// PRIVATE read-only semantic reconciliation. Records describe trusted-host
// statements, never prove provider truth, acknowledgement delivery or authority.
// An intent cannot distinguish death before dispatch from death after dispatch.
import { cloneFreeze, stableStringify, sha256Text } from '../workflow/contracts.mjs';
import { list, record, natural } from '../evaluation/intake-v1.mjs';
import { readPreventionExperimentPlanV1 } from '../evaluation/prevention-experiment-plan-v1.mjs';
import { readPreventionExecutionProfileV1, digest } from '../evaluation/prevention-execution-profile-v1.mjs';
import { validatePairedTrialRowsV1 } from '../evaluation/paired-trial-v1.mjs';
import { readTrialRetentionEventV1, TRIAL_EVENT_LIMITS, failTrialStore as fail } from './paired-trial-event-codec-v1.mjs';
import { inspectPairedTrialEventStoreV1 } from './paired-trial-event-store-v1.mjs';

const planFields = ['schemaVersion', 'planId', 'policy', 'proposer', 'acceptanceReviewer', 'trainingDigests',
  'tasks', 'repetitions', 'exclusions', 'budget', 'measuredTelemetry'];
const profileFields = ['schemaVersion', 'planSha256', 'model', 'modelSettingsSha256', 'toolchainSha256',
  'resourceBudgetSha256', 'trialPolicy', 'executorTimeoutMs', 'oracleTimeoutMs', 'retentionTimeoutMs', 'drainTimeoutMs'];
const pick = (object, keys) => Object.fromEntries(keys.map(key => [key, object[key]]));
const equal = (a, b) => stableStringify(a) === stableStringify(b);
const phases = ['EXECUTOR_START', 'EXECUTOR_RESULT', 'ORACLE_START', 'ORACLE_RESULT'];
const reason = value => value === null || (typeof value === 'string' && value.length <= 128 && /^[A-Z][A-Z0-9_]+$/u.exec(value)?.[0] === value);

