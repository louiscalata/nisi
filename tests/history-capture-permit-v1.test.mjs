import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  createFixedXpcHistoryPermit,
  captureFixedXpcHistory,
  revokeFixedXpcHistoryPermit
} from '../history/history-capture-permit-v1.mjs';
import { openJournalOwner, recordJournalObservation } from '../history/journal-owner-v2.mjs';
import { memfs } from './journal-owner-v2.memfs.mjs';
import { CONFIG as BASE_CONFIG, PATH, entry, serialized, damageFooter, assertDeepFrozen } from './journal-owner-v2.helper.mjs';
import { makeRecord } from './fixtures/fixed-xpc-journal-observation.mjs';

// Use the SAME canonical owner registry as the implementation. Fixed XPC payloads
// have no payload.secret; specific existing-field redaction is exercised below.
const CONFIG = Object.freeze({...BASE_CONFIG, redactPaths: []});

const PERMIT_SCHEMA = 'nisi-fixed-xpc-history-permit/v1';
const CAPTURE_SCHEMA = 'nisi-fixed-xpc-history-capture/v1';
const PERMIT_KEYS = ['schemaVersion', 'status', 'reason', 'permit', 'declarationDigest', 'authorizing'];
const CAPTURE_KEYS = ['schemaVersion', 'status', 'reason', 'recordAttempted', 'declarationDigest', 'journal', 'meaning', 'authorizing'];
const SOURCE = JSON.stringify(makeRecord('valid'));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);

const declaration = (overrides = {}) => ({
  schemaVersion: 'nisi-fixed-xpc-history-declaration/v1',
  declarationId: 'declaration-a',
  projectId: 'project-a',
  candidateId: 'candidate-a',
  receiptId: 'receipt-a',
  consentClass: 'WRITTEN_DECLARATION',
  sourceSha256: sha256(SOURCE),
  issuedAt: 100,
  expiresAt: 3_600_100,
  createdAt: 100,
  retentionMs: 1_000,
  destination: 'LOCAL_OBSERVATION_JOURNAL_ONLY',
  rawContentPersisted: false,
  networkEgress: false,
  learningInfluence: false,
  ...overrides
});
const expectedDeclarationDigest = value => sha256('nisi-history-declaration/v1\n' + canonical(value));
const open = (m, config = CONFIG, now = 100) => openJournalOwner({ path: PATH, fs: m.fs, config, now });
const clock = (...values) => { let index = 0; return () => values[Math.min(index++, values.length - 1)]; };
const create = (owner, declarationValue = declaration(), clockValue = () => 100) =>
  createFixedXpcHistoryPermit({ owner, declaration: declarationValue, clock: clockValue });

function assertPermit(result, status, reason, digest = null) {
  assert.deepEqual(Object.keys(result).sort(), [...PERMIT_KEYS].sort());
  assert.equal(result.schemaVersion, PERMIT_SCHEMA);
  assert.equal(result.status, status);
  assert.equal(result.reason, reason);
  assert.equal(result.declarationDigest, digest);
  assert.equal(result.authorizing, false);
}

function assertCapture(result, status, reason, attempted, digest) {
  assert.deepEqual(Object.keys(result).sort(), [...CAPTURE_KEYS].sort());
  assert.equal(result.schemaVersion, CAPTURE_SCHEMA);
  assert.equal(result.status, status);
  assert.equal(result.reason, reason);
  assert.equal(result.recordAttempted, attempted);
  assert.equal(result.declarationDigest, digest);
  assert.equal(result.meaning, 'HISTORY_OBSERVATIONS_ONLY');
  assert.equal(result.authorizing, false);
  assertDeepFrozen(result);
}

test('create returns exact CREATED response with empty frozen opaque permit and canonical digest', () => {
  const m = memfs(); const opened = open(m); const d = declaration();
  const result = create(opened.owner, d);
  assertPermit(result, 'CREATED', null, expectedDeclarationDigest(d));
  assert.deepEqual(Object.keys(result.permit), []);
  assert.equal(Object.isFrozen(result.permit), true);
});

