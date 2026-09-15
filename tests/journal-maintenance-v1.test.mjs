import test from 'node:test';
import assert from 'node:assert/strict';
import {openJournalOwner, inspectJournalOwner, recordJournalObservation, maintainJournalOwner} from '../history/journal-owner-v2.mjs';
import {reopen} from '../history/run-journal-v1.mjs';
import {memfs} from './journal-owner-v2.memfs.mjs';
import {CONFIG, PATH, entry, serialized, damageFooter, assertDeepFrozen, assertSnapshotShape} from './journal-owner-v2.helper.mjs';

const KEYS = ['schemaVersion', 'status', 'reason', 'store', 'snapshot', 'meaning', 'authorizing'];
const open = (m, now = 100, config = CONFIG) => openJournalOwner({path: PATH, fs: m.fs, config, now});
const maintain = (owner, now) => maintainJournalOwner({owner, now});
const record = (owner, row, now) => recordJournalObservation({owner, entry: row, now});
function assertResult(result, status, reason, snapshot = undefined) {
  assert.deepEqual(Object.keys(result).sort(), [...KEYS].sort());
  assert.equal(result.schemaVersion, 'nisi-journal-maintenance/v1');
  assert.equal(result.status, status); assert.equal(result.reason, reason);
  assert.equal(result.meaning, 'HISTORY_OBSERVATIONS_ONLY'); assert.equal(result.authorizing, false);
  if (snapshot !== undefined) assert.equal(result.snapshot, snapshot);
  assertDeepFrozen(result);
}
const revoked = (id = 'revoke-a', target = 'target-a', overrides = {}) => entry(id, {
  state: 'REVOKED', revokes: target, retryOf: null, receiptId: null, createdAt: 101, ...overrides
});

test('malformed envelopes, hidden fields, symbols and accessors refuse without getter invocation', () => {
  const opened = open(memfs()); let calls = 0;
  const getter = {owner: opened.owner}; Object.defineProperty(getter, 'now', {enumerable: true, get() { calls++; throw Error('no'); }});
  const hidden = {owner: opened.owner, now: 100}; Object.defineProperty(hidden, 'x', {value: true});
  const symbol = {owner: opened.owner, now: 100}; symbol[Symbol('x')] = true;
  for (const input of [null, [], {}, {owner: opened.owner}, {owner: opened.owner, now: 100, extra: true}, getter, hidden, symbol]) {
    const result = maintainJournalOwner(input); assertResult(result, 'REFUSED', 'INVALID_INPUT', null);
    assert.equal(result.store, null);
  }
  assert.equal(calls, 0);
});

test('invalid times and fabricated handles are INVALID_INPUT with no snapshot', () => {
  const opened = open(memfs());
  for (const now of [-0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '100']) {
    const result = maintain(opened.owner, now); assertResult(result, 'REFUSED', 'INVALID_INPUT', null);
  }
  for (const owner of [{}, {...opened.owner}, JSON.parse(JSON.stringify(opened.owner))])
    assertResult(maintain(owner, 100), 'REFUSED', 'INVALID_INPUT', null);
});

test('plain and null-prototype exact envelopes are accepted', () => {
  for (const nullProto of [false, true]) {
    const opened = open(memfs()); const values = {owner: opened.owner, now: 100};
    const input = nullProto ? Object.assign(Object.create(null), values) : values;
    assert.equal(maintainJournalOwner(input).status, 'MAINTAINED');
  }
});

test('SEALED owner refusal preserves its snapshot and performs no IO', () => {
  const m = memfs(); m.seed(PATH, damageFooter(serialized())); const opened = open(m); const before = m.events.length;
  const result = maintain(opened.owner, 100);
  assertResult(result, 'REFUSED', 'OWNER_SEALED', opened.snapshot); assert.equal(result.store, null);
  assert.equal(m.events.length, before);
});

test('COMMIT_UNCERTAIN owner refusal preserves quarantine and performs no IO', () => {
  const m = memfs(); const opened = open(m); let renamed = false; const rename = m.fs.renameSync, read = m.fs.readFileSync;
  m.fs.renameSync = (a, b) => { rename(a, b); renamed = true; };
  m.fs.readFileSync = path => renamed && path === PATH ? Buffer.from('bad') : read(path);
  assert.equal(record(opened.owner, entry(), 100).snapshot.state, 'COMMIT_UNCERTAIN'); const before = m.events.length;
  const result = maintain(opened.owner, 100);
  assertResult(result, 'REFUSED', 'COMMIT_UNCERTAIN', inspectJournalOwner({owner: opened.owner}).snapshot);
  assert.equal(m.events.length, before);
});

