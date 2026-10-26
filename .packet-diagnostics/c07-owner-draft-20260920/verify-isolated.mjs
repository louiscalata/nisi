// Owner-only isolated C07 verifier proposal. It stages a read-only tracked
// closure, records before/after hashes, overlays only the reviewed candidate,
// and runs bounded offline Node tests. It does not dispatch native execution.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const base = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(base, '../..');
const candidateRoot = path.join(base, 'candidate');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const candidateFiles = [
  'hosts/repository/native-incident-source-v1.mjs',
  'hosts/repository/native-incident-admission-v1.mjs',
  'work-orders/v02-finish-cluster-v1/native-incident/admission-integration.test.mjs',
  'work-orders/v02-finish-cluster-v1/native-incident/native-incident-source-v1.test.mjs'
];
const reviewFiles = [
  'DESIGN.md',
  'source-contract-gap.md',
  'second-review-before/DESIGN.md',
  'third-review-before/DESIGN.md'
];

for (const file of candidateFiles) {
  const source = path.join(candidateRoot, file);
  assert(fs.existsSync(source), `missing reviewed candidate: ${file}`);
  assert(!path.isAbsolute(file) && !file.split('/').includes('..') && !file.includes('\\'));
}
const listed = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 16 * 1024 * 1024 });
assert.equal(listed.status, 0, listed.stderr);
assert.equal(listed.error, undefined);
assert.equal(listed.signal, null);
const tracked = listed.stdout.split('\0').filter(Boolean);
const output = fs.mkdtempSync(path.join(base, 'checks-'));
const stage = path.join(output, 'source');
fs.mkdirSync(stage, { recursive: true });
const canonicalHashes = Object.create(null);
const stagedBeforeHashes = Object.create(null);
const sourceReadSet = [...new Set(tracked)].sort();

function safeFile(source, target) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) {
    const link = fs.readlinkSync(source);
    assert(!path.isAbsolute(link));
    const resolved = path.resolve(path.dirname(source), link);
    assert(resolved === root || resolved.startsWith(root + path.sep), `escape symlink: ${source}`);
    fs.symlinkSync(link, target);
    return null;
  }
  assert(stat.isFile(), `not a regular file: ${source}`);
  const bytes = fs.readFileSync(source);
  fs.writeFileSync(target, bytes, { flag: 'wx' });
  return hash(bytes);
}

for (const file of sourceReadSet) {
  const canonical = path.join(root, file);
  const target = path.join(stage, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(canonical) && fs.lstatSync(canonical).isFile()) canonicalHashes[file] = hash(fs.readFileSync(canonical));
  if (fs.existsSync(canonical)) stagedBeforeHashes[file] = safeFile(canonical, target);
}
assert(fs.existsSync(path.join(root, 'node_modules')), 'node_modules required for offline staged verification');
fs.symlinkSync(path.join(root, 'node_modules'), path.join(stage, 'node_modules'), 'dir');

const candidateHashes = Object.fromEntries(candidateFiles.map(file => [file, hash(fs.readFileSync(path.join(candidateRoot, file)))]));
const reviewHashes = Object.fromEntries(reviewFiles.filter(file => fs.existsSync(path.join(base, file))).map(file => [file, hash(fs.readFileSync(path.join(base, file)))]));
const checks = [];
function counts(log) {
  return Object.fromEntries(['tests', 'pass', 'fail', 'skipped', 'cancelled', 'todo'].map(key =>
    [key, Number(log.match(new RegExp(`^# ${key} (\\d+)$`, 'm'))?.[1] ?? -1)]));
}
function run(name, args, cwd = stage, timeout = 60000) {
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024 });
  const stdout = result.stdout ?? '', stderr = result.stderr ?? '', log = stdout + stderr;
  fs.writeFileSync(path.join(output, `${name}.log`), log, { flag: 'wx' });
  const c = counts(log);
  const timedOut = result.error?.code === 'ETIMEDOUT';
  const item = {
    name, command: [process.execPath, ...args], cwd, exitCode: result.status,
    error: result.error?.code ?? null, signal: result.signal ?? null, timedOut,
    drain: result.signal === null && !timedOut ? 'CONFIRMED' : 'UNKNOWN', counts: c,
    logSha256: hash(log), ok: result.status === 0 && !result.error && !result.signal &&
      !timedOut && c.tests > 0 && c.pass === c.tests && c.fail === 0 && c.skipped === 0 && c.cancelled === 0 && c.todo === 0
  };
  checks.push(item);
  console.log(JSON.stringify({ name, exitCode: item.exitCode, signal: item.signal, timedOut, counts: c, ok: item.ok }));
}

