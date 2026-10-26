// PRIVATE operator-exclusive local evidence writer. No retries, overwrite,
// prune, execution, scheduler or writable recovery. OS fsync acknowledgement
// is not proof of delivery of the acknowledgement, power-loss durability or
// protection against a malicious process running as the same user.
import fs from 'node:fs';
import path from 'node:path';
import { record } from '../evaluation/intake-v1.mjs';
import { cloneFreeze } from '../workflow/contracts.mjs';
import { resolveExternalDemoStateV1, recheckExternalDemoStateV1 } from '../hosts/repository/demo-state-v1.mjs';
import { TRIAL_EVENT_LIMITS, encodeTrialEventV1, decodeTrialEventV1, failTrialStore as fail } from './paired-trial-event-codec-v1.mjs';

const SOURCE_ROOT = path.resolve(import.meta.dirname, '..');
const within = (parent, child) => { const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); };
const identity = stat => ({ dev: String(stat.dev), ino: String(stat.ino) });
const same = (a, b) => a.dev === String(b.dev) && a.ino === String(b.ino);
const noFollow = fs.constants.O_NOFOLLOW;
const rootMethods = ['openSync', 'closeSync', 'writeSync', 'readSync', 'fstatSync', 'fsyncSync'];
const causeCodes = new Set(['NISI_STATE_DIRECTORY_INVALID', 'TRIAL_STORE_DIRECTORY_CHANGED', 'TRIAL_STORE_FILE_CHANGED',
  'TRIAL_STORE_READBACK', 'TRIAL_STORE_EVENT_ORDER', 'TRIAL_STORE_CAPACITY', 'TRIAL_STORE_WRITE',
  'TRIAL_STORE_CLOSE_UNCONFIRMED', 'TRIAL_STORE_DIGEST', 'TRIAL_STORE_RAW_CANDIDATE', 'TRIAL_STORE_EVENT_TYPE',
  'TRIAL_STORE_PHASE', 'TRIAL_STORE_EVENT_LIMIT', 'TRIAL_STORE_CHAIN', 'TRIAL_STORE_EVENT_BYTES', 'TRIAL_RECORD', 'TRIAL_NUMBER']);
function safeCause(error) {
  const code = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'code')?.value : null;
  return causeCodes.has(code) ? code : 'TRIAL_STORE_IO_OR_INPUT_FAILURE';
}
function readableDirectory(value, expected = null) {
  // Read-only counterpart of the writer's external-state guard. Do not change
  // the shared writer helper or require W_OK on a privately archived directory.
  if (typeof value !== 'string' || !value.length || value.length > 4096 || value.includes('\0') || !path.isAbsolute(value)) fail('NISI_STATE_DIRECTORY_INVALID');
  const named = fs.lstatSync(path.resolve(value));
  if (!named.isDirectory() || named.isSymbolicLink()) fail('NISI_STATE_DIRECTORY_INVALID');
  const directory = fs.realpathSync(value), source = fs.realpathSync(SOURCE_ROOT), stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || within(source, directory) || within(directory, source) ||
      (stat.mode & 0o077) || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) fail('NISI_STATE_DIRECTORY_INVALID');
  if (expected && (directory !== expected.directory || !same(expected, stat))) fail('TRIAL_STORE_DIRECTORY_CHANGED');
  fs.accessSync(directory, fs.constants.R_OK | fs.constants.X_OK);
  return { directory, ...identity(stat) };
}
function ioMethods(dependencies) {
  const { io } = record(dependencies, ['io']);
  // Fault injection is a trusted implementation seam, not an untrusted driver.
  return Object.fromEntries(rootMethods.map(key => {
    const fn = Object.getOwnPropertyDescriptor(io, key)?.value;
    if (typeof fn !== 'function') fail('TRIAL_STORE_IO');
    return [key, fn.bind(io)];
  }));
}
function checkDirectory(directory, expected) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !same(expected, stat) || (stat.mode & 0o077)) fail('TRIAL_STORE_DIRECTORY_CHANGED');
}
function verifyRange(io, fd, position, expected) {
  const found = Buffer.alloc(expected.length); let offset = 0;
  while (offset < found.length) {
    const count = io.readSync(fd, found, offset, found.length - offset, position + offset);
    if (!Number.isSafeInteger(count) || count <= 0 || count > found.length - offset) fail('TRIAL_STORE_READBACK');
    offset += count;
  }
  if (!expected.equals(found)) fail('TRIAL_STORE_READBACK');
}

