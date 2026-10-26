// PRIVATE injected-transport contract tests. Synthetic checks, no model/process work.
import test from 'node:test';
import assert from 'node:assert/strict';
import { context, deferred, reply, seed, payload, configuration, tick } from './helpers/reviewed-live-model-fixture.mjs';
import { createReviewedLiveModelLaneWithTransportV1, readIssuedLiveModelLaneV1 } from '../hosts/repository/reviewed-live-model-v1.mjs';
import { summarizeLiveUsage } from '../receipts/live-usage-v1.mjs';

const last = lane => lane.snapshot().events.at(-1);
const boundReceipt = (receipt, report, operation, fingerprint) => {
  assert.equal(receipt.operation, operation); assert.equal(receipt.runId, report.runId);
  assert.equal(receipt.taskFingerprint, report.taskFingerprint); assert.equal(receipt.attempt, 1);
  assert.equal(receipt.resultCandidateFingerprint, fingerprint); assert.equal(receipt.status, 'RESPONSE_VALIDATED');
};

test('injected live repair and review bind to the real engine while the host seed remains non-inference', async () => {
  const c = await context(), report = await c.run(), snapshot = c.lane.snapshot();
  assert.equal(report.outcome, 'COMPLETED'); assert.equal(report.repairAttempts, 1);
  assert.deepEqual(c.checks.map(p => p.attempt), [0, 1]); assert.deepEqual(c.tests.map(p => p.attempt), [0, 1]);
  assert.deepEqual(report.stages.filter(s => s.stage === 'tests').map(s => [s.status, s.evidence.assertionsPassed]), [['FAIL', 8], ['PASS', 10]]);
  assert.deepEqual(c.requests.map(r => r.operation), ['repair', 'review']);
  assert.deepEqual(c.requests.map(r => r.body.model), ['synthetic.author', 'synthetic.reviewer']);
  assert.deepEqual(snapshot.events.map(e => e.stage), ['authorizeContext', 'hostSeed', 'repair', 'review']);
  assert.equal(snapshot.configuration.transportKind, 'INJECTED_TEST_TRANSPORT'); assert.equal(snapshot.phase, 'REVIEWED');
  assert.equal(snapshot.authorReceipts.length, 1); assert.equal(snapshot.reviewerReceipts.length, 1);
  assert.equal(snapshot.returnedResults.length, 2); assert.equal(snapshot.authorizing, false);
  assert.equal(snapshot.remoteInferenceStopped, 'NOT_OBSERVED'); assert.equal(snapshot.lifecycle.state, 'IDLE');
  assert.equal(snapshot.lifecycle.pendingTransports, 0);
  assert.match(report.stages.find(s => s.stage === 'draft').evidence.note, /Host-seeded.*No model draft occurred/);
  const [a] = snapshot.authorReceipts, [r] = snapshot.reviewerReceipts;
  boundReceipt(a, report, 'repair', report.candidateFingerprint); boundReceipt(r, report, 'review', report.candidateFingerprint);
  assert.equal(a.inputCandidateFingerprint, c.fixture.preparations[0].candidateFingerprint);
  assert.equal(r.inputCandidateFingerprint, report.candidateFingerprint); assert.notEqual(a.adapterId, r.adapterId);
  assert.equal(c.requests[1].modelPayload.tests.evidence.candidateFingerprint, report.candidateFingerprint);
  assert.equal(c.requests[1].modelPayload.checks.evidence.attempt, 1);
  assert.deepEqual(summarizeLiveUsage([a, r]).totals, { promptTokens: 70, completionTokens: 15, totalTokens: 85 });
});

test('valid unregistered and no-change repairs remain retained data and cannot reach a review', async () => {
  for (const mode of ['unregistered', 'no-change']) {
    const c = await context({ onRequest(call) {
      const output = JSON.parse(call.envelope.choices[0].message.content);
      if (mode === 'unregistered') output.candidate.files[0].content += '\n';
      else { output.status = 'NO_CHANGE'; output.candidate = null; }
      call.envelope.choices[0].message.content = JSON.stringify(output); return reply(call.envelope);
    } });
    const report = await c.run(), snapshot = c.lane.snapshot();
    assert.equal(report.outcome, 'BLOCKED'); assert.equal(report.code, 'ADAPTER_EXCEPTION');
    assert.equal(snapshot.phase, 'FAILED'); assert.equal(last(c.lane).code, 'LIVE_REPAIR_NOT_REGISTERED');
    assert.equal(snapshot.returnedResults.length, 1); assert.equal(snapshot.authorReceipts[0].status, 'RESPONSE_VALIDATED');
    assert.equal(snapshot.reviewerReceipts.length, 0); assert.equal(c.requests.length, 1); assert.equal(c.tests.length, 1);
    if (mode === 'unregistered') assert.notEqual(snapshot.returnedResults[0].result.evidence.candidateFingerprint, snapshot.repairedCandidateFingerprint);
  }
});

