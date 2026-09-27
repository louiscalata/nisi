import test from 'node:test';
import assert from 'node:assert/strict';
import { createCandidate, createTaskSpecification, runWorkflow } from '../workflow/engine.mjs';
import { cloneFreeze, sha256Text, stableStringify } from '../workflow/contracts.mjs';

const BASE_TEXT = 'export const answer = 42;\n';
const refuses = (fn, code) => assert.throws(fn, { name: 'WorkflowInputError', code });
const file = content => ({ path: 'src/app.js', content });
const makeTask = (mode = 'edit', overrides = {}) => ({
  taskId: 'task.one', mode, language: 'javascript', allowedFiles: ['src/app.js', 'test/app.test.js'],
  protectedFiles: [], protectedSnapshots: {}, acceptanceCriteria: ['answer is 42'],
  policy: { repairBudget: 1, totalDeadlineMs: 2000, requiredReviewers: 1, requireReportStore: false }, ...overrides,
});

function candidate(raw = BASE_TEXT, authorId = 'author.one') {
  return createCandidate({ files: [file(raw)] }, { authorId });
}

function passAuthorize(task, binding) {
  return { status: 'PASS', evidence: { ...binding, reason: '' } };
}

function passChecks(binding) {
  return { status: 'PASS', evidence: { ...binding, findings: [], reason: '' } };
}

function passTests(binding) {
  return { status: 'PASS', evidence: { ...binding, assertionsExecuted: 2, assertionsPassed: 2, failures: [], reason: '' } };
}

function passReview(binding, reviewerId) {
  return { status: 'PASS', evidence: { ...binding, reviewerId, findings: [], summary: 'accepted', reason: '' } };
}

function failChecks(binding) {
  return { status: 'FAIL', evidence: { ...binding, findings: [{ code: 'LINT', message: 'bad' }], reason: 'lint' } };
}

function failTests(failures = [{ code: 'X', message: 'x' }], reason = 'failed') {
  return binding => ({ status: 'FAIL', evidence: { ...binding, assertionsExecuted: 2, assertionsPassed: 1, failures, reason } });
}

function adapters({ authorId = 'author.one', source = BASE_TEXT, events = [], mutate = null,
  checks = passChecks, tests = passTests, review = passReview, repair = null } = {}) {
  const author = {
    id: authorId,
    async draft({ task, binding, candidate: supplied }) {
      events.push('draft');
      const made = candidate(source, authorId);
      return { candidate: { files: [file(source)] }, evidence: { ...binding, candidateFingerprint: made.fingerprint, note: 'drafted' } };
    },
  };
  author.repair = repair ?? (async ({ candidate: current, binding }) => ({
    status: 'NO_CHANGE', candidate: null,
    evidence: { ...binding, baseCandidateFingerprint: current.fingerprint, note: 'unchanged' },
  }));
  return {
    authorizeContext: { async authorize({ task, binding }) { events.push('authorize'); return passAuthorize(task, binding); } },
    author,
    staticChecks: { async check({ task, candidate: current, binding }) { events.push('checks'); mutate?.({ task, candidate: current }); return checks(binding); } },
    tests: { async run({ candidate: current, binding }) { events.push('tests'); return tests(binding); } },
    reviewers: [{ id: 'reviewer.one', async review({ candidate: current, binding }) { events.push('review'); return review(binding, 'reviewer.one'); } }],
  };
}

test('normal edit mode produces a bound completed report', async () => {
  const report = await runWorkflow(makeTask(), { adapters: adapters() });
  assert.equal(report.outcome, 'COMPLETED');
  assert.equal(report.workflowOutcome, 'COMPLETED');
  assert.equal(report.code, null);
  assert.equal(report.workflowCode, null);
  assert.match(report.runId, /^[0-9a-f-]{36}$/);
  assert.match(report.taskFingerprint, /^[0-9a-f]{64}$/);
  assert.deepEqual(report.stages.map(stage => stage.stage), ['intake', 'authorizeContext', 'draft', 'staticChecks', 'tests', 'review']);
  assert.equal(new Set(report.stages.map(stage => stage.evidence.runId)).size, 1);
  assert.equal(new Set(report.stages.map(stage => stage.evidence.taskFingerprint)).size, 1);
  assert.equal(report.stages.at(-1).evidence.candidateFingerprint, report.candidateFingerprint);
});

test('review mode validates the supplied candidate and never invokes draft or repair', async () => {
  const events = [];
  const supplied = { files: [file('export const answer = 7;\n')] };
  const report = await runWorkflow(makeTask('review'), { adapters: adapters({ events }), candidate: supplied, candidateAuthorId: 'author.one' });
  assert.equal(report.outcome, 'COMPLETED');
  assert.deepEqual(events, ['authorize', 'checks', 'tests', 'review']);
  assert.equal(report.candidate.files[0].content, 'export const answer = 7;\n');
});

test('a repair reruns all checks, tests, and reviewers with a new attempt binding', async () => {
  const events = [];
  let checkCount = 0;
  const nextText = `${BASE_TEXT}export const fixed = true;\n`;
  const repair = async ({ candidate: current, binding }) => {
    const next = candidate(nextText);
    return { status: 'REPAIRED', candidate: { files: [file(nextText)] }, evidence: {
      ...binding, candidateFingerprint: next.fingerprint, baseCandidateFingerprint: current.fingerprint, note: 'fixed',
    } };
  };
  const a = adapters({ events, repair, checks: binding => {
    checkCount += 1;
    return checkCount === 1 ? { status: 'FAIL', evidence: { ...binding, findings: [{ code: 'LINT', message: 'bad' }], reason: 'lint' } } : passChecks(binding);
  } });
  const report = await runWorkflow(makeTask(), { adapters: a });
  assert.equal(report.outcome, 'COMPLETED');
  assert.deepEqual(events, ['authorize', 'draft', 'checks', 'checks', 'tests', 'review']);
  assert.equal(report.repairAttempts, 1);
  assert.equal(report.stages.filter(stage => stage.stage === 'repair')[0].evidence.attempt, 1);
  assert.equal(report.stages.filter(stage => stage.stage === 'staticChecks')[1].evidence.attempt, 1);
});

