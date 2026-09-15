# incident-eligibility-v1 — `decideIncidentEligibilityV1(input)`

Module (does not exist yet): `hosts/repository/incident-eligibility-v1.mjs`, schemaVersion `nisi-incident-eligibility/v1` (NEW). Oracle `tests/incident-eligibility.test.mjs`, written before the module. Zero imports, no clock, never throws, deep-frozen output, fixed check order, first failure is the reason — the discipline of `hosts/repository/execution-admission-v1.mjs` (sha256 5a9d94e1…ec2dd6) and `hosts/repository/interrupted-run-decision-v1.mjs` (sha256 89f8a08d…ff5a2, roadmap.md L5194-5201). Synthesised from the minimal-surface proposal plus the grafts both judges asked for. Field names not printed by an upstream module are marked NEW.

## Purpose

roadmap.md L4066-4069: "**NX-05 — Integrate failure observations and history.** Specify and test the report-to-incident mapping, trust source, redaction, project isolation, idempotent replay versus conflicting input, revocation, retention and write uncertainty. Nisi's report-store acknowledgement is not durable ledger proof." — this contract is the pure decision half of L325 "**Next:** source-bound incident eligibility and history lifecycle integration": given one fresh `queryRepositoryIncidentV1` result, one public native-incident-source plan envelope and the host's admission context, it returns only ELIGIBLE / INELIGIBLE / UNCERTAIN with a first-failure explanation. It admits, persists, learns and authorizes nothing, and it does not close NX-05 (L4072-4073 "crash qualification and incident eligibility remain open; this milestone is not closed.").

## Non-claims

- ELIGIBLE is not admission, storage, native capture, rerun, crash qualification or learning: `admitted:false`, `authorizing:false`, `learningEnabled:false` on every result; the plan's `requiresSeparateAdmission:true`, `nativeRerun:'NOT_RUN'`, `executionVerified:false` are pinned input literals, never overridden (roadmap L4082-4083, L4087-4088, L112-113; native-incident-source-v1.mjs L19-20).
- Not authenticated or attested: `PERSISTED_UNAUTHENTICATED_OBSERVATION` (capture-v1 L261) over a `TRUSTED_HOST_STATEMENTS_NOT_ATTESTED` row (candidates-v1 L13) with twelve hard-false flags are the only accepted trust shape; the contract cannot raise trust (roadmap L226, L4077-4078, L140).
- No digest is recomputed (zero imports): rowId, fingerprint, occurrenceGroupId, entryId, sourcePlanDigest are compared and echoed, never verified; hash consistency is the fresh query's claim (capture-v1 L87-89, L253; header L2 "Persisted hashes prove consistency, not authenticity").
- Issuance is unverifiable purely: `isIssuedRepositoryIncidentPreviewV1` / `isIssuedNativeIncidentSourcePlanV1` are WeakSet/WeakMap brands (candidates-v1 L14-15; native L9, L23). A structurally valid clone is indistinguishable from the issued object here. Since a SOURCE_BOUND envelope can only be produced in the process holding the issued preview (native L30-34; no handles on disk), ELIGIBLE is reachable only inside the process that ran the run — a stored observation from an earlier process can only reach a plan refusal.
- Freshness is not bound: the query result carries no observedAt; the decision is "as of the query's own `now`" (capture-v1 L281). Callers re-query immediately before any separate admission step.
- The query's REFUSED words are not made precise: JOURNAL_UNAVAILABLE still covers PROJECT_MISMATCH, CLOCK_BEHIND_JOURNAL and unreadable bytes (L271); INVALID_OBSERVATION covers tampering, on-disk redaction and the input catch-all (L284-286). Cells echo the word; nothing guesses the sub-cause.
- Redaction has no marker field: a `[REDACTED]` payload (run-journal-v1.mjs L9) never reaches the query surface (L285); here it is a shape violation. Retention/erasure/durability/cross-process locking are not asserted (roadmap L4069, L146-150, L585-586, L441-444).
- Tests-stage (Node) failures are never source-bound (native L37; roadmap L95). The Swift bridge is unproven (design-request.md L67). No causal or recurrence claim (roadmap L226-228). Not staged-package material (L330, L535); nothing touches the frozen Veritas import (L2288-2289). Overall progress count unchanged (L21).

