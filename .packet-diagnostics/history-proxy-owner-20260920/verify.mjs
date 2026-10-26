import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';

const root = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(root, '../..');
const sourceFiles = ['history/journal-owner-v2.mjs', 'history/run-journal-v1.mjs',
  'history/run-journal-store-v1.mjs', 'tests/journal-owner-v2.helper.mjs',
  'tests/journal-owner-v2.memfs.mjs', 'tests/journal-maintenance-v1.test.mjs',
  'tests/journal-owner-v2.test.mjs', 'tests/run-journal.test.mjs', 'tests/run-journal-store.test.mjs'];
const candidateFiles = [...sourceFiles, 'tests/journal-proxy-boundaries.test.mjs'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const snapshot = (base, files) => Object.fromEntries(files.map(file => {
  const name = path.join(base, file), stat = fs.lstatSync(name);
  assert(stat.isFile() && !stat.isSymbolicLink());
  return [file, hash(fs.readFileSync(name))];
}));
const initial = {canonical: snapshot(repository, sourceFiles),
  before: snapshot(path.join(root, 'before'), candidateFiles),
  candidate: snapshot(path.join(root, 'candidate'), candidateFiles)};
for (const file of sourceFiles) assert.equal(initial.canonical[file], initial.before[file], `baseline drift: ${file}`);
const output = fs.mkdtempSync(path.join(root, 'checks-'));
const results = [];
function run(name, variant, files) {
  const cwd = path.join(root, variant);
  const args = ['--test-reporter=tap', '--test-concurrency=1', '--test', ...files];
  const result = spawnSync(process.execPath, args, {cwd, encoding: 'utf8', timeout: 20000,
    maxBuffer: 2 * 1024 * 1024, env: {PATH: path.dirname(process.execPath), HOME: process.env.HOME, LANG: 'C'}});
  const stdout = result.stdout ?? '', stderr = result.stderr ?? '';
  fs.writeFileSync(path.join(output, name + '.stdout.log'), stdout, {flag: 'wx', mode: 0o600});
  fs.writeFileSync(path.join(output, name + '.stderr.log'), stderr, {flag: 'wx', mode: 0o600});
  const counts = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(key => {
    const found = [...stdout.matchAll(new RegExp('^# ' + key + ' (\\d+)$', 'gm'))];
    assert.equal(found.length, 1, `${name}: one ${key} counter`);
    return [key, Number(found[0][1])];
  }));
  results.push({name, command: [process.execPath, ...args], cwd, exitCode: result.status,
    signal: result.signal, error: result.error?.message ?? null, counts,
    stdoutSha256: hash(stdout), stderrSha256: hash(stderr)});
  return results.at(-1);
}
const existingTests = ['tests/journal-maintenance-v1.test.mjs', 'tests/journal-owner-v2.test.mjs',
  'tests/run-journal.test.mjs', 'tests/run-journal-store.test.mjs'];
run('before-existing', 'before', existingTests);
run('before-new-regressions', 'before', ['tests/journal-proxy-boundaries.test.mjs']);
run('candidate-existing', 'candidate', existingTests);
run('candidate-new-regressions', 'candidate', ['tests/journal-proxy-boundaries.test.mjs']);
const final = {canonical: snapshot(repository, sourceFiles),
  before: snapshot(path.join(root, 'before'), candidateFiles),
  candidate: snapshot(path.join(root, 'candidate'), candidateFiles)};
const unchanged = JSON.stringify(initial) === JSON.stringify(final);
const clean = row => row.exitCode === 0 && row.signal === null && row.error === null
  && row.counts.tests > 0 && row.counts.pass === row.counts.tests
  && ['fail', 'cancelled', 'skipped', 'todo'].every(key => row.counts[key] === 0);
const [oldExisting, oldRegression, newExisting, newRegression] = results;
const passed = unchanged && clean(oldExisting) && clean(newExisting) && clean(newRegression)
  && oldRegression.exitCode === 1 && oldRegression.error === null && oldRegression.signal === null
  && oldRegression.counts.fail > 0 && ['cancelled', 'skipped', 'todo'].every(key => oldRegression.counts[key] === 0);
const report = {schema: 'nisi.history-proxy-owner-check/v1', scope: 'ISOLATED_NODE_HISTORY_PROXY_BOUNDARIES',
  node: process.version, runtimeSha256: hash(fs.readFileSync(process.execPath)),
  checkedAt: new Date().toISOString(), initial, final, unchanged, results,
  passed, implementationAccepted: false, nativeBuildAccepted: false, publicationAuthorized: false,
  inference: 'NOT_RUN', canonicalIntegration: 'NOT_RUN'};
fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify(report, null, 2) + '\n', {flag: 'wx', mode: 0o600});
console.log(JSON.stringify({output, passed, unchanged, results}, null, 2));
if (!passed) process.exitCode = 1;
