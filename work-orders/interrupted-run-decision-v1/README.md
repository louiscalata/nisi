# interrupted-run-decision-v1 — work order (Claude, co-author, 2026-09-14)

STATUS: PROMOTED 2026-09-14 (Louis: "accept") — `hosts/repository/interrupted-run-decision-v1.mjs`; review ACCEPT_WITH_DEFECTS (oracle gaps only), all six oracle additions folded in (24 tests), 13/14 review mutants killed, the 14th proven equivalent.

Implementation provenance: the packet `.packets/nisi-interrupted-run-decision-v1.packet.md` was
run twice and both receipts are retained as BLOCKED — `go` (kimi-k2.7-code) read the four files
and exited after 717 s with no edit and no output (`.result.go-attempt-1.md`), `free`
(big-pickle) produced no edit within the 900 s cap (`.result.free-attempt-2.md`). Per the
integrator-fix rule Claude wrote `src/interrupted-run-decision-v1.mjs` itself AFTER the oracle
was written and frozen (the oracle is therefore still independent of the code). One oracle
fixture bug (T8 shared a mutable row across journals) was fixed by Claude before the fix.


Roadmap authority: NX-07 ("Specify interrupted-run behavior explicitly: refuse
stale state and distinguish safe restart from validated resume. A stored report
is not a checkpoint API.") and DX-03 (define safe restart first; if resume is
implemented, version its checkpoint, revalidate source/profile/consent and
prevent duplicate side effects; do not silently restore stale PASS records).
Pure contract work in the same discipline as `hosts/repository/execution-admission-v1.mjs`;
needs no new authority. Wiring it to a real host, journal handle or UI is a
separate, separately authorized slice.

Design provenance: `evidence/design-synthesis-wf_4a13c365.md` (4 understanding
lenses that probed the real journal/bundle/owner/admission modules with node,
3 design angles, 2 judges, synthesis). The contract below is that synthesis with
Claude's decisions applied:

- **Interrupted work blocks SAFE_RESTART until reconciled.** A RUNNING row whose
  liveness is UNKNOWN (crashed run; the journal has no in-place transitions)
  must be settled by a later terminal sibling (same runId/attempt/candidateId)
  or be revoked/expired before a restart is called safe. "Safe restart first"
  means the persisted state is fully explained; the caller reconciles by
  appending, never by this function.
- **Expired rows are settled** by the journal's own TTL semantics; QUEUED rows
  never block.
- **No silent downgrade.** A refused checkpoint never yields SAFE_RESTART; the
  caller must ask again with `checkpoint: null`.
- **Zero imports, no clock, never throws** (admission parity); the module
  computes no digest — `journalSha256` echoes the store's pin of the bytes.
- Tests T2 and T20 (real `history/` modules, spawned children) are Claude's
  integration tests, written at promotion time; the packet oracle
  `tests/interrupted-run-decision.test.mjs` covers everything else.

Files: `src/interrupted-run-decision-v1.mjs` (placeholder until the packet
lands), `tests/interrupted-run-decision.test.mjs` (oracle, written first),
`tests/baseline.test.mjs`, `.packets/`. Product target after promotion:
`hosts/repository/interrupted-run-decision-v1.mjs` + `tests/interrupted-run-decision.test.mjs`.

---

# interrupted-run-decision-v1 — `decideInterruptedRunV1(input)`

Target: `hosts/repository/interrupted-run-decision-v1.mjs` (does not exist yet; grep for `SAFE_RESTART|REFUSE_STALE|RESUME_ELIGIBLE|decideInterruptedRunV1` is empty). Sole export `decideInterruptedRunV1`. Zero imports, no clock, no fs, no journal handle, never throws — the oracle reuses `tests/execution-admission.test.mjs:105-106` verbatim (`/\bimport\b/` and the process/Date/timers/random regex; the bare word `process` is forbidden even in comments). Result schema `nisi-interrupted-run-decision/v1` (NEW). Base: the minimal-surface proposal prototyped in `scratchpad/irc/proto`, with the grafts both judges required (history before consent, `RUN_UNRECONCILED`, `COMMIT_UNCERTAIN`, fresh-run-id refusal, stage-level PASS validation, version-first checkpoint parsing, row invariants, payload invariance, real-reopen test).

## Purpose

A pure, deterministic decision over persisted run-journal state as the existing modules expose it after a fresh reopen, answering NX-07 (`roadmap.md:4099-4100`): "Specify interrupted-run behavior explicitly: refuse stale state and distinguish safe restart from validated resume. A stored report is not a checkpoint API." It returns only `SAFE_RESTART | REFUSE_STALE | RESUME_ELIGIBLE` with reasons, per DX-03 (`roadmap.md:5108-5111`): "define safe restart first. If resume is implemented, version its checkpoint, revalidate source/profile/consent and prevent duplicate side effects. Do not silently restore stale PASS records."

## Non-claims

