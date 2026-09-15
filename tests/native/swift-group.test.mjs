// PRIVATE actual fixed Swift checker, synthetic repository data and fixture
// author/tests/reviewer. No models, native app UI, or generated-code execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildNativeArtifactKernel } from '../../hosts/swift-verifier/build.mjs';
import { createSwiftStaticGroupAdapterV1 } from '../../hosts/swift-verifier/group-adapter-v1.mjs';
import { createSwiftPlannedArtifactExecutorV1, createSwiftArtifactExecutor } from '../../hosts/swift-verifier/executor.mjs';
import { captureRepositoryFromDisk, DISK_CAPTURE_PROFILE } from '../../hosts/repository/disk-capture.mjs';
import { prepareRepositoryCandidate } from '../../hosts/repository/snapshot-contract.mjs';
import { runWorkflow, createCandidate } from '../../workflow/engine.mjs';
import { createSwiftStaticRunV1, readSwiftStaticRunV1 } from '../../receipts/swift-static-run-v1.mjs';
import { readSwiftStaticGroupV1 } from '../../receipts/swift-static-group-v1.mjs';
import { readExecutionReceipt } from '../../receipts/repository-execution-v1.mjs';
import { issuedSwiftChecksV1 } from '../../hosts/swift-verifier/check-plan-v1.mjs';

const build = buildNativeArtifactKernel(), scope = 'operator-exclusive-static-local-v1';
const inputRoot = path.join(build.directory, 'repository-fixture'); fs.mkdirSync(inputRoot);
const sourceFiles = [{ path: 'a.json', content: '{"enabled":true}' }, { path: 'b.json', content: '{"retries":2}' },
  { path: 'guide.md', content: '# Testing\nRun configuration tests.\n' }];
for (const f of sourceFiles) fs.writeFileSync(path.join(inputRoot, f.path), f.content, { flag: 'wx' });
const capture = await captureRepositoryFromDisk({ root: inputRoot, paths: sourceFiles.map(f => f.path), profile: DISK_CAPTURE_PROFILE });
const baseline = capture.snapshot;
const targets = sourceFiles.map(f => ({ path: f.path, profileId: f.path.endsWith('.json') ? 'nisi-json-structure-v1' : 'nisi-markdown-sections-v1' }));
const task = { taskId: 'native.multi.fixture', mode: 'edit', language: 'javascript', allowedFiles: sourceFiles.map(f => f.path),
  protectedFiles: [], protectedSnapshots: {}, acceptanceCriteria: ['Keep JSON configuration intact; require Testing and Rollback'],
  policy: { repairBudget: 1, totalDeadlineMs: 20000, requiredReviewers: 1, requireReportStore: false } };
const prepare = (content = sourceFiles[2].content) => prepareRepositoryCandidate({ baseline, task,
  candidate: { files: [{ path: 'guide.md', content }] }, authorId: 'author.fixture' });
const id = n => `12345678-1234-4234-8234-${n.toString(16).padStart(12, '0')}`;
function payload(n, signal) {
  const p = prepare(); return { task: p.task, candidate: p.candidate, signal,
    binding: { schemaVersion: 1, runId: id(n), taskFingerprint: p.taskFingerprint, attempt: 0, candidateFingerprint: p.candidateFingerprint } };
}
const artifacts = [];
const retain = (name, data) => {
  const file = path.join(build.directory, name + '.json'); fs.writeFileSync(file, JSON.stringify(data, null, 2), { flag: 'wx' }); artifacts.push(file);
};
const make = () => createSwiftStaticGroupAdapterV1({ build, scope, baseline, targets });

