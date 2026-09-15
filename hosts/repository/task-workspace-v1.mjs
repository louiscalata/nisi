// PRIVATE POSIX materialization under an operator-controlled STATIC LOCAL parent.
// Not an adversarial filesystem boundary: Node path operations are not openat.
// No program execution, cleanup, apply-back, durable recovery or authority.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { isIssuedRepositoryPreparation } from './snapshot-contract.mjs';
import { exact } from '../../integrity/record-utils.mjs';
import { cloneFreeze, sha256Text, stableStringify } from '../../workflow/contracts.mjs';

export const TASK_WORKSPACE_PROFILE = 'operator-controlled-task-materialization-posix-v1';
const owners = new WeakMap(), MAX_NODES = 8192;
const hash = (domain, value) => sha256Text(domain + '\0' + stableStringify(value));
const metaKeys = ['dev', 'ino', 'mode', 'uid', 'gid', 'nlink', 'size', 'mtimeNs', 'ctimeNs'];
const metadata = s => Object.fromEntries(metaKeys.map(k => [k, String(s[k])]));
const same = (a, b) => stableStringify(a) === stableStringify(b);
const identity = s => Object.fromEntries(['dev', 'ino', 'mode', 'uid', 'gid'].map(k => [k, String(s[k])]));
const flags = Object.freeze({ atomicSnapshot: false, hostileTreeContained: false, sandboxed: false,
  executionStatus: 'NOT_RUN', cleanupProvided: false, applyBackProvided: false, authorizing: false, certificationGranted: false });
export class TaskWorkspaceError extends Error {
  constructor(code, { root = null, priorCode = null, systemCode = null } = {}) {
    super(code); this.name = 'TaskWorkspaceError'; this.code = code;
    this.root = root; this.priorCode = priorCode; this.systemCode = systemCode;
  }
}
const refuse = code => { throw new TaskWorkspaceError(code); };
const ioCodes = new Set(['EIO', 'ENOENT', 'EEXIST', 'EACCES', 'EPERM', 'ENOTDIR', 'EISDIR', 'ELOOP', 'ENOSPC', 'EMFILE', 'EBADF']);
function normalize(error, root) {
  return new TaskWorkspaceError(error instanceof TaskWorkspaceError ? error.code : 'WORKSPACE_IO_ERROR', {
    root, priorCode: error instanceof TaskWorkspaceError ? error.priorCode : null,
    systemCode: ioCodes.has(error?.systemCode ?? error?.code) ? error.systemCode ?? error.code : null });
}
const isDirectory = stat => {
  if (!stat.isDirectory() || stat.isSymbolicLink()) refuse('WORKSPACE_DIRECTORY_REQUIRED');
};
function regular(stat, expectedBytes, device) {
  if (!stat.isFile() || stat.isSymbolicLink()) refuse('WORKSPACE_REGULAR_FILE_REQUIRED');
  if (stat.nlink !== 1n) refuse('WORKSPACE_HARDLINK');
  if (stat.dev !== device || stat.uid !== BigInt(process.geteuid())) refuse('WORKSPACE_OWNERSHIP');
  if ((stat.mode & 0o777n) !== 0o600n) refuse('WORKSPACE_MODE');
  if (stat.size !== BigInt(expectedBytes)) refuse('WORKSPACE_BYTES_CHANGED');
}
function expectedNodes(preparation) {
  const nodes = new Map([['', { kind: 'directory' }]]);
  for (const file of preparation.materialized.files) {
    const parts = file.path.split('/');
    for (let n = 1; n < parts.length; n++) nodes.set(parts.slice(0, n).join('/'), { kind: 'directory' });
    nodes.set(file.path, { kind: 'file', file });
  }
  if (nodes.size > MAX_NODES) refuse('WORKSPACE_NODE_LIMIT');
  return nodes;
}

async function withHandle(open, work) {
  let handle, failure = null, result;
  try { handle = await open(); result = await work(handle); }
  catch (error) { failure = error; }
  finally {
    if (handle) try { await handle.close(); }
    catch { failure = new TaskWorkspaceError('WORKSPACE_CLOSE_UNCONFIRMED', { priorCode: failure?.code ?? null }); }
  }
  if (failure) throw failure;
  return result;
}

