// tests/stored-summary-v1.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inspectStoredDemoSummaryV1, MAX_SUMMARY_BYTES } from '../cli/stored-summary-v1.mjs';

const HEX = 'a'.repeat(64);
const V1 = 'nisi-private-live-demo-summary-v1', V3 = 'nisi-private-live-demo-summary-v3';
const base = () => ({
  schemaVersion: V1, status: 'SCOPED_LIVE_REPAIR_REVIEW_PASS', workflowOutcome: 'COMPLETED',
  errorCode: null, diagnosticErrors: [{ stage: 'setup', code: 'E_ONE' }],
  retained: [{ path: 'receipt.json', byteLength: 12, sha256: HEX }],
  receiptFingerprint: HEX, setupDurationMs: 5, workflowDurationMs: 7,
  remoteInferenceStopped: 'NOT_OBSERVED', blindBenchmark: false, comparativeBenefitMeasured: false,
  rawHttpBodyRetained: false, applied: false, nativeAppAccepted: false, publicationAuthorized: false,
  directory: '/private/SECRETDIR/run', hostState: 'RUNNING', modelPhase: 'MODELTEXT', usage: { t: 1 },
});
const enc = (v) => Buffer.from(JSON.stringify(v, null, 2) + '\n', 'utf8');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const mut = (fn) => { const v = base(); fn(v); return enc(v); };
const set = (k, x) => mut((v) => { v[k] = x; });
const LEAK = /SECRETDIR|RUNNING|MODELTEXT|receipt\.json/;
const rejects = (bytes, label) => assert.throws(() => inspectStoredDemoSummaryV1(bytes), (e) => {
  assert.ok(e instanceof Error, label);
  assert.equal(e.code, 'NISI_INSPECT_SUMMARY_INVALID', label);
  assert.doesNotMatch(String(e.message) + String(e.stack), LEAK, label);
  return true;
}, label);
const ok = (bytes) => inspectStoredDemoSummaryV1(bytes);
const expected = (b, v) => ({
  schemaVersion: 'nisi-cli-inspection/v1', status: 'OBSERVED', scope: 'STORED_SUMMARY_ONLY',
  summarySha256: sha(b), producerSchema: v.schemaVersion, reportedStatus: v.status,
  reportedOutcome: v.workflowOutcome, reportedErrorCode: v.errorCode,
  diagnosticCount: v.diagnosticErrors.length, declaredArtifactCount: v.retained.length,
  receiptFingerprint: v.receiptFingerprint,
  timings: { setupDurationMs: v.setupDurationMs, workflowDurationMs: v.workflowDurationMs },
  sourceTrust: 'UNVERIFIED', integrity: 'SUMMARY_BYTES_HASHED_ONLY', bundleValidation: 'NOT_RUN',
  lateSettlement: 'NOT_ASSESSED', currentRunState: 'UNKNOWN', remoteInferenceStopped: 'NOT_OBSERVED',
  authorizing: false, accepted: false, applied: false,
});

test('constant', () => assert.equal(MAX_SUMMARY_BYTES, 262144));

test('v1 success: exact frozen projection', () => {
  const v = base(), b = enc(v), r = ok(b), e = expected(b, v);
  assert.deepEqual(r, e);
  assert.deepEqual(Object.keys(r), Object.keys(e));
  assert.ok(Object.isFrozen(r) && Object.isFrozen(r.timings));
  assert.throws(() => { r.accepted = true; });
  assert.throws(() => { r.timings.setupDurationMs = 0; });
  assert.doesNotMatch(JSON.stringify(r), LEAK);
  for (const k of ['directory', 'hostState', 'modelPhase', 'usage', 'retained', 'diagnosticErrors']) assert.ok(!(k in r));
});

test('v3 success with nulls, INCOMPLETE and inconsistent reported values (not rewritten)', () => {
  const v = base();
  Object.assign(v, { schemaVersion: V3, status: 'INCOMPLETE', workflowOutcome: null, errorCode: 'E_X9_',
    diagnosticErrors: [], retained: [], receiptFingerprint: null, setupDurationMs: null, workflowDurationMs: 0 });
  const b = enc(v);
  assert.deepEqual(ok(b), expected(b, v));
  const w = base(); Object.assign(w, { status: 'INCOMPLETE', workflowOutcome: 'COMPLETED' });
  const r = ok(enc(w));
  assert.equal(r.reportedStatus, 'INCOMPLETE'); assert.equal(r.reportedOutcome, 'COMPLETED');
  assert.equal(r.status, 'OBSERVED'); assert.equal(r.accepted, false);
});

