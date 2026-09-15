// Trusted synthetic repository-host fixture for incident projection tests.
// Plans, groups, and Node receipts are issued by the existing source-reviewed
// helpers; no native process or provider is started.
import {createRepositoryWorkflowOwnerV1} from '../../hosts/repository/reviewed-workflow-v1.mjs';
import {createSwiftCheckPlanV1} from '../../hosts/swift-verifier/check-plan-v1.mjs';
import {createSwiftStaticGroupV1} from '../../receipts/swift-static-group-v1.mjs';
import {entry, profile} from './swift-group-fixture.mjs';
import {context, passing, failing} from './node-repository-fixture.mjs';
import {fixedOptions, syntheticNode, targetsFor} from './repository-run-fixture.mjs';
import {nodeTestAdapterResultV1} from '../../hosts/repository/node-executor-v1.mjs';

const ownerBase = (registrationFingerprint, method, observations, status) => ({
  registrationFingerprint, [method]: null, settled: async () => observations(), observations,
  status: () => typeof status === 'function' ? status() : status, lateObservations: () => [],
});

export async function createIncidentHostFixture(t, {quarantined = false, pending = false} = {}) {
  const c = await context(t), plans = [], groups = [], executions = [], testHistory = [], node = syntheticNode(c);
  let release, ownerState = quarantined ? 'QUARANTINED' : pending ? 'BUSY' : 'IDLE';
  const drain = pending ? new Promise(resolve => { release = resolve; }) : null;
  if (pending) t.after(() => { ownerState = 'IDLE'; release?.(); });
  const staticOwner = ownerBase('a'.repeat(64), 'check', () => plans.map((plan, i) => ({plan, group: groups[i], error: null})), () => ownerState);
  staticOwner.check = async payload => {
    const preparation = c.preparations.find(p => p.candidateFingerprint === payload.binding.candidateFingerprint);
    const plan = createSwiftCheckPlanV1({preparation, runId: payload.binding.runId, attempt: payload.binding.attempt,
      targets: targetsFor(preparation), executionProfile: profile});
    const group = createSwiftStaticGroupV1(plan, plan.targets.map((_, i) => entry(plan, i, 'PASS')));
    plans.push(plan); groups.push(group); return group.adapterResult;
  };
  if (pending) staticOwner.settled = async () => { await drain; return staticOwner.observations(); };
  const testsOwner = ownerBase(node.executor.registrationFingerprint, 'run', () => testHistory, () => ownerState);
  testsOwner.run = async payload => {
    const variant = c.preparations[0].candidateFingerprint === payload.binding.candidateFingerprint ? 0 : 1;
    const execution = await node.execute(payload, variant, variant === 0 ? failing() : passing());
    executions.push(execution); testHistory.push({execution, preparation: c.preparations[variant], error: null});
    return nodeTestAdapterResultV1(execution);
  };
  if (pending) testsOwner.settled = async () => { await drain; return testsOwner.observations(); };
  const host = createRepositoryWorkflowOwnerV1({suite: c.suite, staticOwner, testsOwner});
  return {c, host, options: fixedOptions(c), staticOwner, testsOwner, release: () => { ownerState = 'IDLE'; release?.([]); }, plans, groups, executions};
}
