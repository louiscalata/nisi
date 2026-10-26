// Synthetic V4 repository receipts only. No provider, native application, or
// model-returned candidate execution occurs in this suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { context } from './helpers/live-model-v4-fixture.mjs';
import { deferred, reply, tick } from './helpers/live-model-v3-fixture.mjs';
import { repositoryLiveContext, rebindHostReport } from './helpers/repository-live-run-fixture.mjs';
import { createRepositoryLiveModelRunV4 as create, readRepositoryLiveModelRunV4 as read,
  inspectLiveModelCallV4 as inspectCall } from '../receipts/repository-live-model-run-v4.mjs';
import { createRepositoryLiveModelRunV3 as createV3 } from '../receipts/repository-live-model-run-v3.mjs';
import { inspectIssuedLiveModelRequestsV4 as inspectRequests } from '../receipts/live-model-request-v4.mjs';
import { sha256Text, stableStringify } from '../workflow/contracts.mjs';

const protocols = ['CHAT_COMPLETIONS', 'NATIVE_API'];
const claims = ['authorizing', 'executionAttested', 'modelUseAttested', 'providerDeliveryAttested',
  'promotionEligible', 'measurementVerified', 'causalClaim'];

async function runRepository(t, options = {}) {
  return repositoryLiveContext(t, { contextFactory: context, ...options });
}

function assertNoClaims(value) {
  for (const key of claims) assert.equal(value[key], false, `claim must remain false: ${key}`);
}

function assertRequestInspection(receipt, expectedCalls) {
  assert.equal(receipt.requestInspection.status, 'CONSISTENT');
  assert.equal(receipt.requestInspection.source, 'ORIGINAL_ISSUED_LANE');
  assert.equal(receipt.requestInspection.calls.length, expectedCalls);
  assert.equal(receipt.requestInspection.providerDeliveryAttested, false);
  assert.equal(receipt.requestInspection.modelUseAttested, false);
  assert.equal(receipt.requestInspection.repositoryRunValidated, false);
}

function refuseOrNonPass(context) {
  let value;
  try {
    value = create(context);
  } catch (error) {
    assert.equal(typeof error?.code, 'string');
    return;
  }
  assert.notEqual(value.status, 'SYNTHETIC_CONTRACT_PASS');
  assert.notEqual(value.status, 'SCOPED_LIVE_REPAIR_REVIEW_PASS');
}

function refuseOrIncomplete(context) {
  let value;
  try {
    value = create(context);
  } catch (error) {
    assert.equal(typeof error?.code, 'string');
    return;
  }
  assert.equal(value.status, 'INCOMPLETE');
}

function refuseWithCodeOrIncomplete(context, code) {
  let value;
  try {
    value = create(context);
  } catch (error) {
    assert.equal(error?.code, code);
    return;
  }
  assert.equal(value.status, 'INCOMPLETE');
}

for (const authorApi of protocols) for (const reviewerApi of protocols)
  for (const arm of ['OFF', 'ON']) for (const variant of ['repair', 'baseline', 'no-change'])
    test(`V4 receipt ${authorApi}/${reviewerApi}/${arm}/${variant}`, async t => {
      const c = await runRepository(t, { api: authorApi, reviewerApi, arm, variant });
      const result = await c.run(), receipt = create(result.context), baseline = c.fixture.preparations[0].candidateFingerprint;
      assert.equal(receipt.schemaVersion, 'nisi-repository-live-model-run-v4');
      assert.equal(receipt.lane.configuration.arm, arm);
      assert.equal(receipt.lane.authorReceipts[0].treatment.arm, arm);
      assert.equal(receipt.lane.authorReceipts[0].treatment.treatmentFingerprint, c.treatment.fingerprint);
      assert(!Object.hasOwn(receipt.lane.reviewerReceipts[0] ?? {}, 'treatment'));
      assertNoClaims(receipt);
      assert.deepEqual(read(receipt, result.context), receipt);
      const { fingerprint, ...identity } = receipt;
      assert.equal(fingerprint, sha256Text('nisi/repository-live-model-run/v4\0' + stableStringify(identity)));

      if (variant === 'repair') {
        assert.equal(receipt.status, 'SYNTHETIC_CONTRACT_PASS');
        assert.equal(receipt.outcome, 'COMPLETED'); assert.equal(receipt.workflowOutcome, 'COMPLETED');
        assert.equal(receipt.finalCandidateFingerprint, c.fixture.preparations[1].candidateFingerprint);
        assert.equal(receipt.lane.phase, 'REVIEWED');
        assert.equal(receipt.lane.authorReceipts.length, 1); assert.equal(receipt.lane.reviewerReceipts.length, 1);
        assert.equal(receipt.usage.calls, 2); assert.equal(receipt.usage.totals.totalTokens, 30);
        assert.equal(receipt.usage.complete, true); assert.equal(result.hostResult.proposedChanges !== null, true);
        assertRequestInspection(receipt, 2);
      } else {
        assert.equal(receipt.status, 'CONSISTENT_NO_PROGRESS');
        assert.equal(receipt.outcome, 'NO_PROGRESS'); assert.equal(receipt.workflowOutcome, 'NO_PROGRESS');
        assert.deepEqual(receipt.reasons, []);
        assert.equal(receipt.finalCandidateFingerprint, baseline);
        assert.equal(receipt.lane.phase, 'NO_PROGRESS');
        assert.equal(receipt.lane.authorReceipts.length, 1); assert.equal(receipt.lane.reviewerReceipts.length, 0);
        assert.equal(receipt.lane.returnedResults.length, 1); assert.equal(receipt.lane.returnedResults[0].operation, 'repair');
        assert.equal(receipt.usage.calls, 1); assert.equal(receipt.usage.totals.totalTokens, 15);
        assert.equal(receipt.usage.complete, true); assert.equal(result.hostResult.proposedChanges, null);
        assert.equal(c.requests.length, 1); assertRequestInspection(receipt, 1);
      }
    });