test('wrong served models malformed output and malformed reported usage preserve specific receipt refusal codes', async () => {
  const cases = [
    ['repair', e => { e.model = 'different.model'; }, 'LOCAL_CHAT_MODEL_MISMATCH'],
    ['review', e => { e.model = 'different.model'; }, 'LOCAL_CHAT_MODEL_MISMATCH'],
    ['repair', e => { e.choices[0].finish_reason = 'length'; }, 'LOCAL_CHAT_FINISH_REFUSED'],
    ['repair', e => { e.choices[0].message.content = '{'; }, 'LOCAL_CHAT_JSON_INVALID'],
    ['repair', e => { e.usage = { prompt_tokens: 1.5, completion_tokens: 1, total_tokens: 2.5 }; }, 'LOCAL_CHAT_USAGE_INVALID'],
    ['repair', e => { e.usage.total_tokens = 999; }, 'LOCAL_CHAT_USAGE_INVALID'],
  ];
  for (const [operation, mutate, code] of cases) {
    const c = await context({ onRequest(call) { if (call.operation === operation) mutate(call.envelope); return reply(call.envelope); } });
    const report = await c.run(), snapshot = c.lane.snapshot();
    assert.equal(report.outcome, 'BLOCKED'); assert.equal(report.code, 'ADAPTER_EXCEPTION');
    assert.equal(last(c.lane).code, code); assert.equal(snapshot.phase, 'FAILED');
    const receipt = operation === 'repair' ? snapshot.authorReceipts[0] : snapshot.reviewerReceipts[0];
    assert.equal(receipt.status, 'UNAVAILABLE'); assert.equal(receipt.code, code); assert.equal(receipt.usage, null);
  }
});

test('missing provider usage permits a validated response without inventing complete accounting', async () => {
  const c = await context({ onRequest(call) { if (call.operation === 'review') delete call.envelope.usage; return reply(call.envelope); } });
  const report = await c.run(), snapshot = c.lane.snapshot();
  assert.equal(report.outcome, 'COMPLETED'); assert.equal(snapshot.reviewerReceipts[0].usage, null);
  const usage = summarizeLiveUsage([...snapshot.authorReceipts, ...snapshot.reviewerReceipts]);
  assert.equal(usage.complete, false); assert.equal(usage.totals, null); assert.equal(usage.knownCalls, 1); assert.equal(usage.unknownCalls, 1);
  assert.deepEqual(usage.knownSubtotal, { promptTokens: 40, completionTokens: 10, totalTokens: 50 });
});

test('independent reviewer findings fail the repaired workflow without creating another repair dispatch', async () => {
  const c = await context({ onRequest(call) {
    if (call.operation === 'review') call.envelope.choices[0].message.content = JSON.stringify({ findings: [{ code: 'REVIEW_ISSUE', message: 'Synthetic remaining issue' }], summary: 'Synthetic adverse review' });
    return reply(call.envelope);
  } });
  const report = await c.run(), snapshot = c.lane.snapshot();
  assert.equal(report.outcome, 'REPAIR_LIMIT'); assert.equal(report.code, 'REVIEW_FAILED');
  assert.equal(report.stages.at(-1).stage, 'review'); assert.equal(report.stages.at(-1).status, 'FAIL');
  assert.equal(snapshot.phase, 'REVIEWED'); assert.equal(snapshot.returnedResults[1].result.status, 'FAIL');
  assert.equal(c.requests.length, 2); assert.equal(snapshot.reviewerReceipts[0].status, 'RESPONSE_VALIDATED');
});

