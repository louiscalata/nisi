// Inert owner channels; no models, processes or filesystem effects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { types } from 'node:util';
import { setImmediate as tick } from 'node:timers/promises';
import { startRepositoryTrialOperationV1 } from '../hosts/repository/paired-trial-operation-v1.mjs';
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const coded = code => Object.assign(Error(code), { code });
function setup({ project, revoke, run, hostStatus } = {}) {
  const calls = [], channels = { run: deferred(), host: deferred(), author: deferred(), reviewer: deferred() };
  const states = { host: 'RUNNING', author: 'IDLE', reviewer: 'IDLE' };
  let signal, closed = false;
  const report = { outcome: 'COMPLETED', candidate: { files: [] } }, collection = { report, state: 'SETTLED' };
  const host = {
    run(options) { calls.push('run'); signal = options.signal; signal.addEventListener('abort', () => calls.push('abort'), { once: true }); return run ? run(options) : channels.run.promise; },
    settled() { calls.push('host.join'); return channels.host.promise; },
    status() { return hostStatus ? hostStatus() : states.host; },
  };
  const owners = ['author', 'reviewer'].map(role => ({ id: 'model.' + role,
    settled() { calls.push(role + '.join'); return channels[role].promise; },
    status() { return closed && states[role] === 'IDLE' ? 'OFF' : states[role]; },
  }));
  const lane = {
    authorizeContext: { authorize() {} }, author: { id: 'author.test', draft() {}, repair() {} },
    reviewers: [{ id: 'reviewer.test', review() {} }], executionOwners() { calls.push('owners'); return owners; },
    revoke() { calls.push('revoke'); closed = true; return revoke?.(); },
  };
  const input = { host, lane, projectResult: (actualReport, actualCollection) => {
    calls.push('project'); assert.equal(actualReport, report); assert.equal(actualCollection, collection);
    assert.equal(closed, false, 'receipt must be bound before normal revoke');
    return project ? project(actualReport, actualCollection) : { candidate: actualReport.candidate, authorizing: false };
  } };
  const complete = () => { states.host = 'SETTLED'; states.author = states.reviewer = 'IDLE';
    channels.run.resolve(report); channels.host.resolve(collection); channels.author.resolve(); channels.reviewer.resolve(); };
  return { input, channels, calls, states, report, collection, complete, owners, signal: () => signal };
}
async function pending(promise) {
  let done = false; promise.then(() => { done = true; }, () => { done = true; }); await tick(); assert.equal(done, false);
}

