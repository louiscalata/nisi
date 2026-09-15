// Oracle for decideInterruptedRunV1 (README §Acceptance tests T1, T3–T19).
// Written before the implementation; every case is derived from the contract
// and the real run-journal vocabulary (history/run-journal-v1.mjs), never from
// the module. T2/T20 (real modules, spawned children) live in Claude's
// integration test at promotion time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decideInterruptedRunV1 as decide } from '../src/interrupted-run-decision-v1.mjs';

const NOW = 1_000_000;
const hex = (c) => c.repeat(32);
const SCHEMA = 'nisi-interrupted-run-decision/v1';
const CK_SCHEMA = 'nisi-interrupted-run-checkpoint/v1';
const CELLS = ['journal', 'project', 'entries', 'consent', 'checkpoint', 'identity', 'stages'];
const OUT_KEYS = ['schemaVersion', 'status', 'reason', 'checks', 'interrupted', 'journalSha256', 'authorizing', 'executionGranted', 'resumeGranted'];
const REASONS = ['INVALID_INPUT', 'CONSENT_MISSING', 'CONSENT_EXPIRED', 'CONSENT_REVOKED', 'CONSENT_SCOPE', 'PROJECT_MISMATCH', 'SOURCE_DIGEST_MISMATCH', 'JOURNAL_SEALED', 'HEARTBEAT_LIVE', 'RUN_UNRECONCILED', 'CHECKPOINT_SCHEMA', 'CHECKPOINT_PROJECT', 'CHECKPOINT_PROFILE', 'CHECKPOINT_CONSENT', 'CHECKPOINT_TARGET', 'CHECKPOINT_SUPERSEDED', 'CHECKPOINT_STALE', 'RUN_ID_REUSED', 'RUN_ID_MISMATCH', 'ATTEMPT_REUSED', 'STAGE_ALREADY_SUCCEEDED', 'PASS_UNCONFIRMED', 'STALE_PASS', 'CHECKPOINT_BEFORE_PASS', 'UNCLAIMED_PASS'];

/* ------------------------------------------------------------------ fixtures */
const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'REVOKED']);
// A list(now) view row, coherent with run-journal-v1's own derivation.
function row(over = {}, view = {}) {
  const entry = { id: 'run-a:0:build', projectId: 'project-a', runId: 'run-a', attempt: 0, candidateId: 'cand-a', stage: 'build', receiptId: 'receipt-build', createdAt: NOW - 50_000, ttlMs: 100_000, state: 'SUCCEEDED', heartbeatAt: null, retryOf: null, revokes: null, payload: { overall: 'OBSERVED' }, ...over };
  const revoked = view.revoked ?? false;
  const expired = view.expired ?? (NOW >= entry.createdAt + entry.ttlMs);
  const liveness = view.liveness ?? (revoked ? 'REVOKED' : TERMINAL.has(entry.state) ? entry.state : expired ? 'EXPIRED' : entry.state === 'RUNNING' ? 'UNKNOWN' : entry.state);
  const retained = view.retained ?? !expired;
  if (!retained) entry.payload = null;
  return { entry, historical: true, retained, revoked, expired, liveness, authorizing: false };
}
const s1 = () => row();
const r1 = () => row({ id: 'run-a:0:tests', stage: 'tests', receiptId: 'receipt-tests', state: 'RUNNING', createdAt: NOW - 100, heartbeatAt: NOW - 100 });
const d1 = () => row({ id: 'run-a:0:tests-done', stage: 'tests', receiptId: 'receipt-tests-done', state: 'SUCCEEDED', createdAt: NOW - 90 });
function journal(entries, over = {}) {
  const recovery = { status: 'COMPLETE', recoveredIds: entries.map((r) => r.entry.id), rejectedLine: null, reason: null, authorizing: false, ...(over.recovery ?? {}) };
  return { projectId: 'project-a', observedAtMs: NOW, recovery, sha256: hex('d5'), bytes: 1381, entries, ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== 'recovery')) };
}
const J = () => journal([s1(), r1(), d1()]);
const JR = () => journal([s1(), r1()]);
const pins = () => [{ id: 'candidateFingerprint', sha256: hex('ab') }, { id: 'baselineFingerprint', sha256: hex('cd') }];
const profile = () => ({ id: 'nisi-json-structure-v1', version: 1, rulesetSha256: hex('ef') });
const consent = (over = {}) => ({ grantedAtMs: NOW - 5000, expiresAtMs: NOW + 60_000, revoked: false, scope: 'execute', ...over });
const E = (over = {}) => ({ projectId: 'project-a', runId: 'run-b', attempt: 0, sourcePins: pins(), profile: profile(), consent: consent(), ...over });
const ER = (over = {}) => E({ runId: 'run-a', attempt: 1, ...over });
const CK = (over = {}) => ({ schemaVersion: CK_SCHEMA, projectId: 'project-a', sourcePins: pins(), profile: profile(), consentGrantedAtMs: NOW - 5000, entryId: 'run-a:0:tests', takenAtMs: NOW - 50, completedStages: [{ stage: 'build', entryId: 'run-a:0:build', receiptId: 'receipt-build' }], ...over });
const input = (over = {}) => ({ now: NOW, expected: E(), journal: J(), checkpoint: null, ...over });
const item = (r) => ({ id: r.entry.id, runId: r.entry.runId, attempt: r.entry.attempt, stage: r.entry.stage, liveness: 'UNKNOWN', heartbeatAt: r.entry.heartbeatAt, createdAt: r.entry.createdAt });
const cells = (arr) => Object.fromEntries(CELLS.map((c, i) => [c, arr[i]]));
const NE = 'NOT_EVALUATED';
const refused = (value, reason, extra = {}) => {
  const out = decide(value);
  assert.equal(out.status, 'REFUSE_STALE', `${reason}: status`);
  assert.equal(out.reason, reason);
  if (extra.cells) assert.deepEqual(out.checks, cells(extra.cells));
  if ('interrupted' in extra) assert.deepEqual(out.interrupted, extra.interrupted);
  return out;
};
const invalid = (value) => { const out = decide(value); assert.equal(out.status, 'REFUSE_STALE'); assert.equal(out.reason, 'INVALID_INPUT'); assert.deepEqual(out.checks, cells([NE, NE, NE, NE, NE, NE, NE])); assert.equal(out.interrupted, null); return out; };
const deepFrozen = (v) => { if (v && typeof v === 'object') { assert.ok(Object.isFrozen(v)); for (const c of Object.values(v)) deepFrozen(c); } };

