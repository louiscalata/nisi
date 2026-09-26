// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRunJournal, reopen } from 'nisi/history/run-journal';
import { writeSerializedJournal, readSerializedJournal } from 'nisi/history/run-journal-store';

const config = () => ({ projectId: 'public-test', maxEntries: 8, heartbeatTtlMs: 10, redactPaths: ['payload.secret'] });
const entry = () => ({
  id: 'entry-1', projectId: 'public-test', runId: 'run-1', attempt: 0, candidateId: 'candidate-1',
  stage: 'test', receiptId: 'receipt-1', createdAt: 100, ttlMs: 1000, state: 'SUCCEEDED',
  heartbeatAt: null, retryOf: null, revokes: null, payload: { secret: 'do-not-store', note: 'public fixture' }
});

test('the public run-journal import redacts before serializing and reopens verified bytes', () => {
  const journal = createRunJournal(config());
  assert.equal(journal.append(entry(), 100).status, 'APPENDED');
  const serialized = journal.serialize();
  assert.ok(serialized.endsWith('\n'));
  assert.ok(!serialized.includes('do-not-store'));
  const recovered = reopen(serialized);
  assert.equal(recovered.report.status, 'COMPLETE');
  assert.deepEqual(recovered.report.recoveredIds, ['entry-1']);
  assert.equal(recovered.journal.list(100)[0].entry.payload.secret, '[REDACTED]');
});

test('a truncated public journal is not reported as complete', () => {
  const journal = createRunJournal(config());
  journal.append(entry(), 100);
  const lines = journal.serialize().trimEnd().split('\n');
  const recovered = reopen(lines.slice(0, -1).join('\n') + '\n');
  assert.equal(recovered.report.status, 'INCOMPLETE');
});

test('replacing a stored journal needs the sha256 of the last write or read', t => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'nisi-public-history-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'journal.jsonl');
  const journal = createRunJournal(config());
  assert.equal(journal.append(entry(), 100).status, 'APPENDED');
  const first = writeSerializedJournal({ path, serialized: journal.serialize(), fs });
  assert.equal(first.status, 'WRITTEN');
  assert.equal(journal.append({ ...entry(), id: 'entry-2', payload: { secret: 'also-hidden' } }, 101).status, 'APPENDED');
  const next = journal.serialize();
  const stale = writeSerializedJournal({ path, serialized: next, fs });
  assert.deepEqual([stale.status, stale.reason, stale.committed], ['REFUSED', 'CONFLICT', false]);
  const loaded = readSerializedJournal({ path, fs });
  assert.equal(loaded.sha256, first.sha256);
  assert.equal(writeSerializedJournal({ path, serialized: next, fs, expectedPreviousSha256: loaded.sha256 }).status, 'WRITTEN');
  assert.equal(writeSerializedJournal({ path, serialized: next, fs }).status, 'UNCHANGED');
  const recovered = reopen(readSerializedJournal({ path, fs }).serialized);
  assert.deepEqual(recovered.report.recoveredIds, ['entry-1', 'entry-2']);
  assert.equal(writeSerializedJournal({ path, serialized: next, fs: { ...fs, lstatSync: undefined } }).reason, 'INVALID_INPUT');
});

test('the package does not export the checkout-bound recovery worker', async () => {
  assert.equal(typeof writeSerializedJournal, 'function');
  assert.equal(typeof readSerializedJournal, 'function');
  for (const specifier of ['nisi/history/recovery-worker', 'nisi/history/recovery-worker.mjs']) {
    await assert.rejects(import(specifier), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
  }
});
