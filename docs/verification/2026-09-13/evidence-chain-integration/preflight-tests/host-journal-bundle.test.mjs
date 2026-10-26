import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openJournalBundle as open, recordFixedRun as record } from '../history/host-journal-bundle.mjs';
import { createRunJournal, reopen } from '../history/run-journal-v1.mjs';
import { writeSerializedJournal, readSerializedJournal } from '../history/run-journal-store-v1.mjs';
import { fixedRunJournalEntry } from '../history/fixed-run-journal-entry.mjs';
import { memfs, sha256 } from './helpers/memfs.mjs';

const OBSERVED = JSON.parse(await readFile(new URL('./fixtures/fixed-run/summary-observed.json', import.meta.url), 'utf8'));
const TIMEOUT = JSON.parse(await readFile(new URL('./fixtures/fixed-run/summary-timeout.json', import.meta.url), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const PATH = '/j/journal.jsonl';
const CONFIG = { projectId: 'project-a', maxEntries: 8, heartbeatTtlMs: 10, redactPaths: [] };
const opened = (m, patch = {}) => open({ path: PATH, fs: m.fs, config: CONFIG, now: 100, ...patch });
const run = (patch = {}) => ({ summary: clone(OBSERVED), runId: 'run-a', attempt: 0, candidateId: 'candidate-a', receiptId: 'receipt-a', createdAt: 100, ttlMs: 1000, ...patch });
const refused = (r, reason, label = '') => { assert.equal(r.status, 'REFUSED', `${label} ${JSON.stringify(r).slice(0, 200)}`); assert.equal(r.reason, reason, label); assert.equal(r.authorizing, false, label); };
const seedJournal = (m, entries = [], now = 100) => {
  const j = createRunJournal(CONFIG);
  for (const e of entries) assert.equal(j.append(e, now).status, 'APPENDED');
  const ser = j.serialize(); m.seed(PATH, ser); return ser;
};
const journalEntry = (id, patch = {}) => ({ id, projectId: 'project-a', runId: 'run-x', attempt: 0, candidateId: 'candidate-x', stage: 'tests', receiptId: null,
  createdAt: 50, ttlMs: 1000, state: 'RUNNING', heartbeatAt: 50, retryOf: null, revokes: null, payload: { note: 'seeded' }, ...patch });

test('opening an absent path yields an empty bundle that reports NEW and holds no history', () => {
  const m = memfs();
  const b = opened(m);
  assert.deepEqual(Object.keys(b), ['status', 'recovery', 'sha256', 'bytes', 'entries', 'interrupted', 'journal', 'authorizing']);
  assert.equal(b.status, 'OPEN');
  assert.deepEqual(b.recovery, { status: 'NEW', recoveredIds: [], rejectedLine: null, reason: null, authorizing: false });
  assert.equal(b.sha256, null);
  assert.equal(b.bytes, 0);
  assert.deepEqual(b.entries, []);
  assert.deepEqual(b.interrupted, []);
  assert.equal(typeof b.journal.append, 'function');
  assert.equal(b.authorizing, false);
  assert.deepEqual(m.names(), [], 'opening never writes');
  assert.deepEqual(m.events.map(e => e.name), ['readFileSync']);
});

test('opening a complete persisted journal reports COMPLETE, the on-disk hash and every retained row', () => {
  const m = memfs();
  const ser = seedJournal(m, [journalEntry('done', { state: 'SUCCEEDED', heartbeatAt: null })]);
  const b = opened(m);
  assert.equal(b.status, 'OPEN');
  assert.equal(b.recovery.status, 'COMPLETE');
  assert.deepEqual(b.recovery.recoveredIds, ['done']);
  assert.equal(b.sha256, sha256(Buffer.from(ser, 'utf8')));
  assert.equal(b.bytes, Buffer.byteLength(ser, 'utf8'));
  assert.equal(b.entries.length, 1);
  assert.equal(b.entries[0].entry.id, 'done');
  assert.equal(b.entries[0].historical, true);
  assert.equal(b.entries[0].liveness, 'SUCCEEDED');
  assert.deepEqual(b.interrupted, []);
  assert.deepEqual(m.events.map(e => e.name), ['readFileSync']);
});

test('interrupted work is a RUNNING row whose heartbeat is stale at open time, reported by id with its liveness', () => {
  const m = memfs();
  seedJournal(m, [journalEntry('fresh', { heartbeatAt: 95, createdAt: 95 }), journalEntry('stale', { heartbeatAt: 50 }), journalEntry('never', { heartbeatAt: null }),
    journalEntry('finished', { state: 'FAILED', heartbeatAt: null })], 100);
  const b = opened(m, { now: 100 });
  assert.deepEqual(b.interrupted.map(x => [x.id, x.liveness]), [['stale', 'UNKNOWN'], ['never', 'UNKNOWN']]);
  assert.deepEqual(Object.keys(b.interrupted[0]), ['id', 'runId', 'attempt', 'stage', 'liveness', 'heartbeatAt', 'createdAt']);
  const later = opened(m, { now: 200 });
  assert.deepEqual(later.interrupted.map(x => x.id), ['fresh', 'stale', 'never'], 'fresh becomes stale once the heartbeat TTL lapses');
  const expired = opened(m, { now: 2000 });
  assert.deepEqual(expired.interrupted, [], 'expired rows are not interrupted work; they are EXPIRED');
  assert.ok(expired.entries.every(r => r.liveness === 'EXPIRED' || r.liveness === 'FAILED'));
});

test('a truncated or corrupt persisted journal opens SEALED: prefix recovered, nothing appendable, no rewrite', () => {
  const m = memfs();
  const ser = seedJournal(m, [journalEntry('a', { state: 'SUCCEEDED', heartbeatAt: null }), journalEntry('b', { state: 'SUCCEEDED', heartbeatAt: null })]);
  const lines = ser.split('\n');
  m.seed(PATH, lines.slice(0, 3).join('\n') + '\n');
  const b = opened(m);
  assert.equal(b.status, 'SEALED');
  assert.equal(b.recovery.status, 'INCOMPLETE');
  assert.equal(b.recovery.reason, 'MISSING_FOOTER');
  assert.deepEqual(b.recovery.recoveredIds, ['a', 'b']);
  assert.equal(b.entries.length, 2);
  assert.equal(b.journal.append(journalEntry('c'), 100).status, 'REFUSED');
  refused(record({ bundle: b, run: run(), now: 100 }), 'BUNDLE_SEALED');
  assert.deepEqual(m.events.map(e => e.name), ['readFileSync', 'readFileSync'], 'a sealed bundle never writes');
  m.seed(PATH, ser.replace('"count":2', '"count":9'));
  const c = opened(m);
  assert.equal(c.status, 'SEALED');
  assert.equal(c.recovery.status, 'INVALID');
  assert.equal(c.recovery.reason, 'FOOTER');
  m.seed(PATH, 'not a journal\n');
  const d = opened(m);
  assert.equal(d.status, 'SEALED');
  assert.equal(d.recovery.status, 'INVALID');
  assert.deepEqual(d.entries, []);
});

test('a journal for another project or an unreadable file is refused at open, never adopted', () => {
  const m = memfs();
  const other = createRunJournal({ ...CONFIG, projectId: 'project-b' }); m.seed(PATH, other.serialize());
  const b = opened(m);
  assert.equal(b.status, 'REFUSED');
  assert.equal(b.reason, 'PROJECT_MISMATCH');
  assert.equal(b.authorizing, false);
  const f = memfs({ readFileSync: () => Object.assign(new Error('EACCES'), { code: 'EACCES' }) });
  const c = opened(f);
  assert.equal(c.status, 'REFUSED');
  assert.equal(c.reason, 'READ_FAILED');
  for (const bad of [undefined, null, 'x', [], { path: PATH }, { path: PATH, fs: m.fs }, { path: PATH, fs: m.fs, config: CONFIG }, { path: PATH, fs: m.fs, config: CONFIG, now: -1 },
    { path: PATH, fs: m.fs, config: { ...CONFIG, maxEntries: 0 }, now: 100 }, { path: '', fs: m.fs, config: CONFIG, now: 100 }]) {
    const r = open(bad);
    assert.equal(r.status, 'REFUSED', JSON.stringify(bad));
    assert.equal(r.reason, 'INVALID_INPUT', JSON.stringify(bad));
  }
});

test('recording an observed fixed run appends, persists durably with the expected-previous hash, and reports the new on-disk hash', () => {
  const m = memfs();
  const b = opened(m);
  const r = record({ bundle: b, run: run(), now: 100 });
  assert.deepEqual(Object.keys(r), ['status', 'entryId', 'journal', 'store', 'sha256', 'bytes', 'authorizing']);
  assert.equal(r.status, 'RECORDED');
  assert.equal(r.entryId, 'run-a:0:fixed-run');
  assert.deepEqual(r.journal, { status: 'APPENDED', id: 'run-a:0:fixed-run' });
  assert.equal(r.store.status, 'WRITTEN');
  assert.equal(r.store.durable, true);
  assert.equal(r.store.committed, true);
  assert.equal(r.sha256, r.store.sha256);
  assert.equal(r.bytes, r.store.bytes);
  assert.equal(r.authorizing, false);
  assert.equal(sha256(m.bytes(PATH)), r.sha256, 'reported hash is the on-disk hash');
  const back = reopen(m.bytes(PATH).toString('utf8'));
  assert.equal(back.report.status, 'COMPLETE');
  assert.deepEqual(back.report.recoveredIds, ['run-a:0:fixed-run']);
  const row = back.journal.list(100)[0];
  assert.equal(row.entry.state, 'SUCCEEDED');
  assert.equal(row.entry.payload.overall, 'OBSERVED');
  assert.equal(row.entry.payload.table, OBSERVED.table);
  const expected = fixedRunJournalEntry({ projectId: 'project-a', ...run() }).entry;
  assert.deepEqual(row.entry, expected, 'the persisted entry is exactly what the accepted builder produces');
  const writes = m.events.filter(e => e.name === 'openSync' && e.args[1] === 'wx');
  assert.equal(writes.length, 1, 'exactly one temp file was created');
  assert.deepEqual(m.names(), [PATH], 'no temp file remains');
});

test('the second record on the same open bundle chains on the first: expected-previous is the last written hash', () => {
  const m = memfs();
  const b = opened(m);
  const first = record({ bundle: b, run: run(), now: 100 });
  const second = record({ bundle: b, run: run({ summary: clone(TIMEOUT), attempt: 1, candidateId: 'candidate-b', createdAt: 150 }), now: 150 });
  assert.equal(second.status, 'RECORDED');
  assert.equal(second.entryId, 'run-a:1:fixed-run');
  assert.notEqual(second.sha256, first.sha256);
  const back = reopen(m.bytes(PATH).toString('utf8'));
  assert.deepEqual(back.report.recoveredIds, ['run-a:0:fixed-run', 'run-a:1:fixed-run']);
  assert.deepEqual(back.journal.list(150).map(x => [x.entry.id, x.entry.state]), [['run-a:0:fixed-run', 'SUCCEEDED'], ['run-a:1:fixed-run', 'FAILED']]);
  assert.deepEqual(b.entries.map(x => x.entry.id), ['run-a:0:fixed-run', 'run-a:1:fixed-run'], 'the open bundle view reflects both records');
  assert.equal(b.sha256, second.sha256, 'the bundle tracks the last on-disk hash');
});

test('identical replay is idempotent and touches nothing on disk; same identity with different content is a CONFLICT that writes nothing', () => {
  const m = memfs();
  const b = opened(m);
  record({ bundle: b, run: run(), now: 100 });
  const before = m.events.length; const bytesBefore = Buffer.from(m.bytes(PATH));
  const dup = record({ bundle: b, run: run(), now: 100 });
  assert.equal(dup.status, 'DUPLICATE');
  assert.deepEqual(dup.journal, { status: 'DUPLICATE', id: 'run-a:0:fixed-run' });
  assert.equal(dup.store, null);
  assert.equal(dup.sha256, b.sha256);
  assert.equal(m.events.length, before, 'no fs activity on a duplicate');
  const conflict = record({ bundle: b, run: run({ summary: clone(TIMEOUT) }), now: 100 });
  assert.equal(conflict.status, 'CONFLICT');
  assert.deepEqual(conflict.journal, { status: 'CONFLICT', id: 'run-a:0:fixed-run', reason: 'ID_CONTENT_MISMATCH' });
  assert.equal(conflict.store, null);
  assert.equal(m.events.length, before, 'no fs activity on a conflict');
  assert.ok(bytesBefore.equals(m.bytes(PATH)));
});

test('an invalid run is refused by the builder before the journal or disk is touched; a bad clock is refused too', () => {
  const m = memfs();
  const b = opened(m);
  const before = m.events.length;
  const r = record({ bundle: b, run: run({ runId: '' }), now: 100 });
  refused(r, 'INVALID_RUN');
  assert.equal(r.entryId, null);
  assert.equal(r.journal, null);
  assert.equal(r.store, null);
  const s = record({ bundle: b, run: run({ summary: { bogus: true } }), now: 100 });
  refused(s, 'INVALID_SUMMARY');
  const t = record({ bundle: b, run: run({ createdAt: 500 }), now: 100 });
  refused(t, 'ENTRY', 'createdAt after now is refused by the journal as an ENTRY fault, forwarded unchanged');
  assert.equal(t.entryId, 'run-a:0:fixed-run', 'the entry was built before the journal refused it');
  assert.equal(m.events.length, before, 'refusals never touch the fs');
  assert.equal(record({ bundle: b, run: run(), now: 100 }).status, 'RECORDED');
  const back = record({ bundle: b, run: run({ attempt: 1, createdAt: 90 }), now: 90 });
  refused(back, 'TIME', 'a clock earlier than the journal watermark is the TIME rule, forwarded unchanged');
  for (const bad of [undefined, null, {}, { bundle: b }, { bundle: b, run: run() }, { bundle: b, run: run(), now: -0 }, { bundle: b, run: run(), now: 1.5 }, { bundle: {}, run: run(), now: 100 }]) {
    refused(record(bad), 'INVALID_INPUT', JSON.stringify(bad && bad.now));
  }
});

test('a disk that changed underneath the bundle is a STORE_CONFLICT: the append is rolled back and the caller must reopen', () => {
  const m = memfs();
  const b = opened(m);
  record({ bundle: b, run: run(), now: 100 });
  // an interloper rewrites the file with a different valid journal
  const other = createRunJournal(CONFIG); other.append(journalEntry('interloper', { state: 'SUCCEEDED', heartbeatAt: null }), 100);
  const foreign = other.serialize(); m.seed(PATH, foreign);
  const r = record({ bundle: b, run: run({ attempt: 1, createdAt: 120 }), now: 120 });
  assert.equal(r.status, 'STORE_CONFLICT');
  assert.equal(r.entryId, 'run-a:1:fixed-run');
  assert.deepEqual(r.journal, { status: 'APPENDED', id: 'run-a:1:fixed-run' });
  assert.equal(r.store.status, 'REFUSED');
  assert.equal(r.store.reason, 'CONFLICT');
  assert.equal(r.sha256, b.sha256, 'the reported hash is still the last one this bundle wrote');
  assert.equal(m.bytes(PATH).toString('utf8'), foreign, 'the interloper bytes are preserved');
  assert.deepEqual(b.entries.map(x => x.entry.id), ['run-a:0:fixed-run'], 'the failed append is not part of the bundle view');
  const again = record({ bundle: b, run: run({ attempt: 1, createdAt: 120 }), now: 120 });
  assert.equal(again.status, 'STORE_CONFLICT', 'the bundle stays consistent: the same record fails the same way until reopened');
  assert.equal(b.status, 'OPEN');
});

test('a non-durable write is reported, not hidden: WRITTEN with durable:false keeps the bundle open and the hash advanced', () => {
  const m = memfs({ fsyncSync: (args) => (typeof args[1] === 'string' && args[1].endsWith('/j') ? Object.assign(new Error('EIO'), { code: 'EIO' }) : null) });
  const b = opened(m);
  const r = record({ bundle: b, run: run(), now: 100 });
  assert.equal(r.status, 'RECORDED');
  assert.equal(r.store.status, 'WRITTEN');
  assert.equal(r.store.durable, false);
  assert.equal(r.store.fsyncErrors.directory, 'EIO');
  assert.equal(r.store.fsyncErrors.file, null);
  assert.equal(b.sha256, r.sha256);
  assert.equal(sha256(m.bytes(PATH)), r.sha256);
});

test('an interrupted write (rename fails) is STORE_FAILED: old bytes intact, no temp left, append rolled back', () => {
  let armed = false;
  const m = memfs({ renameSync: () => (armed ? Object.assign(new Error('EIO'), { code: 'EIO' }) : null) });
  const b = opened(m);
  const first = record({ bundle: b, run: run(), now: 100 });
  const bytesBefore = Buffer.from(m.bytes(PATH));
  armed = true;
  const r = record({ bundle: b, run: run({ attempt: 1, createdAt: 120 }), now: 120 });
  assert.equal(r.status, 'STORE_FAILED');
  assert.equal(r.store.status, 'REFUSED');
  assert.equal(r.store.reason, 'RENAME_FAILED');
  assert.equal(r.store.committed, false);
  assert.ok(bytesBefore.equals(m.bytes(PATH)), 'destination untouched');
  assert.deepEqual(m.names(), [PATH], 'the owned temp was cleaned up');
  assert.equal(r.sha256, first.sha256);
  assert.deepEqual(b.entries.map(x => x.entry.id), ['run-a:0:fixed-run']);
  armed = false;
  const retry = record({ bundle: b, run: run({ attempt: 1, createdAt: 120 }), now: 120 });
  assert.equal(retry.status, 'RECORDED', 'after the fault clears the same record succeeds on the same bundle');
});

test('a fresh open after recording sees the record and reports no interrupted work for a finished run', () => {
  const m = memfs();
  record({ bundle: opened(m), run: run(), now: 100 });
  const b2 = opened(m, { now: 150 });
  assert.equal(b2.recovery.status, 'COMPLETE');
  assert.deepEqual(b2.recovery.recoveredIds, ['run-a:0:fixed-run']);
  assert.deepEqual(b2.interrupted, []);
  assert.equal(b2.entries[0].historical, true);
  assert.equal(b2.entries[0].entry.state, 'SUCCEEDED');
});

test('bundle module imports only the three frozen siblings and stays pure', async () => {
  const source = await readFile(new URL('../history/host-journal-bundle.mjs', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/^\s*import\b[^\n]*from\s+['"]([^'"]+)['"]/gm)].map(m => m[1]);
  assert.deepEqual([...new Set(imports)].sort(), ['./fixed-run-journal-entry.mjs', './run-journal-store-v1.mjs', './run-journal-v1.mjs']);
  assert.doesNotMatch(source, /\b(?:require|process|fetch|XMLHttpRequest|eval|Function|setTimeout|setInterval|globalThis|structuredClone)\b/);
  assert.doesNotMatch(source, /\b(?:Date|performance)\b|Math\s*\.\s*random\b/);
  assert.doesNotMatch(source, /from\s+['"]node:/, 'no node: imports; the fs is injected');
  const ns = await import('../history/host-journal-bundle.mjs');
  assert.deepEqual(Object.keys(ns).sort(), ['openJournalBundle', 'recordFixedRun']);
});
