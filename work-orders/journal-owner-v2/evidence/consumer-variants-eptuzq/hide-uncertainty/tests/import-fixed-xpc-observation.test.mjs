import test from 'node:test';
import assert from 'node:assert/strict';
import { importFixedXpcObservation } from '../history/import-fixed-xpc-observation-v1.mjs';
import { openJournalOwner, recordJournalObservation } from '../history/journal-owner-v2.mjs';
import { memfs } from './journal-owner-v2.memfs.mjs';
import { CONFIG as BASE_CONFIG, PATH, entry, serialized, damageFooter, assertDeepFrozen } from './journal-owner-v2.helper.mjs';
import { makeRecord } from './fixtures/fixed-xpc-journal-observation.mjs';

// Projected observations do not have payload.secret; invalid redaction paths are
// correctly refused by the journal. Test tighter valid redaction separately.
const CONFIG = Object.freeze({...BASE_CONFIG, redactPaths: []});

const KEYS = ['schemaVersion', 'status', 'reason', 'recordAttempted', 'projection', 'journal', 'meaning', 'authorizing'];
const base = owner => ({
  owner,
  serializedRecord: JSON.stringify(makeRecord('valid')),
  projectId: 'project-a',
  candidateId: 'candidate-a',
  receiptId: 'receipt-a',
  createdAt: 100,
  ttlMs: 1000,
  now: 100
});
const open = (m, config = CONFIG, now = 100) => openJournalOwner({ path: PATH, fs: m.fs, config, now });

function assertOuter(result, status, reason, attempted) {
  assert.deepEqual(Object.keys(result).sort(), [...KEYS].sort());
  assert.equal(result.schemaVersion, 'nisi-fixed-xpc-history-import/v1');
  assert.equal(result.status, status);
  assert.equal(result.reason, reason);
  assert.equal(result.recordAttempted, attempted);
  assert.equal(result.meaning, 'HISTORY_OBSERVATIONS_ONLY');
  assert.equal(result.authorizing, false);
  assertDeepFrozen(result);
}

test('malformed envelopes, symbols, hidden fields and invalid time refuse before inspection or projection', () => {
  const m = memfs(); const opened = open(m); let calls = 0;
  const getter = base(opened.owner);
  Object.defineProperty(getter, 'serializedRecord', { enumerable: true, get() { calls++; throw new Error('must not run'); } });
  const missing = base(opened.owner); delete missing.now;
  const cases = [null, [], missing, { ...base(opened.owner), extra: true }, getter,
    ...[-0, -1, NaN, Infinity, 1.5, '100'].map(now => ({...base(opened.owner), now}))];
  const symbol = base(opened.owner); symbol[Symbol('x')] = true; cases.push(symbol);
  const hidden = base(opened.owner); Object.defineProperty(hidden, 'hidden', { value: true }); cases.push(hidden);
  for (const request of cases) {
    const result = importFixedXpcObservation(request);
    assertOuter(result, 'REFUSED', 'INVALID_INPUT', false);
    assert.equal(result.projection, null);
    assert.equal(result.journal, null);
  }
  assert.equal(calls, 0);
  assert.equal(m.events.filter(event => event.name !== 'readFileSync').length, 0);
});

test('plain and null-prototype exact envelopes are both accepted', () => {
  for (const nullPrototype of [false, true]) {
    const m = memfs(); const opened = open(m);
    const request = nullPrototype ? Object.assign(Object.create(null), base(opened.owner)) : base(opened.owner);
    assert.equal(importFixedXpcObservation(request).status, 'IMPORTED');
  }
});

test('forged owner refuses before projection', () => {
  const result = importFixedXpcObservation(base({}));
  assertOuter(result, 'REFUSED', 'INVALID_INPUT', false);
  assert.equal(result.projection, null);
  assert.equal(result.journal, null);
});

test('SEALED owner is refused before malformed source is projected', () => {
  const m = memfs(); m.seed(PATH, damageFooter(serialized(CONFIG)));
  const opened = open(m);
  const result = importFixedXpcObservation({ ...base(opened.owner), serializedRecord: '{not json' });
  assertOuter(result, 'REFUSED', 'OWNER_SEALED', false);
  assert.equal(result.projection, null);
  assert.equal(result.journal, null);
});