test('empty NEW owner persists a complete header/footer without synthetic observations', () => {
  const m = memfs(); const opened = open(m); const result = maintain(opened.owner, 100);
  assertResult(result, 'MAINTAINED', null); assert.equal(result.store.status, 'WRITTEN');
  assertSnapshotShape(result.snapshot); assert.deepEqual(result.snapshot.entries, []);
  const parsed = reopen(m.bytes(PATH).toString('utf8')); assert.equal(parsed.report.status, 'COMPLETE');
  assert.deepEqual(parsed.report.recoveredIds, []);
});

test('same-watermark repeat verifies disk and returns UNCHANGED without durability claim', () => {
  const m = memfs(); const opened = open(m); assert.equal(maintain(opened.owner, 100).status, 'MAINTAINED');
  const result = maintain(opened.owner, 100);
  assertResult(result, 'UNCHANGED', null); assert.equal(result.store.status, 'UNCHANGED');
  assert.equal(result.store.committed, false); assert.equal(result.store.durable, false);
});

test('later maintenance advances serialized watermark even when no payload expires', () => {
  const m = memfs(); const opened = open(m); const first = maintain(opened.owner, 100); const bytes = Buffer.from(m.bytes(PATH));
  const result = maintain(opened.owner, 101);
  assertResult(result, 'MAINTAINED', null); assert.equal(result.store.status, 'WRITTEN');
  assert.equal(m.bytes(PATH).equals(bytes), false); assert.notEqual(result.snapshot.sha256, first.snapshot.sha256);
});

test('backward maintenance time refuses TIME and preserves exact prior snapshot and disk', () => {
  const m = memfs(); const opened = open(m, 200); const first = maintain(opened.owner, 200); const disk = Buffer.from(m.bytes(PATH));
  const result = maintain(opened.owner, 199);
  assertResult(result, 'REFUSED', 'TIME', first.snapshot); assert.equal(result.store, null);
  assert.equal(m.bytes(PATH).equals(disk), true);
});

test('payload is retained immediately before TTL boundary', () => {
  const m = memfs(); const opened = open(m); assert.equal(record(opened.owner, entry('ttl', {createdAt: 100, ttlMs: 10}), 100).status, 'RECORDED');
  const result = maintain(opened.owner, 109);
  assert.equal(result.snapshot.entries[0].retained, true); assert.notEqual(result.snapshot.entries[0].entry.payload, null);
});

test('payload is removed exactly at TTL while identity and fingerprint remain', () => {
  const m = memfs(); const opened = open(m); const accepted = record(opened.owner, entry('ttl', {createdAt: 100, ttlMs: 10}), 100);
  assert.equal(accepted.status, 'RECORDED');
  const fingerprint = JSON.parse(m.bytes(PATH).toString('utf8').split('\n')[1]).record.fingerprint;
  assert.match(fingerprint, /^[0-9a-f]{64}$/);
  const result = maintain(opened.owner, 110);
  assertResult(result, 'MAINTAINED', null); const row = result.snapshot.entries[0];
  assert.equal(row.retained, false); assert.equal(row.entry.payload, null); assert.equal(row.entry.id, 'ttl');
  assert.equal(JSON.parse(m.bytes(PATH).toString('utf8').split('\n')[1]).record.fingerprint, fingerprint);
  assert.deepEqual(reopen(m.bytes(PATH).toString('utf8')).report.recoveredIds, ['ttl']);
});

test('revocation expires before its target without undoing revoked liveness after reopen', () => {
  const m = memfs(); const opened = open(m);
  assert.equal(record(opened.owner, entry('target-a', {ttlMs: 1000}), 100).status, 'RECORDED');
  assert.equal(record(opened.owner, revoked('revoke-a', 'target-a', {ttlMs: 1}), 101).status, 'RECORDED');
  assert.equal(maintain(opened.owner, 102).status, 'MAINTAINED');
  const fresh = open(m, 102);
  const target = fresh.snapshot.entries.find(row => row.entry.id === 'target-a');
  const revocation = fresh.snapshot.entries.find(row => row.entry.id === 'revoke-a');
  assert.equal(target.revoked, true); assert.equal(target.liveness, 'REVOKED'); assert.equal(target.retained, true);
  assert.equal(revocation.retained, false); assert.equal(revocation.entry.payload, null);
  assert.equal(revocation.entry.revokes, 'target-a');
});