- Never authorizes, performs, restarts, resumes, appends, revokes, prunes, lists or serializes anything: `authorizing:false`, `executionGranted:false`, `resumeGranted:false` on every result. `decideExecutionAdmission` and the journal's own `append` (SEALED/PROJECT/RETRY/REVOCATION) still gate any real action (`roadmap.md:4922`, `:3028`).
- Not power-loss/reboot durability, cross-process locking, hostile-directory or concurrent-writer safety (`work-orders/journal-restart-recovery/roadmap.md:41-46`, `work-orders/bundle-restart-demo/roadmap.md:17-18`, `roadmap.md:4948-4950`, `:5183-5184`).
- Not drain confirmation and never `DRAIN_UNCONFIRMED` (either sense): a journal cannot say whether a child of a crashed run still executes; that needs `host.pendingTransports`/`settled()`, which the journal does not persist (`roadmap.md:4258-4259`).
- Not exactly-once, auto-resume or cross-restart idempotency (`roadmap.md:4940`, `:4261`, `:4672-4673`); `RESUME_ELIGIBLE` says duplicate side effects were not detected in the persisted record, not that none can occur.
- Not a checkpoint writer, store or format API; nothing in the journal (payload included) is read as a checkpoint. No entry state `INTERRUPTED`/`SETTLED`/`PASS` is added; "stale PASS" means a `SUCCEEDED` row, which this decision never surfaces or reuses.
- Does not recompute heartbeat liveness (`heartbeatTtlMs` is not exposed by the api) and does not verify source pins, profile or consent against the workspace, receipts or a permit — only exact equality between checkpoint and expected, and consent validity against `now`.
- Does not read `journal.jsonl`, the header line or the store; a self-consistent fabricated snapshot is undetectable (inconsistent ones are `INVALID_INPUT`). Does not resolve the four open host-bundle findings (`roadmap.md:785-789`); it only refuses every sealed state and never echoes rows before identity is bound.
- Not U02-04 / NX-05 / NX-07 / DX-03 closure; Astra's reciprocal owner review is still open. Nothing under `~/nisi-next-private` was written by this workflow.

## Input

Exact closed records everywhere (plain or null prototype; `Reflect.ownKeys` length equals the key list; string keys only; every key an own enumerable data descriptor — `execution-admission-v1.mjs` `isPlainDataObject`; lists per `evaluation/prevention-experiment-plan-v1.mjs:27` `list()`). Key SET is exact, key ORDER never matters (reopened entries are canonical-sorted). Any violation → `REFUSE_STALE/INVALID_INPUT`. `ID` = `/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/` (`history/run-journal-v1.mjs:6`); `HEX64` = `/^[a-f0-9]{64}$/`; `NAT` = safe integer ≥ 0, not `-0`; `CODE` = `/^[A-Z][A-Z0-9_]{0,63}$/`.

| key | type / rule | produced by |
|---|---|---|
| `now` | NAT; the only clock | caller (admission idiom, `execution-admission-v1.mjs:54`) |
| `expected` (NEW wrapper) | record of the six keys below | caller |
| `expected.projectId` | ID | journal config (`run-journal-v1.mjs:63`) |
| `expected.runId`, `expected.attempt` (NEW placement) | ID; NAT — identity of the NEXT run the caller intends to issue | entry vocabulary `run-journal-v1.mjs:4` |
| `expected.sourcePins` (NEW) | list 1..16 of `{id: ID, sha256: HEX64}`; ids unique; compared elementwise in list order | workspace fingerprints `task-workspace-v1.mjs:176-177`, `sourceSha256` `receipts/repository-execution-v1.mjs:52` |
| `expected.profile` | `{id: ID, version: safe int 1..1_000_000, rulesetSha256: HEX64}` | `receipts/repository-execution-v1.mjs:52` |
| `expected.consent` | `null` \| `undefined` \| `{grantedAtMs, expiresAtMs, revoked, scope}` verbatim; `grantedAtMs > now` → INVALID_INPUT | `execution-admission-v1.mjs:78-87` |
| `journal` (NEW wrapper) | record of the six keys below — DATA only, no api object | integrator projection of `reopen()` + `list(now)` |
| `journal.projectId` | ID \| null; null iff `recovery.reason === 'HEADER'` | header `config.projectId` (`run-journal-v1.mjs:131`, raw line 1; bundle/owner config after their PROJECT_MISMATCH gate `host-journal-bundle.mjs:79`, `journal-owner-v2.mjs:249`) |
| `journal.observedAtMs` (NEW name) | safe int, MUST `=== now` (INVALID_INPUT otherwise): the `now` passed to `list()`; liveness was derived at that instant | caller |
| `journal.recovery` | `{status: 'NEW'\|'COMPLETE'\|'INCOMPLETE'\|'INVALID'\|'COMMIT_UNCERTAIN', recoveredIds: ID[] (unique, ≤ 65_536; tombstoned ids are never forgotten, so rows can exceed maxEntries), rejectedLine: null \| NAT ≥ 1, reason: null \| CODE, authorizing: false}` | `reopen(serialized).report` (`run-journal-v1.mjs:175`); bundle adds `NEW` (`host-journal-bundle.mjs:101`); owner adds `COMMIT_UNCERTAIN` (`journal-owner-v2.d.mts:76`) |
| `journal.sha256`, `journal.bytes` | `null \| HEX64`; `null \| NAT` | `readSerializedJournal` (`run-journal-store-v1.mjs:73`), `bundle.sha256/bytes` (`host-journal-bundle.mjs:99-110`), owner `snapshot.sha256/bytes` |
| `journal.entries` | list ≤ 65_536 of `list(now)` views verbatim: `{entry, historical: true, retained, revoked, expired, liveness, authorizing: false}`; `entry` = the 14 `ENTRY_KEYS` (`run-journal-v1.mjs:4`) with `payload` OPAQUE (own enumerable data property required; never read) | `run-journal-v1.mjs:109`; `bundle.entries`; owner `snapshot.entries` |
| `checkpoint` | `null` \| record whose own enumerable string `schemaVersion` is read FIRST; if it is not `'nisi-interrupted-run-checkpoint/v1'` no other key is validated (→ `CHECKPOINT_SCHEMA`); v1 exact keys below | caller (NEW; no writer exists in the tree) |

