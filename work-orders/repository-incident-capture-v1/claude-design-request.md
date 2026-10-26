# Private Nisi — selected incident storage design

Tool-disabled coauthor, no tests executed. Opus is the retained available route
after Fable credit unavailability in this task. Review this concrete proposal,
give <=5 material corrections plus boundary test recommendations. No native or
publication claims. Codex owns implementation and integration.

Existing host produces a frozen original-issued source-bound incidentPreview()
after settlement. Rows have rowId (hash binding), fingerprint (hash whole row),
occurrenceGroupId, binding(run/task/baseline/attempt/stage/candidate/checkIndex),
source(report/bundle/profile/preparation/materialized/receipt/evidence hashes),
subject(FILE path/content hashes or MATERIALIZED_TREE null path/content), fixed
failureCodes, classification/rawStatus/stageStatus/disposition. All row flags:
persistable/executionVerified/learningEligible/independentOccurrence/authorizing/
certificationGranted false; sourceTrust TRUSTED_HOST_STATEMENTS_NOT_ATTESTED.
Native v1 ledger cannot accept these records; it needs its own rerun. Do not edit
native imports or misrepresent Node observations as native PipelineResult.

Plan: original projector adds a WeakSet brand predicate without changing any
preview bytes/flags. New capture-access helper holds a callback to the host's
current preview. It only selects a branded preview row with classification
FAILURE_CANDIDATE, reason RECORDED_FAILURE, rawStatus/stageStatus FAIL and
RESULT_RECORDED. Caller cannot supply arbitrary row JSON or serialized preview.
Host exposes createIncidentPermit, captureIncident, revokeIncidentPermit over
one access instance. Every permit bound to exactly one original selected row,
preview hash, owner, written declaration, captured clock and that access instance.
Cross-host permit attempts refused. Permit creation no disk write.

New declaration exact fields:
schemaVersion nisi-repository-incident-declaration/v1, declarationId,
projectId (exactly task:<taskFingerprint>, a logical task namespace NOT a claim
of authenticated filesystem project identity), rowId,rowFingerprint,previewSha256,
issuedAt,expiresAt,createdAt,retentionMs,
consentClass WRITTEN_DECLARATION, destination LOCAL_INCIDENT_OBSERVATION_ONLY,
rawContentPersisted false,networkEgress false,learningInfluence false.
Times safe nonnegative integers no -0; expiry>issued, span<=1hour;
retention1..90days with safe addition; at least initial/final clock validation.
Opaque WeakMap permits; revoke before admission prevents write, after admission
cannot undo it. Busy before callbacks. Consumed before record dependency.
At most one admitted record attempt for each row in this host even if multiple
permits exist. Refusal/failure consumes admission; no automatic retry.

EntryID ric1.+H(domain,{projectId,rowId}) deliberately EXCLUDES fingerprint,
declaration and time: same logical row changed content must CONFLICT, not acquire
a new ID. Journal entry runId/attempt/candidateId/stage REPOSITORY_INCIDENT_CANDIDATE_V1
and state FAILED,receiptId derived from receipt hash, createdAt/ttl from declaration.
Separate versioned payload quotes original metadata-only row plus preview digest
and declaration digest, consentAuthenticityAttested/sourceAuthenticityAttested/
executionAttested/nativeIncidentCaptured/learningEligible/authorizing all false.
The bare preview's persistable:false remains: it is not storage permission. The
new separately permitted envelope is what gets stored; no v1 output widened.

Existing journal owner is opaque process-local state. inspectJournalOwner returns
cached snapshot only. recordJournalObservation stages then compare-and-swaps
actual disk base hash before commit; full record input digest gives DUPLICATE or
CONFLICT. Store WRITTEN may be durable false: never upgrade. Unexpected thrown
or malformed post-admission result maps UNCERTAIN, not REFUSED. Current source
owner is correct testedv2; we will NOT copy old fixed-XPC permit error bugs.

Fresh query takes path/fs/config/entryId/now, calls openJournalOwner itself on
EVERY query and validates the returned snapshot/payload/binding/digests. It does
not accept an old snapshot or owner as evidence of current disk. Match exact
task namespace; return AVAILABLE_OBSERVATION/REVOKED/EXPIRED/NOT_RETAINED/MISSING/
REFUSED with learning false. Expiry at boundary>=createdAt+ttl; revoked flag
precedes expired; tombstones retain identity but cannot disclose pruned payload.
No query writes, sweeper, secure-erasure or after-return freshness guarantees.
Serialized journal integrity does not authenticate record author or execution.

Question: hidden gaps in identity, one-use/reentrancy, freshness, metadata trust,
or mixing a source preview and explicit separate storage decision? Be concrete;
do not invent APIs or source fields beyond these supplied facts.
