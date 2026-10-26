# Mac local SSE CRLF repair — 2026-09-24

> This records the September 24 session. A September 25 readback found the
> window stopped and Gemma unloaded. The later activation and review are in
> [the September 25 record](../opus-activation-20260925/RESULT.md); the
> September 24 launch was not a persistent startup guarantee.

## Scope

The Mac `nisi-session` local LM Studio stream decoder accepted LF-delimited
`data: [DONE]` but retained a terminal CR from CRLF. The completion marker then
failed to match and `requireComplete()` reported `SSE_INCOMPLETE`. The same
decoder is used by the CLI and the Mac window's local turn runner.

Only `session-seam/LocalModelBackend.swift` and
`session-seam/NisiSessionCLI.swift` changed for this repair. The decoder removes
one terminal CR only when LF arrives, after the raw bytes have been counted.
The self-test now byte-feeds CRLF JSON content, blank line and `[DONE]`, plus
the line-cap edge where CR must still count. Strict UTF-8, missing-DONE refusal,
and the loopback-only endpoint rule were not loosened.

## Before and after checks

| Stage | Result |
|---|---|
| Exact isolated baseline built from canonical sources | `nisi-session --selftest`: 72/72 PASS |
| Three new checks against unchanged production decoder | 2/75 FAIL (CRLF normalization and completion); CR line-cap control PASS |
| Isolated corrected decoder and tests | 75/75 PASS |
| Rebased on concurrent `loadWithDigest` changes | 77/77 PASS |
| Canonical two-file integration | Exact bytes matched rebased candidate; `swiftc` build and `--selftest` 77/77 PASS |
| Fresh canonical build on 2026-09-24 | `nisi-session --selftest`: 77/77 PASS |
| Scratch mutant with only the CR removal deleted | 2/77 FAIL: CRLF normalization and completion |
| `git diff --no-index --check` on the untracked source and report files | No whitespace diagnostics; exit 1 is the expected file-diff status |
| Live local CLI, synthetic prompt, 640-token budget | PASS: five content chunks, 24-character reply, schema-2 scratch conversation saved and digest verified |
| Signed Mac app rebuilt from ten pinned current Swift inputs | PASS: strict signature, launched PID 35630, prior conversation restored; live window turn not run |

Original source SHA-256 before this repair:

- `LocalModelBackend.swift`: `c0c08c4229c8409f8e2d76c298118555502c88918dfc2ba9d854419354db2703`
- `NisiSessionCLI.swift`: `f91e32c3375e6ee3aa5d613373521ec4abdbd2fb6a26274f72442c28aa0eb57c` (the concurrent digest-test edit changed this to `aad3a5fd5561273bf76704baccec416b4e1ba95b20e39a6fcbb974e84c354d73` before integration)

Integrated source SHA-256:

- `LocalModelBackend.swift`: `66bcecf8b4a1df888b27590c8fc701b093b6eab2825184947c64a4abeae8dbaf`
- `NisiSessionCLI.swift`: `b38d0bc4fc0e0ababcc26c7e8c8e920dff42384bacf9441813c1c66ab66e30ac`

## Review and boundary

Fable returned `NOT_RUN` because usage credits were unavailable. Sonnet
returned `NOT_RUN` after an invalid structured response. Opus 5.5 produced an
actual tool-disabled PASS review with zero issues; receipt files are alongside
this report. Independent Astra review found no P1/P2 issue and probed exact
stream cap, invalid UTF-8, EOF after CR, and double-CR refusal against the
candidate declarations.

The initially installed binary (`9ea3e96c…`) contained the repair by read-only
disassembly, but its full build inputs were not recorded. That bundle is
preserved at `/tmp/nisi-window-repro.mEu9Nq/Nisi.before.app`. The replacement
was built from ten current Swift files with source hashes and exact build
command in `app-build-manifest-preinstall.json`; the source hashes matched before install.
The signed replacement executable has SHA-256
`ff9f32759446da7920830b938330ec1d38c8a51883ddafc14016ec1b89261c2f`.
Strict code-signature verification passed. It launched at 04:50:40 PDT as PID
35630, and the running executable inode matched the on-disk file. The window
restored the user's prior conversation with an empty input and Local gemma
selected. The default 16-message store remained healthy. The post-install
checks and retained prior-bundle path are in `app-install-result.json`.

LM Studio initially reported zero loaded models, so no Nisi turn was sent until
the configured Gemma was explicitly loaded; no other resident model was evicted.
A 128-token synthetic CLI attempt returned `EMPTY_REPLY`. A separate raw SSE
diagnostic at the same budget showed only `reasoning_content` and
`finish_reason=length`, supporting budget exhaustion as the explanation. A bounded retry at Nisi's
640-token CLI default returned `PASS` with five content chunks and saved exactly
one synthetic user/assistant pair in scratch storage. The saved file and sidecar
matched the CLI digest. See `live-local/RESULT.md` for the before/after and
retained command output. This LM Studio stream used LF line endings; the CRLF
branch is verified by the byte-fed regression and scratch mutant tests. Fresh
`nisi-status --json` reports the new window PID,
healthy store, and loaded Gemma. Its `inferenceVerified=false` flag is an
inventory-only design boundary, not a verdict on the separate CLI live turn.

No synthetic prompt was entered into the user's window conversation. A live
turn through the GUI, Windows execution, Nisi/Jev route, and public CLI release
were not part of this repair. Mac v1 acceptance remains 1/8 pending user review
of V1-02 and V1-03.