test('failed, unavailable, and not-run statuses remain non-successes with distinct outcomes', async () => {
  const failed = adapters({
    checks: binding => ({
      status: 'FAIL',
      evidence: { ...binding, findings: [{ code: 'LINT', message: 'bad' }], reason: 'bad' },
    }),
  });
  const failedReport = await runWorkflow(makeTask('edit', { policy: { repairBudget: 0, totalDeadlineMs: 2000, requiredReviewers: 1, requireReportStore: false } }), { adapters: failed });
  assert.equal(failedReport.outcome, 'FAILED');
  assert.equal(failedReport.code, 'STATIC_CHECKS_FAILED');
  const unavailable = adapters({ checks: binding => ({ status: 'UNAVAILABLE', evidence: { ...binding, findings: [], reason: 'checker unavailable' } }) });
  const unavailableReport = await runWorkflow(makeTask(), { adapters: unavailable });
  assert.equal(unavailableReport.outcome, 'BLOCKED'); assert.equal(unavailableReport.code, 'STATIC_CHECKS_UNAVAILABLE');
  const notRun = adapters({ checks: binding => ({ status: 'NOT_RUN', evidence: { ...binding, findings: [], reason: 'not requested' } }) });
  const notRunReport = await runWorkflow(makeTask(), { adapters: notRun });
  assert.equal(notRunReport.outcome, 'BLOCKED'); assert.equal(notRunReport.code, 'STATIC_CHECKS_NOT_RUN');
});

test('repair budget, no progress, and repeated fingerprints are explicit', async () => {
  const noProgress = await runWorkflow(makeTask(), { adapters: adapters({ checks: binding => ({ status: 'FAIL', evidence: { ...binding, findings: [{ code: 'X', message: 'x' }], reason: 'x' } }) }) });
  assert.equal(noProgress.outcome, 'NO_PROGRESS');
  let n = 0;
  const changing = adapters({ checks: binding => ({ status: 'FAIL', evidence: { ...binding, findings: [{ code: 'X', message: 'x' }], reason: 'x' } }), repair: async ({ candidate: current, binding }) => {
    n += 1; const text = `${current.files[0].content}${n}`; const next = candidate(text);
    return { status: 'REPAIRED', candidate: { files: [file(text)] }, evidence: { ...binding, candidateFingerprint: next.fingerprint, baseCandidateFingerprint: current.fingerprint, note: 'changed' } };
  } });
  assert.equal((await runWorkflow(makeTask(), { adapters: changing })).outcome, 'REPAIR_LIMIT');
});

test('actual task and candidate mutation attempts fail while frozen snapshots remain unchanged', async () => {
  let taskMutation; let candidateMutation;
  const a = adapters({ mutate: ({ task, candidate: current }) => {
    try { task.acceptanceCriteria.push('mutated'); } catch (error) { taskMutation = error; }
    try { current.files.push(file('bad')); } catch (error) { candidateMutation = error; }
  } });
  const report = await runWorkflow(makeTask(), { adapters: a });
  assert.equal(report.outcome, 'COMPLETED');
  assert.equal(taskMutation instanceof TypeError, true);
  assert.equal(candidateMutation instanceof TypeError, true);
  assert.deepEqual(report.candidate.files.map(item => item.path), ['src/app.js']);
});

test('replay identity binds task, run, attempt, and candidate evidence', async () => {
  const reports = await Promise.all([runWorkflow(makeTask(), { adapters: adapters() }), runWorkflow(makeTask(), { adapters: adapters() })]);
  assert.notEqual(reports[0].runId, reports[1].runId);
  assert.equal(reports[0].taskFingerprint, reports[1].taskFingerprint);
  assert.equal(reports[0].stages[1].evidence.runId, reports[0].runId);
  assert.equal(reports[0].stages[1].evidence.attempt, 0);
  assert.equal(reports[0].stages[1].evidence.candidateFingerprint, null);
});

test('stale or malformed evidence and protected or out-of-scope candidates are blocked with exact codes', async () => {
  const stale = adapters({ checks: binding => ({ status: 'PASS', evidence: { ...binding, candidateFingerprint: '0'.repeat(64), findings: [], reason: '' } }) });
  assert.equal((await runWorkflow(makeTask(), { adapters: stale })).code, 'STATIC_CHECKS_EVIDENCE_STALE');
  const malformed = adapters({ checks: binding => ({ status: 'PASS', evidence: { ...binding, findings: [], reason: '', extra: true } }) });
  assert.equal((await runWorkflow(makeTask(), { adapters: malformed })).code, 'STATIC_CHECKS_EVIDENCE_SCHEMA');
  // Drafts carry their real fingerprint, so only the scope or protection guard can refuse them.
  // createCandidate() takes no task: it fingerprints out-of-scope and changed protected files.
  const candidateOf = files => createCandidate({ files }, { authorId: 'author.one' });
  const drafting = (task, files, fingerprint = candidateOf(files).fingerprint) => {
    const a = adapters();
    a.author.draft = async ({ binding }) => ({ candidate: { files }, evidence: { ...binding, candidateFingerprint: fingerprint, note: 'drafted' } });
    return runWorkflow(task, { adapters: a });
  };
  const traversal = await drafting(makeTask(), [{ path: '../secret.js', content: 'x' }], '0'.repeat(64));
  assert.equal(traversal.outcome, 'BLOCKED'); assert.equal(traversal.code, 'PATH_TRAVERSAL');
  const outside = await drafting(makeTask(), [{ path: 'src/other.js', content: 'x' }]);
  assert.equal(outside.outcome, 'BLOCKED'); assert.equal(outside.code, 'CANDIDATE_FILE_OUT_OF_SCOPE');
  const protectedText = 'assert.equal(answer, 42);\n';
  const protectedTask = makeTask('edit', { allowedFiles: ['src/app.js', 'test/app.test.js'], protectedFiles: ['test/app.test.js'], protectedSnapshots: { 'test/app.test.js': sha256Text(protectedText) } });
  const changed = await drafting(protectedTask, [{ path: 'test/app.test.js', content: 'changed' }]);
  assert.equal(changed.outcome, 'BLOCKED'); assert.equal(changed.code, 'PROTECTED_FILE_CHANGED');
  assert.equal((await drafting(protectedTask, [file(BASE_TEXT), { path: 'test/app.test.js', content: protectedText }])).outcome, 'COMPLETED');
});

