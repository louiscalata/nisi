// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
// The store's read path: a byte limit, and refusal of symlinks and of anything
// that is not a regular file. Same reasons as `nisi validate`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as store from '../history/run-journal-store-v1.mjs';

const read = store.readSerializedJournal;
const MAX_READ_BYTES = 64 * 1024 * 1024;

const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}'
    : JSON.stringify(value);

function journal() {
  const header = { type: 'header', schema: 'nisi-run-journal-v1', config: { projectId: 'store', maxEntries: 10, heartbeatTtlMs: 100, redactPaths: [] }, now: 10 };
  const lines = [canonical(header)];
  const previousHash = hash('nisi-run-journal/header/v1\n' + lines[0]);
  lines.push(canonical({ type: 'footer', count: 0, lastHash: previousHash }));
  return lines.join('\n') + '\n';
}

function workdir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nisi-store-read-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function refused(result, reason) {
  assert.equal(result.status, 'REFUSED', JSON.stringify(result));
  assert.equal(result.reason, reason, JSON.stringify(result));
  assert.equal(result.durable, false);
  assert.equal(result.serialized, undefined);
}

// Records every call so a test can check descriptors, flags and read sizes.
function spy(overrides = {}) {
  const calls = [];
  const wrapped = { constants: fs.constants };
  for (const name of ['lstatSync', 'openSync', 'fstatSync', 'readSync', 'closeSync', 'readFileSync']) {
    wrapped[name] = (...args) => {
      calls.push({ name, args });
      return overrides[name] ? overrides[name](...args) : fs[name](...args);
    };
  }
  return { fs: wrapped, calls };
}

test('a successful read is unchanged: same bytes, digest and fields', t => {
  const file = path.join(workdir(t), 'journal.jsonl');
  fs.writeFileSync(file, journal());
  const result = read({ path: file, fs });
  assert.equal(result.status, 'READ');
  assert.equal(result.serialized, journal());
  assert.equal(result.sha256, hash(Buffer.from(journal())));
  assert.equal(result.bytes, Buffer.byteLength(journal()));
  assert.equal(result.verified, true);
  assert.equal(result.durable, false);
  assert.equal(result.committed, false);
});

test('the default limit is 64 MiB and a larger sparse file is refused without being read', t => {
  assert.equal(store.MAX_READ_BYTES, MAX_READ_BYTES);
  const file = path.join(workdir(t), 'journal.jsonl');
  fs.writeFileSync(file, '');
  fs.truncateSync(file, MAX_READ_BYTES + 1);
  const { fs: spied, calls } = spy();
  const result = read({ path: file, fs: spied });
  refused(result, 'FILE_TOO_LARGE');
  assert.equal(result.bytes, MAX_READ_BYTES + 1);
  assert.equal(calls.filter(call => call.name === 'readSync' || call.name === 'readFileSync').length, 0);
});

test('a file of exactly maxBytes is read and one byte over is refused', t => {
  const file = path.join(workdir(t), 'journal.jsonl');
  const text = journal();
  const size = Buffer.byteLength(text);
  fs.writeFileSync(file, text);
  const exact = read({ path: file, fs, maxBytes: size });
  assert.equal(exact.status, 'READ');
  assert.equal(exact.serialized, text);
  const over = read({ path: file, fs, maxBytes: size - 1 });
  refused(over, 'FILE_TOO_LARGE');
  assert.equal(over.bytes, size);
  // A file one byte over the limit is also refused when it is made one byte too large.
  fs.writeFileSync(file, text + 'x');
  refused(read({ path: file, fs, maxBytes: size }), 'FILE_TOO_LARGE');
  refused(read({ path: file, fs, maxBytes: 0 }), 'FILE_TOO_LARGE');
});

test('the limit is checked against the open descriptor, not only the lstat size', t => {
  const dir = workdir(t);
  const small = path.join(dir, 'small.txt');
  const file = path.join(dir, 'journal.jsonl');
  fs.writeFileSync(small, 'x');
  fs.writeFileSync(file, journal());
  const { fs: spied, calls } = spy({ lstatSync: target => fs.lstatSync(target === file ? small : target) });
  refused(read({ path: file, fs: spied, maxBytes: 8 }), 'FILE_TOO_LARGE');
  assert.equal(calls.filter(call => call.name === 'readSync').length, 0);
});