test('lane construction refuses incompatible schemas budgets destinations model identities and forged suite objects', async () => {
  const c = await context(); let calls = 0;
  const cases = [
    [v => { v.extra = true; }, 'LIVE_LANE_SCHEMA'], [v => { v.approval.extra = true; }, 'LIVE_APPROVAL_SCHEMA'],
    [v => { v.authorModel = v.reviewerModel; }, 'LIVE_MODELS_NOT_DISTINCT'],
    [v => { v.authorModel = ' model'; }, 'LIVE_MODEL_ID'], [v => { v.reviewerModel = '\ud800'; }, 'LIVE_MODEL_ID'],
    [v => { v.reviewedSourceFingerprint = 'a'.repeat(63); }, 'LIVE_SOURCE_IDENTITY'],
    [v => { v.approval.expiresAtMs = 0; }, 'LIVE_APPROVAL_INVALID'],
    [v => { v.endpoint = 'http://localhost:1234/chat'; }, 'LOCAL_CHAT_DESTINATION_REFUSED'],
    [v => { v.suite = { ...v.suite }; }, 'NODE_SUITE_NOT_ISSUED'],
    ...[0, 90001, 0.5, NaN].map(value => [v => { v.timeoutMs = value; }, 'LIVE_CALL_BUDGET']),
    ...[0, 4097, 0.5, NaN].map(value => [v => { v.maxOutputTokens = value; }, 'LIVE_CALL_BUDGET']),
  ];
  for (const [mutate, code] of cases) {
    const input = configuration(c.fixture); mutate(input);
    assert.throws(() => createReviewedLiveModelLaneWithTransportV1(input, () => { calls++; }, () => 100), { code });
  }
  assert.throws(() => createReviewedLiveModelLaneWithTransportV1(configuration(c.fixture), null), { code: 'LIVE_TRANSPORT_REQUIRED' });
  assert.equal(calls, 0);
});