function readSchedule(event) {
  if (event.type !== 'SCHEDULE' || event.sequence !== 0 || typeof event.runnerId !== 'string' ||
      event.runnerId.length !== 36 ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(event.runnerId)) fail('TRIAL_RECONCILE_SCHEDULE');
  const plan = readPreventionExperimentPlanV1(pick(event.plan, planFields));
  const profile = readPreventionExecutionProfileV1(pick(event.profile, profileFields), plan.planSha256, plan.policy);
  if (!equal(plan, event.plan) || !equal(profile, event.profile)) fail('TRIAL_RECONCILE_DECLARATION');
  const expected = [];
  for (let repetition = 0; repetition < plan.repetitions; repetition++) for (const task of plan.tasks) {
    for (const arm of task.armOrder[repetition].split('_')) {
      const requestId = sha256Text(JSON.stringify([event.runnerId, plan.planSha256, profile.profileSha256, task.caseId, repetition, arm]));
      expected.push({ requestId, runId: `run-${requestId}`, runnerId: event.runnerId,
        planSha256: plan.planSha256, profileSha256: profile.profileSha256, caseId: task.caseId, repetition, arm,
        taskSha256: task.taskSha256, baselineSha256: task.baselineSha256, oracleSha256: task.oracleSha256,
        model: profile.model, modelSettingsSha256: profile.modelSettingsSha256, toolchainSha256: profile.toolchainSha256,
        resourceBudgetSha256: profile.resourceBudgetSha256, policyMode: arm === 'ON' ? 'ISOLATED_TRIAL' : 'OFF',
        trialPolicy: arm === 'ON' ? profile.trialPolicy : null });
    }
  }
  const supplied = list(event.intents, expected.length, expected.length);
  if (!equal(expected, supplied)) fail('TRIAL_RECONCILE_INTENTS');
  return { plan, profile, intents: expected };
}
function observation(input) {
  const value = record(input, ['resultSettlement', 'ownerSettlement', 'ownerStatus', 'deadline']);
  if (value.resultSettlement !== 'FULFILLED' || value.ownerSettlement !== 'FULFILLED' ||
      !['IDLE', 'OFF'].includes(value.ownerStatus) || value.deadline !== 'WITHIN_OBSERVATION_WINDOW') fail('TRIAL_RECONCILE_SETTLEMENT');
}
function executor(input, intent) {
  const value = record(input, ['requestId', 'profileSha256', 'candidateSha256', 'completionClaim',
    'tokenUsage', 'durationMs', 'repairAttempts', 'modelCalls']);
  if (value.requestId !== intent.requestId || value.profileSha256 !== intent.profileSha256) fail('TRIAL_RECONCILE_EXECUTOR');
  digest(value.candidateSha256);
  if (typeof value.completionClaim !== 'boolean') fail('TRIAL_RECONCILE_CLAIM');
  if (value.tokenUsage !== null) {
    value.tokenUsage = record(value.tokenUsage, ['input', 'output']); natural(value.tokenUsage.input); natural(value.tokenUsage.output);
  }
  for (const key of ['durationMs', 'repairAttempts', 'modelCalls']) if (value[key] !== null) natural(value[key]);
  return value;
}
function oracle(input, intent, previous) {
  const value = record(input, ['requestId', 'oracleSha256', 'oracleCandidateSha256', 'outcome']);
  if (value.requestId !== intent.requestId || value.oracleSha256 !== intent.oracleSha256 ||
      value.oracleCandidateSha256 !== previous.candidateSha256 || !['PASS', 'FAIL', 'ERROR', 'INCONCLUSIVE'].includes(value.outcome)) fail('TRIAL_RECONCILE_ORACLE');
  return value;
}
function buildBatches(plan, profile, rows) {
  return Array.from({ length: plan.repetitions }, (_, repetition) => {
    const lookup = new Map(rows.filter(r => r.intent.repetition === repetition).map(r => [`${r.intent.caseId}/${r.intent.arm}`, r]));
    const pairs = [], unpaired = [];
    for (const task of plan.tasks) {
      const off = lookup.get(`${task.caseId}/OFF`), on = lookup.get(`${task.caseId}/ON`);
      if (off.phaseCount !== 4 || on.phaseCount !== 4) { unpaired.push(task.caseId); continue; }
      const side = row => ({ runId: row.intent.runId, model: profile.model, modelSettingsSha256: profile.modelSettingsSha256,
        toolchainSha256: profile.toolchainSha256, resourceBudgetSha256: profile.resourceBudgetSha256,
        candidateSha256: row.executor.candidateSha256, oracleCandidateSha256: row.oracle.oracleCandidateSha256,
        outcome: row.oracle.outcome, completionClaim: row.executor.completionClaim, tokenUsage: row.executor.tokenUsage,
        durationMs: row.executor.durationMs, repairAttempts: row.executor.repairAttempts });
      pairs.push({ caseId: task.caseId, taskSha256: task.taskSha256, baselineSha256: task.baselineSha256,
        oracleSha256: task.oracleSha256, off: side(off), on: side(on) });
    }
    const pairedRows = pairs.length ? { schemaVersion: 'nisi-paired-trial-v1', pairs } : null;
    if (pairedRows) validatePairedTrialRowsV1(pairedRows);
    return { repetition, pairedRows, unpaired };
  });
}

