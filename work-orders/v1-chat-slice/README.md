# V1 chat slice — work order (V1-01 groundwork)

Created 2026-09-21 by OpenCode (owner/integration writer for this slice).
**V1-01 ACCEPTED 2026-09-21** (roadmap V1 acceptance plan, Louis review of the
live-turn evidence and launched window); this work order records the slice's
evidence and hashes.

## Scope of this increment

Per the roadmap's "Next implementation slice: V1-01 only":

- Installed-SDK evaluation for Apple Foundation Models on this Mac
  (`SDK-EVALUATION-20260921.md`).
- **Nisi-owned Swift session seam** (deterministic core):
  - bounded multi-turn transcript with a UTF-16 tail-kept context window,
  - single-flight (one model turn at a time, second request → `busy`),
  - cooperative cancellation seam, unavailable-model/error states,
  - streaming collector over the installed `LanguageModelSession.streamResponse`,
  - all authority/egress/persistence flags false.
- In-process deterministic self-tests (no model, no I/O, no network).
- **Explicit live streaming verification DONE (2026-09-21):** two real turns on
  the actual Mac's on-device model, including a multi-turn context proof. Full
  evidence (requests, replies, hashes) in `SDK-EVALUATION-20260921.md`.

Not in this increment: finished chat-UI polish, shell/files/MCP tool bridge, Jev
or OpenCode specialists. Those stay out of the first chat slice by roadmap rule.

## Core design context (Louis, 2026-09-21)

**Heterogeneous inference is a core design choice.** Mac Nisi (structured
draft/review seam) and the Windows worker (schema-1 chat worker records)
produce structurally different candidates on purpose: the divergence is the
advantage — more independent choices for the later merger. Never normalize the
two lanes into one output format. This slice preserves the Mac lane's native
contract; recorded in `roadmap.md` under "Direction — September 21, 2026".

## Files

- `session-seam/NisiChatLog.swift` — pure log rules (refusals, window dropping,
  single-flight guard). No FoundationModels import.
- `session-seam/NisiTurnController.swift` — pure turn-control state machine:
  one-flight-at-a-time, halt latch, chunk metrics, stop classification. No
  FoundationModels import.
- `session-seam/NisiChatSession.swift` — `actor` transport over
  `FoundationModels` (`SystemLanguageModel`, `LanguageModelSession`,
  `streamResponse`): the only file that touches the model framework. Since the
  2026-09-21 quality increment it keeps ONE native `LanguageModelSession` per
  conversation, seeded from the stored transcript, and streams only the new
  user text; sampling `.random(top:50)@0.7`.
- `../v1-02-lifecycle/session-seam/NativeTranscriptBuilder.swift` — shared pure
  transcript/tuning builder (compiled into nisi-chat, nisi-session and the
  window).
- `session-seam/NisiChatCLI.swift` — the `nisi-chat` executable
  (`--selftest`, `--status`, `--turn` with the stdin JSON request contract)
  and the deterministic suite.
- `session-seam/NisiChatWindow.swift` — minimal SwiftUI window over the actor
  (message list, input, busy state, notice area). Persists via the shared
  `ConversationStore` (v1-02).
- `session-seam/NisiChatApp.swift` — `@main` app entry (one "Nisi" window in
  the 2026-09-23 Mac source pass).
- `SDK-EVALUATION-20260921.md` — installed-SDK facts, verified API surface,
  live turn evidence and hashes.

## Verified now (deterministic + live)

The commands and binary pins below preserve the 2026-09-21/23 baseline
record. The later Mac enhancement pass, its 48/48 and 67/67 source checks,
and its separate live-turn evidence are in
`../../docs/AGIW-NISI-ENHANCEMENT-2026-09-23.md`. At that checkpoint, the
updated app was signed and installed on disk, but the running process had not
been relaunched. The current running process is noted below.

