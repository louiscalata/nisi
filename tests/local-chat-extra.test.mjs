// Regression tests for the local OpenAI-compatible adapter. No model calls;
// every response and transport is deterministic test data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalChatAuthorAdapter, createLocalChatReviewerAdapter } from '../adapters/local-chat.mjs';
import { runLocalModelExample } from '../examples/local-model-workflow.mjs';

const task = {
  taskId: 'extra.local-chat', mode: 'edit', language: 'json', allowedFiles: ['config.json'],
  protectedFiles: [], protectedSnapshots: {}, acceptanceCriteria: ['config is valid JSON'],
  policy: { repairBudget: 1, totalDeadlineMs: 1000, requiredReviewers: 1, requireReportStore: false },
};
const binding = {
  schemaVersion: 1, runId: 'extra-run', taskFingerprint: 'a'.repeat(64), attempt: 0,
  candidateFingerprint: null,
};
const payload = (overrides = {}) => ({ task, candidate: null, acceptanceCriteria: task.acceptanceCriteria, binding, ...overrides });

function rawResponse(bytes, { ok = true, onCancel = () => {} } = {}) {
  let offset = 0;
  let cancelled = 0;
  const reader = {
    async read() {
      if (offset >= bytes.length) return { done: true };
      const next = bytes.slice(offset, Math.min(offset + 19, bytes.length));
      offset += next.length;
      return { done: false, value: next };
    },
    async cancel() { cancelled += 1; onCancel(); },
    releaseLock() {},
  };
  return {
    ok,
    body: { getReader: () => reader },
    get cancelled() { return cancelled; },
  };
}

function jsonResponse(value, options = {}) {
  return rawResponse(new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)), options);
}

function envelope(model, content, { usage = { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 }, finishReason = 'stop' } = {}) {
  return { model, choices: [{ finish_reason: finishReason, message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }], usage };
}

function reviewerResponse(model, content, options) { return jsonResponse(envelope(model, content, options)); }

function queuedFetch(values, { calls = [], responses = [] } = {}) {
  return async (url, request) => {
    calls.push({ url, request });
    const next = values.shift();
    if (!next) throw new Error('unexpected mocked request');
    const response = typeof next === 'function' ? await next(url, request) : next;
    responses.push(response);
    return response;
  };
}

async function rejectsCode(action, code) {
  await assert.rejects(action, error => error?.code === code, `expected ${code}`);
}

function reviewer(input = {}) {
  return createLocalChatReviewerAdapter({
    destination: 'LOOPBACK_HTTP', endpoint: 'http://127.0.0.1:1234/v1/chat/completions',
    model: 'review-model', id: 'extra.reviewer', ...input,
  });
}

test('REPAIRED requires a candidate object before a validated receipt can be issued', async () => {
  for (const candidate of [null, false, 0, '', [], 'not a candidate']) {
    const adapter = createLocalChatAuthorAdapter({
      destination: 'LOOPBACK_HTTP', endpoint: 'http://127.0.0.1/chat', model: 'author-model', id: 'extra.author',
      fetch: async () => jsonResponse(envelope('author-model', {status: 'REPAIRED', candidate, note: 'claimed correction'})),
    });
    await rejectsCode(() => adapter.repair(payload({binding: {...binding, candidateFingerprint: 'b'.repeat(64)}})), 'LOCAL_CHAT_REPAIR_INVALID');
    assert.equal(adapter.receipts().length, 1);
    assert.equal(adapter.receipts()[0].status, 'UNAVAILABLE');
    assert.equal(adapter.receipts()[0].resultCandidateFingerprint, null);
    assert.equal(adapter.receipts()[0].code, 'LOCAL_CHAT_REPAIR_INVALID');
  }
});

test('malformed repair cannot reach the reviewer or issue a repaired-candidate receipt', async () => {
  const calls = [];
  const result = await runLocalModelExample({
    endpoint: 'http://127.0.0.1/chat', authorModel: 'author-model', reviewerModel: 'review-model', timeoutMs: 5000,
    fetch: queuedFetch([
      jsonResponse(envelope('author-model', {candidate: {files: [{path: 'retry-config.json', content: '{"backoff":"exponential","maxRetries":2,"retryDelayMs":250}'}]}, note: 'draft'})),
      jsonResponse(envelope('author-model', {status: 'REPAIRED', candidate: null, note: 'invalid repair'})),
    ], {calls}),
  });
  assert.equal(result.report.outcome, 'BLOCKED');
  assert.equal(result.report.repairAttempts, 1);
  assert.equal(calls.length, 2);
  assert.equal(result.reviewerReceipts.length, 0);
  assert.equal(result.authorReceipts[1].status, 'UNAVAILABLE');
  assert.equal(result.authorReceipts[1].code, 'LOCAL_CHAT_REPAIR_INVALID');
  assert.equal(result.report.stages.some(s => s.stage === 'repair' && s.status === 'REPAIRED'), false);
});

