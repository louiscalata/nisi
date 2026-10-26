import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalChatAuthorAdapter, createLocalChatReviewerAdapter } from '../adapters/local-chat.mjs';
import { sha256Text } from '../workflow/contracts.mjs';

const task = { allowedFiles: ['src/a.js'] };
const payload = { task, candidate: { files: [{ path: 'src/a.js', content: 'before' }] },
  acceptanceCriteria: ['preserve zero'], binding: { schemaVersion: 1, runId: 'run', taskFingerprint: 'a'.repeat(64),
    attempt: 1, candidateFingerprint: 'b'.repeat(64) } };
const outputs = {
  draft: { candidate: { files: [{ path: 'src/a.js', content: 'after' }] }, note: 'draft' },
  repair: { status: 'REPAIRED', candidate: { files: [{ path: 'src/a.js', content: 'after' }] }, note: 'repair' },
  review: { findings: [], summary: 'review' },
};
// Derived from retained pre-change adapter 7fd5cad4, not the new implementation.
const legacyBodyHashes = { draft: '4cc192689f3f6c99fb1d7fb05e663563122b50ffb02e510b083a5241aa2aeeaa',
  repair: 'd7cc02bde9e1dcba3cfc9ee7e34082fd98f3e1bfb32ac67667803994e8e777e6',
  review: '8cf686bd259cc208c1d176e5c053cacfb5a956d5a9a1aa27ef002d7f21084bad' };
function fixture(operation, mode, change = () => {}) {
  const requests = [], input = { destination: 'LOOPBACK_HTTP', endpoint: 'http://127.0.0.1:1234/v1/chat/completions',
    model: 'synthetic.model', id: 'synthetic.adapter', maxOutputTokens: 128,
    ...(mode === undefined ? {} : { outputMode: mode }), fetch: async (_url, request) => {
      requests.push(request);
      const envelope = { model: 'synthetic.model', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(outputs[operation]) } }] };
      change(envelope); return new Response(JSON.stringify(envelope));
    } };
  const adapter = operation === 'review' ? createLocalChatReviewerAdapter(input) : createLocalChatAuthorAdapter(input);
  return { adapter, requests, input, run: () => adapter[operation](payload) };
}

for (const operation of ['draft', 'repair', 'review']) {
  test(`${operation}: explicit modes preserve instructions and strict default request bytes`, async () => {
    const legacy = fixture(operation), schema = fixture(operation, 'json_schema'), instruction = fixture(operation, 'json_instruction');
    const results = await Promise.all([legacy.run(), schema.run(), instruction.run()]);
    assert.deepEqual(results[0], results[1]); assert.deepEqual(results[0], results[2]);
    assert.equal(legacy.requests[0].body, schema.requests[0].body);
    assert.equal(sha256Text(legacy.requests[0].body), legacyBodyHashes[operation]);
    const strictBody = JSON.parse(schema.requests[0].body), plainBody = JSON.parse(instruction.requests[0].body);
    assert.equal(strictBody.response_format.type, 'json_schema'); assert.equal(strictBody.response_format.json_schema.strict, true);
    delete strictBody.response_format; assert.deepEqual(strictBody, plainBody);
    assert.equal(Object.hasOwn(plainBody, 'response_format'), false);
    assert.equal(legacy.adapter.receipts()[0].schemaVersion, 1);
    assert.equal(Object.hasOwn(legacy.adapter.receipts()[0], 'outputMode'), false);
    for (const [f, mode] of [[schema, 'json_schema'], [instruction, 'json_instruction']]) {
      const r = f.adapter.receipts()[0]; assert.equal(r.schemaVersion, 2); assert.equal(r.outputMode, mode);
      assert.equal(r.requestSha256, sha256Text(f.requests[0].body)); assert.equal(r.status, 'RESPONSE_VALIDATED');
      assert.ok(Object.isFrozen(r)); assert.equal(f.requests.length, 1);
    }
    assert.notEqual(schema.adapter.receipts()[0].requestSha256, instruction.adapter.receipts()[0].requestSha256);
  });
}

test('output mode must be one exact primitive value; invalid modes never dispatch', () => {
  for (const mode of [null, '', 'json', 'JSON_SCHEMA', 'json_instruction ', false, {}, [], new String('json_schema'), 1]) {
    assert.throws(() => fixture('review', mode), { code: 'LOCAL_CHAT_OUTPUT_MODE_INVALID' });
  }
});

test('explicit output mode is snapshotted before caller mutation', async () => {
  const f = fixture('review', 'json_instruction'); f.input.outputMode = 'json_schema';
  await f.run(); assert.equal(f.adapter.receipts()[0].outputMode, 'json_instruction');
  assert.equal(Object.hasOwn(JSON.parse(f.requests[0].body), 'response_format'), false);
});

