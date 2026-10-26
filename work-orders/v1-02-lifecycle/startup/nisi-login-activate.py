#!/usr/bin/python3
"""Activate the local Nisi app and its configured LM Studio model at user login.

This runs once per Aqua login via a user LaunchAgent. It never unloads a model,
and it declines to load Gemma when another model is already resident. The
inventory check and a subsequent load cannot be atomic with other LM Studio
clients; the result is recorded rather than represented as an eviction proof.
"""

import datetime
import fcntl
import http.client
import json
import os
import plistlib
import subprocess
import tempfile
import time
from pathlib import Path


MODEL_KEY = "google/gemma-4-26b-a4b-qat"
LMS = Path("/Users/louiscalata/.lmstudio/bin/lms")
APP = Path("/Users/louiscalata/Applications/Nisi.app")
APP_EXECUTABLE = APP / "Contents/MacOS/nisi-chat-window"
APP_INFO = APP / "Contents/Info.plist"
STATE_DIR = Path("/Users/louiscalata/Library/Application Support/Nisi")
LOCK_FILE = STATE_DIR / "login-activation.lock"
RECEIPT_FILE = STATE_DIR / "login-activation-last.json"
INVENTORY_LIMIT = 262_144


class InventoryError(Exception):
    pass


def inventory():
    """Read a bounded, exact-key local inventory without redirects or proxies."""
    connection = http.client.HTTPConnection("127.0.0.1", 1234, timeout=2)
    try:
        connection.request("GET", "/api/v1/models")
        response = connection.getresponse()
        if response.status != 200:
            raise InventoryError("inventory-http-" + str(response.status))
        raw = response.read(INVENTORY_LIMIT + 1)
        if len(raw) > INVENTORY_LIMIT:
            raise InventoryError("inventory-too-large")
    finally:
        connection.close()

    try:
        payload = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise InventoryError("inventory-invalid-json") from error
    if not isinstance(payload, dict) or not isinstance(payload.get("models"), list):
        raise InventoryError("inventory-invalid-shape")

    loaded = []
    seen_target = False
    for model in payload["models"]:
        if not isinstance(model, dict):
            raise InventoryError("inventory-invalid-shape")
        key = model.get("key")
        instances = model.get("loaded_instances")
        if (not isinstance(key, str) or not key or not isinstance(instances, list)
                or any(not isinstance(instance, dict) for instance in instances)):
            raise InventoryError("inventory-invalid-shape")
        if key == MODEL_KEY:
            seen_target = True
        if instances:
            loaded.append(key)
    if not seen_target:
        raise InventoryError("configured-model-not-listed")
    return loaded


def command(argv, timeout):
    try:
        completed = subprocess.run(
            argv,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=timeout,
            check=False,
        )
        return "exit-" + str(completed.returncode)
    except subprocess.TimeoutExpired:
        return "timeout"
    except OSError as error:
        return "os-error-" + str(error.errno)


def launch_app():
    try:
        with APP_INFO.open("rb") as stream:
            info = plistlib.load(stream)
        if info.get("CFBundleIdentifier") != "local.nisi.chat":
            return "wrong-bundle-identifier"
        if info.get("CFBundleExecutable") != "nisi-chat-window":
            return "wrong-bundle-executable"
        if not APP_EXECUTABLE.is_file() or not os.access(APP_EXECUTABLE, os.X_OK):
            return "missing-executable"
    except (OSError, plistlib.InvalidFileException):
        return "missing-or-invalid-bundle"
    result = command(["/usr/bin/open", "-a", str(APP)], 15)
    return "request-accepted" if result == "exit-0" else "open-" + result


def write_receipt(receipt):
    data = json.dumps(receipt, sort_keys=True, indent=2).encode("utf-8") + b"\n"
    fd, temporary = tempfile.mkstemp(prefix=".login-activation-", dir=str(STATE_DIR))
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, RECEIPT_FILE)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def wait_for_inventory(seconds):
    deadline = time.monotonic() + seconds
    last_error = "server-unreachable"
    while True:
        try:
            return inventory(), None
        except InventoryError as error:
            # A responding but malformed/incompatible server must not trigger
            # a model load. A later response may still become valid at startup.
            last_error = str(error)
        except (OSError, TimeoutError) as error:
            last_error = "server-unreachable-" + type(error).__name__
        if time.monotonic() >= deadline:
            return None, last_error
        time.sleep(min(2, max(0, deadline - time.monotonic())))


def activate(receipt):
    receipt["appLaunch"] = launch_app()

    if not LMS.is_file() or not os.access(LMS, os.X_OK):
        receipt["model"] = "lms-cli-unavailable"
        return

    try:
        loaded = inventory()
    except InventoryError as error:
        # Do not send a second start request to a responding incompatible server.
        receipt["initialInventory"] = str(error)
        loaded = None
    except (OSError, TimeoutError) as error:
        receipt["initialInventory"] = "server-unreachable-" + type(error).__name__
        receipt["serverStart"] = command(
            [str(LMS), "server", "start", "--port", "1234", "--bind", "127.0.0.1"],
            20,
        )
        loaded, inventory_error = wait_for_inventory(30)
        if inventory_error is not None:
            receipt["inventoryError"] = inventory_error

    if loaded is None:
        receipt["model"] = "inventory-unavailable"
        return
    receipt["loadedBefore"] = loaded
    if MODEL_KEY in loaded:
        receipt["model"] = "already-loaded"
        return
    if loaded:
        receipt["model"] = "deferred-other-resident"
        return

    # Re-read immediately before loading to narrow, but not eliminate, races
    # with other clients. Never issue unload or an eviction command.
    try:
        loaded = inventory()
    except (InventoryError, OSError, TimeoutError) as error:
        receipt["model"] = "preload-inventory-unavailable"
        receipt["preloadError"] = type(error).__name__
        return
    if MODEL_KEY in loaded:
        receipt["model"] = "already-loaded"
        return
    if loaded:
        receipt["model"] = "deferred-other-resident"
        receipt["loadedBefore"] = loaded
        return

    receipt["modelLoadCommand"] = command([str(LMS), "load", MODEL_KEY, "-y"], 150)
    after, inventory_error = wait_for_inventory(20)
    if inventory_error is not None:
        receipt["postloadInventoryError"] = inventory_error
    if after is not None:
        receipt["loadedAfter"] = after
    receipt["model"] = "loaded" if after is not None and MODEL_KEY in after else "load-unverified"


def main():
    STATE_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    with LOCK_FILE.open("a+") as lock:
        os.chmod(LOCK_FILE, 0o600)
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0
        receipt = {
            "schemaVersion": 1,
            "timeUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "modelKey": MODEL_KEY,
            "inventoryScope": "127.0.0.1:1234/api/v1/models",
            "generationObserved": False,
            "appLaunch": "not-attempted",
            "model": "not-attempted",
        }
        try:
            activate(receipt)
        except Exception as error:
            receipt["error"] = type(error).__name__
            receipt["model"] = "startup-error"
            if receipt["appLaunch"] == "not-attempted":
                receipt["appLaunch"] = launch_app()
        write_receipt(receipt)
        return 0 if receipt["appLaunch"] == "request-accepted" and receipt["model"] in (
            "already-loaded", "loaded"
        ) else 1


if __name__ == "__main__":
    raise SystemExit(main())
