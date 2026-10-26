// Deterministic host tests: injected transports only, no model server or tools.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { syncBuiltinESMExports } from 'node:module';
import { createOpenCodeLocalOrchestrator } from '../hosts/local-models/opencode-orchestration-v1.mjs';
import { createCandidate, createTaskSpecification, sha256Text, stableStringify } from '../workflow/contracts.mjs';

const ORIGIN = 'http://127.0.0.1:1234';
const model = (key, loaded = true) => ({ key, display_name: key, type: 'llm', loaded_instances: loaded ? [{ id: key }] : [] });
const task = (mode = 'edit') => ({ taskId: 'fixture.task', mode, language: 'javascript', allowedFiles: ['src/a.js'],
  protectedFiles: [], protectedSnapshots: {}, acceptanceCriteria: ['Export the number 1.'],
  policy: { repairBudget: 0, totalDeadlineMs: 1000, requiredReviewers: 1, requireReportStore: false } });
const candidate = content => ({ files: [{ path: 'src/a.js', content: content ?? 'export default 1;' }] });
const input = overrides => ({ runId: 'fixture.run', task: task(), mode: 'draft_review',
  authorModel: 'fixture/author', reviewerModel: 'fixture/reviewer', ...overrides });
const json = value => new Response(JSON.stringify(value), { status: 200 });
const completion = (requestedModel, content, overrides = {}) => json({ model: requestedModel,
  choices: [{ finish_reason: 'stop', message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }, ...overrides });
const code = expected => error => error.code === expected;
function fixture({ inventories, chat } = {}) {
  const calls = []; let inventoryIndex = 0;
  const fetch = async (url, options) => {
    calls.push({ url, ...options });
    assert.equal(options.redirect, 'error');
    if (url === `${ORIGIN}/api/v1/models`) {
      assert.equal(options.method, 'GET');
      const models = inventories ? inventories[Math.min(inventoryIndex++, inventories.length - 1)]
        : [model('fixture/author'), model('fixture/reviewer')];
      return json({ models });
    }
    assert.equal(url, `${ORIGIN}/v1/chat/completions`); assert.equal(options.method, 'POST');
    const body = JSON.parse(options.body), operation = JSON.parse(body.messages[1].content).operation;
    assert.equal(body.stream, false); assert.equal(body.tools, undefined);
    return chat ? chat(body, options, operation) : completion(body.model, operation === 'draft'
      ? { candidate: candidate(), note: 'Proposed export.' } : { findings: [], summary: 'Inspected the provided source only.' });
  };
  return { calls, client: createOpenCodeLocalOrchestrator({ fetch }) };
}

test('construction is inert; discovery remains bounded inventory without inference', async () => {
  const { client, calls } = fixture(); assert.equal(calls.length, 0);
  const result = await client.discover();
  assert.equal(result.status, 'LISTED'); assert.equal(calls.length, 1);
  assert.equal(result.runtimes[0].models[0].inference, 'NOT_TESTED');
  assert.equal(client.status().state, 'IDLE');
});

test('two sequential calls rediscover residency and yield a Nisi-convertible advisory candidate', async () => {
  const { client, calls } = fixture(); const result = await client.work(input());
  assert.equal(result.status, 'RESPONSE_VALIDATED'); assert.equal(result.accepted, false);
  assert.equal(result.advisoryOnly, true); assert.equal(result.independentReviewerCount, 0);
  assert.equal(result.outputMode, 'json_instruction');
  assert.equal(result.distinctReportedModelCount, 2); assert.equal(result.reviewRelationship, 'different_reported_model');
  for (const key of ['checks', 'tests', 'certification']) assert.equal(result[key], 'NOT_RUN');
  assert.deepEqual(calls.map(call => call.method), ['GET', 'POST', 'GET', 'POST']);
  for (const request of calls.filter(call => call.method === 'POST').map(call => JSON.parse(call.body))) {
    assert.equal(Object.hasOwn(request, 'response_format'), false);
  }
  const reviewPrompt = JSON.parse(JSON.parse(calls[3].body).messages[1].content);
  assert.equal(reviewPrompt.tests.status, 'NOT_RUN'); assert.equal(reviewPrompt.tests.evidence.assertionsExecuted, 0);
  assert.equal(result.candidateFingerprint, createCandidate(result.candidate, { authorId: 'any.author' }).fingerprint);
  assert.equal(result.binding.taskFingerprint, sha256Text(`nisi/workflow-task/v1\0${stableStringify(createTaskSpecification(task()))}`));
  assert.equal(result.binding.runId, 'opencode.advisory:fixture.run'); assert.equal(result.binding.attempt, 0);
  assert.equal(result.bindingNamespace, 'OPENCODE_ADVISORY_NOT_WORKFLOW');
  assert.deepEqual(Object.keys(result.review).sort(), ['findings', 'summary']);
  assert.ok(Object.isFrozen(result.candidate.files));
  for (const receipt of result.receipts) {
    assert.equal(receipt.status, 'RESPONSE_VALIDATED'); assert.equal(receipt.requestedModel, receipt.reportedModel);
    for (const field of ['requestSha256', 'responseSha256', 'contentSha256']) assert.match(receipt[field], /^[a-f0-9]{64}$/u);
    assert.equal(receipt.usage.totalTokens, 15);
  }
  const { outputSha256, ...body } = result;
  assert.equal(outputSha256, sha256Text(stableStringify(body)));
});

test('opt-in JSON schema mode adds a strict response format to both model requests', async () => {
  const { client, calls } = fixture();
  const result = await client.work(input({ outputMode: 'json_schema' }));
  assert.equal(result.status, 'RESPONSE_VALIDATED');
  assert.equal(result.outputMode, 'json_schema');
  const requests = calls.filter(call => call.method === 'POST').map(call => JSON.parse(call.body));
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.response_format.type, 'json_schema');
    assert.equal(request.response_format.json_schema.strict, true);
    assert.equal(request.response_format.json_schema.name.startsWith('nisi_'), true);
  }
});

