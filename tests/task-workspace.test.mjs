// Private operator-controlled local POSIX tests; no candidate program execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRepositorySnapshot, prepareRepositoryCandidate } from '../hosts/repository/snapshot-contract.mjs';
import { materializeRepositoryCandidateV1 as materialize, createTaskWorkspaceMaterializerV1,
  TASK_WORKSPACE_PROFILE as profile, issuedTaskWorkspaceV1 } from '../hosts/repository/task-workspace-v1.mjs';
import { sha256Text } from '../workflow/contracts.mjs';
const files = [{ path: 'src/value.mjs', content: 'export const value = 0;\n' },
  { path: 'config.json', content: '{"value":0}\n' }, { path: 'checks/protected.txt', content: 'immutable harness marker\n' }];
function prep(changes = [{ path: 'src/value.mjs', content: 'export const value = 1;\n' }]) {
  const baseline = createRepositorySnapshot({ files });
  return prepareRepositoryCandidate({ baseline, task: { taskId: 'workspace.fixture', mode: 'edit', language: 'javascript',
    allowedFiles: ['src/value.mjs', 'config.json', 'new/empty.txt', 'new/unicode.txt', 'checks/protected.txt'], protectedFiles: ['checks/protected.txt'],
    protectedSnapshots: { 'checks/protected.txt': sha256Text(files[2].content) }, acceptanceCriteria: ['Preserve exact byte identity'],
    policy: { repairBudget: 1, totalDeadlineMs: 5000, requiredReviewers: 1, requireReportStore: false } },
    candidate: { files: changes }, authorId: 'author.fixture' });
}
async function parent(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nisi-workspace-test-'));
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); }); return root;
}
const options = (parentRoot, preparation = prep()) => ({ parentRoot, preparation, profile });
const code = expected => e => e.code === expected;
const handleProxy = (handle, overrides) => new Proxy(handle, { get(target, key) {
  if (Object.hasOwn(overrides, key)) return overrides[key]; const value = Reflect.get(target, key, target);
  return typeof value === 'function' ? value.bind(target) : value;
} });

test('workspace writes exact candidate, baseline and protected bytes with private nodes and linked checkpoints', async t => {
  const p = prep(), owner = await materialize(options(await parent(t), p));
  assert.equal(owner.status(), 'MATERIALIZED'); assert.equal(issuedTaskWorkspaceV1(owner).preparation, p);
  for (const f of p.materialized.files) assert.equal(await fs.readFile(path.join(owner.root, f.path), 'utf8'), f.content);
  assert.equal(Number((await fs.stat(owner.root)).mode & 0o777), 0o700);
  assert.equal(Number((await fs.stat(path.join(owner.root, 'src/value.mjs'))).mode & 0o777), 0o600);
  assert.equal(owner.manifest.initial.inventory.length, 6); assert(Object.isFrozen(owner.manifest.initial.inventory));
  for (const flag of ['sandboxed', 'hostileTreeContained', 'atomicSnapshot', 'cleanupProvided', 'applyBackProvided', 'authorizing', 'certificationGranted']) assert.equal(owner.manifest[flag], false);
  assert.equal(owner.manifest.executionStatus, 'NOT_RUN');
  const pre = await owner.checkpoint('PRE'), post = await owner.checkpoint('POST');
  assert.equal(pre.previousFingerprint, owner.manifest.fingerprint); assert.equal(post.previousFingerprint, pre.fingerprint);
  assert.equal(owner.status(), 'POSTCHECKED'); assert.equal(owner.observations().length, 2);
  assert.equal(p.baseline.files.find(f => f.path === 'src/value.mjs').content, files[0].content);
});

test('workspace permits empty, multibyte and NUL text already admitted by the preparation contract', async t => {
  const p = prep([{ path: 'new/empty.txt', content: '' }, { path: 'new/unicode.txt', content: '\ufeff雪\0🙂\n' }]);
  const owner = await materialize(options(await parent(t), p));
  assert.deepEqual(await fs.readFile(path.join(owner.root, 'new/unicode.txt')), Buffer.from('\ufeff雪\0🙂\n'));
  assert.equal((await fs.stat(path.join(owner.root, 'new/empty.txt'))).size, 0); await owner.checkpoint('PRE');
});

