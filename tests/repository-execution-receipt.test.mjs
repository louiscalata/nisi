// PRIVATE pure-contract fixtures. runWorkflow executes synthetic callbacks only;
// no candidate process, Swift tool, model, filesystem admission or sandbox.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneFreeze, createCandidate, sha256Text, stableStringify } from '../workflow/contracts.mjs';
import { runWorkflow } from '../workflow/engine.mjs';
import { createRepositorySnapshot, prepareRepositoryCandidate } from '../hosts/repository/snapshot-contract.mjs';
import { createExecutionExpectation, readExecutionReceipt, createHostRunBundle, readHostRunBundle } from '../receipts/repository-execution-v1.mjs';

const runId = '12345678-1234-4234-8234-123456789abc';
const otherRunId = '12345678-1234-4234-8234-123456789abd';
const hash = text => sha256Text(text);
const copy = value => structuredClone(value);
const rejects = (fn, code) => assert.throws(fn, e => e.code === code);
const task = () => ({ taskId: 'fixture.receipt', mode: 'review', language: 'javascript',
  allowedFiles: ['main.mjs', 'test.mjs'], protectedFiles: ['test.mjs'],
  protectedSnapshots: { 'test.mjs': hash('fixed tests') }, acceptanceCriteria: ['A fixed requirement'],
  policy: { repairBudget: 1, totalDeadlineMs: 2000, requiredReviewers: 1, requireReportStore: false } });
const candidate = () => ({ files: [{ path: 'main.mjs', content: 'changed' }] });
const preparation = (extra = 'original') => prepareRepositoryCandidate({
  baseline: createRepositorySnapshot({ files: [{ path: 'main.mjs', content: 'original' },
    { path: 'test.mjs', content: 'fixed tests' }, { path: 'other.txt', content: extra }] }),
  task: task(), candidate: candidate(), authorId: 'author.fixture' });
const profile = () => ({ id: 'fixture.check', version: 1, rulesetSha256: hash('rules'), sourceSha256: hash('source'),
  buildSha256: hash('build'), executableSha256: hash('executable'), argv: ['--test', 'test.mjs'],
  environmentSha256: hash('allowlisted environment profile, not values'), cwd: '.', platform: 'darwin', architecture: 'arm64',
  timeoutMs: 1000, maximumOutputBytes: 1024 });
const expectation = (overrides = {}) => createExecutionExpectation({ preparation: preparation(), runId,
  attempt: 0, checkId: 'check.fixture', stage: 'staticChecks', profile: profile(), ...overrides });
const emptyOutput = () => ({ capturedBytes: 0, observedBytes: 0, sha256: hash(''), truncated: false });
const receipt = expected => ({ schemaVersion: 1, expectationFingerprint: expected.fingerprint, binding: copy(expected.binding),
  process: { started: true, closed: true, drain: 'CONFIRMED', exitCode: 0, signal: null, errorCode: null,
    deadlineExceeded: false, cancelRequested: false, durationMs: 10 },
  outputs: { stdout: emptyOutput(), stderr: emptyOutput() }, result: { status: 'PASS', reason: '' } });

