// cli/inspect.mjs — Nisi v0.2 read-only inspection slice (private development only).
// Reads exactly one file, <canonicalRoot>/summary.json, and returns the frozen
// observation from inspectStoredDemoSummaryV1. No enumeration, no traversal of
// retained paths, no writes, no polling, no child processes, no network.
//
// PRECONDITION (operator-exclusive local filesystem): the run directory lives on a
// local filesystem where the invoking operator is the only writer. The pathname and
// identity checks below detect accidental drift and refuse obviously unsafe shapes
// (symlinks, FIFOs, hardlinks, group/world-accessible roots). They are NOT hostile-
// writer isolation: a concurrent privileged or same-uid writer can still race between
// checks. They are also NOT wall-clock guarantees: a stalled mount can block lstat/
// open/read indefinitely; O_NONBLOCK only prevents blocking on FIFOs/devices at open.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { MAX_SUMMARY_BYTES, inspectStoredDemoSummaryV1 } from './stored-summary-v1.mjs';

const SUMMARY_NAME = 'summary.json';
const MAX_DIRECTORY_CHARS = 4096;
const CODE_DIRECTORY = 'NISI_INSPECT_DIRECTORY_INVALID';
const CODE_READ = 'NISI_INSPECT_READ_FAILED';
const CODE_CHANGED = 'NISI_INSPECT_CHANGED';
const CODE_TOO_LARGE = 'NISI_INSPECT_TOO_LARGE';

// Plain errors with fixed codes; never include pathnames, errno text or file content.
function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function safeLstat(target, code, message) {
  try {
    return fs.lstatSync(target, { bigint: true });
  } catch {
    throw fail(code, message);
  }
}

function identityOf(st) {
  return Object.freeze({
    dev: st.dev, ino: st.ino, mode: st.mode, nlink: st.nlink, uid: st.uid,
    size: st.size, mtimeNs: st.mtimeNs, ctimeNs: st.ctimeNs,
  });
}

function sameIdentity(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.nlink === b.nlink &&
    a.uid === b.uid && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}

function sameRootIdentity(a, b) {
  // Root: dev/ino/mode/uid binding (mtime of a directory legitimately changes on
  // unrelated sibling activity, so it is not part of the root binding).
  return a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.uid === b.uid;
}

function currentUid() {
  if (typeof process.getuid !== 'function') {
    throw fail(CODE_DIRECTORY, 'run directory ownership cannot be established on this platform');
  }
  return BigInt(process.getuid());
}

function checkRootStat(st, uid) {
  if (st.isSymbolicLink()) throw fail(CODE_DIRECTORY, 'run directory must not be a symlink');
  if (!st.isDirectory()) throw fail(CODE_DIRECTORY, 'run directory is not a directory');
  if (st.uid !== uid) throw fail(CODE_DIRECTORY, 'run directory is not caller-owned');
  if ((st.mode & 0o077n) !== 0n) throw fail(CODE_DIRECTORY, 'run directory is not private (mode & 077 must be 0)');
}

// Resolve and bind the run directory. Returns { canonicalRoot, rootIdentity, uid }.
function bindRunDirectory(directory) {
  if (typeof directory !== 'string' || directory.length === 0) {
    throw fail(CODE_DIRECTORY, 'run directory must be a nonempty string');
  }
  if (directory.length > MAX_DIRECTORY_CHARS) throw fail(CODE_DIRECTORY, 'run directory string too long');
  if (directory.includes('\0')) throw fail(CODE_DIRECTORY, 'run directory contains NUL');
  if (!path.isAbsolute(directory)) throw fail(CODE_DIRECTORY, 'run directory must be absolute');

  const uid = currentUid();
  // Lexical normalization strips trailing '/' and '/.' so a final-component symlink
  // is seen by lstat as a symlink and refused rather than silently followed.
  const lexical = path.resolve(directory);
  const lexStat = safeLstat(lexical, CODE_DIRECTORY, 'run directory does not exist or is unreadable');
  checkRootStat(lexStat, uid);

  // Parent-component aliases (e.g. /var -> /private/var) may canonicalize; the final
  // component was already proven to be a real directory.
  let canonicalRoot;
  try {
    canonicalRoot = fs.realpathSync.native(lexical);
  } catch {
    throw fail(CODE_DIRECTORY, 'run directory cannot be canonicalized');
  }
  const canonStat = safeLstat(canonicalRoot, CODE_DIRECTORY, 'canonical run directory unreadable');
  checkRootStat(canonStat, uid);
  if (canonStat.dev !== lexStat.dev || canonStat.ino !== lexStat.ino) {
    throw fail(CODE_CHANGED, 'run directory identity changed during canonicalization');
  }
  return { canonicalRoot, rootIdentity: identityOf(canonStat), uid };
}

function recheckRoot(binding) {
  let canonicalNow;
  try {
    canonicalNow = fs.realpathSync.native(binding.canonicalRoot);
  } catch {
    throw fail(CODE_CHANGED, 'run directory disappeared during read');
  }
  if (canonicalNow !== binding.canonicalRoot) {
    throw fail(CODE_CHANGED, 'run directory canonical binding changed during read');
  }
  const st = safeLstat(binding.canonicalRoot, CODE_CHANGED, 'run directory unreadable after read');
  try { checkRootStat(st, binding.uid); }
  catch { throw fail(CODE_CHANGED, 'run directory safety changed during read'); }
  if (!sameRootIdentity(identityOf(st), binding.rootIdentity)) {
    throw fail(CODE_CHANGED, 'run directory identity changed during read');
  }
}

