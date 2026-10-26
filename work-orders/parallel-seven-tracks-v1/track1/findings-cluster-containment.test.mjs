import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Luna-drafted, owner-inspected fixture-only regression tests. No OS sandbox
// or native/model acceptance is established by these controlled filesystem cases.
import { installFixtureWriteGuard } from './fixture-write-guard.mjs';

const WRITE_FLAGS = fs.constants.O_WRONLY | fs.constants.O_CREAT;
const rawSymlinkSync = fs.symlinkSync.bind(fs);

function layout() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nisi-c04-')));
  const parent = path.join(base, 'parent');
  const escape = path.join(base, 'escape');
  fs.mkdirSync(parent);
  fs.mkdirSync(escape);
  const sentinel = path.join(escape, 'sentinel.txt');
  fs.writeFileSync(sentinel, 'unrelated-sentinel\n', { flag: 'wx', mode: 0o600 });
  return Object.freeze({
    base,
    parent,
    escape,
    sentinel,
    readable: sentinel,
    before: Object.freeze({
      base: Object.freeze(fs.readdirSync(base).sort()),
      parent: Object.freeze(fs.readdirSync(parent).sort()),
      escape: Object.freeze(fs.readdirSync(escape).sort()),
    }),
  });
}

function siblingSnapshot(l, root) {
  const rootName = root === null ? null : path.basename(root);
  return Object.freeze({
    base: Object.freeze(fs.readdirSync(l.base).sort()),
    escape: Object.freeze(fs.readdirSync(l.escape).sort()),
    sentinel: fs.readFileSync(l.sentinel, 'utf8'),
    parent: Object.freeze(fs.readdirSync(l.parent).filter(name => name !== rootName).sort()),
  });
}

function assertNoSiblingResidue(l, root, observed = siblingSnapshot(l, root)) {
  assert.deepEqual(observed.base, [...l.before.base], `base residue: ${JSON.stringify(observed)}`);
  assert.deepEqual(observed.escape, [...l.before.escape], `escape residue: ${JSON.stringify(observed)}`);
  assert.equal(observed.sentinel, 'unrelated-sentinel\n', `sentinel changed: ${JSON.stringify(observed)}`);
  assert.deepEqual(observed.parent, [...l.before.parent], `parent residue: ${JSON.stringify(observed)}`);
}

