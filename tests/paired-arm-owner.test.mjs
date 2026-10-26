import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pairedArmContext } from './helpers/paired-arm-owner-fixture.mjs';

for (const api of ['NATIVE_API', 'CHAT_COMPLETIONS']) for (const arm of ['OFF', 'ON'])
for (const variant of ['repair', 'no-change']) test(`arm owner ${api}/${arm}/${variant}: actual fixed Node oracle, synthetic model`, async t => {
  const c = await pairedArmContext(t, { api, arm, variant });
  const ledger = await c.runner.run();
  assert.equal(ledger.stopReason, 'RUNNER_REPORTED_BUDGET_UNCONFIRMED', JSON.stringify(c.owner.inspect()));
  assert.equal(ledger.counts.completed, 1); assert.equal(ledger.counts.executorStarted, 1);
  assert.equal(ledger.counts.oracleStarted, 1); assert.equal(ledger.counts.notStarted, 3);
  assert.equal(ledger.records[0].oracle.outcome, variant === 'repair' ? 'PASS' : 'FAIL');
  assert.equal(ledger.records[0].executor.completionClaim, variant === 'repair');
  assert.equal(ledger.records[0].executor.modelCalls, null); assert.equal(ledger.records[0].executor.tokenUsage, null);
  assert.equal(c.requests.length, variant === 'repair' ? 2 : 1);
  assert.equal(c.state.oracle.inspect().observation.assertionsExecuted, 17);
  assert.equal(c.state.oracle.inspect().observation.assertionsPassed, variant === 'repair' ? 17 : 15);
  const preIntents = c.state.admissions.filter(r => r.disposition === 'PRE_DISPATCH_INTENT_ONLY');
  assert.equal(preIntents.length, 2); assert.equal(c.state.reservations.length, 1);
  assert.deepEqual(c.state.events.map(e => e.type), ['SCHEDULE', 'START_INTENT', 'PHASE_RESULT', 'START_INTENT', 'PHASE_RESULT', 'FINAL']);
  const view = c.owner.inspect(); assert.equal(view.closed, true); assert.equal(view.failure, null);
  assert.equal(view.rows[0].state, 'COMPLETE'); assert.equal(view.rows[0].projection.usage.sourceKind, 'SYNTHETIC_FIXTURE');
  for (const record of preIntents) {
    assert.equal(record.disposition, 'PRE_DISPATCH_INTENT_ONLY'); assert.equal(record.authorizing, false);
    assert.equal(record.executionAttested, false); assert.equal(record.measurementVerified, false);
    assert.equal(record.publicationAuthorized, false); assert.equal(record.resumable, false);
    assert.equal(record.actualDispatchCount, null); assert.equal(record.ownerSetId, view.rows[0].ownerSetId);
  }
  assert.equal(c.lane.snapshot().revoked, true); assert.equal(c.lane.snapshot().lifecycle.state, 'STOPPED');
});

test('persisted final admission history distinguishes post-retention rechecks from pre-intent observations', async t => {
  const c = await pairedArmContext(t);
  c.state.observe = (_arg, o) => { c.state.now++; return o; };
  const ledger = await c.runner.run(); assert.equal(ledger.counts.completed, 1);
  const history = c.state.admissions.filter(r => r.schemaVersion === 'nisi-scheduled-arm-admission-history-v1');
  assert.equal(history.length, 2);
  for (const [i, phase] of ['EXECUTOR', 'ORACLE'].entries()) {
    const before = c.state.admissions.find(r => r.disposition === 'PRE_DISPATCH_INTENT_ONLY' && r.phase === phase);
    const record = history[i]; assert.equal(record.disposition, 'POST_PHASE_LOCAL_OBSERVATIONS');
    const entries = record.history.filter(r => r.phase === phase);
    assert.deepEqual(entries.map(r => r.point), ['PERMIT_MINTED', 'CONSUMPTION_RECHECK_PASSED']);
    assert(entries[0].observedAtMs > before.observedAtMs);
    assert(entries[1].observedAtMs > entries[0].observedAtMs);
    assert.equal(record.authorizing, false); assert.equal(record.executionAttested, false);
    assert.equal(record.resumable, false); assert.equal(record.actualDispatchCount, null);
    assert.equal(record.sourceTrust, 'TRUSTED_HOST_OBSERVATIONS_NOT_ATTESTED');
  }
});

for (const phase of ['EXECUTOR', 'ORACLE']) test(`fresh consent revocation after ${phase} retention prevents that dispatch`, async t => {
  const c = await pairedArmContext(t);
  let revoked = false;
  c.state.retain = async e => { if (e.type === 'START_INTENT' && e.phase === phase) revoked = true; };
  c.state.observe = (_arg, observation) => { observation.consent.revoked = revoked; return observation; };
  const ledger = await c.runner.run();
  assert.equal(ledger.stopReason, 'RUNNER_ARM_ADMISSION_REFUSED'); assert.equal(ledger.counts.oracleStarted, 0);
  assert.equal(c.requests.length, phase === 'EXECUTOR' ? 0 : 2);
  assert.equal(c.state.oracle.inspect().state, 'NEW'); assert.equal(c.owner.inspect().failure, 'RUNNER_ARM_ADMISSION_REFUSED');
  assert.deepEqual(await fs.readdir(c.parentRoot), []);
});

for (const [name, mutate, code] of [
  ['future scheduler', o => o.scheduler.observedAtMs++, 'RUNNER_ARM_STALE_OBSERVATION'],
  ['future capacity', o => o.capacity.measuredAtMs++, 'RUNNER_ARM_STALE_OBSERVATION'],
  ['future runtime', o => o.host.observedAtMs++, 'RUNNER_ARM_STALE_OBSERVATION'],
  ['future custody', o => o.custody.observedAtMs++, 'RUNNER_ARM_STALE_OBSERVATION'],
  ['unmeasured capacity', o => o.capacity.measuredFreeSlots = null, 'RUNNER_ARM_ADMISSION_REFUSED'],
  ['pending transport', o => o.host.pendingTransports = 1, 'RUNNER_ARM_ADMISSION_REFUSED'],
  ['wrong consent identity', o => o.consent.id = 'other.approval', 'RUNNER_ARM_CONSENT_BINDING'],
  ['wrong source', o => o.custody.taskSha256 = '0'.repeat(64), 'RUNNER_ARM_SOURCE_BINDING'],
]) test(`pre-reservation refusal: ${name}`, async t => {
  const c = await pairedArmContext(t); c.state.observe = (_arg, o) => { mutate(o); return o; };
  const ledger = await c.runner.run(); assert.equal(ledger.stopReason, code);
  assert.equal(c.state.reservations.length, 0); assert.equal(c.requests.length, 0);
  assert.equal(c.owner.inspect().closed, true); assert.equal(c.state.events.at(-1).type, 'FINAL');
});
