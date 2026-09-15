// PRIVATE one-artifact workflow adapter. Its explicit target is not a claim that
// every repository file was checked. A versioned multi-file stage is still needed.
import { cloneFreeze } from '../../workflow/contracts.mjs';
import { prepareRepositoryCandidate } from '../repository/snapshot-contract.mjs';
import { createSwiftArtifactExecutor } from './executor.mjs';

const fail = code => { throw Object.assign(new Error(code), { code }); };
export function createSwiftArtifactStaticAdapter({ build, scope, baseline, path, profileId, timeoutMs = 5000, closeGraceMs = 500 }) {
  const executor = createSwiftArtifactExecutor({ build, scope, timeoutMs, closeGraceMs });
  const completed = []; let boundRun = null, inFlight = null;
  async function check(payload) {
    if (inFlight) fail('SWIFT_ADAPTER_BUSY');
    if (completed.length >= 101) fail('SWIFT_ADAPTER_HISTORY_LIMIT');
    const { task, candidate, binding, signal } = payload;
    const preparation = prepareRepositoryCandidate({ baseline, task,
      candidate: { files: candidate.files }, authorId: candidate.authorId });
    if (binding.schemaVersion !== 1 || preparation.taskFingerprint !== binding.taskFingerprint ||
        preparation.candidateFingerprint !== binding.candidateFingerprint || (boundRun !== null && binding.runId !== boundRun)) fail('SWIFT_ADAPTER_BINDING');
    boundRun = binding.runId;
    const operation = executor.execute({ preparation, path, profileId, runId: binding.runId, attempt: binding.attempt, signal });
    inFlight = operation;
    let observation;
    try { observation = await operation; completed.push(observation); }
    finally { inFlight = null; }
    const nativeStatus = observation.receipt.result.status;
    const status = ['ERROR', 'INCONCLUSIVE'].includes(nativeStatus) ? 'UNAVAILABLE' : nativeStatus;
    const findings = status === 'FAIL' ? observation.nativeReport.outcomes.filter(o => o.status === 'FAIL')
      .map(o => ({ code: o.id.replaceAll('-', '_'), message: `${path}: ${o.explanation}` })) : [];
    return cloneFreeze({ status, evidence: { ...binding, findings, reason: observation.receipt.result.reason } });
  }
  // Call after runWorkflow, outside its quality deadline, to collect bounded
  // cleanup observations. This does not revise the immutable engine result.
  async function settled() {
    if (inFlight) { try { await inFlight; } catch {} await Promise.resolve(); }
    return Object.freeze([...completed]);
  }
  return Object.freeze({ check, settled, observations: () => Object.freeze([...completed]),
    lateObservations: executor.lateObservations, status: executor.status });
}
