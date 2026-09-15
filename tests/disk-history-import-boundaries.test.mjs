import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {importFixedXpcHistoryFromDisk} from '../hosts/history/import-fixed-xpc-from-disk-v1.mjs';
import {openJournalOwner} from '../history/journal-owner-v2.mjs';
import {createRepositorySnapshot} from '../hosts/repository/snapshot-contract.mjs';
import {memfs} from './journal-owner-v2.memfs.mjs';
import {CONFIG as BASE_CONFIG, PATH, assertDeepFrozen} from './journal-owner-v2.helper.mjs';
import {makeRecord} from './fixtures/fixed-xpc-journal-observation.mjs';

const CONFIG = Object.freeze({...BASE_CONFIG, redactPaths: []});
const SOURCE = JSON.stringify(makeRecord('valid'));
const IMPORT_SOURCE_SHA = 'e0982d129bf635b33ce53b46d1155b7c0182b9f7875053f540071dfffa4070cd';
const sha = value => createHash('sha256').update(value).digest('hex');
const canonical = value => '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + JSON.stringify(value[key])).join(',') + '}';
const select = root => ({schemaVersion: 'nisi-history-source-selection/v1', consentClass: 'WRITTEN_DECLARATION',
  root, relativePath: 'evidence.json', profile: 'operator-trusted-static-local-v1', rawContentPersisted: false, networkEgress: false});
const selectionDigest = value => sha('nisi-history-source-selection/v1\n' + canonical(value));
const declaration = () => ({schemaVersion: 'nisi-fixed-xpc-history-declaration/v1', declarationId: 'disk-boundary-a',
  projectId: 'project-a', candidateId: 'candidate-a', receiptId: 'receipt-a', consentClass: 'WRITTEN_DECLARATION',
  sourceSha256: sha(SOURCE), issuedAt: 100, expiresAt: 3_600_100, createdAt: 100, retentionMs: 1000,
  destination: 'LOCAL_OBSERVATION_JOURNAL_ONLY', rawContentPersisted: false, networkEgress: false, learningInfluence: false});
const open = m => openJournalOwner({path: PATH, fs: m.fs, config: CONFIG, now: 100});
const input = (owner, root, overrides = {}) => ({owner, declaration: declaration(), source: select(root),
  clock: () => 100, signal: null, ...overrides});

async function withDisk(body) {
  const root = await mkdtemp(join(tmpdir(), 'nisi-disk-boundary-'));
  try { await writeFile(join(root, 'evidence.json'), SOURCE); return await body(root); }
  finally { await rm(root, {recursive: true, force: true}); }
}

// This is dependency substitution in a newly owned temp tree, not a production
// injection feature. Only the reader import is replaced; canonical permit/owner
// modules retain their real process-wide WeakMaps.
async function withReader(reader, body) {
  const root = await mkdtemp(join(tmpdir(), 'nisi-disk-reader-substitute-'));
  const originalPath = new URL('../hosts/history/import-fixed-xpc-from-disk-v1.mjs', import.meta.url);
  try {
    const original = await readFile(originalPath, 'utf8');
    assert.equal(sha(original), IMPORT_SOURCE_SHA, 'reviewed wrapper source drifted');
    const fakePath = join(root, 'fake-reader.mjs');
    await writeFile(fakePath, `export const DISK_CAPTURE_PROFILE='operator-trusted-static-local-v1';\n` +
      `export class RepositoryCaptureError extends Error { constructor(code){ super(code); this.code=code; } }\n` +
      `export const captureRepositoryFromDisk=(value)=>globalThis[Symbol.for('nisi.disk.boundary.reader')](value,RepositoryCaptureError);\n`);
    const snapshotUrl = new URL('../hosts/repository/snapshot-contract.mjs', import.meta.url).href;
    const permitUrl = new URL('../history/history-capture-permit-v1.mjs', import.meta.url).href;
    let copied = original.replace("../repository/disk-capture.mjs", pathToFileURL(fakePath).href)
      .replace("../repository/snapshot-contract.mjs", snapshotUrl)
      .replace("../../history/history-capture-permit-v1.mjs", permitUrl);
    const wrapperPath = join(root, 'wrapper.mjs'); await writeFile(wrapperPath, copied);
    globalThis[Symbol.for('nisi.disk.boundary.reader')] = reader;
    const module = await import(pathToFileURL(wrapperPath).href + `?nonce=${Date.now()}-${Math.random()}`);
    return await body(module.importFixedXpcHistoryFromDisk);
  } finally {
    delete globalThis[Symbol.for('nisi.disk.boundary.reader')];
    await rm(root, {recursive: true, force: true});
  }
}

function validReaderResult(path = 'evidence.json') {
  const snapshot = createRepositorySnapshot({files: [{path, content: SOURCE}]});
  return Object.freeze({snapshot, capture: Object.freeze({schemaVersion: 1, profile: 'operator-trusted-static-local-v1',
    rootFingerprint: '1'.repeat(64), snapshotFingerprint: snapshot.fingerprint, fingerprint: '2'.repeat(64),
    status: 'CAPTURED_TRUSTED_STATIC_INPUT', handlesClosed: true, atomicSnapshot: false,
    executionStatus: 'NOT_RUN', authorizing: false})});
}

test('native AbortSignal methods bypass all instance overrides, including reason', async () => withDisk(async root => {
  const m = memfs(); const controller = new AbortController(); let calls = 0;
  for (const key of ['aborted', 'reason']) Object.defineProperty(controller.signal, key,
    {configurable: true, get() { calls++; throw Error(`must not read ${key}`); }});
  for (const key of ['addEventListener', 'removeEventListener']) Object.defineProperty(controller.signal, key,
    {configurable: true, value() { calls++; throw Error(`must not call ${key}`); }});
  const result = await importFixedXpcHistoryFromDisk(input(open(m).owner, root, {signal: controller.signal}));
  assert.equal(result.status, 'IMPORTED'); assert.equal(calls, 0); assertDeepFrozen(result);
}));

