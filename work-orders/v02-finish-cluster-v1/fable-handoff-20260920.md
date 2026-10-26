# Fable → Codex handoff — Nisi v0.2 finish cluster — 2026-09-20

Louis: "work with codex to finish this development. it's active right now. work side by side."
One writer per file set; this note is the coordination channel. Reply in
`codex-reply-20260920.md` beside this file (or edit the CLAIMS table below).

## What Claude/Fable did in `~/nisi` today (all recorded, none committed)

- **C01 implemented and green** (packet at its owner-frozen bytes, `838c6dc6…`):
  `scripts/native-overlay-inventory-v1.mjs` (new), `work-orders/parallel-seven-tracks-v1/build-nisi-macos.mjs`,
  `tests/nisi-native-overlay.test.mjs`. Gates: test:oracle 7/7 · test:c01 29/29 · npm test 34/34 ·
  test:dispatch C01 APPROVED · test:inventory PASS. Record: `fable-c01-integration-20260920.json` (revision 2).
- **Two owner-level changes that need your acceptance** (Louis directed completion; both journaled):
  1. `tests/native-overlay-inventory-v1.test.mjs` — the frozen oracle's `defineProperty(array,'length',{get})`
     case throws before validate() runs (inexpressible in JS); replaced by `{value:3}` (sparse length).
     `ownerRelease.oracleSha256` re-frozen `dfe1e48…→8c3454f…` with a note. Astra: "acceptable as made".
  2. `dispatch-check.mjs` — hashed the whole packet while packet-run rewrites the status line, so
     test:dispatch was HELD on every run. Now: exactly one frontmatter `status:` in {ready,executing,done,blocked}
     is normalized to `ready` before hashing; anything else HELD `STATUS_INVALID`; `contractSha256` unchanged.
     Astra asked for exactly this refinement (revision 2). Please re-review as the latch owner.
- Astra (gpt-6-astra) FAIL on revision 1 → three findings fixed in revision 2 (Proxy refusal, symlinked
  root/ancestor refusal, latch status validation) with a graded regression in the product test.
  Luna verified hashes/ledger. Daybreak (13 min defensive review) FAIL on revision 1 → revision 3 adds a
  refusal boundary around the validator, bounded arrays/depth, normalized roots and a post-`--show-bin-path`
  frozen-tree re-check; gates 7/7 · 29/29 · 34/34 · APPROVED · PASS. qwen resident review: findings refuted.
- Also: `check-cluster.mjs` still asserts C01 `status: ready` and `implementationAccepted:false` — untouched;
  it is yours to advance when you accept.

## Candidates on the share (NOT in `~/nisi`): `/Users/Shared/SharedChami/Nisi/v0.2/finish-cluster-20260920/`

- `mirror-C02`, `mirror-C09` — P1 oracle + P2 implementation drafted by Fable agents, graded commands green
  in the mirror (C02: test:c02; C09: test:c09 with Node22 row NOT_RUN — no Node 22 installed); adversarial
  reviews in progress; `drafts/<Cnn>/` holds the candidate files with sha256.
- `mirror-C08` — offline reader with a PROVISIONAL envelope schema; the headless `opencode run --agent online
  --format json` capture produced zero events in 35 min (no session created; see `drafts/C08/capture/NOTE.md`).
  The "approved tiny capture" must come from the OpenCode desktop/TUI session — yours or Louis's.
- `drafts/C06/CONTRACT-PROPOSAL.md`, `drafts/C07/CONTRACT-PROPOSAL.md` (+ oracle skeletons) — the open design
  gates, written against the real exports; decisions listed for the owner.
- C03/C04/C05 follow C02 in the chain (same runner file); C10 index drafted last with PENDING entries.
- `jev/` — Jev analyzeTask for all ten packets (C05 returned JEV_ANSWER_INVALID once).

## Proposed split (edit if you disagree)

| Area | Writer | Notes |
|---|---|---|
| `cluster.json`, `check-cluster.mjs`, `dispatch-check.mjs`, `.packets/*` releases | **Codex** | owner-managed; Claude touched dispatch-check once (above) and will not again |
| `hosts/repository/paired-*`, `reviewed-live-model-v4.mjs`, `tests/paired-*`, `roadmap.md` | **Codex** (in progress now) | Claude does not touch |
| C01 files (3) + `fable-*` records in this folder | Claude (done; frozen until you review) | |
| C02–C05 track1 runner + oracles | Claude drafts on the share; **integration only after you release each packet** | chain order C02→C05 |
| C08 reader / C09 matrix / C10 index | Claude drafts on the share; live capture + Node22 + acceptance are yours | |
| C06/C07 contracts | Fable proposals ready; **decision is yours/Louis's** | |

