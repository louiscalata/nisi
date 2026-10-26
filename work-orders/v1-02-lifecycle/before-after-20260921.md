# Nisi / Jev inference — before & after (V1-02 persistence slice, 2026-09-21)

Requested by Louis ("record your before and after results for nisi and jev
inference"). All observations are from this Mac (arm64, macOS 27.0, on-device
`SystemLanguageModel` via the Nisi seam); all live turns are real inference with
bound hashes. No certification implied; this is an evidence record.

## Nisi inference (on-device, via the verified seam)

| Aspect | BEFORE (V1-01, accepted basis) | AFTER (V1-02 persistence slice) |
|---|---|---|
| Deterministic suites | `nisi-chat` 47/47, exit 0 | `nisi-chat` 47/47 + `nisi-session` 18/18, exit 0 — regression-free |
| Live on-device turns verified | 3 (single turn, multi-turn prior, one-word) | 2 + crash/delete evidence (below) |
| Multi-turn context | proven via `prior` request seeding | proven via **disk restore** in a new process (same file) |
| `contentPersisted` | always false (no persistence existed) | true only after a real store write (`SAVED_SHA256` bound) |
| Cumulative-snapshot rule | `finalContent` finding (last snapshot wins) | unchanged; re-observed every turn (chunks vs streamed UTF-16) |
| Model availability | `available` | `available` (re-checked after implementation) |
| Binaries (sha256) | `nisi-chat e9a3ceda…611b`, window `ec13bdce…a81` | `nisi-chat e9a3ceda…611b` (byte-identical clean rebuild), `nisi-session 53ad125d…3b9`, window `7e99f1b8…c56` |
| Source hashes | pinned in v1-chat-slice docs | `NisiChatLog d348bacf…`, `NisiTurnController 884bedd4…`, `NisiChatSession fc20d548…`, `NisiChatWindow e135750b…`, `NisiChatApp fd54dd20…`, `ConversationStore 8b6dc450…`, `NisiSessionCLI 2ab6945c…732` |

Selftest outputs: v1-01 `4cbbf311…91fd` (47), v1-02 `58414660…8138` (18).

### Live turns recorded this slice (all status PASS, exit 0)

1. **Create** `{"user":"Remember that my favorite color is teal.","maxTokens":160}`
   → *"Teal is a nice color."* — saved `48f19f6e5a2154db8768b8ed5fd92b7729aa3be77634be37df02ceaf2021587f`,
   replySha `90d1cabe…`.
2. **Relaunch** (new process, same file; `RESTORED_MESSAGES 2`)
   `{"user":"What is my favorite color? (one short sentence)","maxTokens":160}`
   → *"My favorite color is teal."* (context restored from disk) — saved
   `c9bfe2cb08e38ffe6975dd488206e132d9c5962f53ff16a0f05118bb9cec2409`,
   replySha `235e9eec…`.
3. **Crash test** (kill -9 mid-stream, 4s into a 1600-token request): the stored
   file stayed **byte-identical** to the last PASS save (`f1c2f872…` before AND
   after the kill); `--check` still loaded all 4 messages. No partial write, no
   sidecar mismatch — the store only ever writes after a PASS turn, atomically.
4. **Refusal + recovery**: tampered file → `REFUSED checksumMismatch` exit 66
   + clean-start offer; truncated → refused; missing sidecar → refused; missing
   file → `REFUSED missingFile`.
5. **Delete leg**: verified conversation → `DELETED state=verified`; corrupt file
   → `DELETED state=unverified`; absent file → `NOT_DELETED missingFile` exit 66.
   Ordinary file removal; **no secure-erasure claim** (roadmap rule).
   Note: the `--delete` leg was added after the turn evidence above, so the
   final `nisi-session` binary is `53ad125d…` (turn/relaunch path unchanged).

### Honesty contract, unchanged

On-device model only; no network egress (`networkEgress: false` on every turn);
no tools (`externalToolsEnabled: false`); no authority
(`acceptanceAuthorityGranted: false`); persistence now also reported truthfully
(`contentPersisted` flips true exactly when `SAVED_SHA256` was emitted).

## Jev inference (TypeSafe intake/analysis — online)

| Aspect | BEFORE | AFTER |
|---|---|---|
| Intake enabled | true (`CHAMI_TYPESAFE` + `TYPESAFE_API_KEY` files) | true (unchanged) |
| SDK | typesafe 0.7.0 importable | 0.7.0 importable |
| Env file | `~/.config/opencode/chami-intake.env` usable | usable (unchanged) |
| `network_contacted` | **false** | **false** — the slice made ZERO Jev/network calls |
| Shared router `active` | `null` (idle) | `null` (idle) — no task was routed |
| Historical basis | 3 live Jev classify/analyze/triage calls (Sep 19; roadmap reuse table) | unchanged record; no new calls added |

