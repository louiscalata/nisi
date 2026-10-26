# Journal owner v2 — private correction contract

Status: OWNER-ADJUDICATED CONTRACT; implementation acceptance pending. Overall Nisi progress: 30% (3/10).
This explicitly versioned successor addresses four reproduced host-bundle defects.
Do not edit canonical history/host-journal-bundle.mjs or Claude's v1 work order.
The v1 shape remains historical; the new opaque-owner API is not a drop-in silent change.
It composes the unchanged journal/store v1 formats; it does not invent another disk format.

## Scope and purpose

Reliable single-owner observation persistence for NX-05. Accept journal entries,
including the current fixed-XPC observation projector output; do not treat the
older five-canary summary and actual current runner record as interchangeable.
No native launch, permission grant, incident admission, policy influence, cross-process
lock, crash/power-loss guarantee, exactly-once execution or public release.

Only implementation target src/index.mjs. Allowed imports:
node:crypto, ./run-journal-v1.mjs (createRunJournal,reopen),
./run-journal-store-v1.mjs (writeSerializedJournal).
Dependencies are exact frozen copies. No hidden IO: only injected trusted synchronous
fs methods are called. No timers, processes, network or automatic retries.

## API / exact outer shapes

Exports exactly openJournalOwner, inspectJournalOwner, recordJournalObservation.
All returned values carry schemaVersion:'nisi-journal-owner/v2', authorizing:false.
Input object key sets are exact own enumerable string data properties. Reject
accessors, hidden/symbol keys, arrays, exotic prototypes and missing/extra fields.
Plain Object.prototype and null-prototype envelopes are both supported.
Do not invoke property getters to validate these request envelopes. JS proxy traps
and injected fs implementations are outside the security guarantee.

openJournalOwner({path,fs,config,now})
- path nonempty well-formed string without NUL.
- fs trusted object with readFileSync,openSync,writeSync,closeSync,renameSync,unlinkSync
  functions; fsyncSync optional (absence/non-success means not durable).
- config exactly the unchanged journal config; validate via createRunJournal and retain
  a canonical private copy of projectId,maxEntries,heartbeatTtlMs,redactPaths.
- now a nonnegative safe integer, never -0.
- Refusal exact {schemaVersion,status:'REFUSED',reason,authorizing:false}.
- Success exact {schemaVersion,status:'OPENED',owner,snapshot,authorizing:false}.
- owner is an empty, frozen, unique object registered in a private WeakMap.
  Copied/JSON-roundtripped/manufactured handles never access state.
- snapshot is a deeply frozen value, with no journal API or fs/path/config exposed.

inspectJournalOwner({owner})
- Exact {schemaVersion,status:'SNAPSHOT',snapshot,authorizing:false}, or refusal
  INVALID_INPUT for envelope/handle mismatch.
- Snapshot describes the latest accepted in-memory publication, not a fresh disk read
  or live process observation. Inspection is nonmutating and does not advance time.
- Repeated inspection may return the same immutable snapshot reference.

recordJournalObservation({owner,entry,now})
- Validate request/handle and safe now; malformed outer input -> REFUSED INVALID_INPUT.
- Sealed owner -> REFUSED OWNER_SEALED; uncertainty owner -> REFUSED COMMIT_UNCERTAIN.
- Reentrant record while a write is pending -> REFUSED OWNER_BUSY, with no extra FS IO.
- Entry admission uses the unchanged journal append validation (project, exact entry
  schema, monotonic time, redaction, duplicate/conflict rules). Catch errors and
  return their string code; no exception should escape for admitted request envelopes.
- Record result exact {schemaVersion,status,reason,entryId,append,store,snapshot,authorizing:false}.
  status in RECORDED,DUPLICATE,CONFLICT,REFUSED,STORE_CONFLICT,STORE_FAILED.
  reason null unless refusal/conflict; entryId null if unavailable; append is frozen
  actual staged append response or null; store frozen actual store response or null.
- For invalid envelope/handle/time, use the simple refusal shape (as open).
- OWNER_SEALED, COMMIT_UNCERTAIN and OWNER_BUSY also use that simple refusal shape.
- Source entry is never used for execution or classified as independently verified.
  SUCCEEDED in an observation is not a product/task correctness certificate.

## Snapshot

Exact keys schemaVersion, state, recovery, sha256, bytes, entries, interrupted,
meaning, authorizing.
- state OPEN | SEALED | COMMIT_UNCERTAIN.
- recovery exact {status,recoveredIds,rejectedLine,reason,authorizing:false}.
  statuses NEW | COMPLETE | INCOMPLETE | INVALID | COMMIT_UNCERTAIN.
  Original reopen diagnostics preserved. NEW:[],null,null.
- sha256 and bytes are the last accepted serialized observation or null.
  NEW uses sha256:null,bytes:0; SEALED or COMMIT_UNCERTAIN uses both null.
- entries are the unchanged journal's list(now) snapshots, copied and deeply frozen.
- interrupted contains {id,runId,attempt,stage,liveness,heartbeatAt,createdAt}
  for entries RUNNING with liveness UNKNOWN, neither revoked nor expired.
- meaning:'HISTORY_OBSERVATIONS_ONLY'. authorizing:false always.

## Opening: strict bytes, project/config binding, damaged prefixes

Read the path once using fs.readFileSync. ENOENT -> NEW owner; other read exception
or non-Buffer -> REFUSED READ_FAILED. Copy raw bytes before processing.
Maximum serialized UTF-8 byte count is 16 MiB: larger -> REFUSED SIZE_LIMIT.
This limit is checked after capture, so it is not a bound on initial fs allocation.

