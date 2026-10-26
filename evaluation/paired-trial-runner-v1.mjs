// PRIVATE sequential experimental coordinator. Trusted host callbacks supply
// actual isolation, source custody, durable storage and independently reviewed
// oracle implementation. This is NOT a sandbox, model admission or scheduler.
// Synchronous host setup must be bounded and cooperative. Timers observe waits;
// they cannot preempt JavaScript that blocks the event loop.
// Oracle callbacks must be fixed local checks, not unmetered LLM calls. Resource
// receipts cover the executor only; provider enforcement is outside this module.
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { types } from 'node:util';
import { record, natural } from './intake-v1.mjs';
import { readPreventionExperimentPlanV1 } from './prevention-experiment-plan-v1.mjs';
import { readPreventionExecutionProfileV1, runnerFail as fail, sha256, digest, freezeOwned } from './prevention-execution-profile-v1.mjs';
import { validatePairedTrialRowsV1 } from './paired-trial-v1.mjs';
import { createExecutionCoordinatorV1 } from '../hosts/repository/execution-coordinator-v1.mjs';

const terminal = value => value === 'IDLE' || value === 'OFF';
const copy = value => freezeOwned(structuredClone(value));
// Original scheduled identities only. Persisted/copy-equivalent JSON is data,
// never a dispatch capability. This reader itself grants no admission.
const scheduledIntents = new WeakMap();
const originalEvents = new WeakMap();
export function readScheduledPairedTrialIntentV1(intent) {
  const issued = scheduledIntents.get(intent);
  if (!issued) fail('RUNNER_INTENT_NOT_ISSUED');
  return issued;
}
export function readOriginalPairedTrialEventV1(event) {
  const issued = originalEvents.get(event);
  if (!issued) fail('RUNNER_EVENT_NOT_ISSUED');
  return issued;
}
// Observe original native promises without trusting replaced .then methods.
function observe(promise) {
  if (!types.isPromise(promise)) fail('RUNNER_NATIVE_PROMISE');
  const cell = { state: 'PENDING', value: undefined };
  cell.done = Promise.prototype.then.call(promise,
    value => { cell.state = 'FULFILLED'; cell.value = value; },
    () => { cell.state = 'REJECTED'; });
  return cell;
}
async function wait(cell, durationMs, subscribeStop = null) {
  if (cell.state !== 'PENDING') return cell.state;
  if (durationMs <= 0) return 'TIMEOUT';
  const deadline = performance.now() + durationMs;
  let timer, subscription;
  try {
    subscription = subscribeStop?.();
    return await Promise.race([
      cell.done.then(() => cell.state),
      new Promise(resolve => {
        const onTimer = () => {
          const remaining = deadline - performance.now();
          if (remaining <= 0) { resolve('TIMEOUT'); return; }
          // Timer delivery can precede a high-resolution monotonic deadline.
          timer = setTimeout(onTimer, Math.ceil(remaining));
        };
        onTimer();
      }),
      ...(subscription ? [subscription.promise] : []),
    ]);
  } finally { clearTimeout(timer); subscription?.dispose(); }
}
function readExecutor(value, intent) {
  const out = record(value, ['requestId', 'profileSha256', 'candidateText', 'candidateSha256',
    'completionClaim', 'tokenUsage', 'durationMs', 'repairAttempts', 'modelCalls']);
  if (out.requestId !== intent.requestId || out.profileSha256 !== intent.profileSha256) fail('RUNNER_EXECUTOR_BINDING');
  if (typeof out.candidateText !== 'string' || !out.candidateText.isWellFormed() || Buffer.byteLength(out.candidateText) > 1048576) fail('RUNNER_CANDIDATE_TEXT');
  if (digest(out.candidateSha256) !== sha256(out.candidateText)) fail('RUNNER_CANDIDATE_BINDING');
  if (typeof out.completionClaim !== 'boolean') fail('RUNNER_COMPLETION_CLAIM');
  if (out.tokenUsage !== null) {
    out.tokenUsage = record(out.tokenUsage, ['input', 'output']);
    natural(out.tokenUsage.input); natural(out.tokenUsage.output);
  }
  for (const key of ['durationMs', 'repairAttempts', 'modelCalls']) if (out[key] !== null) natural(out[key]);
  return freezeOwned(out);
}
function readOracle(value, request) {
  const out = record(value, ['requestId', 'oracleSha256', 'oracleCandidateSha256', 'outcome']);
  if (out.requestId !== request.requestId || out.oracleSha256 !== request.oracleSha256 ||
      out.oracleCandidateSha256 !== request.candidateSha256) fail('RUNNER_ORACLE_BINDING');
  if (!['PASS', 'FAIL', 'INCONCLUSIVE', 'ERROR'].includes(out.outcome)) fail('RUNNER_ORACLE_OUTCOME');
  return freezeOwned(out);
}