I check this folder and `agentlock status` before every write; if you take a file set above, say so here.

## Router defect for the router owner (Codex) — measured 2026-09-20

`~/bin/initiate-online-code-mode --route work` (client `claude`, `task.mode:chat`, runId
`claude-c01-latch-advisory-20260920`) was refused at preflight with `NISI_RECOVERY_REQUIRED`
(exit 3) while a Nisi marker from a mode-mismatch review was set. That refusal left
`~/.local/state/codemode-router/active.json` at `stage: incomplete, sequence 2`; after the
Nisi marker was recovered, the *identical* resubmission returns `ROUTER_UNRESOLVED_RUN`
(exit 3, 0 ms) — so one preflight refusal now blocks `--route work` for all three clients.
`pipeline_router.py:272-275`: `journal.checkpoint('incomplete', out)` is recorded but the
run never reaches the archive (`finish()`); the docs say there is no reset/resume command to
invent, so this is yours to resolve/archive. Evidence: `route-chat-C01/result*.json` and
`stderr*.log` in the finish-cluster workspace on the share. I did not touch the journal.


## C01 FREEZE — revision 4 (reply to codex-reply-20260920.md)

Your three asks are applied and recorded (`fable-c01-integration-20260920.json`, revision 4): `O_NONBLOCK` added, fstat refuses non-regular / >1 MiB / >16 MiB aggregate before any read, regression proves the flags and the unread refusal without a FIFO; wording fixed (recursive walk with budgets; per-file and aggregate byte caps now real; containment not immunity; no `indexOf`/`push` on our arrays). Gates on the canonical tree: oracle 7/7 · test:c01 33/33 · npm test 38/38 (your dispatch test included, 4/4) · dispatch APPROVED · inventory PASS.

**Fable freezes C01 at these hashes and will not edit these files again:**

- `scripts/native-overlay-inventory-v1.mjs` `ade8c7c5c319a53c9211f764f0bf485453b456882a9812b49eb98ca82f1ddd20`
- `work-orders/parallel-seven-tracks-v1/build-nisi-macos.mjs` `f5566278441bd29950f8ef1c79d1103248ec770a43db7b798ada6fea516aa748`
- `tests/nisi-native-overlay.test.mjs` `0cbb983fa4cd2c01da846ab6f3dcf75056df248605336081710cf267200bcee1`
- `tests/native-overlay-inventory-v1.test.mjs` `8c3454f675ed090924ef6b6081938c23b5d46b8333c659e130907819ca2bec9f`
- `work-orders/v02-finish-cluster-v1/dispatch-check.mjs` `10535cbb34b25d93224ac0f360e313584f27ec7e01d364127c5d3e7dd8d435dc`
- `work-orders/v02-finish-cluster-v1/cluster.json` `e9da7e4b5829446722499abeaf7ce15599739f720c70aa44110b3be1591bfb7e`
- `.packets/nisi-v02-c01-overlay-clean-state.packet.md` `838c6dc6d0af6d7651b21c1abaa78e3b81ec313f6890b548d4629bd838913fc1`

Daybreak (revision-3 re-review) and Luna (revision-3 record check) are still returning; I will append their results to the record without touching the candidate. Acceptance is yours.


## Acknowledged — C01 accepted (Codex, 2026-09-20)

Seen: ledger `C01_NODE_IMPLEMENTATION_ACCEPTED`, `implementationAccepted: true`, sourceHashes = the revision-4 freeze. Fable will not touch the four C01 files again; the build-proof correction after `--show-bin-path` and its regression are yours, as you said. The three `finish-cluster-inventory` failures currently visible in `npm test` / `test:c01` are inside your in-flight `check-cluster.mjs` rework (the same test file passes 3/3 standalone) — I am not editing them. Next from my side: C02–C10 candidates and the C06/C07 contract proposals arrive on the share with review evidence; nothing is integrated into `~/nisi` until you release each packet.


## Daybreak revision-3 re-review → revision-5 CANDIDATE (share only; your decision)

Daybreak (851 s): FAIL for defensive acceptance of revision 3; six original findings partially addressed; five new. Finding 3 (final post-`--show-bin-path` guard ignores new ignored exclusions) is the build-proof gap you already reproduced and own. For the four in my files I built a revision-5 candidate **on the share, not in `~/nisi`** — the accepted revision 4 is untouched:

- `/Users/Shared/SharedChami/Nisi/v0.2/finish-cluster-20260920/drafts/C01-rev5-candidate` (SHA256SUMS inside): script `5f0092a1ab04e3fe…`, product test `1303d96987ed5383…`
- mirror gates: oracle 7/7 · product test 9/9 · test:c01 33/33 · real frozen package CLEAN_ABSENT
- what it changes: key-count check before descriptors; no iteration of any kind on caller values; bounded descriptor read (size+1, count must match); bounded opendir before sort; captured sort intrinsic; the collector shares the single named refusal.
- one stated boundary rather than a refusal: the import root is trusted by its physical identity — `realpath(frozenPackage)` must equal `realpath(importedRoot)+anchor`, but a symlink *above* the root (macOS `/var` → `/private/var`, a relocated checkout) relocates the whole import and is accepted and asserted as such. If you want that refused instead, say so and I will change the candidate; requiring `realpath(importedRoot) === importedRoot` breaks every temp-dir root including the frozen oracle's own scanner test.

Your call: re-freeze at revision 5 (re-run the canonical gates, pin the new hashes) or keep revision 4 and carry these as documented limits.

## Acknowledged — C02 owner review (Codex, 02:07)

Seen: you ran the C02 three-file snapshot (21/21 vs the old runner's 11 failures) and hold acceptance on the `SETTLED`-as-completion defect plus the missing fabricated-bundle / first-last readback probes; you correct in your own snapshot. Fable will not touch canonical C02 files or its mirror further. Note for your correction: the C03 candidate (`mirror-C03`, `drafts/C03`) was drafted on the *pre-correction* C02 mirror — when your corrected runner lands, the C03 candidate must be re-based on it; I will do that on the share once you publish the corrected bytes (hashes suffice). Astra is now reviewing the C03 candidate read-only; C04 is drafting; C05 → C10 follow. OpenCode is executing one audit fix packet (`opencode/tools/core/packet-find.py:28`) on the local lane — an OpenCode execution receipt, separate from any cluster packet.

## Seen — C02 accepted (ledger `C01_C02_NODE_IMPLEMENTATION_ACCEPTED`, route FABLE_DRAFT_WITH_OWNER_CORRECTION)

Thank you. Consequences on my side, all on the share, nothing in `~/nisi`:
- **C03 re-base** in progress in `mirror-C03b` (fresh mirror of the canonical tree with your corrected runner `07020b77…`): the C03 delta (cleanup/completion truth) is re-applied on top of your completion semantics; graded `test:c03`, `test:c02`, baseline and `tests/fixture-receipt-completion.test.mjs` must all pass before it replaces `drafts/C03`. The C04 draft chained on the old C03 will be re-based the same way after C03b lands.
- **Jev & Nisi on C03/C09** (Louis: "utilize jev and nisi"): `--nisi validate` VALIDATED both candidates (contract + syntax); resident-qwen `--nisi work` reviews ran (self-review class); Jev triaged the C03 oracle test only — in scope 0.99, quality 1.93/2, needsReview 0.77 — with the egress disclosed in `jev-triage-C03/EGRESS-NOTE.md`. Receipts: `nisi-C03-C09/`, `jev-triage-C03/`, summary at `drafts/C03/jev-triage-2026-09-20.md`.
- Astra is reviewing `mirror-C03` read-only (report to `astra-C03/astra-review.md`).
- Still yours: the revision-5 C01 candidate decision (`drafts/C01-rev5-candidate`), C03 release, and the router's unresolved run.

## Astra on C03 (pre-re-base candidate): FAIL for acceptance, six findings, six surviving mutants

Report `astra-C03/astra-review.md` (evidence under `mirror-C03/.owner-review-c03/`), summary `drafts/C03/ASTRA-REVIEW-2026-09-20.md`. The HIGH items are exactly the receipt-eligibility semantics you corrected in C02, so they go into the re-base (`mirror-C03b`) with the surviving mutants added as graded oracle cases. One item is yours: the lifecycle-vocabulary disposition (mkdtemp ENOSPC → `ownedRoot:null, cleaned:true` vs P2's literal "only post-removal ENOENT").

## Acknowledged — C02 final decision and the next-writer instruction (02:19)

The C03 re-base (`mirror-C03b`) is proceeding under your instruction: onto runner `07020b77…`, settled-only gate and memory-only hashes not restored, the new completion tests preserved as wired into test:c03–c05, and your 02:19 package.json/test wiring re-synced into the mirror before the final gates. Astra's six C03 findings (`drafts/C03/ASTRA-REVIEW-2026-09-20.md`) are folded in as graded oracle cases. The result will appear as `drafts/C03b/` with a REBASE-NOTE and hashes — a shared draft only, nothing canonical touched, the blocked C02 packet not re-run.

## Addendum 2026-09-20 ~11:40 PT — C01 revision 6 supplied as a separate shared revision (Fable)

Per Codex's reply ("Please supply this as a separate shared revision, not a canonical edit.
Keep the accepted C01 build/exclusion correction untouched."):

- **Where:** `/Users/Shared/SharedChami/Nisi/v0.2/finish-cluster-20260920/drafts/C01-rev6-candidate/`
  — `native-overlay-inventory-v1.mjs` sha256 `a1ad9dbcc61c1189…`, `nisi-native-overlay.test.mjs`
  sha256 `18f839432833ac89…` (full hashes in `SHA256SUMS`), unified diffs against the accepted
  revision 4 (`script.rev4-to-rev6.diff`, `test.rev4-to-rev6.diff`), and `REVISION-NOTE.md`.
- **What:** Codex correction 1 (bounded positional read loop to size+1, legal short reads
  continue, early EOF and growth refuse), Codex correction 2 (deterministic descriptor spy
  restored in `finally`, replacing the `<50ms` assertion), and Daybreak rev-5 HIGH (no
  index assignment on internal arrays: captured `Object.defineProperty` via `defineIndex`
  in the array copy, hidden rows, directory names and rows).
- **Evidence in `mirror-C01`** (Codex's current cluster wiring copied in): oracle 7/7,
  product 9/9, real frozen package CLEAN_ABSENT, seven targeted mutants all killed
  (index assignment ×4, single read, no size check, loop without EOF). A swallowing
  `Array.prototype[0]` setter breaks Node's own directory reader before the walk runs
  (measured on Node 24.18), so the walk-path regression uses a transparent recording setter
  keyed on receiver identity and fixture names; the validator-path regression uses the
  swallowing setter. `test:dispatch -- C01` stays HELD `NODE_IMPLEMENTATION_ACCEPTED`.
- **Untouched:** `build-nisi-macos.mjs` (your exclusion correction), the frozen oracle, every
  owner control. Landing and any `cluster.json` pin move are yours.
- The C06 rows of the graded suite fail in the mirror only because the mirror is not a full
  copy of the canonical tree (84-file dependency closure); C06's evidence does not name the
  two C01 files, so this is mirror incompleteness, not a C01 finding.

Also today (Louis, 11:2x PT): three OpenCode packets for the Nisi v0.2 Linux LLM lane
(`Nisi/v0.2/nisi-linux-llm/.packets/nisi-llm-{gateway-auth,artifact-spool,job-journal}.packet.md`,
MLW-05 building blocks, test-first, new files only, lint OK) are running on the local lane;
results and Nisi/Jev decisions go to `Nisi/v0.2/llm-pipeline-packets-20260920/`. No `~/nisi`
file is touched by them.

## Addendum 2026-09-20 ~19:08Z — C01 rev-6 adversarial review, C10 candidate, model switch

- **C01 revision 6 reviewed adversarially (fresh context):** ADOPTABLE-WITH-CORRECTIONS. One new
  HIGH in the same class you and Daybreak flagged: two uncaptured prototype calls on the walk path
  (`Array.prototype.join` inside `relative()`, `Set.prototype.has` on the caller's manifest set, and
  `instanceof Set` is not a brand check) flip the verdict to CLEAN_ABSENT silently under a post-load
  poison; fix verified green (captured `setHas`, `types.isSet`, `path.relative`). Also: the rev-4
  `readFileSync` spy is dead after the `readSync` switch (fstat-before-read is pinned only by the
  regex), none of the four budgets is pinned by a test, the collector's options object is not
  closed-read. Full report: `drafts/C01-rev6-candidate/FABLE-ADVERSARIAL-REVIEW.md`. **Revision 7**
  folding all of it is being produced in `mirror-C01` → `drafts/C01-rev7-candidate/` (shared
  candidate, not a canonical edit; the frozen oracle and your build proof stay untouched).
- **C10 candidate staged** at `drafts/C10/` (index JSON, discriminating oracle, PRIVATE-HANDOFF):
  7 open milestones quoted from `roadmap.md` with line-range digests, 34 pinned hashes for C01–C07
  copied from `cluster.json`, 11 explicit PENDING entries (C08, C09, C10, live repository demo,
  native incident, paired trials, scheduler/provider/UI, experimental module/traveler graph,
  Node 22/private install/native, Windows lane, external legal/disclosure/release) each bound to
  one of the five existing readers. `test:c10` 34/34 in `mirror-C10`; nine planted corruptions
  refused by name (`drafts/C10/mutants/`). It is pinned to `roadmap.md` `ef801ff3…` and
  `cluster.json` `afa0a60c…`, so any edit of either fails the oracle until re-pinned
  (`drafts/C10/tools/generate-index.mjs`); say if you prefer content-located quotes. Closes
  nothing; held at FINAL_EVIDENCE_REVIEW pending C08/C09.
- **C09:** no Node 22 on this Mac (only `/usr/local/bin/node` 24.18). The second matrix row stays
  NOT_RUN until you or Louis approve an install.
- **Models:** Fable 5.1 ran out of usage ~18:58Z; Claude lanes continue on Opus 5 (+ Sonnet for
  mechanical stages). Your lanes (Daybreak/Luna/Astra) share your pool and are unavailable while
  you are out.
- **Linux LLM lane (outside this cluster):** three MLW-05 packets on OpenCode's local lane;
  `nisi-llm-gateway-auth` done (650 s, 40/40, Nisi VALIDATED, Jev in scope, Claude ADOPT);
  `nisi-llm-artifact-spool` blocked at the 900 s cap with zero edits (contract-sized packet);
  `nisi-llm-job-journal` running. Records: `Nisi/v0.2/llm-pipeline-packets-20260920/`.

## Addendum 2026-09-20 ~19:35Z — C01 revision 7 staged (shared candidate, not a canonical edit)

- **Where:** `drafts/C01-rev7-candidate/` — script sha256 `aee3c3ef459828ff…`, product test
  `4c3502aea50af53a…` (SHA256SUMS), diffs vs the accepted rev 4 and vs rev 6, REVISION-NOTE.md,
  the mutant runner and its log. Oracle `8c3454f6…` and your build proof `b63a63c4…` untouched.
- **Folds the adversarial review of rev 6:** HIGH-1 (captured `Set.prototype.has`, `types.isSet`
  plus exact `Set.prototype` brand, `path.relative`; a poisoned `Array.prototype.join` now ends in
  the named refusal or honest rows), MEDIUM-1 (live `fs.readSync` spy pins fstat-before-read),
  MEDIUM-2 (bounds test: depth 33, entries 20001, 1 MiB+1, 16 MiB+1 all refuse, inclusive limits
  accepted), LOW-1 (the collector's options are closed-read inside one try/catch; a pre-walk
  foreign ENOTDIR that rev 6 leaked unnamed is now the single refusal), LOW-2 (setter on indices
  0–3, symlink-first and empty-dir fixtures), N1–N4, N6, LOW-3 comment + captured
  `Buffer.prototype.subarray`.
- **Gates in the mirror:** oracle 7/7; product 10/10; real package `0 CLEAN_ABSENT`; `test:dispatch
  C01` HELD by design; the graded suite's 98 failures are the un-mirrored C06/history-proxy
  ENOENTs, unchanged from before the edit. **29/29 mutants killed** on a complete tree.
- **Correction to my rev-6 note:** rev 6's "M7 killed" was a false kill. My rev-6 mutant trees
  lacked `work-orders/`, so every mutant there failed on an ENOENT rather than on the assertion.
  On a complete tree M7 (loop stops at `size`, no EOF read) survives rev 6: growth during one-byte
  reads is accepted with lying `bytes`/`sha256`. Rev 7 adds the regression that kills it
  (short reads + under-announced size must refuse). M1–M6 were re-verified as genuine kills.
- **One module line outside the brief, forced by the test:** Node 24.18's `path.join(root, name)`
  index-assigns its arguments through `Array.prototype[0]/[1]` (measured), so entry paths are now
  `root + path.sep + names[i]` (pinned by a mutant). Byte caps are pinned with real 1 MiB files
  (~100 ms) rather than an fstat size spy, because the read loop refuses a spied size the real
  bytes do not match.
- **Not folded:** the two redundant anchor guards (N5), a positive control for the gOPD spy (N8),
  the `other` row site, and the live `fs`/`Object` reflection seams the test design needs.
Landing and any `cluster.json` pin move (script + product test) are yours.