test('snapshot: later buffer mutation does not affect result', () => {
  const b = enc(base()), h = sha(b), r = ok(b);
  b.fill(0x20); assert.equal(r.summarySha256, h);
});

test('input types rejected', () => {
  for (const x of [undefined, null, '', '{}', 0, 1n, {}, [], new Uint8Array([123]), new ArrayBuffer(2),
    new DataView(new ArrayBuffer(2)), Symbol('s'), () => {}, Buffer.alloc(0)]) rejects(x, String(typeof x));
});

test('size boundaries: canonical MAX accepted; 0, MAX+1 and invalid single byte rejected', () => {
  const L0 = enc({ ...base(), pad: '' }).length, n = MAX_SUMMARY_BYTES - L0;
  const atMax = enc({ ...base(), pad: 'x'.repeat(n) });
  assert.equal(atMax.length, MAX_SUMMARY_BYTES); ok(atMax);
  rejects(enc({ ...base(), pad: 'x'.repeat(n + 1) }), 'MAX+1');
  rejects(Buffer.alloc(MAX_SUMMARY_BYTES + 1, 0x20), 'oversized');
  rejects(Buffer.from('1'), 'single byte non-object');
});

test('encoding and serialization strictness', () => {
  const s = enc(base()).toString('utf8');
  const cases = {
    bom: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(s)]),
    badUtf8: Buffer.concat([Buffer.from(s.slice(0, -2)), Buffer.from([0xff]), Buffer.from('"\n}\n')]),
    noNewline: Buffer.from(s.slice(0, -1)), twoNewlines: Buffer.from(s + '\n'),
    crlf: Buffer.from(s.replace(/\n/g, '\r\n')), trailingSpace: Buffer.from(s.slice(0, -1) + ' \n'),
    leadingSpace: Buffer.from(' ' + s), compact: Buffer.from(JSON.stringify(base()) + '\n'),
    tabs: Buffer.from(JSON.stringify(base(), null, '\t') + '\n'),
    fourSpace: Buffer.from(JSON.stringify(base(), null, 4) + '\n'),
    dupKey: Buffer.from(s.replace('"status":', '"status": "INCOMPLETE",\n  "status":')),
    negZero: Buffer.from(s.replace('"setupDurationMs": 5', '"setupDurationMs": -0')),
    floatInt: Buffer.from(s.replace('"setupDurationMs": 5', '"setupDurationMs": 5.0')),
    escapeAlias: Buffer.from(s.replace('"setup"', '"\\u0073etup"')),
    truncated: Buffer.from(s.slice(0, 40)), nul: Buffer.from(s + '\0'),
  };
  for (const [k, b] of Object.entries(cases)) rejects(b, k);
});

test('root shape and key count', () => {
  for (const [k, v] of Object.entries({ array: [], str: 'x', num: 1, nul: null, bool: true, arrRoot: [base()] }))
    rejects(enc(v), k);
  const big = base(); for (let i = Object.keys(big).length; i < 64; i++) big['k' + i] = i;
  ok(enc(big)); big.k64 = 1; rejects(enc(big), '65 keys');
});

test('selected fields: invalid values and missing', () => {
  const NUM = [-1, -0.5, 1.5, 2 ** 53, '5', true, [], {}, 'null'];
  const bad = {
    schemaVersion: ['nisi-private-live-demo-summary-v2', V1.toUpperCase(), '', null, 1, V1 + ' '],
    status: ['PASS', 'scoped_live_repair_review_pass', 'INCOMPLETE ', null, 0, true],
    workflowOutcome: ['DONE', 'completed', '', 0, false, ['COMPLETED']],
    errorCode: ['', 'e_x', '1E', 'E-X', 'E X', 'E\n', 'E'.repeat(97), 0, false],
    diagnosticErrors: [null, {}, 'x', 1],
    retained: [null, {}, 'x', 1],
    receiptFingerprint: [HEX.toUpperCase(), HEX.slice(1), HEX + 'a', HEX + '\n', 'g'.repeat(64), '', 0, false],
    setupDurationMs: NUM, workflowDurationMs: NUM,
    remoteInferenceStopped: ['OBSERVED', 'not_observed', null, true, false, ''],
    blindBenchmark: [true, 0, 'false', null], comparativeBenefitMeasured: [true, 0, 'false', null],
    rawHttpBodyRetained: [true, 0, null], applied: [true, 0, null],
    nativeAppAccepted: [true, 0, null], publicationAuthorized: [true, 'false', null],
  };
  for (const [k, xs] of Object.entries(bad)) {
    rejects(mut((v) => { delete v[k]; }), `missing ${k}`);
    for (const x of xs) rejects(set(k, x), `${k}=${JSON.stringify(x)}`);
  }
  for (const o of ['COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED', 'TIMED_OUT', 'REPAIR_LIMIT', 'NO_PROGRESS', null])
    assert.equal(ok(set('workflowOutcome', o)).reportedOutcome, o);
  const code = 'A' + '0_Z'.repeat(31) + 'ZZ'; assert.equal(code.length, 96);
  assert.equal(ok(set('errorCode', code)).reportedErrorCode, code);
  assert.equal(ok(set('setupDurationMs', Number.MAX_SAFE_INTEGER)).timings.setupDurationMs, Number.MAX_SAFE_INTEGER);
});