test('same-model role separation remains self-review with zero independent reviewers', async () => {
  const { client } = fixture();
  const result = await client.work(input({ reviewerModel: 'fixture/author' }));
  assert.equal(result.status, 'RESPONSE_VALIDATED'); assert.equal(result.reviewRelationship, 'self_review');
  assert.equal(result.independentReviewerCount, 0); assert.equal(result.distinctReportedModelCount, 1);
});

test('review-only supplies source data without inventing an author or tests', async () => {
  const { client, calls } = fixture();
  const result = await client.work({ runId: 'review.operation', task: task('review'), mode: 'review',
    reviewerModel: 'fixture/reviewer', candidate: candidate() });
  assert.equal(result.status, 'RESPONSE_VALIDATED'); assert.equal(calls.length, 2);
  assert.equal(result.note, null); assert.equal(result.reviewRelationship, 'review_only');
  assert.equal(result.receipts[0].inputCandidateFingerprint, result.candidateFingerprint);
});

test('closed input rejects URLs, tools, model-supplied binding, oversized data and invalid limits before transport', async () => {
  for (const change of [{ endpoint: ORIGIN }, { tools: [] }, { binding: {} }, { timeoutMs: null },
    { timeoutMs: 120001 }, { maxOutputTokens: 2049 }, { allowColdStart: 'true' }, { authorModel: ' bad' },
    { outputMode: 'xml' }, { outputMode: null }, { outputMode: true },
    { runId: '' }, { mode: 'repair' }, { candidate: candidate() }]) {
    const { client, calls } = fixture();
    const expected = Object.hasOwn(change, 'outputMode') ? 'OPENCODE_OUTPUT_MODE_INVALID' : undefined;
    await assert.rejects(() => client.work(input(change)), expected ? code(expected) : undefined); assert.equal(calls.length, 0);
    assert.equal(client.status().state, 'IDLE');
  }
  const { client, calls } = fixture();
  await assert.rejects(() => client.work({ runId: 'big', task: task('review'), mode: 'review',
    reviewerModel: 'fixture/reviewer', candidate: candidate('x'.repeat(262144)) }), code('OPENCODE_INPUT_TOO_LARGE'));
  assert.equal(calls.length, 0);
  assert.throws(() => createOpenCodeLocalOrchestrator({ endpoint: ORIGIN }), code('OPENCODE_INPUT_SCHEMA'));
});

