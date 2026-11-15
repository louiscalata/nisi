// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRunJournal } from '../history/run-journal-v1.mjs';
import { parseValidateArgs, validateData } from '../history/validate-data.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin/nisi.mjs');
const SECRET = 'super-secret-token-9f3a';

function invoke(args, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root, encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024,
    env: { ...process.env, ...env },
  });
}

function writeJournal(dir, { secret = SECRET } = {}) {
  const journal = createRunJournal({
    projectId: 'sample-smoke', maxEntries: 8, heartbeatTtlMs: 1000, redactPaths: [],
  });
  assert.equal(journal.append({
    id: 'entry-smoke', projectId: 'sample-smoke', runId: 'run-smoke', attempt: 0,
    candidateId: 'candidate-smoke', stage: 'test', receiptId: 'receipt-smoke',
    createdAt: 100, ttlMs: 1000, state: 'SUCCEEDED', heartbeatAt: null, retryOf: null, revokes: null,
    payload: { secret, note: 'kept-out-of-the-summary' },
  }, 100).status, 'APPENDED');
  const file = path.join(dir, 'journal.jsonl');
  fs.writeFileSync(file, journal.serialize());
  return file;
}

test('argument parsing accepts one flag or one env var', () => {
  assert.equal(parseValidateArgs([]).ok, false);
  assert.equal(parseValidateArgs(['--journal']).ok, false);
  assert.equal(parseValidateArgs(['--journal', 'a', '--data-dir', 'b']).ok, false);
  assert.deepEqual(parseValidateArgs(['--journal', 'journal.jsonl']), { ok: true, journal: 'journal.jsonl' });
  assert.deepEqual(parseValidateArgs([], { NISI_DATA_DIR: '/data' }), { ok: true, dataDir: '/data' });
  assert.equal(parseValidateArgs([], { NISI_DATA_DIR: '/data', NISI_JOURNAL: '/j' }).ok, false);
  assert.deepEqual(parseValidateArgs(['--data-dir', '/flags'], { NISI_JOURNAL: '/env' }), { ok: true, dataDir: '/flags' });
});

test('the shipped fixture passes and the summary omits payloads', () => {
  const summary = validateData({ dataDir: path.join(root, 'fixtures/sample-data') });
  assert.equal(summary.status, 'PASS', JSON.stringify(summary));
  assert.equal(summary.reason, null);
  assert.equal(summary.passed, 2);
  assert.equal(summary.failed, 0);
  const text = JSON.stringify(summary);
  assert.deepEqual(summary.files.map(file => file.kind).sort(), ['journal', 'workflow-report']);
  assert.doesNotMatch(text, /synthetic smoke fixture|kept-out-of-the-summary|payload/u);
  assert.equal(summary.files.find(file => file.kind === 'journal').entries, 1);
  assert.equal(summary.files.find(file => file.kind === 'journal').verified, true);
  assert.equal(summary.files.find(file => file.kind === 'workflow-report').outcome, 'COMPLETED');
});

