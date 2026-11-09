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
