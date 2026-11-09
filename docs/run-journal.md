# Run journal and store

Reference for the run journal and journal store APIs. Back to the [documentation index](README.md).

The **run journal** (`history/run-journal-v1.mjs`, import `nisi/history/run-journal`) is an append-only, hash-chained record of what a run observed. A host can write it, reopen it after a restart and check it before relying on its rows. The **journal store** (`history/run-journal-store-v1.mjs`, import `nisi/history/run-journal-store`) moves a serialized journal to and from disk through a caller-supplied `fs`.

To check a file that is already on disk, without printing its payload:

```bash
node bin/nisi.mjs validate --journal /absolute/path/to/journal.jsonl
```

`NISI_JOURNAL` is the same path when you omit `--journal`. A directory of `*.jsonl` journals and workflow-report `*.json` files uses `--data-dir` or `NISI_DATA_DIR`. In a source checkout, `scripts/validate-real-data.sh` wraps that command. `verified: true` in the summary is the store's chain check, not authenticity.

The workflow does not write journal entries for you. Your host does; see [Architecture](architecture.md#journal-boundary).

## Example

```js
import fs from 'node:fs';
import { createRunJournal, reopen } from 'nisi/history/run-journal';
import { readSerializedJournal, writeSerializedJournal } from 'nisi/history/run-journal-store';

const journal = createRunJournal({
  projectId: 'demo', maxEntries: 100, heartbeatTtlMs: 30_000,
  redactPaths: ['payload.apiKey'],
});
const now = Date.now();
journal.append({
  id: 'e1', projectId: 'demo', runId: 'r1', attempt: 0, candidateId: 'c1',
  stage: 'draft', receiptId: null, createdAt: now, ttlMs: 3_600_000,
  state: 'RUNNING', heartbeatAt: now, retryOf: null, revokes: null,
  payload: { apiKey: 'secret' },                 // stored as '[REDACTED]'
}, now);
journal.list(now)[0].liveness;                   // 'RUNNING'
writeSerializedJournal({ path: 'journal.jsonl', serialized: journal.serialize(now), fs });
const read = readSerializedJournal({ path: 'journal.jsonl', fs });
const { journal: again, report } = reopen(read.serialized);   // report.status is 'COMPLETE'
```

## How it works

1. `createRunJournal(config)` creates an empty journal for one project.
2. `append(entry, now)` validates an entry and adds it to the hash chain.
3. `list(now)` returns each entry with its liveness at `now`.
4. `retain(now)` retires entries past their TTL or past `maxEntries` and returns the IDs it retired.
5. `serialize(now)` produces canonical JSON lines: a header, a SHA-256 chain and a footer.
6. `writeSerializedJournal` and `readSerializedJournal` save and load those lines.
7. `reopen(serialized)` rebuilds the journal and returns a recovery report.

## Terms

- **Entry:** one record with fixed keys: `id`, `projectId`, `runId`, `attempt`, `candidateId`, `stage`, `receiptId`, `createdAt`, `ttlMs`, `state`, `heartbeatAt`, `retryOf`, `revokes` and `payload`.
- **State:** one of six values: `QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELLED` or `REVOKED`. Journal states are not workflow outcomes.
- **TTL:** `ttlMs`, the time in milliseconds after `createdAt` when the entry expires.
- **Heartbeat:** `heartbeatAt`, the last time a running entry reported that it was alive. `heartbeatTtlMs` in the config sets how old it may be.
- **Liveness:** what `list(now)` reports for each entry. It is `REVOKED` for a revocation entry or a revoked entry; the final state of a `SUCCEEDED`, `FAILED` or `CANCELLED` entry; `EXPIRED` for any other entry past its TTL; `UNKNOWN` for a `RUNNING` entry without a fresh heartbeat; otherwise `QUEUED` or `RUNNING`. Each view also reports `expired` separately.
- **Retired:** an entry whose payload was cleared (set to `null`) while its place in the chain stays. Entries past their TTL or past the configured `maxEntries` are retired.
- **Sealed:** a journal reopened from a damaged body. It refuses appends and cannot `serialize()`.
- **Authorizing:** journal views and recovery reports carry `authorizing: false`. They record observations and grant no authority.

## Rules

- **Validation.** `createRunJournal(config)` validates every entry (fixed keys, identifier formats, safe integers, a valid state), reports duplicate and conflicting re-appends, and refuses invalid retries, revocations and project mismatches.
- **Retries.** A retry must be queued, refer to an eligible earlier entry in the same run and increase its attempt. Terminal targets stay eligible, and hosts decide whether retrying a success makes sense. A second ID for the same retry target and attempt is refused with `RETRY_DUPLICATE`.
- **Redaction.** Redaction is applied by path before anything is stored: the value is replaced with `[REDACTED]` before fingerprinting, so changes only to redacted values compare as duplicates. The same value reachable through another unredacted path is stored there. A missing redaction path is ignored.
- **Retirement.** Retiring a payload clears it but keeps its place in the chain. Its fingerprint is recomputed from the stored entry with a null payload, so re-appending the original content conflicts with `ID_CONTENT_MISMATCH`. `reopen` rejects older pruned rows whose fingerprints cannot be recomputed from their stored entries.
- **Time.** `list`, `retain` and `serialize(now)` advance a time watermark and can permanently retire payloads, as do successful appends. Use one nondecreasing safe-integer millisecond clock; a future timestamp cannot be rolled back, even after reopen. `serialize()` without a time uses the last watermark, not wall time.
- **Reopen.** `reopen(serialized)` returns a recovery report with status `COMPLETE`, `INCOMPLETE` (truncated input) or `INVALID`. A missing or invalid header returns no journal. A valid header with a damaged body returns a sealed journal: `list()` and `retain()` still work, and `serialize()` throws `SEALED`. To move recovered rows, build a new journal and re-append them.

## Limits

- History is capped at 10,000 records. `REFUSED` with `HISTORY_LIMIT` applies to new IDs; duplicates and conflicts still resolve. Reopen rejects larger histories.
- An entry that is malformed, nested deeper than 64 levels, or larger than 1,000,000 copied values or 64 Mi UTF-16 units of copied strings makes `append` throw an error with code `ENTRY`. So does an entry dated after the `now` you pass.
- Project mismatches, a sealed journal, invalid retries and revocations, and the history cap are returned as `REFUSED` statuses instead of errors.
- There is no serialized-byte limit. Hosts rotate journals and bound input bytes themselves.
- The module imports only `node:crypto` and `node:util`.

## Store

- **Write.** A write validates the chain and goes through an exclusive temp file in the same directory. It syncs and reads back that file, renames it into place, syncs the directory and reads back the destination. A symlinked destination is refused with `SYMLINK` before the temp file is written and again before the rename, so the caller's `fs` must provide `lstatSync`.
- **Durability.** The store reports `committed` and `durable` separately. A write that landed without confirmed file and directory sync is never reported as durable. A read refuses truncated, non-canonical, malformed-UTF-8 or chain-broken files.
- **Temp files.** Each write attempt uses its own temporary file name, so an orphaned temp file from a stopped process does not block an identical retry.
- **Concurrent writers.** `expectedPreviousSha256` detects stale **sequential** writes. It is not an atomic guard for concurrent writers or a continuity check: a matching digest permits replacement with any valid journal, including an empty journal or another project. Use one writer per journal and serialize writes in the host.
- **Authenticity.** `verified: true` means internal format and hash consistency, not authenticity. The unkeyed chain and footer can be rewritten together, so detecting malicious replacement needs a trusted digest or authentication outside the journal.

## Recovery

The package has no recovery worker, and its exports are limited to the declared runtime modules (older deep imports may no longer resolve). After a restart a host calls `readSerializedJournal`, then `reopen`.

For damaged input the store returns `INVALID_JOURNAL` and refuses replacement with `EXISTING_INVALID`. The host can read the raw bytes and call `reopen` for sealed recovery when the header is valid. Preservation, quarantine and recovery to a new path are host responsibilities.

A stopped write may leave `journal.jsonl.<sha256>.<uuid>.tmp` beside the journal. Check its owner and destination before removing it.
