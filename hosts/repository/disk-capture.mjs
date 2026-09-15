// PRIVATE — optional POSIX host reader, not part of the portable workflow core.
// Only operator-trusted STATIC LOCAL input before candidate execution. The
// required profile names that caller precondition; it cannot verify local mount
// type or absence of concurrent writers. No hostile-tree containment, atomic
// filesystem snapshot, secret screening, sandbox, execution or hard I/O timeout.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { createRepositorySnapshot, REPOSITORY_SNAPSHOT_LIMITS as limits } from './snapshot-contract.mjs';
import { cloneFreeze, sha256Text, stableStringify } from '../../workflow/contracts.mjs';

export const DISK_CAPTURE_PROFILE = 'operator-trusted-static-local-v1';
export class RepositoryCaptureError extends Error {
  constructor(code, { systemCode = null, priorCode = null } = {}) {
    super(code); this.name = 'RepositoryCaptureError'; this.code = code;
    this.systemCode = systemCode; this.priorCode = priorCode;
  }
}
const refuse = code => { throw new RepositoryCaptureError(code); };
const ioCodes = new Set(['ENOENT', 'EACCES', 'EPERM', 'ENOTDIR', 'EISDIR', 'ELOOP', 'EMFILE', 'ENFILE', 'EIO', 'EAGAIN', 'EBADF']);
const ioError = error => error instanceof RepositoryCaptureError ? error : new RepositoryCaptureError(
  'DISK_CAPTURE_IO_ERROR', { systemCode: ioCodes.has(error?.code) ? error.code : null });
const digest = (domain, value) => sha256Text(`${domain}\0${stableStringify(value)}`);

function inputFrom(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      ![null, Object.prototype].includes(Object.getPrototypeOf(value))) refuse('DISK_CAPTURE_INPUT_SCHEMA');
  const d = Object.getOwnPropertyDescriptors(value);
  const names = ['root', 'paths', 'profile'];
  if (Reflect.ownKeys(d).length !== names.length || names.some(k => !d[k]?.enumerable || !Object.hasOwn(d[k], 'value'))) refuse('DISK_CAPTURE_INPUT_SCHEMA');
  const root = d.root.value, paths = d.paths.value;
  if (d.profile.value !== DISK_CAPTURE_PROFILE) refuse('DISK_CAPTURE_PROFILE_REQUIRED');
  if (typeof root !== 'string' || !root.isWellFormed() || root.length > 4096 || root.includes('\0') ||
      !path.isAbsolute(root) || path.resolve(root) === path.parse(root).root) refuse('DISK_CAPTURE_ROOT_INVALID');
  if (!Array.isArray(paths) || Object.getPrototypeOf(paths) !== Array.prototype) refuse('DISK_CAPTURE_PATHS_SCHEMA');
  const length = Object.getOwnPropertyDescriptor(paths, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 1 || length > limits.maximumFiles) refuse('DISK_CAPTURE_PATH_COUNT');
  const descriptors = Object.getOwnPropertyDescriptors(paths);
  if (Reflect.ownKeys(descriptors).length !== length + 1) refuse('DISK_CAPTURE_PATHS_SCHEMA');
  const files = Array.from({ length }, (_, i) => {
    if (!descriptors[i]?.enumerable || !Object.hasOwn(descriptors[i], 'value')) refuse('DISK_CAPTURE_PATHS_SCHEMA');
    return { path: descriptors[i].value, content: '' };
  });
  // Reuse the exact snapshot grammar/collision checks before any filesystem I/O.
  const manifest = createRepositorySnapshot({ files });
  return { root: path.resolve(root), paths: manifest.files.map(f => f.path) };
}

const metadata = stat => Object.fromEntries(['dev', 'ino', 'mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs']
  .map(key => [key, String(stat[key])]));
const matches = (a, b) => stableStringify(metadata(a)) === stableStringify(metadata(b));
function directory(stat) {
  if (stat.isSymbolicLink()) refuse('DISK_CAPTURE_SYMLINK');
  if (!stat.isDirectory()) refuse('DISK_CAPTURE_DIRECTORY_REQUIRED');
}
function regular(stat) {
  if (stat.isSymbolicLink()) refuse('DISK_CAPTURE_SYMLINK');
  if (!stat.isFile()) refuse('DISK_CAPTURE_REGULAR_FILE_REQUIRED');
  if (stat.nlink !== 1n) refuse('DISK_CAPTURE_HARDLINK');
  if (stat.size < 0n || stat.size > BigInt(limits.maximumFileBytes)) refuse('DISK_CAPTURE_FILE_LIMIT');
}