test('workspace refuses invalid shape, unissued preparation and broad parents before writing', async t => {
  const root = await parent(t), input = options(root);
  for (const candidate of [{ ...input, preparation: structuredClone(input.preparation) }, { ...input, profile: 'auto-approved' },
    { ...input, extra: true }, { ...input, parentRoot: 'relative' }, ...['/', os.homedir(), os.tmpdir(), '/tmp'].map(parentRoot => ({ ...input, parentRoot }))]) {
    await assert.rejects(materialize(candidate));
  }
  let invoked = false; await assert.rejects(materialize({ ...input, get preparation() { invoked = true; return input.preparation; } }));
  assert.equal(invoked, false); assert.deepEqual(await fs.readdir(root), []);
});

test('workspace refuses symlinked or group-writable parents', async t => {
  const root = await parent(t), selected = path.join(root, 'selected'), link = path.join(root, 'link');
  await fs.mkdir(selected, { mode: 0o700 }); await fs.symlink(selected, link);
  await assert.rejects(materialize(options(link)), code('WORKSPACE_DIRECTORY_REQUIRED'));
  await fs.chmod(selected, 0o770); await assert.rejects(materialize(options(selected)), code('WORKSPACE_PARENT_NOT_EXCLUSIVE'));
  assert.deepEqual(await fs.readdir(selected), []);
});

test('workspace refuses root execution and the canonical OS temp root', async t => {
  const root = await parent(t);
  await assert.rejects(materialize(options(await fs.realpath(os.tmpdir()))), code('WORKSPACE_PARENT_BROAD'));
  const mocked = t.mock.method(process, 'geteuid', () => 0);
  try { await assert.rejects(materialize(options(root)), code('WORKSPACE_ROOT_USER_UNSUPPORTED')); }
  finally { mocked.mock.restore(); }
  assert.deepEqual(await fs.readdir(root), []);
});

test('issued owners and ordered checkpoints cannot be cloned, repeated or overlapped', async t => {
  const owner = await materialize(options(await parent(t)));
  assert.throws(() => issuedTaskWorkspaceV1({ ...owner }), code('WORKSPACE_OWNER_NOT_ISSUED'));
  await assert.rejects(owner.checkpoint('POST'), code('WORKSPACE_STATE'));
  await assert.rejects(owner.checkpoint('OTHER'), code('WORKSPACE_PHASE'));
  const pending = owner.checkpoint('PRE'); await assert.rejects(owner.checkpoint('PRE'), code('WORKSPACE_STATE'));
  await pending; await assert.rejects(owner.checkpoint('PRE'), code('WORKSPACE_STATE'));
  await owner.checkpoint('POST'); await assert.rejects(owner.checkpoint('POST'), code('WORKSPACE_STATE'));
});

for (const [name, mutate] of [
  ['extra file', root => fs.writeFile(path.join(root, 'extra.txt'), 'x')],
  ['extra directory', root => fs.mkdir(path.join(root, 'extra'))],
  ['missing file', root => fs.unlink(path.join(root, 'config.json'))],
  ['same-length content change', root => fs.writeFile(path.join(root, 'config.json'), '{"value":9}\n')],
  ['same bytes new inode', async root => { const f = path.join(root, 'config.json'), bytes = await fs.readFile(f); await fs.rename(f, path.join(root, 'saved')); await fs.writeFile(f, bytes, { mode: 0o600 }); await fs.unlink(path.join(root, 'saved')); }],
  ['file hardlink', root => fs.link(path.join(root, 'config.json'), path.join(path.dirname(root), 'linked-config'))],
  ['file symlink', async root => { const f = path.join(root, 'config.json'); await fs.unlink(f); await fs.symlink('../outside', f); }],
  ['protected mode change', root => fs.chmod(path.join(root, 'checks/protected.txt'), 0o400)],
  ['directory mode change', root => fs.chmod(path.join(root, 'checks'), 0o500)],
  ['root replacement', async root => { await fs.rename(root, root + '-old'); await fs.mkdir(root, { mode: 0o700 }); }],
]) test('workspace quarantines post-use ' + name, async t => {
  const owner = await materialize(options(await parent(t))); await owner.checkpoint('PRE');
  await mutate(owner.root); await assert.rejects(owner.checkpoint('POST'));
  assert.equal(owner.status(), 'QUARANTINED'); assert.equal(owner.observations().at(-1).status, 'REFUSED');
  await assert.rejects(owner.checkpoint('POST'), code('WORKSPACE_STATE'));
  if (name === 'directory mode change') await fs.chmod(path.join(owner.root, 'checks'), 0o700);
});