function checkFileStat(st, uid) {
  if (st.isSymbolicLink()) throw fail(CODE_READ, 'summary must not be a symlink');
  if (!st.isFile()) throw fail(CODE_READ, 'summary is not a regular file');
  if (st.nlink !== 1n) throw fail(CODE_READ, 'summary must not be hardlinked');
  if (st.uid !== uid) throw fail(CODE_READ, 'summary is not caller-owned');
  if (st.size > BigInt(MAX_SUMMARY_BYTES)) throw fail(CODE_TOO_LARGE, 'summary exceeds MAX_SUMMARY_BYTES');
  if (st.size < 1n) throw fail(CODE_READ, 'summary is empty');
}

function readAllBounded(fd, size) {
  // Read exactly `size` bytes, then probe one extra byte to detect growth.
  const buf = Buffer.allocUnsafe(size);
  let off = 0;
  while (off < size) {
    let n;
    try {
      n = fs.readSync(fd, buf, off, size - off, off);
    } catch {
      throw fail(CODE_READ, 'summary read failed');
    }
    if (n === 0) throw fail(CODE_CHANGED, 'summary shrank during read');
    off += n;
  }
  const probe = Buffer.alloc(1);
  let extra;
  try {
    extra = fs.readSync(fd, probe, 0, 1, size);
  } catch {
    throw fail(CODE_READ, 'summary read failed');
  }
  if (extra !== 0) throw fail(CODE_CHANGED, 'summary grew during read');
  return buf;
}

/**
 * Synchronously capture the bytes of <canonicalRoot>/summary.json.
 * Returns a Buffer (1..MAX_SUMMARY_BYTES) that is a snapshot; the fd is closed on
 * every path. Throws plain Errors with fixed codes only.
 */
export function readStoredDemoSummaryBytesV1(directory) {
  const binding = bindRunDirectory(directory);
  const summaryPath = path.join(binding.canonicalRoot, SUMMARY_NAME);
  const { O_RDONLY, O_NOFOLLOW, O_NONBLOCK } = fs.constants;
  if (typeof O_NOFOLLOW !== 'number' || typeof O_NONBLOCK !== 'number') throw fail(CODE_READ, 'platform lacks required read flags');

  const beforeNamed = safeLstat(summaryPath, CODE_READ, 'summary missing or unreadable');
  checkFileStat(beforeNamed, binding.uid);

  let fd = -1;
  try {
    fd = fs.openSync(summaryPath, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  } catch {
    throw fail(CODE_READ, 'summary could not be opened');
  }

  let primary = null;
  let bytes = null;
  try {
    let beforeFd;
    try {
      beforeFd = fs.fstatSync(fd, { bigint: true });
    } catch {
      throw fail(CODE_READ, 'summary fstat failed');
    }
    checkFileStat(beforeFd, binding.uid);
    const idBefore = identityOf(beforeFd);
    if (!sameIdentity(idBefore, identityOf(beforeNamed))) {
      throw fail(CODE_CHANGED, 'summary identity differs between name and descriptor');
    }

    bytes = readAllBounded(fd, Number(beforeFd.size));

    let afterFd;
    try {
      afterFd = fs.fstatSync(fd, { bigint: true });
    } catch {
      throw fail(CODE_READ, 'summary fstat failed after read');
    }
    if (!sameIdentity(idBefore, identityOf(afterFd))) {
      throw fail(CODE_CHANGED, 'summary changed during read');
    }
    const afterNamed = safeLstat(summaryPath, CODE_CHANGED, 'summary name unreadable after read');
    if (!sameIdentity(idBefore, identityOf(afterNamed))) {
      throw fail(CODE_CHANGED, 'summary was replaced during read');
    }
    recheckRoot(binding);
  } catch (err) {
    primary = err;
  } finally {
    if (fd >= 0) {
      try {
        fs.closeSync(fd);
      } catch {
        const closeErr = fail(CODE_READ, 'summary descriptor close failed');
        // Close uncertainty must survive the CLI's code-only error projection.
        // Preserve only a fixed prior code, never a raw cause or path.
        closeErr.priorCode = [CODE_DIRECTORY, CODE_READ, CODE_CHANGED, CODE_TOO_LARGE]
          .includes(primary?.code) ? primary.code : null;
        primary = closeErr;
      }
    }
  }
  if (primary !== null) throw primary;
  if (bytes.length < 1 || bytes.length > MAX_SUMMARY_BYTES) {
    throw fail(CODE_TOO_LARGE, 'summary size out of bounds');
  }
  return bytes;
}

/**
 * Read-only observation of a stored run directory. Codec errors from
 * inspectStoredDemoSummaryV1 (NISI_INSPECT_SUMMARY_INVALID) propagate unchanged.
 */
export function inspectNisiRunDirectoryV1(directory) {
  return inspectStoredDemoSummaryV1(readStoredDemoSummaryBytesV1(directory));
}
