# Nisi login activation

This user LaunchAgent starts Nisi at Aqua login and attempts to make the
configured local Gemma model resident in LM Studio. It starts the LM Studio
server on `127.0.0.1:1234` only when the inventory endpoint is unreachable.
It never sends an unload command. If another model is resident and Gemma is
not, it defers the load and still opens Nisi. It does not generate a reply, so
the resulting receipt is an activation record, not an inference proof.

The source files here are not active until installed. The stable installation
targets are:

- App: `~/Applications/Nisi.app`
- Script: `~/Library/Application Support/Nisi/bin/nisi-login-activate.py`
- LaunchAgent: `~/Library/LaunchAgents/com.louiscalata.nisi.login-activation.plist`
- Last receipt: `~/Library/Application Support/Nisi/login-activation-last.json`

After verifying the signed app, install a copy at the stable app path. Install
the script with mode `0700` and the plist with mode `0600`. Check the plist
with `plutil -lint`, then load it with:

```sh
launchctl bootstrap "gui/$(id -u)" \
  ~/Library/LaunchAgents/com.louiscalata.nisi.login-activation.plist
```

`RunAtLoad` runs it immediately in the current login session. The job is
one-shot and does not reopen the app after an intentional window close. For a
controlled repeat after installation, use:

```sh
launchctl kickstart -k "gui/$(id -u)/com.louiscalata.nisi.login-activation"
```

Read the last receipt, `nisi-status --json`, and LM Studio's `lms ps --json`.
The receipt records whether the app open request was accepted and whether the
provider inventory reported the exact Gemma key loaded. It cannot establish
that the GUI generated an answer. A current-session `bootstrap`/`kickstart`
test does not establish that a future login or reboot ran the job; verify that
separately after a real login.

The inventory and the model load are separate LM Studio operations. Another
client could load a model between them, so the pre-load check narrows but does
not eliminate that race. The job has bounded server and model-load waits and
records failure states rather than silently claiming activation.
