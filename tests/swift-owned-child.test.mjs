// PRIVATE deterministic lifecycle doubles. No actual subprocess in this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createOwnedChildObserver } from '../hosts/swift-verifier/owned-child.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(options = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
  child.exitCode = null; child.signalCode = null; child.written = null; child.kills = [];
  child.stdin.end = input => { child.written = input; };
  child.kill = signal => { child.kills.push(signal); return true; };
  let launches = 0, validations = 0;
  const owner = createOwnedChildObserver({ launch: () => { launches++; return child; }, timeoutMs: 1000,
    closeGraceMs: 10, ...options });
  const run = (more = {}) => owner.run({ input: Buffer.from('input'), validate: b => { validations++; return { text: b.toString() }; }, ...more });
  return { child, owner, run, counts: () => ({ launches, validations }) };
}
const complete = f => { f.child.emit('spawn'); f.child.stdout.emit('data', Buffer.from('ok'));
  f.child.exitCode = 0; f.child.emit('exit', 0, null); f.child.emit('close', 0, null); };

test('owned child publishes exactly one immutable observation after close and validation', async () => {
  const f = fixture(), p = f.run(); complete(f); const r = await p;
  assert.equal(r.cause, null); assert.equal(r.process.closed, true); assert.equal(r.process.drain, 'CONFIRMED');
  assert.equal(r.validated.text, 'ok'); assert.equal(f.child.written.toString(), 'input');
  assert.equal(r.outputs.stdout.capturedBytes, 2); assert.equal(r.authorizing, false);
  assert.equal(f.owner.status(), 'IDLE'); assert.deepEqual(f.counts(), { launches: 1, validations: 1 });
  f.child.emit('close', 9, null); assert.equal(r.process.exitCode, 0);
  assert.throws(() => { r.process.closed = false; }, TypeError);
});

test('exit zero alone keeps the owner busy and never validates or releases the slot', async () => {
  const f = fixture(), p = f.run(); f.child.emit('spawn'); f.child.emit('exit', 0, null);
  await tick(); assert.equal(f.owner.status(), 'BUSY'); assert.equal(f.counts().validations, 0);
  await assert.rejects(f.run(), e => e.code === 'CHILD_OWNER_BUSY');
  f.child.emit('close', 0, null); assert.equal((await p).process.closed, true);
});

test('pre-abort and abort during listener registration prevent launch entirely', async () => {
  for (const duringRegistration of [false, true]) {
    const controller = new AbortController(), signal = controller.signal;
    if (duringRegistration) {
      const original = signal.addEventListener.bind(signal);
      signal.addEventListener = (...args) => { original(...args); controller.abort(); };
    } else controller.abort();
    const f = fixture(), r = await f.run({ signal });
    assert.equal(f.counts().launches, 0); assert.equal(r.cause, 'ABORTED');
    assert.equal(r.process.started, false); assert.equal(r.process.closed, false);
    assert.equal(r.process.durationMs, 0); assert.equal(r.process.drain, 'NOT_APPLICABLE');
    assert.equal(r.process.errorCode, null); assert.equal(r.process.cancelRequested, true);
  }
});

test('unknown close after abort quarantines even after a late close or additional output', async () => {
  const controller = new AbortController(), f = fixture(), p = f.run({ signal: controller.signal });
  f.child.emit('spawn'); controller.abort();
  const r = await p;
  assert.equal(r.cause, 'ABORTED'); assert.deepEqual(f.child.kills, ['SIGKILL']);
  assert.equal(r.process.closed, false); assert.equal(r.process.drain, 'UNKNOWN');
  assert.equal(f.owner.status(), 'QUARANTINED');
  f.child.emit('close', null, 'SIGKILL'); f.child.stdout.emit('data', Buffer.from('late'));
  assert.equal(r.outputs.stdout.observedBytes, 0); assert.equal(f.owner.status(), 'QUARANTINED');
  await assert.rejects(f.run(), e => e.code === 'CHILD_OWNER_QUARANTINED');
});

test('spawn arriving after grace finalization is contained without rewriting the old observation', async () => {
  const f = fixture({ timeoutMs: 5 }), p = f.run();
  const r = await p; assert.equal(r.process.started, false); assert.equal(f.owner.status(), 'QUARANTINED');
  assert.equal(r.lifecycle.operation, 1); assert.equal(r.lifecycle.launchCalled, true);
  f.child.emit('spawn'); assert.deepEqual(f.child.kills, ['SIGKILL']);
  assert.equal(r.process.started, false); assert.equal(r.lifecycle.killRequested, false);
  assert.deepEqual(f.owner.lateObservations(), [{ operation: 1, event: 'LATE_SPAWN', killAttempted: true, killReturned: true }]);
  assert.throws(() => { f.owner.lateObservations()[0].killReturned = false; }, TypeError);
  assert.equal(f.owner.status(), 'QUARANTINED');
});

