import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {setImmediate as immediate} from 'node:timers/promises';
import {stableStringify} from '../workflow/contracts.mjs';
import {createRepositoryWorkflowOwnerV1} from '../hosts/repository/reviewed-workflow-v1.mjs';
import {createRepositoryHistoryAccessV1} from '../history/repository-host-history-v1.mjs';
import {createRepositoryRunBundleV1, readRepositoryRunBundleV1} from '../receipts/repository-run-v1.mjs';
import {openJournalOwner, recordJournalObservation} from '../history/journal-owner-v2.mjs';
import {context} from './helpers/node-repository-fixture.mjs';
import {fixedOptions, combinedFixture} from './helpers/repository-run-fixture.mjs';
import {memfs} from './journal-owner-v2.memfs.mjs';
import {CONFIG, PATH, entry, damageFooter, serialized, assertDeepFrozen} from './journal-owner-v2.helper.mjs';

const PREVIEW_KEYS = ['schemaVersion', 'status', 'reason', 'preview', 'sha256', 'authorizing'];
const CAPTURE_KEYS = ['schemaVersion', 'status', 'reason', 'recordAttempted', 'consumed',
  'sourceDigest', 'declarationDigest', 'journal', 'authorizing'];
const BODY_KEYS = ['schemaVersion', 'taskFingerprint', 'baselineFingerprint', 'runId', 'attempt',
  'candidateFingerprint', 'candidatePresent', 'outcome', 'workflowOutcome', 'hostState', 'ownerStates',
  'stageCounts', 'stageTotal', 'diagnostics', 'bundleFingerprint', 'sourceAuthenticityAttested',
  'executionAttested', 'learningEligible', 'authorizing'];
const sha = value => createHash('sha256').update(value).digest('hex');
const JOURNAL_CONFIG = Object.freeze({...CONFIG, redactPaths: []});
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; };
const stub = (key, fn, changes = {}) => ({[key]: fn, registrationFingerprint: 'a'.repeat(64),
  settled: async () => [], observations: () => [], status: () => 'IDLE', lateObservations: () => [], ...changes});
const goodStatic = p => ({status: 'PASS', evidence: {...p.binding, findings: [], reason: ''}});
const goodTest = p => ({status: 'PASS', evidence: {...p.binding, assertionsExecuted: 1, assertionsPassed: 1, failures: [], reason: ''}});
const hostFor = (c, stat = stub('check', goodStatic), node = stub('run', goodTest)) =>
  createRepositoryWorkflowOwnerV1({suite: c.suite, staticOwner: stat, testsOwner: node});
const open = m => openJournalOwner({path: PATH, fs: m.fs, config: JOURNAL_CONFIG, now: 100});
const accessFor = (c, result) => {
  const access = createRepositoryHistoryAccessV1({taskFingerprint: c.preparations[0].taskFingerprint,
    baselineFingerprint: c.preparations[0].baselineFingerprint});
  if (result !== undefined) access.publish(result);
  return access;
};
const declaration = (digest, overrides = {}) => ({schemaVersion: 'nisi-repository-history-declaration/v1',
  declarationId: 'repository-history-a', projectId: 'project-a', sourceDigest: digest,
  issuedAt: 100, expiresAt: 1000, createdAt: 100, retentionMs: 1000,
  consentClass: 'WRITTEN_DECLARATION', destination: 'LOCAL_OBSERVATION_JOURNAL_ONLY',
  rawContentPersisted: false, networkEgress: false, learningInfluence: false, ...overrides});
const capture = (host, owner, digest, overrides = {}) => host.captureHistory({owner,
  declaration: declaration(digest), clock: () => 100, ...overrides});

