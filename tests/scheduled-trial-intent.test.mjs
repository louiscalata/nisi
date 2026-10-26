// Scheduled intent issuance reader: original in-memory identities only.
// No model, network, native, process, or scheduler execution occurs here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createPairedTrialRunnerV1, readScheduledPairedTrialIntentV1 } from '../evaluation/paired-trial-runner-v1.mjs';
import { readPreventionExperimentPlanV1 } from '../evaluation/prevention-experiment-plan-v1.mjs';
import { readPreventionExecutionProfileV1 } from '../evaluation/prevention-execution-profile-v1.mjs';
import { pairedTrialFixtureInputs } from './helpers/paired-trial-fixture.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const candidateText = 'SCHEDULED_INTENT_FIXTURE_CANDIDATE';
const candidateSha256 = hash(candidateText);
const operation = result => ({ result: Promise.resolve(result), settled: Promise.resolve(), status: () => 'IDLE', cancel() {} });

function canonicalInputs() {
  const { plan: rawPlan, profile: rawProfile } = pairedTrialFixtureInputs();
  const plan = readPreventionExperimentPlanV1(rawPlan);
  const profile = readPreventionExecutionProfileV1(rawProfile, plan.planSha256, plan.policy);
  return { rawPlan, rawProfile, plan, profile };
}

function hostFor(plan, profile, { retained = [], seen = [], accept = true } = {}) {
  return {
    async retain(event) { retained.push(event); },
    verifyInputs(intent) { seen.push(intent); return accept; },
    startExecutor(intent) {
      return operation({ requestId: intent.requestId, profileSha256: intent.profileSha256,
        candidateText, candidateSha256, completionClaim: false,
        tokenUsage: { input: 1, output: 1 }, durationMs: 1, repairAttempts: 0, modelCalls: 1 });
    },
    startOracle(request) {
      return operation({ requestId: request.requestId, oracleSha256: request.oracleSha256,
        oracleCandidateSha256: request.candidateSha256, outcome: 'PASS' });
    },
  };
}

function uniqueIntents(seen) {
  return [...new Map(seen.map(intent => [intent.requestId, intent])).values()];
}

function assertUnissued(value) {
  assert.throws(() => readScheduledPairedTrialIntentV1(value), { code: 'RUNNER_INTENT_NOT_ISSUED' });
}

test('original scheduled intents expose frozen canonical plan/profile and no authority', async () => {
  const { rawPlan, rawProfile, plan, profile } = canonicalInputs();
  const seen = [], retained = [];
  const runner = createPairedTrialRunnerV1({ plan: rawPlan, profile: rawProfile,
    host: hostFor(plan, profile, { seen, retained }) });
  const report = await runner.run();
  assert.equal(report.status, 'COMPLETE');

  const intents = uniqueIntents(seen);
  assert.equal(intents.length, 4);
  for (const intent of intents) {
    const decoded = readScheduledPairedTrialIntentV1(intent);
    assert.strictEqual(decoded.intent, intent);
    assert.deepEqual(decoded.plan, plan);
    assert.deepEqual(decoded.profile, profile);
    for (const value of [decoded, decoded.intent, decoded.plan, decoded.plan.policy,
      decoded.plan.tasks, decoded.plan.tasks[0], decoded.profile, decoded.profile.trialPolicy])
      assert.equal(Object.isFrozen(value), true);

    const expectedRequestId = hash(JSON.stringify([intent.runnerId, intent.planSha256, intent.profileSha256,
      intent.caseId, intent.repetition, intent.arm]));
    assert.equal(intent.requestId, expectedRequestId);
    assert.equal(intent.planSha256, plan.planSha256);
    assert.equal(intent.profileSha256, profile.profileSha256);
    assert.equal(intent.taskSha256, plan.tasks[0].taskSha256);
    assert.equal(intent.baselineSha256, plan.tasks[0].baselineSha256);
    assert.equal(intent.oracleSha256, plan.tasks[0].oracleSha256);
    assert.equal(intent.model, profile.model);
    assert.equal(intent.modelSettingsSha256, profile.modelSettingsSha256);
    for (const key of ['authorizing', 'executionAttested', 'modelUseAttested',
      'providerDeliveryAttested', 'promotionEligible', 'measurementVerified', 'causalClaim'])
      assert.equal(Object.hasOwn(intent, key), false, `intent must not grant ${key}`);
  }
});

test('spread, structured, serialized, inspected, and retained schedule copies are unissued', async () => {
  const { rawPlan, rawProfile, plan, profile } = canonicalInputs();
  const seen = [], retained = [];
  const runner = createPairedTrialRunnerV1({ plan: rawPlan, profile: rawProfile,
    host: hostFor(plan, profile, { seen, retained }) });
  await runner.run();
  const original = uniqueIntents(seen)[0];
  const decoded = readScheduledPairedTrialIntentV1(original);

  assertUnissued({ ...original });
  assertUnissued(structuredClone(original));
  assertUnissued(JSON.parse(JSON.stringify(original)));
  assertUnissued({ ...decoded.intent });
  assertUnissued(runner.inspect().records[0].intent);
  const scheduled = retained.find(event => event.type === 'SCHEDULE');
  assert(scheduled);
  assertUnissued(scheduled.intents[0]);
});

test('reconstructed intent with matching fields is still refused and original identities are run-scoped', async () => {
  const aInputs = canonicalInputs(), bInputs = canonicalInputs();
  const aSeen = [], bSeen = [];
  const a = createPairedTrialRunnerV1({ plan: aInputs.rawPlan, profile: aInputs.rawProfile,
    host: hostFor(aInputs.plan, aInputs.profile, { seen: aSeen }) });
  const b = createPairedTrialRunnerV1({ plan: bInputs.rawPlan, profile: bInputs.rawProfile,
    host: hostFor(bInputs.plan, bInputs.profile, { seen: bSeen }) });
  await a.run(); await b.run();
  const first = uniqueIntents(aSeen)[0], second = uniqueIntents(bSeen)[0];
  assert.notStrictEqual(first, second);
  assert.notEqual(first.runnerId, second.runnerId);
  assert.notEqual(first.requestId, second.requestId);
  assert.deepEqual(readScheduledPairedTrialIntentV1(first).plan, aInputs.plan);
  assert.deepEqual(readScheduledPairedTrialIntentV1(second).profile, bInputs.profile);
  assertUnissued({ ...first, runnerId: second.runnerId });
  assertUnissued({ ...second, requestId: first.requestId });
});

test('an unconfirmed host callback does not turn an unissued copy into an authorized intent', async () => {
  const { rawPlan, rawProfile, plan, profile } = canonicalInputs();
  const seen = [];
  const runner = createPairedTrialRunnerV1({ plan: rawPlan, profile: rawProfile,
    host: hostFor(plan, profile, { seen, accept: false }) });
  const report = await runner.run();
  assert.equal(report.status, 'STOPPED');
  const original = seen[0];
  assert.strictEqual(readScheduledPairedTrialIntentV1(original).intent, original);
  assertUnissued({ ...original });
});
