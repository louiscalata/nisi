---
packet: nisi-journal-restart-recovery
project_root: /Users/louiscalata/nisi-next-private/work-orders/journal-restart-recovery
created_by: codex
created: 2026-09-13T15:35:00-07:00
write_owner: opencode
status: blocked
---

# Nisi — real-process journal restart recovery adapter

## Context

Independent private work-order test adapter, NOT the production host bundle.
Node v24.18.0, ESM, no dependencies. npm test was executed: baseline 2/2 PASS.
npm run test:recovery was executed against the placeholder: 0/10 PASS, ten expected
unfinished-work failures. Protected tests run a NEW real Node process per request,
with fixed CLI and owned synthetic files. Tests retain fixtures under .scratch/.

Implement only src/recovery-worker.mjs. It exports synchronous
runRecoveryRequest(input). fixtures/worker-cli.mjs already owns stdin parsing and
the one-line response envelope. DO NOT implement a new process runner or CLI.
The function returns a plain JSON-safe object and NEVER throws for malformed
ordinary JSON input or any represented filesystem/journal error.

Read the protected tests/recovery.test.mjs and the two frozen modules. The
executor may read these exact files. No need to explore a parent directory.

Frozen dependencies (must NOT edit):
- frozen/run-journal-v1.mjs: createRunJournal(config), reopen(serialized).
  Journal API: append(entry, now), list(now), serialize(). CLOSED config keys:
  projectId, maxEntries (1..10000), heartbeatTtlMs (>0), redactPaths ([] or payload.*
  paths). append returns APPENDED/DUPLICATE/CONFLICT/REFUSED or throws error.code.
  Entries have exactly id,projectId,runId,attempt,candidateId,stage,receiptId,
  createdAt,ttlMs,state,heartbeatAt,retryOf,revokes,payload. Follow the frozen code;
  do not duplicate its validation, fingerprint, redaction, retry or revocation logic.
  list(now) returns frozen rows with entry,historical,retained,revoked,expired,
  liveness,authorizing:false. RUNNING liveness becomes UNKNOWN when heartbeat is
  missing/stale and EXPIRED at TTL; this is the journal's existing behavior.
  reopen returns {journal,report}; report keys status,recoveredIds,rejectedLine,
  reason,authorizing:false. COMPLETE is semantically valid; INCOMPLETE/INVALID
  returns sealed journal (or null on invalid header). Never unseal it.
- frozen/run-journal-store-v1.mjs: writeSerializedJournal({path,serialized,fs,
  expectedPreviousSha256?}), readSerializedJournal({path,fs}).
  Store validates framing/hash chain NOT full journal semantics.
  READ supplies serialized,sha256,bytes; failures REFUSED with reason.
  WRITTEN has committed,durable,verified,fsync,fsyncErrors,sha256,bytes.
  UNCHANGED/READ are never durable:true. Checksums are not authentication.
Use real node:fs passed as fs to the accepted store. No dependency installs.

### Response shape — exact keys in this insertion order for EVERY result

{ status, reason, store, recovery, rows, append, sha256, bytes,
  authorizing: false, isolationAccepted: false, generatedCodeExecuted: false }

Default values: reason/store/recovery/sha256/bytes = null; rows/append = [].
store contains the actual store return when called (including its raw fields);
recovery contains actual frozen reopen report when allowed below.
No new persisted/verified/eligible/retry/auto-resume flags.
WRITTEN is a store operation name, not a universal durability claim:
carry durable and fsync errors unchanged. Parent acceptance separately requires
successful file and directory fsync for its ordinary successful-write cases.

### Common request validation

Input ordinary JSON object, not null/array. Exactly the command's enumerable keys.
command must be write/inspect/replay. path nonempty absolute string with no NUL;
now nonnegative safe integer excluding -0.
Expected projectId must match /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.
The path must name journal.jsonl inside an existing real directory beneath this
work order's .scratch directory. Use node:path and fileURLToPath/import.meta.url to
locate .scratch; realpath the parent and verify its boundary. Existing targets
must be regular non-symlink files. Never create parent directories or write
outside this test-owned scope. A missing target file is allowed; missing parent,
symlink target, outside path or invalid shape -> REFUSED/INVALID_INPUT,
empty rows/append and null other default fields.
No reads of arbitrary paths. Tests supply only owned synthetic data.

### write

Exact input keys: command,path,config,entries,now.
entries is an array of at most 100 entries, config ordinary non-null object.
1. createRunJournal(config), then append every entry at supplied now in order.
   Require APPENDED for all. If an append is not APPENDED, refuse with reason
   equal to that append.reason or append.status; no disk write. Invalid config,
   entries or time: REFUSED reason error.code (CONFIG/ENTRY/TIME/etc.), empty rows.
