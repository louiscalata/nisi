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

const fingerprint = value => hash('nisi-run-journal/input/v1\n' + canonical(value));
const parsed = journal => journal.serialize().trimEnd().split('\n').map(JSON.parse);
const nest = depth => { let value = 'leaf'; for (let i = 0; i < depth; i++) value = [value]; return value; };
// Rebuild the chain and footer after editing parsed lines, as anyone able to rewrite the file can.
function rehash(lines) {
  let previousHash = hash('nisi-run-journal/header/v1\n' + canonical(lines[0]));
  for (const line of lines.slice(1, -1)) {
    line.previousHash = previousHash;
    line.hash = previousHash = hash('nisi-run-journal/record/v1\n' + canonical({ seq: line.seq, previousHash, record: line.record }));
  }
  lines.at(-1).lastHash = previousHash;
  return lines.map(canonical).join('\n') + '\n';
}
const invalid = (recoveredIds, rejectedLine, reason = 'RECORD') => ({ status: 'INVALID', recoveredIds, rejectedLine, reason, authorizing: false });

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

test('pruned entry reopens with its original fingerprint and no retained payload', () => {
  const journal = createRunJournal(config());
  assert.equal(journal.append(entry(), 100).status, 'APPENDED');
  assert.deepEqual(journal.retain(1100), ['entry-a']);
  const recovered = reopen(journal.serialize());

  assert.equal(recovered.report.status, 'COMPLETE');
  const [row] = recovered.journal.list(1100);
  assert.equal(row.retained, false);
  assert.equal(row.entry.payload, null);
  assert.equal(recovered.journal.append(entry(), 1100).status, 'DUPLICATE');
  assert.deepEqual(recovered.journal.append(entry('entry-a', { payload: { note: 'changed' } }), 1100), {
    status: 'CONFLICT', id: 'entry-a', reason: 'ID_CONTENT_MISMATCH',
  });
});

test('liveness puts revocation first, then terminal state, then expiry, then heartbeat age', () => {
  const journal = createRunJournal(config());
  const rows = [
    ['queued', { state: 'QUEUED' }],
    ['running', { state: 'RUNNING', heartbeatAt: 100 }],
    ['silent', { state: 'RUNNING' }],
    ['short', { state: 'RUNNING', heartbeatAt: 100, ttlMs: 10 }],
    ['succeeded', { ttlMs: 10 }],
    ['failed', { state: 'FAILED', ttlMs: 10 }],
    ['cancelled', { state: 'CANCELLED', ttlMs: 10 }],
    ['target', { state: 'RUNNING', heartbeatAt: 100 }],
    ['revoker', { state: 'REVOKED', revokes: 'target', payload: {} }],
  ];
  for (const [id, patch] of rows) assert.equal(journal.append(entry(id, patch), 100).status, 'APPENDED');
  const views = now => Object.fromEntries(journal.list(now).map(row => [row.entry.id, [row.liveness, row.expired, row.revoked]]));
  assert.deepEqual(views(109), {
    queued: ['QUEUED', false, false], running: ['RUNNING', false, false], silent: ['UNKNOWN', false, false],
    short: ['RUNNING', false, false], succeeded: ['SUCCEEDED', false, false], failed: ['FAILED', false, false],
    cancelled: ['CANCELLED', false, false], target: ['REVOKED', false, true], revoker: ['REVOKED', false, false],
  });
  const atTtl = views(110);
  assert.deepEqual([atTtl.running, atTtl.short, atTtl.succeeded, atTtl.failed, atTtl.cancelled],
    [['RUNNING', false, false], ['EXPIRED', true, false], ['SUCCEEDED', true, false], ['FAILED', true, false], ['CANCELLED', true, false]]);
  assert.deepEqual(views(111).running, ['UNKNOWN', false, false]);
  assert.deepEqual(views(1100).queued, ['EXPIRED', true, false]);
});

