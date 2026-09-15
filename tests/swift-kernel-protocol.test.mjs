// PRIVATE pure report-contract tests. These do not invoke Swift or prove execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepositorySnapshot, prepareRepositoryCandidate } from '../hosts/repository/snapshot-contract.mjs';
import { createNativeArtifactRequest, fixedProfile, hashBytes, readNativeArtifactReport } from '../hosts/swift-verifier/protocol.mjs';

const digest = '1'.repeat(64);
function request(content = '{}', more = {}) {
  const preparation = prepareRepositoryCandidate({
    baseline: createRepositorySnapshot({ files: [{ path: 'config.json', content: 'original' }] }),
    task: { taskId: 'native.fixture', mode: 'review', language: 'javascript', allowedFiles: ['config.json'],
      protectedFiles: [], protectedSnapshots: {}, acceptanceCriteria: ['Valid configuration'],
      policy: { repairBudget: 0, totalDeadlineMs: 2000, requiredReviewers: 1, requireReportStore: false } },
    candidate: { files: [{ path: 'config.json', content }] }, authorId: 'author.fixture' });
  return createNativeArtifactRequest({ preparation, path: 'config.json', profileId: 'nisi-json-structure-v1',
    expectationFingerprint: digest, sourceFingerprint: digest, ...more });
}
function report(r) {
  return { ...r.header, requestSha256: r.requestSha256, artifactByteLength: r.artifactByteLength,
    status: 'PASS', authorizing: false, outcomes: [
      { id: 'DET-001-NONEMPTY', status: 'PASS', explanation: 'Fixture nonempty' },
      { id: 'DET-002-UTF8', status: 'PASS', explanation: 'Fixture UTF8' },
      { id: 'DET-003-JSON-STRUCTURE', status: 'PASS', explanation: 'Fixture structure' }] };
}
const encode = r => Buffer.from(JSON.stringify(r) + '\n');
const refuses = (fn, code) => assert.throws(fn, e => e.code === code);

test('Swift requests bind one issued materialized file and the complete immutable frame', () => {
  const r = request('é');
  assert.equal(r.artifactByteLength, 2);
  const bytes = Buffer.from(r.frameHex, 'hex'), length = bytes.readUInt32BE();
  assert.deepEqual(JSON.parse(bytes.subarray(4, 4 + length)), { ...r.header });
  assert.equal(bytes.subarray(4 + length).toString(), 'é');
  assert.equal(hashBytes(bytes), r.requestSha256);
  assert.equal(r.authorizing, false);
  assert.throws(() => { r.header.path = 'other'; }, TypeError);
  refuses(() => request('{}', { preparation: {} }), 'SWIFT_PREPARATION_NOT_ISSUED');
  refuses(() => request('{}', { path: 'missing' }), 'SWIFT_ARTIFACT_NOT_IN_PREPARATION');
  refuses(() => request('{}', { sourceFingerprint: 'wrong' }), 'SWIFT_REQUEST_IDENTITY');
  refuses(() => fixedProfile('__proto__'), 'SWIFT_PROFILE_UNSUPPORTED');
  let read = false;
  const input = { get preparation() { read = true; } };
  refuses(() => createNativeArtifactRequest(input), 'SWIFT_REQUEST_SCHEMA');
  assert.equal(read, false);
});

test('Swift report consistency never grants execution proof or hides completed failure', () => {
  const r = request(), native = report(r);
  const checked = readNativeArtifactReport(encode(native), r);
  assert.equal(checked.consistency, 'CONSISTENT');
  assert.equal(checked.executionVerified, false);
  assert.equal(checked.authorizing, false);
  native.status = 'FAIL'; native.outcomes[2].status = 'FAIL';
  assert.equal(readNativeArtifactReport(encode(native), r).report.status, 'FAIL');
  refuses(() => readNativeArtifactReport(encode(native), structuredClone(r)), 'SWIFT_REQUEST_NOT_ISSUED');
});

test('Swift report reader rejects every substituted header identity and request byte count', () => {
  const r = request();
  for (const key of [...Object.keys(r.header), 'requestSha256', 'artifactByteLength', 'authorizing']) {
    const native = report(r); native[key] = key === 'artifactByteLength' ? 3 : key === 'authorizing' ? true : 'changed';
    refuses(() => readNativeArtifactReport(encode(native), r), 'SWIFT_RESPONSE_IDENTITY');
  }
  refuses(() => readNativeArtifactReport(encode(report(r)), request('[]')), 'SWIFT_RESPONSE_IDENTITY');
});

test('Swift report reader requires the exact ordered complete check inventory', () => {
  const r = request();
  for (const alter of [o => o.pop(), o => o.push(o[0]), o => o.reverse(), o => { o[2].id = 'DET-003-STRUCTURE'; }]) {
    const native = report(r); alter(native.outcomes);
    assert.throws(() => readNativeArtifactReport(encode(native), r));
  }
  for (const change of [{ status: 'CERTIFIED' }, { explanation: '' }, { authorizing: true }]) {
    const native = report(r); Object.assign(native.outcomes[2], change);
    assert.throws(() => readNativeArtifactReport(encode(native), r));
  }
});

test('Swift unknown incomplete and contradictory statuses cannot become PASS', () => {
  const r = request();
  for (const status of ['NOT_RUN', 'ERROR', 'INCONCLUSIVE', 'UNAVAILABLE']) {
    const native = report(r); native.outcomes[2].status = status;
    refuses(() => readNativeArtifactReport(encode(native), r), 'SWIFT_OUTCOMES_STATUS');
  }
  const native = report(r); native.outcomes[2].status = 'FAIL';
  refuses(() => readNativeArtifactReport(encode(native), r), 'SWIFT_AGGREGATE_STATUS');
  native.status = 'FAIL'; native.outcomes[2].status = 'PASS';
  refuses(() => readNativeArtifactReport(encode(native), r), 'SWIFT_AGGREGATE_STATUS');
});

test('Swift wire reader refuses extra partial duplicate-key oversized or non-JSON output', () => {
  const r = request(), bytes = encode(report(r));
  for (const raw of [Buffer.alloc(0), bytes.subarray(0, -1), Buffer.concat([bytes, bytes]),
    Buffer.concat([bytes, Buffer.from('noise')]), Buffer.from('PASS\n'), Buffer.from('```json\n{}\n```\n'),
    Buffer.from(bytes.toString().replace('"status":"PASS"', '"status":"FAIL","status":"PASS"')),
    Buffer.from('{' + ' '.repeat(16_384) + '}\n')]) assert.throws(() => readNativeArtifactReport(raw, r));
  const native = report(r); native.extra = 'no';
  refuses(() => readNativeArtifactReport(encode(native), r), 'SWIFT_RESPONSE_SCHEMA');
});
