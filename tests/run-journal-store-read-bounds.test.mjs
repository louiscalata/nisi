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
  refused(read({ path: file, fs: spied }), 'FILE_CHANGED');
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
