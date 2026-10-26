// Actual engine/issued owners, synthetic HTTP/process observations only.
// No model inference or native fixture execution; not an OFF/ON experiment.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startRepositoryTrialOperationV1 } from '../hosts/repository/paired-trial-operation-v1.mjs';
import { createPairedTrialRunnerV1 } from '../evaluation/paired-trial-runner-v1.mjs';
import { repositoryLiveContext } from './helpers/repository-live-run-fixture.mjs';
import { context, selection, deferred, tick, reply } from './helpers/live-model-v3-fixture.mjs';
import { pairedTrialFixtureInputs } from './helpers/paired-trial-fixture.mjs';
import { createRepositoryLiveModelRunV3 } from '../receipts/repository-live-model-run-v3.mjs';

for (const api of ['NATIVE_API', 'CHAT_COMPLETIONS'])
test(`real issued repository/lane ${api} binds receipt before operation closes approval`, async t => {
  const c = await repositoryLiveContext(t, { contextFactory: context, configure(i) {
    i.author = selection('author', api); i.reviewer = selection('reviewer', api);
  } });
  let projected = 0;
  const operation = startRepositoryTrialOperationV1({ host: c.host, lane: c.lane,
    projectResult(report, hostResult) {
      projected++; assert.equal(report, hostResult.report); assert.equal(c.lane.snapshot().revoked, false);
      return createRepositoryLiveModelRunV3({ lane: c.lane, hostResult });
    } });
  const receipt = await operation.result; await operation.settled;
  assert.equal(projected, 1); assert.equal(receipt.status, 'SYNTHETIC_CONTRACT_PASS');
  assert.equal(receipt.authorizing, false); assert.equal(receipt.executionAttested, false);
  assert.equal(receipt.lane.revoked, false); assert.equal(c.lane.snapshot().revoked, true);
  assert.equal(receipt.usage.totals.totalTokens, 85); assert.equal(operation.status(), 'IDLE');
  assert.deepEqual(c.requests.map(row => row.operation), ['repair', 'review']);
});

for (const role of ['author', 'reviewer'])
test(`real ${role} transport remains joined after operation cancellation until original HTTP settles`, async t => {
  const started = deferred(), transport = deferred();
  const c = await repositoryLiveContext(t, { contextFactory: context, onRequest(call) {
    if (call.role === role) { started.resolve(call); return transport.promise; }
    return reply(call.envelope);
  } });
  let projected = false;
  const operation = startRepositoryTrialOperationV1({ host: c.host, lane: c.lane,
    projectResult() { projected = true; throw Error('cancelled output must not be projected'); } });
  const call = await started.promise;
  try {
    operation.cancel(); operation.cancel(); await tick(); await tick();
    let settled = false; operation.settled.then(() => { settled = true; }, () => { settled = true; });
    await tick(); assert.equal(settled, false);
    assert.equal(c.lane.snapshot().lifecycle.pendingTransports, 1);
    assert.equal(c.lane.snapshot().remoteInferenceStopped, 'NOT_OBSERVED');
  } finally { transport.resolve(reply(call.envelope)); }
  await assert.rejects(operation.result); await assert.rejects(operation.settled);
  assert.equal(operation.status(), 'QUARANTINED'); assert.equal(projected, false);
  assert.equal(c.lane.snapshot().lifecycle.pendingTransports, 0);
  assert.equal(c.lane.snapshot().lifecycle.recoveryRequired, true);
});

test('real runner stop owns cancellation and cannot promote a later model response', async t => {
  const started = deferred(), transport = deferred(), events = [];
  const c = await repositoryLiveContext(t, { contextFactory: context, onRequest(call) {
    started.resolve(call); return transport.promise;
  } });
  const { plan, profile } = pairedTrialFixtureInputs();
  let operation, dispatches = 0, oracleCalls = 0;
  const runner = createPairedTrialRunnerV1({ plan, profile, host: {
    verifyInputs: () => true, retain: async event => { events.push(event); },
    startExecutor() { dispatches++; operation = startRepositoryTrialOperationV1({ host: c.host, lane: c.lane,
      projectResult() { throw Error('No accepted result in this stop-only integration'); } }); return operation; },
    startOracle() { oracleCalls++; throw Error('No oracle dispatch after stop'); },
  } });
  const running = runner.run(), call = await started.promise;
  let result;
  try {
    assert.equal(runner.requestStop().status, 'REQUESTED'); result = await running;
    assert.equal(result.stopReason, 'RUNNER_USER_STOP_REQUESTED');
    assert.equal(result.drain.status, 'UNCONFIRMED'); assert.equal(dispatches, 1); assert.equal(oracleCalls, 0);
    assert.equal(result.counts.completed, 0); assert.equal(result.authorizing, false);
    assert.equal(events.filter(event => event.type === 'FINAL').length, 1);
  } finally { transport.resolve(reply(call.envelope)); }
  await assert.rejects(operation.result); await assert.rejects(operation.settled);
  const after = await runner.recheckDrain();
  assert.equal(after.counts.completed, 0); assert.equal(after.stopReason, result.stopReason);
  assert.equal(after.drain.status, 'UNCONFIRMED'); assert.equal(dispatches, 1);
});
