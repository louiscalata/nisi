// Synthetic arm-owner retention barriers only. The fixture uses reviewed local
// source identities; no model, network, native, or oracle start is permitted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pairedArmContext } from './helpers/paired-arm-owner-fixture.mjs';
import { readScheduledPairedTrialIntentV1 } from '../evaluation/paired-trial-runner-v1.mjs';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));

function assertNoDispatch(result, state, owner) {
  assert.equal(result.status, 'STOPPED');
  assert.equal(result.counts.executorStarted, 0);
  assert.equal(result.counts.oracleStarted, 0);
  assert.equal(state.reservations.length, 1);
  assert.equal(state.events.filter(event => event.type === 'START_ATTEMPTED').length, 0);
  const snapshot = owner.inspect();
  assert.equal(snapshot.actualDispatchCount, null);
  assert.equal(snapshot.resumable, false);
  assert.equal(snapshot.authorizing, false);
  assert.equal(snapshot.rows.length, 1);
  assert.equal(snapshot.rows[0].state, 'RESERVED');
}

for (const writer of ['retainAdmission', 'retain']) test(`late ${writer} fulfillment cannot acknowledge or reopen a reservation`, async t => {
  const held = deferred();
  const c = await pairedArmContext(t, { retentionTimeoutMs: 10 });
  let heldOnce = false;
  if (writer === 'retainAdmission') {
    c.state.retainAdmission = async row => {
      if (!heldOnce) { heldOnce = true; await held.promise; }
    };
  } else {
    c.state.retain = async event => {
      c.state.events.push(event);
      if (event.type === 'START_INTENT' && !heldOnce) { heldOnce = true; await held.promise; }
    };
  }
  t.after(async () => { held.resolve(); await tick(); await tick(); });
  const result = await c.runner.run();
  assert.equal(heldOnce, true);
  assertNoDispatch(result, c.state, c.owner);

  held.resolve();
  await held.promise; await tick(); await tick();
  assertNoDispatch(result, c.state, c.owner);
  assert.equal(c.owner.inspect().failure, 'RUNNER_ARM_RETENTION_LATE');
  assert.equal(c.state.events.filter(event => event.type === 'START_ATTEMPTED').length, 0);
  assert(c.state.admissions.every(row => row.disposition === 'PRE_DISPATCH_INTENT_ONLY'));
});

test('partial sidecar success followed by event-writer failure never mints a permit', async t => {
  const c = await pairedArmContext(t, { retentionTimeoutMs: 100 });
  c.state.retain = async event => {
    c.state.events.push(event);
    if (event.type === 'START_INTENT') throw Object.assign(Error('synthetic event writer failure'), { code: 'WRITER_EVENT_FAILED' });
  };
  const result = await c.runner.run();
  assertNoDispatch(result, c.state, c.owner);
  assert.equal(c.owner.inspect().failure, 'RUNNER_ARM_CALLBACK');
  assert(c.state.admissions.length >= 1);
  assert(c.state.admissions.every(row => row.disposition === 'PRE_DISPATCH_INTENT_ONLY'));
  assert.equal(c.owner.inspect().rows[0].state, 'RESERVED');
});

test('reentrant verifyInputs during awaited retention is sticky even when callback catches it', async t => {
  const c = await pairedArmContext(t, { retentionTimeoutMs: 100 });
  let caught = null;
  c.state.retain = async event => {
    c.state.events.push(event);
    if (event.type === 'START_INTENT') {
      try { c.owner.host.verifyInputs(c.state.reservations[0]); }
      catch (error) { caught = error; }
    }
  };
  const result = await c.runner.run();
  assert.equal(caught?.code, 'RUNNER_ARM_REENTRANT');
  assertNoDispatch(result, c.state, c.owner);
  assert.equal(c.owner.inspect().failure, 'RUNNER_ARM_REENTRANT');
  assert.equal(c.state.events.filter(event => event.type === 'START_ATTEMPTED').length, 0);
});

