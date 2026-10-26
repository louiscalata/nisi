// Native overlay inventory oracle (C01, private v0.2). The build proof may accept a
// frozen package in exactly two starting states: no hidden entries at all, or the
// two SwiftPM markers a build without --scratch-path wrote on 2026-09-14T05:02Z.
// validate() is pure (never touches the filesystem, never mutates or reads through
// accessors on its input); collect() reads only under frozenPackage, through lstat,
// and never follows a symlink. Both refuse with one exact named code.
import fs from 'node:fs';
import path from 'node:path';
import {types} from 'node:util';
import {createHash} from 'node:crypto';

export const NATIVE_OVERLAY_INVENTORY_INVALID = 'NATIVE_OVERLAY_INVENTORY_INVALID';
const refuse = () => { throw Object.assign(new Error(NATIVE_OVERLAY_INVENTORY_INVALID), {code: NATIVE_OVERLAY_INVENTORY_INVALID}); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

const PREFIX = 'native/macos/CodenameVeritasFramework/.build';
export const HISTORICAL_EXCLUDED = Object.freeze([PREFIX]);
export const HISTORICAL_HIDDEN = Object.freeze([
  Object.freeze({path: PREFIX + '/.buildSystem_debug', kind: 'file', bytes: 10, sha256: 'cd1ba1c9604b794d71cd3cb482cc02e4c16bdea56c361333fabe801a74db2b90'}),
  Object.freeze({path: PREFIX + '/CACHEDIR.TAG', kind: 'file', bytes: 209, sha256: '61833598201b8d9bb6a18003b6be9fd00ae014cfbd583253c1f23b746bf035d1'}),
]);
const KINDS = new Set(['file', 'directory', 'symlink', 'other']);
const MAX_DEPTH = 32;
const MAX_ENTRIES = 20000;
// An accepted inventory holds two files of 10 and 209 bytes; anything larger can never
// validate, so it is refused from fstat without being read. Aggregate reads are capped too.
const MAX_FILE_BYTES = 1048576;
const MAX_TOTAL_BYTES = 16777216;
const ENTRY_FIELDS = ['path', 'kind', 'bytes', 'sha256'];

// Closed plain-data readers: data descriptors only, so a getter anywhere in the
// input refuses before any value is read (same discipline as snapshot-contract.mjs).
// A Proxy is refused first: Array.isArray, getPrototypeOf and descriptor reflection
// all run its traps, and a revoked one throws a foreign TypeError instead.
function plainObject(value, names) {
  if (types.isProxy(value) || value === null || typeof value !== 'object' || Array.isArray(value)) refuse();
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) refuse();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  // No Array.prototype method is called on caller-supplied values, and this module's own
  // arrays are filled by index. That is containment behind the refusal boundary in
  // validate(), not immunity: a poisoned intrinsic elsewhere still ends in the named refusal.
  if (keys.length !== names.length) refuse();
  for (let i = 0; i < keys.length; i += 1) {
    if (typeof keys[i] !== 'string') refuse();
    let known = false;
    for (let j = 0; j < names.length; j += 1) if (names[j] === keys[i]) known = true;
    if (!known) refuse();
  }
  const out = Object.create(null);
  for (const name of names) {
    const descriptor = descriptors[name];
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) refuse();
    out[name] = descriptor.value;
  }
  return out;
}
function plainArray(value, limit) {
  if (types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) refuse();
  // The genuine length is read first and bounded (an accepted inventory holds at most two
  // rows), so a dense million-element array is refused before its descriptors are copied.
  const length = Object.getOwnPropertyDescriptor(value, 'length');
  if (!length || !Object.hasOwn(length, 'value') || !Number.isSafeInteger(length.value) || length.value < 0 || length.value > limit) refuse();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== length.value + 1) refuse();
  const out = [];
  for (let i = 0; i < length.value; i += 1) {
    const descriptor = descriptors[i];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) refuse();
    out[i] = descriptor.value;
  }
  return out;
}
function entry(value) {
  const row = plainObject(value, ENTRY_FIELDS);
  if (typeof row.path !== 'string' || !KINDS.has(row.kind) || !Number.isSafeInteger(row.bytes) || row.bytes < 0) refuse();
  if (!(row.sha256 === null || (typeof row.sha256 === 'string' && /^[0-9a-f]{64}$/.test(row.sha256)))) refuse();
  return row;
}
const sameEntry = (a, b) => { for (let i = 0; i < ENTRY_FIELDS.length; i += 1) if (a[ENTRY_FIELDS[i]] !== b[ENTRY_FIELDS[i]]) return false; return true; };

