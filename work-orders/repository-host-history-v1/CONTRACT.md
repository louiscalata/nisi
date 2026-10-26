# Actual repository host history — private integration contract

**Overall Nisi:30% (3/10). Status: scoped source acceptance complete.**
See roadmap.md for actual test evidence and the source-review contract correction.
Add historyPreview()/captureHistory(input) to the actual frozen API returned by
both createReviewedRepositoryHostV1 and createRepositoryWorkflowOwnerV1 in
hosts/repository/reviewed-workflow-v1.mjs. Existing methods and run/settlement
result shapes/identities/semantics stay unchanged. No public arbitrary settlement
input: host supplies its collected result privately through an internal helper.

## Implementation boundary

New history/repository-host-history-v1.mjs exports only
createRepositoryHistoryAccessV1({taskFingerprint,baselineFingerprint}). It is an
internal trusted-host seam, NOT source attestation. It returns {publish,reject,
preview,capture}; host exposes only preview as historyPreview and capture as
captureHistory. publish retains exactly one collected result before settled()
resolves; reject records SETTLEMENT_REJECTED on unexpected collection rejection.
No provisional capture after the engine report while owner drains are pending.
The current journal-owner v2, journal/store formats and engine remain unchanged.

Preview/capture before publication return REFUSED NO_SETTLED_RESULT, or
SETTLEMENT_REJECTED after rejected collection, without clock or journal I/O.
Preview failure/success after publication is cached because retained host metadata
is immutable. publish/reject are not exposed on the actual host API.

## Preview

Exact frozen envelope {schemaVersion:'nisi-repository-history-preview/v1',status,
reason,preview,sha256,authorizing:false}. PREVIEW has non-null body/digest and
reason:null; REFUSED has null body/digest and a bounded reason.

Validate final report using unchanged readFinalEngineReportV2. It validates final
linkage, NOT every stage or execution honesty. Malformed/null run ID -> INVALID_REPORT.
Wrong taskFingerprint -> TASK_IDENTITY_MISMATCH. Fixed projection fields:

```
schemaVersion: nisi-repository-history-observation/v1
taskFingerprint, baselineFingerprint, runId, attempt
candidateFingerprint: hex64 or null
candidatePresent: boolean
outcome, workflowOutcome: unchanged engine enums
hostState: SETTLED | QUARANTINED
ownerStates: {staticChecks, tests}: IDLE | BUSY | QUARANTINED | UNKNOWN
stageCounts: {PASS, FAIL, NOT_RUN, UNAVAILABLE, REPAIRED, NO_CHANGE}
stageTotal: exact count, at most2300; NEVER clamp
diagnostics: {reportCodeSha256,reportStoreCodeSha256,bundleCodeSha256,
              settlementCodeSha256:[null|hex,null|hex],
              historyCodeSha256:[null|hex,null|hex],
              ownerStateCodeSha256:[null|hex,null|hex]}
bundleFingerprint: null|hex
sourceAuthenticityAttested:false
executionAttested:false
learningEligible:false
authorizing:false
```

stageCounts must include exactly the actual status vocabulary above; unknown
statuses refuse INVALID_SETTLEMENT, not silently disappear. Code strings are
null or well-formed nonempty <=4096 chars, no NUL; EVERY non-null code is hashed
under 'nisi/repository-history-code/v1\0'. No arbitrary text copied into preview.
Owner error arrays must each have exactly two entries (null or own-data code).
No timings, source, paths, raw report, findings, invocation/history arrays or output.
Bundle summary can be null; otherwise require CONSISTENT and hex fingerprint.
Body max UTF8 canonical size16384; invalid source fields -> INVALID_SETTLEMENT.
Digest = SHA256('nisi/repository-history-preview/v1\0'+stableStringify(body)).

Candidate absence is NOT silently omitted: body keeps null/false. The v1 journal
requires a string candidateId, so this specific operational-entry profile uses
`cand:<64hex>` for actual candidates and reserved `none:<run UUID>` for absence.
`none:` is an absence marker, not a candidate or evidence of evaluation. Consumers
must use this profile and candidatePresent; neither namespace authorizes learning.

## Explicit one-attempt storage

capture exact own-enumerable-DATA envelope {owner,declaration,clock}; clock a
trusted synchronous function. Capture returns frozen exact:
{schemaVersion:'nisi-repository-history-capture/v1',status,reason,recordAttempted,
 consumed,sourceDigest,declarationDigest,journal,authorizing:false}.