test('retries need a finished, expired or revoked target in the same run and a later QUEUED attempt', () => {
  const journal = createRunJournal(config());
  for (const [id, patch] of [['live', { state: 'RUNNING', heartbeatAt: 100 }], ['done', {}], ['doomed', { state: 'RUNNING', heartbeatAt: 100 }]]) {
    assert.equal(journal.append(entry(id, patch), 100).status, 'APPENDED');
  }
  const retry = (id, retryOf, patch = {}) => entry(id, { state: 'QUEUED', attempt: 1, retryOf, createdAt: 101, ...patch });
  for (const input of [
    retry('of-live', 'live'), retry('of-missing', 'missing'), retry('other-run', 'done', { runId: 'run-b' }),
    retry('same-attempt', 'done', { attempt: 0 }), retry('not-queued', 'done', { state: 'RUNNING' }),
    retry('before-target', 'done', { createdAt: 99 }),
  ]) assert.deepEqual(journal.append(input, 101), { status: 'REFUSED', id: input.id, reason: 'RETRY' });
  assert.deepEqual(journal.append(retry('of-done', 'done'), 101), { status: 'APPENDED', id: 'of-done' });
  assert.equal(journal.append(entry('revoker', { state: 'REVOKED', revokes: 'doomed', createdAt: 101, payload: {} }), 101).status, 'APPENDED');
  assert.deepEqual(journal.append(retry('of-revoked', 'doomed'), 101), { status: 'APPENDED', id: 'of-revoked' });
  assert.deepEqual(journal.append(retry('of-expired', 'live', { createdAt: 1100 }), 1100), { status: 'APPENDED', id: 'of-expired' });
  assert.deepEqual(journal.list(1100).filter(row => row.entry.retryOf !== null).map(row => row.entry.id), ['of-done', 'of-revoked', 'of-expired']);
});

test('revocations must name an earlier entry with the same run, attempt and candidate', () => {
  const journal = createRunJournal(config());
  assert.equal(journal.append(entry('target', { state: 'RUNNING', heartbeatAt: 100 }), 100).status, 'APPENDED');
  const revoke = (id, patch = {}) => entry(id, { state: 'REVOKED', revokes: 'target', createdAt: 110, payload: {}, ...patch });
  for (const input of [
    revoke('unknown', { revokes: 'missing' }), revoke('other-run', { runId: 'run-b' }), revoke('other-attempt', { attempt: 1 }),
    revoke('other-candidate', { candidateId: 'candidate-b' }), revoke('before-target', { createdAt: 99 }),
  ]) assert.deepEqual(journal.append(input, 110), { status: 'REFUSED', id: input.id, reason: 'REVOCATION' });
  assert.equal(journal.list(110)[0].revoked, false);
  assert.deepEqual(journal.append(revoke('valid'), 110), { status: 'APPENDED', id: 'valid' });
  assert.equal(journal.list(110)[0].liveness, 'REVOKED');
});

test('the configured maximum retires the oldest payloads and retain() returns the IDs it retires', () => {
  const journal = createRunJournal(config({ maxEntries: 2 }));
  for (const id of ['one', 'two', 'three']) assert.equal(journal.append(entry(id), 100).status, 'APPENDED');
  assert.deepEqual(journal.list(100).map(row => [row.entry.id, row.retained, row.entry.payload]),
    [['one', false, null], ['two', true, { note: 'safe-note' }], ['three', true, { note: 'safe-note' }]]);
  assert.deepEqual(journal.append(entry('one'), 100), { status: 'DUPLICATE', id: 'one' });
  assert.deepEqual(journal.retain(1099), []);
  assert.deepEqual(journal.retain(1100), ['two', 'three']);
  assert.deepEqual(journal.retain(1100), []);
  const recovered = reopen(journal.serialize());
  assert.equal(recovered.report.status, 'COMPLETE');
  assert.deepEqual(recovered.journal.list(1100).map(row => row.retained), [false, false, false]);
});

test('time must be a safe non-negative integer that never moves backwards', () => {
  const journal = createRunJournal(config());
  assert.deepEqual(journal.list(200), []);
  for (const call of [
    () => journal.list(199), () => journal.retain(199), () => journal.append(entry(), 199),
    () => journal.list(-1), () => journal.list(200.5), () => journal.append(entry(), Number.MAX_SAFE_INTEGER + 1),
  ]) assert.throws(call, { code: 'TIME' });
  assert.deepEqual(journal.append(entry(), 200), { status: 'APPENDED', id: 'entry-a' });
});

test('invalid entries throw ENTRY and invalid configs throw CONFIG before anything is recorded', () => {
  const journal = createRunJournal(config());
  const { payload, ...missingKey } = entry('missing-key');
  for (const input of [
    entry('future', { createdAt: 201 }), entry('early-heartbeat', { state: 'RUNNING', heartbeatAt: 101 }),
    entry('no-target', { state: 'REVOKED' }), entry('stray-target', { revokes: 'x' }),
    entry('revoked-retry', { state: 'REVOKED', revokes: 'x', retryOf: 'y' }), entry('paused', { state: 'PAUSED' }),
    entry('bad id!'), entry('fraction', { attempt: 0.5 }), entry('no-ttl', { ttlMs: 0 }),
    entry('float', { payload: { n: 1.5 } }), { ...entry('extra'), extra: true }, missingKey,
  ]) assert.throws(() => journal.append(input, 200), { code: 'ENTRY' });
  assert.equal(typeof payload, 'object');
  assert.deepEqual(journal.list(200), []);
  for (const patch of [
    { maxEntries: 0 }, { maxEntries: 10001 }, { heartbeatTtlMs: 0 }, { projectId: 'bad id!' }, { extra: true },
    { redactPaths: ['secret'] }, { redactPaths: ['payload.'] }, { redactPaths: ['payload.__proto__'] },
    { redactPaths: ['payload.a', 'payload.a'] }, { redactPaths: ['payload.a', 'payload.a.b'] }, { redactPaths: ['payload.a.b', 'payload.a'] },
  ]) assert.throws(() => createRunJournal(config(patch)), { code: 'CONFIG' });
  assert.equal(typeof createRunJournal(config({ maxEntries: 10000, redactPaths: ['payload.a', 'payload.b.0'] })).append, 'function');
});

