import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalChatAuthorAdapter, createLocalChatReviewerAdapter, strictJSON } from '../adapters/local-chat.mjs';
import { createCandidate } from '../workflow/contracts.mjs';

const task = { taskId: 'demo', mode: 'edit', language: 'javascript', allowedFiles: ['src/a.js'], protectedFiles: [], protectedSnapshots: {}, acceptanceCriteria: ['works'], policy: { repairBudget: 1, totalDeadlineMs: 1000, requiredReviewers: 1, requireReportStore: false } };
const binding = { schemaVersion: 1, runId: 'run', taskFingerprint: 'a'.repeat(64), attempt: 0, candidateFingerprint: null };
function response(value, { chunks = 1 } = {}) {
  const bytes = new TextEncoder().encode(JSON.stringify(value)); const size = Math.ceil(bytes.length / chunks);
  return { ok: true, body: { getReader() { let offset = 0; return { async read() { if (offset >= bytes.length) return { done: true }; const value = bytes.slice(offset, offset += size); return { done: false, value }; }, cancel() {return Promise.resolve();}, releaseLock() {} }; } } };
}
function fetchFor(content, options = {}) { return async (_url, request) => { options.request = request; return response({ model: JSON.parse(request.body).model, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }] }, { chunks: 3 }); }; }

test('strict codec rejects duplicate object keys and accepts one JSON fence', () => {
  assert.throws(() => strictJSON('{"a":1,"a":2}'), error => error.code === 'LOCAL_CHAT_JSON_DUPLICATE_KEY');
  assert.equal(strictJSON('```json\n{"a":1}\n```').a, 1);
  for (const text of ['"\\x"', '"\\u12xz"', '```json\u00a0{"a":1}\u00a0```', '"abc', `${'['.repeat(66)}${']'.repeat(66)}`]) {
    assert.throws(() => strictJSON(text), error => error.code === 'LOCAL_CHAT_JSON_INVALID');
  }
  assert.equal(strictJSON(`${'['.repeat(65)}${']'.repeat(65)}`).length, 1);
  const proto = strictJSON('{"__proto__":{"x":1}}');
  assert.equal(Object.getPrototypeOf(proto), null);
  assert.ok(Object.hasOwn(proto, '__proto__'));
});

test('codec trims only JSON whitespace and removes at most one fence, as before the linear rewrite', () => {
  for (const [text, expected] of [
    [' \t\r\n{"a":1}\r\n\t ', {a: 1}], ['```JSON {"a":1} ```', {a: 1}], ['``` {"a":2}\n```', {a: 2}],
    ['```jsonfoo```', 'LOCAL_CHAT_JSON_INVALID'], ['``````', 'LOCAL_CHAT_JSON_INVALID'], ['`````', 'LOCAL_CHAT_JSON_INVALID'],
    ['```json```json {"a":1}``````', 'LOCAL_CHAT_JSON_INVALID'], [' {"a":1}', 'LOCAL_CHAT_JSON_INVALID'],
    ['{"a":1} ', 'LOCAL_CHAT_JSON_INVALID'], ['\f{"a":1}', 'LOCAL_CHAT_JSON_INVALID'],
  ]) {
    if (typeof expected === 'string') assert.throws(() => strictJSON(text), error => error.code === expected, JSON.stringify(text));
    else assert.deepEqual({...strictJSON(text)}, expected, JSON.stringify(text));
  }
});

test('codec stays linear on long whitespace runs inside strings and fences', () => {
  // The former end-anchored global regexes were quadratic and cannot be preempted: the first
  // input took about half a minute and a 1 MiB run about eight minutes. Budgets are generous.
  const quick = (text, check) => {
    const started = performance.now(); check(text); const elapsed = performance.now() - started;
    assert.ok(elapsed < 3000, `strict JSON took ${Math.round(elapsed)} ms for ${text.length} characters`);
  };
  quick(`{"a":"x${' '.repeat(250_000)}y"}`, text => assert.equal(strictJSON(text).a.length, 250_002));
  quick(`\`\`\`json${' '.repeat(100_000)}{"a":1}${' '.repeat(100_000)}\`\`\``, text => assert.equal(strictJSON(text).a, 1));
  quick(`[${' '.repeat(250_000)}1]`, text => assert.equal(strictJSON(text)[0], 1));
  quick(`{"a":"x${' '.repeat(1_000_000)}y"}`, text => assert.equal(strictJSON(text).a.length, 1_000_002));
  quick(`${' '.repeat(1_000_000)}x${' '.repeat(1_000_000)}`,
    text => assert.throws(() => strictJSON(text), error => error.code === 'LOCAL_CHAT_JSON_INVALID'));
});

