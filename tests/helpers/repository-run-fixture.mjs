// Synthetic process/native observations, real engine and workspace contracts.
// No Swift or Node fixture program is executed by this helper.
import { EventEmitter } from 'node:events';
import { createCandidate, runWorkflow } from '../../workflow/engine.mjs';
import { createSwiftCheckPlanV1 } from '../../hosts/swift-verifier/check-plan-v1.mjs';
import { createSwiftStaticGroupV1 } from '../../receipts/swift-static-group-v1.mjs';
import { createNodeExecutorWithDependenciesV1, nodeTestAdapterResultV1 } from '../../hosts/repository/node-executor-v1.mjs';
import { prepareRepositoryCandidate } from '../../hosts/repository/snapshot-contract.mjs';
import { registerReviewedNodeSuiteV1 } from '../../hosts/repository/node-suite-v1.mjs';
import { materializeRepositoryCandidateV1, TASK_WORKSPACE_PROFILE } from '../../hosts/repository/task-workspace-v1.mjs';
import { context, passing, failing, wire } from './node-repository-fixture.mjs';
import { entry, profile } from './swift-group-fixture.mjs';

export function fixedOptions(c) {
  const make = n => ({ files: c.preparations[n].candidate.files.map(({ path, content }) => ({ path, content })) });
  return {
    authorizeContext: { authorize: p => ({ status: 'PASS', evidence: { ...p.binding, reason: '' } }) },
    author: { id: 'author.fixed-fixture', draft: p => ({ candidate: make(0), evidence: { ...p.binding,
      candidateFingerprint: c.preparations[0].candidateFingerprint, note: 'Inspected fixed fixture baseline' } }),
    repair: p => ({ status: 'REPAIRED', candidate: make(1), evidence: { ...p.binding,
      baseCandidateFingerprint: p.binding.candidateFingerprint, candidateFingerprint: c.preparations[1].candidateFingerprint,
      note: 'Inspected fixed fixture repair' } }) },
    reviewers: [{ id: 'reviewer.fixed-fixture', review: p => ({ status: 'PASS', evidence: { ...p.binding,
      reviewerId: 'reviewer.fixed-fixture', findings: [], summary: 'Fixed callback, not independent model review', reason: '' } }) }],
  };
}
export const targetsFor = p => p.materialized.files.map(f => ({ path: f.path, profileId:
  f.path.endsWith('.json') ? 'nisi-json-structure-v1' : f.path.endsWith('.md') ? 'nisi-markdown-sections-v1' : 'nisi-text-structure-v1' }));
export function syntheticNode(c, { outerFailure = false, totalTimeoutMs = 1000 } = {}) {
  let current = passing(), clock = 0, observations = 0;
  const runtime = { path: '/synthetic/node', sha256: 'a'.repeat(64), ino: '1' };
  const executor = createNodeExecutorWithDependenciesV1({ suite: c.suite, totalTimeoutMs, childTimeoutMs: 500, closeGraceMs: 10 }, {
    now: () => clock, observeExecutable: () => { if (outerFailure && ++observations === 3) clock = 1000; return runtime; },
    spawnChild: () => {
      const child = new EventEmitter();
      for (const k of ['stdout', 'stderr', 'stdin']) child[k] = new EventEmitter();
      child.exitCode = null; child.signalCode = null; child.kill = () => true; child.stdin.end = () => {};
      queueMicrotask(() => { child.emit('spawn'); child.stdout.emit('data', wire(current));
        child.exitCode = 0; child.emit('exit', 0, null); child.emit('close', 0, null); });
      return child;
    },
  });
  return { executor, async execute(payload, variant, quality = passing()) {
    current = quality;
    return executor.execute({ workspace: await c.workspace(variant), runId: payload.binding.runId, attempt: payload.binding.attempt });
  } };
}
export async function combinedFixture(t, { skipFirst = false, interrupt = null, outerFailure = false, storageFailure = false, staticOnly = false } = {}) {
  const c = await context(t, { repairBudget: staticOnly ? 0 : 1 }), plans = [], groups = [], executions = [];
  if (storageFailure) {
    c.task = { ...c.task, policy: { ...c.task.policy, requireReportStore: true } };
    c.preparations = c.preparations.map(p => prepareRepositoryCandidate({ baseline: c.baseline, task: c.task,
      candidate: { files: p.candidate.files }, authorId: p.candidate.authorId }));
    c.suite = registerReviewedNodeSuiteV1({ ...c.registration, preparations: c.preparations });
    c.workspace = n => materializeRepositoryCandidateV1({ preparation: c.preparations[n], parentRoot: c.parent, profile: TASK_WORKSPACE_PROFILE });
  }
  const node = syntheticNode(c, { outerFailure });
  let clock = 0; const controller = new AbortController(), options = fixedOptions(c);
  // Review the registered repaired candidate for interruption/host/store cases;
  // ordinary edit cases exercise baseline + repair without invoking a model.
  if (interrupt || outerFailure || storageFailure) options.author.draft = p => {
    const candidate = createCandidate({ files: c.preparations[1].candidate.files }, { authorId: 'author.fixed-fixture' });
    return { candidate: { files: candidate.files }, evidence: { ...p.binding, candidateFingerprint: candidate.fingerprint, note: 'Fixed repaired input' } };
  };
  const report = await runWorkflow(c.task, { clock: () => clock, signal: controller.signal,
    ...(storageFailure ? { reportStore: { store: () => { throw new Error('synthetic store'); } } } : {}),
    adapters: { ...options, staticChecks: { check: p => {
      const prep = c.preparations.find(prep => prep.candidateFingerprint === p.binding.candidateFingerprint);
      const plan = createSwiftCheckPlanV1({ preparation: prep, runId: p.binding.runId, attempt: p.binding.attempt,
        targets: targetsFor(prep), executionProfile: profile });
      const group = createSwiftStaticGroupV1(plan, plan.targets.map((_, i) => entry(plan, i, (skipFirst || staticOnly) && p.binding.attempt === 0 && i === 0 ? 'FAIL' : 'PASS')));
      plans.push(plan); groups.push(group); return group.adapterResult;
    } }, tests: { run: async p => {
      const variant = c.preparations[0].candidateFingerprint === p.binding.candidateFingerprint ? 0 : 1;
      const execution = await node.execute(p, variant, variant === 0 ? failing() : passing()); executions.push(execution);
      if (interrupt === 'abort') controller.abort(); else if (interrupt) clock = c.task.policy.totalDeadlineMs;
      return nodeTestAdapterResultV1(execution);
    } } } });
  return { c, context: { report, plans, groups, executions, suite: c.suite, nodeRegistrationFingerprint: node.executor.registrationFingerprint,
    preparation: c.preparations.find(p => p.candidateFingerprint === report.candidateFingerprint) } };
}
