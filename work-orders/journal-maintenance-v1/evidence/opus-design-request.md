# Bounded private Nisi coauthor task: durable journal lifecycle

Tools disabled. Do not read paths, browse, write files, or infer source not supplied.
Review the following next-step design and suggest at most five concrete corrections
and a compact implementation outline. We are continuing the full Veritas-to-Nisi
merger, specifically durable history retention/revocation. No public disclosure.

Current source inspected by Codex:
- journal-owner-v2 exposes openJournalOwner({path,fs,config,now}), inspectJournalOwner({owner}),
  recordJournalObservation({owner,entry,now}). Handles are frozen opaque WeakMap keys.
  Exact data envelopes; private state includes phase OPEN/SEALED/COMMIT_UNCERTAIN,
  busy, serialized, sha256 and immutable snapshot. Per-file synchronous host FS,
  not adversarial multi-process locking. All results authorizing:false.
- On open COMPLETE: reopen(original disk text); journal.list(now) prunes expired
  payloads and updates its watermark; state.serialized=journal.serialize() can
  therefore ALREADY differ from the actual disk bytes hashed in state.sha256.
  Inspection returns the captured snapshot, not a time-refreshing view.
- record stages by reopen(state.serialized), append(entry,now), list(now), serialize;
  computes prospective snapshot before entering store. Uses expectedPreviousSha256
  only when state.sha256 is non-null. Store validates exact file bytes/readback and
  tries file/directory fsync. On a committed failure or invalid/throwing result after
  store entry, state is sealed COMMIT_UNCERTAIN, serialized/hash cleared, entries=[];
  otherwise a precommit failure preserves the exact previous snapshot. Reopen is
  the existing explicit reconciliation mechanism. No auto retry.
- run-journal-v1 API has retain(now), list(now), append(entry,now), serialize().
  retain/list advance monotonic watermark and strip expired/capacity-exceeded
  payloads to null, retained:false. Identity metadata and original input fingerprints
  remain as tombstones. Serialization preserves that versioned format.
- Revocation already works by recordJournalObservation with a REVOKED entry whose
  revokes is a prior ID, retryOf:null, matching runId/attempt/candidateId and createdAt
  >= target.createdAt. The revoke target remains stored, is marked revoked:true and
  liveness:REVOKED; payload expires by TTL, not instant erasure. Old exact replay
  remains DUPLICATE; conflicting identity content remains CONFLICT.

Proposed useful change rather than a redundant revoke convenience wrapper:
1. Add maintainJournalOwner({owner,now}) to the EXISTING canonical owner. No new
   owner registry or changes to run-journal/store formats. Exact data envelope,
   same owner/busy/phase/time guards. Record method stays behavior-compatible.
2. Share a private staged-write publication helper with record, preserving its
   current uncertainty/refusal behavior. Maintenance reopens private serialized,
   calls retain(now), list(now), serializes, hashes, prepares prospective snapshot,
   and passes through that SAME validated store owner boundary. Do not compare only
   to state.serialized to conclude disk is current; open may have pruned in memory.
3. Return an exact frozen maintenance-specific envelope:
   schemaVersion:'nisi-journal-maintenance/v1', status, reason, store,
   snapshot, meaning:'HISTORY_OBSERVATIONS_ONLY', authorizing:false.
   Known statuses MAINTAINED, UNCHANGED, REFUSED, STORE_CONFLICT, STORE_FAILED.
   No fake deletion counters, no claim of secure disk erasure. store is null before
   store entry; snapshot is current owner's truthful publication when owner valid.
   Unknown/malformed handle returns snapshot:null. Quarantined owners remain refused.
   Even unchanged content should check actual disk CAS before returning UNCHANGED.
4. Store outcomes preserve existing semantics. A new empty owner's missing file
   may be written with header/footer to persist its clock; no automatic background
   sweeper, scanning, OS deletion, model call, auth/UI action, or remote work.
5. Prove existing REVOKED entries through actual disk owner, failed/uncertain writes,
   repeated input/conflict, fresh-process reopening, later explicit maintenance,
   expiration boundary and tombstone identity conservation. This establishes
   durable logical revocation and removal from current journal payload bytes,
   NOT authenticated revocation or secure erasure of backups/filesystem snapshots.

Questions: any incorrect assumption above? How to avoid regressing record output
schemas and ownership while sharing commit logic? Which adverse tests matter most?
Keep raw records, secrets, absolute personal paths and native incident data out of
your reply. Existing caller FS callbacks remain trusted host dependencies.
