# Mac Nisi local activation and Opus 5.5 check — 2026-09-25

This is a **private Mac v1** maintenance record. It does not change the public
Node Nisi v0.2 release or close any v1 acceptance milestone.

## Initial readback

The September 24 signed app was still intact, but on September 25 the Nisi
window was not running and LM Studio reported zero loaded models. A fresh
`nisi-status --json` showed `window: null`, `local.state: running`,
`local.loaded: []`, and a healthy 16-message default conversation. The
September 24 app/model activation claim was a snapshot of that session, not a
persistent startup guarantee. No crash report from the later app shutdown was
found; two earlier accessibility crashes predated the September 24 build.

## Review and changes

Claude CLI receipts for this continuation report the actual
`claude-opus-5-5` model with tools disabled. The first review found that
`finish_reason: "length"` was ignored, so a partial answer with `[DONE]`
could be saved as `PASS` with `budgetExhausted: false`. It also found that
the documented resident-only rule was not checked before the LM Studio chat
POST. The post-fix review identified a second partial-save case for other
explicit non-stop finish reasons. The Swift parser now rejects `length` as
`SSE_OUTPUT_LIMIT` and any other explicit non-stop finish as
`SSE_NONSTOP_FINISH`; a normal `stop` or omitted reason retains the existing
behavior. On failure the pending user turn is rolled back before a save.

The local backend now checks LM Studio's exact, bounded loopback model
inventory before sending a chat request and returns `MODEL_NOT_LOADED` when
Gemma is absent. The check and POST are separate operations. Another LM Studio
client could unload Gemma between them, while the server's just-in-time
loading remains enabled. This is a preflight refusal, not an absolute
no-cold-start guarantee.

At Louis's request, a one-shot Aqua LaunchAgent now runs the
[`startup` script](../../startup/README.md) at login. It checks the exact
Gemma key, starts the loopback server if unavailable, loads Gemma if no other
model is resident, and opens the stable per-user app. It defers model loading
when another model is resident so it does not deliberately evict that model.
It records a bounded, owner-only receipt and does not generate an answer.

## Checks and readback

| Check | Observed result |
|---|---|
| Swift `nisi-session --selftest` | 88/88 pass after the non-stop finish repair. |
| Startup mock tests | 6/6 pass; exact key, malformed/redirect/oversize inventory, idempotence, other-resident deferral, and bounded server start. |
| Unloaded local CLI turn | `MODEL_NOT_LOADED`, exit 65; no scratch conversation or model load. |
| Login job bootstrap | Exit 0. Receipt reported `loadedBefore: []`, `modelLoadCommand: exit-0`, `loadedAfter` containing exact Gemma. `lms ps --json` reported Gemma loaded with `ttlMs: null`. |
| Login job repeat | Exit 0. Receipt reported `already-loaded`, with no second load command. |
| Loaded local CLI turn | `PASS`, six chunks, 21-character reply, one synthetic user/assistant pair saved in scratch; file hash matched `SAVED_SHA256` (`a032f86d…`). |
| Deliberately limited live CLI turn | `SSE_OUTPUT_LIMIT`, exit 65; no scratch conversation file. |
| Signed app | Installed at `~/Applications/Nisi.app`; strict signature verification passed; executable SHA-256 `f1917f4726df89c86062ce091c469ca92dc6b6604b133e7a24027f1c5460795f`. |
| GUI and status | Accessibility showed the existing 16-message conversation, an empty composer, and Local gemma selected. A later `nisi-status --json` reported a window PID and exact Gemma loaded. |

The one-shot job's `open` call returned success and an app process appeared,
but that first process later exited after AppKit logged a mouse-up action and
termination. The cause is not established. The final app was then opened
through the UI and observed running. A login or reboot has not been tested,
and no GUI Send turn was made; the status CLI intentionally reports
`inferenceVerified: false` because it only reads inventory. The separate
scratch CLI result supplies the live inference evidence.

The exact app build, ten source hashes, plist assembly, signing and install
steps are in [build-install-manifest.json](build-install-manifest.json). The
job receipt, `launchctl` readback, loaded-model inventory, status JSON,
self-test log, startup test log, and scratch-store check are retained here.
All tests and live prompts used synthetic content. The user's default
conversation remained at 16 messages. No GitHub push was made.
