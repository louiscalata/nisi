// PRIVATE sequential fixed-checker adapter for every declared materialized file.
// No generated-code execution, disk writes, model calls, or whole-machine owner.
import { cloneFreeze } from '../../workflow/contracts.mjs';
import { prepareRepositoryCandidate } from '../repository/snapshot-contract.mjs';
import { createSwiftPlannedArtifactExecutorV1 } from './executor.mjs';
import { createSwiftStaticGroupV1 } from '../../receipts/swift-static-group-v1.mjs';
import { closedList } from './group-contract-utils.mjs';

const fail = code => { throw Object.assign(new Error(code), { code }); };
export function createSwiftStaticGroupAdapterV1({ build, scope, baseline, targets, timeoutMs = 5000, closeGraceMs = 500 }) {
  const executor = createSwiftPlannedArtifactExecutorV1({ build, scope, timeoutMs, closeGraceMs });
  return createSwiftStaticGroupOwnerV1({ executor, baseline, targets });
}

// Internal dependency seam for a TRUSTED executor, including deterministic
// lifecycle fixtures. This owner does not attest execution or grant permission.
// The actual product entry point above always constructs the fixed Swift runner.
export function createSwiftStaticGroupOwnerV1({ executor, baseline, targets }) {
  if (!executor || ['plan', 'execute', 'status', 'lateObservations'].some(k => typeof executor[k] !== 'function')) fail('SWIFT_GROUP_EXECUTOR_REQUIRED');
  const selected = cloneFreeze(closedList(targets, 64, 'SWIFT_GROUP_TARGETS')), history = [];
  let inFlight = null, boundRun = null, nextAttempt = 0, quarantined = false;
  async function work(payload) {
    const { task, candidate, binding, signal } = payload;
    const preparation = prepareRepositoryCandidate({ baseline, task, candidate: { files: candidate.files }, authorId: candidate.authorId });
    if (binding.schemaVersion !== 1 || preparation.taskFingerprint !== binding.taskFingerprint ||
        preparation.candidateFingerprint !== binding.candidateFingerprint || binding.attempt !== nextAttempt ||
        (boundRun !== null && binding.runId !== boundRun)) fail('SWIFT_GROUP_ADAPTER_BINDING');
    if (signal !== undefined && !(signal instanceof AbortSignal)) fail('SWIFT_SIGNAL_INVALID');
    const plan = executor.plan({ preparation, runId: binding.runId, attempt: binding.attempt, targets: selected });
    boundRun = binding.runId; nextAttempt++;
    const entries = [], observations = []; let stopReason = null;
    try {
      for (let index = 0; index < plan.targets.length; index++) {
        if (stopReason === null && signal?.aborted) stopReason = 'ABORTED';
        if (stopReason !== null) { entries.push({ dispatch: 'NOT_DISPATCHED', reason: stopReason }); continue; }
        const observation = await executor.execute({ plan, index, signal }); observations.push(observation);
        entries.push({ dispatch: 'OBSERVED', receipt: observation.receipt,
          stdoutHex: observation.rawObservation?.stdoutHex ?? '', stderrHex: observation.rawObservation?.stderrHex ?? '' });
        // Preserve the host's abort independently of the unchanged raw child
        // result. A child-only deadline stays in that raw receipt instead.
        if (signal?.aborted) stopReason = 'ABORTED';
        else if (!['PASS', 'FAIL'].includes(observation.receipt.result.status)) stopReason = 'CHILD_UNAVAILABLE';
      }
      const group = createSwiftStaticGroupV1(plan, entries, stopReason);
      history.push(Object.freeze({ plan, group, observations: Object.freeze(observations), error: null }));
      return group.adapterResult;
    } catch (error) {
      // An unrecorded operation is not falsely labeled NOT_DISPATCHED. Retain
      // partial evidence, refuse a complete group, and forbid automatic retry.
      quarantined = true;
      history.push(Object.freeze({ plan, group: null, observations: Object.freeze(observations),
        partialEntries: cloneFreeze(entries), error: typeof error?.code === 'string' ? error.code : 'SWIFT_GROUP_ADAPTER_ERROR' }));
      throw error;
    }
  }
  function check(payload) {
    if (inFlight) fail('SWIFT_GROUP_ADAPTER_BUSY');
    if (quarantined || executor.status() !== 'IDLE') fail('SWIFT_GROUP_ADAPTER_UNAVAILABLE');
    if (history.length >= 101) fail('SWIFT_GROUP_ADAPTER_HISTORY_LIMIT');
    // Capture ownership before dispatch, including synchronous plan failures.
    const operation = Promise.resolve().then(() => work(payload));
    inFlight = operation;
    return operation.finally(() => { inFlight = null; });
  }
  async function settled() { if (inFlight) { try { await inFlight; } catch {} await Promise.resolve(); } return Object.freeze([...history]); }
  return Object.freeze({ check, settled, observations: () => Object.freeze([...history]),
    status: () => quarantined ? 'QUARANTINED' : inFlight ? 'BUSY' : executor.status(), lateObservations: executor.lateObservations });
}