function cleanup(l, root) {
  if (root !== null && fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(l.base, { recursive: true, force: true });
}

async function allocate(g, l) {
  g.markReady();
  return await fsp.mkdtemp(path.join(l.parent, 'nisi-fixture-'));
}

async function capture(action) {
  try {
    await action();
    return null;
  } catch (error) {
    return error;
  }
}

function assertDenied(error, forbidden, label) {
  assert.notEqual(error, null, `${label}: operation must be denied`);
  assert.match(String(error?.code ?? ''), /^TEST_FORBIDDEN_SIDE_EFFECT/,
    `${label}: denial must carry the guard code`);
  assert.ok(forbidden.length > 0, `${label}: guard must retain a forbidden entry`);
  assert.ok(forbidden.every(value => typeof value === 'string'),
    `${label}: forbidden entries must be strings`);
}

async function deniedCase(label, action) {
  const l = layout();
  let g = null;
  let root = null;
  let closed = false;
  try {
    g = await installFixtureWriteGuard({ parentRoot: l.parent, profileAccepted: true });
    root = await allocate(g, l);
    const error = await capture(() => action({ l, root }));
    const forbidden = [...g.forbidden];
    const writes = [...g.writes];
    g.close();
    closed = true;
    const observed = siblingSnapshot(l, root);
    assertNoSiblingResidue(l, root, observed);
    assertDenied(error, forbidden, label);
    assert.ok(writes.length > 0, `${label}: attempted operation must be journaled`);
  } finally {
    if (g !== null && !closed) g.close();
    cleanup(l, root);
  }
}

async function nestedAllocationCase(label, prepareInvalidReturn) {
  const l = layout();
  const descriptor = Object.getOwnPropertyDescriptor(fsp, 'mkdtemp');
  const original = descriptor.value;
  let root = null;
  let g = null;
  let closed = false;
  let overrideInstalled = false;
  Object.defineProperty(fsp, 'mkdtemp', {
    ...descriptor,
    value: async function (...args) {
      const result = await original.apply(this, args);
      if (root !== null && String(args[0]).startsWith(`${root}${path.sep}nisi-task-`)) {
        return prepareInvalidReturn({ l, root, result });
      }
      return result;
    },
  });
  overrideInstalled = true;
  try {
    g = await installFixtureWriteGuard({ parentRoot: l.parent, profileAccepted: true });
    root = await allocate(g, l);
    const error = await capture(() => fsp.mkdtemp(path.join(root, 'nisi-task-')));
    const forbidden = [...g.forbidden];
    const allocations = [...g.allocations];
    g.close();
    closed = true;
    // The guard restores the wrapper to the test stub; restore the real
    // descriptor before making any post-close assertions or starting cleanup.
    Object.defineProperty(fsp, 'mkdtemp', descriptor);
    overrideInstalled = false;
    const observed = siblingSnapshot(l, root);
    assertNoSiblingResidue(l, root, observed);
    assertDenied(error, forbidden, label);
    assert.equal(allocations.length, 1, `${label}: only the top-level root may be recorded`);
  } finally {
    if (g !== null && !closed) { try { g.close(); } catch {} }
    if (overrideInstalled) Object.defineProperty(fsp, 'mkdtemp', descriptor);
    cleanup(l, root);
  }
}

test('positive control admits exact allocation, descendant materialization, handles, and sync writes', async () => {
  const l = layout();
  let g = null;
  let root = null;
  let closed = false;
  try {
    g = await installFixtureWriteGuard({ parentRoot: l.parent, profileAccepted: true });
    root = await allocate(g, l);
    const taskRoot = await fsp.mkdtemp(path.join(root, 'nisi-task-'));
    await fsp.mkdir(path.join(taskRoot, 'nested'));
    await fsp.writeFile(path.join(taskRoot, 'promise.txt'), 'promise\n', { flag: 'wx', mode: 0o600 });
    const promiseHandle = await fsp.open(path.join(taskRoot, 'handle.txt'), WRITE_FLAGS, 0o600);
    await promiseHandle.writeFile('handle\n');
    await promiseHandle.close();
    const syncFd = fs.openSync(path.join(taskRoot, 'sync.txt'), WRITE_FLAGS, 0o600);
    fs.writeSync(syncFd, Buffer.from('sync\n'));
    fs.closeSync(syncFd);
    const callbackError = await capture(() => new Promise((resolve, reject) => {
      try {
        fs.writeFile(path.join(taskRoot, 'callback.txt'), 'callback\n', { flag: 'wx', mode: 0o600 }, error => {
          if (error) reject(error); else resolve();
        });
      } catch (error) { reject(error); }
    }));
    g.close();
    closed = true;
    g.assertClean();
    assert.equal(callbackError, null);
    assert.equal(g.forbidden.length, 0);
    assert.ok(g.writes.length > 0);
    assert.equal(fs.readFileSync(path.join(taskRoot, 'callback.txt'), 'utf8'), 'callback\n');
    assertNoSiblingResidue(l, root);
  } finally {
    if (g !== null && !closed) g.close();
    cleanup(l, root);
  }
});

test('pre-readiness and wrong-profile states cannot allocate or write', async () => {
  for (const [label, profileAccepted, mark] of [
    ['not-ready', true, false],
    ['profile-refused', false, true],
  ]) {
    const l = layout();
    const g = await installFixtureWriteGuard({ parentRoot: l.parent, profileAccepted });
    let readyError = null;
    let allocationError = null;
    let root = null;
    try {
      if (mark) readyError = await capture(() => g.markReady());
      allocationError = await capture(async () => { root = await fsp.mkdtemp(path.join(l.parent, 'nisi-fixture-')); });
      const forbidden = [...g.forbidden];
      g.close();
      assert.notEqual(mark ? readyError : allocationError, null, `${label}: refusal must be observable`);
      assert.equal(g.ownedRoot, null, `${label}: no owned root may be admitted`);
      assert.ok(forbidden.length > 0, `${label}: pre-readiness mutation must be forbidden`);
      assertNoSiblingResidue(l, root);
    } finally {
      if (g.close) {
        try { g.close(); } catch {}
      }
      cleanup(l, root);
    }
  }
});

test('only one exact top-level allocation is admitted; stale readiness cannot authorize a later guard', async () => {
  const l = layout();
  const g = await installFixtureWriteGuard({ parentRoot: l.parent, profileAccepted: true });
  let root = null;
  try {
    const nestedError = await capture(() => installFixtureWriteGuard({ parentRoot: l.parent, profileAccepted: true }));
    g.markReady();
    root = await fsp.mkdtemp(path.join(l.parent, 'nisi-fixture-'));
    const secondError = await capture(() => fsp.mkdtemp(path.join(l.parent, 'nisi-fixture-')));
    const forbidden = [...g.forbidden];
    g.close();
    assert.notEqual(nestedError, null);
    assert.equal(nestedError?.code, 'FIXTURE_GUARD_ALREADY_INSTALLED');
    assertDenied(secondError, forbidden, 'second top-level allocation');
    assert.equal(g.ownedRoot, fs.realpathSync(root));
    assertNoSiblingResidue(l, root);
  } finally {
    try { g.close(); } catch {}
    cleanup(l, root);
  }

  const late = layout();
  const stale = await installFixtureWriteGuard({ parentRoot: late.parent, profileAccepted: true });
  stale.close();
  const fresh = await installFixtureWriteGuard({ parentRoot: late.parent, profileAccepted: true });
  let freshError = null;
  try {
    const lateResult = await Promise.resolve().then(() => stale.markReady());
    assert.equal(lateResult, false, 'a closed generation cannot become ready');
    freshError = await capture(() => fsp.mkdtemp(path.join(late.parent, 'nisi-fixture-')));
    const freshState = fresh.state;
    const freshForbidden = [...fresh.forbidden];
    fresh.close();
    assertDenied(freshError, freshForbidden, 'stale readiness must not authorize a new guard');
    assert.equal(freshState, 'PREVALIDATION');
    assert.equal(fresh.ownedRoot, null);
    assertNoSiblingResidue(late, null);
  } finally {
    try { fresh.close(); } catch {}
    cleanup(late, null);
  }
});

test('promise, callback, and synchronous file mutators reject escape paths', async () => {
  await deniedCase('parent escape', ({ l }) => fsp.writeFile(`${l.parent}/../parent-escape.txt`, 'x'));
  await deniedCase('parent sibling engine-report write', ({ l }) => fsp.writeFile(path.join(l.parent, 'engine-report.json'), 'x'));
  await deniedCase('fsp.writeFile outside', ({ l }) => fsp.writeFile(path.join(l.escape, 'promise.txt'), 'x'));
  await deniedCase('fs.writeFile callback outside', ({ l }) => new Promise((resolve, reject) => {
    try {
      fs.writeFile(path.join(l.escape, 'callback.txt'), 'x', error => error ? reject(error) : resolve());
    } catch (error) { reject(error); }
  }));
  await deniedCase('fs.writeFileSync outside', ({ l }) => fs.writeFileSync(path.join(l.escape, 'sync.txt'), 'x'));
  await deniedCase('fsp.appendFile outside', ({ l }) => fsp.appendFile(path.join(l.escape, 'append.txt'), 'x'));
  await deniedCase('fs.appendFileSync outside', ({ l }) => fs.appendFileSync(path.join(l.escape, 'append-sync.txt'), 'x'));
});

test('write-capable open flags are rejected while read-only outside opens remain usable', async () => {
  await deniedCase('fsp.open string write flag', async ({ l }) => {
    const handle = await fsp.open(path.join(l.escape, 'string.txt'), 'w');
    try { return handle; } finally { await handle.close(); }
  });
  await deniedCase('fsp.open numeric write flags', async ({ l }) => {
    const handle = await fsp.open(path.join(l.escape, 'numeric.txt'), WRITE_FLAGS, 0o600);
    try { return handle; } finally { await handle.close(); }
  });
  await deniedCase('fs.open callback numeric write flags', ({ l }) => new Promise((resolve, reject) => {
    try {
      fs.open(path.join(l.escape, 'callback-open.txt'), WRITE_FLAGS, 0o600, (error, fd) => {
        if (error) return reject(error);
        try { fs.closeSync(fd); } catch (closeError) { return reject(closeError); }
        resolve();
      });
    } catch (error) { reject(error); }
  }));
  await deniedCase('fs.openSync numeric write flags', ({ l }) => {
    const fd = fs.openSync(path.join(l.escape, 'sync-open.txt'), WRITE_FLAGS, 0o600);
    try { return fd; } finally { fs.closeSync(fd); }
  });

  const l = layout();
  let g = null;
  let root = null;
  let handle = null;
  let fd = null;
  try {
    g = await installFixtureWriteGuard({ parentRoot: l.parent, profileAccepted: true });
    root = await allocate(g, l);
    handle = await fsp.open(l.readable, 'r');
    const handleError = await capture(() => handle.writeFile('must-not-write'));
    fd = await new Promise((resolve, reject) => fs.open(l.readable, 'r', (error, value) => error ? reject(error) : resolve(value)));
    const descriptorError = await capture(() => new Promise((resolve, reject) => {
      try {
        fs.write(fd, Buffer.from('must-not-write'), error => error ? reject(error) : resolve());
      } catch (error) { reject(error); }
    }));
    await handle.close();
    handle = null;
    fs.closeSync(fd);
    fd = null;
    const forbidden = [...g.forbidden];
    g.close();
    assertDenied(handleError, forbidden, 'read-open FileHandle mutation');
    assertDenied(descriptorError, forbidden, 'unknown/read-only descriptor mutation');
    assertNoSiblingResidue(l, root);
  } finally {
    if (handle !== null) { try { await handle.close(); } catch {} }
    if (fd !== null) { try { fs.closeSync(fd); } catch {} }
    if (g !== null) { try { g.close(); } catch {} }
    cleanup(l, root);
  }
});

test('both operands of two-path operations and symlink targets must be descendants', async () => {
  const cases = [
    ['rename source outside', async ({ l, root }) => {
      await fsp.writeFile(path.join(root, 'rename-dest'), 'x');
      return fsp.rename(l.readable, path.join(root, 'rename-dest'));
    }],
    ['rename destination outside', async ({ l, root }) => {
      await fsp.writeFile(path.join(root, 'rename-source'), 'x');
      return fsp.rename(path.join(root, 'rename-source'), path.join(l.escape, 'rename-dest'));
    }],
    ['copyFile source outside', ({ l, root }) => fsp.copyFile(l.readable, path.join(root, 'copy-dest'))],
    ['copyFile destination outside', async ({ l, root }) => {
      const source = path.join(root, 'copy-source');
      await fsp.writeFile(source, 'x');
      return fsp.copyFile(source, path.join(l.escape, 'copy-dest'));
    }],
    ['cp source outside', ({ l, root }) => fsp.cp(l.readable, path.join(root, 'cp-dest'))],
    ['cp destination outside', async ({ l, root }) => {
      const source = path.join(root, 'cp-source');
      await fsp.writeFile(source, 'x');
      return fsp.cp(source, path.join(l.escape, 'cp-dest'));
    }],
    ['hardlink source outside', ({ l, root }) => fsp.link(l.readable, path.join(root, 'hardlink-dest'))],
    ['hardlink destination outside', async ({ l, root }) => {
      const source = path.join(root, 'hardlink-source');
      await fsp.writeFile(source, 'x');
      return fsp.link(source, path.join(l.escape, 'hardlink-dest'));
    }],
    ['symlink target outside', ({ l, root }) => fsp.symlink(l.escape, path.join(root, 'symlink-dest'), 'dir')],
    ['symlink link outside', ({ l, root }) => fsp.symlink(root, path.join(l.escape, 'symlink-dest'), 'dir')],
  ];
  for (const [label, action] of cases) await deniedCase(label, action);
});

test('physical symlink ancestor and raw link/.. traversal are rejected', async () => {
  await deniedCase('symlink ancestor', async ({ l, root }) => {
    // Setup uses the captured original solely to construct the owned test
    // topology; the attempted write itself goes through the guarded API.
    rawSymlinkSync(l.escape, path.join(root, 'redirect'), 'dir');
    return fsp.writeFile(path.join(root, 'redirect', 'payload.txt'), 'escape');
  });
  await deniedCase('raw link/.. traversal', async ({ l, root }) => {
    rawSymlinkSync(l.escape, path.join(root, 'redirect'), 'dir');
    const rawPath = `${root}/redirect/../dotdot-payload.txt`;
    return fsp.writeFile(rawPath, 'escape');
  });
  await deniedCase('unresolved missing/.. traversal', ({ root }) =>
    fsp.writeFile(`${root}/missing/../unresolved-dotdot.txt`, 'escape'));
});

test('final symlink to an owned file is refused without altering the target', async () => {
  const l = layout();
  let g = null, root = null;
  try {
    g = await installFixtureWriteGuard({ parentRoot: l.parent, profileAccepted: true });
    root = await allocate(g, l);
    const target = path.join(root, 'known.txt'), link = path.join(root, 'final-link');
    await fsp.writeFile(target, 'preserve these exact bytes\n');
    rawSymlinkSync(target, link);
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true, 'test setup must establish a real link');
    const error = await capture(() => fsp.appendFile(link, 'must-not-append'));
    const forbidden = [...g.forbidden];
    g.close();
    assert.equal(fs.readFileSync(target, 'utf8'), 'preserve these exact bytes\n');
    assertNoSiblingResidue(l, root);
    assertDenied(error, forbidden, 'final symlink');
    assert.ok(forbidden.includes('final symlink'));
  } finally {
    g?.close();
    cleanup(l, root);
  }
});

