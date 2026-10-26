// Fixed non-model operations for command lifecycle tests, not experiment data.
import { createHash } from 'node:crypto';
import { pairedTrialFixtureInputs } from './paired-trial-fixture.mjs';
export const deferredTrialValue = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
export function pairedTrialCommandFixture() {
  const { plan, profile } = pairedTrialFixtureInputs(), calls = [];
  const candidateText = 'FIXED_PRIVATE_TEST_CANDIDATE';
  const executor = intent => ({ requestId: intent.requestId, profileSha256: intent.profileSha256,
    candidateText, candidateSha256: createHash('sha256').update(candidateText).digest('hex'),
    completionClaim: true, tokenUsage: { input: 0, output: 0 }, modelCalls: 0, durationMs: null, repairAttempts: 0 });
  const oracle = request => ({ requestId: request.requestId, oracleSha256: request.oracleSha256,
    oracleCandidateSha256: request.candidateSha256, outcome: 'FAIL' });
  const operation = result => ({ result: Promise.resolve(result), settled: Promise.resolve(), status: () => 'IDLE', cancel() {} });
  const host = { verifyInputs: () => true,
    startExecutor: intent => { calls.push('EXECUTOR'); return operation(executor(intent)); },
    startOracle: request => { calls.push('ORACLE'); return operation(oracle(request)); } };
  return { plan, profile, host, executor, oracle, calls };
}
