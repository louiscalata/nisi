import test from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openJournalOwner, inspectJournalOwner, recordJournalObservation } from '../src/index.mjs';
import { reopen } from '../src/run-journal-v1.mjs';
import { memfs } from './memfs.mjs';
import { CONFIG, PATH, entry, serialized, assertDeepFrozen, assertSnapshotShape, simpleRefusal, damageFooter, truncateAfterEntries } from './helper.mjs';

const open = (m, overrides = {}) => openJournalOwner({ path: PATH, fs: m.fs, config: CONFIG, now: 100, ...overrides });
const inspect = owner => inspectJournalOwner({ owner });
const record = (owner, row = entry(), now = 100) => recordJournalObservation({ owner, entry: row, now });

test('NEW open returns an opaque unique owner and exact frozen empty snapshot', () => {
  const a = open(memfs());
  const b = open(memfs());
  assert.deepEqual(Object.keys(a).sort(), ['authorizing', 'owner', 'schemaVersion', 'snapshot', 'status'].sort());
  assert.equal(a.schemaVersion, 'nisi-journal-owner/v2');
  assert.equal(a.status, 'OPENED');
  assert.equal(a.authorizing, false);
  assert.notEqual(a.owner, b.owner);
  assert.deepEqual(Object.keys(a.owner), []);
  assertDeepFrozen(a.owner);
  assertSnapshotShape(a.snapshot);
  assert.deepEqual(a.snapshot.recovery, { status: 'NEW', recoveredIds: [], rejectedLine: null, reason: null, authorizing: false });
  assert.equal(a.snapshot.sha256, null);
  assert.equal(a.snapshot.bytes, 0);
  assert.deepEqual(a.snapshot.entries, []);
});

test('inspection is nonmutating and may return the same latest snapshot reference', () => {
  const opened = open(memfs());
  const first = inspect(opened.owner);
  const second = inspect(opened.owner);
  assert.deepEqual(Object.keys(first).sort(), ['authorizing', 'schemaVersion', 'snapshot', 'status'].sort());
  assert.equal(first.status, 'SNAPSHOT');
  assert.equal(first.snapshot, opened.snapshot);
  assert.equal(second.snapshot, first.snapshot);
  assert.equal(first.authorizing, false);
});

test('request envelopes reject extra, hidden, symbol, accessor, array and exotic forms without invoking getters', () => {
  let calls = 0;
  const getter = {}; Object.defineProperty(getter, 'owner', { enumerable: true, get() { calls++; throw new Error('must not run'); } });
  const cases = [null, [], { owner: {} }, { owner: {}, extra: 1 }, Object.assign(Object.create(null), { owner: {} }), getter];
  const hidden = { owner: {} }; Object.defineProperty(hidden, 'hidden', { value: 1 }); cases.push(hidden);
  const symbol = { owner: {} }; symbol[Symbol('x')] = 1; cases.push(symbol);
  for (const value of cases) assert.deepEqual(inspectJournalOwner(value), simpleRefusal('INVALID_INPUT'));
  assert.equal(calls, 0);
});

test('manufactured, copied and JSON-roundtripped handles are refused', () => {
  const opened = open(memfs());
  for (const owner of [{}, { ...opened.owner }, JSON.parse(JSON.stringify(opened.owner))]) {
    assert.deepEqual(inspect(owner), simpleRefusal('INVALID_INPUT'));
    assert.deepEqual(record(owner), simpleRefusal('INVALID_INPUT'));
  }
});

test('open validates path, time, fs and exact config without throwing', () => {
  const m = memfs();
  for (const overrides of [{ path: '' }, { path: 'x\0y' }, { path: '\ud800' }, { now: -0 }, { now: -1 }, { now: 1.5 }, { fs: {} }, { config: { ...CONFIG, extra: true } }]) {
    assert.deepEqual(open(m, overrides), simpleRefusal('INVALID_INPUT'));
  }
});

test('open copies configuration and is not changed by later caller mutation', () => {
  const m = memfs();
  const config = { ...CONFIG, redactPaths: [...CONFIG.redactPaths] };
  const opened = open(m, { config });
  config.projectId = 'project-b'; config.redactPaths[0] = 'payload.observation';
  const result = record(opened.owner);
  assert.equal(result.status, 'RECORDED');
  assert.equal(result.snapshot.entries[0].entry.projectId, 'project-a');
  assert.equal(result.snapshot.entries[0].entry.payload.secret, '[REDACTED]');
});

