// PRIVATE real-fixture mutation checks. Only copied controlled source is changed;
// no model/candidate execution. Tests remove only their synthetic mkdtemp roots.
// This harness retains exact source, control and adverse mutant outputs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const subject = 'hosts/repository/disk-capture.mjs';
const testPath = 'tests/repository-disk-capture.test.mjs';
const sources = new Map([subject, testPath, 'hosts/repository/snapshot-contract.mjs', 'workflow/contracts.mjs']
  .map(file => [file, readFileSync(path.join(root, file), 'utf8')]));
const mutants = [
  ['M01-hardlink', "if (stat.nlink !== 1n) refuse('DISK_CAPTURE_HARDLINK');", '// MUTANT: hardlinks admitted',
    'directories FIFOs and multiply linked files are refused before any content open'],
  ['M02-bom', 'fatal: true, ignoreBOM: true', 'fatal: true, ignoreBOM: false',
    'empty files and UTF-8 BOM bytes are preserved without normalization'],
  ['M03-final-drift', "if (!matches(original.stat, stat)) refuse('DISK_CAPTURE_CHANGED');", '// MUTANT: final drift ignored',
    'final pass detects a previously read file changed while a later file was read'],
  ['M04-close-uncertainty', "failure = new RepositoryCaptureError('DISK_CAPTURE_CLOSE_UNCONFIRMED', { priorCode: failure?.code ?? null });", 'void 0;',
    'close uncertainty refuses capture and retains a primary read refusal without inventing closure'],
];
mkdirSync(path.join(root, '.build'), { recursive: true });
const evidence = mkdtempSync(path.join(root, '.build/repository-disk-mutants-'));
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
const report = { schemaVersion: 1, scope: 'FOUR_TARGETED_DISK_CAPTURE_MUTANTS_ONLY',
  nodeVersion: process.version, platform: process.platform, architecture: process.arch,
  controlExitCode: control.status, evidenceDirectory: evidence,
  sourceHashes: [...sources].map(([file, source]) => ({ file, sha256: createHash('sha256').update(source).digest('hex') })),
  results, realFixtureIO: true, candidateExecutionVerified: false, hostileTreeContainment: false, legalClearance: false };
writeFileSync(path.join(evidence, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (results.some(result => !result.caught)) process.exitCode = 1;
