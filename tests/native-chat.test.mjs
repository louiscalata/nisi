import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeChatAuthorAdapterV1 as author, createNativeChatReviewerAdapterV1 as reviewer,
  createNativeChatTransportOwnerV1 as owner } from '../adapters/native-chat-v1.mjs';
import { readNativeChatEnvelopeV1 as readEnvelope } from '../adapters/native-chat-protocol-v1.mjs';
import { sha256Text } from '../workflow/contracts.mjs';
import { runWorkflow } from '../workflow/engine.mjs';
import { config, payload, output, envelope, deferred, tick, task, candidate } from './helpers/native-chat-fixture.mjs';
const selection = { expectedModelInstance: 'synthetic.instance', maxOutputTokens: 128 };
const reply = body => new Response(JSON.stringify(body));

test('real Nisi engine consumes native draft, repair and review adapters with injected responses', async () => {
  const operations = [], shared = owner();
  const transport = async (_url, request) => {
    const p = JSON.parse(JSON.parse(request.body).input); operations.push(p.operation);
    const result = p.operation === 'draft' ? { candidate: { files: candidate.files }, note: 'Synthetic baseline' } : output(p.operation);
    return reply(envelope(JSON.stringify(result)));
  };
  const a = author(config(transport, { transportOwner: shared }));
  const r = reviewer(config(transport, { id: 'synthetic.reviewer', transportOwner: shared }));
  const report = await runWorkflow(task, { adapters: {
    authorizeContext: { authorize: p => ({ status: 'PASS', evidence: { ...p.binding, reason: '' } }) },
    author: a, reviewers: [r],
    staticChecks: { check: p => ({ status: 'PASS', evidence: { ...p.binding, findings: [], reason: '' } }) },
    tests: { run: p => ({ status: p.binding.attempt ? 'PASS' : 'FAIL', evidence: { ...p.binding, assertionsExecuted: 1,
      assertionsPassed: p.binding.attempt ? 1 : 0,
      failures: p.binding.attempt ? [] : [{ code: 'SYNTHETIC_BASELINE', message: 'Synthetic expected failure' }],
      reason: p.binding.attempt ? '' : 'Synthetic expected failure' } }) },
  } });
  assert.equal(report.outcome, 'COMPLETED'); assert.equal(report.repairAttempts, 1);
  assert.deepEqual(operations, ['draft', 'repair', 'review']); assert.equal(a.receipts().length, 2); assert.equal(r.receipts().length, 1);
  assert.equal(report.candidateFingerprint, a.receipts()[1].resultCandidateFingerprint);
  assert.equal(report.candidateFingerprint, r.receipts()[0].resultCandidateFingerprint);
  assert.equal(shared.status().state, 'IDLE');
});