test('read failures, non-Buffer reads, invalid UTF-8 and size limit refuse without owner exposure', () => {
  const io = memfs({ readFileSync: () => Object.assign(new Error('denied'), { code: 'EACCES' }) });
  assert.deepEqual(open(io), simpleRefusal('READ_FAILED'));
  const nonBuffer = memfs(); nonBuffer.fs.readFileSync = () => 'not bytes';
  assert.deepEqual(open(nonBuffer), simpleRefusal('READ_FAILED'));
  const bad = memfs(); bad.seed(PATH, Buffer.from([0xc3, 0x28]));
  assert.deepEqual(open(bad), simpleRefusal('INVALID_UTF8'));
  const invalid = memfs(); invalid.seed(PATH, Buffer.from('ordinary UTF-8, but not a journal\n'));
  assert.deepEqual(open(invalid), simpleRefusal('INVALID_JOURNAL'));
  const huge = memfs(); huge.seed(PATH, Buffer.alloc(16 * 1024 * 1024 + 1, 0x20));
  assert.deepEqual(open(huge), simpleRefusal('SIZE_LIMIT'));
});

test('bad UTF-8 suffix after a valid prefix never exposes a lossy recovered row', () => {
  const m = memfs();
  m.seed(PATH, Buffer.concat([Buffer.from(truncateAfterEntries(serialized())), Buffer.from([0xc3, 0x28])]));
  assert.deepEqual(open(m), simpleRefusal('INVALID_UTF8'));
});

test('wrong-project COMPLETE, INCOMPLETE and INVALID journals all refuse before prefix exposure', () => {
  const foreignConfig = { ...CONFIG, projectId: 'project-b' };
  const foreign = serialized(foreignConfig, [entry('foreign', { projectId: 'project-b' })]);
  for (const bytes of [foreign, truncateAfterEntries(foreign), damageFooter(foreign)]) {
    const m = memfs(); m.seed(PATH, bytes);
    assert.deepEqual(open(m), simpleRefusal('PROJECT_MISMATCH'));
  }
});

test('matching project with any other persisted config difference refuses policy drift', () => {
  for (const changed of [
    { ...CONFIG, maxEntries: 9 },
    { ...CONFIG, heartbeatTtlMs: 11 },
    { ...CONFIG, redactPaths: ['payload.observation', 'payload.secret'] }
  ]) {
    const m = memfs(); m.seed(PATH, serialized(changed));
    assert.deepEqual(open(m), simpleRefusal('CONFIG_MISMATCH'));
  }
});

test('open refuses a clock behind the persisted journal watermark', () => {
  const m = memfs(); m.seed(PATH, serialized(CONFIG, [entry()], 100));
  assert.deepEqual(open(m, { now: 99 }), simpleRefusal('CLOCK_BEHIND_JOURNAL'));
});

test('COMPLETE recovery binds exact raw digest and publishes historical entries', () => {
  const m = memfs(); const text = serialized(); m.seed(PATH, text);
  const opened = open(m);
  assert.equal(opened.status, 'OPENED');
  assertSnapshotShape(opened.snapshot);
  assert.equal(opened.snapshot.recovery.status, 'COMPLETE');
  assert.deepEqual(opened.snapshot.recovery.recoveredIds, ['entry-a']);
  assert.equal(opened.snapshot.bytes, Buffer.byteLength(text));
  assert.match(opened.snapshot.sha256, /^[0-9a-f]{64}$/);
  assert.equal(opened.snapshot.entries[0].historical, true);
});

test('matching damaged prefixes open SEALED with verified prefix only and cannot record', () => {
  for (const text of [truncateAfterEntries(serialized()), damageFooter(serialized())]) {
    const m = memfs(); m.seed(PATH, text);
    const opened = open(m);
    assertSnapshotShape(opened.snapshot, 'SEALED');
    assert.equal(opened.snapshot.entries.length, 1);
    assert.equal(opened.snapshot.sha256, null);
    assert.equal(opened.snapshot.bytes, null);
    assert.deepEqual(record(opened.owner), simpleRefusal('OWNER_SEALED'));
  }
});

