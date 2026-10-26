// PRIVATE actual Swift subprocess checks; separate from npm's portable test lane.
// Only this inspected fixed kernel executes. Candidate contents are input data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildNativeArtifactKernel } from '../../hosts/swift-verifier/build.mjs';
import { createNativeArtifactRequest, hashBytes, readNativeArtifactReport } from '../../hosts/swift-verifier/protocol.mjs';
import { createRepositorySnapshot, prepareRepositoryCandidate } from '../../hosts/repository/snapshot-contract.mjs';

const build = buildNativeArtifactKernel();
let processCount = 0;
const retained = [];
function invoke(bytes, argv = []) {
  assert.equal(hashBytes(fs.readFileSync(build.executable)), build.executableSha256);
  const result = spawnSync(build.executable, argv, { input: bytes, timeout: 5000, killSignal: 'SIGKILL',
    maxBuffer: 16_384, env: { LANG: 'C', LC_ALL: 'C' }, cwd: build.directory });
  assert.equal(hashBytes(fs.readFileSync(build.executable)), build.executableSha256);
  processCount++;
  retained.push({ index: processCount, requestSha256: hashBytes(bytes), argv, status: result.status,
    signal: result.signal, errorCode: result.error?.code ?? null,
    stdout: result.stdout?.toString('utf8') ?? null, stderr: result.stderr?.toString('utf8') ?? null });
  fs.writeFileSync(path.join(build.directory, 'native-fixture-results.json'), JSON.stringify(retained, null, 2));
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  return result;
}
function request(content = '{}', profileId = 'nisi-json-structure-v1') {
  const preparation = prepareRepositoryCandidate({
    baseline: createRepositorySnapshot({ files: [{ path: 'fixture.txt', content: 'original' }] }),
    task: { taskId: 'native.fixture', mode: 'review', language: 'javascript', allowedFiles: ['fixture.txt'],
      protectedFiles: [], protectedSnapshots: {}, acceptanceCriteria: ['Fixed artifact structure'],
      policy: { repairBudget: 0, totalDeadlineMs: 5000, requiredReviewers: 1, requireReportStore: false } },
    candidate: { files: [{ path: 'fixture.txt', content }] }, authorId: 'author.fixture' });
  return createNativeArtifactRequest({ preparation, path: 'fixture.txt', profileId,
    expectationFingerprint: '1'.repeat(64), sourceFingerprint: build.sourceFingerprint });
}
function frame(header, artifact = Buffer.from('{}')) {
  const h = typeof header === 'string' ? Buffer.from(header) : Buffer.from(JSON.stringify(header));
  const prefix = Buffer.alloc(4); prefix.writeUInt32BE(h.length);
  return Buffer.concat([prefix, h, artifact]);
}
function refused(bytes, argv) {
  const result = invoke(bytes, argv);
  assert.equal(result.status, 2); assert.equal(result.stdout.length, 0);
  assert.equal(result.stderr.toString(), 'NISI_SWIFT_KERNEL_REFUSED\n');
}
function evaluate(content, profileId) {
  const r = request(content, profileId), result = invoke(Buffer.from(r.frameHex, 'hex'));
  assert.equal(result.status, 0); assert.equal(result.stderr.length, 0);
  return readNativeArtifactReport(result.stdout, r).report;
}

test('real native kernel compiles the three unchanged imported sources and binds Nisi candidates', () => {
  assert.match(build.compilerVersion, /Swift version/);
  assert.equal(build.sourceFiles.length, 4);
  for (const content of ['{}', '[]', '{"name":"é🍎"}']) assert.equal(evaluate(content).status, 'PASS');
  assert.equal(evaluate('ordinary text', 'nisi-text-structure-v1').status, 'PASS');
  assert.equal(evaluate('# Testing\n## Rollback\n', 'nisi-markdown-sections-v1').status, 'PASS');
});

test('real native artifact failures are completed FAIL records with actual strict JSON outcomes', () => {
  for (const content of ['{"a":1,"a":2}', '{"é":1,"e\\u0301":2}', '{"a\\u0000":0}', '{', 'true', '42', '']) {
    const report = evaluate(content);
    assert.equal(report.status, 'FAIL');
    assert.equal(report.outcomes[2].status, 'FAIL');
  }
  const report = evaluate('Testing and Rollback', 'nisi-markdown-sections-v1');
  assert.equal(report.outcomes[2].status, 'FAIL');
});

test('retained Markdown marker checks do not prove rendered sections or useful content', () => {
  // Deliberate evidence-ceiling control, not an endorsement of this document.
  const report = evaluate('```markdown\n# Testing\n# Rollback\n```', 'nisi-markdown-sections-v1');
  assert.equal(report.status, 'PASS');
  assert.equal(report.outcomes[2].explanation, 'Every required section marker is present.');
});

test('real native input cap uses UTF8 bytes and keeps exact boundary artifacts', () => {
  assert.equal(evaluate('é'.repeat(524288), 'nisi-text-structure-v1').status, 'PASS');
  const r = request('{}'), artifact = Buffer.alloc(1_048_577, 97);
  refused(frame({ ...r.header, artifactSha256: hashBytes(artifact) }, artifact));
  refused(Buffer.alloc(4 + 4096 + 1_048_577));
});

test('real native framing rejects missing truncated oversized and unexpected command input', () => {
  const r = request();
  for (let n = 0; n < 4; n++) refused(Buffer.alloc(n));
  for (const n of [0, 4097, 0xffffffff]) { const b = Buffer.alloc(4); b.writeUInt32BE(n); refused(b); }
  const incomplete = Buffer.alloc(8); incomplete.writeUInt32BE(32); refused(incomplete);
  refused(Buffer.from(r.frameHex, 'hex'), ['--unexpected']);
});

test('real native header rejects ambiguous schema values and stale source rules or artifact identities', () => {
  const r = request();
  for (const key of Object.keys(r.header)) {
    const missing = { ...r.header }; delete missing[key]; refused(frame(missing));
    refused(frame({ ...r.header, [key]: 1 }));
  }
  for (const key of ['sourceFingerprint', 'rulesFingerprint', 'artifactSha256']) refused(frame({ ...r.header, [key]: '0'.repeat(64) }));
  for (const key of ['expectationFingerprint', 'preparationFingerprint']) refused(frame({ ...r.header, [key]: 'bad' }));
  for (const extra of [{ unknown: true }, { schemaVersion: '2' }, { profileId: 'arbitrary' }]) refused(frame({ ...r.header, ...extra }));
  refused(frame(JSON.stringify(r.header).replace('"schemaVersion":', '"schemaVersion":"other","schemaVersion":')));
  refused(frame('{"invalid":"\\ud800"}'));
});

test('real native invalid UTF8 retains NOT_RUN structure and never becomes PASS', () => {
  const r = request(), artifact = Buffer.from([0xff]);
  const result = invoke(frame({ ...r.header, artifactSha256: hashBytes(artifact) }, artifact));
  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'INCONCLUSIVE');
  assert.deepEqual(report.outcomes.map(o => o.status), ['PASS', 'FAIL', 'NOT_RUN']);
  assert.throws(() => readNativeArtifactReport(result.stdout, r));
});

test.after(() => {
  console.log(JSON.stringify({ nativeBuildManifest: path.join(build.directory, 'build-manifest.json'),
    retainedObservations: path.join(build.directory, 'native-fixture-results.json'), processCount,
    scope: 'FIXED_KERNEL_ONLY', fullHostVerified: false }));
});