function assertPreview(result, status, reason) {
  assert.deepEqual(Object.keys(result).sort(), [...PREVIEW_KEYS].sort());
  assert.equal(result.schemaVersion, 'nisi-repository-history-preview/v1');
  assert.equal(result.status, status); assert.equal(result.reason, reason); assert.equal(result.authorizing, false);
  assertDeepFrozen(result);
}
function assertCapture(result, status, reason, attempted, consumed) {
  assert.deepEqual(Object.keys(result).sort(), [...CAPTURE_KEYS].sort());
  assert.equal(result.schemaVersion, 'nisi-repository-history-capture/v1');
  assert.equal(result.status, status); assert.equal(result.reason, reason);
  assert.equal(result.recordAttempted, attempted); assert.equal(result.consumed, consumed);
  assert.equal(result.authorizing, false); assertDeepFrozen(result);
}
async function settledHost(t, configure = options => options) {
  const c = await context(t); const host = hostFor(c); const report = await host.run(configure(fixedOptions(c)));
  const result = await host.settled(); return {c, host, report, result};
}
function collectedFixture(fixture) {
  const x = fixture.context;
  const bundle = createRepositoryRunBundleV1(x), bundleSummary = readRepositoryRunBundleV1(bundle, x);
  return {schemaVersion: 'nisi-reviewed-repository-host-v1', report: x.report, invocations: [],
    staticHistory: x.plans.map((plan, i) => ({plan, group: x.groups[i], error: null})),
    testHistory: x.executions.map(execution => ({execution, error: null})),
    settlementErrors: [null, null], historyErrors: [null, null], ownerStateErrors: [null, null],
    ownerStates: {staticChecks: 'IDLE', tests: 'IDLE'}, state: 'SETTLED', bundle, bundleSummary,
    bundleError: null, proposedChanges: null, applied: false, sandboxed: false, authorizing: false,
    certificationGranted: false};
}

test('actual host exposes only preview/capture additions, never helper publication authority', async t => {
  const {host} = await settledHost(t);
  assert.equal(typeof host.historyPreview, 'function'); assert.equal(typeof host.captureHistory, 'function');
  assert.equal(Object.hasOwn(host, 'publish'), false); assert.equal(Object.hasOwn(host, 'reject'), false);
});

test('before run, preview and capture refuse without clock or journal IO', async t => {
  const c = await context(t); const host = hostFor(c); const m = memfs(); const owner = open(m).owner; let clocks = 0;
  assertPreview(host.historyPreview(), 'REFUSED', 'NO_SETTLED_RESULT');
  const result = host.captureHistory({owner, declaration: declaration('0'.repeat(64)), clock: () => ++clocks});
  assertCapture(result, 'REFUSED', 'NO_SETTLED_RESULT', false, false); assert.equal(clocks, 0); assert.equal(m.events.length, 1);
});

test('engine report availability does not permit history while either drain is pending', async t => {
  const c = await context(t), drain = deferred(); t.after(() => drain.resolve([]));
  const node = stub('run', goodTest, {settled: () => drain.promise, status: () => 'BUSY'});
  const host = hostFor(c, stub('check', goodStatic), node); await host.run(fixedOptions(c));
  assert.equal(host.status(), 'SETTLING'); assert.equal(host.historyPreview().reason, 'NO_SETTLED_RESULT');
  let clocks = 0; assert.equal(host.captureHistory({owner: {}, declaration: {}, clock: () => ++clocks}).reason, 'NO_SETTLED_RESULT');
  assert.equal(clocks, 0); drain.resolve([]); await host.settled();
});

test('unexpected collection rejection publishes SETTLEMENT_REJECTED without clock', async t => {
  const c = await context(t); const access = accessFor(c); access.reject(); let calls = 0;
  assertPreview(access.preview(), 'REFUSED', 'SETTLEMENT_REJECTED');
  const result = access.capture({owner: {}, declaration: {}, clock: () => ++calls});
  assertCapture(result, 'REFUSED', 'SETTLEMENT_REJECTED', false, false); assert.equal(calls, 0);
});

