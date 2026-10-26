import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createPairedTrialRunnerV1 } from '../evaluation/paired-trial-runner-v1.mjs';
import { readPreventionExperimentPlanV1 } from '../evaluation/prevention-experiment-plan-v1.mjs';
import { reconcileTrialRetentionEventsV1 as reconcile } from '../history/paired-trial-reconciliation-v1.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const op = result => ({ result: Promise.resolve(result), settled: Promise.resolve(), status: () => 'IDLE', cancel() {} });
async function trace(options = {}) {
  const events = [];
  const plan = { schemaVersion: 'nisi-prevention-experiment-plan-v1', planId: 'plan.reconcile',
    policy: { version: 'policy.v1', sha256: hash('policy'), influenceEnabled: false }, proposer: 'author', acceptanceReviewer: 'reviewer',
    trainingDigests: [], tasks: [{ caseId: 'case.one', taskSha256: hash('task'), baselineSha256: hash('baseline'), oracleSha256: hash('oracle'),
      armOrder: ['OFF_ON', 'ON_OFF'] }], repetitions: 2, exclusions: [],
    budget: { maxDurationMs: 10000, maxModelCalls: 100, maxInputTokens: 1000, maxOutputTokens: 1000 }, measuredTelemetry: 'UNKNOWN_UNTIL_RUN' };
  const profile = { schemaVersion: 'nisi-prevention-execution-profile-v1', planSha256: readPreventionExperimentPlanV1(plan).planSha256,
    model: 'fixed-fixture', modelSettingsSha256: hash('settings'), toolchainSha256: hash('node'), resourceBudgetSha256: hash('budget'),
    trialPolicy: { version: plan.policy.version, sha256: plan.policy.sha256 }, executorTimeoutMs: 500,
    oracleTimeoutMs: 500, retentionTimeoutMs: 500, drainTimeoutMs: 10 };
  const runner = createPairedTrialRunnerV1({ plan, profile, host: {
    retain: value => { events.push(value); return Promise.resolve(); },
    verifyInputs: () => !(options.refuseAfterIntent && events.at(-1).type === 'START_INTENT'),
    startExecutor: intent => op({ requestId: intent.requestId, profileSha256: intent.profileSha256, candidateText: 'ok', candidateSha256: hash('ok'),
      completionClaim: true, tokenUsage: options.unknownUsage ? null : { input: 0, output: 0 }, modelCalls: 0, durationMs: null, repairAttempts: 0 }),
    startOracle: request => op({ requestId: request.requestId, oracleSha256: request.oracleSha256,
      oracleCandidateSha256: request.candidateSha256, outcome: 'PASS' })
  } });
  const run = await runner.run(); return { events: structuredClone(events), run };
}

test('full actual-runner trace reconciles, preserves original cases and grants no execution authority', async () => {
  const { events } = await trace(), result = reconcile({ events, byteStatus: 'FINAL_PRESENT' });
  assert.equal(result.status, 'FINAL_CONSISTENT'); assert.equal(result.counts.planned, 4);
  assert.equal(result.counts.startIntents, 4); assert.equal(result.counts.uniqueTasks, 1);
  assert.equal(result.batches.length, 2); assert.equal(result.batches[1].pairedRows.pairs[0].caseId, 'case.one');
  assert.equal(result.actualDispatchCount, null); assert.equal(result.durabilityAcknowledgement, 'UNKNOWN');
  assert.equal(result.measurementVerified, false); assert.equal(result.resumable, false); assert.equal(result.authorizing, false);
});

test('every interruption boundary preserves the full declared denominator without retry', async () => {
  const { events } = await trace();
  for (let length = 1; length < events.length; length++) {
    const result = reconcile({ events: events.slice(0, length), byteStatus: 'INCOMPLETE' });
    assert.equal(result.status, 'INTERRUPTED', `prefix ${length}`); assert.equal(result.counts.planned, 4);
    assert.equal(result.actualDispatchCount, null); assert.equal(result.resumable, false);
  }
  const onlyIntent = reconcile({ events: events.slice(0, 2), byteStatus: 'INCOMPLETE' });
  assert.equal(onlyIntent.rows[0].observedState, 'EXECUTION_UNKNOWN'); assert.equal(onlyIntent.batches[0].pairedRows, null);
});

