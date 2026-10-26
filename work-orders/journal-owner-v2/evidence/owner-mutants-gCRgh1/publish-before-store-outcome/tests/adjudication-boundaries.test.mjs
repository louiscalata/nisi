import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { openJournalOwner, inspectJournalOwner, recordJournalObservation } from '../src/index.mjs';
import { reopen } from '../src/run-journal-v1.mjs';
import { memfs } from './memfs.mjs';
import { CONFIG, PATH, entry, serialized, simpleRefusal, damageFooter } from './helper.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const open = (m, overrides = {}) => openJournalOwner({ path: PATH, fs: m.fs, config: CONFIG, now: 100, ...overrides });

test('NEW open publishes its accepted clock: a later record below it gets journal TIME', () => {
  const m = memfs();
  const opened = open(m, { now: 200 });
  const before = opened.snapshot;
  const result = recordJournalObservation({ owner: opened.owner, entry: entry('behind-new', { createdAt: 199 }), now: 199 });
  assert.equal(result.status, 'REFUSED');
  assert.equal(result.reason, 'TIME');
  assert.equal(result.snapshot, before);
  assert.equal(m.bytes(PATH), undefined);
});

test('concurrent NEW owners: identical first bytes are UNCHANGED and non-durable, different bytes conflict', () => {
  const m = memfs();
  const writer = open(m);
  const identical = open(m);
  const different = open(m);
  const first = recordJournalObservation({ owner: writer.owner, entry: entry('same'), now: 100 });
  assert.equal(first.status, 'RECORDED');
  assert.equal(first.store.status, 'WRITTEN');
  const replay = recordJournalObservation({ owner: identical.owner, entry: entry('same'), now: 100 });
  assert.equal(replay.status, 'RECORDED');
  assert.equal(replay.store.status, 'UNCHANGED');
  assert.equal(replay.store.committed, false);
  assert.equal(replay.store.durable, false);
  assert.equal(replay.snapshot.sha256, first.snapshot.sha256);
  const conflict = recordJournalObservation({ owner: different.owner, entry: entry('different'), now: 100 });
  assert.equal(conflict.status, 'STORE_CONFLICT');
  assert.equal(conflict.store.status, 'REFUSED');
  assert.equal(conflict.store.reason, 'CONFLICT');
  assert.equal(conflict.store.committed, false);
  assert.deepEqual(reopen(m.bytes(PATH).toString('utf8')).report.recoveredIds, ['same']);
});

test('ordered redactPaths binding refuses the same two paths in reversed order', () => {
  const expected = { ...CONFIG, redactPaths: ['payload.secret', 'payload.observation.status'] };
  const reversed = { ...CONFIG, redactPaths: ['payload.observation.status', 'payload.secret'] };
  const m = memfs();
  m.seed(PATH, serialized(reversed, [entry('ordered-paths')], 100));
  assert.deepEqual(open(m, { config: expected }), simpleRefusal('CONFIG_MISMATCH'));
});

test('COMPLETE open-time pruning keeps raw disk CAS hash while staging the pruned memory serialization', () => {
  const m = memfs();
  const raw = Buffer.from(serialized(CONFIG, [entry('expires', { createdAt: 100, ttlMs: 50 })], 100));
  m.seed(PATH, raw);
  const opened = open(m, { now: 150 });
  assert.equal(opened.snapshot.sha256, digest(raw));
  assert.equal(opened.snapshot.bytes, raw.length);
  assert.equal(m.bytes(PATH).equals(raw), true);
  assert.equal(opened.snapshot.entries[0].retained, false);
  assert.equal(opened.snapshot.entries[0].entry.payload, null);
  const result = recordJournalObservation({ owner: opened.owner, entry: entry('after-prune', { createdAt: 150 }), now: 150 });
  assert.equal(result.status, 'RECORDED');
  assert.equal(result.store.status, 'WRITTEN');
  assert.deepEqual(result.snapshot.recovery.recoveredIds, ['expires', 'after-prune']);
  assert.equal(result.snapshot.entries[0].retained, false);
  assert.equal(result.snapshot.entries[0].entry.payload, null);
  assert.equal(result.snapshot.sha256, digest(m.bytes(PATH)));
});

test('damaged-prefix precedence is project, then config, then clock', () => {
  const foreignConfig = { projectId: 'project-b', maxEntries: 9, heartbeatTtlMs: 11, redactPaths: [] };
  const foreign = damageFooter(serialized(foreignConfig, [entry('foreign', {
    projectId: 'project-b', createdAt: 200, payload: { secret: 'x', observation: { status: 'OBSERVED' } }
  })], 200));
  const foreignFs = memfs(); foreignFs.seed(PATH, foreign);
  assert.deepEqual(open(foreignFs, { now: 100 }), simpleRefusal('PROJECT_MISMATCH'));

  const driftConfig = { ...CONFIG, maxEntries: 9 };
  const drift = damageFooter(serialized(driftConfig, [entry('drift', { createdAt: 200 })], 200));
  const driftFs = memfs(); driftFs.seed(PATH, drift);
  assert.deepEqual(open(driftFs, { now: 100 }), simpleRefusal('CONFIG_MISMATCH'));

  const clock = damageFooter(serialized(CONFIG, [entry('clock', { createdAt: 200 })], 200));
  const clockFs = memfs(); clockFs.seed(PATH, clock);
  assert.deepEqual(open(clockFs, { now: 100 }), simpleRefusal('CLOCK_BEHIND_JOURNAL'));
});

test('valid null-prototype outer envelopes are supported with a genuine private handle', () => {
  const m = memfs();
  const openInput = Object.assign(Object.create(null), { path: PATH, fs: m.fs, config: CONFIG, now: 100 });
  const opened = openJournalOwner(openInput);
  assert.equal(opened.status, 'OPENED');

  const inspectInput = Object.assign(Object.create(null), { owner: opened.owner });
  assert.equal(inspectJournalOwner(inspectInput).snapshot, opened.snapshot);

  const recordInput = Object.assign(Object.create(null), { owner: opened.owner, entry: entry('null-proto'), now: 100 });
  const result = recordJournalObservation(recordInput);
  assert.equal(result.status, 'RECORDED');
  assert.deepEqual(result.snapshot.recovery.recoveredIds, ['null-proto']);
  assert.equal(result.authorizing, false);
});
