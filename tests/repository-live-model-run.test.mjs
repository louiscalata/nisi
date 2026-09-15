// PRIVATE portable contract tests: actual engine, injected HTTP and synthetic issued process records.
// No native process or model inference occurs. Hashes are consistency, not attestation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepositoryLiveModelRunV1 as create, readRepositoryLiveModelRunV1 as read } from '../receipts/repository-live-model-run-v1.mjs';
import { repositoryLiveContext, rebindHostReport } from './helpers/repository-live-run-fixture.mjs';
import { reply } from './helpers/reviewed-live-model-fixture.mjs';
import { sha256Text, stableStringify, cloneFreeze } from '../workflow/contracts.mjs';

const run = async (t, options) => (await repositoryLiveContext(t, options)).run();
const hostContext = (c, patch) => ({ lane: c.lane, hostResult: { ...c.hostResult, ...patch } });
const refusal = (fn, code) => assert.throws(fn, error => typeof error?.code === 'string' && (!code || error.code === code));
const changeEnvelope = change => ({ onRequest(call) { change(call.envelope, call); return reply(call.envelope); } });

test('issued synthetic host plus model lane yields synthetic contract pass and complete exact usage', async t => {
  const c = await run(t), r = create(c.context);
  assert.equal(c.hostResult.report.outcome, 'COMPLETED'); assert.equal(c.hostResult.report.repairAttempts, 1);
  assert.equal(c.hostResult.state, 'SETTLED'); assert.equal(c.hostResult.bundleError, null);
  assert.equal(c.staticHistory.length, 2); assert.equal(c.testHistory.length, 2);
  assert.deepEqual(c.testHistory.map(h => h.execution.receipt.result.status), ['FAIL', 'PASS']);
  assert.equal(r.schemaVersion, 'nisi-repository-live-model-run-v1'); assert.equal(r.status, 'SYNTHETIC_CONTRACT_PASS');
  assert.deepEqual(r.reasons, []); assert.equal(r.lane.configuration.transportKind, 'INJECTED_TEST_TRANSPORT');
  assert.equal(r.lane.phase, 'REVIEWED'); assert.equal(c.requests.length, 2);
  assert.deepEqual(c.requests.map(call => call.operation), ['repair', 'review']);
  assert.equal(r.runId, c.hostResult.report.runId);
  assert.equal(r.finalCandidateFingerprint, c.fixture.preparations[1].candidateFingerprint);
  assert.equal(r.repositoryBundleFingerprint, c.hostResult.bundle.fingerprint);
  assert.equal(r.reportSha256, c.hostResult.bundle.reportSha256);
  assert.deepEqual(r.usage, cloneFreeze({ calls: 2, knownCalls: 2, unknownCalls: 0,
    totals: { promptTokens: 70, completionTokens: 15, totalTokens: 85 }, knownSubtotal: { promptTokens: 70, completionTokens: 15, totalTokens: 85 }, complete: true }));
  for (const key of ['hostSeedInference','modelAuthenticityAttested','executionAttested','causalClaim','authorizing','certificationGranted','publicationAuthorized']) assert.equal(r[key], false);
  const { fingerprint, ...body } = r;
  assert.equal(fingerprint, sha256Text('nisi/repository-live-model-run/v1\0' + stableStringify(body)));
  assert.deepEqual(read(r, c.context), r);
});

test('serialized receipt is inspectable with original context and returned records are deeply frozen', async t => {
  const c = await run(t), r = create(c.context), serialized = JSON.parse(JSON.stringify(r));
  assert.deepEqual(read(serialized, c.context), r);
  const inspect = value => { if (value && typeof value === 'object') { assert(Object.isFrozen(value)); for (const child of Object.values(value)) inspect(child); } };
  inspect(r); assert.throws(() => { r.lane.events[0].status = 'FAIL'; }, TypeError);
  assert.throws(() => { r.usage.totals.totalTokens = 0; }, TypeError);
});

