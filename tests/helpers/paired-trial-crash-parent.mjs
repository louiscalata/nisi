// Parent-owned process-death fixture. Never delete an uncertain live workspace.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
const fail = code => { throw Object.assign(Error(code), { code }); };
const within = (base, target) => { const relative = path.relative(base, target);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); };
const limit = 8192;
const expectedEvents = { SCHEDULE: 1, EXECUTOR_INTENT: 2, EXECUTOR_RESULT: 3, ORACLE_RESULT: 5, FINAL: 18,
  PARTIAL_SCHEDULE: 0, PARTIAL_INTENT: 1, PARTIAL_FINAL: 17, BAD_READY: 0 };
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function bounded(promise, ms, code) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(Error(code), { code })), ms); })])
    .finally(() => clearTimeout(timer));
}
export function createTrialCrashHarness(sourceRoot) {
  const root = fs.realpathSync(sourceRoot), temp = fs.realpathSync(os.tmpdir());
  const parent = fs.mkdtempSync(path.join(within(root, temp) ? path.dirname(root) : temp, 'nisi-trial-crash-'));
  const identity = fs.lstatSync(parent);
  let child = null, closed = false, exit = null, used = false, removed = false, terminal;
  let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), bad = null;
  function stop() {
    // Child handle only; no group/server/global PID discovery and no descendants.
    return child && !closed ? child.kill('SIGKILL') : false;
  }
  async function start(boundary, timeoutMs = 5000) {
    if (used || removed) fail('CRASH_HARNESS_ONE_SHOT'); used = true;
    const nonce = randomBytes(16).toString('hex'); let accept, reject;
    const marker = new Promise((a, b) => { accept = a; reject = b; });
    const refuse = code => { bad ??= code; reject(Object.assign(Error(code), { code })); stop(); };
    child = spawn(process.execPath, [path.join(root, 'tests/helpers/paired-trial-crash-child.mjs'), parent, boundary, nonce], {
      cwd: parent, env: { PATH: process.env.PATH, HOME: parent, TMPDIR: parent }, detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    terminal = new Promise(resolve => { child.once('close', (code, signal) => {
      closed = true; exit = { code, signal }; resolve(exit); if (!stdout.includes(10)) refuse('CRASH_CHILD_BEFORE_READY');
    }); });
    child.once('error', () => refuse('CRASH_CHILD_ERROR'));
    const collect = (channel, bytes) => {
      if (stdout.length + stderr.length + bytes.length > limit) { refuse('CRASH_CHILD_OUTPUT_LIMIT'); return; }
      if (channel === 'stderr') { stderr = Buffer.concat([stderr, bytes]); refuse('CRASH_CHILD_STDERR'); return; }
      stdout = Buffer.concat([stdout, bytes]); const newline = stdout.indexOf(10); if (newline < 0) return;
      try {
        if (newline !== stdout.length - 1 || stdout.indexOf(10, newline + 1) !== -1) fail('CRASH_READY_FRAME');
        const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(stdout.subarray(0, newline)));
        if (Object.keys(value).sort().join(',') !== 'boundary,byteLength,directory,lastSha256,nonce,partial,pid,retainedEvents,type' || value.type !== 'READY' ||
            value.nonce !== nonce || value.boundary !== boundary || value.pid !== child.pid ||
            typeof value.directory !== 'string' || path.dirname(value.directory) !== parent ||
            !path.basename(value.directory).startsWith('nisi-trial-')) fail('CRASH_READY_BINDING');
        if (value.retainedEvents !== expectedEvents[boundary] || !Number.isSafeInteger(value.byteLength) ||
            value.byteLength < 0 || value.byteLength > 1048576 ||
            (value.retainedEvents === 0 ? value.lastSha256 !== null || value.byteLength !== 0
              : !digest(value.lastSha256) || value.byteLength === 0)) fail('CRASH_READY_PREFIX');
        if (boundary.startsWith('PARTIAL_')) {
          const p = value.partial;
          if (!p || Object.keys(p).sort().join(',') !== 'ordinal,phase,recordBytes,tailSha256,type,writtenBytes' ||
              p.ordinal !== value.retainedEvents || p.type !== ({ PARTIAL_SCHEDULE: 'SCHEDULE', PARTIAL_INTENT: 'START_INTENT', PARTIAL_FINAL: 'FINAL' })[boundary] ||
              p.phase !== (boundary === 'PARTIAL_INTENT' ? 'EXECUTOR' : null) || p.writtenBytes !== 7 ||
              !Number.isSafeInteger(p.recordBytes) || p.recordBytes <= p.writtenBytes || p.recordBytes > 1048576 ||
              !digest(p.tailSha256)) fail('CRASH_READY_PARTIAL');
        } else if (value.partial !== null) fail('CRASH_READY_PARTIAL');
        const stat = fs.lstatSync(value.directory);
        if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(value.directory) !== value.directory) fail('CRASH_READY_PATH');
        accept(value);
      } catch { refuse('CRASH_READY_INVALID'); }
    };
    child.stdout.on('data', bytes => collect('stdout', bytes));
    child.stderr.on('data', bytes => collect('stderr', bytes));
    try { return await bounded(marker, timeoutMs, 'CRASH_READY_TIMEOUT'); }
    catch (error) { stop(); throw error; }
  }
  async function kill() {
    if (!child) fail('CRASH_NOT_STARTED');
    if (closed || child.exitCode !== null || child.signalCode !== null) fail('CRASH_CHILD_NOT_LIVE');
    if (!stop()) fail('CRASH_KILL_NOT_SENT');
    const observed = await bounded(terminal, 2000, 'CRASH_CLOSE_UNCONFIRMED');
    if (bad) fail(bad);
    if (observed.code !== null || observed.signal !== 'SIGKILL') fail('CRASH_KILL_NOT_OBSERVED');
    return Object.freeze({ ...observed, closeObserved: true, pid: child.pid });
  }
  async function dispose() {
    if (removed) return;
    if (child && !closed) {
      stop();
      try { await bounded(terminal, 2000, 'CRASH_CLEANUP_QUARANTINED'); }
      catch { fail('CRASH_CLEANUP_QUARANTINED'); }
    }
    if (child && !closed) fail('CRASH_CLEANUP_QUARANTINED');
    const current = fs.lstatSync(parent);
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino)
      fail('CRASH_PARENT_CHANGED');
    fs.rmSync(parent, { recursive: true, force: false }); removed = true;
  }
  return Object.freeze({ parent, start, kill, dispose,
    inspect: () => Object.freeze({ closed, removed, exit: exit && Object.freeze({ ...exit }), stdoutBytes: stdout.length, stderrBytes: stderr.length, bad }) });
}