Checkpoint v1 (NEW) exact keys: `schemaVersion`, `projectId: ID`, `sourcePins` (same rule as expected), `profile` (same shape), `consentGrantedAtMs: safe int`, `entryId: ID` (the interrupted entry it resumes; name from `recordFixedRun` result `host-journal-bundle.mjs:118`), `takenAtMs: NAT ≤ now`, `completedStages`: list 0..64 of `{stage: ID, entryId: ID, receiptId: ID}` with unique stages and unique entryIds. It is a declaration: no resume data, no payload, no PASS content.

Coherence (INVALID_INPUT): `NEW|COMPLETE` ⇒ `rejectedLine null, reason null`; `INCOMPLETE|INVALID` ⇒ `rejectedLine ≥ 1, reason CODE`; `COMMIT_UNCERTAIN` ⇒ `rejectedLine null, entries [], recoveredIds []`; `NEW` ⇒ `entries [], recoveredIds [], sha256 null, bytes 0`; `COMPLETE` ⇒ `sha256 HEX64, bytes ≥ 1`; `INCOMPLETE|INVALID|COMMIT_UNCERTAIN` ⇒ `sha256 null` (bytes null or NAT: the bundle prints a count, the owner null). `entries.map(r => r.entry.id)` equals `recoveredIds` element-wise in order. Per row: `entry.projectId === journal.projectId`; `createdAt ≤ observedAtMs`; `ttlMs ≥ 1`; `heartbeatAt null | ≤ createdAt`; `revokes !== null ⇔ state === 'REVOKED'` and names an id in entries; `revoked === (some row.entry.revokes === id)`; `expired === (observedAtMs ≥ createdAt + ttlMs)`; `retained === false ⇒ payload === null`; liveness: `revoked ⇒ 'REVOKED'`; terminal state ⇒ that word; `expired ⇒ 'EXPIRED'`; `state RUNNING ⇒ 'RUNNING' | 'UNKNOWN'` (not recomputed); `state QUEUED ⇒ 'QUEUED'`. Caller obligations the function cannot check: recovery/entries come from ONE reopen listed at `now`, nothing appended in between; a store `NOT_FOUND` is presented as `recovery.status 'NEW'` with `journal.projectId = expected.projectId` (bundle/owner convention).

## Output

`Object.freeze({ schemaVersion: 'nisi-interrupted-run-decision/v1', status, reason, checks, interrupted, journalSha256, authorizing: false, executionGranted: false, resumeGranted: false })` — own-key order fixed exactly as written; fresh object per call; input never mutated.

- `status`: `'SAFE_RESTART' | 'REFUSE_STALE' | 'RESUME_ELIGIBLE'` (closed; INVALID_INPUT is `REFUSE_STALE`).
- `reason`: `null ⇔ status !== 'REFUSE_STALE'`; otherwise the first failing check's code.
- `checks`: `Object.freeze({journal, project, entries, consent, checkpoint, identity, stages})` (NEW cell names, fixed order); each cell `'NOT_EVALUATED' | 'OK' | <code> | <echoed upstream word>`: `journal` → `recovery.reason` word (`TRUNCATED|MISSING_FOOTER|HEADER|RECORD|FOOTER|TRAILING_DATA|UTF8`) or `'COMMIT_UNCERTAIN'`; `entries` → the offending liveness word (`'RUNNING'` / `'UNKNOWN'`); `checkpoint` → `'NONE'` (no checkpoint) or a code or `'NOT_FOUND'` / the cited row's liveness word / the last row's liveness word; `stages` → `'NOT_EVALUATED'` on the restart path.
- `interrupted`: `null` until the entries step ran (no rows are echoed on sealed or foreign journals), else frozen list of frozen `{id, runId, attempt, stage, liveness: 'UNKNOWN', heartbeatAt, createdAt}` — the bundle/owner filter and item shape verbatim (`host-journal-bundle.mjs:87-90`, `journal-owner-v2.mjs:137-146`): `entry.state === 'RUNNING' && liveness === 'UNKNOWN' && !revoked && !expired`, file order. Structurally no output field can carry a `SUCCEEDED`/`FAILED`/`CANCELLED` row or any payload.
- `journalSha256` (NEW echo): `journal.sha256` (non-null only for `COMPLETE`).

## Check order (first failure is the reason; later cells stay `NOT_EVALUATED`)

