// Private cooperative cancellation tests: fixed local fixtures, no model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createTaskWorkspaceMaterializerV1, TASK_WORKSPACE_PROFILE } from '../hosts/repository/task-workspace-v1.mjs';
import { createReviewedNodeTestAdapterV1 } from '../hosts/repository/node-adapter-v1.mjs';
import { context } from './helpers/node-repository-fixture.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
const input = (c, extra = {}) => ({ preparation: c.preparations[1], parentRoot: c.parent,
  profile: TASK_WORKSPACE_PROFILE, ...extra });
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

test('already-aborted materialization performs zero filesystem operations', async t => {
  const c = await context(t), controller = new AbortController(); controller.abort();
  let calls = 0;
  const io = new Proxy({}, { get() { return () => { calls++; throw Error('I/O forbidden after pre-abort'); }; } });
  const materialize = createTaskWorkspaceMaterializerV1(io);
  await assert.rejects(materialize({ preparation: c.preparations[1], parentRoot: c.parent,
    profile: TASK_WORKSPACE_PROFILE, signal: controller.signal }), { code: 'WORKSPACE_ABORTED' });
  assert.equal(calls, 0); assert.deepEqual(await fs.readdir(c.parent), []);
});

test('signal schema is descriptor-safe and malformed signals initiate no I/O', async t => {
  const c = await context(t); let calls = 0;
  const io = new Proxy({}, { get() { return () => { calls++; throw Error('unexpected I/O'); }; } });
  const materialize = createTaskWorkspaceMaterializerV1(io);
  await assert.rejects(materialize(null), { code: 'WORKSPACE_INPUT_SCHEMA' });
  for (const signal of [undefined, {}])
    await assert.rejects(materialize(input(c, { signal })), { code: 'WORKSPACE_SIGNAL_INVALID' });
  let invoked = false;
  await assert.rejects(materialize({ ...input(c), get signal() { invoked = true; return new AbortController().signal; } }),
    { code: 'WORKSPACE_INPUT_SCHEMA' });
  assert.equal(invoked, false); assert.equal(calls, 0);
});