for (const operation of ['draft', 'repair', 'review']) test(`native ${operation}: exact request, bound result, distinct receipt, no completion attestation`, async () => {
  const requests = [], content = JSON.stringify(output(operation)), raw = JSON.stringify(envelope(content));
  const a = (operation === 'review' ? reviewer : author)(config(async (url, request) => {
    requests.push({ url, request }); return new Response(raw);
  }));
  const p = payload(operation), result = await a[operation](p), receipt = a.receipts()[0];
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'http://127.0.0.1:1234/api/v1/chat');
  const request = requests[0].request, body = JSON.parse(request.body);
  assert.deepEqual(Object.keys(body).sort(), ['input', 'integrations', 'max_output_tokens', 'model', 'reasoning', 'store', 'stream', 'system_prompt', 'temperature']);
  assert.deepEqual(body.integrations, []); assert.equal(body.store, false); assert.equal(body.reasoning, 'off');
  assert.equal(body.stream, false); assert.equal(body.temperature, 0); assert.equal(body.model, 'synthetic.model');
  assert.equal(body.max_output_tokens, 128); assert.equal(JSON.parse(body.input).operation, operation);
  assert.equal(request.redirect, 'error'); assert.equal(request.method, 'POST');
  assert.equal(receipt.schemaVersion, 'nisi-native-chat-receipt-v1'); assert.equal(receipt.termination, 'NOT_REPORTED');
  assert.equal(receipt.serverCompletionAttested, false); assert.equal(receipt.modelAuthenticityAttested, false);
  assert.equal(receipt.truncationCheck, 'BELOW_REPORTED_OUTPUT_CAP');
  assert.equal(receipt.requestSha256, sha256Text(request.body)); assert.equal(receipt.responseSha256, sha256Text(raw));
  assert.equal(receipt.contentSha256, sha256Text(content)); assert.equal(receipt.reportedModelInstance, 'synthetic.instance');
  assert.equal(receipt.runId, p.binding.runId); assert.equal(receipt.taskFingerprint, p.binding.taskFingerprint);
  assert.equal(receipt.resultCandidateFingerprint, result.evidence.candidateFingerprint);
  assert.deepEqual({ ...receipt.usage }, { promptTokens: 10, completionTokens: 5, totalTokens: 15 });
  assert.equal(receipt.usageSource.totalTokens, 'DERIVED_SUM_OF_REPORTED_COUNTERS');
  assert.equal(receipt.lifecycle.transportSettlement, 'CONFIRMED'); assert.equal(a.lifecycle().state, 'IDLE');
  assert.equal(a.lifecycle().remoteInferenceStopped, 'NOT_OBSERVED');
  assert.ok(Object.isFrozen(receipt)); assert.ok(Object.isFrozen(result.evidence));
  assert.equal(Object.hasOwn(receipt, 'finish_reason'), false);
});

test('native one-fence inner content and NO_CHANGE retain original candidate binding', async () => {
  const content = '```json\n' + JSON.stringify({ status: 'NO_CHANGE', candidate: null, note: 'No useful change' }) + '\n```';
  const a = author(config(async () => reply(envelope(content))));
  const p = payload(), result = await a.repair(p);
  assert.equal(result.status, 'NO_CHANGE'); assert.equal(result.candidate, null);
  assert.equal(result.evidence.candidateFingerprint, p.binding.candidateFingerprint);
  assert.equal(result.evidence.baseCandidateFingerprint, p.binding.candidateFingerprint);
});

test('native caller config and pending payload mutation cannot change request or receipt', async t => {
  const pending = deferred(); let request;
  const input = config(async (_url, value) => { request = value; return pending.promise; });
  const a = author(input), p = payload(); const originalRun = p.binding.runId;
  input.model = 'wrong'; input.reasoning = 'on';
  const result = a.repair(p); result.catch(() => {});
  t.after(async () => { pending.resolve(reply(envelope())); await result.catch(() => {}); });
  p.binding.runId = 'replaced'; p.binding.candidateFingerprint = 'f'.repeat(64);
  pending.resolve(reply(envelope())); await result;
  assert.equal(JSON.parse(request.body).model, 'synthetic.model'); assert.equal(JSON.parse(request.body).reasoning, 'off');
  assert.equal(a.receipts()[0].runId, originalRun);
});