test('real disk capture and six Swift children prove failed baseline, targeted fixture repair, and fresh full checks', async () => {
  const adapter = make(); let repairCalls = 0, testsCalls = 0, reviewCalls = 0;
  const report = await runWorkflow(task, { adapters: {
    authorizeContext: { authorize: p => ({ status: 'PASS', evidence: { ...p.binding, reason: '' } }) },
    author: { id: 'author.fixture', draft: p => {
      const c = createCandidate({ files: [{ ...sourceFiles[2] }] }, { authorId: 'author.fixture' });
      return { candidate: { files: c.files }, evidence: { ...p.binding, candidateFingerprint: c.fingerprint, note: 'Fixture reproduces captured missing Rollback' } };
    }, repair: p => {
      repairCalls++; assert.equal(p.stages.find(s => s.stage === 'staticChecks').status, 'FAIL');
      assert.match(p.stages.find(s => s.stage === 'staticChecks').evidence.findings[0].message, /guide\.md:/);
      const c = createCandidate({ files: [{ path: 'guide.md', content: sourceFiles[2].content + '# Rollback\nRestore previous configuration.\n' }] }, { authorId: 'author.fixture' });
      return { status: 'REPAIRED', candidate: { files: c.files }, evidence: { ...p.binding, candidateFingerprint: c.fingerprint,
        baseCandidateFingerprint: p.binding.candidateFingerprint, note: 'Deterministic fixture author repairs only documentation' } };
    } }, staticChecks: adapter,
    tests: { run: p => {
      testsCalls++; assert.equal(JSON.parse(baseline.files[0].content).enabled, true);
      assert.equal(JSON.parse(baseline.files[1].content).retries, 2);
      assert.match(p.candidate.files[0].content, /^# Rollback$/m);
      return { status: 'PASS', evidence: { ...p.binding, assertionsExecuted: 3, assertionsPassed: 3, failures: [], reason: '' } };
    } }, reviewers: [{ id: 'reviewer.fixture', review: p => {
      reviewCalls++; assert.equal(p.binding.attempt, 1); assert.equal(p.candidate.files.length, 1);
      assert.equal(p.candidate.files[0].path, 'guide.md');
      return { status: 'PASS', evidence: { ...p.binding, reviewerId: 'reviewer.fixture', findings: [],
        summary: 'Deterministic fixture review of expected patch, not independent model review', reason: '' } };
    } }] } });
  const history = await adapter.settled();
  assert.equal(report.outcome, 'COMPLETED'); assert.equal(repairCalls, 1); assert.equal(testsCalls, 1); assert.equal(reviewCalls, 1);
  assert.equal(history.length, 2); assert.deepEqual(history.map(h => h.group.aggregate.status), ['FAIL', 'PASS']);
  assert(history.every(h => h.observations.length === 3));
  for (const h of history) {
    assert.equal(readSwiftStaticGroupV1(h.group, h.plan).aggregate.counts.NOT_DISPATCHED, 0);
    assert.deepEqual(h.observations.map(o => o.path), ['a.json', 'b.json', 'guide.md']);
    assert.equal(new Set(h.observations.map(o => o.expected.binding.checkId)).size, 3);
    for (const [index, o] of h.observations.entries()) {
      const planned = issuedSwiftChecksV1(h.plan)[index];
      assert.equal(o.expected.fingerprint, planned.expected.fingerprint);
      assert.equal(o.nativeReport.path, planned.target.path);
      assert.equal(o.nativeReport.expectationFingerprint, planned.expected.fingerprint);
      assert.equal(o.nativeReport.requestSha256, planned.request.requestSha256);
      const r = readExecutionReceipt(o.receipt, o.expected);
      assert.equal(r.process.started, true); assert.equal(r.process.closed, true); assert.equal(r.process.drain, 'CONFIRMED');
      assert.equal(o.reservation.released, true);
    }
  }
  for (let i = 0; i < 3; i++) {
    assert.notEqual(history[0].observations[i].expected.fingerprint, history[1].observations[i].expected.fingerprint);
    assert.notEqual(history[0].observations[i].requestSha256, history[1].observations[i].requestSha256);
  }
  assert.equal(history[0].plan.targets[0].artifactSha256, history[1].plan.targets[0].artifactSha256);
  assert.equal(history[0].plan.targets[1].artifactSha256, history[1].plan.targets[1].artifactSha256);
  const context = { report, plans: history.map(h => h.plan) }, bundle = createSwiftStaticRunV1(context, history.map(h => h.group));
  const summary = readSwiftStaticRunV1(bundle, context);
  assert.equal(summary.rawCounts.PASS, 5); assert.equal(summary.rawCounts.FAIL, 1); assert.equal(summary.recordedPassGroups, 1);
  assert.throws(() => createSwiftStaticRunV1(context, [history[0].group, history[0].group]));
  assert.equal(adapter.status(), 'IDLE');
  for (const f of sourceFiles) assert.equal(fs.readFileSync(path.join(inputRoot, f.path), 'utf8'), f.content);
  retain('disk-backed-grouped-repair', { scope: 'SYNTHETIC_DATA_REAL_SWIFT_FIXTURE_AUTHOR_TESTS_REVIEW', capture: capture.capture,
    report, history, bundle, summary, modelInference: false, generatedCodeExecuted: false, fullHost: false });
});

test('planned native executor separates identical-profile paths and refuses replay and changed plan identity', async () => {
  const executor = createSwiftPlannedArtifactExecutorV1({ build, scope }), preparation = prepare();
  const plan = executor.plan({ preparation, runId: id(2), attempt: 0, targets });
  const first = await executor.execute({ plan, index: 0 }), second = await executor.execute({ plan, index: 1 });
  assert.equal(first.receipt.result.status, 'PASS'); assert.equal(second.receipt.result.status, 'PASS');
  assert.notEqual(first.expected.binding.checkId, second.expected.binding.checkId);
  await assert.rejects(executor.execute({ plan, index: 0 }), e => e.code === 'SWIFT_EXECUTION_REPLAY');
  const changed = executor.plan({ preparation: prepare('# Different\n'), runId: id(2), attempt: 0, targets });
  await assert.rejects(executor.execute({ plan: changed, index: 2 }), e => e.code === 'SWIFT_PLAN_IDENTITY_CONFLICT');
  await assert.rejects(executor.execute({ plan: structuredClone(plan), index: 2 }), e => e.code === 'SWIFT_PLAN_NOT_ISSUED');
  await assert.rejects(executor.execute({ plan, index: 2, extra: true }), e => e.code === 'SWIFT_PLANNED_INPUT_SCHEMA');
  retain('planned-path-identities', { first, second });
  // Preserve the original executor contract: one terminal identity per attempt.
  const legacy = createSwiftArtifactExecutor({ build, scope });
  const input = { preparation, runId: id(3), attempt: 0, path: 'a.json', profileId: targets[0].profileId };
  const old = await legacy.execute(input); assert.equal(old.expected.binding.checkId, 'nisi.swift.artifact');
  await assert.rejects(legacy.execute({ ...input, path: 'b.json' }), e => e.code === 'SWIFT_EXECUTION_REPLAY');
});

test('group pre-abort emits only undispatched entries, never fake native receipts', async () => {
  const adapter = make(), c = new AbortController(); c.abort();
  assert.equal((await adapter.check(payload(4, c.signal))).status, 'UNAVAILABLE');
  const [h] = await adapter.settled(); assert.equal(h.group.stopReason, 'ABORTED');
  assert.equal(h.observations.length, 0); assert.equal(h.group.aggregate.counts.NOT_DISPATCHED, 3);
  assert(h.group.entries.every(e => e.dispatch === 'NOT_DISPATCHED' && !Object.hasOwn(e, 'receipt')));
  retain('group-pre-abort', h);
});

test('group abort after dispatch preserves exact cancellation and undispatched suffix', async () => {
  const adapter = make(), c = new AbortController(), pending = adapter.check(payload(5, c.signal));
  assert.throws(() => adapter.check(payload(6)), e => e.code === 'SWIFT_GROUP_ADAPTER_BUSY');
  // The adapter work microtask launches the first child before this microtask.
  queueMicrotask(() => c.abort());
  assert.equal((await pending).status, 'UNAVAILABLE');
  const [h] = await adapter.settled(); assert.equal(h.error, null); assert.equal(h.group.stopReason, 'ABORTED');
  assert.equal(h.observations.length, 1); assert.equal(h.group.entries[0].receipt.result.reason, 'ABORTED');
  assert.equal(h.group.entries[0].receipt.process.cancelRequested, true);
  assert.equal(h.group.entries[0].receipt.process.closed, true);
  assert.equal(h.group.entries[0].receipt.process.drain, 'CONFIRMED');
  assert.equal(h.observations[0].reservation.released, true);
  assert.equal(h.group.aggregate.counts.NOT_DISPATCHED, 2); assert.equal(adapter.status(), 'IDLE');
  retain('group-dispatched-abort', h);
});

test('native all-PASS group survives engine deadline as raw evidence without acceptance credit', async () => {
  const adapter = make(); let clock = 0;
  const reviewTask = { ...task, mode: 'review' }, noCall = () => { throw new Error('Must not reach fixture'); };
  const report = await runWorkflow(reviewTask, { clock: () => clock,
    candidate: { files: [{ path: 'guide.md', content: '# Testing\n# Rollback\n' }] }, candidateAuthorId: 'author.fixture',
    adapters: { authorizeContext: { authorize: p => ({ status: 'PASS', evidence: { ...p.binding, reason: '' } }) },
      staticChecks: { check: async p => { const result = await adapter.check(p); clock = task.policy.totalDeadlineMs; return result; } },
      tests: { run: noCall }, reviewers: [{ id: 'reviewer.fixture', review: noCall }] } });
  const history = await adapter.settled(), context = { report, plans: history.map(h => h.plan) };
  const bundle = createSwiftStaticRunV1(context, history.map(h => h.group)), summary = readSwiftStaticRunV1(bundle, context);
  assert.equal(report.outcome, 'TIMED_OUT'); assert.equal(summary.rawCounts.PASS, 3);
  assert.equal(summary.recordedPassGroups, 0); assert.equal(summary.unrecordedRawPassGroups, 1);
  retain('group-native-pass-engine-timeout', { report, history, bundle, summary });
});

// Retain this unique, bounded build/fixture directory as private acceptance
// evidence. Cleanup is a separate exact-path operation, never a broad test hook.
test.after(() => console.log(JSON.stringify({ buildManifest: path.join(build.directory, 'build-manifest.json'),
  artifacts, scope: 'DECLARED_MATERIALIZED_STATIC_CHECKS_ONLY', nativeApp: false, modelInference: false, fullMerger: false })));
