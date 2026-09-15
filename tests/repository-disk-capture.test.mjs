// PRIVATE: real, generated local filesystem fixtures; no user repository content
// or candidate code is executed. Only exact test-owned temporary roots are
// removed. Source, test output and failing mutation evidence are retained by the
// verification harness. Tests are serial within this process for narrow mocks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRepositorySnapshot, prepareRepositoryCandidate } from '../hosts/repository/snapshot-contract.mjs';
import { captureRepositoryFromDisk as capture, DISK_CAPTURE_PROFILE } from '../hosts/repository/disk-capture.mjs';
import { sha256Text } from '../workflow/contracts.mjs';

const MIB = 1_048_576;
const input = (root, paths) => ({ root, paths, profile: DISK_CAPTURE_PROFILE });
const rejects = (fn, code) => assert.rejects(fn, e => e.code === code);
async function fixture(t, files = { 'main.mjs': 'original', 'tests/check.mjs': 'fixed tests' }) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'nisi-disk-capture-')));
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); await assert.rejects(fs.lstat(root), { code: 'ENOENT' }); });
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name); await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  return root;
}
function watchOpens(t, modify = async () => {}) {
  const original = fs.open.bind(fs); const handles = [];
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await original(...args); handles.push(handle); await modify(handle, args); return handle;
  });
  return handles;
}

test('real disk bytes feed the existing immutable snapshot and protected-candidate preparation', async t => {
  const root = await fixture(t, { 'main.mjs': 'é 😀\r\n', 'tests/check.mjs': 'fixed tests', 'ignored.txt': 'not admitted' });
  const handles = watchOpens(t); const paths = ['tests/check.mjs', 'main.mjs'];
  const out = await capture(input(root, paths));
  const expected = createRepositorySnapshot({ files: [{ path: 'main.mjs', content: 'é 😀\r\n' }, { path: 'tests/check.mjs', content: 'fixed tests' }] });
  assert.equal(out.snapshot.fingerprint, expected.fingerprint); assert.equal(out.snapshot.totalBytes, expected.totalBytes);
  assert.equal(out.capture.status, 'CAPTURED_TRUSTED_STATIC_INPUT'); assert.equal(out.capture.handlesClosed, true);
  assert.equal(out.capture.atomicSnapshot, false); assert.equal(out.capture.executionStatus, 'NOT_RUN'); assert.equal(out.capture.authorizing, false);
  assert.equal(handles.length, 2); assert(handles.every(h => h.fd === -1));
  assert(!JSON.stringify(out.capture).includes(root)); assert(Object.isFrozen(out.capture.files[0]));
  const prepared = prepareRepositoryCandidate({ baseline: out.snapshot,
    task: { taskId: 'disk.fixture', mode: 'edit', language: 'javascript', allowedFiles: paths,
      protectedFiles: ['tests/check.mjs'], protectedSnapshots: { 'tests/check.mjs': sha256Text('fixed tests') }, acceptanceCriteria: ['fixture'],
      policy: { repairBudget: 1, totalDeadlineMs: 1000, requiredReviewers: 1, requireReportStore: false } },
    candidate: { files: [{ path: 'main.mjs', content: 'proposed change' }] }, authorId: 'author.fixture' });
  assert.equal(prepared.materialized.files.find(f => f.path === 'tests/check.mjs').content, 'fixed tests');
  assert.equal(await fs.readFile(path.join(root, 'main.mjs'), 'utf8'), 'é 😀\r\n'); // capture did not apply a change
  assert.throws(() => { out.snapshot.files[0].content = 'mutate'; }, TypeError);
});

test('empty files and UTF-8 BOM bytes are preserved without normalization', async t => {
  const root = await fixture(t, { 'empty.txt': '', 'bom.txt': Buffer.from([0xef, 0xbb, 0xbf, 0x61]) });
  const out = await capture(input(root, ['empty.txt', 'bom.txt']));
  assert.equal(out.snapshot.files[0].content, '\ufeffa'); assert.equal(out.snapshot.files[0].byteLength, 4);
  assert.equal(out.snapshot.files[1].byteLength, 0);
});

