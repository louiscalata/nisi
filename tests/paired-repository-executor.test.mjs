// Actual engine/issued-owner APIs with synthetic HTTP/process observations.
// No inference, native source execution, policy treatment or benchmark occurs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { describeRepositoryTrialInputsV1 as describe, startRepositoryPairedExecutorV1 as start } from '../hosts/repository/paired-trial-executor-v1.mjs';
import { decodeRepositoryTrialCandidateV1 } from '../evaluation/repository-trial-candidate-v1.mjs';
import { createPairedTrialRunnerV1 } from '../evaluation/paired-trial-runner-v1.mjs';
import { readPreventionExperimentPlanV1 } from '../evaluation/prevention-experiment-plan-v1.mjs';
import { createReviewedLiveModelLaneV3 } from '../hosts/repository/reviewed-live-model-v3.mjs';
import { createRepositoryWorkflowOwnerV1 } from '../hosts/repository/reviewed-workflow-v1.mjs';
import { sha256Text, stableStringify } from '../workflow/contracts.mjs';
import { repositoryLiveContext } from './helpers/repository-live-run-fixture.mjs';
import { context, selection, reply, deferred, tick } from './helpers/live-model-v3-fixture.mjs';
import { pairedTrialFixtureInputs } from './helpers/paired-trial-fixture.mjs';
const binding = lane => {
  const d = describe(lane);
  return { requestId: 'a'.repeat(64), profileSha256: 'b'.repeat(64), model: d.model, modelSettingsSha256: d.modelSettingsSha256,
    taskSha256: d.taskSha256, baselineSha256: d.baselineSha256, suiteFingerprint: d.suiteFingerprint,
    reviewedSourceFingerprint: d.reviewedSourceFingerprint };
};
const create = async (t, options = {}) => repositoryLiveContext(t, { contextFactory: context, ...options });
function evidence(wrapper) {
  const observed = wrapper.inspectProjection(); assert.equal(observed.state, 'PUBLISHED');
  assert.equal(observed.persisted, false); assert.equal(observed.authorizing, false);
  const e = observed.evidence, { fingerprint, ...identity } = e;
  assert.equal(fingerprint, sha256Text('nisi/repository-trial-projection/v1\0' + stableStringify(identity)));
  for (const key of ['oracleEvaluated', 'policyTreatmentApplied', 'modelAuthenticityAttested', 'executionAttested',
    'measurementVerified', 'causalClaim', 'authorizing', 'promotionEligible', 'resumable']) assert.equal(e[key], false);
  return e;
}

test('composite profile binds both roles settings and transport while source identities stay explicit', async t => {
  const c = await create(t), d = describe(c.lane); assert(Object.isFrozen(d.configuration.roles.author));
  assert.equal(d.taskSha256, c.fixture.preparations[0].taskFingerprint);
  assert.equal(d.baselineSha256, c.fixture.preparations[0].baselineFingerprint);
  assert.notEqual(d.baselineSha256, c.fixture.preparations[0].candidateFingerprint);
  assert.equal(d.model, 'nisi-v3-composite:' + d.modelSettingsSha256); assert(!d.model.includes('synthetic.author'));
  assert.equal(d.configuration.roles.author.model, 'synthetic.author'); assert.equal(d.configuration.roles.reviewer.model, 'synthetic.reviewer');
  assert.equal(d.authorizing, false); assert.equal(d.oracleToolchainAndResourceAdmission, 'CALLER_VERIFY_INPUTS_REQUIRED');
  for (const configure of [i => { i.author = selection('other', 'NATIVE_API'); }, i => { i.reviewer.model = 'different'; },
    i => { i.author.expectedModelInstance = 'different.instance'; }, i => { i.reviewer.outputMode = 'json_instruction'; },
    i => { i.timeoutMs++; }, i => { i.maxOutputTokens++; }]) {
    const other = await create(t, { configure }); assert.notEqual(describe(other.lane).modelSettingsSha256, d.modelSettingsSha256);
    assert.equal(describe(other.lane).taskSha256, d.taskSha256);
  }
});

