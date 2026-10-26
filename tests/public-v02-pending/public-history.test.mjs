// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
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

test('the package does not export the checkout-bound recovery worker', async () => {
  assert.equal(typeof writeSerializedJournal, 'function');
  assert.equal(typeof readSerializedJournal, 'function');
  for (const specifier of ['nisi/history/recovery-worker', 'nisi/history/recovery-worker.mjs']) {
    await assert.rejects(import(specifier), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
  }
});