for (const api of protocols) test(`V4 malformed ${api} author response is retained as non-pass`, async t => {
  const c = await runRepository(t, { api, onRequest(call, response) {
    if (call.operation === 'repair') return new Response('{}');
    return new Response(JSON.stringify(response));
  } });
  const result = await c.run(), receipt = create(result.context);
  assert.equal(receipt.status, 'INCOMPLETE'); assert.equal(receipt.lane.reviewerReceipts.length, 0);
  assert.equal(receipt.lane.authorReceipts[0].status, 'UNAVAILABLE'); assert.equal(result.hostResult.proposedChanges, null);
  assertNoClaims(receipt);
});

for (const api of protocols) test(`V4 adverse reviewer ${api} cannot pass`, async t => {
  const c = await runRepository(t, { api, reviewerApi: api, onRequest(call, result) {
    if (call.operation !== 'review') return new Response(JSON.stringify(result));
    const changed = structuredClone(result);
    if (api === 'NATIVE_API') {
      const output = JSON.parse(changed.output[0].content);
      output.findings = [{ code: 'SYNTHETIC_REVIEW', message: 'Synthetic adverse review' }];
      output.summary = 'Synthetic adverse review'; changed.output[0].content = JSON.stringify(output);
    } else {
      changed.choices[0].message.content = JSON.stringify({
        findings: [{ code: 'SYNTHETIC_REVIEW', message: 'Synthetic adverse review' }], summary: 'Synthetic adverse review',
      });
    }
    return new Response(JSON.stringify(changed));
  } });
  const result = await c.run(), receipt = create(result.context);
  assert.equal(receipt.status, 'INCOMPLETE'); assert.equal(receipt.outcome, 'REPAIR_LIMIT');
  assert.equal(receipt.lane.reviewerReceipts.length, 1); assert.equal(receipt.lane.reviewerReceipts[0].status, 'RESPONSE_VALIDATED');
  assert.equal(result.hostResult.proposedChanges, null); assertNoClaims(receipt);
});

for (const api of protocols) test(`V4 unregistered third candidate ${api} never reaches reviewer`, async t => {
  const c = await runRepository(t, { api, variant: 'third' }), result = await c.run(), receipt = create(result.context);
  assert.equal(receipt.status, 'INCOMPLETE'); assert.notEqual(receipt.status, 'SYNTHETIC_CONTRACT_PASS');
  assert.equal(receipt.lane.authorReceipts.length, 1); assert.equal(receipt.lane.reviewerReceipts.length, 0);
  assert.equal(c.requests.length, 1); assert.equal(result.hostResult.proposedChanges, null);
  assert(receipt.reasons.includes('MODEL_CANDIDATE_NOT_ADMITTED'));
  assertNoClaims(receipt);
});

test('V4 unknown usage remains null without fabricated totals', async t => {
  const c = await runRepository(t, { api: 'CHAT_COMPLETIONS', reviewerApi: 'CHAT_COMPLETIONS', onRequest(call, result) {
    const changed = structuredClone(result); if (call.operation === 'repair') delete changed.usage;
    return new Response(JSON.stringify(changed));
  } });
  const result = await c.run(), receipt = create(result.context);
  assert.equal(receipt.status, 'SYNTHETIC_CONTRACT_PASS'); assert.equal(receipt.usage.complete, false);
  assert.equal(receipt.usage.totals, null); assert.equal(receipt.usage.knownCalls, 1); assert.equal(receipt.usage.unknownCalls, 1);
  assert.equal(receipt.usage.knownSubtotal.totalTokens, 15);
  assert.equal(Object.hasOwn(receipt.usage, 'projectedTokens'), false);
  assertNoClaims(receipt);
});