export function createPairedTrialRunnerV1(input) {
  const top = record(input, ['plan', 'profile', 'host']);
  const plan = readPreventionExperimentPlanV1(top.plan);
  const profile = readPreventionExecutionProfileV1(top.profile, plan.planSha256, plan.policy);
  const host = record(top.host, ['verifyInputs', 'startExecutor', 'startOracle', 'retain']);
  if (Object.values(host).some(fn => typeof fn !== 'function')) fail('RUNNER_HOST');
  const runnerId = randomUUID(), records = [], events = [];
  for (let repetition = 0; repetition < plan.repetitions; repetition++) {
    for (const task of plan.tasks) {
      for (const arm of task.armOrder[repetition].split('_')) {
        const requestId = sha256(JSON.stringify([runnerId, plan.planSha256, profile.profileSha256, task.caseId, repetition, arm]));
        const intent = freezeOwned({ requestId, runId: `run-${requestId}`, runnerId,
          planSha256: plan.planSha256, profileSha256: profile.profileSha256,
          caseId: task.caseId, repetition, arm, taskSha256: task.taskSha256,
          baselineSha256: task.baselineSha256, oracleSha256: task.oracleSha256,
          model: profile.model, modelSettingsSha256: profile.modelSettingsSha256,
          toolchainSha256: profile.toolchainSha256, resourceBudgetSha256: profile.resourceBudgetSha256,
          policyMode: arm === 'ON' ? 'ISOLATED_TRIAL' : 'OFF', trialPolicy: arm === 'ON' ? profile.trialPolicy : null });
        scheduledIntents.set(intent, Object.freeze({ intent, plan, profile }));
        records.push({ intent, status: 'NOT_STARTED', reason: null, executor: null, oracle: null,
          executorObservation: null, oracleObservation: null, executorRetained: false, oracleRetained: false, oracleAttempted: false });
      }
    }
  }
  let ran = false, running = false, stopReason = null, startTime = null, endTime = null;
  let stopRequested = false, stopAcceptanceClosed = true;
  const stopWaiters = new Set();
  function subscribeStop() {
    // Per-wait lifetime: an unresolved global promise would retain losing race
    // reactions through the whole run. Completed waits detach and settle here.
    let wake;
    const promise = new Promise(resolve => { wake = resolve; });
    if (stopRequested) wake('STOP');
    else {
      stopWaiters.add(wake);
      if (stopRequested) { stopWaiters.delete(wake); wake('STOP'); }
    }
    return { promise, dispose() { stopWaiters.delete(wake); wake('DISPOSED'); } };
  }
  let retentionStatus = 'CONFIRMED', pendingRetention = null, active = null, coordinator = null, drain = null;
  let rechecking = false;
  const totals = { modelCalls: 0n, input: 0n, output: 0n };
  const unknown = { modelCalls: false, input: false, output: false };
  const remaining = () => Math.max(0, plan.budget.maxDurationMs - (performance.now() - startTime));
  const checkStop = () => { if (stopRequested) fail('RUNNER_USER_STOP_REQUESTED'); };
  const event = data => {
    const value = copy({ sequence: events.length, ...data });
    originalEvents.set(value, Object.freeze({ event: value, runnerId, plan, profile }));
    events.push(value);
    return value;
  };
  function requestStop(...args) {
    if (args.length) fail('RUNNER_ARGUMENTS');
    if (!running || stopAcceptanceClosed) return Object.freeze({ status: 'REFUSED', reason: 'RUNNER_NOT_STOPPABLE', authorizing: false });
    if (stopRequested) return Object.freeze({ status: 'ALREADY_REQUESTED', authorizing: false });
    stopRequested = true;
    event({ type: 'STOP_REQUESTED' }); // Diagnostic only; no concurrent storage write.
    for (const wake of [...stopWaiters]) wake('STOP');
    stopWaiters.clear();
    return Object.freeze({ status: 'REQUESTED', authorizing: false });
  }
  function budgetExhausted() {
    return totals.modelCalls >= BigInt(plan.budget.maxModelCalls) ||
      totals.input >= BigInt(plan.budget.maxInputTokens) || totals.output >= BigInt(plan.budget.maxOutputTokens);
  }
  async function retain(data) {
    const value = event(data);
    if (retentionStatus !== 'CONFIRMED') fail('RUNNER_RETENTION_UNCONFIRMED');
    try {
      pendingRetention = observe(Reflect.apply(host.retain, undefined, [value]));
      const state = await wait(pendingRetention, profile.retentionTimeoutMs);
      if (state !== 'FULFILLED') fail('RUNNER_RETENTION_UNCONFIRMED');
      pendingRetention = null;
    } catch {
      retentionStatus = 'UNCONFIRMED';
      fail('RUNNER_RETENTION_UNCONFIRMED');
    }
  }
  function verify(intent) {
    if (remaining() <= 0) fail('RUNNER_DEADLINE');
    checkStop();
    if (Reflect.apply(host.verifyInputs, undefined, [intent]) !== true) fail('RUNNER_SOURCE_UNCONFIRMED');
    if (remaining() <= 0) fail('RUNNER_DEADLINE');
    checkStop();
  }
  function operationCheckpoint(deadline) {
    // Already-observed adverse channels/deadlines remain faults, not success or
    // user cancellation. A fulfilled but unaccepted result never defeats stop.
    if (active.result.state === 'REJECTED') fail('RUNNER_RESULT_UNCONFIRMED');
    if (active.settled.state === 'REJECTED') fail('RUNNER_SETTLEMENT_UNCONFIRMED');
    if (performance.now() >= deadline) fail('RUNNER_DEADLINE');
    checkStop();
  }
  async function operate(row, phase, argument) {
    const intent = row.intent;
    verify(intent);
    await retain({ type: 'START_INTENT', requestId: intent.requestId, phase });
    verify(intent); // Storage waits and checks cannot extend dispatch eligibility.
    if (phase === 'EXECUTOR') row.status = 'STARTED'; else row.oracleAttempted = true;
    event({ type: 'START_ATTEMPTED', requestId: intent.requestId, phase });
    const deadline = performance.now() + Math.min(remaining(), profile[phase === 'EXECUTOR' ? 'executorTimeoutMs' : 'oracleTimeoutMs']);
    // If start throws or returns an invalid handle, effects cannot be disproved.
    active = { invalid: true };
    const raw = Reflect.apply(host[phase === 'EXECUTOR' ? 'startExecutor' : 'startOracle'], undefined, [argument]);
    // Catch exposed native promises even when another handle field is invalid.
    // Accessors are not invoked; a malformed handle still cannot establish stop.
    const promised = {};
    if (raw && typeof raw === 'object') {
      for (const key of ['result', 'settled']) {
        const descriptor = Object.getOwnPropertyDescriptor(raw, key);
        if (descriptor && Object.hasOwn(descriptor, 'value') && types.isPromise(descriptor.value)) promised[key] = observe(descriptor.value);
      }
    }
    const handle = record(raw, ['result', 'settled', 'status', 'cancel']);
    // Attach both observers before invoking status or the coordinator.
    if (!promised.result || !promised.settled) fail('RUNNER_NATIVE_PROMISE');
    const { result, settled } = promised;
    if (typeof handle.status !== 'function' || typeof handle.cancel !== 'function') fail('RUNNER_HANDLE');
    active = { invalid: false, result, settled, status: handle.status, cancel: handle.cancel };
    operationCheckpoint(deadline); // Reentrant stop in start still owns this handle.
    if (!['IDLE', 'BUSY', 'QUARANTINED', 'OFF'].includes(Reflect.apply(active.status, undefined, []))) fail('RUNNER_OWNER_STATUS');
    operationCheckpoint(deadline);
    const resultState = await wait(result, deadline - performance.now(), subscribeStop);
    operationCheckpoint(deadline);
    if (resultState !== 'FULFILLED') fail('RUNNER_RESULT_UNCONFIRMED');
    const settledState = await wait(settled, deadline - performance.now(), subscribeStop);
    operationCheckpoint(deadline);
    if (settledState !== 'FULFILLED') fail('RUNNER_SETTLEMENT_UNCONFIRMED');
    const ownerStatus = Reflect.apply(active.status, undefined, []);
    if (!terminal(ownerStatus)) fail('RUNNER_OWNER_UNCONFIRMED');
    operationCheckpoint(deadline);
    const value = phase === 'EXECUTOR' ? readExecutor(result.value, intent) : readOracle(result.value, argument);
    operationCheckpoint(deadline);
    const observation = freezeOwned({ resultSettlement: result.state, ownerSettlement: settled.state,
      ownerStatus, deadline: 'WITHIN_OBSERVATION_WINDOW' });
    active = null;
    return { value, observation };
  }
  function batches() {
    const groups = [];
    for (let repetition = 0; repetition < plan.repetitions; repetition++) {
      const pairs = [], unpaired = [];
      const rows = records.filter(row => row.intent.repetition === repetition);
      const lookup = new Map(rows.map(row => [`${row.intent.caseId}/${row.intent.arm}`, row]));
      for (const task of plan.tasks) {
        const off = lookup.get(`${task.caseId}/OFF`), on = lookup.get(`${task.caseId}/ON`);
        if ([off, on].some(row => row.status !== 'COMPLETED' || !row.executorRetained || !row.oracleRetained ||
            !row.executorObservation || !row.oracleObservation)) {
          unpaired.push({ caseId: task.caseId, offStatus: off.status, onStatus: on.status });
          continue;
        }
        const side = row => ({ runId: row.intent.runId, model: profile.model,
          modelSettingsSha256: profile.modelSettingsSha256, toolchainSha256: profile.toolchainSha256,
          resourceBudgetSha256: profile.resourceBudgetSha256, candidateSha256: row.executor.candidateSha256,
          oracleCandidateSha256: row.oracle.oracleCandidateSha256, outcome: row.oracle.outcome,
          completionClaim: row.executor.completionClaim, tokenUsage: row.executor.tokenUsage,
          durationMs: row.executor.durationMs, repairAttempts: row.executor.repairAttempts });
        pairs.push({ caseId: task.caseId, taskSha256: task.taskSha256, baselineSha256: task.baselineSha256,
          oracleSha256: task.oracleSha256, off: side(off), on: side(on) });
      }
      const pairedRows = pairs.length ? { schemaVersion: 'nisi-paired-trial-v1', pairs } : null;
      if (pairedRows) validatePairedTrialRowsV1(pairedRows);
      groups.push({ repetition, pairedRows, unpaired });
    }
    return groups;
  }
  function inspect() {
    const started = records.filter(row => row.status !== 'NOT_STARTED');
    return copy({ schemaVersion: 'nisi-paired-trial-ledger-v1', runnerId,
      planSha256: plan.planSha256, profileSha256: profile.profileSha256,
      status: running ? 'RUNNING' : !ran ? 'READY' : stopReason ? 'STOPPED' : 'COMPLETE', stopReason,
      stopRequested, stopAcceptanceClosed,
      counts: { planned: records.length, uniqueTasks: plan.tasks.length, repetitions: plan.repetitions,
        executorStarted: started.length, oracleStarted: records.filter(row => row.oracleAttempted).length,
        completed: records.filter(row => row.status === 'COMPLETED').length,
        notStarted: records.length - started.length,
        oraclePass: records.filter(row => row.oracle?.outcome === 'PASS').length,
        oracleFail: records.filter(row => row.oracle?.outcome === 'FAIL').length,
        oracleError: records.filter(row => row.oracle?.outcome === 'ERROR').length,
        oracleInconclusive: records.filter(row => row.oracle?.outcome === 'INCONCLUSIVE').length,
        missingOracle: started.filter(row => row.oracle === null).length,
        claims: records.filter(row => row.executor?.completionClaim === true).length,
        incorrectClaims: records.filter(row => row.executor?.completionClaim === true && row.oracle?.outcome === 'FAIL').length,
        unknownClaims: started.filter(row => row.executor?.completionClaim === true &&
          (!row.oracle || ['ERROR', 'INCONCLUSIVE'].includes(row.oracle.outcome))).length,
        missingCompletionClaim: started.filter(row => row.executor === null).length },
      budgetEnforcement: { durationMs: 'MONOTONIC_DISPATCH_ENVELOPE', modelCalls: 'REPORTED_NOT_PROVIDER_ENFORCED',
        inputTokens: 'REPORTED_NOT_PROVIDER_ENFORCED', outputTokens: 'REPORTED_NOT_PROVIDER_ENFORCED',
        retentionAndDrain: 'SEPARATE_BOUNDED_OBSERVATION_WINDOWS' },
      usage: Object.fromEntries(Object.keys(totals).map(key => [key, { knownSubtotal: totals[key].toString(), unknown: unknown[key] }])),
      reportedBudgetExhausted: budgetExhausted(), reportedBudgetStatus: budgetExhausted() ? 'EXHAUSTED' :
        Object.values(unknown).some(Boolean) ? 'UNKNOWN' : 'KNOWN_SUBTOTAL_BELOW_LIMITS',
      elapsedMs: startTime === null ? null : Math.max(0, (endTime ?? performance.now()) - startTime),
      records, events, drain, batches: batches(), retentionStatus,
      retentionSettlement: pendingRetention?.state ?? null,
      measurementVerified: false, causalClaim: false, authorizing: false, promotionEligible: false, influenceEnabled: false });
  }
  async function stopActive() {
    if (!active) return;
    if (active.invalid) {
      drain = { status: 'UNCONFIRMED', reason: 'HANDLE_UNAVAILABLE', authorizing: false };
      event({ type: 'DRAIN', observation: drain });
      return;
    }
    const owned = active;
    coordinator = createExecutionCoordinatorV1({ owners: [{ id: 'trial.operation',
      status: () => Reflect.apply(owned.status, undefined, []),
      // Cleanup joins BOTH original channels; rejected results are terminal
      // cleanup evidence only and are never promoted to successful execution.
      settled: () => Promise.all([owned.result.done, owned.settled.done]).then(() => {
        if (owned.settled.state !== 'FULFILLED' || owned.result.state === 'PENDING') fail('RUNNER_SETTLEMENT_REJECTED');
      }),
      cancel: () => Reflect.apply(owned.cancel, undefined, []) }], settleTimeoutMs: profile.drainTimeoutMs });
    drain = await coordinator.requestOff();
    event({ type: 'DRAIN', observation: drain });
  }
  async function run(...args) {
    if (args.length) fail('RUNNER_ARGUMENTS');
    if (ran) fail('RUNNER_ALREADY_RAN');
    ran = true; running = true; stopAcceptanceClosed = false; startTime = performance.now();
    let current = null;
    try {
      await retain({ type: 'SCHEDULE', runnerId, plan, profile, intents: records.map(row => row.intent) });
      checkStop();
      for (const row of records) {
        current = row;
        checkStop();
        if (budgetExhausted()) fail('RUNNER_REPORTED_BUDGET_EXHAUSTED');
        if (Object.values(unknown).some(Boolean)) fail('RUNNER_REPORTED_BUDGET_UNCONFIRMED');
        const execution = await operate(row, 'EXECUTOR', row.intent);
        checkStop(); // Stop may arrive between operate resolving and this continuation.
        const executor = execution.value;
        const { candidateText, ...redacted } = executor;
        row.executor = redacted; row.executorObservation = execution.observation;
        for (const key of Object.keys(totals)) {
          const amount = key === 'modelCalls' ? executor.modelCalls : executor.tokenUsage?.[key] ?? null;
          if (amount === null) unknown[key] = true; else totals[key] += BigInt(amount);
        }
        await retain({ type: 'PHASE_RESULT', requestId: row.intent.requestId, phase: 'EXECUTOR', result: redacted, observation: execution.observation });
        row.executorRetained = true;
        checkStop();
        const oracleRequest = freezeOwned({ requestId: row.intent.requestId, oracleSha256: row.intent.oracleSha256,
          candidateSha256: executor.candidateSha256, candidateText });
        const checking = await operate(row, 'ORACLE', oracleRequest);
        checkStop();
        row.oracle = checking.value; row.oracleObservation = checking.observation;
        await retain({ type: 'PHASE_RESULT', requestId: row.intent.requestId, phase: 'ORACLE', result: row.oracle, observation: checking.observation });
        row.oracleRetained = true; row.status = 'COMPLETED';
        checkStop(); // Acknowledged oracle records stay completed, even on stop.
      }
    } catch (error) {
      stopAcceptanceClosed = true; // Existing catch remains the sole drain owner.
      // No arbitrary host error messages or candidate content enter evidence.
      const code = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'code')?.value : undefined;
      stopReason = typeof code === 'string' && code.length <= 128 && /^RUNNER_[A-Z_]+$/u.exec(code)?.[0] === code ? code : 'RUNNER_CALLBACK_OR_CONTRACT_ERROR';
      if (current && current.status === 'STARTED') { current.status = 'ERROR'; current.reason = stopReason; }
      if (current && current.status === 'ERROR' && !current.executor) for (const key of Object.keys(unknown)) unknown[key] = true;
      try { await stopActive(); }
      catch {
        // Defensive containment if the trusted coordinator itself fails. Its
        // ordinary owner/status/cancel failures are already observed internally.
        drain = { status: 'UNCONFIRMED', reason: 'DRAIN_ERROR', authorizing: false };
        event({ type: 'DRAIN', observation: drain });
      }
    }
    stopAcceptanceClosed = true; // Final retention is not a new stoppable phase.
    for (const row of records) if (row.status === 'NOT_STARTED') row.reason = stopReason;
    try {
      if (retentionStatus === 'CONFIRMED') await retain({ type: 'FINAL', stopReason,
        states: records.map(row => ({ requestId: row.intent.requestId, status: row.status, reason: row.reason })), drain });
      else event({ type: 'FINAL_NOT_RETAINED', reason: 'RETENTION_UNCONFIRMED' });
    } catch { stopReason ??= 'RUNNER_RETENTION_UNCONFIRMED'; }
    running = false; endTime = performance.now();
    return inspect();
  }
  async function recheckDrain() {
    if (running || rechecking || !ran) fail('RUNNER_RECHECK_REFUSED');
    rechecking = true;
    try {
      if (coordinator) {
        try { drain = await coordinator.recheck(); }
        catch { drain = { status: 'UNCONFIRMED', reason: 'DRAIN_ERROR', authorizing: false }; }
        event({ type: 'DRAIN_RECHECK', observation: drain });
      }
      // Late results are diagnostic only, never input to normal result parsing.
      if (active && !active.invalid) event({ type: 'LATE_OBSERVATION', result: active.result.state, settled: active.settled.state });
      if (pendingRetention) event({ type: 'RETENTION_RECHECK', state: pendingRetention.state });
      return inspect();
    } finally { rechecking = false; }
  }
  return Object.freeze({ run, inspect, recheckDrain, requestStop });
}
