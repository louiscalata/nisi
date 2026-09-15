# Nisi — paused development handoff

**User pause: exhausted Astra usage. Overall progress: 30% (3/10 NX milestones).**
**Louis subsequently authorized Claude to take over development.** Claude may
continue this private work from the retained state. Codex must remain paused and
must not automatically restart or switch models. Existing privacy/release and
file-ownership boundaries continue to apply; this is not publication approval.
The full goal remains the private Veritas merger into Nisi plus the macOS build
using macOS 27 / Xcode 27. All seven development tracks remain in scope.

## Accepted baseline

Last accepted portable snapshot: 1598/1598,31 focused,23 relocated controls,
seven semantic faults detected; receipt
`.build/repository-incident-review-verification-HXHnMK/verification.json`.
This is historical evidence for its exact snapshot, not the following drafts.

## New work retained, not globally accepted

- Track2: native-incident-source module + host retention; 17 source,4 host and
  10 boundary checks reported passing. Root read all source/test files. Opus
  source review PASS with no findings; no final pin/mutation/full-suite receipt.
  Initial five failed oracle assumptions retained in native work order.
- Track3: prevention experiment-plan validator,9 focused checks. Root added and
  fixed an explicit 32-repetition cap after a retained failing regression.
  Source-only declaration; no trials, measured uplift, influence or promotion.
- Track4: execution-coordinator draft,12 author-run checks. Root source review
  needs resolution before acceptance: cancellation promises are not awaited,
  cancellation errors can be cleared, repeated settlement calls may replace an
  unresolved observation, and owner-array descriptor validation needs scrutiny.
- Track5: experimental-module registry draft,7 author-run checks. Root review
  pending for symbol/hidden fields, identifier coercion on inspect/disable,
  bounded registry/history growth and exact identity preservation. No loading.
- Tracks6/7: offline readiness-checker drafts,5 author-run tests. NOT accepted:
  source review found generic PASS fields/empty manifests and self-declared gate
  inventories can overstate readiness; exact shapes, gate-specific evidence,
  negative tests and fixture cleanup need work. Do not use their ready:true as
  product/release evidence. Publishing remains forbidden pending original gates.

## Native build

Environment observed: macOS27.0 arm64, Xcode27.0, Swift6.4. Package manifest has
no remote dependencies and the imported source was not edited.
`build-macos.mjs` ran the actual full app-target debug compile. Compiler exit0;
receipt FAIL because executable lookup used the product display name/path
without verifying SwiftPM's actual output name. Retain this adverse receipt:
`.build/nisi-full-native-build-bD8zYH/verification.json` and stdout/stderr.
Next after resume: inspect actual compiler output, correct the proof's artifact
lookup without erasing the failed receipt, then verify a Nisi-owned native build
overlay/branding and app bundle. Build success is not runtime or release success.

## Claude packets

Claude session metadata cwd is `/Users/louiscalata/pending-review/nisi`, but the
reviewed packet artifacts are actually under this canonical repository.
`work-orders/bundle-restart-demo` is the useful unintegrated candidate: historical
3 baseline+9 process checks, corrected realpath/link-dotdot boundary. No current
deterministic packet result or reciprocal owner review. Root read source/CLI/tests
but did NOT execute or integrate them. Existing other owner/XPC/recovery packets
are already integrated, blocked or superseded; do not blindly rerun them.

## Stopped execution and coordination

All three Codex helper agents are completed. Opus review session50284, local tier
resolution50773 and build session63641 are terminal. The Claude watch automation
`nisi-claude-parallel-work-watch` is PAUSED. Claude's independently user-owned CLI
was not interrupted, edited or assumed live. Windows window ended04:58:04UTC;
20 terminal requests, no outstanding in retained accounting,6 candidates/95 local
checks,0 independently accepted. No remote service shutdown is claimed.

