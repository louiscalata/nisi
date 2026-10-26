# Repository incident candidates v1 — private contract

Status: accepted in source-checkout preview scope, 1535/1535 portable checks.
Overall Nisi 30% (3/10 NX milestones); native admission and NX-05 remain open.

## Purpose and integration

Implement `history/repository-incident-candidates-v1.mjs`, exporting
`createRepositoryIncidentPreviewV1({bundle,context})`. Re-read the exact bundle
with `readRepositoryRunBundleV1` and original issued context before projecting.
Malformed/context-cloned inputs throw a closed error; never accept serialized
expectations or the aggregate repository-history-v1 preview as source evidence.
Object accessors are rejected without invocation by the existing exact readers;
hostile Proxy execution is outside the trusted in-process boundary.

The actual `createRepositoryWorkflowOwnerV1` exposes `incidentPreview()` with no
arguments, only after collect(report) has settled both owners and created the
valid bundle. Before settlement: REFUSED/NO_SETTLED_RESULT; quarantined or failed
settlement: REFUSED/HOST_NOT_SETTLED; projection failure: REFUSED/INVALID_EVIDENCE.
Refusals use the envelope below with null digests and empty rows. Projection is
optional: failure must not alter the engine report, host status, bundle, proposal,
existing history preview/capture, or prior outcome. No dispatch from preview.

## Exact envelope

`schemaVersion: nisi-repository-incident-preview/v1`, `status: PREVIEW|REFUSED`,
`reason: null|NO_SETTLED_RESULT|HOST_NOT_SETTLED|INVALID_EVIDENCE`,
`reportSha256`, `bundleFingerprint`, `rows`, `sha256`,
`sourceTrust: TRUSTED_HOST_STATEMENTS_NOT_ATTESTED`,
`freshness: SETTLED_SNAPSHOT_ONLY`, `persistable:false`, `learningEligible:false`,
`authorizing:false`.

For PREVIEW, `sha256 = H(nisi/repository-incident-preview/v1, body)`, where body
is this envelope without sha256. All strings canonicalized using existing
stableStringify; H(domain,value)=sha256(domain + NUL + stableStringify(value)).
No timestamps or random IDs in preview. Return recursively frozen plain data.
No truncation: reject >6565 rows or >16MiB canonical output instead of losing
failed attempts or late results. Rows ordered by stageIndex then checkIndex.

## Exact row

- schemaVersion: `nisi-repository-incident-row/v1`
- rowId: H(`nisi/repository-incident-row-id/v1`, binding)
- occurrenceGroupId: H(`nisi/repository-incident-occurrence/v1`,
  {taskFingerprint,baselineFingerprint,runId,familyId})
- familyId: H(`nisi/repository-incident-family/v1`,
  {stage,profileId,profileVersion,rulesetSha256}) — profile grouping, NOT root cause
- binding: {runId,taskFingerprint,baselineFingerprint,attempt,stage,checkIndex,
  candidateFingerprint,subjectKey}. subjectKey is path hash for static files or
  H(`nisi/repository-incident-suite/v1`,nodeSuiteFingerprint) for Node tests.
- stageIndex: exact engine report index
- classification: `FAILURE_CANDIDATE|PASS|NOT_RUN|OPERATIONAL|INTERRUPTED`
- reason: `RECORDED_FAILURE|RECORDED_PASS|NOT_DISPATCHED|CHECK_NOT_RUN|
  STAGE_UNAVAILABLE|CHECK_UNAVAILABLE|ENGINE_INTERRUPTED`
- rawStatus: `PASS|FAIL|NOT_RUN|ERROR|INCONCLUSIVE|NOT_DISPATCHED|NO_RECEIPT`
- stageStatus: original engine stage status
- disposition: `RESULT_RECORDED|ENGINE_INTERRUPTED`
- source: {reportSha256,bundleFingerprint,planFingerprint,groupFingerprint,
  expectationFingerprint,profileFingerprint,verifierSourceSha256,
  verifierBuildSha256,executableSha256,rulesetSha256,preparationFingerprint,
  materializedFingerprint,receiptSha256,evidenceSha256}