for (const endpoint of ['https://127.0.0.1/api/v1/chat', 'http://localhost/api/v1/chat', 'http://example.com/api/v1/chat',
  'http://127.0.0.1/v1/chat/completions', 'http://127.0.0.1/api/v1/chat?x=1', 'http://user:pass@127.0.0.1/api/v1/chat']) {
  test(`native refuses endpoint ${endpoint} before dispatch`, () => {
    assert.throws(() => author(config(() => assert.fail('fetch called'), { endpoint })), { code: 'NATIVE_CHAT_DESTINATION_REFUSED' });
  });
}
for (const key of ['maxOutputTokens', 'timeoutMs', 'maxRequestBytes', 'maxResponseBytes']) test(`native null ${key} is not an implicit default`, () => {
  assert.throws(() => author(config(() => assert.fail('fetch called'), { [key]: null })));
});
test('native rejects configuration accessors without invoking them', () => {
  let reads = 0; const input = config(() => assert.fail('fetch called'));
  Object.defineProperty(input, 'reasoning', { enumerable: true, get() { reads++; return 'off'; } });
  assert.throws(() => author(input), { code: 'NATIVE_CHAT_CONFIG_INVALID' }); assert.equal(reads, 0);
  assert.throws(() => author(config(() => {}, { reasoning: 'low' })), { code: 'NATIVE_CHAT_REASONING_SELECTION_REQUIRED' });
  assert.throws(() => author(config(() => {}, { store: true })), { code: 'NATIVE_CHAT_CONFIG_INVALID' });
  assert.throws(() => author(config(() => {}, { transportOwner: {} })), { code: 'NATIVE_CHAT_OWNER_INVALID' });
});

