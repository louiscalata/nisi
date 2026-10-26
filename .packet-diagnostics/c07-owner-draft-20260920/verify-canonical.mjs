// Owner-only canonical compatibility capture. No model, native launch or acceptance.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const base = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(base, '../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const checkpoint = JSON.parse(fs.readFileSync(path.join(base, 'candidate-checkpoint.json')));
const historicalPath = '.packet-diagnostics/c06-owner-draft-20260920/final-evidence.json';
const historicalBytes = fs.readFileSync(path.join(root, historicalPath));
assert.equal(sha(historicalBytes), '922cfd9585df6ad86eaf252fd17c9b3b94d1f7e681a7d824625e2cbfea3af4ce');
const historical = JSON.parse(historicalBytes);
assert.equal(historical.dependencyHashes[checkpoint.requiredDependencySupersession.path],
  checkpoint.requiredDependencySupersession.oldSha256, 'historical dependency transition mismatch');
const sourceFiles = [...Object.keys(checkpoint.sourceHashes), 'work-orders/v02-finish-cluster-v1/native-incident/README.md'];
const hashFile = file => {
  assert(!path.isAbsolute(file) && !file.includes('\\') && !file.split('/').includes('..'));
  const name = path.join(root, file), stat = fs.lstatSync(name);
  assert(stat.isFile() && !stat.isSymbolicLink(), 'regular source: ' + file);
  assert(fs.realpathSync(name).startsWith(fs.realpathSync(root) + path.sep));
  return sha(fs.readFileSync(name));
};
const sourceHashes = Object.fromEntries(sourceFiles.map(file => [file, hashFile(file)]));
for (const [file, digest] of Object.entries(checkpoint.sourceHashes)) assert.equal(sourceHashes[file], digest, 'reviewed candidate drift');
for (const [file, digest] of Object.entries(historical.sourceHashes)) assert.equal(hashFile(file), digest, 'C06 accepted source drift');
for (const [file, digest] of Object.entries(historical.dependencyHashes)) {
  const expected = file === checkpoint.requiredDependencySupersession.path ? checkpoint.requiredDependencySupersession.newSha256 : digest;
  assert.equal(hashFile(file), expected, 'C06 live dependency drift: ' + file);
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'work-orders/v02-finish-cluster-v1/package.json')));
const journalTests = ['host-journal-bundle', 'host-journal-bundle-baseline', 'run-journal', 'run-journal-baseline',
  'run-journal-store', 'run-journal-store-baseline', 'fixed-run-journal-entry', 'fixed-run-journal-entry-baseline',
  'journal-restart-recovery-boundaries', 'journal-restart-recovery-baseline', 'bundle-restart-demo-baseline',
  'interrupted-run-decision-integration'].map(name => 'tests/' + name + '.test.mjs');
const queue = [...Object.keys(historical.dependencyHashes), ...Object.keys(historical.sourceHashes), ...sourceFiles,
  'tests/native-incident-source.test.mjs', 'tests/native-incident-source-host.test.mjs', 'tests/native-incident-source-boundaries.test.mjs'];
const closure = new Map();
while (queue.length) {
  const file = queue.pop(); if (closure.has(file)) continue;
  closure.set(file, hashFile(file));
  if (!/\.[cm]?js$/.test(file)) continue;
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"\n]+)['"]/g)) {
    if (match[1].startsWith('.')) queue.push(path.relative(root, path.resolve(root, path.dirname(file), match[1])));
  }
  for (const match of text.matchAll(/new URL\(['"]([^'"\n]+)['"],\s*import\.meta\.url\)/g)) {
    const name = path.resolve(root, path.dirname(file), match[1]);
    if (fs.existsSync(name) && fs.statSync(name).isFile()) queue.push(path.relative(root, name));
  }
}
const dependencyHashes = Object.fromEntries([...closure].filter(([file]) => !sourceFiles.includes(file)).sort(([a], [b]) => a.localeCompare(b)));
const priorChecks = JSON.parse(fs.readFileSync(path.join(base, checkpoint.checks.path)));
for (const [file, digest] of Object.entries(dependencyHashes)) assert.equal(priorChecks.canonicalHashes[file], digest, 'dependency differs from reviewed checkpoint: ' + file);
const output = fs.mkdtempSync(path.join(base, 'canonical-')), checks = [];
function run(name, args, relativeCwd, count) {
  const result = spawnSync(process.execPath, args, { cwd: path.join(root, relativeCwd), encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024 });
  const log = (result.stdout ?? '') + (result.stderr ?? '');
  const logPath = path.relative(root, path.join(output, name + '.log'));
  fs.writeFileSync(path.join(root, logPath), log, { flag: 'wx' });
  const counts = Object.fromEntries(['tests', 'pass', 'fail', 'skipped', 'cancelled', 'todo'].map(key => {
    const rows = [...log.matchAll(new RegExp('^# ' + key + ' (\\d+)$', 'gm'))];
    return [key, rows.length === 1 ? Number(rows[0][1]) : -1];
  }));
  const ok = result.status === 0 && !result.error && !result.signal && counts.tests === count && counts.pass === count && counts.fail === 0 && counts.skipped === 0 && counts.cancelled === 0 && counts.todo === 0;
  checks.push({ name, command: [process.execPath, ...args], relativeCwd, exitCode: result.status, error: result.error?.code ?? null, signal: result.signal, counts, logPath, logSha256: sha(log), ok });
  console.log(JSON.stringify({ name, counts, ok }));
}
for (const [name, count] of [['c07', 54], ['c06', 52], ['c05', 111]]) {
  const command = pkg.scripts['test:' + name];
  assert(/^node (--experimental-test-module-mocks )?--test [a-zA-Z0-9./ -]+$/.test(command));
  run(name, ['--test-reporter=tap', '--test-concurrency=1', ...command.split(' ').slice(1)], 'work-orders/v02-finish-cluster-v1', count);
}
run('journal-regressions', ['--test-reporter=tap', '--test-concurrency=1', '--test', ...journalTests], '.', 80);
const unchanged = map => Object.entries(map).every(([file, digest]) => hashFile(file) === digest);
const sourceUnchanged = unchanged(sourceHashes), dependenciesUnchanged = unchanged(dependencyHashes);
const record = { schema: 'nisi.c07.canonical-checks.v1', at: new Date().toISOString(), node: process.version, sourceHashes, dependencyHashes,
  prerequisite: { id: 'C06', evidence: historicalPath, evidenceSha256: sha(historicalBytes) },
  checks, sourceUnchanged, dependenciesUnchanged, implementationAccepted: false, openCodeExecuted: false, nativeBuildAccepted: false,
  nativeExecutionAttested: false, publicationAuthorized: false, sourceAuthenticityAttested: false, resumeGranted: false, inference: 'NOT_RUN',
  ok: sourceUnchanged && dependenciesUnchanged && checks.every(row => row.ok) };
fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, ok: record.ok, dependencyCount: Object.keys(dependencyHashes).length }));
if (!record.ok) process.exitCode = 1;