test('candidate path, file-count, duplicate, content and total-size limits return exact codes', () => {
  const make = files => createCandidate({ files }, { authorId: 'author.one' });
  refuses(() => createCandidate({ files: [file('a')], extra: true }, { authorId: 'author.one' }), 'CANDIDATE_SCHEMA');
  refuses(() => make([{ path: 'src/app.js' }]), 'CANDIDATE_FILE_SCHEMA');
  refuses(() => make([]), 'CANDIDATE_FILES_INVALID');
  refuses(() => make([file('a'), file('b')]), 'CANDIDATE_DUPLICATE_PATH');
  assert.equal(make([{ path: 'a'.repeat(512), content: '' }]).files[0].path.length, 512);
  refuses(() => make([{ path: 'a'.repeat(513), content: '' }]), 'PATH_INVALID');
  const files = count => Array.from({ length: count }, (_, index) => ({ path: `src/f${index}.js`, content: 'x' }));
  assert.equal(make(files(256)).files.length, 256);
  refuses(() => make(files(257)), 'CANDIDATE_FILES_INVALID');
  const mebibyte = 'x'.repeat(1_048_576);
  refuses(() => make([file(`${mebibyte}x`)]), 'CANDIDATE_CONTENT_INVALID');
  const large = count => files(count).map(item => ({ ...item, content: mebibyte }));
  assert.equal(make(large(8)).files.length, 8);
  refuses(() => make(large(9)), 'CANDIDATE_TOO_LARGE');
  refuses(() => make([{ path: 'src/app.js', content: Buffer.from('x') }]), 'INPUT_OBJECT_INVALID');
});

test('cancellation before and during listener registration prevents adapter calls', async () => {
  const before = new AbortController(); before.abort(); let beforeCalled = false;
  const beforeAdapters = adapters({ events: [] }); beforeAdapters.authorizeContext.authorize = async () => { beforeCalled = true; return null; };
  assert.equal((await runWorkflow(makeTask(), { adapters: beforeAdapters, signal: before.signal })).outcome, 'CANCELLED');
  assert.equal(beforeCalled, false);

  const during = new AbortController(); let duringCalled = false;
  const originalAdd = during.signal.addEventListener.bind(during.signal);
  during.signal.addEventListener = (...args) => { originalAdd(...args); during.abort(); };
  const duringAdapters = adapters(); duringAdapters.authorizeContext.authorize = async () => { duringCalled = true; return null; };
  const report = await runWorkflow(makeTask(), { adapters: duringAdapters, signal: during.signal });
  assert.equal(report.outcome, 'CANCELLED'); assert.equal(duringCalled, false);
});

test('async timeout and synchronous clock advancement are timed out before later adapters', async () => {
  const slow = adapters(); let checksCalled = false;
  slow.authorizeContext.authorize = () => new Promise(() => {});
  slow.staticChecks.check = async () => { checksCalled = true; return null; };
  const timed = await runWorkflow(makeTask('edit', { policy: { repairBudget: 0, totalDeadlineMs: 15, requiredReviewers: 1, requireReportStore: false } }), { adapters: slow });
  assert.equal(timed.outcome, 'TIMED_OUT'); assert.equal(checksCalled, false);

  let now = 0;
  const advanced = adapters();
  advanced.authorizeContext.authorize = async ({ binding }) => { now = 100; return passAuthorize(makeTask(), binding); };
  const syncTimed = await runWorkflow(makeTask('edit', { policy: { repairBudget: 0, totalDeadlineMs: 50, requiredReviewers: 1, requireReportStore: false } }), { adapters: advanced, clock: () => now });
  assert.equal(syncTimed.outcome, 'TIMED_OUT');
});

test('clock regression and deadline overflow fail closed', async () => {
  const values = [10, 11, 10];
  const regressed = await runWorkflow(makeTask(), { adapters: adapters(), clock: () => values.shift() ?? 10 });
  assert.equal(regressed.outcome, 'BLOCKED'); assert.equal(regressed.code, 'CLOCK_INVALID');
  const overflow = await runWorkflow(makeTask('edit', { policy: { repairBudget: 0, totalDeadlineMs: 10, requiredReviewers: 1, requireReportStore: false } }), { adapters: adapters(), clock: () => Number.MAX_SAFE_INTEGER });
  assert.equal(overflow.outcome, 'BLOCKED'); assert.equal(overflow.code, 'CLOCK_INVALID');
});

test('a storage acknowledgement copied after the deadline is rejected even when storage is optional', async () => {
  for (const required of [false, true]) {
    let now = 0;
    let storeSignal;
    const task = makeTask();
    task.policy.totalDeadlineMs = 50;
    task.policy.requireReportStore = required;
    const reportStore = { store({ report, reportSha256, binding, signal }) {
      storeSignal = signal;
      const receipt = { status: 'PASS', evidence: { ...binding, outcome: report.outcome, reportSha256 } };
      return new Proxy(receipt, {
        ownKeys(target) {
          // Advance time during the snapshot without depending on timer scheduling.
          now = 50;
          return Reflect.ownKeys(target);
        },
      });
    } };
    const report = await runWorkflow(task, { adapters: adapters(), reportStore, clock: () => now });
    assert.equal(report.workflowOutcome, 'COMPLETED');
    assert.equal(report.outcome, 'TIMED_OUT');
    assert.equal(report.reportStored, false);
    assert.equal(report.reportStoreCode, 'DEADLINE_EXCEEDED');
    assert.equal(report.reportStoreEvidence, null);
    assert.equal(storeSignal.aborted, true);
  }
});

test('report stores receive exact frozen report and binding hashes; required failure blocks', async () => {
  let received;
  const store = { async store({ report, reportSha256, binding }) {
    received = { report, reportSha256, binding };
    return { status: 'PASS', evidence: { ...binding, outcome: report.outcome, reportSha256 } };
  } };
  const report = await runWorkflow(makeTask(), { adapters: adapters(), reportStore: store });
  assert.equal(report.outcome, 'COMPLETED'); assert.equal(report.reportStored, true);
  assert.equal(received.reportSha256, sha256Text(`nisi/run-report/v1\0${stableStringify(received.report)}`));
  assert.equal(received.report.runId, report.runId);
  assert.equal(Object.isFrozen(received.report), true);
  const failingStore = { async store({ report, binding }) { return { status: 'FAIL', evidence: { ...binding, outcome: report.outcome, reportSha256: '0'.repeat(64) } }; } };
  const required = makeTask('edit', { policy: { repairBudget: 0, totalDeadlineMs: 2000, requiredReviewers: 1, requireReportStore: true } });
  const blocked = await runWorkflow(required, { adapters: adapters(), reportStore: failingStore });
  assert.equal(blocked.outcome, 'BLOCKED'); assert.equal(blocked.reportStored, false);
  assert.equal(blocked.code, 'REPORT_STORE_EVIDENCE_STALE');
});