test('workspace loops positive short writes and refuses a no-progress write with retained root', async t => {
  const root = await parent(t);
  const short = createTaskWorkspaceMaterializerV1({ ...fs, open: async (...args) => {
    const h = await fs.open(...args); if (!(args[1] & constants.O_WRONLY)) return h;
    return handleProxy(h, { write: (b, offset, length, position) => h.write(b, offset, Math.min(2, length), position) });
  } });
  const owner = await short(options(root)); await owner.checkpoint('PRE');
  const zero = createTaskWorkspaceMaterializerV1({ ...fs, open: async (...args) => {
    const h = await fs.open(...args); return args[1] & constants.O_WRONLY ? handleProxy(h, { write: async () => ({ bytesWritten: 0 }) }) : h;
  } });
  await assert.rejects(zero(options(root)), e => e.code === 'WORKSPACE_WRITE_NO_PROGRESS' && typeof e.root === 'string');
  assert.equal((await fs.readdir(root)).length, 2);
});

test('exclusive creation refuses an injected preexisting file without overwriting it', async t => {
  const root = await parent(t); let file;
  const create = createTaskWorkspaceMaterializerV1({ ...fs, open: async (...args) => {
    if (args[1] & constants.O_WRONLY) { file = args[0]; await fs.writeFile(file, 'sentinel', { flag: 'wx', mode: 0o600 }); }
    return fs.open(...args);
  } });
  await assert.rejects(create(options(root)), e => e.code === 'WORKSPACE_IO_ERROR' && e.systemCode === 'EEXIST');
  assert.equal(await fs.readFile(file, 'utf8'), 'sentinel');
});

test('uncertain write close overrides prior write failure and retains partial materialization', async t => {
  for (const failure of [false, true]) {
    const root = await parent(t), create = createTaskWorkspaceMaterializerV1({ ...fs, open: async (...args) => {
      const h = await fs.open(...args); if (!(args[1] & constants.O_WRONLY)) return h;
      return handleProxy(h, { ...(failure ? { write: async () => { throw Object.assign(new Error('write fault'), { code: 'EIO' }); } } : {}),
        close: async () => { await h.close(); throw new Error('close acknowledgement unknown'); } });
    } });
    await assert.rejects(create(options(root)), e => e.code === 'WORKSPACE_CLOSE_UNCONFIRMED' &&
      e.priorCode === (failure ? 'EIO' : null) && typeof e.root === 'string');
    assert.equal((await fs.readdir(root)).length, 1);
  }
});

test('checkpoint close uncertainty quarantines even when all read bytes match', async t => {
  let failClose = false;
  const create = createTaskWorkspaceMaterializerV1({ ...fs, open: async (...args) => {
    const h = await fs.open(...args); if (args[1] & constants.O_WRONLY) return h;
    return handleProxy(h, { close: async () => { await h.close(); if (failClose) throw new Error('uncertain read close'); } });
  } });
  const owner = await create(options(await parent(t))); failClose = true;
  await assert.rejects(owner.checkpoint('PRE'), code('WORKSPACE_CLOSE_UNCONFIRMED'));
  assert.equal(owner.status(), 'QUARANTINED');
});