test('a changing output-mode accessor is captured once for wire behavior and receipt identity', async () => {
  let reads = 0, body;
  const adapter = createLocalChatReviewerAdapter({ destination: 'LOOPBACK_HTTP', endpoint: 'http://127.0.0.1/chat',
    model: 'synthetic.model', id: 'reviewer', get outputMode() { reads++; return reads < 3 ? 'json_instruction' : undefined; },
    fetch: async (_url, request) => { body = JSON.parse(request.body); return new Response(JSON.stringify({ model: 'synthetic.model',
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(outputs.review) } }] })); } });
  await adapter.review(payload);
  assert.equal(reads, 1); assert.equal(Object.hasOwn(body, 'response_format'), false);
  assert.equal(adapter.receipts()[0].schemaVersion, 2); assert.equal(adapter.receipts()[0].outputMode, 'json_instruction');
});

const refusals = [
  ['empty final despite reasoning', e => { e.choices[0].message = { content: '', reasoning: JSON.stringify(outputs.review) }; }, 'LOCAL_CHAT_EMPTY_RESPONSE'],
  ['malformed content', e => { e.choices[0].message.content = '{'; }, 'LOCAL_CHAT_JSON_INVALID'],
  ['duplicate key', e => { e.choices[0].message.content = '{"findings":[],"summary":"one","summary":"two"}'; }, 'LOCAL_CHAT_JSON_DUPLICATE_KEY'],
  ['invented verdict', e => { e.choices[0].message.content = JSON.stringify({ ...outputs.review, verdict: 'PASS' }); }, 'LOCAL_CHAT_OUTPUT_SCHEMA'],
  ['model mismatch', e => { e.model = 'other.model'; }, 'LOCAL_CHAT_MODEL_MISMATCH'],
  ['unfinished answer', e => { e.choices[0].finish_reason = 'length'; }, 'LOCAL_CHAT_FINISH_REFUSED'],
  ['tool call', e => { e.choices[0].message.tool_calls = [{}]; }, 'LOCAL_CHAT_FINISH_REFUSED'],
  ['usage mismatch', e => { e.usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 3 }; }, 'LOCAL_CHAT_USAGE_INVALID'],
  ['prose around JSON', e => { e.choices[0].message.content = 'Here: ' + JSON.stringify(outputs.review); }, 'LOCAL_CHAT_JSON_INVALID'],
  ['think markup', e => { e.choices[0].message.content = '<think>ok</think>' + JSON.stringify(outputs.review); }, 'LOCAL_CHAT_JSON_INVALID'],
];
for (const mode of ['json_schema', 'json_instruction']) for (const [name, change, code] of refusals) {
  test(`${mode} refuses ${name} without retry or mode fallback`, async () => {
    const f = fixture('review', mode, change);
    await assert.rejects(f.run(), { code }); assert.equal(f.requests.length, 1);
    const receipts = f.adapter.receipts(); assert.equal(receipts.length, 1);
    assert.equal(receipts[0].schemaVersion, 2); assert.equal(receipts[0].outputMode, mode);
    assert.equal(receipts[0].status, 'UNAVAILABLE'); assert.equal(receipts[0].code, code); assert.equal(receipts[0].usage, null);
  });
}

for (const mode of ['json_schema', 'json_instruction']) test(`${mode} retains one-fence compatibility and NO_CHANGE semantics`, async () => {
  const f = fixture('repair', mode, e => { e.choices[0].message.content = '```json\n' + JSON.stringify({ status: 'NO_CHANGE', candidate: null, note: 'no change' }) + '\n```'; });
  const result = await f.run(); assert.equal(result.status, 'NO_CHANGE'); assert.equal(result.candidate, null);
  assert.equal(result.evidence.candidateFingerprint, payload.binding.candidateFingerprint);
});

for (const mode of ['json_schema', 'json_instruction']) test(`${mode} pre-dispatch cancellation records its mode without HTTP`, async () => {
  const f = fixture('review', mode), controller = new AbortController(); controller.abort();
  await assert.rejects(f.adapter.review({ ...payload, signal: controller.signal }), { code: 'ABORTED' });
  assert.equal(f.requests.length, 0); const r = f.adapter.receipts()[0];
  assert.equal(r.schemaVersion, 2); assert.equal(r.outputMode, mode); assert.equal(r.requestSha256, null);
  assert.equal(r.lifecycle.transportSettlement, 'NOT_STARTED');
});