test('all declared source and composite binding mismatches refuse before host or model dispatch', async t => {
  const c = await create(t), b = binding(c.lane); let calls = 0;
  const host = { ...c.host, run() { calls++; throw Error('must not run'); } };
  for (const key of ['model', 'modelSettingsSha256', 'taskSha256', 'baselineSha256', 'suiteFingerprint', 'reviewedSourceFingerprint']) {
    const changed = { ...b, [key]: key === 'model' ? 'synthetic.author' : '0'.repeat(64) };
    assert.throws(() => start({ host, lane: c.lane, binding: changed }), { code: 'TRIAL_PROJECTION_BINDING' });
  }
  for (const key of ['requestId', 'profileSha256']) assert.throws(() => start({ host, lane: c.lane, binding: { ...b, [key]: b[key] + '\n' } }), { code: 'TRIAL_PROJECTION_DIGEST' });
  assert.equal(calls, 0); assert.equal(c.requests.length, 0); assert.equal(c.lane.snapshot().phase, 'NEW');
});

test('cloned lane identities and accessor bindings never start an operation', async t => {
  const c = await create(t), b = binding(c.lane); let gets = 0;
  assert.throws(() => describe({ ...c.lane }), { code: 'LIVE_LANE_NOT_ISSUED' });
  Object.defineProperty(b, 'model', { enumerable: true, get() { gets++; return ''; } });
  assert.throws(() => start({ host: c.host, lane: c.lane, binding: b }), { code: 'TRIAL_RECORD' });
  assert.equal(gets, 0); assert.equal(c.requests.length, 0);
});

for (const author of ['NATIVE_API', 'CHAT_COMPLETIONS']) for (const reviewer of ['NATIVE_API', 'CHAT_COMPLETIONS'])
test(`${author}/${reviewer} projects exact candidate and engine label without promoting synthetic counters`, async t => {
  const c = await create(t, { configure(i) { i.author = selection('author', author); i.reviewer = selection('reviewer', reviewer); } });
  const b = binding(c.lane), wrapper = start({ host: c.host, lane: c.lane, binding: b }); b.requestId = 'changed';
  assert.equal(wrapper.inspectProjection().state, 'PENDING'); assert.equal(wrapper.inspectProjection().evidence, null);
  const result = await wrapper.operation.result; await wrapper.operation.settled; const e = evidence(wrapper);
  assert.deepEqual(Object.keys(result).sort(), ['requestId', 'profileSha256', 'candidateText', 'candidateSha256',
    'completionClaim', 'tokenUsage', 'durationMs', 'repairAttempts', 'modelCalls'].sort());
  assert.equal(result.requestId, 'a'.repeat(64)); assert.equal(result.profileSha256, 'b'.repeat(64));
  assert.equal(result.completionClaim, true); assert.equal(e.completionClaimSource, 'ENGINE_OUTCOME_LABEL_COMPLETED_V1');
  const candidate = decodeRepositoryTrialCandidateV1(result.candidateText, result.candidateSha256);
  assert.deepEqual(candidate.files, c.fixture.preparations[1].candidate.files);
  assert.equal(candidate.candidateFingerprint, e.candidate.candidateFingerprint);
  assert.notEqual(result.candidateSha256, candidate.candidateFingerprint);
  assert.equal(e.repositoryReceiptStatus, 'SYNTHETIC_CONTRACT_PASS'); assert.equal(e.usage.sourceKind, 'SYNTHETIC_FIXTURE');
  assert.equal(e.usage.reported.totals.totalTokens, 85); assert.equal(result.tokenUsage, null); assert.equal(result.modelCalls, null);
  assert.equal(result.repairAttempts, 1); assert.equal(result.durationMs, null); assert.equal(e.usage.hostSeedInference, false);
  assert.equal(c.lane.snapshot().revoked, true); assert.equal(wrapper.operation.status(), 'IDLE');
  wrapper.operation.cancel(); assert.deepEqual(wrapper.inspectProjection().evidence, e);
  assert.throws(() => start({ host: c.host, lane: c.lane, binding: binding(c.lane) }), { code: 'TRIAL_PROJECTION_LANE_NOT_READY' });
});