const baselineSourceTests = [
  'tests/native-incident-source.test.mjs',
  'tests/native-incident-source-host.test.mjs',
  'tests/native-incident-source-boundaries.test.mjs'
];
run('source-regressions', ['--test-reporter=tap', '--test-concurrency=1', '--test', ...baselineSourceTests]);
const baselineStageUnchanged = Object.entries(stagedBeforeHashes).every(([file, expected]) => {
  const target = path.join(stage, file);
  if (expected === null) return fs.lstatSync(target).isSymbolicLink();
  return hash(fs.readFileSync(target)) === expected;
});

// Candidate overlay happens only after the canonical baseline has produced its
// retained log. New target paths are allowed only from the reviewed list.
for (const file of candidateFiles) {
  const source = path.join(candidateRoot, file), target = path.join(stage, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const stat = fs.lstatSync(source);
  assert(stat.isFile(), `candidate must be a regular file: ${file}`);
  fs.writeFileSync(target, fs.readFileSync(source));
}

const workorder = path.join(stage, 'work-orders/v02-finish-cluster-v1');
const pkg = JSON.parse(fs.readFileSync(path.join(workorder, 'package.json'), 'utf8'));
const c07 = pkg.scripts?.['test:c07'];
assert.equal(typeof c07, 'string', 'work-order test:c07 script is required');
const tokens = c07.trim().split(/\s+/);
assert.deepEqual(tokens.slice(0, 2), ['node', '--test'], `unexpected frozen test:c07 command: ${c07}`);
run('c07-candidate', ['--test-reporter=tap', '--test-concurrency=1', ...tokens.slice(1)], workorder);
run('source-identity', ['--test-reporter=tap', '--test-concurrency=1', '--test',
  'native-incident/native-incident-source-v1.test.mjs'], workorder);

const candidateUnchanged = candidateFiles.every(file => hash(fs.readFileSync(path.join(candidateRoot, file))) === candidateHashes[file]);
const canonicalUnchanged = Object.entries(canonicalHashes).every(([file, expected]) =>
  fs.existsSync(path.join(root, file)) && hash(fs.readFileSync(path.join(root, file))) === expected);
const candidateOverlayUnchanged = candidateFiles.every(file => hash(fs.readFileSync(path.join(stage, file))) === candidateHashes[file]);
const dependenciesUnchanged = Object.entries(stagedBeforeHashes).filter(([file]) => !candidateFiles.includes(file)).every(([file, expected]) => {
  const target = path.join(stage, file);
  if (expected === null) return fs.lstatSync(target).isSymbolicLink();
  return hash(fs.readFileSync(target)) === expected;
});
const record = {
  schema: 'nisi-c07-isolated-verifier/v1', at: new Date().toISOString(), node: process.version,
  output, sourceReadSet, candidateHashes, reviewHashes, canonicalHashes, stagedBeforeHashes,
  checks, candidateUnchanged, canonicalUnchanged, baselineStageUnchanged, candidateOverlayUnchanged, dependenciesUnchanged,
  callerSuppliedFixtureOnly: true, nativeRerun: 'NOT_RUN', nativeExecutionAttested: false,
  implementationAccepted: false, nativeBuildAccepted: false, publicationAuthorized: false,
  inference: 'NOT_RUN', ok: candidateUnchanged && canonicalUnchanged && baselineStageUnchanged &&
    candidateOverlayUnchanged && dependenciesUnchanged && checks.every(item => item.ok)
};
fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, ok: record.ok, candidateUnchanged, canonicalUnchanged, baselineStageUnchanged, candidateOverlayUnchanged, dependenciesUnchanged }));
if (!record.ok) process.exitCode = 1;
