# Run Journal and Journal Store API

The run journal keeps a hash-chained record of what a run observed. The journal
store moves a serialized journal to and from disk. Import them from
`nisi/history/run-journal` and `nisi/history/run-journal-store` when installed,
or from `./history/run-journal-v1.mjs` and `./history/run-journal-store-v1.mjs`
in this checkout. Journal views and reports carry `authorizing: false`; they
record observations and grant no authority.

```js
import * as fs from 'node:fs';
import { createRunJournal, reopen } from 'nisi/history/run-journal';
import { writeSerializedJournal, readSerializedJournal } from 'nisi/history/run-journal-store';

const journal = createRunJournal({ projectId: 'project-a', maxEntries: 1000, heartbeatTtlMs: 30_000, redactPaths: ['payload.token'] });
journal.append({
  id: 'run-1.test.0', projectId: 'project-a', runId: 'run-1', attempt: 0, candidateId: 'candidate-1',
  stage: 'test', receiptId: null, createdAt: 1000, ttlMs: 86_400_000, state: 'SUCCEEDED',
  heartbeatAt: null, retryOf: null, revokes: null, payload: { token: 'secret', passed: 12 },
}, 1000); // { status: 'APPENDED', id: 'run-1.test.0' }
const first = writeSerializedJournal({ path: '/var/lib/app/journal.jsonl', serialized: journal.serialize(), fs });
// Later writes to the same file pass expectedPreviousSha256: first.sha256.
```

## Data rules

Configs and entries are deep-copied before use. Every value must be `null`, a
boolean, a well-formed string (no lone surrogates), a safe integer other than
`-0`, a plain array without holes or extra properties, or an object whose
prototype is `Object.prototype` or `null`. Objects may hold only enumerable
string-keyed data properties with well-formed keys other than `__proto__`,
`prototype` and `constructor`. `undefined`, fractions, symbols, functions,
accessors, Proxies and cycles are refused.

An entry or config may nest at most **256 objects and arrays** on any path,
counting the entry or config object itself, so a payload can nest 255 levels.
A deeper value is refused with `ENTRY` or `CONFIG`, and a stored record that
is deeper reopens `INVALID` with reason `RECORD`.

IDs (`projectId`, `id`, `runId`, `candidateId`, `stage`, and non-null
`receiptId`, `retryOf` and `revokes`) are 1–128 characters of ASCII letters,
digits, `_`, `.`, `:` and `-`, starting with a letter or digit.

## Config

`createRunJournal(config)` returns a frozen `{ append, list, retain, serialize }`.
It throws an `Error` with `code: 'CONFIG'` unless the config has exactly these
keys and meets these rules:

| Key | Rule |
|---|---|
| `projectId` | ID; every entry must carry the same value |
| `maxEntries` | Integer 1–10,000; the most records that keep their payload |
| `heartbeatTtlMs` | Integer ≥ 1; heartbeat age above which `RUNNING` reads `UNKNOWN` |
| `redactPaths` | Array of `payload.`-prefixed dot paths; no path may equal or contain another |

A path segment is an identifier (`[A-Za-z_][A-Za-z0-9_]*`, not `__proto__`,
`prototype` or `constructor`) or an array index without leading zeros.

## Entries

An entry has exactly these 14 keys:

| Key | Rule |
|---|---|
| `id` | ID; bound to the first content appended under it |
| `projectId`, `runId`, `candidateId`, `stage` | IDs |
| `receiptId` | ID or `null` |
| `attempt` | Integer ≥ 0 |
| `createdAt` | Integer ≥ 0, not after the append's `now` |
| `ttlMs` | Integer ≥ 1; `createdAt + ttlMs` must be a safe integer |
| `state` | `QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELLED` or `REVOKED` |
| `heartbeatAt` | `null` or an integer ≥ 0 that is not after `createdAt` |
| `retryOf` | ID of the entry being retried, or `null`; must be `null` when `REVOKED` |
| `revokes` | ID of the revoked entry when the state is `REVOKED`, otherwise `null` |
| `payload` | Any value under the data rules, including `null` |

Entries are immutable once appended. A later heartbeat or state is a new entry
with its own `id`.

Each configured redaction path must exist in every entry's payload, revocations
included; otherwise `append` throws `code: 'REDACTION'` and records nothing. A
segment that meets an array must be an existing index. The value at each path
is replaced with `'[REDACTED]'` before the entry is fingerprinted or stored, so
entries that differ only in redacted values are duplicates.

## Append, list and retain

`append(entry, now)` checks, in order, and returns a frozen result:

| Result | When |
|---|---|
| throws `TIME` | `now` is not a safe integer ≥ 0 or is below the journal's watermark |
| throws `ENTRY` | The entry breaks the data or entry rules |
| `{ status: 'REFUSED', id, reason: 'SEALED' }` | The journal came from damaged input |
| `{ status: 'REFUSED', id, reason: 'PROJECT' }` | `projectId` differs from the config |
| throws `REDACTION` | A configured path is missing |
| `{ status: 'DUPLICATE', id }` | The ID exists with the same redacted content |
| `{ status: 'CONFLICT', id, reason: 'ID_CONTENT_MISMATCH' }` | The ID exists with different redacted content |
| `{ status: 'REFUSED', id, reason: 'RETRY' }` | `retryOf` is set and the retry rule fails |
| `{ status: 'REFUSED', id, reason: 'REVOCATION' }` | `revokes` is set and the revocation rule fails |
| `{ status: 'APPENDED', id }` | The entry was recorded |