/* ------------------------------------------------------------------ T1 */
test('T1 restart baseline: fully settled journal, no checkpoint, fresh run id → SAFE_RESTART with the fixed shape', () => {
  const out = decide(input());
  assert.deepEqual(Object.keys(out), OUT_KEYS);
  assert.equal(out.schemaVersion, SCHEMA);
  assert.equal(out.status, 'SAFE_RESTART'); assert.equal(out.reason, null);
  assert.deepEqual(out.checks, cells(['OK', 'OK', 'OK', 'OK', 'NONE', 'OK', NE]));
  assert.deepEqual(out.interrupted, [item(r1())], 'd1 settles r1 but the filter still lists the interrupted row');
  assert.equal(out.journalSha256, hex('d5'));
  assert.equal(out.authorizing, false); assert.equal(out.executionGranted, false); assert.equal(out.resumeGranted, false);
  deepFrozen(out);
  assert.notEqual(decide(input()), out, 'fresh object per call');
});

/* ------------------------------------------------------------------ T3 */
test('T3 uncertain writes seal the decision before anything is echoed', () => {
  const inc = journal([s1(), r1()], { recovery: { status: 'INCOMPLETE', rejectedLine: 11, reason: 'MISSING_FOOTER' }, sha256: null, bytes: 1200 });
  refused(input({ journal: inc }), 'JOURNAL_SEALED', { cells: ['MISSING_FOOTER', NE, NE, NE, NE, NE, NE], interrupted: null });
  refused(input({ journal: inc, checkpoint: CK(), expected: ER() }), 'JOURNAL_SEALED', { cells: ['MISSING_FOOTER', NE, NE, NE, NE, NE, NE], interrupted: null });
  refused(input({ journal: journal([], { recovery: { status: 'COMMIT_UNCERTAIN', recoveredIds: [], rejectedLine: null, reason: null }, sha256: null, bytes: null }) }), 'JOURNAL_SEALED', { cells: ['COMMIT_UNCERTAIN', NE, NE, NE, NE, NE, NE], interrupted: null });
  refused(input({ journal: journal([s1()], { recovery: { status: 'INVALID', rejectedLine: 5, reason: 'RECORD' }, sha256: null, bytes: 900 }) }), 'JOURNAL_SEALED', { cells: ['RECORD', NE, NE, NE, NE, NE, NE], interrupted: null });
  refused(input({ journal: journal([s1()], { recovery: { status: 'INVALID', rejectedLine: 3, reason: 'FOOTER' }, sha256: null, bytes: null }) }), 'JOURNAL_SEALED', { cells: ['FOOTER', NE, NE, NE, NE, NE, NE], interrupted: null });
  refused(input({ journal: journal([], { projectId: null, recovery: { status: 'INVALID', recoveredIds: [], rejectedLine: 1, reason: 'HEADER' }, sha256: null, bytes: 5 }) }), 'JOURNAL_SEALED', { cells: ['HEADER', NE, NE, NE, NE, NE, NE], interrupted: null });
});

/* ------------------------------------------------------------------ T4 */
test('T4 foreign project is caught at the header, even when empty; rows under a foreign header are invalid input', () => {
  refused(input({ journal: journal([], { projectId: 'project-b', recovery: { status: 'NEW', recoveredIds: [] }, sha256: null, bytes: 0 }) }), 'PROJECT_MISMATCH', { cells: ['OK', 'PROJECT_MISMATCH', NE, NE, NE, NE, NE], interrupted: null });
  refused(input({ journal: journal([row({ projectId: 'project-b' })], { projectId: 'project-b' }) }), 'PROJECT_MISMATCH', { interrupted: null });
  invalid(input({ journal: journal([row({ projectId: 'project-b' })]) }));
});

/* ------------------------------------------------------------------ T5 */
test('T5 live heartbeat refuses; stale heartbeat needs a terminal sibling of the same run/attempt/candidate; revoked and expired rows are settled', () => {
  const r2 = row({ id: 'run-c:0:tests', runId: 'run-c', candidateId: 'cand-c', stage: 'tests', receiptId: null, state: 'RUNNING', createdAt: NOW - 5, heartbeatAt: NOW - 5 }, { liveness: 'RUNNING' });
  refused(input({ journal: journal([s1(), r1(), d1(), r2]) }), 'HEARTBEAT_LIVE', { cells: ['OK', 'OK', 'RUNNING', NE, NE, NE, NE], interrupted: [item(r1())] });
  const r2u = row({ ...r2.entry }, { liveness: 'UNKNOWN' });
  const r2done = row({ id: 'run-c:0:tests-done', runId: 'run-c', candidateId: 'cand-c', stage: 'tests', receiptId: 'receipt-c', state: 'SUCCEEDED', createdAt: NOW - 4 });
  refused(input({ journal: journal([s1(), r1(), r2u, r2done]) }), 'RUN_UNRECONCILED', { cells: ['OK', 'OK', 'UNKNOWN', NE, NE, NE, NE], interrupted: [item(r1()), item(r2u)] });
  const otherAttempt = row({ id: 'run-a:1:tests-done', attempt: 1, stage: 'tests', receiptId: 'receipt-x', state: 'SUCCEEDED', createdAt: NOW - 80 });
  refused(input({ journal: journal([s1(), r1(), otherAttempt]) }), 'RUN_UNRECONCILED');
  const otherCandidate = row({ id: 'run-a:0:tests-other', candidateId: 'cand-z', stage: 'tests', receiptId: 'receipt-y', state: 'FAILED', createdAt: NOW - 80 });
  refused(input({ journal: journal([s1(), r1(), otherCandidate]) }), 'RUN_UNRECONCILED');
  const failedSibling = row({ id: 'run-a:0:tests-failed', stage: 'tests', receiptId: null, state: 'FAILED', createdAt: NOW - 80 });
  assert.equal(decide(input({ journal: journal([s1(), r1(), failedSibling]) })).status, 'SAFE_RESTART', 'FAILED settles too');
  const cancelled = row({ id: 'run-a:0:tests-cancelled', stage: 'tests', receiptId: null, state: 'CANCELLED', createdAt: NOW - 80 });
  assert.equal(decide(input({ journal: journal([s1(), r1(), cancelled]) })).status, 'SAFE_RESTART', 'CANCELLED settles too');
  assert.equal(decide(input({ journal: J() })).status, 'SAFE_RESTART');
  const rv1 = row({ id: 'run-a:0:tests-rev', stage: 'tests', receiptId: null, state: 'REVOKED', revokes: 'run-a:0:tests', createdAt: NOW - 80 });
  const revokedR1 = row({ ...r1().entry }, { revoked: true, liveness: 'REVOKED' });
  let out = decide(input({ journal: journal([s1(), revokedR1, rv1]) }));
  assert.equal(out.status, 'SAFE_RESTART'); assert.deepEqual(out.interrupted, []);
  const expiredR1 = row({ ...r1().entry, createdAt: NOW - 200_000, heartbeatAt: NOW - 200_000, ttlMs: 100_000 }, { expired: true, retained: false, liveness: 'EXPIRED' });
  out = decide(input({ journal: journal([s1(), expiredR1]) }));
  assert.equal(out.status, 'SAFE_RESTART'); assert.deepEqual(out.interrupted, []);
});