test('coherent failed review preserves candidate for independent checking without a completion claim', async t => {
  const c = await create(t, { onRequest(call) {
    if (call.role === 'reviewer') call.envelope.choices[0].message.content = JSON.stringify({ findings: [{ code: 'TEST_FINDING', message: 'Still fails a requirement' }], summary: 'Adverse fixture review' });
    return reply(call.envelope);
  } });
  const wrapper = start({ host: c.host, lane: c.lane, binding: binding(c.lane) });
  const result = await wrapper.operation.result; await wrapper.operation.settled; const e = evidence(wrapper);
  assert.equal(e.repositoryReceiptStatus, 'INCOMPLETE'); assert.equal(e.engineOutcome, 'REPAIR_LIMIT');
  assert.equal(result.completionClaim, false); assert.equal(result.repairAttempts, 1); assert.equal(result.tokenUsage, null);
  assert.deepEqual(decodeRepositoryTrialCandidateV1(result.candidateText, result.candidateSha256).files, c.fixture.preparations[1].candidate.files);
  assert(e.repositoryReceiptReasons.includes('WORKFLOW_NOT_COMPLETED')); assert.equal(e.oracleEvaluated, false);
});

// Exercise the production-constructor counter branch with a captured fake fetch.
// This is deliberately NOT live transport or model evidence. Restore the global
// synchronously before running; the new lane retains only this test function.
async function reportedCounterFixture(options) {
  const c = await context(options), input = { ...c.input, author: selection('author', 'CHAT_COMPLETIONS'),
    reviewer: selection('reviewer', 'CHAT_COMPLETIONS'), approval: { id: 'fixture.counter', expiresAtMs: Date.now() + 30000 } };
  const saved = globalThis.fetch;
  try {
    globalThis.fetch = async (url, request) => {
      const body = JSON.parse(request.body), role = body.model === input.author.model ? 'author' : 'reviewer';
      const content = role === 'author' ? { status: 'REPAIRED', candidate: { files: c.fixture.preparations[1].candidate.files }, note: 'Fixture' }
        : { findings: [], summary: 'Fixture' };
      const envelope = { model: body.model, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }],
        usage: { prompt_tokens: role === 'author' ? 40 : 30, completion_tokens: role === 'author' ? 10 : 5, total_tokens: role === 'author' ? 50 : 35 } };
      const call = { role, envelope }; c.requests.push(call);
      return options?.onRequest ? options.onRequest(call) : reply(envelope);
    };
    return { ...c, input, lane: createReviewedLiveModelLaneV3(input) };
  } finally { globalThis.fetch = saved; }
}
for (const missing of [false, true]) test(`reported-counter mapping keeps coverage and excludes seeded draft; missing=${missing}`, async t => {
  const c = await repositoryLiveContext(t, { contextFactory: reportedCounterFixture, onRequest(call) {
    if (missing && call.role === 'reviewer') delete call.envelope.usage; return reply(call.envelope);
  } });
  const wrapper = start({ host: c.host, lane: c.lane, binding: binding(c.lane) }), result = await wrapper.operation.result;
  await wrapper.operation.settled; const e = evidence(wrapper);
  assert.equal(e.usage.sourceKind, 'VALIDATED_REPORTED_COUNTERS'); assert.equal(result.modelCalls, 2); assert.equal(c.requests.length, 2);
  assert.equal(result.repairAttempts, 1); assert.equal(result.durationMs, null); assert.equal(e.measurementVerified, false);
  if (missing) { assert.equal(result.tokenUsage, null); assert.equal(e.usage.reported.unknownCalls, 1); assert.equal(e.usage.reported.knownSubtotal.totalTokens, 50); }
  else assert.deepEqual({ ...result.tokenUsage }, { input: 70, output: 15 });
});

test('different original report and collection channels refuse projection rather than accepting cloned reports', async t => {
  const c = await create(t);
  const host = { run: async options => structuredClone(await c.host.run(options)), settled: () => c.host.settled(), status: () => c.host.status() };
  const wrapper = start({ host, lane: c.lane, binding: binding(c.lane) });
  await assert.rejects(wrapper.operation.result, { code: 'TRIAL_PROJECTION_REPORT_CHANNEL' }); await wrapper.operation.settled;
  assert.equal(wrapper.inspectProjection().state, 'UNAVAILABLE'); assert.equal(wrapper.inspectProjection().evidence, null);
});