test('short reads are assembled in order', t => {
  const file = path.join(workdir(t), 'journal.jsonl');
  fs.writeFileSync(file, journal());
  const { fs: spied, calls } = spy({ readSync: (fd, buffer, offset, length, position) => fs.readSync(fd, buffer, offset, Math.min(length, 7), position) });
  const result = read({ path: file, fs: spied });
  assert.equal(result.status, 'READ');
  assert.equal(result.serialized, journal());
  assert.ok(calls.filter(call => call.name === 'readSync').length > 3);
});

test('a file that grows during the read is refused, and the read asks for at most size + 1 bytes', t => {
  const file = path.join(workdir(t), 'journal.jsonl');
  const text = journal();
  fs.writeFileSync(file, text);
  const { fs: spied, calls } = spy({
    fstatSync: fd => { const stat = fs.fstatSync(fd); return { isFile: () => stat.isFile(), size: stat.size - 3 }; },
  });
  assert.deepEqual(read({ path: file, fs: spied }), {
    durable: false,
    committed: false,
    fsync: { file: false, directory: false },
    fsyncErrors: { file: null, directory: null },
    status: 'REFUSED',
    reason: 'FILE_CHANGED',
  });
  const asked = calls.filter(call => call.name === 'readSync').reduce((sum, call) => sum + call.args[3], 0);
  assert.ok(asked <= Buffer.byteLength(text) - 3 + 1, `asked for ${asked} bytes`);
});

test('a symlink to a valid journal is refused and the target is never opened', t => {
  const dir = workdir(t);
  const target = path.join(dir, 'real.jsonl');
  const link = path.join(dir, 'link.jsonl');
  fs.writeFileSync(target, journal());
  try { fs.symlinkSync(target, link); } catch { t.skip('symlinks are not available'); return; }
  const { fs: spied, calls } = spy();
  refused(read({ path: link, fs: spied }), 'SYMLINK');
  assert.equal(calls.filter(call => ['openSync', 'readSync', 'readFileSync'].includes(call.name)).length, 0);
  assert.equal(read({ path: target, fs }).status, 'READ');
});

test('a dangling symlink is refused as a symlink, not reported missing', t => {
  const dir = workdir(t);
  const link = path.join(dir, 'link.jsonl');
  try { fs.symlinkSync(path.join(dir, 'nowhere'), link); } catch { t.skip('symlinks are not available'); return; }
  refused(read({ path: link, fs }), 'SYMLINK');
});

test('a link swapped in after the lstat check is refused by the open', t => {
  if (process.platform === 'win32') { t.skip('Windows opens without O_NOFOLLOW'); return; }
  const dir = workdir(t);
  const target = path.join(dir, 'real.jsonl');
  const link = path.join(dir, 'link.jsonl');
  fs.writeFileSync(target, journal());
  fs.symlinkSync(target, link);
  const { fs: spied } = spy({ lstatSync: () => fs.lstatSync(target) });
  refused(read({ path: link, fs: spied }), 'SYMLINK');
});