test('repair dispatch refuses stale bindings altered tasks criteria and candidate bytes before transport', async () => {
  const cases = [
    [p => { p.binding.extra = true; }, 'LIVE_BINDING_SCHEMA'],
    [p => { p.binding.runId = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'; }, 'LIVE_BINDING_MISMATCH'],
    [p => { p.binding.attempt = 0; }, 'LIVE_BINDING_MISMATCH'],
    [p => { p.binding.taskFingerprint = '0'.repeat(64); }, 'LIVE_BINDING_MISMATCH'],
    [p => { p.binding.candidateFingerprint = '0'.repeat(64); }, 'LIVE_BINDING_MISMATCH'],
    [p => { p.task = { ...p.task, taskId: 'other.task' }; }, 'LIVE_TASK_MISMATCH'],
    [p => { p.acceptanceCriteria = ['Changed criterion']; }, 'LIVE_CRITERIA_MISMATCH'],
    [p => { p.candidate = { files: p.candidate.files.map(f => ({ path: f.path, content: f.content + '\n' })) }; }, 'LIVE_CANDIDATE_MISMATCH'],
  ];
  for (const [mutate, code] of cases) {
    const c = await context(), p = seed(c); mutate(p);
    await assert.rejects(c.lane.author.repair(p), { code });
    assert.equal(c.requests.length, 0); assert.equal(c.lane.snapshot().authorReceipts.length, 0); assert.equal(last(c.lane).code, code);
  }
});

test('approval expiry refuses both initial dispatch and a valid repair returned after expiry', async () => {
  let wall = 10000;
  const before = await context({ now: () => wall }), stopped = await before.run();
  assert.equal(stopped.outcome, 'BLOCKED'); assert.equal(stopped.code, 'ADAPTER_EXCEPTION'); assert.equal(before.requests.length, 0);
  wall = 100;
  const during = await context({ now: () => wall, onRequest(call) { wall = 10000; return reply(call.envelope); } });
  const report = await during.run(), snapshot = during.lane.snapshot();
  assert.equal(report.outcome, 'BLOCKED'); assert.equal(report.code, 'ADAPTER_EXCEPTION');
  assert.equal(last(during.lane).code, 'LIVE_APPROVAL_EXPIRED'); assert.equal(snapshot.phase, 'FAILED');
  assert.equal(snapshot.returnedResults.length, 1); assert.equal(snapshot.authorReceipts[0].status, 'RESPONSE_VALIDATED');
  assert.equal(during.requests.length, 1); assert.equal(snapshot.reviewerReceipts.length, 0);
  assert.equal(during.tests.length, 1, 'Expired repair must not reach fresh checks before the reviewer refuses it');
  assert.equal(report.stages.find(s => s.stage === 'repair').status, 'UNAVAILABLE');
});

test('approval revocation before and during transport prevents later review and preserves unknown remote stop', async t => {
  const before = await context(); before.lane.revoke(); const stopped = await before.run();
  assert.equal(stopped.outcome, 'BLOCKED'); assert.equal(before.requests.length, 0); assert.equal(before.lane.snapshot().revoked, true);
  const started = deferred(), completion = deferred();
  const during = await context({ onRequest(call) { started.resolve(call); return completion.promise; } });
  const run = during.run(), call = await started.promise;
  t.after(async () => { completion.resolve(reply(call.envelope)); await run; });
  during.lane.revoke(); const report = await run; await tick();
  let snapshot = during.lane.snapshot();
  assert.equal(report.outcome, 'BLOCKED'); assert.equal(report.code, 'ADAPTER_EXCEPTION');
  assert.equal(snapshot.phase, 'FAILED'); assert.equal(snapshot.authorReceipts[0].code, 'LOCAL_CHAT_OWNER_STOPPED');
  assert.equal(snapshot.lifecycle.state, 'STOPPED_DRAINING'); assert.equal(snapshot.lifecycle.pendingTransports, 1);
  assert.equal(snapshot.remoteInferenceStopped, 'NOT_OBSERVED'); assert.equal(snapshot.reviewerReceipts.length, 0);
  completion.resolve(reply(call.envelope)); await tick(); await tick(); snapshot = during.lane.snapshot();
  assert.equal(snapshot.lifecycle.state, 'STOPPED'); assert.equal(snapshot.lifecycle.pendingTransports, 0);
  assert.equal(snapshot.returnedResults.length, 0); assert.equal(during.requests.length, 1);
});

test('engine cancellation before and during transport remains cancelled and cannot imply model drain', async t => {
  const early = new AbortController(); early.abort(); const before = await context(), stopped = await before.run({ signal: early.signal });
  assert.equal(stopped.outcome, 'CANCELLED'); assert.equal(stopped.code, 'ABORTED'); assert.equal(before.requests.length, 0);
  const controller = new AbortController(), started = deferred(), completion = deferred();
  const during = await context({ onRequest(call) { started.resolve(call); return completion.promise; } });
  const run = during.run({ signal: controller.signal }), call = await started.promise;
  t.after(async () => { completion.resolve(reply(call.envelope)); await run; });
  controller.abort(); const report = await run; await tick();
  let snapshot = during.lane.snapshot();
  assert.equal(report.outcome, 'CANCELLED'); assert.equal(report.code, 'ABORTED');
  assert.equal(snapshot.authorReceipts[0].code, 'ABORTED'); assert.equal(snapshot.phase, 'FAILED');
  assert.equal(snapshot.lifecycle.pendingTransports, 1); assert.equal(snapshot.lifecycle.state, 'QUARANTINED');
  completion.resolve(reply(call.envelope)); await tick(); await tick(); snapshot = during.lane.snapshot();
  assert.equal(snapshot.lifecycle.pendingTransports, 0); assert.equal(snapshot.lifecycle.state, 'QUARANTINED');
  assert.equal(snapshot.remoteInferenceStopped, 'NOT_OBSERVED'); assert.equal(snapshot.reviewerReceipts.length, 0);
});

test('stage replays dispatch nothing and cannot rewrite an already returned engine report', async () => {
  const c = await context(), report = await c.run(), before = JSON.stringify(report);
  await assert.rejects(c.lane.author.repair(payload(c.fixture, { runId: report.runId })), { code: 'LIVE_STAGE_ORDER' });
  assert.throws(() => c.lane.author.draft(payload(c.fixture, { attempt: 0, candidate: null, runId: report.runId })), { code: 'LIVE_STAGE_ORDER' });
  assert.equal(c.requests.length, 2); assert.equal(JSON.stringify(report), before); assert.equal(c.lane.snapshot().phase, 'FAILED');
  const separate = await context(), p = payload(separate.fixture, { attempt: 0, candidate: null }); seed(separate);
  assert.throws(() => separate.lane.author.draft(p), { code: 'LIVE_STAGE_ORDER' }); assert.equal(separate.requests.length, 0);
});

test('caller mutation after lane construction cannot replace captured configuration approval or budgets', async () => {
  const c = await context(), before = c.lane.snapshot();
  Object.assign(c.input, { authorModel: 'changed.author', reviewerModel: 'changed.reviewer', endpoint: 'http://localhost/chat', timeoutMs: 0, maxOutputTokens: 0 });
  c.input.approval.id = 'changed.approval'; c.input.approval.expiresAtMs = 1;
  const report = await c.run(), after = c.lane.snapshot();
  assert.equal(report.outcome, 'COMPLETED'); assert.deepEqual(after.configuration, before.configuration); assert.deepEqual(after.approval, before.approval);
  assert.equal(after.configurationFingerprint, before.configurationFingerprint); assert.equal(after.approvalFingerprint, before.approvalFingerprint);
  assert.deepEqual(c.requests.map(r => r.body.model), ['synthetic.author', 'synthetic.reviewer']);
  for (const request of c.requests) { assert.equal(request.body.max_tokens, 512); assert.equal(request.url, before.configuration.endpoint); }
});

test('invalid and regressing consent clocks refuse dispatch or retain a late result without admission', async () => {
  for (const wall of [NaN, Infinity, -1, 0.5]) {
    const c = await context({ now: () => wall });
    assert.throws(() => c.lane.authorizeContext.authorize(payload(c.fixture, { attempt: 0, candidate: null })), { code: 'LIVE_CLOCK_INVALID' });
    assert.equal(c.requests.length, 0);
  }
  let wall = 100;
  const before = await context({ now: () => wall }), p = seed(before); wall = 99;
  await assert.rejects(before.lane.author.repair(p), { code: 'LIVE_CLOCK_INVALID' }); assert.equal(before.requests.length, 0);
  wall = 100;
  const during = await context({ now: () => wall, onRequest(call) { wall = 99; return reply(call.envelope); } });
  assert.equal((await during.run()).outcome, 'BLOCKED'); assert.equal(last(during.lane).code, 'LIVE_CLOCK_INVALID');
  assert.equal(during.lane.snapshot().returnedResults.length, 1);
});

test('issued lane reader refuses copied identities and returns immutable snapshots with injected provenance', async () => {
  const c = await context(), before = readIssuedLiveModelLaneV1(c.lane);
  assert.equal(before.preparations[0], c.fixture.preparations[0]); assert.equal(before.snapshot.configuration.transportKind, 'INJECTED_TEST_TRANSPORT');
  assert.throws(() => readIssuedLiveModelLaneV1({ ...c.lane }), { code: 'LIVE_LANE_NOT_ISSUED' });
  assert.throws(() => readIssuedLiveModelLaneV1(c.lane.snapshot()), { code: 'LIVE_LANE_NOT_ISSUED' });
  await c.run(); assert.equal(before.snapshot.authorReceipts.length, 0);
  const after = readIssuedLiveModelLaneV1(c.lane); assert.equal(after.snapshot.authorReceipts.length, 1);
  assert(Object.isFrozen(after)); assert(Object.isFrozen(after.snapshot.returnedResults[0].result));
  assert.throws(() => { after.snapshot.configuration.authorModel = 'changed'; }, TypeError);
});

test('concurrent stage refusal stays terminal when the original repair returns later', async t => {
  const started = deferred(), completion = deferred();
  const c = await context({ onRequest(call) { started.resolve(call); return completion.promise; } });
  const p = seed(c), first = c.lane.author.repair(p); first.catch(() => {});
  t.after(async () => { completion.resolve(reply((await started.promise).envelope)); await first.catch(() => {}); });
  const call = await started.promise;
  await assert.rejects(c.lane.author.repair(p), { code: 'LIVE_STAGE_ORDER' });
  assert.equal(c.lane.snapshot().phase, 'FAILED');
  completion.resolve(reply(call.envelope));
  await assert.rejects(first, { code: 'LIVE_STAGE_ORDER' });
  const snapshot = c.lane.snapshot();
  assert.equal(snapshot.phase, 'FAILED'); assert.equal(snapshot.returnedResults.length, 1);
  assert.equal(snapshot.authorReceipts.length, 1); assert.equal(snapshot.reviewerReceipts.length, 0);
  assert.equal(c.requests.length, 1);
});