test('NEW record writes, publishes exact staged evidence, redacts payload and freezes all returned evidence', () => {
  const m = memfs(); const opened = open(m); const source = entry();
  const result = record(opened.owner, source);
  assert.deepEqual(Object.keys(result).sort(), ['append', 'authorizing', 'entryId', 'reason', 'schemaVersion', 'snapshot', 'status', 'store'].sort());
  assert.equal(result.status, 'RECORDED');
  assert.equal(result.reason, null);
  assert.equal(result.entryId, 'entry-a');
  assert.equal(result.append.status, 'APPENDED');
  assert.equal(result.store.status, 'WRITTEN');
  assert.equal(result.authorizing, false);
  assertSnapshotShape(result.snapshot);
  assert.equal(result.snapshot.entries[0].entry.payload.secret, '[REDACTED]');
  assert.equal(source.payload.secret, '/synthetic/private');
  assertDeepFrozen(result.append);
  assertDeepFrozen(result.store);
  assertDeepFrozen(result.snapshot);
  assert.equal(reopen(m.bytes(PATH).toString('utf8')).report.status, 'COMPLETE');
});

test('current fixed-XPC projected observation is inert history payload, not authority', () => {
  const m = memfs(); const opened = open(m);
  const row = entry('fixed-xpc', { payload: { secret: '/synthetic/private', observation: {
    schemaVersion: 'nisi-fixed-xpc-journal-observation/v1', status: 'OBSERVED', caseName: 'valid',
    meaning: 'FIXED_XPC_OBSERVATION_ONLY', authorizing: false, generatedCodeExecuted: false, nativeProductAccepted: false
  } } });
  const result = record(opened.owner, row);
  assert.equal(result.status, 'RECORDED');
  assert.equal(result.snapshot.meaning, 'HISTORY_OBSERVATIONS_ONLY');
  assert.equal(result.snapshot.authorizing, false);
  assert.equal(result.snapshot.entries[0].authorizing, false);
});

test('RUNNING stale observation is listed as interrupted only when UNKNOWN and active', () => {
  const m = memfs(); const opened = open(m);
  const running = entry('running-a', { state: 'RUNNING', heartbeatAt: 100, createdAt: 100, ttlMs: 1000 });
  const result = record(opened.owner, running, 111);
  assert.deepEqual(result.snapshot.interrupted, [{ id: 'running-a', runId: 'run-a', attempt: 0, stage: 'observe', liveness: 'UNKNOWN', heartbeatAt: 100, createdAt: 100 }]);
});

test('revocation removes an UNKNOWN RUNNING observation from interrupted without granting authority', () => {
  const m = memfs(); const opened = open(m);
  const running = entry('running-a', { state: 'RUNNING', heartbeatAt: 100, createdAt: 100, ttlMs: 1000 });
  assert.equal(record(opened.owner, running, 111).snapshot.interrupted.length, 1);
  const revoked = entry('revoke-a', { state: 'REVOKED', revokes: 'running-a', receiptId: null, createdAt: 112 });
  const result = record(opened.owner, revoked, 112);
  assert.deepEqual(result.snapshot.interrupted, []);
  assert.equal(result.snapshot.entries[0].revoked, true);
  assert.equal(result.snapshot.authorizing, false);
});

test('duplicate returns original accepted snapshot and conflict performs no storage', () => {
  const m = memfs(); const opened = open(m); const first = record(opened.owner);
  const eventCount = m.events.length;
  const duplicate = record(opened.owner);
  assert.equal(duplicate.status, 'DUPLICATE');
  assert.equal(duplicate.snapshot, first.snapshot);
  assert.equal(duplicate.store, null);
  assert.equal(m.events.length, eventCount);
  const conflict = record(opened.owner, entry('entry-a', { candidateId: 'other' }));
  assert.equal(conflict.status, 'CONFLICT');
  assert.equal(conflict.reason, 'ID_CONTENT_MISMATCH');
  assert.equal(conflict.store, null);
  assert.equal(conflict.snapshot, first.snapshot);
  assert.equal(m.events.length, eventCount);
});

test('entry refusal and time failure preserve the accepted snapshot and do not escape', () => {
  const m = memfs(); const opened = open(m); const first = record(opened.owner);
  const wrong = record(opened.owner, entry('wrong', { projectId: 'project-b' }));
  assert.equal(wrong.status, 'REFUSED'); assert.equal(wrong.reason, 'PROJECT'); assert.equal(wrong.snapshot, first.snapshot);
  const behind = record(opened.owner, entry('later'), 99);
  assert.equal(behind.status, 'REFUSED'); assert.equal(behind.reason, 'TIME'); assert.equal(behind.snapshot, first.snapshot);
});

