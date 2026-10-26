// Private lifecycle tests; trusted seams are not evidence of disk execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTaskMaterializationOwnerV1, TaskMaterializationError } from '../hosts/repository/task-materialization-owner-v1.mjs';
import { createReviewedNodeTestAdapterV1 } from '../hosts/repository/node-adapter-v1.mjs';
import { TASK_WORKSPACE_PROFILE } from '../hosts/repository/task-workspace-v1.mjs';
import { context } from './helpers/node-repository-fixture.mjs';

function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const binding = (p, attempt = 1) => ({ runId: randomUUID(), attempt, taskFingerprint: p.taskFingerprint,
  candidateFingerprint: p.candidateFingerprint, preparationFingerprint: p.fingerprint });
const input = (c, extra = {}) => ({ preparation: c.preparations[1], parentRoot: c.parent,
  profile: TASK_WORKSPACE_PROFILE, deadlineMs: 100, binding: binding(c.preparations[1]), ...extra });
function manualTimer() {
  let callback = null, clears = 0, delay = null;
  return { setTimer(fn, ms) { callback = fn; delay = ms; return 1; }, clearTimer() { clears++; callback = null; },
    fire() { const fn = callback; callback = null; fn?.(); }, clears: () => clears, delay: () => delay };
}

test('owner returns an on-time workspace once and clears its boundary timer', async t => {
  const c = await context(t), workspace = await c.workspace(), timer = manualTimer(); let time = 0;
  const owner = createTaskMaterializationOwnerV1({ materialize: async () => workspace, now: () => time++,
    setTimer: timer.setTimer, clearTimer: timer.clearTimer });
  assert.equal(await owner.run(input(c)), workspace); assert.equal(owner.status(), 'IDLE'); assert.equal(timer.clears(), 1);
  assert.throws(() => owner.run(input(c)), { code: 'MATERIALIZATION_OWNER_CONSUMED' });
  assert.equal(owner.observations().at(-1).outcome, 'FULFILLED');
});

test('pre-call elapsed time reduces the timer and explicit undefined config is refused', async t => {
  const c = await context(t), workspace = await c.workspace(), timer = manualTimer(); let n = 0;
  const owner = createTaskMaterializationOwnerV1({ materialize: async () => workspace,
    now: () => [10, 25, 30][Math.min(n++, 2)], setTimer: timer.setTimer, clearTimer: timer.clearTimer });
  await owner.run(input(c, { deadlineMs: 100 })); assert.equal(timer.delay(), 85);
  assert.throws(() => createTaskMaterializationOwnerV1({ now: undefined }), { code: 'MATERIALIZATION_OWNER_CONFIG' });
  assert.throws(() => createReviewedNodeTestAdapterV1({ suite: c.suite, parentRoot: c.parent,
    totalTimeoutMs: 1000, childTimeoutMs: 500, closeGraceMs: 10, materializationTimeoutMs: undefined }),
  { code: 'NODE_ADAPTER_BOUNDS' });
});

test('signal and timer setup failures are sanitized and never reported as user aborts', async t => {
  const c = await context(t); let calls = 0;
  const signal = new AbortController().signal;
  signal.addEventListener = () => { throw Error('private signal setup'); };
  const signalOwner = createTaskMaterializationOwnerV1({ materialize: () => { calls++; } });
  await assert.rejects(signalOwner.run(input(c, { signal })), error =>
    error.code === 'WORKSPACE_MATERIALIZATION_SIGNAL_UNAVAILABLE' && !error.message.includes('private'));
  const timerOwner = createTaskMaterializationOwnerV1({ materialize: () => { calls++; }, setTimer: () => { throw Error('private timer'); } });
  await assert.rejects(timerOwner.run(input(c)), { code: 'WORKSPACE_MATERIALIZATION_TIMER_UNAVAILABLE' });
  assert.equal(calls, 0); assert.equal(signalOwner.observations()[0].outcome, 'EVIDENCE_UNAVAILABLE');
});