test('abort observed after late write-handle acquisition closes exactly once and retains root', async t => {
  const c = await context(t), controller = new AbortController(); let closes = 0, writes = 0;
  const materialize = createTaskWorkspaceMaterializerV1({ ...fs, open: async (...args) => {
    const handle = await fs.open(...args);
    if (!(args[1] & constants.O_WRONLY)) return handle;
    controller.abort();
    return new Proxy(handle, { get(target, key) {
      if (key === 'close') return async () => { closes++; return handle.close(); };
      if (key === 'write') return (...values) => { writes++; return handle.write(...values); };
      const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
  } });
  await assert.rejects(materialize(input(c, { signal: controller.signal })),
    error => error.code === 'WORKSPACE_ABORTED' && typeof error.root === 'string');
  assert.equal(closes, 1); assert.equal(writes, 0); assert.equal((await fs.readdir(c.parent)).length, 1);
});

test('close uncertainty after late acquisition abort retains abort as prior code', async t => {
  const c = await context(t), controller = new AbortController();
  const materialize = createTaskWorkspaceMaterializerV1({ ...fs, open: async (...args) => {
    const handle = await fs.open(...args); if (!(args[1] & constants.O_WRONLY)) return handle; controller.abort();
    return new Proxy(handle, { get(target, key) {
      if (key === 'close') return async () => { await handle.close(); throw Error('close uncertain'); };
      const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
  } });
  await assert.rejects(materialize(input(c, { signal: controller.signal })), error =>
    error.code === 'WORKSPACE_CLOSE_UNCONFIRMED' && error.priorCode === 'WORKSPACE_ABORTED' && typeof error.root === 'string');
});

test('abort after mkdtemp retains the exact partial root without cleanup', async t => {
  const c = await context(t), controller = new AbortController(); let created;
  const materialize = createTaskWorkspaceMaterializerV1({ ...fs, mkdtemp: async (...args) => {
    created = await fs.mkdtemp(...args); controller.abort(); return created;
  } });
  await assert.rejects(materialize(input(c, { signal: controller.signal })), error =>
    error.code === 'WORKSPACE_ABORTED' && error.root === created);
  assert.equal((await fs.lstat(created)).isDirectory(), true);
});

test('malformed mkdtemp result is refused before a simultaneous abort is reported', async t => {
  const c = await context(t), controller = new AbortController();
  const materialize = createTaskWorkspaceMaterializerV1({ ...fs, mkdtemp: async () => { controller.abort(); return 42; } });
  await assert.rejects(materialize(input(c, { signal: controller.signal })), { code: 'WORKSPACE_ROOT_INVALID' });
});

test('abort after partial write or sync closes the acquired creation handle', async t => {
  for (const boundary of ['write', 'sync']) {
    const c = await context(t), controller = new AbortController(); let closes = 0, writes = 0, partialBytes, requestedBytes;
    const materialize = createTaskWorkspaceMaterializerV1({ ...fs, open: async (...args) => {
      const handle = await fs.open(...args); if (!(args[1] & constants.O_WRONLY)) return handle;
      return new Proxy(handle, { get(target, key) {
        if (key === 'write') return async (...values) => {
          requestedBytes = values[2];
          if (boundary === 'write') values[2] = Math.max(1, Math.floor(values[2] / 2));
          const result = await handle.write(...values); writes++;
          if (boundary === 'write') { partialBytes = result.bytesWritten; controller.abort(); }
          return result;
        };
        if (key === 'sync') return async () => { await handle.sync(); if (boundary === 'sync') controller.abort(); };
        if (key === 'close') return async () => { closes++; return handle.close(); };
        const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
      } });
    } });
    await assert.rejects(materialize(input(c, { signal: controller.signal })), error =>
      error.code === 'WORKSPACE_ABORTED' && typeof error.root === 'string');
    assert.equal(closes, 1); assert.equal(writes, 1);
    if (boundary === 'write') assert.ok(partialBytes > 0 && partialBytes < requestedBytes);
  }
});

test('late directory and read-only handle acquisition closes before reading', async t => {
  for (const boundary of ['directory', 'file']) {
    const c = await context(t), controller = new AbortController(); let closes = 0, reads = 0;
    const io = { ...fs };
    if (boundary === 'directory') io.opendir = async (...args) => {
      const directory = await fs.opendir(...args); controller.abort();
      return { read: async () => { reads++; return directory.read(); },
        close: async () => { closes++; return directory.close(); } };
    };
    else io.open = async (...args) => {
      const handle = await fs.open(...args); if (args[1] & constants.O_WRONLY) return handle;
      controller.abort();
      return new Proxy(handle, { get(target, key) {
        if (key === 'read') return async (...values) => { reads++; return handle.read(...values); };
        if (key === 'close') return async () => { closes++; return handle.close(); };
        const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
      } });
    };
    await assert.rejects(createTaskWorkspaceMaterializerV1(io)(input(c, { signal: controller.signal })),
      { code: 'WORKSPACE_ABORTED' });
    assert.equal(reads, 0); assert.equal(closes, 1);
  }
});

test('abort during successful close stops before opening another file', async t => {
  const c = await context(t), controller = new AbortController(); let opens = 0, closes = 0;
  const materialize = createTaskWorkspaceMaterializerV1({ ...fs, open: async (...args) => {
    opens++; const handle = await fs.open(...args);
    return new Proxy(handle, { get(target, key) {
      if (key === 'close') return async () => { closes++; await handle.close(); controller.abort(); };
      const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
  } });
  await assert.rejects(materialize(input(c, { signal: controller.signal })), { code: 'WORKSPACE_ABORTED' });
  assert.equal(opens, 1); assert.equal(closes, 1);
});

test('I/O rejection coinciding with abort preserves the sanitized I/O failure', async t => {
  const c = await context(t), controller = new AbortController();
  const materialize = createTaskWorkspaceMaterializerV1({ ...fs, lstat: async () => {
    controller.abort(); throw Object.assign(Error('private diagnostic detail'), { code: 'EIO' });
  } });
  await assert.rejects(materialize(input(c, { signal: controller.signal })), error =>
    error.code === 'WORKSPACE_IO_ERROR' && error.systemCode === 'EIO' &&
    error.message === 'WORKSPACE_IO_ERROR' && error.root === null);
});

test('initial directory and file reads close their handles when abort follows settled work', async t => {
  for (const boundary of ['directory-read', 'file-read']) {
    const c = await context(t), controller = new AbortController(); let closes = 0;
    const io = { ...fs };
    if (boundary === 'directory-read') io.opendir = async (...args) => {
      const directory = await fs.opendir(...args); return {
        read: async () => { const result = await directory.read(); controller.abort(); return result; },
        close: async () => { closes++; return directory.close(); },
      };
    };
    else io.open = async (...args) => {
      const handle = await fs.open(...args); if (args[1] & constants.O_WRONLY) return handle;
      return new Proxy(handle, { get(target, key) {
        if (key === 'read') return async (...values) => { const result = await handle.read(...values); controller.abort(); return result; };
        if (key === 'close') return async () => { closes++; return handle.close(); };
        const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
      } });
    };
    await assert.rejects(createTaskWorkspaceMaterializerV1(io)(input(c, { signal: controller.signal })), error =>
      error.code === 'WORKSPACE_ABORTED' && typeof error.root === 'string');
    assert.equal(closes, 1);
  }
});

test('abort does not falsely settle pending I/O and is observed after release', async t => {
  const c = await context(t), controller = new AbortController(), gate = deferred(), started = deferred(); let first = true, settled = false;
  const materialize = createTaskWorkspaceMaterializerV1({ ...fs, lstat: async (...args) => {
    if (first) { first = false; started.resolve(); await gate.promise; } return fs.lstat(...args);
  } });
  const operation = materialize(input(c, { signal: controller.signal })).finally(() => { settled = true; });
  const expected = assert.rejects(operation, { code: 'WORKSPACE_ABORTED' });
  await started.promise; controller.abort(); await tick(); assert.equal(settled, false);
  gate.resolve(); await expected;
});

test('creation signal is not inherited by accepted PRE and POST checkpoints', async t => {
  const c = await context(t), controller = new AbortController();
  const owner = await createTaskWorkspaceMaterializerV1(fs)(input(c, { signal: controller.signal }));
  controller.abort(); const pre = await owner.checkpoint('PRE'), post = await owner.checkpoint('POST');
  assert.equal(pre.status, 'UNCHANGED_AT_CHECKPOINT'); assert.equal(post.status, 'UNCHANGED_AT_CHECKPOINT');
});

test('final inspection-to-owner poll refuses cancellation before issuing an owner', async t => {
  const c = await context(t), controller = new AbortController();
  const lastPath = c.preparations[1].materialized.files.at(-1).path;
  let lastPathStats = 0, boundaryPolls = 0, boundary = false;
  // Trusted test seam, not a timing or OS-preemption claim: the real signal's
  // getter switches at the two polls surrounding completion of initial inspect.
  const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
  Object.defineProperty(controller.signal, 'aborted', { configurable: true, get() {
    if (boundary && ++boundaryPolls === 2) controller.abort();
    return nativeAborted.call(controller.signal);
  } });
  const materialize = createTaskWorkspaceMaterializerV1({ ...fs, lstat: async (...args) => {
    const result = await fs.lstat(...args);
    if (args[0].endsWith('/' + lastPath) && ++lastPathStats === 2) boundary = true;
    return result;
  } });
  await assert.rejects(materialize(input(c, { signal: controller.signal })), error =>
    error.code === 'WORKSPACE_ABORTED' && typeof error.root === 'string');
  assert.equal(lastPathStats, 2); assert.equal(boundaryPolls, 2);
});

test('already-aborted adapter records cancellation without creating a workspace', async t => {
  const c = await context(t), controller = new AbortController(); controller.abort();
  const adapter = createReviewedNodeTestAdapterV1({ suite: c.suite, parentRoot: c.parent,
    totalTimeoutMs: 10000, childTimeoutMs: 5000, closeGraceMs: 500 });
  const p = c.preparations[1], payload = { task: p.task, candidate: p.candidate, signal: controller.signal,
    binding: { schemaVersion: 1, runId: randomUUID(), attempt: 1,
      taskFingerprint: p.taskFingerprint, candidateFingerprint: p.candidateFingerprint } };
  await assert.rejects(adapter.run(payload), { code: 'WORKSPACE_ABORTED' });
  assert.deepEqual(await fs.readdir(c.parent), []);
  const history = await adapter.settled(); assert.equal(history.length, 1);
  assert.equal(history[0].workspace, null); assert.equal(history[0].execution, null);
  assert.equal(history[0].adapterResult, null); assert.equal(history[0].error, 'WORKSPACE_ABORTED');
  assert.equal(adapter.status(), 'QUARANTINED');
  assert.throws(() => adapter.run(payload), { code: 'NODE_ADAPTER_QUARANTINED' });
});
