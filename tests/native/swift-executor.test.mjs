// PRIVATE real fixed-kernel execution; no models/UI or generated-code execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildNativeArtifactKernel } from '../../hosts/swift-verifier/build.mjs';
import { createSwiftArtifactExecutor } from '../../hosts/swift-verifier/executor.mjs';
import { createSwiftArtifactStaticAdapter } from '../../hosts/swift-verifier/adapter.mjs';
import { createRepositorySnapshot, prepareRepositoryCandidate } from '../../hosts/repository/snapshot-contract.mjs';
import { readExecutionReceipt, createHostRunBundle, readHostRunBundle } from '../../receipts/repository-execution-v1.mjs';
import { createHostRunBundleV2, readHostRunBundleV2 } from '../../receipts/host-run-bundle-v2.mjs';
import { runWorkflow } from '../../workflow/engine.mjs';

const build = buildNativeArtifactKernel(), scope = 'operator-exclusive-static-local-v1';
const runId = '12345678-1234-4234-8234-123456789abc';
const baseline = createRepositorySnapshot({ files: [{ path: 'config.json', content: '{}' }] });
const task = { taskId: 'native.owned.fixture', mode: 'review', language: 'javascript', allowedFiles: ['config.json'],
  protectedFiles: [], protectedSnapshots: {}, acceptanceCriteria: ['Configuration is a strict JSON object'],
  policy: { repairBudget: 0, totalDeadlineMs: 20_000, requiredReviewers: 1, requireReportStore: false } };
const prep = content => prepareRepositoryCandidate({ baseline, task,
  candidate: { files: [{ path: 'config.json', content }] }, authorId: 'author.fixture' });
const observations = [];
function retain(value) {
  observations.push(value);
  fs.writeFileSync(path.join(build.directory, 'executor-fixture-observations.json'), JSON.stringify(observations, null, 2));
}
let operationCount = 0;
const execute = (executor, content = '{}', extra = {}) => executor.execute({ preparation: prep(content), path: 'config.json',
  profileId: 'nisi-json-structure-v1', runId: `12345678-1234-4234-8234-${(++operationCount).toString(16).padStart(12, '0')}`,
  attempt: 0, ...extra });

test('actual async Swift execution produces issued expectation and consistent real process receipt', async () => {
  const executor = createSwiftArtifactExecutor({ build, scope });
  for (const [content, status] of [['{}', 'PASS'], ['{"a":1,"a":2}', 'FAIL']]) {
    const observed = await execute(executor, content); retain(observed);
    assert.equal(readExecutionReceipt(observed.receipt, observed.expected).result.status, status);
    assert.equal(observed.receipt.process.closed, true); assert.equal(observed.receipt.process.drain, 'CONFIRMED');
    assert.equal(observed.receipt.process.exitCode, 0); assert.equal(observed.reservation.released, true);
    assert.equal(observed.nativeReport.status, status); assert.equal(executor.status(), 'IDLE');
    assert(Number.isSafeInteger(observed.rawObservation.lifecycle.operation));
  }
  assert.deepEqual(executor.lateObservations(), []); assert(Object.isFrozen(executor.lateObservations()));
});

test('actual executor refuses forged build and requires explicit exclusive static local scope', () => {
  assert.throws(() => createSwiftArtifactExecutor({ build }), e => e.code === 'SWIFT_EXECUTION_SCOPE_REQUIRED');
  assert.throws(() => createSwiftArtifactExecutor({ build: { ...build }, scope }), e => e.code === 'SWIFT_BUILD_NOT_ISSUED');
  assert.throws(() => createSwiftArtifactExecutor({ build, scope, timeoutMs: 60001 }), e => e.code === 'CHILD_OWNER_CONFIG');
  assert.equal(createSwiftArtifactExecutor({ build, scope, timeoutMs: 60000 }).status(), 'IDLE');
  assert.throws(() => { build.sourceFiles[0].sha256 = 'wrong'; }, TypeError);
});

test('pre-cancelled real executor creates no reservation or process', async () => {
  const c = new AbortController(); c.abort();
  const executor = createSwiftArtifactExecutor({ build, scope }), observed = await execute(executor, '{}', { signal: c.signal }); retain(observed);
  assert.equal(observed.receipt.result.status, 'INCONCLUSIVE'); assert.equal(observed.receipt.result.reason, 'ABORTED');
  assert.equal(observed.receipt.process.started, false); assert.equal(observed.reservation.acquired, false);
});