Require Buffer.from(raw.toString('utf8'),'utf8').equals(raw). Otherwise refuse
INVALID_UTF8 with no owner, prefix rows or recovered IDs; no replacement decoding.
Call reopen only after that guard. If reopen returns no journal -> REFUSED INVALID_JOURNAL.
Whenever reopen returns a journal (COMPLETE,INCOMPLETE or INVALID), parse the already
validated header and compare expected project before exposing any rows or IDs:
wrong project -> PROJECT_MISMATCH. Other persisted config difference -> CONFIG_MISMATCH
(canonical compare, including ordered redactPaths) to prevent policy drift.
now earlier than persisted journal watermark -> CLOCK_BEHIND_JOURNAL, not INVALID_INPUT.
The watermark is the validated persisted header's `now`; the API does not expose it.
All four config fields are actually persisted by the frozen journal, and ordered
redactPaths are preserved. Compare canonical JSON of the validated persisted config
with the header config from createRunJournal(config).serialize(), not caller objects.
After input validation, open precedence is read, size, UTF-8, invalid journal, project,
config, clock. Call list(now) once on the reopened journal, including a sealed prefix
for display only. It can discard expired payloads but does not erase recovered IDs.
Record at a time below the accepted memory watermark returns the journal's TIME code.
COMPLETE -> OPEN, hash exact raw bytes, bytes raw length, keep journal serialization
after list(now) as the accepted memory staging basis (disk CAS hash remains raw hash).
INCOMPLETE/INVALID with validated matching header -> SEALED; expose only verified
prefix through frozen snapshot, keep original diagnostic, no appends or writes.

## Staging and write outcome

Never expose the mutable journal instance or CAS digest as writable authority.
All mutable state, owner phase and predecessor hash live only in the WeakMap.
Stage every record against a separate journal reconstructed from last accepted memory
serialization (or new journal for a NEW owner). Live owner stays unchanged until outcome.
Reconstruction can mark prior rows historical; this is reconstruction, not execution proof.

Append REFUSED/DUPLICATE/CONFLICT returns that actual result without storage;
do not publish staged mutation/time/pruning. Duplicate returns original accepted snapshot.
For APPENDED, call staged list(now) once, serialize after listing, enforce the 16 MiB
cap, and prepare the immutable success publication before calling the unchanged store.
Append/store results are copied as strict plain data and deeply frozen; never share
mutable response objects. Do not silently drop accessors, fields or functions, or invent
a Buffer representation. The pinned journal/store emit plain JSON-compatible data;
an unexpected/unrepresentable store response is STORE_RESPONSE_INVALID and uncertain.
Use only the private prior raw-disk digest as expectedPreviousSha256; never caller mirrors.
For a NEW owner pass no expected digest: the unchanged store refuses a different existing
file rather than overwriting it. No loop retries and no automatic reopen on conflict.

WRITTEN/UNCHANGED -> RECORDED, publish the prepared staged snapshot, interrupted derived consistently,
new stored digest/byte count, recovery COMPLETE and recoveredIds from accepted entries.
Durability flags remain exactly as returned; UNCHANGED is not new fsync proof.
Validate the actual store response's known status, boolean committed/durable/verified,
fsync diagnostics, and exact staged digest/byte count before success. WRITTEN is
committed:true; UNCHANGED is committed:false. Identical first writes from two NEW
owners may return UNCHANGED; different bytes conflict. Only a refusal whose reason is
CONFLICT maps to STORE_CONFLICT, not every NEW-owner refusal.
Before rename (committed:false) refusal -> STORE_CONFLICT for CONFLICT else STORE_FAILED;
preserve old live snapshot/serialized state/hash exactly. No stale live mutation to undo.
After rename (committed:true) refusal -> STORE_FAILED with original diagnostic;
seal as COMMIT_UNCERTAIN, clear entries/interrupted/recoveredIds and current hash/bytes,
rejectedLine:null, recovery.reason=store.reason. Reject all future records for that owner.
Previously returned frozen snapshots remain historical values, not current disk claims.
Only a NEW open call can reconcile current actual bytes, yielding old/new/sealed/refused;
never assume either rollback or success after commit uncertainty.
Unexpected exception while invoking write store -> COMMIT_UNCERTAIN too unless proven
pre-store, because commit stage cannot be safely inferred from the thrown error.
Define pre-store structurally: local storeEntered=false until it is set true as the
last statement before writeSerializedJournal. Never infer this boundary from an error
message. A pre-store preparation failure returns STORE_FAILED without changing live
state; an append validation error returns REFUSED with its journal code. Any exception
after storeEntered, or malformed response, clears the authoritative state and seals it
before constructing the outward result. A prebuilt cleared uncertainty snapshot is a
fallback if diagnostic construction itself fails. Out-of-memory/global intrinsic
tampering are not guarantees of this JavaScript API.
Always clear internal busy flag in finally; no exception leaves phantom running state.

## Required evidence

Original four fault paths must be rejected/reconciled in successor tests:
1. Post-rename mismatch AND exception -> no stale old-state publication; fresh reopen.
2. Wrong-project COMPLETE, INCOMPLETE and INVALID prefix all refused before exposure.
3. Bad UTF-8 suffix after valid prefix refused without recovering a lossy row.
4. Public-handle/snapshot attempts cannot replace journal, hash or status or erase an
   intervening writer; genuine stale owner detects STORE_CONFLICT.
Also: NEW and COMPLETE writes, exact replay/conflict, expiry/pruning on failed write,
non-durable store success, config mismatch, lower clock, reentrancy and getter traps.
Retain baseline/source hashes and targeted mutants; no existing tests weakened.
Add real temporary-filesystem and fresh-process recovery evidence, without native app
execution. Connect one current fixed-XPC projected entry to this owner in a test.
Final integration of a successor is a separate explicit owner action, not copying over v1.