test('create exact envelope rejects missing, extra, symbols, hidden fields and getters without invocation', () => {
  const m = memfs(); const opened = open(m); let calls = 0;
  const valid = { owner: opened.owner, declaration: declaration(), clock: () => 100 };
  const getter = { ...valid }; Object.defineProperty(getter, 'declaration', { enumerable: true, get() { calls++; throw Error('secret'); } });
  const symbol = { ...valid }; symbol[Symbol('x')] = true;
  const hidden = { ...valid }; Object.defineProperty(hidden, 'x', { value: true });
  for (const input of [null, [], { ...valid, extra: true }, { owner: opened.owner, declaration: declaration() }, getter, symbol, hidden]) {
    const result = createFixedXpcHistoryPermit(input);
    assertPermit(result, 'REFUSED', 'INVALID_INPUT');
    assert.equal(result.permit, null);
  }
  assert.equal(calls, 0);
});

test('plain and null-prototype create envelopes are accepted', () => {
  for (const nullPrototype of [false, true]) {
    const m = memfs(); const opened = open(m);
    const values = { owner: opened.owner, declaration: declaration(), clock: () => 100 };
    const input = nullPrototype ? Object.assign(Object.create(null), values) : values;
    assert.equal(createFixedXpcHistoryPermit(input).status, 'CREATED');
  }
});

test('closed declaration rejects missing, extra, accessor and malformed scalar cases before owner', () => {
  let calls = 0;
  const accessor = declaration(); Object.defineProperty(accessor, 'projectId', { enumerable: true, get() { calls++; return 'project-a'; } });
  const cases = [
    { ...declaration(), extra: true },
    Object.fromEntries(Object.entries(declaration()).filter(([key]) => key !== 'receiptId')),
    { ...declaration(), declarationId: '' },
    { ...declaration(), projectId: 'has space' },
    { ...declaration(), sourceSha256: 'A'.repeat(64) },
    { ...declaration(), consentClass: 'CLICK' },
    { ...declaration(), destination: 'NETWORK' },
    { ...declaration(), rawContentPersisted: true },
    { ...declaration(), networkEgress: true },
    { ...declaration(), learningInfluence: true },
    accessor
  ];
  for (const value of cases) assertPermit(createFixedXpcHistoryPermit({ owner: {}, declaration: value, clock: () => 100 }), 'REFUSED', 'INVALID_DECLARATION');
  assert.equal(calls, 0);
});

test('declaration temporal and retention scalar bounds are closed', () => {
  const m = memfs(); const owner = open(m).owner;
  for (const value of [
    declaration({ issuedAt: -0 }), declaration({ expiresAt: 100 }), declaration({ expiresAt: 3_600_101 }),
    declaration({ createdAt: -0 }), declaration({ retentionMs: 0 }), declaration({ retentionMs: 7_776_000_001 }),
    declaration({ createdAt: Number.MAX_SAFE_INTEGER, retentionMs: 1 })
  ]) assertPermit(create(owner, value), 'REFUSED', 'INVALID_DECLARATION');
});

test('unknown, SEALED and COMMIT_UNCERTAIN owners follow create precedence', () => {
  assertPermit(create({}, declaration()), 'REFUSED', 'INVALID_OWNER');
  const sealedFs = memfs(); sealedFs.seed(PATH, damageFooter(serialized(CONFIG)));
  assertPermit(create(open(sealedFs).owner), 'REFUSED', 'OWNER_SEALED');
  const uncertainFs = memfs(); const uncertain = open(uncertainFs); let renamed = false;
  const rename = uncertainFs.fs.renameSync, read = uncertainFs.fs.readFileSync;
  uncertainFs.fs.renameSync = (a, b) => { rename(a, b); renamed = true; };
  uncertainFs.fs.readFileSync = path => renamed && path === PATH ? Buffer.from('mismatch') : read(path);
  assert.equal(recordJournalObservation({ owner: uncertain.owner, entry: entry(), now: 100 }).snapshot.state, 'COMMIT_UNCERTAIN');
  assertPermit(create(uncertain.owner), 'REFUSED', 'COMMIT_UNCERTAIN');
});