test('unavailable model response remains an adverse operation with no published projection', async t => {
  const c = await create(t, { onRequest(call) { call.envelope.model_instance_id = 'wrong.instance'; return reply(call.envelope); } });
  const wrapper = start({ host: c.host, lane: c.lane, binding: binding(c.lane) });
  await assert.rejects(wrapper.operation.result, { code: 'TRIAL_PROJECTION_OWNER_UNCONFIRMED' });
  // Invalid output and cleanup are separate outcomes: this completed response
  // stopped its lane without leaving a pending transport or recovery hold.
  await wrapper.operation.settled;
  assert.equal(wrapper.inspectProjection().state, 'UNAVAILABLE'); assert.equal(wrapper.inspectProjection().evidence, null);
  assert.equal(c.requests.length, 1); assert.equal(wrapper.operation.status(), 'IDLE');
  assert.equal(c.lane.snapshot().lifecycle.pendingTransports, 0);
  assert.equal(c.lane.snapshot().lifecycle.recoveryRequired, false);
});

test('cancellation in projection publication gap discards sidecar as well as outward candidate', async t => {
  const c = await create(t); let wrapper;
  const host = { run: options => c.host.run(options), settled: () => c.host.settled(), status() {
    if (c.lane.snapshot().revoked) queueMicrotask(() => wrapper.operation.cancel());
    return c.host.status();
  } };
  wrapper = start({ host, lane: c.lane, binding: binding(c.lane) });
  await assert.rejects(wrapper.operation.result, { code: 'TRIAL_OPERATION_CANCELLED' }); await wrapper.operation.settled;
  assert.equal(wrapper.inspectProjection().state, 'UNAVAILABLE'); assert.equal(wrapper.inspectProjection().evidence, null);
});

test('pending cancelled transport cannot publish late candidate or projection', async t => {
  const started = deferred(), response = deferred();
  const c = await create(t, { onRequest(call) { started.resolve(call); return response.promise; } });
  const wrapper = start({ host: c.host, lane: c.lane, binding: binding(c.lane) }), call = await started.promise;
  try { wrapper.operation.cancel(); await tick(); assert.equal(wrapper.inspectProjection().state, 'PENDING'); }
  finally { response.resolve(reply(call.envelope)); }
  await assert.rejects(wrapper.operation.result); await assert.rejects(wrapper.operation.settled);
  assert.equal(wrapper.inspectProjection().state, 'UNAVAILABLE'); assert.equal(wrapper.inspectProjection().evidence, null);
});

test('real paired runner counts an engine completion rejected by the independent test oracle', async t => {
  const c = await create(t), declared = describe(c.lane), { plan, profile } = pairedTrialFixtureInputs(), events = [];
  plan.tasks[0].taskSha256 = declared.taskSha256; plan.tasks[0].baselineSha256 = declared.baselineSha256;
  profile.planSha256 = readPreventionExperimentPlanV1(plan).planSha256;
  profile.model = declared.model; profile.modelSettingsSha256 = declared.modelSettingsSha256;
  let wrapper, oracleCalls = 0;
  const runner = createPairedTrialRunnerV1({ plan, profile, host: {
    retain: async event => { events.push(event); }, verifyInputs: () => true,
    startExecutor(intent) {
      wrapper = start({ host: c.host, lane: c.lane, binding: { ...binding(c.lane), requestId: intent.requestId, profileSha256: intent.profileSha256 } });
      return wrapper.operation;
    },
    startOracle(request) {
      oracleCalls++; const decoded = decodeRepositoryTrialCandidateV1(request.candidateText, request.candidateSha256);
      assert.equal(decoded.candidateFingerprint, c.fixture.preparations[1].candidateFingerprint);
      return { result: Promise.resolve({ requestId: request.requestId, oracleSha256: request.oracleSha256,
        oracleCandidateSha256: request.candidateSha256, outcome: 'FAIL' }), settled: Promise.resolve(), status: () => 'IDLE', cancel() {} };
    },
  } });
  const report = await runner.run();
  assert.equal(report.stopReason, 'RUNNER_REPORTED_BUDGET_UNCONFIRMED'); // Synthetic usage is not converted to zero to run more trials.
  assert.equal(report.counts.completed, 1); assert.equal(report.counts.claims, 1); assert.equal(report.counts.incorrectClaims, 1);
  assert.equal(report.counts.oracleFail, 1); assert.equal(report.counts.notStarted, 3); assert.equal(oracleCalls, 1);
  assert.equal(report.authorizing, false); assert.equal(events.at(-1).type, 'FINAL'); evidence(wrapper);
});