async function fixture({ status = 'PASS', stop = false, store = false, failedReview = false, interrupt = null } = {}) {
  const prep = preparation();
  const controller = new AbortController(); let now = 0;
  const expectations = [], receipts = [];
  const callback = name => payload => {
    const e = expectation({ preparation: prep, runId: payload.binding.runId, attempt: payload.binding.attempt,
      stage: name, checkId: `fixture.${name.toLowerCase()}` });
    expectations.push(e);
    const r = receipt(e);
    const current = name === 'tests' ? status : 'PASS';
    r.result = { status: current, reason: current === 'PASS' ? '' : 'fixture adverse evidence' };
    if (current === 'FAIL') r.process.exitCode = 1;
    if (current === 'NOT_RUN') Object.assign(r.process, { started: false, closed: false, drain: 'NOT_APPLICABLE', exitCode: null, durationMs: 0 });
    if (current === 'ERROR') r.process.errorCode = 'FIXTURE_ERROR';
    if (current === 'INCONCLUSIVE') r.process.drain = 'UNKNOWN';
    receipts.push(r);
    if (stop && name === 'tests') { r.result = { status: 'ERROR', reason: 'ADAPTER_EXCEPTION' }; r.process.errorCode = 'ADAPTER_EXCEPTION'; throw new Error('fixture stop'); }
    if (interrupt && name === 'tests') {
      r.result = { status: 'INCONCLUSIVE', reason: interrupt === 'cancel' ? 'ABORTED' : 'DEADLINE_EXCEEDED' };
      r.process.cancelRequested = true; r.process.drain = 'UNKNOWN';
      if (interrupt === 'cancel') controller.abort(); else now = 2000;
    }
    const resultStatus = ['ERROR', 'INCONCLUSIVE'].includes(current) ? 'UNAVAILABLE' : current;
    const findings = current === 'FAIL' ? [{ code: 'FIXTURE_FAILED', message: 'fixture finding' }] : [];
    return { status: resultStatus, evidence: { ...payload.binding, reason: r.result.reason,
      ...(name === 'tests' ? { assertionsExecuted: ['PASS', 'FAIL'].includes(current) ? 1 : 0,
        assertionsPassed: current === 'PASS' ? 1 : 0, failures: findings } : { findings }) } };
  };
  let preliminary;
  const report = await runWorkflow(task(), { candidate: candidate(), candidateAuthorId: 'author.fixture', clock: () => now, signal: controller.signal,
    adapters: { authorizeContext: { authorize: p => ({ status: 'PASS', evidence: { ...p.binding, reason: '' } }) },
      staticChecks: { check: callback('staticChecks') }, tests: { run: callback('tests') },
      reviewers: [{ id: 'reviewer.fixture', review: p => ({ status: failedReview ? 'FAIL' : 'PASS', evidence: {
        ...p.binding, reviewerId: 'reviewer.fixture', reason: failedReview ? 'review failed' : '', summary: 'Synthetic fixture only',
        findings: failedReview ? [{ code: 'FIXTURE', message: 'review issue' }] : [] } }) }] },
    ...(store ? { reportStore: { store: p => { preliminary = p.report; return { status: 'PASS', evidence: {
      ...p.binding, outcome: p.report.outcome, reportSha256: p.reportSha256 } }; } } } : {}) });
  return { context: { report, expectations }, receipts, preliminary };
}

test('execution expectations require issued preparations and preserve immutable distinct identities', () => {
  const p = preparation();
  rejects(() => expectation({ preparation: copy(p) }), 'EXECUTION_PREPARATION_NOT_ISSUED');
  rejects(() => expectation({ preparation: { ...p, authorizing: true } }), 'EXECUTION_PREPARATION_NOT_ISSUED');
  const inputProfile = profile(); const e = expectation({ preparation: p, profile: inputProfile });
  inputProfile.argv.reverse();
  assert.deepEqual([...e.profile.argv], ['--test', 'test.mjs']);
  assert.throws(() => { e.binding.attempt = 1; }, TypeError);
  assert.equal(e.authorizing, false);
  assert.notEqual(e.binding.candidateFingerprint, e.binding.materializedFingerprint);
  assert.equal(e.fingerprint, expectation({ preparation: p }).fingerprint);
  rejects(() => readExecutionReceipt(receipt(e), copy(e)), 'EXECUTION_EXPECTATION_NOT_ISSUED');
});

test('profiles reject shell-shaped argv, ambiguous cwd, malformed values and extra authority', () => {
  for (const change of [{ cwd: '../outside' }, { cwd: '/tmp' }, { argv: 'node --test' },
    { argv: ['\0'] }, { argv: ['\ud800'] }, { argv: ['a'.repeat(1025)] }, { argv: Array(33).fill('a') },
    { argv: [true] }, { timeoutMs: 0 }, { timeoutMs: 86_400_001 }, { maximumOutputBytes: 1_048_577 },
    { executableSha256: 'invalid' }, { version: '1' }, { platform: 'unknown' }, { architecture: 'unknown' }]) {
    assert.throws(() => expectation({ profile: { ...profile(), ...change } }));
  }
  rejects(() => expectation({ profile: { ...profile(), authorizing: true } }), 'EXECUTION_PROFILE_SCHEMA');
  for (const change of [{ runId: 'fake' }, { attempt: -1 }, { attempt: 2 }, { checkId: '' }, { stage: 'repair' }]) {
    rejects(() => expectation(change), 'EXECUTION_EXPECTATION_INVALID');
  }
});

