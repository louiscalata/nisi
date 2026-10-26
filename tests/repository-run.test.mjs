// Real engine/identity contracts; synthetic Swift and Node process observations.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stableStringify, sha256Text } from '../workflow/contracts.mjs';
import { createRepositorySnapshot, prepareRepositoryCandidate } from '../hosts/repository/snapshot-contract.mjs';
import { createSwiftCheckPlanV1 } from '../hosts/swift-verifier/check-plan-v1.mjs';
import { createSwiftStaticGroupV1 } from '../receipts/swift-static-group-v1.mjs';
import { registerReviewedNodeSuiteV1 } from '../hosts/repository/node-suite-v1.mjs';
import { createRepositoryRunBundleV1 as create, readRepositoryRunBundleV1 as read } from '../receipts/repository-run-v1.mjs';
import { combinedFixture, targetsFor, syntheticNode } from './helpers/repository-run-fixture.mjs';
import { passing, failing } from './helpers/node-repository-fixture.mjs';
import { entry, profile } from './helpers/swift-group-fixture.mjs';
const rehash = b => { const { fingerprint, ...body } = b; return { ...body, fingerprint: sha256Text('nisi/repository-run/v1\0' + stableStringify(body)) }; };

test('combined record links both lanes and fresh final candidate after repair', async t => {
  const { context: c } = await combinedFixture(t), b = create(c), r = read(b, c);
  assert.equal(c.report.outcome, 'COMPLETED'); assert.equal(r.staticSummary.groupCount, 2);
  assert.equal(r.testCount, 2); assert.equal(r.rawTestCounts.FAIL, 1); assert.equal(r.rawTestCounts.PASS, 1);
  assert.equal(r.recordedTestPasses, 1); assert.equal(r.finalChecksRecordedPass, true);
  assert.equal(r.preparationFingerprint, c.preparation.fingerprint);
  for (const key of ['executionVerified', 'authorizing', 'certificationGranted']) assert.equal(r[key], false);
  assert.equal(b.sandboxed, false); assert.equal(b.noDescendantsEnforced, false); assert(Object.isFrozen(b.testEntries[0].execution));
});
test('test stage inventory permits an attempt skipped after static failure', async t => {
  const { context: c } = await combinedFixture(t, { skipFirst: true }), r = read(create(c), c);
  assert.equal(c.report.outcome, 'COMPLETED'); assert.equal(r.staticSummary.groupCount, 2); assert.equal(r.testCount, 1);
  assert.equal(c.executions[0].expected.binding.attempt, 1); assert.equal(r.finalChecksRecordedPass, true);
});
for (const interrupt of ['deadline', 'abort']) test('raw Node PASS survives engine ' + interrupt + ' without accepted credit', async t => {
  const { context: c } = await combinedFixture(t, { interrupt }), b = create(c), r = read(b, c);
  assert.equal(r.outcome, interrupt === 'abort' ? 'CANCELLED' : 'TIMED_OUT'); assert.equal(r.rawTestCounts.PASS, 1);
  assert.equal(r.recordedTestPasses, 0); assert.equal(r.unrecordedRawTestPasses, 1); assert.equal(r.interruptedTests, 1);
  assert.equal(r.finalChecksRecordedPass, false); assert.equal(b.testEntries[0].disposition.kind, 'ENGINE_INTERRUPTED');
  const bad = structuredClone(b); bad.testEntries[0].disposition.kind = 'RESULT_RECORDED';
  assert.throws(() => read(rehash(bad), c), { code: 'REPOSITORY_RUN_MISMATCH' });
});
test('outer Node host failure preserves raw PASS but normal UNAVAILABLE engine result', async t => {
  const { context: c } = await combinedFixture(t, { outerFailure: true }), r = read(create(c), c);
  assert.equal(r.outcome, 'BLOCKED'); assert.equal(r.rawTestCounts.PASS, 1); assert.equal(r.recordedTestPasses, 0);
  assert.equal(r.finalChecksRecordedPass, false); assert.equal(r.unrecordedRawTestPasses, 1);
});
test('complete workflow and storage failure remain separate from recorded passing checks', async t => {
  const { context: c } = await combinedFixture(t, { storageFailure: true }), r = read(create(c), c);
  assert.equal(r.workflowOutcome, 'COMPLETED'); assert.equal(r.outcome, 'BLOCKED'); assert.equal(r.reportStoreCode, 'ADAPTER_EXCEPTION');
  assert.equal(r.finalChecksRecordedPass, true); assert.equal(r.recordedTestPasses, 1);
});
test('missing extra duplicate and reordered executions refuse without positional inference', async t => {
  const { context: c } = await combinedFixture(t);
  for (const executions of [[], c.executions.slice(1), [...c.executions, c.executions[0]], [...c.executions].reverse(), [c.executions[0], c.executions[0]]]) {
    assert.throws(() => create({ ...c, executions }));
  }
});
test('serialized originals and forged final preparation cannot become issued evidence', async t => {
  const { context: c } = await combinedFixture(t);
  assert.throws(() => create({ ...c, executions: structuredClone(c.executions) }), { code: 'NODE_EXECUTION_NOT_ISSUED' });
  assert.throws(() => create({ ...c, preparation: structuredClone(c.preparation) }), { code: 'REPOSITORY_RUN_PREPARATION' });
  assert.throws(() => create({ ...c, plans: structuredClone(c.plans) }), { code: 'SWIFT_PLAN_NOT_ISSUED' });
});
test('same candidate cannot join lanes from different baseline or materialized trees', async t => {
  const { c: fixture, context: c } = await combinedFixture(t, { interrupt: 'deadline' }), p = c.preparation;
  // Add an unchanged, out-of-candidate file. The task and candidate stay equal,
  // but the baseline, preparation and materialized identity genuinely change.
  const baseline = createRepositorySnapshot({ files: [...p.baseline.files.map(({ path, content }) => ({ path, content })), { path: 'extra.txt', content: 'different baseline' }] });
  const prep = prepareRepositoryCandidate({ baseline, task: p.task, candidate: { files: p.candidate.files }, authorId: p.candidate.authorId });
  const plan = createSwiftCheckPlanV1({ preparation: prep, runId: c.report.runId, attempt: 0, targets: targetsFor(prep), executionProfile: profile });
  const group = createSwiftStaticGroupV1(plan, plan.targets.map((_, i) => entry(plan, i)));
  const report = structuredClone(c.report), stage = report.stages.find(s => s.stage === 'staticChecks');
  stage.evidence = group.adapterResult.evidence;
  assert.equal(prep.candidateFingerprint, p.candidateFingerprint); assert.notEqual(prep.fingerprint, p.fingerprint);
  const suite = registerReviewedNodeSuiteV1({ ...fixture.registration, preparations: [prep] });
  assert.throws(() => create({ ...c, suite, preparation: prep, plans: [plan], groups: [group], report }), { code: 'REPOSITORY_RUN_CROSS_LANE' });
});
test('test result mismatch is refused before any completion summary', async t => {
  const { context: c } = await combinedFixture(t), report = structuredClone(c.report);
  report.stages.find(s => s.stage === 'tests').evidence.failures[0].message = 'changed evidence';
  assert.throws(() => create({ ...c, report }), { code: 'REPOSITORY_RUN_TEST_RESULT' });
});
test('non-interruption engine exception cannot be repaired into a complete composite', async t => {
  const { context: c } = await combinedFixture(t, { interrupt: 'deadline' }), report = structuredClone(c.report);
  report.outcome = report.workflowOutcome = 'BLOCKED'; report.code = 'ADAPTER_EXCEPTION';
  const s = report.stages.at(-1); s.code = s.evidence.reason = 'ADAPTER_EXCEPTION';
  assert.throws(() => create({ ...c, report }), { code: 'REPOSITORY_RUN_UNRECORDED_ERROR' });
});
test('recomputed outer hashes cannot conceal flags scope raw evidence or full report changes', async t => {
  const { context: c } = await combinedFixture(t), bundle = create(c);
  for (const change of [b => { b.authorizing = true; }, b => { b.scope = 'ALL_CODE'; }, b => { b.reportSha256 = '0'.repeat(64); },
    b => { b.testEntries[0].execution.hostCode = 'different'; }, b => { b.testEntries[0].disposition.stageIndex++; },
    b => { b.report.stages.find(s => s.stage === 'review').evidence.summary = 'substituted'; },
    b => { b.nodeSuiteFingerprint = '0'.repeat(64); }, b => { b.nodeRegistrationFingerprint = '0'.repeat(64); }]) {
    const b = structuredClone(bundle); change(b); assert.throws(() => read(rehash(b), c), { code: 'REPOSITORY_RUN_MISMATCH' });
  }
});
test('declared Node suite and executor registration refuse substituted original executions', async t => {
  const { c: fixture, context: c } = await combinedFixture(t);
  const otherSuite = registerReviewedNodeSuiteV1({ ...fixture.registration, id: 'nisi.node.alternate' });
  for (const [suite, bounds] of [[otherSuite, {}], [fixture.suite, { totalTimeoutMs: 2000 }]]) {
    const node = syntheticNode({ ...fixture, suite }, bounds), executions = [];
    for (const [i, original] of c.executions.entries()) {
      executions.push(await node.execute({ binding: original.expected.binding }, i, i === 0 ? failing() : passing()));
    }
    assert.throws(() => create({ ...c, executions }), { code: 'REPOSITORY_RUN_TEST_CONFIGURATION' });
  }
  assert.throws(() => create({ ...c, suite: structuredClone(c.suite) }), { code: 'NODE_SUITE_NOT_ISSUED' });
  for (const v of [undefined, null, 'bad', 'A'.repeat(64)]) {
    assert.throws(() => create({ ...c, nodeRegistrationFingerprint: v }), { code: 'REPOSITORY_RUN_NODE_CONFIGURATION' });
  }
});
test('configured Node identity is retained even when static failure prevents all behavior tests', async t => {
  const { context: c } = await combinedFixture(t, { staticOnly: true }), bundle = create(c), summary = read(bundle, c);
  assert.equal(c.report.outcome, 'FAILED'); assert.equal(c.executions.length, 0); assert.equal(summary.testCount, 0);
  assert.equal(bundle.nodeSuiteFingerprint, c.suite.fingerprint);
  assert.equal(bundle.nodeRegistrationFingerprint, c.nodeRegistrationFingerprint);
  assert.equal(summary.nodeSuiteFingerprint, c.suite.fingerprint); assert.equal(summary.finalChecksRecordedPass, false);
});
test('composite inventory rejects custom arrays without invoking their accessors or iterators', async t => {
  const { context: c } = await combinedFixture(t); let invoked = 0;
  for (const key of ['plans', 'groups', 'executions']) {
    const values = [...c[key]]; values[Symbol.iterator] = function* () { invoked++; yield* c[key]; };
    assert.throws(() => create({ ...c, [key]: values }));
  }
  assert.equal(invoked, 0);
});
