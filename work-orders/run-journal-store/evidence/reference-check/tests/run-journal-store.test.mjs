import test from 'node:test';
import assert from 'node:assert/strict';
import * as realFs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { writeSerializedJournal as write, readSerializedJournal as read } from '../src/run-journal-store-v1.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}'
    : JSON.stringify(value);

function journal(payload = 'café 🌱', empty = false, count = 1) {
  const header = { type: 'header', schema: 'nisi-run-journal-v1', config: { projectId: 'store', maxEntries: 10, heartbeatTtlMs: 100, redactPaths: [] }, now: 10 };
  const lines = [canonical(header)];
  let previousHash = hash('nisi-run-journal/header/v1\n' + lines[0]);
  for (let index = 0; index < (empty ? 0 : count); index++) {
    const entry = { id: 'e' + (index + 1), projectId: 'store', runId: 'r1', attempt: 0, candidateId: 'c1', stage: 'test', receiptId: null, createdAt: 10, ttlMs: 100, state: 'SUCCEEDED', heartbeatAt: null, retryOf: null, revokes: null, payload };
    const record = { entry, fingerprint: hash('nisi-run-journal/input/v1\n' + canonical(entry)), retained: true };
    const body = { seq: index + 1, previousHash, record };
    previousHash = hash('nisi-run-journal/record/v1\n' + canonical(body));
    lines.push(canonical({ type: 'entry', ...body, hash: previousHash }));
  }
  lines.push(canonical({ type: 'footer', count: empty ? 0 : count, lastHash: previousHash }));
  return lines.join('\n') + '\n';
}

function fixture(t, hooks = {}) {
  const dir = realFs.mkdtempSync(join(tmpdir(), 'nisi-journal-store-'));
  t.after(() => realFs.rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'journal.jsonl');
  const events = [];
  const descriptors = new Map();
  const fs = {};
  for (const name of ['openSync', 'writeSync', 'fsyncSync', 'closeSync', 'readFileSync', 'renameSync', 'unlinkSync']) {
    fs[name] = (...args) => {
      const descriptor = descriptors.get(args[0]);
      const event = { name, args, descriptor };
      events.push(event);
      const invoke = () => realFs[name](...args);
      try {
        const value = hooks[name] ? hooks[name](event, invoke) : invoke();
        if (name === 'openSync') descriptors.set(value, { path: args[0], flags: args[1] });
        return value;
      } finally {
        // The close fault below simulates a descriptor released before an error.
        if (name === 'closeSync') descriptors.delete(args[0]);
      }
    };
  }
  return { dir, path, fs, events, descriptors };
}

function refused(result, reason) {
  assert.equal(result.status, 'REFUSED');
  assert.equal(result.durable, false);
  assert.equal(typeof result.reason, 'string');
  assert.ok(result.reason.length > 0);
  if (reason) assert.equal(result.reason, reason);
}

function written(result, serialized) {
  assert.equal(result.status, 'WRITTEN');
  assert.equal(result.sha256, hash(Buffer.from(serialized)));
  assert.equal(result.bytes, Buffer.byteLength(serialized));
  assert.equal(result.verified, true);
  assert.equal(typeof result.durable, 'boolean');
}

test('raw UTF-8 round trip preserves bytes and records successful file and directory fsync', t => {
  const f = fixture(t);
  const serialized = journal();
  const result = write({ ...f, serialized });
  written(result, serialized);
  assert.equal(result.durable, true);
  assert.deepEqual(result.fsync, { file: true, directory: true });
  assert.deepEqual(result.fsyncErrors, { file: null, directory: null });
  assert.deepEqual(realFs.readFileSync(f.path), Buffer.from(serialized));
  const loaded = read(f);
  assert.equal(loaded.status, 'READ');
  assert.equal(loaded.serialized, serialized);
  assert.equal(loaded.sha256, hash(Buffer.from(serialized)));
  assert.equal(loaded.bytes, Buffer.byteLength(serialized));
  assert.equal(loaded.durable, false);
  assert.deepEqual(realFs.readdirSync(f.dir), ['journal.jsonl']);
  assert.equal(f.descriptors.size, 0);
});