test('unknown usage preserves quality result but supplies no aggregate or fabricated zero', async t => {
  const c = await run(t, changeEnvelope((envelope, call) => { if (call.operation === 'repair') delete envelope.usage; })), r = create(c.context);
  assert.equal(r.status, 'SYNTHETIC_CONTRACT_PASS'); assert.deepEqual(r.reasons, []);
  assert.equal(r.usage.complete, false); assert.equal(r.usage.totals, null);
  assert.equal(r.usage.knownCalls, 1); assert.equal(r.usage.unknownCalls, 1);
  assert.deepEqual({ ...r.usage.knownSubtotal }, { promptTokens: 30, completionTokens: 5, totalTokens: 35 });
  assert.equal(r.lane.authorReceipts[0].usage, null); assert.equal(r.causalClaim, false);
});

test('both unknown usage records remain unknown with an explicit empty known subtotal', async t => {
  const c = await run(t, changeEnvelope(envelope => { delete envelope.usage; })), r = create(c.context);
  assert.equal(r.status, 'SYNTHETIC_CONTRACT_PASS'); assert.equal(r.usage.totals, null);
  assert.equal(r.usage.complete, false); assert.equal(r.usage.unknownCalls, 2); assert.equal(r.usage.knownCalls, 0);
  assert.deepEqual({ ...r.usage.knownSubtotal }, { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
});

test('invalid model response produces incomplete receipt with retained refusal and no reviewer call', async t => {
  const c = await run(t, changeEnvelope(envelope => { envelope.choices[0].finish_reason = 'length'; })), r = create(c.context);
  assert.equal(r.status, 'INCOMPLETE'); assert.equal(c.requests.length, 1);
  assert(r.reasons.includes('MODEL_RESPONSE_UNAVAILABLE')); assert(r.reasons.includes('MODEL_INVENTORY_INCOMPLETE'));
  assert.equal(r.lane.authorReceipts[0].code, 'LOCAL_CHAT_FINISH_REFUSED');
  assert.equal(r.lane.reviewerReceipts.length, 0); assert.equal(c.hostResult.proposedChanges, null);
});

test('valid but unregistered repair is retained without fresh execution or accepted proposal', async t => {
  const c = await run(t, changeEnvelope((envelope, call) => {
    if (call.operation === 'repair') {
      const content = JSON.parse(envelope.choices[0].message.content);
      content.candidate.files[0].content += '\n// unregistered change\n';
      envelope.choices[0].message.content = JSON.stringify(content);
    }
  })), r = create(c.context);
  assert.equal(r.status, 'INCOMPLETE'); assert(r.reasons.includes('MODEL_CANDIDATE_NOT_ADMITTED'));
  assert.equal(r.lane.authorReceipts[0].status, 'RESPONSE_VALIDATED');
  assert.equal(r.lane.events.at(-1).code, 'LIVE_REPAIR_NOT_REGISTERED');
  assert.equal(c.testHistory.length, 1); assert.equal(c.staticHistory.length, 1); assert.equal(c.requests.length, 1);
  assert.equal(c.hostResult.proposedChanges, null);
});

test('invalid model usage becomes a retained unavailable response rather than measured total', async t => {
  const c = await run(t, changeEnvelope(envelope => { envelope.usage.total_tokens++; })), r = create(c.context);
  assert.equal(r.status, 'INCOMPLETE'); assert.equal(r.lane.authorReceipts[0].code, 'LOCAL_CHAT_USAGE_INVALID');
  assert.equal(r.usage.totals, null); assert.equal(r.usage.unknownCalls, 1);
});

test('adverse reviewer findings remain incomplete and cannot produce a proposal', async t => {
  const c = await run(t, changeEnvelope((envelope, call) => { if (call.operation === 'review') envelope.choices[0].message.content = JSON.stringify({ findings: [{ code: 'SYNTHETIC_REVIEW', message: 'Review fixture finding' }], summary: 'Synthetic adverse review' }); })), r = create(c.context);
  assert.equal(r.status, 'INCOMPLETE'); assert(r.reasons.includes('REVIEW_NOT_RECORDED'));
  assert.equal(c.hostResult.report.outcome, 'REPAIR_LIMIT'); assert.equal(c.hostResult.proposedChanges, null);
  assert.equal(r.lane.reviewerReceipts[0].status, 'RESPONSE_VALIDATED');
});

for (const mode of ['snapshot', 'spread']) test('original lane identity is required: ' + mode, async t => {
  const c = await run(t), lane = mode === 'snapshot' ? JSON.parse(JSON.stringify(c.lane.snapshot())) : { ...c.lane };
  refusal(() => create({ lane, hostResult: c.hostResult }), 'LIVE_LANE_NOT_ISSUED');
});

test('serialized host histories cannot recreate issued static or Node records', async t => {
  const c = await run(t);
  refusal(() => create({ lane: c.lane, hostResult: JSON.parse(JSON.stringify(c.hostResult)) }));
});

test('a second issued lane cannot be substituted for the host run', async t => {
  const a = await run(t), b = await run(t);
  refusal(() => create({ lane: b.lane, hostResult: a.hostResult }), 'LIVE_RUN_BINDING');
});

for (const key of ['applied','sandboxed','authorizing','certificationGranted']) test('host claim is pinned false: ' + key, async t => {
  const c = await run(t); refusal(() => create(hostContext(c, { [key]: true })), 'LIVE_RUN_HOST_CLAIM');
});

test('host schema version and extra outer keys are rejected', async t => {
  const c = await run(t);
  refusal(() => create(hostContext(c, { schemaVersion: 'nisi-reviewed-repository-host-v2' })), 'LIVE_RUN_HOST_CLAIM');
  refusal(() => create(hostContext(c, { extra: true })), 'LIVE_RUN_HOST_SCHEMA');
  refusal(() => create({ ...c.context, extra: true }), 'LIVE_RUN_CONTEXT');
});

for (const key of ['settlementErrors','historyErrors','ownerStateErrors']) test('diagnostic inventory and unavailable state are distinct: ' + key, async t => {
  const c = await run(t);
  refusal(() => create(hostContext(c, { [key]: [] })), 'LIVE_RUN_HOST_DIAGNOSTICS');
  const r = create(hostContext(c, { [key]: [{ code: 'SYNTHETIC_UNAVAILABLE' }, null] }));
  assert.equal(r.status, 'INCOMPLETE'); assert(r.reasons.includes('HOST_DIAGNOSTICS_UNAVAILABLE'));
});

test('unsettled owner or missing bundle suppresses the quality pass', async t => {
  const c = await run(t);
  const pending = create(hostContext(c, { state: 'QUARANTINED', ownerStates: { staticChecks: 'IDLE', tests: 'QUARANTINED' } }));
  assert.equal(pending.status, 'INCOMPLETE'); assert(pending.reasons.includes('HOST_NOT_SETTLED'));
  const missing = create(hostContext(c, { bundle: null, bundleSummary: null, bundleError: { code: 'SYNTHETIC_MISSING' }, proposedChanges: null }));
  assert.equal(missing.status, 'INCOMPLETE'); assert(missing.reasons.includes('HOST_BUNDLE_UNAVAILABLE'));
});

for (const field of ['after', 'bundleFingerprint', 'reportSha256', 'fingerprint']) test('full host proposal recomputation detects changed ' + field, async t => {
  const c = await run(t), proposedChanges = structuredClone(c.hostResult.proposedChanges);
  if (field === 'after') proposedChanges.changes[0].after.content += 'tampered'; else proposedChanges[field] = '0'.repeat(64);
  refusal(() => create(hostContext(c, { proposedChanges })), 'LIVE_RUN_HOST_PROPOSAL');
});

test('tampered bundle fingerprint and summary cannot be substituted', async t => {
  const c = await run(t);
  refusal(() => create(hostContext(c, { bundle: { ...c.hostResult.bundle, fingerprint: '0'.repeat(64) } })), 'REPOSITORY_RUN_MISMATCH');
  refusal(() => create(hostContext(c, { bundleSummary: { ...c.hostResult.bundleSummary, recordedTestPasses: 100 } })), 'LIVE_RUN_HOST_SUMMARY');
});

test('report identities must still match the original issued lane', async t => {
  const c = await run(t);
  for (const patch of [{ runId: '11111111-1111-4111-8111-111111111111' }, { taskFingerprint: '0'.repeat(64) }]) {
    refusal(() => create(hostContext(c, { report: { ...c.hostResult.report, ...patch } })), 'LIVE_RUN_BINDING');
  }
});

test('changing the host seed claim remains incomplete even with newly consistent outer hashes', async t => {
  const c = await run(t), hostResult = rebindHostReport(c, report => { report.stages.find(s => s.stage === 'draft').evidence.note = 'Model drafted this candidate'; });
  refuseOrIncomplete({ lane: c.lane, hostResult });
});

for (const operation of ['repair','review']) test('exact returned ' + operation + ' evidence must be recorded even after outer rebinding', async t => {
  const c = await run(t), hostResult = rebindHostReport(c, report => {
    const s = report.stages.find(s => s.stage === operation);
    s.evidence[operation === 'repair' ? 'note' : 'summary'] = 'A substituted stage observation';
  });
  const r = create({ lane: c.lane, hostResult });
  assert.equal(r.status, 'INCOMPLETE'); assert(r.reasons.includes('MODEL_RESULT_NOT_RECORDED'));
});

for (const target of ['fingerprint','reportSha256','repositoryBundleFingerprint','status','scope','claim','stage','usage']) test('reader rejects record tamper: ' + target, async t => {
  const c = await run(t), r = structuredClone(create(c.context));
  if (['fingerprint','reportSha256','repositoryBundleFingerprint'].includes(target)) r[target] = '0'.repeat(64);
  else if (target === 'status') r.status = 'SCOPED_LIVE_REPAIR_REVIEW_PASS';
  else if (target === 'scope') r.lane.configuration.transportKind = 'LOOPBACK_HTTP';
  else if (target === 'claim') r.modelAuthenticityAttested = true;
  else if (target === 'stage') r.lane.events.reverse();
  else r.usage.totals.totalTokens = 0;
  refusal(() => read(r, c.context), 'LIVE_RUN_RECORD_MISMATCH');
});

test('reader notices later lane revocation without rewriting an earlier record', async t => {
  const c = await run(t), r = create(c.context); c.lane.revoke();
  refusal(() => read(r, c.context), 'LIVE_RUN_RECORD_MISMATCH');
  const after = create(c.context); assert.equal(after.status, 'INCOMPLETE');
  assert(after.reasons.includes('MODEL_LANE_NOT_READY')); assert.equal(r.status, 'SYNTHETIC_CONTRACT_PASS');
});

const refuseOrIncomplete = context => {
  let result;
  try { result = create(context); }
  catch (error) { assert.equal(typeof error?.code, 'string'); return; }
  assert.equal(result.status, 'INCOMPLETE', 'A structurally rehashed false workflow must not retain the quality-pass label');
};

test('regression: exact workflow topology and authorization outcome survive full outer rebinding', async t => {
  const mutations = {
    'review moved before repair': report => { const i = report.stages.findIndex(s => s.stage === 'review'), [review] = report.stages.splice(i, 1); report.stages.splice(report.stages.findIndex(s => s.stage === 'repair'), 0, review); },
    'review moved before baseline test': report => { const i = report.stages.findIndex(s => s.stage === 'review'), [review] = report.stages.splice(i, 1); report.stages.splice(report.stages.findIndex(s => s.stage === 'tests'), 0, review); },
    'authorization changed to FAIL': report => { report.stages.find(s => s.stage === 'authorizeContext').status = 'FAIL'; }
  };
  for (const [name, mutate] of Object.entries(mutations)) await t.test(name, async sub => {
    const c = await run(sub), hostResult = rebindHostReport(c, mutate);
    refuseOrIncomplete({ lane: c.lane, hostResult });
  });
});

test('regression: host-seed full evidence binding survives full outer rebinding', async t => {
  const mutations = {
    'missing draft runId': evidence => { delete evidence.runId; },
    'wrong draft runId': evidence => { evidence.runId = '11111111-1111-4111-8111-111111111111'; },
    'wrong draft taskFingerprint': evidence => { evidence.taskFingerprint = '0'.repeat(64); },
    'wrong draft attempt': evidence => { evidence.attempt = 1; }
  };
  for (const [name, mutate] of Object.entries(mutations)) await t.test(name, async sub => {
    const c = await run(sub), hostResult = rebindHostReport(c, report => { mutate(report.stages.find(s => s.stage === 'draft').evidence); });
    refuseOrIncomplete({ lane: c.lane, hostResult });
  });
});

test('regression: report task metadata must match its issued lane and retained task fingerprint', async t => {
  for (const [name, mutate] of Object.entries({
    'different taskId': report => { report.taskId = 'different.task'; },
    'review mode instead of edit': report => { report.mode = 'review'; }
  })) await t.test(name, async sub => {
    const c = await run(sub), hostResult = rebindHostReport(c, mutate);
    refuseOrIncomplete({ lane: c.lane, hostResult });
  });
});