test('capacity eviction of target and revocation payloads preserves their relation', () => {
  const config = {...CONFIG, maxEntries: 1}; const m = memfs(); const opened = open(m, 100, config);
  assert.equal(record(opened.owner, entry('target-a'), 100).status, 'RECORDED');
  assert.equal(record(opened.owner, revoked(), 101).status, 'RECORDED');
  assert.equal(record(opened.owner, entry('later', {createdAt: 102}), 102).status, 'RECORDED');
  assert.equal(maintain(opened.owner, 103).status, 'MAINTAINED');
  const fresh = open(m, 103, config);
  assert.deepEqual(fresh.snapshot.entries.map(row => row.entry.id), ['target-a', 'revoke-a', 'later']);
  assert.equal(fresh.snapshot.entries[0].entry.payload, null); assert.equal(fresh.snapshot.entries[0].revoked, true);
  assert.equal(fresh.snapshot.entries[1].entry.payload, null); assert.equal(fresh.snapshot.entries[1].entry.revokes, 'target-a');
});

test('same-watermark maintenance does not conceal disk drift behind unchanged private bytes', () => {
  const m = memfs(); const first = open(m); const maintained = maintain(first.owner, 100);
  assert.equal(maintained.status, 'MAINTAINED'); const writer = open(m);
  assert.equal(record(writer.owner, entry('new-writer'), 100).status, 'RECORDED');
  const disk = Buffer.from(m.bytes(PATH)); const result = maintain(first.owner, 100);
  assertResult(result, 'STORE_CONFLICT', 'CONFLICT', maintained.snapshot);
  assert.equal(m.bytes(PATH).equals(disk), true);
});

test('open-time private pruning is durably persisted even without newly expired payload', () => {
  const m = memfs(); const raw = serialized(CONFIG, [entry('old', {createdAt: 100, ttlMs: 10})], 100); m.seed(PATH, raw);
  const opened = open(m, 110); assert.equal(opened.snapshot.entries[0].entry.payload, null);
  assert.equal(m.bytes(PATH).toString('utf8'), raw);
  const result = maintain(opened.owner, 110); assert.equal(result.status, 'MAINTAINED');
  assert.equal(reopen(m.bytes(PATH).toString('utf8')).journal.list(110)[0].entry.payload, null);
});

test('maintenance preserves already-redacted payload and never restores caller secret', () => {
  const m = memfs(); const opened = open(m); const source = entry('redacted');
  assert.equal(record(opened.owner, source, 100).snapshot.entries[0].entry.payload.secret, '[REDACTED]');
  const result = maintain(opened.owner, 101);
  assert.equal(result.snapshot.entries[0].entry.payload.secret, '[REDACTED]');
  assert.equal(m.bytes(PATH).includes(Buffer.from('/synthetic/private')), false);
});

test('durable REVOKED row removes target liveness but preserves target payload before TTL', () => {
  const m = memfs(); const opened = open(m);
  assert.equal(record(opened.owner, entry('target-a', {state: 'RUNNING', heartbeatAt: 100}), 100).status, 'RECORDED');
  const accepted = record(opened.owner, revoked(), 101); assert.equal(accepted.status, 'RECORDED');
  const result = maintain(opened.owner, 102); assert.deepEqual(result.snapshot.interrupted, []);
  const target = result.snapshot.entries.find(row => row.entry.id === 'target-a');
  assert.equal(target.revoked, true); assert.notEqual(target.entry.payload, null);
});

test('revocation relation and both identities survive target TTL pruning and reopen', () => {
  const m = memfs(); const opened = open(m);
  record(opened.owner, entry('target-a', {createdAt: 100, ttlMs: 3}), 100);
  record(opened.owner, revoked('revoke-a', 'target-a', {ttlMs: 100}), 101);
  const result = maintain(opened.owner, 103); const target = result.snapshot.entries.find(row => row.entry.id === 'target-a');
  const tombstone = result.snapshot.entries.find(row => row.entry.id === 'revoke-a');
  assert.equal(target.entry.payload, null); assert.equal(target.revoked, true); assert.equal(tombstone.entry.revokes, 'target-a');
  const reopened = openJournalOwner({path: PATH, fs: m.fs, config: CONFIG, now: 103});
  assert.deepEqual(reopened.snapshot.recovery.recoveredIds, ['target-a', 'revoke-a']);
  assert.equal(reopened.snapshot.entries.find(row => row.entry.id === 'target-a').revoked, true);
});