test('receipt identity rejects each cross-run candidate snapshot profile and command substitution', () => {
  const e = expectation();
  for (const key of Object.keys(e.binding)) {
    const r = receipt(e); r.binding[key] = typeof r.binding[key] === 'number' ? r.binding[key] + 1 : 'different';
    rejects(() => readExecutionReceipt(r, e), 'EXECUTION_BINDING_MISMATCH');
  }
  for (const change of [{ runId: otherRunId }, { attempt: 1 }, { preparation: preparation('different dependency') },
    { profile: { ...profile(), argv: ['test.mjs', '--test'] } }, { profile: { ...profile(), rulesetSha256: hash('other') } }]) {
    rejects(() => readExecutionReceipt(receipt(e), expectation(change)), 'EXECUTION_BINDING_MISMATCH');
  }
});

test('receipt schemas reject getters hidden fields symbols prototypes and missing data without invocation', () => {
  const e = expectation(); let reads = 0;
  const getter = receipt(e); Object.defineProperty(getter.process, 'started', { get() { reads++; return true; } });
  rejects(() => readExecutionReceipt(getter, e), 'EXECUTION_PROCESS_SCHEMA');
  const hidden = receipt(e); Object.defineProperty(hidden, 'authorizing', { value: true });
  const symbol = receipt(e); symbol[Symbol('x')] = true;
  const missing = receipt(e); delete missing.process.drain;
  for (const r of [hidden, symbol, { ...receipt(e), authorizing: true }, Object.create(receipt(e))]) {
    rejects(() => readExecutionReceipt(r, e), 'EXECUTION_RECEIPT_SCHEMA');
  }
  rejects(() => readExecutionReceipt(missing, e), 'EXECUTION_PROCESS_SCHEMA');
  assert.equal(reads, 0);
});

test('PASS requires confirmed drain even when the child reports exit zero', () => {
  const e = expectation(); const r = receipt(e); r.process.drain = 'UNKNOWN';
  rejects(() => readExecutionReceipt(r, e), 'EXECUTION_RESULT_CONTRADICTION');
});

test('passing and failed checks cannot hide interruption truncation error or unclosed execution', () => {
  const e = expectation();
  const changes = [{ exitCode: 1 }, { deadlineExceeded: true }, { cancelRequested: true }, { errorCode: 'EIO' },
    { durationMs: 1000 }, { closed: false, exitCode: null, drain: 'UNKNOWN' }, { exitCode: null, signal: 'SIGTERM' }];
  for (const change of changes) {
    const r = receipt(e); Object.assign(r.process, change);
    rejects(() => readExecutionReceipt(r, e), 'EXECUTION_RESULT_CONTRADICTION');
  }
  for (const status of ['PASS', 'FAIL']) {
    const r = receipt(e); r.result = { status, reason: status === 'PASS' ? '' : 'semantic failure' };
    r.outputs.stdout = { capturedBytes: 0, observedBytes: 1, sha256: hash(''), truncated: true };
    rejects(() => readExecutionReceipt(r, e), 'EXECUTION_RESULT_CONTRADICTION');
  }
  const fail = receipt(e); fail.result = { status: 'FAIL', reason: 'semantic assertion failed despite exit 0' };
  assert.equal(readExecutionReceipt(fail, e).result.status, 'FAIL');
  fail.result.reason = ''; rejects(() => readExecutionReceipt(fail, e), 'EXECUTION_RESULT_INVALID');
});

test('contradictory process states are refused even in adverse receipts', () => {
  const e = expectation();
  for (const change of [{ started: false }, { signal: 'SIGTERM' }, { closed: false },
    { drain: 'NOT_APPLICABLE' }, { started: false, closed: false, drain: 'NOT_APPLICABLE', exitCode: null }]) {
    const r = receipt(e); r.result = { status: 'INCONCLUSIVE', reason: 'unknown state' }; Object.assign(r.process, change);
    rejects(() => readExecutionReceipt(r, e), 'EXECUTION_PROCESS_CONTRADICTION');
  }
  for (const change of [{ started: 1 }, { closed: 'true' }, { durationMs: NaN }, { durationMs: -1 },
    { exitCode: -1 }, { exitCode: 1.5 }, { signal: 'TERM' }, { drain: null }, { errorCode: true }]) {
    const r = receipt(e); Object.assign(r.process, change);
    rejects(() => readExecutionReceipt(r, e), 'EXECUTION_PROCESS_INVALID');
  }
});

