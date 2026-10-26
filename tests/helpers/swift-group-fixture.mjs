// Synthetic object evidence only. Does not run Swift or authenticate execution.
import { createRepositorySnapshot, prepareRepositoryCandidate } from '../../hosts/repository/snapshot-contract.mjs';
import { createSwiftCheckPlanV1, issuedSwiftChecksV1 } from '../../hosts/swift-verifier/check-plan-v1.mjs';
import { hashBytes } from '../../hosts/swift-verifier/protocol.mjs';
export const runId = '12345678-1234-4234-8234-123456789abc';
export const files = [{ path: 'a.json', content: '{}' }, { path: 'b.json', content: '{}' },
  { path: 'guide.md', content: '# Testing\n# Rollback\n' }];
export const targets = files.map(f => ({ path: f.path,
  profileId: f.path.endsWith('.json') ? 'nisi-json-structure-v1' : 'nisi-markdown-sections-v1' }));
export const baseline = createRepositorySnapshot({ files });
export const task = { taskId: 'group.fixture', mode: 'review', language: 'javascript', allowedFiles: files.map(f => f.path),
  protectedFiles: [], protectedSnapshots: {}, acceptanceCriteria: ['Strict configuration and complete documentation'],
  policy: { repairBudget: 2, totalDeadlineMs: 20000, requiredReviewers: 1, requireReportStore: false } };
export const profile = { sourceSha256: '1'.repeat(64), buildSha256: '2'.repeat(64), executableSha256: '3'.repeat(64),
  argv: [], environmentSha256: '4'.repeat(64), cwd: '.', platform: 'darwin', architecture: 'arm64',
  timeoutMs: 5000, maximumOutputBytes: 16384 };
export const prep = (candidateFiles = files, extra = {}) => prepareRepositoryCandidate({ baseline, task,
  candidate: { files: candidateFiles }, authorId: 'author.fixture', ...extra });
export const plan = (extra = {}) => createSwiftCheckPlanV1({ preparation: prep(), runId, attempt: 0, targets,
  executionProfile: profile, ...extra });
export function entry(p, index, status = 'PASS', options = {}) {
  const { expected, request } = issuedSwiftChecksV1(p)[index];
  const clean = status === 'PASS' || status === 'FAIL';
  const bytes = clean ? Buffer.from(JSON.stringify({ ...request.header, requestSha256: request.requestSha256,
    artifactByteLength: request.artifactByteLength, status, authorizing: false, outcomes: [
      { id: 'DET-001-NONEMPTY', status: 'PASS', explanation: 'Fixture nonempty' },
      { id: 'DET-002-UTF8', status: 'PASS', explanation: 'Fixture UTF8' },
      { id: request.profile.kind === 'json' ? 'DET-003-JSON-STRUCTURE' : 'DET-003-REQUIRED-SECTIONS',
        status, explanation: 'Synthetic structure finding' }] }) + '\n') : Buffer.alloc(0);
  const output = b => ({ capturedBytes: b.length, observedBytes: b.length, sha256: hashBytes(b), truncated: false });
  const process = { started: status !== 'NOT_RUN', closed: status !== 'NOT_RUN',
    drain: status === 'NOT_RUN' ? 'NOT_APPLICABLE' : 'CONFIRMED', exitCode: status === 'NOT_RUN' ? null : 0,
    signal: null, errorCode: status === 'ERROR' ? 'FIXTURE_ERROR' : null, deadlineExceeded: false,
    cancelRequested: false, durationMs: status === 'NOT_RUN' ? 0 : 1, ...options.process };
  return { dispatch: 'OBSERVED', receipt: { schemaVersion: 1, expectationFingerprint: expected.fingerprint,
    binding: expected.binding, process, outputs: { stdout: output(bytes), stderr: output(Buffer.alloc(0)) },
    result: { status, reason: options.reason ?? (status === 'PASS' ? '' : status === 'FAIL' ? 'SWIFT_ARTIFACT_FAILED' : 'FIXTURE_UNAVAILABLE') } },
    stdoutHex: bytes.toString('hex'), stderrHex: '' };
}
export const undispatched = reason => ({ dispatch: 'NOT_DISPATCHED', reason });
