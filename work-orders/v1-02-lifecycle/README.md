# V1-02 — Local conversation lifecycle (planning work-order)

Created 2026-09-21 by OpenCode. **Planning + first implementation increment.**
V1-02 is the next implementation slice after V1-01 was accepted (roadmap V1
acceptance plan; state Accepted 2026-09-21). This document records the decided
storage choice and the plan; the implemented increment is verified and its
evidence is in `before-after-20260921.md`.

## Scope (roadmap V1-02 row)

Explicit storage choice; bounded context; inspect/delete history; relaunch/crash
tests; cancellation and privacy behavior. **No secure-erasure claim.**

## What V1-01 already contributes (reuse, do not duplicate)

| Asset | Role in V1-02 |
|---|---|
| `ChatLog` (UTF-16 tail-kept window) | Already enforces bounded in-memory context; becomes the load boundary for persisted transcripts |
| `TurnController` (single-flight, halt, stop classes) | Cancellation and in-flight privacy behavior stay on this seam |
| `TranscriptExport` (`Codable`, tail-capped 64 entries, `messageCount`/`totalUtf16`) | Ready-made serialization shape for history inspection/export |
| `PromptAssembler` + honesty flags | Keep flags false through lifecycle (no network, no tools, no authority) |
| `nisi-chat` CLI + `NisiChatWindow` | Relaunch/crash-test harness targets (both are already launchable binaries) |

## Storage decision (explicit choice — the gate's first requirement)

Options:

1. **Bounded JSONL store in a Nisi-owned application-support directory with a
   sha256 integrity sidecar** — recommended. Recommended location
   `~/Library/Application Support/Nisi/` (project-owned, no imports of other
   projects' data). One file per conversation; header line carries schema
   version + maxContextUtf16 + createdAt; message lines are `TranscriptEntry`
JSON. Recommendation reasons: crash-testable (truncated tail detectable),
    inspectable, delete = remove the conversation file, and the sidecar catches
    corruption before load.
2. In-memory only + user-initiated export (no persistence) — simplest, but
   fails the "relaunch" leg of the gate (relaunch/crash tests require state to
   survive a relaunch).
3. SQLite/FoundationDB — heavier than the slice needs; rejected at planning.

**Decision: OPTION 1 CONFIRMED 2026-09-21 (OpenCode decided on Louis's behalf
per "decide for me").** Bounded JSONL store in `~/Library/Application Support/
Nisi/` with a sha256 integrity sidecar; one file per conversation; header line
carries schema version (2) + conversationId + maxContextUtf16 + createdAt;
message lines are `TranscriptEntry` JSON; delete = remove the conversation file
and sidecar — ordinary file removal, **no secure-erasure claim**.

## Slice plan (implementation order; first increment done 2026-09-21)

1. **Persistence layer (Nisi-owned, pure where possible):** conversation
   store protocol; JSONL writer/reader; schema-version header; byte cap
   (e.g. 1 MB per conversation, prune oldest message lines when over the cap on
   load — bounded context applies to disk too); sha256 sidecar on write;
   refusal to load mismatched sidecar or malformed schema (offer clean start).
2. **Bounded context:** load path enforces the same UTF-16 tail-kept rule via
   `ChatLog`; persistence never grows without bound (per-file cap + count cap).
3. **Inspect/delete history:** window list of conversations (name, message
   count, utf16 total via `TranscriptExport`); delete action removes the file
   and sidecar. Deletion is ordinary file removal — **no secure-erasure
   claim** (roadmap rule).
4. **Relaunch/crash tests (deterministic):** start binary → send turn →
   kill -9 mid-turn → relaunch → transcript restored minus the in-flight turn
   (or gracefully excluded); corrupted/truncated file → refuse + clean-start
   path; relaunch with restored multi-turn context → live follow-up answers
   with restored context (mirror of the V1-01 prior-seed proof).
5. **Cancellation/privacy behavior:** halt button in window wired to
   `cancelTurn()`; refused-chunk rule unchanged; nothing persisted until the
   turn completes PASS (in-flight partial text never written);
   `contentPersisted` flag becomes honest (true only after an actual store
   write, per-run in evidence).

## Acceptance evidence template (for the V1-02 gate)

- Storage choice recorded in the roadmap/decision log with Louis's confirm.
- Deterministic suite extended (load/refuse/cap/prune/restore checks); exit 0.
- Kill-then-relaunch evidence: transcript restored, no partial turn retained.
- Corrupt-file evidence: refused + clean-start path shown.
- One live follow-up answered with restored context (hash-bound like V1-01).
- Honesty flags: `contentPersisted` true ONLY when a store write actually
  happened; network/tools/authority remain false. No secure-erasure claim.

Status (2026-09-21): persistence layer, `nisi-session` (turn/check/delete),
window persistence, crash/kill evidence, **history UI (inspect + delete in the
window, plus a `--list` CLI leg)**, and the before/after inference record are all
done and verified — see `before-after-20260921.md`. **V1-02 implementation
complete; the acceptance-evidence checklist in the record maps to this README's
template. Remaining: Louis's acceptance review.**

## Chat-quality increment (2026-09-21, Louis: "make it smarter"; all 3 options)

- **AFM driving fixed** (`NisiChatSession.swift`): one persistent
  `LanguageModelSession` per conversation, seeded from the stored transcript via
  `NativeTranscriptBuilder.swift` (instructions entry first, then
  prompt/response entries — restore **without replaying generation**); each turn
  streams only the new user text. Sampling `.random(top: 50, seed: nil)` @ 0.7
  temperature (was greedy), default budget 1280 (was 640). Evidence gains
  `backend` / `transport` / `nativeSession`.
- **Bigger local model route** (`LocalModelBackend.swift`): `--backend local`
  streams the already-resident `google/gemma-4-26b-a4b-qat` (LM Studio,
  `http://127.0.0.1:1234/v1/chat/completions`, OpenAI-compatible SSE). Loopback
  only → `networkEgress: false` stays, `transport: loopback-http` reported
  honestly. **Backend choice recorded in roadmap** (Louis): local route = bigger
  brain on-device, not an egress path.
- **Verified:** suites `nisi-chat` 47/47 + `nisi-session` **44/44**; live AFM
  reply 296 chars natural prose (was 35-char terse) and local route 607-char
  structured reply, both PASS + persisted to conversation
  `EAFA1198-4F91-4961-8BCA-1338D6D7B84D`; window rebuilt (current 2026-09-23
  bundle binary
  `8f06f6b45904a4297d3b8b37d3cc0dcfc7120de7c6f63809109b9099cbe4400e`,
  signed + verified), relaunched frontmost, quit. Full evidence in
  `before-after-20260921.md` (incl. the 2026-09-23 addendum: adaptive depth,
  autocontinue, `nisi-status`, window UX).
- **History UI:** the window's History panel lists every conversation in the
  Nisi app-support directory (count, utf16 total, verified/corrupt, newest
  first) with a per-conversation Delete (ordinary file removal, corrupt
  conversations are reported, never silently deleted). Backed by pure
  `ConversationListing.swift`; the `--list [dir]` CLI leg does the same for
  shells. Live proof: `nisi-session --list` → `conversation-default.jsonl
  verified 12 msgs utf16 1335 EAFA1198…B84D`.
- Build (from `session-seam/`):
  `swiftc -O -parse-as-library -target arm64-apple-macos26.0 ConversationStore.swift ConversationListing.swift NisiSessionCLI.swift NativeTranscriptBuilder.swift LocalModelBackend.swift ../../v1-chat-slice/session-seam/NisiChatLog.swift ../../v1-chat-slice/session-seam/NisiTurnController.swift ../../v1-chat-slice/session-seam/NisiChatSession.swift -o /tmp/nisi-session`
  → `nisi-session` sha256
  `1bdb70168aeaf8f75cbeb2b244818a92a79ee34f53c1d2e2900d4b7075290ebc` (2026-09-23
  rebuild), selftest 44/44 exit 0.
  Usage: `nisi-session <path> < request.json` (default AFM),
  `nisi-session <path> --backend local < request.json`, `nisi-session --list`.
- **`nisi-status` (new, 2026-09-23):** one-command self-check — window pid,
  AFM availability, store health, resident LM Studio models; `--json` for
  scripts. Build: `swiftc -O -parse-as-library -target arm64-apple-macos26.0
  ../../v1-chat-slice/session-seam/NisiChatLog.swift
  ../../v1-chat-slice/session-seam/NisiTurnController.swift
  ConversationStore.swift NisiStatusCLI.swift -framework AppKit -o /tmp/nisi-status`.
  Live: `window: running (pid 99232)` while the bundle ran (else
  `not running`), `afm: available`, `store: healthy (12 msgs)`, residents
  `openai/gpt-oss-20b` + `google/gemma-4-26b-a4b-qat`.

## Boundaries

No shell, files out of the project scope, Jev or background work. Storage lives
under Nisi's own app-support directory only. Windows lane remains delegated to
Windows OpenCode; heterogeneous-inference design choice unchanged
(roadmap Direction, 2026-09-21).
