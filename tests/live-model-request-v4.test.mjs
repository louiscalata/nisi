// Synthetic responses, no external inference or candidate-code execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import { context } from './helpers/live-model-v4-fixture.mjs';
import { seed, deferred, tick } from './helpers/live-model-v3-fixture.mjs';
import { createReviewedLiveModelLaneWithTransportV4, readIssuedLiveModelLaneV4 } from '../hosts/repository/reviewed-live-model-v4.mjs';
import { inspectIssuedLiveModelRequestsV4 as inspect } from '../receipts/live-model-request-v4.mjs';
import { sha256Text } from '../workflow/contracts.mjs';

for (const api of ['CHAT_COMPLETIONS','NATIVE_API']) for (const reviewerApi of ['CHAT_COMPLETIONS','NATIVE_API'])
  for (const arm of ['OFF','ON']) test(`original request channel ${api}/${reviewerApi}/${arm}`, async () => {
    const c = await context({ api, reviewerApi, arm }); assert.equal((await c.run()).outcome, 'COMPLETED');
    const result = inspect({ lane: c.lane }), issued = readIssuedLiveModelLaneV4(c.lane);
    assert.equal(result.status, 'CONSISTENT'); assert.equal(result.calls.length, 2); assert.equal(result.arm, arm);
    for (const [index, role] of ['author','reviewer'].entries()) {
      const observed = issued.requestObservations[index], actual = c.requests[index].request;
      assert.equal(observed.role, role); assert.equal(observed.request.body, actual.body);
      assert.equal(observed.requestSha256, sha256Text(actual.body));
      assert.equal(result.calls[index].requestSha256, observed.requestSha256);
      assert.equal(result.calls[index].requestBytes, Buffer.byteLength(actual.body));
      assert.equal(result.calls[index].transportSettlement, 'CONFIRMED');
      assert(Object.isFrozen(actual)); assert(Object.isFrozen(actual.headers));
      assert(!Object.hasOwn(observed.request, 'signal')); assert(!Object.hasOwn(issued.invocations[index].payload, 'signal'));
      assert.equal(result.calls[index].observation, 'LOCAL_TRANSPORT_INVOKED');
    }
    assert.equal(result.calls[0].systemPromptSha256, c.treatment.expectedSystemPromptSha256);
    assert.equal(result.source, 'ORIGINAL_ISSUED_LANE'); assert.equal(result.consistencyOnly, true);
    for (const key of ['providerDeliveryAttested','modelUseAttested','repositoryRunValidated','executionAttested','authorizing','promotionEligible','measurementVerified'])
      assert.equal(result[key], false);
    for (const value of [result, c.lane.snapshot()]) {
      assert(!Object.hasOwn(value, 'requestObservations')); assert(!Object.hasOwn(value, 'invocations'));
      const forbidden = new Set(['body','headers','input','system_prompt','messages']);
      function check(v) { if (!v || typeof v !== 'object') return; for (const [key, child] of Object.entries(v)) { assert(!forbidden.has(key)); check(child); } }
      check(value);
    }
    assert.throws(() => inspect({ lane: { ...c.lane } }), { code: 'LIVE_LANE_NOT_ISSUED' });
    assert.throws(() => inspect({ lane: c.lane.snapshot() }), { code: 'LIVE_LANE_NOT_ISSUED' });
    assert.throws(() => { issued.requestObservations[0].request.body = '{}'; }, TypeError);
    assert.throws(() => { issued.invocations[0].payload.task.taskId = 'forged'; }, TypeError);
  });

