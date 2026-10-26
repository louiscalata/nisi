// Private, bounded mutation checks. Only these reviewed substitutions execute.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = readFileSync(path.join(root, 'scripts/verify-veritas-import.mjs'), 'utf8');
const tests = readFileSync(path.join(root, 'tests/veritas-import.test.mjs'), 'utf8');
const mutations = [
  ['M01-digest-disabled', 'observed.bytes !== expected.bytes || observed.sha256 !== expected.sha256', 'observed.bytes !== expected.bytes', 'import refuses same-size content edit'],
  ['M02-inventory-guard-disabled', "if (JSON.stringify(actual.files.map(file => file.path)) !== JSON.stringify(manifest.files.map(file => file.path))) fail('IMPORT_INVENTORY_DRIFT');", "if (actual.files.length < manifest.files.length) fail('IMPORT_INVENTORY_DRIFT');", 'import refuses new source'],
  ['M03-schema-version-accepted', 'manifest.schemaVersion !== 1 ||', 'false ||', 'import refuses wrong schema'],
  ['M04-authority-field-accepted', "exact(manifest, ['schemaVersion', 'purpose', 'frozenAt', 'source', 'roots', 'exclusionPolicy', 'files'], 'IMPORT_MANIFEST_SCHEMA');", '// MUTANT: unknown authority fields accepted', 'import refuses unknown authority field'],
];
mkdirSync(path.join(root, '.build'), { recursive: true });
const evidence = mkdtempSync(path.join(root, '.build/import-mutants-'));
const control = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'tests/veritas-import.test.mjs'], {
  cwd: root, timeout: 30_000, maxBuffer: 1024 * 1024, encoding: 'utf8',
});
writeFileSync(path.join(evidence, 'control-stdout.txt'), control.stdout ?? '');
writeFileSync(path.join(evidence, 'control-stderr.txt'), control.stderr ?? '');
assert(!control.error && control.status === 0 && /^# fail 0$/m.test(control.stdout), 'Unmodified control must pass before mutation');
const results = [];
for (const [id, from, to, expectedFailure] of mutations) {
  assert.equal(source.split(from).length, 2, `${id}: substitution no longer uniquely matches`);
  const folder = path.join(evidence, id);
  mkdirSync(path.join(folder, 'scripts'), { recursive: true });
  mkdirSync(path.join(folder, 'tests'));
  writeFileSync(path.join(folder, 'scripts/verify-veritas-import.mjs'), source.replace(from, to));
  writeFileSync(path.join(folder, 'tests/veritas-import.test.mjs'), tests);
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'tests/veritas-import.test.mjs'], {
    cwd: folder, timeout: 30_000, maxBuffer: 1024 * 1024, encoding: 'utf8',
  });
  writeFileSync(path.join(folder, 'stdout.txt'), run.stdout ?? '');
  writeFileSync(path.join(folder, 'stderr.txt'), run.stderr ?? '');
  const failed = Number(run.stdout?.match(/^# fail (\d+)$/m)?.[1] ?? NaN);
  const failures = [...(run.stdout ?? '').matchAll(/^not ok \d+ - (.+)$/gm)].map(match => match[1]);
  results.push({ id, exitCode: run.status, failedChecks: Number.isFinite(failed) ? failed : null, failures,
    caught: !run.error && run.status !== 0 && failed === 1 && failures.length === 1 && failures[0] === expectedFailure });
}
const report = { scope: 'FOUR_TARGETED_IMPORT_READER_MUTANTS_ONLY', source: 'scripts/verify-veritas-import.mjs', results, evidenceDirectory: evidence };
writeFileSync(path.join(evidence, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (results.some(result => !result.caught)) process.exitCode = 1;