test('semantically forged but byte-rehashable candidate, request, phase and declaration bindings refuse', async () => {
  const original = (await trace()).events;
  const mutations = [
    e => { e[0].runnerId += '\n'; }, e => { e[0].plan.policy.influenceEnabled = true; },
    e => { e[0].profile.model = 'changed'; }, e => { e[0].intents[0].arm = 'ON'; },
    e => { e[1].requestId = e[0].intents[1].requestId; }, e => { e[1].phase = 'ORACLE'; },
    e => { e[2].result.profileSha256 = hash('stale'); }, e => { e[2].observation.ownerStatus = 'BUSY'; },
    e => { e[4].result.oracleCandidateSha256 = hash('stale'); }, e => { e[4].result.oracleSha256 = hash('stale'); },
    e => { e[4].result.outcome = 'CERTIFIED'; }, e => { e[2].result.tokenUsage.input = -1; },
    e => { e.splice(2, 1); }, e => { [e[1], e[5]] = [e[5], e[1]]; },
    e => { e.at(-1).states[0].status = 'NOT_STARTED'; }, e => { e.at(-1).states.pop(); },
    e => { e.push(e[1]); }, e => { e[2].result.candidateText = 'raw'; }
  ];
  for (const mutate of mutations) {
    const events = structuredClone(original); mutate(events);
    assert.equal(reconcile({ events, byteStatus: 'FINAL_PRESENT' }).status, 'REFUSED');
  }
});

test('unknown-budget stop and refused dispatch are consistent adverse finals, not invented failures', async () => {
  for (const options of [{ unknownUsage: true }, { refuseAfterIntent: true }]) {
    const { events, run } = await trace(options), result = reconcile({ events, byteStatus: 'FINAL_PRESENT' });
    assert.equal(run.status, 'STOPPED'); assert.equal(result.status, 'FINAL_CONSISTENT');
    assert.equal(result.finalStopReason, run.stopReason); assert.equal(result.counts.planned, 4);
    assert.equal(result.actualDispatchCount, null); assert.equal(result.authorizing, false);
  }
});

test('continuing after unconfirmed usage is rejected even if all later hashes are recomputed', async () => {
  const { events } = await trace(); events[2].result.tokenUsage = null;
  assert.equal(reconcile({ events, byteStatus: 'FINAL_PRESENT' }).status, 'REFUSED');
});

test('partial/corrupt byte tails never become a complete experiment merely because FINAL is in the prefix', async () => {
  const { events } = await trace();
  for (const byteStatus of ['CORRUPT', 'PARTIAL_TAIL']) assert.equal(reconcile({ events, byteStatus }).status, 'INTERRUPTED');
  assert.equal(reconcile({ events: events.slice(0, -1), byteStatus: 'FINAL_PRESENT' }).status, 'REFUSED');
  assert.equal(reconcile({ events, byteStatus: 'INCOMPLETE' }).status, 'REFUSED');
});

test('FINAL cannot erase an intent-only unknown slot by claiming completed', async () => {
  const { events } = await trace(), shortened = [events[0], events[1], events.at(-1)];
  assert.equal(reconcile({ events: shortened, byteStatus: 'FINAL_PRESENT' }).status, 'REFUSED');
});

test('reported durations cannot establish wall-clock budget compliance on restart', async () => {
  const { events } = await trace();
  events[2].result.durationMs = 999999999;
  const result = reconcile({ events, byteStatus: 'FINAL_PRESENT' });
  assert.equal(result.status, 'FINAL_CONSISTENT');
  assert.equal(result.durationBudgetReconciliation, 'NOT_RECONCILABLE_FROM_RETAINED_EVENTS');
  assert.equal(result.measurementVerified, false); assert.equal(result.authorizing, false);
});

test('unvalidated FINAL drain payload cannot prove provider stop or authorize resume', async () => {
  const { events, run } = await trace({ unknownUsage: true });
  events.at(-1).drain = { status: 'OFF', safeToResume: true, anything: 'unvalidated' };
  const result = reconcile({ events, byteStatus: 'FINAL_PRESENT' });
  assert.equal(result.status, 'FINAL_CONSISTENT'); assert.equal(result.finalStopReason, run.stopReason);
  assert.equal(result.drainSemantics, 'NOT_VALIDATED'); assert.equal(result.remoteExecutionStopped, 'UNKNOWN');
  assert.equal(result.resumable, false); assert.equal(result.authorizing, false);
});

test('consistent candidate hashes are not a revalidation of absent candidate bytes', async () => {
  const { events } = await trace(), forged = hash('not-the-real-candidate');
  events[2].result.candidateSha256 = forged; events[4].result.oracleCandidateSha256 = forged;
  const result = reconcile({ events, byteStatus: 'FINAL_PRESENT' });
  assert.equal(result.status, 'FINAL_CONSISTENT'); assert.equal(result.candidateBytesRevalidated, false);
  assert.equal(result.measurementVerified, false); assert.equal(result.causalClaim, false);
  assert.equal(result.promotionEligible, false); assert.equal(result.authorizing, false);
});

test('wrong oracle candidate binding is refused before both arms can form a pair', async () => {
  const { events } = await trace(), firstArm = events.slice(0, 5);
  assert.equal(reconcile({ events: firstArm, byteStatus: 'INCOMPLETE' }).status, 'INTERRUPTED');
  firstArm[4].result.oracleCandidateSha256 = hash('another-candidate');
  assert.equal(reconcile({ events: firstArm, byteStatus: 'INCOMPLETE' }).status, 'REFUSED');
});