test('nested allocations reject outside, symlinked, and non-directory returns', async () => {
  await nestedAllocationCase('nested allocation outside', ({ l }) => l.escape);
  await nestedAllocationCase('nested allocation symlink return', ({ l, root }) => {
    const redirect = path.join(root, 'allocation-redirect');
    rawSymlinkSync(l.escape, redirect, 'dir');
    return redirect;
  });
  await nestedAllocationCase('nested allocation non-directory return', ({ root }) => {
    const file = path.join(root, 'allocation-file');
    fs.writeFileSync(file, 'not-a-directory', { flag: 'wx', mode: 0o600 });
    return file;
  });
});

for (const fault of ['outside', 'root-itself', 'symlink']) {
  test(`runner refuses ${fault} workspace before invoking its executor`, () => {
    const l = layout();
    const workspaceURL = new URL('../../../hosts/repository/task-workspace-v1.mjs', import.meta.url).href;
    const executorURL = new URL('../../../hosts/repository/node-executor-v1.mjs', import.meta.url).href;
    const runnerURL = new URL('./repository-fixture-runner.mjs', import.meta.url).href;
    const script = `
      import { mock } from 'node:test';
      import fs from 'node:fs/promises';
      import path from 'node:path';
      import assert from 'node:assert/strict';
      const workspaceModule = await import(${JSON.stringify(workspaceURL)});
      const executorModule = await import(${JSON.stringify(executorURL)});
      let executorCalls = 0, materializations = 0;
      mock.module(${JSON.stringify(workspaceURL)}, { namedExports: {
        ...workspaceModule,
        async materializeRepositoryCandidateV1(input) {
          const actual = await workspaceModule.materializeRepositoryCandidateV1(input);
          materializations++;
          let root = ${JSON.stringify(l.escape)};
          if (${JSON.stringify(fault)} === 'root-itself') root = input.parentRoot;
          if (${JSON.stringify(fault)} === 'symlink') {
            root = path.join(input.parentRoot, 'workspace-link-' + materializations);
            await fs.symlink(actual.root, root, 'dir');
          }
          return { ...actual, root };
        }
      }});
      mock.module(${JSON.stringify(executorURL)}, { namedExports: {
        ...executorModule,
        createNodeExecutorWithDependenciesV1(...args) {
          const actual = executorModule.createNodeExecutorWithDependenciesV1(...args);
          return { ...actual, execute(...input) { executorCalls++; return actual.execute(...input); } };
        }
      }});
      const runner = await import(${JSON.stringify(runnerURL)});
      const result = await runner.runRepositoryFixtureAcceptanceV1({
        parentRoot: ${JSON.stringify(l.parent)}, profile: runner.REPOSITORY_FIXTURE_RUNNER_PROFILE
      });
      assert.ok(materializations > 0, 'fault must reach the actual materializer');
      assert.equal(executorCalls, 0, 'an invalid workspace must not reach executor.execute');
      assert.notEqual(result.status, 'COMPLETED');
      assert.equal(result.receipt, null);
      console.log(JSON.stringify({ materializations, executorCalls, status: result.status }));
    `;
    try {
      const run = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--input-type=module', '-e', script],
        { encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024 });
      const observed = siblingSnapshot(l, null);
      assert.equal(run.error, undefined, run.error?.message);
      assert.equal(run.signal, null, run.stderr);
      assert.equal(run.status, 0, run.stderr);
      assertNoSiblingResidue(l, null, observed);
      const result = JSON.parse(run.stdout.trim());
      assert.equal(result.executorCalls, 0);
    } finally { cleanup(l, null); }
  });
}

