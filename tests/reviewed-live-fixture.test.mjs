// PRIVATE fixture admission tests. Source is read as data; nothing is executed,
// materialized, transmitted to a model or written back to the source repository.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReviewedLiveFixtureV1 as fixture,
  createReviewedLiveFixtureFromSourcesV1 as fromSources } from '../examples/repository-task/reviewed-live-fixture-v1.mjs';
import { digest } from '../integrity/record-utils.mjs';
import { isIssuedRepositoryPreparation } from '../hosts/repository/snapshot-contract.mjs';
import { requireReviewedNodeSuiteV1, reviewedNodePreparationsV1 } from '../hosts/repository/node-suite-v1.mjs';

const paths = ['fixtures/live-baseline/retry-settings.mjs', 'fixtures/live-repair/retry-settings.mjs',
  'fixtures/baseline/config.json', 'fixtures/baseline/README.md', 'fixtures/harness/check-retry-settings.mjs'];
const sourceURL = relative => new URL('../examples/repository-task/' + relative, import.meta.url);
const sources = async () => Object.fromEntries(await Promise.all(paths.map(async name => [name, await readFile(sourceURL(name))])));
const byteDigest = bytes => createHash('sha256').update(bytes).digest('hex');

test('reviewed live fixture captures the four exact repository paths with unchanged protected bytes', async () => {
  const f = await fixture(), raw = await sources();
  assert.deepEqual(f.baseline.files.map(file => file.path), ['README.md', 'checks/check-retry-settings.mjs', 'config.json', 'retry-settings.mjs']);
  const mappings = { 'retry-settings.mjs': paths[0], 'config.json': paths[2], 'README.md': paths[3], 'checks/check-retry-settings.mjs': paths[4] };
  for (const file of f.baseline.files) {
    assert.deepEqual(Buffer.from(file.content, 'utf8'), raw[mappings[file.path]]);
    assert.equal(file.sha256, byteDigest(raw[mappings[file.path]]));
  }
  for (const p of f.preparations) for (const file of p.materialized.files.filter(file => file.path !== 'retry-settings.mjs'))
    assert.equal(file.sha256, f.task.protectedSnapshots[file.path]);
});

test('reviewed live revisions share a neutral header and differ only in the reviewed operator', async () => {
  const f = await fixture(), a = f.preparations[0].candidate.files[0].content, b = f.preparations[1].candidate.files[0].content;
  assert.equal(a.split('\n')[0], '// Private Nisi reviewed live-repair fixture.');
  assert.equal(a.split('input.retryLimit || 3').length, 2);
  assert.equal(a.replace('input.retryLimit || 3', 'input.retryLimit ?? 3'), b);
  assert.equal(a.endsWith('\n'), true); assert.equal(b.endsWith('\n'), true);
  assert.notEqual(f.preparations[0].candidateFingerprint, f.preparations[1].candidateFingerprint);
  for (const p of f.preparations) {
    assert.equal(p.candidate.authorId, 'author.live-model');
    assert.deepEqual(p.candidate.files.map(file => file.path), ['retry-settings.mjs']);
  }
});

test('reviewed live source manifest covers all five byte sources and uses its separate digest domain', async () => {
  const f = await fixture(), raw = await sources();
  assert.deepEqual(f.reviewedSourceManifest.map(entry => entry.path), paths);
  for (const entry of f.reviewedSourceManifest) {
    assert.equal(entry.sha256, byteDigest(raw[entry.path])); assert.equal(entry.byteLength, raw[entry.path].length);
  }
  assert.equal(f.reviewedSourceFingerprint, digest('nisi-reviewed-live-source-v1', f.reviewedSourceManifest));
  assert.notEqual(f.reviewedSourceFingerprint, digest('nisi/repository-snapshot/v1', f.reviewedSourceManifest));
});

test('reviewed live task fixes the policy and protected scope without including approved repair source', async () => {
  const f = await fixture();
  assert.equal(f.task.taskId, 'retry.repository.live'); assert.equal(f.task.mode, 'edit');
  assert.deepEqual({ ...f.task.policy }, { repairBudget: 1, totalDeadlineMs: 240000, requiredReviewers: 1, requireReportStore: false });
  assert.deepEqual(f.task.protectedFiles, ['README.md', 'checks/check-retry-settings.mjs', 'config.json']);
  assert.equal(f.task.acceptanceCriteria.some(text => text.includes('Preserve ALL unrelated bytes')), true);
  assert.equal(f.task.acceptanceCriteria.some(text => text.includes('exactly that one changed file')), true);
  const promptTask = JSON.stringify(f.task);
  assert.equal(f.task.acceptanceCriteria.join('\n').includes(f.preparations[1].candidate.files[0].content), false);
  assert.equal(promptTask.includes('??'), false);
});