test('normal operation returns exact native channels and projects before one revoke', async () => {
  const s = setup(), op = startRepositoryTrialOperationV1(s.input);
  assert.deepEqual(Object.keys(op), ['result', 'settled', 'status', 'cancel']);
  assert(types.isPromise(op.result) && types.isPromise(op.settled)); assert(Object.isFrozen(op));
  assert.equal(op.status(), 'BUSY'); await tick(); assert.deepEqual(s.calls, ['owners', 'run']);
  s.complete(); const result = await op.result; await op.settled;
  assert.deepEqual(s.calls, ['owners', 'run', 'host.join', 'author.join', 'reviewer.join', 'project', 'revoke']);
  assert.equal(result.authorizing, false); assert(Object.isFrozen(result.candidate.files)); assert.equal(op.status(), 'IDLE');
  assert.equal(s.signal().aborted, false);
});
test('model joins are never captured while later workflow dispatch is possible', async () => {
  const s = setup(), op = startRepositoryTrialOperationV1(s.input);
  s.channels.author.resolve(); await tick();
  s.states.reviewer = 'BUSY'; await tick();
  assert.equal(s.calls.some(call => call.endsWith('.join')), false);
  s.channels.run.resolve(s.report); await tick();
  assert.equal(s.calls.filter(call => call === 'reviewer.join').length, 1);
  await pending(op.settled); s.complete(); await op.result; await op.settled;
});
test('host rejection cannot hide another pending model settlement', async () => {
  const s = setup(), op = startRepositoryTrialOperationV1(s.input);
  s.channels.run.resolve(s.report); s.channels.host.reject(coded('HOST_JOIN_FAILED')); s.channels.author.resolve();
  await tick(); assert.equal(s.calls.includes('reviewer.join'), true); await pending(op.settled);
  assert.equal(s.calls.includes('project'), false); s.channels.reviewer.resolve();
  await assert.rejects(op.settled, { code: 'HOST_JOIN_FAILED' }); await assert.rejects(op.result);
  assert.equal(op.status(), 'QUARANTINED'); assert.equal(s.calls.filter(x => x === 'revoke').length, 1);
});
test('a rejected model join still observes host and the other model', async () => {
  const s = setup(), op = startRepositoryTrialOperationV1(s.input);
  s.channels.run.resolve(s.report); s.channels.author.reject(coded('MODEL_JOIN_FAILED'));
  await tick(); await pending(op.settled); assert.equal(s.calls.filter(x => x.endsWith('.join')).length, 3);
  s.complete(); await assert.rejects(op.settled, { code: 'MODEL_JOIN_FAILED' }); await assert.rejects(op.result);
  assert.equal(s.calls.includes('project'), false); assert.equal(op.status(), 'QUARANTINED');
});
test('cancel during either model phase joins originals and rejects late success', async () => {
  for (const role of ['author', 'reviewer']) {
    const s = setup(), op = startRepositoryTrialOperationV1(s.input); s.states[role] = 'BUSY';
    op.cancel(); op.cancel(); assert.equal(s.signal().aborted, true);
    assert.equal(op.status(), 'BUSY'); await pending(op.settled);
    assert.equal(s.calls.filter(x => x === 'abort').length, 1); assert.equal(s.calls.filter(x => x === 'revoke').length, 1);
    s.complete(); await op.settled; await assert.rejects(op.result, { code: 'TRIAL_OPERATION_CANCELLED' });
    assert.equal(op.status(), 'OFF'); assert.equal(s.calls.includes('project'), false);
  }
});
test('reentrant cancellation in projector discards its output without duplicate revoke', async () => {
  let op; const s = setup({ project() { op.cancel(); return { shouldNotPublish: true }; } });
  op = startRepositoryTrialOperationV1(s.input); s.complete();
  await assert.rejects(op.result, { code: 'TRIAL_OPERATION_CANCELLED' }); await op.settled;
  assert.equal(op.status(), 'OFF'); assert.equal(s.calls.filter(x => x === 'revoke').length, 1);
});
test('cancellation after projection but before publication also discards result', async () => {
  let op; const s = setup({ project() { queueMicrotask(() => op.cancel()); return { shouldNotPublish: true }; } });
  op = startRepositoryTrialOperationV1(s.input); s.complete();
  await assert.rejects(op.result, { code: 'TRIAL_OPERATION_CANCELLED' }); await op.settled;
  assert.equal(s.calls.filter(x => x === 'revoke').length, 1);
});
test('cancellation after terminal publication cannot relabel completed cleanup', async () => {
  for (const failedProjection of [false, true]) {
    const s = setup({ project: failedProjection ? () => { throw coded('PROJECT_FAILED'); } : undefined });
    const op = startRepositoryTrialOperationV1(s.input); s.complete();
    if (failedProjection) await assert.rejects(op.result, { code: 'PROJECT_FAILED' });
    else await op.result;
    await op.settled; assert.equal(op.status(), 'IDLE');
    const before = [...s.calls]; op.cancel(); op.cancel();
    assert.equal(s.signal().aborted, false); assert.equal(op.status(), 'IDLE'); assert.deepEqual(s.calls, before);
  }
});
test('projection failure is not fabricated unfinished owner cleanup', async () => {
  const s = setup({ project() { throw coded('PROJECT_FAILED'); } }), op = startRepositoryTrialOperationV1(s.input); s.complete();
  await assert.rejects(op.result, { code: 'PROJECT_FAILED' }); await op.settled;
  assert.equal(op.status(), 'IDLE'); assert.equal(s.calls.filter(x => x === 'revoke').length, 1);
});
test('async projection rejects without an unhandled promise and still closes lane', async () => {
  const s = setup({ project: () => Promise.reject(coded('DISCARDED_PROJECTOR')) }), op = startRepositoryTrialOperationV1(s.input); s.complete();
  await assert.rejects(op.result, { code: 'TRIAL_OPERATION_ASYNC_PROJECTOR' }); await op.settled; await tick();
  assert.equal(op.status(), 'IDLE'); assert.equal(s.calls.filter(x => x === 'revoke').length, 1);
});
test('throwing or async revoke remains sticky quarantine while abort is attempted once', async () => {
  for (const revoke of [() => { throw coded('REVOKE_FAILED'); }, () => Promise.reject(coded('ASYNC_REVOKE_FAILED'))]) {
    const s = setup({ revoke }), op = startRepositoryTrialOperationV1(s.input);
    assert.throws(() => op.cancel()); assert.throws(() => op.cancel()); s.complete();
    await assert.rejects(op.result); await assert.rejects(op.settled); await tick();
    assert.equal(op.status(), 'QUARANTINED'); assert.equal(s.calls.filter(x => x === 'abort').length, 1);
    assert.equal(s.calls.filter(x => x === 'revoke').length, 1);
  }
});
test('original workflow throw/rejection rejects result but does not invent failed joins', async () => {
  for (const run of [() => { throw coded('RUN_THROW'); }, () => Promise.reject(coded('RUN_REJECT'))]) {
    const s = setup({ run }), op = startRepositoryTrialOperationV1(s.input); s.complete();
    await assert.rejects(op.result, reason => ['RUN_THROW', 'RUN_REJECT'].includes(reason.code)); await op.settled;
    assert.equal(op.status(), 'OFF'); assert.equal(s.calls.includes('project'), false);
  }
});
test('non-native workflow return cannot bypass original owner collection', async () => {
  let thenCalled = false;
  const s = setup({ run: () => ({ then() { thenCalled = true; } }) }), op = startRepositoryTrialOperationV1(s.input); s.complete();
  await assert.rejects(op.result, { code: 'TRIAL_OPERATION_NATIVE_PROMISE' }); await op.settled;
  assert.equal(thenCalled, false); assert.equal(s.calls.filter(x => x.endsWith('.join')).length, 3);
});
test('falsy rejections and throws stay failures on every channel', async () => {
  for (const reason of [undefined, null, false, 0, '']) {
    const s = setup(), op = startRepositoryTrialOperationV1(s.input); s.channels.author.reject(reason); s.complete();
    await assert.rejects(op.settled, { code: 'TRIAL_OPERATION_CALLBACK_FAILED' }); await assert.rejects(op.result);
    const p = setup({ project() { throw reason; } }), projected = startRepositoryTrialOperationV1(p.input); p.complete();
    await assert.rejects(projected.result, { code: 'TRIAL_OPERATION_CALLBACK_FAILED' }); await projected.settled;
  }
});
test('nonterminal and throwing owner status cannot report success after joins', async () => {
  for (const state of ['SETTLING', 'QUARANTINED', 'BOGUS', 'THROW']) {
    const s = setup({ hostStatus: () => { if (state === 'THROW') throw null; return state; } });
    const op = startRepositoryTrialOperationV1(s.input); s.complete();
    await assert.rejects(op.result); await assert.rejects(op.settled); assert.equal(op.status(), 'QUARANTINED');
  }
});
test('captured methods and containers cannot be swapped during the workflow', async () => {
  const s = setup(), op = startRepositoryTrialOperationV1(s.input);
  s.input.host.settled = () => { throw Error('replacement'); }; s.input.lane.revoke = () => { throw Error('replacement'); };
  s.owners[0].settled = () => { throw Error('replacement'); }; s.owners.splice(1);
  s.complete(); await op.result; await op.settled; assert.equal(op.status(), 'IDLE');
});
test('malformed ownership or getter capabilities refuse before host dispatch', () => {
  for (const change of [s => { s.owners[1].id = 'model.author'; }, s => { s.owners.pop(); },
    s => { Object.defineProperty(s.input.host, 'run', { enumerable: true, get() { throw Error('must not invoke getter'); } }); },
    s => { s.input.extra = true; }]) {
    const s = setup(); change(s); assert.throws(() => startRepositoryTrialOperationV1(s.input)); assert.equal(s.calls.includes('run'), false);
  }
});