test('create clock throw and invalid values refuse without a handle', () => {
  for (const clockValue of [() => { throw Error('private clock'); }, () => -0, () => -1, () => 1.5, () => Number.MAX_SAFE_INTEGER + 1]) {
    const m = memfs(); const result = create(open(m).owner, declaration(), clockValue);
    assertPermit(result, 'REFUSED', 'INVALID_CLOCK');
    assert.equal(result.permit, null);
    assert.equal(JSON.stringify(result).includes('private clock'), false);
  }
});

test('create temporal currentness reasons are precise', () => {
  const cases = [
    [declaration({ issuedAt: 101 }), 100, 'PERMIT_NOT_YET_VALID'],
    [declaration(), 3_600_100, 'PERMIT_EXPIRED'],
    [declaration({ createdAt: 101 }), 100, 'OBSERVATION_IN_FUTURE'],
    [declaration({ createdAt: 100, retentionMs: 10 }), 110, 'OBSERVATION_EXPIRED']
  ];
  for (const [d, now, reason] of cases) { const m = memfs(); assertPermit(create(open(m).owner, d, () => now), 'REFUSED', reason); }
});

test('declaration is privately copied and digest is recursively canonical', () => {
  const m = memfs(); const d = declaration(); const expected = expectedDeclarationDigest(d);
  const created = create(open(m).owner, d);
  d.projectId = 'project-b'; d.sourceSha256 = '0'.repeat(64); d.rawContentPersisted = true;
  assert.equal(created.declarationDigest, expected);
  const result = captureFixedXpcHistory({ permit: created.permit, serializedRecord: SOURCE });
  assertCapture(result, 'IMPORTED', null, true, expected);
  assert.equal(result.journal.snapshot.entries[0].entry.projectId, 'project-a');
});

test('capture exact envelope and forged permit refuse with no declaration recognition', () => {
  const m = memfs(); const created = create(open(m).owner); let calls = 0;
  const getter = { permit: created.permit };
  Object.defineProperty(getter, 'serializedRecord', { enumerable: true, get() { calls++; throw Error('secret'); } });
  for (const input of [null, [], { permit: created.permit }, { permit: created.permit, serializedRecord: SOURCE, extra: true }, getter])
    assertCapture(captureFixedXpcHistory(input), 'REFUSED', 'INVALID_INPUT', false, null);
  assert.equal(calls, 0);
  assertCapture(captureFixedXpcHistory({ permit: {}, serializedRecord: SOURCE }), 'REFUSED', 'INVALID_PERMIT', false, null);
});

test('revoke exact responses reject malformed and unknown handles', () => {
  let calls = 0; const getter = {};
  Object.defineProperty(getter, 'permit', { enumerable: true, get() { calls++; throw Error('secret'); } });
  assertPermit(revokeFixedXpcHistoryPermit({}), 'REFUSED', 'INVALID_INPUT');
  assertPermit(revokeFixedXpcHistoryPermit({ permit: {}, extra: true }), 'REFUSED', 'INVALID_INPUT');
  assertPermit(revokeFixedXpcHistoryPermit(getter), 'REFUSED', 'INVALID_INPUT');
  assert.equal(calls, 0);
  assertPermit(revokeFixedXpcHistoryPermit({ permit: {} }), 'REFUSED', 'INVALID_PERMIT');
});

test('recognized revoke is idempotent and later capture reports PERMIT_REVOKED', () => {
  const m = memfs(); const created = create(open(m).owner);
  for (let i = 0; i < 2; i++) {
    const revoked = revokeFixedXpcHistoryPermit({ permit: created.permit });
    assertPermit(revoked, 'REVOKED', null, created.declarationDigest);
    assert.equal(revoked.permit, null);
  }
  assertCapture(captureFixedXpcHistory({ permit: created.permit, serializedRecord: SOURCE }), 'REFUSED', 'PERMIT_REVOKED', false, created.declarationDigest);
});

test('invalid source types, malformed Unicode and >1MiB leave permit reusable', () => {
  const m = memfs(); const created = create(open(m).owner);
  for (const serializedRecord of [null, '\ud800', 'x'.repeat(1024 * 1024 + 1)]) {
    const result = captureFixedXpcHistory({ permit: created.permit, serializedRecord });
    assertCapture(result, 'REFUSED', 'INVALID_SOURCE', false, created.declarationDigest);
    assert.equal(result.journal, null);
  }
  assert.equal(captureFixedXpcHistory({ permit: created.permit, serializedRecord: SOURCE }).status, 'IMPORTED');
});

