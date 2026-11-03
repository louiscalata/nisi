import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { runExample, runExampleTests } from '../examples/workflow.mjs';

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

test('example assertions treat candidate source as data without executing it', async () => {
  globalThis.nisiExampleExecuted = false;
  try {
    const result = await runExampleTests({ candidate: { files: [{ path: 'answer.mjs', content: 'globalThis.nisiExampleExecuted = true; export const answer = 42;' }] }, binding: {} });
    assert.equal(globalThis.nisiExampleExecuted, false);
    assert.equal(result.status, 'FAIL');
    const valid = await runExampleTests({ candidate: { files: [{ path: 'answer.mjs', content: 'export const answer = 42;\n' }] }, binding: {} });
    assert.equal(valid.status, 'PASS');
  } finally { delete globalThis.nisiExampleExecuted; }
});

test('demo can remove its temporary report after verified storage', async () => {
  const { report, directory } = await runExample({ keepReport: false });
  try {
    assert.equal(report.reportStored, true);
    await assert.rejects(fs.stat(directory), { code: 'ENOENT' });
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