test('every configured redaction path must exist in each entry, or append throws REDACTION and records nothing', () => {
  const journal = createRunJournal(config({ redactPaths: ['payload.secret'] }));
  for (const input of [entry('no-secret'), entry('null-payload', { payload: null }), entry('array-payload', { payload: ['secret'] })]) {
    assert.throws(() => journal.append(input, 100), { code: 'REDACTION' });
  }
  assert.equal(journal.append(entry('target', { state: 'RUNNING', heartbeatAt: 100, payload: { secret: 's' } }), 100).status, 'APPENDED');
  // A revocation is an entry too, so it needs the configured path as well.
  assert.throws(() => journal.append(entry('revoker', { state: 'REVOKED', revokes: 'target', payload: {} }), 100), { code: 'REDACTION' });
  assert.equal(journal.append(entry('revoker', { state: 'REVOKED', revokes: 'target', payload: { secret: null } }), 100).status, 'APPENDED');
  assert.deepEqual(journal.list(100).map(row => [row.entry.id, row.entry.payload]), [['target', { secret: '[REDACTED]' }], ['revoker', { secret: '[REDACTED]' }]]);
});

test('entries nested past 256 objects and arrays are refused, and such a journal never reopens', () => {
  // A valid config nests only two levels (its redactPaths array holds strings), so the limit shows through entries.
  const journal = createRunJournal(config());
  assert.deepEqual(journal.append(entry('deepest', { payload: nest(255) }), 100), { status: 'APPENDED', id: 'deepest' });
  for (const depth of [256, 3000]) assert.throws(() => journal.append(entry('too-deep', { payload: nest(depth) }), 100), { code: 'ENTRY' });
  assert.deepEqual(journal.list(100).map(row => row.entry.id), ['deepest']);
  assert.equal(reopen(journal.serialize()).report.status, 'COMPLETE');
  const lines = parsed(journal);
  lines[1].record.entry.payload = nest(256);
  lines[1].record.fingerprint = fingerprint(lines[1].record.entry);
  const recovered = reopen(rehash(lines));
  assert.deepEqual(recovered.report, invalid([], 2));
  assert.deepEqual(recovered.journal.list(100), []);
});

test('reopen reports truncation, trailing data, a bad footer and a damaged header with exact reasons', () => {
  const journal = createRunJournal(config());
  assert.equal(journal.append(entry(), 100).status, 'APPENDED');
  const serialized = journal.serialize();
  const [header, record, footer] = serialized.trimEnd().split('\n');
  const cases = [
    [serialized.slice(0, -1), 'INCOMPLETE', ['entry-a'], 3, 'TRUNCATED'],
    [header + '\n' + record.slice(0, 40), 'INCOMPLETE', [], 2, 'TRUNCATED'],
    [header + '\n' + record + '\n', 'INCOMPLETE', ['entry-a'], 3, 'MISSING_FOOTER'],
    [serialized + '{}\n', 'INVALID', ['entry-a'], 4, 'TRAILING_DATA'],
    [serialized + '{', 'INVALID', ['entry-a'], 4, 'TRAILING_DATA'],
    [header + '\n' + record + '\n' + footer.replace('"count":1', '"count":2') + '\n', 'INVALID', ['entry-a'], 3, 'FOOTER'],
  ];
  for (const [input, status, recoveredIds, rejectedLine, reason] of cases) {
    const recovered = reopen(input);
    assert.deepEqual(recovered.report, { status, recoveredIds, rejectedLine, reason, authorizing: false });
    assert.deepEqual(recovered.journal.append(entry('new-entry'), 100), { status: 'REFUSED', id: 'new-entry', reason: 'SEALED' });
    assert.throws(() => recovered.journal.serialize(), { code: 'SEALED' });
  }
  // Without a usable header there is no configuration to rebuild, so no journal is returned.
  for (const input of ['', serialized.slice(0, 20), null, serialized.replace('nisi-run-journal-v1', 'nisi-run-journal-v2'), serialized.replace('"maxEntries":8', '"maxEntries":0')]) {
    assert.deepEqual(reopen(input), { journal: null, report: invalid([], 1, 'HEADER') });
  }
});