test('task specification and candidate inputs are frozen and schema-checked', () => {
  const task = createTaskSpecification(makeTask());
  assert.equal(Object.isFrozen(task), true); assert.equal(Object.isFrozen(task.acceptanceCriteria), true);
  assert.throws(() => createTaskSpecification({ ...makeTask(), acceptanceCriteria: [] }), /ACCEPTANCE_CRITERIA_INVALID/);
  assert.throws(() => createTaskSpecification({ ...makeTask(), allowedFiles: ['../bad.js'] }), /PATH_TRAVERSAL/);
  assert.throws(() => createCandidate({ files: [{ path: '/absolute.js', content: 'x' }] }, { authorId: 'author.one' }), /PATH_INVALID/);
});

test('captured reviewer list, IDs and methods survive caller mutation after authorization', async () => {
  const a = adapters();
  const reviewer = a.reviewers[0];
  const initialDraft = a.author.draft;
  a.author.draft = async payload => {
    reviewer.id = 'author.one';
    reviewer.review = () => { throw new Error('replacement must not run'); };
    a.reviewers.length = 0;
    a.reviewers.push({ id: 'author.one', review: reviewer.review });
    a.tests.run = () => { throw new Error('replacement must not run'); };
    return initialDraft(payload);
  };
  const report = await runWorkflow(makeTask(), { adapters: a });
  assert.equal(report.outcome, 'COMPLETED');
  const reviews = report.stages.filter(stage => stage.stage === 'review');
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].evidence.reviewerId, 'reviewer.one');
});

test('reviewers receive immutable fresh check and test evidence; all required reviewers run', async () => {
  const a = adapters();
  a.reviewers = ['reviewer.one', 'reviewer.two'].map(id => ({ id, review({ checks, tests, binding, reviewerId }) {
    for (const result of [checks, tests]) {
      assert.equal(result.status, 'PASS');
      assert.equal(result.evidence.candidateFingerprint, binding.candidateFingerprint);
      assert.ok(Object.isFrozen(result));
      assert.ok(Object.isFrozen(result.evidence));
    }
    return passReview(binding, reviewerId);
  } }));
  const task = makeTask(); task.policy.requiredReviewers = 2;
  assert.equal((await runWorkflow(task, { adapters: a })).stages.filter(stage => stage.stage === 'review').length, 2);
});

test('captured evidence cannot replay across task, run, candidate or repair attempt', async () => {
  let captured;
  const first = adapters({ checks: binding => { captured = passChecks(binding); return captured; } });
  assert.equal((await runWorkflow(makeTask(), { adapters: first })).outcome, 'COMPLETED');
  for (const changed of [makeTask(), makeTask('edit', { taskId: 'task.two' }),
    makeTask('edit', { acceptanceCriteria: ['returns something else'] }),
    makeTask('edit', { language: 'typescript' }), makeTask('edit', { allowedFiles: ['src/app.js'] })]) {
    assert.equal((await runWorkflow(changed, { adapters: adapters({ checks: () => captured }) })).code, 'STATIC_CHECKS_EVIDENCE_STALE');
  }
  for (const key of ['runId', 'taskFingerprint', 'attempt', 'candidateFingerprint']) {
    const report = await runWorkflow(makeTask(), { adapters: adapters({ checks: binding => ({
      status: 'PASS', evidence: { ...binding, [key]: key === 'attempt' ? 99 : 'stale', findings: [], reason: '' },
    }) }) });
    assert.equal(report.code, 'STATIC_CHECKS_EVIDENCE_STALE');
  }
});

test('test status and assertion count invariants reject contradictory evidence', async () => {
  for (const [status, executed, passed, failures, code] of [
    ['PASS', 0, 0, [], 'NO_TEST_ASSERTIONS_EXECUTED'], ['PASS', 2, 1, [], 'NO_TEST_ASSERTIONS_EXECUTED'],
    ['FAIL', 1, 1, [{code: 'X', message: 'x'}], 'TEST_FAILURE_EVIDENCE_INVALID'],
    ['FAIL', 0, 0, [{code: 'X', message: 'x'}], 'TEST_FAILURE_EVIDENCE_INVALID'],
    ['FAIL', 1, 0, [], 'TESTS_FAIL_WITHOUT_FINDINGS'], ['PASS', 1, 1, [{code: 'X', message: 'x'}], 'TESTS_PASS_WITH_FINDINGS'],
    ['NOT_RUN', 1, 1, [], 'TEST_NOT_RUN_WITH_ASSERTIONS'], ['UNAVAILABLE', 1, 0, [], 'TEST_NOT_RUN_WITH_ASSERTIONS'],
    ['NOT_RUN', 0, 0, [{code: 'X', message: 'x'}], 'TESTS_NOT_RUN_WITH_FINDINGS'], ['PASS', 1, 2, [], 'TEST_ASSERTION_COUNT_INVALID'],
  ]) {
    const report = await runWorkflow(makeTask(), { adapters: adapters({ tests: binding => ({
      status, evidence: { ...binding, assertionsExecuted: executed, assertionsPassed: passed,
        failures, reason: status === 'PASS' ? '' : 'not passed' },
    }) }) });
    assert.equal(report.outcome, 'BLOCKED', `${status} ${executed}/${passed}`);
    assert.equal(report.code, code, `${status} ${executed}/${passed}`);
  }
});

