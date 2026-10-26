# Selected repository incident observations — private contract

Status: scoped implementation accepted; native/learning integration open.
Overall Nisi 30% (3/10 NX milestones). See this work order's roadmap for evidence.

## Integration and trust

New `history/repository-incident-capture-v1.mjs` exports
`createRepositoryIncidentAccessV1({getPreview})` and
`queryRepositoryIncidentV1({path,fs,config,entryId,now})`.
Factory returns frozen `{createPermit,capture,revoke}`. getPreview is a captured
trusted-host callback, not user/model data. The existing projector adds a WeakSet
predicate `isIssuedRepositoryIncidentPreviewV1(value)` without changing preview
bytes, status, fields or hashes. Only a branded original preview is accepted.
Cloned/serialized rows or previews cannot create permits.

Real host adds `createIncidentPermit`, `captureIncident`, `revokeIncidentPermit`
backed by one access instance and its existing cached incidentPreview. Existing
run/history/proposal/preview semantics remain unchanged. No native code/imported
schemas, automatic model calls, background storage or learning are added.

## Permit declaration and creation

`createPermit({owner,declaration,clock})`, exact data fields only.
Declaration exact15 fields:
schemaVersion=`nisi-repository-incident-declaration/v1`, declarationId,
projectId=`task:<taskFingerprint>`, rowId,rowFingerprint,previewSha256,
issuedAt,expiresAt,createdAt,retentionMs,
consentClass=`WRITTEN_DECLARATION`, destination=`LOCAL_INCIDENT_OBSERVATION_ONLY`,
rawContentPersisted=false, networkEgress=false, learningInfluence=false.
This task namespace is NOT authenticated filesystem-project identity.
Safe nonnegative integer times excluding -0; expiresAt>issuedAt, span<=1hour;
retention1..90days, safe createdAt+retention. Nonempty bounded IDs per journal;
all digests lowercase64hex. No owner/disk write during permit creation.

Select declaration.rowId from original PREVIEW. Match fingerprint/preview SHA;
require row FAILURE_CANDIDATE/RECORDED_FAILURE with raw and stage FAIL,
RESULT_RECORDED, nonnull receipt hash. Never admit PASS or operational rows.
Row scope derives projectId; owner project mismatch is finally enforced by the
journal append, not inferred from cached entries. Refuse unknown/sealed/uncertain
owners. Claim access-level busy before callbacks. Validate clock, capture private
owner/declaration/row/preview/clock in WeakMap, release busy in finally.

Permit result exact:
{schemaVersion:`nisi-repository-incident-permit/v1`,status:CREATED|REFUSED|REVOKED,
reason,permit:null|opaqueHandle,declarationDigest:null|hex,consumed:boolean,
authorizing:false}. Refusals use closed reason codes; no raw exceptions.
Created consumed=false. Handles are bound to this access instance.

## Capture and revocation

`capture({permit})` and `revoke({permit})` exact fields.
Refuse unknown/cross-access handles. A Set prevents more than one admitted record
attempt per row in the host even when multiple permits were created. Consumed
row/permit precedes revoked/busy; no automatic retry, even on refusal/failure.
Claim busy before clock callback. Revalidate original preview identity and exact
selected row, then check a monotonic clock again after preparing the entry.
At each clock check: revoked wins, then clock validity/backward movement,
not-yet-valid, permit expiry, future observation, retention expiry. Invalid time
permanently revokes that permit. Revoke is allowed during a clock callback.
Set permit.consumed and add rowId to consumed set immediately BEFORE calling
recordJournalObservation. Post-admission revocation cannot undo a write; return
the exact actual journal outcome. A repeated capture has recordAttempted=false
but consumed=true. Other permits for the consumed row also refuse.

