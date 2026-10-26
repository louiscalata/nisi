# Confidential, bounded coauthor task — first observation-history consumer

You are a tool-disabled design reviewer. Do not claim file access or tests.
No browsing, publication, package installation, native execution or security changes.
Fable previously hit a same-task credit failure; reuse the working Opus fallback.

Objective: critique and tighten a SMALL, explicit private function that imports a
retained fixed-XPC record into the already-reviewed opaque journal owner v2.
Return at most five concrete contract requirements and a concise test plan. Do not
invent a new persistence engine. Keep scope to one synchronous consumer.

Existing source-bound APIs (not full source, so do not claim source review):

1. fixedXpcJournalObservation({serializedRecord,projectId,candidateId,receiptId,createdAt,ttlMs})
strictly parses a supplied serialized record string. Returns ENTRY with one
validated/redacted journal entry or REFUSED INVALID_INPUT/INVALID_RECORD. It has no
IO. Entry state SUCCEEDED means only an expected fixed engineering case was observed;
a structurally admitted INCONCLUSIVE runner record produces FAILED. Payload sets
authorizing/generatedCodeExecuted/nativeProductAccepted/sourceManifestVerified false.
Projected entry ID = runId + ':0:fixed-xpc'; stage fixed-xpc, attempt0, receipt ID from
host. Current API differs from an old five-canary format which must not be accepted.

2. openJournalOwner({path,fs,config,now}) -> REFUSED reason or OPENED with opaque
frozen empty owner and immutable snapshot. Reads trusted injected synchronous fs
once; ENOENT NEW. Strict UTF8, full project/config and watermark binding. Damaged
matching prefixes open as SEALED, not writable. Snapshot meanings observations only.

3. recordJournalObservation({owner,entry,now}) -> simple REFUSED INVALID_INPUT,
OWNER_SEALED,COMMIT_UNCERTAIN,OWNER_BUSY OR full result: status RECORDED,DUPLICATE,
CONFLICT,REFUSED,STORE_CONFLICT,STORE_FAILED; reason,append,store,snapshot. Non-RECORDED
status is never reported as newly persisted. Prior-digest conflict is not retried.
Postrename failure clears current snapshot and seals COMMIT_UNCERTAIN; only a NEW
explicit open reconciles actual disk. Store exposes committed,durable,verified.
Success without fsync is RECORDED but durable:false, no crash guarantee.

Proposed actual consumer source history/import-fixed-xpc-observation-v1.mjs:
export function importFixedXpcObservation({owner,serializedRecord,projectId,candidateId,
receiptId,createdAt,ttlMs,now})
- strict exact own enumerable data input envelope, plain/null prototype, no getters
- obtain inspectJournalOwner({owner}) first to validate opaque handle and phase;
  reject invalid, SEALED or COMMIT_UNCERTAIN before projection/storage
- projector receives host identity/time fields; use its actual entry unchanged
- call record once, no retries, never call open implicitly
- return immutable {schemaVersion:'nisi-fixed-xpc-history-import/v1',status,
  reason,projection,journal,authorizing:false,meaning:'HISTORY_OBSERVATIONS_ONLY'}
- statuses IMPORTED (only RECORDED), DUPLICATE (no new write), REFUSED (projection or
  validation/phase refusal), CONFLICT (entry or store), STORE_FAILED
- preserve original journal result with durability and uncertainty; do not promote
  sourceManifestVerified or claim task correctness/native launch.

The function does not read raw files itself or export arbitrary execution. A private
example will explicitly read a retained record with a cap and strict UTF8, explicitly
open a caller-selected history path and call this consumer, without any native runner.
Host remains responsible for choosing trusted project/path, consent and resource policy.
Do you see a reason to avoid inspect first, or simplify the return shape/statuses?
