// PRIVATE. Five single-site mutations of the pure contract, not a candidate
// runner or native integration test. Each must fail its exact named regression
// after an unmodified passing control. Retain source copies and adverse outputs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const subject = 'receipts/repository-execution-v1.mjs';
const testPath = 'tests/repository-execution-receipt.test.mjs';
const sources = new Map([subject, testPath, 'hosts/repository/snapshot-contract.mjs', 'workflow/contracts.mjs', 'workflow/engine.mjs']
  .map(file => [file, readFileSync(path.join(root, file), 'utf8')]));
const mutants = [
  ['M01-drain', "p.drain === 'CONFIRMED' && p.signal === null", 'p.signal === null',
    'PASS requires confirmed drain even when the child reports exit zero'],
  ['M02-binding', 'Object.keys(binding).some(k => binding[k] !== expected.binding[k])', 'false',
    'receipt identity rejects each cross-run candidate snapshot profile and command substitution'],
  ['M03-final-report', 'bundle.reportSha256 !== context.reportSha256', 'false',
    'bundle binds final report digest not the preliminary store acknowledgement'],
  ['M04-stop-classification', "refuse('HOST_STAGE_STOP_MISMATCH');", 'void 0;',
    'bundle preserves adverse reasons and exact exception cancellation and deadline classifications'],
  ['M05-inventory', "if (inputs.length !== context.expectations.length) refuse('HOST_RECEIPT_INVENTORY');", '// MUTANT: missing receipt inventory allowed',
    'bundle refuses extra missing duplicate reordered and cross-linked receipt inventories'],
];
mkdirSync(path.join(root, '.build'), { recursive: true });
const evidence = mkdtempSync(path.join(root, '.build/repository-receipt-mutants-'));
const run = directory => spawnSync(process.execPath, ['--test', '--test-reporter=tap', testPath], {
  cwd: directory, encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
});
function retain(directory, result) {
  writeFileSync(path.join(directory, 'stdout.txt'), result.stdout ?? '');
  writeFileSync(path.join(directory, 'stderr.txt'), result.stderr ?? '');
}
const control = run(root); retain(evidence, control);
assert(!control.error && control.status === 0 && /^# fail 0$/m.test(control.stdout), 'Unmodified control must pass');
const results = [];
for (const [id, from, to, expectedFailure] of mutants) {
  assert.equal(sources.get(subject).split(from).length, 2, `${id}: exactly one mutation site required`);
  const directory = path.join(evidence, id);
  for (const [file, content] of sources) {
    const destination = path.join(directory, file);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, file === subject ? content.replace(from, to) : content);
  }
  const result = run(directory); retain(directory, result);
  const failed = Number(result.stdout?.match(/^# fail (\d+)$/m)?.[1] ?? NaN);
  const failures = [...(result.stdout ?? '').matchAll(/^not ok \d+ - (.+)$/gm)].map(m => m[1]);
  results.push({ id, expectedFailure, exitCode: result.status, signal: result.signal,
    errorCode: result.error?.code ?? null, failedChecks: Number.isFinite(failed) ? failed : null, failures,
    caught: !result.error && result.signal === null && result.status === 1 && failed === 1 &&
      failures.length === 1 && failures[0] === expectedFailure });
}
const report = { schemaVersion: 1, scope: 'FIVE_TARGETED_REPOSITORY_RECEIPT_MUTANTS_ONLY',
  nodeVersion: process.version, platform: process.platform, architecture: process.arch,
  controlExitCode: control.status, evidenceDirectory: evidence,
  sourceHashes: [...sources].map(([file, source]) => ({ file, sha256: createHash('sha256').update(source).digest('hex') })),
  results, candidateExecutionVerified: false, legalClearance: false };
writeFileSync(path.join(evidence, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (results.some(result => !result.caught)) process.exitCode = 1;