test('rehashed journals reopen INVALID for rule violations that a recomputed chain cannot hide', () => {
  const journal = createRunJournal(config());
  for (const [id, patch] of [['live', { state: 'RUNNING', heartbeatAt: 100 }], ['done', {}]]) assert.equal(journal.append(entry(id, patch), 100).status, 'APPENDED');
  assert.equal(journal.append(entry('retry', { state: 'QUEUED', attempt: 1, retryOf: 'done' }), 100).status, 'APPENDED');
  assert.equal(journal.append(entry('revoker', { state: 'REVOKED', revokes: 'live', payload: {} }), 100).status, 'APPENDED');
  assert.equal(reopen(journal.serialize()).report.status, 'COMPLETE');
  const edits = [
    [lines => { lines[0].config.maxEntries = 2; }, 4, ['live', 'done']],
    [lines => { lines[0].now = 1100; }, 2, []],
    [lines => { lines[3].record.entry.retryOf = 'live'; }, 4, ['live', 'done']],
    [lines => { lines[4].record.entry.candidateId = 'candidate-b'; }, 5, ['live', 'done', 'retry']],
    [lines => { lines[2].record.entry.projectId = 'project-b'; }, 3, ['live']],
    [lines => { lines[2].record.entry.id = 'live'; }, 3, ['live']],
  ];
  for (const [edit, rejectedLine, recoveredIds] of edits) {
    const lines = parsed(journal);
    edit(lines);
    for (const line of lines.slice(1, -1)) line.record.fingerprint = fingerprint(line.record.entry);
    const recovered = reopen(rehash(lines));
    assert.deepEqual(recovered.report, invalid(recoveredIds, rejectedLine));
    assert.deepEqual(recovered.journal.list(1100).map(row => row.entry.id), recoveredIds);
  }
});

test('a retired record must be expired at the header time or followed by maxEntries records', () => {
  const journal = createRunJournal(config({ maxEntries: 2 }));
  for (const id of ['first', 'second']) assert.equal(journal.append(entry(id), 100).status, 'APPENDED');
  // Marking an unexpired, under-cap entry retired cannot swap in another fingerprint.
  const failed = entry('first', { state: 'FAILED' });
  const lines = parsed(journal);
  lines[1].record = { entry: { ...lines[1].record.entry, payload: null }, fingerprint: fingerprint(failed), retained: false };
  const crafted = reopen(rehash(lines));
  assert.deepEqual(crafted.report, invalid([], 2));
  assert.deepEqual(crafted.journal.list(100), []);
  assert.deepEqual(crafted.journal.append(failed, 100), { status: 'REFUSED', id: 'first', reason: 'SEALED' });
  // When several retired records break the rule, the first is rejected, as for every other check.
  const twice = parsed(journal);
  for (const line of twice.slice(1, -1)) line.record = { ...line.record, entry: { ...line.record.entry, payload: null }, retained: false };
  assert.deepEqual(reopen(rehash(twice)).report, invalid([], 2));

  // A third append retires 'first' with exactly maxEntries records after it; 'second' cannot be retired too.
  assert.equal(journal.append(entry('third'), 100).status, 'APPENDED');
  const capped = reopen(journal.serialize());
  assert.equal(capped.report.status, 'COMPLETE');
  assert.deepEqual(capped.journal.list(100).map(row => row.retained), [false, true, true]);
  const both = parsed(journal);
  both[2].record = { ...both[2].record, entry: { ...both[2].record.entry, payload: null }, retained: false };
  const early = reopen(rehash(both));
  assert.deepEqual(early.report, invalid(['first'], 3));
  assert.deepEqual(early.journal.list(100).map(row => row.entry.id), ['first']);
});

test('the header time is part of the chain root, so a later list or retain changes every hash', () => {
  const journal = createRunJournal(config());
  assert.equal(journal.append(entry(), 100).status, 'APPENDED');
  const before = parsed(journal);
  assert.equal(journal.serialize(), journal.serialize());
  journal.list(101);
  const after = parsed(journal);
  assert.equal(after[0].now, 101);
  assert.deepEqual(after[1].record, before[1].record);
  assert.notEqual(after[1].hash, before[1].hash);
  assert.notEqual(after[2].lastHash, before[2].lastHash);
  assert.equal(reopen(journal.serialize()).report.status, 'COMPLETE');
});