Capture result exact:
{schemaVersion:`nisi-repository-incident-capture/v1`,status,reason,
entryId:null|id,rowId:null|hex,declarationDigest:null|hex,
recordAttempted:boolean,consumed:boolean,journal:null|actualResult,
learningEligible:false,authorizing:false}.
Map RECORDED→STORED, DUPLICATE→DUPLICATE, CONFLICT/STORE_CONFLICT→CONFLICT,
REFUSED→REFUSED, STORE_FAILED→UNCERTAIN iff snapshot COMMIT_UNCERTAIN else
STORE_FAILED. Unexpected throw/malformed result after admission→UNCERTAIN /
INTERNAL_ERROR with journal:null. Never fabricate a failed write as no attempt.
Do not upgrade the underlying store.durable false or cached DUPLICATE.
For a NEW owner, exact byte-identical existing storage can also return
store UNCHANGED and owner RECORDED: capture preserves STORED with the actual
store.durable=false rather than claiming a fresh physical write or fsync.
The journal's disk-base comparisons are optimistic checks around a rename, NOT
an atomic cross-process compare-and-swap or lock. Use a task-owned single-writer
journal; concurrent-writer/crash qualification remains open at NX-05.

## Stored entry

H(domain,value)=sha256(domain+NUL+stableStringify(value)).
entry.id=`ric1.`+H(`nisi/repository-incident-entry-id/v1`,{projectId,rowId});
EXCLUDE rowFingerprint/declaration/time from ID so changed content conflicts.
Entry fields: projectId, runId/attempt from row, candidateId=`cand:<fingerprint>`,
stage=`REPOSITORY_INCIDENT_CANDIDATE_V1`,receiptId=`rcpt:<receiptSha256>`,
createdAt/ttlMs from declaration,state=FAILED,heartbeatAt/retryOf/revokes=null.
Payload exact:
{schemaVersion:`nisi-repository-incident-observation/v1`,row,previewSha256,
declarationDigest,consentClass:`WRITTEN_DECLARATION`,
consentAuthenticityAttested:false,sourceAuthenticityAttested:false,
executionAttested:false,nativeIncidentCaptured:false,learningEligible:false,
authorizing:false}.
Declaration digest domain `nisi/repository-incident-declaration/v1`.
This separately admitted envelope quotes original metadata; bare row's
persistable:false remains unchanged and is not a storage grant. No raw code,
paths, prompts, messages or process output added. Hashes are NOT anonymization.
Exact replay at the journal layer is DUPLICATE; changed declaration or row body
under same entryId is CONFLICT. Same-host repeated admission is refused earlier.

## Fresh query

Read-only query validates exact input then calls openJournalOwner itself EVERY
time. No caller-supplied snapshot/owner stands in for current disk read. Require
OPEN snapshot; reject corrupt/sealed/uncertain recovery. Require entryId matches
`ric1.<64hex>`, config.projectId task namespace, safe now. Missing entry→MISSING.
Verify entry top-level stage/project/state/run/attempt/candidate/receipt binding.
For an existing tombstone: REVOKED before EXPIRED before NOT_RETAINED; return
observation:null without requiring the pruned payload. Otherwise validate exact
payload/row schemas, allowed fixed codes, hashes, IDs, flags and row fingerprint
(shape/consistency only, not renewed original issuance). Select only original
failure-candidate shape. Entry ID recomputes using stored project/rowId.
Return AVAILABLE_OBSERVATION with frozen payload only if still retained,
unrevoked and unexpired at the supplied now. No write, maintenance or sweeper.

Query result exact:
{schemaVersion:`nisi-repository-incident-query/v1`,status,reason,
entryId:null|id,journalSha256:null|hex,observation:null|payload,
sourceTrust:`PERSISTED_UNAUTHENTICATED_OBSERVATION`,learningEligible:false,
authorizing:false}. Status AVAILABLE_OBSERVATION|REVOKED|EXPIRED|NOT_RETAINED|
MISSING|REFUSED; reason null for regular statuses, closed error code for refusal.
The observation is current only at that read/time, not a later authorization.
Do not claim automatic secure deletion or universal crash durability.

## Verification and next boundary

Original issued actual-host fixture, storage opt-in, nonfailure/mismatch/crosshost
refusals; expiry boundaries/revocation/reentrancy/one-row multiple permits;
IO/commit uncertainty and disk conflict, exact duplicate vs changed identity;
fresh query after external revocation, expiry, pruning, corrupt/tampered payload,
project mismatch; actual filesystem store and independent child-process reopen.
All existing journal/native semantics stay unchanged. Full portable suite and
targeted semantic fault variants; no runtime-only credit. Next native transport
must reconstruct/rerun its own inputs before native ledger admission. This
source-checkout task does not close NX-05 or authorize learned policy influence.
