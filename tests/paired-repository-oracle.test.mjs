import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createCandidate } from '../workflow/contracts.mjs';
import { createReviewedRepositoryOracleV1, readIssuedRepositoryOracleV1 } from '../examples/repository-task/reviewed-oracle-fixture-v1.mjs';
import { createRepositoryTrialOracleV1 as create, createRepositoryTrialOracleWithDependenciesV1 as injected } from '../hosts/repository/paired-trial-oracle-v1.mjs';
import { encodeRepositoryTrialCandidateV1 } from '../evaluation/repository-trial-candidate-v1.mjs';
import { createPairedTrialRunnerV1 } from '../evaluation/paired-trial-runner-v1.mjs';
import { pairedTrialFixtureInputs } from './helpers/paired-trial-fixture.mjs';
import { readPreventionExperimentPlanV1 } from '../evaluation/prevention-experiment-plan-v1.mjs';
import { deferred, tick } from './helpers/live-model-v3-fixture.mjs';
async function context(t) {
  const registration = await createReviewedRepositoryOracleV1(), owned = readIssuedRepositoryOracleV1(registration);
  const parentRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nisi-oracle-test-'));
  t.after(() => fs.rm(parentRoot, { recursive: true, force: true }));
  const binding = { requestId: 'a'.repeat(64), profileSha256: 'b'.repeat(64), ...registration.workflow, oracleSha256: registration.oracleSha256 };
  const input = { registration, binding, parentRoot, materializationTimeoutMs: 10000, totalTimeoutMs: 10000, childTimeoutMs: 5000, closeGraceMs: 500 };
  const request = variant => { const e = encodeRepositoryTrialCandidateV1(owned.workflow.preparations[variant].candidate);
    return { requestId: binding.requestId, oracleSha256: binding.oracleSha256, candidateSha256: e.candidateSha256, candidateText: e.candidateText }; };
  return { registration, owned, parentRoot, binding, input, request };
}
test('REAL separate behavioral oracle rejects baseline and accepts repair with original Node evidence', async t => {
  const c = await context(t), records = [];
  for (const variant of [0, 1]) {
    const owner = create(c.input), request = c.request(variant), operation = owner.start(request);
    const result = await operation.result; await operation.settled; const view = owner.inspect();
    assert.equal(result.outcome, variant ? 'PASS' : 'FAIL'); assert.equal(result.oracleCandidateSha256, request.candidateSha256);
    assert.equal(result.requestId, request.requestId); assert.equal(result.oracleSha256, c.registration.oracleSha256);
    assert.equal(operation.status(), 'IDLE'); assert.equal(view.state, 'PUBLISHED');
    assert.equal(view.observation.assertionsExecuted, 17); assert.equal(view.observation.assertionsPassed, variant ? 17 : 15);
    assert.equal(view.observation.mapping.candidateSha256, request.candidateSha256);
    assert.equal(view.observation.independenceAttested, false); assert.equal(view.observation.authorizing, false);
    operation.cancel(); assert.deepEqual(owner.inspect(), view); records.push(view.observation);
    assert.throws(() => owner.start(request), { code: 'ORACLE_OWNER_CONSUMED' });
  }
  assert.notEqual(records[0].oracleRunId, records[1].oracleRunId);
  assert.notEqual(records[0].receiptSha256, records[1].receiptSha256);
});
test('source and oracle identity mismatches refuse before any adapter creation', async t => {
  const c = await context(t); let calls = 0;
  const deps = { createAdapter() { calls++; throw Error('should not start'); } };
  for (const key of ['taskSha256', 'baselineSha256', 'suiteFingerprint', 'reviewedSourceFingerprint', 'oracleSha256'])
    assert.throws(() => injected({ ...c.input, binding: { ...c.binding, [key]: '0'.repeat(64) } }, deps), { code: 'ORACLE_BINDING' });
  assert.throws(() => injected({ ...c.input, parentRoot: 'relative' }, deps), { code: 'ORACLE_OPTIONS' });
  assert.throws(() => injected({ ...c.input, registration: structuredClone(c.registration) }, deps), { code: 'ORACLE_NOT_ISSUED' });
  assert.equal(calls, 0); assert.deepEqual(await fs.readdir(c.parentRoot), []);
});
test('request mismatches unreviewed bytes and protected file candidates refuse without effects', async t => {
  const c = await context(t); let calls = 0;
  const owner = injected(c.input, { createAdapter() { calls++; throw Error('should not start'); } });
  for (const extra of [{ requestId: '0'.repeat(64) }, { oracleSha256: '0'.repeat(64) }])
    assert.throws(() => owner.start({ ...c.request(1), ...extra }), { code: 'ORACLE_REQUEST_BINDING' });
  assert.throws(() => owner.start({ ...c.request(1), candidateSha256: '0'.repeat(64) }), { code: 'TRIAL_CANDIDATE_TEXT_HASH' });
  for (const files of [[{ path: 'retry-settings.mjs', content: 'throw Error("UNREVIEWED")' }],
    [{ path: 'README.md', content: 'changed' }],
    [...c.owned.workflow.preparations[1].candidate.files, { path: 'extra.mjs', content: '' }]]) {
    const e = encodeRepositoryTrialCandidateV1(createCandidate({ files }, { authorId: 'test.oracle' }));
    assert.throws(() => owner.start({ ...c.request(1), candidateText: e.candidateText, candidateSha256: e.candidateSha256 }), { code: 'ORACLE_CANDIDATE_NOT_REVIEWED' });
  }
  assert.equal(calls, 0); assert.deepEqual(await fs.readdir(c.parentRoot), []);
});
test('immediate cancel prevents run invocation and joins original unused owner once', async t => {
  const c = await context(t); let runs = 0, joins = 0;
  const owner = injected(c.input, { createAdapter: () => ({ run() { runs++; return Promise.resolve(); },
    settled() { joins++; return Promise.resolve([]); }, status: () => 'IDLE' }) });
  const operation = owner.start(c.request(1)); operation.cancel(); operation.cancel();
  await assert.rejects(operation.result, { code: 'ORACLE_CANCELLED' }); await operation.settled;
  assert.equal(runs, 0); assert.equal(joins, 1); assert.equal(operation.status(), 'OFF'); assert.equal(owner.inspect().observation, null);
});
test('cancellation retains pending original run and settlement without early terminal credit', async t => {
  const c = await context(t), started = deferred(), runResult = deferred(), joined = deferred(); let joins = 0, state = 'BUSY';
  const owner = injected(c.input, { createAdapter: () => ({ run(payload) { started.resolve(payload); return runResult.promise; },
    settled() { joins++; return joined.promise; }, status: () => state }) });
  const operation = owner.start(c.request(1)), payload = await started.promise; let terminal = false;
  const tracking = Promise.allSettled([operation.result, operation.settled]).then(() => { terminal = true; });
  try {
    operation.cancel(); await tick(); assert(payload.signal.aborted); assert.equal(joins, 0); assert.equal(terminal, false);
    runResult.resolve({}); await tick(); assert.equal(joins, 1); assert.equal(terminal, false); assert.equal(operation.status(), 'BUSY');
  } finally { state = 'IDLE'; runResult.resolve({}); joined.resolve([]); await tracking; }
  await assert.rejects(operation.result, { code: 'ORACLE_CANCELLED' }); await operation.settled;
  assert.equal(operation.status(), 'OFF'); assert.equal(owner.inspect().observation, null);
});
for (const mode of ['run-throws', 'run-rejects', 'run-thenable', 'settlement-rejects', 'settlement-thenable', 'quarantine', 'fabricated-pass'])
test(`oracle ${mode} cannot publish a passing result`, async t => {
  const c = await context(t); let joins = 0;
  const owner = injected(c.input, { createAdapter: () => ({
    run() { if (mode === 'run-throws') throw 'PRIVATE_ERROR';
      if (mode === 'run-rejects') return Promise.reject('PRIVATE_ERROR');
      if (mode === 'run-thenable') return { then() {} }; return Promise.resolve({ status: 'PASS' }); },
    settled() { joins++; if (mode === 'settlement-rejects') return Promise.reject('PRIVATE_ERROR');
      if (mode === 'settlement-thenable') return { then() {} }; return Promise.resolve([]); },
    status: () => mode === 'quarantine' ? 'QUARANTINED' : 'IDLE',
  }) });
  const operation = owner.start(c.request(1)); const outcomes = await Promise.allSettled([operation.result, operation.settled]);
  assert.equal(outcomes[0].status, 'rejected'); assert(!outcomes[0].reason.message.includes('PRIVATE'));
  assert.equal(joins, 1); assert.equal(owner.inspect().observation, null);
  if (mode.startsWith('settlement') || mode === 'quarantine') { assert.equal(outcomes[1].status, 'rejected'); assert.equal(operation.status(), 'QUARANTINED'); }
  else { assert.equal(outcomes[1].status, 'fulfilled'); assert.equal(operation.status(), 'IDLE'); }
});
test('REAL oracle result is withheld if cancelled in the completion-to-publication gap', async t => {
  const c = await context(t), owner = create(c.input), originalThen = Promise.prototype.then;
  let operation, triggered = false;
  Promise.prototype.then = function(onFulfilled, onRejected) {
    return originalThen.call(this, value => {
      if (!triggered && value?.value?.oracleSha256 === c.registration.oracleSha256 && Object.hasOwn(value, 'resultError')) {
        triggered = true; operation.cancel();
      }
      return typeof onFulfilled === 'function' ? onFulfilled(value) : value;
    }, onRejected);
  };
  try {
    operation = owner.start(c.request(1)); await assert.rejects(operation.result, { code: 'ORACLE_CANCELLED' }); await operation.settled;
    assert.equal(triggered, true); assert.equal(owner.inspect().observation, null); assert.equal(operation.status(), 'OFF');
  } finally { Promise.prototype.then = originalThen; if (operation) await Promise.allSettled([operation.result, operation.settled]); }
});
test('REAL local oracle in paired runner counts a false completion claim without live-model metrics', async t => {
  const c = await context(t), { plan, profile } = pairedTrialFixtureInputs();
  Object.assign(plan.tasks[0], { taskSha256: c.binding.taskSha256, baselineSha256: c.binding.baselineSha256, oracleSha256: c.binding.oracleSha256 });
  profile.planSha256 = readPreventionExperimentPlanV1(plan).planSha256;
  let oracleOwner, pendingIntent, oracleStarts = 0; const events = [];
  const runner = createPairedTrialRunnerV1({ plan, profile, host: {
    verifyInputs(intent) { assert.equal(intent.oracleSha256, c.registration.oracleSha256); return true; },
    retain: async e => { events.push(e); },
    startExecutor(intent) {
      pendingIntent = intent; const request = c.request(0);
      return { result: Promise.resolve({ requestId: intent.requestId, profileSha256: intent.profileSha256,
        candidateText: request.candidateText, candidateSha256: request.candidateSha256, completionClaim: true,
        tokenUsage: null, durationMs: null, repairAttempts: 0, modelCalls: null }),
      settled: Promise.resolve(), status: () => 'IDLE', cancel() {} };
    },
    startOracle(request) { oracleStarts++; oracleOwner = create({ ...c.input,
      binding: { ...c.binding, requestId: pendingIntent.requestId, profileSha256: pendingIntent.profileSha256 } });
      return oracleOwner.start(request); },
  } });
  const result = await runner.run(); assert.equal(oracleStarts, 1);
  assert.equal(result.records[0].oracle.outcome, 'FAIL'); assert.equal(result.counts.incorrectClaims, 1);
  assert.equal(result.records[0].executor.tokenUsage, null); assert.equal(result.authorizing, false);
  assert.equal(oracleOwner.inspect().observation.assertionsPassed, 15); assert.equal(events.at(-1).type, 'FINAL');
});
