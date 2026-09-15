---
packet: nisi-run-journal-store-v1
project_root: /Users/louiscalata/nisi-next-private/work-orders/run-journal-store
created_by: codex
created: 2026-09-13T13:43:59-07:00
write_owner: opencode
status: done
---

# U02-04 store — install the verified reference

## Context

SECOND AND FINAL AUTHORIZED LOCAL ATTEMPT: MECHANICAL INSTALLATION ONLY.
The first run timed out at 900 seconds after repeated file reads and zero edits.
The author has now completely resolved the implementation, not only its design.
COPY THE EXACT JAVASCRIPT below into `src/run-journal-store-v1.mjs` using the
write tool. Read the target once only if the write tool requires that precondition.
Do not list directories, read tests/package/evidence, redesign, reason through
the functions, run commands or write a receipt. The task is exact text copying.

Astra authored and inspected this reference, then tested it against byte-identical
copies of the original protected tests/package: store 16/16 PASS, baseline 2/2
PASS. The real target remains the unchanged placeholder: baseline 2/2 PASS and
store 0/16 PASS. The tests have NOT been changed since the first packet launch.
This is a private dependency-free ESM project, Node v24.18.0, npm 11.16.0.

The source implements the two synchronous injected-fs APIs, raw UTF-8 JSONL
framing/hash-chain/footer validation, exclusive same-directory temp and rename,
short-write completion, guarded overwrite, exact temp/final readback, recorded
file/directory fsync and conservative durable flags. It assumes caller-serialized
writers in a trusted directory; it grants no history/execution authority.

Expected complete source SHA-256: `fa1817d924471cbf6307f9583c5f513f6e6aa97eee61ce8445f9addc13c1163a`.
Copy every line, including imports and final newline. Do not add markdown fences
to the source file. No implementation decisions remain for the executor.

### Exact owner-reviewed installation reference

