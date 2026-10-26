// Private SOURCE-REVIEWED fixed Node fixture execution. No live models or
// unreviewed generated programs; not the general async repository host API.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { sha256Text } from '../workflow/contracts.mjs';
import { createRepositorySnapshot, prepareRepositoryCandidate } from '../hosts/repository/snapshot-contract.mjs';
import { materializeRepositoryCandidateV1, TASK_WORKSPACE_PROFILE } from '../hosts/repository/task-workspace-v1.mjs';
const fixture = fileURLToPath(new URL('../examples/repository-task/fixtures/', import.meta.url));
const harnessPath = path.join(fixture, 'harness/check-retry-settings.mjs');
const load = p => fs.readFile(path.join(fixture, p), 'utf8');
async function context(t) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'nisi-behavior-test-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const files = await Promise.all(['retry-settings.mjs', 'config.json', 'README.md'].map(async p => ({ path: p, content: await load('baseline/' + p) })));
  files.push({ path: 'checks/check-retry-settings.mjs', content: await load('harness/check-retry-settings.mjs') });
  const baseline = createRepositorySnapshot({ files }), protectedFiles = files.filter(f => f.path !== 'retry-settings.mjs');
  const task = { taskId: 'retry.repository.fixture', mode: 'edit', language: 'javascript', allowedFiles: files.map(f => f.path),
    protectedFiles: protectedFiles.map(f => f.path), protectedSnapshots: Object.fromEntries(protectedFiles.map(f => [f.path, sha256Text(f.content)])),
    acceptanceCriteria: ['Explicit zero retries is preserved; default remains three; invalid limits are refused'],
    policy: { repairBudget: 1, totalDeadlineMs: 20000, requiredReviewers: 1, requireReportStore: false } };
  return { parent, baseline, task };
}
function invoke(harness, root, extra = []) {
  const result = spawnSync(process.execPath, [harness, root, ...extra], { encoding: 'utf8',
    timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 65536,
    env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' }, cwd: root });
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.stderr, '');
  assert.equal(result.stdout.trim().split('\n').length, 1);
  return { exitCode: result.status, report: JSON.parse(result.stdout) };
}

test('reviewed repository baseline fails two real assertions; one-file correction passes all ten without workspace drift', async t => {
  const c = await context(t), originalHarness = await fs.readFile(harnessPath), results = [];
  for (const variant of ['baseline', 'repair']) {
    const preparation = prepareRepositoryCandidate({ baseline: c.baseline, task: c.task,
      candidate: { files: [{ path: 'retry-settings.mjs', content: await load(variant + '/retry-settings.mjs') }] }, authorId: 'author.fixed-fixture' });
    const owner = await materializeRepositoryCandidateV1({ preparation, parentRoot: c.parent, profile: TASK_WORKSPACE_PROFILE });
    const pre = await owner.checkpoint('PRE');
    const observed = invoke(path.join(owner.root, 'checks/check-retry-settings.mjs'), owner.root);
    const post = await owner.checkpoint('POST'); results.push({ preparation, owner, observed });
    assert.equal(observed.exitCode, 0); assert.equal(observed.report.schemaVersion, 'nisi-retry-fixture-v1');
    assert.equal(observed.report.assertionsExecuted, 10); assert.equal(post.previousFingerprint, pre.fingerprint);
    assert.deepEqual(await fs.readFile(path.join(owner.root, 'checks/check-retry-settings.mjs')), originalHarness);
    assert.equal(owner.status(), 'POSTCHECKED'); assert.equal(owner.manifest.executionStatus, 'NOT_RUN');
  }
  assert.equal(results[0].observed.report.status, 'FAIL'); assert.equal(results[0].observed.report.assertionsPassed, 8);
  assert.deepEqual(results[0].observed.report.failures.map(f => f.name), ['explicit zero retries stays 0', 'loaded config object returns 0']);
  assert.equal(results[1].observed.report.status, 'PASS'); assert.equal(results[1].observed.report.assertionsPassed, 10);
  assert.deepEqual(results[1].observed.report.failures, []);
  assert.notEqual(results[0].owner.root, results[1].owner.root);
  assert.notEqual(results[0].preparation.candidateFingerprint, results[1].preparation.candidateFingerprint);
  assert.deepEqual(await fs.readFile(harnessPath), originalHarness);
  assert.equal(c.baseline.files.find(f => f.path === 'config.json').content.trim(), '{"retryLimit":0}');
});

test('fixture setup error is ERROR exit two, never ten invented passing assertions', async t => {
  const c = await context(t);
  for (const args of [[], ['extra']]) {
    const result = invoke(harnessPath, c.parent, args);
    assert.equal(result.exitCode, 2); assert.deepEqual(result.report, { schemaVersion: 'nisi-retry-fixture-v1', status: 'ERROR',
      assertionsExecuted: 0, assertionsPassed: 0, failures: [], reason: 'FIXTURE_SETUP_FAILED' });
  }
});