test('malformed record envelopes and accessor entry fields refuse without getter execution', () => {
  const opened = open(memfs()); let calls = 0;
  const hostile = entry(); Object.defineProperty(hostile, 'payload', { enumerable: true, get() { calls++; throw new Error('no'); } });
  assert.equal(record(opened.owner, hostile).reason, 'ENTRY');
  assert.equal(calls, 0);
  for (const input of [{ owner: opened.owner, entry: entry(), now: 100, extra: 1 }, { owner: opened.owner, entry: entry(), now: -0 }]) {
    assert.deepEqual(recordJournalObservation(input), simpleRefusal('INVALID_INPUT'));
  }
});

test('pre-rename store failure rolls back staged append and pruning exactly', () => {
  const m = memfs(); m.seed(PATH, serialized(CONFIG, [entry('old', { createdAt: 100, ttlMs: 12 })], 100));
  const opened = open(m, { now: 101 }); const before = opened.snapshot; const beforeBytes = Buffer.from(m.bytes(PATH));
  m.fs.renameSync = () => { throw Object.assign(new Error('no rename'), { code: 'EIO' }); };
  const failed = record(opened.owner, entry('new', { createdAt: 113 }), 113);
  assert.equal(failed.status, 'STORE_FAILED');
  assert.equal(failed.store.committed, false);
  assert.equal(failed.snapshot, before);
  assert.equal(inspect(opened.owner).snapshot, before);
  assert.equal(m.bytes(PATH).equals(beforeBytes), true);
  assert.equal(before.entries[0].retained, true);
});

test('genuine stale owner detects STORE_CONFLICT despite public mutation attempts', () => {
  const m = memfs(); const first = open(m); assert.equal(record(first.owner, entry('first')).status, 'RECORDED');
  const staleSnapshot = inspect(first.owner).snapshot;
  const second = open(m); assert.equal(record(second.owner, entry('interloper')).status, 'RECORDED');
  assert.throws(() => { first.owner.sha256 = second.snapshot.sha256; }, TypeError);
  assert.throws(() => { staleSnapshot.entries.length = 0; }, TypeError);
  const result = record(first.owner, entry('stale'));
  assert.equal(result.status, 'STORE_CONFLICT');
  assert.equal(result.store.reason, 'CONFLICT');
  assert.equal(result.store.committed, false);
  assert.equal(result.snapshot, staleSnapshot);
  assert.deepEqual(reopen(m.bytes(PATH).toString('utf8')).report.recoveredIds, ['first', 'interloper']);
});

test('post-rename readback mismatch seals COMMIT_UNCERTAIN without stale publication', () => {
  const m = memfs(); const opened = open(m); const old = opened.snapshot; let renamed = false;
  const rename = m.fs.renameSync, read = m.fs.readFileSync;
  m.fs.renameSync = (a, b) => { rename(a, b); renamed = true; };
  m.fs.readFileSync = path => renamed && path === PATH ? Buffer.from('mismatch') : read(path);
  const result = record(opened.owner);
  assert.equal(result.status, 'STORE_FAILED');
  assert.equal(result.store.committed, true);
  assertSnapshotShape(result.snapshot, 'COMMIT_UNCERTAIN');
  assert.deepEqual(result.snapshot.entries, []);
  assert.deepEqual(result.snapshot.interrupted, []);
  assert.deepEqual(result.snapshot.recovery.recoveredIds, []);
  assert.equal(result.snapshot.recovery.reason, result.store.reason);
  assert.equal(result.snapshot.sha256, null);
  assert.equal(result.snapshot.bytes, null);
  assert.equal(old.state, 'OPEN');
  assert.deepEqual(record(opened.owner, entry('later')), simpleRefusal('COMMIT_UNCERTAIN'));
  const fresh = openJournalOwner({ path: PATH, fs: { ...m.fs, readFileSync: read }, config: CONFIG, now: 100 });
  assert.equal(fresh.status, 'OPENED');
  assert.equal(fresh.snapshot.recovery.status, 'COMPLETE');
  assert.deepEqual(fresh.snapshot.recovery.recoveredIds, ['entry-a']);
});