Conclusion: Jev inference state is identical before and after this slice — no
online contact occurred. The only inference delta is Nisi's honest new
capability: persistence exists now, and `contentPersisted` is true exactly when
a verified store write happened.

## V1-02 status from this slice

- Storage decision: **Option 1** (bounded JSONL + sha256 sidecar under
  `~/Library/Application Support/Nisi/`), decided 2026-09-21 on Louis's behalf.
- Done + verified: persistence layer, `nisi-session` (turn/check/delete),
  window persistence wiring, relaunch/crash/refusal/delete evidence.
- **First user-driven window save (2026-09-21, verified):** typed `hi` in the
  Nisi window → on-device reply `hello` → stored
  `~/Library/Application Support/Nisi/conversation-default.jsonl`
  (2 entries, schema 2, conversation `EAFA1198-4F91-4961-8BCA-1338D6D7B84D`);
  file digest `86c8dd43…6e67` matches the sidecar; `nisi-session --check`
  independently loads it. The window was rebuilt as a real `.app` bundle
  (`build/Nisi.app`, bundleID `local.nisi.chat`, binary `683492be…b91`) with a
  regular activation policy after a bare-binary launch could not take keyboard
  focus (`NisiChatApp.swift fb505698…`).
- V1-02 implementation complete; remaining is Louis's acceptance review of
  this record (the gate-review section below plus the checklist immediately
  after this status block).

### History inspect/delete UI (2026-09-21, closes the last V1-02 work item)

- Pure `ConversationListing.swift` scans the Nisi app-support directory:
  per-conversation summary (message count, utf16 total via the store load,
  `verified`/`corrupt` state, newest first); deletion stays
  `ConversationStore.delete` — ordinary file removal, **no secure-erasure
  claim** (corrupt files are reported, never silently deleted). Window History
  panel lists + deletes; `nisi-session --list [dir]` exposes the same leg to
  shells. Deleting the *open* conversation keeps the in-memory chat; the next
  PASS turn writes it anew.
- Live proof on the real directory: `nisi-session --list` →
  `conversation-default.jsonl  verified  12 msgs  utf16 1335
  EAFA1198-4F91-4961-8BCA-1338D6D7B84D`.
- Suite: +8 history-listing checks (verified/corrupt classification, counts,
  utf16 totals, manifest id/schema, newest-first ordering, exact deletion path,
  delete-reflects-in-list). `nisi-session` final binary `96cbf9195fba5489`
  (44/44 exit 0). Window rebuilt with `ConversationListing.swift`
  (unsigned `c0e9aa00b9ff7dcf`, signed bundle binary `37e3d6f00b05aa8a`),
  relaunched, frontmost (pid 85176).

## Chat-quality increment (2026-09-21, Louis: "it's not as smart")

Root causes: the seam re-flattened history into one `User:/Assistant:` prompt per
turn, used greedy decoding, conservative 640-token budgets, and formal
honesty-contract instructions. Fix + evidence:

| Aspect | BEFORE (V1-01 seam) | AFTER (quality increment) |
|---|---|---|
| AFM context | fresh `LanguageModelSession` per turn, flattened prompt string | **one native session per conversation**, seeded via `NativeTranscriptBuilder` (instructions first), only the new user text is fed each turn; restore without replaying generation |
| AFM sampling | `.greedy` | `.random(top: 50, seed: nil)` @ **temperature 0.7** (macOS 26-compatible) |
| AFM budget | 640 tokens | 1280 tokens default |
| Evidence | 10 fields | + `backend` / `transport` / `nativeSession` |
| Deterministic suites | `nisi-session` 18/18 | **44/44** (+18 quality: transcript builder ordering/tuning, loopback request + SSE parsing; +8 history-listing checks) |
| Live AFM reply (`"…strengths and limits…"`) | terse/flat (35-char scale, e.g. *"Teal is a nice color."*) | **296-char natural prose** ("I am strong at quick, private tasks—like summarizing text, extracting info…"); 61 chunks, streamed 9993 UTF-16 (cumulative snapshots), reply `3afbf8e3…` |
| Bigger local route | did not exist | `nisi-session --backend local`: resident **`google/gemma-4-26b-a4b-qat`** via loopback LM Studio (`http://127.0.0.1:1234`, OpenAI-compatible, SSE streaming) — **607-char structured reply** (Markdown bullets), 141 deltas, reply `31ce3611…` |
| Backend honesty | — | AFM: `backend: afm-ondevice` / `transport: on-device`; local: `backend: lmstudio-loopback` / `transport: loopback-http`. **Both keep `networkEgress: false`** (loopback is not egress); only already-resident models are used (no cold start, no eviction) |