for (const adverse of ['expired approval', 'wrong model instance', 'host settlement rejection'])
test(`paired runner retains adverse execution and original diagnostics without oracle: ${adverse}`, async t => {
  const c = await create(t, adverse === 'expired approval' ? { configure(i) { i.approval.expiresAtMs = 1; } }
    : adverse === 'wrong model instance' ? { onRequest(call) { call.envelope.model_instance_id = 'wrong.instance'; return reply(call.envelope); } } : {});
  let host = c.host;
  if (adverse === 'host settlement rejection') {
    const unavailable = () => { throw Object.assign(Error('Fixture owner failure'), { code: 'FIXTURE_OWNER_FAILED' }); };
    const owner = { settled: async () => [], observations: () => [], status: () => 'IDLE', lateObservations: () => [] };
    host = createRepositoryWorkflowOwnerV1({ suite: c.fixture.suite,
      staticOwner: { ...owner, check: unavailable, settled: async () => unavailable(), status: () => 'QUARANTINED' },
      testsOwner: { ...owner, registrationFingerprint: 'a'.repeat(64), run() { assert.fail('must not run after static owner failure'); } } });
  }
  const declared = describe(c.lane), { plan, profile } = pairedTrialFixtureInputs(), events = [];
  plan.tasks[0].taskSha256 = declared.taskSha256; plan.tasks[0].baselineSha256 = declared.baselineSha256;
  profile.planSha256 = readPreventionExperimentPlanV1(plan).planSha256;
  profile.model = declared.model; profile.modelSettingsSha256 = declared.modelSettingsSha256;
  let wrapper, oracleCalls = 0;
  const runner = createPairedTrialRunnerV1({ plan, profile, host: {
    retain: async event => { events.push(event); }, verifyInputs: () => true,
    startExecutor(intent) {
      wrapper = start({ host, lane: c.lane, binding: { ...binding(c.lane), requestId: intent.requestId, profileSha256: intent.profileSha256 } });
      return wrapper.operation;
    },
    startOracle() { oracleCalls++; assert.fail('unpublishable output must not reach oracle'); },
  } });
  const report = await runner.run(), collected = await host.settled(), snapshot = c.lane.snapshot();
  assert.equal(report.status, 'STOPPED'); assert.equal(report.stopReason, 'RUNNER_RESULT_UNCONFIRMED');
  assert.equal(report.records[0].status, 'ERROR'); assert.equal(report.records[0].executor, null);
  assert.equal(report.counts.executorStarted, 1); assert.equal(report.counts.completed, 0); assert.equal(report.counts.notStarted, 3);
  assert.equal(report.counts.claims, 0); assert.equal(report.counts.missingCompletionClaim, 1);
  assert.equal(report.counts.oracleStarted, 0); assert.equal(oracleCalls, 0);
  assert.equal(events.at(-1).type, 'FINAL'); assert.equal(events.some(e => e.type === 'PHASE_RESULT'), false);
  assert.equal(wrapper.inspectProjection().state, 'UNAVAILABLE'); assert.equal(wrapper.inspectProjection().evidence, null);
  // The original owners keep diagnostics; absence of a candidate projection
  // never substitutes zero usage for attempted/unavailable work.
  for (const counter of Object.values(report.usage)) { assert.equal(counter.unknown, true); assert.equal(counter.knownSubtotal, '0'); }
  assert.equal(report.reportedBudgetStatus, 'UNKNOWN'); assert.equal(report.authorizing, false);
  if (adverse === 'expired approval') {
    assert.equal(collected.report.candidate, null); assert.equal(c.requests.length, 0);
    assert.equal(collected.state, 'QUARANTINED'); assert.equal(report.drain.status, 'UNCONFIRMED');
  } else if (adverse === 'host settlement rejection') {
    assert.equal(collected.settlementErrors[0].code, 'FIXTURE_OWNER_FAILED'); assert.equal(c.requests.length, 0);
    assert.equal(collected.state, 'QUARANTINED'); assert.equal(report.drain.status, 'UNCONFIRMED');
  } else {
    assert.equal(snapshot.authorReceipts.length, 1); assert.equal(snapshot.authorReceipts[0].status, 'UNAVAILABLE');
    assert.equal(snapshot.reviewerReceipts.length, 0); assert.equal(c.requests.length, 1);
    assert.equal(collected.state, 'SETTLED'); assert.equal(report.drain.status, 'OFF');
  }
});