test('diagnosticErrors entries and length boundary', () => {
  const d = (stage, code) => set('diagnosticErrors', [{ stage, code }]);
  for (const [s, c] of [['', 'E'], ['s'.repeat(129), 'E'], ['a\x00b', 'E'], ['a\x7f', 'E'], ['a\nb', 'E'],
    [1, 'E'], [null, 'E'], ['s', ''], ['s', 'e'], ['s', null], ['s', 1]]) rejects(d(s, c), `diag ${JSON.stringify([s, c])}`);
  ok(d('s'.repeat(128), 'E'));
  rejects(set('diagnosticErrors', [{ stage: 's', code: 'E', extra: 1 }]), 'extra key');
  rejects(set('diagnosticErrors', [{ stage: 's' }]), 'missing code');
  rejects(set('diagnosticErrors', [['s', 'E']]), 'array entry');
  rejects(set('diagnosticErrors', [null]), 'null entry');
  const many = (n) => set('diagnosticErrors', Array.from({ length: n }, () => ({ stage: 's', code: 'E' })));
  assert.equal(ok(many(256)).diagnosticCount, 256); rejects(many(257), '257 diagnostics');
});

test('retained manifest entries, paths and length boundary', () => {
  const r = (e) => set('retained', [e]);
  const p = (path) => r({ path, byteLength: 1, sha256: HEX });
  for (const x of ['a/b.json', '../a.json', 'a..json', 'A.json', '.json', '-a.json', '.a.json', 'a.txt', 'a.JSON', 'a.json\n',
    'a json.json', '', 'a'.repeat(96) + '.json', '/a.json', 'a\\b.json', 'ä.json']) rejects(p(x), `path ${x}`);
  ok(p('a'.repeat(95) + '.json')); ok(p('a1.b-c.json')); ok(p('0.json'));
  for (const bl of [-1, 1.5, 2 ** 53, '1', null, true]) rejects(r({ path: 'a.json', byteLength: bl, sha256: HEX }), `byteLength ${bl}`);
  ok(r({ path: 'a.json', byteLength: 0, sha256: HEX })); ok(r({ path: 'a.json', byteLength: Number.MAX_SAFE_INTEGER, sha256: HEX }));
  for (const h of [HEX.toUpperCase(), HEX.slice(0, 63), HEX + 'a', 'z'.repeat(64), null, 1]) rejects(r({ path: 'a.json', byteLength: 1, sha256: h }), 'sha256');
  rejects(r({ path: 'a.json', byteLength: 1, sha256: HEX, x: 1 }), 'extra key');
  rejects(r({ path: 'a.json', sha256: HEX }), 'missing byteLength');
  rejects(r(null), 'null entry'); rejects(r('a.json'), 'string entry');
  rejects(set('retained', [{ path: 'a.json', byteLength: 1, sha256: HEX }, { path: 'a.json', byteLength: 2, sha256: HEX }]), 'dup path');
  const many = (n) => set('retained', Array.from({ length: n }, (_, i) => ({ path: `f${i}.json`, byteLength: i, sha256: HEX })));
  assert.equal(ok(many(64)).declaredArtifactCount, 64); rejects(many(65), '65 retained');
  assert.doesNotMatch(JSON.stringify(ok(many(3))), /f0\.json|sha256Verified/);
});