A retry must be `QUEUED`, name an existing entry in the same `runId`, have a
higher `attempt` and a `createdAt` no earlier than the target's, and the target
must be in a terminal state (`SUCCEEDED`, `FAILED`, `CANCELLED`, `REVOKED`),
expired at `now`, or revoked. A revocation must name an existing entry with the
same `runId`, `attempt` and `candidateId`, created no later than the revocation.

The watermark is the latest accepted time. `APPENDED`, `list(now)` and
`retain(now)` advance it; other append results leave it unchanged. `list` and
`retain` throw `TIME` under the same rule as `append`.

Retirement runs after each successful append and on every `list` and `retain`.
First, each record whose TTL has passed (`now ≥ createdAt + ttlMs`) is retired;
then the oldest records are retired until at most `maxEntries` keep their
payload. A retired record keeps its entry, fingerprint and place in the chain,
with `retained: false` and `payload: null`, so a later duplicate or conflicting
append of that ID is still classified. `retain(now)` returns a frozen array of
the IDs it retired, in record order.

`list(now)` returns one frozen view per record: `entry` (a copy), `historical`
(`true` for records loaded by `reopen`), `retained`, `revoked` (another entry
revokes it), `expired`, `liveness` and `authorizing: false`. `liveness` is the
first that applies:

1. `REVOKED` when another entry revokes this one.
2. The entry's own terminal state: `SUCCEEDED`, `FAILED`, `CANCELLED` or `REVOKED`, even after its TTL.
3. `EXPIRED` once `now ≥ createdAt + ttlMs`.
4. `UNKNOWN` for `RUNNING` when `heartbeatAt` is `null` or `now - heartbeatAt > heartbeatTtlMs`.
5. The entry's state, `QUEUED` or `RUNNING`.

Use `expired` and `revoked` to filter by TTL or revocation. `liveness` alone
does not separate them: a revocation entry itself reads `REVOKED` with
`revoked: false`, and a terminal entry keeps its state after its TTL.

## Serialized form and reopen

`serialize()` returns canonical JSON lines, each ending in `\n`: keys sorted,
no whitespace. It throws `SEALED` on a sealed journal.

- Header: `{ type: 'header', schema: 'nisi-run-journal-v1', config, now }`, where `now` is the watermark.
- One line per record: `{ type: 'entry', seq, previousHash, record: { entry, fingerprint, retained }, hash }`.
- Footer: `{ type: 'footer', count, lastHash }`.

The first `previousHash` is SHA-256 of `nisi-run-journal/header/v1\n` plus the
header line. Each `hash` is SHA-256 of `nisi-run-journal/record/v1\n` plus the
canonical `{ seq, previousHash, record }`. A fingerprint is SHA-256 of
`nisi-run-journal/input/v1\n` plus the canonical redacted entry. `lastHash` is
the last record hash, or the header hash when there are no records.

`reopen(serialized)` returns a frozen `{ journal, report }`. The report is
`{ status, recoveredIds, rejectedLine, reason, authorizing: false }`; line
numbers start at 1 for the header.

| Status | Reason | Meaning |
|---|---|---|
| `COMPLETE` | `null` | Every line verified. `rejectedLine` is `null`; the journal accepts appends at or after the header's `now`. |
| `INCOMPLETE` | `TRUNCATED` | The input ends without a newline before any footer. The partial last line is ignored. |
| `INCOMPLETE` | `MISSING_FOOTER` | Complete lines end without a footer. |
| `INVALID` | `HEADER` | No newline, or the header or its config is invalid. `journal` is `null`. |
| `INVALID` | `RECORD` | A record line failed a check below. |
| `INVALID` | `FOOTER` | The footer's keys, `count` or `lastHash` do not match. |
| `INVALID` | `TRAILING_DATA` | Anything follows a valid footer. |

`recoveredIds` lists the records before the rejected line. Except for
`HEADER`, a non-`COMPLETE` reopen returns a **sealed** journal holding those
records: `list` and `retain` work, `append` returns `REFUSED`/`SEALED` after
its `TIME` and `ENTRY` checks, and `serialize` throws `SEALED`. Check
`report.status` before using `journal`.

