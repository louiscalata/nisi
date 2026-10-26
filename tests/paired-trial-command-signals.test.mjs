import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { inspectPairedTrialEventStoreV1 } from '../history/paired-trial-event-store-v1.mjs';
const root = fs.realpathSync(path.resolve(import.meta.dirname, '..'));
function bounded(promise, duration, code) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(code)), duration); })])
    .finally(() => clearTimeout(timer));
}

for (const signal of ['SIGINT', 'SIGTERM']) test(`real owned child ${signal} yields durable stopped evidence and closes normally`, async t => {
  const parent = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'nisi-command-signal-'));
  const identity = fs.lstatSync(parent), nonce = randomBytes(16).toString('hex');
  const child = spawn(process.execPath, [path.join(root, 'tests/helpers/paired-trial-command-child.mjs'), parent, nonce], {
    cwd: parent, env: { PATH: process.env.PATH, HOME: parent, TMPDIR: parent }, stdio: ['ignore', 'pipe', 'pipe'], detached: false,
  });
  let closed = false, bad = null, stdout = '', stderr = '', resolveReady, rejectReady, readySeen = false;
  const ready = new Promise((a, b) => { resolveReady = a; rejectReady = b; });
  const terminal = new Promise(resolve => child.once('close', (code, terminationSignal) => {
    closed = true; resolve({ code, signal: terminationSignal });
    if (!readySeen) rejectReady(Error('TEST_CHILD_CLOSED_BEFORE_READY'));
  }));
  const refuse = code => { bad ??= code; rejectReady(Error(code)); if (!closed) child.kill('SIGKILL'); };
  child.once('error', () => refuse('TEST_CHILD_ERROR'));
  child.stdout.on('data', bytes => {
    if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) + bytes.length > 8192) { refuse('TEST_OUTPUT_LIMIT'); return; }
    stdout += bytes.toString('utf8');
    if (!readySeen && stdout.includes('\n')) {
      try { const frame = JSON.parse(stdout.slice(0, stdout.indexOf('\n'))); readySeen = true; resolveReady(frame); }
      catch { refuse('TEST_READY_INVALID'); }
    }
  });
  child.stderr.on('data', bytes => { if (Buffer.byteLength(stderr) + bytes.length <= 8192) stderr += bytes.toString('utf8'); refuse('TEST_STDERR'); });
  t.after(async () => {
    if (!closed) child.kill('SIGKILL');
    await bounded(terminal, 3000, 'TEST_CLOSE_UNCONFIRMED_WORKSPACE_RETAINED');
    assert.equal(closed, true);
    const current = fs.lstatSync(parent);
    assert(current.isDirectory() && !current.isSymbolicLink()); assert.equal(current.dev, identity.dev); assert.equal(current.ino, identity.ino);
    fs.rmSync(parent, { recursive: true, force: false });
  });
  const frame = await bounded(ready, 5000, 'TEST_READY_TIMEOUT');
  assert.deepEqual(Object.keys(frame).sort(), ['directory', 'nonce', 'pid', 'type']);
  assert.equal(frame.type, 'READY'); assert.equal(frame.nonce, nonce); assert.equal(frame.pid, child.pid);
  assert.equal(path.dirname(frame.directory), parent); assert(path.basename(frame.directory).startsWith('nisi-trial-'));
  assert.equal(fs.realpathSync(frame.directory), frame.directory); assert.equal(closed, false);
  assert.equal(child.kill(signal), true);
  const exit = await bounded(terminal, 5000, 'TEST_SIGNAL_CLOSE_TIMEOUT');
  assert.equal(bad, null); assert.equal(stderr, ''); assert.deepEqual(exit, { code: 0, signal: null });
  const lines = stdout.trimEnd().split('\n'); assert.equal(lines.length, 2);
  const report = JSON.parse(lines[1]);
  assert.equal(report.type, 'REPORT'); assert.equal(report.nonce, nonce); assert.equal(report.pid, child.pid);
  assert.equal(report.recorded, true); assert.equal(report.firstSignal, signal); assert.equal(report.stopReason, 'RUNNER_USER_STOP_REQUESTED');
  assert.equal(report.drainStatus, 'OFF'); assert.equal(report.cancels, 1); assert.equal(report.authorizing, false);
  assert.deepEqual(report.listeners, [0, 0]); assert.deepEqual(report.cleanup, { signals: 'REMOVED', storage: 'CLOSED' });
  assert.deepEqual([report.executorStarted, report.oracleStarted, report.completed], [1, 0, 0]);
  const archive = inspectPairedTrialEventStoreV1({ directory: frame.directory });
  assert.equal(archive.status, 'FINAL_PRESENT'); assert.equal(archive.events.length, 3);
  assert.equal(archive.events.at(-1).stopReason, 'RUNNER_USER_STOP_REQUESTED');
  const file = path.join(frame.directory, 'events.jsonl');
  const before = fs.readFileSync(file), beforeStat = fs.statSync(file), beforeFiles = fs.readdirSync(frame.directory);
  const cli = spawnSync(process.execPath, ['--import', path.join(root, 'tests/helpers/nisi-cli-no-effects.mjs'),
    path.join(root, 'bin/nisi.mjs'), 'inspect-trial', frame.directory], {
    cwd: parent, env: { PATH: process.env.PATH, HOME: parent, TMPDIR: parent,
      NISI_CLI_TEST_ALLOW_TRIAL: '1', NISI_CLI_TEST_PACKAGE_ROOT: root, NISI_CLI_TEST_SINGLE_CAPTURE: '1' },
    timeout: 10000, killSignal: 'SIGKILL', encoding: 'utf8', maxBuffer: 65536,
  });
  assert.equal(cli.error, undefined); assert.equal(cli.signal, null); assert.equal(cli.status, 0); assert.equal(cli.stderr, '');
  const observed = JSON.parse(cli.stdout); assert.equal(observed.semanticStatus, 'FINAL_CONSISTENT');
  assert.equal(observed.remoteExecutionStopped, 'UNKNOWN'); assert.equal(observed.authorizing, false);
  assert.deepEqual(fs.readFileSync(file), before); assert.deepEqual(fs.readdirSync(frame.directory), beforeFiles);
  for (const key of ['mode', 'ctimeMs', 'mtimeMs', 'nlink', 'size', 'ino', 'dev']) assert.equal(fs.statSync(file)[key], beforeStat[key]);
});