test('the open uses O_NOFOLLOW and O_NONBLOCK and every descriptor is closed', t => {
  if (process.platform === 'win32') { t.skip('Windows opens with r'); return; }
  const file = path.join(workdir(t), 'journal.jsonl');
  fs.writeFileSync(file, journal());
  const { fs: spied, calls } = spy();
  assert.equal(read({ path: file, fs: spied }).status, 'READ');
  const open = calls.find(call => call.name === 'openSync');
  assert.equal(open.args[1], fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  const opened = calls.filter(call => call.name === 'openSync').length;
  assert.equal(calls.filter(call => call.name === 'closeSync').length, opened);
  // Refusals after the open close it too.
  const big = spy();
  refused(read({ path: file, fs: big.fs, maxBytes: 1 }), 'FILE_TOO_LARGE');
  assert.equal(big.calls.filter(call => call.name === 'closeSync').length, big.calls.filter(call => call.name === 'openSync').length);
});

test('a directory and a missing file are refused with their own reasons', t => {
  const dir = workdir(t);
  const sub = path.join(dir, 'journal.jsonl');
  fs.mkdirSync(sub);
  const { fs: spied, calls } = spy();
  refused(read({ path: sub, fs: spied }), 'NOT_A_FILE');
  assert.equal(calls.filter(call => call.name === 'openSync').length, 0, 'a directory is refused before it is opened');
  refused(read({ path: path.join(dir, 'missing.jsonl'), fs }), 'NOT_FOUND');
});

test('a directory swapped in after the lstat check is refused from the descriptor', t => {
  const dir = workdir(t);
  const sub = path.join(dir, 'journal.jsonl');
  const regular = path.join(dir, 'regular.txt');
  fs.mkdirSync(sub);
  fs.writeFileSync(regular, 'x');
  const { fs: spied } = spy({ lstatSync: () => fs.lstatSync(regular) });
  if (process.platform === 'win32') { t.skip('Windows cannot open a directory'); return; }
  refused(read({ path: sub, fs: spied }), 'NOT_A_FILE');
});

// A FIFO has no writer here, so a blocking open never returns. The child has a
// deadline: without it, a hang would hang the test run.
test('a FIFO is refused at once, with or without a stale lstat', t => {
  if (process.platform === 'win32') { t.skip('Windows has no mkfifo'); return; }
  const dir = workdir(t);
  const fifo = path.join(dir, 'journal.jsonl');
  const made = spawnSync('mkfifo', [fifo], { encoding: 'utf8' });
  if (made.error || made.status !== 0) { t.skip('mkfifo is not available'); return; }
  const regular = path.join(dir, 'regular.txt');
  fs.writeFileSync(regular, 'x');
  const child = `
    import fs from 'node:fs';
    const [moduleUrl, fifo, regular] = process.argv.slice(1);
    const { readSerializedJournal } = await import(moduleUrl);
    const stale = { ...fs, constants: fs.constants, lstatSync: target => target === fifo ? fs.lstatSync(regular) : fs.lstatSync(target) };
    const plain = readSerializedJournal({ path: fifo, fs });
    const swapped = readSerializedJournal({ path: fifo, fs: stale });
    console.log(JSON.stringify([plain.reason, swapped.reason]));
  `;
  const moduleUrl = new URL('../history/run-journal-store-v1.mjs', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', child, moduleUrl, fifo, regular], { encoding: 'utf8', timeout: 5_000 });
  assert.equal(result.error?.code, undefined, 'readSerializedJournal did not return within 5 s');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), ['NOT_A_FILE', 'NOT_A_FILE']);
});

test('descriptor failures map to reasons and never carry error messages', t => {
  const file = path.join(workdir(t), 'journal.jsonl');
  fs.writeFileSync(file, journal());
  const failing = code => spy({ openSync: () => { throw Object.assign(new Error('secret-path-in-message'), { code }); } });
  refused(read({ path: file, fs: failing('EACCES').fs }), 'READ_FAILED');
  refused(read({ path: file, fs: failing('ELOOP').fs }), 'SYMLINK');
  refused(read({ path: file, fs: failing('ENOENT').fs }), 'NOT_FOUND');
  refused(read({ path: file, fs: spy({ readSync: () => { throw new Error('secret-path-in-message'); } }).fs }), 'READ_FAILED');
  refused(read({ path: file, fs: spy({ lstatSync: () => { throw Object.assign(new Error('x'), { code: 'EACCES' }); } }).fs }), 'READ_FAILED');
  assert.doesNotMatch(JSON.stringify(read({ path: file, fs: failing('EACCES').fs })), /secret-path/u);
});

test('an invalid maxBytes is refused as INVALID_INPUT', t => {
  const file = path.join(workdir(t), 'journal.jsonl');
  fs.writeFileSync(file, journal());
  for (const maxBytes of [-1, NaN, '100', null, {}]) refused(read({ path: file, fs, maxBytes }), 'INVALID_INPUT');
  assert.equal(read({ path: file, fs, maxBytes: Infinity }).status, 'READ');
});

test('an fs with only readFileSync reads as before and applies maxBytes only when given', t => {
  const bytes = Buffer.from(journal());
  const minimal = { readFileSync: () => bytes };
  const free = read({ path: 'x', fs: minimal });
  assert.equal(free.status, 'READ');
  assert.equal(free.serialized, journal());
  assert.equal(read({ path: 'x', fs: minimal, maxBytes: bytes.length }).status, 'READ');
  const over = read({ path: 'x', fs: minimal, maxBytes: bytes.length - 1 });
  refused(over, 'FILE_TOO_LARGE');
  assert.equal(over.bytes, bytes.length);
});

