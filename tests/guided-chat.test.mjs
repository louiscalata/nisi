// Captured synthetic transports only; no inference or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256Text, stableStringify } from '../workflow/contracts.mjs';
import { registerRepairGuidanceV1 } from '../adapters/repair-guidance-v1.mjs';
import { createLocalChatAuthorAdapter, createLocalChatGuidedAuthorAdapterV1 } from '../adapters/local-chat.mjs';
import { createNativeChatAuthorAdapterV1, createNativeChatGuidedAuthorAdapterV1 } from '../adapters/native-chat-v1.mjs';
import { payload, output, envelope, config, taskFingerprint, deferred, tick } from './helpers/native-chat-fixture.mjs';
function setup(api, { arm = 'ON', legacy = false, patch = {}, onRequest, response } = {}) {
  const requests = [], native = api === 'NATIVE_API';
  const registration = registerRepairGuidanceV1({ arm, api, binding: { taskFingerprint,
    baselineFingerprint: 'a'.repeat(64), suiteFingerprint: 'b'.repeat(64), reviewedSourceFingerprint: 'c'.repeat(64) } });
  const fetch = async (_url, request) => {
    requests.push(request); const body = JSON.parse(request.body);
    const operation = JSON.parse(native ? body.input : body.messages[1].content).operation;
    const value = response ?? output(operation);
    const result = native ? envelope(JSON.stringify(value)) : { model: body.model,
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
    return onRequest ? onRequest(request, result) : new Response(JSON.stringify(result));
  };
  const options = native ? config(fetch, patch) : { destination: 'LOOPBACK_HTTP', endpoint: 'http://127.0.0.1:1234/v1/chat/completions',
    model: 'synthetic.model', id: 'synthetic.adapter', maxOutputTokens: 128, timeoutMs: 1000, fetch, ...patch };
  const factory = native ? (legacy ? createNativeChatAuthorAdapterV1 : createNativeChatGuidedAuthorAdapterV1)
    : (legacy ? createLocalChatAuthorAdapter : createLocalChatGuidedAuthorAdapterV1);
  return { adapter: factory(options, registration), registration, requests, options, factory };
}
const system = (api, body) => api === 'NATIVE_API' ? body.system_prompt : body.messages[0].content;
for (const api of ['CHAT_COMPLETIONS', 'NATIVE_API']) {
  test(`${api}: OFF preserves legacy repair bytes with explicitly new evidence version`, async () => {
    const a = setup(api, { legacy: true }), b = setup(api, { arm: 'OFF' });
    assert.deepEqual(await a.adapter.repair(payload()), await b.adapter.repair(payload()));
    assert.equal(a.requests[0].body, b.requests[0].body);
    const old = a.adapter.receipts()[0], current = b.adapter.receipts()[0];
    assert.notEqual(current.schemaVersion, old.schemaVersion); assert(!Object.hasOwn(old, 'treatment'));
    assert.equal(current.treatment.arm, 'OFF'); assert.equal(current.requestSha256, old.requestSha256);
    assert.equal(current.treatment.systemPromptSha256, b.registration.baseSystemPromptSha256);
  });
  test(`${api}: ON changes exactly repair system text, not user data or controls`, async () => {
    const off = setup(api, { arm: 'OFF' }), on = setup(api);
    await off.adapter.repair(payload()); await on.adapter.repair(payload());
    const a = JSON.parse(off.requests[0].body), b = JSON.parse(on.requests[0].body), instruction = system(api, b);
    assert.equal(instruction, system(api, a) + on.registration.suffix);
    if (api === 'NATIVE_API') b.system_prompt = a.system_prompt; else b.messages[0].content = a.messages[0].content;
    assert.deepEqual(b, a); const r = on.adapter.receipts()[0];
    assert.equal(r.requestSha256, sha256Text(on.requests[0].body)); assert.equal(r.treatment.systemPromptSha256, sha256Text(instruction));
    assert.equal(r.treatment.treatmentFingerprint, on.registration.fingerprint);
    assert.equal(r.treatment.dispatch, 'LOCAL_FETCH_INVOKED'); assert.equal(r.treatment.modelUseAttested, false);
  });
  test(`${api}: guided draft remains legacy and treatment-free`, async () => {
    const a = setup(api, { legacy: true }), b = setup(api);
    assert.deepEqual(await a.adapter.draft(payload('draft')), await b.adapter.draft(payload('draft')));
    assert.equal(a.requests[0].body, b.requests[0].body);
    const r = b.adapter.receipts()[0]; assert(!Object.hasOwn(r, 'treatment')); assert.equal(r.schemaVersion, a.adapter.receipts()[0].schemaVersion);
  });
  test(`${api}: invalid task, stopped owner, oversize and pre-abort never claim dispatch`, async () => {
    for (const mode of ['binding', 'task', 'foreign-task', 'abort', 'stopped', 'oversize']) {
      const c = setup(api, { patch: mode === 'oversize' ? { maxRequestBytes: 256 } : {} }), p = structuredClone(payload());
      if (mode === 'binding') p.binding.taskFingerprint = '0'.repeat(64);
      if (mode === 'task') p.task.acceptanceCriteria = ['changed'];
      if (mode === 'foreign-task') {
        p.task.acceptanceCriteria = ['different coherent task']; p.acceptanceCriteria = p.task.acceptanceCriteria;
        p.binding.taskFingerprint = sha256Text('nisi/workflow-task/v1\0' + stableStringify(p.task));
      }
      if (mode === 'abort') { const controller = new AbortController(); controller.abort(); p.signal = controller.signal; }
      if (mode === 'stopped') c.adapter.stop();
      await assert.rejects(c.adapter.repair(p), mode === 'foreign-task' ? { code: 'GUIDANCE_TASK' } : undefined);
      assert.equal(c.requests.length, 0);
      const r = c.adapter.receipts()[0]; assert.equal(r.status, 'UNAVAILABLE'); assert.equal(r.requestSha256, null);
      assert.equal(r.treatment.dispatch, 'NOT_DISPATCHED'); assert.equal(r.treatment.modelUseAttested, false);
    }
  });
  test(`${api}: malformed response records dispatch but not model use`, async () => {
    const c = setup(api, { response: { private: 'invalid result' } });
    await assert.rejects(c.adapter.repair(payload())); const r = c.adapter.receipts()[0];
    assert.equal(c.requests.length, 1); assert.equal(r.status, 'UNAVAILABLE'); assert.equal(r.resultCandidateFingerprint, null);
    assert.equal(r.treatment.dispatch, 'LOCAL_FETCH_INVOKED'); assert.equal(r.treatment.modelUseAttested, false);
  });
  test(`${api}: pending input mutation cannot alter request or result binding`, async () => {
    const ready = deferred(), response = deferred();
    const c = setup(api, { onRequest: (_request, body) => { ready.resolve(body); return response.promise; } });
    const p = structuredClone(payload()), original = structuredClone(p), pending = c.adapter.repair(p);
    try {
      const body = await ready.promise; p.binding.runId = 'changed'; p.binding.candidateFingerprint = '0'.repeat(64);
      p.task.acceptanceCriteria[0] = 'changed'; p.candidate.files[0].content = 'changed';
      response.resolve(new Response(JSON.stringify(body))); const result = await pending;
      assert.equal(result.evidence.runId, original.binding.runId); assert.equal(result.evidence.baseCandidateFingerprint, original.binding.candidateFingerprint);
      const sent = JSON.parse(c.requests[0].body), wire = JSON.parse(api === 'NATIVE_API' ? sent.input : sent.messages[1].content);
      assert.deepEqual(wire.task, original.task); assert.deepEqual(wire.candidate, original.candidate);
    } finally { response.resolve(new Response('{}')); await Promise.allSettled([pending]); }
  });
  test(`${api}: cancelled pending transport remains unconfirmed until original response settles`, async () => {
    const response = deferred(), ready = deferred(), c = setup(api, { onRequest: () => { ready.resolve(); return response.promise; } });
    const controller = new AbortController(), pending = c.adapter.repair({ ...payload(), signal: controller.signal });
    try {
      await ready.promise; controller.abort(); await assert.rejects(pending, { code: 'ABORTED' });
      const r = c.adapter.receipts()[0]; assert.equal(r.treatment.dispatch, 'LOCAL_FETCH_INVOKED');
      assert.equal(r.lifecycle.transportSettlement, 'UNKNOWN'); assert.equal(c.adapter.lifecycle().pendingTransports, 1);
    } finally { response.resolve(new Response('{}')); await Promise.allSettled([pending]); await tick(); }
    assert.equal(c.adapter.lifecycle().pendingTransports, 0); assert.equal(c.adapter.lifecycle().recoveryRequired, true);
  });
}
test('guided constructors refuse serialized or protocol-swapped registrations before transport', () => {
  for (const api of ['CHAT_COMPLETIONS', 'NATIVE_API']) {
    const c = setup(api), other = setup(api === 'NATIVE_API' ? 'CHAT_COMPLETIONS' : 'NATIVE_API');
    assert.throws(() => c.factory(c.options, structuredClone(c.registration)), { code: 'GUIDANCE_NOT_ISSUED' });
    assert.throws(() => c.factory(c.options, other.registration), { code: 'GUIDANCE_API' }); assert.equal(c.requests.length, 0);
  }
});
