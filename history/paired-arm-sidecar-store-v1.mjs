// PRIVATE append-only evidence. The codec owns record validation and chain bytes;
// this module owns bounded local-file admission, acknowledgement, and read-only
// reconciliation. It does not authorize, replay, resume, or authenticate data.
import fs from 'node:fs';
import path from 'node:path';
import { record } from '../evaluation/intake-v1.mjs';
import { cloneFreeze } from '../workflow/contracts.mjs';
import { resolveExternalDemoStateV1, recheckExternalDemoStateV1 } from '../hosts/repository/demo-state-v1.mjs';
import { SIDECAR_LIMITS, encodeArmSidecarRecordV1, decodeArmSidecarRecordV1 } from './paired-arm-sidecar-codec-v1.mjs';

const SOURCE_ROOT = path.resolve(import.meta.dirname, '..');
const NAME = 'arm-sidecar.jsonl';
const noFollow = fs.constants.O_NOFOLLOW;
const ioKeys = ['openSync', 'closeSync', 'writeSync', 'readSync', 'fstatSync', 'fsyncSync'];
const fail = code => { throw Object.assign(Error(code), { code }); };
const identity = stat => ({
  dev: String(stat.dev), ino: String(stat.ino), mode: stat.mode, nlink: stat.nlink,
  uid: typeof stat.uid === 'number' ? stat.uid : null,
});
const sameIdentity = (a, b) => a.dev === String(b.dev) && a.ino === String(b.ino) &&
  a.mode === b.mode && a.nlink === b.nlink && a.uid === (typeof b.uid === 'number' ? b.uid : null);
const currentUid = () => typeof process.getuid === 'function' ? process.getuid() : null;

function ioMethods(dependencies) {
  const { io } = record(dependencies, ['io']);
  return Object.fromEntries(ioKeys.map(key => {
    const fn = Object.getOwnPropertyDescriptor(io, key)?.value;
    if (typeof fn !== 'function') fail('SIDECAR_IO');
    return [key, fn.bind(io)];
  }));
}

function checkPrivateDirectory(observation) {
  const stat = fs.lstatSync(observation.directory);
  const uid = currentUid();
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) ||
      (uid !== null && stat.uid !== uid) ||
      String(stat.dev) !== observation.dev ||
      String(stat.ino) !== observation.ino) fail('SIDECAR_DIRECTORY_CHANGED');
}

function checkNamedOpened(io, fd, file, fileIdentity, expectedSize) {
  const named = fs.lstatSync(file);
  const opened = io.fstatSync(fd);
  const uid = currentUid();
  for (const stat of [named, opened]) {
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 ||
        (stat.mode & 0o077) || (uid !== null && stat.uid !== uid)) fail('SIDECAR_FILE_CHANGED');
  }
  if (!sameIdentity(fileIdentity, named) || !sameIdentity(fileIdentity, opened) ||
      named.size !== expectedSize || opened.size !== expectedSize) fail('SIDECAR_FILE_CHANGED');
  return { named, opened };
}

function fsyncDirectory(io, directory) {
  const dirFd = io.openSync(directory, fs.constants.O_RDONLY | noFollow | fs.constants.O_DIRECTORY);
  try { io.fsyncSync(dirFd); } finally { io.closeSync(dirFd); }
}

function readExact(io, fd, size, start = 0) {
  if (!Number.isSafeInteger(size) || size < 0 || size > SIDECAR_LIMITS.maxBytes) fail('SIDECAR_READ');
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < bytes.length) {
    const count = io.readSync(fd, bytes, offset, bytes.length - offset, start + offset);
    if (!Number.isSafeInteger(count) || count <= 0 || count > bytes.length - offset) fail('SIDECAR_EOF');
    offset += count;
  }
  const end = io.readSync(fd, Buffer.alloc(1), 0, 1, start + size);
  if (end !== 0) fail('SIDECAR_EOF');
  return bytes;
}

function snapshot(state) {
  return cloneFreeze({
    schemaVersion: 'nisi-paired-arm-sidecar-store-v1', file: state.file, state: state.state,
    reason: state.reason, failureCause: state.failureCause, retainedRecords: state.ordinal,
    byteLength: state.byteLength, lastSha256: state.previousSha256, finalSeen: state.finalSeen,
    retentionCountSemantics: 'FULLY_CONFIRMED_STORE_OPERATIONS',
    durability: 'OS_FSYNC_ACKNOWLEDGEMENT_ONLY', powerLossVerified: false,
    hostileWriterIsolation: false, authorizing: false, resumable: false,
  });
}