async function readOwnedFile(absolute, before) {
  let handle, failure = null, content;
  try {
    handle = await fs.open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = await handle.stat({ bigint: true }); regular(opened);
    if (!matches(before, opened)) refuse('DISK_CAPTURE_CHANGED');
    // One extra byte detects growth. Fixed buffers and explicit positions bound
    // the amount read; partial reads are normal and must not truncate content.
    const bytes = Buffer.alloc(Number(opened.size) + 1);
    let used = 0;
    while (used < bytes.length) {
      const { bytesRead } = await handle.read(bytes, used, Math.min(65_536, bytes.length - used), used);
      if (bytesRead === 0) break;
      used += bytesRead;
    }
    if (used !== Number(opened.size)) refuse('DISK_CAPTURE_CHANGED');
    const after = await handle.stat({ bigint: true }); regular(after);
    if (!matches(opened, after)) refuse('DISK_CAPTURE_CHANGED');
    try {
      // ignoreBOM=true preserves U+FEFF in content instead of dropping real bytes.
      content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, used));
    } catch { refuse('DISK_CAPTURE_UTF8_INVALID'); }
    if (content.includes('\0')) refuse('DISK_CAPTURE_BINARY_UNSUPPORTED');
    if (!Buffer.from(content, 'utf8').equals(bytes.subarray(0, used))) refuse('DISK_CAPTURE_BYTE_ROUNDTRIP');
  } catch (error) { failure = ioError(error); }
  finally {
    if (handle) try { await handle.close(); }
    catch { failure = new RepositoryCaptureError('DISK_CAPTURE_CLOSE_UNCONFIRMED', { priorCode: failure?.code ?? null }); }
  }
  if (failure) throw failure;
  return content;
}

export async function captureRepositoryFromDisk(value) {
  const input = inputFrom(value);
  if (!['darwin', 'linux'].includes(process.platform) || !Number.isInteger(constants.O_NOFOLLOW) ||
      !Number.isInteger(constants.O_NONBLOCK)) refuse('DISK_CAPTURE_PLATFORM_UNSUPPORTED');
  try {
    directory(await fs.lstat(input.root, { bigint: true }));
    // Resolving the operator-selected root accommodates canonical OS aliases
    // above it (e.g. /var). No symlink below the resulting root is supported.
    const root = await fs.realpath(input.root);
    const rootStat = await fs.lstat(root, { bigint: true }); directory(rootStat);
    const observed = new Map([[root, { stat: rootStat, kind: 'directory' }]]);
    const admitted = [];
    let totalBytes = 0;
    // Observe the ENTIRE declared manifest before opening any file for content.
    for (const relative of input.paths) {
      const parts = relative.split('/'); let parent = root;
      for (const part of parts.slice(0, -1)) {
        parent = path.join(parent, part);
        if (!observed.has(parent)) {
          const stat = await fs.lstat(parent, { bigint: true }); directory(stat);
          observed.set(parent, { stat, kind: 'directory' });
        }
      }
      const absolute = path.join(root, relative);
      const stat = await fs.lstat(absolute, { bigint: true }); regular(stat);
      if (stat.dev !== rootStat.dev) refuse('DISK_CAPTURE_CROSS_DEVICE');
      totalBytes += Number(stat.size);
      if (totalBytes > limits.maximumTotalBytes) refuse('DISK_CAPTURE_TOTAL_LIMIT');
      observed.set(absolute, { stat, kind: 'file' }); admitted.push({ relative, absolute, stat });
    }
    const files = [];
    for (const file of admitted) files.push({ path: file.relative, content: await readOwnedFile(file.absolute, file.stat) });
    // Best-effort static-input drift detection, NOT hostile-race containment or
    // an atomic snapshot. No returned data is authorized for execution here.
    for (const [absolute, original] of observed) {
      const stat = await fs.lstat(absolute, { bigint: true });
      (original.kind === 'file' ? regular : directory)(stat);
      if (!matches(original.stat, stat)) refuse('DISK_CAPTURE_CHANGED');
    }
    const snapshot = createRepositorySnapshot({ files });
    const observation = { schemaVersion: 1, profile: DISK_CAPTURE_PROFILE,
      rootFingerprint: digest('nisi/disk-capture-root/v1', root), snapshotFingerprint: snapshot.fingerprint,
      files: admitted.map(f => ({ path: f.relative, ...metadata(f.stat) })) };
    return Object.freeze({ snapshot, capture: cloneFreeze({ ...observation,
      fingerprint: digest('nisi/disk-capture/v1', observation), status: 'CAPTURED_TRUSTED_STATIC_INPUT',
      handlesClosed: true, atomicSnapshot: false, executionStatus: 'NOT_RUN', authorizing: false }) });
  } catch (error) { throw ioError(error); }
}
