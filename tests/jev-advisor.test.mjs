import test from 'node:test';
import assert from 'node:assert/strict';
import { planWithJev, createJevReviewer, DEFAULT_JEV_PLAN_POLICY } from '../adapters/jev-advisor.mjs';
import { runWorkflow, createCandidate } from '../workflow/engine.mjs';

const task = { taskId: 'jev.task', mode: 'edit', language: 'json', allowedFiles: ['answer.json'], protectedFiles: [], protectedSnapshots: {},
  acceptanceCriteria: ['Return {"answer": 391} for 17*23.'], policy: { repairBudget: 1, totalDeadlineMs: 5000, requiredReviewers: 2, requireReportStore: false } };
const answer = (questions, values) => ({ model: 'jev-test', answers: Object.fromEntries(Object.keys(questions).map(k => [k, values[k]])) });

test('planWithJev maps the choice to adapter settings and keeps the underspecified probability', async () => {
  let seen;
  const judge = async request => { seen = request; return answer(request.questions, { plan: { choice: 'reason', confidence: 0.9 }, underspecified: { noul: 0.1 } }); };
  const plan = await planWithJev(task, { judge });
  assert.equal(plan.plan, 'reason');
  assert.deepEqual({ ...plan.settings }, { ...DEFAULT_JEV_PLAN_POLICY.reason });
  assert.equal(plan.underspecified, 0.1);
  assert.match(plan.evidence.requestSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual([...seen.state.task.acceptanceCriteria], task.acceptanceCriteria);
  const direct = await planWithJev(task, { judge: async r => answer(r.questions, { plan: { choice: 'direct' }, underspecified: { noul: 0 } }) });
  assert.deepEqual({ ...direct.settings }, { reasoningEffort: 'none', maxOutputTokens: 1024 });
});

test('malformed or failed Jev answers are refused with named codes', async () => {
  const bad = [
    async r => answer(r.questions, { plan: { choice: 'think-hard' }, underspecified: { noul: 0.1 } }),
    async r => answer(r.questions, { plan: { choice: 'direct' }, underspecified: { noul: 1.5 } }),
    async () => ({ model: 'jev-test', answers: { plan: { choice: 'direct' } } }),
    async () => null,
  ];
  for (const judge of bad) await assert.rejects(() => planWithJev(task, { judge }), { code: 'JEV_RESPONSE_INVALID' });
  await assert.rejects(() => planWithJev(task, { judge: async () => { throw new Error('network'); } }), { code: 'JEV_UNAVAILABLE' });
  await assert.rejects(() => planWithJev(task, {}), { code: 'JEV_JUDGE_REQUIRED' });
});

test('the Jev reviewer is advisory by default and gates only when asked', async () => {
  const judge = p => async r => answer(r.questions, { satisfies: { noul: p } });
  const candidate = { files: [{ path: 'answer.json', content: '{"answer": 390}' }] };
  const advisory = await createJevReviewer({ id: 'jev.review', judge: judge(0.1) }).review({ task, candidate, tests: { status: 'PASS' }, binding: { runId: 'r' } });
  assert.equal(advisory.status, 'PASS');
  assert.match(advisory.evidence.summary, /0\.10 \(advisory\)/);
  const gated = await createJevReviewer({ id: 'jev.review', judge: judge(0.1), gate: true, threshold: 0.3 }).review({ task, candidate, tests: null, binding: {} });
  assert.equal(gated.status, 'FAIL');
  assert.equal(gated.evidence.findings[0].code, 'JEV_LIKELY_INCORRECT');
  const down = await createJevReviewer({ id: 'jev.review', judge: async () => { throw new Error('x'); } }).review({ task, candidate, binding: {} });
  assert.equal(down.status, 'UNAVAILABLE');
  assert.throws(() => createJevReviewer({ id: 'jev.review', judge: judge(1), threshold: 2 }), { code: 'JEV_THRESHOLD_INVALID' });
});

test('an advisory Jev reviewer runs inside a workflow without changing its outcome', async () => {
  const draft = { files: [{ path: 'answer.json', content: '{"answer": 391}' }] };
  const report = await runWorkflow(task, { adapters: {
    authorizeContext: { authorize: ({ binding }) => ({ status: 'PASS', evidence: { ...binding, reason: '' } }) },
    author: { id: 'author.one', draft: ({ binding }) => ({ candidate: draft, evidence: { ...binding, candidateFingerprint: createCandidate(draft, { authorId: 'author.one' }).fingerprint, note: 'd' } }), repair: () => { throw new Error('no'); } },
    staticChecks: { check: ({ binding }) => ({ status: 'PASS', evidence: { ...binding, findings: [], reason: '' } }) },
    tests: { run: ({ binding }) => ({ status: 'PASS', evidence: { ...binding, assertionsExecuted: 1, assertionsPassed: 1, failures: [], reason: '' } }) },
    reviewers: [
      { id: 'reviewer.one', review: ({ binding, reviewerId }) => ({ status: 'PASS', evidence: { ...binding, reviewerId, findings: [], summary: 's', reason: '' } }) },
      createJevReviewer({ id: 'jev.review', judge: async r => answer(r.questions, { satisfies: { noul: 0.2 } }) }),
    ] } });
  assert.equal(report.outcome, 'COMPLETED');
  assert.match(report.stages.filter(s => s.stage === 'review').map(s => s.evidence.summary).join(' '), /0\.20 \(advisory\)/);
});