```
swiftc -parse-as-library -target arm64-apple-macos26.0 -typecheck \
  NisiChatLog.swift NisiTurnController.swift NisiChatSession.swift \
  ../../v1-02-lifecycle/session-seam/NativeTranscriptBuilder.swift \
  NisiChatWindow.swift NisiChatApp.swift                -> exit 0 (all sources)
swiftc -O -parse-as-library -target arm64-apple-macos26.0 \
  NisiChatLog.swift NisiTurnController.swift NisiChatSession.swift \
  ../../v1-02-lifecycle/session-seam/NativeTranscriptBuilder.swift \
  NisiChatCLI.swift -o /tmp/nisi-chat                   -> build exit 0
/tmp/nisi-chat --selftest                               -> SELF-TEST OK (47 checks), exit 0
/tmp/nisi-chat --status                                 -> model: available; target: arm64-apple-macos
printf '%s' '{"user":"...","maxContextUtf16":...}' | /tmp/nisi-chat --turn
  -> status PASS with reply + evidence JSON (live; multi-turn verified 2026-09-21)
swiftc -O -parse-as-library -target arm64-apple-macos26.0 \
  NisiChatLog.swift NisiTurnController.swift NisiChatSession.swift \
  ../../v1-02-lifecycle/session-seam/NativeTranscriptBuilder.swift \
  ../../v1-02-lifecycle/session-seam/LocalModelBackend.swift \
  ../../v1-02-lifecycle/session-seam/ConversationStore.swift \
  ../../v1-02-lifecycle/session-seam/ConversationListing.swift \
  NisiChatWindow.swift NisiChatApp.swift -o /tmp/nisi-chat-window
  -> build exit 0; launched as Nisi.app (frontmost, bundleID local.nisi.chat)
```

`nisi-chat` sha256
`64ba35d3911382bcfe80603c40a0995a7e7b29f055953f11c9a5d6c6ae8b5381` (47/47);
`Nisi.app` bundle binary (ad-hoc signed + verified)
`8f06f6b45904a4297d3b8b37d3cc0dcfc7120de7c6f63809109b9099cbe4400e` (2026-09-23
adaptive-depth rebuild; superseded pins `bee0467c…`/`c0e9aa00…`/`37e3d6f0…`
are the 2026-09-21 state). Sources pinned in
`work-orders/v1-02-lifecycle/before-after-20260921.md` (quality, history and
2026-09-23 addendum). Run from `work-orders/v1-chat-slice/session-seam`.

### Current Mac build note (2026-09-24)

The historical window build command above predates V1-03. A build of the
current source also needs
`../../v1-03-project-context/session-seam/TemporaryContextStore.swift` before
`NisiChatWindow.swift`. The signed app was rebuilt from ten SHA-256-pinned
current Swift inputs and launched at 04:50:40 PDT as PID 35630. Its executable
SHA-256 is `ff9f32759446da7920830b938330ec1d38c8a51883ddafc14016ec1b89261c2f`;
the prior bundle (`9ea3e96c…`) is preserved in scratch storage. Strict code
signing verifies, and the new window restored the existing conversation.
The local Gemma route passed a live synthetic CLI turn at the default
640-token budget: five content chunks, reply persisted to an isolated
conversation with a verified digest. An earlier 128-token CLI attempt returned
`EMPTY_REPLY` and saved nothing; a separate raw diagnostic at that budget
produced reasoning-only output and `finish_reason=length`. No synthetic prompt
was entered through the user's window. The exact source/build manifest,
77/77 checks, and live receipts are in
`../v1-02-lifecycle/evidence/sse-crlf-20260924/`.

### Current Mac build note (2026-09-25)

Louis requested an Opus 5.5 check of the September 24 improvements. The
tool-free CLI receipts identify `claude-opus-5-5` for an initial excerpt review
and a focused review after two host-reproduced repairs. The window now shows
`last verified save` and clears that badge when a failed save leaves the JSONL
and sidecar inconsistent. The Mac routing adapter now refuses at the ledger's
whole-second expiry boundary. The current signed executable SHA-256 is
`a9679069e90f00ccf82591ad863eba74d1c74c852c5e7dfd46d826a6a248d4c5`;
strict signature verification passed. On relaunch, accessibility showed the
existing conversation, `last verified save d0dc303d`, and no selected project
files. No new GUI model turn was sent. The exact review packets, receipts,
focused checks and remaining two-file save limitation are in
`../../docs/verification/2026-09-25/mac-v1-opus-review/REPORT.md`.