for (const api of ['CHAT_COMPLETIONS','NATIVE_API']) {
  for (const variant of ['baseline','no-change','third']) test(`${api}: request inspection preserves ${variant} without inventing review`, async () => {
    const c = await context({ api, variant }), report = await c.run(), result = inspect({ lane: c.lane });
    assert.equal(report.outcome === 'COMPLETED', false);
    assert.equal(result.status, 'CONSISTENT', 'Only request consistency, never workflow acceptance');
    assert.equal(result.repositoryRunValidated, false); assert.equal(result.calls.length, 1);
    assert.equal(result.calls[0].role, 'author'); assert.equal(c.requests.length, 1);
    if (variant !== 'third') assert.equal(report.outcome, 'NO_PROGRESS');
  });
  test(`${api}: an idle or pre-aborted lane has no fabricated request observation`, async () => {
    const c = await context({ api }); assert.equal(inspect({ lane: c.lane }).status, 'INCOMPLETE');
    const controller = new AbortController(); const p = seed(c); controller.abort();
    await assert.rejects(c.lane.author.repair({ ...p, signal: controller.signal }));
    assert.equal(readIssuedLiveModelLaneV4(c.lane).requestObservations.length, 0);
    assert.equal(inspect({ lane: c.lane }).calls.length, 0); assert.equal(c.requests.length, 0);
  });
  test(`${api}: oversized request refuses before observation with resolved treatment retained`, async () => {
    const c = await context({ api }), p = seed(c);
    await assert.rejects(c.lane.author.repair({ ...p, stages: [{ data: 'x'.repeat(262144) }] }));
    const read = readIssuedLiveModelLaneV4(c.lane), result = inspect({ lane: c.lane });
    assert.equal(read.requestObservations.length, 0); assert.equal(read.invocations.length, 1);
    assert.equal(read.invocations[0].payload, null, 'Oversized stage text is not retained');
    assert.equal(result.status, 'INCOMPLETE'); assert.equal(result.calls[0].observation, 'NOT_OBSERVED');
    assert.equal(result.calls[0].requestSha256, null); assert.equal(result.calls[0].transportSettlement, 'NOT_STARTED');
    assert.equal(read.snapshot.authorReceipts[0].treatment.systemPromptSha256, c.treatment.expectedSystemPromptSha256);
    assert.equal(read.snapshot.authorReceipts[0].treatment.dispatch, 'NOT_DISPATCHED'); assert.equal(c.requests.length, 0);
  });
  test(`${api}: observer retention-cap violation fails closed without claiming a transport request`, async () => {
    const c = await context({ api });
    // reviewerId is not serialized in the author request. The observer still
    // bounds accepted input retention independently of serialized-body size.
    await assert.rejects(c.lane.author.repair({ ...seed(c), reviewerId: 'x'.repeat(300000) }), { code: 'LIVE_REQUEST_PAYLOAD_CAP' });
    const read = readIssuedLiveModelLaneV4(c.lane);
    assert.equal(read.requestObservations.length, 0); assert.equal(read.invocations[0].payload, null);
    assert.equal(c.requests.length, 0); assert.equal(read.snapshot.authorReceipts[0].code, 'LIVE_REQUEST_PAYLOAD_CAP');
    // The adapter invoked its fetch wrapper, but the wrapper did not invoke
    // the captured transport. Inconsistent evidence is refused, not relabelled
    // as NOT_STARTED/CONSISTENT. The full host receipt remains follow-on.
    assert.throws(() => inspect({ lane: c.lane }));
  });
  test(`${api}: observer token is single-use before and after transport completion`, async () => {
    const c = await context({ api }); let calls = 0, wrapper, request, receiver, endpoint;
    const author = function (url, p) {
      calls++; wrapper = this.fetch; receiver = this; request = p; endpoint = url;
      assert.throws(() => Reflect.apply(wrapper, receiver, [url, p]), { code: 'LIVE_REQUEST_INVENTORY' });
      return c.transports.author(url, p);
    };
    const lane = createReviewedLiveModelLaneWithTransportV4(c.input, { ...c.transports, author }, () => 100);
    await lane.author.repair(seed({ ...c, lane }));
    const before = readIssuedLiveModelLaneV4(lane).requestObservations;
    assert.throws(() => Reflect.apply(wrapper, receiver, [endpoint, request]), { code: 'LIVE_REQUEST_INVENTORY' });
    assert.equal(calls, 1); assert.deepEqual(readIssuedLiveModelLaneV4(lane).requestObservations, before);
    assert.equal(inspect({ lane }).status, 'CONSISTENT');
  });
  for (const refusal of ['synchronous-throw','malformed-response']) test(`${api}: ${refusal} retains invocation, not success`, async () => {
    const c = await context({ api }); let calls = 0;
    const author = () => { calls++; if (refusal === 'synchronous-throw') throw Error('synthetic'); return new Response('{}'); };
    const lane = createReviewedLiveModelLaneWithTransportV4(c.input, { ...c.transports, author }, () => 100);
    await assert.rejects(lane.author.repair(seed({ ...c, lane })));
    const result = inspect({ lane }); assert.equal(calls, 1); assert.equal(result.calls.length, 1);
    assert.equal(result.calls[0].observation, 'LOCAL_TRANSPORT_INVOKED');
    assert.equal(result.status, 'INCOMPLETE'); assert.equal(result.calls[0].receiptStatus, 'UNAVAILABLE');
  });
  test(`${api}: pending cancellation preserves original signal, body and unknown settlement`, async () => {
    const c = await context({ api }), entered = deferred(), completion = deferred(); let receiver;
    const author = function (_url, request) { receiver = this; entered.resolve(request); return completion.promise; };
    const lane = createReviewedLiveModelLaneWithTransportV4(c.input, { ...c.transports, author }, () => 100);
    const p = structuredClone(seed({ ...c, lane }));
    const running = lane.author.repair(p); let joined = false;
    try {
      const request = await entered.promise;
      assert.equal(receiver.model, c.input.author.model, 'Preserve adapter receiver semantics');
      const before = readIssuedLiveModelLaneV4(lane).requestObservations[0].request.body;
      p.candidate.files[0].content = 'mutated'; p.task.acceptanceCriteria[0] = 'mutated';
      assert.equal(readIssuedLiveModelLaneV4(lane).requestObservations[0].request.body, before);
      assert.equal(inspect({ lane }).status, 'INCOMPLETE');
      lane.revoke(); await assert.rejects(running);
      assert.equal(request.signal.aborted, true);
      const result = inspect({ lane }); assert.equal(result.status, 'INCOMPLETE');
      assert.equal(result.calls[0].transportSettlement, 'UNKNOWN');
      assert.equal(lane.snapshot().lifecycle.pendingTransports, 1);
      const settlement = Promise.all(lane.executionOwners().map(owner => owner.settled())).then(() => { joined = true; });
      await tick(); assert.equal(joined, false); completion.resolve(new Response('{}')); await settlement;
      assert.equal(inspect({ lane }).calls[0].transportSettlement, 'UNKNOWN', 'Later drain cannot upgrade historical call settlement');
      assert.equal(lane.snapshot().lifecycle.pendingTransports, 0); assert.equal(lane.snapshot().lifecycle.recoveryRequired, true);
    } finally { completion.resolve(new Response('{}')); await Promise.allSettled([running]); await Promise.all(lane.executionOwners().map(owner => owner.settled())); }
  });
}
test('request channel follows explicit local instruction mode without schema injection', async () => {
  const c = await context({ api: 'CHAT_COMPLETIONS', configure: input => { input.author.outputMode = 'json_instruction'; input.reviewer.outputMode = 'json_instruction'; } });
  await c.run(); assert.equal(inspect({ lane: c.lane }).status, 'CONSISTENT');
  assert(c.requests.every(item => !Object.hasOwn(item.body, 'response_format')));
});