test('deadline after exit does not signal an exited child and cannot infer pipe closure', async () => {
  const f = fixture({ timeoutMs: 5 }), p = f.run(); f.child.emit('spawn');
  f.child.exitCode = 0; f.child.emit('exit', 0, null);
  const r = await p;
  assert.equal(r.cause, 'DEADLINE_EXCEEDED'); assert.equal(r.process.deadlineExceeded, true);
  assert.equal(r.process.exitCode, null); assert.equal(r.process.drain, 'UNKNOWN');
  assert.deepEqual(f.child.kills, []);
});

test('output overflow retains bounded bytes and continues counting until close', async () => {
  const f = fixture({ maximumOutputBytes: 4 }), p = f.run(); f.child.emit('spawn');
  f.child.stdout.emit('data', Buffer.from('12345')); f.child.stdout.emit('data', Buffer.from('678'));
  f.child.emit('exit', null, 'SIGKILL'); f.child.emit('close', null, 'SIGKILL');
  const r = await p;
  assert.equal(r.cause, 'CHILD_OUTPUT_LIMIT'); assert.equal(r.process.errorCode, 'CHILD_OUTPUT_LIMIT');
  assert.equal(r.outputs.stdout.capturedBytes, 4); assert.equal(r.outputs.stdout.observedBytes, 8);
  assert.equal(r.outputs.stdout.truncated, true); assert.equal(f.counts().validations, 0);
});

test('nonzero exit and external signal remain inconclusive without claiming adapter cancellation', async () => {
  for (const [code, signal] of [[2, null], [null, 'SIGTERM']]) {
    const f = fixture(), p = f.run(); f.child.emit('spawn'); f.child.emit('exit', code, signal); f.child.emit('close', code, signal);
    const r = await p;
    assert.equal(r.cause, 'CHILD_TERMINATION_INCONCLUSIVE'); assert.equal(r.process.closed, true);
    assert.equal(r.process.cancelRequested, false); assert.equal(r.process.errorCode, null);
    assert.equal(f.counts().validations, 0);
  }
});

test('spawn failure has explicit error with unstarted receipt fields and observed infrastructure close', async () => {
  const f = fixture(), p = f.run(); f.child.emit('error', new Error('private diagnostic'));
  f.child.emit('close', -2, null); const r = await p;
  assert.equal(r.cause, 'CHILD_PROCESS_ERROR'); assert.equal(r.process.started, false);
  assert.equal(r.process.closed, false); assert.equal(r.process.exitCode, null);
  assert.equal(r.process.drain, 'NOT_APPLICABLE'); assert.equal(r.process.durationMs, 0);
  assert.equal(r.lifecycle.closeObserved, true); assert.equal(f.owner.status(), 'IDLE');
  assert(!JSON.stringify(r).includes('private diagnostic'));
});

test('primary stream error survives later cancellation and clean child closure', async () => {
  const c = new AbortController(), f = fixture(), p = f.run({ signal: c.signal }); f.child.emit('spawn');
  f.child.stdout.emit('error', new Error('private')); c.abort(); f.child.emit('close', 0, null);
  const r = await p;
  assert.equal(r.cause, 'CHILD_STDOUT_ERROR'); assert.equal(r.process.errorCode, 'CHILD_STDOUT_ERROR');
  assert.equal(r.process.cancelRequested, true); assert.equal(r.validated, null);
});

test('abort during synchronous validation vetoes success with no post-exit kill', async () => {
  const c = new AbortController(), f = fixture(), p = f.run({ signal: c.signal,
    validate: () => { c.abort(); return { text: 'no' }; } }); complete(f);
  const r = await p;
  assert.equal(r.cause, 'ABORTED'); assert.equal(r.validated, null); assert.equal(r.process.closed, true);
  assert.deepEqual(f.child.kills, []);
});

test('deadline during final validation and invalid clocks cannot accept late output', async () => {
  let now = 0; const f = fixture({ now: () => now, timeoutMs: 10 });
  const p = f.run({ validate: () => { now = 10; return { pass: true }; } }); complete(f);
  const r = await p; assert.equal(r.cause, 'DEADLINE_EXCEEDED'); assert.equal(r.validated, null);
  let called = false;
  const invalid = fixture({ now: () => { called = true; return NaN; } });
  const denied = await invalid.run(); assert.equal(called, true); assert.equal(denied.process.started, false);
  assert.notEqual(denied.cause, null);
});

test('published duration includes the final monotonic sample rather than a previous sample', async () => {
  let now = 0; const f = fixture({ now: () => now++, timeoutMs: 1000 });
  const p = f.run(); complete(f); const r = await p;
  assert.equal(r.process.durationMs, now - 1);
});

test('throwing validation and unexpected stderr are errors not artifact failures', async () => {
  const f = fixture(), p = f.run({ validate: () => { throw new Error('secret'); } }); complete(f);
  const r = await p; assert.equal(r.process.errorCode, 'CHILD_RESPONSE_INVALID'); assert.equal(r.validated, null);
  const g = fixture(), q = g.run(); g.child.emit('spawn'); g.child.stderr.emit('data', Buffer.from('warning'));
  g.child.emit('close', 0, null); assert.equal((await q).cause, 'CHILD_STDERR_UNEXPECTED');
});