test('valid observation imports with immutable summary and exact journal result', () => {
  const m = memfs(); const opened = open(m);
  const result = importFixedXpcObservation(base(opened.owner));
  assertOuter(result, 'IMPORTED', null, true);
  assert.deepEqual(result.projection, {
    status: 'ENTRY', entryId: '0123456789abcdef0123456789abcdef:0:fixed-xpc', state: 'SUCCEEDED', authorizing: false
  });
  assert.equal(result.journal.status, 'RECORDED');
  assert.equal(result.journal.store.status, 'WRITTEN');
  assert.equal(result.journal.snapshot.entries[0].entry.stage, 'fixed-xpc');
});

test('adverse structurally valid source imports as FAILED history without promotion', () => {
  const record = makeRecord('valid');
  record.client.result.process.exitCode = 70;
  const m = memfs(); const opened = open(m);
  const result = importFixedXpcObservation({ ...base(opened.owner), serializedRecord: JSON.stringify(record) });
  assertOuter(result, 'IMPORTED', null, true);
  assert.equal(result.projection.state, 'FAILED');
  assert.equal(result.journal.snapshot.entries[0].entry.state, 'FAILED');
  assert.equal(result.authorizing, false);
});

test('duplicate maps to DUPLICATE and performs no additional filesystem IO', () => {
  const m = memfs(); const opened = open(m); const request = base(opened.owner);
  assert.equal(importFixedXpcObservation(request).status, 'IMPORTED');
  const before = m.events.length;
  const result = importFixedXpcObservation(request);
  assertOuter(result, 'DUPLICATE', null, true);
  assert.equal(result.journal.status, 'DUPLICATE');
  assert.equal(result.journal.store, null);
  assert.equal(m.events.length, before);
});

test('same entry identity with changed accepted content maps journal CONFLICT', () => {
  const m = memfs(); const opened = open(m);
  assert.equal(importFixedXpcObservation(base(opened.owner)).status, 'IMPORTED');
  const result = importFixedXpcObservation({ ...base(opened.owner), candidateId: 'candidate-b' });
  assertOuter(result, 'CONFLICT', 'ID_CONTENT_MISMATCH', true);
  assert.equal(result.journal.status, 'CONFLICT');
  assert.equal(result.journal.store, null);
});

test('stale private disk digest maps STORE_CONFLICT and preserves prior owner snapshot', () => {
  const m = memfs();
  const first = open(m);
  const accepted = open(m);
  const prior = first.snapshot;
  assert.equal(recordJournalObservation({ owner: accepted.owner, entry: entry('interloper'), now: 100 }).status, 'RECORDED');
  const result = importFixedXpcObservation(base(first.owner));
  assertOuter(result, 'CONFLICT', 'CONFLICT', true);
  assert.equal(result.journal.status, 'STORE_CONFLICT');
  assert.equal(result.journal.store.committed, false);
  assert.equal(result.journal.snapshot, prior);
});

test('precommit rename failure maps STORE_FAILED and preserves previous snapshot', () => {
  const m = memfs(); const opened = open(m); const prior = opened.snapshot;
  let renameCalls = 0;
  m.fs.renameSync = () => { renameCalls++; throw Object.assign(new Error('rename failed'), { code: 'EIO' }); };
  const result = importFixedXpcObservation(base(opened.owner));
  assertOuter(result, 'STORE_FAILED', 'RENAME_FAILED', true);
  assert.equal(result.journal.status, 'STORE_FAILED');
  assert.equal(result.journal.store.committed, false);
  assert.equal(result.journal.snapshot, prior);
  assert.equal(renameCalls, 1);
});

test('postrename final-read fault maps UNCERTAIN, clears owner, and fresh open reconciles committed bytes', () => {
  const m = memfs(); const opened = open(m); let renamed = false;
  const rename = m.fs.renameSync, read = m.fs.readFileSync;
  m.fs.renameSync = (a, b) => { rename(a, b); renamed = true; };
  m.fs.readFileSync = path => {
    if (renamed && path === PATH) throw Object.assign(new Error('read failed'), { code: 'EIO' });
    return read(path);
  };
  const result = importFixedXpcObservation(base(opened.owner));
  assertOuter(result, 'UNCERTAIN', 'READBACK_MISMATCH', true);
  assert.equal(result.journal.status, 'STORE_FAILED');
  assert.equal(result.journal.store.committed, true);
  assert.equal(result.journal.snapshot.state, 'COMMIT_UNCERTAIN');
  assert.deepEqual(result.journal.snapshot.entries, []);
  const fresh = openJournalOwner({ path: PATH, fs: { ...m.fs, readFileSync: read }, config: CONFIG, now: 100 });
  assert.equal(fresh.status, 'OPENED');
  assert.deepEqual(fresh.snapshot.recovery.recoveredIds, ['0123456789abcdef0123456789abcdef:0:fixed-xpc']);
});