test('all valid repair responses retain evidence, including fixed points and cycles', async () => {
  const failure = binding => ({ status: 'FAIL', evidence: { ...binding, findings: [{code: 'X', message: 'x'}], reason: 'x' } });
  for (const [status, outcome, code] of [['NO_CHANGE', 'NO_PROGRESS', 'NO_PROGRESS'], ['FAIL', 'FAILED', 'REPAIR_FAIL'],
    ['NOT_RUN', 'BLOCKED', 'REPAIR_NOT_RUN'], ['UNAVAILABLE', 'BLOCKED', 'REPAIR_UNAVAILABLE'], ['REPAIRED', 'NO_PROGRESS', 'NO_PROGRESS']]) {
    const report = await runWorkflow(makeTask(), { adapters: adapters({ checks: failure,
      repair: ({ candidate, binding }) => ({ status, candidate: status === 'REPAIRED' ? {files: candidate.files} : null,
        evidence: {...binding, baseCandidateFingerprint: candidate.fingerprint, note: 'retained repair reason'},
      }),
    }) });
    assert.equal(report.stages.at(-1).stage, 'repair');
    assert.equal(report.stages.at(-1).status, status);
    assert.equal(report.stages.at(-1).evidence.note, 'retained repair reason');
    assert.equal(report.repairAttempts, 1);
    assert.equal(report.outcome, outcome, status);
    assert.equal(report.code, code, status);
  }
  let attempt = 0;
  const task = makeTask(); task.policy.repairBudget = 4;
  const cycle = await runWorkflow(task, { adapters: adapters({ checks: failure, repair: ({ candidate: previous, binding }) => {
    const content = ++attempt === 1 ? BASE_TEXT + '// changed' : BASE_TEXT;
    return {status: 'REPAIRED', candidate: {files: [file(content)]}, evidence: {...binding,
      baseCandidateFingerprint: previous.fingerprint, candidateFingerprint: candidate(content).fingerprint, note: 'cycles back'},
    };
  } }) });
  assert.equal(cycle.outcome, 'NO_PROGRESS');
  assert.equal(cycle.repairAttempts, 2);
});

test('post-task setup refusals retain identity, and all invalid clocks have CLOCK_INVALID', async () => {
  const task = makeTask();
  for (const options of [{}, {adapters: adapters(), signal: {}}, {adapters: adapters(), clock: false},
    {adapters: adapters(), unknown: true}, {adapters: adapters(), clock: () => { throw Error('clock'); }}]) {
    const report = await runWorkflow(task, options);
    assert.equal(report.outcome, 'BLOCKED');
    assert.equal(report.taskId, task.taskId);
    assert.equal(report.mode, 'edit');
    assert.match(report.taskFingerprint, /^[0-9a-f]{64}$/);
  }
  for (const clock of [() => {throw Error('clock');}, () => -1, () => NaN, () => 0.5, () => Number.MAX_SAFE_INTEGER]) {
    assert.equal((await runWorkflow(task, {adapters: adapters(), clock})).code, 'CLOCK_INVALID');
  }
  for (const language of ['', '   ', 'x'.repeat(65)]) assert.throws(() => createTaskSpecification({...task, language}), /LANGUAGE_INVALID/);
  assert.equal(createTaskSpecification({...task, language: 'x'.repeat(64)}).language.length, 64);
});

test('valid store refusals, invalid receipts, exceptions, timeout and cancellation preserve the workflow outcome', async () => {
  for (const required of [false, true]) {
    for (const status of ['PASS', 'FAIL', 'NOT_RUN', 'UNAVAILABLE']) {
      const task = makeTask(); task.policy.requireReportStore = required;
      const report = await runWorkflow(task, { adapters: adapters(), reportStore: {store: ({report, reportSha256, binding}) => ({
        status, evidence: {...binding, outcome: report.outcome, reportSha256},
      })} });
      assert.equal(report.workflowOutcome, 'COMPLETED');
      assert.equal(report.outcome, required && status !== 'PASS' ? 'BLOCKED' : 'COMPLETED');
      assert.equal(report.reportStored, status === 'PASS');
      assert.equal(report.reportStoreEvidence.status, status);
    }
    const task = makeTask(); task.policy.requireReportStore = required;
    const failed = await runWorkflow(task, {adapters: adapters(), reportStore: {store: () => {throw Error('disk');}}});
    assert.equal(failed.outcome, required ? 'BLOCKED' : 'COMPLETED');
    assert.equal(failed.reportStoreCode, 'ADAPTER_EXCEPTION');
    const controller = new AbortController();
    const cancelled = await runWorkflow(task, {adapters: adapters(), signal: controller.signal,
      reportStore: {store: () => {controller.abort(); return null;}},
    });
    assert.equal(cancelled.workflowOutcome, 'COMPLETED');
    assert.equal(cancelled.outcome, 'CANCELLED');
    task.policy.totalDeadlineMs = 20;
    // A frozen clock keeps the stages inside the deadline; only the store's timer expires.
    const timed = await runWorkflow(task, {adapters: adapters(), clock: () => 0, reportStore: {store: () => new Promise(() => {})}});
    assert.equal(timed.workflowOutcome, 'COMPLETED');
    assert.equal(timed.outcome, 'TIMED_OUT');
    assert.equal(timed.reportStored, false);
    assert.equal(timed.reportStoreCode, 'DEADLINE_EXCEEDED');
  }
});

test('separation, reviewer-plan and required-store guards refuse setup before any adapter call', async () => {
  const reviewer = id => ({ id, review: ({ binding, reviewerId }) => passReview(binding, reviewerId) });
  const withReviewers = (events, reviewers) => ({ adapters: { ...adapters({ events }), reviewers } });
  const twoReviewers = makeTask(); twoReviewers.policy.requiredReviewers = 2;
  const storeRequired = makeTask(); storeRequired.policy.requireReportStore = true;
  for (const [code, task, options] of [
    ['AUTHOR_REVIEWER_NOT_INDEPENDENT', makeTask(), events => ({ adapters: adapters({ events, authorId: 'reviewer.one' }) })],
    ['AUTHOR_REVIEWER_NOT_INDEPENDENT', makeTask('review'), events => ({ adapters: adapters({ events }),
      candidate: { files: [file(BASE_TEXT)] }, candidateAuthorId: 'reviewer.one' })],
    ['DUPLICATE_REVIEWER', twoReviewers, events => withReviewers(events, [reviewer('reviewer.one'), reviewer('reviewer.one')])],
    ['REVIEW_ADAPTER_COUNT', makeTask(), events => withReviewers(events, [reviewer('reviewer.one'), reviewer('reviewer.two')])],
    ['REVIEW_ADAPTER_COUNT', twoReviewers, events => withReviewers(events, [reviewer('reviewer.one')])],
    ['REVIEW_ADAPTER_COUNT', makeTask(), events => withReviewers(events, [])],
    ['REVIEW_ADAPTER_COUNT', makeTask(), events => withReviewers(events, { 0: reviewer('reviewer.one'), length: 1 })],
    ['REVIEWER_IDENTITY_INVALID', makeTask(), events => withReviewers(events, new Array(1))],
    ['REPORT_STORE_REQUIRED', storeRequired, events => ({ adapters: adapters({ events }) })],
    ['REPORT_STORE_REQUIRED', storeRequired, events => ({ adapters: adapters({ events }), reportStore: {} })],
  ]) {
    const events = [];
    const report = await runWorkflow(task, options(events));
    assert.equal(report.outcome, 'BLOCKED', code);
    assert.equal(report.code, code);
    assert.equal(report.workflowCode, code);
    assert.deepEqual(events, [], code);
  }
});

