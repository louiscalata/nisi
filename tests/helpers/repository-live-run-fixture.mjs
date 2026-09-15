// PRIVATE real engine and issued contract identities; all HTTP/process observations are injected.
// The only disk writes are owned temporary workspaces; no Swift or Node fixture is executed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { context as liveContext } from './reviewed-live-model-fixture.mjs';
import { syntheticNode, targetsFor } from './repository-run-fixture.mjs';
import { failing, passing } from './node-repository-fixture.mjs';
import { entry, profile } from './swift-group-fixture.mjs';
import { createSwiftCheckPlanV1 } from '../../hosts/swift-verifier/check-plan-v1.mjs';
import { createSwiftStaticGroupV1 } from '../../receipts/swift-static-group-v1.mjs';
import { createRepositoryWorkflowOwnerV1 } from '../../hosts/repository/reviewed-workflow-v1.mjs';
import { nodeTestAdapterResultV1 } from '../../hosts/repository/node-executor-v1.mjs';
import { materializeRepositoryCandidateV1, TASK_WORKSPACE_PROFILE } from '../../hosts/repository/task-workspace-v1.mjs';
import { createRepositoryRunBundleV1, readRepositoryRunBundleV1 } from '../../receipts/repository-run-v1.mjs';
import { createRepositoryProposalV1 } from '../../hosts/repository/proposed-changes-v1.mjs';

export async function repositoryLiveContext(t, options = {}) {
  const c = await (options.contextFactory ?? liveContext)(options), fixture = c.fixture;
  const build = new URL('../../.build/', import.meta.url);
  await fs.mkdir(build, { recursive: true });
  const parent = await fs.mkdtemp(new URL('live-receipt-workspaces-', build));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const workspaces = [], staticHistory = [], testHistory = [];
  const node = syntheticNode({ suite: fixture.suite, workspace: async variant => {
    const workspace = await materializeRepositoryCandidateV1({ preparation: fixture.preparations[variant], parentRoot: parent, profile: TASK_WORKSPACE_PROFILE });
    workspaces.push(workspace); return workspace;
  } });
  const observationOwner = history => ({ settled: async () => Object.freeze([...history]), observations: () => Object.freeze([...history]), status: () => 'IDLE', lateObservations: () => Object.freeze([]) });
  const staticOwner = { ...observationOwner(staticHistory), check(payload) {
    const preparation = fixture.preparations.find(p => p.candidateFingerprint === payload.binding.candidateFingerprint);
    const plan = createSwiftCheckPlanV1({ preparation, runId: payload.binding.runId, attempt: payload.binding.attempt, targets: targetsFor(preparation), executionProfile: profile });
    const group = createSwiftStaticGroupV1(plan, plan.targets.map((_, i) => entry(plan, i)));
    staticHistory.push(Object.freeze({ plan, group, error: null })); return group.adapterResult;
  } };
  const testsOwner = { ...observationOwner(testHistory), registrationFingerprint: node.executor.registrationFingerprint, async run(payload) {
    const variant = fixture.preparations[0].candidateFingerprint === payload.binding.candidateFingerprint ? 0 : 1;
    const execution = await node.execute(payload, variant, variant === 0 ? failing() : passing());
    const adapterResult = nodeTestAdapterResultV1(execution);
    testHistory.push(Object.freeze({ execution, adapterResult, preparation: fixture.preparations[variant], workspace: workspaces.at(-1), error: null }));
    return adapterResult;
  } };
  const host = createRepositoryWorkflowOwnerV1({ suite: fixture.suite, staticOwner, testsOwner });
  const run = async (workflowOptions = {}) => {
    await host.run({ authorizeContext: c.lane.authorizeContext, author: c.lane.author, reviewers: c.lane.reviewers, ...workflowOptions });
    const hostResult = await host.settled();
    return { ...c, host, hostResult, context: { lane: c.lane, hostResult }, parent, staticHistory, testHistory };
  };
  return { ...c, host, run };
}

// A fresh structurally consistent host bundle around a changed trusted report.
// Used to make lane-linkage tests discriminate beyond an obsolete outer hash.
export function rebindHostReport(c, mutate) {
  const report = structuredClone(c.hostResult.report); mutate(report);
  const preparation = c.fixture.preparations.find(p => p.candidateFingerprint === report.candidateFingerprint);
  const context = { report, preparation, suite: c.fixture.suite,
    nodeRegistrationFingerprint: c.hostResult.bundleSummary.nodeRegistrationFingerprint,
    plans: c.hostResult.staticHistory.map(h => h.plan), groups: c.hostResult.staticHistory.map(h => h.group), executions: c.hostResult.testHistory.map(h => h.execution) };
  const bundle = createRepositoryRunBundleV1(context), bundleSummary = readRepositoryRunBundleV1(bundle, context);
  return { ...c.hostResult, report, bundle, bundleSummary, proposedChanges: createRepositoryProposalV1({ preparation, report, bundleSummary }) };
}