test('published preview has exact fixed metadata, vocabulary conservation and digest', async t => {
  const {c, result} = await settledHost(t); const access = accessFor(c, result); const preview = access.preview();
  assertPreview(preview, 'PREVIEW', null); assert.deepEqual(Object.keys(preview.preview).sort(), [...BODY_KEYS].sort());
  assert.equal(preview.preview.stageTotal, Object.values(preview.preview.stageCounts).reduce((a, b) => a + b, 0));
  assert.deepEqual(Object.keys(preview.preview.stageCounts).sort(), ['PASS', 'FAIL', 'NOT_RUN', 'UNAVAILABLE', 'REPAIRED', 'NO_CHANGE'].sort());
  assert.equal(preview.preview.candidatePresent, preview.preview.candidateFingerprint !== null);
  assert.equal(preview.preview.authorizing, false); assert.equal(preview.preview.executionAttested, false);
  assert.equal(preview.preview.sourceAuthenticityAttested, false); assert.equal(preview.preview.learningEligible, false);
  assert.equal(preview.sha256, sha('nisi/repository-history-preview/v1\0' + stableStringify(preview.preview)));
  assert.equal(Buffer.byteLength(stableStringify(preview.preview)) <= 16384, true);
});

test('preview is cached, deterministic and independent from existing host state and result identity', async t => {
  const {host, report, result} = await settledHost(t); const state = host.status(), invocations = host.invocations();
  const first = host.historyPreview(), second = host.historyPreview();
  assert.equal(second, first); assert.equal(second.preview, first.preview); assert.equal(second.sha256, first.sha256);
  assert.equal(host.status(), state); assert.deepEqual(host.invocations(), invocations);
  assert.equal((await host.settled()), result); assert.equal(result.report, report);
});

test('preview and capture never expose sources, paths, histories, messages or arbitrary diagnostic text', async t => {
  const {c, result} = await settledHost(t); const poisoned = structuredClone(result);
  poisoned.staticHistory.push({path: '/PRIVATE/PATH', output: 'PRIVATE-OUTPUT'});
  poisoned.settlementErrors = [{code: 'PRIVATE_DIAGNOSTIC_CODE'}, null];
  const access = accessFor(c, poisoned), preview = access.preview(); assert.equal(preview.status, 'PREVIEW');
  const m = memfs(); const stored = access.capture({owner: open(m).owner,
    declaration: declaration(preview.sha256), clock: () => 100});
  const text = JSON.stringify({preview, stored, disk: m.bytes(PATH)?.toString('utf8')});
  for (const secret of ['PRIVATE/PATH', 'PRIVATE-OUTPUT', 'PRIVATE_DIAGNOSTIC_CODE', 'retry-settings.mjs']) assert.equal(text.includes(secret), false);
  assert.match(preview.preview.diagnostics.settlementCodeSha256[0], /^[0-9a-f]{64}$/);
});

test('unknown stage status refuses rather than disappearing from counts', async t => {
  const {c, result} = await settledHost(t); const malformed = structuredClone(result);
  malformed.report.stages[0].status = 'MYSTERY'; const preview = accessFor(c, malformed).preview();
  assertPreview(preview, 'REFUSED', 'INVALID_SETTLEMENT'); assert.equal(preview.preview, null); assert.equal(preview.sha256, null);
});

test('malformed report and wrong task identity are distinct cached refusals', async t => {
  const {c, result} = await settledHost(t);
  const bad = structuredClone(result); bad.report.runId = null;
  assertPreview(accessFor(c, bad).preview(), 'REFUSED', 'INVALID_REPORT');
  const wrong = createRepositoryHistoryAccessV1({taskFingerprint: 'f'.repeat(64), baselineFingerprint: c.preparations[0].baselineFingerprint});
  wrong.publish(result); assertPreview(wrong.preview(), 'REFUSED', 'TASK_IDENTITY_MISMATCH');
});