test('hostile accessors and invalid run identifiers are refused before materialization', async t => {
  const c = await context(t); let touched = 0, calls = 0;
  assert.throws(() => createTaskMaterializationOwnerV1(Object.defineProperty({}, 'now', {
    enumerable: true, get() { touched++; return () => 0; },
  })), { code: 'MATERIALIZATION_OWNER_CONFIG' });
  const owner = createTaskMaterializationOwnerV1({ materialize: () => { calls++; } });
  const poisoned = Object.defineProperty(input(c), 'signal', { enumerable: true, get() { touched++; return new AbortController().signal; } });
  assert.throws(() => owner.run(poisoned), { code: 'MATERIALIZATION_INPUT' });
  const second = createTaskMaterializationOwnerV1({ materialize: () => { calls++; } });
  assert.throws(() => second.run(input(c, { binding: { ...binding(c.preparations[1]), runId: 'bad\0run' } })),
    { code: 'MATERIALIZATION_BINDING' });
  assert.equal(touched, 0); assert.equal(calls, 0);
});

test('raw rejection codes and messages are sanitized in outward and retained evidence', async t => {
  const c = await context(t), owner = createTaskMaterializationOwnerV1({ materialize: () =>
    Promise.reject(Object.assign(Error('private raw failure'), { code: 'not private-safe', root: c.parent })) });
  await assert.rejects(owner.run(input(c)), error => error.code === 'WORKSPACE_MATERIALIZATION_ERROR' &&
    error.message === 'WORKSPACE_MATERIALIZATION_ERROR' && error.root === c.parent);
  const observations = await owner.settled(); assert.equal(observations[0].code, 'WORKSPACE_MATERIALIZATION_ERROR');
  assert.equal(JSON.stringify(observations).includes('private raw failure'), false);
});

test('deadline returns outwardly while late workspace is quarantined and actual settlement remains joined', async t => {
  const c = await context(t), workspace = await c.workspace(), gate = deferred(), timer = manualTimer();
  const owner = createTaskMaterializationOwnerV1({ materialize: () => gate.promise, now: () => 0,
    setTimer: timer.setTimer, clearTimer: timer.clearTimer });
  const outward = owner.run(input(c)); const immutable = assert.rejects(outward, error =>
    error instanceof TaskMaterializationError && error.code === 'WORKSPACE_MATERIALIZATION_DEADLINE' && error.underlyingSettlement === 'PENDING');
  timer.fire(); await immutable; assert.equal(owner.status(), 'QUARANTINED');
  let joined = false; const settlement = owner.settled().then(value => { joined = true; return value; });
  await Promise.resolve(); assert.equal(joined, false); gate.resolve(workspace); const observations = await settlement;
  assert.equal(owner.status(), 'QUARANTINED'); assert.equal(workspace.status(), 'QUARANTINED');
  assert.equal(observations.at(-1).event, 'LATE_SETTLEMENT'); assert.equal(observations.at(-1).workspaceState, 'QUARANTINED');
});

test('external abort is prompt, later mutable raw error is sanitized and no rejection escapes', async t => {
  const c = await context(t), gate = deferred(), controller = new AbortController(), timer = manualTimer();
  const owner = createTaskMaterializationOwnerV1({ materialize: () => gate.promise, now: () => 0,
    setTimer: timer.setTimer, clearTimer: timer.clearTimer });
  const outward = owner.run(input(c, { signal: controller.signal })); controller.abort();
  await assert.rejects(outward, error => Object.isFrozen(error) && error.code === 'WORKSPACE_ABORTED' && error.root === null);
  const raw = Object.assign(new Error('private detail'), { code: 'EIO', root: c.parent }); gate.reject(raw);
  const observations = await owner.settled(); raw.code = 'CHANGED';
  assert.equal(observations.at(-1).code, 'EIO'); assert.equal(observations.at(-1).root, c.parent);
  assert.equal(owner.status(), 'QUARANTINED');
});

