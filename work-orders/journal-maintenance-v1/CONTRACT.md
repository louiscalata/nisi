# Durable journal maintenance and revocation

**Overall Nisi: 30% (3/10 NX milestones). Status: accepted in explicit lifecycle scope.**
See [work-order roadmap](roadmap.md) for exact verification and remaining boundaries.
This advances NX-05/U02-04's real history lifecycle, not a new log formatter.

## Required implementation

Add `maintainJournalOwner({owner, now})` to the existing canonical
`history/journal-owner-v2.mjs`, sharing its private registry and busy guard.
Keep the run-journal-v1 and run-journal-store-v1 formats/source unchanged.
Existing open, inspect and record API behavior stays compatible. An additive
fourth export deliberately changes the old three-export baseline assertion.
Update the colocated `.d.mts` and independently verify type narrowing.

Input is an exact plain/null-prototype own-enumerable-data envelope with exactly
owner and now. No accessors, symbols, extra keys or fabricated handle. Invalid
envelope/time/owner -> REFUSED INVALID_INPUT with snapshot:null and store:null.
now is a nonnegative safe integer excluding -0. After recognizing a valid owner:
SEALED -> OWNER_SEALED; COMMIT_UNCERTAIN -> COMMIT_UNCERTAIN; busy -> OWNER_BUSY.
Those refusals preserve its existing snapshot and do no I/O.

On OPEN, claim the SAME busy flag used by recording; release in finally. Restore
private serialized bytes into a COMPLETE staged journal, then retain(now) and
list(now). A clock behind its watermark returns REFUSED TIME with the exact
previous owner snapshot and store:null. Unexpected pre-store preparation error
is STORE_FAILED PREPARATION_FAILED. Never mutate/publish staged state early.

Prepare serialized bytes, SHA-256 and a COMPLETE prospective snapshot with all
existing IDs, including tombstones. Enforce the existing 16MiB owner limit.
Call the unchanged writer even if no payload becomes newly expired in this
invocation: open() may already have pruned privately without updating disk.
The store must check actual previous disk bytes before saying UNCHANGED; do not
short-circuit solely on state.serialized. Empty NEW owners may persist a header
and footer. No synthetic observation is appended just to force persistence.

`UNCHANGED` is normally a repeat at the same watermark; a later time changes
serialized header bytes even if no row expires. A backward time is refused, not
an unchanged success. For a NEW owner, the unchanged existing store refuses a
different file that appears before writing; an exact identical valid file can
yield verified UNCHANGED without clobbering it. The final pre-rename check still
guards cooperative drift, not an adversarial multi-process atomic-CAS guarantee.

## Shared write publication boundary

Refactor only the private prepare/store/validate/publish sequence so record and
maintenance share the existing byte limit, expected previous disk hash, frozen
closed store-response validation and uncertainty handling. Record still returns
its original envelope/statuses, including RECORDED for a verified unchanged store.
Do not leak a mutable journal, owner state, filesystem adapter or path.

Maintenance's exact frozen output has seven fields:

```
{
  schemaVersion: 'nisi-journal-maintenance/v1',
  status, reason, store, snapshot,
  meaning: 'HISTORY_OBSERVATIONS_ONLY',
  authorizing: false
}
```

| Store or staging outcome | Maintenance result |
| --- | --- |
| Valid WRITTEN | MAINTAINED, reason:null; publish the prepared snapshot |
| Valid UNCHANGED | UNCHANGED, reason:null; publish the verified snapshot |
| Precommit CONFLICT | STORE_CONFLICT; preserve prior snapshot |
| Other coherent precommit refusal | STORE_FAILED; preserve prior snapshot |
| Committed refusal | STORE_FAILED; clear/quarantine COMMIT_UNCERTAIN |
| Invalid or throwing response after entering store | STORE_FAILED STORE_RESPONSE_INVALID; clear/quarantine COMMIT_UNCERTAIN |
| Too large before store | STORE_FAILED SIZE_LIMIT; preserve prior snapshot |

Representable rejected store values may be retained as untrusted frozen plain
data, just as record does today. In all failures store may be null. Success alone
permits treating store as validated WRITTEN/UNCHANGED data. UNCHANGED does not
claim fresh fsync or durable commit. Verified WRITTEN with missing/failed fsync
remains truthful non-durable MAINTAINED, not a durability claim.

## Durable revocation without a redundant API

Use existing recordJournalObservation with an exact REVOKED entry. Its `revokes`
must name a prior row, `retryOf` must be null, and runId/attempt/candidateId and
timestamps must satisfy the unchanged run journal. Prove actual persisted reopen,
duplicate replay, conflicting input and failed/uncertain write handling.
Revocation changes liveness and preserves the target's payload until its TTL or
capacity policy removes it; this does not authenticate who requested revocation.
After maintenance, the current serialized journal must omit expired payload data
while preserving every ID, fingerprint and revocation relation.

## Boundaries and acceptance

No live stores, automatic sweeper, filesystem scans, native execution, external
model calls from product code, secure erasure claim, policy promotion or release.
Payload removal applies to newly written current journal bytes, not snapshots,
backups, SSD remnants or previously returned immutable objects. No persistent
schedule is introduced. Explicit future UI wiring and retention authorization
remain separate. All observations remain authorizing:false.

Independent tests must precede implementation with a finite stub-red result.
Cover new/empty, just-before/at TTL, opening already-expired data, same-time repeat,
nonadvancing/invalid time, forged handle, malformed envelopes, redaction, identity
conservation, busy/reentrant record/maintenance, stale owner, precommit failure,
postcommit uncertainty/reconciliation and non-durable fsync outcomes. Add a real
filesystem + fresh-process lifecycle test, and semantic single-site mutants.
All existing owner/history tests must continue passing; only the deliberate export
list and reviewed owner source pin may change in those baseline/store fixtures.