test('candidate absence uses null/false preview and reserved none:run namespace without inventing evaluation', async t => {
  const {c, host, report, result} = await settledHost(t, options => ({...options,
    authorizeContext: {authorize: p => ({status: 'REFUSED', reason: 'NO_AUTH', evidence: {...p.binding}})}}));
  assert.equal(report.candidateFingerprint, null); const preview = host.historyPreview();
  assert.equal(preview.preview.candidateFingerprint, null); assert.equal(preview.preview.candidatePresent, false);
  const m = memfs(); const stored = capture(host, open(m).owner, preview.sha256);
  assert.equal(stored.status, 'STORED'); const row = stored.journal.snapshot.entries[0].entry;
  assert.equal(row.candidateId, `none:${report.runId}`); assert.equal(row.payload.preview.candidatePresent, false);
});

test('candidate presence uses cand:hex namespace and deterministic rh1 identity', async t => {
  const {host, report} = await settledHost(t); const preview = host.historyPreview(); const m = memfs();
  const stored = capture(host, open(m).owner, preview.sha256); assert.equal(stored.status, 'STORED');
  const row = stored.journal.snapshot.entries[0].entry;
  assert.equal(row.candidateId, `cand:${report.candidateFingerprint}`);
  assert.equal(row.id, `rh1.${sha('nisi/repository-history-id/v1\0' + preview.sha256)}`);
});

test('quarantined completed host is stored as FAILED operational state, never model failure', async t => {
  const {host, result} = await settledHost(t); assert.equal(result.state, 'QUARANTINED'); const preview = host.historyPreview();
  assert.equal(preview.preview.hostState, 'QUARANTINED'); const m = memfs(); const stored = capture(host, open(m).owner, preview.sha256);
  assert.equal(stored.journal.snapshot.entries[0].entry.state, 'FAILED');
  assert.equal(stored.journal.snapshot.entries[0].entry.payload.preview.executionAttested, false);
});

test('consistent completed settlement from the trusted combined fixture stores SUCCEEDED without execution attestation', async t => {
  const fixture = await combinedFixture(t); const result = collectedFixture(fixture);
  assert.equal(result.report.outcome, 'COMPLETED'); const access = accessFor(fixture.c, result), preview = access.preview();
  assert.equal(preview.preview.hostState, 'SETTLED'); const stored = access.capture({owner: open(memfs()).owner,
    declaration: declaration(preview.sha256), clock: () => 100});
  assert.equal(stored.status, 'STORED'); assert.equal(stored.journal.snapshot.entries[0].entry.state, 'SUCCEEDED');
  assert.equal(stored.journal.snapshot.entries[0].entry.payload.preview.executionAttested, false);
});

test('consistent cancelled settlement stores CANCELLED as run outcome, not candidate failure', async t => {
  const fixture = await combinedFixture(t, {interrupt: 'abort'}); const result = collectedFixture(fixture);
  assert.equal(result.report.outcome, 'CANCELLED'); const access = accessFor(fixture.c, result), preview = access.preview();
  const stored = access.capture({owner: open(memfs()).owner, declaration: declaration(preview.sha256), clock: () => 100});
  assert.equal(stored.status, 'STORED'); assert.equal(stored.journal.snapshot.entries[0].entry.state, 'CANCELLED');
  assert.equal(stored.journal.snapshot.entries[0].entry.payload.preview.outcome, 'CANCELLED');
  assert.equal(stored.journal.snapshot.entries[0].entry.payload.preview.learningEligible, false);
});

test('capture rejects malformed closed envelopes and declarations without getters or consumption', async t => {
  const {host} = await settledHost(t); const p = host.historyPreview(); const m = memfs(), owner = open(m).owner; let calls = 0;
  const getter = {owner, declaration: declaration(p.sha256)}; Object.defineProperty(getter, 'clock', {enumerable: true, get() { calls++; throw Error('no'); }});
  const extra = {owner, declaration: declaration(p.sha256), clock: () => 100, extra: true};
  for (const input of [null, [], {owner, declaration: declaration(p.sha256)}, extra, getter]) {
    const result = host.captureHistory(input); assertCapture(result, 'REFUSED', 'INVALID_INPUT', false, false);
  }
  assert.equal(calls, 0); assert.equal(capture(host, owner, p.sha256).status, 'STORED');
});

