// PRIVATE workflow adapter for already source-reviewed, registered full trees.
// Does not approve new generated programs, apply changes back or publish anything.
import { createReviewedNodeExecutorV1, nodeTestAdapterResultV1 } from './node-executor-v1.mjs';
import { reviewedNodePreparationsV1 } from './node-suite-v1.mjs';
import { prepareRepositoryCandidate } from './snapshot-contract.mjs';
import { materializeRepositoryCandidateV1, TASK_WORKSPACE_PROFILE } from './task-workspace-v1.mjs';
import { exact } from '../../integrity/record-utils.mjs';
const refuse = code => { throw Object.assign(new Error(code), { code }); };

export function createReviewedNodeTestAdapterV1(input) {
  exact(input, ['suite', 'parentRoot', 'totalTimeoutMs', 'childTimeoutMs', 'closeGraceMs'], 'NODE_ADAPTER_SCHEMA');
  const { suite, parentRoot, ...bounds } = input;
  const preparations = reviewedNodePreparationsV1(suite);
  const executor = createReviewedNodeExecutorV1({ suite, ...bounds });
  const history = []; let inFlight = null, boundRun = null, lastAttempt = -1, quarantined = false;
  async function work(payload) {
    const { task, candidate, binding, signal } = payload;
    const captured = prepareRepositoryCandidate({ baseline: preparations[0].baseline, task,
      candidate: { files: candidate.files }, authorId: candidate.authorId });
    const preparation = preparations.find(p => p.fingerprint === captured.fingerprint);
    if (!preparation || binding.schemaVersion !== 1 || binding.taskFingerprint !== preparation.taskFingerprint ||
        binding.candidateFingerprint !== preparation.candidateFingerprint || !Number.isSafeInteger(binding.attempt) ||
        binding.attempt < 0 || binding.attempt > preparation.task.policy.repairBudget || binding.attempt <= lastAttempt ||
        (boundRun !== null && boundRun !== binding.runId)) refuse('NODE_ADAPTER_BINDING');
    if (signal !== undefined && !(signal instanceof AbortSignal)) refuse('NODE_ADAPTER_SIGNAL');
    // Static checks can skip this adapter on any attempt. Require increasing,
    // bounded attempts, not a consecutive count of behavior-test invocations.
    boundRun = binding.runId; lastAttempt = binding.attempt;
    let workspace = null, execution = null;
    try {
      workspace = await materializeRepositoryCandidateV1({ preparation, parentRoot, profile: TASK_WORKSPACE_PROFILE });
      execution = await executor.execute({ workspace, runId: binding.runId, attempt: binding.attempt, signal });
      const adapterResult = nodeTestAdapterResultV1(execution);
      history.push(Object.freeze({ preparation, workspace, execution, adapterResult, error: null }));
      return adapterResult;
    } catch (error) {
      quarantined = true;
      history.push(Object.freeze({ preparation, workspace, execution, adapterResult: null,
        error: typeof error?.code === 'string' ? error.code : 'NODE_ADAPTER_ERROR' }));
      throw error;
    }
  }
  function run(payload) {
    if (inFlight) refuse('NODE_ADAPTER_BUSY');
    if (quarantined || executor.status() !== 'IDLE') refuse('NODE_ADAPTER_QUARANTINED');
    if (history.length >= 101) refuse('NODE_ADAPTER_HISTORY_LIMIT');
    const operation = Promise.resolve().then(() => work(payload)); inFlight = operation;
    return operation.finally(() => { inFlight = null; });
  }
  // Await separately after runWorkflow: cleanup observations never revise its
  // immutable result. Workspace I/O is settlement-bounded, not hard-preempted.
  async function settled() { if (inFlight) { try { await inFlight; } catch {} await Promise.resolve(); } return Object.freeze([...history]); }
  return Object.freeze({ run, settled, observations: () => Object.freeze([...history]),
    registrationFingerprint: executor.registrationFingerprint,
    status: () => quarantined ? 'QUARANTINED' : inFlight ? 'BUSY' : executor.status(), lateObservations: executor.lateObservations });
}