test('reviewed live suite retains original issued preparations and nonauthorizing fixture-only scope', async () => {
  const f = await fixture();
  assert.equal(requireReviewedNodeSuiteV1(f.suite), f.suite);
  assert.equal(f.suite.id, 'nisi.node.live-retry'); assert.equal(f.suite.scope, 'source-reviewed-no-descendants-static-local-v1');
  assert.equal(f.suite.entryPath, 'checks/check-retry-settings.mjs');
  assert.equal(f.suite.reportSchema, 'nisi-retry-fixture-v1'); assert.equal(f.suite.setupReason, 'FIXTURE_SETUP_FAILED');
  assert.equal(f.suite.assertionNames.length, 10);
  const issued = reviewedNodePreparationsV1(f.suite);
  for (const [i, p] of f.preparations.entries()) {
    assert.equal(isIssuedRepositoryPreparation(p), true); assert.equal(issued[i], p);
    assert.equal(requireReviewedNodeSuiteV1(f.suite, p), f.suite);
    assert.equal(p.executionStatus, 'NOT_RUN'); assert.equal(p.authorizing, false);
  }
  for (const key of ['sandboxed', 'noDescendantsEnforced', 'authorizing']) assert.equal(f.suite[key], false);
  assert.deepEqual(f.targets.map(value => ({ ...value })), [
    { path: 'README.md', profileId: 'nisi-markdown-sections-v1' },
    { path: 'checks/check-retry-settings.mjs', profileId: 'nisi-text-structure-v1' },
    { path: 'config.json', profileId: 'nisi-json-structure-v1' },
    { path: 'retry-settings.mjs', profileId: 'nisi-text-structure-v1' },
  ]);
});

test('reviewed live fixture freezes its returned graph and snapshots mutable input bytes', async () => {
  const raw = await sources(), f = fromSources(raw), before = JSON.stringify(f);
  const visit = value => { if (value && typeof value === 'object') { assert(Object.isFrozen(value)); for (const v of Object.values(value)) visit(v); } };
  visit(f); raw[paths[0]].fill(0); raw[paths[2]] = Buffer.from('replacement');
  assert.equal(JSON.stringify(f), before);
  assert.throws(() => { f.task.policy.repairBudget = 99; }, TypeError);
  assert.throws(() => { f.reviewedSourceManifest[0].sha256 = '0'.repeat(64); }, TypeError);
});

test('reviewed live factory makes fresh issued objects while retaining stable content identities', async () => {
  const a = await fixture(), b = await fixture();
  assert.notEqual(a.baseline, b.baseline); assert.notEqual(a.preparations[0], b.preparations[0]); assert.notEqual(a.suite, b.suite);
  assert.equal(a.baseline.fingerprint, b.baseline.fingerprint); assert.equal(a.suite.fingerprint, b.suite.fingerprint);
  assert.equal(a.reviewedSourceFingerprint, b.reviewedSourceFingerprint);
  assert.throws(() => requireReviewedNodeSuiteV1(a.suite, b.preparations[0]), { code: 'NODE_SUITE_PREPARATION_NOT_REGISTERED' });
});

for (const sourcePath of paths) test('reviewed live source pin rejects same-size tampering: ' + sourcePath, async () => {
  const raw = await sources(); raw[sourcePath][0] ^= 1;
  assert.throws(() => fromSources(raw), { code: 'LIVE_FIXTURE_SOURCE_HASH', sourcePath });
});

test('reviewed live source map refuses alternate byte types and changed lengths before issuance', async () => {
  for (const value of [null, 'source text', new Uint8Array(275), {}, Buffer.alloc(0), Buffer.alloc(276)]) {
    const raw = await sources(); raw[paths[0]] = value;
    assert.throws(() => fromSources(raw), { code: Buffer.isBuffer(value) ? 'LIVE_FIXTURE_SOURCE_HASH' : 'LIVE_FIXTURE_SOURCE_BYTES' });
  }
});

test('reviewed live source map requires exact enumerable data paths without reading accessors', async () => {
  let calls = 0;
  for (const kind of ['missing', 'extra', 'symbol', 'hidden', 'getter', 'prototype']) {
    const raw = await sources();
    if (kind === 'missing') delete raw[paths[0]];
    if (kind === 'extra') raw['fixtures/unreviewed.mjs'] = Buffer.from('new');
    if (kind === 'symbol') raw[Symbol()] = Buffer.from('new');
    if (kind === 'hidden') Object.defineProperty(raw, paths[0], { enumerable: false });
    if (kind === 'getter') Object.defineProperty(raw, paths[0], { enumerable: true, get() { calls++; return Buffer.alloc(275); } });
    if (kind === 'prototype') Object.setPrototypeOf(raw, { extra: true });
    assert.throws(() => fromSources(raw), { code: 'LIVE_FIXTURE_SOURCE_SCHEMA' });
  }
  assert.equal(calls, 0);
});