for (const api of protocols) test(`V4 pending cancellation ${api} retains incomplete request/lifecycle evidence`, async t => {
  const entered = deferred(), completion = deferred();
  const c = await runRepository(t, { api, onRequest(call, response) { entered.resolve(response); return completion.promise; } });
  const running = c.run(), response = await entered.promise;
  t.after(async () => { completion.resolve(reply(response)); await running; });
  c.lane.revoke(); const result = await running, receipt = create(result.context);
  assert.equal(receipt.status, 'INCOMPLETE'); assert.notEqual(receipt.status, 'SYNTHETIC_CONTRACT_PASS');
  assert.equal(receipt.usage.totals, null); assert.equal(receipt.lane.lifecycle.pendingTransports, 1);
  assert.equal(receipt.lane.lifecycle.recoveryRequired, true); assert.equal(receipt.requestInspection.status, 'INCOMPLETE');
  assert.equal(receipt.requestInspection.calls[0].transportSettlement, 'UNKNOWN'); assertNoClaims(receipt);
  completion.resolve(reply(response)); await tick(); await tick();
  assert.equal(create(result.context).lane.lifecycle.pendingTransports, 0);
});

for (const api of protocols) test(`V4 expiry after validated ${api} response is incomplete and stops the lane`, async t => {
  let wall = 100;
  const c = await runRepository(t, { api, now: () => wall, onRequest(call, response) {
    wall = 10000;
    return new Response(JSON.stringify(response));
  } });
  const result = await c.run(), receipt = create(result.context);
  assert.equal(receipt.status, 'INCOMPLETE');
  assert.equal(receipt.lane.phase, 'FAILED');
  assert.equal(receipt.lane.lifecycle.roles.author.state, 'STOPPED');
  assert.equal(receipt.lane.lifecycle.roles.reviewer.state, 'STOPPED');
  assert(receipt.reasons.includes('WORKFLOW_NOT_COMPLETED'));
  assertNoClaims(receipt);
});

for (const api of protocols) test(`V4 pre-aborted ${api} run is incomplete without model dispatch`, async t => {
  const c = await runRepository(t, { api });
  const controller = new AbortController(); controller.abort();
  const result = await c.run({ signal: controller.signal }), receipt = create(result.context);
  assert.equal(receipt.status, 'INCOMPLETE');
  assert.equal(c.requests.length, 0);
  assert(receipt.reasons.includes('WORKFLOW_NOT_COMPLETED'));
  assertNoClaims(receipt);
});

test('V4 original-issued identity, legacy reader refusal, and serialized host refusal', async t => {
  const c = await runRepository(t, { api: 'CHAT_COMPLETIONS', reviewerApi: 'NATIVE_API' }), result = await c.run();
  const receipt = create(result.context);
  assert.throws(() => create({ lane: { ...c.lane }, hostResult: result.hostResult }), { code: 'LIVE_LANE_NOT_ISSUED' });
  assert.throws(() => create({ lane: c.lane.snapshot(), hostResult: result.hostResult }), { code: 'LIVE_LANE_NOT_ISSUED' });
  assert.throws(() => create({ lane: c.lane, hostResult: structuredClone(result.hostResult) }));
  assert.throws(() => createV3(result.context), { code: 'LIVE_LANE_NOT_ISSUED' });
  assert.deepEqual(read(receipt, result.context), receipt);
});

test('V4 second issued lane cannot substitute for original host/lane', async t => {
  const a = await runRepository(t, { api: 'CHAT_COMPLETIONS', reviewerApi: 'NATIVE_API' }), ar = await a.run();
  const b = await runRepository(t, { api: 'CHAT_COMPLETIONS', reviewerApi: 'NATIVE_API' }), br = await b.run();
  assert.throws(() => create({ lane: b.lane, hostResult: ar.hostResult }));
  assert.throws(() => create({ lane: a.lane, hostResult: br.hostResult }));
});

test('V4 tampered rehashed metadata is rejected by the reader', async t => {
  const c = await runRepository(t, { api: 'NATIVE_API', reviewerApi: 'CHAT_COMPLETIONS' }), result = await c.run();
  const receipt = create(result.context), changed = structuredClone(receipt);
  changed.status = 'INCOMPLETE'; changed.workflowOutcome = 'NO_PROGRESS';
  const { fingerprint, ...identity } = changed;
  changed.fingerprint = sha256Text('nisi/repository-live-model-run/v4\0' + stableStringify(identity));
  assert.throws(() => read(changed, result.context), { code: 'LIVE_RUN_RECORD_MISMATCH' });
});

