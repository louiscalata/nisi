// Test-only dependency substitution. Each mutant copies the reviewed owner and
// frozen dependencies into an owned temporary directory and replaces only the
// copied store import. This is not a production injection feature.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openJournalOwner, recordJournalObservation } from '../src/index.mjs';
import { memfs } from './memfs.mjs';
import { CONFIG, PATH, entry, simpleRefusal } from './helper.mjs';

const SOURCES = Object.freeze({
  owner: new URL('../src/index.mjs', import.meta.url),
  journal: new URL('../src/run-journal-v1.mjs', import.meta.url),
  store: new URL('../src/run-journal-store-v1.mjs', import.meta.url),
  memfs: new URL('./memfs.mjs', import.meta.url)
});
const HASHES = Object.freeze({
  owner: '54777f65338a36ca6c208fc880c8ca4013ffce675c7aede2afdc2d8fa85f4e49',
  journal: 'dee9f490c091000b2560cd9464d945885e7f341091b87dde9ae4f2b7cdbd359e',
  store: '1356028b65f9f8b96e3b9ec8ba3bfbb4968092af53d00e8b5dfdb11b161f4792',
  memfs: 'e202da18a120645ccdf6c51da48843f64ca90b6af48e87d3fdcb5cda0f9319c0'
});
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function assertPinnedSources() {
  for (const [name, url] of Object.entries(SOURCES)) {
    assert.equal(sha256(readFileSync(url)), HASHES[name], `${name} fixture source drifted`);
  }
}

function wrapper(mode) {
  return `
import { writeSerializedJournal as pinned } from './run-journal-store-real.mjs';
let accessorCalls = 0;
export const testOnlyAccessorCalls = () => accessorCalls;
export function writeSerializedJournal(options) {
  const mode = ${JSON.stringify(mode)};
  if (mode === 'throw-before') throw new Error('test-only pre-call throw');
  const actual = pinned(options);
  if (mode === 'throw-after') throw new Error('test-only post-call throw');
  if (mode === 'malformed-null') return null;
  const out = { ...actual, fsync: { ...actual.fsync }, fsyncErrors: { ...actual.fsyncErrors } };
  if (mode === 'extra-key') out.extra = true;
  if (mode === 'wrong-hash') out.sha256 = '0'.repeat(64);
  if (mode === 'wrong-bytes') out.bytes += 1;
  if (mode === 'written-uncommitted') out.committed = false;
  if (mode === 'fsync-contradiction') { out.fsync.file = true; out.fsyncErrors.file = 'EIO'; }
  if (mode === 'bad-cleanup') out.cleanupError = 7;
  if (mode === 'function') out.verified = () => true;
  if (mode === 'buffer') out.sha256 = Buffer.alloc(32);
  if (mode === 'accessor') Object.defineProperty(out, 'sha256', { enumerable: true, get() { accessorCalls++; throw new Error('getter must not run'); } });
  return out;
}
`;
}

