// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunJournal, reopen } from '../history/run-journal-v1.mjs';

const config = patch => ({
  projectId: 'project-a',
  maxEntries: 8,
  heartbeatTtlMs: 10,
  redactPaths: [],
  ...patch,
});

const entry = (id = 'entry-a', patch = {}) => ({
  id,
  projectId: 'project-a',
  runId: 'run-a',
  attempt: 0,
  candidateId: 'candidate-a',
  stage: 'test',
  receiptId: 'receipt-a',
  createdAt: 100,
  ttlMs: 1000,
  state: 'SUCCEEDED',
  heartbeatAt: null,
  retryOf: null,
  revokes: null,
  payload: { note: 'safe-note' },
  ...patch,
});

test('append binds each ID to its first input and refuses project mismatches', () => {
  const journal = createRunJournal(config());
  const first = entry();

  assert.deepEqual(journal.append(first, 100), { status: 'APPENDED', id: 'entry-a' });
  assert.deepEqual(journal.append(first, 100), { status: 'DUPLICATE', id: 'entry-a' });
  assert.deepEqual(
    journal.append(entry('entry-a', { payload: { note: 'changed' } }), 100),
    { status: 'CONFLICT', id: 'entry-a', reason: 'ID_CONTENT_MISMATCH' },
  );
  assert.deepEqual(
    journal.append(entry('entry-b', { projectId: 'project-b' }), 100),
    { status: 'REFUSED', id: 'entry-b', reason: 'PROJECT' },
  );
  assert.deepEqual(journal.list(100).map(row => row.entry.id), ['entry-a']);
});

test('configured payload redaction occurs before serialization and survives reopen', () => {
  const journal = createRunJournal(config({ redactPaths: ['payload.secret'] }));
  const original = entry('redacted', { payload: { secret: 'secret-value', note: 'retained' } });
  const alternate = entry('redacted', { payload: { secret: 'other-secret', note: 'retained' } });
  assert.equal(journal.append(original, 100).status, 'APPENDED');
  assert.equal(original.payload.secret, 'secret-value');
  assert.equal(journal.append(alternate, 100).status, 'DUPLICATE');

  const serialized = journal.serialize();
  assert.doesNotMatch(serialized, /secret-value/);
  assert.doesNotMatch(serialized, /other-secret/);
  assert.match(serialized, /\[REDACTED\]/);
  const alternateJournal = createRunJournal(config({ redactPaths: ['payload.secret'] }));
  assert.equal(alternateJournal.append(alternate, 100).status, 'APPENDED');
  assert.equal(alternateJournal.serialize(), serialized);
  const recovered = reopen(serialized);
  assert.equal(recovered.report.status, 'COMPLETE');
  assert.equal(recovered.journal.append(alternate, 100).status, 'DUPLICATE');
  const [row] = recovered.journal.list(100);
  assert.equal(row.entry.payload.secret, '[REDACTED]');
  assert.equal(row.entry.payload.note, 'retained');
  assert.equal(row.historical, true);
  assert.equal(row.authorizing, false);
});

test('revocation changes the target view and expiry retires payload data', () => {
  const journal = createRunJournal(config());
  assert.equal(journal.append(entry('active', { state: 'RUNNING', heartbeatAt: 100 }), 100).status, 'APPENDED');
  assert.equal(journal.append(entry('revoker', {
    state: 'REVOKED',
    revokes: 'active',
    createdAt: 110,
    payload: {},
  }), 110).status, 'APPENDED');
  const [active, revoker] = journal.list(110);
  assert.equal(active.revoked, true);
  assert.equal(active.liveness, 'REVOKED');
  assert.equal(revoker.liveness, 'REVOKED');

  const expiring = createRunJournal(config());
  assert.equal(expiring.append(entry('short-lived', {
    state: 'QUEUED',
    ttlMs: 10,
    payload: { note: 'discard-me' },
  }), 100).status, 'APPENDED');
  const [expired] = expiring.list(110);
  assert.equal(expired.liveness, 'EXPIRED');
  assert.equal(expired.expired, true);
  assert.equal(expired.retained, false);
  assert.equal(expired.entry.payload, null);
});

test('truncated journal reopens as incomplete and remains sealed', () => {
  const journal = createRunJournal(config());
  assert.equal(journal.append(entry(), 100).status, 'APPENDED');
  const serialized = journal.serialize();
  const headerOnly = serialized.split('\n')[0] + '\n';
  const recovered = reopen(headerOnly);

  assert.equal(recovered.report.status, 'INCOMPLETE');
  assert.equal(recovered.report.reason, 'MISSING_FOOTER');
  assert.deepEqual(recovered.report.recoveredIds, []);
  assert.deepEqual(recovered.journal.append(entry('new-entry'), 100), {
    status: 'REFUSED', id: 'new-entry', reason: 'SEALED',
  });
  assert.throws(() => recovered.journal.serialize(), { code: 'SEALED' });
});

test('malformed records and broken record hashes reopen as invalid', () => {
  const journal = createRunJournal(config());
  assert.equal(journal.append(entry(), 100).status, 'APPENDED');
  const serialized = journal.serialize();
  const lines = serialized.trimEnd().split('\n');
  const malformed = [...lines];
  malformed[1] = '{broken';
  const corruptHash = [...lines];
  corruptHash[1] = corruptHash[1].replace('safe-note', 'tampered-note');

  for (const damaged of [malformed.join('\n') + '\n', corruptHash.join('\n') + '\n']) {
    const recovered = reopen(damaged);
    assert.equal(recovered.report.status, 'INVALID');
    assert.equal(recovered.report.rejectedLine, 2);
    assert.equal(recovered.report.reason, 'RECORD');
    assert.deepEqual(recovered.report.recoveredIds, []);
    assert.deepEqual(recovered.journal.append(entry('new-entry'), 100), {
      status: 'REFUSED', id: 'new-entry', reason: 'SEALED',
    });
  }
});
