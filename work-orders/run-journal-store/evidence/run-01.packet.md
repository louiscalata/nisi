---
packet: nisi-run-journal-store-v1
project_root: /Users/louiscalata/nisi-next-private/work-orders/run-journal-store
created_by: codex
created: 2026-09-13T13:43:59-07:00
write_owner: opencode
status: ready
---

# U02-04 — run-journal disk store v1

## Context

This is an isolated private dependency-free ESM work order, Node v24.18.0,
npm 11.16.0. Astra authored the protected tests BEFORE implementation. Measured
placeholder baseline `npm test` passes 2/2 and the discriminating
`npm run test:store` fails all 16 tests, with zero skipped/cancelled. Tests use
real temporary directories and a recording injected fs with fault injection.
Implement the one source file from this contract. Read the protected tests if
needed; their content is immutable. Do not explore the parent repository.

Export exactly two SYNCHRONOUS functions:

```text
writeSerializedJournal({ path, serialized, fs, expectedPreviousSha256 })
readSerializedJournal({ path, fs })
```

Optional expectedPreviousSha256 is the SHA-256 of the previous raw serialized
UTF-8 bytes, lowercase 64-hex, never a new content hash or envelope hash.
No stored outer envelope: ON-DISK BYTES MUST EQUAL Buffer.from(serialized,'utf8').
Imports may only be deterministic createHash from node:crypto and helpers from
node:path. Buffer is available globally. No ambient fs, clock, randomness,
configuration, logging, network or application-module dependency. The caller
owns a trusted directory and serializes all writers. Recheck before rename as
specified, but do not claim a cross-process CAS lock or hostile-directory safety.
No parent-directory creation. Path is a nonempty string without NUL.

### Injected fs and results

The fs object exposes sync methods with native Node signatures: readFileSync
(called WITHOUT an encoding, returning Buffer), openSync, writeSync, fsyncSync,
closeSync, renameSync, unlinkSync. There is no existsSync/stat requirement.
Tests' recording double exposes only these methods; it forwards to real fs.
All disk activity MUST go through this object. Inputs/fs are trusted ordinary
objects, not hostile getters or Proxies. Catch malformed data and ordinary I/O
exceptions and return REFUSED; do not throw for these cases. Invalid path/fs
arguments return INVALID_INPUT. Missing fsyncSync is supported as a failed sync,
NOT an invalid fs. No asynchronous functions or promises.

Every returned result includes `durable` boolean, `fsync:{file:boolean,
directory:boolean}` and `fsyncErrors:{file:null|string,directory:null|string}`.
Default sync flags are false and errors null (not attempted). A successful
fsyncSync call sets its flag true. Failure records error.code if a nonempty
string, otherwise a nonempty fallback such as FSYNC_FAILED. Missing fsyncSync
records a nonempty error for each attempt. Directory open/close errors count as
directory sync failures, recorded under directory. No swallowed sync evidence.

Results:
- WRITTEN: `{status:'WRITTEN',sha256,bytes,verified:true,committed:true,...}`.
  `bytes` is UTF-8 byte length. `durable` is true ONLY when BOTH file and
  directory fsyncs succeeded, closes succeeded and final exact-byte verification
  succeeded. Successful fsync calls are an observation, not power-loss proof.
- UNCHANGED: same-byte no-op, includes sha256,bytes,verified:true,
  `committed:false,durable:false`; no mutating operations and no fsync attempted.
- READ: `{status:'READ',serialized,sha256,bytes,verified:true,committed:false,
  durable:false,...}`. A read never proves that anyone previously flushed data.
- REFUSED: `{status:'REFUSED',reason,committed,durable:false,...}`. Do not expose
  `serialized` or a recovered prefix. `committed` is true iff this call already
  renamed its temp to destination; false before rename and always false on read.
  Even if both sync flags are true, failed verification MUST be durable:false.

Reason vocabulary: INVALID_INPUT, INVALID_JOURNAL, NOT_FOUND, READ_FAILED,
EXISTING_INVALID, CONFLICT, WRITE_FAILED, RENAME_FAILED, READBACK_MISMATCH.
All other operation errors map to their stage, never arbitrary success.

### Raw journal framing and integrity validator

Use ONE shared nonthrowing validator for read and write. It checks storage
framing and chain integrity, NOT full journal-entry semantic admission. Entry
identity, retention, retry/revocation and authority validation remain the product
journal's reopen responsibility. This module grants no execution authority.

Input must be a well-formed Unicode string (isWellFormed), newline-terminated,
at least two nonempty JSON lines, with no blank lines or trailing garbage. For
read, also require raw Buffer UTF-8 roundtrip equality: Buffer.from(decoded)
equals original Buffer; invalid UTF-8 cannot be silently replaced. Parse each
line and require canonical text equality; canonical JSON C recursively sorts
object keys lexically, preserves array order, uses compact JSON escaping and
no whitespace. Duplicate JSON keys and alternate encodings fail this equality.
Catch parse/recursion/data failures as INVALID_JOURNAL.

Framing shapes (require exact own keys and object/nonarray types at these levels):

```text
header = {type:'header',schema:'nisi-run-journal-v1',config,now}
envelope = {type:'entry',seq,previousHash,record,hash}
record = {entry,fingerprint,retained}
footer = {type:'footer',count,lastHash}
```