test('NO_CHANGE only admits null and preserves the base candidate identity', async () => {
  const base = {...binding, candidateFingerprint: 'b'.repeat(64)};
  for (const candidate of [null, false, 0, '', [], {}, {files: []}]) {
    const adapter = createLocalChatAuthorAdapter({
      destination: 'LOOPBACK_HTTP', endpoint: 'http://127.0.0.1/chat', model: 'author-model', id: 'extra.author',
      fetch: async () => jsonResponse(envelope('author-model', {status: 'NO_CHANGE', candidate, note: 'no useful correction'})),
    });
    if (candidate === null) {
      const result = await adapter.repair(payload({binding: base}));
      assert.equal(result.status, 'NO_CHANGE'); assert.equal(result.candidate, null);
      assert.equal(result.evidence.candidateFingerprint, base.candidateFingerprint);
      assert.equal(result.evidence.baseCandidateFingerprint, base.candidateFingerprint);
      assert.equal(adapter.receipts()[0].status, 'RESPONSE_VALIDATED');
    } else await rejectsCode(() => adapter.repair(payload({binding: base})), 'LOCAL_CHAT_REPAIR_INVALID');
  }
});

test('REPAIRED object still must pass the complete candidate schema', async () => {
  for (const candidate of [{}, {files: []}, {files: [{path: '../escape.json',content:'{}'}]}, {files: [{path:'config.json',content:'{}'},{path:'config.json',content:'{}'}]}]) {
    const adapter = createLocalChatAuthorAdapter({
      destination: 'LOOPBACK_HTTP', endpoint: 'http://127.0.0.1/chat', model: 'author-model', id: 'extra.author',
      fetch: async () => jsonResponse(envelope('author-model', {status:'REPAIRED', candidate, note:'malformed candidate object'})),
    });
    await assert.rejects(() => adapter.repair(payload()), error => typeof error.code === 'string');
    assert.equal(adapter.receipts()[0].status,'UNAVAILABLE');
    assert.equal(adapter.receipts()[0].resultCandidateFingerprint,null);
  }
});

test('example repairs an acceptance failure, reruns checks/tests, and reviews with evidence', async () => {
  const calls = [];
  const values = [
    jsonResponse(envelope('author-model', {
      // Valid JSON with an incorrect acceptance value makes static checks pass
      // and the executable acceptance assertions fail before repair.
      candidate: { files: [{ path: 'retry-config.json', content: '{"backoff":"exponential","maxRetries":2,"retryDelayMs":250}' }] }, note: 'draft',
    })),
    jsonResponse(envelope('author-model', {
      status: 'REPAIRED',
      candidate: { files: [{ path: 'retry-config.json', content: '{"backoff":"exponential","maxRetries":3,"retryDelayMs":250}' }] },
      note: 'closed the JSON object and supplied all required fields',
    })),
    jsonResponse(envelope('review-model', { findings: [], summary: 'checked candidate, static checks, and tests' })),
  ];
  const result = await runLocalModelExample({
    endpoint: 'http://127.0.0.1:1234/v1/chat/completions', authorModel: 'author-model', reviewerModel: 'review-model',
    fetch: queuedFetch(values, { calls }), timeoutMs: 5000,
  });
  assert.equal(result.report.outcome, 'COMPLETED');
  assert.equal(result.report.repairAttempts, 1);
  assert.deepEqual(calls.map(item => JSON.parse(item.request.body).model), ['author-model', 'author-model', 'review-model']);
  assert.equal(result.report.stages.filter(stage => stage.stage === 'staticChecks').length, 2);
  assert.equal(result.report.stages.filter(stage => stage.stage === 'tests').length, 2);
  assert.equal(result.report.stages.at(-1).stage, 'review');
  const repairPrompt = JSON.parse(calls[1].request.body).messages[1].content;
  assert.match(repairPrompt, /RETRY_LIMIT/);
  assert.match(repairPrompt, /tests/);
  const reviewPrompt = JSON.parse(calls[2].request.body).messages[1].content;
  assert.match(reviewPrompt, /"checks"/);
  assert.match(reviewPrompt, /"tests"/);
  for (const item of calls) {
    const body = JSON.parse(item.request.body);
    assert.equal(body.response_format.type, 'json_schema');
    assert.equal(body.response_format.json_schema.strict, true);
    assert.equal(body.response_format.json_schema.schema.additionalProperties, false);
    assert.equal(body.temperature, 0);
  }
  assert.equal(result.authorReceipts.length, 2);
  assert.equal(result.reviewerReceipts.length, 1);
  for (const receipt of [...result.authorReceipts, ...result.reviewerReceipts]) {
    assert.equal(receipt.status, 'RESPONSE_VALIDATED');
    assert.equal(receipt.reportedModel, receipt.requestedModel);
    assert.equal(receipt.usage.promptTokens, 11);
    assert.equal(receipt.usage.completionTokens, 5);
    assert.equal(receipt.usage.totalTokens, 16);
    assert.match(receipt.requestSha256, /^[0-9a-f]{64}$/);
    assert.match(receipt.responseSha256, /^[0-9a-f]{64}$/);
    assert.match(receipt.contentSha256, /^[0-9a-f]{64}$/);
    assert.equal(typeof receipt.runId, 'string');
    assert.equal(typeof receipt.taskFingerprint, 'string');
  }
});