## Input

`input` is an exact closed record: Reflect.ownKeys length AND membership, string keys only, own enumerable data descriptors read through getOwnPropertyDescriptor, plain or null prototype (record() of interrupted-run-decision-v1.mjs L41-55). Exactly five keys, none optional; nullable VALUES are only `capture` and the fields the producers themselves null.

| key | type / rule | producer (file:line) |
|---|---|---|
| `projectId` | `/^task:[0-9a-f]{64}$/` — the `config.projectId` the caller passed to the query | capture-v1.mjs L12, L266-267; journal header (run-journal-v1.mjs L131) |
| `query` (NEW key name) | frozen 9-key result of `queryRepositoryIncidentV1`; rules below | history/repository-incident-capture-v1.mjs L257-287 |
| `plan` | frozen 13-key envelope, never null (every producer returns one); rules below | hosts/repository/native-incident-source-v1.mjs L17-22, L74-79; reviewed-workflow-v1.mjs L167-173 |
| `revoked` (NEW as input; name = journal row view key, run-journal-v1.mjs L109) | boolean — the host holds a revocation decision for this entryId that the query may not yet reflect (roadmap L585) | caller |
| `capture` (NEW) | `null` \| exact `{status, reason}`: status ∈ {STORED, DUPLICATE, CONFLICT, UNCERTAIN, STORE_FAILED, REFUSED}, reason `null` \| `/^[A-Z][A-Z0-9_]{0,63}$/` — this process's own capture result for this entryId; null after restart or when none is held | capture-v1.mjs journalStatus L134-151, result keys L153-232 |