OpenCode's current runner accepts local/free, not old Go/Zen names. Local resolves
to lmstudio/qwen/qwen3.8-27b; no new packet or inference ran. Prior timed-out packet
remains held. Do not silently switch to a remote tier or infer health from resolve.

No commits, pushes, publication, installation, signing, authentication or model
service changes occurred. Preserve all dirty work and the frozen import.

## Takeover log — Claude, from 2026-09-13 21:30 PDT (co-author under Louis's authorization)

**Ownership (Louis, 2026-09-14):** "allow opencode to takeover the development
as a co author. now it will be codex, claude and opencode." OpenCode is a
co-author: it may be given whole work orders (contract, tests, implementation),
not only packet `do` items, and its bounded reviews count as an independent
eye. Unchanged: one writer per checkout at a time; `packet-receipt` decides;
tests are not oracles for their own code; the tree never gets a remote.

**Lanes (Louis, 2026-09-14): "allow paid models until we use up its usage."**
The metered OpenCode Go tier is re-enabled as `go` (chami-tier + packet-run +
`packet-go` agent/command; `opencode-go` whitelist: kimi-k2.7-code, glm-5.3,
qwen3.6-plus). It is never auto-preferred and every launch passes
`--allow-paid`; there is no usage meter, so exhaustion will appear as a refused
request in a receipt, at which point work falls back to `free`. Measured today:
`free` (big-pickle) answers in ~9 s; `local` (qwen3.8-27b) alternates between
14 s and a 90 s hang and needs `lms load … --ttl` before a run because gemma
evicts it; `go` (kimi-k2.7-code) completed a contract-sized async fix in 11 min.

**Checkpoint:** `eadec33` (2026-09-14 05:09Z, 1315 files) into the remote-less
store, run from the Claude session with the injected signing config unset for
that one process (`env -u GIT_CONFIG_KEY_0 …`); the tool's no-remote and
pre-push guards were re-checked by the run. Zero dirty paths after it.

**Done since the pause:**
- Native build: the FAIL receipt was a lookup defect (Xcode 27 emits to
  `out/Products/<Config>`); `build-macos.mjs` now uses `--show-bin-path` and
  takes `debug|release`. Both configurations compile the full app target from
  the byte-identical frozen import: debug `.build/nisi-full-native-build-SW1LT0`
  (6,648,800 B), release `.build/nisi-full-native-build-release-FuiYbe`
  (4,246,728 B). `COMPILED_APP_TARGET_ONLY`; nothing launched, signed, branded.
- Track 6: independent hardening oracle (11 tests) found the two overstatement
  holes the handoff named (empty `sourceManifest` counted as PASS; empty
  required-feature list counted as complete). Fixed by the LOCAL lane in 10 min
  (3-line diff, receipt DONE); 11/11 + 3/3.
