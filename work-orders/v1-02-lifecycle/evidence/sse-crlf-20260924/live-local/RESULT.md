# Nisi Mac local turn verification — 2026-09-24

Verdict: **PASS** for the configured Nisi local route with a 640-token cap. A 128-token CLI attempt first returned `EMPTY_REPLY`. A separate diagnostic request at the same budget produced only model reasoning and ended at the length limit, supporting budget exhaustion as the explanation. The higher-budget retry produced streamed answer content and saved exactly one synthetic user/assistant turn in scratch storage.

## Scope and method

- Canonical source: `~/nisi/work-orders/v1-02-lifecycle/session-seam`.
- Built current-source `nisi-session` in the original scratch directory (`/tmp/nisi-live-20260924-iwSFbu`) with the documented eight Swift inputs; build exit 0. Binary SHA-256: `3949214665435b5a5feea6c8889d25e6404a23327272480a5dfd9624060b5ae3`. Selected receipts were copied beside this report.
- `nisi-session --selftest`: exit 0, `SELF-TEST OK (77 checks)`; full output in `selftest.log`.
- Built current-source `nisi-status` with `NisiChatLog.swift`, `NisiTurnController.swift`, `ConversationStore.swift`, `NisiStatusCLI.swift`, and AppKit; build exit 0. Binary SHA-256: `063d60cbd256979f7cfcf7f42c75b3c6a58df346d4f4b661d76fe9c4e8a8dc1e`.
- Initial preflight: `nisi-status --json` in `status-before-load.json` reported `local.loaded=[]`. LM Studio `/api/v1/models` in `inventory-before-load.json` reported no loaded instances. The configured model was then explicitly loaded by the parent task without evicting another resident model.
- Loaded-state preflight immediately before inference: `lms ps` showed `google/gemma-4-26b-a4b-qat` IDLE, and fresh `nisi-status --json` reported it in `local.loaded` with `local.state=running`.
- Scratch conversation path: `/tmp/nisi-live-20260924-iwSFbu/synthetic-conversation.jsonl`. No user conversation was read or changed by the turn runner.

## Live-turn result

The first Nisi CLI turn used `request-128.json`, a synthetic prompt with `maxTokens=128`, and `--backend local`. CLI exit was 0, stderr was empty, and `turn-128-stdout.txt` reports `status=EMPTY_REPLY`, `chunks=0`, `replyChars=0`, `contentPersisted=false`, `RESTORED_MESSAGES 0`, request SHA-256 `6ce5224830cc899b0df6348c720ef1a6b211b040a9ac9cfbea1d065e4d8de18e`, and empty-reply SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`. The scratch conversation was not created; `--check` returned `REFUSED missingFile` (exit 66).

One separate raw OpenAI-compatible SSE request to the same loaded model, same synthetic prompt, same `max_tokens=128` and `temperature=0.8` returned HTTP 200 and 126 JSON events followed by `[DONE]`. Of those events, 125 carried `delta.reasoning_content` (501 characters total), **zero** carried `delta.content`, and the final `finish_reason` was `length`. These counts are retained in `raw-sse-summary.json` without model reasoning text. The original raw stream and headers remain in the scratch directory. This sampled request exhausted its output cap before producing answer content, supporting the budget explanation for the first CLI result; the first CLI stream itself was not captured at the wire level.
The captured LM Studio wire stream used LF line endings (254 LF, zero CRLF), so
the live turn verifies the local route while the byte-fed regression tests
verify the CRLF branch.

The status CLI only reports inventory and cannot itself mark generation observed. The 128-token CLI turn and raw request establish generation reached LM Studio, but that first turn did not produce or persist a user-visible answer. No app edit, canonical repo edit, commit, or push occurred in this lane.

## One authorized 640-token retry

The retry used the same synthetic prompt in `request-640.json` and the same scratch conversation path with `--backend local`. Request SHA-256 was `636129fb55ede97c38255ece38c561560cd33720c7c57bd47ef023d10ab1b018`. CLI exit was 0, stderr was empty, and `turn-640-stdout.txt` reports `status=PASS`, `backend=lmstudio-loopback`, `transport=loopback-http`, `chunks=5`, `streamedChars=24`, `replyChars=24`, and `contentPersisted=true`. The reply was `I received your message.` with SHA-256 `274d7ad1f3b0b7fb633098a1e10cfe82fbf3e78d85feb4c6749864cb3bb38a64`.

`--check` exited 0 and loaded schema 2 with two messages (`post-check.txt`). The scratch JSONL has exactly one user entry with the synthetic prompt and one assistant entry with that reply. The file SHA-256 and owner-only sidecar both equal the CLI `SAVED_SHA256`: `5950bff073fd0989335efb6fb47fcdefc9971f72117678b03d1cf9bd1619ed30`. The JSONL and sidecar permissions are `-rw-------`. Fresh status and `lms ps` outputs in `status-after-turn.json` and `post-lms-ps.txt` show the configured Gemma still loaded and IDLE. The default Nisi store remains healthy with its preexisting 16 messages; the synthetic conversation was kept only in scratch storage.

The 128-token result remains a real short-budget failure. This evidence establishes the current-source CLI's streamed local route at 640 tokens, not a live turn through the installed window. This test lane made no canonical repo or app edits, commits, or pushes.

The status CLI build line in `work-orders/v1-02-lifecycle/README.md` originally omitted `NisiTurnController.swift` and failed because `ConversationStore.swift` needs `TranscriptEntry`. The parent task corrected that line and independently built the corrected command.

## Signed app integration by the parent task

After this CLI verification, the parent task installed a new signed `Nisi.app`
from the ten source files pinned in `../app-build-manifest-preinstall.json`. All ten source
hashes matched that manifest immediately before installation. The new executable
SHA-256 is `ff9f32759446da7920830b938330ec1d38c8a51883ddafc14016ec1b89261c2f`.
The original bundle was preserved at `/tmp/nisi-window-repro.mEu9Nq/Nisi.before.app`
with executable SHA-256 `9ea3e96c448905ca00aac0dda818b190ff87a82654eb35c20f0617d83ab848c5`.
Strict code-signature verification passed. The new app launched as PID `35630`
at 04:50:40 PDT; its running executable inode matched the on-disk file. The
window restored the existing conversation with an empty message input, and
fresh `nisi-status --json` reported that PID, a healthy 16-message default
store, and the configured Gemma model loaded. No synthetic prompt was entered
into the user's window conversation. A live window turn remains untested.