test('a readFileSync fallback returning a valid journal string is INVALID_JOURNAL', () => {
  assert.deepEqual(read({ path: 'journal.jsonl', fs: { readFileSync: () => journal() } }), {
    durable: false,
    committed: false,
    fsync: { file: false, directory: false },
    fsyncErrors: { file: null, directory: null },
    status: 'REFUSED',
    reason: 'INVALID_JOURNAL',
  });
});

// Model large sparse files without allocating or reading gigabytes. The count
// coercion matches Node's readSync length conversion; the first read is short.
test('large reads never wrap a request length or accept only a valid prefix', async t => {
  const prefix = Buffer.from(journal());
  for (const size of [2 ** 31 - 1, 2 ** 31, 2 ** 32 - 1, 2 ** 32, 2 ** 32 + prefix.length - 1, 2 ** 33 + prefix.length - 1]) {
    for (const maxBytes of [size, Infinity]) await t.test(`size ${size}, limit ${maxBytes}`, t => {
      const requests = [];
      let consumed = 0;
      let closed = 0;
      const buffer = {
        length: size + 1,
        subarray(start, end) {
          assert.equal(start, 0);
          assert.equal(end, consumed);
          return end === prefix.length ? prefix : Buffer.from('invalid trailing bytes');
        },
      };
      t.mock.method(Buffer, 'alloc', requested => {
        assert.equal(requested, size + 1);
        return buffer;
      });
      const virtual = {
        readFileSync() { assert.fail('descriptor reads must not call readFileSync'); },
        openSync: () => 17,
        fstatSync: () => ({ size, isFile: () => true }),
        readSync(fd, target, offset, length, position) {
          requests.push({ fd, target, offset, length, position });
          const coerced = length | 0;
          const count = coerced <= 0 ? 0 : Math.min(offset === 0 ? prefix.length : coerced, size - consumed);
          consumed += count;
          return count;
        },
        closeSync(fd) { assert.equal(fd, 17); closed++; },
      };
      const result = read({ path: 'journal.jsonl', fs: virtual, maxBytes });
      refused(result, 'INVALID_JOURNAL');
      assert.equal(consumed, size);
      assert.equal(closed, 1);
      let offset = 0;
      for (const request of requests) {
        assert.equal(request.fd, 17);
        assert.equal(request.target, buffer);
        assert.equal(request.offset, offset);
        assert.equal(request.position, null);
        assert.ok(request.length > 0 && request.length <= 2 ** 30);
        assert.equal(request.length, Math.min(size + 1 - offset, 2 ** 30));
        offset += Math.min(offset === 0 ? prefix.length : request.length, size - offset);
      }
      assert.equal(requests.at(-1).length, 1, 'probe for growth after all original bytes');
    });
  }
});

test('shrinking during the read refuses even a complete valid prefix', async t => {
  for (const suffix of ['x', 'unread trailing bytes']) await t.test(suffix, t => {
    const file = path.join(workdir(t), 'journal.jsonl');
    const text = journal();
    fs.writeFileSync(file, text + suffix);
    const { fs: spied, calls } = spy({
      fstatSync(fd) {
        const stat = fs.fstatSync(fd);
        fs.truncateSync(file, Buffer.byteLength(text));
        return stat;
      },
    });
    assert.deepEqual(read({ path: file, fs: spied }), {
      durable: false,
      committed: false,
      fsync: { file: false, directory: false },
      fsyncErrors: { file: null, directory: null },
      status: 'REFUSED',
      reason: 'FILE_CHANGED',
    });
    assert.equal(calls.filter(call => call.name === 'closeSync').length, 1);
  });
});

test('shrinking to an empty or incomplete journal is FILE_CHANGED', async t => {
  for (const size of [0, 1, Buffer.byteLength(journal()) - 1]) await t.test(`size ${size}`, t => {
    const file = path.join(workdir(t), 'journal.jsonl');
    fs.writeFileSync(file, journal());
    const { fs: spied } = spy({
      fstatSync(fd) {
        const stat = fs.fstatSync(fd);
        fs.truncateSync(file, size);
        return stat;
      },
    });
    assert.deepEqual(read({ path: file, fs: spied }), {
      durable: false,
      committed: false,
      fsync: { file: false, directory: false },
      fsyncErrors: { file: null, directory: null },
      status: 'REFUSED',
      reason: 'FILE_CHANGED',
    });
  });
});