test('digest mismatch and invalid declaration times are non-consuming and correctable', async t => {
  const {host} = await settledHost(t); const p = host.historyPreview(); const owner = open(memfs()).owner;
  assertCapture(capture(host, owner, '0'.repeat(64)), 'REFUSED', 'SOURCE_DIGEST_MISMATCH', false, false);
  for (const changes of [{issuedAt: -0}, {expiresAt: 100}, {retentionMs: 0}]) {
    const result = host.captureHistory({owner, declaration: declaration(p.sha256, changes), clock: () => 100});
    assertCapture(result, 'REFUSED', 'INVALID_INPUT', false, false);
  }
  assert.equal(capture(host, owner, p.sha256).status, 'STORED');
});

test('forged, SEALED and uncertain owners refuse before admission without consuming', async t => {
  const {host} = await settledHost(t); const p = host.historyPreview();
  assertCapture(capture(host, {}, p.sha256), 'REFUSED', 'INVALID_OWNER', false, false);
  const sealedFs = memfs(); sealedFs.seed(PATH, damageFooter(serialized(JOURNAL_CONFIG)));
  assertCapture(capture(host, open(sealedFs).owner, p.sha256), 'REFUSED', 'OWNER_SEALED', false, false);
  const uncertainFs = memfs(); const uncertainOwner = open(uncertainFs); let renamed = false;
  const rename = uncertainFs.fs.renameSync, read = uncertainFs.fs.readFileSync;
  uncertainFs.fs.renameSync = (a, b) => { rename(a, b); renamed = true; };
  uncertainFs.fs.readFileSync = path => renamed && path === PATH ? Buffer.from('bad') : read(path);
  assert.equal(recordJournalObservation({owner: uncertainOwner.owner, entry: entry(), now: 100}).snapshot.state, 'COMMIT_UNCERTAIN');
  assertCapture(capture(host, uncertainOwner.owner, p.sha256), 'REFUSED', 'COMMIT_UNCERTAIN', false, false);
  const good = open(memfs()).owner; assert.equal(capture(host, good, p.sha256).status, 'STORED');
});

test('clock is called twice, copied declaration survives first-clock mutation, and reentry is BUSY', async t => {
  const {host} = await settledHost(t); const p = host.historyPreview(); const m = memfs(), owner = open(m).owner;
  const d = declaration(p.sha256); let calls = 0, nested;
  const outer = host.captureHistory({owner, declaration: d, clock: () => {
    calls++; if (calls === 1) { d.projectId = 'poison'; d.sourceDigest = '0'.repeat(64);
      nested = host.captureHistory({owner, declaration: declaration(p.sha256), clock: () => 100}); }
    return 100;
  }});
  assertCapture(nested, 'REFUSED', 'BUSY', false, false); assert.equal(calls, 2); assert.equal(outer.status, 'STORED');
  assert.equal(outer.journal.snapshot.entries[0].entry.projectId, 'project-a');
});

test('clock throw, backward second clock, expiry and observation times refuse without consumption', async t => {
  for (const [values, reason] of [[[100, 99], 'INVALID_CLOCK'], [[100, 1000], 'DECLARATION_EXPIRED']]) {
    const {host} = await settledHost(t); const p = host.historyPreview(), owner = open(memfs()).owner; let i = 0;
    const result = host.captureHistory({owner, declaration: declaration(p.sha256), clock: () => values[i++]});
    assertCapture(result, 'REFUSED', reason, false, false);
  }
  const {host} = await settledHost(t); const p = host.historyPreview(), owner = open(memfs()).owner;
  assertCapture(host.captureHistory({owner, declaration: declaration(p.sha256), clock: () => { throw Error('PRIVATE'); }}),
    'REFUSED', 'INVALID_CLOCK', false, false);
});