### 2026-09-23 increment (AGIW window + adaptive depth)

- **Window UX:** live streaming display of the turn in progress (the seam
  resolves cumulative snapshots into display deltas, including across
  autocontinue legs), segmented **AFM / Local gemma backend toggle**
  (`@AppStorage`), distinct red error notices, `resetContext()` when the open
  conversation is deleted.
- **Adaptive depth + autocontinue (approved design):** `ask(...)` defaults to
  `TurnMode.auto` — prompts ≥ 500 UTF-16 auto-upgrade to the experimental
  research tier (deep-thinking prompt, `reasoningLevel: prompt-level`) and
  arm autocontinue (≤ 2 continuation legs on the same native session; honest
  `budget-80pct` truncation heuristic because macOS 26 exposes no
  stopReason — see `AutocontinueProbe.swift` for the live harness).
- **`nisi-status` (new):** one-command self-check — window pid, AFM
  availability, store health, resident LM Studio models; `--json` supported.
- Live proof (AFM, `networkEgress: false`): short 26-utf16 prompt → fast/0
  legs; 607-utf16 prompt → experimental, complete 2519-char reply; forced
  40-token budget → `budgetExhausted true`, **2 continuation legs**, reply
  642–793 chars vs ~160-char single-leg budget. Gate scans 6/6 PASS.

NOTE (2026-09-21): the turn-control logic is a pure layer (`TurnController` +
`PromptAssembler` + `TranscriptExport`); the actor is a thin transport. Runtime
finding — on-device `snapshot.content` is CUMULATIVE; the reply is the last
snapshot (`finalContent`), never a join. self-tests grew 25 → 47 checks.

## Open doors (next slices)

1. Finished chat-UI behavior — window now persists to the Nisi app-support
   store after PASS turns and restores on launch (V1-02 wiring); polish as
   needs arise.
2. V1-02 local conversation lifecycle — first increment done + verified
   (persistence layer, `nisi-session` CLI, relaunch/crash/refusal/delete
   evidence); see `../v1-02-lifecycle/before-after-20260921.md`. Remaining:
   inspect/delete-history UI, first user-driven window save, gate review.
3. Multi-turn context tuning against real measured usage.
4. V1-03 read-only project context after V1-02 acceptance evidence exists.

Never count this groundwork as acceptance; V1-01 gates include the finished
chat surface and gate review of the live streaming evidence.

## V1-01 gate-readiness checklist (2026-09-21)

| Roadmap gate element | State | Evidence |
|---|---|---|
| Send + reply via on-device model | DONE, real turns | 3 live turns, status PASS, request/reply hashes in SDK-EVALUATION |
| Multi-turn context | DONE, proven live | prior-seeded turn answered with seeded context (turn 2) |
| Cancellation / single-flight | DONE (deterministic) | `TurnController` tests: busy refusal, halt latch, stop classes |
| Unavailable-model / error states | DONE (seam) | `modelUnavailable` path; `--status` reports available on this Mac |
| Streaming collection correctness | DONE (live) | cumulative-snapshot finding → `finalContent`, tests + 3 live runs |
| Chat surface (window) | LAUNCHED live | `/tmp/nisi-chat-window`, pid verified running; human interaction review pending |
| Gate review (roadmap acceptance) | ACCEPTED 2026-09-21 | roadmap V1 plan: V1-01 Accepted; next slice V1-02 (plan in `../v1-02-lifecycle/`) |

Binary hashes (`nisi-chat` `e9a3ceda…611b`, window `ec13bdce…a81`) were
pinned at the verified live runs. A later clean rebuild at the same sources
reproduced behavior exactly (47/47 selftest, live turn PASS, `model: available`)
— behavior reproducibility confirmed; byte-identity is not claimed.