export function createPairedArmSidecarStoreV1(input, dependencies = { io: fs }) {
  const { directory } = record(input, ['directory']);
  const parent = resolveExternalDemoStateV1(directory, SOURCE_ROOT);
  const io = ioMethods(dependencies);
  recheckExternalDemoStateV1(parent, SOURCE_ROOT);
  const file = path.join(parent.directory, NAME);
  let fd = null, fileIdentity = null, state = 'OPEN', busy = false;
  let ordinal = 0, byteLength = 0, previousSha256 = null, finalSeen = false;
  let reason = null, failureCause = null;
  const closeOwned = cause => {
    if (fd === null) return;
    const owned = fd; fd = null;
    try { io.closeSync(owned); } catch {
      failureCause ??= cause;
      state = 'COMMIT_UNCERTAIN'; reason = cause;
    }
  };
  const verify = () => {
    recheckExternalDemoStateV1(parent, SOURCE_ROOT);
    checkPrivateDirectory(parent);
    checkNamedOpened(io, fd, file, fileIdentity, byteLength);
  };
  try {
    fd = io.openSync(file, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_APPEND | noFollow, 0o600);
    fileIdentity = identity(io.fstatSync(fd));
    checkNamedOpened(io, fd, file, fileIdentity, 0);
    fsyncDirectory(io, parent.directory);
    verify();
  } catch {
    failureCause = 'SIDECAR_CREATE_UNCONFIRMED';
    state = 'COMMIT_UNCERTAIN'; reason = failureCause;
    closeOwned(failureCause);
    fail(failureCause);
  }
  async function retain(raw) {
    if (state !== 'OPEN' || busy || finalSeen) fail('SIDECAR_NOT_WRITABLE');
    busy = true;
    let writeAttempted = false;
    try {
      // The codec snapshots and validates the producer. Only its validated
      // record is inspected here; raw objects are never trusted for ordering.
      const encoded = encodeArmSidecarRecordV1(raw, ordinal, previousSha256);
      const event = encoded.record;
      if (ordinal === 0 && (event.kind !== 'HEADER' || previousSha256 !== null)) fail('SIDECAR_HEADER');
      if (ordinal > 0 && event.kind === 'HEADER') fail('SIDECAR_HEADER');
      if (finalSeen || (event.kind === 'FINAL' && ordinal === 0)) fail('SIDECAR_FINAL_ORDER');
      if (encoded.bytes.length > SIDECAR_LIMITS.maxRecordBytes ||
          byteLength + encoded.bytes.length > SIDECAR_LIMITS.maxBytes ||
          ordinal >= SIDECAR_LIMITS.maxRecords) fail('SIDECAR_CAPACITY');
      verify();
      let offset = 0;
      while (offset < encoded.bytes.length) {
        writeAttempted = true;
        const written = io.writeSync(fd, encoded.bytes, offset, encoded.bytes.length - offset, null);
        if (!Number.isSafeInteger(written) || written <= 0 || written > encoded.bytes.length - offset) fail('SIDECAR_WRITE');
        offset += written;
      }
      io.fsyncSync(fd);
      const found = readExact(io, fd, encoded.bytes.length, byteLength);
      if (!found.equals(encoded.bytes)) fail('SIDECAR_READBACK');
      const nextSize = byteLength + encoded.bytes.length;
      checkNamedOpened(io, fd, file, fileIdentity, nextSize);
      recheckExternalDemoStateV1(parent, SOURCE_ROOT);
      checkPrivateDirectory(parent);
      if (event.kind === 'FINAL') {
        closeOwned('SIDECAR_CLOSE_UNCONFIRMED');
        if (state !== 'OPEN') fail('SIDECAR_CLOSE_UNCONFIRMED');
      }
      // An operation is acknowledged only after every check and final close.
      byteLength = nextSize;
      previousSha256 = encoded.sha256;
      ordinal += 1;
      finalSeen = event.kind === 'FINAL';
      if (finalSeen) state = 'CLOSED';
    } catch {
      failureCause ??= writeAttempted ? 'SIDECAR_COMMIT_UNCONFIRMED' : 'SIDECAR_PREWRITE_REFUSED';
      reason = writeAttempted ? 'SIDECAR_COMMIT_UNCONFIRMED' : 'SIDECAR_PREWRITE_REFUSED';
      state = writeAttempted ? 'COMMIT_UNCERTAIN' : 'FAILED';
      closeOwned(failureCause);
      fail(reason);
    } finally { busy = false; }
  }
  function close() {
    if (busy) fail('SIDECAR_BUSY');
    if (state === 'OPEN') {
      try { verify(); } catch { failureCause ??= 'SIDECAR_FILE_CHANGED'; state = 'COMMIT_UNCERTAIN'; reason = 'SIDECAR_FILE_CHANGED'; }
      closeOwned('SIDECAR_CLOSE_UNCONFIRMED');
      if (state === 'OPEN') state = 'CLOSED';
    }
    return snapshot({ file, state, reason, failureCause, ordinal, byteLength, previousSha256, finalSeen });
  }
  return Object.freeze({ retain, inspect: () => snapshot({ file, state, reason, failureCause, ordinal, byteLength, previousSha256, finalSeen }), close });
}