test('NOT_RUN ERROR and INCONCLUSIVE retain distinct non-success semantics', () => {
  const e = expectation(); const r = receipt(e);
  Object.assign(r.process, { started: false, closed: false, drain: 'NOT_APPLICABLE', exitCode: null, durationMs: 0 });
  r.result = { status: 'NOT_RUN', reason: 'runner unavailable' };
  assert.equal(readExecutionReceipt(r, e).result.status, 'NOT_RUN');
  r.process.errorCode = 'SPAWN_FAILED';
  rejects(() => readExecutionReceipt(r, e), 'EXECUTION_RESULT_CONTRADICTION');
  r.result.status = 'ERROR'; assert.equal(readExecutionReceipt(r, e).result.status, 'ERROR');
  r.process.errorCode = null; rejects(() => readExecutionReceipt(r, e), 'EXECUTION_RESULT_CONTRADICTION');
  r.result.status = 'INCONCLUSIVE'; assert.equal(readExecutionReceipt(r, e).result.status, 'INCONCLUSIVE');
  Object.assign(r.process, { started: true, drain: 'UNKNOWN', cancelRequested: true });
  assert.equal(readExecutionReceipt(r, e).process.closed, false);
});

test('output summaries enforce byte bounds digest shape and exact truncation without inventing content proof', () => {
  const e = expectation();
  for (const change of [{ capturedBytes: 1025, observedBytes: 1025 }, { observedBytes: -1 },
    { sha256: hash('not empty') }, { capturedBytes: 1 }, { truncated: true }, { observedBytes: 1 }, { sha256: 'fake' }]) {
    const r = receipt(e); Object.assign(r.outputs.stdout, change);
    rejects(() => readExecutionReceipt(r, e), 'EXECUTION_OUTPUT_INVALID');
  }
  const r = receipt(e); r.outputs.stdout = { capturedBytes: 1024, observedBytes: 1024, sha256: hash('x'.repeat(1024)), truncated: false };
  assert.equal(readExecutionReceipt(r, e).outputs.stdout.capturedBytes, 1024);
  Object.assign(r.process, { started: false, closed: false, drain: 'NOT_APPLICABLE', exitCode: null, durationMs: 0 });
  r.result = { status: 'NOT_RUN', reason: 'not run' };
  rejects(() => readExecutionReceipt(r, e), 'EXECUTION_UNSTARTED_OUTPUT');
});

test('bundle links synthetic workflow records without changing v1 completion or granting authority', async () => {
  const f = await fixture(); const before = stableStringify(f.context.report);
  const b = createHostRunBundle(f.context, f.receipts); const result = readHostRunBundle(b, f.context);
  assert.equal(f.context.report.outcome, 'COMPLETED'); assert.equal(result.status, 'CONSISTENT');
  assert.equal(result.allChecksReportedPass, true); assert.equal(result.receiptCount, 2);
  assert.equal(result.executionVerified, false); assert.equal(result.authorizing, false);
  assert.equal(stableStringify(f.context.report), before);
  assert.throws(() => { b.receipts[0].process.exitCode = 1; }, TypeError);
  assert.equal(readHostRunBundle(copy(b), f.context).status, 'CONSISTENT');
});

test('bundle binds final report digest not the preliminary store acknowledgement', async () => {
  const f = await fixture({ store: true }); const b = createHostRunBundle(f.context, f.receipts);
  assert.equal(f.context.report.reportStored, true);
  assert.equal(f.context.report.storedReportSha256, hash(`nisi/run-report/v1\0${stableStringify(f.preliminary)}`));
  assert.equal(b.reportSha256, hash(`nisi/host-final-report/v1\0${stableStringify(f.context.report)}`));
  assert.notEqual(b.reportSha256, f.context.report.storedReportSha256);
  const changed = { ...f.context, report: cloneFreeze({ ...f.context.report, reportStoreCode: 'CHANGED' }) };
  rejects(() => readHostRunBundle(b, changed), 'HOST_REPORT_DIGEST_MISMATCH');
  rejects(() => readHostRunBundle({ ...b, reportSha256: f.context.report.storedReportSha256 }, f.context), 'HOST_REPORT_DIGEST_MISMATCH');
});

