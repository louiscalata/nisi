import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runExample } from '../examples/workflow.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

// pnpm, npm link, `npm install <folder>` and macOS /tmp all reach files through
// symlinks. Each entrypoint must still run rather than exit 0 without output.
test('example and benchmark entrypoints run when invoked through a symlinked path', t => {
  const entrypoints = ['examples/workflow.mjs', 'examples/local-model-workflow.mjs', 'benchmarks/value/run.mjs',
    'benchmarks/value/interop.mjs', 'benchmarks/value/overhead.mjs', 'benchmarks/value/live-pilot.mjs'];
  const temp = mkdtempSync(path.join(os.tmpdir(), 'nisi-entry-link-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const scratch = path.join(temp, 'tmp');
  mkdirSync(scratch);
  try {
    for (const file of entrypoints) symlinkSync(path.join(root, file), path.join(temp, path.basename(file)), 'file');
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
      t.skip(`Windows symlink creation unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  const run = (file, args = []) => spawnSync(process.execPath, [path.join(temp, path.basename(file)), ...args], {
    cwd: temp, encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
    env: { ...process.env, TMPDIR: scratch, TMP: scratch, TEMP: scratch },
  });

  const workflow = run('examples/workflow.mjs');
  assert.equal(workflow.status, 0, workflow.stderr);
  assert.equal(JSON.parse(workflow.stdout).outcome, 'COMPLETED');

  const local = run('examples/local-model-workflow.mjs', ['https://127.0.0.1/x', 'draft', 'review']);
  assert.equal(local.status, 2);
  assert.equal(local.stdout, '');
  assert.match(local.stderr, /^Invalid local chat configuration \(LOCAL_CHAT_DESTINATION_REFUSED\)\./);
  assert.match(local.stderr, /Usage: node examples\/local-model-workflow\.mjs/);

  for (const [file, usage] of [
    ['benchmarks/value/run.mjs', /Usage: node benchmarks\/value\/run\.mjs <new-output-directory>/],
    ['benchmarks/value/interop.mjs', /Usage: node benchmarks\/value\/interop\.mjs <new-output-directory>/],
    ['benchmarks/value/overhead.mjs', /Usage: node benchmarks\/value\/overhead\.mjs <new-output-directory>/],
    ['benchmarks/value/live-pilot.mjs', /USAGE: --allow-live <loopback-endpoint> <model> <output-file> <task-id\|all>/],
  ]) {
    const result = run(file);
    assert.equal(result.status, 1, `${file}: ${result.stderr}`);
    assert.match(result.stderr, usage, file);
  }
});
