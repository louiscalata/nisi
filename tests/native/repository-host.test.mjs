// PRIVATE actual fixed Swift checker and inspected Node retry fixture only.
// Fixed author/reviewer callbacks: no model inference or arbitrary-code approval.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildNativeArtifactKernel } from '../../hosts/swift-verifier/build.mjs';
import { createReviewedRepositoryHostV1 } from '../../hosts/repository/reviewed-workflow-v1.mjs';
import { readRepositoryRunBundleV1 } from '../../receipts/repository-run-v1.mjs';
import { context } from '../helpers/node-repository-fixture.mjs';
import { fixedOptions, targetsFor } from '../helpers/repository-run-fixture.mjs';

const build = buildNativeArtifactKernel(), artifacts = [];
const retain = (name, value) => {
  const file = path.join(build.directory, name + '.json');
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); artifacts.push(file);
};
async function fixture() {
  // Retain these uniquely owned trees with the receipt. Never remove a tree on
  // a test failure before we have independently confirmed process settlement.
  const c = await context({ after() {} });
  const host = createReviewedRepositoryHostV1({ suite: c.suite, build,
    scope: 'operator-exclusive-static-local-v1', targets: targetsFor(c.preparations[0]),
    parentRoot: c.parent, staticTimeoutMs: 5000, totalTestTimeoutMs: 10000,
    testTimeoutMs: 5000, closeGraceMs: 500 });
  return { c, host };
}

test('real combined host checks both candidates, repairs the fixed defect, and proposes only the accepted change', async () => {
  const { c, host } = await fixture(), before = c.baseline.fingerprint;
  const report = await host.run(fixedOptions(c)), result = await host.settled();
  assert.equal(report.outcome, 'COMPLETED'); assert.equal(report.repairAttempts, 1);
  assert.equal(result.report, report); assert.equal(result.state, 'SETTLED');
  assert.equal(result.bundleError, null); assert.deepEqual({ ...result.ownerStates }, { staticChecks: 'IDLE', tests: 'IDLE' });
  assert.equal(result.staticHistory.length, 2); assert.equal(result.testHistory.length, 2);
  assert.deepEqual(result.invocations.map(i => [i.stage, i.binding.attempt, i.state]),
    [['staticChecks', 0, 'RETURNED'], ['tests', 0, 'RETURNED'], ['staticChecks', 1, 'RETURNED'], ['tests', 1, 'RETURNED']]);
  assert.deepEqual(result.testHistory.map(h => h.execution.receipt.result.status), ['FAIL', 'PASS']);
  assert.deepEqual(result.testHistory.map(h => h.adapterResult.evidence.assertionsPassed), [8, 10]);
  assert.notEqual(result.testHistory[0].workspace.root, result.testHistory[1].workspace.root);
  for (const [attempt, h] of result.staticHistory.entries()) {
    assert.equal(h.observations.length, 4);
    assert.equal(h.group.aggregate.status, 'PASS');
    const n = result.testHistory[attempt];
    for (const key of ['runId', 'taskFingerprint', 'attempt', 'candidateFingerprint', 'baselineFingerprint', 'materializedFingerprint', 'preparationFingerprint']) {
      assert.equal(h.plan.binding[key], n.execution.expected.binding[key]);
    }
    for (const o of h.observations) {
      assert.equal(o.receipt.process.started, true); assert.equal(o.receipt.process.closed, true);
      assert.equal(o.receipt.process.drain, 'CONFIRMED'); assert.equal(o.reservation.released, true);
    }
    assert.equal(n.execution.receipt.process.closed, true); assert.equal(n.execution.receipt.process.drain, 'CONFIRMED');
    for (const file of c.baseline.files.filter(f => f.path !== 'retry-settings.mjs')) {
      assert.equal(fs.readFileSync(path.join(n.workspace.root, file.path), 'utf8'), file.content);
    }
  }
  const originalContext = { report, preparation: c.preparations[1], suite: c.suite,
    nodeRegistrationFingerprint: result.bundleSummary.nodeRegistrationFingerprint, plans: result.staticHistory.map(h => h.plan),
    groups: result.staticHistory.map(h => h.group), executions: result.testHistory.map(h => h.execution) };
  assert.deepEqual(readRepositoryRunBundleV1(result.bundle, originalContext), result.bundleSummary);
  assert.equal(result.bundleSummary.recordedTestPasses, 1); assert.equal(result.bundleSummary.finalChecksRecordedPass, true);
  assert.equal(result.proposedChanges.changes.length, 1);
  assert.equal(result.proposedChanges.bundleFingerprint, result.bundle.fingerprint);
  assert.equal(result.proposedChanges.reportSha256, result.bundle.reportSha256);
  assert.equal(result.proposedChanges.changes[0].path, 'retry-settings.mjs');
  assert.equal(result.proposedChanges.changes[0].kind, 'MODIFY');
  assert.equal(result.proposedChanges.changes[0].before.content, c.preparations[0].candidate.files[0].content);
  assert.equal(result.proposedChanges.changes[0].after.content, c.preparations[1].candidate.files[0].content);
  for (const key of ['applied', 'sandboxed', 'authorizing', 'certificationGranted']) assert.equal(result[key], false);
  assert.equal(c.baseline.fingerprint, before);
  assert.throws(() => host.run(fixedOptions(c)), e => e.code === 'REPOSITORY_HOST_ALREADY_USED');
  retain('combined-native-repair', { scope: 'FIXED_SOURCE_REVIEWED_SWIFT_NODE_FIXTURE', parentRoot: c.parent,
    result, modelInference: false, independentReviewer: false, liveModelBenchmark: false, fullMerger: false });
});

test('real checks remain recorded but late fixture review cannot produce an accepted proposal', async () => {
  const { c, host } = await fixture(), options = fixedOptions(c); let clock = 0;
  const review = options.reviewers[0].review;
  options.reviewers[0].review = p => { const result = review(p); clock = c.task.policy.totalDeadlineMs; return result; };
  const report = await host.run({ ...options, clock: () => clock }), result = await host.settled();
  assert.equal(report.outcome, 'TIMED_OUT'); assert.equal(report.code, 'DEADLINE_EXCEEDED');
  assert.equal(result.state, 'SETTLED'); assert.equal(result.bundleError, null);
  assert.equal(result.bundleSummary.rawTestCounts.PASS, 1); assert.equal(result.bundleSummary.recordedTestPasses, 1);
  assert.equal(result.bundleSummary.finalChecksRecordedPass, true); assert.equal(result.proposedChanges, null);
  assert.equal(result.report, report);
  retain('combined-native-review-timeout', { scope: 'REAL_CHECKS_SYNTHETIC_REVIEW_CLOCK', parentRoot: c.parent, result });
});

test.after(() => console.log(JSON.stringify({ buildManifest: path.join(build.directory, 'build-manifest.json'),
  artifacts, scope: 'FIXED_SOURCE_REVIEWED_SWIFT_NODE_FIXTURE', nativeApp: false, modelInference: false, fullMerger: false })));