const envelopeCases = [
  ['wrong instance', e => { e.model_instance_id = 'other'; }, 'NATIVE_CHAT_MODEL_INSTANCE_MISMATCH'],
  ['storage id even null', e => { e.response_id = null; }, 'NATIVE_CHAT_ENVELOPE_INVALID'],
  ['missing stats', e => { delete e.stats; }, 'NATIVE_CHAT_ENVELOPE_INVALID'],
  ['unknown outer field', e => { e.finish_reason = 'stop'; }, 'NATIVE_CHAT_ENVELOPE_INVALID'],
  ['multiple messages', e => { e.output.push(e.output[0]); }, 'NATIVE_CHAT_OUTPUT_INVALID'],
  ['no message', e => { e.output = []; }, 'NATIVE_CHAT_OUTPUT_INVALID'],
  ['reasoning item', e => { e.output[0].type = 'reasoning'; }, 'NATIVE_CHAT_OUTPUT_KIND_REFUSED'],
  ['tool item', e => { e.output[0].type = 'tool_call'; }, 'NATIVE_CHAT_OUTPUT_KIND_REFUSED'],
  ['empty message', e => { e.output[0].content = ' '; }, 'NATIVE_CHAT_EMPTY_RESPONSE'],
  ['unknown stats', e => { e.stats.total_tokens = 15; }, 'NATIVE_CHAT_STATS_INVALID'],
  ['zero output', e => { e.stats.total_output_tokens = 0; }, 'NATIVE_CHAT_USAGE_INVALID'],
  ['fractional input', e => { e.stats.input_tokens = 0.5; }, 'NATIVE_CHAT_USAGE_INVALID'],
  ['overflow total', e => { e.stats.input_tokens = Number.MAX_SAFE_INTEGER; }, 'NATIVE_CHAT_USAGE_INVALID'],
  ['negative tokens', e => { e.stats.input_tokens = -1; }, 'NATIVE_CHAT_USAGE_INVALID'],
  ['reasoning tokens', e => { e.stats.reasoning_output_tokens = 1; }, 'NATIVE_CHAT_REASONING_REFUSED'],
  ['cap equality', e => { e.stats.total_output_tokens = 128; }, 'NATIVE_CHAT_OUTPUT_CAP_REACHED'],
  ['over cap', e => { e.stats.total_output_tokens = 129; }, 'NATIVE_CHAT_OUTPUT_CAP_REACHED'],
  ['bad performance', e => { e.stats.tokens_per_second = -1; }, 'NATIVE_CHAT_STATS_INVALID'],
];
for (const [name, change, code] of envelopeCases) test(`native refuses ${name} once without retry`, async () => {
  const e = envelope(); change(e); let requests = 0;
  const a = author(config(async () => { requests++; return reply(e); }));
  await assert.rejects(a.repair(payload()), { code }); assert.equal(requests, 1);
  assert.equal(a.receipts()[0].status, 'UNAVAILABLE'); assert.equal(a.receipts()[0].usage, null);
  assert.equal(a.receipts()[0].serverCompletionAttested, false);
});
test('native counts reject negative zero; optional load timing remains valid', () => {
  const raw = JSON.stringify(envelope()).replace('"input_tokens":10', '"input_tokens":-0');
  assert.throws(() => readEnvelope(raw, selection), { code: 'NATIVE_CHAT_USAGE_INVALID' });
  const e = envelope(); e.stats.model_load_time_seconds = 0.25;
  assert.equal(readEnvelope(JSON.stringify(e), selection).reportedStats.model_load_time_seconds, 0.25);
});
test('native outer envelopes reject fences, duplicate names and invalid UTF8', async () => {
  const raw = JSON.stringify(envelope());
  assert.throws(() => readEnvelope('```json\n' + raw + '\n```', selection), { code: 'NATIVE_CHAT_ENVELOPE_INVALID' });
  assert.throws(() => readEnvelope(raw.replace('"stats":', '"output":[],"stats":'), selection), { code: 'NATIVE_CHAT_JSON_DUPLICATE_KEY' });
  const a = author(config(async () => new Response(new Uint8Array([0xff]))));
  await assert.rejects(a.repair(payload()), { code: 'NATIVE_CHAT_RESPONSE_UTF8_INVALID' });
});
for (const [name, content, code] of [
  ['duplicate result field', '{"findings":[],"summary":"a","summary":"b"}', 'NATIVE_CHAT_JSON_DUPLICATE_KEY'],
  ['invented verdict', '{"findings":[],"summary":"a","verdict":"PASS"}', 'NATIVE_CHAT_OUTPUT_SCHEMA'],
  ['reasoning prefix', '<think>done</think>{"findings":[],"summary":"a"}', 'NATIVE_CHAT_JSON_INVALID'],
  ['bad findings', '{"findings":[{"code":"x"}],"summary":"a"}', 'NATIVE_CHAT_FINDING_SCHEMA'],
]) test(`native rejects inner ${name}`, async () => {
  const a = reviewer(config(async () => reply(envelope(content))));
  await assert.rejects(a.review(payload('review')), { code });
});
test('native rejects out-of-task generated paths', async () => {
  const o = output('repair'); o.candidate.files[0].path = 'outside.mjs';
  const a = author(config(async () => reply(envelope(JSON.stringify(o)))));
  await assert.rejects(a.repair(payload()), { code: 'CANDIDATE_FILE_OUT_OF_SCOPE' });
});
for (const [name, change] of [
  ['task identity', p => { p.binding.taskFingerprint = 'a'.repeat(64); }],
  ['candidate identity', p => { p.binding.candidateFingerprint = 'b'.repeat(64); }],
  ['criteria', p => { p.acceptanceCriteria = ['weakened']; }],
  ['invalid attempt', p => { p.binding.attempt = 0; }],
]) test(`native refuses changed ${name} before HTTP`, async () => {
  let requests = 0; const a = author(config(async () => { requests++; return reply(envelope()); }));
  const p = payload(); change(p); await assert.rejects(a.repair(p)); assert.equal(requests, 0);
  assert.equal(a.receipts()[0].lifecycle.transportSettlement, 'NOT_STARTED');
});