export function reconcileTrialRetentionEventsV1(input) {
  try {
    const { events: raw, byteStatus } = record(input, ['events', 'byteStatus']);
    if (!['FINAL_PRESENT', 'INCOMPLETE', 'PARTIAL_TAIL', 'CORRUPT'].includes(byteStatus)) fail('TRIAL_RECONCILE_BYTES');
    const events = list(raw, 1, TRIAL_EVENT_LIMITS.maxEvents).map(readTrialRetentionEventV1);
    const { plan, profile, intents } = readSchedule(events[0]);
    const rows = intents.map(intent => ({ intent, phaseCount: 0, observedState: 'NO_START_INTENT', executor: null, oracle: null, declaredFinal: null }));
    let slot = 0, phase = 0, final = null, lastSequence = 0;
    const totals = { modelCalls: 0n, input: 0n, output: 0n }; let usageUnknown = false;
    for (const event of events.slice(1)) {
      if (event.sequence <= lastSequence || final) fail('TRIAL_RECONCILE_SEQUENCE'); lastSequence = event.sequence;
      if (event.type === 'FINAL') {
        if (!reason(event.stopReason) || (event.stopReason === null && event.drain !== null)) fail('TRIAL_RECONCILE_FINAL');
        const states = list(event.states, rows.length, rows.length);
        for (let i = 0; i < rows.length; i++) {
          const value = record(states[i], ['requestId', 'status', 'reason']), row = rows[i];
          if (value.requestId !== row.intent.requestId || !reason(value.reason)) fail('TRIAL_RECONCILE_FINAL');
          const allowed = row.phaseCount === 4 ? ['COMPLETED'] : row.phaseCount === 0 ? ['NOT_STARTED'] :
            row.phaseCount === 1 ? ['NOT_STARTED', 'ERROR'] : ['ERROR'];
          if (!allowed.includes(value.status) || (value.status === 'COMPLETED' ? value.reason !== null : value.reason !== event.stopReason)) fail('TRIAL_RECONCILE_FINAL');
          row.declaredFinal = value;
        }
        if (slot !== rows.length && event.stopReason === null) fail('TRIAL_RECONCILE_FALSE_COMPLETION');
        final = event; continue;
      }
      const row = rows[slot];
      if (!row || event.requestId !== row.intent.requestId) fail('TRIAL_RECONCILE_REQUEST');
      const action = `${event.phase}_${event.type === 'START_INTENT' ? 'START' : event.type === 'PHASE_RESULT' ? 'RESULT' : 'INVALID'}`;
      if (action !== phases[phase]) fail('TRIAL_RECONCILE_PHASE_ORDER');
      if (phase === 0 && (usageUnknown || totals.modelCalls >= BigInt(plan.budget.maxModelCalls) ||
          totals.input >= BigInt(plan.budget.maxInputTokens) || totals.output >= BigInt(plan.budget.maxOutputTokens))) fail('TRIAL_RECONCILE_BUDGET_CONTINUATION');
      if (phase === 1) {
        observation(event.observation); row.executor = executor(event.result, row.intent);
        for (const key of Object.keys(totals)) {
          const value = key === 'modelCalls' ? row.executor.modelCalls : row.executor.tokenUsage?.[key] ?? null;
          if (value === null) usageUnknown = true; else totals[key] += BigInt(value);
        }
      }
      if (phase === 3) { observation(event.observation); row.oracle = oracle(event.result, row.intent, row.executor); }
      row.phaseCount++;
      row.observedState = ['NO_START_INTENT', 'EXECUTION_UNKNOWN', 'EXECUTOR_RECORDED', 'ORACLE_UNKNOWN', 'COMPLETED_RECORDED'][row.phaseCount];
      phase++; if (phase === 4) { phase = 0; slot++; }
    }
    if ((byteStatus === 'FINAL_PRESENT') !== (final !== null) && !['CORRUPT', 'PARTIAL_TAIL'].includes(byteStatus)) fail('TRIAL_RECONCILE_BYTE_FINAL');
    return cloneFreeze({ schemaVersion: 'nisi-trial-semantic-reconciliation-v1',
      status: final && byteStatus === 'FINAL_PRESENT' ? 'FINAL_CONSISTENT' : 'INTERRUPTED', byteStatus,
      runnerId: events[0].runnerId, planSha256: plan.planSha256, profileSha256: profile.profileSha256,
      finalStopReason: final?.stopReason ?? null, rows, batches: buildBatches(plan, profile, rows),
      counts: { planned: rows.length, uniqueTasks: plan.tasks.length, repetitions: plan.repetitions,
        startIntents: rows.filter(r => r.phaseCount > 0).length, completePhaseRecords: rows.filter(r => r.phaseCount === 4).length,
        incompletePhaseRecords: rows.filter(r => r.phaseCount > 0 && r.phaseCount < 4).length },
      actualDispatchCount: null, sourceTrust: 'UNAUTHENTICATED_HOST_STATEMENTS', durabilityAcknowledgement: 'UNKNOWN',
      durationBudgetReconciliation: 'NOT_RECONCILABLE_FROM_RETAINED_EVENTS', drainSemantics: 'NOT_VALIDATED',
      candidateBytesRevalidated: false,
      remoteExecutionStopped: 'UNKNOWN', measurementVerified: false, causalClaim: false, resumable: false,
      promotionEligible: false, authorizing: false });
  } catch {
    return cloneFreeze({ schemaVersion: 'nisi-trial-semantic-reconciliation-v1', status: 'REFUSED',
      reason: 'INVALID_OR_UNAVAILABLE_EXPERIMENT_EVIDENCE', rows: [], batches: [], resumable: false, authorizing: false });
  }
}
export function reconcilePairedTrialEventStoreV1(input) {
  const inspected = inspectPairedTrialEventStoreV1(input);
  return reconcileTrialRetentionEventsV1({ events: inspected.events, byteStatus: inspected.status });
}
