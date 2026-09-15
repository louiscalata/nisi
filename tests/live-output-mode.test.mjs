// Private, injected transport/process evidence only; no model or native work.
import test from 'node:test';
import assert from 'node:assert/strict';
import { context, configuration, deferred, seed, reply, tick } from './helpers/reviewed-live-model-fixture.mjs';
import { repositoryLiveContext } from './helpers/repository-live-run-fixture.mjs';
import { createReviewedLiveModelLaneWithTransportV1, createReviewedLiveModelLaneWithTransportV2,
  readIssuedLiveModelLaneV1, readIssuedLiveModelLaneV2 } from '../hosts/repository/reviewed-live-model-v1.mjs';
import { createRepositoryLiveModelRunV1, createRepositoryLiveModelRunV2, readRepositoryLiveModelRunV1,
  readRepositoryLiveModelRunV2 } from '../receipts/repository-live-model-run-v1.mjs';
import { parseLiveDemoArguments, runPrivateLiveDemo } from '../examples/repository-live-model.mjs';
import { withPreflightGuards } from './helpers/live-cli-side-effect-guard.mjs';
import { sha256Text, stableStringify } from '../workflow/contracts.mjs';
const modes = ['json_schema', 'json_instruction'];
const setModes = (a, r = a) => input => Object.assign(input, { authorOutputMode: a, reviewerOutputMode: r });

test('V1 and V2 issued identities are not interchangeable; v2 modes must be explicit', async () => {
  const c = await context(), input = configuration(c.fixture), transport = () => { throw Error('must not dispatch'); };
  assert.throws(() => createReviewedLiveModelLaneWithTransportV2(input, transport), { code: 'LIVE_LANE_SCHEMA' });
  assert.throws(() => createReviewedLiveModelLaneWithTransportV1({ ...input, authorOutputMode: 'json_schema', reviewerOutputMode: 'json_schema' }, transport), { code: 'LIVE_LANE_SCHEMA' });
  const d = await context({ laneVersion: 2 });
  assert.throws(() => readIssuedLiveModelLaneV1(d.lane), { code: 'LIVE_LANE_VERSION_MISMATCH' });
  assert.throws(() => readIssuedLiveModelLaneV2(c.lane), { code: 'LIVE_LANE_VERSION_MISMATCH' });
  assert.throws(() => readIssuedLiveModelLaneV2({ ...d.lane }), { code: 'LIVE_LANE_NOT_ISSUED' });
  for (const mode of [undefined, null, 'json', 'JSON_SCHEMA', ' json_instruction', false, {}, []]) {
    assert.throws(() => createReviewedLiveModelLaneWithTransportV2({ ...input, authorOutputMode: mode, reviewerOutputMode: 'json_schema' }, transport), { code: 'LIVE_OUTPUT_MODE_INVALID' });
  }
});

test('mode-only changes bind configuration and approval without changing task or fixture', async () => {
  const c = await context({ laneVersion: 2, configure: setModes('json_schema') }), snapshots = [];
  for (const [a, r] of [['json_schema','json_schema'], ['json_instruction','json_schema'], ['json_schema','json_instruction']]) {
    const input = { ...c.input, authorOutputMode: a, reviewerOutputMode: r };
    const lane = createReviewedLiveModelLaneWithTransportV2(input, () => { throw Error('unexpected'); }, () => 100);
    snapshots.push(lane.snapshot()); input.authorOutputMode = 'changed'; input.reviewerOutputMode = 'changed';
    assert.equal(lane.snapshot().configuration.authorOutputMode, a); assert.equal(lane.snapshot().configuration.reviewerOutputMode, r);
  }
  assert.equal(new Set(snapshots.map(s => s.configurationFingerprint)).size, 3);
  assert.equal(new Set(snapshots.map(s => s.approvalFingerprint)).size, 3);
  for (const s of snapshots) {
    assert.equal(s.configurationFingerprint, sha256Text('nisi/live-model-configuration/v2\0' + stableStringify(s.configuration)));
    assert.equal(s.approvalFingerprint, sha256Text('nisi/live-model-approval/v2\0' + stableStringify(s.approval)));
    assert.equal(s.configuration.taskFingerprint, c.fixture.preparations[0].taskFingerprint);
    assert.equal(s.configuration.suiteFingerprint, c.fixture.suite.fingerprint);
    assert.equal(s.baselineCandidateFingerprint, c.fixture.preparations[0].candidateFingerprint);
  }
});

