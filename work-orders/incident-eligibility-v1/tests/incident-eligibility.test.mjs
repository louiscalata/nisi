// Oracle for decideIncidentEligibilityV1 (README §Acceptance tests). Written
// from the contract before the implementation. The baseline query, plan and
// projectId come from the REAL producers (paged incident host fixture, memfs
// journal, journal-owner-v2 capture, queryRepositoryIncidentV1,
// host.nativeIncidentSourcePlan); every refusal is then either a real lifecycle
// path or a single-field forgery of that baseline.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { decideIncidentEligibilityV1 as decide } from '../src/incident-eligibility-v1.mjs';
import { createPagedIncidentHostFixture } from '../../../tests/helpers/incident-review-fixture.mjs';
import { queryRepositoryIncidentV1 } from '../../../history/repository-incident-capture-v1.mjs';
import { openJournalOwner, recordJournalObservation } from '../../../history/journal-owner-v2.mjs';
import { nativeIncidentSourceRefusalV1 } from '../../../hosts/repository/native-incident-source-v1.mjs';
import { memfs } from '../../../tests/journal-owner-v2.memfs.mjs';

const SCHEMA = 'nisi-incident-eligibility/v1';
const CELLS = ['journal', 'capture', 'observation', 'project', 'row', 'source', 'identity'];
const OUT_KEYS = ['schemaVersion', 'status', 'reason', 'checks', 'entryId', 'journalSha256', 'sourcePlanDigest', 'authorizing', 'admitted', 'learningEnabled'];
const REASONS = ['INVALID_INPUT', 'JOURNAL_UNAVAILABLE', 'JOURNAL_NOT_OPEN', 'COMMIT_UNCERTAIN', 'INVALID_OBSERVATION', 'MISSING', 'REVOKED', 'EXPIRED', 'NOT_RETAINED', 'PROJECT_MISMATCH', 'UNSUPPORTED_STAGE', 'ROW_NOT_FAILURE', 'INVALID_PREVIEW', 'PREVIEW_MISMATCH', 'ROW_MISSING', 'SOURCE_MISMATCH', 'INVALID_EVIDENCE', 'ARTIFACT_LIMIT', 'HOST_NOT_SETTLED', 'ROW_MISMATCH', 'CONFLICT'];
const PLAN_REFUSALS = ['INVALID_INPUT', 'INVALID_PREVIEW', 'PREVIEW_MISMATCH', 'ROW_MISSING', 'ROW_NOT_FAILURE', 'UNSUPPORTED_STAGE', 'SOURCE_MISMATCH', 'INVALID_EVIDENCE', 'ARTIFACT_LIMIT', 'HOST_NOT_SETTLED'];
const NE = 'NOT_EVALUATED';
const PATH = '/j/incidents.jsonl';
const hex = (c) => c.repeat(64);
const clone = (v) => JSON.parse(JSON.stringify(v));
const cells = (arr) => Object.fromEntries(CELLS.map((c, i) => [c, arr[i]]));
const deepFrozen = (v) => { if (v && typeof v === 'object') { assert.ok(Object.isFrozen(v)); for (const c of Object.values(v)) deepFrozen(c); } };

