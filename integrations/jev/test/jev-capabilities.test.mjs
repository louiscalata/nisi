// Offline deterministic checks for the bounded JEV task/candidate capabilities.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createJevEvaluator } from '../src/jev-adapter.mjs';
import { analyzeTask, triageCandidate, proposeRouting, createJevCapabilities } from '../src/jev-capabilities.mjs';
import { sha256Text, stableStringify } from '../../../workflow/contracts.mjs';

const expectCode = code => error => { assert.equal(error?.code, code); return true; };

function stubFetch(captured, responseBody) {
  return async (url, init) => {
    captured.url = url;
    captured.init = init;
    return new Response(JSON.stringify(responseBody), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

const taskAnswers = {
  route: { type: 'choice', choice: 'code_change', confidence: 0.9,
    probabilities: { code_change: 0.9, review: 0.03, diagnosis: 0.03, planning: 0.02, other: 0.02 } },
  risk: { type: 'score', score: 1, confidence: 0.8, legend: { '0': 'low', '1': 'medium', '2': 'high' }, probabilities: { '0': 0.1, '1': 0.8, '2': 0.1 } },
  destructive: { type: 'noul', noul: 0.1 }, underspecified: { type: 'noul', noul: 0.2 },
};
const candidateAnswers = {
  scope: { type: 'choice', choice: 'in_scope', confidence: 0.95, probabilities: { in_scope: 0.95, out_of_scope: 0.03, unclear: 0.02 } },
  quality: { type: 'score', score: 2, confidence: 0.85, legend: { '0': 'poor', '1': 'mixed', '2': 'strong' }, probabilities: { '0': 0.02, '1': 0.08, '2': 0.9 } },
  securityConcern: { type: 'noul', noul: 0.05 }, needsReview: { type: 'noul', noul: 0.35 },
};
const routingAnswers = {
  target: { type: 'choice', choice: 'mac-review', confidence: 0.92,
    probabilities: { 'mac-review': 0.92, 'windows-probe': 0.04, hold: 0.04 } },
  priority: { type: 'choice', choice: 'normal', confidence: 0.88,
    probabilities: { low: 0.08, normal: 0.88, high: 0.04 } },
  needsReview: { type: 'noul', noul: 0.15 },
};
const routingRoutes = [
  { id: 'mac-review', targetThreadId: '01a0344b-d760-7090-93ae-ddffa423843b', host: 'mac', client: 'codex', scope: 'Nisi contract review' },
  { id: 'windows-probe', targetThreadId: '01a010c6-ab72-7f32-9867-f3223abbf101', host: 'windows', client: 'opencode', scope: 'Windows probe and compatibility review' },
];

test('analyzeTask returns typed advisory answers with an exact task hash', async () => {
  const captured = {};
  const evaluator = createJevEvaluator({ id: 'jev-cap-task', apiKey: 'test-key', fetch: stubFetch(captured, {
    model: 'jev-1.14.0', answers: taskAnswers, usage: { input_tokens: 20, output_tokens: 8 },
  }) });
  const task = { taskId: 'task.1', text: 'Add a bounded parser.', mode: 'edit', language: 'javascript', acceptanceCriteria: ['Reject malformed input.'] };
  const result = await analyzeTask({ evaluator, task });
  assert.equal(result.kind, 'nisi.jev.advisory.v1');
  assert.equal(result.capability, 'analyzeTask');
  assert.equal(result.status, 'RESPONSE_VALIDATED');
  assert.equal(result.accepted, false);
  assert.equal(result.taskSha256, sha256Text(stableStringify(task)));
  assert.equal(result.candidateSha256, null);
  assert.equal(result.answers.route.choice, 'code_change');
  assert.equal(result.answers.risk.score, 1);
  assert.equal(result.answers.destructive.noul, 0.1);
  assert.equal(result.usage.inputTokens, 20);
  assert.equal(JSON.stringify(result).includes(task.text), false);
  const wire = JSON.parse(captured.init.body);
  assert.deepEqual(wire.state, { task });
});

test('triageCandidate binds the exact normalized task and candidate hashes', async () => {
  const candidate = { schemaVersion: 1, authorId: 'author.one', files: [{ path: 'src/a.js', content: 'export const answer = 42;\n' }] };
  const captured = {};
  const evaluator = createJevEvaluator({ id: 'jev-cap-candidate', apiKey: 'test-key', fetch: stubFetch(captured, {
    model: 'jev-1.14.0', answers: candidateAnswers, usage: { input_tokens: 30, output_tokens: 10 },
  }) });
  const task = { taskId: 'task.2', text: 'Review the answer.', mode: 'review', language: 'javascript' };
  const result = await triageCandidate({ evaluator, task, candidate });
  assert.equal(result.capability, 'triageCandidate');
  assert.equal(result.status, 'RESPONSE_VALIDATED');
  assert.equal(result.taskSha256, sha256Text(stableStringify(task)));
  assert.equal(result.candidateSha256, sha256Text(stableStringify(candidate)));
  assert.equal(result.answers.scope.choice, 'in_scope');
  assert.equal(result.answers.quality.probabilities['2'], 0.9);
  assert.equal(JSON.stringify(result).includes(candidate.files[0].content), false);
  const wire = JSON.parse(captured.init.body);
  assert.deepEqual(wire.state, { task, candidate });
});

test('capability factory reuses one evaluator and exposes both operations', async () => {
  let calls = 0;
  const evaluator = { async evaluate() { calls += 1; return { model: 'stub', answers: taskAnswers, usage: null,
    evidence: { requestedModel: 'stub', requestSha256: 'a'.repeat(64), responseSha256: 'b'.repeat(64), elapsedMs: 1 } }; } };
  const capabilities = createJevCapabilities(evaluator);
  const result = await capabilities.analyzeTask({ task: 'Explain this change.' });
  assert.equal(result.capability, 'analyzeTask');
  assert.equal(calls, 1);
  assert.equal(typeof capabilities.triageCandidate, 'function');
  assert.equal(typeof capabilities.proposeRouting, 'function');
});

test('proposeRouting returns a bounded route advisory bound to the route registry', async () => {
  const captured = {};
  const evaluator = createJevEvaluator({ id: 'jev-cap-routing', apiKey: 'test-key', fetch: stubFetch(captured, {
    model: 'jev-1.14.0', answers: routingAnswers, usage: { input_tokens: 31, output_tokens: 11 },
  }) });
  const result = await proposeRouting({ evaluator, task: { taskId: 'task.route', text: 'Review the route.' }, routes: routingRoutes });
  assert.equal(result.capability, 'proposeRouting');
  assert.equal(result.routing.routeId, 'mac-review');
  assert.equal(result.routing.priority, 'normal');
  assert.equal(result.routing.needsReview, false);
  assert.equal(result.routing.confidence, 0.85);
  assert.match(result.routesSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.taskSha256, sha256Text(stableStringify({ taskId: 'task.route', text: 'Review the route.' })));
  assert.equal(JSON.stringify(result).includes('Review the route.'), false);
  const wire = JSON.parse(captured.init.body);
  assert.deepEqual(wire.state.task, { taskId: 'task.route', text: 'Review the route.' });
  assert.deepEqual(wire.state.routes, routingRoutes);
});

test('proposeRouting rejects an unknown route answer before it can become a queue job', async () => {
  const bad = { ...routingAnswers, target: { ...routingAnswers.target, choice: 'other' } };
  const evaluator = createJevEvaluator({ id: 'jev-cap-routing-bad', apiKey: 'test-key', fetch: stubFetch({}, {
    model: 'jev-1.14.0', answers: bad,
  }) });
  await assert.rejects(() => proposeRouting({ evaluator, task: 'Route this.', routes: routingRoutes }), expectCode('JEV_ANSWER_INVALID'));
});

test('strict bounds reject malformed or oversized inputs before evaluation', async () => {
  let calls = 0;
  const evaluator = { async evaluate() { calls += 1; return { model: 'stub', answers: taskAnswers, usage: null, evidence: {} }; } };
  await assert.rejects(() => analyzeTask({ evaluator, task: { text: 'x', extra: true } }), expectCode('JEV_CAPABILITY_INPUT_INVALID'));
  await assert.rejects(() => analyzeTask({ evaluator, task: 'x'.repeat(16 * 1024 + 1) }), expectCode('JEV_TASK_INVALID'));
  await assert.rejects(() => triageCandidate({ evaluator, task: 'x', candidate: { files: [{ path: '../bad', content: 'x' }] } }), expectCode('JEV_CANDIDATE_INVALID'));
  assert.equal(calls, 0);
});

test('answer coverage and probability ranges are validated without leaking transport errors', async () => {
  const bad = { ...taskAnswers, risk: { ...taskAnswers.risk, probabilities: { '0': 0.4, '1': 0.4, '2': 0.4 } } };
  const evaluator = createJevEvaluator({ id: 'jev-cap-bad', apiKey: 'test-key', fetch: stubFetch({}, { model: 'jev-1.14.0', answers: bad }) });
  await assert.rejects(() => analyzeTask({ evaluator, task: 'Check this.' }), expectCode('JEV_ANSWER_INVALID'));
  const missing = { ...taskAnswers }; delete missing.route;
  const second = createJevEvaluator({ id: 'jev-cap-missing', apiKey: 'test-key', fetch: stubFetch({}, { model: 'jev-1.14.0', answers: missing }) });
  await assert.rejects(() => analyzeTask({ evaluator: second, task: 'Check this.' }), expectCode('JEV_ANSWER_COVERAGE'));
});