test('draft, repair and reviewer evidence guards return exact codes', async () => {
  const noted = note => {
    const a = adapters();
    const draft = a.author.draft;
    a.author.draft = async payload => { const result = await draft(payload); return { ...result, evidence: { ...result.evidence, note } }; };
    return runWorkflow(makeTask(), { adapters: a });
  };
  assert.equal((await noted('   ')).code, 'DRAFT_NOTE_INVALID');
  assert.equal((await noted('n'.repeat(4097))).code, 'DRAFT_NOTE_INVALID');
  assert.equal((await noted('n'.repeat(4096))).outcome, 'COMPLETED');
  const nextText = `${BASE_TEXT}// repaired\n`;
  const repairing = change => runWorkflow(makeTask(), { adapters: adapters({ checks: failChecks,
    repair: ({ candidate: current, binding }) => change({ status: 'REPAIRED', candidate: { files: [file(nextText)] }, evidence: {
      ...binding, candidateFingerprint: candidate(nextText).fingerprint, baseCandidateFingerprint: current.fingerprint, note: 'fixed',
    } }, current) }) });
  assert.equal((await repairing(result => result)).outcome, 'REPAIR_LIMIT');
  assert.equal((await repairing(result => ({ ...result, evidence: { ...result.evidence, baseCandidateFingerprint: '0'.repeat(64) } }))).code, 'REPAIR_BASE_STALE');
  assert.equal((await repairing(result => ({ ...result, evidence: { ...result.evidence, note: '' } }))).code, 'REPAIR_NOTE_INVALID');
  assert.equal((await repairing(result => ({ ...result, evidence: { ...result.evidence, note: 'n'.repeat(4097) } }))).code, 'REPAIR_NOTE_INVALID');
  const unused = await repairing((result, current) => ({ status: 'NO_CHANGE', candidate: { files: current.files },
    evidence: { ...result.evidence, candidateFingerprint: current.fingerprint } }));
  assert.equal(unused.outcome, 'BLOCKED'); assert.equal(unused.code, 'REPAIR_UNUSED_CANDIDATE');
  const mismatch = await runWorkflow(makeTask(), { adapters: adapters({ review: binding => passReview(binding, 'reviewer.two') }) });
  assert.equal(mismatch.outcome, 'BLOCKED'); assert.equal(mismatch.code, 'REVIEWER_ID_MISMATCH');
});

test('store receipts bound to another outcome or digest are REPORT_STORE_EVIDENCE_STALE', async () => {
  for (const required of [false, true]) {
    for (const change of [{ outcome: 'FAILED' }, { reportSha256: '0'.repeat(64) }]) {
      const task = makeTask(); task.policy.requireReportStore = required;
      const report = await runWorkflow(task, { adapters: adapters(), reportStore: { store: ({ report: preliminary, reportSha256, binding }) => ({
        status: 'PASS', evidence: { ...binding, outcome: preliminary.outcome, reportSha256, ...change },
      }) } });
      assert.equal(report.reportStoreCode, 'REPORT_STORE_EVIDENCE_STALE');
      assert.equal(report.reportStored, false);
      assert.equal(report.reportStoreEvidence, null);
      assert.equal(report.outcome, required ? 'BLOCKED' : 'COMPLETED');
      assert.equal(report.code, required ? 'REPORT_STORE_EVIDENCE_STALE' : null);
    }
  }
});

test('the reviewer plan, author and adapter IDs are read once and the validated snapshot runs', async () => {
  const reviews = report => report.stages.filter(stage => stage.stage === 'review').map(stage => stage.evidence.reviewerId);
  const shrinking = adapters();
  const [reviewer] = shrinking.reviewers;
  let planReads = 0;
  Object.defineProperty(shrinking, 'reviewers', { enumerable: true, get() { planReads += 1; return planReads === 1 ? [reviewer] : []; } });
  const planned = await runWorkflow(makeTask(), { adapters: shrinking });
  assert.equal(planned.outcome, 'COMPLETED');
  assert.deepEqual(reviews(planned), ['reviewer.one']);
  assert.equal(planReads, 1);

  const renamed = adapters();
  let idReads = 0;
  renamed.reviewers = [{ get id() { idReads += 1; return idReads === 1 ? 'reviewer.one' : 'NOT A VALID ID'; }, review: renamed.reviewers[0].review }];
  const identified = await runWorkflow(makeTask(), { adapters: renamed });
  assert.equal(identified.outcome, 'COMPLETED');
  assert.deepEqual(reviews(identified), ['reviewer.one']);
  assert.equal(idReads, 1);

  const swapped = adapters();
  const { author } = swapped;
  let authorReads = 0;
  Object.defineProperty(swapped, 'author', { enumerable: true, get() { authorReads += 1; return authorReads === 1 ? author : { id: 'reviewer.one' }; } });
  const authored = await runWorkflow(makeTask(), { adapters: swapped });
  assert.equal(authored.outcome, 'COMPLETED');
  assert.equal(authorReads, 1);

  const reads = { candidate: 0, candidateAuthorId: 0, reportStore: 0 };
  const first = { candidate: { files: [file(BASE_TEXT)] }, candidateAuthorId: 'author.one', reportStore: { store: ({ report, reportSha256, binding }) => ({
    status: 'PASS', evidence: { ...binding, outcome: report.outcome, reportSha256 } }) } };
  const later = { candidate: { files: [] }, candidateAuthorId: 'reviewer.one', reportStore: undefined };
  const options = { adapters: adapters() };
  for (const key of Object.keys(reads)) {
    Object.defineProperty(options, key, { enumerable: true, get() { reads[key] += 1; return reads[key] === 1 ? first[key] : later[key]; } });
  }
  const reviewed = await runWorkflow(makeTask('review'), options);
  assert.equal(reviewed.outcome, 'COMPLETED');
  assert.equal(reviewed.reportStored, true);
  assert.deepEqual(reads, { candidate: 1, candidateAuthorId: 1, reportStore: 1 });
});

