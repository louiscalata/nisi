// PRIVATE. Four reviewed, single-site mutations; no model/candidate execution.
// Copies only the local contract test and its three source dependencies into
// task-owned .build evidence directories, retains every output, never deletes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const subject = 'hosts/repository/snapshot-contract.mjs';
const testPath = 'tests/repository-snapshot.test.mjs';
const sources = new Map([subject, testPath, 'workflow/contracts.mjs', 'workflow/engine.mjs']
  .map(file => [file, readFileSync(path.join(root, file), 'utf8')]));
const mutants = [
  ['M01-byte-limit', "if (byteLength > REPOSITORY_SNAPSHOT_LIMITS.maximumFileBytes) refuse('REPOSITORY_CONTENT_LIMIT');", '// MUTANT: byte limit disabled', 'UTF-8 accounting admits exact byte bounds and rejects multibyte overflow'],
  ['M02-factory-identity', "if (!issuedSnapshots.has(input.baseline)) refuse('REPOSITORY_BASELINE_NOT_ISSUED');", '// MUTANT: factory identity check disabled', 'serialized or forged baselines cannot impersonate factory-issued snapshots'],
  ['M03-protected-baseline', "if (!original || original.sha256 !== task.protectedSnapshots[path]) refuse('REPOSITORY_PROTECTED_BASELINE_MISMATCH');", '// MUTANT: protected baseline check disabled', 'all protected baseline files must exist with their fixed digests even if omitted by candidate'],
  ['M04-task-scope', 'checkPaths(task.allowedFiles);', '// MUTANT: task scope profile check disabled', 'repository scope refuses ambiguous or unsupported allowed and protected paths'],
];
mkdirSync(path.join(root, '.build'), { recursive: true });
const evidence = mkdtempSync(path.join(root, '.build/repository-snapshot-mutants-'));
function run(directory) {
  return spawnSync(process.execPath, ['--test', '--test-reporter=tap', testPath], {
    cwd: directory, encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
  });
}
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
const report = {
  schemaVersion: 1, scope: 'FOUR_TARGETED_REPOSITORY_SNAPSHOT_MUTANTS_ONLY',
  nodeVersion: process.version, platform: process.platform, architecture: process.arch,
  controlExitCode: control.status, evidenceDirectory: evidence,
  sourceHashes: [...sources].map(([file, source]) => ({ file, sha256: createHash('sha256').update(source).digest('hex') })),
  results, candidateExecutionVerified: false, legalClearance: false,
};
writeFileSync(path.join(evidence, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (results.some(result => !result.caught)) process.exitCode = 1;