test('an earlier listener stopping propagation cannot hide abort from the final permit clock', async () => withDisk(async root => {
  const m = memfs(); const controller = new AbortController(); let clocks = 0;
  controller.signal.addEventListener('abort', event => event.stopImmediatePropagation());
  const result = await importFixedXpcHistoryFromDisk(input(open(m).owner, root, {signal: controller.signal,
    clock: () => { clocks++; if (clocks === 2) controller.abort(); return 100; }}));
  assert.equal(result.status, 'REFUSED'); assert.equal(result.reason, 'PERMIT_REVOKED');
  assert.equal(result.captureAttempted, true); assert.equal(result.capture.status, 'REFUSED');
  assert.equal(result.capture.recordAttempted, false);
}));

test('synthetic pending event does not consume listener and later real abort cancels awaited read', async () => withDisk(async root => {
  const controller = new AbortController(); let release;
  const pending = new Promise(resolve => { release = resolve; });
  await withReader(async () => pending, async importDisk => {
    const m = memfs(); const operation = importDisk(input(open(m).owner, root, {signal: controller.signal}));
    controller.signal.dispatchEvent(new Event('abort')); assert.equal(controller.signal.aborted, false);
    controller.abort('PRIVATE'); release(validReaderResult());
    const result = await operation;
    assert.equal(result.status, 'CANCELLED'); assert.equal(result.reason, 'ABORTED');
    assert.equal(result.sourceReadAttempted, true); assert.equal(result.captureAttempted, false);
    assert.equal(result.sourceFailure, null); assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  });
}));

test('source-selection digest preserves original root spelling while the reader resolves it', async () => withDisk(async root => {
  const spelled = root + '/.'; const source = select(spelled); const m = memfs();
  const result = await importFixedXpcHistoryFromDisk(input(open(m).owner, root, {source}));
  assert.equal(result.status, 'IMPORTED'); assert.equal(result.sourceSelectionDigest, selectionDigest(source));
  assert.notEqual(result.sourceSelectionDigest, selectionDigest(select(root)));
}));

test('expiry reached only at the second clock refuses after read without recording', async () => withDisk(async root => {
  const m = memfs(); const opened = open(m); let calls = 0;
  const result = await importFixedXpcHistoryFromDisk(input(opened.owner, root,
    {clock: () => ++calls === 1 ? 100 : 3_600_100}));
  assert.equal(result.status, 'REFUSED'); assert.equal(result.reason, 'PERMIT_EXPIRED');
  assert.equal(result.sourceReadAttempted, true); assert.equal(result.captureAttempted, true);
  assert.equal(result.capture.recordAttempted, false); assert.deepEqual(opened.snapshot.entries, []);
}));

test('close-unconfirmed reader error remains visible when the same read aborts', async () => withDisk(async root => {
  const controller = new AbortController();
  await withReader(async (_value, ErrorClass) => { controller.abort(); throw new ErrorClass('DISK_CAPTURE_CLOSE_UNCONFIRMED'); },
    async importDisk => {
      const m = memfs(); const result = await importDisk(input(open(m).owner, root, {signal: controller.signal}));
      assert.equal(result.status, 'CANCELLED'); assert.equal(result.reason, 'ABORTED');
      assert.equal(result.sourceFailure, 'DISK_CAPTURE_CLOSE_UNCONFIRMED');
      assert.equal(result.captureAttempted, false); assert.equal(result.capture, null);
    });
}));

test('unknown reader error class maps closed SOURCE_CAPTURE_FAILED without leaking details', async () => withDisk(async root => {
  await withReader(async () => { throw Object.assign(Error('PRIVATE-UNKNOWN-READER'), {code: 'DISK_CAPTURE_HARDLINK'}); },
    async importDisk => {
      const m = memfs(); const opened = open(m); const result = await importDisk(input(opened.owner, root));
      assert.equal(result.status, 'REFUSED'); assert.equal(result.reason, 'SOURCE_CAPTURE_FAILED');
      assert.equal(result.sourceFailure, 'SOURCE_CAPTURE_FAILED'); assert.equal(result.captureAttempted, false);
      assert.equal(JSON.stringify(result).includes('PRIVATE-UNKNOWN-READER'), false);
      assert.deepEqual(opened.snapshot.entries, []);
    });
}));

test('contradictory successful reader shapes never reach capture or expose a permit', async () => withDisk(async root => {
  const variants = [
    () => validReaderResult('different.json'),
    () => { const value = validReaderResult(); return {...value, capture: {...value.capture, handlesClosed: false}}; },
    () => { const value = validReaderResult(); return {...value, capture: {...value.capture, snapshotFingerprint: 'f'.repeat(64)}}; },
    () => { const value = validReaderResult(); return {...value, capture: {...value.capture, authorizing: true}}; }
  ];
  for (const make of variants) await withReader(async () => make(), async importDisk => {
    const m = memfs(); const opened = open(m); const result = await importDisk(input(opened.owner, root));
    assert.equal(result.status, 'REFUSED'); assert.equal(result.reason, 'SOURCE_CAPTURE_INVALID');
    assert.equal(result.sourceReadAttempted, true); assert.equal(result.captureAttempted, false);
    assert.equal(result.sourceFailure, null); assert.equal(result.capture, null);
    assert.equal(Object.hasOwn(result, 'permit'), false); assert.deepEqual(opened.snapshot.entries, []);
  });
}));