test('exclusive same-directory temp, file sync and temp verification precede rename; directory sync and final verification follow', t => {
  const f = fixture(t);
  written(write({ ...f, serialized: journal() }), journal());
  const opens = f.events.filter(e => e.name === 'openSync');
  const tempOpen = opens.find(e => e.args[0] !== f.dir);
  assert.ok(tempOpen);
  assert.equal(tempOpen.args[1], 'wx');
  assert.equal(tempOpen.args[2], 0o600);
  assert.equal(dirname(tempOpen.args[0]), f.dir);
  assert.notEqual(tempOpen.args[0], f.path);
  assert.ok(opens.every(e => e.args[0] !== f.path));
  const renameAt = f.events.findIndex(e => e.name === 'renameSync');
  const fileSyncAt = f.events.findIndex(e => e.name === 'fsyncSync' && e.descriptor.path !== f.dir);
  const dirSyncAt = f.events.findIndex(e => e.name === 'fsyncSync' && e.descriptor.path === f.dir);
  const tempReadAt = f.events.findIndex(e => e.name === 'readFileSync' && e.args[0] === tempOpen.args[0]);
  const tempCloseAt = f.events.findIndex(e => e.name === 'closeSync' && e.descriptor.path === tempOpen.args[0]);
  assert.ok(fileSyncAt >= 0 && fileSyncAt < tempCloseAt && tempCloseAt < tempReadAt && tempReadAt < renameAt && renameAt < dirSyncAt);
  assert.ok(f.events.slice(dirSyncAt + 1).some(e => e.name === 'readFileSync' && e.args[0] === f.path));
  assert.deepEqual(f.events[renameAt].args, [tempOpen.args[0], f.path]);
});

test('short writes are completed; zero progress is refused and the owned temp is cleaned', t => {
  const f = fixture(t, { writeSync: ({ args }) => realFs.writeSync(args[0], args[1], args[2], Math.min(7, args[3]), args[4]) });
  written(write({ ...f, serialized: journal() }), journal());
  assert.ok(f.events.filter(e => e.name === 'writeSync').length > 1);
  const z = fixture(t, { writeSync: () => 0 });
  refused(write({ ...z, serialized: journal() }), 'WRITE_FAILED');
  assert.deepEqual(realFs.readdirSync(z.dir), []);
  assert.equal(z.descriptors.size, 0);
});

test('file fsync failure is recorded, still writes and verifies, and cannot claim durability', t => {
  const f = fixture(t, { fsyncSync: (e, invoke) => {
    if (e.descriptor.flags === 'wx') throw Object.assign(new Error('unsupported'), { code: 'ENOTSUP' });
    return invoke();
  } });
  const result = write({ ...f, serialized: journal() });
  written(result, journal());
  assert.equal(result.durable, false);
  assert.deepEqual(result.fsync, { file: false, directory: true });
  assert.equal(result.fsyncErrors.file, 'ENOTSUP');
  assert.equal(read(f).serialized, journal());
  assert.equal(f.descriptors.size, 0);
});

test('directory fsync or directory-open failure records a committed but non-durable write', t => {
  for (const point of ['fsyncSync', 'openSync']) {
    const f = fixture(t, { [point]: (e, invoke) => {
      if (point === 'openSync' ? e.args[1] === 'r' : e.descriptor.flags === 'r') throw Object.assign(new Error('unsupported'), { code: 'ENOTSUP' });
      return invoke();
    } });
    const result = write({ ...f, serialized: journal() });
    written(result, journal());
    assert.equal(result.durable, false);
    assert.deepEqual(result.fsync, { file: true, directory: false });
    assert.equal(result.fsyncErrors.directory, 'ENOTSUP');
    assert.equal(read(f).serialized, journal());
    assert.equal(f.descriptors.size, 0);
  }
});

test('absent fsync support is recorded for both attempts and never upgraded to durable', t => {
  const f = fixture(t);
  delete f.fs.fsyncSync;
  const result = write({ ...f, serialized: journal() });
  written(result, journal());
  assert.equal(result.durable, false);
  assert.deepEqual(result.fsync, { file: false, directory: false });
  assert.equal(typeof result.fsyncErrors.file, 'string');
  assert.equal(typeof result.fsyncErrors.directory, 'string');
  assert.equal(f.descriptors.size, 0);
});

test('different existing content needs exact previous sha256; conflicts preserve bytes without opening any file', t => {
  const f = fixture(t);
  const before = journal('old');
  realFs.writeFileSync(f.path, before);
  for (const expectedPreviousSha256 of [undefined, '0'.repeat(64)]) {
    f.events.length = 0;
    refused(write({ ...f, serialized: journal('new'), expectedPreviousSha256 }), 'CONFLICT');
    assert.equal(realFs.readFileSync(f.path, 'utf8'), before);
    assert.ok(f.events.every(e => e.name === 'readFileSync'));
  }
  written(write({ ...f, serialized: journal('new'), expectedPreviousSha256: hash(before) }), journal('new'));
  assert.equal(realFs.readFileSync(f.path, 'utf8'), journal('new'));
});