export function createPairedTrialEventStoreV1(input, dependencies = { io: fs }) {
  const { parentDirectory } = record(input, ['parentDirectory']);
  const parent = resolveExternalDemoStateV1(parentDirectory, SOURCE_ROOT);
  const io = ioMethods(dependencies);
  recheckExternalDemoStateV1(parent, SOURCE_ROOT);
  const directory = fs.mkdtempSync(path.join(parent.directory, 'nisi-trial-'));
  recheckExternalDemoStateV1(parent, SOURCE_ROOT);
  const dirIdentity = identity(fs.lstatSync(directory)), file = path.join(directory, 'events.jsonl');
  let fd = null, fileIdentity = null, state = 'OPEN', busy = false, ordinal = 0, previousSha256 = null;
  let lastSequence = -1, byteLength = 0, reason = null, failureCause = null, finalSeen = false;
  function uncertain(code) { state = 'COMMIT_UNCERTAIN'; reason = code; }
  function closeOwned() {
    if (fd === null) return;
    const original = fd; fd = null;
    try { io.closeSync(original); } catch {
      failureCause ??= 'TRIAL_STORE_CLOSE_UNCONFIRMED'; uncertain('TRIAL_STORE_CLOSE_UNCONFIRMED');
    }
  }
  function verifyIdentity() {
    recheckExternalDemoStateV1(parent, SOURCE_ROOT); checkDirectory(directory, dirIdentity);
    const named = fs.lstatSync(file), opened = io.fstatSync(fd);
    if (!named.isFile() || named.isSymbolicLink() || !opened.isFile() || !same(fileIdentity, named) ||
        !same(fileIdentity, opened) || named.nlink !== 1 || opened.nlink !== 1 || (named.mode & 0o077) ||
        named.size !== byteLength || opened.size !== byteLength) fail('TRIAL_STORE_FILE_CHANGED');
  }
  const snapshot = () => cloneFreeze({ schemaVersion: 'nisi-trial-event-store-v1', directory, file, state, reason, failureCause,
    retainedEvents: ordinal, byteLength, lastSha256: previousSha256, finalSeen,
    retentionCountSemantics: 'FULLY_CONFIRMED_STORE_OPERATIONS',
    durability: 'OS_FSYNC_ACKNOWLEDGEMENT_ONLY', powerLossVerified: false, hostileWriterIsolation: false,
    resumable: false, authorizing: false });
  try {
    fd = io.openSync(file, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_APPEND | noFollow, 0o600);
    fileIdentity = identity(io.fstatSync(fd));
    for (const target of [directory, parent.directory]) {
      const dirFd = io.openSync(target, fs.constants.O_RDONLY | noFollow | fs.constants.O_DIRECTORY);
      try { io.fsyncSync(dirFd); } finally { io.closeSync(dirFd); }
    }
    verifyIdentity();
  } catch {
    uncertain('TRIAL_STORE_CREATE_UNCONFIRMED'); closeOwned();
    throw Object.assign(Error('TRIAL_STORE_CREATE_UNCONFIRMED'), { code: 'TRIAL_STORE_CREATE_UNCONFIRMED', directory });
  }
  async function retain(raw) {
    if (state !== 'OPEN' || busy || finalSeen) fail('TRIAL_STORE_NOT_WRITABLE');
    busy = true; let writeAttempted = false;
    try {
      const encoded = encodeTrialEventV1(raw, ordinal, previousSha256), event = encoded.event;
      if (event.sequence <= lastSequence || (ordinal === 0 ? event.type !== 'SCHEDULE' || event.sequence !== 0 : event.type === 'SCHEDULE')) fail('TRIAL_STORE_EVENT_ORDER');
      if (byteLength + encoded.bytes.length > TRIAL_EVENT_LIMITS.maxBytes) fail('TRIAL_STORE_CAPACITY');
      verifyIdentity();
      let offset = 0;
      while (offset < encoded.bytes.length) {
        writeAttempted = true;
        const written = io.writeSync(fd, encoded.bytes, offset, encoded.bytes.length - offset, null);
        if (!Number.isSafeInteger(written) || written <= 0 || written > encoded.bytes.length - offset) fail('TRIAL_STORE_WRITE');
        offset += written;
      }
      io.fsyncSync(fd);
      verifyRange(io, fd, byteLength, encoded.bytes);
      byteLength += encoded.bytes.length;
      verifyIdentity();
      if (event.type === 'FINAL') {
        closeOwned();
        if (state !== 'OPEN') fail('TRIAL_STORE_CLOSE_UNCONFIRMED');
      }
      // Publish only after fsync, exact readback and pinned-path checks.
      previousSha256 = encoded.sha256; ordinal++; lastSequence = event.sequence; finalSeen = event.type === 'FINAL';
      if (finalSeen) state = 'CLOSED';
    } catch (error) {
      failureCause ??= safeCause(error);
      if (writeAttempted) uncertain('TRIAL_STORE_COMMIT_UNCONFIRMED');
      else { state = 'SEALED'; reason = 'TRIAL_STORE_PREWRITE_REFUSED'; }
      closeOwned();
      fail(reason);
    } finally { busy = false; }
  }
  function close() {
    if (busy) fail('TRIAL_STORE_BUSY');
    if (state === 'OPEN') {
      try { verifyIdentity(); } catch (error) { failureCause ??= safeCause(error); uncertain('TRIAL_STORE_FILE_CHANGED'); }
      closeOwned(); if (state === 'OPEN') state = 'CLOSED';
    }
    return snapshot();
  }
  return Object.freeze({ retain, inspect: snapshot, close });
}