A record is rejected when its line is not canonical JSON, its `seq`,
`previousHash` or `hash` does not match, its entry breaks the entry rules
(with the header's `now` as the append time), its `projectId` differs, its ID
repeats, or a retry or revocation breaks the append rules. A retained record
must have `'[REDACTED]'` at every configured path, a fingerprint that matches
its entry, and must not be expired at the header's `now`; at most `maxEntries`
records may be retained. A retired record must have `payload: null`. When the
footer is otherwise valid, the last retired record that is not expired at the
header's `now` must have at least `maxEntries` records after it; otherwise it
is the rejected record.

## What the chain shows

The chain detects changes and truncation relative to itself, and `reopen`
applies the rules above to every record, so a file rewritten with recomputed
hashes must still follow them. The chain does not authenticate a writer:
anyone able to rewrite the file can recompute every hash and change entries
consistently. A retired entry's fingerprint cannot be recomputed from its
cleared payload and is trusted as recorded. The retirement check narrows, but
does not close, that gap; for example, the header's `now` can be raised past
the entry's TTL, which changes how a later append of that ID is classified.

The header's `now` is part of the chain root. Once `append`, `list` or `retain`
advances the watermark, every later serialization has new record hashes and a
new `lastHash`, so a saved `lastHash` identifies one snapshot, not a prefix of
later files.

## Journal store

Both functions take an options object with a caller-supplied `fs` and report
invalid input, invalid data and `fs` failures as refusals instead of throwing.
Every result has `status`, `committed`, `durable`, `fsync: { file, directory }`
and `fsyncErrors: { file, directory }`. Refusals also have `reason`. When a
refusal comes from a thrown `fs` error, `error` holds that error's `code`
(`IO_ERROR` if it has none). `cleanupError` records a failed close or temp
removal.

### readSerializedJournal({ path, fs })

`fs` needs `readFileSync`. The read does not refuse symlinks (Node's
`readFileSync` follows them) and makes no other `fs` call. It returns `{ status: 'READ', serialized, sha256, bytes, verified: true }`
only when the file is strict UTF-8 and a journal that reopens `COMPLETE` with
canonical framing, no empty lines and a final newline. `sha256` is the
lowercase hex SHA-256 of the file's bytes and `bytes` is their count.

### writeSerializedJournal({ path, serialized, fs, expectedPreviousSha256 })

`fs` needs `readFileSync`, `lstatSync`, `openSync`, `writeSync`, `closeSync`,
`renameSync` and `unlinkSync`. A missing or failing `fsyncSync` is recorded in
`fsyncErrors` and the write cannot be durable.

Creating a new file needs no hash. **Replacing an existing journal requires
`expectedPreviousSha256`**, the `sha256` returned by the previous write or read
of that file. If the file already holds identical bytes, the result is
`UNCHANGED` when the hash is omitted or matches. The hash detects stale
sequential writes. It is not an atomic guard for concurrent writers: use one
writer per journal. The store checks that a replacement is a valid journal and
that the existing file matches the hash; it does not check that the replacement
extends the existing journal.

A write validates its input, then refuses a symlinked destination, then reads
and checks the existing file. It writes an exclusive temp named
`<path>.<sha256>.<uuid>.tmp` (mode `0o600`) in the same directory, syncs and
closes it, and reads it back. Just before the rename it checks again that the
destination is not a symlink and is unchanged. After the rename it syncs the
directory and reads the destination back. A refusal before the rename leaves
the destination untouched, and every refusal up to and including a failed
rename closes and removes the temp that write created. A process stopped
mid-write may leave its temp behind; each attempt uses a new name, so an orphan
does not block a retry.

| Status | Meaning |
|---|---|
| `WRITTEN` | Renamed into place and read back. `committed: true`; `durable` is `true` only when both the file and directory syncs succeeded. |
| `UNCHANGED` | The file already holds these bytes. Nothing is written; `durable: false`. |
| `READ` | `readSerializedJournal` verified the file. |
| `REFUSED` | See `reason`; `durable: false`. |

| Reason | Cause |
|---|---|
| `INVALID_INPUT` | Missing options, an empty or NUL-containing path, a missing `fs` method, or an `expectedPreviousSha256` that is not 64 lowercase hex characters |
| `PATH_TOO_LONG` | Write only: the file name exceeds 149 UTF-8 bytes, so the temp name would exceed 255 |
| `TOO_LARGE` | Write only: the journal's UTF-8 size exceeds `buffer.constants.MAX_STRING_LENGTH`, so it could not be read back |
| `INVALID_JOURNAL` | `serialized`, or the file being read, is not a valid journal (including a file above that size) |
| `NOT_FOUND` | Read only: the file does not exist |
| `SYMLINK` | Write only: the destination is a symlink, checked before any change and again before the rename |
| `READ_FAILED` | Reading or inspecting the file failed other than with `ENOENT` |
| `EXISTING_INVALID` | The existing file is not a valid journal; it is left unchanged |
| `CONFLICT` | The hash is missing for a replacement, does not match, or was given for a missing file; or the destination appeared, disappeared or changed before the rename |
| `WRITE_FAILED` | Opening, writing or closing the temp failed, or a write made no progress |
| `READBACK_MISMATCH` | The temp or, after the rename, the destination did not read back identically; `committed` tells which |
| `RENAME_FAILED` | The rename of the temp onto the destination failed |

Only the file name is checked for a symlink. Symlinked parent directories are
followed, and the temp, rename and directory sync all resolve through them.
