// Synthetic repository projection only. The runner captures an issued intent,
// then the reviewed V4 fixture is run through its existing source-reviewed path.
// This suite does not add an execution API or call a model/provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describeRepositoryTrialInputsV2, checkRepositoryTrialIntentV2,
  projectRepositoryTrialV2 } from '../hosts/repository/paired-trial-projection-v2.mjs';
import { readPreventionExperimentPlanV1 } from '../evaluation/prevention-experiment-plan-v1.mjs';
import { readPreventionExecutionProfileV1 } from '../evaluation/prevention-execution-profile-v1.mjs';
import { createPairedTrialRunnerV1 } from '../evaluation/paired-trial-runner-v1.mjs';
import { createRepositoryLiveModelRunV4 } from '../receipts/repository-live-model-run-v4.mjs';
import { stableStringify } from '../workflow/contracts.mjs';
import { repositoryLiveContext } from './helpers/repository-live-run-fixture.mjs';
import { context } from './helpers/live-model-v4-fixture.mjs';
import { context as contextV3 } from './helpers/live-model-v3-fixture.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const protocols = ['CHAT_COMPLETIONS', 'NATIVE_API'];
const operation = result => ({ result: Promise.resolve(result), settled: Promise.resolve(), status: () => 'IDLE', cancel() {} });

function runnerInputs(description, arm) {
  const policy = description.configuration.policy;
  const rawPlan = {
    schemaVersion: 'nisi-prevention-experiment-plan-v1', planId: 'plan.repository-projection-fixture',
    policy: { version: policy.version, sha256: policy.sha256, influenceEnabled: false },
    proposer: 'fixture.author', acceptanceReviewer: 'fixture.reviewer', trainingDigests: [],
    tasks: [{ caseId: 'repository.projection', taskSha256: description.taskSha256,
      baselineSha256: description.baselineSha256, oracleSha256: hash('projection-oracle'),
      armOrder: arm === 'ON' ? ['ON_OFF', 'OFF_ON'] : ['OFF_ON', 'ON_OFF'] }],
    repetitions: 2, exclusions: [],
    budget: { maxDurationMs: 30000, maxModelCalls: 100, maxInputTokens: 1000, maxOutputTokens: 1000 },
    measuredTelemetry: 'UNKNOWN_UNTIL_RUN',
  };
  const plan = readPreventionExperimentPlanV1(rawPlan);
  const rawProfile = {
    schemaVersion: 'nisi-prevention-execution-profile-v1', planSha256: plan.planSha256,
    model: description.model, modelSettingsSha256: description.modelSettingsSha256,
    toolchainSha256: hash('projection-toolchain'), resourceBudgetSha256: hash('projection-budget'),
    trialPolicy: { version: policy.version, sha256: policy.sha256 },
    executorTimeoutMs: 1000, oracleTimeoutMs: 1000, retentionTimeoutMs: 1000, drainTimeoutMs: 10,
  };
  const profile = readPreventionExecutionProfileV1(rawProfile, plan.planSha256, plan.policy);
  return { rawPlan, rawProfile, plan, profile };
}

async function captureIssuedIntent(description, arm) {
  const { rawPlan, rawProfile, plan, profile } = runnerInputs(description, arm);
  const seen = [];
  const runner = createPairedTrialRunnerV1({ plan: rawPlan, profile: rawProfile, host: {
    retain: async () => {}, verifyInputs(intent) { seen.push(intent); return false; },
    startExecutor: intent => operation({ requestId: intent.requestId, profileSha256: intent.profileSha256,
      candidateText: 'unused', candidateSha256: hash('unused'), completionClaim: false,
      tokenUsage: { input: 1, output: 1 }, durationMs: 1, repairAttempts: 0, modelCalls: 1 }),
    startOracle: request => operation({ requestId: request.requestId, oracleSha256: request.oracleSha256,
      oracleCandidateSha256: request.candidateSha256, outcome: 'PASS' }),
  } });
  const report = await runner.run();
  assert.equal(report.status, 'STOPPED');
  assert.equal(seen.length, 1);
  return { intent: seen[0], plan, profile };
}