// Read-only byte reconciliation. Valid prefix is not proof that the previous
// process returned an acknowledgement, stopped its workers, or completed a task.
export function inspectPairedTrialEventStoreV1(input) {
  const { directory } = record(input, ['directory']);
  let bytes = null, fd = null;
  try {
    const selected = readableDirectory(directory), file = path.join(selected.directory, 'events.jsonl');
    const named = fs.lstatSync(file);
    if (!named.isFile() || named.isSymbolicLink() || named.nlink !== 1 || (named.mode & 0o077) || named.size > TRIAL_EVENT_LIMITS.maxBytes) fail('TRIAL_STORE_READ');
    if (![fs.constants.O_RDONLY, noFollow, fs.constants.O_NONBLOCK].every(Number.isInteger)) fail('TRIAL_STORE_READ');
    // A special-file replacement between lstat/open must not block opening.
    fd = fs.openSync(file, fs.constants.O_RDONLY | noFollow | fs.constants.O_NONBLOCK);
    const opened = fs.fstatSync(fd);
    if (!same(identity(named), opened) || opened.size !== named.size) fail('TRIAL_STORE_READ');
    bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (count <= 0) fail('TRIAL_STORE_READ'); offset += count;
    }
    readableDirectory(selected.directory, selected);
    const after = fs.lstatSync(file), last = fs.fstatSync(fd);
    if (!same(identity(named), after) || !same(identity(named), last) || after.size !== named.size || last.size !== named.size ||
        last.mtimeMs !== opened.mtimeMs || last.ctimeMs !== opened.ctimeMs) fail('TRIAL_STORE_READ');
    const closing = fd; fd = null; fs.closeSync(closing);
  } catch {
    if (fd !== null) try { fs.closeSync(fd); } catch { /* evidence unavailable */ }
    return cloneFreeze({ schemaVersion: 'nisi-trial-event-reconciliation-v1', status: 'UNAVAILABLE', events: [],
      sourceTrust: 'UNAUTHENTICATED_LOCAL_BYTES', creationAcknowledgement: 'UNKNOWN',
      durabilityAcknowledgement: 'UNKNOWN', resumable: false, authorizing: false });
  }
  const events = []; let offset = 0, previousSha256 = null, lastSequence = -1, status = 'EMPTY', finalSeen = false;
  while (offset < bytes.length) {
    const end = bytes.indexOf(10, offset);
    if (end < 0) { status = 'PARTIAL_TAIL'; break; }
    try {
      const decoded = decodeTrialEventV1(bytes.subarray(offset, end + 1), events.length, previousSha256), event = decoded.event;
      if (event.sequence <= lastSequence || finalSeen || (events.length === 0 ? event.type !== 'SCHEDULE' || event.sequence !== 0 : event.type === 'SCHEDULE')) fail('TRIAL_STORE_EVENT_ORDER');
      events.push(event); previousSha256 = decoded.sha256; lastSequence = event.sequence;
      offset = end + 1; finalSeen = event.type === 'FINAL'; status = finalSeen ? 'FINAL_PRESENT' : 'INCOMPLETE';
    } catch { status = 'CORRUPT'; break; }
  }
  return cloneFreeze({ schemaVersion: 'nisi-trial-event-reconciliation-v1', status, events, verifiedPrefixBytes: offset,
    lastSha256: previousSha256, finalPresent: finalSeen, semanticExecutionValidation: 'NOT_PERFORMED',
    sourceTrust: 'UNAUTHENTICATED_LOCAL_BYTES', creationAcknowledgement: 'UNKNOWN',
    durabilityAcknowledgement: 'UNKNOWN', remoteExecutionStopped: 'UNKNOWN',
    resumable: false, authorizing: false });
}