for (const authorMode of modes) for (const reviewerMode of modes) test(`v2 real-engine synthetic ${authorMode}/${reviewerMode} binds role modes and fresh checks`, async t => {
  const c = await repositoryLiveContext(t, { laneVersion: 2, configure: setModes(authorMode, reviewerMode) }), run = await c.run();
  let receipt;
  assert.doesNotThrow(() => { receipt = createRepositoryLiveModelRunV2(run.context); }, 'Each valid role-mode pair must have consistent transport evidence');
  const { fingerprint, ...identity } = receipt;
  assert.equal(fingerprint, sha256Text('nisi/repository-live-model-run/v2\0' + stableStringify(identity)));
  assert.equal(receipt.schemaVersion, 'nisi-repository-live-model-run-v2'); assert.equal(receipt.status, 'SYNTHETIC_CONTRACT_PASS');
  assert.equal(receipt.lane.schemaVersion, 'nisi-reviewed-live-model-lane-v2'); assert.equal(receipt.hostSeedInference, false);
  assert.deepEqual(c.requests.map(r => Object.hasOwn(r.body, 'response_format')), [authorMode === 'json_schema', reviewerMode === 'json_schema']);
  assert.deepEqual([receipt.lane.authorReceipts[0].outputMode, receipt.lane.reviewerReceipts[0].outputMode], [authorMode, reviewerMode]);
  assert.deepEqual([receipt.lane.authorReceipts[0].schemaVersion, receipt.lane.reviewerReceipts[0].schemaVersion], [2, 2]);
  assert.deepEqual(run.hostResult.report.stages.filter(s => s.stage === 'tests').map(s => [s.status, s.evidence.attempt]), [['FAIL', 0], ['PASS', 1]]);
  assert.deepEqual(readRepositoryLiveModelRunV2(receipt, run.context), receipt);
  assert.throws(() => createRepositoryLiveModelRunV1(run.context), { code: 'LIVE_LANE_VERSION_MISMATCH' });
  assert.throws(() => readRepositoryLiveModelRunV1(receipt, run.context), { code: 'LIVE_LANE_VERSION_MISMATCH' });
  for (const mutate of [r => { r.lane.authorReceipts[0].outputMode = 'unknown'; },
    r => { delete r.lane.reviewerReceipts[0].outputMode; }, r => { r.lane.authorReceipts[0].schemaVersion = 1; },
    r => { r.lane.configuration.authorOutputMode = 'unknown'; }, r => { r.schemaVersion = 'nisi-repository-live-model-run-v1'; }]) {
    const changed = structuredClone(receipt); mutate(changed); const { fingerprint: _old, ...identity } = changed;
    changed.fingerprint = sha256Text('nisi/repository-live-model-run/v2\0' + stableStringify(identity));
    assert.throws(() => readRepositoryLiveModelRunV2(changed, run.context), { code: 'LIVE_RUN_RECORD_MISMATCH' });
  }
});

