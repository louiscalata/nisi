// Pure V4 model-call receipt validation. Synthetic transports only: no model,
// native application, candidate execution or network call. Fixture source is read locally.
import test from 'node:test';
import assert from 'node:assert/strict';
import { context } from './helpers/live-model-v4-fixture.mjs';
import { seed } from './helpers/live-model-v3-fixture.mjs';
import { inspectLiveModelCallV4 as inspect } from '../receipts/repository-live-model-run-v4.mjs';

const protocols = ['CHAT_COMPLETIONS', 'NATIVE_API'];
const arms = ['OFF', 'ON'];

function callInput(lane, role, receipt = null) {
  const snapshot = lane.snapshot();
  return {
    receipt: receipt ?? snapshot[role + 'Receipts'][0], role,
    configuration: snapshot.configuration, runId: snapshot.runId,
    taskFingerprint: snapshot.configuration.taskFingerprint,
    baselineCandidateFingerprint: snapshot.baselineCandidateFingerprint,
    repairedCandidateFingerprint: snapshot.repairedCandidateFingerprint,
  };
}

function changed(value, mutate) {
  const copy = structuredClone(value); mutate(copy); return copy;
}

function refuses(input, mutate, code = undefined) {
  const copy = changed(input, mutate);
  assert.throws(() => inspect(copy), code ? { code } : undefined);
}

for (const api of protocols) for (const arm of arms) test(`pure V4 call inspection ${api}/${arm}`, async () => {
  const c = await context({ api, reviewerApi: api, arm });
  assert.equal((await c.run()).outcome, 'COMPLETED');
  for (const role of ['author', 'reviewer']) {
    const result = inspect(callInput(c.lane, role));
    assert.deepEqual(result.reasons, []); assert.equal(result.consistencyOnly, true);
    assert.equal(result.authorizing, false); assert.equal(result.usage.calls, 1);
  }
  const author = callInput(c.lane, 'author'), reviewer = callInput(c.lane, 'reviewer');
  assert(Object.hasOwn(author.receipt, 'treatment'));
  assert(!Object.hasOwn(reviewer.receipt, 'treatment'));
});

for (const api of protocols) test(`${api}: guided author receipt schema is closed and cannot be relabelled legacy`, async () => {
  const c = await context({ api, reviewerApi: api }); await c.run();
  const input = callInput(c.lane, 'author');
  refuses(input, v => { v.receipt.unknown = true; }, 'LIVE_RUN_MODEL_SCHEMA');
  refuses(input, v => { v.receipt.schemaVersion = api === 'NATIVE_API' ? 'nisi-native-chat-receipt-v1' : 2; });
  refuses(input, v => { delete v.receipt.treatment; }, 'LIVE_RUN_MODEL_SCHEMA');
  refuses(input, v => { v.configuration.author.adapterReceiptVersion = api === 'NATIVE_API' ? 'nisi-native-chat-receipt-v1' : 2; });
});

for (const api of protocols) for (const arm of arms) test(`${api}/${arm}: treatment contradictions refuse`, async () => {
  const c = await context({ api, reviewerApi: api, arm }); await c.run();
  const input = callInput(c.lane, 'author');
  for (const mutate of [
    v => { v.receipt.treatment.arm = v.receipt.treatment.arm === 'ON' ? 'OFF' : 'ON'; },
    v => { v.receipt.treatment.treatmentFingerprint = '0'.repeat(64); },
    v => { v.receipt.treatment.baseSystemPromptSha256 = '0'.repeat(64); },
    v => { v.receipt.treatment.systemPromptSha256 = '0'.repeat(64); },
    v => { v.receipt.treatment.applicationPoint = 'OTHER'; },
    v => { v.configuration.arm = v.configuration.arm === 'ON' ? 'OFF' : 'ON'; },
    v => { v.configuration.treatment.fingerprint = '0'.repeat(64); },
  ]) refuses(input, mutate);
});

for (const api of protocols) test(`${api}: reviewer treatment contamination and protocol relabelling refuse`, async () => {
  const c = await context({ api, reviewerApi: api }); await c.run();
  const input = callInput(c.lane, 'reviewer');
  refuses(input, v => { v.receipt.treatment = structuredClone(v.configuration.treatment); }, 'LIVE_RUN_MODEL_SCHEMA');
  refuses(input, v => { v.receipt.schemaVersion = api === 'NATIVE_API' ? 'nisi-native-chat-guidance-receipt-v1' : 4; });
  refuses(input, v => { v.receipt.unknown = null; }, 'LIVE_RUN_MODEL_SCHEMA');
});

for (const api of protocols) test(`${api}: model and execution bindings refuse`, async () => {
  const c = await context({ api, reviewerApi: api }); await c.run();
  const input = callInput(c.lane, 'author');
  for (const mutate of [
    v => { v.receipt.runId = 'substituted'; },
    v => { v.receipt.taskFingerprint = '0'.repeat(64); },
    v => { v.receipt.attempt = 0; },
    v => { v.receipt.inputCandidateFingerprint = '0'.repeat(64); },
    v => { v.receipt.requestedModel = 'other.model'; },
    v => { v.receipt.adapterId = 'other.adapter'; },
    v => { v.receipt.requestedMaxOutputTokens++; },
    v => { v.runId = 'substituted'; },
    v => { v.taskFingerprint = '0'.repeat(64); },
  ]) refuses(input, mutate);
});

