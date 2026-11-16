# Run journal and store

Reference for the run journal and journal store APIs. Back to the [documentation index](README.md).

The **run journal** (`history/run-journal-v1.mjs`, import `nisi/history/run-journal`) is an append-only, hash-chained record of what a run observed. A host can write it, reopen it after a restart and check it before relying on its rows. The **journal store** (`history/run-journal-store-v1.mjs`, import `nisi/history/run-journal-store`) moves a serialized journal to and from disk through a caller-supplied `fs`. The **journal anchor** (`history/run-journal-anchor-v1.mjs`, import `nisi/history/run-journal-anchor`) is an optional host-held record that detects rollback and rewrite (see [Anchor](#anchor)).

To check a file that is already on disk, without printing its payload:

```bash
node bin/nisi.mjs validate --journal /absolute/path/to/journal.jsonl
```

`NISI_JOURNAL` is the same path when you omit `--journal`. A directory of `*.jsonl` journals and workflow-report `*.json` files uses `--data-dir` or `NISI_DATA_DIR`. In a source checkout, `scripts/validate-real-data.sh` wraps that command. `verified: true` in the summary is the store's chain check, not authenticity, and `nisi validate` does not read an anchor.

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
- **Retirement.** Retiring a payload clears it but keeps its place in the chain. Its fingerprint is recomputed from the stored entry with a null payload, so re-appending the original content conflicts with `ID_CONTENT_MISMATCH`. `reopen` rejects older pruned rows whose fingerprints cannot be recomputed from their stored entries. Journals written before commit `4fc09e7` (3 November 2026, the first commit in v0.2.1) cleared that payload and left the previous fingerprint in place. Reopen at that time checked fingerprints only on retained rows, so those files reopened as `COMPLETE`. They no longer do. When the hash chain is intact and the only problem is that fingerprint on a non-retained row, `reopen` returns status `INVALID`, reason `LEGACY_UNRETAINED_FINGERPRINT`, and `authorizing: false`. The store refuses the file with the same reason instead of a generic `INVALID_JOURNAL`. Nothing in that file is authorized. The remedy is to run the work again with v0.2.1 or later, which recomputes the fingerprint when it retires a row. Nisi does not repair the old file.
- **Time.** `list`, `retain` and `serialize(now)` advance a time watermark and can permanently retire payloads, as do successful appends. Use one nondecreasing safe-integer millisecond clock; a future timestamp cannot be rolled back, even after reopen. `serialize()` without a time uses the last watermark, not wall time.
- **Reopen.** `reopen(serialized)` returns a recovery report with status `COMPLETE`, `INCOMPLETE` (the input ends before a valid footer: reason `TRUNCATED` when the last line is cut off, `MISSING_FOOTER` when there is no footer line) or `INVALID`. `INCOMPLETE` detects a file that was cut off. It does not detect a file shortened to an earlier entry with a matching footer, which reopens as `COMPLETE` (see Rollback and replay under Store). A missing or invalid header returns no journal. A valid header with a damaged body returns a sealed journal: `list()` and `retain()` still work, and `serialize()` throws `SEALED`. To move recovered rows, build a new journal and re-append them. Pass `reopen(serialized, {projectId, redactPaths, maxNow})` to pin what the host expects. All three keys are required. `redactPaths` is compared as a set, and `maxNow` is the latest header watermark the host accepts. On a mismatch `reopen` returns no journal and status `INVALID` with reason `PROJECT_MISMATCH`, `REDACTION_MISMATCH` or `CLOCK_AHEAD`, checked in that order. A malformed expectations object throws `EXPECTATIONS`. Without the second argument, the header supplies its own policy, as before.

## Limits

- History is capped at 10,000 records. `REFUSED` with `HISTORY_LIMIT` applies to new IDs; duplicates and conflicts still resolve. Reopen rejects larger histories.
- An entry that is malformed, nested deeper than 64 levels, or larger than 1,000,000 copied values or 64 Mi UTF-16 units of copied strings makes `append` throw an error with code `ENTRY`. So does an entry dated after the `now` you pass.
- Project mismatches, a sealed journal, invalid retries and revocations, and the history cap are returned as `REFUSED` statuses instead of errors.
- `readSerializedJournal` refuses a file larger than `maxBytes` (default 64 MiB) with `FILE_TOO_LARGE`. Nothing else bounds a serialized journal: hosts rotate journals and bound the bytes they write and pass to `reopen` themselves.
- The module imports only `node:crypto` and `node:util`.

## Store

- **Write.** A write validates the chain and goes through an exclusive temp file in the same directory. It syncs and reads back that file, renames it into place, syncs the directory and reads back the destination. A symlinked destination is refused with `SYMLINK` before the temp file is written and again before the rename, so the caller's `fs` must provide `lstatSync`. If UTF-8 conversion of the existing destination bytes throws, `writeSerializedJournal` returns `REFUSED` with `EXISTING_INVALID` instead of throwing.
- **Durability.** The store reports `committed` and `durable` separately. A write that landed without confirmed file and directory sync is never reported as durable. A read refuses files that end before a valid footer, and non-canonical, malformed-UTF-8 or chain-broken files. It does not refuse a file shortened to an earlier entry with a matching footer (see Rollback and replay).
- **Read.** `readSerializedJournal({path, fs, maxBytes})` opens the file once and reads from that descriptor, never more than one byte past its initial size, and refuses a larger file with `FILE_TOO_LARGE` (`bytes` is the size). A file of exactly `maxBytes` is read. Each `readSync` request is at most 1 GiB, including when `maxBytes` is `Infinity`, so Node's signed 32-bit length conversion cannot turn a large request into a zero-length read. A byte count different from the initial descriptor size, whether from growth or shrinkage, is `FILE_CHANGED`. This is not a snapshot: changes that preserve the byte count can still escape this check. A UTF-8 conversion that throws, including a runtime string-length limit, returns `REFUSED` with `READ_FAILED` instead of throwing. Normal journals keep the same serialized bytes, digest and result fields. `maxBytes` must be a number of at least 0, otherwise the read is refused with `INVALID_INPUT`.
- **Filesystem interface.** Reads require `readFileSync` on the caller's `fs`. When it also supplies `openSync`, `fstatSync`, `readSync` and `closeSync`, the store uses those descriptor methods and bypasses `readFileSync`, including any override on a wrapped `fs`. Such a wrapper now reads the descriptor's bytes even if its `readFileSync` would return virtual bytes or throw. An `fs` with only `readFileSync` reads as before and is checked against `maxBytes` only when the caller passes it. Descriptor reads use `lstatSync` when present, and `O_NOFOLLOW` and `O_NONBLOCK` where available, to refuse a final-component symlink with `SYMLINK` and a directory, FIFO or other non-regular file with `NOT_A_FILE`.
- **Path scope.** The symlink checks on reads and writes protect only the final path component. Symlinked parent directories are followed, and hard links to regular files are read. These checks do not confine access to a directory tree; hosts must control parent paths themselves.
- **Windows.** Without `O_NOFOLLOW` the read opens with `'r'`. An available `lstatSync` can refuse a symlink already present, but a link swapped in after that check can be followed. The nonblocking FIFO protection also depends on `O_NONBLOCK` being available. These fixes were checked on macOS; native Windows link-swap and named-pipe behaviour is `NOT_RUN`, and the POSIX results do not establish it.
- **Temp files.** Each write attempt uses its own temporary file name, so an orphaned temp file from a stopped process does not block an identical retry.
- **Concurrent writers.** `expectedPreviousSha256` detects stale **sequential** writes. It is not an atomic guard for concurrent writers or a continuity check: a matching digest permits replacement with any valid journal, including an empty journal or another project. Use one writer per journal and serialize writes in the host. The anchored writer adds a continuity check (see [Anchor](#anchor)); the store does not.
- **Authenticity.** `verified: true` means internal format and hash consistency, not authenticity. The unkeyed chain and footer can be rewritten together, so detecting malicious replacement needs a trusted digest or authentication outside the journal. The [anchor](#anchor) is such a digest for a host that keeps it where the journal's writers cannot write.
- **Rollback and replay.** Two changes need no hashing at all. Deleting the last entry lines and writing a footer with `count` set to the remaining entry count and `lastHash` set to the `previousHash` of the first deleted line uses values already in the file: `reopen` returns `COMPLETE`, the store returns `READ` with `verified: true`, and `nisi validate` reports `PASS`. An older complete copy of the same journal also reopens as `COMPLETE`, and the store writes it over the current file when the caller passes the current file's digest as `expectedPreviousSha256`. Nisi detects neither change. Separately, when `reopen` is called with one argument, the header supplies its own `projectId`, `redactPaths` and clock watermark `now`. The [14 November 2026 review](reviews/2026-11-14-journal-auth-review.md) records them as F3 to F5 and proposes R1 (a host-held anchor) and R3 (host-supplied expectations on reopen). R3 is implemented: a host that passes expectations to `reopen` (see Reopen) gets `INVALID` for a header with another `projectId`, other `redactPaths` or a `now` past `maxNow`. R1 is implemented as a separate module (see [Anchor](#anchor)): a host that keeps an anchor detects both changes. The anchor addition does not change the unanchored rollback behavior of `reopen`, the store or `nisi validate`; the store read and conversion fixes above apply with or without an anchor.

## Anchor

The **journal anchor** (`history/run-journal-anchor-v1.mjs`, import `nisi/history/run-journal-anchor`) is the answer to review item R1. The reasoning is in the [journal anchor design](design/journal-anchor.md). The host keeps one small file, the anchor, outside the journal's directory. The anchor holds the SHA-256 of the exact journal bytes the host last wrote, the entry count, a chain over each entry without its payload (the stem chain) and a generation counter. A journal that no longer matches the anchor is reported with a reason. The anchor addition preserves the journal format and the behavior of `reopen` and `nisi validate`; it uses the store with the bounded-read and conversion behavior described above. A journal written through the anchor is byte-identical to one written by `writeSerializedJournal`.

```js
import fs from 'node:fs';
import { adoptJournal, writeAnchoredJournal, verifyAnchoredJournal } from 'nisi/history/run-journal-anchor';

const where = { journalPath: '/data/journal.jsonl', anchorDir: '/secure/anchors', key: 'project-demo', fs };
writeAnchoredJournal({ ...where, serialized: journal.serialize(now) }); // { status: 'WRITTEN', generation: 2, ... }
const result = verifyAnchoredJournal(where);                            // { status: 'OK', ok: true, ... }
if (!result.ok) { /* do not rely on the journal */ }
```

- **Functions.** `writeAnchoredJournal` writes a journal and its anchor. `verifyAnchoredJournal` reads both and returns a status. `adoptJournal` anchors a journal that already exists. `reanchorJournal` accepts a journal that is ahead of its anchor. `describeJournal(serialized)` returns the count, the footer `lastHash`, the file digest and the stem chain. `anchorFileName(key)` gives the anchor's file name. The first four never throw on bad input or on an error from the caller's `fs`: each returns a status and a reason code. `anchorFileName` throws an error with `code` `INVALID_INPUT` for a key that is empty, longer than 1,024 characters, not a string or not well-formed. `describeJournal` throws `INVALID_JOURNAL` for a value that is not a well-formed string ending in a line feed and `JOURNAL_NOT_COMPLETE` for a journal that is not `COMPLETE` under `reopen`; it is a helper, and the four functions above catch it. `verifyAnchoredJournal` also takes `policy`, `expectations` (the same `{projectId, redactPaths, maxNow}` that `reopen` accepts) and `maxBytes`. The writer takes `expectedGeneration`, which is a `CONFLICT` if the anchor's generation has changed since the host read it.
- **Where the anchor lives.** The host passes `anchorDir`. A directory that is, or is inside, the journal's directory is refused with `ANCHOR_INSIDE_JOURNAL_DIR`. Each call resolves the journal directory and the anchor directory once, using `realpath` on the nearest existing ancestor without first collapsing `..`; it keeps the journal's final file name so that a symlinked file is still refused. Empty and `.` directory components are skipped. If `realpath` is unavailable or cannot resolve a component, the remaining ordinary names and `..` components retain their spelling for both the identity check and I/O. The resulting journal path is used for the check and every journal read and write, and the resulting anchor directory is used for the check and the anchor file. A missing directory is compared using its existing ancestor and the remaining ordinary names and `..` components; this does not create it or make an otherwise invalid kernel path usable. The check also compares the device and inode of the journal's directory with those of the anchor directory and its physical parents, obtained by appending literal `/..` components rather than taking string parents. This catches aliases whose spelled parents differ, including macOS volfs paths, as well as another case on a case-insensitive volume, another Unicode normalisation and Windows 8.3 names when directory identities are available. On POSIX it compares `dev` and `ino`. On Windows Node reports the volume serial and file index; Windows was not run. If directory identity lookup fails, `dev` or `ino` is missing or `undefined`, or `ino` is 0, the check falls back to the spelled comparison, which another spelling can defeat. Null-valued `dev` or `ino` metadata in a caller-supplied stat object has not been verified. A bind mount of a journal subdirectory whose mounted parent chain never visits the journal directory is also not detected by the identity walk. The check is not atomic with the write: replacing a resolved directory or an ancestor with a symlink after the check can redirect the write. The host must prevent those swaps as well as other writes to the anchor location. There is no default location. The directory must exist, and it protects nothing unless the journal's other writers cannot write it (see below). `key` is the host's own label for the journal. The file is `<sha256 of the key>.anchor.json`, so the name is 64 lowercase hex characters plus the suffix and never contains the key or a path.
- **The file.** Canonical JSON on one line ending in LF, at most 4,096 bytes, a regular file (a symlink or other file is refused). Fields: `schema` (`nisi-journal-anchor-v1`), `current` and `pending`. `current` is the last confirmed state and `pending` is `null` or the state about to be written. A state has `count`, `fileSha256`, `generation`, `journalSchema`, `lastHash`, `projectId` and `stemTip`. It holds hashes, counters and the project ID. It holds no payload, entry ID or path, and none of the functions puts one in a result or a reason.
- **Writing.** The writer reads the anchor and checks the journal against it, refuses anything that is not `OK` or `OK_PENDING` (an `OK_PENDING` anchor is promoted first), and builds the new state. The new journal must extend the anchored one: the same project, no fewer entries, the same stem chain over the anchored entries, retained rows with the same fingerprints and retired rows still retired. Otherwise the write is refused with `NOT_EXTENSION` and nothing is written. The anchor is then written with the new state as `pending`, the journal is written through `writeSerializedJournal` with the current digest as `expectedPreviousSha256`, and the anchor is written again with the new state as `current`, the generation raised by one and `pending` cleared. Each anchor write uses an exclusive temp file in the anchor directory, `fsync`, rename and a directory sync. A store write that is refused before it changed anything clears `pending`. A store write that was committed and then refused (a read-back mismatch) leaves it. A write is refused with `GENERATION_EXHAUSTED` before anything changes when the next generation would not be a safe integer, and so is a re-anchor. The first write for a key creates the anchor with an empty state at generation 1, so a new journal's first anchored generation is 2. `result.durable` is `true` only when every file and directory sync of every write in the call was confirmed.
- **Verifying.** The statuses are in the table. Only `OK` and `OK_PENDING` have `ok: true`. `OK_PENDING` is the journal after a crash between the journal write and the promotion: it matches `pending`, and the next anchored write promotes it. `generation` in the result is the generation of `current`, also for `OK_PENDING`. While `pending` is set, a copy of the journal that matches `current` still verifies `OK` and the result does not show that a pending state exists: a one-write rollback to the previous state is not detected until the next anchored write promotes the pending state (a host that only reads never closes that window). A verify is not atomic against the single legitimate writer: it reads the anchor and then the journal, so a complete anchored write that lands between the two reads makes it report `AHEAD` for a moment. That is a false alarm and never a false `OK`; verify again, serialized with writes, before acting on `AHEAD`.
- **Policy.** `policy` is `require` (the default) or `unanchored-ok`. With no anchor file, `require` gives `ANCHOR_MISSING` and `unanchored-ok` gives `UNANCHORED`. Neither is `ok`. `unanchored-ok` is for a journal that has not been adopted yet. Use `require` for every journal created through the anchored path and move adopted journals to it, because under `unanchored-ok` a deleted anchor is a silent downgrade.
- **Adoption.** `adoptJournal` reads a journal that exists, requires `COMPLETE` and writes an anchor at generation 1. Adoption is trust on first use: whatever the file said at that moment is accepted and nothing before it is protected. It is never automatic. A journal that fails with `LEGACY_UNRETAINED_FINGERPRINT` or any other `JOURNAL_NOT_COMPLETE` cause is refused. The writer does not extend an existing journal that has no anchor (`ANCHOR_MISSING`): adopt it first.
- **Re-anchoring.** A journal that extends its anchor but is not in it is `AHEAD`: someone, or a host that does not know the anchor, wrote more entries. `reanchorJournal` is the explicit decision to accept it. It refuses every other status with `NOT_AHEAD`, `CONTENT_DIFFERS` included. The host decides and records why, and does not re-anchor on a single `AHEAD` without verifying again with no writer running, because the first `AHEAD` can be a read that straddled a legitimate write. `AHEAD` does not mean that the anchored entries are unchanged. The stem chain leaves out payloads and the anchor holds no fingerprints, so a journal whose retained payloads, retained flags or header were rewritten and which also has an appended entry is `AHEAD`, and `reanchorJournal` records it as it is: trust on first use again for everything but the stems. The same holds after a first write that stopped before its journal landed: any journal of the project placed at the path is `AHEAD` of the empty first state. Closing that needs the anchor to hold per-entry fingerprints, which is a format change that is not made here. Nothing re-anchors by itself and nothing edits a journal.
- **One writer.** The anchor does not make concurrent writers safe. Two writers that interleave leave a journal that does not match the anchor, which a later verify reports (not `OK`). Use one writer per journal and serialize writes in the host, and serialize reads with writes or verify again before acting on `AHEAD`.
- **Cost.** An anchor with `pending` null is 385 bytes for the project ID `project-a` and 504 bytes for one of 128 characters; with `pending` set it is at most 942 bytes. Each anchored write adds two small atomic writes, each with a file sync and a directory sync. Verifying runs `reopen`, a second pass over the entries for the stem chain and one SHA-256 of the file.
- **Windows.** The file name is lowercase hex, so there are no reserved names, case collisions or `:`. A rename that fails with `EPERM`, `EBUSY` or `EACCES` is tried up to 5 times, waiting 10, 20, 40 and 80 ms between tries; other errors are not retried. The tests inject `EPERM` to exercise this. Directory sync opens the directory as the store does, and a failure is reported as `durable: false`. Windows has no `O_NOFOLLOW`, so the symlink check relies on `lstat` before the open, as the store does. File mode `0o600` does nothing useful there, and Node cannot set an ACL: separation from other accounts and tools needs an ACL on the anchor directory that the host or installer sets. Nothing in the anchor was run on Windows or on any hardware.

| Status | Meaning |
|---|---|
| `OK` | The journal's digest is the anchor's `current` digest. |
| `OK_PENDING` | It is the `pending` digest. |
| `ANCHOR_MISSING`, `UNANCHORED` | No anchor file, by policy. |
| `ANCHOR_INVALID` | The anchor is unreadable, not canonical, has other keys, an unknown schema or a bad value, is over the cap, or is not a regular file. `cause` says which. |
| `JOURNAL_NOT_COMPLETE` | The journal is missing, damaged, legacy or `INCOMPLETE`, or fails the host's expectations. `cause` is the store's or `reopen`'s reason. |
| `ANCHOR_PROJECT` | The journal's `projectId` is not the anchor's. |
| `ROLLED_BACK` | Fewer entries than the anchor: a truncation with a rebuilt footer, an older copy, or a deleted file replaced by a shorter one. |
| `CONTENT_DIFFERS` | The same entries but different bytes: a rewritten payload or a replaced retirement. |
| `AHEAD` | More entries after the anchored ones, which the anchor does not know. The anchored entries' payloads are not compared (see Re-anchoring). It is also what a read that straddled a legitimate write reports. |
| `DIVERGED` | An entry among the anchored ones is different: a rewrite of history, or an unrelated journal of the same project. |
| `ANCHOR_INSIDE_JOURNAL_DIR`, `INVALID_INPUT` | The arguments are refused before anything is read. |

**What an unanchored read does not detect.** A journal read without an anchor (`reopen`, `readSerializedJournal`, `nisi validate`) checks format and hashes only. It does not detect a rollback to an earlier entry with a footer rebuilt from values already in the file, an older complete copy, a deleted journal followed by a fresh one, a full rewrite with every fingerprint, hash and footer recomputed, or a rewritten payload. It reports `COMPLETE`, `READ` with `verified: true` or `PASS`. The chain is unkeyed, and the footer `lastHash` alone cannot show growth either: a later watermark or a retirement changes every later hash, so a later file does not contain an earlier footer.

**An anchored read detects** a rollback to an earlier or older copy (`ROLLED_BACK`), a deleted journal started again, a rewrite of history with every hash recomputed (`DIVERGED`), a rewrite of a retained payload with the entries unchanged (`CONTENT_DIFFERS`), entries the host did not write (`AHEAD`), another project's journal, a missing, damaged or replaced anchor, and a crash between the two writes, which it reports as `OK` or `OK_PENDING` (see the limits below for the window while a pending slot is set). It also refuses, at write time, a journal that is not an extension of the anchored one, which the store's `expectedPreviousSha256` does not check.

**An anchored read does not detect or protect against:**

- An attacker who can write the anchor as well as the journal. An attacker running as the host's own account, with the anchor directory writable by that account, is in this class. A directory outside the journal's directory only stops accidents and tools that touch the journal directory (restores, sync conflicts, cleanup).
- An attacker who runs the host's own code and calls the anchor writer.
- A restore of the journal and the anchor together from one backup.
- Anything written before adoption. Adoption trusts the file as it is at that moment.
- A deleted anchor under `unanchored-ok`. Use `require`.
- Appends by anyone who can also write the anchor. The anchor says what the host wrote, not that an entry is true or which writer wrote it. Keyed authentication is review item R2, which is not started.
- Denial of service. An attacker who can change the file can make it fail verification. The host loses trust in the file, not data it already trusts elsewhere.
- Older copies that still hold retired payloads. Replay detection does not remove them from disk.
- Whether two copies of a journal on two machines agree. The anchor belongs to one host.
- A rewrite of a retained payload together with an appended entry. The journal is `AHEAD`, not `CONTENT_DIFFERS`, because the anchor compares stems and not payloads, and a re-anchor accepts the rewritten payloads. The same rewrite without the append is `CONTENT_DIFFERS`.
- A one-write rollback while the pending slot is set. Between a journal write whose promotion did not happen and the next anchored write, the previous journal still verifies `OK` and the result does not say that a pending state exists.
- Whether the recorded events happened, or the confidentiality of a payload.

## Recovery

The package has no recovery worker, and its exports are limited to the declared runtime modules (older deep imports may no longer resolve). After a restart a host calls `readSerializedJournal`, then `reopen`.

For damaged input the store returns `INVALID_JOURNAL` and refuses replacement with `EXISTING_INVALID`. The host can read the raw bytes and call `reopen` for sealed recovery when the header is valid. Preservation, quarantine and recovery to a new path are host responsibilities.

A stopped write may leave `journal.jsonl.<sha256>.<uuid>.tmp` beside the journal. Check its owner and destination before removing it.