test('replaying an expired target is DUPLICATE while changed content remains CONFLICT', () => {
  const m = memfs(); const opened = open(m); const original = entry('target-a', {createdAt: 100, ttlMs: 2});
  assert.equal(record(opened.owner, original, 100).status, 'RECORDED'); assert.equal(maintain(opened.owner, 102).status, 'MAINTAINED');
  const duplicate = record(opened.owner, original, 102); assert.equal(duplicate.status, 'DUPLICATE'); assert.equal(duplicate.store, null);
  const conflict = record(opened.owner, {...original, candidateId: 'changed'}, 102);
  assert.equal(conflict.status, 'CONFLICT'); assert.equal(conflict.reason, 'ID_CONTENT_MISMATCH'); assert.equal(conflict.store, null);
});

test('replaying a durable revocation is DUPLICATE and conflicting revocation is CONFLICT', () => {
  const m = memfs(); const opened = open(m); record(opened.owner, entry('target-a'), 100);
  const row = revoked(); assert.equal(record(opened.owner, row, 101).status, 'RECORDED'); maintain(opened.owner, 102);
  assert.equal(record(opened.owner, row, 102).status, 'DUPLICATE');
  const conflict = record(opened.owner, revoked('revoke-a', 'target-a', {runId: 'other'}), 102);
  assert.equal(conflict.status, 'CONFLICT'); assert.equal(conflict.reason, 'ID_CONTENT_MISMATCH');
});

test('REVOKED row validation still requires prior target and top-level revokes metadata', () => {
  const m = memfs(); const opened = open(m);
  assert.equal(record(opened.owner, revoked(), 101).status, 'REFUSED');
  record(opened.owner, entry('target-a'), 100);
  assert.equal(record(opened.owner, revoked('bad-retry', 'target-a', {retryOf: 'target-a'}), 101).status, 'REFUSED');
  assert.equal(record(opened.owner, revoked('bad-null', null), 101).status, 'REFUSED');
});

test('capacity pruning removes oldest payloads but conserves every accepted ID', () => {
  const m = memfs(); const opened = open(m);
  for (let i = 0; i < 9; i++) assert.equal(record(opened.owner,
    entry(`capacity-${i}`, {createdAt: 100 + i, ttlMs: 1000}), 100 + i).status, 'RECORDED');
  const result = maintain(opened.owner, 109);
  assert.deepEqual(result.snapshot.entries.map(row => row.entry.id), Array.from({length: 9}, (_, i) => `capacity-${i}`));
  assert.equal(result.snapshot.entries[0].entry.payload, null);
  assert.equal(result.snapshot.entries.filter(row => row.retained).length, CONFIG.maxEntries);
});

test('stale owner maintenance detects changed disk and preserves its prior snapshot', () => {
  const m = memfs(); const stale = open(m); const writer = open(m);
  assert.equal(record(writer.owner, entry('writer'), 100).status, 'RECORDED'); const prior = stale.snapshot;
  const result = maintain(stale.owner, 100);
  assertResult(result, 'STORE_CONFLICT', 'CONFLICT', prior); assert.equal(result.store.committed, false);
  assert.deepEqual(reopen(m.bytes(PATH).toString('utf8')).report.recoveredIds, ['writer']);
});

test('concurrent NEW owners accept identical bytes as verified UNCHANGED and reject different bytes', () => {
  const m = memfs(); const first = open(m); const identical = open(m); const different = open(m);
  assert.equal(maintain(first.owner, 100).status, 'MAINTAINED');
  const same = maintain(identical.owner, 100); assert.equal(same.status, 'UNCHANGED'); assert.equal(same.store.status, 'UNCHANGED');
  const conflict = maintain(different.owner, 101); assert.equal(conflict.status, 'STORE_CONFLICT');
  assert.equal(conflict.store.reason, 'CONFLICT'); assert.equal(conflict.store.committed, false);
});

test('precommit rename failure rolls back staged pruning and preserves disk bytes', () => {
  const m = memfs(); m.seed(PATH, serialized(CONFIG, [entry('old', {createdAt: 100, ttlMs: 10})], 100));
  const opened = open(m, 101); const prior = opened.snapshot; const disk = Buffer.from(m.bytes(PATH));
  m.fs.renameSync = () => { throw Object.assign(Error('private'), {code: 'EIO'}); };
  const result = maintain(opened.owner, 110);
  assertResult(result, 'STORE_FAILED', 'RENAME_FAILED', prior); assert.equal(result.store.committed, false);
  assert.equal(m.bytes(PATH).equals(disk), true); assert.equal(inspectJournalOwner({owner: opened.owner}).snapshot, prior);
});