// Returns 'CLEAN_ABSENT' or 'HISTORICAL_MARKERS'; anything else — partial, extra,
// reordered, duplicated or cross-state inventories included — refuses. The two
// states are compared exactly, so a build that moves between them is a drift.
export function validateNativeOverlayInventoryV1(input) {
  // Any unexpected throw inside the reader (a foreign TypeError from an exotic object, a
  // RangeError from a poisoned intrinsic) is the same refusal: nothing escapes unnamed.
  try {
    const {excluded, hidden} = plainObject(input, ['excluded', 'hidden']);
    const excludedRows = plainArray(excluded, HISTORICAL_EXCLUDED.length);
    for (let i = 0; i < excludedRows.length; i += 1) if (typeof excludedRows[i] !== 'string') refuse();
    const hiddenValues = plainArray(hidden, HISTORICAL_HIDDEN.length);
    const hiddenRows = [];
    for (let i = 0; i < hiddenValues.length; i += 1) hiddenRows[i] = entry(hiddenValues[i]);
    if (excludedRows.length === 0 && hiddenRows.length === 0) return 'CLEAN_ABSENT';
    let historical = excludedRows.length === HISTORICAL_EXCLUDED.length && hiddenRows.length === HISTORICAL_HIDDEN.length;
    for (let i = 0; historical && i < excludedRows.length; i += 1) historical = excludedRows[i] === HISTORICAL_EXCLUDED[i];
    for (let i = 0; historical && i < hiddenRows.length; i += 1) historical = sameEntry(hiddenRows[i], HISTORICAL_HIDDEN[i]);
    if (historical) return 'HISTORICAL_MARKERS';
  } catch { /* fall through to the one named refusal */ }
  refuse();
}

// Everything under frozenPackage the manifest does not cover, in sorted walk order:
// unlisted regular files (hashed), symlinks (never followed), empty directories and
// other kinds (sha256 null). The traversal root is frozenPackage — importedRoot only
// anchors the recorded relative paths, and manifest paths outside frozenPackage are
// ignored rather than visited.
export function collectNativeOverlayHiddenV1({importedRoot, frozenPackage, manifestPaths}) {
  if (typeof importedRoot !== 'string' || typeof frozenPackage !== 'string' || !path.isAbsolute(importedRoot) ||
      !path.isAbsolute(frozenPackage) || !(manifestPaths instanceof Set)) refuse();
  // Both roots must already be normalized: `a/../pkg` reads through a symlinked `a`
  // at the OS level even though the lexical anchor below looks contained.
  if (path.normalize(importedRoot) !== importedRoot || path.normalize(frozenPackage) !== frozenPackage ||
      importedRoot.split(path.sep).indexOf('..') >= 0 || frozenPackage.split(path.sep).indexOf('..') >= 0) refuse();
  const anchor = path.relative(importedRoot, frozenPackage);
  if (anchor === '' || anchor.startsWith('..') || path.isAbsolute(anchor)) refuse();
  // The traversal root and every directory from the import anchor down to it must be
  // real directories (lstat, never followed): a symlinked root or ancestor would make
  // the walk read outside the import while every recorded path still looked contained.
  let cursor = importedRoot;
  for (const step of ['', ...anchor.split(path.sep)]) {
    if (step) cursor = path.join(cursor, step);
    const st = fs.lstatSync(cursor, {throwIfNoEntry: false});
    if (!st || !st.isDirectory()) refuse();
  }
  const relative = p => path.relative(importedRoot, p).split(path.sep).join('/');
  // Regular files are opened O_NOFOLLOW|O_NONBLOCK and fstat-checked before any read:
  // an entry swapped for a symlink is refused rather than followed, a FIFO cannot block
  // the open, and a non-regular or oversized descriptor is refused unread. Directory
  // reads are not fd-anchored (Node has no openat): a closed reader, not a snapshot.
  let totalBytes = 0;
  const readRegular = p => {
    let fd;
    try { fd = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); } catch { refuse(); }
    try {
      const st = fs.fstatSync(fd);
      if (!st.isFile() || st.size > MAX_FILE_BYTES || (totalBytes += st.size) > MAX_TOTAL_BYTES) refuse();
      return {bytes: st.size, sha256: hash(fs.readFileSync(fd))};
    } finally { fs.closeSync(fd); }
  };
  // Recursive walk with explicit depth, entry and byte budgets (a frozen package is a few
  // hundred entries at most): exceeding one is a refusal, not a stack overflow.
  const rows = [];
  let visited = 0;
  const walk = (root, depth) => {
    if (depth > MAX_DEPTH) refuse();
    const names = fs.readdirSync(root).sort();
    if (names.length === 0 && root !== frozenPackage) { rows[rows.length] = {path: relative(root), kind: 'directory', bytes: fs.lstatSync(root).size, sha256: null}; return; }
    for (let i = 0; i < names.length; i += 1) {
      if ((visited += 1) > MAX_ENTRIES) refuse();
      const p = path.join(root, names[i]);
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink()) { rows[rows.length] = {path: relative(p), kind: 'symlink', bytes: st.size, sha256: null}; continue; }
      if (st.isDirectory()) { walk(p, depth + 1); continue; }
      const rel = relative(p);
      if (st.isFile()) { if (!manifestPaths.has(rel)) rows[rows.length] = {path: rel, kind: 'file', ...readRegular(p)}; continue; }
      rows[rows.length] = {path: rel, kind: 'other', bytes: st.size, sha256: null};
    }
  };
  walk(frozenPackage, 0);
  return rows;
}