test('a journal payload never appears in the CLI summary, and a bad file fails closed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nisi-validate-'));
  try {
    const file = writeJournal(dir);
    assert.match(fs.readFileSync(file, 'utf8'), new RegExp(SECRET, 'u'));
    const ok = invoke(['validate', '--journal', file]);
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(JSON.parse(ok.stdout).status, 'PASS');
    assert.doesNotMatch(`${ok.stdout}\n${ok.stderr}`, new RegExp(`${SECRET}|kept-out-of-the-summary`, 'u'));

    const viaEnv = invoke(['validate'], { NISI_JOURNAL: file, NISI_DATA_DIR: '' });
    assert.equal(viaEnv.status, 0, viaEnv.stderr);
    assert.doesNotMatch(`${viaEnv.stdout}\n${viaEnv.stderr}`, new RegExp(SECRET, 'u'));

    fs.writeFileSync(path.join(dir, 'notes.json'), '{"unrelated":true}\n');
    fs.writeFileSync(path.join(dir, 'broken.jsonl'), '{"not":"a journal"}\n');
    const mixed = invoke(['validate', '--data-dir', dir]);
    assert.equal(mixed.status, 1, mixed.stdout);
    const summary = JSON.parse(mixed.stdout);
    assert.equal(summary.status, 'FAIL');
    assert.equal(summary.reason, 'FILES_FAILED');
    assert.equal(summary.files.find(item => item.name === 'broken.jsonl').reason, 'INVALID_JOURNAL');
    assert.equal(summary.files.find(item => item.name === 'notes.json').status, 'SKIP');
    assert.doesNotMatch(`${mixed.stdout}\n${mixed.stderr}`, new RegExp(SECRET, 'u'));

    const missing = invoke(['validate', '--journal', path.join(dir, 'missing.jsonl')]);
    assert.equal(missing.status, 1);
    assert.equal(JSON.parse(missing.stdout).reason, 'NOT_FOUND');
    assert.doesNotMatch(`${missing.stdout}\n${missing.stderr}`, /missing\.jsonl/u);

    const usage = invoke(['validate', '--journal', file, '--data-dir', dir]);
    assert.equal(usage.status, 2);
    assert.match(usage.stderr, /Invalid command or arguments/);
    assert.equal(usage.stdout, '');
    assert.doesNotMatch(usage.stderr, new RegExp(SECRET, 'u'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a symlinked journal is refused without reading it', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nisi-validate-link-'));
  try {
    const file = writeJournal(dir, { secret: 'link-secret-should-stay-unread' });
    const link = path.join(dir, 'linked.jsonl');
    try { fs.symlinkSync(file, link); }
    catch (error) {
      if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
        t.skip(`Windows symlink creation unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    const summary = validateData({ journal: link });
    assert.equal(summary.status, 'FAIL');
    assert.equal(summary.reason, 'SYMLINK');
    assert.equal(summary.files.length, 0);
    assert.doesNotMatch(JSON.stringify(summary), /link-secret-should-stay-unread/u);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// The size check must bound the bytes actually read, not only what an earlier
// lstat saw. A file that grows or is swapped after lstat stays FILE_TOO_LARGE.
test('a file larger than maxBytes after the lstat check is refused, not read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nisi-validate-size-'));
  try {
    const file = writeJournal(dir);
    fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ schemaVersion: 1, outcome: 'COMPLETED', stages: [{ stage: 'test', status: 'PASS', note: 'x'.repeat(200) }] }));
    const small = path.join(dir, 'small.txt');
    fs.writeFileSync(small, 'x');
    const staleStat = { ...fs, lstatSync: target => target === dir ? fs.lstatSync(target) : fs.lstatSync(small) };
    const maxBytes = 64;
    assert.ok(fs.statSync(file).size > maxBytes);

    const one = validateData({ journal: file, fs: staleStat, maxBytes });
    assert.equal(one.status, 'FAIL', JSON.stringify(one));
    assert.equal(one.files[0].reason, 'FILE_TOO_LARGE');

    const many = validateData({ dataDir: dir, fs: staleStat, maxBytes });
    assert.equal(many.files.find(item => item.name === 'journal.jsonl').reason, 'FILE_TOO_LARGE', JSON.stringify(many));
    assert.equal(many.files.find(item => item.name === 'report.json').reason, 'FILE_TOO_LARGE', JSON.stringify(many));
    assert.doesNotMatch(JSON.stringify(many), new RegExp(SECRET, 'u'));

    const normal = validateData({ journal: file });
    assert.equal(normal.status, 'PASS', JSON.stringify(normal));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// A file that grows while it is being read must not be accepted, even when
// its fstat size was within the limit.
test('a journal that grows during the read fails with FILE_CHANGED', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nisi-validate-grow-'));
  try {
    const file = writeJournal(dir);
    let reads = 0;
    const growing = {
      ...fs,
      readSync: (...args) => {
        const count = fs.readSync(...args);
        reads += 1;
        if (reads === 1) fs.appendFileSync(file, '\n');
        return count;
      },
    };
    const summary = validateData({ journal: file, fs: growing });
    assert.equal(summary.status, 'FAIL', JSON.stringify(summary));
    assert.equal(summary.files[0].reason, 'FILE_CHANGED', JSON.stringify(summary));
    assert.doesNotMatch(JSON.stringify(summary), new RegExp(SECRET, 'u'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// The lstat symlink check runs before the open. A file swapped for a symlink
// in between must still be refused, which the open's O_NOFOLLOW provides.
test('a journal swapped for a symlink after the lstat check is refused', t => {
  if (fs.constants.O_NOFOLLOW === undefined) {
    t.skip('this platform has no O_NOFOLLOW');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nisi-validate-swap-'));
  try {
    const file = writeJournal(dir, { secret: 'swap-secret-should-stay-unread' });
    const moved = path.join(dir, 'moved.jsonl');
    let seen;
    const swapping = {
      ...fs,
      lstatSync: target => {
        if (target !== file) return fs.lstatSync(target);
        if (seen === undefined) {
          seen = fs.lstatSync(file);
          fs.renameSync(file, moved);
          fs.symlinkSync(moved, file);
        }
        return seen;
      },
    };
    const summary = validateData({ journal: file, fs: swapping });
    assert.ok(fs.lstatSync(file).isSymbolicLink());
    assert.equal(summary.status, 'FAIL', JSON.stringify(summary));
    assert.equal(summary.files[0].reason, 'SYMLINK', JSON.stringify(summary));
    assert.doesNotMatch(JSON.stringify(summary), /swap-secret-should-stay-unread/u);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the smoke script checks only the synthetic fixture', () => {
  const result = spawnSync('sh', [path.join(root, 'scripts/validate-real-data.sh'), '--smoke'], {
    cwd: root, encoding: 'utf8', timeout: 15_000,
  });
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.status, 'PASS', result.stdout);
  assert.equal(summary.passed, 2);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /synthetic smoke fixture/u);
});
