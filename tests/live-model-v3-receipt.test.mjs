// Synthetic HTTP and process observations. Never execute model-returned source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { context, selection, reply, deferred, tick } from './helpers/live-model-v3-fixture.mjs';
import { repositoryLiveContext } from './helpers/repository-live-run-fixture.mjs';
import { createRepositoryLiveModelRunV3, readRepositoryLiveModelRunV3, inspectLiveModelCallV3 } from '../receipts/repository-live-model-run-v3.mjs';
import { createRepositoryLiveModelRunV1, createRepositoryLiveModelRunV2 } from '../receipts/repository-live-model-run-v1.mjs';
import { sha256Text, stableStringify } from '../workflow/contracts.mjs';

for (const author of ['NATIVE_API', 'CHAT_COMPLETIONS']) for (const reviewer of ['NATIVE_API', 'CHAT_COMPLETIONS'])
  test(`V3 complete issued host receipt ${author}/${reviewer} stays synthetic`, async t => {
    const c = await repositoryLiveContext(t, { contextFactory: context, configure(i) { i.author = selection('author', author); i.reviewer = selection('reviewer', reviewer); } });
    const result = await c.run(), receipt = createRepositoryLiveModelRunV3(result.context);
    assert.equal(receipt.status, 'SYNTHETIC_CONTRACT_PASS'); assert.equal(receipt.schemaVersion, 'nisi-repository-live-model-run-v3');
    assert.equal(receipt.hostSeedInference, false); assert.equal(receipt.authorizing, false); assert.equal(receipt.executionAttested, false);
    assert.equal(receipt.usage.totals.totalTokens, 85); assert.equal(receipt.lane.returnedResults.length, 2);
    assert.equal(receipt.usageProvenance.aggregateTotals, 'DERIVED_SUM_OF_VALIDATED_CALL_COUNTERS');
    assert.equal(receipt.usageProvenance.measurementsVerified, false);
    for (const item of receipt.usageProvenance.roles) assert.equal(item.totalTokensSource,
      receipt.lane.configuration[item.role].api === 'NATIVE_API' ? 'DERIVED_SUM_OF_REPORTED_COUNTERS' : 'REPORTED_TOTAL_TOKENS');
    assert.equal(receipt.lane.repairedCandidateFingerprint, result.hostResult.report.candidateFingerprint);
    assert.deepEqual(readRepositoryLiveModelRunV3(receipt, result.context), receipt);
    for (const create of [createRepositoryLiveModelRunV1, createRepositoryLiveModelRunV2]) assert.throws(() => create(result.context), { code: 'LIVE_LANE_NOT_ISSUED' });
    for (const mutate of [r => { r.schemaVersion = 'nisi-repository-live-model-run-v2'; }, r => { r.status = 'SCOPED_LIVE_REPAIR_REVIEW_PASS'; },
      r => { r.lane.authorReceipts[0] = r.lane.reviewerReceipts[0]; }, r => { r.lane.lifecycle.roles.author.remoteInferenceStopped = 'STOPPED'; },
      r => { r.usage.totals.totalTokens++; }, r => { r.lane.configuration.author.api = 'OTHER'; }]) {
      const changed = structuredClone(receipt); mutate(changed); const { fingerprint, ...identity } = changed;
      changed.fingerprint = sha256Text('nisi/repository-live-model-run/v3\0' + stableStringify(identity));
      assert.throws(() => readRepositoryLiveModelRunV3(changed, result.context), { code: 'LIVE_RUN_RECORD_MISMATCH' });
    }
  });
