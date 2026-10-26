// Actual owner/runner APIs, synthetic model/process observations; no inference.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { repositoryLiveContext } from './repository-live-run-fixture.mjs';
import { context } from './live-model-v3-fixture.mjs';
import { pairedTrialFixtureInputs } from './paired-trial-fixture.mjs';
import { createPairedTrialRunnerV1 } from '../../evaluation/paired-trial-runner-v1.mjs';
import { readPreventionExperimentPlanV1 } from '../../evaluation/prevention-experiment-plan-v1.mjs';
import { createPairedTrialEventStoreV1 } from '../../history/paired-trial-event-store-v1.mjs';
import { startObservedRepositoryPairedExecutorV1 } from '../../hosts/repository/paired-trial-observer-v1.mjs';
import { describeRepositoryTrialInputsV1 } from '../../hosts/repository/paired-trial-executor-v1.mjs';
export async function observedTrial(t, options = {}) {
  const c = await repositoryLiveContext(t, { contextFactory: context, ...options }), d = describeRepositoryTrialInputsV1(c.lane);
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nisi-diagnostic-test-')));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const store = createPairedTrialEventStoreV1({ parentDirectory: parent }); t.after(() => store.close());
  const { plan, profile } = pairedTrialFixtureInputs();
  plan.tasks[0].taskSha256 = d.taskSha256; plan.tasks[0].baselineSha256 = d.baselineSha256;
  profile.planSha256 = readPreventionExperimentPlanV1(plan).planSha256;
  profile.model = d.model; profile.modelSettingsSha256 = d.modelSettingsSha256;
  let observed = null, calls = { run: 0, settled: 0, oracle: 0 };
  const original = options.hostFactory ? options.hostFactory(c) : c.host;
  const host = { run(...args) { calls.run++; return original.run(...args); },
    settled(...args) { calls.settled++; return original.settled(...args); }, status: () => original.status() };
  const runner = createPairedTrialRunnerV1({ plan, profile, host: {
    verifyInputs: () => true, retain: event => store.retain(event),
    startExecutor(intent) {
      const binding = Object.fromEntries(['model', 'modelSettingsSha256', 'taskSha256', 'baselineSha256', 'suiteFingerprint', 'reviewedSourceFingerprint'].map(key => [key, d[key]]));
      observed = startObservedRepositoryPairedExecutorV1({ host, lane: c.lane, binding: { ...binding, requestId: intent.requestId, profileSha256: intent.profileSha256 } });
      return observed.operation;
    },
    startOracle(request) { calls.oracle++; return { result: Promise.resolve({ requestId: request.requestId, oracleSha256: request.oracleSha256,
      oracleCandidateSha256: request.candidateSha256, outcome: 'FAIL' }), settled: Promise.resolve(), status: () => 'IDLE', cancel() {} }; },
  } });
  return { ...c, parent, store, runner, calls, observed: () => observed };
}