async function inspect(entry) {
  const { io, root, preparation, nodes, created, device } = entry;
  const observed = new Map(); let visited = 0;
  async function visit(relative) {
    if (++visited > nodes.size) refuse('WORKSPACE_INVENTORY');
    const expected = nodes.get(relative); if (!expected) refuse('WORKSPACE_INVENTORY');
    const absolute = path.join(root, relative), stat = await io.lstat(absolute, { bigint: true });
    if (!same(identity(stat), created.get(relative))) refuse('WORKSPACE_IDENTITY_CHANGED');
    if (stat.dev !== device || stat.uid !== BigInt(process.geteuid())) refuse('WORKSPACE_OWNERSHIP');
    if (expected.kind === 'directory') {
      isDirectory(stat); if ((stat.mode & 0o777n) !== 0o700n) refuse('WORKSPACE_MODE');
      observed.set(relative, metadata(stat));
      // Bounded iteration stops on the first extra node. Directory close is
      // explicit so uncertain close is not lost behind automatic iteration.
      const children = await withHandle(() => io.opendir(absolute, { bufferSize: 32 }), async directory => {
        const names = []; let child;
        while ((child = await directory.read()) !== null) {
          const target = relative ? relative + '/' + child.name : child.name;
          if (!nodes.has(target) || names.length >= nodes.size) refuse('WORKSPACE_INVENTORY');
          names.push(target);
        }
        return names.sort();
      });
      for (const child of children) await visit(child);
    } else {
      const file = expected.file; regular(stat, file.byteLength, device);
      await withHandle(() => io.open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK), async handle => {
        const opened = await handle.stat({ bigint: true }); regular(opened, file.byteLength, device);
        if (!same(metadata(stat), metadata(opened))) refuse('WORKSPACE_CHANGED_DURING_READ');
        const bytes = Buffer.alloc(file.byteLength + 1); let used = 0;
        while (used < bytes.length) {
          const result = await handle.read(bytes, used, Math.min(65536, bytes.length - used), used);
          if (!Number.isInteger(result.bytesRead) || result.bytesRead < 0 || result.bytesRead > Math.min(65536, bytes.length - used)) refuse('WORKSPACE_READ_INVALID');
          if (!result.bytesRead) break; used += result.bytesRead;
        }
        if (used !== file.byteLength || !bytes.subarray(0, used).equals(Buffer.from(file.content, 'utf8'))) refuse('WORKSPACE_BYTES_CHANGED');
        if (!same(metadata(opened), metadata(await handle.stat({ bigint: true })))) refuse('WORKSPACE_CHANGED_DURING_READ');
      });
      observed.set(relative, metadata(stat));
    }
  }
  await visit(''); if (observed.size !== nodes.size) refuse('WORKSPACE_INVENTORY');
  // Static-input drift observation, not an atomic snapshot or race containment.
  for (const [relative, stat] of observed) {
    if (!same(stat, metadata(await io.lstat(path.join(root, relative), { bigint: true })))) refuse('WORKSPACE_CHANGED_DURING_READ');
  }
  const inventory = [...observed].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([relative, stat]) => ({
    path: relative, kind: nodes.get(relative).kind, metadata: stat,
    ...(nodes.get(relative).kind === 'file' ? { sha256: nodes.get(relative).file.sha256 } : {}) }));
  return cloneFreeze({ materializedFingerprint: preparation.materializedFingerprint, inventory });
}