test('growth by one byte is FILE_CHANGED', t => {
  const file = path.join(workdir(t), 'journal.jsonl');
  fs.writeFileSync(file, journal());
  const { fs: spied } = spy({
    fstatSync(fd) {
      const stat = fs.fstatSync(fd);
      fs.appendFileSync(file, 'x');
      return stat;
    },
  });
  assert.deepEqual(read({ path: file, fs: spied }), {
    durable: false,
    committed: false,
    fsync: { file: false, directory: false },
    fsyncErrors: { file: null, directory: null },
    status: 'REFUSED',
    reason: 'FILE_CHANGED',
  });
});

// The runtime string ceiling is exercised by throwing the same error from a
// small real Buffer, keeping this regression safe on machines with little RAM.
test('UTF-8 conversion failures return READ_FAILED on both fs interfaces', async t => {
  for (const bounded of [false, true]) {
    for (const operation of ['toString', 'from']) await t.test(`${bounded ? 'descriptor' : 'readFileSync'} ${operation}`, t => {
      const text = journal();
      const bytes = Buffer.from(text);
      const file = path.join(workdir(t), 'journal.jsonl');
      fs.writeFileSync(file, bytes);
      const fail = () => { throw Object.assign(new RangeError('private conversion detail'), { code: 'ERR_STRING_TOO_LONG' }); };
      if (operation === 'toString') {
        const original = Buffer.prototype.toString;
        t.mock.method(Buffer.prototype, 'toString', function (encoding, ...args) {
          return encoding === 'utf8' && this.equals(bytes) ? fail() : original.call(this, encoding, ...args);
        });
      } else {
        const original = Buffer.from;
        t.mock.method(Buffer, 'from', function (value, encoding, ...args) {
          return value === text && encoding === 'utf8' ? fail() : original.call(this, value, encoding, ...args);
        });
      }
      const spied = spy();
      const result = read({ path: file, fs: bounded ? spied.fs : { readFileSync: () => bytes }, maxBytes: Infinity });
      refused(result, 'READ_FAILED');
      assert.doesNotMatch(JSON.stringify(result), /private conversion detail|ERR_STRING_TOO_LONG/u);
      assert.equal(spied.calls.filter(call => call.name === 'closeSync').length, bounded ? 1 : 0);
    });
  }
});

test('a wrapped fs with descriptor methods bypasses its readFileSync override', t => {
  const file = path.join(workdir(t), 'journal.jsonl');
  fs.writeFileSync(file, journal());
  const { fs: spied, calls } = spy({ readFileSync() { throw new Error('readFileSync override'); } });
  const result = read({ path: file, fs: spied });
  assert.equal(result.status, 'READ');
  assert.equal(result.serialized, journal());
  assert.equal(calls.filter(call => call.name === 'readFileSync').length, 0);
});

test('symlinked parents and hard links are read as regular files', t => {
  const dir = workdir(t);
  const parent = path.join(dir, 'parent');
  const alias = path.join(dir, 'alias');
  fs.mkdirSync(parent);
  const file = path.join(parent, 'journal.jsonl');
  fs.writeFileSync(file, journal());
  const hard = path.join(dir, 'hard.jsonl');
  fs.linkSync(file, hard);
  assert.equal(read({ path: hard, fs }).serialized, journal());
  try { fs.symlinkSync(parent, alias, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch { t.skip('directory symlinks are not available'); return; }
  assert.equal(read({ path: path.join(alias, 'journal.jsonl'), fs }).serialized, journal());
});

test('without O_NOFOLLOW a stale lstat can still follow a final symlink', t => {
  const dir = workdir(t);
  const file = path.join(dir, 'journal.jsonl');
  const link = path.join(dir, 'link.jsonl');
  fs.writeFileSync(file, journal());
  try { fs.symlinkSync(file, link); } catch { t.skip('symlinks are not available'); return; }
  const { fs: spied, calls } = spy({ lstatSync: () => fs.lstatSync(file) });
  spied.constants = {};
  const result = read({ path: link, fs: spied });
  assert.equal(result.status, 'READ');
  assert.equal(result.serialized, journal());
  assert.equal(calls.find(call => call.name === 'openSync').args[1], 'r');
});