// Real-producer baseline, built once.
const B = {};
before(async () => {
  const { host, preview, eligible } = await createPagedIncidentHostFixture();
  B.host = host; B.preview = preview; B.eligible = eligible;
  B.row = eligible[0];
  B.projectId = 'task:' + B.row.binding.taskFingerprint;
  B.config = { projectId: B.projectId, maxEntries: 32, heartbeatTtlMs: 30000, redactPaths: [] };
  B.declFor = (pv, r, id) => ({ schemaVersion: 'nisi-repository-incident-declaration/v1', declarationId: id, projectId: B.projectId, rowId: r.rowId, rowFingerprint: r.fingerprint, previewSha256: pv.sha256, issuedAt: 100, expiresAt: 1000, createdAt: 100, retentionMs: 10000, consentClass: 'WRITTEN_DECLARATION', destination: 'LOCAL_INCIDENT_OBSERVATION_ONLY', rawContentPersisted: false, networkEgress: false, learningInfluence: false });
  B.decl = (r, id) => B.declFor(preview, r, id);
  B.m = memfs();
  const owner = openJournalOwner({ path: PATH, fs: B.m.fs, config: B.config, now: 100 }).owner;
  const permit = host.createIncidentPermit({ owner, declaration: B.decl(B.row, 'oracle.elig.a'), clock: () => 100 });
  B.stored = host.captureIncident({ permit: permit.permit });
  assert.equal(B.stored.status, 'STORED');
  B.q = (over = {}) => queryRepositoryIncidentV1({ path: PATH, fs: B.m.fs, config: B.config, entryId: B.stored.entryId, now: 100, ...over });
  B.query = B.q();
  assert.equal(B.query.status, 'AVAILABLE_OBSERVATION');
  B.plan = host.nativeIncidentSourcePlan({ rowId: B.row.rowId });
  assert.equal(B.plan.status, 'SOURCE_BOUND');
});
const inp = (over = {}) => ({ projectId: B.projectId, query: B.query, plan: B.plan, revoked: false, capture: { status: 'STORED', reason: null }, ...over });
// Forge a clone of the baseline query with one edit applied by the callback.
const fq = (edit) => { const q = clone(B.query); edit(q); return q; };
const fp = (edit) => { const p = clone(B.plan); edit(p); return p; };
const expect = (value, status, reason, extra = {}) => {
  const out = decide(value);
  assert.equal(out.status, status, `status; got ${out.status}/${out.reason} checks ${JSON.stringify(out.checks)}`);
  assert.equal(out.reason, reason);
  if (extra.cells) assert.deepEqual(out.checks, cells(extra.cells));
  return out;
};
const invalid = (value) => { const out = decide(value); assert.equal(out.status, 'INELIGIBLE'); assert.equal(out.reason, 'INVALID_INPUT'); assert.deepEqual(out.checks, cells([NE, NE, NE, NE, NE, NE, NE])); assert.equal(out.entryId, null); assert.equal(out.journalSha256, null); assert.equal(out.sourcePlanDigest, null); return out; };