test('all temporal reasons and invalid clock types are precise and non-consuming', async t => {
  const cases = [
    [declaration, () => 99, 'NOT_YET_VALID'],
    [(digest) => declaration(digest, {createdAt: 101}), () => 100, 'OBSERVATION_IN_FUTURE'],
    [(digest) => declaration(digest, {createdAt: 100, retentionMs: 1}), () => 101, 'OBSERVATION_EXPIRED']
  ];
  for (const [makeDeclaration, clock, reason] of cases) {
    const {host} = await settledHost(t); const p = host.historyPreview(), owner = open(memfs()).owner;
    assertCapture(host.captureHistory({owner, declaration: makeDeclaration(p.sha256), clock}), 'REFUSED', reason, false, false);
  }
  for (const clock of [null, 100, {}, 'clock']) {
    const {host} = await settledHost(t); const p = host.historyPreview(), owner = open(memfs()).owner;
    assertCapture(host.captureHistory({owner, declaration: declaration(p.sha256), clock}), 'REFUSED', 'INVALID_INPUT', false, false);
  }
});

test('stage count overflow refuses INVALID_SETTLEMENT instead of clamping', async t => {
  const {c, result} = await settledHost(t); const malformed = structuredClone(result);
  malformed.report.stages = Array.from({length: 2301}, () => structuredClone(result.report.stages[0]));
  const preview = accessFor(c, malformed).preview();
  assertPreview(preview, 'REFUSED', 'INVALID_SETTLEMENT'); assert.equal(preview.preview, null); assert.equal(preview.sha256, null);
});

test('wrong-project reaches record, returns REFUSED, and permanently consumes', async t => {
  const {host} = await settledHost(t); const p = host.historyPreview(); const m = memfs(), owner = open(m).owner;
  const first = host.captureHistory({owner, declaration: declaration(p.sha256, {projectId: 'project-b'}), clock: () => 100});
  assertCapture(first, 'REFUSED', 'PROJECT', true, true); assert.equal(first.journal.status, 'REFUSED');
  assertCapture(capture(host, owner, p.sha256), 'REFUSED', 'ALREADY_CAPTURED', false, true);
});

test('reentry from journal FS after admission sees ALREADY_CAPTURED, never BUSY', async t => {
  const {host} = await settledHost(t); const p = host.historyPreview(); const m = memfs(), owner = open(m).owner;
  const openSync = m.fs.openSync; let nested = null, entered = false;
  m.fs.openSync = (...args) => { if (!entered) { entered = true; nested = capture(host, owner, p.sha256); } return openSync(...args); };
  assert.equal(capture(host, owner, p.sha256).status, 'STORED');
  assertCapture(nested, 'REFUSED', 'ALREADY_CAPTURED', false, true);
});

test('duplicate journal result consumes the host admission and is preserved exactly', async t => {
  const {c, result} = await settledHost(t); const first = accessFor(c, result), second = accessFor(c, result);
  const p = first.preview(), m = memfs(), owner = open(m).owner;
  assert.equal(first.capture({owner, declaration: declaration(p.sha256), clock: () => 100}).status, 'STORED');
  const duplicate = second.capture({owner, declaration: declaration(p.sha256), clock: () => 100});
  assertCapture(duplicate, 'DUPLICATE', null, true, true); assert.equal(duplicate.journal.status, 'DUPLICATE');
  assert.equal(second.capture({owner, declaration: declaration(p.sha256), clock: () => 100}).reason, 'ALREADY_CAPTURED');
});