test('listed unloaded or embedding models cannot be used as resident LLMs', async () => {
  for (const models of [[model('fixture/author', false)], [{ ...model('fixture/author'), type: 'embedding' }], []]) {
    const { client, calls } = fixture({ inventories: [models] }); const result = await client.work(input());
    assert.equal(result.status, 'UNAVAILABLE'); assert.equal(result.candidate, null);
    assert.equal(calls.length, 1); assert.equal(client.status().recoveryRequired, true);
  }
});

test('explicit cold start only permits listed LLM when no other LLM is resident', async () => {
  const draft = { runId: 'cold', task: task(), mode: 'draft', authorModel: 'fixture/author', allowColdStart: true };
  const empty = fixture({ inventories: [[model('fixture/author', false)]] });
  assert.equal((await empty.client.work(draft)).status, 'RESPONSE_VALIDATED');
  assert.deepEqual(empty.calls.map(call => call.method), ['GET', 'POST']);
  const occupied = fixture({ inventories: [[model('fixture/author', false), model('fixture/reviewer')]] });
  assert.equal((await occupied.client.work(draft)).code, 'OPENCODE_MODEL_NOT_RESIDENT');
  assert.equal(occupied.calls.length, 1);
});

test('ambiguous instance IDs are refused rather than inferred from catalog keys', async () => {
  for (const ids of [['different-instance'], ['fixture/author', 'second-instance']]) {
    const { client, calls } = fixture({ inventories: [[{ ...model('fixture/author'), loaded_instances: ids.map(id => ({ id })) }]] });
    const result = await client.work(input());
    assert.equal(result.code, 'OPENCODE_MODEL_INSTANCE_AMBIGUOUS'); assert.equal(calls.length, 1);
  }
  const collision = fixture({ inventories: [[model('fixture/author'), {
    ...model('fixture/reviewer'), loaded_instances: [{ id: 'fixture/author' }],
  }]] });
  assert.equal((await collision.client.work(input())).code, 'OPENCODE_MODEL_INSTANCE_AMBIGUOUS');
  assert.equal(collision.calls.length, 1);
});

test('second-stage residency is fresh and never causes implicit loading or retained candidate acceptance', async () => {
  const { client, calls } = fixture({ inventories: [
    [model('fixture/author'), model('fixture/reviewer')], [model('fixture/author'), model('fixture/reviewer', false)],
  ] });
  const result = await client.work(input({ allowColdStart: true }));
  assert.equal(result.code, 'OPENCODE_MODEL_NOT_RESIDENT'); assert.equal(result.candidate, null);
  assert.equal(result.receipts.length, 1); assert.equal(calls.length, 3);
});

test('malformed JSON, counterfeit status or binding and actual-model mismatch fail closed', async () => {
  const withoutModel = body => completion(body.model, { candidate: candidate(), note: 'No model identity.' }, { model: undefined });
  const bad = [
    (body) => completion(body.model, '{"candidate":{},"candidate":{},"note":"fake"}'),
    (body) => completion(body.model, { candidate: candidate(), note: 'fake', testsPassed: true }),
    (body) => completion(body.model, { candidate: candidate(), note: 'fake', binding: { runId: 'old' } }),
    (body) => completion('wrong/model', { candidate: candidate(), note: 'wrong model' }),
    withoutModel,
    (body) => completion(body.model, { candidate: candidate(), note: 'truncated' }, {
      choices: [{ finish_reason: 'length', message: { content: '{}' } }] }),
    (body) => completion(body.model, {}, { choices: [{ finish_reason: 'stop', message: { content: '{}', tool_calls: [{}] } }] }),
    (body) => completion(body.model, 'x'.repeat(262145)),
  ];
  for (const chat of bad) {
    const { client, calls } = fixture({ chat }); const result = await client.work(input());
    assert.equal(result.status, 'UNAVAILABLE'); assert.equal(result.accepted, false);
    if (chat === withoutModel) assert.equal(result.code, 'LOCAL_CHAT_MODEL_MISMATCH');
    assert.equal(result.candidate, null); assert.equal(result.review, null);
    assert.equal(calls.length, 2); assert.equal(client.status().state, 'QUARANTINED');
    await assert.rejects(() => client.work(input()), code('OPENCODE_ORCHESTRATOR_QUARANTINED'));
    assert.equal(calls.length, 2);
  }
});

