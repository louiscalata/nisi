"""Offline branch checks for the Nisi login activation job.

Run with PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -m unittest discover
-s work-orders/v1-02-lifecycle/startup -p 'test_*.py' -v from the repo root.
The tests never run the job's main function or call LM Studio or open Nisi.
"""

import json
import unittest
from pathlib import Path
from unittest.mock import patch


SOURCE = Path(__file__).with_name("nisi-login-activate.py")
JOB = {"__name__": "nisi_login_activate_test"}
exec(compile(SOURCE.read_text(), str(SOURCE), "exec"), JOB)
MODEL = JOB["MODEL_KEY"]


class Response:
    def __init__(self, status, body):
        self.status = status
        self.body = body

    def read(self, size):
        return self.body[:size]


class Connection:
    response = None

    def __init__(self, *args, **kwargs):
        pass

    def request(self, method, path):
        assert (method, path) == ("GET", "/api/v1/models")

    def getresponse(self):
        return self.response

    def close(self):
        pass


def inventory_case(status, payload):
    Connection.response = Response(status, payload)
    with patch.object(JOB["http"].client, "HTTPConnection", Connection):
        return JOB["inventory"]()


class StartupTests(unittest.TestCase):
    def test_exact_model_and_other_resident_inventory(self):
        body = json.dumps({"models": [
            {"key": MODEL, "loaded_instances": [{"id": "gemma"}]},
            {"key": "other", "loaded_instances": []},
        ]}).encode()
        self.assertEqual(inventory_case(200, body), [MODEL])
        body = json.dumps({"models": [
            {"key": MODEL, "loaded_instances": []},
            {"key": "other", "loaded_instances": [{"id": "other"}]},
        ]}).encode()
        self.assertEqual(inventory_case(200, body), ["other"])

    def test_inventory_refuses_redirect_invalid_and_oversize(self):
        cases = [(302, b"{}"), (200, b"{bad"),
                 (200, b"x" * 262_145), (200, b'{"models": []}'),
                 (200, json.dumps({"models": [
                     {"key": MODEL, "loaded_instances": ["malformed"]}
                 ]}).encode())]
        for status, body in cases:
            with self.subTest(status=status, size=len(body)):
                with self.assertRaises(JOB["InventoryError"]):
                    inventory_case(status, body)

    def test_other_resident_defers_without_loading(self):
        calls = []
        with patch.dict(JOB, {
            "LMS": Path("/usr/bin/python3"),
            "launch_app": lambda: "request-accepted",
            "inventory": lambda: ["other"],
            "command": lambda *args: calls.append(args),
        }):
            receipt = {}
            JOB["activate"](receipt)
        self.assertEqual(receipt["model"], "deferred-other-resident")
        self.assertEqual(receipt["appLaunch"], "request-accepted")
        self.assertEqual(calls, [])

    def test_existing_gemma_is_idempotent(self):
        calls = []
        with patch.dict(JOB, {
            "LMS": Path("/usr/bin/python3"),
            "launch_app": lambda: "request-accepted",
            "inventory": lambda: [MODEL],
            "command": lambda *args: calls.append(args),
        }):
            receipt = {}
            JOB["activate"](receipt)
        self.assertEqual(receipt["model"], "already-loaded")
        self.assertEqual(calls, [])

    def test_empty_inventory_loads_exact_model_then_verifies(self):
        calls = []
        with patch.dict(JOB, {
            "LMS": Path("/usr/bin/python3"),
            "launch_app": lambda: "request-accepted",
            "inventory": lambda: [],
            "command": lambda argv, timeout: calls.append((argv, timeout)) or "exit-0",
            "wait_for_inventory": lambda seconds: ([MODEL], None),
        }):
            receipt = {}
            JOB["activate"](receipt)
        self.assertEqual(receipt["model"], "loaded")
        self.assertEqual(calls, [(["/usr/bin/python3", "load", MODEL, "-y"], 150)])

    def test_unreachable_server_has_bounded_start(self):
        calls = []

        def unreachable():
            raise ConnectionRefusedError()

        with patch.dict(JOB, {
            "LMS": Path("/usr/bin/python3"),
            "launch_app": lambda: "request-accepted",
            "inventory": unreachable,
            "command": lambda argv, timeout: calls.append((argv, timeout)) or "exit-0",
            "wait_for_inventory": lambda seconds: (None, "server-unreachable"),
        }):
            receipt = {}
            JOB["activate"](receipt)
        self.assertEqual(receipt["model"], "inventory-unavailable")
        self.assertEqual(calls, [([
            "/usr/bin/python3", "server", "start", "--port", "1234", "--bind", "127.0.0.1"
        ], 20)])


if __name__ == "__main__":
    unittest.main()