test('invalid roots profiles path manifests and getters are rejected before all filesystem I/O', async t => {
  let calls = 0, getters = 0;
  for (const name of ['lstat', 'realpath', 'open']) t.mock.method(fs, name, async () => { calls++; throw new Error('unexpected I/O'); });
  const root = '/does-not-exist';
  for (const paths of [['../escape'], ['A', 'a'], ['dir/a', 'DIR/b'], ['a', 'a/b'], ['a//b'], ['/absolute'], ['é'], ['a\\b']]) {
    await assert.rejects(capture(input(root, paths)), e => e.code.startsWith('REPOSITORY_'));
  }
  for (const r of ['relative', '/', '/x\0secret']) await rejects(() => capture(input(r, ['a'])), 'DISK_CAPTURE_ROOT_INVALID');
  await rejects(() => capture({ ...input(root, ['a']), profile: 'generic-safe' }), 'DISK_CAPTURE_PROFILE_REQUIRED');
  await rejects(() => capture({ ...input(root, ['a']), authorizing: true }), 'DISK_CAPTURE_INPUT_SCHEMA');
  const getter = { get root() { getters++; return root; }, paths: ['a'], profile: DISK_CAPTURE_PROFILE };
  const badPaths = ['a']; Object.defineProperty(badPaths, '0', { get() { getters++; return 'a'; } });
  await rejects(() => capture(getter), 'DISK_CAPTURE_INPUT_SCHEMA');
  await rejects(() => capture(input(root, badPaths)), 'DISK_CAPTURE_PATHS_SCHEMA');
  for (const paths of [[], Array(1025).fill('a')]) await rejects(() => capture(input(root, paths)), 'DISK_CAPTURE_PATH_COUNT');
  assert.equal(calls, 0); assert.equal(getters, 0);
});

test('root leaf and intermediate symlinks are refused without reading their targets', async t => {
  const root = await fixture(t); const outside = await fixture(t, { 'private.txt': 'outside fixture' });
  await fs.symlink(outside, path.join(root, 'directory-link'));
  await fs.symlink(path.join(outside, 'private.txt'), path.join(root, 'file-link'));
  const handles = watchOpens(t);
  for (const data of [input(root, ['directory-link/private.txt']), input(root, ['file-link']), input(path.join(root, 'directory-link'), ['private.txt'])]) {
    await rejects(() => capture(data), 'DISK_CAPTURE_SYMLINK');
  }
  assert.equal(handles.length, 0); assert.equal(await fs.readFile(path.join(outside, 'private.txt'), 'utf8'), 'outside fixture');
});

test('directories FIFOs and multiply linked files are refused before any content open', async t => {
  const root = await fixture(t); const outside = await fixture(t, {});
  const fifo = path.join(root, 'pipe');
  const made = spawnSync('/usr/bin/mkfifo', [fifo], { timeout: 2000, encoding: 'utf8' });
  assert.equal(made.status, 0, `Fixture mkfifo unavailable: ${made.error?.code ?? made.stderr}`);
  await fs.link(path.join(root, 'main.mjs'), path.join(outside, 'alias'));
  const handles = watchOpens(t);
  for (const p of ['tests', 'pipe']) await rejects(() => capture(input(root, [p])), 'DISK_CAPTURE_REGULAR_FILE_REQUIRED');
  await rejects(() => capture(input(root, ['main.mjs'])), 'DISK_CAPTURE_HARDLINK');
  assert.equal(handles.length, 0); assert.equal(await fs.readFile(path.join(outside, 'alias'), 'utf8'), 'original');
});

test('missing paths return bounded diagnostics without partial content or absolute root leakage', async t => {
  const root = await fixture(t); const handles = watchOpens(t);
  await assert.rejects(capture(input(root, ['main.mjs', 'missing.txt'])), e => {
    assert.equal(e.code, 'DISK_CAPTURE_IO_ERROR'); assert.equal(e.systemCode, 'ENOENT');
    assert(!JSON.stringify(e).includes(root)); assert(!e.message.includes('original')); return true;
  });
  assert.equal(handles.length, 0); // full manifest checked before first read
});

test('malformed UTF-8 and NUL-bearing binary data are refused and their owned handles close', async t => {
  const root = await fixture(t, { 'invalid.txt': Buffer.from([0xc0, 0xaf]), 'binary.txt': Buffer.from([0x61, 0, 0x62]) });
  const handles = watchOpens(t);
  await rejects(() => capture(input(root, ['invalid.txt'])), 'DISK_CAPTURE_UTF8_INVALID');
  await rejects(() => capture(input(root, ['binary.txt'])), 'DISK_CAPTURE_BINARY_UNSUPPORTED');
  assert.equal(handles.length, 2); assert(handles.every(h => h.fd === -1));
});

test('actual files obey inclusive per-file and aggregate byte limits before content opens', async t => {
  const root = await fixture(t, {}); const files = Array.from({ length: 8 }, (_, i) => `f${i}`);
  for (const f of files) await fs.writeFile(path.join(root, f), Buffer.alloc(MIB, 0x61));
  const valid = await capture(input(root, files)); assert.equal(valid.snapshot.totalBytes, 8 * MIB);
  await fs.writeFile(path.join(root, 'extra'), 'a');
  await fs.writeFile(path.join(root, 'oversized'), Buffer.alloc(MIB + 1, 0x61));
  const handles = watchOpens(t);
  await rejects(() => capture(input(root, [...files, 'extra'])), 'DISK_CAPTURE_TOTAL_LIMIT');
  await rejects(() => capture(input(root, ['oversized'])), 'DISK_CAPTURE_FILE_LIMIT');
  assert.equal(handles.length, 0);
});

