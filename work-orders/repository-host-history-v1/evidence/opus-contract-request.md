# Private bounded coauthor request: actual repository host history

Design critique only, tools disabled. No repository access. The following current
source facts are supplied; do not claim to inspect paths or execute tests. Return
a concrete contract recommendation under 6500 characters, with at most five
risks and explicit corrections. Do not write production code yet.

Objective: wire the VERIFIED current journal owner into the existing reviewed
repository workflow host, not another unused wrapper. All private. No publication,
native launch, live-store mutation, model call from product code, automated learning,
authenticated consent, secure erasure, background timer or rollback guarantees.

Current actual host `hosts/repository/reviewed-workflow-v1.mjs`:
- public createReviewedRepositoryHostV1 creates static/test owners then calls
  createRepositoryWorkflowOwnerV1; latter is trusted dependency seam, not attestation.
- returned frozen API currently {run, settled, status, invocations, lateObservations}.
- run is one-shot; invokes real runWorkflow, returns immutable engine report early.
- settlement waits Promise.allSettled of BOTH static and test owner drains, then
  retains their independent histories/errors/status, derives a repository bundle
  using issued plans/executions. It returns a frozen host result even on most
  quarantined/error outcomes. An unexpected collect throw rejects settled.
- report identity fields: schemaVersion1, UUID runId (null on preflight-invalid
  reports), taskFingerprint64hex, nullable candidateFingerprint64hex,
  repairAttempts0..100, outcome/workflowOutcome enums, nullable codes,
  stages array. report also includes candidate source/evidence; MUST NOT persist
  those wholesale. Existing readFinalEngineReportV2 requires UUID and fully validates
  the report; invalid reports must explicitly refuse history, not be coerced.
- settlement has state SETTLED|QUARANTINED; ownerStates staticChecks/tests in
  IDLE|BUSY|QUARANTINED|UNKNOWN; bundleSummary null or consistency summary with
  fingerprint/reportSha256. It has invocations/histories containing paths/output;
  DO NOT copy them. Source execution is not attested even if internally consistent.
- preparation taskFingerprint and baselineFingerprint are available at host creation.

Journal owner v2 (unchanged dependency for this task):
inspectJournalOwner({owner}) returns frozen {schemaVersion,status:'INSPECTED',snapshot,
 authorizing:false} or REFUSED. Snapshot has state OPEN|SEALED|COMMIT_UNCERTAIN,
 recovery,sha256,bytes,entries,interrupted,meaning,authorizing:false (NO config).
recordJournalObservation({owner,entry,now}) validates exact entry, writes bounded
serialized bytes, returns frozen status RECORDED|DUPLICATE|CONFLICT|STORE_CONFLICT|
STORE_FAILED|REFUSED,reason,store,snapshot,authorizing:false. Store failures can be
precommit or COMMIT_UNCERTAIN. Returns only journal-redacted snapshot.
Entry exact fields {id,projectId,runId,attempt,candidateId,stage,receiptId,createdAt,
 ttlMs,state,heartbeatAt,retryOf,revokes,payload}. IDs require1..128 chars of
[A-Za-z0-9_.:-] with alphanumeric first. candidateId non-null; receiptId nullable.
states QUEUED,RUNNING,SUCCEEDED,FAILED,CANCELLED,REVOKED; payload can be null/plain.
time safe integer >=0 not -0, ttl>=1, createdAt+ttl safe, entry createdAt <= now.
Current owner detects project mismatch and duplicate/conflict, verifies disk,
reports non-durable WRITTEN honestly and quarantines uncertain commits.
Existing fixed-XPC source permit is format-specific, not reusable for repo results.

Proposed integration:
1. Two additive methods on real host: historyPreview() and captureHistory(input).
   Existing run/settled outputs and behavior stay unchanged. Store privately the
   exact collected result; methods refuse until that result exists, including when
   engine report already returned but drain is pending, and on collect rejection.
2. Preview is deterministic deeply frozen fixed-size metadata and SHA256 (domain
   separated canonical encoding); no raw source, paths, messages, invocation lists,
   prompts, model text, arbitrary findings or timings. Include host task/baseline,
   final run/attempt/candidate, engine outcomes/codes, owner states, bounded stage
   status counts, explicit diagnostic codes, optional bundle fingerprint; flags
   sourceAuthenticityAttested/executionAttested/learningEligible/authorizing false.
   Invalid report, wrong task identity, malformed scalar/known schema -> REFUSED.
   A candidate-less early refusal: prefer refusing capture explicitly unless a
   truthful non-fabricated nullable-ID mapping exists; do not invent candidate.
   A valid QUARANTINED result should remain an operational observation, not vanish.
3. captureHistory takes exact own-enumerable-data {owner,declaration,clock}; copy
   declaration before any injected callback. Declaration schema distinct repo-v1,
   id/projectId, sourceDigest EXACT preview, issuedAt/expiresAt, createdAt/retentionMs,
   destination LOCAL_OBSERVATION_JOURNAL_ONLY, consentClass WRITTEN_DECLARATION,
   rawContentPersisted/networkEgress/learningInfluence false. Lifetime<=1h,
   retention<=90d, input timestamps safe. Clock trusted; recheck before admission.
4. At most one actual journal call per host history admission, shared private
   consumed/busy state. Bad schema/digest/owner refusal does not consume; admitted
   write DOES consume even duplicate/conflict/failure. Reentrant calls must refuse.
   Needs a concrete revocation route: add revokeHistory() before admission? Or
   keep this an explicit one-shot immediate post-settlement call with NO reusable
   grant (preferred smaller honest API), and state no cancel after synchronous
   admission. Do not imply a protected UI or authenticated permission.
5. ID deterministically binds host run, candidate, source preview; no new failure
   occurrence on repeated read. Entry payload only preview+declaration digest;
   exact result contains journal-redacted outcome, never raw attempted payload on
   refusal. No update to original engine report.reportStored; that field concerns
   a different pre-final reportStore stage.

Please resolve the candidate-null representation, diagnostic code bounds (codes
may be arbitrary text from adapters in final report; hash/drop versus refusing
the entire operational observation), revocation/one-shot semantics, and returned
state mapping without claiming model failure from host/store/infrastructure errors.
The feature should materially integrate real workflow history, not upgrade
observations into native incidents or hide inconvenient outcomes.