- Track 4: adversarial review (32 agents) — REJECT: D1 scope gap (admission is
  not implemented and the author's CONTRACT.md narrowed it), D2 owner callbacks
  received the mutable record as `this` and could forge OFF, D3 a rejecting
  `cancel()` escaped as an unhandled rejection and crashed the process, D4 the
  owners container was read live (Proxy/sparse). Independent containment oracle
  (10 tests) written; the GO lane implemented the fixes (receipt blocked only
  because the packet under-specified error clearing — corrected by the
  integrator in one clause; note appended to the packet). Product module
  `hosts/repository/execution-coordinator-v1.mjs` SHA256
  `0a70d4c7a515f2e1dbf3e179bb0d035feb2392def45718bf1dfd906ba1b14f8f`;
  `tests/execution-coordinator-containment.test.mjs` added; suite 1667/1667.
  D1 (admission: consent, scheduler freshness, measured capacity, ADMIT/REFUSE/
  DRAIN_UNCONFIRMED) is deliberately NOT bolted onto the drain coordinator; it
  is the next Track 4 work order with its own contract.
- Track 7: independent oracle (10 tests) written requiring per-platform
  receipt bindings; 5/10 fail on the draft (self-declared platform PASS,
  approvals-key strictness). Packet not yet run.

**Not done / next:** Track 7 packet; Track 4 admission contract; Track 1
(never started); Track 5 registry review; Track 2 pin/mutation receipt; Nisi
branding + app bundle; integrate `bundle-restart-demo` and
`journal-restart-recovery`. Progress remains 30% — 3/10.

**2026-09-14 06:55 PDT (Claude):** Track 4 admission integrated:
`hosts/repository/execution-admission-v1.mjs` (`5a9d94e141dd06d5d3492b355134a13c795d8750e4523c5277bf0da0b6ec2dd6`), oracle
`tests/execution-admission.test.mjs`; suite 1677/1677. Checkpoints `eadec33`,
`c02587b` (Louis, from Terminal). OpenCode's app session is the single OpenCode
co-author; the headless session Claude started never wrote and was stopped.

**2026-09-14 00:41 PDT (Claude):** Track 5 promoted from OpenCode's O3:
`experimental/module-registry-v1.mjs` now `567622623bb274cd…` (D1 + D2, exactly the
three hunks in `track5/src/`); oracle promoted as
`tests/experimental-module-registry-containment.test.mjs` (20; 10/20 failed on the
unmodified product). Suite 1697/1697. Track 1 (O2 step 1): OpenCode's oracle
`track1/repository-fixture-runner.test.mjs` reviewed adversarially — REJECT, 8 items
(does not parse at :109; undeclared `original`; evidence read from the wrong field;
run-to-run deepEqual vs random runIds; wrong fingerprint field; hard-coded stub
passes 8/8; cleanup asserted after the test's own rmSync; RUNNER_ARGS shape) —
appended to `track1/README.md` for OpenCode to fix; nothing else written there.
OpenCode is on O4 (`integration/` dirs appeared 00:41 PDT); not yet reviewed.

**2026-09-14 01:01 PDT (Claude):** Nisi overlay landed (Louis: "go for it"). `native/macos/Nisi/`
mirror package + `build-nisi-macos.mjs`; debug and release `Nisi` executables and
unsigned `Nisi.app` assembled, receipts under `docs/verification/2026-09-14/nisi-app-bundle/`;
`tests/nisi-native-overlay.test.mjs` (7); suite 1704/1704. Details and the open list in
`macos-build-plan.md`. The previous Claude process exited mid-turn; both review
workflows (Track 3 validator, O4 migration) were resumed from their run ids.

**2026-09-14 01:07 PDT (Claude):** Track 3 closed: review REJECT (2 contract defects), oracle 17,
packet on `free` (big-pickle, ~1 min) applied exactly the specified edit, promoted to
`evaluation/prevention-experiment-plan-v1.mjs` (`470443df…`) + product oracle. Suite 1721/1721.
Seven tracks now: 2, 3, 4, 5, 6, 7 closed with independent oracles; Track 1 is OpenCode's
(oracle in its fix loop).

**2026-09-14 01:10 PDT (Claude):** O4 integrated from the originals per the review's placement
(depth-one under `history/`), cleanup hooks + B5 probes added, `.scratch/` gitignored;
suite 1749/1749, structural PASS. `docs/verification/2026-09-14/o4-integration/`.

**2026-09-14 01:18 PDT (Claude):** Overlay review (wf_44eef069-f25) corrections applied
before its synthesis landed, all re-measured: receipt script v2 (signature flags +
entitlements recorded, hidden-entry drift in the frozen tree refused, frozen app-file
coverage, env/cwd, allow-listed subprocess surface), product test rewritten (exact branding
transform, exhaustive manifest/plist pins, subprocess audit; 9/9 review mutants caught),
narrative corrected (debug is build-system ad-hoc with get-task-allow, one residual string is
VeritasCore's, three-line diff, -package-name evidence retained). Receipts v2 debug
`a69ae903…` / release `3f650c26…`. Suite 1749/1749. Track 1: OpenCode edited its oracle at
01:08 PDT (fix loop in progress; no ORACLE READY re-append yet).

**2026-09-14 01:29 PDT (Claude):** Louis "confirm": bundle id `com.louiscalata.nisi`
confirmed; wording rebrand done as owned exact-transform copies (ShellTruthV1 coverage text,
PrivateVerifiedFileWriter refusal, MenuBarView save-panel message); identity strings
inspected and kept verbatim, pinned by the test. Rebuilt: debug `d66a8301…`, release
`490559ad…`; residual old-name literals 3/3, all identity-bearing or library-owned. Suite
1749/1749. O4 review filed at `docs/verification/2026-09-14/o4-migration-review.md`
(PROMOTE_WITH_FIXES, all applied); both work-order roadmaps ticked. Checkpoint `4e65dcf`
before this slice.

**2026-09-14 01:34 PDT (Claude):** Overlay review synthesis filed
(`evidence/claude-overlay-review-20260914.md`, ACCEPT_WITH_FIXES, all five items fixed and
dispositioned): receipt script v3 (compiled-surface manifest walk, exclusion + hidden pins,
buildInputs/docs split), test 8/8 with the same walk, 13 mutants retained, receipts debug
`727b4ad1…` / release `e6bafd03…`. Suite 1750/1750 at 08:33Z.

**Seven-track status table (Claude, 2026-09-14 08:45Z):**

| Track | Owner | State | Where |
|---|---|---|---|
| 1 live repository workflow (fixture runner) | OpenCode | oracle re-fixed and a 301-line runner drafted directly in the app session (not via a `go` packet, and before Claude's ACCEPT — deviation from the handoff order); oracle 0/10 on the draft at 08:43Z, still iterating; no ORACLE READY re-append yet | `track1/` |
| 2 native incident source | Claude | closed: strengthened oracle, mutation receipt | `docs/verification/2026-09-14/track2-native-incident-source/` |
| 3 prevention experiment plan | Claude + OpenCode free lane | closed: review REJECT → 2 fixes, oracle 17, promoted | `track3/`, `evaluation/prevention-experiment-plan-v1.mjs` |
| 4 execution coordinator + admission | Claude + OpenCode go lane | closed: containment fixes, admission module, both promoted; wiring to a real provider/owner/UI still needs separate authorization | `track4/`, `hosts/repository/execution-{coordinator,admission}-v1.mjs` |
| 5 modular registry | OpenCode (fix) + Claude (review, promote) | closed: D1/D2, oracle 20, promoted | `track5/`, `experimental/module-registry-v1.mjs` |
| 6 product readiness | Claude | closed: hardening oracle 11 | `track6/` |
| 7 release readiness | Claude + OpenCode go lane | closed: receipt bindings, honestly not ready | `track7/` |
| native build + overlay | Claude | debug/release compiled; Nisi overlay + unsigned bundle; two adversarial reviews applied | `macos-build-plan.md`, `native/macos/Nisi/` |
| U02-04 demos | OpenCode (rehearsal) + Claude (install) | integrated into the product suite | `docs/verification/2026-09-14/o4-integration/` |

Product checks at 08:45Z: suite 1750/1750, structural PASS, private package PASS_SCOPED, types OK. Checkpoints today: `d559d92`, `886150a`, `4e65dcf`, `21f7182`, `c1a1c07`.
Still needing Louis: authorization for NX-07 wiring (coordinator/admission to a real provider and the app), the live-model repository demonstration (NX-04), module loading (NX-08), and any trial run (NX-06); the app icon (visual work is stopped).

**2026-09-14 02:30 PDT (Claude):** OpenCode completed Track 1 in-session (oracle 10/10,
runner 301 lines, receipt `executed_by: opencode`, README re-submitted 02:22 PDT; it wrote the
runner before Claude's ACCEPT "per Louis's explicit direction" given in the app). Claude's second
pass (oracle + runner cross-review, wf_e5faf4e2-353) is running. In parallel, the NX-07/DX-03
interruption-contract design (wf_4a13c365-af3) is in its judging phase; the work order will be
`work-orders/interrupted-run-decision-v1/`.

**2026-09-14 03:09 PDT (Claude):** Track 1 second pass: REJECT (wf_e5faf4e2-353, 45 agents).
Five must-fixes survive two refuters each: the oracle still passes a runner that never imports the
host (an independently written stub, 10/10); `cleaned: true` is a literal and cleanup-on-failure has
no discriminating test; the containment boundary is the caller's parent, not the owned root, and the
guard misses `fsp.open`/callback `fs.*`/symlink traversal (six leak mutants pass); receipt bindings
and retained digests are unverified (stale-candidate and wrong-runId mutants pass); plus a fifth in the
full report. Appended to `track1/README.md`; handoff O2 flipped to REJECTED. OpenCode's disposition
claims ("all 9 findings repaired", "Defect 5 … assertions added") were found false by measurement.
Interruption contract: go-lane packet made NO edit in 717 s (silent exit after reading the four files;
receipt BLOCKED, retained as `.result.go-attempt-1.md`); free lane running as the sanctioned fallback;
Claude's own draft passes the oracle 18/18 in the scratchpad and will be installed as the integrator
fix if the free lane also produces nothing. One oracle fixture-aliasing bug (T8) fixed by Claude.

**2026-09-14 03:23 PDT (Claude):** interrupted-run-decision-v1: both lanes blocked (go silent
after 717 s, free nothing within the cap; receipts retained); integrator fix installed
(`src/interrupted-run-decision-v1.mjs` 275 lines, sha `89f8a08d…`), packet oracle 18/18, integration
oracle 4/4 against the real history modules (`tests/integration.test.mjs`). Adversarial review
running (wf_f1ab9875-020); promotion to `hosts/repository/` + `tests/` after it. Checkpoint still
pending on Louis's side (gate denied mine at 10:10Z).

**2026-09-14 03:39 PDT (Claude):** INCIDENT — OpenCode edited the frozen Veritas import at
10:22Z (new `VeritasAFMInternalBuilder` target + Package.swift) and built in place; verifier threw
IMPORT_INVENTORY_DRIFT, 3 suite failures. Restored by moves only: draft → `work-orders/afm-internal-builder-opencode-20260914/`,
Package.swift restored from the checkpoint store, in-place `.build` quarantined under `.build/`.
Verifier 225/225 again. Handoff carries the rule in bold. Also: "accept" → interruption contract
promoted (`hosts/repository/interrupted-run-decision-v1.mjs` `89f8a08d…`, oracles
`tests/interrupted-run-decision{,-integration}.test.mjs`); the adversarial review is still running
and its findings will be applied in place.

**2026-09-14 04:07 PDT (Claude):** interrupted-run-decision review filed (ACCEPT_WITH_DEFECTS,
oracle gaps only); six additions folded into `tests/interrupted-run-decision.test.mjs` (24), 13/14
mutants killed, 14th equivalent; README §Mutants corrected. Suite 1778/1778. Frozen import clean.

**2026-09-14 04:19 PDT (Claude):** next slice started — NX-05 "source-bound incident eligibility"
(roadmap's own Next line): design workflow wf_8c2f1875-d63 (4 readers probing incident-capture,
candidates preview, native-incident-source, roadmap text → 3 angles → 2 judges → spec); work order
`work-orders/incident-eligibility-v1/` scaffolded. Contract + oracle first, then a lane attempt with
Claude's draft in parallel, then adversarial review, then promotion.

**2026-09-14 05:17 PDT (Claude):** incident-eligibility-v1: spec synthesized (wf_8c2f1875-d63), README with
7 decisions, oracle 16 tests over REAL producers (paged incident host, memfs journal, capture, query,
plan) 0/16 on the placeholder → module authored from the design sketch + grafts → 16/16. Review next.
Checkpoint denied by the gate (no touch); pending on Louis's side.