test('backward clock and delayed timer fulfillment fail closed without returning workspace', async t => {
  const c = await context(t), workspace = await c.workspace();
  for (const times of [[10, 9], [0, 100]]) {
    let index = 0; const timer = manualTimer();
    const owner = createTaskMaterializationOwnerV1({ materialize: async () => workspace,
      now: () => times[Math.min(index++, times.length - 1)], setTimer: timer.setTimer, clearTimer: timer.clearTimer });
    await assert.rejects(owner.run(input(c)), error => ['WORKSPACE_MATERIALIZATION_CLOCK_INVALID', 'WORKSPACE_MATERIALIZATION_DEADLINE'].includes(error.code));
    await owner.settled(); assert.equal(owner.status(), 'QUARANTINED');
  }
});

test('pre-abort and cancel are one-shot, non-authorizing and invoke no materializer', async t => {
  const c = await context(t), controller = new AbortController(); controller.abort(); let calls = 0;
  const owner = createTaskMaterializationOwnerV1({ materialize: () => { calls++; return Promise.resolve(); } });
  await assert.rejects(owner.run(input(c, { signal: controller.signal })), { code: 'WORKSPACE_ABORTED' });
  assert.equal(calls, 0); assert.equal(owner.observations()[0].underlyingSettlement, 'NOT_STARTED');
  assert.equal(owner.cancel().authorizing, false); assert.equal(owner.status(), 'QUARANTINED');
  const gate = deferred(), active = createTaskMaterializationOwnerV1({ materialize: () => gate.promise });
  const outward = active.run(input(c)); assert.equal(active.cancel().status, 'QUARANTINED');
  await assert.rejects(outward, { code: 'WORKSPACE_ABORTED' }); gate.reject(Object.assign(Error('late'), { code: 'EIO' }));
  await active.settled(); assert.equal(active.observations().at(-1).outcome, 'REJECTED');
});

test('throwing raw error getters cannot orphan outward rejection or the terminal join', async t => {
  const c = await context(t); let touched = 0;
  const raw = Object.defineProperty({ root: c.parent }, 'code', { get() { touched++; throw Error('private'); } });
  const owner = createTaskMaterializationOwnerV1({ materialize: () => Promise.reject(raw) });
  await assert.rejects(owner.run(input(c)), { code: 'WORKSPACE_MATERIALIZATION_ERROR', root: c.parent });
  const rows = await owner.settled(); assert.equal(touched, 0);
  assert.equal(rows.length, 1); assert.equal(owner.status(), 'QUARANTINED');
});

test('late close uncertainty remains distinct from promise settlement and immutable outward error', async t => {
  const c = await context(t), gate = deferred(), timer = manualTimer(); let captured;
  const owner = createTaskMaterializationOwnerV1({ materialize: ({ signal }) => { captured = signal; return gate.promise; },
    now: () => 0, setTimer: timer.setTimer, clearTimer: timer.clearTimer });
  const outward = owner.run(input(c)); timer.fire(); let issued;
  await assert.rejects(outward, error => { issued = error; return error.code === 'WORKSPACE_MATERIALIZATION_DEADLINE'; });
  const before = JSON.stringify(issued); assert.equal(captured.aborted, true);
  gate.reject(Object.assign(Error('private close'), { code: 'WORKSPACE_CLOSE_UNCONFIRMED',
    root: c.parent, priorCode: 'WORKSPACE_ABORTED', systemCode: 'EIO' }));
  const rows = await owner.settled(); assert.equal(rows[1].underlyingSettlement, 'REJECTED');
  assert.equal(rows[1].handleClosure, 'UNCONFIRMED'); assert.equal(rows[1].root, c.parent);
  assert.equal(rows[1].priorCode, 'WORKSPACE_ABORTED'); assert.equal(rows[1].systemCode, 'EIO');
  assert.equal(JSON.stringify(issued), before); assert.equal(owner.status(), 'QUARANTINED');
});