test('native pre-abort never sends; successful completion permits a second explicitly requested operation', async () => {
  let requests = 0; const a = author(config(async () => { requests++; return reply(envelope()); }));
  const c = new AbortController(); c.abort(); await assert.rejects(a.repair({ ...payload(), signal: c.signal }), { code: 'ABORTED' });
  assert.equal(requests, 0); assert.equal(a.lifecycle().state, 'IDLE');
  await a.repair(payload()); await a.repair(payload()); assert.equal(requests, 2);
});
test('native timeout preserves unresolved transport and quarantine after late settlement', async t => {
  const pending = deferred(); let requests = 0;
  const a = author(config(() => { requests++; return pending.promise; }, { timeoutMs: 20 }));
  t.after(async () => { pending.resolve(reply(envelope())); await tick(); await tick(); });
  await assert.rejects(a.repair(payload()), { code: 'NATIVE_CHAT_TIMEOUT' });
  const r = a.receipts()[0]; assert.equal(r.lifecycle.transportSettlement, 'UNKNOWN');
  assert.equal(a.lifecycle().pendingTransports, 1); assert.equal(a.lifecycle().state, 'QUARANTINED');
  await assert.rejects(a.repair(payload()), { code: 'NATIVE_CHAT_TRANSPORT_QUARANTINED' });
  pending.resolve(reply(envelope())); await tick(); await tick();
  assert.equal(a.lifecycle().pendingTransports, 0); assert.equal(a.lifecycle().state, 'QUARANTINED');
  await assert.rejects(a.repair(payload()), { code: 'NATIVE_CHAT_TRANSPORT_QUARANTINED' });
  assert.equal(requests, 1); assert.equal(r.lifecycle.transportSettlement, 'UNKNOWN');
});
test('native shared owner reports overlap as busy; STOP drains then stays stopped', async t => {
  const pending = deferred(), shared = owner(); let requests = 0;
  const a = author(config(() => { requests++; return pending.promise; }, { transportOwner: shared }));
  const b = reviewer(config(() => assert.fail('overlap dispatched'), { transportOwner: shared }));
  const result = a.repair(payload()); result.catch(() => {});
  t.after(async () => { shared.stop(); pending.reject(Error('cleanup')); await result.catch(() => {}); await tick(); });
  await assert.rejects(b.review(payload('review')), { code: 'NATIVE_CHAT_TRANSPORT_BUSY' });
  shared.stop(); await assert.rejects(result, { code: 'NATIVE_CHAT_OWNER_STOPPED' });
  assert.equal(shared.status().state, 'STOPPED_DRAINING'); assert.equal(requests, 1);
  pending.reject(Error('late')); await tick(); assert.equal(shared.status().state, 'STOPPED');
  await assert.rejects(a.repair(payload()), { code: 'NATIVE_CHAT_OWNER_STOPPED' });
});
test('native body cancellation pending is not local settlement', async t => {
  const read = deferred(), cancel = deferred(); let cancels = 0;
  const a = author(config(async () => ({ ok: true, body: { getReader: () => ({ read: () => read.promise,
    cancel: () => { cancels++; return cancel.promise; }, releaseLock() {} }) } }), { timeoutMs: 20 }));
  t.after(async () => { read.resolve({ done: true }); cancel.resolve(); await tick(); await tick(); });
  await assert.rejects(a.repair(payload()), { code: 'NATIVE_CHAT_TIMEOUT' });
  read.resolve({ done: true }); await tick(); assert.equal(a.lifecycle().pendingTransports, 1);
  cancel.resolve(); await tick(); await tick(); assert.equal(a.lifecycle().pendingTransports, 0);
  assert.equal(a.lifecycle().state, 'QUARANTINED'); assert.equal(cancels, 1);
});
test('native request/response byte limits and synchronous over-deadline result refuse', async () => {
  const requestCap = author(config(() => assert.fail('oversized request dispatched'), { maxRequestBytes: 256 }));
  await assert.rejects(requestCap.repair(payload()), { code: 'NATIVE_CHAT_REQUEST_TOO_LARGE' });
  const responseCap = author(config(async () => new Response('x'.repeat(257)), { maxResponseBytes: 256 }));
  await assert.rejects(responseCap.repair(payload()), { code: 'NATIVE_CHAT_RESPONSE_TOO_LARGE' });
  const late = author(config(async () => { const start = performance.now(); while (performance.now() - start < 30) {} return reply(envelope()); }, { timeoutMs: 5 }));
  await assert.rejects(late.repair(payload()), { code: 'NATIVE_CHAT_TIMEOUT' });
  assert.equal(late.receipts()[0].status, 'UNAVAILABLE');
});