test('post-rename final-read exception is reconciled as COMMIT_UNCERTAIN, not rollback', () => {
  const m = memfs(); const opened = open(m); let renamed = false;
  const rename = m.fs.renameSync, read = m.fs.readFileSync;
  m.fs.renameSync = (a, b) => { rename(a, b); renamed = true; };
  m.fs.readFileSync = path => {
    if (renamed && path === PATH) throw Object.assign(new Error('final read failed'), { code: 'EIO' });
    return read(path);
  };
  const result = record(opened.owner);
  assert.equal(result.status, 'STORE_FAILED');
  assert.equal(result.store.committed, true);
  assertSnapshotShape(result.snapshot, 'COMMIT_UNCERTAIN');
  assert.deepEqual(record(opened.owner, entry('later')), simpleRefusal('COMMIT_UNCERTAIN'));
  const fresh = openJournalOwner({ path: PATH, fs: { ...m.fs, readFileSync: read }, config: CONFIG, now: 100 });
  assert.equal(fresh.status, 'OPENED');
  assert.deepEqual(fresh.snapshot.recovery.recoveredIds, ['entry-a']);
});

test('reentrant record is OWNER_BUSY and performs no nested filesystem IO', () => {
  const m = memfs(); const opened = open(m); let nested; let nestedEvents;
  const original = m.fs.openSync;
  m.fs.openSync = (...args) => {
    if (!nested) { const before = m.events.length; nested = record(opened.owner, entry('nested')); nestedEvents = m.events.length - before; }
    return original(...args);
  };
  const outer = record(opened.owner, entry('outer'));
  assert.equal(outer.status, 'RECORDED');
  assert.deepEqual(nested, simpleRefusal('OWNER_BUSY'));
  assert.equal(nestedEvents, 0);
});

test('successful write without fsync remains explicitly non-durable', () => {
  const m = memfs(); const fs = { ...m.fs }; delete fs.fsyncSync;
  const opened = openJournalOwner({ path: PATH, fs, config: CONFIG, now: 100 });
  const result = record(opened.owner);
  assert.equal(result.status, 'RECORDED');
  assert.equal(result.store.status, 'WRITTEN');
  assert.equal(result.store.durable, false);
  assert.equal(result.store.fsync.file, false);
  assert.equal(result.store.fsync.directory, false);
});

test('previous snapshots remain frozen historical values after later publication', () => {
  const m = memfs(); const opened = open(m); const first = record(opened.owner, entry('one'));
  const second = record(opened.owner, entry('two'));
  assert.notEqual(second.snapshot, first.snapshot);
  assert.deepEqual(first.snapshot.recovery.recoveredIds, ['one']);
  assert.deepEqual(second.snapshot.recovery.recoveredIds, ['one', 'two']);
  assert.equal(first.snapshot.entries.length, 1);
  assert.equal(second.snapshot.entries.length, 2);
  assertDeepFrozen(first.snapshot); assertDeepFrozen(second.snapshot);
});

test('real temporary filesystem bytes recover in a fresh Node process boundary', () => {
  const directory = nodeFs.mkdtempSync(join(tmpdir(), 'nisi-journal-owner-v2-'));
  const path = join(directory, 'journal.jsonl');
  const moduleUrl = new URL('../src/index.mjs', import.meta.url).href;
  const child = `
    import * as fs from 'node:fs';
    import { openJournalOwner, recordJournalObservation } from ${JSON.stringify(moduleUrl)};
    const config = ${JSON.stringify(CONFIG)};
    const entry = ${JSON.stringify(entry('fresh-process'))};
    const opened = openJournalOwner({ path: process.argv[1], fs, config, now: 100 });
    const result = opened.status === 'OPENED' ? recordJournalObservation({ owner: opened.owner, entry, now: 100 }) : opened;
    process.stdout.write(JSON.stringify({ status: result.status, authorizing: result.authorizing }));
  `;
  try {
    const written = spawnSync(process.execPath, ['--input-type=module', '--eval', child, path], { encoding: 'utf8', timeout: 5000 });
    assert.equal(written.status, 0, written.stderr);
    assert.deepEqual(JSON.parse(written.stdout), { status: 'RECORDED', authorizing: false });
    const reopened = openJournalOwner({ path, fs: nodeFs, config: CONFIG, now: 100 });
    assert.equal(reopened.status, 'OPENED');
    assert.equal(reopened.snapshot.recovery.status, 'COMPLETE');
    assert.deepEqual(reopened.snapshot.recovery.recoveredIds, ['fresh-process']);
    assert.equal(reopened.snapshot.entries[0].historical, true);
  } finally {
    nodeFs.rmSync(directory, { recursive: true, force: true });
  }
});