test('delayed timer cannot accept expired fulfillment or a mutated caller budget', async t => {
  const c = await context(t), workspace = await c.workspace(), gate = deferred(), timer = manualTimer(); let time = 0;
  const owner = createTaskMaterializationOwnerV1({ materialize: () => gate.promise, now: () => time,
    setTimer: timer.setTimer, clearTimer: timer.clearTimer });
  const request = input(c); const outward = owner.run(request);
  request.deadlineMs = 60000; time = 100; gate.resolve(workspace);
  await assert.rejects(outward, { code: 'WORKSPACE_MATERIALIZATION_DEADLINE', underlyingSettlement: 'FULFILLED' });
  await owner.settled(); assert.equal(workspace.status(), 'QUARANTINED'); assert.equal(owner.status(), 'QUARANTINED');
});

test('synchronous timer interruption invokes no materializer and a throwing cleanup cannot strand it', async t => {
  const c = await context(t); let calls = 0;
  const owner = createTaskMaterializationOwnerV1({ materialize: () => { calls++; }, now: () => 0,
    setTimer: fn => { fn(); return 1; }, clearTimer: () => { throw Error('private cleanup'); } });
  await assert.rejects(owner.run(input(c)), { code: 'WORKSPACE_MATERIALIZATION_DEADLINE', underlyingSettlement: 'NOT_STARTED' });
  await owner.settled(); assert.equal(calls, 0); assert.equal(owner.status(), 'QUARANTINED');
});

test('throwing signal state at either admission read produces a sanitized terminal refusal', async t => {
  const c = await context(t);
  for (const failureAt of [1, 2]) {
    const signal = new AbortController().signal; let reads = 0, calls = 0;
    Object.defineProperty(signal, 'aborted', { get() { if (++reads === failureAt) throw Error('private state'); return false; } });
    const owner = createTaskMaterializationOwnerV1({ materialize: () => { calls++; } });
    await assert.rejects(owner.run(input(c, { signal })), { code: 'WORKSPACE_MATERIALIZATION_SIGNAL_UNAVAILABLE', underlyingSettlement: 'NOT_STARTED' });
    await owner.settled(); assert.equal(calls, 0); assert.equal(owner.status(), 'QUARANTINED');
  }
});

test('unissued and wrong-preparation workspaces cannot become positive owner evidence', async t => {
  const c = await context(t); let diagnosticCalls = 0;
  const fake = { root: c.parent, manifest: { rootFingerprint: 'a'.repeat(64) },
    status: () => { diagnosticCalls++; return 'MATERIALIZED'; } };
  for (const workspace of [fake, await c.workspace(0)]) {
    const owner = createTaskMaterializationOwnerV1({ materialize: async () => workspace });
    await assert.rejects(owner.run(input(c)), { code: 'WORKSPACE_MATERIALIZATION_EVIDENCE_UNAVAILABLE' });
    const rows = await owner.settled(); assert.equal(rows[0].outcome, 'EVIDENCE_UNAVAILABLE');
    assert.equal(owner.status(), 'QUARANTINED');
  }
  assert.equal(diagnosticCalls, 0);
});

test('abort during trusted timer cleanup cannot restore successful owner state', async t => {
  const c = await context(t), workspace = await c.workspace(), controller = new AbortController(); let cleaned = false;
  const owner = createTaskMaterializationOwnerV1({ materialize: async () => workspace, now: () => 0,
    setTimer: () => 1, clearTimer: () => { if (!cleaned) { cleaned = true; controller.abort(); } } });
  await assert.rejects(owner.run(input(c, { signal: controller.signal })), { code: 'WORKSPACE_ABORTED' });
  const rows = await owner.settled(); assert.equal(owner.status(), 'QUARANTINED');
  assert.equal(workspace.status(), 'QUARANTINED'); assert.equal(rows.some(row => row.event === 'SETTLED' && row.outcome === 'FULFILLED'), false);
});