test('same bytes are an explicit non-durable no-op; supplied stale expected hash still refuses', t => {
  const f = fixture(t);
  realFs.writeFileSync(f.path, journal());
  for (const expectedPreviousSha256 of [undefined, hash(journal())]) {
    f.events.length = 0;
    const result = write({ ...f, serialized: journal(), expectedPreviousSha256 });
    assert.equal(result.status, 'UNCHANGED');
    assert.equal(result.sha256, hash(journal()));
    assert.equal(result.durable, false);
    assert.ok(f.events.every(e => e.name === 'readFileSync'));
  }
  refused(write({ ...f, serialized: journal(), expectedPreviousSha256: '0'.repeat(64) }), 'CONFLICT');
  const missing = fixture(t);
  refused(write({ ...missing, serialized: journal(), expectedPreviousSha256: hash(journal()) }), 'CONFLICT');
  assert.deepEqual(realFs.readdirSync(missing.dir), []);
});

test('read refuses every truncated prefix, including complete-line boundaries, and never returns partial data', t => {
  const f = fixture(t);
  const bytes = Buffer.from(journal());
  for (let end = 0; end < bytes.length; end++) {
    realFs.writeFileSync(f.path, bytes.subarray(0, end));
    const result = read(f);
    refused(result, 'INVALID_JOURNAL');
    assert.equal(result.serialized, undefined);
  }
});

test('read refuses malformed UTF-8, corrupt chain/footer/schema, trailing data and noncanonical JSON', t => {
  const f = fixture(t);
  const lines = journal().trimEnd().split('\n');
  const footer = JSON.parse(lines[2]);
  const invalid = [
    Buffer.from([0xff, 0x0a]),
    journal().replace('café', 'cafe'),
    lines[0] + '\n' + lines[1] + '\n' + canonical({ ...footer, count: 2 }) + '\n',
    lines[0] + '\n' + lines[1] + '\n' + canonical({ ...footer, lastHash: '0'.repeat(64) }) + '\n',
    journal().replace('nisi-run-journal-v1', 'nisi-run-journal-v2'),
    journal() + '{}\n', journal() + '\n', journal().replace('{', '{ '),
    journal().replace('\"type\":\"entry\"', '\"type\":\"wrong\"'),
    journal().replace('\"type\":\"footer\"', '\"type\":\"wrong\"'),
    'null\nnull\n', '{}\n{}\n'
  ];
  for (const field of ['seq', 'previousHash']) {
    const chain = journal('two entries', false, 2).trimEnd().split('\n').map(JSON.parse);
    const target = chain[2];
    target[field] = field === 'seq' ? 3 : '0'.repeat(64);
    target.hash = hash('nisi-run-journal/record/v1\n' + canonical({ seq: target.seq, previousHash: target.previousHash, record: target.record }));
    chain[3].lastHash = target.hash;
    invalid.push(chain.map(canonical).join('\n') + '\n');
  }
  for (const bytes of invalid) {
    realFs.writeFileSync(f.path, bytes);
    refused(read(f), 'INVALID_JOURNAL');
  }
  realFs.writeFileSync(f.path, journal('two entries', false, 2));
  assert.equal(read(f).serialized, journal('two entries', false, 2));
  realFs.writeFileSync(f.path, journal('empty', true));
  assert.equal(read(f).serialized, journal('empty', true));
});

test('write validates strings, framing and expected hash before mutation; corrupt existing data stays intact', t => {
  const f = fixture(t);
  for (const serialized of [null, 4, Buffer.from(journal()), '', journal().slice(0, -1), journal() + '\ud800', '{}\n{}\n']) {
    f.events.length = 0;
    refused(write({ ...f, serialized }), 'INVALID_JOURNAL');
    assert.equal(f.events.length, 0);
  }
  refused(write({ ...f, serialized: journal(), expectedPreviousSha256: 'bad' }), 'INVALID_INPUT');
  assert.deepEqual(realFs.readdirSync(f.dir), []);
  realFs.writeFileSync(f.path, 'broken');
  refused(write({ ...f, serialized: journal(), expectedPreviousSha256: hash('broken') }), 'EXISTING_INVALID');
  assert.equal(realFs.readFileSync(f.path, 'utf8'), 'broken');
});

test('missing and unreadable files are refusals, and read never attempts mutations or sync', t => {
  const f = fixture(t);
  refused(read(f), 'NOT_FOUND');
  assert.ok(f.events.every(e => e.name === 'readFileSync'));
  const bad = fixture(t, { readFileSync: () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } });
  refused(read(bad), 'READ_FAILED');
  refused(write({ ...bad, serialized: journal() }), 'READ_FAILED');
  assert.ok(bad.events.every(e => e.name === 'readFileSync'));
  refused(read({ path: '', fs: f.fs }), 'INVALID_INPUT');
  refused(write({ path: '', serialized: journal(), fs: f.fs }), 'INVALID_INPUT');
});