function assertProjectionIdentity(projection, description, intent, variant) {
  assert.equal(projection.evidence.schemaVersion, 'nisi-repository-trial-projection-v2');
  assert.equal(projection.evidence.inputs.model, description.model);
  assert.equal(projection.evidence.inputs.modelSettingsSha256, description.modelSettingsSha256);
  assert.equal(projection.evidence.inputs.taskSha256, description.taskSha256);
  assert.equal(projection.evidence.inputs.baselineSha256, description.baselineSha256);
  assert.equal(projection.evidence.inputs.arm, intent.arm);
  assert.equal(projection.evidence.intent.requestId, intent.requestId);
  assert.equal(projection.evidence.oracleEvaluated, false);
  assert.equal(projection.evidence.modelAuthenticityAttested, false);
  assert.equal(projection.evidence.executionAttested, false);
  assert.equal(projection.evidence.measurementVerified, false);
  assert.equal(projection.evidence.causalClaim, false);
  assert.equal(projection.evidence.authorizing, false);
  assert.equal(projection.evidence.promotionEligible, false);
  assert.equal(projection.evidence.resumable, false);
  assert.equal(projection.evidence.usage.projectedTokens, null);
  assert.equal(projection.evidence.usage.projectedModelCalls, null);
  assert.equal(projection.executor.tokenUsage, null);
  assert.equal(projection.executor.modelCalls, null);
  assert.equal(projection.executor.candidateSha256, projection.evidence.candidate.candidateSha256);
  assert.equal(Buffer.byteLength(projection.executor.candidateText), projection.evidence.candidate.byteLength);
  assert.equal(projection.executor.repairAttempts, 1);
  if (variant === 'repair') assert.equal(projection.evidence.completionClaim, true);
  else assert.equal(projection.evidence.completionClaim, false);
}

for (const api of protocols) for (const arm of ['OFF', 'ON'])
  for (const variant of ['repair', 'baseline', 'no-change'])
    test(`V2 projection ${api}/${arm}/${variant}`, async t => {
      const c = await repositoryLiveContext(t, { contextFactory: context, api, reviewerApi: api, arm, variant });
      const description = describeRepositoryTrialInputsV2(c.lane);
      const before = stableStringify(description);
      const { intent } = await captureIssuedIntent(description, arm);
      const result = await c.run();
      assert.equal(stableStringify(describeRepositoryTrialInputsV2(c.lane)), before);
      assert.equal(stableStringify(describeRepositoryTrialInputsV2(c.lane)), stableStringify(description));
      const receipt = createRepositoryLiveModelRunV4({ lane: c.lane, hostResult: result.hostResult });
      assert.equal(receipt.usage.calls, variant === 'repair' ? 2 : 1);
      assert.equal(receipt.lane.reviewerReceipts.length, variant === 'repair' ? 1 : 0);
      const projection = projectRepositoryTrialV2({ report: result.hostResult.report, hostResult: result.hostResult,
        lane: c.lane, intent, description });
      assertProjectionIdentity(projection, description, intent, variant);
      assert.equal(projection.evidence.candidate.candidateFingerprint,
        c.fixture.preparations[variant === 'repair' ? 1 : 0].candidateFingerprint);
      assert.equal(projection.evidence.treatment.arm, arm);
      assert.equal(projection.evidence.treatment.modelUseAttested, false);
      assert.equal(projection.evidence.usage.sourceKind, 'SYNTHETIC_FIXTURE');
      assert.equal(projection.evidence.usage.completeInventory, true);
      assert.equal(projection.evidence.usage.reported.calls, variant === 'repair' ? 2 : 1);
      assert.equal(projection.evidence.usage.durationMs, null);
      if (variant === 'repair') {
        assert.equal(projection.evidence.repositoryReceiptStatus, 'SYNTHETIC_CONTRACT_PASS');
        assert.equal(projection.evidence.engineOutcome, 'COMPLETED');
        assert.equal(projection.evidence.treatment.requestInspection, 'CONSISTENT');
      } else {
        assert.equal(projection.evidence.repositoryReceiptStatus, 'CONSISTENT_NO_PROGRESS');
        assert.equal(projection.evidence.engineOutcome, 'NO_PROGRESS');
        assert.equal(projection.evidence.treatment.requestInspection, 'CONSISTENT');
      }
    });

