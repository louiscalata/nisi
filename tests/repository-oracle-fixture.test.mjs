import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createReviewedRepositoryOracleV1 as create, createReviewedRepositoryOracleFromSourceV1 as fromSource,
  readIssuedRepositoryOracleV1 as read } from '../examples/repository-task/reviewed-oracle-fixture-v1.mjs';
import { requireReviewedNodeSuiteV1 } from '../hosts/repository/node-suite-v1.mjs';
import { context } from './helpers/live-model-v3-fixture.mjs';
function assertNoOracleLeak(value, hidden, depth = 0) {
  assert(depth < 32, 'oracle exposure check exceeded its decoding bound');
  if (typeof value === 'string') {
    for (const secret of hidden) assert(!value.includes(secret), 'oracle material entered workflow payload');
    let decoded; try { decoded = JSON.parse(value); } catch { return; }
    assertNoOracleLeak(decoded, hidden, depth + 1);
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      assertNoOracleLeak(key, hidden, depth + 1); assertNoOracleLeak(child, hidden, depth + 1);
    }
  }
}
test('exposure check detects multiline source inside nested JSON-string payloads', () => {
  const source = 'first oracle line\nsecond "quoted" line\n';
  const body = JSON.stringify({ input: JSON.stringify({ context: { source } }) });
  assert(!body.includes(source)); // Raw substring matching would miss this leak.
  assert.throws(() => assertNoOracleLeak(body, [source]), { code: 'ERR_ASSERTION' });
  assert.doesNotThrow(() => assertNoOracleLeak(JSON.stringify({ input: '{"task":"repair"}' }), [source]));
});
test('oracle registration keeps two complete identity graphs and refuses serialized authority', async () => {
  const registration = await create(), owned = read(registration);
  assert.equal(registration.candidatePopulation, 2); assert.equal(registration.independenceAttested, false);
  assert.equal(registration.measurementVerified, false); assert.equal(registration.authorizing, false);
  assert.equal(registration.assertionNames.length, 17);
  assert.notEqual(registration.workflow.taskSha256, registration.oracle.taskSha256);
  assert.notEqual(registration.workflow.baselineSha256, registration.oracle.baselineSha256);
  assert.notEqual(registration.workflow.suiteFingerprint, registration.oracle.suiteFingerprint);
  for (const mapping of registration.mappings) {
    const original = owned.workflow.preparations.find(p => p.fingerprint === mapping.workflowPreparationFingerprint);
    const oracle = owned.preparations.find(p => p.fingerprint === mapping.oraclePreparationFingerprint);
    assert(original && oracle); assert.equal(original.candidateFingerprint, oracle.candidateFingerprint);
    assert.deepEqual(original.candidate.files, oracle.candidate.files);
    assert.notEqual(original.materializedFingerprint, oracle.materializedFingerprint);
    requireReviewedNodeSuiteV1(owned.suite, oracle);
    assert.throws(() => requireReviewedNodeSuiteV1(owned.workflow.suite, oracle), { code: 'NODE_SUITE_PREPARATION_NOT_REGISTERED' });
    assert.throws(() => requireReviewedNodeSuiteV1(owned.suite, original), { code: 'NODE_SUITE_PREPARATION_NOT_REGISTERED' });
  }
  assert.throws(() => read(structuredClone(registration)), { code: 'ORACLE_NOT_ISSUED' });
  assert.throws(() => read({ ...registration }), { code: 'ORACLE_NOT_ISSUED' });
});
test('oracle source bytes are pinned and captured before asynchronous workflow loading', async () => {
  const bytes = await fs.readFile(new URL('../examples/repository-task/oracle-only/check-retry-semantics.mjs', import.meta.url));
  const expected = await create(), pending = fromSource(bytes); bytes[0] ^= 1;
  assert.equal((await pending).oracleSha256, expected.oracleSha256);
  await assert.rejects(fromSource(bytes), { code: 'ORACLE_SOURCE_HASH' });
  await assert.rejects(fromSource(Buffer.concat([bytes, Buffer.from('\n')])), { code: 'ORACLE_SOURCE_BYTES' });
  await assert.rejects(fromSource(bytes.toString()), { code: 'ORACLE_SOURCE_BYTES' });
});
test('oracle harness bytes path hash and selected assertion wording stay out of captured model payloads', async () => {
  const registration = await create(), owned = read(registration), c = await context();
  const report = await c.run(); assert.equal(report.outcome, 'COMPLETED'); assert.equal(c.requests.length, 2);
  const content = owned.baseline.files.find(file => file.path === registration.oracle.entryPath).content;
  const hidden = [registration.oracle.entryPath, registration.oracle.entrySha256, content, 'bigint is rejected'];
  assertNoOracleLeak({ baseline: owned.workflow.baseline, task: owned.workflow.task,
    suite: owned.workflow.suite, manifest: owned.workflow.reviewedSourceManifest }, hidden);
  for (const request of c.requests) {
    assertNoOracleLeak(request.request.body, hidden); assertNoOracleLeak(request.modelPayload, hidden);
  }
  // Selected new assertion wording, not semantics, is absent from this fixture's
  // two captured requests. This is not an attestation about all future inference.
  assert.equal(registration.inferenceExposureAttested, false);
});