test('write and rename failures preserve old bytes, close descriptors and clean only the owned temp', t => {
  for (const point of ['writeSync', 'renameSync']) {
    const f = fixture(t, { [point]: () => { throw Object.assign(new Error('disk error'), { code: 'EIO' }); } });
    realFs.writeFileSync(f.path, journal('old'));
    refused(write({ ...f, serialized: journal('new'), expectedPreviousSha256: hash(journal('old')) }), point === 'writeSync' ? 'WRITE_FAILED' : 'RENAME_FAILED');
    assert.equal(realFs.readFileSync(f.path, 'utf8'), journal('old'));
    assert.deepEqual(realFs.readdirSync(f.dir), ['journal.jsonl']);
    assert.equal(f.descriptors.size, 0);
  }
  const collision = fixture(t, { openSync: (e, invoke) => {
    if (e.args[1] === 'wx') realFs.writeFileSync(e.args[0], 'belongs to somebody else');
    return invoke();
  } });
  refused(write({ ...collision, serialized: journal() }), 'WRITE_FAILED');
  const files = realFs.readdirSync(collision.dir);
  assert.equal(files.length, 1);
  assert.equal(realFs.readFileSync(join(collision.dir, files[0]), 'utf8'), 'belongs to somebody else');
  assert.ok(collision.events.every(e => e.name !== 'unlinkSync'));
});

test('temp read-back mismatch refuses before rename and final mismatch never reports durable success', t => {
  let renamed = false;
  for (const [phase, fault] of [['temp', 'mismatch'], ['final', 'mismatch'], ['temp', 'throw'], ['final', 'throw']]) {
    renamed = false;
    const f = fixture(t, {
      renameSync: (e, invoke) => { const value = invoke(); renamed = true; return value; },
      readFileSync: (e, invoke) => {
        if (phase === 'temp' ? e.args[0] !== f.path : renamed && e.args[0] === f.path) {
          if (fault === 'throw') throw Object.assign(new Error('readback failed'), { code: 'EIO' });
          return Buffer.from('mismatch');
        }
        return invoke();
      }
    });
    realFs.writeFileSync(f.path, journal('old'));
    const result = write({ ...f, serialized: journal('new'), expectedPreviousSha256: hash(journal('old')) });
    refused(result, 'READBACK_MISMATCH');
    assert.equal(result.committed, phase === 'final');
    if (phase === 'temp') assert.equal(realFs.readFileSync(f.path, 'utf8'), journal('old'));
    assert.deepEqual(realFs.readdirSync(f.dir), ['journal.jsonl']);
    assert.equal(f.descriptors.size, 0);
  }
});

test('destination is rechecked before rename and an observed concurrent change is preserved', t => {
  let changed = false;
  const f = fixture(t, { fsyncSync: (e, invoke) => {
    if (e.descriptor.flags === 'wx' && !changed) { realFs.writeFileSync(f.path, journal('interloper')); changed = true; }
    return invoke();
  } });
  realFs.writeFileSync(f.path, journal('old'));
  refused(write({ ...f, serialized: journal('new'), expectedPreviousSha256: hash(journal('old')) }), 'CONFLICT');
  assert.equal(realFs.readFileSync(f.path, 'utf8'), journal('interloper'));
  assert.ok(f.events.every(e => e.name !== 'renameSync'));
  assert.deepEqual(realFs.readdirSync(f.dir), ['journal.jsonl']);
});

test('file close failure refuses before rename, preserves destination and cannot claim durability', t => {
  let fail = true;
  const f = fixture(t, { closeSync: (e, invoke) => {
    if (fail && e.descriptor.flags === 'wx') {
      fail = false;
      invoke();
      throw Object.assign(new Error('close reported error after releasing descriptor'), { code: 'EIO' });
    }
    return invoke();
  } });
  realFs.writeFileSync(f.path, journal('old'));
  refused(write({ ...f, serialized: journal('new'), expectedPreviousSha256: hash(journal('old')) }), 'WRITE_FAILED');
  assert.equal(realFs.readFileSync(f.path, 'utf8'), journal('old'));
  assert.deepEqual(realFs.readdirSync(f.dir), ['journal.jsonl']);
  assert.equal(f.events.filter(e => e.name === 'closeSync').length, 1);
  assert.ok(f.events.every(e => e.name !== 'renameSync'));
  assert.equal(f.descriptors.size, 0);
});