/* ------------------------------------------------------------------ T6 */
test('T6 QUEUED rows never block a restart', () => {
  const q1 = row({ id: 'run-q:0:build', runId: 'run-q', candidateId: 'cand-q', receiptId: null, state: 'QUEUED', createdAt: NOW - 10 });
  const out = decide(input({ journal: journal([s1(), q1]) }));
  assert.equal(out.status, 'SAFE_RESTART'); assert.deepEqual(out.interrupted, []);
});

/* ------------------------------------------------------------------ T7 */
test('T7 consent is checked after history, on both paths, with the admission vocabulary', () => {
  const after = ['OK', 'OK', 'OK'];
  refused(input({ expected: E({ consent: null }) }), 'CONSENT_MISSING', { cells: [...after, 'CONSENT_MISSING', NE, NE, NE] });
  refused(input({ expected: E({ consent: undefined }) }), 'CONSENT_MISSING');
  refused(input({ expected: E({ consent: consent({ expiresAtMs: NOW }) }) }), 'CONSENT_EXPIRED', { cells: [...after, 'CONSENT_EXPIRED', NE, NE, NE] });
  assert.equal(decide(input({ expected: E({ consent: consent({ expiresAtMs: NOW + 1 }) }) })).status, 'SAFE_RESTART');
  refused(input({ expected: E({ consent: consent({ revoked: true }) }) }), 'CONSENT_REVOKED', { cells: [...after, 'CONSENT_REVOKED', NE, NE, NE] });
  refused(input({ expected: E({ consent: consent({ scope: 'review' }) }) }), 'CONSENT_SCOPE', { cells: [...after, 'CONSENT_SCOPE', NE, NE, NE] });
  refused(input({ expected: ER({ consent: consent({ revoked: true }) }), journal: JR(), checkpoint: CK() }), 'CONSENT_REVOKED', { cells: [...after, 'CONSENT_REVOKED', NE, NE, NE] });
  invalid(input({ expected: E({ consent: consent({ grantedAtMs: NOW + 1 }) }) }));
});

/* ------------------------------------------------------------------ T8 */
test('T8 fixed order: the first failing check is the reason and later cells stay NOT_EVALUATED', () => {
  const r2 = () => row({ id: 'run-c:0:tests', runId: 'run-c', candidateId: 'cand-c', stage: 'tests', receiptId: null, state: 'RUNNING', createdAt: NOW - 5, heartbeatAt: NOW - 5 }, { liveness: 'RUNNING' });
  const ck0 = { schemaVersion: 'nisi-interrupted-run-checkpoint/v0' };
  let j = journal([s1(), r1(), r2()], { projectId: 'project-b', recovery: { status: 'INCOMPLETE', rejectedLine: 9, reason: 'TRUNCATED' }, sha256: null, bytes: 700 });
  for (const r of j.entries) r.entry.projectId = 'project-b';
  const exp = ER({ consent: consent({ expiresAtMs: NOW - 1 }) });
  refused({ now: NOW, expected: exp, journal: j, checkpoint: ck0 }, 'JOURNAL_SEALED', { cells: ['TRUNCATED', NE, NE, NE, NE, NE, NE], interrupted: null });
  j = journal([s1(), r1(), r2()], { projectId: 'project-b' }); for (const r of j.entries) r.entry.projectId = 'project-b';
  refused({ now: NOW, expected: exp, journal: j, checkpoint: ck0 }, 'PROJECT_MISMATCH', { cells: ['OK', 'PROJECT_MISMATCH', NE, NE, NE, NE, NE], interrupted: null });
  j = journal([s1(), r1(), r2()]);
  refused({ now: NOW, expected: exp, journal: j, checkpoint: ck0 }, 'HEARTBEAT_LIVE', { cells: ['OK', 'OK', 'RUNNING', NE, NE, NE, NE], interrupted: [item(r1())] });
  refused({ now: NOW, expected: exp, journal: JR(), checkpoint: ck0 }, 'RUN_UNRECONCILED', { cells: ['OK', 'OK', 'UNKNOWN', NE, NE, NE, NE], interrupted: [item(r1())] }, 'a v0 checkpoint exempts nothing');
  refused({ now: NOW, expected: exp, journal: JR(), checkpoint: CK({ projectId: 'project-b' }) }, 'CONSENT_EXPIRED', { cells: ['OK', 'OK', 'OK', 'CONSENT_EXPIRED', NE, NE, NE] });
  refused({ now: NOW, expected: ER(), journal: JR(), checkpoint: CK({ projectId: 'project-b' }) }, 'CHECKPOINT_PROJECT', { cells: ['OK', 'OK', 'OK', 'OK', 'CHECKPOINT_PROJECT', NE, NE] });
  assert.equal(decide({ now: NOW, expected: ER(), journal: JR(), checkpoint: CK() }).status, 'RESUME_ELIGIBLE');
});

