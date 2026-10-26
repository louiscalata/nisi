// Deterministic test-only host; no models, network, generated code or processes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createPairedTrialRunnerV1 } from '../../evaluation/paired-trial-runner-v1.mjs';
import { readPreventionExperimentPlanV1 } from '../../evaluation/prevention-experiment-plan-v1.mjs';
import { createPairedTrialEventStoreV1 } from '../../history/paired-trial-event-store-v1.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const operation = result => ({ result: Promise.resolve(result), settled: Promise.resolve(), status: () => 'IDLE', cancel() {} });

export function pairedTrialFixtureInputs() {
  const plan = {
    schemaVersion: 'nisi-prevention-experiment-plan-v1', planId: 'plan.cli-fixture',
    policy: { version: 'policy.v1', sha256: hash('policy'), influenceEnabled: false },
    proposer: 'fixture.author', acceptanceReviewer: 'fixture.reviewer', trainingDigests: [],
    tasks: [{ caseId: 'case.one', taskSha256: hash('task'), baselineSha256: hash('baseline'),
      oracleSha256: hash('oracle'), armOrder: ['OFF_ON', 'ON_OFF'] }], repetitions: 2, exclusions: [],
    budget: { maxDurationMs: 30000, maxModelCalls: 100, maxInputTokens: 1000, maxOutputTokens: 1000 },
    measuredTelemetry: 'UNKNOWN_UNTIL_RUN',
  };
  const profile = { schemaVersion: 'nisi-prevention-execution-profile-v1',
    planSha256: readPreventionExperimentPlanV1(plan).planSha256, model: 'fixed-test-host',
    modelSettingsSha256: hash('settings'), toolchainSha256: hash('node'), resourceBudgetSha256: hash('budget'),
    trialPolicy: { version: plan.policy.version, sha256: plan.policy.sha256 },
    executorTimeoutMs: 1000, oracleTimeoutMs: 1000, retentionTimeoutMs: 1000, drainTimeoutMs: 10 };
  return { plan, profile };
}

export async function pairedTrialFixtureEvents({ unknownUsage = false } = {}) {
  const events = [], { plan, profile } = pairedTrialFixtureInputs();
  const candidateText = 'PRIVATE_CANDIDATE_NOT_FOR_DISPLAY';
  const runner = createPairedTrialRunnerV1({ plan, profile, host: {
    retain: async event => { events.push(event); }, verifyInputs: () => true,
    startExecutor: intent => operation({ requestId: intent.requestId, profileSha256: intent.profileSha256,
      candidateText, candidateSha256: hash(candidateText), completionClaim: true,
      tokenUsage: unknownUsage ? null : { input: 0, output: 0 }, modelCalls: 0, durationMs: null, repairAttempts: 0 }),
    startOracle: request => operation({ requestId: request.requestId, oracleSha256: request.oracleSha256,
      oracleCandidateSha256: request.candidateSha256, outcome: 'FAIL' }),
  } });
  const result = await runner.run();
  assert.equal(result.status, unknownUsage ? 'STOPPED' : 'COMPLETE');
  assert.equal(events[0].type, 'SCHEDULE'); assert.equal(events.at(-1).type, 'FINAL');
  return structuredClone(events);
}

export async function retainPairedTrialFixture(parentDirectory, events) {
  const store = createPairedTrialEventStoreV1({ parentDirectory });
  try { for (const event of events) await store.retain(event); }
  finally { store.close(); }
  return store.inspect();
}