State precedence: no settled result; consumed -> ALREADY_CAPTURED; busy -> BUSY;
then input validation. No rejected input is echoed. Journal is null before admission.

Declaration exact own-data scalar keys:
schemaVersion:'nisi-repository-history-declaration/v1', declarationId,projectId,
sourceDigest, issuedAt,expiresAt,createdAt,retentionMs,
consentClass:'WRITTEN_DECLARATION',destination:'LOCAL_OBSERVATION_JOURNAL_ONLY',
rawContentPersisted:false,networkEgress:false,learningInfluence:false.
IDs use journal grammar1..128. Digest must equal preview.sha256.
Times safe nonnegative integers excluding -0; expiresAt>issuedAt and interval<=1h;
retention1..90d; createdAt+retention safe. Source mismatch -> SOURCE_DIGEST_MISMATCH;
bad structure/scalars -> INVALID_INPUT. Copy declaration before callbacks.
Declaration digest = SHA256('nisi/repository-history-declaration/v1\0'+stableStringify(copy)).

Validate actual owner with inspectJournalOwner success **SNAPSHOT**, not INSPECTED.
Bad handle -> INVALID_OWNER; SEALED -> OWNER_SEALED; uncertain -> COMMIT_UNCERTAIN.
Inspection is read-only and not a record attempt; config is not exposed, so a
wrong-project owner cannot be reliably rejected until record: that attempt consumes.

Claim busy BEFORE any clock callback. Call clock twice: initial validation and
again immediately before admission, with no callback between final check and
record. Safe nondecreasing time required; errors -> INVALID_CLOCK, before issue ->
NOT_YET_VALID, now>=expiresAt -> DECLARATION_EXPIRED, createdAt>now ->
OBSERVATION_IN_FUTURE, now>=createdAt+retention -> OBSERVATION_EXPIRED.
All such pre-admission failures are non-consuming. Reentrant capture in clock -> BUSY.
After final valid time set consumed=true BEFORE calling recordJournalObservation.
Every actual record call consumes, including REFUSED, DUPLICATE, CONFLICT,
precommit failure and uncertainty. FS callback reentry -> ALREADY_CAPTURED.
Finally release busy. No reusable grant/revoke API, automatic retry or clock timer.
Revocation of an already stored observation uses the separate journal lifecycle;
this synchronous admission cannot be cancelled or undone by a late callback.

Entry:
id='rh1.'+SHA256('nisi/repository-history-id/v1\0'+preview.sha256)
projectId from declaration, runId from preview, attempt from preview,
candidateId namespace above, stage:'REPOSITORY_SETTLEMENT',receiptId:null,
createdAt/ttlMs from declaration,heartbeatAt:null,retryOf:null,revokes:null.
state CANCELLED if final outcome CANCELLED; SUCCEEDED only when final outcome
COMPLETED AND hostState SETTLED; otherwise FAILED (run-level operational state,
NOT model/candidate failure). Payload exactly {preview,sourceDigest,declarationDigest}.

Map journal outcomes without altering them:
RECORDED->STORED; DUPLICATE->DUPLICATE; CONFLICT/STORE_CONFLICT->CONFLICT;
REFUSED->REFUSED; STORE_FAILED with snapshot COMMIT_UNCERTAIN->UNCERTAIN;
other STORE_FAILED with a valid OPEN/SEALED snapshot->STORE_FAILED. Preserve
reason and exact known journal result, which contains only journal-redacted entries.
Unknown result/throw after admission or STORE_FAILED with missing/unknown snapshot
state -> UNCERTAIN INTERNAL_ERROR with recordAttempted/consumed true and journal:null;
do not echo malformed dependency output or imply rollback. Before-admission internal
errors remain REFUSED INTERNAL_ERROR. This revises the original REFUSED-after-entry
wording following source review; the original FAIL review remains retained.
No redundant durable boolean: consumers inspect actual journal.store evidence.
Never update report.reportStored, host state, proposal or original settled result.

## Acceptance

Independent tests before implementation, through actual workflow owner wherever
possible, not only helper units. Pending-drain, candidate-less/blocked, quarantined,
completed, cancellation/timeouts; strict input/owner/digest/clock/copy/reentry;
one admitted attempt across all write outcomes; raw-data canaries absent; exact
preview/digest/metadata; real filesystem capture and fresh-process reopen.
Retain stub-red, targeted green, relocated positive control and semantic mutants.
Revalidate previous240 pins with only deliberate host change; new module/tests
are additional pins. Run full portable npm check. Native combined-host acceptance
is separate; no new Swift launch is implied by portable seam tests.
