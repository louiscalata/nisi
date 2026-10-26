import test from 'node:test';
import assert from 'node:assert/strict';
import { context, configuration, selection, seed, payload, deferred, tick, reply } from './helpers/live-model-v3-fixture.mjs';
import { createReviewedLiveModelLaneWithTransportV3, createReviewedLiveModelLaneV3, readIssuedLiveModelLaneV3 } from '../hosts/repository/reviewed-live-model-v3.mjs';
import { readIssuedLiveModelLaneV1, readIssuedLiveModelLaneV2 } from '../hosts/repository/reviewed-live-model-v1.mjs';
import { context as legacyContext } from './helpers/reviewed-live-model-fixture.mjs';
import { readLiveModelSelectionV3 } from '../hosts/repository/live-model-selection-v3.mjs';
import { sha256Text, stableStringify } from '../workflow/contracts.mjs';

for (const authorApi of ['NATIVE_API', 'CHAT_COMPLETIONS']) for (const reviewerApi of ['NATIVE_API', 'CHAT_COMPLETIONS']) {
  test(`V3 synthetic engine ${authorApi}/${reviewerApi} retains exact candidate and fresh checks`, async () => {
    const c = await context({ configure(input) { input.author = selection('author', authorApi); input.reviewer = selection('reviewer', reviewerApi); } });
    const report = await c.run(), s = c.lane.snapshot();
    assert.equal(report.outcome, 'COMPLETED'); assert.equal(report.repairAttempts, 1);
    assert.equal(report.candidateFingerprint, c.fixture.preparations[1].candidateFingerprint);
    assert.deepEqual(c.requests.map(r => r.operation), ['repair', 'review']);
    assert.deepEqual(c.tests.map(r => r.attempt), [0, 1]); assert.equal(s.phase, 'REVIEWED');
    assert.equal(s.configuration.transportKind, 'INJECTED_TEST_TRANSPORT'); assert.equal(s.lifecycle.state, 'IDLE');
    assert.equal(s.lifecycle.pendingTransports, 0); assert.equal(s.lifecycle.remoteInferenceStopped, 'NOT_OBSERVED');
    for (const name of ['author', 'reviewer']) {
      const receipt = s[name + 'Receipts'][0], expected = s.configuration[name];
      assert.equal(receipt.schemaVersion, expected.adapterReceiptVersion); assert.equal(receipt.requestedModel, expected.model);
      assert.equal(s.lifecycle.roles[name].state, 'IDLE');
      if (expected.api === 'NATIVE_API') {
        assert.equal(receipt.termination, 'NOT_REPORTED'); assert.equal(receipt.serverCompletionAttested, false);
        assert.equal(receipt.usageSource.totalTokens, 'DERIVED_SUM_OF_REPORTED_COUNTERS');
      } else assert.equal(receipt.outputMode, expected.outputMode);
    }
  });
}
test('V3 issuance does not recreate V1/V2 authority and requires both injected transports', async () => {
  const c = await context(), old = await legacyContext(), transports = { author() {}, reviewer() {} };
  for (const read of [readIssuedLiveModelLaneV1, readIssuedLiveModelLaneV2]) assert.throws(() => read(c.lane), { code: 'LIVE_LANE_NOT_ISSUED' });
  assert.throws(() => readIssuedLiveModelLaneV3(old.lane), { code: 'LIVE_LANE_NOT_ISSUED' });
  assert.throws(() => readIssuedLiveModelLaneV3({ ...c.lane }), { code: 'LIVE_LANE_NOT_ISSUED' });
  assert.throws(() => createReviewedLiveModelLaneWithTransportV3(c.input, { author() {} }), { code: 'LIVE_TRANSPORT_REQUIRED' });
  assert.throws(() => createReviewedLiveModelLaneWithTransportV3({ ...c.input, endpoint: 'extra' }, transports), { code: 'LIVE_LANE_SCHEMA' });
});
const invalidSelections = [
  ['unknown-api', s => { s.author.api = 'NATIVE'; }],
  ['native-output-mode', s => { s.author.outputMode = 'json_schema'; }],
  ['chat-instance', s => { s.reviewer.expectedModelInstance = 'x'; }],
  ['native-reasoning', s => { s.author.reasoning = 'auto'; }],
  ['native-profile', s => { s.author.profile = 'other'; }],
  ['native-path', s => { s.author.endpoint = s.reviewer.endpoint; }],
  ['chat-path', s => { s.reviewer.endpoint = s.author.endpoint; }],
  ['outside-loopback', s => { s.author.endpoint = 'http://example.com/api/v1/chat'; }],
  ['credentials', s => { s.author.endpoint = 'http://u:p@127.0.0.1/api/v1/chat'; }],
  ['query', s => { s.author.endpoint += '?extra=1'; }],
  ['same-model', s => { s.reviewer.model = s.author.model; }],
  ['model-null', s => { s.author.model = null; }],
  ['missing-field', s => { delete s.author.expectedModelInstance; }],
  ['same-native-instance', s => { s.reviewer = { ...selection('reviewer', 'NATIVE_API'), expectedModelInstance: s.author.expectedModelInstance }; }],
];
for (const [name, change] of invalidSelections) test(`V3 refuses ${name} before dispatch`, () => {
  const s = { author: selection('author'), reviewer: selection('reviewer') }; change(s);
  assert.throws(() => readLiveModelSelectionV3(s));
});
test('V3 selection and payload accessors are not invoked', async () => {
  const c = await context(); let reads = 0;
  const author = selection('author'); Object.defineProperty(author, 'api', { enumerable: true, get() { reads++; return 'NATIVE_API'; } });
  assert.throws(() => readLiveModelSelectionV3({ author, reviewer: selection('reviewer') })); assert.equal(reads, 0);
  const p = seed(c); Object.defineProperty(p, 'binding', { enumerable: true, get() { reads++; return {}; } });
  await assert.rejects(c.lane.author.repair(p), { code: 'LIVE_PAYLOAD_SCHEMA' }); assert.equal(reads, 0); assert.equal(c.requests.length, 0);
});
test('V3 complete configuration changes bind approval; frozen selection is not mutable', async () => {
  const c = await context(), changes = [() => {}, i => { i.author.model = 'another.author'; },
    i => { i.author.expectedModelInstance = 'another.instance'; }, i => { i.author.endpoint = 'http://127.0.0.1:4321/api/v1/chat'; },
    i => { i.reviewer.outputMode = 'json_instruction'; }, i => { i.timeoutMs = 900; }, i => { i.maxOutputTokens = 500; },
    i => { i.author = selection('author', 'CHAT_COMPLETIONS'); }], snapshots = [];
  for (const change of changes) {
    const i = configuration(c.fixture); change(i);
    const lane = createReviewedLiveModelLaneWithTransportV3(i, { author() {}, reviewer() {} }, () => 100);
    const s = lane.snapshot(); snapshots.push(s); i.author.model = 'mutated'; i.approval.id = 'mutated';
    assert.equal(lane.snapshot().configuration.author.model, s.configuration.author.model);
    assert.equal(s.configurationFingerprint, sha256Text('nisi/live-model-configuration/v3\0' + stableStringify(s.configuration)));
    assert.equal(s.approvalFingerprint, sha256Text('nisi/live-model-approval/v3\0' + stableStringify(s.approval)));
  }
  assert.equal(new Set(snapshots.map(s => s.configurationFingerprint)).size, changes.length);
  assert.equal(new Set(snapshots.map(s => s.approvalFingerprint)).size, changes.length);
  // Construction captures global transport but makes no request.
  const real = createReviewedLiveModelLaneV3(configuration(c.fixture));
  assert.notEqual(real.snapshot().configurationFingerprint, snapshots[0].configurationFingerprint);
  assert.equal(real.snapshot().configuration.transportKind, 'LOOPBACK_HTTP'); real.revoke();
});
for (const role of ['author', 'reviewer']) test(`V3 cancellation while ${role} pending stops both owners without inventing remote stop`, async t => {
  const start = deferred(), completion = deferred();
  const c = await context({ onRequest(call) { if (call.role !== role) return reply(call.envelope); start.resolve(call); return completion.promise; } });
  const run = c.run(), call = await start.promise;
  t.after(async () => { completion.resolve(reply(call.envelope)); await run; });
  c.lane.revoke(); assert.equal((await run).outcome, 'BLOCKED');
  let s = c.lane.snapshot(); assert.equal(s.phase, 'FAILED'); assert.equal(s.lifecycle.pendingTransports, 1);
  assert.equal(s.lifecycle.remoteInferenceStopped, 'NOT_OBSERVED'); assert.equal(s.lifecycle.roles[role].state, 'STOPPED_DRAINING');
  assert.equal(s.lifecycle.roles[role === 'author' ? 'reviewer' : 'author'].state, 'STOPPED');
  completion.resolve(reply(call.envelope)); await tick(); await tick(); s = c.lane.snapshot();
  assert.equal(s.lifecycle.pendingTransports, 0); assert.equal(s.lifecycle.recoveryRequired, true);
  assert.equal(s.lifecycle.state, 'QUARANTINED'); assert.equal(s.remoteInferenceStopped, 'NOT_OBSERVED');
});
test('V3 unregistered returned source is retained but never reaches new checks/reviewer', async () => {
  const c = await context({ onRequest(call) {
    const content = JSON.parse(call.envelope.output[0].content); content.candidate.files[0].content += '\n';
    call.envelope.output[0].content = JSON.stringify(content); return reply(call.envelope);
  } });
  assert.equal((await c.run()).outcome, 'BLOCKED'); const s = c.lane.snapshot();
  assert.equal(s.events.at(-1).code, 'LIVE_REPAIR_NOT_REGISTERED'); assert.equal(s.returnedResults.length, 1);
  assert.equal(c.tests.length, 1); assert.equal(c.requests.length, 1); assert.equal(s.reviewerReceipts.length, 0);
});
test('V3 expiry after validated response prevents admission and stops both owners', async () => {
  let wall = 100;
  const c = await context({ now: () => wall, onRequest(call) { wall = 10000; return reply(call.envelope); } });
  assert.equal((await c.run()).outcome, 'BLOCKED'); const s = c.lane.snapshot();
  assert.equal(s.events.at(-1).code, 'LIVE_APPROVAL_EXPIRED'); assert.equal(s.returnedResults.length, 1);
  assert.equal(s.lifecycle.roles.author.state, 'STOPPED'); assert.equal(s.lifecycle.roles.reviewer.state, 'STOPPED');
});
test('V3 caller payload changes while awaiting transport cannot change retained event bindings', async () => {
  const start = deferred(), completion = deferred();
  const c = await context({ onRequest(call) { start.resolve(call); return completion.promise; } });
  const p = seed(c), expected = { ...p.binding }, running = c.lane.author.repair(p), call = await start.promise;
  p.binding.runId = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'; p.acceptanceCriteria = ['tampered'];
  completion.resolve(reply(call.envelope)); await running;
  assert.deepEqual({ ...c.lane.snapshot().events.at(-1).binding }, expected);
});
test('V3 overlapping call fails lane permanently; no restarted/second transport', async t => {
  const start = deferred(), completion = deferred();
  const c = await context({ onRequest(call) { start.resolve(call); return completion.promise; } });
  const p = seed(c), running = c.lane.author.repair(p); running.catch(() => {}); const call = await start.promise;
  t.after(async () => { completion.resolve(reply(call.envelope)); await running.catch(() => {}); });
  await assert.rejects(c.lane.author.repair(p), { code: 'LIVE_STAGE_ORDER' });
  await assert.rejects(running); assert.equal(c.lane.snapshot().phase, 'FAILED'); assert.equal(c.requests.length, 1);
});