function readableDirectory(value) {
  if (typeof value !== 'string' || !value.length || value.length > 4096 || value.includes('\0') || !path.isAbsolute(value)) fail('SIDECAR_DIRECTORY_INVALID');
  const named = fs.lstatSync(path.resolve(value));
  if (!named.isDirectory() || named.isSymbolicLink()) fail('SIDECAR_DIRECTORY_INVALID');
  const directory = fs.realpathSync(value);
  const source = fs.realpathSync(SOURCE_ROOT);
  const stat = fs.lstatSync(directory);
  const relative = path.relative(source, directory);
  const nested = relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
  const reverse = path.relative(directory, source);
  const containsSource = reverse === '' || (!reverse.startsWith('..' + path.sep) && reverse !== '..' && !path.isAbsolute(reverse));
  const uid = currentUid();
  if (!stat.isDirectory() || stat.isSymbolicLink() || nested || containsSource || (stat.mode & 0o077) || (uid !== null && stat.uid !== uid)) fail('SIDECAR_DIRECTORY_INVALID');
  fs.accessSync(directory, fs.constants.R_OK | fs.constants.X_OK);
  return { directory, ...identity(stat) };
}

export function inspectPairedArmSidecarStoreV1(input) {
  let fd = null;
  try {
    const { directory } = record(input, ['directory']);
    const selected = readableDirectory(directory), file = path.join(selected.directory, NAME);
    let named;
    try { named = fs.lstatSync(file); } catch { return cloneFreeze({ schemaVersion: 'nisi-paired-arm-sidecar-inspection-v1', status: 'UNAVAILABLE', records: [], verifiedPrefixBytes: 0, lastSha256: null, authorizing: false, resumable: false, pastAcknowledgement: 'UNKNOWN' }); }
    if (!named.isFile() || named.isSymbolicLink() || named.nlink !== 1 || (named.mode & 0o077) || (currentUid() !== null && named.uid !== currentUid()) || named.size > SIDECAR_LIMITS.maxBytes) fail('SIDECAR_READ');
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | noFollow);
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || !sameIdentity(identity(named), opened) || opened.size !== named.size || opened.size > SIDECAR_LIMITS.maxBytes) fail('SIDECAR_READ');
    const bytes = readExact(fs, fd, opened.size);
    const afterDirectory = readableDirectory(selected.directory);
    const after = fs.lstatSync(file), last = fs.fstatSync(fd);
    if (!sameIdentity(identity(named), after) || !sameIdentity(identity(named), last) || after.size !== named.size || last.size !== opened.size ||
        after.mtimeMs !== named.mtimeMs || after.ctimeMs !== named.ctimeMs || last.mtimeMs !== opened.mtimeMs || last.ctimeMs !== opened.ctimeMs ||
        afterDirectory.dev !== selected.dev || afterDirectory.ino !== selected.ino) fail('SIDECAR_READ');
    const owned = fd; fd = null; fs.closeSync(owned);
    let at = 0, ordinal = 0, previous = null, finalSeen = false, status = bytes.length ? 'INCOMPLETE' : 'EMPTY', records = [];
    while (at < bytes.length) {
      const end = bytes.indexOf(10, at);
      if (end < 0) { status = 'PARTIAL_TAIL'; break; }
      try {
        const decoded = decodeArmSidecarRecordV1(bytes.subarray(at, end + 1), ordinal, previous);
        if (finalSeen) fail('SIDECAR_ORDER');
        records.push({ record: decoded.record, sha256: decoded.sha256, ordinal });
        previous = decoded.sha256; ordinal += 1; finalSeen = decoded.record.kind === 'FINAL'; at = end + 1;
        status = finalSeen ? 'FINAL_PRESENT' : 'INCOMPLETE';
      } catch { status = 'CORRUPT'; break; }
    }
    return cloneFreeze({ schemaVersion: 'nisi-paired-arm-sidecar-inspection-v1', status, records, verifiedPrefixBytes: at, lastSha256: previous, authorizing: false, resumable: false, pastAcknowledgement: 'UNKNOWN' });
  } catch {
    if (fd !== null) try { fs.closeSync(fd); } catch { /* unavailable */ }
    return cloneFreeze({ schemaVersion: 'nisi-paired-arm-sidecar-inspection-v1', status: 'UNAVAILABLE', records: [], verifiedPrefixBytes: 0, lastSha256: null, authorizing: false, resumable: false, pastAcknowledgement: 'UNKNOWN' });
  }
}