test('streams may be refused outright and patches are restored after close', async () => {
  await deniedCase('owned streams explicitly unsupported', ({ root }) => fs.createWriteStream(path.join(root, 'stream.txt')));
  await deniedCase('owned FileHandle streams explicitly unsupported', async ({ root }) => {
    const handle = await fsp.open(path.join(root, 'handle-stream.txt'), 'w');
    try { return handle.createWriteStream(); } finally { await handle.close(); }
  });
  await deniedCase('createWriteStream outside', ({ l }) => new Promise((resolve, reject) => {
    try {
      const stream = fs.createWriteStream(path.join(l.escape, 'stream.txt'));
      stream.once('error', reject);
      stream.once('open', () => { stream.destroy(); resolve(); });
    } catch (error) { reject(error); }
  }));

  const l = layout();
  const g = await installFixtureWriteGuard({ parentRoot: l.parent, profileAccepted: true });
  let root = null;
  try {
    root = await allocate(g, l);
    g.close();
    fs.writeFileSync(path.join(l.escape, 'after-close.txt'), 'restored', { flag: 'wx' });
    assert.equal(fs.readFileSync(path.join(l.escape, 'after-close.txt'), 'utf8'), 'restored');
    fs.rmSync(path.join(l.escape, 'after-close.txt'));
    assert.deepEqual(fs.readdirSync(l.escape).sort(), [...l.before.escape]);
  } finally {
    try { g.close(); } catch {}
    cleanup(l, root);
  }
});
