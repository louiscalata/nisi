// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRunJournal, reopen } from '../history/run-journal-v1.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}'
    : JSON.stringify(value);

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

test('retained entry fingerprint must match its payload even when the chain is rehashed', () => {
  const journal = createRunJournal(config());
  assert.equal(journal.append(entry(), 100).status, 'APPENDED');
  const lines = journal.serialize().trimEnd().split('\n').map(JSON.parse);
  lines[1].record.fingerprint = lines[1].record.fingerprint === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64);
  lines[1].hash = hash('nisi-run-journal/record/v1\n' + canonical({
    seq: lines[1].seq, previousHash: lines[1].previousHash, record: lines[1].record,
  }));
  lines[2].lastHash = lines[1].hash;
  const recovered = reopen(lines.map(canonical).join('\n') + '\n');

  assert.equal(recovered.report.status, 'INVALID');
  assert.equal(recovered.report.rejectedLine, 2);
  assert.equal(recovered.report.reason, 'RECORD');
  assert.deepEqual(recovered.report.recoveredIds, []);
  assert.deepEqual(recovered.journal.append(entry(), 100), {
    status: 'REFUSED', id: 'entry-a', reason: 'SEALED',
  });
  assert.throws(() => recovered.journal.serialize(), { code: 'SEALED' });
});

test('pruned entry reopens with a verifiable null-payload fingerprint', () => {
  const journal = createRunJournal(config());
  assert.equal(journal.append(entry(), 100).status, 'APPENDED');
  assert.deepEqual(journal.retain(1100), ['entry-a']);
  const recovered = reopen(journal.serialize());

  assert.equal(recovered.report.status, 'COMPLETE');
  const [row] = recovered.journal.list(1100);
  assert.equal(row.retained, false);
  assert.equal(row.entry.payload, null);
  assert.equal(recovered.journal.append(entry(), 1100).status, 'CONFLICT');
  assert.deepEqual(recovered.journal.append(entry('entry-a', { payload: { note: 'changed' } }), 1100), {
    status: 'CONFLICT', id: 'entry-a', reason: 'ID_CONTENT_MISMATCH',
  });
});

function rehash(lines) {
  let previousHash = hash('nisi-run-journal/header/v1\n' + canonical(lines[0]));
  for (const line of lines.slice(1, -1)) {
    line.previousHash = previousHash;
    line.hash = hash('nisi-run-journal/record/v1\n' + canonical({ seq: line.seq, previousHash, record: line.record }));
    previousHash = line.hash;
  }
  lines.at(-1).lastHash = previousHash;
  return lines.map(canonical).join('\n') + '\n';
}

test('non-retained fingerprints cannot plant duplicate identity in a rehashed journal', () => {
  const journal = createRunJournal(config()); journal.append(entry(), 100);
  const lines = journal.serialize().trimEnd().split('\n').map(JSON.parse);
  lines[1].record.retained = false; lines[1].record.entry.payload = null;
  assert.equal(reopen(rehash(lines)).report.status, 'INVALID');
  lines[1].record.fingerprint = hash('nisi-run-journal/input/v1\n' + canonical(lines[1].record.entry));
  const recovered = reopen(rehash(lines));
  assert.equal(recovered.report.status, 'COMPLETE');
  assert.equal(recovered.journal.append(entry(), 100).status, 'CONFLICT');
});

test('redaction ignores absent paths including null payloads and revocations', () => {
  const journal = createRunJournal(config({ redactPaths: ['payload.nested.value'] }));
  for (const [i, payload] of [null, {}, { nested: {} }, { nested: { value: 'fixture' } }].entries()) {
    assert.equal(journal.append(entry(`entry-${i}`, { payload }), 100).status, 'APPENDED');
  }
  assert.equal(journal.append(entry('revocation', { state: 'REVOKED', revokes: 'entry-0', payload: {} }), 100).status, 'APPENDED');
  assert.equal(reopen(journal.serialize()).report.status, 'COMPLETE');
});

test('journal rejects repeated retry target and attempt on append and reopen', () => {
  const journal = createRunJournal(config()); journal.append(entry('target', { state: 'FAILED' }), 100);
  const retry = id => entry(id, { state: 'QUEUED', attempt: 1, retryOf: 'target' });
  assert.equal(journal.append(retry('retry-a'), 100).status, 'APPENDED');
  assert.equal(journal.append(retry('retry-b'), 100).reason, 'RETRY_DUPLICATE');
  const lines = journal.serialize().trimEnd().split('\n').map(JSON.parse);
  const extra = structuredClone(lines[2]); extra.seq = 3; extra.record.entry.id = 'retry-b';
  extra.record.fingerprint = hash('nisi-run-journal/input/v1\n' + canonical(extra.record.entry));
  lines.splice(3, 0, extra); lines.at(-1).count = 3;
  assert.equal(reopen(rehash(lines)).report.status, 'INVALID');
});

test('journal bounds payload depth before hashing', () => {
  let payload = null; for (let i = 0; i < 65; i++) payload = { a: payload };
  const journal = createRunJournal(config());
  assert.throws(() => journal.append(entry('deep', { payload }), 100), { code: 'ENTRY' });
  assert.deepEqual(journal.list(100), []);
  const shallow = createRunJournal(config()); shallow.append(entry(), 100);
  const lines = shallow.serialize().trimEnd().split('\n').map(JSON.parse);
  lines[1].record.entry.payload = payload;
  lines[1].record.fingerprint = hash('nisi-run-journal/input/v1\n' + canonical(lines[1].record.entry));
  assert.equal(reopen(rehash(lines)).report.status, 'INVALID');
});

test('serialize with a time retires expired payloads before writing', () => {
  const journal = createRunJournal(config());
  journal.append(entry('expiring', { ttlMs: 10, payload: { note: 'expired-fixture' } }), 100);
  const serialized = journal.serialize(110);
  assert.doesNotMatch(serialized, /expired-fixture/);
  assert.equal(reopen(serialized).report.status, 'COMPLETE');
});

test('journal refuses total history beyond 10000 records without discarding identity', () => {
  const journal = createRunJournal(config({ maxEntries: 1 }));
  for (let i = 0; i < 10000; i++) assert.equal(journal.append(entry(`row-${i}`, { payload: null }), 100).status, 'APPENDED');
  assert.equal(journal.append(entry('overflow'), 100).reason, 'HISTORY_LIMIT');
  assert.equal(journal.append(entry('row-0', { payload: null }), 100).status, 'DUPLICATE');
  assert.equal(journal.list(100).filter(row => row.retained).length, 1);
  const serialized = journal.serialize();
  assert.equal(reopen(serialized).report.status, 'COMPLETE');
  const lines = serialized.trimEnd().split('\n').map(JSON.parse);
  const extra = structuredClone(lines[1]);
  extra.seq = 10001; extra.record.entry.id = 'overflow';
  extra.record.fingerprint = hash('nisi-run-journal/input/v1\n' + canonical(extra.record.entry));
  lines.splice(-1, 0, extra); lines.at(-1).count = 10001;
  assert.equal(reopen(rehash(lines)).report.status, 'INVALID');
});
