import test from 'node:test';
import assert from 'node:assert/strict';
import { createCandidate, createTaskSpecification, runWorkflow } from '../workflow/engine.mjs';
import { sha256Text, stableStringify } from '../workflow/contracts.mjs';

const BASE_TEXT = 'export const answer = 42;\n';
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
  const unavailable = adapters({ checks: binding => ({ status: 'UNAVAILABLE', evidence: { ...binding, findings: [], reason: 'checker unavailable' } }) });
  assert.equal((await runWorkflow(makeTask(), { adapters: unavailable })).outcome, 'BLOCKED');
  const notRun = adapters({ checks: binding => ({ status: 'NOT_RUN', evidence: { ...binding, findings: [], reason: 'not requested' } }) });
  assert.equal((await runWorkflow(makeTask(), { adapters: notRun })).outcome, 'BLOCKED');
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

test('stale or malformed evidence and protected or out-of-scope candidates are blocked', async () => {
  const stale = adapters({ checks: binding => ({ status: 'PASS', evidence: { ...binding, candidateFingerprint: '0'.repeat(64), findings: [], reason: '' } }) });
  assert.equal((await runWorkflow(makeTask(), { adapters: stale })).outcome, 'BLOCKED');
  const malformed = adapters({ checks: binding => ({ status: 'PASS', evidence: { ...binding, findings: [], reason: '', extra: true } }) });
  assert.equal((await runWorkflow(makeTask(), { adapters: malformed })).outcome, 'BLOCKED');
  const outside = adapters({ source: 'x' });
  outside.author.draft = async ({ binding }) => ({ candidate: { files: [{ path: '../secret.js', content: 'x' }] }, evidence: { ...binding, candidateFingerprint: '0'.repeat(64), note: 'bad' } });
  assert.equal((await runWorkflow(makeTask(), { adapters: outside })).outcome, 'BLOCKED');
  const protectedText = 'assert.equal(answer, 42);\n';
  const protectedTask = makeTask('edit', { allowedFiles: ['src/app.js', 'test/app.test.js'], protectedFiles: ['test/app.test.js'], protectedSnapshots: { 'test/app.test.js': sha256Text(protectedText) } });
  const protectedAdapter = adapters();
  protectedAdapter.author.draft = async ({ binding }) => ({ candidate: { files: [{ path: 'test/app.test.js', content: 'changed' }] }, evidence: { ...binding, candidateFingerprint: createCandidate({ files: [{ path: 'test/app.test.js', content: 'changed' }] }, { authorId: 'author.one' }).fingerprint, note: 'bad' } });
  const protectedReport = await runWorkflow(protectedTask, { adapters: protectedAdapter });
  assert.equal(protectedReport.outcome, 'BLOCKED');
  assert.equal(protectedReport.code, 'PROTECTED_FILE_CHANGED');
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

test('a reviewer list that changes between reads cannot skip the required review', async () => {
  const base = adapters();
  let reads = 0;
  const getter = await runWorkflow(makeTask(), { adapters: {
    ...base,
    // The first two reads see one reviewer; a third read would see none.
    get reviewers() { reads += 1; return reads <= 2 ? base.reviewers : []; },
  } });
  assert.equal(getter.stages.filter(stage => stage.stage === 'review').length, 1);
  assert.equal(getter.outcome, 'COMPLETED');
  assert.equal(reads, 1);
});

test('a reviewer Proxy whose length shrinks after the count check cannot skip review', async () => {
  const base = adapters();
  let lengthReads = 0;
  const shrinking = new Proxy(base.reviewers, { get(target, key, receiver) {
    if (key === 'length') { lengthReads += 1; return lengthReads === 1 ? target.length : 0; }
    return Reflect.get(target, key, receiver);
  } });
  const proxied = await runWorkflow(makeTask(), { adapters: { ...base, reviewers: shrinking } });
  assert.equal(proxied.stages.filter(stage => stage.stage === 'review').length, 1);
  assert.equal(proxied.outcome, 'COMPLETED');
  assert.equal(lengthReads, 1);
});

test('a reviewer list with a hole is refused before any adapter runs', async () => {
  const base = adapters();
  const holey = await runWorkflow(makeTask(undefined, { policy: { ...makeTask().policy, requiredReviewers: 2 } }),
    { adapters: { ...base, reviewers: [, base.reviewers[0]] } });
  assert.equal(holey.outcome, 'BLOCKED');
  assert.equal(holey.stages.filter(stage => stage.stage === 'review').length, 0);
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
  for (const [status, executed, passed, failures] of [
    ['PASS', 0, 0, []], ['PASS', 2, 1, []],
    ['FAIL', 1, 1, [{code: 'X', message: 'x'}]],
    ['FAIL', 1, 0, []], ['NOT_RUN', 1, 1, []], ['UNAVAILABLE', 1, 0, []],
  ]) {
    const report = await runWorkflow(makeTask(), { adapters: adapters({ tests: binding => ({
      status, evidence: { ...binding, assertionsExecuted: executed, assertionsPassed: passed,
        failures, reason: status === 'PASS' ? '' : 'not passed' },
    }) }) });
    assert.equal(report.outcome, 'BLOCKED', `${status} ${executed}/${passed}`);
  }
});

test('all valid repair responses retain evidence, including fixed points and cycles', async () => {
  const failure = binding => ({ status: 'FAIL', evidence: { ...binding, findings: [{code: 'X', message: 'x'}], reason: 'x' } });
  for (const status of ['NO_CHANGE', 'FAIL', 'NOT_RUN', 'UNAVAILABLE', 'REPAIRED']) {
    const report = await runWorkflow(makeTask(), { adapters: adapters({ checks: failure,
      repair: ({ candidate, binding }) => ({ status, candidate: status === 'REPAIRED' ? {files: candidate.files} : null,
        evidence: {...binding, baseCandidateFingerprint: candidate.fingerprint, note: 'retained repair reason'},
      }),
    }) });
    assert.equal(report.stages.at(-1).stage, 'repair');
    assert.equal(report.stages.at(-1).status, status);
    assert.equal(report.stages.at(-1).evidence.note, 'retained repair reason');
    assert.equal(report.repairAttempts, 1);
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
    let now = 0;
    const timed = await runWorkflow(task, {adapters: adapters(), clock: () => now,
      reportStore: {store: ({report, reportSha256, binding}) => {
        now = 20;
        return {status: 'PASS', evidence: {...binding, outcome: report.outcome, reportSha256}};
      }},
    });
    assert.equal(timed.workflowOutcome, 'COMPLETED');
    assert.equal(timed.outcome, 'TIMED_OUT');
    assert.equal(timed.reportStored, false);
  }
});

test('factory and report candidates compose with review mode and revalidate identity', async () => {
  const made = candidate();
  const first = await runWorkflow(makeTask('review'), { adapters: adapters(), candidate: made, candidateAuthorId: 'author.one' });
  assert.equal(first.outcome, 'COMPLETED');
  const second = await runWorkflow(makeTask('review'), { adapters: adapters(), candidate: first.candidate, candidateAuthorId: 'author.one' });
  assert.equal(second.outcome, 'COMPLETED');
  for (const changed of [{ ...made, authorId: 'other.author' }, { ...made, fingerprint: '0'.repeat(64) }, { ...made, schemaVersion: 999 }, { ...made, files: [file('changed')] }]) {
    const report = await runWorkflow(makeTask('review'), { adapters: adapters(), candidate: changed, candidateAuthorId: 'author.one' });
    assert.equal(report.outcome, 'BLOCKED');
  }
});

test('required timed-out reports are stored with a fresh signal and deadline', async () => {
  for (const timeout of ['async', 'clock']) {
    const task = makeTask();
    task.policy.requireReportStore = true;
    task.policy.totalDeadlineMs = 15;
    let now = 0, runSignal, stored;
    const host = adapters();
    host.authorizeContext.authorize = ({ signal, binding }) => {
      runSignal = signal;
      if (timeout === 'async') return new Promise(() => {});
      now = 15;
      return passAuthorize(task, binding);
    };
    const report = await runWorkflow(task, {
      adapters: host, ...(timeout === 'clock' ? { clock: () => now } : {}),
      reportStore: { store({ report, reportSha256, binding, signal }) {
        assert.equal(runSignal.aborted, true);
        assert.equal(signal.aborted, false);
        assert.notEqual(signal, runSignal);
        assert.equal(Object.isFrozen(report), true);
        assert.equal(report.outcome, 'TIMED_OUT');
        assert.equal(reportSha256, sha256Text(`nisi/run-report/v1\0${stableStringify(report)}`));
        stored = report;
        return { status: 'PASS', evidence: { ...binding, outcome: report.outcome, reportSha256 } };
      } },
    });
    assert.equal(stored.runId, report.runId);
    assert.equal(report.workflowOutcome, 'TIMED_OUT');
    assert.equal(report.outcome, 'TIMED_OUT');
    assert.equal(report.code, 'DEADLINE_EXCEEDED');
    assert.equal(report.reportStored, true);
    assert.equal(report.reportStoreCode, null);
  }
});

test('required cancelled reports are stored before or during a run with a fresh signal', async () => {
  for (const before of [true, false]) {
    const task = makeTask(); task.policy.requireReportStore = true;
    const controller = new AbortController();
    const events = [];
    const host = adapters({ events });
    if (before) controller.abort();
    else host.authorizeContext.authorize = () => { controller.abort(); return new Promise(() => {}); };
    let calls = 0;
    const report = await runWorkflow(task, {
      adapters: host, signal: controller.signal,
      reportStore: { store({ report, reportSha256, binding, signal }) {
        calls += 1;
        assert.equal(controller.signal.aborted, true);
        assert.equal(signal.aborted, false);
        assert.notEqual(signal, controller.signal);
        assert.equal(report.outcome, 'CANCELLED');
        return { status: 'PASS', evidence: { ...binding, outcome: report.outcome, reportSha256 } };
      } },
    });
    assert.equal(calls, 1);
    assert.deepEqual(events, []);
    assert.equal(report.outcome, 'CANCELLED');
    assert.equal(report.workflowOutcome, 'CANCELLED');
    assert.equal(report.code, 'ABORTED');
    assert.equal(report.reportStored, true);
    assert.equal(report.reportStoreCode, null);
  }
});

test('required terminal storage honours its timeout even if the store never settles', { timeout: 2000 }, async () => {
  const task = makeTask(); task.policy.requireReportStore = true;
  const controller = new AbortController(); controller.abort();
  let storeSignal;
  const report = await runWorkflow(task, {
    adapters: adapters(), signal: controller.signal, storeTimeoutMs: 15,
    reportStore: { store({ signal }) { storeSignal = signal; return new Promise(() => {}); } },
  });
  assert.equal(storeSignal.aborted, true);
  assert.equal(report.workflowOutcome, 'CANCELLED');
  assert.equal(report.outcome, 'TIMED_OUT');
  assert.equal(report.reportStored, false);
  assert.equal(report.reportStoreCode, 'DEADLINE_EXCEEDED');
});

test('terminal storage starts its default or custom budget at storage and rejects late receipt copies', async () => {
  for (const storeTimeoutMs of [undefined, 25]) {
    const task = makeTask(); task.policy.requireReportStore = true;
    const controller = new AbortController(); controller.abort();
    let now = 500, storeSignal;
    const report = await runWorkflow(task, {
      adapters: adapters(), signal: controller.signal, clock: () => now, storeTimeoutMs,
      reportStore: { store({ report, reportSha256, binding, signal }) {
        storeSignal = signal;
        const receipt = { status: 'PASS', evidence: { ...binding, outcome: report.outcome, reportSha256 } };
        return new Proxy(receipt, { ownKeys(target) {
          now = 500 + (storeTimeoutMs ?? 1000);
          return Reflect.ownKeys(target);
        } });
      } },
    });
    assert.equal(report.workflowOutcome, 'CANCELLED');
    assert.equal(report.outcome, 'TIMED_OUT');
    assert.equal(report.reportStoreCode, 'DEADLINE_EXCEEDED');
    assert.equal(report.reportStored, false);
    assert.equal(report.reportStoreEvidence, null);
    assert.equal(storeSignal.aborted, true);
  }
});

test('optional terminal storage retains the run deadline and cancellation signal', async () => {
  for (const outcome of ['TIMED_OUT', 'CANCELLED']) {
    const task = makeTask(); task.policy.totalDeadlineMs = 15;
    const controller = new AbortController();
    if (outcome === 'CANCELLED') controller.abort();
    let now = 0, calls = 0;
    const host = adapters();
    host.authorizeContext.authorize = ({ binding }) => { now = 15; return passAuthorize(task, binding); };
    const report = await runWorkflow(task, {
      adapters: host, signal: controller.signal, clock: () => now, storeTimeoutMs: 100,
      reportStore: { store() { calls += 1; } },
    });
    assert.equal(calls, 0);
    assert.equal(report.outcome, outcome);
    assert.equal(report.reportStored, false);
    assert.equal(report.reportStoreCode, outcome === 'CANCELLED' ? 'ABORTED' : 'DEADLINE_EXCEEDED');
  }
});

test('invalid storage budgets fail setup before invoking adapters or storage', async () => {
  for (const storeTimeoutMs of [null, 0, -1, 1.5, NaN, Infinity, '15', 86_400_001]) {
    const task = makeTask(); task.policy.requireReportStore = true;
    const events = [];
    const report = await runWorkflow(task, {
      adapters: adapters({ events }), storeTimeoutMs,
      reportStore: { store() { events.push('store'); } },
    });
    assert.equal(report.outcome, 'BLOCKED');
    assert.equal(report.code, 'STORE_TIMEOUT_INVALID');
    assert.equal(report.runId, null);
    assert.deepEqual(events, []);
  }
});

test('terminal storage clock setup failure returns a failed storage report', async () => {
  const task = makeTask(); task.policy.requireReportStore = true;
  const controller = new AbortController(); controller.abort();
  let clockCalls = 0, stored = false;
  const report = await runWorkflow(task, {
    adapters: adapters(), signal: controller.signal,
    clock: () => { if (clockCalls++ > 0) throw Error('clock unavailable'); return 0; },
    reportStore: { store() { stored = true; } },
  });
  assert.equal(stored, false);
  assert.equal(report.workflowOutcome, 'CANCELLED');
  assert.equal(report.outcome, 'BLOCKED');
  assert.equal(report.reportStoreCode, 'CLOCK_INVALID');
});

for (const terminal of ['timeout', 'pre-cancel', 'in-run-cancel']) {
  test(`required terminal storage rejects clock regression after ${terminal}`, async () => {
    const task = makeTask();
    task.policy.requireReportStore = true;
    task.policy.totalDeadlineMs = 100;
    const controller = new AbortController();
    const host = adapters();
    let calls = 0;
    let samples;
    if (terminal === 'pre-cancel') {
      controller.abort();
      samples = [100, 50];
    } else if (terminal === 'timeout') {
      samples = [0, 100, 50];
    } else {
      samples = [0, 100, 100, 50];
      task.policy.totalDeadlineMs = 200;
      host.authorizeContext.authorize = () => {
        controller.abort();
        return new Promise(() => {});
      };
    }
    const report = await runWorkflow(task, {
      adapters: host, signal: controller.signal, clock: () => samples.shift() ?? 50,
      reportStore: { store({ report, reportSha256, binding }) {
        calls += 1;
        return { status: 'PASS', evidence: { ...binding, outcome: report.outcome, reportSha256 } };
      } },
    });
    assert.equal(calls, 0);
    assert.equal(report.workflowOutcome, terminal === 'timeout' ? 'TIMED_OUT' : 'CANCELLED');
    assert.equal(report.outcome, 'BLOCKED');
    assert.equal(report.code, 'CLOCK_INVALID');
    assert.equal(report.reportStoreCode, 'CLOCK_INVALID');
    assert.equal(report.reportStored, false);
    assert.equal(report.reportStoreEvidence, null);
    assert.equal(report.storedReportSha256, null);
  });
}