/* ------------------------------------------------------------------ T9 */
test('T9 resume baseline: a v1 checkpoint that cites the last interrupted row and confirms every PASS → RESUME_ELIGIBLE, not granted', () => {
  const out = decide({ now: NOW, expected: ER(), journal: JR(), checkpoint: CK() });
  assert.deepEqual(Object.keys(out), OUT_KEYS);
  assert.equal(out.status, 'RESUME_ELIGIBLE'); assert.equal(out.reason, null);
  assert.deepEqual(out.checks, cells(['OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'OK']));
  assert.deepEqual(out.interrupted, [item(r1())]);
  assert.equal(out.resumeGranted, false); assert.equal(out.executionGranted, false); assert.equal(out.authorizing, false);
  deepFrozen(out);
});

/* ------------------------------------------------------------------ T10 */
test('T10 checkpoint schema version is read first and pinned exactly', () => {
  refused(input({ checkpoint: { schemaVersion: 'nisi-interrupted-run-checkpoint/v2', anything: 1 } }), 'CHECKPOINT_SCHEMA', { cells: ['OK', 'OK', 'OK', 'OK', 'CHECKPOINT_SCHEMA', NE, NE], interrupted: [item(r1())] });
  refused(input({ checkpoint: { schemaVersion: 'nisi-interrupted-run-checkpoint/v1 ' } }), 'CHECKPOINT_SCHEMA');
  refused(input({ checkpoint: { schemaVersion: 'nisi-interrupted-run-checkpoint/v0' } }), 'CHECKPOINT_SCHEMA');
  invalid(input({ checkpoint: { schemaVersion: 42 } }));
  invalid(input({ checkpoint: {} }));
  invalid(input({ checkpoint: CK({ extra: 1 }) }));
});

/* ------------------------------------------------------------------ T11 */
test('T11 checkpoint identity: one drifted pin of N, reordered or missing pins, profile, project and consent grant all refuse', () => {
  const base = () => ({ now: NOW, expected: ER(), journal: JR() });
  const p = pins(); p[1].sha256 = hex('ff');
  refused({ ...base(), checkpoint: CK({ sourcePins: p }) }, 'SOURCE_DIGEST_MISMATCH', { cells: ['OK', 'OK', 'OK', 'OK', 'SOURCE_DIGEST_MISMATCH', NE, NE] });
  refused({ ...base(), checkpoint: CK({ sourcePins: pins().reverse() }) }, 'SOURCE_DIGEST_MISMATCH');
  refused({ ...base(), checkpoint: CK({ sourcePins: [pins()[0]] }) }, 'SOURCE_DIGEST_MISMATCH');
  refused({ ...base(), checkpoint: CK({ profile: { ...profile(), rulesetSha256: hex('00') } }) }, 'CHECKPOINT_PROFILE');
  refused({ ...base(), checkpoint: CK({ profile: { ...profile(), version: 2 } }) }, 'CHECKPOINT_PROFILE');
  refused({ ...base(), checkpoint: CK({ projectId: 'project-b' }) }, 'CHECKPOINT_PROJECT');
  refused({ ...base(), checkpoint: CK({ consentGrantedAtMs: NOW - 4999 }) }, 'CHECKPOINT_CONSENT');
  refused({ ...base(), checkpoint: CK({ takenAtMs: NOW - 6000 }) }, 'CHECKPOINT_CONSENT', {}, 'taken before the grant');
});

/* ------------------------------------------------------------------ T12 */
test('T12 a stored report is not a checkpoint: only an interrupted row can be cited', () => {
  refused(input({ expected: ER(), checkpoint: CK({ entryId: 'run-a:0:build' }) }), 'CHECKPOINT_TARGET', { cells: ['OK', 'OK', 'OK', 'OK', 'SUCCEEDED', NE, NE] });
  const q1 = row({ id: 'run-q:0:build', runId: 'run-q', candidateId: 'cand-q', receiptId: null, state: 'QUEUED', createdAt: NOW - 10 });
  refused({ now: NOW, expected: ER(), journal: journal([s1(), q1]), checkpoint: CK({ entryId: 'run-q:0:build', completedStages: [] }) }, 'CHECKPOINT_TARGET', { cells: ['OK', 'OK', 'OK', 'OK', 'QUEUED', NE, NE] });
  const expiredR1 = row({ ...r1().entry, createdAt: NOW - 200_000, heartbeatAt: NOW - 200_000, ttlMs: 100_000 }, { expired: true, retained: false, liveness: 'EXPIRED' });
  refused({ now: NOW, expected: ER(), journal: journal([s1(), expiredR1]), checkpoint: CK() }, 'CHECKPOINT_TARGET', { cells: ['OK', 'OK', 'OK', 'OK', 'EXPIRED', NE, NE] });
  refused({ now: NOW, expected: ER(), journal: J(), checkpoint: CK({ entryId: 'run-a:0:nope' }) }, 'CHECKPOINT_TARGET', { cells: ['OK', 'OK', 'OK', 'OK', 'NOT_FOUND', NE, NE] });
  refused({ now: NOW, expected: ER(), journal: journal([], { recovery: { status: 'NEW', recoveredIds: [] }, sha256: null, bytes: 0 }), checkpoint: CK() }, 'CHECKPOINT_TARGET', { cells: ['OK', 'OK', 'OK', 'OK', 'NOT_FOUND', NE, NE], interrupted: [] });
});

/* ------------------------------------------------------------------ T13 */
test('T13 supersession and staleness: the cited row must be the newest record and the checkpoint no older than it', () => {
  const later = row({ id: 'run-z:0:x', runId: 'run-z', candidateId: 'cand-z', stage: 'x', receiptId: 'receipt-z', state: 'SUCCEEDED', createdAt: NOW - 20 });
  refused({ now: NOW, expected: ER(), journal: journal([s1(), r1(), later]), checkpoint: CK() }, 'CHECKPOINT_SUPERSEDED', { cells: ['OK', 'OK', 'OK', 'OK', 'SUCCEEDED', NE, NE] });
  const r0 = row({ id: 'run-z:0:y', runId: 'run-z', candidateId: 'cand-z', stage: 'y', receiptId: null, state: 'RUNNING', createdAt: NOW - 60_000, heartbeatAt: NOW - 60_000 });
  refused({ now: NOW, expected: ER(), journal: journal([r0, s1(), r1()]), checkpoint: CK() }, 'RUN_UNRECONCILED', { interrupted: [item(r0), item(r1())] }, 'the exemption covers only the cited row');
  const r0done = row({ id: 'run-z:0:y-done', runId: 'run-z', candidateId: 'cand-z', stage: 'y', receiptId: 'receipt-zz', state: 'SUCCEEDED', createdAt: NOW - 59_000 });
  assert.equal(decide({ now: NOW, expected: ER(), journal: journal([r0, r0done, s1(), r1()]), checkpoint: CK() }).status, 'RESUME_ELIGIBLE');
  refused({ now: NOW, expected: ER(), journal: JR(), checkpoint: CK({ takenAtMs: NOW - 101 }) }, 'CHECKPOINT_STALE', { cells: ['OK', 'OK', 'OK', 'OK', 'CHECKPOINT_STALE', NE, NE] });
  assert.equal(decide({ now: NOW, expected: ER(), journal: JR(), checkpoint: CK({ takenAtMs: NOW - 100 }) }).status, 'RESUME_ELIGIBLE');
});

/* ------------------------------------------------------------------ T14 */
test('T14 identity: restart needs a fresh run id; resume needs the cited run id and a strictly newer, unused attempt', () => {
  refused(input({ expected: E({ runId: 'run-a' }) }), 'RUN_ID_REUSED', { cells: ['OK', 'OK', 'OK', 'OK', 'NONE', 'RUN_ID_REUSED', NE] });
  refused({ now: NOW, expected: ER({ runId: 'run-b' }), journal: JR(), checkpoint: CK() }, 'RUN_ID_MISMATCH', { cells: ['OK', 'OK', 'OK', 'OK', 'OK', 'RUN_ID_MISMATCH', NE] });
  refused({ now: NOW, expected: ER({ attempt: 0 }), journal: JR(), checkpoint: CK() }, 'ATTEMPT_REUSED', { cells: ['OK', 'OK', 'OK', 'OK', 'OK', 'ATTEMPT_REUSED', NE] });
  const a1 = row({ id: 'run-a:1:x', attempt: 1, stage: 'x', receiptId: null, state: 'FAILED', createdAt: NOW - 40_000 });
  refused({ now: NOW, expected: ER({ attempt: 1 }), journal: journal([s1(), a1, r1()]), checkpoint: CK() }, 'ATTEMPT_REUSED');
  assert.equal(decide({ now: NOW, expected: ER({ attempt: 2 }), journal: journal([s1(), a1, r1()]), checkpoint: CK() }).status, 'RESUME_ELIGIBLE');
});

/* ------------------------------------------------------------------ T15 */
test('T15 every claimed PASS must be a confirmed, unrevoked, unexpired SUCCEEDED row of that run created before the checkpoint; no PASS may go unclaimed', () => {
  const base = (rows, ck = CK()) => ({ now: NOW, expected: ER(), journal: journal(rows), checkpoint: ck });
  refused(base([s1(), r1()], CK({ completedStages: [{ stage: 'build', entryId: 'run-a:0:build', receiptId: 'receipt-other' }] })), 'PASS_UNCONFIRMED', { cells: ['OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'PASS_UNCONFIRMED'] });
  refused(base([s1(), r1()], CK({ completedStages: [{ stage: 'build', entryId: 'run-a:0:buildX', receiptId: 'receipt-build' }] })), 'PASS_UNCONFIRMED');
  refused(base([row({ candidateId: 'cand-b' }), r1()]), 'PASS_UNCONFIRMED');
  refused(base([s1(), r1()], CK({ completedStages: [{ stage: 'lint', entryId: 'run-a:0:build', receiptId: 'receipt-build' }] })), 'PASS_UNCONFIRMED', {}, 'stage must match');
  const rev = row({ id: 'run-a:0:build-rev', stage: 'build', receiptId: null, state: 'REVOKED', revokes: 'run-a:0:build', createdAt: NOW - 45_000 });
  refused(base([row({}, { revoked: true, liveness: 'REVOKED' }), rev, r1()]), 'STALE_PASS', { cells: ['OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'STALE_PASS'] });
  refused(base([row({ createdAt: NOW - 200_000, ttlMs: 100_000 }, { expired: true, retained: false, liveness: 'SUCCEEDED' }), r1()]), 'STALE_PASS', {}, 'expired flag wins even if liveness says SUCCEEDED');
  refused(base([row({ state: 'FAILED' }), r1()]), 'STALE_PASS');
  refused(base([row({ createdAt: NOW - 40 }), r1()]), 'CHECKPOINT_BEFORE_PASS', { cells: ['OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'CHECKPOINT_BEFORE_PASS'] });
  const lint = row({ id: 'run-a:0:lint', stage: 'lint', receiptId: 'receipt-lint', state: 'SUCCEEDED', createdAt: NOW - 48_000 });
  refused(base([s1(), lint, r1()]), 'UNCLAIMED_PASS', { cells: ['OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'UNCLAIMED_PASS'] });
  refused(base([s1(), r1()], CK({ completedStages: [{ stage: 'build', entryId: 'run-a:0:build', receiptId: 'receipt-build' }, { stage: 'tests', entryId: 'run-a:0:tests', receiptId: 'receipt-tests' }] })), 'STAGE_ALREADY_SUCCEEDED', { cells: ['OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'STAGE_ALREADY_SUCCEEDED'] });
  refused(base([s1(), r1()], CK({ completedStages: [] })), 'UNCLAIMED_PASS');
  const otherRunPass = row({ id: 'run-k:0:build', runId: 'run-k', candidateId: 'cand-k', receiptId: 'receipt-k', createdAt: NOW - 49_000 });
  assert.equal(decide(base([otherRunPass, s1(), r1()])).status, 'RESUME_ELIGIBLE', 'a PASS of another run is not a claim of this one');
});

/* ------------------------------------------------------------------ T16 */
test('T16 no silent downgrade: a refused checkpoint never yields SAFE_RESTART, and the restart verdict must be asked for explicitly', () => {
  for (const ck of [CK({ projectId: 'project-b' }), CK({ takenAtMs: NOW - 101 }), CK({ entryId: 'run-a:0:build' }), { schemaVersion: 'nisi-interrupted-run-checkpoint/v2' }]) {
    const out = decide({ now: NOW, expected: ER(), journal: JR(), checkpoint: ck });
    assert.equal(out.status, 'REFUSE_STALE'); assert.notEqual(out.interrupted, null);
  }
  assert.equal(decide({ now: NOW, expected: E(), journal: JR(), checkpoint: null }).reason, 'RUN_UNRECONCILED');
  assert.equal(decide({ now: NOW, expected: E(), journal: J(), checkpoint: null }).status, 'SAFE_RESTART');
});

/* ------------------------------------------------------------------ T17 */
test('T17 payload is opaque: any data value leaves the decision unchanged; an accessor is invalid input', () => {
  const ref = decide(input());
  for (const payload of [null, { sourcePins: pins(), overall: 'PASS' }, 'x'.repeat(1_000_000)]) {
    const j = J(); j.entries[0].entry.payload = payload; j.entries[2].entry.payload = payload;
    assert.deepEqual(decide(input({ journal: j })), ref);
  }
  const refResume = decide({ now: NOW, expected: ER(), journal: JR(), checkpoint: CK() });
  const jr = JR(); jr.entries[0].entry.payload = { overall: 'PASS', receiptId: 'receipt-other' };
  assert.deepEqual(decide({ now: NOW, expected: ER(), journal: jr, checkpoint: CK() }), refResume);
  const bad = J(); Object.defineProperty(bad.entries[0].entry, 'payload', { get() { throw new Error('read'); }, enumerable: true, configurable: true });
  invalid(input({ journal: bad }));
});

/* ------------------------------------------------------------------ T18 */
test('T18 invalid-input battery: every shape or coherence violation is INVALID_INPUT with nothing evaluated', () => {
  const sym = Symbol('x');
  const cases = [
    undefined, null, 'x', [], {}, input({ extra: 1 }), (() => { const v = input(); v[sym] = 1; return v; })(),
    (() => { const v = input(); Object.defineProperty(v, 'hidden', { value: 1, enumerable: false }); return v; })(),
    (() => { const v = input(); Object.defineProperty(v, 'expected', { get: () => E(), enumerable: true }); return v; })(),
    input({ now: -0 }), input({ now: 1.5 }), input({ now: -1 }), input({ now: '1' }),
    input({ journal: journal([s1(), r1(), d1()], { observedAtMs: NOW + 1 }) }), input({ journal: journal([s1(), r1(), d1()], { observedAtMs: NOW - 1 }) }),
    (() => { const j = J(); j.recovery.recoveredIds = [...j.recovery.recoveredIds].reverse(); return input({ journal: j }); })(),
    input({ journal: journal([s1(), s1()]) }),
    (() => { const j = J(); j.entries[0].historical = false; return input({ journal: j }); })(),
    (() => { const j = J(); j.entries[0].authorizing = true; return input({ journal: j }); })(),
    (() => { const j = J(); delete j.entries[0].retained; return input({ journal: j }); })(),
    (() => { const j = J(); j.entries[0].extra = 1; return input({ journal: j }); })(),
    (() => { const j = J(); delete j.entries[0].entry.payload; return input({ journal: j }); })(),
    (() => { const j = J(); j.entries[0].entry.extra = 1; return input({ journal: j }); })(),
    (() => { const j = J(); j.entries[1].entry.heartbeatAt = j.entries[1].entry.createdAt + 1; return input({ journal: j }); })(),
    (() => { const j = J(); j.entries[0].entry.createdAt = NOW + 1; return input({ journal: j }); })(),
    (() => { const j = J(); j.entries[0].entry.ttlMs = 0; return input({ journal: j }); })(),
    (() => { const j = J(); j.entries[0].entry.state = 'INTERRUPTED'; return input({ journal: j }); })(),
    (() => { const j = J(); j.entries[1].liveness = 'SEALED'; return input({ journal: j }); })(),
    (() => { const j = J(); j.entries[0].expired = true; j.entries[0].liveness = 'EXPIRED'; return input({ journal: j }); })(),
    (() => { const j = J(); j.entries[0].revoked = true; j.entries[0].liveness = 'REVOKED'; return input({ journal: j }); })(),
    (() => { const j = J(); j.entries[0].entry.revokes = 'run-a:0:tests'; return input({ journal: j }); })(),
    (() => { const j = J(); j.entries[0].retained = false; return input({ journal: j }); })(),
    (() => { const j = J(); j.sha256 = null; return input({ journal: j }); })(),
    input({ journal: journal([], { recovery: { status: 'NEW', recoveredIds: [] }, sha256: null, bytes: 5 }) }),
    input({ journal: journal([s1()], { recovery: { status: 'INCOMPLETE', rejectedLine: null, reason: 'TRUNCATED' }, sha256: null, bytes: 1 }) }),
    input({ journal: journal([s1()], { recovery: { status: 'COMPLETE', rejectedLine: 2, reason: 'RECORD' } }) }),
    (() => { const j = J(); j.projectId = null; return input({ journal: j }); })(),
    (() => { const j = J(); j.recovery.authorizing = true; return input({ journal: j }); })(),
    (() => { const j = J(); j.recovery.status = 'OPEN'; return input({ journal: j }); })(),
    input({ expected: E({ sourcePins: [] }) }), input({ expected: E({ sourcePins: Array.from({ length: 17 }, (_, i) => ({ id: `pin${i}`, sha256: hex('ab') })) }) }),
    input({ expected: E({ sourcePins: [pins()[0], pins()[0]] }) }), input({ expected: E({ sourcePins: [{ id: 'x', sha256: 'AB'.repeat(32) }] }) }),
    input({ expected: E({ profile: { ...profile(), version: 0 } }) }), input({ expected: E({ profile: { ...profile(), version: 1_000_001 } }) }),
    input({ expected: E({ projectId: '' }) }), input({ expected: E({ runId: 'a'.repeat(129) }) }), input({ expected: E({ attempt: -1 }) }),
    input({ expected: E({ consent: { grantedAtMs: NOW - 1, expiresAtMs: NOW + 1, revoked: false } }) }),
    input({ checkpoint: CK({ takenAtMs: NOW + 1 }) }),
    input({ checkpoint: CK({ completedStages: Array.from({ length: 65 }, (_, i) => ({ stage: `s${i}`, entryId: `e${i}`, receiptId: `r${i}` })) }) }),
    input({ checkpoint: CK({ completedStages: [{ stage: 'build', entryId: 'a', receiptId: 'r' }, { stage: 'build', entryId: 'b', receiptId: 'r' }] }) }),
    input({ checkpoint: CK({ completedStages: [{ stage: 'a', entryId: 'same', receiptId: 'r' }, { stage: 'b', entryId: 'same', receiptId: 'r' }] }) }),
    input({ checkpoint: CK({ entryId: 7 }) }), input({ checkpoint: CK({ sourcePins: [] }) }),
    input({ checkpoint: 'ck' }), input({ checkpoint: [] }),
    (() => { const v = input(); v.journal = Object.create({ inherited: 1 }, Object.getOwnPropertyDescriptors(v.journal)); return v; })(),
  ];
  for (const [i, c] of cases.entries()) { try { invalid(c); } catch (e) { e.message = `case ${i}: ${e.message}`; throw e; } }
  // a null-prototype record is still a plain data record
  const np = Object.assign(Object.create(null), input());
  assert.equal(decide(np).status, 'SAFE_RESTART');
});

/* ------------------------------------------------------------------ T19 */
test('T19 purity and closed vocabulary: inputs untouched, no imports or clock in the source, exactly one export, statuses and reasons closed', async () => {
  const frozen = (v) => { if (v && typeof v === 'object') { Object.freeze(v); for (const c of Object.values(v)) frozen(c); } return v; };
  const a = frozen(input()), b = frozen(input());
  const before = JSON.stringify(a);
  const x = decide(a), y = decide(b);
  assert.deepEqual(x, y); assert.notEqual(x, y); assert.equal(JSON.stringify(a), before);
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/interrupted-run-decision-v1.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bimport\b/);
  assert.doesNotMatch(source, /\b(?:require|process|fetch|setTimeout|setInterval|Date|performance|globalThis)\b|Math\s*\.\s*random\b/);
  const ns = await import('../src/interrupted-run-decision-v1.mjs');
  assert.deepEqual(Object.keys(ns), ['decideInterruptedRunV1']);
  const r2 = row({ id: 'run-c:0:tests', runId: 'run-c', candidateId: 'cand-c', stage: 'tests', receiptId: null, state: 'RUNNING', createdAt: NOW - 5, heartbeatAt: NOW - 5 }, { liveness: 'RUNNING' });
  const adverse = [undefined, null, 1, 'x', input({ now: 0 }), input({ journal: JR() }), input({ journal: journal([s1(), r1(), d1(), r2]) }), input({ expected: E({ consent: null }) }), input({ checkpoint: {} }),
    ...[CK({ projectId: 'project-b' }), CK({ takenAtMs: NOW - 101 }), CK({ entryId: 'nope' }), CK({ completedStages: [] }), CK({ sourcePins: [pins()[0]] })].map((ck) => ({ now: NOW, expected: ER(), journal: JR(), checkpoint: ck })),
    input({ expected: E({ runId: 'run-a' }) }), { now: NOW, expected: ER({ runId: 'run-b' }), journal: JR(), checkpoint: CK() }, input(), { now: NOW, expected: ER(), journal: JR(), checkpoint: CK() },
    ...Array.from({ length: 45 }, (_, i) => { const v = input(); v.now = NOW + i + 1; return v; })];
  assert.ok(adverse.length >= 60);
  for (const v of adverse) {
    const out = decide(v);
    assert.ok(['SAFE_RESTART', 'REFUSE_STALE', 'RESUME_ELIGIBLE'].includes(out.status));
    assert.equal(out.reason === null, out.status !== 'REFUSE_STALE');
    if (out.reason !== null) assert.ok(REASONS.includes(out.reason), out.reason);
    assert.equal(out.authorizing, false); assert.equal(out.executionGranted, false); assert.equal(out.resumeGranted, false);
    assert.equal(out.schemaVersion, SCHEMA);
  }
});

/* ------------------------------------------------------------------ review additions (wf_f1ab9875-020) */
const b2 = () => row({ id: 'run-a:2:build', attempt: 2 });
const t2 = () => row({ id: 'run-a:2:tests', attempt: 2, stage: 'tests', receiptId: 'receipt-tests', state: 'RUNNING', createdAt: NOW - 100, heartbeatAt: NOW - 100 });
const ck2 = () => CK({ entryId: 'run-a:2:tests', completedStages: [{ stage: 'build', entryId: 'run-a:2:build', receiptId: 'receipt-build' }] });
const otherProfile = () => { const p = profile(); p.id = 'nisi-other-profile-v1'; return p; };

test('T5+ sibling settlement: only a later SUCCEEDED/FAILED/CANCELLED row of the same run/attempt/candidate settles; QUEUED, UNKNOWN and REVOKED siblings do not; the stage is irrelevant', () => {
  refused({ now: NOW, expected: E(), journal: journal([s1(), r1(), row({ id: 'run-a:0:q', stage: 'q', receiptId: null, state: 'QUEUED', createdAt: NOW - 80 })]), checkpoint: null }, 'RUN_UNRECONCILED');
  refused({ now: NOW, expected: ER(), journal: journal([s1(), r1(), row({ id: 'run-a:0:tests-b', stage: 'tests', receiptId: 'rb', state: 'RUNNING', createdAt: NOW - 80, heartbeatAt: NOW - 80 })]), checkpoint: CK({ entryId: 'run-a:0:tests-b' }) }, 'RUN_UNRECONCILED');
  refused({ now: NOW, expected: E(), journal: journal([row({}, { revoked: true, liveness: 'REVOKED' }), r1(), row({ id: 'run-a:0:build-rev', stage: 'build', receiptId: null, state: 'REVOKED', revokes: 'run-a:0:build', createdAt: NOW - 80 })]), checkpoint: null }, 'RUN_UNRECONCILED');
  // A later terminal row of ANY stage proves the run progressed past the crashed row.
  assert.equal(decide({ now: NOW, expected: E(), journal: journal([s1(), r1(), row({ id: 'run-a:0:lint', stage: 'lint', receiptId: 'receipt-lint', state: 'SUCCEEDED', createdAt: NOW - 80 })]), checkpoint: null }).status, 'SAFE_RESTART');
});

test('T15+ claim identity is runId + attempt + candidateId; the unclaimed scan covers every candidate of the cited run/attempt; claims are checked one at a time in order', () => {
  refused({ now: NOW, expected: ER(), journal: journal([row({ id: 'run-k:0:build', runId: 'run-k' }), r1()]), checkpoint: CK({ completedStages: [{ stage: 'build', entryId: 'run-k:0:build', receiptId: 'receipt-build' }] }) }, 'PASS_UNCONFIRMED');
  refused({ now: NOW, expected: ER({ attempt: 2 }), journal: journal([row({ id: 'run-a:1:build', attempt: 1 }), r1()]), checkpoint: CK({ completedStages: [{ stage: 'build', entryId: 'run-a:1:build', receiptId: 'receipt-build' }] }) }, 'PASS_UNCONFIRMED');
  refused({ now: NOW, expected: ER(), journal: journal([s1(), row({ id: 'run-a:0:lint', candidateId: 'cand-other', stage: 'lint', receiptId: 'rl', state: 'SUCCEEDED', createdAt: NOW - 48_000 }), r1()]), checkpoint: CK() }, 'UNCLAIMED_PASS');
  const rev = row({ id: 'run-a:0:build-rev', stage: 'build', receiptId: null, state: 'REVOKED', revokes: 'run-a:0:build', createdAt: NOW - 45_000 });
  refused({ now: NOW, expected: ER(), journal: journal([row({}, { revoked: true, liveness: 'REVOKED' }), rev, r1()]), checkpoint: CK({ completedStages: [{ stage: 'build', entryId: 'run-a:0:build', receiptId: 'receipt-build' }, { stage: 'x', entryId: 'run-a:0:nope', receiptId: 'r' }] }) }, 'STALE_PASS', {}, 'first claim decides before the second is looked at');
});

test('T14+ restart identity: any persisted row with the run id refuses, whatever its attempt or liveness; a revoked tail still supersedes a checkpoint', () => {
  refused({ now: NOW, expected: E({ runId: 'run-a', attempt: 5 }), journal: J(), checkpoint: null }, 'RUN_ID_REUSED');
  refused({ now: NOW, expected: E({ runId: 'run-a' }), journal: journal([row({ createdAt: NOW - 200_000 })]), checkpoint: null }, 'RUN_ID_REUSED');
  const tail = row({ id: 'run-a:0:build-rev', stage: 'build', receiptId: null, state: 'REVOKED', revokes: 'run-a:0:build', createdAt: NOW - 40 });
  refused({ now: NOW, expected: ER(), journal: journal([row({}, { revoked: true, liveness: 'REVOKED' }), r1(), tail]), checkpoint: CK({ completedStages: [] }) }, 'CHECKPOINT_SUPERSEDED', { cells: ['OK', 'OK', 'OK', 'OK', 'REVOKED', NE, NE] });
});

test('T11+/T14+ checkpoint binding: profile.id drift refuses; a resume attempt not newer than the cited attempt refuses', () => {
  refused({ now: NOW, expected: ER(), journal: JR(), checkpoint: CK({ profile: otherProfile() }) }, 'CHECKPOINT_PROFILE');
  refused({ now: NOW, expected: ER({ attempt: 1 }), journal: journal([b2(), t2()]), checkpoint: ck2() }, 'ATTEMPT_REUSED');
  refused({ now: NOW, expected: ER({ attempt: 2 }), journal: journal([b2(), t2()]), checkpoint: ck2() }, 'ATTEMPT_REUSED');
  assert.equal(decide({ now: NOW, expected: ER({ attempt: 3 }), journal: journal([b2(), t2()]), checkpoint: ck2() }).status, 'RESUME_ELIGIBLE');
});

test('T18+ row coherence is pinned in both directions, one invariant at a time', () => {
  invalid({ now: NOW, expected: ER(), journal: journal([s1(), row({ id: 'run-a:0:build-rev', stage: 'build', receiptId: null, state: 'REVOKED', revokes: 'run-a:0:build', createdAt: NOW - 49_000 }), r1()]), checkpoint: CK() });
  invalid({ now: NOW, expected: ER(), journal: journal([row({ createdAt: NOW - 200_000 }, { expired: false, retained: true, liveness: 'SUCCEEDED' }), r1()]), checkpoint: CK() });
  invalid(input({ journal: journal([row({ state: 'FAILED' }, { liveness: 'SUCCEEDED' })]) }));
  invalid(input({ journal: journal([row({ id: 'run-a:0:x', state: 'REVOKED', revokes: null, receiptId: null })]) }));
  invalid(input({ journal: journal([row({ id: 'run-a:0:x', state: 'REVOKED', revokes: 'run-a:0:absent', receiptId: null })]) }));
  invalid((() => { const j = J(); j.recovery.recoveredIds = [...j.recovery.recoveredIds, 'ghost']; return input({ journal: j }); })());
  invalid(input({ journal: journal([s1()], { recovery: { status: 'INCOMPLETE', rejectedLine: 2, reason: 'TRUNCATED' }, sha256: hex('d5'), bytes: 10 }) }));
  invalid(input({ journal: journal([s1()], { recovery: { status: 'NEW' }, sha256: null, bytes: 0 }) }));
  invalid(input({ journal: journal([], { recovery: { status: 'INVALID', recoveredIds: [], rejectedLine: 1, reason: 'HEADER' }, sha256: null, bytes: 5 }) }));
  invalid(input({ journal: journal([s1()], { bytes: 0 }) }));
  invalid(input({ journal: journal([], { recovery: { status: 'COMMIT_UNCERTAIN', recoveredIds: [], rejectedLine: 3, reason: null }, sha256: null, bytes: null }) }));
  invalid((() => { const rows = Array.from({ length: 65537 }, (_, i) => row({ id: `run-${i}:0:b`, runId: `run-${i}`, candidateId: `c${i}` })); return { now: NOW, expected: E(), journal: journal(rows), checkpoint: null }; })());
});

test('T19+ never throws on hostile objects: revoked proxies, throwing traps, descriptor tricks', () => {
  const revokedProxy = (() => { const p = Proxy.revocable({}, {}); p.revoke(); return p.proxy; })();
  const hostile = [revokedProxy, new Proxy({}, { getPrototypeOf() { throw new Error('trap'); } }),
    { now: NOW, expected: E(), journal: { ...journal([]), entries: new Proxy([], { ownKeys() { throw new TypeError('x'); } }) }, checkpoint: null },
    { now: NOW, expected: E(), journal: J(), checkpoint: new Proxy({}, { get() { throw new Error('get'); } }) },
    (() => { const v = input(); Object.defineProperty(v.journal.entries, '0', { get() { throw new Error('index'); }, enumerable: true, configurable: true }); return v; })()];
  for (const v of hostile) { let o; assert.doesNotThrow(() => { o = decide(v); }); assert.equal(o.reason, 'INVALID_INPUT'); assert.equal(o.interrupted, null); }
});