test('cloneFreeze refuses non-data objects before listing their properties', async () => {
  let listed = 0;
  const trap = { ownKeys(target) { listed += 1; return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) { listed += 1; return Reflect.getOwnPropertyDescriptor(target, key); } };
  for (const value of [new Uint8Array(4), Buffer.from('x'), new Map([[1, 2]]), new (class Box { constructor() { this.x = 1; } })()]) {
    refuses(() => cloneFreeze(new Proxy(value, trap)), 'INPUT_OBJECT_INVALID');
  }
  assert.equal(listed, 0);
  for (const [value, code] of [[() => {}, 'INPUT_VALUE_INVALID'], [NaN, 'INPUT_NUMBER_INVALID'],
    [Object.defineProperty({}, 'x', { enumerable: true, get: () => 1 }), 'INPUT_PROPERTY_INVALID'],
    [{ [Symbol('x')]: 1 }, 'INPUT_PROPERTY_INVALID'], [Object.defineProperty({}, 'x', { value: 1 }), 'INPUT_PROPERTY_INVALID'],
    [Object.assign([1], { extra: true }), 'INPUT_ARRAY_INVALID'], [[1, , 3], 'INPUT_ARRAY_INVALID']]) {
    refuses(() => cloneFreeze(value), code);
  }
  const report = await runWorkflow(makeTask(), { adapters: adapters({ checks: () => new Map() }) });
  assert.equal(report.outcome, 'BLOCKED'); assert.equal(report.code, 'INPUT_OBJECT_INVALID');
});

test('cloneFreeze copies a shared reference once, keeps cycles refused and the depth limit exact', () => {
  let listings = 0;
  const shared = new Proxy({ answer: 42 }, { ownKeys(target) { listings += 1; return Reflect.ownKeys(target); } });
  let dag = [shared];
  for (let level = 0; level < 10; level += 1) dag = [dag, dag];
  const copy = cloneFreeze(dag);
  assert.equal(listings, 1);
  assert.equal(copy[0], copy[1]);
  assert.equal(Object.isFrozen(copy[0]), true);
  let leaf = copy;
  while (Array.isArray(leaf)) leaf = leaf.at(-1);
  assert.deepEqual({ ...leaf }, { answer: 42 });

  const loop = []; loop.push([loop]);
  refuses(() => cloneFreeze(loop), 'INPUT_CYCLE');
  const node = { name: 'node' }; node.children = [{ parent: node }];
  refuses(() => cloneFreeze([node, node]), 'INPUT_CYCLE');

  // A reused copy must be refused wherever an unshared copy would exceed 64 levels,
  // including a reused copy nested in another, and a leaf must not inherit a height.
  const chain = (inner, levels) => { let value = inner; for (let index = 0; index < levels; index += 1) value = [value]; return value; };
  const result = value => { try { cloneFreeze(value); return 'ok'; } catch (error) { return error.code; } };
  for (let levels = 50; levels <= 56; levels += 1) {
    const expected = 1 + levels + 10 <= 64 ? 'ok' : 'INPUT_DEPTH_LIMIT';
    const reused = chain('leaf', 10);
    assert.equal(result([reused, chain(reused, levels)]), expected, `shared ${levels}`);
    assert.equal(result([chain('leaf', 10), chain(chain('leaf', 10), levels)]), expected, `unshared ${levels}`);
    const inner = chain('leaf', 10), outer = [inner];
    assert.equal(result([inner, outer, chain(outer, levels - 1)]), expected, `nested ${levels}`);
    const small = ['x'];
    assert.equal(result([chain('leaf', 30), small, chain(small, levels + 9)]), expected, `leaf ${levels}`);
  }
});

test('evidence size limits hold at their documented boundaries; oversized evidence blocks without repair', async () => {
  const entry = { code: 'X', message: 'x' };
  for (const [failures, reason, code] of [
    [Array.from({ length: 256 }, () => entry), 'failed', 'NO_PROGRESS'],
    [Array.from({ length: 257 }, () => entry), 'failed', 'TESTS_FINDINGS_INVALID'],
    [[{ code: 'C'.repeat(128), message: 'm'.repeat(2048) }], 'failed', 'NO_PROGRESS'],
    [[{ code: 'C'.repeat(129), message: 'm' }], 'failed', 'TESTS_FINDING_INVALID'],
    [[{ code: 'C', message: 'm'.repeat(2049) }], 'failed', 'TESTS_FINDING_INVALID'],
    [[entry], 'r'.repeat(4096), 'NO_PROGRESS'],
    [[entry], 'r'.repeat(4097), 'TESTS_REASON_INVALID'],
  ]) {
    let repairs = 0;
    const repair = async ({ candidate: current, binding }) => { repairs += 1; return { status: 'NO_CHANGE', candidate: null,
      evidence: { ...binding, baseCandidateFingerprint: current.fingerprint, note: 'unchanged' } }; };
    const report = await runWorkflow(makeTask(), { adapters: adapters({ tests: failTests(failures, reason), repair }) });
    assert.equal(report.code, code, `${failures.length} ${reason.length}`);
    assert.equal(repairs, code === 'NO_PROGRESS' ? 1 : 0);
  }
  for (const [length, code] of [[4096, null], [4097, 'REVIEW_EVIDENCE_INVALID']]) {
    const report = await runWorkflow(makeTask(), { adapters: adapters({ review: (binding, reviewerId) => ({
      status: 'PASS', evidence: { ...binding, reviewerId, findings: [], summary: 's'.repeat(length), reason: '' } }) }) });
    assert.equal(report.code, code);
  }
  const checked = await runWorkflow(makeTask(), { adapters: adapters({ checks: binding => ({
    status: 'FAIL', evidence: { ...binding, findings: [{ code: 'LINT', message: 'm'.repeat(2049) }], reason: 'lint' } }) }) });
  assert.equal(checked.code, 'STATIC_CHECKS_FINDING_INVALID');
  const denied = adapters();
  denied.authorizeContext.authorize = ({ binding }) => ({ status: 'FAIL', evidence: { ...binding, reason: 'r'.repeat(4097) } });
  assert.equal((await runWorkflow(makeTask(), { adapters: denied })).code, 'AUTHORIZE_CONTEXT_REASON_INVALID');
});

