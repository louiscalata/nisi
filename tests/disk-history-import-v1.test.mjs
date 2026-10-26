import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, writeFile, symlink, link, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {importFixedXpcHistoryFromDisk} from '../hosts/history/import-fixed-xpc-from-disk-v1.mjs';
import {openJournalOwner, recordJournalObservation} from '../history/journal-owner-v2.mjs';
import {memfs} from './journal-owner-v2.memfs.mjs';
import {CONFIG as BASE_CONFIG, PATH, entry, assertDeepFrozen} from './journal-owner-v2.helper.mjs';
import {makeRecord} from './fixtures/fixed-xpc-journal-observation.mjs';

const CONFIG = Object.freeze({...BASE_CONFIG, redactPaths: []});
const SOURCE_TEXT = JSON.stringify(makeRecord('valid'));
const OUTER_KEYS = ['schemaVersion', 'status', 'reason', 'sourceReadAttempted', 'captureAttempted',
  'sourceSelectionDigest', 'declarationDigest', 'sourceEvidence', 'sourceFailure', 'capture', 'meaning', 'authorizing'];
const EVIDENCE_KEYS = ['profile', 'rootFingerprint', 'snapshotFingerprint', 'captureFingerprint',
  'sourceSha256', 'sourceBytes', 'handlesClosed', 'atomicSnapshot', 'sourceAuthenticityAttested',
  'executionAttested', 'authorizing'];
const sha256 = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);
const sourceDigest = value => sha256('nisi-history-source-selection/v1\n' + canonical(value));

const selection = root => ({
  schemaVersion: 'nisi-history-source-selection/v1', consentClass: 'WRITTEN_DECLARATION',
  root, relativePath: 'evidence.json', profile: 'operator-trusted-static-local-v1',
  rawContentPersisted: false, networkEgress: false
});
const declaration = (overrides = {}) => ({
  schemaVersion: 'nisi-fixed-xpc-history-declaration/v1', declarationId: 'declaration-disk-a',
  projectId: 'project-a', candidateId: 'candidate-a', receiptId: 'receipt-a',
  consentClass: 'WRITTEN_DECLARATION', sourceSha256: sha256(SOURCE_TEXT), issuedAt: 100,
  expiresAt: 3_600_100, createdAt: 100, retentionMs: 1000,
  destination: 'LOCAL_OBSERVATION_JOURNAL_ONLY', rawContentPersisted: false,
  networkEgress: false, learningInfluence: false, ...overrides
});
const open = m => openJournalOwner({path: PATH, fs: m.fs, config: CONFIG, now: 100});
const request = (owner, root, overrides = {}) => ({owner, declaration: declaration(), source: selection(root),
  clock: () => 100, signal: null, ...overrides});

async function diskFile(content = SOURCE_TEXT) {
  const root = await mkdtemp(join(tmpdir(), 'nisi-disk-import-test-'));
  await writeFile(join(root, 'evidence.json'), content);
  return root;
}
async function withRoot(body, content = SOURCE_TEXT) {
  const root = await diskFile(content);
  try { return await body(root); }
  finally { await rm(root, {recursive: true, force: true}); }
}
function assertOuter(result, status, reason, read, capture) {
  assert.deepEqual(Object.keys(result).sort(), [...OUTER_KEYS].sort());
  assert.equal(result.schemaVersion, 'nisi-disk-fixed-xpc-history-import/v1');
  assert.equal(result.status, status); assert.equal(result.reason, reason);
  assert.equal(result.sourceReadAttempted, read); assert.equal(result.captureAttempted, capture);
  if (!read || result.sourceEvidence) assert.equal(result.sourceFailure, null);
  assert.equal(result.meaning, 'HISTORY_OBSERVATIONS_ONLY'); assert.equal(result.authorizing, false);
  assertDeepFrozen(result);
}

