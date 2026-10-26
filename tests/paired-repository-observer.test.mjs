import test from 'node:test';
import assert from 'node:assert/strict';
import { observedTrial } from './helpers/observed-repository-trial-fixture.mjs';
import { deferred, reply, tick } from './helpers/live-model-v3-fixture.mjs';
test('original successful channels are observed once without replacing the operation interface', async t => {
  const c = await observedTrial(t); const result = await c.runner.run(), observed = c.observed(), d = observed.captureDiagnostics();
  assert.equal(d.kind, 'TERMINAL_CHANNELS'); assert.equal(d.host.collectionState, 'SETTLED');
  assert.equal(d.host.reportChannelMatches, true); assert.equal(d.host.outcome, 'COMPLETED');
  assert.equal(d.projection.completionClaim, true); assert.equal(d.projection.state, 'PUBLISHED');
  assert.equal(d.projection.modelCalls, null); assert.equal(d.projection.inputTokens, null);
  assert.equal(d.lane.revoked, true); assert.equal(d.lane.authorReceipts, 1); assert.equal(d.lane.reviewerReceipts, 1);
  assert.equal(c.calls.run, 1); assert.equal(c.calls.settled, 1); assert.equal(c.calls.oracle, 1);
  assert.equal(result.counts.incorrectClaims, 1); assert.equal(result.authorizing, false);
  assert.deepEqual(Object.keys(observed.operation).sort(), ['cancel', 'result', 'settled', 'status']);
  observed.operation.cancel(); assert.equal(observed.captureDiagnostics(), d);
  const serialized = JSON.stringify(d);
  for (const absent of ['synthetic.author', 'http://', 'retry-settings.mjs', 'PRIVATE_', 'candidateText', 'returnedResults']) assert(!serialized.includes(absent));
});
for (const scenario of ['expired', 'wrong-instance']) test(`adverse ${scenario} preserves original redacted diagnostics without oracle`, async t => {
  const c = await observedTrial(t, scenario === 'expired' ? { configure(i) { i.approval.expiresAtMs = 1; } }
    : { onRequest(call) { call.envelope.model_instance_id = 'wrong.instance'; return reply(call.envelope); } });
  const result = await c.runner.run(), d = c.observed().captureDiagnostics();
  assert.equal(result.records[0].status, 'ERROR'); assert.equal(c.calls.oracle, 0); assert.equal(c.calls.run, 1); assert.equal(c.calls.settled, 1);
  assert.equal(d.kind, 'TERMINAL_CHANNELS'); assert.equal(d.projection.state, 'UNAVAILABLE'); assert.equal(d.projection.completionClaim, null);
  assert.equal(d.channels.operationResult.state, 'REJECTED'); assert.equal(d.host.availability, 'AVAILABLE');
  assert.equal(d.host.reportChannelMatches, true); assert.equal(d.projection.modelCalls, null);
  if (scenario === 'expired') { assert.equal(d.host.candidateFingerprint, null); assert.equal(d.host.collectionState, 'QUARANTINED'); }
  else { assert.equal(d.lane.unavailableReceipts, 1); assert.equal(d.host.collectionState, 'SETTLED'); assert.equal(d.channels.operationSettlement.state, 'FULFILLED'); }
});
test('pending capture remains immutable after cancellation and later original settlement', async t => {
  const started = deferred(), response = deferred();
  const c = await observedTrial(t, { onRequest(call) { started.resolve(call); return response.promise; } });
  const running = c.runner.run(), call = await started.promise, observed = c.observed();
  let partial, before;
  try {
    partial = observed.captureDiagnostics();
    assert.equal(partial.kind, 'PARTIAL_CHANNELS'); assert.equal(partial.channels.hostRun.state, 'PENDING');
    assert.equal(partial.lane.pendingTransports, 1); before = JSON.stringify(partial);
    c.runner.requestStop(); await tick();
  } finally {
    response.resolve(reply(call.envelope));
    await running; await Promise.allSettled([observed.operation.result, observed.operation.settled]);
  }
  const terminal = observed.captureDiagnostics(); assert.equal(terminal.kind, 'TERMINAL_CHANNELS');
  assert.notEqual(terminal, partial); assert.equal(JSON.stringify(partial), before); assert.equal(terminal.projection.state, 'UNAVAILABLE');
  assert.equal(c.calls.run, 1); assert.equal(c.calls.settled, 1); assert.equal(c.calls.oracle, 0);
});
test('synchronous and primitive host failures never escape observers or copy messages', async t => {
  for (const throwing of [true, false]) {
    const c = await observedTrial(t, { hostFactory() { return {
      run() { if (throwing) throw 'PRIVATE_SECRET'; return Promise.reject('PRIVATE_SECRET'); },
      settled: () => Promise.reject('PRIVATE_OTHER_SECRET'), status: () => 'QUARANTINED',
    }; } });
    await c.runner.run(); const d = c.observed().captureDiagnostics();
    assert.equal(d.kind, 'TERMINAL_CHANNELS'); assert.equal(d.host.availability, 'UNAVAILABLE');
    assert.equal(d.channels.hostRun.state, throwing ? 'THREW' : 'REJECTED');
    assert.equal(d.channels.hostCollection.state, 'REJECTED'); assert(!JSON.stringify(d).includes('PRIVATE'));
  }
});
