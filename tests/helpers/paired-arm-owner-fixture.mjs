// Synthetic HTTP/Swift/workflow-test observations with an optional REAL fixed,
// reviewed Node behavioral oracle. No model-returned source is executed.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { repositoryLiveContext } from './repository-live-run-fixture.mjs';
import { context } from './live-model-v4-fixture.mjs';
import { createReviewedRepositoryOracleV1 } from '../../examples/repository-task/reviewed-oracle-fixture-v1.mjs';
import { createRepositoryTrialOracleV1 } from '../../hosts/repository/paired-trial-oracle-v1.mjs';
import { describeRepositoryTrialInputsV2 } from '../../hosts/repository/paired-trial-projection-v2.mjs';
import { createRepositoryPairedArmOwnerV1 } from '../../hosts/repository/paired-trial-arm-owner-v1.mjs';
import { createPairedTrialRunnerV1 } from '../../evaluation/paired-trial-runner-v1.mjs';
import { readPreventionExperimentPlanV1 } from '../../evaluation/prevention-experiment-plan-v1.mjs';
import { readPreventionExecutionProfileV1 } from '../../evaluation/prevention-execution-profile-v1.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');

export async function pairedArmContext(t, options = {}) {
  const state = { now: 100, observed: [], events: [], admissions: [], reservations: [], oracle: null,
    observe: null, reserve: null, retain: null, retainAdmission: null };
  const c = await repositoryLiveContext(t, { contextFactory: context, arm: 'ON', ...options,
    now: () => state.now });
  const description = describeRepositoryTrialInputsV2(c.lane);
  const registration = await createReviewedRepositoryOracleV1();
  const parentRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nisi-arm-oracle-'));
  t.after(() => fs.rm(parentRoot, { recursive: true, force: true }));
  const policy = description.configuration.policy;
  const rawPlan = { schemaVersion: 'nisi-prevention-experiment-plan-v1', planId: 'plan.arm-fixture',
    policy: { version: policy.version, sha256: policy.sha256, influenceEnabled: false },
    proposer: 'fixture.author', acceptanceReviewer: 'fixture.reviewer', trainingDigests: [],
    tasks: [{ caseId: 'repository.arm', taskSha256: description.taskSha256,
      baselineSha256: description.baselineSha256, oracleSha256: registration.oracleSha256,
      armOrder: description.arm === 'ON' ? ['ON_OFF', 'OFF_ON'] : ['OFF_ON', 'ON_OFF'] }],
    repetitions: 2, exclusions: [], measuredTelemetry: 'UNKNOWN_UNTIL_RUN',
    budget: { maxDurationMs: 30000, maxModelCalls: 100, maxInputTokens: 1000, maxOutputTokens: 1000 } };
  const plan = readPreventionExperimentPlanV1(rawPlan);
  const rawProfile = { schemaVersion: 'nisi-prevention-execution-profile-v1', planSha256: plan.planSha256,
    model: description.model, modelSettingsSha256: description.modelSettingsSha256,
    toolchainSha256: hash('arm-fixture-toolchain'), resourceBudgetSha256: hash('arm-fixture-budget'),
    trialPolicy: { version: policy.version, sha256: policy.sha256 }, executorTimeoutMs: 10000,
    oracleTimeoutMs: 10000, retentionTimeoutMs: options.retentionTimeoutMs ?? 1000, drainTimeoutMs: 100 };
  const profile = readPreventionExecutionProfileV1(rawProfile, plan.planSha256, plan.policy);
  const approval = { id: 'synthetic.approval', ownerId: 'fixture.owner', planSha256: plan.planSha256,
    profileSha256: profile.profileSha256, expiresAtMs: 10000, priority: 'FOREGROUND' };
  function observation({ intent, now }) {
    return { consent: { id: approval.id, ownerId: approval.ownerId, planSha256: plan.planSha256,
      profileSha256: profile.profileSha256, grantedAtMs: 0, expiresAtMs: 10000, revoked: false, scope: 'execute' },
    scheduler: { decision: 'ALLOW', observedAtMs: now, freshnessMs: 1000, queueState: 'ACTIVE' },
    capacity: { configuredSlots: 1, measuredFreeSlots: 1, measuredAtMs: now, freshnessMs: 1000 },
    host: { state: 'IDLE', pendingTransports: 0, observedAtMs: now },
    custody: { taskSha256: intent.taskSha256, baselineSha256: intent.baselineSha256, oracleSha256: intent.oracleSha256,
      suiteFingerprint: description.suiteFingerprint, reviewedSourceFingerprint: description.reviewedSourceFingerprint,
      toolchainSha256: intent.toolchainSha256, resourceBudgetSha256: intent.resourceBudgetSha256,
      observedAtMs: now, freshnessMs: 1000 } };
  }
  function reserve(intent) {
    state.reservations.push(intent);
    state.oracle = createRepositoryTrialOracleV1({ registration,
      binding: { ...registration.workflow, requestId: intent.requestId, profileSha256: intent.profileSha256,
        oracleSha256: registration.oracleSha256 }, parentRoot, materializationTimeoutMs: 5000,
      totalTimeoutMs: 5000, childTimeoutMs: 3000, closeGraceMs: 500 });
    return { host: c.host, lane: c.lane, oracle: state.oracle };
  }
  const input = { plan: rawPlan, profile: rawProfile, approval, now: () => state.now,
    observe(arg) { state.observed.push(arg); return state.observe ? state.observe(arg, observation(arg)) : observation(arg); },
    reserve(intent) { return state.reserve ? state.reserve(intent, reserve) : reserve(intent); },
    async retain(event) { if (state.retain) await state.retain(event); state.events.push(event); },
    async retainAdmission(row) { if (state.retainAdmission) await state.retainAdmission(row); state.admissions.push(row); } };
  const owner = createRepositoryPairedArmOwnerV1(input);
  const makeRunner = (host = owner.host) => createPairedTrialRunnerV1({ plan: rawPlan, profile: rawProfile, host });
  return { ...c, state, description, registration, parentRoot, rawPlan, rawProfile, plan, profile, approval,
    input, owner, makeRunner, runner: makeRunner() };
}