test('malformed model identity, finish reason, envelope schema, Unicode, and duplicate keys fail closed', async () => {
  const cases = [
    ['identity', reviewer({ model: 'expected', fetch: async () => jsonResponse(envelope('actual', { findings: [], summary: 'x' })) }), 'LOCAL_CHAT_MODEL_MISMATCH'],
    ['finish reason', reviewer({ fetch: async () => reviewerResponse('review-model', { findings: [], summary: 'x' }, { finishReason: 'length' }) }), 'LOCAL_CHAT_FINISH_REFUSED'],
    ['choices schema', reviewer({ fetch: async () => jsonResponse({ model: 'review-model', choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) }), 'LOCAL_CHAT_CHOICES_INVALID'],
    ['output schema', reviewer({ fetch: async () => jsonResponse(envelope('review-model', { findings: [] })) }), 'LOCAL_CHAT_OUTPUT_SCHEMA'],
    ['Unicode', reviewer({ fetch: async () => reviewerResponse('review-model', '{"findings":[],"summary":"\\ud800"}') }), 'LOCAL_CHAT_JSON_UNICODE'],
    ['content duplicate', reviewer({ fetch: async () => reviewerResponse('review-model', '{"findings":[],"findings":[],"summary":"x"}') }), 'LOCAL_CHAT_JSON_DUPLICATE_KEY'],
  ];
  for (const [name, adapter, code] of cases) {
    await rejectsCode(() => adapter.review(payload()), code);
    assert.equal(adapter.receipts().at(-1).status, 'UNAVAILABLE', name);
    assert.equal(adapter.receipts().at(-1).code, code, name);
  }
  const duplicateEnvelope = reviewer({ fetch: async () => rawResponse(new TextEncoder().encode(
    '{"model":"review-model","model":"review-model","choices":[{"finish_reason":"stop","message":{"content":"{\\"findings\\":[],\\"summary\\":\\"x\\"}"}}]}'
  )) });
  await rejectsCode(() => duplicateEnvelope.review(payload()), 'LOCAL_CHAT_JSON_DUPLICATE_KEY');
});

test('configuration enforces exact loopback HTTP scope and bounded numeric caps', () => {
  const base = { destination: 'LOOPBACK_HTTP', endpoint: 'http://127.0.0.1/chat', model: 'm', id: 'r' };
  for (const endpoint of ['https://127.0.0.1/chat', 'http://localhost/chat', 'http://user@127.0.0.1/chat', 'http://127.0.0.1/chat?x=1', 'http://127.0.0.1/chat#x']) {
    assert.throws(() => reviewer({ ...base, endpoint }), /LOCAL_CHAT_/);
  }
  assert.throws(() => reviewer({ ...base, destination: 'ANY_HTTP' }), /LOCAL_CHAT_DESTINATION_REQUIRED/);
  assert.throws(() => reviewer({ ...base, unexpected: true }), /LOCAL_CHAT_CONFIG_INVALID/);
  assert.throws(() => reviewer({ ...base, maxRequestBytes: 255 }), /LOCAL_CHAT_REQUEST_CAP_INVALID/);
  assert.throws(() => reviewer({ ...base, maxResponseBytes: 255 }), /LOCAL_CHAT_RESPONSE_CAP_INVALID/);
  assert.throws(() => reviewer({ ...base, timeoutMs: 0 }), /LOCAL_CHAT_TIMEOUT_INVALID/);
});

test('pre-aborted upstream signal and abort during listener registration prevent fetch', async () => {
  let fetchCount = 0;
  const adapter = reviewer({ fetch: async () => { fetchCount += 1; return reviewerResponse('review-model', { findings: [], summary: 'x' }); } });
  const already = new AbortController(); already.abort();
  await rejectsCode(() => adapter.review(payload({ signal: already.signal })), 'ABORTED');
  const racedController = new AbortController();
  const originalAdd = racedController.signal.addEventListener.bind(racedController.signal);
  racedController.signal.addEventListener = (type, listener, options) => {
    const result = originalAdd(type, listener, options);
    if (type === 'abort') racedController.abort();
    return result;
  };
  await rejectsCode(() => adapter.review(payload({ signal: racedController.signal })), 'ABORTED');
  assert.equal(fetchCount, 0);
});

test('request and response byte caps fail before transport or cancel an active reader', async () => {
  let requestCalls = 0;
  const tooSmall = reviewer({ maxRequestBytes: 256, fetch: async () => { requestCalls += 1; throw new Error('must not fetch'); } });
  await rejectsCode(() => tooSmall.review(payload({ acceptanceCriteria: ['x'.repeat(3000)] })), 'LOCAL_CHAT_REQUEST_TOO_LARGE');
  assert.equal(requestCalls, 0);

  let cancelled = 0;
  const tooLarge = reviewer({ maxResponseBytes: 256, fetch: async () => rawResponse(new TextEncoder().encode('x'.repeat(2000)), { onCancel: () => { cancelled += 1; } }) });
  await rejectsCode(() => tooLarge.review(payload()), 'LOCAL_CHAT_RESPONSE_TOO_LARGE');
  assert.ok(cancelled >= 1);
});

test('throwing and hanging fetches produce explicit unavailable and timeout receipts', async () => {
  const throwing = reviewer({ fetch: async () => { throw new Error('transport failed'); } });
  await rejectsCode(() => throwing.review(payload()), 'LOCAL_CHAT_UNAVAILABLE');
  assert.equal(throwing.receipts().at(-1).status, 'UNAVAILABLE');

  const hanging = reviewer({ timeoutMs: 20, fetch: async () => new Promise(() => {}) });
  await rejectsCode(() => hanging.review(payload()), 'LOCAL_CHAT_TIMEOUT');
  assert.equal(hanging.receipts().at(-1).code, 'LOCAL_CHAT_TIMEOUT');
});

test('adapter snapshots configuration and freezes receipt snapshots', async () => {
  const calls = [];
  const input = {
    destination: 'LOOPBACK_HTTP', endpoint: 'http://127.0.0.1:1111/old', model: 'old-model', id: 'snap',
    fetch: async (url, request) => { calls.push({ url, request }); return reviewerResponse('old-model', { findings: [], summary: 'ok' }); },
  };
  const adapter = createLocalChatReviewerAdapter(input);
  input.endpoint = 'http://127.0.0.1:2222/new'; input.model = 'new-model'; input.id = 'changed';
  input.fetch = async () => { throw new Error('wrong fetch'); };
  const result = await adapter.review(payload());
  assert.equal(result.status, 'PASS');
  assert.equal(calls[0].url, 'http://127.0.0.1:1111/old');
  assert.equal(JSON.parse(calls[0].request.body).model, 'old-model');
  const receipts = adapter.receipts();
  assert.ok(Object.isFrozen(receipts));
  assert.ok(Object.isFrozen(receipts[0]));
  assert.ok(Object.isFrozen(receipts[0].usage));
  assert.throws(() => { receipts[0].usage.totalTokens = 99; }, TypeError);
  assert.equal(adapter.receipts()[0].usage.totalTokens, 16);
});

test('response cleanup preserves its original error even when cancellation throws', async () => {
  let cancelled = 0;
  const unavailable = reviewer({ fetch: async () => ({ok: false, body: {cancel() {cancelled += 1; throw Error('cleanup');}}}) });
  await rejectsCode(() => unavailable.review(payload()), 'LOCAL_CHAT_RESPONSE_UNAVAILABLE');
  assert.equal(cancelled, 1);
  const over = reviewer({maxResponseBytes: 256, fetch: async () => ({ok: true, body: {getReader() {
    return {read: async () => ({value: new Uint8Array(300), done: false}), cancel() {throw Error('cleanup');}, releaseLock() {}};
  }}})});
  await rejectsCode(() => over.review(payload()), 'LOCAL_CHAT_RESPONSE_TOO_LARGE');
});