test('bundle refuses extra missing duplicate reordered and cross-linked receipt inventories', async () => {
  const f = await fixture(); const b = createHostRunBundle(f.context, f.receipts);
  for (const receipts of [[], f.receipts.slice(1), [...f.receipts, f.receipts[0]]]) {
    rejects(() => createHostRunBundle(f.context, receipts), 'HOST_RECEIPT_INVENTORY');
    rejects(() => readHostRunBundle({ ...b, receipts }, f.context), 'HOST_RECEIPT_INVENTORY');
  }
  for (const receipts of [[f.receipts[0], f.receipts[0]], [...f.receipts].reverse()]) {
    rejects(() => readHostRunBundle({ ...b, receipts }, f.context), 'EXECUTION_BINDING_MISMATCH');
  }
  rejects(() => readHostRunBundle(b, { ...f.context, expectations: [] }), 'HOST_EXPECTATION_INVENTORY');
  const decorated = [...f.receipts]; decorated.authorizing = true;
  rejects(() => readHostRunBundle({ ...b, receipts: decorated }, f.context), 'HOST_RECEIPTS_INVALID');
});

test('bundle refuses stage status contradictions even with a recomputed bundle digest', async () => {
  const f = await fixture(); const b = copy(createHostRunBundle(f.context, f.receipts));
  b.receipts[1].result = { status: 'FAIL', reason: 'test failed' }; b.receipts[1].process.exitCode = 1;
  b.fingerprint = hash(`nisi/host-run-bundle/v1\0${stableStringify({ schemaVersion: b.schemaVersion, reportSha256: b.reportSha256, receipts: b.receipts })}`);
  rejects(() => readHostRunBundle(b, f.context), 'HOST_STAGE_STATUS_MISMATCH');
});

test('adverse receipts and engine exception stops remain readable without PASS coercion', async () => {
  for (const status of ['FAIL', 'NOT_RUN', 'ERROR', 'INCONCLUSIVE']) {
    const f = await fixture({ status });
    const result = readHostRunBundle(createHostRunBundle(f.context, f.receipts), f.context);
    assert.equal(result.allChecksReportedPass, false);
    assert.equal(f.context.report.outcome, status === 'FAIL' ? 'FAILED' : 'BLOCKED');
  }
  const f = await fixture({ stop: true }); const stage = f.context.report.stages.find(s => s.stage === 'tests');
  assert.equal(stage.code, 'ADAPTER_EXCEPTION'); assert.equal(stage.evidence.assertionsExecuted, undefined);
  assert.equal(readHostRunBundle(createHostRunBundle(f.context, f.receipts), f.context).allChecksReportedPass, false);
});

test('all checks passing does not imply a completed workflow or a releasable product', async () => {
  const f = await fixture({ failedReview: true }); assert.equal(f.context.report.outcome, 'FAILED');
  const r = readHostRunBundle(createHostRunBundle(f.context, f.receipts), f.context);
  assert.equal(r.allChecksReportedPass, true); assert.equal(r.authorizing, false); assert.equal(r.executionVerified, false);
});

test('bundle rejects stale expected run attempt or snapshot and malformed authority fields', async () => {
  const f = await fixture(); const b = createHostRunBundle(f.context, f.receipts);
  for (const change of [{ runId: otherRunId }, { attempt: 1 }]) {
    const expectations = [...f.context.expectations]; expectations[0] = expectation({ ...change, checkId: 'fixture.staticchecks' });
    rejects(() => readHostRunBundle(b, { ...f.context, expectations }), 'HOST_STAGE_BINDING_MISMATCH');
  }
  const expectations = [...f.context.expectations];
  expectations[1] = expectation({ preparation: preparation('different'), runId: f.context.report.runId, stage: 'tests', checkId: 'fixture.tests' });
  rejects(() => readHostRunBundle(b, { ...f.context, expectations }), 'HOST_SNAPSHOT_MISMATCH');
  rejects(() => readHostRunBundle({ ...b, authorizing: true }, f.context), 'HOST_BUNDLE_SCHEMA');
  rejects(() => readHostRunBundle({ ...b, fingerprint: hash('forged') }, f.context), 'HOST_BUNDLE_DIGEST_MISMATCH');
  rejects(() => readHostRunBundle({ ...b, schemaVersion: 2 }, f.context), 'HOST_REPORT_DIGEST_MISMATCH');
});

test('cancellation and deadlines retain UNAVAILABLE and refuse a late passing receipt', async () => {
  for (const interrupt of ['cancel', 'timeout']) {
    const f = await fixture({ interrupt });
    assert.equal(f.context.report.outcome, interrupt === 'cancel' ? 'CANCELLED' : 'TIMED_OUT');
    assert.equal(f.context.report.stages.at(-1).status, 'UNAVAILABLE');
    assert.equal(readHostRunBundle(createHostRunBundle(f.context, f.receipts), f.context).allChecksReportedPass, false);
    const late = [...f.receipts]; late[1] = receipt(f.context.expectations[1]);
    rejects(() => createHostRunBundle(f.context, late), 'HOST_STAGE_STATUS_MISMATCH');
  }
});