// Trusted dependency seam for I/O fault tests. The default product function below
// always uses Node's filesystem; injecting dependencies does not attest a disk.
export function createTaskWorkspaceMaterializerV1(io = fs) {
  return async function materialize(input) {
    exact(input, ['preparation', 'parentRoot', 'profile'], 'WORKSPACE_INPUT_SCHEMA');
    const { preparation, parentRoot, profile } = input;
    if (!isIssuedRepositoryPreparation(preparation)) refuse('WORKSPACE_PREPARATION_NOT_ISSUED');
    if (profile !== TASK_WORKSPACE_PROFILE) refuse('WORKSPACE_PROFILE_REQUIRED');
    if (!['darwin', 'linux'].includes(process.platform) || !Number.isInteger(constants.O_NOFOLLOW)) refuse('WORKSPACE_PLATFORM');
    if (process.geteuid() === 0) refuse('WORKSPACE_ROOT_USER_UNSUPPORTED');
    if (typeof parentRoot !== 'string' || !parentRoot.isWellFormed() || parentRoot.includes('\0') || parentRoot.length > 4096 ||
        !path.isAbsolute(parentRoot)) refuse('WORKSPACE_PARENT_INVALID');
    const denied = new Set([path.parse(parentRoot).root, os.homedir(), os.tmpdir(), '/tmp', '/private/tmp', '/Volumes', '/Users'].map(p => path.resolve(p)));
    if (denied.has(path.resolve(parentRoot))) refuse('WORKSPACE_PARENT_BROAD');
    const nodes = expectedNodes(preparation); let root = null;
    try {
      // Alias forms of broad existing roots stay denied after canonicalization.
      // Missing platform-specific roots are harmless; other I/O uncertainty refuses.
      for (const candidate of [...denied]) {
        try { denied.add(await io.realpath(candidate)); }
        catch (error) { if (error?.code !== 'ENOENT') throw error; }
      }
      const parentBefore = await io.lstat(parentRoot, { bigint: true }); isDirectory(parentBefore);
      if (parentBefore.uid !== BigInt(process.geteuid()) || (parentBefore.mode & 0o022n) !== 0n) refuse('WORKSPACE_PARENT_NOT_EXCLUSIVE');
      const parent = await io.realpath(parentRoot); if (denied.has(parent)) refuse('WORKSPACE_PARENT_BROAD');
      if (!same(identity(parentBefore), identity(await io.lstat(parent, { bigint: true })))) refuse('WORKSPACE_PARENT_CHANGED');
      root = await io.mkdtemp(path.join(parent, 'nisi-task-'));
      // Reject a broken trusted dependency before it can redirect later writes.
      if (typeof root !== 'string' || path.dirname(root) !== parent || !/^nisi-task-[A-Za-z0-9]+$/.test(path.basename(root))) refuse('WORKSPACE_ROOT_INVALID');
      await io.chmod(root, 0o700);
      const rootStat = await io.lstat(root, { bigint: true }); isDirectory(rootStat);
      if (rootStat.uid !== BigInt(process.geteuid()) || rootStat.dev !== parentBefore.dev || (rootStat.mode & 0o777n) !== 0o700n) refuse('WORKSPACE_OWNERSHIP');
      const created = new Map([['', identity(rootStat)]]), directories = [...nodes].filter(([p, n]) => p && n.kind === 'directory');
      directories.sort(([a], [b]) => a.split('/').length - b.split('/').length || (a < b ? -1 : 1));
      for (const [relative] of directories) {
        const absolute = path.join(root, relative); await io.mkdir(absolute, { mode: 0o700 });
        const stat = await io.lstat(absolute, { bigint: true }); isDirectory(stat);
        created.set(relative, identity(stat));
      }
      for (const file of preparation.materialized.files) {
        const absolute = path.join(root, file.path), bytes = Buffer.from(file.content, 'utf8');
        const stat = await withHandle(() => io.open(absolute, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600), async handle => {
          let written = 0;
          while (written < bytes.length) {
            const size = Math.min(65536, bytes.length - written), result = await handle.write(bytes, written, size, written);
            if (!Number.isInteger(result.bytesWritten) || result.bytesWritten < 1 || result.bytesWritten > size) refuse('WORKSPACE_WRITE_NO_PROGRESS');
            written += result.bytesWritten;
          }
          await handle.sync(); const result = await handle.stat({ bigint: true }); regular(result, file.byteLength, rootStat.dev); return result;
        });
        created.set(file.path, identity(stat));
      }
      if (!same(identity(parentBefore), identity(await io.lstat(parent, { bigint: true })))) refuse('WORKSPACE_PARENT_CHANGED');
      const entry = { io, root, preparation, nodes, created, device: rootStat.dev, state: 'MATERIALIZED', history: [] };
      const initial = await inspect(entry); entry.original = initial;
      const initialIdentity = { schemaVersion: 'nisi-task-workspace-v1', profile,
        preparationFingerprint: preparation.fingerprint, taskFingerprint: preparation.taskFingerprint,
        candidateFingerprint: preparation.candidateFingerprint, materializedFingerprint: preparation.materializedFingerprint,
        rootFingerprint: hash('nisi/task-workspace-root/v1', root), initial, ...flags };
      const manifest = cloneFreeze({ ...initialIdentity, fingerprint: hash('nisi/task-workspace/v1', initialIdentity) });
      const owner = Object.freeze({ root, manifest, status: () => entry.state,
        observations: () => Object.freeze([...entry.history]), checkpoint: phase => checkpoint(owner, phase) });
      owners.set(owner, entry); return owner;
    } catch (error) { throw normalize(error, root); }
  };
}

export const materializeRepositoryCandidateV1 = createTaskWorkspaceMaterializerV1();

async function checkpoint(owner, phase) {
  const entry = owners.get(owner); if (!entry) refuse('WORKSPACE_OWNER_NOT_ISSUED');
  if (!['PRE', 'POST'].includes(phase)) refuse('WORKSPACE_PHASE');
  const expectedState = phase === 'PRE' ? 'MATERIALIZED' : 'PRECHECKED';
  if (entry.state !== expectedState) refuse('WORKSPACE_STATE');
  entry.state = 'CHECKING';
  try {
    const observed = await inspect(entry);
    if (!same(observed, entry.original)) refuse('WORKSPACE_DRIFT');
    const identity = { schemaVersion: 'nisi-task-workspace-checkpoint-v1', phase,
      workspaceFingerprint: owner.manifest.fingerprint,
      previousFingerprint: entry.history.at(-1)?.fingerprint ?? owner.manifest.fingerprint,
      observation: observed, status: 'UNCHANGED_AT_CHECKPOINT', ...flags };
    const result = cloneFreeze({ ...identity, fingerprint: hash('nisi/task-workspace-checkpoint/v1', identity) });
    entry.history.push(result); entry.state = phase === 'PRE' ? 'PRECHECKED' : 'POSTCHECKED'; return result;
  } catch (error) {
    entry.state = 'QUARANTINED'; const failure = normalize(error, entry.root);
    entry.history.push(cloneFreeze({ phase, status: 'REFUSED', code: failure.code, priorCode: failure.priorCode, systemCode: failure.systemCode }));
    throw failure;
  }
}

// Only the issued owner can identify a workspace; this helper does not approve
// a command or prove that anything executed between the two checkpoints.
export function issuedTaskWorkspaceV1(owner) {
  const entry = owners.get(owner); if (!entry) refuse('WORKSPACE_OWNER_NOT_ISSUED');
  return Object.freeze({ root: entry.root, preparation: entry.preparation, manifest: owner.manifest, state: entry.state });
}