for (const mode of modes) {
  test(`${mode} unregistered repair and empty final remain terminal without reviewer`, async () => {
    for (const unregistered of [true, false]) {
      const c = await context({ laneVersion: 2, configure: setModes(mode), onRequest(call) {
        if (unregistered) { const output = JSON.parse(call.envelope.choices[0].message.content); output.candidate.files[0].content += '\n'; call.envelope.choices[0].message.content = JSON.stringify(output); }
        else call.envelope.choices[0].message.content = '';
        return reply(call.envelope);
      } });
      const report = await c.run(), s = c.lane.snapshot(); assert.equal(report.outcome, 'BLOCKED');
      assert.equal(s.phase, 'FAILED'); assert.equal(s.authorReceipts[0].outputMode, mode); assert.equal(s.reviewerReceipts.length, 0);
      assert.equal(c.requests.length, 1); assert.equal(c.tests.length, 1); assert.equal(s.returnedResults.length, unregistered ? 1 : 0);
    }
  });
  test(`${mode} post-result expiry stops before fresh tests`, async () => {
    let wall = 100;
    const c = await context({ laneVersion: 2, configure: setModes(mode), now: () => wall, onRequest(call) { wall = 10000; return reply(call.envelope); } });
    assert.equal((await c.run()).outcome, 'BLOCKED'); const s = c.lane.snapshot();
    assert.equal(s.events.at(-1).code, 'LIVE_APPROVAL_EXPIRED'); assert.equal(s.returnedResults.length, 1);
    assert.equal(c.tests.length, 1); assert.equal(c.requests.length, 1); assert.equal(s.reviewerReceipts.length, 0);
  });
  test(`${mode} overlapping repair cannot revive failed lane`, async t => {
    const started = deferred(), completion = deferred();
    const c = await context({ laneVersion: 2, configure: setModes(mode), onRequest(call) { started.resolve(call); return completion.promise; } });
    const p = seed(c), first = c.lane.author.repair(p); first.catch(() => {});
    t.after(async () => { completion.resolve(reply((await started.promise).envelope)); await first.catch(() => {}); });
    const call = await started.promise; await assert.rejects(c.lane.author.repair(p), { code: 'LIVE_STAGE_ORDER' });
    completion.resolve(reply(call.envelope)); await assert.rejects(first, { code: 'LIVE_STAGE_ORDER' });
    assert.equal(c.lane.snapshot().phase, 'FAILED'); assert.equal(c.requests.length, 1);
  });
  test(`${mode} revocation preserves pending transport and refuses review`, async t => {
    const started = deferred(), completion = deferred();
    const c = await context({ laneVersion: 2, configure: setModes(mode), onRequest(call) { started.resolve(call); return completion.promise; } });
    const run = c.run(), call = await started.promise;
    t.after(async () => { completion.resolve(reply(call.envelope)); await run; });
    c.lane.revoke(); assert.equal((await run).outcome, 'BLOCKED');
    const s = c.lane.snapshot(); assert.equal(s.authorReceipts[0].outputMode, mode); assert.equal(s.authorReceipts[0].code, 'LOCAL_CHAT_OWNER_STOPPED');
    assert.equal(s.lifecycle.pendingTransports, 1); assert.equal(s.reviewerReceipts.length, 0);
    completion.resolve(reply(call.envelope)); await tick(); await tick(); assert.equal(c.lane.snapshot().lifecycle.pendingTransports, 0);
  });
}

test('CLI paired mode selection stays explicit immutable and refuses mistakes before fixture access', async () => {
  const base = ['--approved-reviewed-fixture', '--endpoint', 'http://127.0.0.1/chat', '--author-model', 'a', '--reviewer-model', 'b'];
  await withPreflightGuards(async ({ reads }) => {
    const selected = parseLiveDemoArguments([...base, '--author-output-mode', 'json_instruction', '--reviewer-output-mode', 'json_schema']);
    assert.ok(Object.isFrozen(selected)); assert.equal(selected.authorOutputMode, 'json_instruction'); assert.equal(selected.reviewerOutputMode, 'json_schema');
    assert.equal(Object.hasOwn(parseLiveDemoArguments(base), 'authorOutputMode'), false);
    for (const extra of [['--author-output-mode', 'json_schema'], ['--reviewer-output-mode', 'json_instruction'],
      ['--author-output-mode', 'json', '--reviewer-output-mode', 'json_schema']]) {
      await assert.rejects(runPrivateLiveDemo([...base, ...extra]), { code: 'LIVE_DEMO_OUTPUT_MODE' });
    }
    await assert.rejects(runPrivateLiveDemo([...base, '--author-output-mode']), { code: 'LIVE_DEMO_ARGUMENTS' });
    await assert.rejects(runPrivateLiveDemo([...base, '--author-output-mode', 'json_schema', '--author-output-mode', 'json_schema']), { code: 'LIVE_DEMO_ARGUMENTS' });
    await assert.rejects(runPrivateLiveDemo([...base.slice(1), '--author-output-mode', 'json_schema', '--reviewer-output-mode', 'json_schema']), { code: 'LIVE_DEMO_EXPLICIT_APPROVAL_REQUIRED' });
    assert.deepEqual(reads, []);
  });
});
