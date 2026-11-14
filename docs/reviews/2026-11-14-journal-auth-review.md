# Run journal authentication and format review — 14 November 2026

Source reviewed: `origin/main` at `239611c` (merge of PR #56). Scope: the open roadmap item "Review journal format migration/authentication before adding either feature" (`roadmap.md:27`). This review covers how the run journal is written, read and checked. It looks at who can write, tamper evidence, the trust boundary, replay, size limits and error output. It also covers what a later format migration would need.

Files read: `history/run-journal-v1.mjs`, `history/run-journal-store-v1.mjs`, `history/validate-data.mjs`, `bin/nisi.mjs` (the `validate` path), `docs/run-journal.md`, `docs/architecture.md` (journal boundary), `SECURITY.md`, and the Jaryo adaptor notes (`spec/docs/adaptor/ADAPTOR-V0.md` in the Jaryo repository). Each suspected weakness was reproduced with a small stand-alone Node script that was kept outside the repository. Nothing was tagged, released or published.

**Summary.** The journal has no authentication, and its documentation says so plainly. The integrity checks hold for accidental damage, and none of the probed malformed inputs got through. One small defect was confirmed and fixed in this change: `nisi validate` checked file size with `lstat` and then read the file by path without a limit. Every other finding is a documented consequence of the unkeyed design. Each one needs a design decision before authentication or a v2 format is added.

## Trust boundary as built

- **Who can write.** Anyone who holds a journal object can append. Anyone who can write the file or its directory can replace it. Entries have no writer field (`history/run-journal-v1.mjs:7`). `receiptId` is an unchecked identifier string (`:96`). Any caller can append a `REVOKED` entry for any entry in the same run, attempt and candidate (`:151`).
- **What the hashes cover.** The fingerprint (`:113`), the record hash and the chain (`:161-163`), and the footer are all unkeyed SHA-256. They detect damage that has not been rehashed. They do not identify who wrote the file.
- **Where policy comes from.** `reopen(serialized)` takes only the bytes (`:215`). The project ID, `redactPaths`, `maxEntries`, `heartbeatTtlMs` and the clock watermark `now` are all read from the file's own header (`:179-181`). The host cannot pass the values it expects.
- **What the store adds.** The store adds format and chain checks (`history/run-journal-store-v1.mjs:25-58`), a stale-write guard (`expectedPreviousSha256`, `:116`, `:125`), a refusal to write through a symlink (`:117-119`, `:181-183`), and owner-only temp files (`0o600`, `:152`). The rename keeps that mode.
- **Outputs.** Views and recovery reports carry `authorizing: false` (`run-journal-v1.mjs:133`, `:171`).

## Confirmed findings

| # | Finding | Evidence | Severity | Disposition |
|---|---|---|---|---|
| F1 | `nisi validate` checked the size with `lstat` and then read the file by path with no limit. A file that grew, or was swapped, between the two calls was read in full and could be reported `PASS` even though it was over `maxBytes`. | `origin/main` `history/validate-data.mjs:63-64` (journal) and `:96-98` (workflow report). Reproduction: a stale `lstat` size (1 byte) with a 1,899-byte journal and `maxBytes` 64 returned `["PASS", bytes 1899]`. | Low. It needs someone who can already change the file. The effect is unbounded memory and a misleading `PASS` over the bound. | **Fixed here.** The file is now read from one descriptor (`O_NOFOLLOW` where the platform has it). The size check uses that descriptor's `fstat`, and the read stops one byte past that size. A file that grows during the read fails with `FILE_CHANGED`. The new test `a file larger than maxBytes after the lstat check is refused, not read` failed before the fix and passes after it. Two more tests cover the `FILE_CHANGED` branch (a file that grows during the read) and the `O_NOFOLLOW` open (a file swapped for a symlink after `lstat`). |
| F2 | A full rewrite is accepted. An attacker can change an entry's payload or state, then recompute its fingerprint, every record hash and the footer. `reopen` returns `COMPLETE` and the store returns `READ` with `verified: true`. | `run-journal-v1.mjs:113`, `:161-163`, `:190-197`. Reproduction: entry `e3` changed to state `CANCELLED` with the payload `{verdict:'pass'}`. The result was `COMPLETE` and `["READ", true]`. | High if a host treats the journal as evidence. Already documented (`SECURITY.md:74-80`, `docs/run-journal.md:85`). | Design: R1, R2. |
| F3 | Rollback needs no hashing. Deleting the last N entry lines and writing a footer with `count: n-N` and `lastHash` set to the `previousHash` of the first deleted line produces a `COMPLETE` journal. Both values are already in the file. An older complete copy also replays as `COMPLETE`. A store write of the older copy succeeds when the caller passes the current file's digest. | Footer check `run-journal-v1.mjs:186`; store guard `run-journal-store-v1.mjs:125`. Reproduction: `["COMPLETE", ["e1","e2"]]`, store `READ`, older copy `COMPLETE`, rollback write `WRITTEN`. | Medium. This attack is cheaper than F2. The general limit is documented, but this cheap form is not spelled out. | Design: R1 (an external anchor). The documentation note is under recommendations. |
| F4 | The policy comes from the file. A rewritten header can set `redactPaths: []` and change `projectId`. A retained row can then hold a value that the host's policy would redact. `reopen` returns `COMPLETE`. The host only notices when its next append returns `REFUSED`/`PROJECT`. If it only reads, it never notices. | `run-journal-v1.mjs:179-181`, `:201-203` (redaction is checked against the file's own paths), `:215` (no expected-config parameter). Reproduction: payload `{"apiKey":"sk-planted"}`, project `"other"`, status `COMPLETE`. | Medium for read-only consumers such as an adaptor or a dashboard. | Small API addition (R3). Not done here because it changes the public API. |
| F5 | The clock watermark can be pinned in the future. A rewritten header with `now` set to `Number.MAX_SAFE_INTEGER` (and no retained row that this value would expire) reopens as `COMPLETE`. After that, every `append`, `list` and `serialize` at real time throws `TIME`. | `run-journal-v1.mjs:128`, `:136`, `:181`. Reproduction: all three calls threw `TIME`. | Low, availability only. The no-rollback behaviour is documented (`docs/run-journal.md:68`). | R3: let the host give an upper bound for `now`. |