test('draft scope and protected content are validated after inference', async () => {
  for (const path of ['../escape.js', 'src/outside.js', 'src/a.js']) {
    const { client, calls } = fixture({ chat: body => completion(body.model,
      { candidate: { files: [{ path, content: 'changed' }] }, note: 'change' }) });
    const protectedTask = { ...task(), protectedFiles: ['src/a.js'], protectedSnapshots: { 'src/a.js': sha256Text('original') } };
    const result = await client.work(input({ task: protectedTask }));
    assert.equal(result.status, 'UNAVAILABLE'); assert.equal(result.candidate, null); assert.equal(calls.length, 2);
  }
});

test('review findings stay advisory and no review PASS is exposed as execution evidence', async () => {
  const { client } = fixture({ chat: (body, options, operation) => completion(body.model, operation === 'draft'
    ? { candidate: candidate(), note: 'draft' } : { findings: [{ code: 'BUG', message: 'A concrete defect.' }], summary: 'Needs correction.' }) });
  const result = await client.work(input());
  assert.equal(result.status, 'RESPONSE_VALIDATED'); assert.equal(result.review.findings.length, 1);
  assert.equal(result.accepted, false); assert.equal(result.tests, 'NOT_RUN'); assert.equal(result.review.status, undefined);
});

test('input is frozen before await and later calls recompute hashes for altered task and source', async () => {
  let release; const held = new Promise(resolve => { release = resolve; });
  const calls = []; let first = true;
  const client = createOpenCodeLocalOrchestrator({ fetch: async (url, options) => {
    if (options.method === 'GET') { if (first) { first = false; await held; } return json({ models: [model('fixture/reviewer')] }); }
    const body = JSON.parse(options.body); calls.push(JSON.parse(body.messages[1].content));
    return completion(body.model, { findings: [], summary: 'Inspected.' });
  } });
  const raw = { runId: 'first', task: task('review'), mode: 'review', reviewerModel: 'fixture/reviewer', candidate: candidate() };
  const pending = client.work(raw);
  raw.task.acceptanceCriteria[0] = 'Export the number 2.'; raw.candidate.files[0].content = 'export default 2;';
  release(); const original = await pending;
  const changed = await client.work({ ...raw, runId: 'second' });
  assert.equal(calls[0].candidate.files[0].content, 'export default 1;');
  assert.equal(calls[1].candidate.files[0].content, 'export default 2;');
  assert.notEqual(original.binding.taskFingerprint, changed.binding.taskFingerprint);
  assert.notEqual(original.candidateFingerprint, changed.candidateFingerprint);
  assert.notEqual(original.outputSha256, changed.outputSha256);
  assert.equal(changed.receipts[0].runId, 'opencode.advisory:second');
});

test('cancel during inference rejects late success, quarantines owner and skips review', async () => {
  const controller = new AbortController(); let finish, entered;
  const inChat = new Promise(resolve => { entered = resolve; });
  const { client, calls } = fixture({ chat: body => new Promise(resolve => {
    finish = () => resolve(completion(body.model, { candidate: candidate(), note: 'late' })); entered();
  }) });
  const pending = client.work(input(), { signal: controller.signal }); await inChat; controller.abort();
  const result = await pending;
  assert.equal(result.code, 'OPENCODE_CANCELLED'); assert.equal(result.candidate, null); assert.equal(calls.length, 2);
  assert.equal(result.recoveryRequired, true); assert.equal(client.status().transport.remoteInferenceStopped, 'NOT_OBSERVED');
  finish(); await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(() => client.work(input()), code('OPENCODE_ORCHESTRATOR_QUARANTINED'));
  assert.equal(calls.length, 2);
});

test('total deadline includes inventory and rejects eventual inventory success', async () => {
  let release; let calls = 0;
  const client = createOpenCodeLocalOrchestrator({ fetch: () => { calls++; return new Promise(resolve => { release = () => resolve(json({ models: [model('fixture/author')] })); }); } });
  const result = await client.work(input({ timeoutMs: 10 }));
  assert.equal(result.code, 'OPENCODE_DEADLINE_EXCEEDED'); assert.equal(result.candidate, null); assert.equal(calls, 1);
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(client.status().state, 'QUARANTINED');
});