test('file-count overflow is rejected for a real fixture before its files are opened', async t => {
  const root = await fixture(t, {}); const files = Array.from({ length: 1025 }, (_, i) => `f${i}`);
  for (const f of files) await fs.writeFile(path.join(root, f), '');
  const handles = watchOpens(t);
  await rejects(() => capture(input(root, files)), 'DISK_CAPTURE_PATH_COUNT');
  assert.equal(handles.length, 0);
  assert.equal((await capture(input(root, files.slice(0, 1024)))).snapshot.files.length, 1024);
  assert.equal(handles.length, 1024); assert(handles.every(h => h.fd === -1));
});

test('short real reads preserve all bytes and the fixed no-follow nonblocking flags', async t => {
  const root = await fixture(t, { 'text': 'a'.repeat(200_001) }); let calls = 0;
  const handles = watchOpens(t, async (h, args) => {
    assert.equal(args[1], constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const original = h.read.bind(h);
    t.mock.method(h, 'read', async (buffer, offset, length, position) => { calls++; return original(buffer, offset, Math.min(length, 1024), position); });
  });
  const out = await capture(input(root, ['text']));
  assert.equal(out.snapshot.files[0].content, 'a'.repeat(200_001)); assert(calls > 190); assert.equal(handles[0].fd, -1);
});

test('early EOF is refused instead of silently admitting truncated text', async t => {
  const root = await fixture(t, { 'text': 'hello' });
  const handles = watchOpens(t, async h => t.mock.method(h, 'read', async () => ({ bytesRead: 0 })));
  await rejects(() => capture(input(root, ['text'])), 'DISK_CAPTURE_CHANGED'); assert.equal(handles[0].fd, -1);
});

test('same-size in-place changes during reading are detected and the handle closes', async t => {
  const root = await fixture(t, { 'text': 'before' }); let changed = false;
  const handles = watchOpens(t, async h => {
    const read = h.read.bind(h);
    t.mock.method(h, 'read', async (...args) => {
      const result = await read(...args);
      if (!changed) { changed = true; await fs.writeFile(path.join(root, 'text'), 'after!'); await fs.utimes(path.join(root, 'text'), 1, 1); }
      return result;
    });
  });
  await rejects(() => capture(input(root, ['text'])), 'DISK_CAPTURE_CHANGED'); assert.equal(handles[0].fd, -1);
});

test('final pass detects a previously read file changed while a later file was read', async t => {
  const root = await fixture(t, { 'a': 'first', 'b': 'second' }); let changed = false;
  const handles = watchOpens(t, async (h, args) => {
    if (args[0] === path.join(root, 'b') && !changed) {
      changed = true; await fs.writeFile(path.join(root, 'a'), 'other'); await fs.utimes(path.join(root, 'a'), 1, 1);
    }
  });
  await rejects(() => capture(input(root, ['a', 'b'])), 'DISK_CAPTURE_CHANGED'); assert(handles.every(h => h.fd === -1));
});

test('read errors close owned handles and suppress raw filesystem error messages', async t => {
  const root = await fixture(t, { 'text': 'private fixture' });
  const handles = watchOpens(t, async h => t.mock.method(h, 'read', async () => { throw Object.assign(new Error(`${root} private fixture`), { code: 'EIO' }); }));
  await assert.rejects(capture(input(root, ['text'])), e => e.code === 'DISK_CAPTURE_IO_ERROR' && e.systemCode === 'EIO' && !JSON.stringify(e).includes(root));
  assert.equal(handles[0].fd, -1);
});

test('close uncertainty refuses capture and retains a primary read refusal without inventing closure', async t => {
  const root = await fixture(t, { 'good': 'good', 'bad': Buffer.from([0xff]) });
  const handles = watchOpens(t, async h => {
    const close = h.close.bind(h);
    t.mock.method(h, 'close', async () => { await close(); throw new Error('simulated close-result uncertainty after actual fixture close'); });
  });
  for (const [file, prior] of [['good', null], ['bad', 'DISK_CAPTURE_UTF8_INVALID']]) {
    await assert.rejects(capture(input(root, [file])), e => e.code === 'DISK_CAPTURE_CLOSE_UNCONFIRMED' && e.priorCode === prior);
  }
  assert.equal(handles.length, 2); assert(handles.every(h => h.fd === -1));
});
