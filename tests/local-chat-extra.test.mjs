// Regression tests for the local OpenAI-compatible adapter. No model calls;
// every response and transport is deterministic test data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
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

function rawResponse(bytes, { ok = true, status, onCancel = () => {} } = {}) {
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
    status,
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
  // Finding bounds in the requested schema equal validateFindings' limits (workflow/contracts.mjs).
  assert.deepEqual(JSON.parse(calls[2].request.body).response_format.json_schema.schema.properties.findings.items.properties,
    { code: { type: 'string', minLength: 1, maxLength: 128 }, message: { type: 'string', minLength: 1, maxLength: 2048 } });
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

test('configuration enforces exact loopback HTTP scope and bounded numeric caps', async () => {
  const base = { destination: 'LOOPBACK_HTTP', endpoint: 'http://127.0.0.1/chat', model: 'm', id: 'r' };
  for (const endpoint of ['https://127.0.0.1/chat', 'http://localhost/chat', 'http://user@127.0.0.1/chat', 'http://:pw@127.0.0.1/chat',
    'http://127.0.0.1/chat?x=1', 'http://127.0.0.1/chat#x', 'http://0.0.0.0/', 'http://[::]/', 'http://127.0.0.2/', 'http://10.0.0.1/',
    'http://[::ffff:127.0.0.1]/', 'http://[::2]/', 'http://127.0.0.1.example.com/', 'http://127.0.0.1@example.com/', 'ftp://127.0.0.1/', 'file:///chat']) {
    assert.throws(() => reviewer({ ...base, endpoint }), error => error.code === 'LOCAL_CHAT_DESTINATION_REFUSED', endpoint);
  }
  for (const endpoint of [undefined, 42, 'not a url', 'http://[::1%251]/', `http://127.0.0.1/${'x'.repeat(2048)}`]) {
    assert.throws(() => reviewer({ ...base, endpoint }), error => error.code === 'LOCAL_CHAT_ENDPOINT_INVALID', String(endpoint).slice(0, 32));
  }
  // URL parsing rewrites these to literal loopback, and the rewritten URL is the one requested.
  for (const [endpoint, requested] of [['http://2130706433:1234/v1', 'http://127.0.0.1:1234/v1'], ['http://127.0.0.1.:1234/v1', 'http://127.0.0.1:1234/v1'],
    ['HTTP://127.1/v1', 'http://127.0.0.1/v1'], ['http://[0:0:0:0:0:0:0:1]:80/v1', 'http://[::1]/v1']]) {
    const calls = [];
    const adapter = reviewer({ ...base, endpoint, model: 'review-model', fetch: queuedFetch([reviewerResponse('review-model', { findings: [], summary: 'ok' })], { calls }) });
    assert.equal((await adapter.review(payload())).status, 'PASS', endpoint);
    assert.equal(calls[0].url, requested, endpoint);
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

test('response guards refuse tools, refusals, invalid bytes and malformed shapes with exact codes', async () => {
  const content = JSON.stringify({ findings: [], summary: 'x' });
  const withChoices = choices => jsonResponse({ model: 'review-model', choices });
  const withMessage = message => withChoices([{ finish_reason: 'stop', message }]);
  const invalidUTF8 = new TextEncoder().encode(JSON.stringify(envelope('review-model', { findings: [], summary: 'ok#' })));
  invalidUTF8[invalidUTF8.lastIndexOf(0x23)] = 0xff;
  const stringChunk = { ok: true, body: { getReader() {
    let sent = false;
    return { read: async () => sent ? { done: true } : (sent = true, { done: false, value: 'text' }), async cancel() {}, releaseLock() {} };
  } } };
  const usage = value => reviewerResponse('review-model', content, { usage: value });
  const cases = [
    ['tool calls', withMessage({ content, tool_calls: [{}] }), 'LOCAL_CHAT_FINISH_REFUSED'],
    ['tool calls object', withMessage({ content, tool_calls: {} }), 'LOCAL_CHAT_FINISH_REFUSED'],
    ['refusal', withMessage({ content, refusal: 'no' }), 'LOCAL_CHAT_FINISH_REFUSED'],
    ['invalid UTF-8', rawResponse(invalidUTF8), 'LOCAL_CHAT_RESPONSE_UTF8_INVALID'],
    ['string chunk', stringChunk, 'LOCAL_CHAT_RESPONSE_INVALID'],
    ['usage sum', usage({ prompt_tokens: 1, completion_tokens: 1, total_tokens: 3 }), 'LOCAL_CHAT_USAGE_INVALID'],
    ['usage negative', usage({ prompt_tokens: -1, completion_tokens: 1, total_tokens: 0 }), 'LOCAL_CHAT_USAGE_INVALID'],
    ['usage fraction', usage({ prompt_tokens: 0.5, completion_tokens: 0.5, total_tokens: 1 }), 'LOCAL_CHAT_USAGE_INVALID'],
    ['usage array', usage([]), 'LOCAL_CHAT_USAGE_INVALID'],
    ['usage number', usage(5), 'LOCAL_CHAT_USAGE_INVALID'],
    ['null envelope', jsonResponse('null'), 'LOCAL_CHAT_CHOICES_INVALID'],
    ['array envelope', jsonResponse('[]'), 'LOCAL_CHAT_CHOICES_INVALID'],
    ['null choice', withChoices([null]), 'LOCAL_CHAT_CHOICES_INVALID'],
    ['primitive choice', withChoices([1]), 'LOCAL_CHAT_CHOICES_INVALID'],
    ['two choices', withChoices([{ finish_reason: 'stop', message: { content } }, { finish_reason: 'stop', message: { content } }]), 'LOCAL_CHAT_CHOICES_INVALID'],
    ['null message', withMessage(null), 'LOCAL_CHAT_EMPTY_RESPONSE'],
    ['string message', withMessage('text'), 'LOCAL_CHAT_EMPTY_RESPONSE'],
    ['blank content', withMessage({ content: ' \n' }), 'LOCAL_CHAT_EMPTY_RESPONSE'],
    ['nesting', reviewerResponse('review-model', `${'['.repeat(66)}${']'.repeat(66)}`), 'LOCAL_CHAT_JSON_INVALID'],
    ['unterminated string', reviewerResponse('review-model', '"abc'), 'LOCAL_CHAT_JSON_INVALID'],
  ];
  for (const [name, response, code] of cases) {
    const adapter = reviewer({ fetch: async () => response });
    await rejectsCode(() => adapter.review(payload()), code);
    assert.equal(adapter.receipts().at(-1).status, 'UNAVAILABLE', name);
    assert.equal(adapter.receipts().at(-1).code, code, name);
  }
  await rejectsCode(() => reviewer({ fetch: async () => usage(undefined) }).review(payload({ signal: {} })), 'LOCAL_CHAT_SIGNAL_INVALID');
  // Omitted, null and empty tool/refusal/usage fields are absent, not failures.
  for (const response of [usage(null), withMessage({ content, tool_calls: null, refusal: null }), withMessage({ content, tool_calls: [], refusal: '' })]) {
    const adapter = reviewer({ fetch: async () => response });
    assert.equal((await adapter.review(payload())).status, 'PASS');
    assert.equal(adapter.receipts().at(-1).usage, null);
  }
});

test('a result that completes after the deadline is refused even when the timer could not run', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify(envelope('review-model', { findings: [], summary: 'late' })));
  // Every step settles in microtasks, so only the monotonic re-check can observe the busy wait.
  const late = reviewer({ timeoutMs: 5, fetch: async () => ({ ok: true, body: { getReader() {
    let sent = false;
    return { async read() { if (sent) return { done: true }; sent = true; const until = performance.now() + 30; while (performance.now() < until); return { done: false, value: bytes }; },
      async cancel() {}, releaseLock() {} };
  } } }) });
  await rejectsCode(() => late.review(payload()), 'LOCAL_CHAT_TIMEOUT');
  assert.equal(late.receipts().at(-1).code, 'LOCAL_CHAT_TIMEOUT');
});

test('finding bounds match the engine and repair NO_CHANGE cannot carry a candidate', async () => {
  const review = findings => reviewer({ fetch: async () => reviewerResponse('review-model', { findings, summary: 'checked' }) }).review(payload());
  assert.equal((await review([{ code: 'C'.repeat(128), message: 'm'.repeat(2048) }])).status, 'FAIL');
  await rejectsCode(() => review([{ code: 'C'.repeat(129), message: 'm' }]), 'LOCAL_CHAT_FINDING_INVALID');
  await rejectsCode(() => review([{ code: 'C', message: 'm'.repeat(2049) }]), 'LOCAL_CHAT_FINDING_INVALID');
  // The schema counts code points; the engine counts UTF-16 units and refuses blank text.
  await rejectsCode(() => review([{ code: '\u{1f600}'.repeat(65), message: 'm' }]), 'LOCAL_CHAT_FINDING_INVALID');
  await rejectsCode(() => review([{ code: 'C', message: ' ' }]), 'LOCAL_CHAT_FINDING_INVALID');
  const author = createLocalChatAuthorAdapter({ destination: 'LOOPBACK_HTTP', endpoint: 'http://127.0.0.1:1234/v1/chat/completions',
    model: 'author-model', id: 'extra.author', fetch: async () => jsonResponse(envelope('author-model',
      { status: 'NO_CHANGE', candidate: { files: [{ path: 'config.json', content: '{}' }] }, note: 'x' })) });
  await rejectsCode(() => author.repair(payload({ binding: { ...binding, candidateFingerprint: 'c'.repeat(64) } })), 'LOCAL_CHAT_REPAIR_INVALID');
  assert.equal(author.receipts().at(-1).code, 'LOCAL_CHAT_REPAIR_INVALID');
});

test('author schemas offer only unprotected paths unless every allowed path is protected', async () => {
  const guarded = { ...task, allowedFiles: ['src/a.mjs', 'tests/a.test.mjs'], protectedFiles: ['tests/a.test.mjs'],
    protectedSnapshots: { 'tests/a.test.mjs': 'b'.repeat(64) } };
  const draft = envelope('author-model', { candidate: { files: [{ path: 'src/a.mjs', content: 'export {};' }] }, note: 'draft' });
  const calls = [];
  const author = createLocalChatAuthorAdapter({ destination: 'LOOPBACK_HTTP', endpoint: 'http://127.0.0.1:1234/v1/chat/completions',
    model: 'author-model', id: 'extra.author', fetch: queuedFetch([jsonResponse(draft),
      jsonResponse(envelope('author-model', { status: 'NO_CHANGE', candidate: null, note: 'none' })),
      jsonResponse(envelope('author-model', { candidate: { files: [{ path: 'tests/a.test.mjs', content: 'x' }] }, note: 'draft' }))], { calls }) });
  await author.draft(payload({ task: guarded }));
  await author.repair(payload({ task: guarded, binding: { ...binding, candidateFingerprint: 'c'.repeat(64) } }));
  await author.draft(payload({ task: { ...guarded, allowedFiles: ['tests/a.test.mjs'] } }));
  const schemas = calls.map(item => JSON.parse(item.request.body).response_format.json_schema.schema);
  const pathEnum = candidate => candidate.properties.files.items.properties.path.enum;
  assert.deepEqual(pathEnum(schemas[0].properties.candidate), ['src/a.mjs']);
  assert.deepEqual(pathEnum(schemas[1].properties.candidate.anyOf[0]), ['src/a.mjs']);
  assert.deepEqual(pathEnum(schemas[2].properties.candidate), ['tests/a.test.mjs']);
});

test('failure receipts keep the response facts already supplied, with the success shape', async () => {
  const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');
  const bodyFor = (model, options) => JSON.stringify(envelope(model, { findings: [], summary: 'x' }, options));
  const contentSha256 = sha256(JSON.stringify({ findings: [], summary: 'x' }));
  const tokens = { prompt_tokens: 900, completion_tokens: 100, total_tokens: 1000 };
  const recorded = { promptTokens: 900, completionTokens: 100, totalTokens: 1000 };
  const receiptFor = async (body, code, options = {}) => {
    const adapter = reviewer({ model: 'expected', fetch: async () => jsonResponse(body, { status: 200, ...options }) });
    await rejectsCode(() => adapter.review(payload()), code);
    return adapter.receipts().at(-1);
  };
  const mismatch = await receiptFor(bodyFor('actual', { usage: tokens }), 'LOCAL_CHAT_MODEL_MISMATCH');
  assert.equal(mismatch.reportedModel, 'actual');
  assert.deepEqual({ ...mismatch.usage }, recorded);
  assert.equal(mismatch.responseSha256, sha256(bodyFor('actual', { usage: tokens })));
  assert.equal(mismatch.contentSha256, contentSha256);
  assert.equal(mismatch.httpStatus, 200);
  assert.equal(mismatch.candidateFingerprint, null);
  assert.equal(mismatch.resultCandidateFingerprint, null);
  const truncated = await receiptFor(bodyFor('expected', { usage: tokens, finishReason: 'length' }), 'LOCAL_CHAT_FINISH_REFUSED');
  assert.deepEqual([truncated.reportedModel, { ...truncated.usage }, truncated.contentSha256], ['expected', recorded, contentSha256]);
  // Invalid usage and an oversized model name are not recorded, and never replace the first failure code.
  const unrecorded = await receiptFor(bodyFor('m'.repeat(257), { usage: { ...tokens, total_tokens: 1 } }), 'LOCAL_CHAT_MODEL_MISMATCH');
  assert.deepEqual([unrecorded.reportedModel, unrecorded.usage], [null, null]);
  assert.match(unrecorded.responseSha256, /^[0-9a-f]{64}$/u);
  // The response digest is kept once the body is read, even when the envelope cannot be parsed or used.
  for (const [body, code] of [['{"model":', 'LOCAL_CHAT_JSON_INVALID'], ['null', 'LOCAL_CHAT_CHOICES_INVALID']]) {
    const early = await receiptFor(body, code);
    assert.deepEqual([early.responseSha256, early.contentSha256, early.httpStatus], [sha256(body), null, 200], body);
  }
  const rejected = await receiptFor(bodyFor('expected'), 'LOCAL_CHAT_RESPONSE_UNAVAILABLE', { ok: false, status: 400 });
  assert.deepEqual([rejected.httpStatus, rejected.responseSha256, rejected.contentSha256], [400, null, null]);
  // Only an integer status from 100 to 999 is recorded.
  for (const status of [99, 1000, 400.5, '400']) {
    assert.equal((await receiptFor(bodyFor('expected'), 'LOCAL_CHAT_RESPONSE_UNAVAILABLE', { ok: false, status })).httpStatus, null, String(status));
  }
  const thrown = reviewer({ fetch: async () => { throw new Error('transport failed'); } });
  await rejectsCode(() => thrown.review(payload()), 'LOCAL_CHAT_UNAVAILABLE');
  const none = thrown.receipts().at(-1);
  assert.deepEqual([none.httpStatus, none.responseSha256, none.contentSha256, none.reportedModel, none.usage], [null, null, null, null, null]);
  assert.match(none.requestSha256, /^[0-9a-f]{64}$/u);
  const valid = reviewer({ fetch: async () => jsonResponse(bodyFor('review-model'), { status: 200 }) });
  await valid.review(payload());
  const success = valid.receipts().at(-1);
  assert.equal(success.httpStatus, 200);
  assert.deepEqual(Object.keys(mismatch).filter(key => key !== 'code'), Object.keys(success));
});

test('malformed payloads are refused with an exact code and receipt before any timer or request', async () => {
  let fetchCalls = 0;
  const adapter = reviewer({ timeoutMs: 5_000, fetch: async () => { fetchCalls += 1; throw new Error('must not fetch'); } });
  const bad = [undefined, null, 1, 'payload', [], {}, { task: null, binding }, { task: [] }, { task: 'task', binding }];
  for (const value of bad) await rejectsCode(() => adapter.review(value), 'LOCAL_CHAT_PAYLOAD_INVALID');
  const receipts = adapter.receipts();
  assert.equal(fetchCalls, 0);
  assert.deepEqual(receipts.map(receipt => [receipt.status, receipt.code, receipt.requestSha256]), bad.map(() => ['UNAVAILABLE', 'LOCAL_CHAT_PAYLOAD_INVALID', null]));
  assert.deepEqual(receipts.map(receipt => receipt.runId), bad.map(value => value?.binding ? 'extra-run' : null));
  const author = createLocalChatAuthorAdapter({ destination: 'LOOPBACK_HTTP', endpoint: 'http://127.0.0.1:1234/v1/chat/completions',
    model: 'author-model', id: 'extra.author', timeoutMs: 5_000, fetch: async () => { fetchCalls += 1; throw new Error('must not fetch'); } });
  await rejectsCode(() => author.draft(), 'LOCAL_CHAT_PAYLOAD_INVALID');
  await rejectsCode(() => author.repair(null), 'LOCAL_CHAT_PAYLOAD_INVALID');
  assert.equal(fetchCalls, 0);
  // A fresh process shows that the refusal leaves no timer holding the event loop open.
  const script = `
    import { createLocalChatReviewerAdapter } from ${JSON.stringify(new URL('../adapters/local-chat.mjs', import.meta.url).href)};
    const reviewer = createLocalChatReviewerAdapter({ destination: 'LOOPBACK_HTTP', endpoint: 'http://127.0.0.1:9/v1', model: 'm', id: 'r', timeoutMs: 600000 });
    let code = null;
    try { await reviewer.review(); } catch (error) { code = error.code; }
    console.log(JSON.stringify({ code, receipts: reviewer.receipts().length,
      timers: process.getActiveResourcesInfo().filter(name => name === 'Timeout').length }));`;
  const stdout = await new Promise((resolve, reject) => execFile(process.execPath, ['--input-type=module', '-e', script],
    { timeout: 60_000, windowsHide: true }, (error, out) => error ? reject(error) : resolve(out)));
  assert.deepEqual(JSON.parse(stdout.trim()), { code: 'LOCAL_CHAT_PAYLOAD_INVALID', receipts: 1, timers: 0 });
});

test('a binding value a receipt cannot hold is recorded as null, and the call still leaves a receipt', async () => {
  const adapter = reviewer({ timeoutMs: 5_000, fetch: async () => { throw new Error('offline'); } });
  const odd = { ...binding, runId: { nested: true }, attempt: Number.NaN, taskFingerprint: 7.5, candidateFingerprint: undefined };
  await rejectsCode(() => adapter.review(payload({ binding: odd })), 'LOCAL_CHAT_UNAVAILABLE');
  await rejectsCode(() => adapter.review(payload({ binding: 'not-a-binding' })), 'LOCAL_CHAT_UNAVAILABLE');
  const receipts = adapter.receipts();
  assert.deepEqual(receipts.map(receipt => [receipt.status, receipt.code, receipt.runId, receipt.taskFingerprint, receipt.attempt,
    receipt.inputCandidateFingerprint]), [['UNAVAILABLE', 'LOCAL_CHAT_UNAVAILABLE', null, null, null, null],
    ['UNAVAILABLE', 'LOCAL_CHAT_UNAVAILABLE', null, null, null, null]]);
});

test('a payload with a task object is still sent, whatever its file lists hold', async () => {
  // The engine only supplies validated arrays; direct callers keep the acceptance they had before the payload guard.
  const listed = { ...task, allowedFiles: ['a.json', 'config.json'] };
  const tasks = [{ ...listed, protectedFiles: null }, { ...listed, protectedFiles: 'config.json' }, {}, { ...task, allowedFiles: undefined }];
  const calls = [];
  const draft = envelope('author-model', { candidate: { files: [{ path: 'config.json', content: '{}' }] }, note: 'draft' });
  const author = createLocalChatAuthorAdapter({ destination: 'LOOPBACK_HTTP', endpoint: 'http://127.0.0.1:1234/v1/chat/completions',
    model: 'author-model', id: 'extra.author', fetch: queuedFetch(tasks.map(() => jsonResponse(draft)), { calls }) });
  for (const value of tasks) assert.equal((await author.draft(payload({ task: value }))).candidate.files[0].path, 'config.json');
  // Only an array protectedFiles narrows the path enum, and a missing allowedFiles leaves it out.
  assert.deepEqual(calls.map(item => JSON.parse(item.request.body).response_format.json_schema.schema.properties.candidate.properties.files.items.properties.path),
    [{ type: 'string', enum: ['a.json', 'config.json'] }, { type: 'string', enum: ['a.json', 'config.json'] }, { type: 'string' }, { type: 'string' }]);
  for (const value of tasks) {
    const adapter = reviewer({ fetch: async () => reviewerResponse('review-model', { findings: [], summary: 'ok' }) });
    assert.equal((await adapter.review(payload({ task: value }))).status, 'PASS');
    assert.equal(adapter.receipts().at(-1).status, 'RESPONSE_VALIDATED');
  }
});