test('V4 request inspection and pure call inspection retain original metadata', async t => {
  const c = await runRepository(t, { api: 'NATIVE_API', reviewerApi: 'CHAT_COMPLETIONS', arm: 'OFF' }), result = await c.run();
  const receipt = create(result.context), lane = c.lane.snapshot();
  assert.equal(receipt.requestInspection.status, 'CONSISTENT');
  assert.deepEqual(receipt.requestInspection, inspectRequests({ lane: c.lane }));
  const authorInput = { receipt: structuredClone(lane.authorReceipts[0]), role: 'author', configuration: lane.configuration,
    runId: lane.runId, taskFingerprint: lane.configuration.taskFingerprint,
    baselineCandidateFingerprint: lane.baselineCandidateFingerprint, repairedCandidateFingerprint: lane.repairedCandidateFingerprint };
  const inspected = inspectCall(authorInput);
  assert.equal(inspected.consistencyOnly, true); assert.equal(inspected.authorizing, false);
  assert.equal(inspected.usage.calls, 1); assert.equal(inspected.usage.complete, true);
  assert.deepEqual(inspected.reasons, []);
});

test('V4 original host rebindings never receive a quality pass', async t => {
  const c = await runRepository(t, { api: 'CHAT_COMPLETIONS', reviewerApi: 'NATIVE_API' }), result = await c.run();
  const repair = rebindHostReport({ ...c, hostResult: result.hostResult }, report => {
    report.stages.find(stage => stage.stage === 'repair').evidence.note = 'substituted repair';
  });
  assert.throws(() => create({ lane: c.lane, hostResult: repair }), { code: 'LIVE_RUN_MODEL_RESULT_MISMATCH' });
  const review = rebindHostReport({ ...c, hostResult: result.hostResult }, report => {
    report.stages.find(stage => stage.stage === 'review').evidence.summary = 'substituted review';
  });
  assert.throws(() => create({ lane: c.lane, hostResult: review }), { code: 'LIVE_RUN_MODEL_RESULT_MISMATCH' });
  const reordered = rebindHostReport({ ...c, hostResult: result.hostResult }, report => {
    const index = report.stages.findIndex(stage => stage.stage === 'review');
    const [stage] = report.stages.splice(index, 1); report.stages.splice(5, 0, stage);
  });
  refuseOrNonPass({ lane: c.lane, hostResult: reordered });
});

test('V4 no-progress report tampering cannot remain CONSISTENT_NO_PROGRESS', async t => {
  const c = await runRepository(t, { api: 'CHAT_COMPLETIONS', reviewerApi: 'NATIVE_API', variant: 'no-change' });
  const result = await c.run();
  const tampered = rebindHostReport({ ...c, hostResult: result.hostResult }, report => {
    report.stages.find(stage => stage.stage === 'repair').evidence.note = 'substituted no-progress repair';
  });
  refuseOrIncomplete({ lane: c.lane, hostResult: tampered });
  const proposalTampered = { ...result.hostResult, proposedChanges: {} };
  refuseWithCodeOrIncomplete({ lane: c.lane, hostResult: proposalTampered }, 'LIVE_RUN_HOST_PROPOSAL');
});

test('V4 original report and host journal linkage tampering is rejected', async t => {
  const c = await runRepository(t, { api: 'NATIVE_API', reviewerApi: 'CHAT_COMPLETIONS' });
  const result = await c.run();
  const reportDetached = { ...result.hostResult, report: structuredClone(result.hostResult.report) };
  reportDetached.report.candidateFingerprint = c.fixture.preparations[0].candidateFingerprint;
  refuseOrNonPass({ lane: c.lane, hostResult: reportDetached });

  const journalDetached = { ...result.hostResult, invocations: result.hostResult.invocations.map((row, index) =>
    index === 0 ? { ...row, binding: { ...row.binding, candidateFingerprint: '0'.repeat(64) } } : row) };
  refuseWithCodeOrIncomplete({ lane: c.lane, hostResult: journalDetached }, 'LIVE_RUN_HOST_INVOCATION');

  const adapterResultDetached = { ...result.hostResult, invocations: result.hostResult.invocations.map((row, index) =>
    index === 0 ? { ...row, adapterResult: { ...row.adapterResult, status: 'FAIL' } } : row) };
  refuseWithCodeOrIncomplete({ lane: c.lane, hostResult: adapterResultDetached }, 'LIVE_RUN_HOST_INVOCATION_RESULT');

  // The bundle reader derives this expectation from ORIGINAL issued executions,
  // not a circular comparison of the caller-supplied summary to itself.
  const registrationDetached = { ...result.hostResult,
    bundleSummary: { ...result.hostResult.bundleSummary, nodeRegistrationFingerprint: '0'.repeat(64) } };
  assert.throws(() => create({ lane: c.lane, hostResult: registrationDetached }), { code: 'REPOSITORY_RUN_TEST_CONFIGURATION' });
});