test('copied or altered retained events cannot replace original event identities', async t => {
  const c = await pairedArmContext(t, { retentionTimeoutMs: 100 });
  c.state.retain = async event => {
    c.state.events.push(event);
    if (event.type === 'START_INTENT') throw Object.assign(Error('stop before dispatch'), { code: 'WRITER_EVENT_FAILED' });
  };
  const result = await c.runner.run();
  assertNoDispatch(result, c.state, c.owner);
  const originalSchedule = c.state.events.find(event => event.type === 'SCHEDULE');
  assert(originalSchedule);
  await assert.rejects(c.owner.host.retain(structuredClone(originalSchedule)), { code: 'RUNNER_EVENT_NOT_ISSUED' });
  await assert.rejects(c.owner.host.retain({ ...originalSchedule, sequence: originalSchedule.sequence + 1 }), { code: 'RUNNER_EVENT_NOT_ISSUED' });
  assert.throws(() => readScheduledPairedTrialIntentV1({ ...c.state.reservations[0] }), { code: 'RUNNER_INTENT_NOT_ISSUED' });
  assert.equal(c.state.events.filter(event => event.type === 'START_ATTEMPTED').length, 0);
});

function assertPostPhaseWriteStopped(result, c) {
  assert.equal(result.status, 'STOPPED');
  assert.equal(result.counts.executorStarted, 1);
  assert.equal(result.counts.oracleStarted, 0);
  assert.equal(c.state.events.filter(event => event.type === 'PHASE_RESULT').length, 0);
  const snapshot = c.owner.inspect();
  assert.equal(snapshot.rows.length, 1);
  assert.equal(snapshot.rows[0].historyRetained, 0);
  assert.equal(snapshot.actualDispatchCount, null);
  assert.equal(snapshot.authorizing, false);
  assert.equal(snapshot.measurementVerified, false);
  assert.equal(snapshot.publicationAuthorized, false);
}

test('post-phase admission-history writer failure leaves executor evidence unacknowledged', async t => {
  const c = await pairedArmContext(t, { retentionTimeoutMs: 100 });
  c.state.retainAdmission = async row => {
    if (row.schemaVersion === 'nisi-scheduled-arm-admission-history-v1' &&
        row.disposition === 'POST_PHASE_LOCAL_OBSERVATIONS')
      throw Object.assign(Error('synthetic post-phase admission failure'), { code: 'WRITER_ADMISSION_FAILED' });
  };
  const result = await c.runner.run();
  assertPostPhaseWriteStopped(result, c);
  assert.equal(c.owner.inspect().failure, 'RUNNER_ARM_CALLBACK');
  assert(c.state.admissions.every(row => row.disposition === 'PRE_DISPATCH_INTENT_ONLY'));
  assert.equal(c.state.events.filter(event => event.type === 'PHASE_RESULT').length, 0);
});

test('late post-phase admission-history fulfillment cannot acknowledge history or reopen oracle dispatch', async t => {
  const held = deferred();
  const c = await pairedArmContext(t, { retentionTimeoutMs: 20 });
  let heldOnce = false;
  c.state.retainAdmission = async row => {
    if (row.schemaVersion === 'nisi-scheduled-arm-admission-history-v1' &&
        row.disposition === 'POST_PHASE_LOCAL_OBSERVATIONS' && !heldOnce) {
      heldOnce = true;
      await held.promise;
    }
  };
  t.after(async () => { held.resolve(); await tick(); await tick(); });
  const result = await c.runner.run();
  assert.equal(heldOnce, true);
  assertPostPhaseWriteStopped(result, c);
  assert.equal(c.owner.inspect().failure, null);

  held.resolve();
  await held.promise; await tick(); await tick();
  assertPostPhaseWriteStopped(result, c);
  assert.equal(c.owner.inspect().failure, 'RUNNER_ARM_RETENTION_LATE');
  assert.equal(c.owner.inspect().rows[0].historyRetained, 0);
  assert.equal(c.state.events.filter(event => event.type === 'PHASE_RESULT').length, 0);
  assert.equal(result.counts.oracleStarted, 0);
});
