import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pairedArmContext } from './helpers/paired-arm-owner-fixture.mjs';
import { deferred } from './helpers/live-model-v3-fixture.mjs';
import { createRepositoryPairedArmOwnerV1 } from '../hosts/repository/paired-trial-arm-owner-v1.mjs';

for (const boundary of [1, 2, 3]) for (const [name, mutate, code] of [
  ['consent', o => o.consent.revoked = true, 'RUNNER_ARM_ADMISSION_REFUSED'],
  ['capacity', o => o.capacity.measuredFreeSlots = 0, 'RUNNER_ARM_ADMISSION_REFUSED'],
  ['custody', o => o.custody.baselineSha256 = '0'.repeat(64), 'RUNNER_ARM_SOURCE_BINDING'],
]) test(`oracle ${name} changes at admission boundary ${boundary} refuse before oracle effects`, async t => {
  const c = await pairedArmContext(t); let calls = 0;
  c.state.observe = (arg, observation) => {
    if (arg.phase === 'ORACLE' && ++calls === boundary) mutate(observation);
    return observation;
  };
  const ledger = await c.runner.run(); assert.equal(ledger.stopReason, code);
  assert.equal(c.state.oracle.inspect().state, 'NEW'); assert.equal(c.requests.length, 2);
  assert.equal(c.lane.snapshot().revoked, true); assert.deepEqual(await fs.readdir(c.parentRoot), []);
  assert.equal(c.state.events.filter(e => e.type === 'PHASE_RESULT').length, 1);
  assert.equal(c.owner.inspect().failure, code);
});

test('cancelled pending original transport can only finish diagnostically, never reach oracle or reuse owners', async t => {
  const started = deferred(), release = deferred();
  const c = await pairedArmContext(t, { onRequest: async (_request, envelope) => {
    started.resolve(); await release.promise; return new Response(JSON.stringify(envelope));
  } });
  const running = c.runner.run(); let ledger;
  try {
    await started.promise;
    assert.equal(c.runner.requestStop().status, 'REQUESTED');
    ledger = await running;
    assert.equal(ledger.stopReason, 'RUNNER_USER_STOP_REQUESTED');
    assert.equal(ledger.drain.status, 'UNCONFIRMED');
    assert.equal(c.state.oracle.inspect().state, 'NEW');
    assert.equal(c.state.events.some(e => e.type === 'PHASE_RESULT'), false);
    assert.equal(c.owner.inspect().rows[0].projection, null);
  } finally {
    release.resolve(); await running;
    await c.host.settled();
    await Promise.allSettled(c.lane.executionOwners().map(o => o.settled()));
  }
  const late = await c.runner.recheckDrain();
  assert.equal(late.counts.completed, 0); assert.equal(late.counts.oracleStarted, 0);
  assert.equal(c.requests.length, 1); assert.equal(c.lane.snapshot().revoked, true);
  assert.equal(c.state.events.some(e => e.type === 'PHASE_RESULT'), false);
  assert.equal(c.owner.inspect().rows[0].projection, null);
  c.state.reserve = () => ({host: c.host, lane: c.lane, oracle: c.state.oracle});
  const other = createRepositoryPairedArmOwnerV1(c.input);
  const refused = await c.makeRunner(other.host).run();
  assert.equal(refused.stopReason, 'RUNNER_ARM_OWNER_REUSED');
  assert.equal(c.requests.length, 1); assert.equal(c.state.oracle.inspect().state, 'NEW');
});

test('copied and changed oracle candidate cannot consume the reserved oracle', async t => {
  const c = await pairedArmContext(t);
  const host = { ...c.owner.host, startOracle(request) {
    return c.owner.host.startOracle({ ...request, candidateText: request.candidateText + ' ' });
  } };
  const ledger = await c.makeRunner(host).run();
  assert.equal(ledger.stopReason, 'RUNNER_ARM_ORACLE_CANDIDATE');
  assert.equal(c.state.oracle.inspect().state, 'NEW'); assert.equal(c.requests.length, 2);
  assert.deepEqual(await fs.readdir(c.parentRoot), []);
});

test('a consumed executor permit cannot be reused, even before its original result settles', async t => {
  const c = await pairedArmContext(t); let duplicate = false;
  const host = { ...c.owner.host, startExecutor(intent) {
    const operation = c.owner.host.startExecutor(intent);
    assert.throws(() => c.owner.host.startExecutor(intent), { code: 'RUNNER_ARM_PERMIT' });
    duplicate = true; return operation;
  } };
  const ledger = await c.makeRunner(host).run(); assert.equal(duplicate, true);
  assert.equal(c.owner.inspect().failure, 'RUNNER_ARM_PERMIT');
  assert.equal(ledger.counts.oracleStarted, 0); assert.equal(c.state.oracle.inspect().state, 'NEW');
  assert.equal(c.requests.length, 2); assert.equal(c.lane.snapshot().revoked, true);
});