test('subsequent call on uncertain owner refuses before projecting malformed source', () => {
  const m = memfs(); const opened = open(m); let renamed = false;
  const rename = m.fs.renameSync, read = m.fs.readFileSync;
  m.fs.renameSync = (a, b) => { rename(a, b); renamed = true; };
  m.fs.readFileSync = path => renamed && path === PATH ? Buffer.from('mismatch') : read(path);
  assert.equal(importFixedXpcObservation(base(opened.owner)).status, 'UNCERTAIN');
  const before = m.events.length;
  const result = importFixedXpcObservation({ ...base(opened.owner), serializedRecord: '{bad' });
  assertOuter(result, 'REFUSED', 'COMMIT_UNCERTAIN', false);
  assert.equal(result.projection, null);
  assert.equal(result.journal, null);
  assert.equal(m.events.length, before);
});

test('missing fsync is imported while preserving non-durable store evidence', () => {
  const m = memfs(); const fs = { ...m.fs }; delete fs.fsyncSync;
  const opened = openJournalOwner({ path: PATH, fs, config: CONFIG, now: 100 });
  const result = importFixedXpcObservation(base(opened.owner));
  assertOuter(result, 'IMPORTED', null, true);
  assert.equal(result.journal.store.status, 'WRITTEN');
  assert.equal(result.journal.store.durable, false);
  assert.deepEqual(result.journal.store.fsync, { file: false, directory: false });
});

test('malformed and old source records refuse before record or write', () => {
  for (const serializedRecord of ['{bad', JSON.stringify({ ...makeRecord('valid'), schemaVersion: 'nisi-fixed-private-xpc-run-v0' })]) {
    const m = memfs(); const opened = open(m); const before = m.events.length;
    const result = importFixedXpcObservation({ ...base(opened.owner), serializedRecord });
    assertOuter(result, 'REFUSED', 'INVALID_INPUT', false);
    assert.deepEqual(result.projection, { status: 'REFUSED', reason: 'INVALID_INPUT', authorizing: false });
    assert.equal(result.journal, null);
    assert.equal(m.events.length, before);
  }
});

test('host-configured stricter redaction is not leaked through projection summary', () => {
  const config = { ...CONFIG, redactPaths: ['payload.process.errorCode'] };
  const source = makeRecord('valid');
  source.client.result.process.errorCode = 'PRIVATE_SENTINEL';
  const m = memfs(); const opened = open(m, config);
  const result = importFixedXpcObservation({ ...base(opened.owner), serializedRecord: JSON.stringify(source) });
  assert.equal(result.status, 'IMPORTED');
  assert.deepEqual(result.projection, {
    status: 'ENTRY', entryId: '0123456789abcdef0123456789abcdef:0:fixed-xpc', state: 'FAILED', authorizing: false
  });
  assert.equal(result.journal.snapshot.entries[0].entry.payload.process.errorCode, '[REDACTED]');
  assert.equal(JSON.stringify(result).includes('PRIVATE_SENTINEL'), false);
});

test('reentrant owner refusal is mapped once with no retry', () => {
  const m = memfs(); const opened = open(m); let nested = null; let entered = false;
  const openSync = m.fs.openSync;
  m.fs.openSync = (...args) => {
    if (!entered) {
      entered = true;
      const before = m.events.length;
      nested = importFixedXpcObservation(base(opened.owner));
      assert.equal(m.events.length, before);
    }
    return openSync(...args);
  };
  const outer = importFixedXpcObservation(base(opened.owner));
  assert.equal(outer.status, 'IMPORTED');
  assertOuter(nested, 'REFUSED', 'OWNER_BUSY', true);
  assert.equal(nested.projection.status, 'ENTRY');
  assert.deepEqual(nested.journal, { schemaVersion: 'nisi-journal-owner/v2', status: 'REFUSED', reason: 'OWNER_BUSY', authorizing: false });
});
