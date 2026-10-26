// Repository regression test: paired arm fixture remains local to Nisi tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {pairedArmContext} from './helpers/paired-arm-owner-fixture.mjs';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
};
const tick = () => new Promise(resolve => setImmediate(resolve));

function assertReservedWithoutDispatch(result, context) {
  assert.equal(result.status, 'STOPPED');
  assert.equal(result.retentionStatus, 'UNCONFIRMED');
  assert.equal(result.counts.executorStarted, 0);
  assert.equal(result.counts.oracleStarted, 0);
  assert.equal(result.authorizing, false);
  assert.equal(context.state.reservations.length, 1);
  assert.equal(context.state.events.filter(event => event.type === 'START_ATTEMPTED').length, 0);
  const owner = context.owner.inspect();
  assert.equal(owner.rows.length, 1);
  assert.equal(owner.rows[0].state, 'RESERVED');
  assert.equal(owner.actualDispatchCount, null);
  assert.equal(owner.authorizing, false);
  assert.equal(owner.resumable, false);
}

test('early timer callback cannot beat the owner retention deadline', {concurrency: false}, async t => {
  const context = await pairedArmContext(t, {retentionTimeoutMs: 200});
  const held = deferred();
  let heldStartIntent = false;
  context.state.retain = async event => {
    if (event.type === 'START_INTENT' && !heldStartIntent) {
      heldStartIntent = true;
      await held.promise;
    }
  };
  const nativeSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, delay, ...args) =>
    nativeSetTimeout(callback, Math.min(delay, 1), ...args);
  try {
    const startedAt = performance.now();
    const result = await context.runner.run();
    const elapsedMs = performance.now() - startedAt;
    assert.equal(heldStartIntent, true);
    assertReservedWithoutDispatch(result, context);

    // If the runner believed the 1 ms callback was a true timeout, releasing
    // now lets the owner acknowledge before its independent 200 ms deadline.
    held.resolve();
    await held.promise; await tick(); await tick();
    assertReservedWithoutDispatch(result, context);
    assert.equal(context.owner.inspect().failure, 'RUNNER_ARM_RETENTION_LATE');
    assert(elapsedMs >= 190, `runner stopped before monotonic retention deadline: ${elapsedMs} ms`);
    assert(context.state.admissions.every(row => row.disposition === 'PRE_DISPATCH_INTENT_ONLY'));
  } finally {
    globalThis.setTimeout = nativeSetTimeout;
    held.resolve();
  }
});

test('fulfilled retention proceeds without waiting for its timeout', {concurrency: false}, async t => {
  const context = await pairedArmContext(t, {retentionTimeoutMs: 1000});
  context.state.retain = async event => {
    if (event.type === 'SCHEDULE') {
      assert.deepEqual(context.runner.requestStop(), {status: 'REQUESTED', authorizing: false});
    }
  };
  const nativeSetTimeout = globalThis.setTimeout;
  const nativeClearTimeout = globalThis.clearTimeout;
  const longTimers = new Set();
  let longTimerCallbacks = 0;
  globalThis.setTimeout = (callback, delay, ...args) => {
    let timer;
    timer = nativeSetTimeout((...callbackArgs) => {
      if (longTimers.delete(timer)) longTimerCallbacks++;
      callback(...callbackArgs);
    }, delay, ...args);
    if (delay >= 900) longTimers.add(timer);
    return timer;
  };
  globalThis.clearTimeout = timer => {
    longTimers.delete(timer);
    return nativeClearTimeout(timer);
  };
  try {
    const startedAt = performance.now();
    const result = await context.runner.run();
    const elapsedMs = performance.now() - startedAt;
    assert.equal(result.status, 'STOPPED');
    assert.equal(result.stopRequested, true);
    assert.equal(result.retentionStatus, 'CONFIRMED');
    assert.equal(result.counts.executorStarted, 0);
    assert.equal(result.counts.oracleStarted, 0);
    assert.equal(result.authorizing, false);
    assert.equal(context.state.reservations.length, 0);
    assert(context.state.events.some(event => event.type === 'SCHEDULE'));
    assert(context.state.events.some(event => event.type === 'FINAL'));
    assert.equal(longTimerCallbacks, 0, 'the retention timeout callback fired');
    assert.equal(longTimers.size, 0, 'a retention timeout remained scheduled');
    assert(elapsedMs < 900, `fulfilled retention waited for its 1000 ms timeout: ${elapsedMs} ms`);
  } finally {
    globalThis.setTimeout = nativeSetTimeout;
    globalThis.clearTimeout = nativeClearTimeout;
  }
});