test('T1 positive path over real producers: ELIGIBLE with the fixed shape, seven OK cells, echoes and constants', () => {
  const out = decide(inp());
  assert.deepEqual(Object.keys(out), OUT_KEYS);
  assert.equal(out.schemaVersion, SCHEMA);
  assert.equal(out.status, 'ELIGIBLE'); assert.equal(out.reason, null);
  assert.deepEqual(out.checks, cells(['OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'OK']));
  assert.deepEqual(Object.keys(out.checks), CELLS);
  assert.equal(out.entryId, B.query.entryId); assert.equal(out.journalSha256, B.query.journalSha256); assert.equal(out.sourcePlanDigest, B.plan.sourcePlanDigest);
  assert.equal(out.authorizing, false); assert.equal(out.admitted, false); assert.equal(out.learningEnabled, false);
  deepFrozen(out);
});

test('T2 idempotent replay: deepEqual, distinct objects, inputs unmutated; capture DUPLICATE/STORED/null all eligible; key order of the observation is irrelevant', () => {
  const a = inp(); const before = JSON.stringify(a);
  const x = decide(a), y = decide(a);
  assert.deepEqual(x, y); assert.notEqual(x, y); assert.equal(JSON.stringify(a), before);
  for (const capture of [{ status: 'DUPLICATE', reason: null }, { status: 'STORED', reason: null }, null]) assert.equal(decide(inp({ capture })).status, 'ELIGIBLE');
  const reordered = fq((q) => { const o = q.observation; q.observation = Object.fromEntries(Object.entries(o).reverse()); });
  assert.equal(decide(inp({ query: reordered })).status, 'ELIGIBLE');
});

test('T3 INVALID_INPUT family: shape, vocabulary, attestation pins, nullability matrix', () => {
  const sym = Symbol('x');
  const cases = [
    undefined, null, {}, inp({ extra: 1 }),
    (() => { const v = inp(); delete v.capture; return v; })(),
    (() => { const v = inp(); v[sym] = 1; return v; })(),
    (() => { const v = inp(); Object.defineProperty(v, 'projectId', { get: () => B.projectId, enumerable: true }); return v; })(),
    (() => { const v = inp(); v.query = Object.create(Map.prototype, Object.getOwnPropertyDescriptors(clone(B.query))); return v; })(),
    inp({ projectId: 'proj' }), inp({ projectId: 'task:' + 'G'.repeat(64) }),
    inp({ query: clone(B.query.observation.row) }), inp({ query: clone(B.query.observation) }), inp({ query: { schemaVersion: 'nisi-repository-incident-capture/v1' } }),
    inp({ query: fq((q) => { q.status = 'REFUSED'; q.reason = 'JOURNAL_UNAVAILABLE'; q.observation = null; }) }),
    inp({ query: fq((q) => { q.status = 'REFUSED'; q.reason = 'INVALID_INPUT'; q.observation = null; q.journalSha256 = null; }) }),
    inp({ query: fq((q) => { q.status = 'REVOKED'; q.observation = null; q.journalSha256 = null; }) }),
    inp({ query: fq((q) => { q.observation = null; }) }),
    inp({ query: fq((q) => { q.status = 'REFUSED'; q.reason = 'INVALID_OBSERVATION'; q.observation = null; q.entryId = null; }) }),
    inp({ query: fq((q) => { q.status = 'MISSING'; }) }),
    inp({ query: fq((q) => { q.status = 'PENDING'; }) }),
    inp({ query: fq((q) => { q.sourceTrust = 'ATTESTED'; }) }),
    inp({ query: fq((q) => { q.observation.executionAttested = true; }) }),
    inp({ query: fq((q) => { q.observation.row.sourceTrust = 'TRUSTED_HOST_STATEMENTS_ATTESTED'; }) }),
    inp({ query: fq((q) => { q.observation.row.source.reportSha256 = '[REDACTED]'; }) }),
    inp({ query: fq((q) => { q.observation.row.failureCodes = ['[REDACTED]']; }) }),
    inp({ query: fq((q) => { q.observation.row.failureCodes = ['DET-002-UTF8', 'DET-001-NONEMPTY']; }) }),
    inp({ query: fq((q) => { q.observation.row.persistable = true; }) }),
    inp({ plan: fp((p) => { p.status = 'REFUSED'; p.reason = 'BOGUS'; p.selection = null; p.sourcePlanDigest = null; }) }),
    inp({ plan: fp((p) => { p.selection = null; }) }),
    inp({ plan: fp((p) => { p.status = 'REFUSED'; p.reason = 'ROW_MISSING'; p.sourcePlanDigest = null; }) }),
    inp({ plan: fp((p) => { p.requiresSeparateAdmission = false; }) }),
    inp({ plan: fp((p) => { p.selection.profile.modelParticipationRequired = true; }) }),
    inp({ plan: fp((p) => { p.selection.artifactByteLength = 1048577; }) }),
    inp({ revoked: 'yes' }), inp({ capture: { status: 'WRITTEN', reason: null } }), inp({ capture: { status: 'STORED' } }),
  ];
  for (const [i, c] of cases.entries()) { try { invalid(c); } catch (e) { e.message = `case ${i}: ${e.message}`; throw e; } }
  assert.equal(decide(inp({ plan: fp((p) => { p.selection.artifactByteLength = 1048576; }) })).status, 'ELIGIBLE', 'cap is inclusive');
});

test('T4 never throws on hostile objects', () => {
  const revokedProxy = (() => { const p = Proxy.revocable({}, {}); p.revoke(); return p.proxy; })();
  const hostile = [revokedProxy, new Proxy({}, { getPrototypeOf() { throw new Error('trap'); } }),
    inp({ query: new Proxy({}, { ownKeys() { throw new TypeError('x'); } }) }),
    inp({ query: fq((q) => { Object.defineProperty(q.observation.row.failureCodes, '0', { get() { throw new Error('index'); }, enumerable: true, configurable: true }); }) })];
  for (const v of hostile) { let o; assert.doesNotThrow(() => { o = decide(v); }); assert.equal(o.reason, 'INVALID_INPUT'); }
});

test('T5/T6 journal cell: JOURNAL_UNAVAILABLE and JOURNAL_NOT_OPEN from real reads are UNCERTAIN with the pins echoed', () => {
  const ua = B.q({ config: { ...B.config, projectId: 'task:' + '0'.repeat(64) } });
  assert.equal(ua.reason, 'JOURNAL_UNAVAILABLE');
  let out = expect(inp({ query: ua }), 'UNCERTAIN', 'JOURNAL_UNAVAILABLE', { cells: ['JOURNAL_UNAVAILABLE', NE, NE, NE, NE, NE, NE] });
  assert.equal(out.entryId, ua.entryId); assert.equal(out.journalSha256, null); assert.equal(out.sourcePlanDigest, B.plan.sourcePlanDigest);
  const lines = B.m.bytes(PATH).toString('utf8').trimEnd().split('\n');
  const m2 = memfs(); m2.seed(PATH, Buffer.from(lines.slice(0, -1).join('\n') + '\n'));
  const no = B.q({ fs: m2.fs });
  assert.equal(no.reason, 'JOURNAL_NOT_OPEN');
  out = expect(inp({ query: no }), 'UNCERTAIN', 'JOURNAL_NOT_OPEN', { cells: ['JOURNAL_NOT_OPEN', NE, NE, NE, NE, NE, NE] });
});

test('T7 capture carrier: only an UNCERTAIN capture refuses (COMMIT_UNCERTAIN, cell = its reason); every other capture status is OK', () => {
  expect(inp({ capture: { status: 'UNCERTAIN', reason: 'READBACK_MISMATCH' } }), 'UNCERTAIN', 'COMMIT_UNCERTAIN', { cells: ['OK', 'READBACK_MISMATCH', NE, NE, NE, NE, NE] });
  expect(inp({ capture: { status: 'UNCERTAIN', reason: 'INTERNAL_ERROR' } }), 'UNCERTAIN', 'COMMIT_UNCERTAIN', { cells: ['OK', 'INTERNAL_ERROR', NE, NE, NE, NE, NE] });
  expect(inp({ capture: { status: 'UNCERTAIN', reason: null } }), 'UNCERTAIN', 'COMMIT_UNCERTAIN', { cells: ['OK', 'UNCERTAIN', NE, NE, NE, NE, NE] });
  for (const capture of [{ status: 'CONFLICT', reason: 'ID_CONTENT_MISMATCH' }, { status: 'STORE_FAILED', reason: 'WRITE_FAILED' }, { status: 'REFUSED', reason: 'PROJECT' }]) expect(inp({ capture }), 'ELIGIBLE', null);
});

test('T8/T9 observation cell: a corrupt or redacted stored row and a malformed query request are INELIGIBLE / INVALID_OBSERVATION with the query reason as the cell, never UNCERTAIN', async () => {
  const { host, preview, eligible } = await createPagedIncidentHostFixture();
  const config = { ...B.config, redactPaths: ['payload.row.source.reportSha256'] };
  const m = memfs();
  const owner = openJournalOwner({ path: PATH, fs: m.fs, config, now: 100 }).owner;
  const permit = host.createIncidentPermit({ owner, declaration: B.declFor(preview, eligible[0], 'oracle.elig.redacted'), clock: () => 100 });
  const stored = host.captureIncident({ permit: permit.permit });
  assert.equal(stored.status, 'STORED');
  const q = queryRepositoryIncidentV1({ path: PATH, fs: m.fs, config, entryId: stored.entryId, now: 100 });
  assert.equal(q.reason, 'INVALID_OBSERVATION');
  let out = expect(inp({ query: q }), 'INELIGIBLE', 'INVALID_OBSERVATION', { cells: ['OK', 'OK', 'INVALID_OBSERVATION', NE, NE, NE, NE] });
  assert.equal(out.entryId, q.entryId); assert.equal(out.journalSha256, q.journalSha256);
  const bad = B.q({ now: -0 });
  assert.equal(bad.reason, 'INVALID_INPUT');
  out = expect(inp({ query: bad }), 'INELIGIBLE', 'INVALID_OBSERVATION', { cells: ['OK', 'OK', 'INVALID_INPUT', NE, NE, NE, NE] });
  assert.equal(out.entryId, null); assert.equal(out.journalSha256, null); assert.equal(out.sourcePlanDigest, B.plan.sourcePlanDigest);
});

test('T10 MISSING split: no journal file is UNCERTAIN, an absent entry in a present journal is INELIGIBLE', () => {
  const none = B.q({ path: '/j/none.jsonl' });
  assert.equal(none.status, 'MISSING'); assert.equal(none.journalSha256, null);
  expect(inp({ query: none }), 'UNCERTAIN', 'MISSING', { cells: ['OK', 'OK', 'MISSING', NE, NE, NE, NE] });
  const absent = B.q({ entryId: 'ric1.' + 'f'.repeat(64) });
  assert.equal(absent.status, 'MISSING'); assert.match(absent.journalSha256, /^[0-9a-f]{64}$/);
  expect(inp({ query: absent }), 'INELIGIBLE', 'MISSING', { cells: ['OK', 'OK', 'MISSING', NE, NE, NE, NE] });
});

test('T11 REVOKED: a real tombstone read and the host\'s own revocation decision both refuse before project/row/plan are consulted', () => {
  const m = memfs(); m.seed(PATH, B.m.bytes(PATH));
  const o2 = openJournalOwner({ path: PATH, fs: m.fs, config: B.config, now: 101 });
  const e = o2.snapshot.entries.find((x) => x.entry.id === B.stored.entryId).entry;
  const tomb = { ...e, id: 'revoke.' + 'a'.repeat(20), state: 'REVOKED', revokes: e.id, retryOf: null, createdAt: 101, ttlMs: 1000000, payload: null };
  const rev = recordJournalObservation({ owner: o2.owner, entry: tomb, now: 101 });
  assert.equal(rev.status, 'RECORDED', JSON.stringify(rev));
  const q = B.q({ fs: m.fs, now: 102 });
  assert.equal(q.status, 'REVOKED');
  expect(inp({ query: q }), 'INELIGIBLE', 'REVOKED', { cells: ['OK', 'OK', 'REVOKED', NE, NE, NE, NE] });
  expect(inp({ revoked: true, projectId: 'task:' + '1'.repeat(64), plan: nativeIncidentSourceRefusalV1('ROW_MISSING') }), 'INELIGIBLE', 'REVOKED', { cells: ['OK', 'OK', 'REVOKED', NE, NE, NE, NE] });
});

test('T12/T13 EXPIRED boundary and NOT_RETAINED from real reads', async () => {
  const exp = B.q({ now: 10100 });
  assert.equal(exp.status, 'EXPIRED');
  expect(inp({ query: exp }), 'INELIGIBLE', 'EXPIRED', { cells: ['OK', 'OK', 'EXPIRED', NE, NE, NE, NE] });
  const edge = B.q({ now: 10099 });
  assert.equal(edge.status, 'AVAILABLE_OBSERVATION');
  expect(inp({ query: edge }), 'ELIGIBLE', null);
  const { host, preview, eligible } = await createPagedIncidentHostFixture();
  const cfg = { ...B.config, maxEntries: 1 };
  const m = memfs();
  const o = openJournalOwner({ path: PATH, fs: m.fs, config: cfg, now: 100 }).owner;
  const first = host.captureIncident({ permit: host.createIncidentPermit({ owner: o, declaration: B.declFor(preview, eligible[1], 'oracle.elig.r1'), clock: () => 100 }).permit });
  const o2 = openJournalOwner({ path: PATH, fs: m.fs, config: cfg, now: 101 }).owner;
  const second = host.captureIncident({ permit: host.createIncidentPermit({ owner: o2, declaration: B.declFor(preview, eligible[2], 'oracle.elig.r2'), clock: () => 101 }).permit });
  assert.equal(first.status, 'STORED'); assert.equal(second.status, 'STORED');
  const q = queryRepositoryIncidentV1({ path: PATH, fs: m.fs, config: cfg, entryId: first.entryId, now: 101 });
  assert.equal(q.status, 'NOT_RETAINED');
  expect(inp({ query: q }), 'INELIGIBLE', 'NOT_RETAINED', { cells: ['OK', 'OK', 'NOT_RETAINED', NE, NE, NE, NE] });
});

test('T14 PROJECT_MISMATCH is decided from the row binding, after the observation cell', () => {
  expect(inp({ projectId: 'task:' + '1'.repeat(64) }), 'INELIGIBLE', 'PROJECT_MISMATCH', { cells: ['OK', 'OK', 'OK', 'PROJECT_MISMATCH', NE, NE, NE] });
});

test('T15/T16 row cell: a tests-stage row is UNSUPPORTED_STAGE and a non-failure quintuple is ROW_NOT_FAILURE; the plan is never consulted', () => {
  const testsRow = fq((q) => { const r = q.observation.row; r.binding.stage = 'tests'; r.binding.checkIndex = 0; r.source.planFingerprint = null; r.source.groupFingerprint = null; r.subject = { kind: 'MATERIALIZED_TREE', pathSha256: null, contentSha256: null }; r.failureCodes = ['NODE_ASSERTION_' + '0'.repeat(16)]; });
  expect(inp({ query: testsRow, plan: nativeIncidentSourceRefusalV1('UNSUPPORTED_STAGE') }), 'INELIGIBLE', 'UNSUPPORTED_STAGE', { cells: ['OK', 'OK', 'OK', 'OK', 'UNSUPPORTED_STAGE', NE, NE] });
  expect(inp({ query: testsRow }), 'INELIGIBLE', 'UNSUPPORTED_STAGE', { cells: ['OK', 'OK', 'OK', 'OK', 'UNSUPPORTED_STAGE', NE, NE] });
  const passRow = fq((q) => { const r = q.observation.row; r.classification = 'PASS'; r.reason = 'RECORDED_PASS'; r.rawStatus = 'PASS'; r.stageStatus = 'PASS'; r.failureCodes = []; });
  expect(inp({ query: passRow, plan: nativeIncidentSourceRefusalV1('ROW_NOT_FAILURE') }), 'INELIGIBLE', 'ROW_NOT_FAILURE', { cells: ['OK', 'OK', 'OK', 'OK', 'ROW_NOT_FAILURE', NE, NE] });
  expect(inp({ query: passRow }), 'INELIGIBLE', 'ROW_NOT_FAILURE');
  for (const [k, v] of [['classification', 'PASS'], ['reason', 'RECORDED_PASS'], ['rawStatus', 'PASS'], ['stageStatus', 'PASS'], ['disposition', 'RESULT_WITHHELD']]) expect(inp({ query: fq((q) => { q.observation.row[k] = v; }) }), 'INELIGIBLE', 'ROW_NOT_FAILURE', { cells: ['OK', 'OK', 'OK', 'OK', 'ROW_NOT_FAILURE', NE, NE] });
});

test('T17 source cell: every plan refusal is INELIGIBLE with the plan reason (INVALID_INPUT collapses to INVALID_EVIDENCE) and the cell verbatim; the real host refusal for an unknown row is ROW_MISSING', () => {
  for (const code of PLAN_REFUSALS) {
    const out = expect(inp({ plan: nativeIncidentSourceRefusalV1(code) }), 'INELIGIBLE', code === 'INVALID_INPUT' ? 'INVALID_EVIDENCE' : code, { cells: ['OK', 'OK', 'OK', 'OK', 'OK', code, NE] });
    assert.equal(out.sourcePlanDigest, null); assert.equal(out.entryId, B.query.entryId);
  }
  const real = B.host.nativeIncidentSourcePlan({ rowId: '0'.repeat(64) });
  assert.equal(real.reason, 'ROW_MISSING');
  expect(inp({ plan: real }), 'INELIGIBLE', 'ROW_MISSING', { cells: ['OK', 'OK', 'OK', 'OK', 'OK', 'ROW_MISSING', NE] });
});

test('T18 identity join: same row, same content, same snapshot — single-field forgeries of the real plan', () => {
  expect(inp({ plan: fp((p) => { p.selection.rowId = hex('e'); }) }), 'INELIGIBLE', 'ROW_MISMATCH', { cells: ['OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'ROW_MISMATCH'] });
  expect(inp({ plan: fp((p) => { p.selection.rowFingerprint = hex('e'); }) }), 'INELIGIBLE', 'CONFLICT', { cells: ['OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'ID_CONTENT_MISMATCH'] });
  expect(inp({ plan: fp((p) => { p.selection.binding.attempt = 7; }) }), 'INELIGIBLE', 'CONFLICT', { cells: ['OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'SOURCE_MISMATCH'] });
  expect(inp({ plan: fp((p) => { p.selection.source.receiptSha256 = hex('e'); }) }), 'INELIGIBLE', 'CONFLICT', { cells: ['OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'SOURCE_MISMATCH'] });
  expect(inp({ plan: fp((p) => { p.selection.previewSha256 = hex('e'); }) }), 'INELIGIBLE', 'PREVIEW_MISMATCH', { cells: ['OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'PREVIEW_MISMATCH'] });
  expect(inp({ plan: fp((p) => { p.selection.rowId = hex('e'); p.selection.rowFingerprint = hex('e'); }) }), 'INELIGIBLE', 'ROW_MISMATCH');
  // the query side of the join: a forged observation previewSha256 is caught the same way
  expect(inp({ query: fq((q) => { q.observation.previewSha256 = hex('e'); }) }), 'INELIGIBLE', 'PREVIEW_MISMATCH');
});

test('T19 compound faults: the first failing cell in the fixed order is the reason', () => {
  const rev = fq((q) => { q.status = 'REVOKED'; q.observation = null; });
  expect(inp({ query: rev, projectId: 'task:' + '1'.repeat(64), plan: nativeIncidentSourceRefusalV1('ROW_MISSING') }), 'INELIGIBLE', 'REVOKED');
  expect(inp({ projectId: 'task:' + '1'.repeat(64), plan: nativeIncidentSourceRefusalV1('ROW_MISSING') }), 'INELIGIBLE', 'PROJECT_MISMATCH');
  const notOpen = fq((q) => { q.status = 'REFUSED'; q.reason = 'JOURNAL_NOT_OPEN'; q.observation = null; q.journalSha256 = null; });
  expect(inp({ query: notOpen, capture: { status: 'UNCERTAIN', reason: null }, projectId: 'task:' + '1'.repeat(64), plan: nativeIncidentSourceRefusalV1('ROW_MISSING') }), 'UNCERTAIN', 'JOURNAL_NOT_OPEN');
  expect(inp({ query: rev, capture: { status: 'UNCERTAIN', reason: null } }), 'UNCERTAIN', 'COMMIT_UNCERTAIN');
  const testsRow = fq((q) => { const r = q.observation.row; r.binding.stage = 'tests'; r.binding.checkIndex = 0; r.source.planFingerprint = null; r.source.groupFingerprint = null; r.subject = { kind: 'MATERIALIZED_TREE', pathSha256: null, contentSha256: null }; r.failureCodes = []; });
  expect(inp({ query: testsRow, revoked: true }), 'INELIGIBLE', 'REVOKED');
  expect(inp({ query: testsRow, plan: fp((p) => { p.selection.rowId = hex('e'); }) }), 'INELIGIBLE', 'UNSUPPORTED_STAGE');
  expect(inp({ plan: fp((p) => { p.selection.rowId = hex('e'); p.selection.previewSha256 = hex('e'); }) }), 'INELIGIBLE', 'ROW_MISMATCH');
});

test('T20 invariants over every decision, and module purity', async () => {
  const outs = [decide(inp()), decide(inp({ revoked: true })), decide(inp({ plan: nativeIncidentSourceRefusalV1('ARTIFACT_LIMIT') })), decide(inp({ query: B.q({ now: 10100 }) })), decide(inp({ query: B.q({ path: '/j/none.jsonl' }) })), decide(inp({ capture: { status: 'UNCERTAIN', reason: null } })), decide(undefined), decide(inp({ projectId: 'task:' + '1'.repeat(64) })), decide(inp({ plan: fp((p) => { p.selection.previewSha256 = hex('e'); }) }))];
  for (const out of outs) {
    assert.deepEqual(Object.keys(out), OUT_KEYS); assert.deepEqual(Object.keys(out.checks), CELLS);
    assert.ok(['ELIGIBLE', 'INELIGIBLE', 'UNCERTAIN'].includes(out.status));
    assert.equal(out.reason === null, out.status === 'ELIGIBLE');
    if (out.reason !== null) assert.ok(REASONS.includes(out.reason), out.reason);
    assert.equal(out.authorizing, false); assert.equal(out.admitted, false); assert.equal(out.learningEnabled, false);
    deepFrozen(out);
    const words = CELLS.map((c) => out.checks[c]); const firstBad = words.findIndex((w) => w !== 'OK');
    if (firstBad >= 0) for (const w of words.slice(firstBad + 1)) assert.equal(w, NE);
    if (out.reason !== 'INVALID_INPUT') { assert.equal(out.sourcePlanDigest !== null, true === (out.sourcePlanDigest !== null)); }
  }
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/incident-eligibility-v1.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bimport\b/);
  assert.doesNotMatch(source, /\b(?:require|process|fetch|setTimeout|setInterval|Date|performance|globalThis|Buffer|crypto)\b|Math\s*\.\s*random\b/);
  const ns = await import('../src/incident-eligibility-v1.mjs');
  assert.deepEqual(Object.keys(ns), ['decideIncidentEligibilityV1']);
});
