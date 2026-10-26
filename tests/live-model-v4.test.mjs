// Synthetic model transport and workflow checks; no server/native-code execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runWorkflow } from '../workflow/engine.mjs';
import { createReviewedLiveFixtureV1 } from '../examples/repository-task/reviewed-live-fixture-v1.mjs';
import { registerRepairGuidanceV1 } from '../adapters/repair-guidance-v1.mjs';
import { createReviewedLiveModelLaneWithTransportV4 as create, readIssuedLiveModelLaneV4 } from '../hosts/repository/reviewed-live-model-v4.mjs';
import { readIssuedLiveModelLaneV3 } from '../hosts/repository/reviewed-live-model-v3.mjs';
import { selection, payload, seed, deferred, tick } from './helpers/live-model-v3-fixture.mjs';
async function context({ api = 'NATIVE_API', reviewerApi = api, arm = 'ON', variant = 'repair', now = () => 100, onRequest, configure = () => {} } = {}) {
  const fixture = await createReviewedLiveFixtureV1(), requests = [];
  const treatment = registerRepairGuidanceV1({ arm, api, binding: { taskFingerprint: fixture.preparations[0].taskFingerprint,
    baselineFingerprint: fixture.baseline.fingerprint, suiteFingerprint: fixture.suite.fingerprint,
    reviewedSourceFingerprint: fixture.reviewedSourceFingerprint } });
  const input = { suite: fixture.suite, reviewedSourceFingerprint: fixture.reviewedSourceFingerprint,
    author: selection('author', api), reviewer: selection('reviewer', reviewerApi), arm, treatment,
    timeoutMs: 1000, maxOutputTokens: 512, approval: { id: 'synthetic.approval', expiresAtMs: 10000 } };
  configure(input);
  const transport = role => async (_url, request) => {
    const body = JSON.parse(request.body), native = input[role].api === 'NATIVE_API', operation = role === 'author' ? 'repair' : 'review';
    const candidate = variant === 'third' ? { files: [{ path: 'retry-settings.mjs', content: 'throw Error("unreviewed")' }] }
      : { files: fixture.preparations[variant === 'baseline' ? 0 : 1].candidate.files };
    const output = role === 'reviewer' ? { findings: [], summary: 'Synthetic review' }
      : { status: variant === 'no-change' ? 'NO_CHANGE' : 'REPAIRED', candidate: variant === 'no-change' ? null : candidate, note: 'Synthetic response' };
    const result = native ? { model_instance_id: input[role].expectedModelInstance, output: [{ type: 'message', content: JSON.stringify(output) }],
      stats: { input_tokens: 10, total_output_tokens: 5, reasoning_output_tokens: 0, tokens_per_second: 10, time_to_first_token_seconds: 0.1 } }
      : { model: body.model, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
    const captured = { role, body, request, operation }; requests.push(captured);
    return onRequest ? onRequest(captured, result) : new Response(JSON.stringify(result));
  };
  const transports = { author: transport('author'), reviewer: transport('reviewer') }, lane = create(input, transports, now);
  const run = () => runWorkflow(fixture.task, { adapters: { authorizeContext: lane.authorizeContext,
    author: lane.author, reviewers: lane.reviewers,
    staticChecks: { check: p => ({ status: 'PASS', evidence: { ...p.binding, findings: [], reason: '' } }) },
    tests: { run: p => {
      const pass = p.binding.candidateFingerprint === fixture.preparations[1].candidateFingerprint;
      return { status: pass ? 'PASS' : 'FAIL', evidence: { ...p.binding, assertionsExecuted: 1, assertionsPassed: pass ? 1 : 0,
        failures: pass ? [] : [{ code: 'SYNTHETIC', message: 'Synthetic baseline failure' }], reason: pass ? '' : 'Synthetic failure' } };
    } },
  } });
  return { fixture, input, treatment, requests, transports, lane, run };
}
for (const api of ['CHAT_COMPLETIONS', 'NATIVE_API']) {
  test(`${api}: V4 arms differ only in repair guidance; reviewer bytes and candidate checks match`, async () => {
    const off = await context({ api, arm: 'OFF' }), on = await context({ api, arm: 'ON' });
    for (const c of [off, on]) {
      const repaired = await c.lane.author.repair(seed(c));
      assert.equal(repaired.evidence.candidateFingerprint, c.fixture.preparations[1].candidateFingerprint);
      await c.lane.reviewers[0].review(payload(c.fixture, { candidate: c.fixture.preparations[1].candidate }));
      const snap = c.lane.snapshot(); assert.equal(snap.phase, 'REVIEWED'); assert.equal(snap.authorizing, false);
      assert.equal(snap.authorReceipts[0].treatment.treatmentFingerprint, c.treatment.fingerprint);
      assert(!Object.hasOwn(snap.reviewerReceipts[0], 'treatment'));
      assert.equal(readIssuedLiveModelLaneV4(c.lane).treatment, c.treatment);
      assert.throws(() => readIssuedLiveModelLaneV3(c.lane), { code: 'LIVE_LANE_NOT_ISSUED' });
    }
    const a = structuredClone(off.requests[0].body), b = structuredClone(on.requests[0].body);
    if (api === 'NATIVE_API') { assert.equal(b.system_prompt, a.system_prompt + on.treatment.suffix); b.system_prompt = a.system_prompt; }
    else { assert.equal(b.messages[0].content, a.messages[0].content + on.treatment.suffix); b.messages[0].content = a.messages[0].content; }
    assert.deepEqual(b, a); assert.equal(on.requests[1].request.body, off.requests[1].request.body);
    assert.deepEqual(on.input.author, off.input.author); assert.deepEqual(on.input.reviewer, off.input.reviewer);
    assert.equal(on.treatment.binding.taskFingerprint, off.treatment.binding.taskFingerprint);
  });
  for (const arm of ['OFF', 'ON']) for (const variant of ['repair', 'baseline', 'no-change', 'third'])
    test(`${api}/${arm}: ${variant} has identical population and workflow stopping rules`, async () => {
      const c = await context({ api, arm, variant }), report = await c.run(), snap = c.lane.snapshot();
      if (variant === 'repair') {
        assert.equal(report.outcome, 'COMPLETED'); assert.equal(c.requests.length, 2); assert.equal(snap.phase, 'REVIEWED');
      } else if (variant === 'third') {
        assert.notEqual(report.outcome, 'COMPLETED'); assert.equal(snap.events.at(-1).code, 'LIVE_REPAIR_NOT_REGISTERED');
        assert.equal(c.requests.length, 1); assert.equal(snap.reviewerReceipts.length, 0);
      } else {
        assert.equal(report.outcome, 'NO_PROGRESS'); assert.equal(snap.phase, 'NO_PROGRESS');
        assert.equal(report.candidateFingerprint, c.fixture.preparations[0].candidateFingerprint);
        assert.equal(snap.authorReceipts.length, 1); assert.equal(snap.authorReceipts[0].status, 'RESPONSE_VALIDATED');
        assert.equal(snap.reviewerReceipts.length, 0); assert.equal(c.requests.length, 1);
      }
      assert.equal(snap.authorReceipts[0].treatment.arm, arm); assert.equal(snap.authorReceipts[0].treatment.modelUseAttested, false);
      await Promise.all(c.lane.executionOwners().map(owner => owner.settled()));
    });
}
for (const api of ['NATIVE_API', 'CHAT_COMPLETIONS'])
test(`${api}: V4 supports a reviewer on the other protocol without treatment leakage`, async () => {
  const c = await context({ api, reviewerApi: api === 'NATIVE_API' ? 'CHAT_COMPLETIONS' : 'NATIVE_API' });
  assert.equal((await c.run()).outcome, 'COMPLETED'); assert.equal(c.requests.length, 2);
  const snap = c.lane.snapshot(); assert(Object.hasOwn(snap.authorReceipts[0], 'treatment'));
  assert(!Object.hasOwn(snap.reviewerReceipts[0], 'treatment'));
  assert.equal(snap.reviewerReceipts[0].schemaVersion, api === 'NATIVE_API' ? 2 : 'nisi-native-chat-receipt-v1');
});
test('V4 rejects swapped arms, unissued treatment and every changed source binding before transport', async () => {
  const c = await context(); let requests = 0; const transport = () => { requests++; throw Error('unexpected'); };
  const transports = { author: transport, reviewer: transport };
  assert.throws(() => create({ ...c.input, arm: 'OFF' }, transports), { code: 'LIVE_TREATMENT_ARM' });
  assert.throws(() => create({ ...c.input, treatment: structuredClone(c.treatment) }, transports), { code: 'GUIDANCE_NOT_ISSUED' });
  for (const key of Object.keys(c.treatment.binding)) {
    const treatment = registerRepairGuidanceV1({ api: 'NATIVE_API', arm: 'ON', binding: { ...c.treatment.binding, [key]: '0'.repeat(64) } });
    assert.throws(() => create({ ...c.input, treatment }, transports), { code: 'LIVE_TREATMENT_BINDING' });
  }
  assert.equal(requests, 0);
});
test('V4 snapshots selection and refuses expired approval, unknown input and review after no progress', async () => {
  let clock = 100; const c = await context({ now: () => clock }); const p = seed(c);
  c.input.arm = 'OFF'; c.input.approval.expiresAtMs = 50000; clock = 10000;
  await assert.rejects(c.lane.author.repair(p), { code: 'LIVE_APPROVAL_EXPIRED' }); assert.equal(c.requests.length, 0);
  const d = await context(); const raw = seed(d); raw.candidate = { ...raw.candidate, files: [{ path: 'retry-settings.mjs', content: 'other' }] };
  await assert.rejects(d.lane.author.repair(raw), { code: 'LIVE_CANDIDATE_MISMATCH' }); assert.equal(d.requests.length, 0);
  const e = await context({ variant: 'no-change' }); await e.lane.author.repair(seed(e));
  await assert.rejects(e.lane.reviewers[0].review(payload(e.fixture)), { code: 'LIVE_STAGE_ORDER' }); assert.equal(e.requests.length, 1);
});
test('V4 revoke waits on original transport; late response never advances stage', async () => {
  const pending = deferred(), entered = deferred();
  const c = await context({ onRequest: () => { entered.resolve(); return pending.promise; } });
  const run = c.lane.author.repair(seed(c)); let joined = false;
  try {
    await entered.promise; c.lane.revoke(); await assert.rejects(run);
    const joins = Promise.all(c.lane.executionOwners().map(owner => owner.settled())).then(() => { joined = true; });
    await tick(); assert.equal(joined, false); assert.equal(c.lane.snapshot().lifecycle.pendingTransports, 1);
    pending.resolve(new Response('{}')); await joins; assert.equal(joined, true);
  } finally { pending.resolve(new Response('{}')); await Promise.allSettled([run]); await Promise.all(c.lane.executionOwners().map(owner => owner.settled())); }
  assert.equal(c.lane.snapshot().phase, 'FAILED'); assert.equal(c.lane.snapshot().lifecycle.recoveryRequired, true);
});