test('factory requires literal loopback HTTP destination and rejects redirects by request policy', () => {
  assert.throws(() => createLocalChatReviewerAdapter({ destination: 'LOOPBACK_HTTP', endpoint: 'https://127.0.0.1/chat', model: 'm', id: 'reviewer' }), /LOCAL_CHAT_DESTINATION_REFUSED/);
  assert.throws(() => createLocalChatReviewerAdapter({ destination: 'LOOPBACK_HTTP', endpoint: 'http://localhost:123/chat', model: 'm', id: 'reviewer' }), /LOCAL_CHAT_DESTINATION_REFUSED/);
  const seen = {}; const adapter = createLocalChatReviewerAdapter({ destination: 'LOOPBACK_HTTP', endpoint: 'http://127.0.0.1:123/chat', model: 'm', id: 'reviewer', fetch: fetchFor({ findings: [], summary: 'ok' }, seen) });
  assert.equal(adapter.id, 'reviewer');
  return adapter.review({ task, candidate: null, acceptanceCriteria: task.acceptanceCriteria, binding }).then(() => assert.equal(seen.request.redirect, 'error'));
});

test('author builds draft result from model data and preserves exact engine binding', async () => {
  const adapter = createLocalChatAuthorAdapter({ destination: 'LOOPBACK_HTTP', endpoint: 'http://[::1]:8080/v1/chat/completions', model: 'local-model', id: 'author', maxOutputTokens: 33, fetch: fetchFor({ candidate: { files: [{ path: 'src/a.js', content: 'export default 1;' }] }, note: 'drafted' }) });
  const result = await adapter.draft({ task, candidate: null, acceptanceCriteria: task.acceptanceCriteria, binding });
  assert.equal(result.evidence.schemaVersion, 1); assert.equal(result.evidence.runId, 'run');
  assert.equal(result.evidence.candidateFingerprint, createCandidate(result.candidate, { authorId: 'author' }).fingerprint);
});

test('reviewer derives PASS or FAIL and identity from its configuration', async () => {
  const adapter = createLocalChatReviewerAdapter({ destination: 'LOOPBACK_HTTP', endpoint: 'http://127.0.0.1/review', model: 'review-model', id: 'reviewer', fetch: fetchFor({ findings: [{ code: 'BUG', message: 'bad' }], summary: 'found issue' }) });
  const result = await adapter.review({ task: { ...task, mode: 'review' }, candidate: { files: [{ path: 'src/a.js', content: 'x' }] }, acceptanceCriteria: task.acceptanceCriteria, binding: { ...binding, candidateFingerprint: 'b'.repeat(64) } });
  assert.equal(result.status, 'FAIL'); assert.equal(result.evidence.reviewerId, 'reviewer'); assert.equal(result.evidence.reason, 'found issue');
});

test('length finish reason and oversized streamed body are refused', async () => {
  const adapter = createLocalChatReviewerAdapter({ destination: 'LOOPBACK_HTTP', endpoint: 'http://127.0.0.1/review', model: 'm', id: 'reviewer', fetch: async () => response({ choices: [{ finish_reason: 'length', message: { content: '{"findings":[],"summary":"x"}' } }] }) });
  await assert.rejects(() => adapter.review({ task, candidate: null, acceptanceCriteria: task.acceptanceCriteria, binding }), error => error.code === 'LOCAL_CHAT_FINISH_REFUSED');
  const large = createLocalChatReviewerAdapter({ destination: 'LOOPBACK_HTTP', endpoint: 'http://127.0.0.1/review', model: 'm', id: 'reviewer', maxResponseBytes: 256, fetch: async () => response({ choices: [{ finish_reason: 'stop', message: { content: 'x'.repeat(1000) } }] }) });
  await assert.rejects(() => large.review({ task, candidate: null, acceptanceCriteria: task.acceptanceCriteria, binding }), error => error.code === 'LOCAL_CHAT_RESPONSE_TOO_LARGE');
});