Header config must be a nonnull nonarray object, now a nonnegative safe integer.
Initial previousHash = SHA256('nisi-run-journal/header/v1\n' + C(header)).
All interior lines are entry envelopes with seq starting at 1 without gaps,
previousHash equal to the prior hash, record.entry a nonnull nonarray object,
record.fingerprint lowercase 64-hex and record.retained boolean. Envelope hash
must be lowercase 64-hex and equal to SHA256('nisi-run-journal/record/v1\n' +
C({seq,previousHash,record})). Advance previousHash to envelope.hash. Footer
must be the last line, count exactly the entry count and lastHash equal to the
final hash (header hash for zero entries). Unknown schema, incomplete entry,
missing footer or missing terminal newline refuses. Tests carry independent
canonical fixtures including multibyte text and a valid zero-entry journal.
Do not import/copy the product journal implementation or widen validation to
unrequested full entry semantics. Checksums detect accidental damage, not forgery.

### Read operation

Validate path and read capability. readFileSync(path) ENOENT -> NOT_FOUND;
other read exceptions -> READ_FAILED. Bytes failing the validator ->
INVALID_JOURNAL. Valid bytes -> READ result above. No writes, opens, syncs or
cleanup during a read, and no dependence on a prior write in this module.

### Write operation and compare-before-replace

1. Validate path/fs, serialized and expectedPreviousSha256 BEFORE any disk
   mutation. Invalid serialization -> INVALID_JOURNAL, malformed expected hash
   -> INVALID_INPUT. Compute the exact Buffer, its byte count and SHA-256.
2. Read the existing destination without encoding. ENOENT means absent; other
   exceptions -> READ_FAILED. Existing malformed bytes -> EXISTING_INVALID even
   when expectedPreviousSha256 matches their hash. Never auto-repair corruption.
3. Absent + supplied expected hash -> CONFLICT. Present + supplied expected
   hash not equal to actual existing SHA-256 -> CONFLICT (including same-byte
   writes). Present + different new bytes + no expected hash -> CONFLICT.
   Present + same bytes and no conflicting expected hash -> UNCHANGED. Only
   readFileSync may have run on these paths; preserve existing bytes untouched.
4. For a new write/update create a temp sibling using deterministic name
   `path + '.' + newSha256 + '.tmp'`. openSync(temp,'wx',0o600) ensures exclusive
   creation; a collision is WRITE_FAILED. Do not remove any file unless this
   invocation successfully opened/owns it. Never open destination for writing.
5. Write Buffer using writeSync(fd,buffer,offset,remaining,null) in a loop until
   every byte is written. Support short positive writes. Noninteger, negative,
   overlarge or zero progress -> WRITE_FAILED. Attempt fsyncSync on the file,
   recording success/failure; a failed fsync is best effort and does not stop the
   byte-safe write. Close file; close failure -> WRITE_FAILED before rename.
   Clear the owned descriptor reference BEFORE attempting close. Do not retry
   a failed close: it may have already released that descriptor.
6. Read the temp back without encoding and compare exact Buffer bytes. Read
   exception or inequality -> READBACK_MISMATCH. Record no verified success.
7. Read destination again immediately before rename. It must have the same
   presence and byte content observed at step 2; an observed change -> CONFLICT,
   preserving the new external bytes. Non-ENOENT read failure -> READ_FAILED.
   This mitigates observed interference; caller serialization is still required.
8. renameSync(temp,path) commits; failure -> RENAME_FAILED, old bytes unchanged.
   After success mark committed=true and relinquish temp ownership.
9. openSync(dirname(path),'r'), fsyncSync(directoryFd), closeSync(directoryFd).
   These are best effort with explicit fsyncErrors.directory; write can succeed
   as non-durable if they fail. Close each opened directory descriptor at most
   once; clear its reference before attempting close.
10. Read destination back and compare exact bytes to the input. Exceptions or
    mismatch -> READBACK_MISMATCH with committed:true,durable:false. Do not try
    a dangerous rollback after rename. Otherwise WRITTEN with computed hash,
    bytes, verified:true and durability derived only from the recorded syncs.

On pre-rename errors close any open descriptor and remove ONLY the owned temp,
best effort. Cleanup must never throw over the result. If cleanup itself fails,
record a nonempty `cleanupError` rather than claiming complete cleanup. Do not
unlink the destination or any preexisting colliding temp. No infinite retry.

## Constraints

- Write ONLY `src/run-journal-store-v1.mjs`. All tests, package.json, roadmap.md,
  evidence and .packets are protected. No parent/sibling access or writes.
- Do not modify tests, disable assertions, inspect test names to branch behavior,
  hardcode fixtures or bypass the fs injection. No new exports or dependencies.
- No test execution, shell commands, config edits, worker dispatch, nested
  packets, receipt calls, commit or push by the executor. Outer wrapper owns
  deterministic acceptance and receipts; author reads and reruns tests afterward.
- No ambient clock/random/fs/network effects or dynamic imports/evaluation. The
  baseline also scans source/comments for forbidden ambient API names.
- Local tier is pinned by the launcher. Never load/switch models yourself.
- No host integration, locking protocol, platform acceptance or roadmap closure.

## Items

### P1 — Implement byte-preserving atomic disk store with honest durability
- **files**: src/run-journal-store-v1.mjs
- **do**: Replace the placeholder with the two synchronous store functions implementing the complete contract above. Keep tests and all other paths read-only. Write a compact readable module using only injected fs and deterministic crypto/path helpers. The wrapper runs the protected store tests and baseline after your source edit; do not run commands or decide acceptance yourself.
- **accept**: npm run test:store

## Packet acceptance
npm test