## Refuted or holding

- **Cheap tampering without rehashing.** A duplicate JSON key, a byte-order mark, CRLF line endings and a number written as `1000.0` were each rejected with `INVALID`. Each line must equal its canonical form (`run-journal-v1.mjs:168-170`, `run-journal-store-v1.mjs:30-34`). The store also rejects malformed UTF-8 (`:60-66`), lone surrogates and `-0`.
- **Payload or path leaks in errors.** A marker string was placed in a payload and in a fake `fs` error message. It did not appear in the reopen report for a damaged line, in the store refusals (damaged, missing, `EACCES`), in the append `ENTRY` error, or in the CLI's stdout or stderr for `validate --data-dir`. Store refusals carry reason codes and `fs` error codes, never messages (`run-journal-store-v1.mjs:14`). Two minor exposures remain. Reopen reports list `recoveredIds`, which are entry IDs, and the line number of a rejected line. `validate` prints only counts.
- **Fingerprints exposing redacted values.** Redaction runs before fingerprinting (`run-journal-v1.mjs:142-143`), and retiring an entry recomputes the fingerprint over a null payload (`:123`). The digest therefore does not cover redacted or retired values.
- **The pre-4fc09e7 legacy path.** A non-retained row with a stale fingerprint is still refused as `LEGACY_UNRETAINED_FINGERPRINT` (`:194-200`, `:211`), and nothing in it is authorized. No change is needed.

## Unknowns

- **Windows.** Node has no `O_NOFOLLOW` on Windows, so there the F1 fix opens the file with plain `'r'`. The descriptor's size bound still holds. Between `lstat` and open, though, only the earlier `lstat` symlink check applies. The Windows CI jobs will run the new test. This review was run on macOS only.
- **The store's read path.** `readSerializedJournal` follows symlinks and reads without a byte limit (`run-journal-store-v1.mjs:68-75`, `:86-95`). The documentation says hosts bound the input themselves (`docs/run-journal.md:76`). Whether the store should accept a `maxBytes` option is an API decision. `nisi validate` now does that bounding itself before it calls the store.
- **A FIFO swapped in before the open (follow-up).** If the file is replaced by a FIFO between `lstat` and open, the open blocks until a writer appears. The descriptor's `fstat` then refuses it as `NOT_A_FILE`, but only after the open returns. This was already true with `readFileSync` before this change. Adding `O_NONBLOCK` to the open flags would make it fail at once; it is left for a follow-up.
- **Current consumers.** A search of the AGIW Suite, AGIW MCP and Jaryo repositories found the journal only as vendored copies and in documentation, with no runtime reader making decisions from it. A host outside these repositories might exist, and this review did not look for one.
- **Temp file names.** A temp name contains the SHA-256 of the new content (`run-journal-store-v1.mjs:133`). Anyone who can list the directory, even without read access, could use it to confirm a guess of the whole file. The practical impact seems negligible, but it has not been assessed further.