test('repaired candidates require fresh receipts while adverse attempt history remains intact', async () => {
  const t = { ...task(), mode: 'edit' }; const base = preparation().baseline;
  const first = candidate(); const repaired = { files: [{ path: 'main.mjs', content: 'repaired' }] };
  const authorId = 'author.fixture'; const fingerprint = c => createCandidate(c, { authorId }).fingerprint;
  const expectations = [], receipts = [];
  const check = name => p => {
    const prep = prepareRepositoryCandidate({ baseline: base, task: t, candidate: { files: p.candidate.files }, authorId });
    const e = expectation({ preparation: prep, runId: p.binding.runId, attempt: p.binding.attempt, stage: name });
    expectations.push(e); const r = receipt(e); receipts.push(r);
    const fail = name === 'tests' && p.binding.attempt === 0;
    if (fail) { r.result = { status: 'FAIL', reason: 'first candidate failed' }; r.process.exitCode = 1; }
    return { status: r.result.status, evidence: { ...p.binding, reason: r.result.reason,
      ...(name === 'tests' ? { assertionsExecuted: 1, assertionsPassed: fail ? 0 : 1,
        failures: fail ? [{ code: 'ASSERTION', message: 'fixture failure' }] : [] } : { findings: [] }) } };
  };
  const report = await runWorkflow(t, { adapters: {
    authorizeContext: { authorize: p => ({ status: 'PASS', evidence: { ...p.binding, reason: '' } }) },
    author: { id: authorId,
      draft: p => ({ candidate: first, evidence: { ...p.binding, candidateFingerprint: fingerprint(first), note: 'fixture draft' } }),
      repair: p => ({ status: 'REPAIRED', candidate: repaired, evidence: { ...p.binding,
        candidateFingerprint: fingerprint(repaired), baseCandidateFingerprint: p.candidate.fingerprint, note: 'fixture repair' } }) },
    staticChecks: { check: check('staticChecks') }, tests: { run: check('tests') },
    reviewers: [{ id: 'reviewer.fixture', review: p => ({ status: 'PASS', evidence: { ...p.binding,
      reviewerId: 'reviewer.fixture', reason: '', findings: [], summary: 'Synthetic fixture review' } }) }],
  } });
  assert.equal(report.outcome, 'COMPLETED'); assert.equal(report.repairAttempts, 1);
  const context = { report, expectations }; const bundle = createHostRunBundle(context, receipts);
  const result = readHostRunBundle(bundle, context);
  assert.equal(result.receiptCount, 4); assert.equal(result.allChecksReportedPass, false); // history includes the genuine fixture FAIL
  assert.notEqual(expectations[0].binding.materializedFingerprint, expectations[2].binding.materializedFingerprint);
  assert.equal(bundle.receipts[1].result.status, 'FAIL');
  rejects(() => createHostRunBundle(context, [...receipts.slice(0, 2), ...receipts.slice(0, 2)]), 'EXECUTION_BINDING_MISMATCH');
});

test('bundle preserves adverse reasons and exact exception cancellation and deadline classifications', async () => {
  const failed = await fixture({ status: 'FAIL' }); failed.receipts[1].result.reason = 'different failure';
  rejects(() => createHostRunBundle(failed.context, failed.receipts), 'HOST_STAGE_REASON_MISMATCH');
  const stopped = await fixture({ stop: true });
  const changedCode = copy(stopped.receipts); changedCode[1].process.errorCode = 'UNRELATED';
  rejects(() => createHostRunBundle(stopped.context, changedCode), 'HOST_STAGE_STOP_MISMATCH');
  const downgraded = copy(stopped.receipts); downgraded[1].result.status = 'INCONCLUSIVE';
  downgraded[1].process.errorCode = null; downgraded[1].process.drain = 'UNKNOWN';
  rejects(() => createHostRunBundle(stopped.context, downgraded), 'HOST_STAGE_STOP_MISMATCH');
  for (const interrupt of ['cancel', 'timeout']) {
    const f = await fixture({ interrupt });
    f.receipts[1].process.cancelRequested = false;
    rejects(() => createHostRunBundle(f.context, f.receipts), 'HOST_STAGE_STOP_MISMATCH');
  }
});