test('already-cancelled request performs zero transport and concurrent invocation cannot start', async () => {
  const aborted = fixture();
  const result = await aborted.client.work(input(), { signal: AbortSignal.abort() });
  assert.equal(result.code, 'OPENCODE_CANCELLED'); assert.equal(aborted.calls.length, 0);
  assert.equal(result.recoveryRequired, false); assert.equal(aborted.client.status().state, 'IDLE');
  assert.equal(aborted.client.status().transport.state, 'IDLE');
  assert.equal((await aborted.client.work(input())).status, 'RESPONSE_VALIDATED');
  let release;
  const client = createOpenCodeLocalOrchestrator({ fetch: () => new Promise(resolve => { release = () => resolve(json({ models: [] })); }) });
  const pending = client.work(input());
  await assert.rejects(() => client.work(input()), code('OPENCODE_ALREADY_RUNNING'));
  await assert.rejects(() => client.discover(), code('OPENCODE_ALREADY_RUNNING'));
  release(); await pending;
});

test('deadline before first discovery leaves an unused host reusable', async () => {
  const originalNow = performance.now; let reads = 0;
  const { client, calls } = fixture();
  performance.now = () => reads++ === 0 ? 0 : 1001;
  try {
    const result = await client.work(input({ timeoutMs: 1000 }));
    assert.equal(result.code, 'OPENCODE_DEADLINE_EXCEEDED'); assert.equal(calls.length, 0);
    assert.equal(result.recoveryRequired, false); assert.equal(client.status().state, 'IDLE');
  } finally { performance.now = originalNow; }
  assert.equal((await client.work(input())).status, 'RESPONSE_VALIDATED');
});

test('default transport uses direct literal loopback despite proxy settings and never follows redirects', async () => {
  const originalRequest = http.request, originalProxy = process.env.HTTP_PROXY;
  const calls = []; let redirect = false;
  http.request = (options, callback) => {
    calls.push(options);
    const request = new EventEmitter();
    request.end = () => {
      const response = new PassThrough(); response.statusCode = redirect ? 302 : 200;
      callback(response); response.end(JSON.stringify({ models: [model('fixture/author')] }));
    };
    return request;
  };
  syncBuiltinESMExports(); process.env.HTTP_PROXY = 'http://proxy.invalid:8080';
  try {
    assert.equal((await createOpenCodeLocalOrchestrator().discover()).status, 'LISTED');
    assert.equal(calls[0].hostname, '127.0.0.1'); assert.equal(calls[0].port, 1234);
    assert.equal(calls[0].path, '/api/v1/models'); assert.equal(calls[0].agent, false);
    redirect = true;
    const result = await createOpenCodeLocalOrchestrator().discover();
    assert.equal(result.runtimes[0].code, 'INVENTORY_REDIRECT_REFUSED'); assert.equal(calls.length, 2);
  } finally {
    http.request = originalRequest; syncBuiltinESMExports();
    if (originalProxy === undefined) delete process.env.HTTP_PROXY; else process.env.HTTP_PROXY = originalProxy;
  }
});

test('deadline crossed during final canonical output hashing rejects an otherwise valid result', async () => {
  const originalHash = crypto.createHash, originalNow = performance.now;
  let fakeNow = 0;
  performance.now = () => fakeNow;
  crypto.createHash = (...args) => {
    const hash = originalHash(...args), originalUpdate = hash.update;
    hash.update = function (value, ...rest) {
      if (typeof value === 'string' && value.includes('"kind":"nisi.opencode.local-advisory.v1"') &&
          value.includes('"status":"RESPONSE_VALIDATED"')) fakeNow = 1001;
      return originalUpdate.call(this, value, ...rest);
    };
    return hash;
  };
  syncBuiltinESMExports();
  try {
    const { client } = fixture(); const result = await client.work(input({ timeoutMs: 1000 }));
    assert.equal(result.code, 'OPENCODE_DEADLINE_EXCEEDED'); assert.equal(result.status, 'UNAVAILABLE');
    assert.equal(result.candidate, null); assert.equal(result.recoveryRequired, true);
  } finally { crypto.createHash = originalHash; syncBuiltinESMExports(); performance.now = originalNow; }
});
