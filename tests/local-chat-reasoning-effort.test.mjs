import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalChatAuthorAdapter, createLocalChatReviewerAdapter } from '../adapters/local-chat.mjs';
import { createOpenCodeLocalOrchestrator } from '../hosts/local-models/opencode-orchestration-v1.mjs';

const task = (mode = 'edit') => ({ taskId: 'reasoning.fixture', mode, language: 'javascript',
  allowedFiles: ['src/a.mjs'], protectedFiles: [], protectedSnapshots: {},
  acceptanceCriteria: ['Export value one.'],
  policy: { repairBudget: 0, totalDeadlineMs: 1000, requiredReviewers: 1, requireReportStore: false } });
const candidate = { files: [{ path: 'src/a.mjs', content: 'export default 1;' }] };
const payload = { task: task(), candidate, acceptanceCriteria: ['Export value one.'],
  binding: { schemaVersion: 1, runId: 'reasoning.run', taskFingerprint: 'a'.repeat(64), attempt: 0, candidateFingerprint: 'b'.repeat(64) } };
const authorOutput = { candidate, note: 'draft' };
const reviewOutput = { findings: [], summary: 'reviewed' };
const response = (model, value) => new Response(JSON.stringify({ model,
  choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }));

function adapterFixture(operation, options = {}) {
  const requests = [];
  const output = operation === 'review' ? reviewOutput : authorOutput;
  const input = { destination: 'LOOPBACK_HTTP', endpoint: 'http://127.0.0.1/chat', model: 'reasoning.model',
    id: operation === 'review' ? 'reasoning.reviewer' : 'reasoning.author', maxOutputTokens: 128,
    reasoningEffort: 'none', fetch: async (_url, request) => { requests.push(JSON.parse(request.body)); return response('reasoning.model', output); }, ...options };
  const adapter = operation === 'review' ? createLocalChatReviewerAdapter(input) : createLocalChatAuthorAdapter(input);
  return { adapter, requests, run: () => adapter[operation](payload) };
}

for (const operation of ['draft', 'review']) test(`explicit none forwards reasoning effort for ${operation}`, async () => {
  const fixture = adapterFixture(operation);
  await fixture.run();
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.requests[0].reasoning_effort, 'none');
  const receipt = fixture.adapter.receipts()[0];
  assert.equal(receipt.schemaVersion, 3);
  assert.equal(receipt.reasoningEffort, 'none');
  assert.equal(receipt.outputMode, 'json_schema');
});

test('invalid reasoning effort values refuse construction without dispatch', () => {
  for (const value of [null, true, false, '', 'low', 'NONE', 0, {}, []]) {
    let calls = 0;
    assert.throws(() => createLocalChatReviewerAdapter({ destination: 'LOOPBACK_HTTP', endpoint: 'http://127.0.0.1/chat',
      model: 'm', id: 'reviewer', reasoningEffort: value, fetch: async () => { calls += 1; } }),
      { code: 'LOCAL_CHAT_REASONING_EFFORT_INVALID' });
    assert.equal(calls, 0);
  }
});

test('reasoning effort accessor is captured once for wire and receipt', async () => {
  let reads = 0, body;
  const adapter = createLocalChatReviewerAdapter({ destination: 'LOOPBACK_HTTP', endpoint: 'http://127.0.0.1/chat',
    model: 'm', id: 'reviewer', get reasoningEffort() { reads += 1; return 'none'; },
    fetch: async (_url, request) => { body = JSON.parse(request.body); return response('m', reviewOutput); } });
  await adapter.review(payload);
  assert.equal(reads, 1);
  assert.equal(body.reasoning_effort, 'none');
  assert.equal(adapter.receipts()[0].reasoningEffort, 'none');
});

test('final content remains mandatory when reasoning content is present', async () => {
  let calls = 0;
  const adapter = createLocalChatReviewerAdapter({ destination: 'LOOPBACK_HTTP', endpoint: 'http://127.0.0.1/chat',
    model: 'm', id: 'reviewer', reasoningEffort: 'none', fetch: async () => {
      calls += 1; return new Response(JSON.stringify({ model: 'm', choices: [{ finish_reason: 'stop',
        message: { content: '', reasoning_content: JSON.stringify(reviewOutput) } }] }));
    } });
  await assert.rejects(adapter.review(payload), { code: 'LOCAL_CHAT_EMPTY_RESPONSE' });
  assert.equal(calls, 1);
  assert.equal(adapter.receipts()[0].reasoningEffort, 'none');
});

test('host forwards explicit none to both draft and review requests and receipts', async () => {
  const requests = [];
  const fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body || "{}") });
    if (url === 'http://127.0.0.1:1234/api/v1/models') return new Response(JSON.stringify({ models: [
      { key: 'reasoning.model', display_name: 'reasoning.model', type: 'llm', loaded_instances: [{ id: 'reasoning.model' }] },
    ] }));
    const body = JSON.parse(options.body);
    const operation = JSON.parse(body.messages[1].content).operation;
    return response(body.model, operation === 'draft' ? authorOutput : reviewOutput);
  };
  const host = createOpenCodeLocalOrchestrator({ fetch });
  const result = await host.work({ runId: 'reasoning.host', task: task(), mode: 'draft_review',
    authorModel: 'reasoning.model', reviewerModel: 'reasoning.model', reasoningEffort: 'none' });
  assert.equal(result.status, 'RESPONSE_VALIDATED');
  const posts = requests.filter(request => request.url.endsWith('/v1/chat/completions'));
  assert.equal(posts.length, 2);
  for (const post of posts) assert.equal(post.body.reasoning_effort, 'none');
  assert.deepEqual(result.receipts.map(receipt => [receipt.schemaVersion, receipt.reasoningEffort]), [[3, 'none'], [3, 'none']]);
});