## Format migration constraints

- **v1 is closed to new fields.** The header, record, envelope and footer are all checked for an exact set of keys (`run-journal-v1.mjs:179`, `:186`, `:190-191`; `run-journal-store-v1.mjs:36`, `:41-43`, `:50`). A MAC or key-ID field cannot be added to v1 without breaking every v1 reader. Authentication therefore needs a new schema string (for example `nisi-run-journal-v2`) and new domain-separation prefixes (`.../v2`).
- **v1 readers fail closed on v2.** A v1 reader refuses any header whose schema is not `nisi-run-journal-v1`, with `INVALID`/`HEADER`. That refusal is the safe direction.
- **No in-place upgrade.** Following `AGENTS.md` ("do not repair journals or fingerprints silently"), a v1 file should never be upgraded in place. Migration should copy forward: a host reads v1 (which stays unauthenticated), re-appends into a new v2 journal, and records the source file's SHA-256 in that first v2 entry or in its header. v1 files remain readable but never authenticated.
- **The serializer is part of the format.** The journal's key order (UTF-16 code units) is part of the hashed bytes (`docs/architecture.md`, journal boundary). Any v2 must keep that order or define it again.

## Recommended fixes, ranked

1. **R1: an external anchor (design, before any authentication feature).** Without a trusted record of the last good digest, neither F2 nor F3 can be detected. The smallest complete answer is for the host to store `(projectId, count, lastHash)` from each successful write somewhere the journal's writer cannot change. On read, it checks that the file's footer extends that anchor: same prefix and a count that has not gone down. This works with v1 and needs no format change. It does need a public helper, for example `chainTip(serialized)` that returns `{count, lastHash}`, and a written rule for hosts.
2. **R2: keyed authentication in v2 (design).** An HMAC-SHA-256 over the header hash and the footer (`count`, `lastHash`, a new random `journalId`), with a `keyId`, would authenticate "a holder of the key". It would not identify a specific writer, and it would not prevent replay of an older MAC'd file unless R1's anchor is also kept. Per-writer signatures (for example Ed25519) are needed only if attribution matters. Decide the key owner and rotation before choosing.
3. **R3: host-supplied expectations on reopen (small API addition, follow-up).** Add an optional second argument, `reopen(serialized, {projectId, redactPaths, maxNow})`, that refuses a mismatch with a named reason. This closes F4 and F5 for read-only consumers without changing the format. Existing one-argument calls keep their behaviour.
4. **R4: documentation (follow-up).** In `docs/run-journal.md` (Authenticity) and `SECURITY.md`, state that truncation to an earlier entry and replay of an older copy need no rehashing, and that the header supplies its own redaction and project policy on reopen.
5. **R5: a store read limit (optional).** Add `maxBytes` to `readSerializedJournal` and refuse symlinked reads to match writes. `validate` already bounds its reads after this change.

## For the Jaryo Nisi-journal adaptor

The adaptor notes already say that "records are trusted as written" (`ADAPTOR-V0.md`, finding 5). A Nisi journal does not change that. `COMPLETE` and `verified: true` mean the format and chain are intact, not that the events happened. Until R1 or R3 exists, an adaptor reading a Nisi journal should:

- check the header `projectId` against its manifest;
- use its own clock instead of the header `now`;
- bound input bytes before `reopen`, as `nisi validate` now does;
- label the view "unauthenticated" and never show OK only because a journal is `COMPLETE`.

## Verification

| Check | Result |
|---|---|
| Seven reproduction scripts (R1 rewrite, R2 rollback, R3 policy, R4 watermark, R5 size, R6 leaks, R7 writers and canonical form) | Run on macOS with Node 24 (v24.22.2), outside the repository. Results are as quoted above. R5 was run against both `239611c` (`PASS`) and this change (`FAIL FILE_TOO_LARGE`). |
| `node --test tests/validate-data.test.mjs` | The three new tests fail on `239611c` and pass with the fix. Removing the `FILE_CHANGED` check fails the growth test; opening with plain `'r'` instead of `O_NOFOLLOW` fails the symlink-swap test. Full counts are in the pull request. |
| Windows | `NOT_RUN` locally. It runs in CI. |