| step | condition | decision | reason |
|---|---|---|---|
| 0 | any shape/type/coherence violation, `observedAtMs !== now`, `consent.grantedAtMs > now`, `checkpoint.takenAtMs > now` | REFUSE_STALE, all cells NOT_EVALUATED, `interrupted null` | `INVALID_INPUT` |
| 1 journal | `recovery.status ∈ {INCOMPLETE, INVALID, COMMIT_UNCERTAIN}` (cell = reason word / `COMMIT_UNCERTAIN`); `NEW|COMPLETE` → OK | REFUSE_STALE | `JOURNAL_SEALED` |
| 2 project | `journal.projectId !== expected.projectId` (header-level, so an empty foreign journal is caught) | REFUSE_STALE | `PROJECT_MISMATCH` |
| 3 entries | first compute `interrupted`; then any row `liveness === 'RUNNING'` (cell `'RUNNING'`) | REFUSE_STALE | `HEARTBEAT_LIVE` |
| 3 entries | any interrupted row R — other than the row named by `checkpoint.entryId` when a v1 checkpoint is present (a non-v1 checkpoint exempts nothing) — with no later row S (file order) having the same `runId`, `attempt`, `candidateId` and `liveness ∈ {SUCCEEDED, FAILED, CANCELLED}` (cell `'UNKNOWN'`); revoked/expired rows are settled by the filter; QUEUED never blocks | REFUSE_STALE | `RUN_UNRECONCILED` |
| 4 consent | `null|undefined` → `CONSENT_MISSING`; `expiresAtMs <= now` → `CONSENT_EXPIRED`; `revoked === true` → `CONSENT_REVOKED`; `scope !== 'execute'` → `CONSENT_SCOPE` (`execution-admission-v1.mjs:166-178` order) | REFUSE_STALE | as listed |
| 5 checkpoint | `null` → cell `'NONE'`, go to 6 | — | — |
| 5a | `schemaVersion !== 'nisi-interrupted-run-checkpoint/v1'` | REFUSE_STALE | `CHECKPOINT_SCHEMA` |
| 5b | `projectId !== expected.projectId` | REFUSE_STALE | `CHECKPOINT_PROJECT` |
| 5c | `sourcePins` differ from `expected.sourcePins` (length, or any pin's `id`/`sha256`) | REFUSE_STALE | `SOURCE_DIGEST_MISMATCH` (reused: `history/history-capture-permit-v1.mjs:130`) |
| 5d | `profile.{id,version,rulesetSha256}` not all equal | REFUSE_STALE | `CHECKPOINT_PROFILE` |
| 5e | `consentGrantedAtMs !== expected.consent.grantedAtMs`, or `takenAtMs < grantedAtMs`, or `takenAtMs >= expiresAtMs` | REFUSE_STALE | `CHECKPOINT_CONSENT` |
| 5f | no row with `entry.id === entryId` (cell `'NOT_FOUND'`); or the row is not in `interrupted` (cell = its liveness word — a stored report is not a checkpoint) | REFUSE_STALE | `CHECKPOINT_TARGET` |
| 5g | the cited row is not `entries[entries.length-1]` (cell = last row's liveness word: something was recorded after the interruption; every other interrupted row already passed step 3 as sibling-settled) | REFUSE_STALE | `CHECKPOINT_SUPERSEDED` |
| 5h | `takenAtMs < cited.entry.createdAt` | REFUSE_STALE | `CHECKPOINT_STALE` |
| 6 identity (restart) | any row `entry.runId === expected.runId` (safe restart uses a fresh run id, `roadmap.md:4260`) | REFUSE_STALE | `RUN_ID_REUSED` |
| 6 identity (resume) | `expected.runId !== cited.entry.runId` → `RUN_ID_MISMATCH`; `expected.attempt <= cited.entry.attempt` or any row with that `runId` and `attempt === expected.attempt` → `ATTEMPT_REUSED` (journal retry rule `run-journal-v1.mjs:119`) | REFUSE_STALE | as listed |
| 7 stages (resume) | `cited.entry.stage ∈ completedStages[].stage` | REFUSE_STALE | `STAGE_ALREADY_SUCCEEDED` |
| 7 | per claim in list order: row `id === claim.entryId` missing, or its `runId/attempt/candidateId` ≠ cited row's, or `stage !== claim.stage`, or `receiptId !== claim.receiptId` | REFUSE_STALE | `PASS_UNCONFIRMED` |
| 7 | that row's `liveness !== 'SUCCEEDED' || revoked || expired` (view flags, never `entry.state`) | REFUSE_STALE | `STALE_PASS` |
| 7 | that row's `createdAt > takenAtMs` | REFUSE_STALE | `CHECKPOINT_BEFORE_PASS` |
| 7 | any row with the cited `runId/attempt`, `liveness 'SUCCEEDED'`, `!revoked && !expired`, whose id is not claimed (its effects already happened) | REFUSE_STALE | `UNCLAIMED_PASS` |
| end | restart path all OK: cells `{OK,OK,OK,OK,NONE,OK,NOT_EVALUATED}` | SAFE_RESTART | `null` |
| end | resume path all OK | RESUME_ELIGIBLE | `null` |

Reason codes (25, closed): reused verbatim — `INVALID_INPUT`, `CONSENT_MISSING`, `CONSENT_EXPIRED`, `CONSENT_REVOKED`, `CONSENT_SCOPE` (`execution-admission-v1.mjs`), `PROJECT_MISMATCH` (`host-journal-bundle.mjs:79`, `journal-owner-v2.mjs:249`), `SOURCE_DIGEST_MISMATCH` (`history/history-capture-permit-v1.mjs:130`, `history/repository-host-history-v1.mjs:146`); NEW — `JOURNAL_SEALED`, `HEARTBEAT_LIVE`, `RUN_UNRECONCILED`, `CHECKPOINT_SCHEMA`, `CHECKPOINT_PROJECT`, `CHECKPOINT_PROFILE`, `CHECKPOINT_CONSENT`, `CHECKPOINT_TARGET`, `CHECKPOINT_SUPERSEDED`, `CHECKPOINT_STALE`, `RUN_ID_REUSED`, `RUN_ID_MISMATCH`, `ATTEMPT_REUSED`, `STAGE_ALREADY_SUCCEEDED`, `PASS_UNCONFIRMED`, `STALE_PASS`, `CHECKPOINT_BEFORE_PASS`, `UNCLAIMED_PASS`. A failed checkpoint never degrades to `SAFE_RESTART`: the caller must call again with `checkpoint: null` to obtain the restart verdict explicitly.

## Decisions

- `SAFE_RESTART` — persisted state is fully known (recovery `NEW` or `COMPLETE`), the header project matches, no row has a live heartbeat, every interrupted row is settled by an explicit terminal sibling (or is revoked/expired), consent is valid at `now`, no checkpoint was offered, and `expected.runId` is unused. The caller MAY submit `expected.runId/attempt` to `decideExecutionAdmission` and the journal with the original snapshot; it MUST NOT reuse any persisted `runId`, carry over any result, or treat `interrupted` as settled work. Not a grant.
- `REFUSE_STALE` — the only refusal; `reason` is the first failing check; `interrupted` (when non-null) still explains the interruption. The caller MAY reconcile (append a `REVOKED` entry or a terminal sibling per interrupted row, repair identity, drop the checkpoint) and decide again; it MUST NOT restart, resume or restore any PASS.
- `RESUME_ELIGIBLE` — a v1 checkpoint binds the same project, source pins, profile and consent grant the caller now presents, cites an interrupted entry that is the newest record (every other interrupted row being sibling-settled), and every claimed PASS is a `SUCCEEDED`, unrevoked, unexpired row of that run/attempt with the cited entry and receipt, created no later than the checkpoint; no PASS is unclaimed and the resume stage is not claimed complete. The caller MAY propose `expected.attempt` as a journal retry (`retryOf` the cited entry, `QUEUED`) that skips `completedStages`; `resumeGranted` is still `false`, the journal append and admission may still refuse.

## Explanation record

Derived, not a field (no free text is emitted, so no prose is pinned by the oracle): the ordered pair (`checks` cells in the fixed order `journal, project, entries, consent, checkpoint, identity, stages`, then `interrupted` items in file order). The operator reads the cells left to right; the first cell that is neither `OK` nor `NONE` is `reason`; echoed upstream words (`TRUNCATED`, `RECORD`, `COMMIT_UNCERTAIN`, `RUNNING`, `UNKNOWN`, `NOT_FOUND`, `SUCCEEDED`) name what the persisted state said. On `RUN_UNRECONCILED` the blocking rows are exactly the `interrupted` items (minus the cited one) with no later terminal sibling. Everything in it is built from persisted fields plus `now`; nothing comes from payload, the store or the host.

## Digest

- The module computes no digest (zero-import parity with `execution-admission-v1.mjs`). It echoes `journalSha256` = `journal.sha256`, the store's pin of the exact persisted bytes (`run-journal-store-v1.mjs:73` `sha256`), non-null only when recovery is `COMPLETE`.
- `inputDigest` (NEW; computed by the host and the integration oracle, not the module): `canonicalizeJSONV1(Buffer.from(JSON.stringify(declared))).sha256` from `canonical/canonical-json-v1.mjs:200` (profile `nisi-canonical-json-v1`, limits 1 MiB / depth 128 / 4096 members). `declared` = `{schema: 'nisi-interrupted-run-decision/input/v1', now, expected, journal: {projectId, observedAtMs, recovery, sha256, bytes}, checkpoint}` — the validator-rebuilt input with `journal.entries` omitted: rows are a pure function of the pinned bytes and `observedAtMs` under `reopen` + `list` (`run-journal-v1.mjs:175`, `:109`), and `entry.payload` is never read. It therefore binds identity, clock, checkpoint and the persisted bytes, not hand-built rows (those are caught only by the row invariants).

## Acceptance tests (`tests/interrupted-run-decision.test.mjs`; T02/T20 in a separate integration file that may import `history/`)

Fixture: `NOW=1_000_000`; `E={projectId:'project-a', runId:'run-b', attempt:0, sourcePins:[{id:'candidateFingerprint', sha256:'ab'x32},{id:'baselineFingerprint', sha256:'cd'x32}], profile:{id:'nisi-json-structure-v1', version:1, rulesetSha256:'ef'x32}, consent:{grantedAtMs:NOW-5000, expiresAtMs:NOW+60_000, revoked:false, scope:'execute'}}`; rows `s1='run-a:0:build'` SUCCEEDED `receiptId 'receipt-build'` `createdAt NOW-50_000 ttlMs 100_000`, `r1='run-a:0:tests'` RUNNING `heartbeatAt=createdAt=NOW-100` liveness UNKNOWN, `d1='run-a:0:tests-done'` SUCCEEDED (same runId/attempt/candidateId, `createdAt NOW-90`); `J=[s1,r1,d1]` COMPLETE, `projectId 'project-a'`, `observedAtMs NOW`, `sha256 'd5'x32`, `bytes 1381`; `JR=[s1,r1]` (r1 last, unreconciled); `CK={schemaVersion v1, projectId 'project-a', sourcePins E's, profile E's, consentGrantedAtMs NOW-5000, entryId 'r1', takenAtMs NOW-50, completedStages:[{stage:'build', entryId:'s1', receiptId:'receipt-build'}]}`; `ER={...E, runId:'run-a', attempt:1}`.

1. Restart baseline: `{now, expected:E, journal:J, checkpoint:null}` → `SAFE_RESTART`, reason null, checks `{OK,OK,OK,OK,NONE,OK,NOT_EVALUATED}`, `interrupted [r1 item]` (d1 settles it, the filter still lists it), `journalSha256 'd5'x32`, three flags false, result/checks/interrupted/item frozen, `Object.keys` in the fixed order.
2. Real-module round trip: `createRunJournal({project-a,100,10,[]})`, append s1 and r1, `serialize`, `writeSerializedJournal`, spawn a child that `reopen`s + `list(NOW)` → `RUN_UNRECONCILED` with `interrupted [r1]`; `+CK` with `ER` → `RESUME_ELIGIBLE`; a second child after appending d1 → `SAFE_RESTART`; `reopen(text.slice(0,-30)).report` → `JOURNAL_SEALED` cell `'TRUNCATED'` `interrupted null`; `reopen('nope\n')` with `projectId null` → cell `'HEADER'`; `list(header.now)` while the heartbeat is within `heartbeatTtlMs` → `HEARTBEAT_LIVE`.
3. Uncertain writes: recovery `{INCOMPLETE, rejectedLine 11, reason 'MISSING_FOOTER'}` with the prefix rows → `JOURNAL_SEALED` cell `'MISSING_FOOTER'`, project..stages NOT_EVALUATED, `interrupted null`; `{COMMIT_UNCERTAIN, entries [], sha256 null, bytes null}` → cell `'COMMIT_UNCERTAIN'`; `INVALID/RECORD` line 5 → `'RECORD'`; `INVALID/FOOTER` → `'FOOTER'`; a valid CK attached changes nothing.
4. Foreign project: `journal.projectId 'project-b'` with `entries []` (empty foreign journal) → `PROJECT_MISMATCH`, entries NOT_EVALUATED, `interrupted null`; rows stamped `'project-b'` under header `'project-a'` → `INVALID_INPUT`.
5. Live vs stale heartbeat: add `r2='run-c:0:tests'` RUNNING `heartbeatAt=createdAt=NOW-5` liveness `'RUNNING'` → `HEARTBEAT_LIVE` cell `'RUNNING'`, `interrupted [r1 item]` (r2 excluded); on `JR` with r2 liveness `'UNKNOWN'` and a later `run-c:0:tests-done` SUCCEEDED sibling (same runId/attempt/candidateId) → r2 is reconciled, r1 is not → `RUN_UNRECONCILED` cell `'UNKNOWN'`, `interrupted [r1, r2]`; a sibling of another attempt (`'run-a:1:tests-done'`) or candidate does not settle r1; adding d1 → `SAFE_RESTART`. r1 revoked (`revoked:true`, liveness `'REVOKED'`, plus `rv1` state REVOKED `revokes 'r1'`) → `SAFE_RESTART`, `interrupted []`; r1 expired (`expired:true, retained:false, payload:null, liveness 'EXPIRED'`) → `SAFE_RESTART`.
6. QUEUED never blocks: `q1='run-q:0:build'` QUEUED liveness QUEUED beside settled rows → `SAFE_RESTART`, `interrupted []`.
7. Consent, both paths, after history: `consent null`/`undefined` → `CONSENT_MISSING`; `expiresAtMs === NOW` → `CONSENT_EXPIRED` and `NOW+1` passes; `revoked true` → `CONSENT_REVOKED`; `scope 'review'` → `CONSENT_SCOPE`; each with journal/project/entries `OK` and checkpoint..stages NOT_EVALUATED; `grantedAtMs NOW+1` → `INVALID_INPUT`.
8. Order, first failure wins: `JR` + `INCOMPLETE/TRUNCATED` + header `'project-b'` + r2 live + expired consent + CK v0 → `JOURNAL_SEALED` with `{TRUNCATED, NOT_EVALUATED×6}`; repair in order → `PROJECT_MISMATCH`, `HEARTBEAT_LIVE`, (r2 removed; a v0 checkpoint exempts nothing) `RUN_UNRECONCILED`, (CK made v1 but `projectId 'project-b'`) `CONSENT_EXPIRED`, `CHECKPOINT_PROJECT`, `RESUME_ELIGIBLE`.
9. Resume baseline: `{expected:ER, journal:JR, checkpoint:CK}` → `RESUME_ELIGIBLE`, reason null, all seven cells `OK`, `interrupted [r1 item]`, `resumeGranted false`.
10. Checkpoint version (on `J`, no unreconciled rows): `{schemaVersion:'nisi-interrupted-run-checkpoint/v2', anything:1}` → `CHECKPOINT_SCHEMA` (other keys not validated); `'…/v1 '` and `'…/v0'` → `CHECKPOINT_SCHEMA`; `schemaVersion 42` or `{}` → `INVALID_INPUT`.
11. Source pin drift in one of N: CK with `sourcePins[1].sha256 'ff'x32` (pin 0 intact) → `SOURCE_DIGEST_MISMATCH`; pins reordered → `SOURCE_DIGEST_MISMATCH`; one pin missing → `SOURCE_DIGEST_MISMATCH`; `profile.rulesetSha256` changed → `CHECKPOINT_PROFILE`; `projectId 'project-b'` → `CHECKPOINT_PROJECT`; `consentGrantedAtMs NOW-4999` → `CHECKPOINT_CONSENT`; `takenAtMs NOW-6000` (before the grant) → `CHECKPOINT_CONSENT`.
12. Stored report is not a checkpoint (on `J`): CK `entryId 's1'` → `CHECKPOINT_TARGET` cell `'SUCCEEDED'`; citing an EXPIRED / REVOKED / QUEUED row → that word; unknown id → `'NOT_FOUND'`; `recovery NEW` + CK → `CHECKPOINT_TARGET 'NOT_FOUND'`.
13. Supersession and staleness (on `JR`): `+ 'run-z:0:x'` SUCCEEDED appended after r1 → `CHECKPOINT_SUPERSEDED` cell `'SUCCEEDED'`; `r0='run-z:0:y'` UNKNOWN unreconciled placed before s1 → `RUN_UNRECONCILED` (the exemption covers only the cited row); r0 followed by its SUCCEEDED sibling → `RESUME_ELIGIBLE`; `takenAtMs NOW-101` → `CHECKPOINT_STALE`; `NOW-100` → `RESUME_ELIGIBLE`.
14. Identity: restart with `expected.runId 'run-a'` → `RUN_ID_REUSED`; resume with `ER.runId 'run-b'` → `RUN_ID_MISMATCH`; `ER.attempt 0` → `ATTEMPT_REUSED`; `+ 'run-a:1:x'` FAILED placed before r1 in file order and `ER.attempt 1` → `ATTEMPT_REUSED`, `attempt 2` → `RESUME_ELIGIBLE`.
15. Duplicate side-effect receipt and stale PASS (on `JR`+`ER`+`CK`; rows added here are placed before r1 in file order): claim `receiptId 'receipt-other'` → `PASS_UNCONFIRMED`; claim `entryId 'run-a:0:buildX'` → `PASS_UNCONFIRMED`; s1 candidate `'candidate-b'` → `PASS_UNCONFIRMED`; s1 revoked by `'run-a:0:build-rev'` (state still `'SUCCEEDED'`, liveness `'REVOKED'`) → `STALE_PASS`; s1 `expired:true` liveness `'SUCCEEDED'` → `STALE_PASS`; s1 FAILED → `STALE_PASS`; s1 `createdAt NOW-40` (after takenAtMs) → `CHECKPOINT_BEFORE_PASS`; `+ 'run-a:0:lint'` SUCCEEDED unclaimed → `UNCLAIMED_PASS`; `completedStages` claiming `'tests'` → `STAGE_ALREADY_SUCCEEDED`; `completedStages []` with s1 present → `UNCLAIMED_PASS`.
16. No silent downgrade: every refusal in T10–T15 is `REFUSE_STALE` with `interrupted` non-null; the identical `JR` input with `checkpoint:null` and `expected:E` decides `RUN_UNRECONCILED` (never `SAFE_RESTART` while r1 is unsettled), and only after d1 is appended `SAFE_RESTART`.
17. Payload is opaque: rows whose payload is `null`, `{sourcePins:…, overall:'PASS'}`, or a 1 MB string decide deepEqual to T1/T9; a payload accessor property → `INVALID_INPUT`.
18. INVALID_INPUT battery (all cells NOT_EVALUATED, `interrupted null`): `undefined`, `null`, `'x'`, `[]`, `{}`, extra key, symbol-keyed extra, non-enumerable extra, accessor `expected`, `now -0/1.5/-1`, `observedAtMs NOW±1`, `recoveredIds` reordered vs entries, duplicate row, `historical:false`, `row.authorizing:true`, 6/8-key row, 13-key entry, `heartbeatAt > createdAt`, `createdAt > now`, `ttlMs 0`, `state 'INTERRUPTED'`, `liveness 'SEALED'`, `expired:true` with `createdAt+ttlMs > now`, `revoked:true` with no revoker, `revokes` on a non-REVOKED row, `retained:false` with payload `{}`, COMPLETE with `sha256 null`, NEW with `bytes 5`, INCOMPLETE with `rejectedLine null`, `projectId null` on COMPLETE, `sourcePins []`/17 pins/duplicate pin id, `takenAtMs NOW+1`, 65 completed stages, duplicate claim stage.
19. Purity and vocabulary: deep-frozen inputs unchanged (JSON before/after) across two calls that are deepEqual but not identical; source matches no `\bimport\b` and none of the admission regex words; `Object.keys(namespace)` is `['decideInterruptedRunV1']`; over ≥ 60 adverse inputs status ∈ the three words, `reason null ⇔ status !== 'REFUSE_STALE'`, reason ∈ the 25 codes otherwise, three flags false everywhere.
20. Real reopen acceptance: seed QUEUED, RUNNING(heartbeat), SUCCEEDED+revoker and short-ttl rows, `openJournalBundle` in a spawned child at `now=N`, project `{recovery, sha256, bytes, entries}` → not `INVALID_INPUT`, `interrupted` deepEquals `bundle.interrupted`, reason `RUN_UNRECONCILED`; append a terminal sibling per RUNNING row, rewrite, reopen in a second child → `SAFE_RESTART`.

## Mutants that must fail

1. `expiresAtMs <= now` → `<` (T7 closed boundary).
2. Drop the `liveness === 'RUNNING'` → `HEARTBEAT_LIVE` branch (T5 first case, T2 last case).
3. Drop the `RUN_UNRECONCILED` pass, or let a QUEUED/UNKNOWN/REVOKED sibling count as terminal (T5+); drop the cited-row exemption (T9) or extend it to non-v1 checkpoints (T8). Settlement is by runId/attempt/candidateId only — the stage is irrelevant (a later terminal row of any stage proves the run progressed past the crashed row; pinned positively in T5+).
4. Require a terminal sibling only by `runId` (drop `attempt`/`candidateId`) (T5: a sibling of another attempt must not settle r1).
5. `interrupted` filter keyed on `entry.state` without `liveness === 'UNKNOWN'` (T5 revoked/expired cases echo rows).
6. Consent step moved before journal/project (T8 order).
7. Only `INVALID` seals: `COMMIT_UNCERTAIN` or `INCOMPLETE` treated as open (T3).
8. `PROJECT_MISMATCH` computed from row projectIds instead of `journal.projectId` (T4 empty foreign journal).
9. `observedAtMs !== now` weakened to a safe-integer check (T18).
10. Checkpoint refusal returns `SAFE_RESTART` (T16).
11. `schemaVersion` pin relaxed to `startsWith` (T10).
12. Compare only `sourcePins[0]` or ignore pin order/length (T11).
13. `STALE_PASS` read from `entry.state` instead of `liveness/revoked/expired` (T15 revoked and expired PASS).
14. Claim matched on candidateId/stage/receipt only (runId or attempt dropped), or the `UNCLAIMED_PASS` scan narrowed to the cited candidateId (T15+).
15b. `RUN_ID_REUSED` qualified by attempt or ignoring revoked/expired rows (T14+).
16. Either direction of the revoked/expired coherence dropped; the row cap moved; the catch-all removed (T18+, T19+).
14. Drop the `receiptId` comparison (T15 first case) or the `UNCLAIMED_PASS` scan (T15).
15. `expected.attempt <= cited.attempt` → `<` (T14) or drop `RUN_ID_REUSED` (T14 first case).
16. `resumeGranted: status === 'RESUME_ELIGIBLE'` or any flag true (T9, T19).
17. `Reflect.ownKeys` → `Object.keys` in the record helper (T18 symbol/non-enumerable extras).
18. Ordered `entries`/`recoveredIds` equality → `includes` (T18 reordered/duplicate rows).

## Open questions for Louis (each changes the contract)

1. Reconciliation: is a later terminal sibling (same runId/attempt/candidateId) enough to settle an interrupted row, or must the host append a `REVOKED` entry citing it (revoke-only, the stricter reading of `roadmap.md:4938`)? Revoke-only removes the sibling rule from step 3 and makes every crash require a write before any decision.
2. Fresh run id: enforced via `expected.runId/attempt` + `RUN_ID_REUSED` (this spec) or advisory only (`restart.doNotReuse`, no `expected.runId`)? Must `expected.attempt` be 0 on restart?
3. Source identity: a list of named pins (this spec, NEW shape) or the single `sourceSha256` the tree already uses? Who composes the workspace fingerprints into it, and is that composition versioned?
4. Consent binding on resume: same grant (`consentGrantedAtMs` equality + window, this spec) or any currently valid `execute` consent? Should the admission consent shape gain a `consentId` (changes `execution-admission-v1` and its oracle)?
5. `recovery.status 'NEW'`: `SAFE_RESTART` (loss of optional history reduces capability, `roadmap.md:4944`) or refuse when a journal is expected to exist (would add a `historyRequired` input)?
6. Input producer: bundle projection (projectId-only binding) or journal-owner-v2 snapshot (adds `CONFIG_MISMATCH`/`CLOCK_BEHIND_JOURNAL` upstream and `COMMIT_UNCERTAIN`)? If the bundle, should `heartbeatTtlMs/maxEntries` be inputs so header-config drift cannot silently change liveness?
7. Digest: keep `inputDigest` outside the module (zero-import parity) or import `createHash` like `prevention-experiment-plan-v1.mjs` and emit it from the decision? Should `journal.entries` be bound in it despite the 1 MiB canonical limit?
8. Should the derived explanation be materialised as a frozen `explanation` field (codes only, no text), and should `RUN_UNRECONCILED` name the first blocking id (`entryId`)?
9. Cross-attempt PASS reuse: claims must cite rows of the cited entry's own attempt (this spec); allow claims against earlier attempts of the same run via the `retryOf` chain?

---

## Review disposition (Claude, 2026-09-14)

`evidence/claude-review-20260914.md` (wf_f1ab9875-020, 47 agents): **ACCEPT_WITH_DEFECTS** — the
module decided correctly on every probe (no accepted-but-should-refuse case, no order violation, no
throw, no mutation, no real persisted shape refused); the defects were oracle gaps. Disposition:
the six proposed additions are folded into the oracle (24 tests); 13 of the 14 surviving mutants
are now killed and the 14th (`<=`→`<` on the attempt disjunct) is proven equivalent
(`evidence/mutants-20260914.txt`). Two contract wordings tightened above: claims are checked one at
a time in list order (PASS_UNCONFIRMED, then STALE_PASS, then CHECKPOINT_BEFORE_PASS, before the next
claim), and check 5e's `takenAtMs >= expiresAtMs` is unreachable after step 4 (kept for symmetry).