test('V3 unregistered native output records incomplete result without executing a new candidate', async t => {
  const c = await repositoryLiveContext(t, { contextFactory: context, onRequest(call) {
    const content = JSON.parse(call.envelope.output[0].content); content.candidate.files[0].content += '\n';
    call.envelope.output[0].content = JSON.stringify(content); return reply(call.envelope);
  } });
  const result = await c.run(), receipt = createRepositoryLiveModelRunV3(result.context);
  assert.equal(receipt.status, 'INCOMPLETE'); assert.equal(receipt.lane.reviewerReceipts.length, 0);
  assert.equal(result.testHistory.length, 1); assert.ok(receipt.reasons.includes('MODEL_CANDIDATE_NOT_ADMITTED'));
});
test('V3 native cancellation receipt preserves aggregate pending and unavailable usage', async t => {
  const start = deferred(), completion = deferred();
  const c = await repositoryLiveContext(t, { contextFactory: context, onRequest(call) { start.resolve(call); return completion.promise; } });
  const running = c.run(), call = await start.promise;
  t.after(async () => { completion.resolve(reply(call.envelope)); await running; });
  c.lane.revoke(); const result = await running;
  let receipt;
  assert.doesNotThrow(() => { receipt = createRepositoryLiveModelRunV3(result.context); },
    'A cancelled lane must retain a readable incomplete receipt while transport settlement is pending');
  assert.equal(receipt.status, 'INCOMPLETE'); assert.equal(receipt.usage.totals, null);
  assert.equal(receipt.usageProvenance.aggregateTotals, null);
  assert.equal(receipt.lane.lifecycle.pendingTransports, 1); assert.equal(receipt.lane.lifecycle.recoveryRequired, true);
  completion.resolve(reply(call.envelope)); await tick(); await tick();
  assert.equal(createRepositoryLiveModelRunV3(result.context).lane.lifecycle.pendingTransports, 0);
});

const callInput = s => ({ receipt: structuredClone(s.authorReceipts[0]), role: 'author', configuration: s.configuration,
  runId: s.runId, taskFingerprint: s.configuration.taskFingerprint, baselineCandidateFingerprint: s.baselineCandidateFingerprint,
  repairedCandidateFingerprint: s.repairedCandidateFingerprint });
const invalidCalls = [
  ['termination-claim', r => { r.termination = 'COMPLETED'; }],
  ['completion-attestation', r => { r.serverCompletionAttested = true; }],
  ['authenticity-attestation', r => { r.modelAuthenticityAttested = true; }],
  ['reported-instance', r => { r.reportedModelInstance = 'wrong'; }],
  ['wrong-profile', r => { r.profile = 'other'; }],
  ['wrong-receipt-version', r => { r.schemaVersion = 2; }],
  ['tool-integration', r => { r.integrationsRequested = ['tool']; }],
  ['stored', r => { r.storeRequested = true; }],
  ['invented-total-provenance', r => { r.usageSource.totalTokens = 'PROVIDER_REPORTED'; }],
  ['zero-output', r => { r.usage.completionTokens = 0; r.usage.totalTokens = r.usage.promptTokens; r.reportedStats.total_output_tokens = 0; }],
  ['cap-hit', r => { r.usage.completionTokens = 512; r.usage.totalTokens = r.usage.promptTokens + 512; r.reportedStats.total_output_tokens = 512; }],
  ['negative-zero-reasoning', r => { r.reportedStats.reasoning_output_tokens = -0; }],
  ['fractional-count', r => { r.usage.promptTokens = 1.5; }],
  ['wrong-derived-total', r => { r.usage.totalTokens++; }],
  ['overflow', r => { r.usage.promptTokens = Number.MAX_SAFE_INTEGER; r.reportedStats.input_tokens = Number.MAX_SAFE_INTEGER; r.usage.totalTokens = Number.MAX_SAFE_INTEGER + 10; }],
  ['unknown-stat', r => { r.reportedStats.extra = 1; }],
  ['fractional-elapsed', r => { r.elapsedMs = 0.1; }],
  ['request-hash-newline', r => { r.requestSha256 += '\n'; }],
  ['remote-stop-claim', r => { r.lifecycle.remoteInferenceStopped = 'STOPPED'; }],
];
for (const [name, change] of invalidCalls) test(`V3 pure evidence reader rejects ${name} without relying on adapter refusal`, async () => {
  const c = await context(); await c.run(); const input = callInput(c.lane.snapshot());
  assert.equal(inspectLiveModelCallV3(input).consistencyOnly, true); assert.equal(inspectLiveModelCallV3(input).authorizing, false);
  change(input.receipt); assert.throws(() => inspectLiveModelCallV3(input));
});