test('journal content conflict is preserved and consumes the one host attempt', async t => {
  const {c, result} = await settledHost(t); const first = accessFor(c, result), second = accessFor(c, result);
  const p = first.preview(), m = memfs(), owner = open(m).owner;
  assert.equal(first.capture({owner, declaration: declaration(p.sha256), clock: () => 100}).status, 'STORED');
  const conflict = second.capture({owner, declaration: declaration(p.sha256, {declarationId: 'changed'}), clock: () => 100});
  assertCapture(conflict, 'CONFLICT', 'ID_CONTENT_MISMATCH', true, true); assert.equal(conflict.journal.status, 'CONFLICT');
  assert.equal(second.capture({owner, declaration: declaration(p.sha256), clock: () => 100}).reason, 'ALREADY_CAPTURED');
});

test('stale owner STORE_CONFLICT is preserved and consumes the one host attempt', async t => {
  const {c, result} = await settledHost(t); const access = accessFor(c, result), p = access.preview(), m = memfs();
  const stale = open(m), writer = open(m);
  assert.equal(recordJournalObservation({owner: writer.owner, entry: entry('intervening'), now: 100}).status, 'RECORDED');
  const conflict = access.capture({owner: stale.owner, declaration: declaration(p.sha256), clock: () => 100});
  assertCapture(conflict, 'CONFLICT', 'CONFLICT', true, true); assert.equal(conflict.journal.status, 'STORE_CONFLICT');
  assert.equal(access.capture({owner: stale.owner, declaration: declaration(p.sha256), clock: () => 100}).reason, 'ALREADY_CAPTURED');
});

test('precommit store failure and commit uncertainty both consume with actual journal evidence', async t => {
  for (const uncertain of [false, true]) {
    const {c, result} = await settledHost(t); const access = accessFor(c, result), p = access.preview(), m = memfs(), opened = open(m);
    if (!uncertain) m.fs.renameSync = () => { throw Object.assign(Error('no'), {code: 'EIO'}); };
    else { let renamed = false; const rename = m.fs.renameSync, read = m.fs.readFileSync;
      m.fs.renameSync = (a, b) => { rename(a, b); renamed = true; };
      m.fs.readFileSync = path => renamed && path === PATH ? Buffer.from('bad') : read(path); }
    const captureResult = access.capture({owner: opened.owner, declaration: declaration(p.sha256), clock: () => 100});
    assert.equal(captureResult.status, uncertain ? 'UNCERTAIN' : 'STORE_FAILED');
    assert.equal(captureResult.recordAttempted, true); assert.equal(captureResult.consumed, true);
    assert.equal(access.capture({owner: opened.owner, declaration: declaration(p.sha256), clock: () => 100}).reason, 'ALREADY_CAPTURED');
  }
});

test('capture does not mutate settled report, host status, invocations or reportStored', async t => {
  const {host, report, result} = await settledHost(t); const before = JSON.stringify(result), state = host.status(), calls = host.invocations();
  const reportStored = report.reportStored; assert.equal(typeof reportStored, 'boolean');
  const p = host.historyPreview(); const stored = capture(host, open(memfs()).owner, p.sha256);
  assert.equal(stored.status, 'STORED'); assert.equal(JSON.stringify(result), before); assert.equal(host.status(), state);
  assert.deepEqual(host.invocations(), calls); assert.equal(report.reportStored, reportStored); assert.equal((await host.settled()), result);
});

test('published preview and malformed-settlement refusal are cached without partial metadata', async t => {
  const {c, result} = await settledHost(t); const access = accessFor(c); access.publish(result);
  const first = access.preview(), second = access.preview(); assert.equal(second, first);
  const malformed = accessFor(c); malformed.publish({...result, ownerStates: {staticChecks: 'ALIEN', tests: 'IDLE'}});
  const refusal = malformed.preview(); assertPreview(refusal, 'REFUSED', 'INVALID_SETTLEMENT');
  assert.equal(refusal.preview, null); assert.equal(refusal.sha256, null);
});

test('internal publication is one-shot and cannot replace an already retained result', async t => {
  const {c, result} = await settledHost(t); const access = accessFor(c); access.publish(result);
  assert.throws(() => access.publish(structuredClone(result)));
  assert.equal(access.preview().preview.runId, result.report.runId);
});