```javascript
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : object(value) ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);
const errorCode = error => typeof error?.code === 'string' && error.code ? error.code : 'IO_ERROR';
const validPath = path => typeof path === 'string' && path.length > 0 && !path.includes('\0');
const hasMethods = (fs, names) => fs != null && names.every(name => typeof fs[name] === 'function');
const initial = () => ({ durable: false, committed: false, fsync: { file: false, directory: false }, fsyncErrors: { file: null, directory: null } });
const refusal = (state, reason) => ({ ...state, status: 'REFUSED', reason, durable: false });

function validJournal(serialized) {
  try {
    if (typeof serialized !== 'string' || !serialized.isWellFormed() || !serialized.endsWith('\n')) return false;
    const lines = serialized.slice(0, -1).split('\n');
    if (lines.length < 2 || lines.some(line => !line)) return false;
    const values = lines.map(line => {
      const value = JSON.parse(line);
      if (canonical(value) !== line) throw new Error('NONCANONICAL');
      return value;
    });
    const header = values[0];
    if (!exact(header, ['type', 'schema', 'config', 'now']) || header.type !== 'header' || header.schema !== 'nisi-run-journal-v1'
      || !object(header.config) || !Number.isSafeInteger(header.now) || header.now < 0) return false;
    let previousHash = digest('nisi-run-journal/header/v1\n' + lines[0]);
    for (let index = 1; index < values.length - 1; index++) {
      const value = values[index];
      if (!exact(value, ['type', 'seq', 'previousHash', 'record', 'hash']) || value.type !== 'entry'
        || value.seq !== index || value.previousHash !== previousHash || !hex(value.hash)
        || !exact(value.record, ['entry', 'fingerprint', 'retained']) || !object(value.record.entry)
        || !hex(value.record.fingerprint) || typeof value.record.retained !== 'boolean') return false;
      const expected = digest('nisi-run-journal/record/v1\n' + canonical({ seq: value.seq, previousHash: value.previousHash, record: value.record }));
      if (value.hash !== expected) return false;
      previousHash = value.hash;
    }
    const footer = values.at(-1);
    return exact(footer, ['type', 'count', 'lastHash']) && footer.type === 'footer'
      && footer.count === values.length - 2 && footer.lastHash === previousHash;
  } catch {
    return false;
  }
}

function decode(bytes) {
  if (!Buffer.isBuffer(bytes)) return null;
  const serialized = bytes.toString('utf8');
  return Buffer.from(serialized, 'utf8').equals(bytes) && validJournal(serialized) ? serialized : null;
}

function existingBytes(fs, path) {
  try {
    const bytes = fs.readFileSync(path);
    return { bytes, absent: false };
  } catch (error) {
    return error?.code === 'ENOENT' ? { bytes: null, absent: true } : { error: 'READ_FAILED' };
  }
}

function syncFile(fs, fd, state, kind) {
  try {
    fs.fsyncSync(fd);
    state.fsync[kind] = true;
  } catch (error) {
    state.fsyncErrors[kind] = errorCode(error);
  }
}

export function readSerializedJournal(options) {
  const state = initial();
  if (!options || !validPath(options.path) || !hasMethods(options.fs, ['readFileSync'])) return refusal(state, 'INVALID_INPUT');
  const found = existingBytes(options.fs, options.path);
  if (found.error) return refusal(state, found.error);
  if (found.absent) return refusal(state, 'NOT_FOUND');
  const serialized = decode(found.bytes);
  if (serialized === null) return refusal(state, 'INVALID_JOURNAL');
  return { ...state, status: 'READ', serialized, sha256: digest(found.bytes), bytes: found.bytes.length, verified: true };
}

export function writeSerializedJournal(options) {
  const state = initial();
  if (!options || !validPath(options.path) || !hasMethods(options.fs, ['readFileSync', 'openSync', 'writeSync', 'closeSync', 'renameSync', 'unlinkSync'])) return refusal(state, 'INVALID_INPUT');
  const { path, serialized, fs, expectedPreviousSha256 } = options;
  if (!validJournal(serialized)) return refusal(state, 'INVALID_JOURNAL');
  if (expectedPreviousSha256 !== undefined && !hex(expectedPreviousSha256)) return refusal(state, 'INVALID_INPUT');
  const bytes = Buffer.from(serialized, 'utf8');
  const sha256 = digest(bytes);
  const before = existingBytes(fs, path);
  if (before.error) return refusal(state, before.error);
  if (!before.absent && decode(before.bytes) === null) return refusal(state, 'EXISTING_INVALID');
  if (expectedPreviousSha256 !== undefined && (before.absent || digest(before.bytes) !== expectedPreviousSha256)) return refusal(state, 'CONFLICT');
  if (!before.absent) {
    if (before.bytes.equals(bytes)) return { ...state, status: 'UNCHANGED', sha256, bytes: bytes.length, verified: true };
    if (expectedPreviousSha256 === undefined) return refusal(state, 'CONFLICT');
  }

  const temp = path + '.' + sha256 + '.tmp';
  let fd = null;
  let ownedTemp = false;
  const cleanup = () => {
    if (fd !== null) {
      const closing = fd;
      fd = null;
      try { fs.closeSync(closing); } catch (error) { state.cleanupError = errorCode(error); }
    }
    if (ownedTemp) {
      ownedTemp = false;
      try { fs.unlinkSync(temp); } catch (error) { state.cleanupError = errorCode(error); }
    }
  };
  const fail = reason => {
    cleanup();
    return refusal(state, reason);
  };
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    ownedTemp = true;
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.writeSync(fd, bytes, offset, bytes.length - offset, null);
      if (!Number.isSafeInteger(count) || count <= 0 || count > bytes.length - offset) return fail('WRITE_FAILED');
      offset += count;
    }
    syncFile(fs, fd, state, 'file');
    const closing = fd;
    fd = null;
    try { fs.closeSync(closing); } catch (error) {
      state.cleanupError = errorCode(error);
      return fail('WRITE_FAILED');
    }
  } catch {
    return fail('WRITE_FAILED');
  }

  const matches = target => {
    try {
      const actual = fs.readFileSync(target);
      return Buffer.isBuffer(actual) && actual.equals(bytes);
    } catch { return false; }
  };
  if (!matches(temp)) return fail('READBACK_MISMATCH');
  const current = existingBytes(fs, path);
  if (current.error) return fail(current.error);
  if (current.absent !== before.absent || !current.absent && (!Buffer.isBuffer(current.bytes) || !current.bytes.equals(before.bytes))) return fail('CONFLICT');
  try { fs.renameSync(temp, path); } catch { return fail('RENAME_FAILED'); }
  state.committed = true;
  ownedTemp = false;

  let directoryFd = null;
  try {
    directoryFd = fs.openSync(dirname(path), 'r');
    syncFile(fs, directoryFd, state, 'directory');
  } catch (error) {
    state.fsyncErrors.directory = errorCode(error);
  } finally {
    if (directoryFd !== null) {
      const closing = directoryFd;
      directoryFd = null;
      try { fs.closeSync(closing); } catch (error) {
        state.fsync.directory = false;
        state.fsyncErrors.directory = errorCode(error);
        state.cleanupError = errorCode(error);
      }
    }
  }
  if (!matches(path)) return refusal(state, 'READBACK_MISMATCH');
  return { ...state, status: 'WRITTEN', sha256, bytes: bytes.length, verified: true, durable: state.fsync.file && state.fsync.directory };
}
```

## Constraints

- Write ONLY `src/run-journal-store-v1.mjs`; the exact reference is above.
- Tests, package.json, roadmap.md, evidence and .packets are protected; do not
  read or modify them. Read only this packet and the listed target source.
- No parent/sibling access, directory listing, dependencies, installation, shell
  commands, tests, receipt calls, nested packets, worker dispatch or model loads.
- Do not change the packet/status yourself. The wrapper owns the receipt.
- No commit/push or host/product integration. No new code design is requested.

## Items

### P1 — Install exact reviewed disk store source
- **files**: src/run-journal-store-v1.mjs
- **do**: Mechanically replace the target with the EXACT fenced JavaScript in this packet, preserving all bytes and final newline. Expected SHA-256 fa1817d924471cbf6307f9583c5f513f6e6aa97eee61ce8445f9addc13c1163a. Only call the source read/write tools needed for that copy. Do not redesign, read other files, run tests or claim acceptance; the wrapper runs all unchanged protected checks.
- **accept**: npm run test:store

## Packet acceptance
npm test