async function withMutant(mode, body) {
  assertPinnedSources();
  const directory = mkdtempSync(join(tmpdir(), `nisi-owner-store-${mode}-`));
  try {
    const ownerSource = readFileSync(SOURCES.owner, 'utf8');
    const expectedImport = "import {writeSerializedJournal} from './run-journal-store-v1.mjs';";
    assert.equal(ownerSource.split(expectedImport).length, 2, 'reviewed store import must occur exactly once');
    writeFileSync(join(directory, 'index.mjs'), ownerSource.replace(expectedImport,
      "import {writeSerializedJournal} from './store-stub.mjs';"));
    writeFileSync(join(directory, 'run-journal-v1.mjs'), readFileSync(SOURCES.journal));
    writeFileSync(join(directory, 'run-journal-store-real.mjs'), readFileSync(SOURCES.store));
    writeFileSync(join(directory, 'store-stub.mjs'), wrapper(mode));
    const api = await import(pathToFileURL(join(directory, 'index.mjs')).href);
    const control = await import(pathToFileURL(join(directory, 'store-stub.mjs')).href);
    await body(api, control);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function assertUncertain(result, owner, api, expectedStore = true) {
  assert.equal(result.status, 'STORE_FAILED');
  assert.equal(result.reason, 'STORE_RESPONSE_INVALID');
  assert.equal(result.store !== null, expectedStore);
  assert.equal(result.snapshot.state, 'COMMIT_UNCERTAIN');
  assert.equal(result.snapshot.sha256, null);
  assert.equal(result.snapshot.bytes, null);
  assert.deepEqual(result.snapshot.entries, []);
  assert.deepEqual(result.snapshot.recovery.recoveredIds, []);
  assert.deepEqual(api.recordJournalObservation({ owner, entry: entry('later'), now: 100 }), simpleRefusal('COMMIT_UNCERTAIN'));
}

async function postStoreInvalid(mode) {
  await withMutant(mode, async (api, control) => {
    const m = memfs();
    const opened = api.openJournalOwner({ path: PATH, fs: m.fs, config: CONFIG, now: 100 });
    const result = api.recordJournalObservation({ owner: opened.owner, entry: entry(mode), now: 100 });
    assertUncertain(result, opened.owner, api, !['malformed-null', 'accessor', 'function', 'buffer'].includes(mode));
    if (mode === 'accessor') assert.equal(control.testOnlyAccessorCalls(), 0, 'response getter must not run');
    assert.ok(m.bytes(PATH), 'the pinned store committed before its response was mutated');
    const fresh = openJournalOwner({ path: PATH, fs: m.fs, config: CONFIG, now: 100 });
    assert.equal(fresh.status, 'OPENED');
    assert.deepEqual(fresh.snapshot.recovery.recoveredIds, [mode]);
  });
}

test('hash pins bind the reviewed owner, frozen dependencies and memfs context', () => {
  assertPinnedSources();
});

for (const mode of ['extra-key', 'wrong-hash', 'wrong-bytes', 'written-uncommitted', 'fsync-contradiction', 'bad-cleanup']) {
  test(`post-store ${mode} response seals uncertainty and fresh open reconciles committed bytes`, async () => {
    await postStoreInvalid(mode);
  });
}

for (const mode of ['malformed-null', 'accessor', 'function', 'buffer']) {
  test(`unrepresentable post-store ${mode} response is not copied or exposed`, async () => {
    await postStoreInvalid(mode);
  });
}

test('direct wrapper throw before the pinned store still seals because the owner crossed storeEntered', async () => {
  await withMutant('throw-before', async api => {
    const m = memfs();
    const opened = api.openJournalOwner({ path: PATH, fs: m.fs, config: CONFIG, now: 100 });
    const result = api.recordJournalObservation({ owner: opened.owner, entry: entry('throw-before'), now: 100 });
    assertUncertain(result, opened.owner, api, false);
    assert.equal(m.bytes(PATH), undefined);
    const fresh = openJournalOwner({ path: PATH, fs: m.fs, config: CONFIG, now: 100 });
    assert.equal(fresh.snapshot.recovery.status, 'NEW');
  });
});

test('direct wrapper throw after the pinned store seals and fresh open finds actual committed bytes', async () => {
  await withMutant('throw-after', async api => {
    const m = memfs();
    const opened = api.openJournalOwner({ path: PATH, fs: m.fs, config: CONFIG, now: 100 });
    const result = api.recordJournalObservation({ owner: opened.owner, entry: entry('throw-after'), now: 100 });
    assertUncertain(result, opened.owner, api, false);
    assert.ok(m.bytes(PATH));
    const fresh = openJournalOwner({ path: PATH, fs: m.fs, config: CONFIG, now: 100 });
    assert.deepEqual(fresh.snapshot.recovery.recoveredIds, ['throw-after']);
  });
});

test('normal pinned store accepts missing fsync as explicit non-durable success', () => {
  assertPinnedSources();
  const m = memfs(); const fs = { ...m.fs }; delete fs.fsyncSync;
  const opened = openJournalOwner({ path: PATH, fs, config: CONFIG, now: 100 });
  const result = recordJournalObservation({ owner: opened.owner, entry: entry('no-fsync'), now: 100 });
  assert.equal(result.status, 'RECORDED');
  assert.equal(result.store.status, 'WRITTEN');
  assert.equal(result.store.durable, false);
  assert.deepEqual(result.store.fsync, { file: false, directory: false });
});

test('normal pinned store accepts coherent fsync errors as non-durable committed success', () => {
  assertPinnedSources();
  const fault = Object.assign(new Error('sync failed'), { code: 'EIO' });
  const m = memfs({ fsyncSync: () => fault });
  const opened = openJournalOwner({ path: PATH, fs: m.fs, config: CONFIG, now: 100 });
  const result = recordJournalObservation({ owner: opened.owner, entry: entry('fsync-error'), now: 100 });
  assert.equal(result.status, 'RECORDED');
  assert.equal(result.store.committed, true);
  assert.equal(result.store.durable, false);
  assert.deepEqual(result.store.fsyncErrors, { file: 'EIO', directory: 'EIO' });
});

test('normal pinned cleanupError refusal remains precommit and preserves the previous snapshot', () => {
  assertPinnedSources();
  const fault = Object.assign(new Error('close failed'), { code: 'EIO' });
  const m = memfs({ closeSync: () => fault });
  const opened = openJournalOwner({ path: PATH, fs: m.fs, config: CONFIG, now: 100 });
  const before = opened.snapshot;
  const result = recordJournalObservation({ owner: opened.owner, entry: entry('cleanup-error'), now: 100 });
  assert.equal(result.status, 'STORE_FAILED');
  assert.equal(result.store.status, 'REFUSED');
  assert.equal(result.store.committed, false);
  assert.equal(result.store.cleanupError, 'EIO');
  assert.equal(result.snapshot, before);
  assert.equal(m.bytes(PATH), undefined);
});