test('source digest mismatch leaves permit reusable and never exposes source', () => {
  const m = memfs(); const created = create(open(m).owner);
  const privateSource = SOURCE + 'PRIVATE-SOURCE-CANARY';
  const refused = captureFixedXpcHistory({ permit: created.permit, serializedRecord: privateSource });
  assertCapture(refused, 'REFUSED', 'SOURCE_DIGEST_MISMATCH', false, created.declarationDigest);
  assert.equal(JSON.stringify(refused).includes('PRIVATE-SOURCE-CANARY'), false);
  assert.equal(captureFixedXpcHistory({ permit: created.permit, serializedRecord: SOURCE }).status, 'IMPORTED');
});

test('projector INVALID_INPUT leaves permit reusable', () => {
  const malformed = JSON.stringify({ schemaVersion: 'old' });
  const m = memfs(); const created = create(open(m).owner, declaration({ sourceSha256: sha256(malformed) }));
  const refused = captureFixedXpcHistory({ permit: created.permit, serializedRecord: malformed });
  assertCapture(refused, 'REFUSED', 'INVALID_INPUT', false, created.declarationDigest);
  assert.equal(refused.journal, null);
  assertPermit(revokeFixedXpcHistoryPermit({ permit: created.permit }), 'REVOKED', null, created.declarationDigest);
});

test('capture clock invalidity permanently revokes permit after first precise INVALID_CLOCK', () => {
  const m = memfs(); const created = create(open(m).owner, declaration(), clock(100, -0));
  assertCapture(captureFixedXpcHistory({ permit: created.permit, serializedRecord: SOURCE }), 'REFUSED', 'INVALID_CLOCK', false, created.declarationDigest);
  assertCapture(captureFixedXpcHistory({ permit: created.permit, serializedRecord: SOURCE }), 'REFUSED', 'PERMIT_REVOKED', false, created.declarationDigest);
  const otherFs = memfs(); let calls = 0;
  const throwingClock = () => { if (calls++ === 0) return 100; throw Error('private clock text'); };
  const other = create(open(otherFs).owner, declaration(), throwingClock);
  const thrown = captureFixedXpcHistory({ permit: other.permit, serializedRecord: SOURCE });
  assertCapture(thrown, 'REFUSED', 'INVALID_CLOCK', false, other.declarationDigest);
  assert.equal(JSON.stringify(thrown).includes('private clock text'), false);
  assert.equal(captureFixedXpcHistory({ permit: other.permit, serializedRecord: SOURCE }).reason, 'PERMIT_REVOKED');
});

test('backward capture clock permanently revokes permit', () => {
  const m = memfs(); const created = create(open(m).owner, declaration(), clock(100, 101, 100));
  assertCapture(captureFixedXpcHistory({ permit: created.permit, serializedRecord: SOURCE }), 'REFUSED', 'INVALID_CLOCK', false, created.declarationDigest);
  assert.equal(revokeFixedXpcHistoryPermit({ permit: created.permit }).status, 'REVOKED');
});

test('capture expiry returns precise reason once then permanently revoked', () => {
  const d = declaration({ expiresAt: 150 }); const m = memfs(); const created = create(open(m).owner, d, clock(100, 150));
  assertCapture(captureFixedXpcHistory({ permit: created.permit, serializedRecord: SOURCE }), 'REFUSED', 'PERMIT_EXPIRED', false, created.declarationDigest);
  assert.equal(captureFixedXpcHistory({ permit: created.permit, serializedRecord: SOURCE }).reason, 'PERMIT_REVOKED');
});

test('observation expiry during capture returns precise reason once then permanently revoked', () => {
  const d = declaration({ retentionMs: 10 }); const m = memfs(); const created = create(open(m).owner, d, clock(100, 110));
  assertCapture(captureFixedXpcHistory({ permit: created.permit, serializedRecord: SOURCE }), 'REFUSED', 'OBSERVATION_EXPIRED', false, created.declarationDigest);
  assert.equal(captureFixedXpcHistory({ permit: created.permit, serializedRecord: SOURCE }).reason, 'PERMIT_REVOKED');
});