- subject: {kind:FILE|MATERIALIZED_TREE,pathSha256,contentSha256}. Node test suite
  acts on the materialized tree: pathSha256/contentSha256 null, never assign a
  whole-suite defect to an arbitrary individual file. Tree hash lives in source.
- failureCodes: sorted unique fixed Swift deterministic IDs or fixed-shape
  Node assertion IDs from validated adapter evidence; no arbitrary messages.
- sourceTrust: `TRUSTED_HOST_STATEMENTS_NOT_ATTESTED`
- persistable:false, executionVerified:false, learningEligible:false,
  independentOccurrence:false, authorizing:false, certificationGranted:false
- fingerprint: H(`nisi/repository-incident-row/v1`, row without fingerprint)

Static rows use the original plan's issued check expected/request/target values.
receiptSha256 = H(`nisi/repository-incident-receipt/v1`, receipt), null if absent.
evidenceSha256 = H(`nisi/repository-incident-evidence/v1`, exact group entry for
static, or exact execution for Node). plan/group fingerprints null for Node.
Path hash = H(`nisi/repository-incident-path/v1`, path); hashes are linkable and
dictionary-guessable, NOT anonymization or privacy guarantees. No raw source,
path, explanation, assertion message, stdout/stderr, task text or profile argv.

## Qualification, in order

1. ENGINE_INTERRUPTED => INTERRUPTED regardless of raw receipt status.
2. Undispatched => NOT_RUN/NOT_DISPATCHED.
3. Stage is neither PASS nor FAIL => OPERATIONAL/STAGE_UNAVAILABLE.
4. Raw NOT_RUN => NOT_RUN/CHECK_NOT_RUN; non PASS/FAIL => OPERATIONAL/CHECK_UNAVAILABLE.
5. Raw FAIL AND stage FAIL => FAILURE_CANDIDATE/RECORDED_FAILURE.
6. Raw PASS => PASS/RECORDED_PASS; otherwise throw inconsistent evidence.

The underlying original-issued bundle readers validate clean termination,
drain, timeout, truncation, raw output and exact engine adapter correspondence.
A raw static child FAIL in an UNAVAILABLE group remains OPERATIONAL, not a
candidate. Preserve its rawStatus and any closed failure codes for diagnosis.
All attempts are emitted even if the final run COMPLETED or report storage failed.
Same run/family across repairs shares occurrenceGroupId; distinct rowId.
This grouping does not establish independent occurrences across distinct runs.
No automatic REPAIRED/causal label: later PASS alone does not prove resolution.

## Acceptance

Independent tests: normal failing-then-passing Node repair; static failure;
interrupted late results; host outer failure; storage-failed final report;
operational static group with earlier raw FAIL; missing/changed/rehash evidence;
cloned issued context; exact schemas; metadata leak checks; stable replay;
occurrence grouping across attempts; content conflict identity; row order;
actual host before/pending/settled/quarantined paths and unchanged old methods.
Run full portable suite and selected semantic mutants. Bind receipt to previous
252 pins: only deliberate host change plus inventoried new files. Do not include
new tests in old passing evidence or silently repin unrelated changes.

## Boundaries and coauthor adjudication

Opus's proposal included candidate/stageIndex in an occurrence key while claiming
repair attempts share it. They change across repairs; omit them from group IDs.
Opus also proposed REPAIRED attribution and truncated subsets: neither is adopted.
Run-derived public salts are not anonymization. Keep explicit hash limitations.
Daybreak's native audit confirms Node receipts are not native PipelineResult.
Do not edit imported native v1 schemas or fabricate that conversion. Native
transport, independent reconstruction/rerun, explicit persistence permission,
current scope/revocation/retention checks and evaluated policy admission follow.
This preview is not incident storage, a current capture permit, training,
prediction, certification or public-release clearance.