for (const api of protocols) test(`V2 OFF and ON common settings are equal while treatment identity differs: ${api}`, async t => {
  const off = await repositoryLiveContext(t, { contextFactory: context, api, reviewerApi: api, arm: 'OFF' });
  const on = await repositoryLiveContext(t, { contextFactory: context, api, reviewerApi: api, arm: 'ON' });
  const a = describeRepositoryTrialInputsV2(off.lane), b = describeRepositoryTrialInputsV2(on.lane);
  assert.deepEqual(a.configuration, b.configuration);
  assert.equal(a.model, b.model); assert.equal(a.modelSettingsSha256, b.modelSettingsSha256);
  assert.equal(a.guidancePolicySha256, b.guidancePolicySha256);
  assert.equal(a.arm, 'OFF'); assert.equal(b.arm, 'ON');
  assert.notEqual(a.treatmentFingerprint, b.treatmentFingerprint);
});

test('V2 arbitrary copied intent is refused before projection', async t => {
  const c = await repositoryLiveContext(t, { contextFactory: context, api: 'CHAT_COMPLETIONS', reviewerApi: 'CHAT_COMPLETIONS', arm: 'ON' });
  const description = describeRepositoryTrialInputsV2(c.lane), { intent } = await captureIssuedIntent(description, 'ON');
  assert.throws(() => checkRepositoryTrialIntentV2({ ...intent }, c.lane), { code: 'RUNNER_INTENT_NOT_ISSUED' });
});

for (const [field, change] of [
  ['reviewedSourceFingerprint', value => '0'.repeat(64)],
  ['model', value => value + '.wrong'],
  ['modelSettingsSha256', value => '0'.repeat(64)],
  ['guidancePolicySha256', value => '0'.repeat(64)],
  ['arm', value => value === 'ON' ? 'OFF' : 'ON'],
]) test(`V2 refuses changed ${field} description`, async t => {
  const c = await repositoryLiveContext(t, { contextFactory: context, api: 'NATIVE_API', reviewerApi: 'NATIVE_API', arm: 'ON', variant: 'repair' });
  const description = describeRepositoryTrialInputsV2(c.lane), { intent } = await captureIssuedIntent(description, 'ON');
  const result = await c.run();
  const changed = structuredClone(description); changed[field] = change(changed[field]);
  assert.throws(() => projectRepositoryTrialV2({ report: result.hostResult.report, hostResult: result.hostResult,
    lane: c.lane, intent, description: changed }), { code: 'TRIAL_V2_CONFIGURATION_CHANGED' });
});

test('V2 rejects a V3 lane and a cloned report channel', async t => {
  const legacy = await contextV3();
  assert.throws(() => describeRepositoryTrialInputsV2(legacy.lane), { code: 'LIVE_LANE_NOT_ISSUED' });
  const c = await repositoryLiveContext(t, { contextFactory: context, api: 'CHAT_COMPLETIONS', reviewerApi: 'CHAT_COMPLETIONS', arm: 'OFF' });
  const description = describeRepositoryTrialInputsV2(c.lane), { intent } = await captureIssuedIntent(description, 'OFF');
  const result = await c.run();
  assert.throws(() => projectRepositoryTrialV2({ report: structuredClone(result.hostResult.report), hostResult: result.hostResult,
    lane: c.lane, intent, description }), { code: 'TRIAL_V2_REPORT_CHANNEL' });
});