test('reentrant capture of the same permit is PERMIT_BUSY and outer capture remains valid', () => {
  const m = memfs(); const opened = open(m); let created; let nested; let called = false;
  const liveClock = () => {
    if (created && !called) { called = true; nested = captureFixedXpcHistory({ permit: created.permit, serializedRecord: SOURCE }); }
    return 100;
  };
  created = create(opened.owner, declaration(), liveClock);
  const outer = captureFixedXpcHistory({ permit: created.permit, serializedRecord: SOURCE });
  assertCapture(nested, 'REFUSED', 'PERMIT_BUSY', false, created.declarationDigest);
  assert.equal(outer.status, 'IMPORTED');
});

test('reentrant revocation from trusted clock before admission prevents record', () => {
  const m = memfs(); const opened = open(m); let created; let revoked; let called = false;
  const liveClock = () => {
    if (created && !called) { called = true; revoked = revokeFixedXpcHistoryPermit({ permit: created.permit }); }
    return 100;
  };
  created = create(opened.owner, declaration(), liveClock);
  const result = captureFixedXpcHistory({ permit: created.permit, serializedRecord: SOURCE });
  assertPermit(revoked, 'REVOKED', null, created.declarationDigest);
  assertCapture(result, 'REFUSED', 'PERMIT_REVOKED', false, created.declarationDigest);
  assert.equal(m.bytes(PATH), undefined);
});

test('revoke from filesystem callback after admission does not abort actual journal outcome', () => {
  const m = memfs(); const opened = open(m); const created = create(opened.owner); let revoked; let called = false;
  const openSync = m.fs.openSync;
  m.fs.openSync = (...args) => {
    if (!called) { called = true; revoked = revokeFixedXpcHistoryPermit({ permit: created.permit }); }
    return openSync(...args);
  };
  const result = captureFixedXpcHistory({ permit: created.permit, serializedRecord: SOURCE });
  assertPermit(revoked, 'REVOKED', null, created.declarationDigest);
  assertCapture(result, 'IMPORTED', null, true, created.declarationDigest);
  assert.equal(result.journal.status, 'RECORDED');
  assert.equal(captureFixedXpcHistory({ permit: created.permit, serializedRecord: SOURCE }).reason, 'PERMIT_REVOKED');
});

test('successful capture stores only closed provenance and preserves immutable owner result', () => {
  const m = memfs(); const created = create(open(m).owner); const result = captureFixedXpcHistory({ permit: created.permit, serializedRecord: SOURCE });
  assertCapture(result, 'IMPORTED', null, true, created.declarationDigest);
  const row = result.journal.snapshot.entries[0].entry;
  assert.deepEqual(row.payload.historyCapture, {
    schemaVersion: 'nisi-history-capture-provenance/v1', declarationDigest: created.declarationDigest,
    consentClass: 'WRITTEN_DECLARATION', consentAuthenticityAttested: false,
    sourceAuthenticityAttested: false, executionAttested: false
  });
  assert.equal(result.journal.store.status, 'WRITTEN');
});

test('permit remains privately bound to its original owner and cannot write another owner', () => {
  const firstFs = memfs(); const secondFs = memfs();
  const first = open(firstFs); const second = open(secondFs);
  const created = create(first.owner);
  assert.equal(captureFixedXpcHistory({ permit: created.permit, serializedRecord: SOURCE }).status, 'IMPORTED');
  assert.ok(firstFs.bytes(PATH));
  assert.equal(secondFs.bytes(PATH), undefined);
  assert.deepEqual(second.snapshot.entries, []);
});

test('same consumed permit cannot be reused', () => {
  const m = memfs(); const created = create(open(m).owner);
  assert.equal(captureFixedXpcHistory({ permit: created.permit, serializedRecord: SOURCE }).status, 'IMPORTED');
  assertCapture(captureFixedXpcHistory({ permit: created.permit, serializedRecord: SOURCE }), 'REFUSED', 'PERMIT_CONSUMED', false, created.declarationDigest);
});

