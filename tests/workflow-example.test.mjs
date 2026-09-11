import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { runExample } from '../examples/workflow.mjs';

test('runnable workflow example executes failing and passing assertions, repairs, reviews and saves its report', async t => {
  const { report, reportPath, directory } = await runExample();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  assert.equal(report.outcome, 'COMPLETED');
  assert.equal(report.repairAttempts, 1);
  const tests = report.stages.filter(stage => stage.stage === 'tests');
  assert.deepEqual(tests.map(stage => stage.status), ['FAIL', 'PASS']);
  assert.deepEqual(tests.map(stage => stage.evidence.assertionsPassed), [1, 2]);
  assert.equal(report.stages.filter(stage => stage.stage === 'review').length, 1);
  assert.equal(report.reportStored, true);
  const saved = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  assert.equal(saved.runId, report.runId);
  assert.equal(saved.outcome, 'COMPLETED');
  assert.equal(report.reportStoreEvidence.evidence.reportSha256, report.storedReportSha256);
});