2. Serialize the resulting journal and call writeSerializedJournal({path,
   serialized,fs}) ONCE. Do not supply expectedPreviousSha256; this command does
   not authorize replacing different existing contents.
3. WRITTEN or UNCHANGED -> status equals store.status, reason null, store exact,
   rows journal.list(now), append array of all append results, sha256/bytes from store,
   recovery null. Carry durable:false truthfully if the store reports it.
4. Store REFUSED -> REFUSED with its reason, store exact, no rows; no retry.

### inspect

Exact input keys: command,path,projectId,now.
Call readSerializedJournal({path,fs}).
- REFUSED NOT_FOUND/READ_FAILED/INVALID_INPUT -> REFUSED with same reason, store
  exact, no recovery/rows. Do not create an empty journal.
- READ -> use exact serialized text. INVALID_JOURNAL -> read the same file as
  Buffer, check Buffer.from(buffer.toString('utf8'),'utf8').equals(buffer).
  Invalid UTF8 -> SEALED/INVALID_UTF8, store exact,
  recovery {status:'INVALID',recoveredIds:[],rejectedLine:1,reason:'UTF8',authorizing:false},
  rows [], sha256/bytes null. A read error -> REFUSED/READ_FAILED.
- For valid text ALWAYS call authoritative reopen, even when the store says READ.
  A structurally valid store READ can still reopen INVALID.
- If reopen.journal is non-null, it implies a valid recovered header:
  parse the first line and compare header.config.projectId to requested projectId.
  Mismatch takes precedence over exposing COMPLETE/INCOMPLETE/INVALID prefix
  rows: REFUSED/PROJECT_MISMATCH, store exact, recovery null, rows [], hash/bytes null.
  No valid header means no project comparison; expose no rows.
- If header matches, obtain journal.list(now) or [] if null. TIME or another
  thrown code -> REFUSED with that code, store exact, rows [], recovery null.
- COMPLETE -> OPEN, reason null; INCOMPLETE/INVALID -> SEALED,
  reason report.reason. Include report, rows.
  sha256/bytes use store values only for READ; otherwise null.
Inspect never calls the store writer or mutates disk. BOM/noncanonical bytes are
left to authoritative reopen; never strip/rewrite text to make it acceptable.

### replay

Exact input keys: command,path,projectId,entry,now.
Use the SAME read/decode/project/semantic path as inspect. If its result REFUSED,
return it. If SEALED, return REFUSED/SEALED, retain store/recovery diagnostics,
rows [] and no append. Do not recreate an unsealed journal.
On OPEN, call reopened journal.append(input.entry,now) exactly once:
- DUPLICATE or CONFLICT -> status = append.status, reason = append.reason or null,
  store remains original READ result, recovery same, rows current list(now),
  append [appendResult], original read sha256/bytes.
- APPENDED or other outcome -> REFUSED/UNEXPECTED_APPEND, rows [], append [],
  no write, original store/recovery/hash/bytes may remain. Discard this in-memory
  journal; it is never persisted. Do not compute your own equality.
- thrown journal error -> REFUSED with error.code or IO_ERROR, rows [].
Replay never invokes writeSerializedJournal or any write operation.

### Error/side-effect boundary

Use a top-level try/catch: unexpected fs/read failures return REFUSED/IO_ERROR,
never fabricated success. Validation precedence common keys/path then command
body. Missing file is NOT_FOUND only for valid inspect/replay.
Allowed imports only frozen journal/store, node:fs, node:path, node:url.
No child_process, networking, models, ambient clocks, random numbers, eval,
dynamic code generation, global changes, or import-time I/O.
The target function may read/write only through the described operations.

## Constraints

- Only src/recovery-worker.mjs may be edited. Everything else is protected:
  tests/, fixtures/, frozen/, package.json, roadmap.md, .packets/, evidence/.
- No parent-tree access. Another Claude/OpenCode job owns host-journal-bundle.
- Do not alter tests, pins, acceptance commands, or frozen modules to get DONE.
- Do not execute commands/tests or nested packets yourself. The installed wrapper
  executes the inspected accepts and owns the final receipt.
- Private only. No public commits, pushes, README, packages, uploads beyond this
  bounded approved executor context, model calls, dependencies or settings changes.
- Completion proves this adapter and its fixed recovery tests only, not host
  bundle integration, native generated-code execution, power-loss durability,
  concurrent-writer safety, failure-memory eligibility, auto-resume or NX closure.

## Items

### P1 — Implement the exact synchronous recovery adapter
- **files**: src/recovery-worker.mjs
- **do**: Replace NOT_IMPLEMENTED with runRecoveryRequest implementing the exact input/output, controlled write, authoritative read/project/sealed recovery, and read-only duplicate/conflict replay contracts above. Preserve the frozen dependency implementations.
- **accept**: npm run test:recovery

## Packet acceptance
npm test