Live quality turns (both PASS, exit 0, same conversation
`EAFA1198-4F91-4961-8BCA-1338D6D7B84D`, same prompt, context restored from disk):

1. **AFM (afm-ondevice):** `{"user":"Be honest: what are your actual strengths as an on-device assistant, and what are your limits? Keep it brief but specific.","maxTokens":768}`
   → *"I am strong at quick, private tasks—like summarizing text, extracting info, and organizing thoughts—without needing the cloud. My limits include handling complex logic, real-time data, and long-scale multi-step reasoning. I can't access external databases or make decisions based on user history."*
   — saved `a4184a11…d73405`, 61 chunks.
2. **Local (lmstudio-loopback):** same prompt → strengths/limits with **structured bullets** (Privacy/Speed/Offline; Reasoning/Knowledge/Context limits) — saved `4d9fac01…52a1c6`, 141 true deltas, `streamedChars == replyChars` (delta semantics, unlike AFM's cumulative snapshots).

New binaries: `nisi-chat bee0467c9e1f499d` (47/47), `nisi-session ba6e089b64af9aa3` (36/36), window bundle binary **`37e3d6f00b05aa8a`** (final, confirm-dialog rebuild; unsigned build `c0e9aa00b9ff7dcf`). New sources: `NativeTranscriptBuilder.swift`, `LocalModelBackend.swift`; modified: `NisiChatSession.swift`, `NisiSessionCLI.swift`, `NisiChatCLI.swift`, `NisiChatWindow.swift`. The rebuilt `Nisi.app` was relaunched and is frontmost (bundleID `local.nisi.chat`).

**Backend choice (roadmap decision):** the local route stays on-device and
loopback-only by design — a bigger brain, not an egress path.
## Gate review of the recorded evidence (OpenCode, 2026-09-21)

Re-verified against the actual working tree on this Mac; every check observed
live (exit 0 unless noted). Louis's acceptance remains the authoritative gate;
this is the evidence-consistency audit the V1-02 row asked for.

| # | Claim | Re-verification |
|---|---|---|
| 1 | `nisi-chat` 47/47 | `--selftest` re-run → SELF-TEST OK (47 checks), exit 0; binary `bee0467c9e1f499d` unchanged |
| 2 | `nisi-session` 44/44 | re-run → SELF-TEST OK (44 checks), exit 0; binary `96cbf9195fba5489` unchanged |
| 3 | Conversation intact | `nisi-session --list` → `conversation-default.jsonl verified 12 msgs utf16 1335 EAFA1198-4F91-4961-8BCA-1338D6D7B84D`; `--check` LOADED, schema 2 |
| 4 | Window bundle | rebuilt (unsigned `c0e9aa00b9ff7dcf`, signed `37e3d6f00b05aa8a`), pid 37200, **frontmost**, bundleID `local.nisi.chat`; History delete now asks `confirmationDialog` (explicit destructive action, matches CLI `--delete` contract) |
| 5 | Gate scans | `chami_gate_scan` PASS, zero findings, rules identity VERIFIED on `NisiChatSession.swift` and `NisiSessionCLI.swift` (replayed content-keyed caches) |
| 6 | Jev untouched | zero classify/analyze/triage calls this day from this work; router idle; `networkEgress: false` every Nisi turn |

Current source pins (sha256 prefixes, 2026-09-21):

- v1-01 seam: `NisiChatLog d348bacf…`, `NisiTurnController 884bedd4…`, `NisiChatSession fe578d41…` (quality rewrite; doc's earlier `fc20d548…` is the persistence-era hash), `NisiChatCLI 02912399…`, `NisiChatWindow f43f19cd…` (history UI + confirm dialog; earlier `e135750b…`), `NisiChatApp fb505698…`.
- v1-02: `ConversationStore 8b6dc450…` (unchanged), `ConversationListing d0b2e637…`, `NativeTranscriptBuilder 068883eb…`, `LocalModelBackend d10e2e4d…`, `NisiSessionCLI a89c4535…` (>= the doc's `2ab6945c…`).
- Binaries: `nisi-chat bee0467c9e1f499d`, `nisi-session 96cbf9195fba5489`, window bundle `37e3d6f00b05aa8a`.

Conclusion: all documented claims re-verified; three source hashes legitimately
advanced (session/window/CLI) and are re-pinned above. No contradictions found.
V1-02 implementation work is complete pending Louis's review of this record.

## V1-02 acceptance-evidence checklist (2026-09-21, mapping to the work-order template)

| Template item (v1-02 README) | Evidence in this record | State |
|---|---|---|
| Storage choice recorded in roadmap/decision log with Louis's confirm | Option 1 (bounded JSONL + sha256 sidecar, `~/Library/Application Support/Nisi/`) decided 2026-09-21 on Louis's behalf ("decide for me"); roadmap progress paragraph | done |
| Deterministic suite extended (load/refuse/cap/prune/restore checks); exit 0 | `nisi-session --selftest` 44/44, exit 0 (18 persistence + 18 quality + 8 history checks); `nisi-chat` 47/47 | done |
| Kill-then-relaunch evidence: transcript restored, no partial turn retained | kill -9 mid-stream → stored file byte-identical to last PASS save (`f1c2f872…`); relaunch answered "My favorite color is teal." with restored context | done |
| Corrupt-file evidence: refused + clean-start path shown | tampered/truncated/missing-sidecar → `REFUSED …` exit 66 + clean-start offer; `--delete` on corrupt → `state=unverified` | done |
| One live follow-up answered with restored context (hash-bound) | turn 2 (relaunch, 2 restored messages), sha-256-bound saved digest `c9bfe2cb…`; plus quality turns 296-char AFM (`3afbf8e3…`) and 607-char local (`31ce3611…`), both restored-context | done |
| Honesty flags: `contentPersisted` true ONLY when a store write happened; network/tools/authority remain false; no secure-erasure claim | `contentPersisted` flips exactly with `SAVED_SHA256`; `networkEgress: false` every turn incl. loopback (`transport: loopback-http`); `externalToolsEnabled`/`acceptanceAuthorityGranted` false; delete = ordinary removal, stated in UI dialog + CLI | done |
| History inspect/delete | Window History panel (list, counts, state, per-row Delete with confirmation) + `nisi-session --list`/`--delete`; live `--list` on real store | done |

V1-02 implementation: COMPLETE. Remaining: Louis's acceptance review of this
record (the roadmap counter advances only on his accept, mirroring V1-01).

### Re-binding pass (2026-09-21, after final build `96cbf9195fba5489`)

The checklist's crash/refusal/delete evidence originally came from the
persistence-era binary; `ConversationStore` is byte-identical since, but the
legs were re-run on the FINAL binary for exact binding:

- **Crash/kill:** baseline PASS save `f950c2ab0509e9d9` → big turn (2048 tokens)
  → kill -9 at 1.5s mid-stream → file byte-identical before/after
  (`f950c2ab0509e9d9`), no completed turn in the killed log, `--check` LOADED
  4 messages. (First attempt completed in <5s and saved — correct honest
  behavior: store writes only after PASS.)
- **Refusals (all exit 66):** tamper → `REFUSED checksumMismatch`; truncate
  (364→356 bytes) → `REFUSED checksumMismatch`; missing sidecar →
  `REFUSED missingSidecar`; missing file → `REFUSED missingFile`; all with the
  clean-start offer.
- **Deletes:** verified → `DELETED conversation=… state=verified`; corrupt →
  `DELETED state=unverified(checksumMismatch)`; absent → `NOT_DELETED
  missingFile` exit 66.

## Addendum — 2026-09-23 (adaptive depth, autocontinue, self-check, window UX)

Requested by Louis (five-option improvement mandate; approved autocontinue +
deep-think + experimental research design). Evidence record; no certification
implied (no supported run.json → UNCERTIFIED).

### SDK facts (Xcode 27.0 FoundationModels interface, verified)

- macOS 26 surface exposes **no `stopReason`/`StopReason`** anywhere and no
  analysis/experimental platform mode. `ContextOptions.ReasoningLevel`
  (light/moderate/deep/custom) and `GenerationOptions.toolCallingMode` are
  **27-only**. ⇒ Deep-think on V1 is prompt-tiered (`reasoningLevel:
  prompt-level` in evidence) and truncation detection uses an honest budget
  heuristic (`budget-80pct`: ~4 UTF-16 chars/token, leg ≥ 80% of estimated
  budget = truncated), never a fabricated platform signal.

### What changed (sources, sha256)

- `NisiChatSession.swift` `c77015076ec0c98cc23268f684a49793c90f214eb71b647fe68b9f31a7fb9420` —
  `TurnMode` (auto/fast/deep/experimental), auto-upgrade at ≥ 500 UTF-16,
  autocontinue leg loop (≤ 2 continuation legs, same native session,
  "Continue exactly where you left off."), per-leg delta resolution for
  `onSnapshot`, evidence fields `turnMode`/`reasoningLevel`/
  `continuationLegs`/`budgetExhausted`/`continuationHeuristic`.
- `NativeTranscriptBuilder.swift` `58093dd37c3de4d8579f88a3476d06c21e3f1c250396a8f2dea30abaab9dd9a1` —
  `deepThinkInstruction`, `experimentalInstruction`, `continuationPrompt`,
  `tieredPrompt`.
- `NisiChatWindow.swift` `a27ac9a3a91ce2d6089be0050579c7017e3ccea0fd8b5c113902eff3bb4cc21c` —
  delta-append streaming, backend toggle (AFM / local), red-vs-orange notices,
  `resetContext()` after deleting the open conversation.
- `NisiStatusCLI.swift` (new) `a47b2bc6889e102269c0d06db5488ec0c5ffaa1e0520b4665313dc6559b991dc` —
  one-command self-check (`--json`), parses resident models from
  `127.0.0.1:1234/api/v1/models` via `loaded_instances`.
- `LocalModelBackend.swift` `03f205c9f1650642cdfb750d28b0e692ec721af854f5558eae6864d17ef36f3b` —
  shared `NisiLocalTurn` runner (CLI + window parity); `NisiSessionCLI.swift`
  `25ebf99442b619f57f881a8ff057053d7fe76614688f606448dc505e96d1057e` now a
  thin wrapper. `AutocontinueProbe.swift` `80516f2cb47c2ab8711170b2332008ed7d9027ffcefd6893f7a5af30cdaa6304`
  is the live proof harness.

### Binaries (current pins; supersedes 2026-09-21 pins above)

- `nisi-chat` `64ba35d3911382bcfe80603c40a0995a7e7b29f055953f11c9a5d6c6ae8b5381`
  — SELF-TEST OK (47 checks), `--status` model available.
- `nisi-session` `1bdb70168aeaf8f75cbeb2b244818a92a79ee34f53c1d2e2900d4b7075290ebc`
  — SELF-TEST OK (44 checks) with `--check`.
- `Nisi.app` bundle binary `8f06f6b45904a4297d3b8b37d3cc0dcfc7120de7c6f63809109b9099cbe4400e`
  (ad-hoc `/tmp` build `56ccf6fa0f2b5a2575844efd5ad7670063b9f698e95a50add55df52a68a996c6`),
  `codesign --verify --deep --strict` OK; relaunched frontmost (pid 99232),
  then quit per owner preference.

### Live proof (AutocontinueProbe, all AFM on-device, `networkEgress: false`)

- **Short control (26 UTF-16):** `turnMode fast`, `continuationLegs 0`,
  reply 24 chars — no behavior change.
- **Long auto-tier (607 UTF-16 ≥ 500):** `turnMode experimental`,
  `reasoningLevel prompt-level`, complete 2519-char reply, budget not
  exhausted (`continuationLegs 0`) — the "prompt gets a bit longer" trigger.
- **Forced 40-token budget:** `budgetExhausted true`,
  **`continuationLegs 2`** (3 legs), reply 642–793 chars vs ~160-char
  single-leg budget — autocontinue genuinely finished the answer.
- **`nisi-status`:** window not running → `window: not running`; while the
  relaunched bundle ran → `window: running (pid 99232)`; store healthy
  (12 msgs, `EAFA1198…`, 1335 utf16); AFM available; residents
  `openai/gpt-oss-20b`, `google/gemma-4-26b-a4b-qat`; `--json` shape verified.

### Gate

`chami_gate_scan` **PASS (zero findings, rules VERIFIED)** on all six changed
sources listed above.

### Honest limits

No platform stopReason on macOS 26 (heuristic is labeled `budget-80pct`, not
"token limit"); experimental tier is prompt-level reasoning on 26
(platform-deep/tool research = macOS 27 follow-up); GUI interactions not
automation-tested; local-backend autocontinue (LM Studio `finish_reason`) not
implemented yet — AFM only. UNCERTIFIED (evidence-backed only).