test('the report store is not called after cancellation, deadline expiry or an invalid clock', async () => {
  for (const [stop, outcome, storeCode] of [['cancel', 'CANCELLED', 'ABORTED'], ['expire', 'TIMED_OUT', 'DEADLINE_EXCEEDED'],
    ['regress', 'BLOCKED', 'CLOCK_INVALID']]) {
    let now = 10, stores = 0;
    const controller = new AbortController();
    const task = makeTask(); task.policy.totalDeadlineMs = 50; task.policy.requireReportStore = true;
    const tests = binding => {
      if (stop === 'cancel') controller.abort(); else now = stop === 'expire' ? 60 : 5;
      return passTests(binding);
    };
    const report = await runWorkflow(task, { adapters: adapters({ tests }), clock: () => now, signal: controller.signal,
      reportStore: { store: () => { stores += 1; return null; } } });
    assert.equal(stores, 0, stop);
    assert.equal(report.outcome, outcome);
    assert.equal(report.workflowOutcome, outcome);
    assert.equal(report.workflowCode, storeCode);
    assert.equal(report.reportStoreCode, storeCode);
    assert.equal(report.reportStored, false);
    assert.equal(report.reportStoreEvidence, null);
  }
});

test('the store guard reads the clock: a run timed out by a stage timer still reaches the store', async () => {
  const task = makeTask(); task.policy.totalDeadlineMs = 20; task.policy.requireReportStore = true;
  let stores = 0;
  // The frozen clock never reaches the deadline; only the hanging stage's timer expires.
  const report = await runWorkflow(task, { adapters: adapters({ tests: () => new Promise(() => {}) }), clock: () => 0,
    reportStore: { store: ({ report: preliminary, reportSha256, binding }) => {
      stores += 1;
      return { status: 'PASS', evidence: { ...binding, outcome: preliminary.outcome, reportSha256 } };
    } } });
  assert.deepEqual([report.outcome, report.code, report.workflowOutcome, report.reportStored, report.reportStoreCode, stores],
    ['TIMED_OUT', 'DEADLINE_EXCEEDED', 'TIMED_OUT', true, null, 1]);
});

test('workflowCode keeps the workflow code when storage changes the outcome and code', async () => {
  const task = makeTask(); task.policy.repairBudget = 0; task.policy.requireReportStore = true;
  const unavailable = { store: ({ report, reportSha256, binding }) => ({ status: 'UNAVAILABLE', evidence: { ...binding, outcome: report.outcome, reportSha256 } }) };
  const stored = await runWorkflow(task, { adapters: adapters({ tests: failTests() }), reportStore: unavailable });
  assert.deepEqual([stored.outcome, stored.code, stored.workflowOutcome, stored.workflowCode, stored.reportStoreCode],
    ['BLOCKED', 'REPORT_STORE_UNAVAILABLE', 'FAILED', 'TESTS_FAILED', 'REPORT_STORE_UNAVAILABLE']);
  const controller = new AbortController();
  const cancelled = await runWorkflow(task, { adapters: adapters({ tests: failTests() }), signal: controller.signal,
    reportStore: { store: () => { controller.abort(); return null; } } });
  assert.deepEqual([cancelled.outcome, cancelled.code, cancelled.workflowOutcome, cancelled.workflowCode],
    ['CANCELLED', 'ABORTED', 'FAILED', 'TESTS_FAILED']);
  let preliminary;
  const optional = makeTask(); optional.policy.repairBudget = 0;
  const kept = await runWorkflow(optional, { adapters: adapters({ tests: failTests() }), reportStore: { store: ({ report, reportSha256, binding }) => {
    preliminary = report;
    return { status: 'PASS', evidence: { ...binding, outcome: report.outcome, reportSha256 } };
  } } });
  assert.deepEqual([kept.outcome, kept.code, kept.workflowCode, preliminary.workflowCode], ['FAILED', 'TESTS_FAILED', 'TESTS_FAILED', 'TESTS_FAILED']);
});

test('author and reviewer adapters must be plain objects; other adapters may be class instances', async () => {
  class Reviewer { constructor(id) { this.id = id; } review({ binding, reviewerId }) { return passReview(binding, reviewerId); } }
  class Checks { check({ binding }) { return passChecks(binding); } }
  const base = adapters();
  class Author { constructor() { this.id = 'author.one'; } draft(payload) { return base.author.draft(payload); } repair() { return null; } }
  assert.equal((await runWorkflow(makeTask(), { adapters: { ...base, staticChecks: new Checks() } })).outcome, 'COMPLETED');
  assert.equal((await runWorkflow(makeTask(), { adapters: { ...base, reviewers: [new Reviewer('reviewer.one')] } })).code, 'REVIEWER_IDENTITY_INVALID');
  assert.equal((await runWorkflow(makeTask(), { adapters: { ...base, author: new Author() } })).code, 'AUTHOR_IDENTITY_INVALID');
  const bare = Object.assign(Object.create(null), { id: 'reviewer.one', review: ({ binding, reviewerId }) => passReview(binding, reviewerId) });
  assert.equal((await runWorkflow(makeTask(), { adapters: { ...base, reviewers: [bare] } })).outcome, 'COMPLETED');
});

test('runWorkflow takes the raw { files } candidate, not a createCandidate() result', async () => {
  const made = candidate('export const answer = 7;\n');
  const review = supplied => runWorkflow(makeTask('review'), { adapters: adapters(), candidate: supplied, candidateAuthorId: 'author.one' });
  assert.equal((await review(made)).code, 'CANDIDATE_SCHEMA');
  assert.equal((await review({ files: made.files })).outcome, 'COMPLETED');
  const normalized = adapters();
  normalized.author.draft = async ({ binding }) => ({ candidate: made, evidence: { ...binding, candidateFingerprint: made.fingerprint, note: 'normalized' } });
  assert.equal((await runWorkflow(makeTask(), { adapters: normalized })).code, 'CANDIDATE_SCHEMA');
});