test('real file import returns the exact frozen schema, bounded evidence and journal capture', async () => withRoot(async root => {
  const m = memfs(); const s = selection(root); const d = declaration();
  const before = await import('node:fs/promises').then(fs => fs.readFile(join(root, 'evidence.json')));
  const result = await importFixedXpcHistoryFromDisk({...request(open(m).owner, root), source: s, declaration: d});
  assertOuter(result, 'IMPORTED', null, true, true);
  assert.equal(result.sourceSelectionDigest, sourceDigest(s));
  assert.match(result.declarationDigest, /^[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(result.sourceEvidence).sort(), [...EVIDENCE_KEYS].sort());
  assert.equal(result.sourceEvidence.sourceSha256, sha256(SOURCE_TEXT));
  assert.equal(result.sourceEvidence.sourceBytes, Buffer.byteLength(SOURCE_TEXT));
  assert.equal(result.sourceEvidence.handlesClosed, true); assert.equal(result.sourceEvidence.atomicSnapshot, false);
  assert.equal(result.sourceEvidence.sourceAuthenticityAttested, false);
  assert.equal(result.sourceEvidence.executionAttested, false); assert.equal(result.sourceEvidence.authorizing, false);
  assert.equal(result.capture.status, 'IMPORTED'); assert.equal(result.capture.journal.status, 'RECORDED');
  const after = await import('node:fs/promises').then(fs => fs.readFile(join(root, 'evidence.json')));
  assert.deepEqual(after, before);
}));

test('fresh owner reopen observes the imported journal entry', async () => withRoot(async root => {
  const m = memfs(); assert.equal((await importFixedXpcHistoryFromDisk(request(open(m).owner, root))).status, 'IMPORTED');
  const reopened = openJournalOwner({path: PATH, fs: m.fs, config: CONFIG, now: 100});
  assert.equal(reopened.status, 'OPENED');
  assert.deepEqual(reopened.snapshot.entries.map(row => row.entry.id), ['0123456789abcdef0123456789abcdef:0:fixed-xpc']);
}));

test('malformed outer requests refuse before clock, disk and digest recognition', async () => withRoot(async root => {
  const m = memfs(); const owner = open(m).owner; let clockCalls = 0; const base = request(owner, root, {clock: () => ++clockCalls});
  const missing = {...base}; delete missing.signal;
  const accessor = {...base}; Object.defineProperty(accessor, 'source', {enumerable: true, get() { throw Error('secret getter'); }});
  const symbol = {...base}; symbol[Symbol('x')] = true;
  for (const input of [null, [], missing, {...base, extra: true}, accessor, symbol]) {
    const result = await importFixedXpcHistoryFromDisk(input);
    assertOuter(result, 'REFUSED', 'INVALID_INPUT', false, false);
    assert.equal(result.sourceSelectionDigest, null); assert.equal(result.declarationDigest, null);
  }
  assert.equal(clockCalls, 0);
}));

test('plain and null-prototype exact envelopes are accepted', async () => {
  for (const nullProto of [false, true]) await withRoot(async root => {
    const m = memfs(); const values = request(open(m).owner, root);
    const input = nullProto ? Object.assign(Object.create(null), values) : values;
    assert.equal((await importFixedXpcHistoryFromDisk(input)).status, 'IMPORTED');
  });
});

test('source selection is a closed data schema and accessors are not invoked', async () => withRoot(async root => {
  const m = memfs(); const owner = open(m).owner; let calls = 0;
  const getter = selection(root); Object.defineProperty(getter, 'root', {enumerable: true, get() { calls++; throw Error('private'); }});
  const cases = [{...selection(root), extra: true}, {...selection(root), profile: 'other'},
    {...selection(root), consentClass: 'MODEL_CONSENT'}, {...selection(root), rawContentPersisted: true},
    {...selection(root), networkEgress: true}, {...selection(root), relativePath: '../evidence.json'}, getter];
  for (const source of cases) {
    const result = await importFixedXpcHistoryFromDisk(request(owner, root, {source}));
    assertOuter(result, 'REFUSED', 'INVALID_SOURCE_SELECTION', false, false);
    assert.equal(result.sourceSelectionDigest, null); assert.equal(result.declarationDigest, null);
  }
  assert.equal(calls, 0);
}));

test('valid source selection digest is available when already aborted, without permit or read', async () => withRoot(async root => {
  const m = memfs(); const controller = new AbortController(); controller.abort('PRIVATE-REASON'); const s = selection(root);
  const result = await importFixedXpcHistoryFromDisk(request(open(m).owner, root, {source: s, signal: controller.signal}));
  assertOuter(result, 'CANCELLED', 'ABORTED', false, false);
  assert.equal(result.sourceSelectionDigest, sourceDigest(s)); assert.equal(result.declarationDigest, null);
  assert.equal(JSON.stringify(result).includes('PRIVATE-REASON'), false);
}));

test('invalid declaration preserves permit refusal after valid selection and before disk read', async () => withRoot(async root => {
  const m = memfs(); const s = selection(root);
  const result = await importFixedXpcHistoryFromDisk(request(open(m).owner, root, {source: s, declaration: declaration({sourceSha256: 'bad'})}));
  assertOuter(result, 'REFUSED', 'INVALID_DECLARATION', false, false);
  assert.equal(result.sourceSelectionDigest, sourceDigest(s)); assert.equal(result.declarationDigest, null);
}));

test('abort during permit clock revokes recognized permit and cancels before disk read', async () => withRoot(async root => {
  const m = memfs(); const controller = new AbortController();
  const result = await importFixedXpcHistoryFromDisk(request(open(m).owner, root, {signal: controller.signal,
    clock: () => { controller.abort(); return 100; }}));
  assertOuter(result, 'CANCELLED', 'ABORTED', false, false);
  assert.match(result.declarationDigest, /^[0-9a-f]{64}$/);
}));

test('abort while the asynchronous reader is pending awaits cleanup and returns no evidence', async () => withRoot(async root => {
  const m = memfs(); const controller = new AbortController();
  const operation = importFixedXpcHistoryFromDisk(request(open(m).owner, root, {signal: controller.signal}));
  queueMicrotask(() => controller.abort());
  const result = await operation;
  assertOuter(result, 'CANCELLED', 'ABORTED', true, false);
  assert.equal(result.sourceEvidence, null); assert.equal(result.capture, null);
}));

test('a synthetic abort event neither cancels nor consumes the later real abort listener', async () => withRoot(async root => {
  const m = memfs(); const controller = new AbortController();
  const operation = importFixedXpcHistoryFromDisk(request(open(m).owner, root, {signal: controller.signal}));
  controller.signal.dispatchEvent(new Event('abort'));
  assert.equal(controller.signal.aborted, false);
  queueMicrotask(() => controller.abort());
  const result = await operation;
  assertOuter(result, 'CANCELLED', 'ABORTED', true, false);
}));

test('source selection is copied before await and later poisoning cannot redirect scope', async () => withRoot(async root => {
  await writeFile(join(root, 'private.json'), 'PRIVATE-DISK-CANARY');
  const m = memfs(); const s = selection(root);
  const operation = importFixedXpcHistoryFromDisk(request(open(m).owner, root, {source: s}));
  s.relativePath = 'private.json'; s.root = '/'; s.networkEgress = true;
  const result = await operation;
  assert.equal(result.status, 'IMPORTED'); assert.equal(JSON.stringify(result).includes('PRIVATE-DISK-CANARY'), false);
}));

test('declaration is copied by permit before await and later poisoning cannot change binding', async () => withRoot(async root => {
  const m = memfs(); const d = declaration(); const operation = importFixedXpcHistoryFromDisk(request(open(m).owner, root, {declaration: d}));
  d.projectId = 'project-poison'; d.sourceSha256 = '0'.repeat(64); d.rawContentPersisted = true;
  const result = await operation;
  assert.equal(result.status, 'IMPORTED'); assert.equal(result.capture.journal.snapshot.entries[0].entry.projectId, 'project-a');
}));

test('directory at selected path refuses after one source attempt without capture', async () => withRoot(async root => {
  await rm(join(root, 'evidence.json')); await mkdir(join(root, 'evidence.json'));
  const result = await importFixedXpcHistoryFromDisk(request(open(memfs()).owner, root));
  assertOuter(result, 'REFUSED', 'DISK_CAPTURE_REGULAR_FILE_REQUIRED', true, false); assert.equal(result.sourceEvidence, null);
  assert.equal(result.sourceFailure, 'DISK_CAPTURE_REGULAR_FILE_REQUIRED');
}));

test('file symlink is never followed', async () => withRoot(async root => {
  await writeFile(join(root, 'target.json'), SOURCE_TEXT); await rm(join(root, 'evidence.json'));
  await symlink('target.json', join(root, 'evidence.json'));
  const result = await importFixedXpcHistoryFromDisk(request(open(memfs()).owner, root));
  assertOuter(result, 'REFUSED', 'DISK_CAPTURE_SYMLINK', true, false);
  assert.equal(result.sourceFailure, 'DISK_CAPTURE_SYMLINK');
}));

test('symlinked directory component is never followed', async () => withRoot(async root => {
  await mkdir(join(root, 'real')); await writeFile(join(root, 'real', 'evidence.json'), SOURCE_TEXT);
  await symlink('real', join(root, 'linked')); const s = {...selection(root), relativePath: 'linked/evidence.json'};
  const result = await importFixedXpcHistoryFromDisk(request(open(memfs()).owner, root, {source: s}));
  assertOuter(result, 'REFUSED', 'DISK_CAPTURE_SYMLINK', true, false);
  assert.equal(result.sourceFailure, 'DISK_CAPTURE_SYMLINK');
}));

test('hardlinked selected file is refused', async () => withRoot(async root => {
  await link(join(root, 'evidence.json'), join(root, 'second-link.json'));
  const result = await importFixedXpcHistoryFromDisk(request(open(memfs()).owner, root));
  assertOuter(result, 'REFUSED', 'DISK_CAPTURE_HARDLINK', true, false);
  assert.equal(result.sourceFailure, 'DISK_CAPTURE_HARDLINK');
}));

test('invalid UTF-8 is refused without echoing bytes', async () => withRoot(async root => {
  await writeFile(join(root, 'evidence.json'), Buffer.from([0xff, 0xfe, 0xfd]));
  const result = await importFixedXpcHistoryFromDisk(request(open(memfs()).owner, root));
  assertOuter(result, 'REFUSED', 'DISK_CAPTURE_UTF8_INVALID', true, false);
  assert.equal(result.sourceFailure, 'DISK_CAPTURE_UTF8_INVALID');
  assert.equal(result.sourceEvidence, null); assert.equal(result.capture, null);
}));

test('file larger than 1MiB is refused without capture', async () => withRoot(async root => {
  await writeFile(join(root, 'evidence.json'), Buffer.alloc(1024 * 1024 + 1, 0x61));
  const result = await importFixedXpcHistoryFromDisk(request(open(memfs()).owner, root));
  assertOuter(result, 'REFUSED', 'DISK_CAPTURE_FILE_LIMIT', true, false);
  assert.equal(result.sourceFailure, 'DISK_CAPTURE_FILE_LIMIT');
}));

test('cancellation wins outer status but retains a closed reader failure code', async () => withRoot(async root => {
  await rm(join(root, 'evidence.json')); await mkdir(join(root, 'evidence.json'));
  const controller = new AbortController();
  const operation = importFixedXpcHistoryFromDisk(request(open(memfs()).owner, root, {signal: controller.signal}));
  queueMicrotask(() => controller.abort());
  const result = await operation;
  assertOuter(result, 'CANCELLED', 'ABORTED', true, false);
  assert.equal(result.sourceFailure, 'DISK_CAPTURE_REGULAR_FILE_REQUIRED');
  assert.equal(result.sourceEvidence, null); assert.equal(result.capture, null);
}));

test('source digest mismatch preserves bounded evidence but refuses capture admission', async () => withRoot(async root => {
  const m = memfs(); const result = await importFixedXpcHistoryFromDisk(request(open(m).owner, root,
    {declaration: declaration({sourceSha256: '0'.repeat(64)})}));
  assertOuter(result, 'REFUSED', 'SOURCE_DIGEST_MISMATCH', true, true);
  assert.equal(result.sourceEvidence.sourceSha256, sha256(SOURCE_TEXT));
  assert.equal(result.capture.status, 'REFUSED'); assert.equal(result.capture.recordAttempted, false);
}));

test('malformed but digest-matched source record is refused by the canonical projector', async () => withRoot(async root => {
  const text = '{"not":"fixed-xpc"}'; await writeFile(join(root, 'evidence.json'), text);
  const m = memfs(); const result = await importFixedXpcHistoryFromDisk(request(open(m).owner, root,
    {declaration: declaration({sourceSha256: sha256(text)})}));
  assertOuter(result, 'REFUSED', 'INVALID_INPUT', true, true); assert.equal(result.capture.status, 'REFUSED');
}));

test('result never leaks root, relative path, source content or signal reason', async () => withRoot(async root => {
  const m = memfs(); const result = await importFixedXpcHistoryFromDisk(request(open(m).owner, root)); const encoded = JSON.stringify(result);
  assert.equal(encoded.includes(root), false); assert.equal(encoded.includes('evidence.json'), false);
  assert.equal(encoded.includes(SOURCE_TEXT), false); assert.equal(encoded.includes('nisi fixed probe'), false);
}));

test('duplicate preserves the actual canonical capture result', async () => withRoot(async root => {
  const m = memfs(); const opened = open(m); const first = await importFixedXpcHistoryFromDisk(request(opened.owner, root));
  assert.equal(first.status, 'IMPORTED'); const second = await importFixedXpcHistoryFromDisk(request(opened.owner, root));
  assertOuter(second, 'DUPLICATE', null, true, true); assert.equal(second.capture.status, 'DUPLICATE');
  assert.equal(second.capture.journal.store, null);
}));

test('same observation identity with changed declaration binding reports conflict', async () => withRoot(async root => {
  const m = memfs(); const opened = open(m); assert.equal((await importFixedXpcHistoryFromDisk(request(opened.owner, root))).status, 'IMPORTED');
  const result = await importFixedXpcHistoryFromDisk(request(opened.owner, root, {declaration: declaration({candidateId: 'candidate-b'})}));
  assertOuter(result, 'CONFLICT', 'ID_CONTENT_MISMATCH', true, true); assert.equal(result.capture.journal.status, 'CONFLICT');
}));

test('precommit journal failure preserves STORE_FAILED and the previous snapshot', async () => withRoot(async root => {
  const m = memfs(); const opened = open(m); const prior = opened.snapshot;
  m.fs.renameSync = () => { throw Object.assign(Error('PRIVATE-RENAME'), {code: 'EIO'}); };
  const result = await importFixedXpcHistoryFromDisk(request(opened.owner, root));
  assertOuter(result, 'STORE_FAILED', 'RENAME_FAILED', true, true);
  assert.equal(result.capture.journal.store.committed, false); assert.equal(result.capture.journal.snapshot, prior);
  assert.equal(JSON.stringify(result).includes('PRIVATE-RENAME'), false);
}));

test('postrename failure is uncertain and a fresh owner reconciles actual committed bytes', async () => withRoot(async root => {
  const m = memfs(); const opened = open(m); let renamed = false;
  const rename = m.fs.renameSync, read = m.fs.readFileSync;
  m.fs.renameSync = (a, b) => { rename(a, b); renamed = true; };
  m.fs.readFileSync = path => renamed && path === PATH ? (() => { throw Object.assign(Error('PRIVATE-READ'), {code: 'EIO'}); })() : read(path);
  const result = await importFixedXpcHistoryFromDisk(request(opened.owner, root));
  assertOuter(result, 'UNCERTAIN', 'READBACK_MISMATCH', true, true);
  assert.equal(result.capture.journal.store.committed, true);
  const fresh = openJournalOwner({path: PATH, fs: {...m.fs, readFileSync: read}, config: CONFIG, now: 100});
  assert.equal(fresh.status, 'OPENED'); assert.deepEqual(fresh.snapshot.recovery.recoveredIds,
    ['0123456789abcdef0123456789abcdef:0:fixed-xpc']);
}));

test('stale owner disk digest reports STORE_CONFLICT without retry', async () => withRoot(async root => {
  const m = memfs(); const stale = open(m); const writer = open(m);
  assert.equal(recordJournalObservation({owner: writer.owner, entry: entry('interloper'), now: 100}).status, 'RECORDED');
  const before = m.events.length; const result = await importFixedXpcHistoryFromDisk(request(stale.owner, root));
  assertOuter(result, 'CONFLICT', 'CONFLICT', true, true); assert.equal(result.capture.journal.status, 'STORE_CONFLICT');
  assert.equal(m.events.filter((event, index) => index >= before && event.name === 'renameSync').length, 0);
}));

test('abort inside pre-record clock preserves PERMIT_REVOKED rather than outer cancellation', async () => withRoot(async root => {
  const m = memfs(); const controller = new AbortController(); let calls = 0;
  const result = await importFixedXpcHistoryFromDisk(request(open(m).owner, root, {signal: controller.signal,
    clock: () => { calls++; if (calls === 2) controller.abort(); return 100; }}));
  assertOuter(result, 'REFUSED', 'PERMIT_REVOKED', true, true);
  assert.equal(result.capture.status, 'REFUSED'); assert.equal(result.capture.recordAttempted, false);
}));

test('abort after record admission cannot override the actual write result', async () => withRoot(async root => {
  const m = memfs(); const controller = new AbortController(); const opened = open(m); const openSync = m.fs.openSync; let aborted = false;
  m.fs.openSync = (...args) => { if (!aborted) { aborted = true; controller.abort(); } return openSync(...args); };
  const result = await importFixedXpcHistoryFromDisk(request(opened.owner, root, {signal: controller.signal}));
  assertOuter(result, 'IMPORTED', null, true, true); assert.equal(result.capture.journal.status, 'RECORDED');
}));

test('capture is invoked once: admitted store failure is consumed and never automatically retried', async () => withRoot(async root => {
  const m = memfs(); const opened = open(m); let renames = 0;
  m.fs.renameSync = () => { renames++; throw Object.assign(Error('fail'), {code: 'EIO'}); };
  const result = await importFixedXpcHistoryFromDisk(request(opened.owner, root));
  assert.equal(result.status, 'STORE_FAILED'); assert.equal(renames, 1);
}));

test('source scope is exactly the selected single path and unrelated files are not represented', async () => withRoot(async root => {
  await writeFile(join(root, 'unrelated-private.txt'), 'UNRELATED-PRIVATE-CANARY');
  const result = await importFixedXpcHistoryFromDisk(request(open(memfs()).owner, root));
  assert.equal(result.status, 'IMPORTED'); const encoded = JSON.stringify(result);
  assert.equal(encoded.includes('unrelated-private'), false); assert.equal(encoded.includes('UNRELATED-PRIVATE-CANARY'), false);
}));

test('invalid signal identity is INVALID_INPUT before source recognition or clock', async () => withRoot(async root => {
  const m = memfs(); let calls = 0;
  for (const signal of [{aborted: false}, new EventTarget(), 0]) {
    const result = await importFixedXpcHistoryFromDisk(request(open(m).owner, root, {signal, clock: () => ++calls}));
    assertOuter(result, 'REFUSED', 'INVALID_INPUT', false, false);
    assert.equal(result.sourceSelectionDigest, null); assert.equal(result.declarationDigest, null);
  }
  assert.equal(calls, 0);
}));