test('checkpoint directory close uncertainty is retained rather than ignored', async t => {
  let failClose = false;
  const create = createTaskWorkspaceMaterializerV1({ ...fs, opendir: async (...args) => {
    const d = await fs.opendir(...args); return { read: () => d.read(), close: async () => { await d.close(); if (failClose) throw new Error('uncertain directory close'); } };
  } });
  const owner = await create(options(await parent(t))); failClose = true;
  await assert.rejects(owner.checkpoint('PRE'), code('WORKSPACE_CLOSE_UNCONFIRMED'));
  assert.equal(owner.status(), 'QUARANTINED');
});

test('metadata-only drift is refused even when every file byte and inode still matches', async t => {
  const owner = await materialize(options(await parent(t))); await owner.checkpoint('PRE');
  await fs.utimes(path.join(owner.root, 'config.json'), 1000000000, 1000000000);
  await assert.rejects(owner.checkpoint('POST'), code('WORKSPACE_DRIFT')); assert.equal(owner.status(), 'QUARANTINED');
});

test('all file opens request nofollow and write opens also request exclusive creation', async t => {
  let writes = 0, reads = 0;
  const create = createTaskWorkspaceMaterializerV1({ ...fs, open: async (...args) => {
    assert(args[1] & constants.O_NOFOLLOW);
    if (args[1] & constants.O_WRONLY) { assert(args[1] & constants.O_EXCL); assert(args[1] & constants.O_CREAT); writes++; }
    else reads++;
    return fs.open(...args);
  } });
  const owner = await create(options(await parent(t))); await owner.checkpoint('PRE');
  assert.equal(writes, 3); assert.equal(reads, 6);
});

test('parent identity change before handoff refuses with a retained root', async t => {
  const root = await parent(t), canonical = await fs.realpath(root); let visits = 0;
  const create = createTaskWorkspaceMaterializerV1({ ...fs, lstat: async (...args) => {
    const stat = await fs.lstat(...args);
    if ((args[0] === root || args[0] === canonical) && ++visits === 3) {
      return new Proxy(stat, { get: (target, key) => key === 'ino' ? target.ino + 1n : Reflect.get(target, key) });
    }
    return stat;
  } });
  await assert.rejects(create(options(root)), e => e.code === 'WORKSPACE_PARENT_CHANGED' && typeof e.root === 'string');
});

test('new ancestor EEXIST is a refusal, not mkdir-recursive reuse', async t => {
  const root = await parent(t);
  const create = createTaskWorkspaceMaterializerV1({ ...fs, mkdir: async (...args) => { await fs.mkdir(...args); return fs.mkdir(...args); } });
  await assert.rejects(create(options(root)), e => e.code === 'WORKSPACE_IO_ERROR' && e.systemCode === 'EEXIST' && typeof e.root === 'string');
});

test('short reads complete, but early EOF, corrupted bytes and invalid byte counts refuse initial admission', async t => {
  for (const mode of ['short', 'early', 'invalid', 'corrupt']) {
    const create = createTaskWorkspaceMaterializerV1({ ...fs, open: async (...args) => {
      const h = await fs.open(...args); if (args[1] & constants.O_WRONLY) return h;
      return handleProxy(h, { read: async (b, offset, length, position) => {
        if (mode === 'short') return h.read(b, offset, Math.min(2, length), position);
        if (mode === 'corrupt') { const r = await h.read(b, offset, length, position); if (r.bytesRead) b[offset] ^= 1; return r; }
        return { bytesRead: mode === 'early' ? 0 : length + 1 };
      } });
    } });
    const input = options(await parent(t));
    if (mode === 'short') await (await create(input)).checkpoint('PRE');
    else await assert.rejects(create(input), e => e.code === (mode === 'invalid' ? 'WORKSPACE_READ_INVALID' : 'WORKSPACE_BYTES_CHANGED') && typeof e.root === 'string');
  }
});