**`query`** — keys exactly {schemaVersion, status, reason, entryId, journalSha256, observation, sourceTrust, learningEligible, authorizing} as a SET (the query cloneFreeze-sorts, L259); schemaVersion `nisi-repository-incident-query/v1`; sourceTrust `PERSISTED_UNAUTHENTICATED_OBSERVATION`; learningEligible false; authorizing false; reason null for every non-REFUSED status. Nullability matrix verified against L264-286 (corrects the fact sheet's "journalSha256 null on every REFUSED": L274 assigns it before L277/L283 can throw; eligibility-probe.out L30):

| status / reason | entryId | journalSha256 | observation |
|---|---|---|---|
| REFUSED / INVALID_INPUT | null | null | null |
| REFUSED / JOURNAL_UNAVAILABLE or JOURNAL_NOT_OPEN | ric1 hex | null | null |
| REFUSED / INVALID_OBSERVATION | ric1 hex or null | hex or null; hex only with a hex entryId | null |
| MISSING | ric1 hex | hex (file present, no entry) or null (no journal file) | null |
| REVOKED, EXPIRED, NOT_RETAINED | ric1 hex | hex | null |
| AVAILABLE_OBSERVATION | ric1 hex | hex | 11-key payload |

Payload: exactly OBSERVATION_KEYS (capture-v1 L30-33); schemaVersion `nisi-repository-incident-observation/v1`; previewSha256, declarationDigest hex64; consentClass `WRITTEN_DECLARATION`; the six flags false (L245-247). Row: exactly ROW_KEYS (L19-23), validateRow L64-85 verbatim — schemaVersion `nisi-repository-incident-row/v1`; rowId/occurrenceGroupId/familyId/fingerprint hex64; binding exactly BINDING_KEYS (runId `/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/` L10, four hex64 fingerprints, attempt/checkIndex non-negative safe integers not -0, stage ∈ {staticChecks, tests}); stageIndex likewise; classification/reason/rawStatus/stageStatus/disposition are CODE strings whose VALUES are decided in the row cell, not in shape; source exactly SOURCE_KEYS, all hex64 except planFingerprint/groupFingerprint (hex for staticChecks, null for tests, L73-81); subject exactly {kind, pathSha256, contentSha256} — staticChecks: FILE/hex/hex with subjectKey === pathSha256; tests: MATERIALIZED_TREE/null/null with checkIndex 0; failureCodes a plain Array of 0..65536 strings, strictly ascending, staticChecks ⊆ STATIC_CODES (L34-35), tests `/^NODE_ASSERTION_[a-f0-9]{16}$/` (L83); sourceTrust `TRUSTED_HOST_STATEMENTS_NOT_ATTESTED`; six ROW_FLAGS false.

**`plan`** — keys exactly the 13 printed (native-source-probe.out); schemaVersion `nisi-native-incident-source-plan/v1`; status ∈ {SOURCE_BOUND, REFUSED}; constants L18-20 pinned: rawContentIncluded false, persistable false, freshness `ORIGINAL_SNAPSHOT_ONLY`, requiresSeparateAdmission true, nativeRerun `NOT_RUN`, executionVerified/learningEligible/authorizing false. REFUSED: reason ∈ the closed ten (L15-16), selection null, sourcePlanDigest null. SOURCE_BOUND: reason null, sourcePlanDigest hex64, selection exactly {rowId, rowFingerprint, previewSha256, binding, source, profile, artifactByteLength, priorTranscriptSha256, inputSha256} (L74-75) — five hex64 digests; binding and source under the SAME validator as the row (stage grammar and per-stage nulls, so a forged tests-stage selection is refused by the row cell with the row's word, never by shape); profile exactly {id, kind, requiredSections, rulesFingerprint, allowedAdvisoryDimensions, modelParticipationRequired, maximumAdvisoryDimensions}: id ID-regex, kind string, requiredSections plain array 0..64 strings, rulesFingerprint hex64 and === selection.source.rulesetSha256 (L64), allowedAdvisoryDimensions `[]`, modelParticipationRequired false, maximumAdvisoryDimensions 0 (L65; roadmap L599-602); artifactByteLength non-negative safe integer ≤ 1048576 (L55). Not checked: issuance, sourcePlanDigest recomputation.

## Output

`Object.freeze`d; `Object.keys` order exactly `['schemaVersion','status','reason','checks','entryId','journalSha256','sourcePlanDigest','authorizing','admitted','learningEnabled']`.

- `schemaVersion` `nisi-incident-eligibility/v1`; `status` ELIGIBLE | INELIGIBLE | UNCERTAIN; `reason` null iff ELIGIBLE, else one of the 21 codes below.
- `checks`: frozen record, key order `['journal','capture','observation','project','row','source','identity']` (journal/project from the precedent CELLS; the rest NEW); each cell `'NOT_EVALUATED' | 'OK' | <upstream word verbatim>`; every cell after the first non-OK cell is NOT_EVALUATED; on INVALID_INPUT all seven are NOT_EVALUATED.
- `entryId`, `journalSha256`, `sourcePlanDigest`: echoed verbatim from `query`/`plan` on every non-INVALID_INPUT result (null exactly where the producer printed null); all null on INVALID_INPUT. Pins, not claims.
- `authorizing:false`, `admitted:false` (NEW), `learningEnabled:false` (NEW) — unconditional constants. No row, payload, timestamp or raw content is echoed. Same structurally-equal input ⇒ deepEqual output, distinct object; inputs never mutated.

## Check order

| step | cell | condition | status / reason | cell word |
|---|---|---|---|---|
| 0 | — | any shape rule above fails, or anything throws (revoked proxies, throwing traps) | INELIGIBLE / INVALID_INPUT | all NOT_EVALUATED |
| 1 | journal | query REFUSED with reason JOURNAL_UNAVAILABLE or JOURNAL_NOT_OPEN (capture-v1 L271-272) | UNCERTAIN / that reason | that reason |
| 2 | capture | `capture !== null && capture.status === 'UNCERTAIN'` (roadmap L4938) | UNCERTAIN / COMMIT_UNCERTAIN | `capture.reason ?? 'UNCERTAIN'` |
| 3 | observation | query REFUSED (INVALID_INPUT or INVALID_OBSERVATION) | INELIGIBLE / INVALID_OBSERVATION | query.reason |
|   |   | query MISSING with journalSha256 null (no journal file) | UNCERTAIN / MISSING | MISSING |
|   |   | query MISSING with journalSha256 hex (journal present, entry absent) | INELIGIBLE / MISSING | MISSING |
|   |   | query REVOKED, EXPIRED or NOT_RETAINED (the query's own order L280-282) | INELIGIBLE / that status | that status |
|   |   | AVAILABLE_OBSERVATION and `revoked === true` (roadmap L585) | INELIGIBLE / REVOKED | REVOKED |
| 4 | project | `'task:' + row.binding.taskFingerprint !== projectId` (capture-v1 L98, L250) | INELIGIBLE / PROJECT_MISMATCH | PROJECT_MISMATCH |
| 5 | row | `row.binding.stage !== 'staticChecks'` (native L37) | INELIGIBLE / UNSUPPORTED_STAGE | UNSUPPORTED_STAGE |
|   |   | classification/reason/rawStatus/stageStatus/disposition ≠ FAILURE_CANDIDATE/RECORDED_FAILURE/FAIL/FAIL/RESULT_RECORDED (native L38-39) | INELIGIBLE / ROW_NOT_FAILURE | ROW_NOT_FAILURE |
| 6 | source | `plan.status === 'REFUSED'` | INELIGIBLE / plan.reason, except INVALID_INPUT → INVALID_EVIDENCE (native L22 convention) | plan.reason verbatim |
| 7 | identity | `selection.rowId !== row.rowId` | INELIGIBLE / ROW_MISMATCH | ROW_MISMATCH |
|   |   | `selection.rowFingerprint !== row.fingerprint` | INELIGIBLE / CONFLICT | ID_CONTENT_MISMATCH |
|   |   | any of the 8 binding or 14 source keys not `===` | INELIGIBLE / CONFLICT | SOURCE_MISMATCH |
|   |   | `selection.previewSha256 !== observation.previewSha256` | INELIGIBLE / PREVIEW_MISMATCH | PREVIEW_MISMATCH |
| 8 | — | all seven cells OK | ELIGIBLE / null | all OK |

Reason codes (21, all upstream words): INVALID_INPUT, JOURNAL_UNAVAILABLE, JOURNAL_NOT_OPEN, COMMIT_UNCERTAIN, INVALID_OBSERVATION, MISSING, REVOKED, EXPIRED, NOT_RETAINED, PROJECT_MISMATCH, UNSUPPORTED_STAGE, ROW_NOT_FAILURE, INVALID_PREVIEW, PREVIEW_MISMATCH, ROW_MISSING, SOURCE_MISMATCH, INVALID_EVIDENCE, ARTIFACT_LIMIT, HOST_NOT_SETTLED, ROW_MISMATCH, CONFLICT. UNCERTAIN ⇐ {JOURNAL_UNAVAILABLE, JOURNAL_NOT_OPEN, COMMIT_UNCERTAIN, MISSING with null journalSha256}; every other code ⇐ INELIGIBLE. Capture statuses other than UNCERTAIN (STORED, DUPLICATE, CONFLICT, STORE_FAILED, REFUSED, null) are cell OK: the fresh read decides (a failed later declaration says nothing about the intact first entry; a non-committed write reads back as MISSING).

## Decisions

- **ELIGIBLE** means exactly: the fresh disk read returned a currently available, unrevoked, unexpired, retained, hash-consistent, project-matched, recorded static-check FAIL observation; this process holds no uncertain capture and no revocation decision for it; and a SOURCE_BOUND plan names the same row (rowId), the same bound content (fingerprint, 8 binding keys, 14 source keys) and the same settled snapshot (previewSha256). The caller MAY present `(entryId, sourcePlanDigest)` to a SEPARATE admission step and key idempotency on `entryId` (= H(projectId,rowId), capture-v1 L187). The caller MAY NOT treat it as admitted, persisted-native, learned or authorized; skip a fresh re-query before that step; or carry it to another process.
- **INELIGIBLE** is final for THIS input; a different query result, plan or projectId is a new question. The caller MAY NOT retry the same input expecting a change, and MUST NOT discard the observation — it stays in history with its named refusal (roadmap L4930-4933 "must not be silently discarded").
- **UNCERTAIN** means the ledger or write state is unresolved and reconciliation may change the answer without any input being wrong. The caller MAY reconcile (fresh-process reopen, `maintainJournalOwner`, host clearing its capture result) and ask again; MUST NOT treat it as INELIGIBLE (no filing) or ELIGIBLE; MUST NOT retry the write (roadmap L77 "A consumed refusal/uncertain write is not safely retryable").

## Explanation record

The `checks` record is the explanation: exactly one non-OK cell on a refusal, carrying the upstream word the producer printed (query status/reason, capture reason, plan reason, journal conflict word), so an operator can read "cell X said Y" without a code table; every later cell is NOT_EVALUATED, so the order is visible. The three echoes pin the inputs: `entryId` and `journalSha256` say which entry on which journal bytes, `sourcePlanDigest` which plan. Together they let a reviewer replay the decision: same query bytes + same plan digest ⇒ same result. Nothing else is echoed.

## Digest

- Pins to record in `docs/verification/<date>/incident-eligibility-v1/receipt.json`: sha256 of the module and of the oracle; `grep -c '^import'` === 0 and no Date/Math.random/require/process/Buffer/crypto/fs; node version; the mutant list with the killing test ids; precedent pins 5a9d94e1…, 89f8a08d… (matches roadmap L5194-5195), native ab08ed66…, capture 6b0aaaf0…, candidates 618c32c0….
- Scratchpad evidence for the pre-graft sketch (not deliverables; private tree untouched; /private/tmp is wiped on reboot): `/private/tmp/claude-501/-Users-louiscalata-pending-review-nisi/2f53d710-6292-4004-827d-779c1b004c30/scratchpad/iec/` — `eligibility-sketch.mjs` + `eligibility-probe.out` (real-producer ELIGIBLE and every lifecycle path), `eligibility-mutants.out` (23/23 killed), `judge2/p1-real-refused.out` (REFUSED/INVALID_OBSERVATION carries a hex journalSha256); this draft at `spec/README.md`. The grafted cells (capture, revoked, MISSING split, nullability matrix) have no executed evidence yet — the product oracle must supply it.
- Fact-sheet correction for the implementer: lens-1 "journalSha256 null on every REFUSED" is wrong; use the matrix above.

## Acceptance tests

Real-producer cases use `tests/helpers/incident-review-fixture.mjs` (paged host, 13 static FAIL rows) with memfs; declaration issuedAt 100, expiresAt 1000, createdAt 100, retentionMs 10000; query at now 100. Forged cases are hand-built from the printed shapes.

1. **Positive path A (real producers):** eligible[0] captured, queried AVAILABLE, plan = `host.nativeIncidentSourcePlan({rowId})` SOURCE_BOUND, projectId = `'task:'+taskFingerprint`, revoked false, capture `{status:'STORED', reason:null}` → ELIGIBLE, reason null, seven cells OK, echoes equal query.entryId / query.journalSha256 / plan.sourcePlanDigest, constants false, key orders exact, deep-frozen.
2. **Positive path B (idempotent replay):** same inputs twice → deepEqual, distinct objects, inputs unmutated; capture `{DUPLICATE,null}`, `{STORED,null}` and `null` all ELIGIBLE; a payload rebuilt in producer key order (schemaVersion first) instead of cloneFreeze order → ELIGIBLE (key SET semantics).
3. **INVALID_INPUT family** (each: INELIGIBLE/INVALID_INPUT, all cells NOT_EVALUATED, echoes null): undefined; null; `{}`; extra key; missing `capture`; symbol-keyed extra; getter-backed projectId; Map prototype; projectId `'proj'`; on the `query` slot a bare row (`nisi-repository-incident-row/v1`), a PREVIEW envelope, a host REFUSED preview envelope, a capture acknowledgement (`nisi-repository-incident-capture/v1`); matrix contradictions: JOURNAL_UNAVAILABLE with hex journalSha256, REFUSED/INVALID_INPUT with entryId set, REVOKED with null journalSha256, AVAILABLE with observation null, INVALID_OBSERVATION with hex sha and null entryId, MISSING with observation; status `'PENDING'`; query.sourceTrust `'ATTESTED'`; payload.executionAttested true; row.sourceTrust other; `'[REDACTED]'` in row.source.reportSha256 and in failureCodes; failureCodes unsorted; plan reason `'BOGUS'`; SOURCE_BOUND with selection null; REFUSED with selection; plan.requiresSeparateAdmission false; profile.modelParticipationRequired true; artifactByteLength 1048577 (1048576 passes); revoked `'yes'`; capture `{status:'WRITTEN'}`; capture missing `reason`.
4. **Never throws:** revoked Proxy; Proxy with throwing getPrototypeOf; query Proxy with throwing ownKeys; failureCodes with a throwing index getter → doesNotThrow, INVALID_INPUT.
5. **JOURNAL_UNAVAILABLE (real):** query with projectId `'task:'+'0'*64` against the journal → UNCERTAIN/JOURNAL_UNAVAILABLE, checks [JOURNAL_UNAVAILABLE, NE×6], entryId echoed, journalSha256 null, sourcePlanDigest echoed.
6. **JOURNAL_NOT_OPEN (real):** footer line removed → UNCERTAIN/JOURNAL_NOT_OPEN, cell journal JOURNAL_NOT_OPEN.
7. **Capture carrier:** T1 inputs with capture `{UNCERTAIN, READBACK_MISMATCH}` → UNCERTAIN/COMMIT_UNCERTAIN, checks [OK, READBACK_MISMATCH, NE×5]; `{UNCERTAIN, INTERNAL_ERROR}` → cell INTERNAL_ERROR; `{UNCERTAIN, null}` → cell UNCERTAIN; `{CONFLICT, ID_CONTENT_MISMATCH}`, `{STORE_FAILED, WRITE_FAILED}`, `{REFUSED, PROJECT}` → cell OK and the T1 decision ELIGIBLE.
8. **Corrupt/redacted on disk (real):** config.redactPaths `['payload.row.source.reportSha256']` → capture STORED, query REFUSED/INVALID_OBSERVATION with hex journalSha256 and non-null entryId → INELIGIBLE/INVALID_OBSERVATION, checks [OK, OK, INVALID_OBSERVATION, NE×4], both echoes non-null.
9. **Malformed query request (real):** query now -0 → REFUSED/INVALID_INPUT → INELIGIBLE/INVALID_OBSERVATION, cell observation INVALID_INPUT, entryId and journalSha256 null, sourcePlanDigest echoed. Never UNCERTAIN.
10. **MISSING split (real):** path `/j/none.jsonl` → UNCERTAIN/MISSING, journalSha256 null; entryId `'ric1.'+'f'*64` on the existing file → INELIGIBLE/MISSING, journalSha256 hex; both cell MISSING.
11. **REVOKED:** real tombstone via `recordJournalObservation`, query at now 102 → INELIGIBLE/REVOKED, cell REVOKED; T1 inputs with `revoked:true` → INELIGIBLE/REVOKED, cell REVOKED, project..identity NE.
12. **EXPIRED boundary (real):** now 10100 → INELIGIBLE/EXPIRED; now 10099 → query AVAILABLE and decision ELIGIBLE.
13. **NOT_RETAINED (real):** maxEntries 1, capture eligible[1] then eligible[2], query the first → INELIGIBLE/NOT_RETAINED.
14. **PROJECT_MISMATCH:** T1 inputs with projectId `'task:'+'1'*64` → INELIGIBLE/PROJECT_MISMATCH, checks [OK, OK, OK, PROJECT_MISMATCH, NE×3].
15. **UNSUPPORTED_STAGE:** the default fixture's tests-stage FAILURE_CANDIDATE row captured for real (capture accepts tests rows) with the real REFUSED/UNSUPPORTED_STAGE plan → INELIGIBLE/UNSUPPORTED_STAGE, checks.row UNSUPPORTED_STAGE, checks.source NE; the same row with a forged SOURCE_BOUND plan whose selection.binding.stage is `'tests'` and matches the row → identical result (plan never consulted).
16. **Report-to-incident mapping (forged rows — the stored surface cannot emit them, capture-v1 L69-70):** static PASS/RECORDED_PASS/PASS/FAIL/RESULT_RECORDED sibling with the real ROW_NOT_FAILURE plan → INELIGIBLE/ROW_NOT_FAILURE; the same row with a forged byte-matching SOURCE_BOUND plan → ROW_NOT_FAILURE, source NE; each quintuple cell off alone on the real FAIL row (classification PASS; reason RECORDED_PASS; rawStatus ERROR; stageStatus PASS; disposition ENGINE_INTERRUPTED) → ROW_NOT_FAILURE.
17. **Plan refusals:** `nativeIncidentSourceRefusalV1(code)` for each of the ten with the real AVAILABLE query → INELIGIBLE, reason = code except INVALID_INPUT → INVALID_EVIDENCE, checks.source = code verbatim (INVALID_INPUT visible), sourcePlanDigest null; real host refusal for rowId `'0'*64` → ROW_MISSING with checks [OK×5, ROW_MISSING, NE]; HOST_NOT_SETTLED → INELIGIBLE/HOST_NOT_SETTLED.
18. **Identity join** (single-field forgeries of the real SOURCE_BOUND plan, checks [OK×6, word]): selection.rowId `'e'*64` → ROW_MISMATCH/ROW_MISMATCH; rowFingerprint `'e'*64` → CONFLICT/ID_CONTENT_MISMATCH; binding.attempt 7 → CONFLICT/SOURCE_MISMATCH; source.receiptSha256 `'e'*64` → CONFLICT/SOURCE_MISMATCH; previewSha256 `'e'*64` → PREVIEW_MISMATCH/PREVIEW_MISMATCH; rowId AND fingerprint both changed → ROW_MISMATCH (order); the real plan for eligible[1] against the observation of eligible[0] → ROW_MISMATCH with that plan's sourcePlanDigest echoed.
19. **Compound faults, first failure wins:** REVOKED read + wrong projectId + plan REFUSED/ROW_MISSING → REVOKED; AVAILABLE + wrong projectId + plan REFUSED → PROJECT_MISMATCH; JOURNAL_NOT_OPEN + capture UNCERTAIN + everything else broken → JOURNAL_NOT_OPEN; journal OK + capture UNCERTAIN + REVOKED read → COMMIT_UNCERTAIN; AVAILABLE + revoked true + tests-stage row → REVOKED; AVAILABLE + tests-stage row + plan REFUSED/ARTIFACT_LIMIT → UNSUPPORTED_STAGE.
20. **Invariants over every case above:** Object.keys orders exact; result and checks frozen; reason null iff ELIGIBLE, else ∈ the 21; status ∈ the three; constants false; echoes equal the producer fields on every non-INVALID_INPUT result; the cell after the first non-OK cell is NE. Module-level: `grep -c '^import'` === 0; no Date/Math.random/require/process/Buffer/crypto/fs.

## Mutants that must fail

1. `plan.status !== 'SOURCE_BOUND'` → `false && …` — every plan refusal ELIGIBLE; killed by T17.
2. drop `sel.rowFingerprint !== row.fingerprint` — killed by T18.
3. journal cell UNCERTAIN → INELIGIBLE — killed by T5, T6; drop `|| reason === 'JOURNAL_NOT_OPEN'` — killed by T6.
4. lifecycle INELIGIBLE → UNCERTAIN — killed by T11, T12, T13.
5. MISSING split inverted (`=== null` ↔ `!== null`) or collapsed to one status — killed by T10.
6. capture cell removed, or UNCERTAIN mapped to OK — killed by T7; CONFLICT/STORE_FAILED mapped to INELIGIBLE — killed by T7 second half.
7. project check `if (false)` — killed by T14.
8. stage gate `if (false)` — killed by T15 (cell must be UNSUPPORTED_STAGE with source NE).
9. drop any one of the five quintuple comparisons — killed by T16.
10. `admitted: status === 'ELIGIBLE'`, or any constant flipped — killed by T1, T20.
11. `checks` not frozen, or cells emitted in insertion order — killed by T1, T20.
12. record() `own.length !== keys.length` → `<` — killed by T3 extra key.
13. observation cell INVALID_OBSERVATION → UNCERTAIN — killed by T8, T9.
14. drop the plan INVALID_INPUT → INVALID_EVIDENCE collapse — killed by T17.
15. `sel.previewSha256 !== obs.previewSha256` → `if (false)` — killed by T18.
16. drop the BINDING_KEYS or the SOURCE_KEYS loop — killed by T18 (attempt / receiptSha256).
17. failure-code vocabulary check disabled, or source hex check relaxed to `typeof === 'string'` — killed by T3 `[REDACTED]` cases.
18. delete the row.sourceTrust pin or any attestation-flag pin — killed by T3.
19. drop the nullability matrix (accept hex journalSha256 on JOURNAL_UNAVAILABLE, or null on REVOKED) — killed by T3 contradictions.
20. ignore `revoked` — killed by T11 second half; swap the project and row blocks — killed by T19.
21. remove the catch-all (rethrow) — killed by T4.

## Open questions for Louis (each changes the contract)

1. **Retention re-check with `now`** (judge 1 optional graft vs judge 2 objection): add `now` plus the entry window `{createdAt, ttlMs}` read from the journal row (journal-owner-v2 view) and refuse EXPIRED at `now >= createdAt + ttlMs` (inclusive, capture-v1 L116/L281)? Cost: the host must open the journal a second time. Current stance: no — expiry is the query's fresh-read statement.
2. **Capture carrier breadth** (judge 2 vs judge 1): should CONFLICT / STORE_FAILED / REFUSED capture results also refuse (INELIGIBLE with the capture reason as cell), or only UNCERTAIN as specified? Current stance: only UNCERTAIN; the fresh read decides the rest.
3. **HOST_NOT_SETTLED** (both judges list it as a defect, neither grafted a change): keep INELIGIBLE (final for this input, re-askable with a fresh plan) or move to UNCERTAIN because NEW/SETTLING/RUNNING hosts may still settle? Current stance: INELIGIBLE; UNCERTAIN stays reserved for ledger/write state.
4. **Freshness echo**: if `queryRepositoryIncidentV1` later returns an `observedAtMs`, this contract should require `observedAtMs === now` exactly as interrupted-run-decision-v1 L112 — a history/ schema change, not v1 here. Confirm it is wanted at all.
5. **Redaction consistency key** (judge 2 optional): accept the journal header's `redactPaths` and refuse a non-empty list next to an AVAILABLE payload as INVALID_INPUT (run-journal-v1 L165 + capture L285 make the pair impossible)? Current stance: left out for minimality.
6. **Bounds**: failureCodes ≤ 65536 and profile.requiredSections ≤ 64 are precedent-style caps, not producer limits; confirm or derive from a documented limit.
7. **Placement/types**: `hosts/repository/incident-eligibility-v1.mjs` with an additive `.d.mts` pinning the closed unions (outside the staged-package allowlist, roadmap L330) — confirm the path and whether the `.d.mts` is wanted in v1.