test('a second permit for identical source maps owner duplicate without a fresh write', () => {
  const m = memfs(); const owner = open(m).owner; const first = create(owner); const second = create(owner);
  assert.equal(captureFixedXpcHistory({ permit: first.permit, serializedRecord: SOURCE }).status, 'IMPORTED');
  const before = m.events.length;
  const replay = captureFixedXpcHistory({ permit: second.permit, serializedRecord: SOURCE });
  assertCapture(replay, 'DUPLICATE', null, true, second.declarationDigest);
  assert.equal(replay.journal.status, 'DUPLICATE');
  assert.equal(m.events.length, before);
});

test('project mismatch is an attempted one-shot journal refusal', () => {
  const m = memfs(); const created = create(open(m).owner, declaration({ projectId: 'project-b' }));
  const result = captureFixedXpcHistory({ permit: created.permit, serializedRecord: SOURCE });
  assertCapture(result, 'REFUSED', 'PROJECT', true, created.declarationDigest);
  assert.equal(result.journal.status, 'REFUSED');
  assert.equal(captureFixedXpcHistory({ permit: created.permit, serializedRecord: SOURCE }).reason, 'PERMIT_CONSUMED');
});

test('precommit write failure is returned once and permit remains consumed without retry', () => {
  const m = memfs(); const owner = open(m).owner; const created = create(owner); let renames = 0;
  m.fs.renameSync = () => { renames++; throw Error('private failure'); };
  const result = captureFixedXpcHistory({ permit: created.permit, serializedRecord: SOURCE });
  assertCapture(result, 'STORE_FAILED', 'RENAME_FAILED', true, created.declarationDigest);
  assert.equal(result.journal.store.committed, false);
  assert.equal(renames, 1);
  assert.equal(captureFixedXpcHistory({ permit: created.permit, serializedRecord: SOURCE }).reason, 'PERMIT_CONSUMED');
});

test('postrename read failure returns UNCERTAIN and fresh explicit open reconciles bytes', () => {
  const m = memfs(); const owner = open(m).owner; const created = create(owner); let renamed = false;
  const rename = m.fs.renameSync, read = m.fs.readFileSync;
  m.fs.renameSync = (a, b) => { rename(a, b); renamed = true; };
  m.fs.readFileSync = path => renamed && path === PATH ? Buffer.from('mismatch') : read(path);
  const result = captureFixedXpcHistory({ permit: created.permit, serializedRecord: SOURCE });
  assertCapture(result, 'UNCERTAIN', 'READBACK_MISMATCH', true, created.declarationDigest);
  assert.equal(result.journal.store.committed, true);
  assert.equal(result.journal.snapshot.state, 'COMMIT_UNCERTAIN');
  const fresh = openJournalOwner({ path: PATH, fs: { ...m.fs, readFileSync: read }, config: CONFIG, now: 100 });
  assert.equal(fresh.status, 'OPENED');
  assert.deepEqual(fresh.snapshot.recovery.recoveredIds, ['0123456789abcdef0123456789abcdef:0:fixed-xpc']);
});

test('configured journal redaction applies to capture provenance without leaking unredacted payload', () => {
  const config = { ...CONFIG, redactPaths: ['payload.historyCapture.declarationDigest'] };
  const m = memfs(); const created = create(open(m, config).owner);
  const result = captureFixedXpcHistory({ permit: created.permit, serializedRecord: SOURCE });
  assert.equal(result.status, 'IMPORTED');
  assert.equal(result.journal.snapshot.entries[0].entry.payload.historyCapture.declarationDigest, '[REDACTED]');
  assert.equal(result.declarationDigest, created.declarationDigest);
  assert.equal(JSON.stringify(result.journal).includes(created.declarationDigest), false);
});

test('adverse source preserves FAILED observation state and non-authorizing flags', () => {
  const adverse = makeRecord('valid'); adverse.client.result.process.exitCode = 70;
  const source = JSON.stringify(adverse); const m = memfs();
  const created = create(open(m).owner, declaration({ sourceSha256: sha256(source) }));
  const result = captureFixedXpcHistory({ permit: created.permit, serializedRecord: source });
  assert.equal(result.status, 'IMPORTED');
  assert.equal(result.journal.snapshot.entries[0].entry.state, 'FAILED');
  assert.equal(result.authorizing, false);
  assert.equal(result.journal.authorizing, false);
});