for (const api of protocols) test(`${api}: usage lifecycle and refusal contradictions fail closed`, async () => {
  const c = await context({ api, reviewerApi: api }); await c.run();
  const input = callInput(c.lane, 'author');
  refuses(input, v => { v.receipt.lifecycle.transportSettlement = 'NOT_STARTED'; });
  refuses(input, v => { v.receipt.lifecycle.remoteInferenceStopped = 'CONFIRMED'; }, 'LIVE_RUN_REMOTE_STOP_CLAIM');
  refuses(input, v => { v.receipt.lifecycle.ownerState = 'UNKNOWN'; }, 'LIVE_RUN_MODEL_LIFECYCLE');
  refuses(input, v => { v.receipt.requestSha256 = 'not-a-digest'; });
  if (api === 'CHAT_COMPLETIONS') {
    refuses(input, v => { v.receipt.usage.totalTokens++; });
    refuses(input, v => { v.receipt.reportedModel = 'other.model'; });
  } else {
    refuses(input, v => { v.receipt.reportedStats.input_tokens++; }, 'LIVE_RUN_NATIVE_STATS');
    refuses(input, v => { v.receipt.reportedStats.reasoning_output_tokens = 1; }, 'LIVE_RUN_NATIVE_STATS');
    refuses(input, v => { v.receipt.usageSource.totalTokens = 'REPORTED_TOTAL_TOKENS'; }, 'LIVE_RUN_NATIVE_USAGE_SOURCE');
    refuses(input, v => { v.receipt.reportedModelInstance = 'other.instance'; });
    refuses(input, v => { v.receipt.termination = 'CONFIRMED'; });
  }
  refuses(input, v => {
    v.receipt.status = 'UNAVAILABLE'; v.receipt.code = 'SYNTHETIC_REFUSAL';
    v.receipt.resultCandidateFingerprint = null; v.receipt.usage = null;
  }, 'LIVE_RUN_MODEL_SCHEMA');
});

for (const api of protocols) test(`${api}: genuine adapter pre-dispatch refusal is inspectable but incomplete`, async () => {
  const c = await context({ api, reviewerApi: api });
  await assert.rejects(c.lane.author.repair({ ...seed(c), stages: [{ data: 'x'.repeat(262144) }] }));
  const input = callInput(c.lane, 'author'), result = inspect(input);
  assert(result.reasons.includes('MODEL_RESPONSE_UNAVAILABLE'));
  assert(result.reasons.includes('MODEL_TRANSPORT_UNCONFIRMED'));
  assert.equal(input.receipt.status, 'UNAVAILABLE');
  assert.equal(input.receipt.requestSha256, null);
  assert.equal(input.receipt.lifecycle.transportSettlement, 'NOT_STARTED');
  assert.equal(input.receipt.treatment.dispatch, 'NOT_DISPATCHED');
  refuses(input, v => { v.receipt.treatment.dispatch = 'LOCAL_FETCH_INVOKED'; });
  refuses(input, v => { v.receipt.requestSha256 = '0'.repeat(64); v.receipt.lifecycle.transportSettlement = 'CONFIRMED'; });
});

for (const api of protocols) test(`${api}: genuine failed dispatched call remains inspectable and nonpassing`, async () => {
  const c = await context({ api, reviewerApi: api, onRequest(call, result) {
    if (call.operation === 'repair') return new Response('{}');
    return new Response(JSON.stringify(result));
  } });
  assert.notEqual((await c.run()).outcome, 'COMPLETED');
  const input = callInput(c.lane, 'author'), result = inspect(input);
  assert(result.reasons.includes('MODEL_RESPONSE_UNAVAILABLE'));
  assert.equal(input.receipt.status, 'UNAVAILABLE');
  assert.equal(input.receipt.treatment.dispatch, 'LOCAL_FETCH_INVOKED');
  assert.equal(typeof input.receipt.requestSha256, 'string');
  refuses(input, v => { v.receipt.treatment.dispatch = 'NOT_DISPATCHED'; });
  refuses(input, v => { v.receipt.lifecycle.transportSettlement = 'NOT_STARTED'; });
});

// Co-mutating context and receipt must not evade the independently pinned
// configuration. These regressions were introduced before the production fix.
const contextMutations = [
  ['foreign task', v => { v.taskFingerprint = v.receipt.taskFingerprint = '0'.repeat(64); }],
  ['nonnumeric token cap', v => { v.configuration.maxOutputTokens = v.receipt.requestedMaxOutputTokens = 'nonsense'; }],
  ['unknown configuration field', v => { v.configuration.extra = true; }],
  ['wrong fixed adapter ID', v => { v.configuration.authorId = v.receipt.adapterId = 'other.author'; }],
  ['invalid request cap', v => { v.configuration.maxRequestBytes = -1; }],
  ['invalid response cap', v => { v.configuration.maxResponseBytes = 0; }],
  ['invalid timeout', v => { v.configuration.timeoutMs = '1000'; }],
  ['unknown transport', v => { v.configuration.transportKind = 'REMOTE'; }],
  ['invalid endpoint', v => { v.configuration.author.endpoint = 'https://example.invalid'; }],
  ['invalid run ID', v => { v.runId = v.receipt.runId = ''; }],
  ['same candidate population', v => {
    v.repairedCandidateFingerprint = v.baselineCandidateFingerprint;
    v.receipt.resultCandidateFingerprint = v.baselineCandidateFingerprint;
    if (v.configuration.author.api === 'CHAT_COMPLETIONS') v.receipt.candidateFingerprint = v.baselineCandidateFingerprint;
  }],
];
for (const api of protocols) for (const [name,mutate] of contextMutations)
  test(`${api}: independent context rejects ${name}`, async () => {
    const c = await context({api,reviewerApi:api}); await c.run();
    refuses(callInput(c.lane,'author'),mutate);
  });
