// Owner-reviewed semantic mutation checks on an already-verified isolated stage.
// Never touches canonical source or the candidate. Mutated code remains local.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const base = path.dirname(fileURLToPath(import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const checkpoint = process.argv[2];
assert(/^checks-[A-Za-z0-9]+$/.test(checkpoint ?? ''), 'supply one retained local checkpoint name');
const receiptPath = path.join(base, checkpoint, 'checks.json');
const receiptBytes = fs.readFileSync(receiptPath), receipt = JSON.parse(receiptBytes);
assert.equal(receipt.ok, true, 'mutation seed must have passing behavior and unchanged files');
const output = fs.mkdtempSync(path.join(base, 'mutations-'));
const stage = path.join(output, 'source');
const seed = path.join(base, checkpoint, 'source');
fs.cpSync(seed, stage, { recursive: true, dereference: false,
  filter: file => !path.relative(seed, file).split(path.sep).includes('.packet-diagnostics') });
const file = 'hosts/repository/native-incident-admission-v1.mjs', target = path.join(stage, file);
const original = fs.readFileSync(target, 'utf8');
assert.equal(hash(original), receipt.candidateHashes[file]);
const mutations = [
  ['alias-digest', 'admissionDigest = state.admissionDigest;', 'admissionDigest = handleDigest(top.admission);'],
  ['reuse-handle', "if (state.consumed) refuse('ADMISSION_CONSUMED');", "if (false) refuse('ADMISSION_CONSUMED');"],
  ['reverse-clock', "if (top.now < state.admittedAt) refuse('ADMISSION_CLOCK_REVERSED');", "if (false) refuse('ADMISSION_CLOCK_REVERSED');"],
  ['raw-stream-hash', "if (bytes.length !== stream.capturedBytes || hashBytes(bytes) !== stream.sha256) refuse('FRESH_OBSERVATION_MISMATCH');", "if (false) refuse('FRESH_OBSERVATION_MISMATCH');"],
  ['paired-request', 'fresh.requestSha256 !== expectedReport.requestSha256 ||', 'false ||'],
  ['grant-executable', "if (grant.executableSha256 !== executionIdentity.executableSha256) refuse('GRANT_EXECUTABLE_MISMATCH');", "if (false) refuse('GRANT_EXECUTABLE_MISMATCH');"]
];
const checks = [];
function run(name, text, shouldPass) {
  fs.writeFileSync(target, text);
  try {
    const args = ['--test-reporter=tap', '--test-concurrency=1', '--test',
      'work-orders/v02-finish-cluster-v1/native-incident/admission-integration.test.mjs'];
    const result = spawnSync(process.execPath, args, { cwd: stage, encoding: 'utf8',
      timeout: 60000, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024 });
    const log = (result.stdout ?? '') + (result.stderr ?? '');
    fs.writeFileSync(path.join(output, name + '.log'), log, { flag: 'wx' });
    const counts = Object.fromEntries(['tests', 'pass', 'fail', 'skipped', 'cancelled', 'todo'].map(key =>
      [key, Number(log.match(new RegExp('^# ' + key + ' (\\d+)$', 'm'))?.[1] ?? -1)]));
    const clean = !result.error && !result.signal && counts.tests > 0 && counts.skipped === 0 && counts.cancelled === 0 && counts.todo === 0;
    const ok = clean && (shouldPass ? result.status === 0 && counts.fail === 0 && counts.pass === counts.tests :
      result.status === 1 && counts.fail > 0 && /code: 'ERR_ASSERTION'/.test(log));
    checks.push({ name, shouldPass, command: [process.execPath, ...args], sourceSha256: hash(text),
      exitCode: result.status, error: result.error?.code ?? null, signal: result.signal, counts, logSha256: hash(log), ok });
    console.log(JSON.stringify({ name, counts, ok }));
  } finally { fs.writeFileSync(target, original); }
}
run('control-before', original, true);
for (const [name, from, to] of mutations) {
  assert.equal(original.split(from).length, 2, `exact mutation target: ${name}`);
  run(name, original.replace(from, to), false);
}
run('control-after', original, true);
const restored = hash(fs.readFileSync(target)) === hash(original);
const candidateUnchanged = Object.entries(receipt.candidateHashes).every(([name, sha]) =>
  hash(fs.readFileSync(path.join(base, 'candidate', name))) === sha);
const result = { checkpoint, checkpointSha256: hash(receiptBytes), output, checks, restored, candidateUnchanged,
  implementationAccepted: false, nativeRerun: 'NOT_RUN', inference: 'NOT_RUN',
  ok: restored && candidateUnchanged && checks.every(item => item.ok) };
fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, ok: result.ok }));
if (!result.ok) process.exitCode = 1;