test('postcommit readback failure quarantines owner and fresh reopen reconciles committed maintenance', () => {
  const m = memfs(); const opened = open(m); record(opened.owner, entry('old', {createdAt: 100, ttlMs: 10}), 100);
  let renamed = false; const rename = m.fs.renameSync, read = m.fs.readFileSync;
  m.fs.renameSync = (a, b) => { rename(a, b); renamed = true; };
  m.fs.readFileSync = path => renamed && path === PATH ? Buffer.from('mismatch') : read(path);
  const result = maintain(opened.owner, 110);
  assert.equal(result.status, 'STORE_FAILED'); assert.equal(result.store.committed, true);
  assertSnapshotShape(result.snapshot, 'COMMIT_UNCERTAIN');
  assertResult(maintain(opened.owner, 111), 'REFUSED', 'COMMIT_UNCERTAIN', result.snapshot);
  const fresh = openJournalOwner({path: PATH, fs: {...m.fs, readFileSync: read}, config: CONFIG, now: 110});
  assert.equal(fresh.status, 'OPENED'); assert.equal(fresh.snapshot.entries[0].entry.payload, null);
});

test('missing fsync truthfully succeeds as non-durable MAINTAINED', () => {
  const m = memfs(); const fs = {...m.fs}; delete fs.fsyncSync;
  const opened = openJournalOwner({path: PATH, fs, config: CONFIG, now: 100});
  const result = maintain(opened.owner, 100);
  assert.equal(result.status, 'MAINTAINED'); assert.equal(result.store.status, 'WRITTEN');
  assert.equal(result.store.durable, false); assert.deepEqual(result.store.fsync, {file: false, directory: false});
});

test('coherent fsync faults remain verified non-durable success rather than uncertainty', () => {
  const m = memfs({fsyncSync: () => Object.assign(Error('fsync'), {code: 'EIO'})}); const opened = open(m);
  const result = maintain(opened.owner, 100);
  assert.equal(result.status, 'MAINTAINED'); assert.equal(result.store.status, 'WRITTEN');
  assert.equal(result.store.durable, false); assert.equal(result.snapshot.state, 'OPEN');
});

test('maintenance holds the shared busy guard against reentrant record', () => {
  const m = memfs(); const opened = open(m); let nested = null, entered = false; const openSync = m.fs.openSync;
  m.fs.openSync = (...args) => {
    if (!entered) { entered = true; nested = record(opened.owner, entry('nested'), 100); }
    return openSync(...args);
  };
  assert.equal(maintain(opened.owner, 100).status, 'MAINTAINED');
  assert.equal(nested.status, 'REFUSED'); assert.equal(nested.reason, 'OWNER_BUSY');
  assert.deepEqual(inspectJournalOwner({owner: opened.owner}).snapshot.entries, []);
});

test('record holds the shared busy guard against reentrant maintenance', () => {
  const m = memfs(); const opened = open(m); let nested = null, entered = false; const openSync = m.fs.openSync;
  m.fs.openSync = (...args) => {
    if (!entered) { entered = true; nested = maintain(opened.owner, 100); }
    return openSync(...args);
  };
  assert.equal(record(opened.owner, entry('outer'), 100).status, 'RECORDED');
  assertResult(nested, 'REFUSED', 'OWNER_BUSY', opened.snapshot); assert.equal(nested.store, null);
});

test('busy guard is released after failed maintenance', () => {
  const m = memfs(); const opened = open(m); const rename = m.fs.renameSync;
  m.fs.renameSync = () => { throw Object.assign(Error('fail'), {code: 'EIO'}); };
  assert.equal(maintain(opened.owner, 100).status, 'STORE_FAILED');
  m.fs.renameSync = rename; assert.equal(maintain(opened.owner, 100).status, 'MAINTAINED');
});

test('maintenance snapshots are immutable and older returned payload snapshots are not erased retroactively', () => {
  const m = memfs(); const opened = open(m); const accepted = record(opened.owner, entry('old', {createdAt: 100, ttlMs: 2}), 100);
  const oldSnapshot = accepted.snapshot; const result = maintain(opened.owner, 102);
  assert.equal(result.snapshot.entries[0].entry.payload, null);
  assert.notEqual(oldSnapshot.entries[0].entry.payload, null);
  assert.throws(() => { result.snapshot.entries[0].entry.id = 'changed'; }, TypeError);
  assertDeepFrozen(result.store); assertDeepFrozen(result.snapshot);
});