test('an executor refuses exact replay and conflicting reuse of a terminal run attempt', async () => {
  const executor = createSwiftArtifactExecutor({ build, scope });
  const first = await execute(executor, '{}', { runId }); retain(first);
  await assert.rejects(execute(executor, '{}', { runId }), e => e.code === 'SWIFT_EXECUTION_REPLAY');
  await assert.rejects(execute(executor, '[]', { runId }), e => e.code === 'SWIFT_EXECUTION_IDENTITY_CONFLICT');
});

test('same executor refuses overlap and an actual abort never grants PASS', async () => {
  const c = new AbortController(), executor = createSwiftArtifactExecutor({ build, scope });
  const pending = execute(executor, '{}', { signal: c.signal });
  await assert.rejects(execute(executor), e => e.code === 'SWIFT_EXECUTOR_BUSY');
  c.abort(); const observed = await pending; retain(observed);
  assert.equal(observed.receipt.result.status, 'INCONCLUSIVE'); assert.equal(observed.receipt.result.reason, 'ABORTED');
  assert.equal(observed.receipt.process.cancelRequested, true); assert.equal(observed.receipt.process.closed, true);
  assert.equal(observed.reservation.released, true);
});

test('a second executor cannot bypass the durable reservation of an active operation', async () => {
  const first = createSwiftArtifactExecutor({ build, scope }), second = createSwiftArtifactExecutor({ build, scope });
  const p = execute(first), denied = await execute(second); retain(denied);
  assert.equal(denied.receipt.result.status, 'ERROR'); assert.equal(denied.receipt.result.reason, 'SWIFT_RESERVATION_PRESENT');
  assert.equal(denied.receipt.process.started, false); assert.equal(denied.reservation.acquired, false);
  const successful = await p; retain(successful); assert.equal(successful.receipt.result.status, 'PASS');
});

test('changed retained build source is refused before execution without modifying the original import', async () => {
  const source = path.join(build.directory, 'main.swift'), original = fs.readFileSync(source);
  try {
    fs.appendFileSync(source, '\n// fixed test drift\n');
    const executor = createSwiftArtifactExecutor({ build, scope }), observed = await execute(executor); retain(observed);
    assert.equal(observed.receipt.result.status, 'ERROR'); assert.equal(observed.receipt.result.reason, 'SWIFT_BUILD_SOURCE_STALE');
    assert.equal(observed.receipt.process.started, false);
  } finally { fs.writeFileSync(source, original); }
});

test('real Swift static adapter runs inside Nisi while other fixture stages retain their exact scope', async () => {
  const adapter = createSwiftArtifactStaticAdapter({ build, scope, baseline, path: 'config.json', profileId: 'nisi-json-structure-v1' });
  let testsRan = 0;
  const report = await runWorkflow(task, { candidate: { files: [{ path: 'config.json', content: '{"enabled":true}' }] }, candidateAuthorId: 'author.fixture',
    adapters: { authorizeContext: { authorize: p => ({ status: 'PASS', evidence: { ...p.binding, reason: '' } }) },
      staticChecks: adapter, tests: { run: p => {
        const enabled = JSON.parse(p.candidate.files[0].content).enabled; assert.equal(enabled, true); testsRan++;
        return { status: 'PASS', evidence: { ...p.binding, assertionsExecuted: 1, assertionsPassed: 1, failures: [], reason: '' } };
      } }, reviewers: [{ id: 'reviewer.fixture', review: p => ({ status: 'PASS', evidence: { ...p.binding,
        reviewerId: 'reviewer.fixture', findings: [], summary: 'Fixed fixture callback, not model review', reason: '' } }) }] } });
  const records = await adapter.settled(); records.forEach(retain);
  assert.equal(report.outcome, 'COMPLETED'); assert.equal(testsRan, 1); assert.equal(records.length, 1);
  assert.deepEqual(adapter.lateObservations(), []); assert(Object.isFrozen(adapter.lateObservations()));
  assert.equal(records[0].expected.binding.runId, report.runId);
  assert.equal(report.stages.find(s => s.stage === 'staticChecks').evidence.candidateFingerprint, records[0].expected.binding.candidateFingerprint);
  assert.equal(readExecutionReceipt(records[0].receipt, records[0].expected).result.status, 'PASS');
});

