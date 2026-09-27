// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
import { constants } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, sep } from 'node:path';
import { reopen } from './run-journal-v1.mjs';

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
// A lookup refusal also carries the code of the fs error that caused it, if any.
const refusalOf = (state, found) => refusal(found.code === undefined ? state : { ...state, error: found.code }, found.error);
// Windows needs a write-access directory handle for its flush; POSIX directories
// reject a read/write open. A failed sync still reports durable: false.
const directoryFlags = sep === '\\' ? 'r+' : 'r';
// The temp name adds '.<sha256>.<uuid>.tmp' (106 bytes) to the journal's file name,
// and filesystems commonly cap one name at 255 bytes.
const MAX_NAME_BYTES = 255 - 106;

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
      && footer.count === values.length - 2 && footer.lastHash === previousHash
      && reopen(serialized).report.status === 'COMPLETE';
  } catch {
    return false;
  }
}

function decode(bytes) {
  // Node 22 will not decode more than buffer.constants.MAX_STRING_LENGTH bytes, while Node 24
  // limits characters and so decodes larger multibyte files; the byte limit holds on every version.
  if (!Buffer.isBuffer(bytes) || bytes.length > constants.MAX_STRING_LENGTH) return null;
  // A caller-supplied fs may return a Buffer whose methods throw; that is data, not a crash.
  try {
    const serialized = bytes.toString('utf8');
    return Buffer.from(serialized, 'utf8').equals(bytes) && validJournal(serialized) ? serialized : null;
  } catch {
    return null;
  }
}

function existingBytes(fs, path) {
  try {
    const bytes = fs.readFileSync(path);
    return { bytes, absent: false };
  } catch (error) {
    return error?.code === 'ENOENT' ? { bytes: null, absent: true } : { error: 'READ_FAILED', code: errorCode(error) };
  }
}

// A rename replaces a symlink itself and leaves its target stale, so a link is refused.
function linkCheck(fs, path) {
  try {
    return fs.lstatSync(path).isSymbolicLink() ? { error: 'SYMLINK' } : {};
  } catch (error) {
    return error?.code === 'ENOENT' ? {} : { error: 'READ_FAILED', code: errorCode(error) };
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
  if (found.error) return refusalOf(state, found);
  if (found.absent) return refusal(state, 'NOT_FOUND');
  const serialized = decode(found.bytes);
  if (serialized === null) return refusal(state, 'INVALID_JOURNAL');
  return { ...state, status: 'READ', serialized, sha256: digest(found.bytes), bytes: found.bytes.length, verified: true };
}

export function writeSerializedJournal(options) {
  const state = initial();
  if (!options || !validPath(options.path) || !hasMethods(options.fs, ['readFileSync', 'lstatSync', 'openSync', 'writeSync', 'closeSync', 'renameSync', 'unlinkSync'])) return refusal(state, 'INVALID_INPUT');
  const { path, serialized, fs, expectedPreviousSha256 } = options;
  if (Buffer.byteLength(basename(path)) > MAX_NAME_BYTES) return refusal(state, 'PATH_TOO_LONG');
  // A journal above decode()'s byte limit could not be read back by this store, so it is not written.
  if (typeof serialized === 'string' && Buffer.byteLength(serialized) > constants.MAX_STRING_LENGTH) return refusal(state, 'TOO_LARGE');
  if (!validJournal(serialized)) return refusal(state, 'INVALID_JOURNAL');
  if (expectedPreviousSha256 !== undefined && !hex(expectedPreviousSha256)) return refusal(state, 'INVALID_INPUT');
  const bytes = Buffer.from(serialized, 'utf8');
  const sha256 = digest(bytes);
  const link = linkCheck(fs, path);
  const before = link.error ? link : existingBytes(fs, path);
  if (before.error) return refusalOf(state, before);
  if (!before.absent && decode(before.bytes) === null) return refusal(state, 'EXISTING_INVALID');
  if (expectedPreviousSha256 !== undefined && (before.absent || digest(before.bytes) !== expectedPreviousSha256)) return refusal(state, 'CONFLICT');
  if (!before.absent) {
    if (before.bytes.equals(bytes)) return { ...state, status: 'UNCHANGED', sha256, bytes: bytes.length, verified: true };
    if (expectedPreviousSha256 === undefined) return refusal(state, 'CONFLICT');
  }

  // Each attempt owns a distinct temp. A process killed before cleanup may leave
  // its temp behind; the next attempt must not be blocked by that orphan.
  const temp = path + '.' + sha256 + '.' + randomUUID() + '.tmp';
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
      state.cleanupError = state.error = errorCode(error);
      return fail('WRITE_FAILED');
    }
  } catch (error) {
    state.error = errorCode(error);
    return fail('WRITE_FAILED');
  }

  const matches = target => {
    try {
      const actual = fs.readFileSync(target);
      return Buffer.isBuffer(actual) && actual.equals(bytes);
    } catch (error) {
      state.error = errorCode(error);
      return false;
    }
  };
  if (!matches(temp)) return fail('READBACK_MISMATCH');
  const relinked = linkCheck(fs, path);
  const current = relinked.error ? relinked : existingBytes(fs, path);
  if (current.error) {
    if (current.code !== undefined) state.error = current.code;
    return fail(current.error);
  }
  if (current.absent !== before.absent || !current.absent && (!Buffer.isBuffer(current.bytes) || !current.bytes.equals(before.bytes))) return fail('CONFLICT');
  try { fs.renameSync(temp, path); } catch (error) {
    state.error = errorCode(error);
    return fail('RENAME_FAILED');
  }
  state.committed = true;
  ownedTemp = false;

  let directoryFd = null;
  try {
    directoryFd = fs.openSync(dirname(path), directoryFlags);
    syncFile(fs, directoryFd, state, 'directory');
  } catch (error) {
    state.fsyncErrors.directory = errorCode(error);
  } finally {
    if (directoryFd !== null) {
      const closing = directoryFd;
      directoryFd = null;
      try { fs.closeSync(closing); } catch (error) {
        state.fsync.directory = false;
        state.fsyncErrors.directory = [state.fsyncErrors.directory, errorCode(error)].filter(code => code !== null).join(';');
        state.cleanupError = errorCode(error);
      }
    }
  }
  if (!matches(path)) return refusal(state, 'READBACK_MISMATCH');
  return { ...state, status: 'WRITTEN', sha256, bytes: bytes.length, verified: true, durable: state.fsync.file && state.fsync.directory };
}