test('native FAIL stops Nisi before later stages and retains actual failed check explanations', async () => {
  const adapter = createSwiftArtifactStaticAdapter({ build, scope, baseline, path: 'config.json', profileId: 'nisi-json-structure-v1' });
  const noCall = () => { throw new Error('Later stage must not run'); };
  const report = await runWorkflow(task, { candidate: { files: [{ path: 'config.json', content: '{"a":1,"a":2}' }] }, candidateAuthorId: 'author.fixture',
    adapters: { authorizeContext: { authorize: p => ({ status: 'PASS', evidence: { ...p.binding, reason: '' } }) },
      staticChecks: adapter, tests: { run: noCall }, reviewers: [{ id: 'reviewer.fixture', review: noCall }] } });
  const records = await adapter.settled(); records.forEach(retain);
  assert.notEqual(report.outcome, 'COMPLETED');
  assert.equal(report.stages.find(s => s.stage === 'staticChecks').status, 'FAIL');
  assert.match(report.stages.find(s => s.stage === 'staticChecks').evidence.findings[0].message, /duplicate object key/);
  const context = { report, expectations: records.map(r => r.expected) };
  const bundle = createHostRunBundle(context, records.map(r => r.receipt));
  assert.equal(readHostRunBundle(bundle, context).status, 'CONSISTENT');
});

test('Nisi cancellation returns before cleanup but settled collects a compatible observed interruption', async () => {
  const controller = new AbortController();
  const adapter = createSwiftArtifactStaticAdapter({ build, scope, baseline, path: 'config.json', profileId: 'nisi-json-structure-v1' });
  const noCall = () => { throw new Error('Not reached'); };
  const report = await runWorkflow(task, { signal: controller.signal,
    candidate: { files: [{ path: 'config.json', content: '{}' }] }, candidateAuthorId: 'author.fixture',
    adapters: { authorizeContext: { authorize: p => ({ status: 'PASS', evidence: { ...p.binding, reason: '' } }) },
      staticChecks: { check: p => { const pending = adapter.check(p); controller.abort(); return pending; } },
      tests: { run: noCall }, reviewers: [{ id: 'reviewer.fixture', review: noCall }] } });
  const records = await adapter.settled(); records.forEach(retain);
  assert.equal(report.outcome, 'CANCELLED'); assert.equal(records.length, 1);
  assert.equal(records[0].receipt.result.reason, 'ABORTED'); assert.equal(records[0].reservation.released, true);
  const context = { report, expectations: records.map(r => r.expected) };
  assert.equal(readHostRunBundle(createHostRunBundle(context, records.map(r => r.receipt)), context).status, 'CONSISTENT');
});

test('engine deadline after native completion does not rewrite passing raw process evidence', async () => {
  let clock = 0;
  const adapter = createSwiftArtifactStaticAdapter({ build, scope, baseline, path: 'config.json', profileId: 'nisi-json-structure-v1' });
  const noCall = () => { throw new Error('Not reached'); };
  const report = await runWorkflow(task, { clock: () => clock,
    candidate: { files: [{ path: 'config.json', content: '{}' }] }, candidateAuthorId: 'author.fixture',
    adapters: { authorizeContext: { authorize: p => ({ status: 'PASS', evidence: { ...p.binding, reason: '' } }) },
      staticChecks: { check: async p => { const answer = await adapter.check(p); clock = 20_000; return answer; } },
      tests: { run: noCall }, reviewers: [{ id: 'reviewer.fixture', review: noCall }] } });
  const records = await adapter.settled(); records.forEach(retain);
  assert.equal(report.outcome, 'TIMED_OUT'); assert.equal(records[0].receipt.result.status, 'PASS');
  const context = { report, expectations: records.map(r => r.expected) };
  assert.throws(() => createHostRunBundle(context, records.map(r => r.receipt)), e => e.code === 'HOST_STAGE_STATUS_MISMATCH');
  // Legacy v1 stays strict. V2 binds both truths without changing either record.
  const before = JSON.stringify({ report, records });
  const bundle = createHostRunBundleV2(context, records.map(r => r.receipt));
  const disposition = readHostRunBundleV2(bundle, context);
  assert.equal(disposition.outcome, 'TIMED_OUT');
  assert.equal(disposition.rawStatusCounts.PASS, 1);
  assert.equal(disposition.recordedPassCount, 0);
  assert.equal(disposition.unrecordedRawPassCount, 1);
  assert.equal(bundle.entries[0].disposition.kind, 'ENGINE_INTERRUPTED');
  assert.equal(bundle.entries[0].receipt.process.cancelRequested, false);
  assert.equal(JSON.stringify({ report, records }), before);
  fs.writeFileSync(path.join(build.directory, 'two-layer-host-bundle-v2.json'), JSON.stringify({ bundle, disposition }, null, 2));
});

test.after(() => console.log(JSON.stringify({ buildManifest: path.join(build.directory, 'build-manifest.json'),
  observations: path.join(build.directory, 'executor-fixture-observations.json'), count: observations.length,
  nativeScope: 'ONE_FIXED_ARTIFACT_AT_A_TIME', modelReview: false, fullHost: false })));
