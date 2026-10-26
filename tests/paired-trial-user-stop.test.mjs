import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createPairedTrialRunnerV1 } from '../evaluation/paired-trial-runner-v1.mjs';
import { readPreventionExperimentPlanV1 } from '../evaluation/prevention-experiment-plan-v1.mjs';
import { reconcileTrialRetentionEventsV1 } from '../history/paired-trial-reconciliation-v1.mjs';
const hash = text => createHash('sha256').update(text).digest('hex');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const operation = value => ({ result: Promise.resolve(value), settled: Promise.resolve(), status: () => 'IDLE', cancel() {} });
const turn = () => new Promise(setImmediate);
const STOP = 'RUNNER_USER_STOP_REQUESTED';
function fixture() {
  const plan = { schemaVersion: 'nisi-prevention-experiment-plan-v1', planId: 'plan.user-stop',
    policy: { version: 'policy.v1', sha256: hash('policy'), influenceEnabled: false }, proposer: 'author', acceptanceReviewer: 'reviewer',
    trainingDigests: [], tasks: [{ caseId: 'case.one', taskSha256: hash('task'), baselineSha256: hash('base'), oracleSha256: hash('oracle'),
      armOrder: ['OFF_ON', 'ON_OFF'] }], repetitions: 2, exclusions: [],
    budget: { maxDurationMs: 30000, maxModelCalls: 100, maxInputTokens: 1000, maxOutputTokens: 1000 }, measuredTelemetry: 'UNKNOWN_UNTIL_RUN' };
  const profile = { schemaVersion: 'nisi-prevention-execution-profile-v1', planSha256: readPreventionExperimentPlanV1(plan).planSha256,
    model: 'fixed-no-model-host', modelSettingsSha256: hash('settings'), toolchainSha256: hash('node'), resourceBudgetSha256: hash('budget'),
    trialPolicy: { version: plan.policy.version, sha256: plan.policy.sha256 },
    executorTimeoutMs: 2000, oracleTimeoutMs: 2000, retentionTimeoutMs: 500, drainTimeoutMs: 5 };
  const events = [], calls = [];
  const executor = intent => ({ requestId: intent.requestId, profileSha256: intent.profileSha256, candidateText: 'fixture',
    candidateSha256: hash('fixture'), completionClaim: true, tokenUsage: { input: 0, output: 0 }, durationMs: null, modelCalls: 0, repairAttempts: 0 });
  const oracle = request => ({ requestId: request.requestId, oracleSha256: request.oracleSha256,
    oracleCandidateSha256: request.candidateSha256, outcome: 'PASS' });
  const host = { retain: async event => { events.push(event); }, verifyInputs: () => true,
    startExecutor: intent => { calls.push('EXECUTOR'); return operation(executor(intent)); },
    startOracle: request => { calls.push('ORACLE'); return operation(oracle(request)); } };
  return { plan, profile, events, calls, executor, oracle, host };
}
const create = f => { const runner = createPairedTrialRunnerV1({ plan: f.plan, profile: f.profile, host: f.host });
  assert.equal(typeof runner.requestStop, 'function'); return runner; };
function stopped(report) {
  assert.equal(report.status, 'STOPPED'); assert.equal(report.stopReason, STOP);
  assert.equal(report.stopRequested, true); assert.equal(report.stopAcceptanceClosed, true);
  assert.equal(report.authorizing, false); assert.equal(report.promotionEligible, false); assert.equal(report.measurementVerified, false);
}
function finalConsistency(f) {
  const report = reconcileTrialRetentionEventsV1({ events: f.events, byteStatus: 'FINAL_PRESENT' });
  assert.equal(report.status, 'FINAL_CONSISTENT'); assert.equal(report.actualDispatchCount, null);
  assert.equal(report.remoteExecutionStopped, 'UNKNOWN'); assert.equal(report.resumable, false);
  assert.equal(f.events.filter(event => event.type === 'FINAL').length, 1);
}
async function promptly(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new assert.AssertionError({ message: 'STOP_DID_NOT_WAKE_WAIT' })), 500); })]); }
  finally { clearTimeout(timer); }
}

test('stop is zero-argument, frozen, refused outside execution and cannot rewrite final evidence', async () => {
  const f = fixture(), runner = create(f);
  const before = runner.inspect(); assert.equal(before.stopRequested, false); assert.equal(before.stopAcceptanceClosed, true);
  assert.throws(() => runner.requestStop('private reason'), { code: 'RUNNER_ARGUMENTS' });
  const refused = runner.requestStop(); assert(Object.isFrozen(refused));
  assert.deepEqual(refused, { status: 'REFUSED', reason: 'RUNNER_NOT_STOPPABLE', authorizing: false });
  assert.deepEqual(runner.inspect(), before);
  const result = await runner.run(), final = JSON.stringify(f.events);
  assert.equal(result.status, 'COMPLETE'); assert.equal(runner.requestStop().status, 'REFUSED');
  assert.equal(JSON.stringify(f.events), final); assert.deepEqual(runner.inspect(), result);
  await assert.rejects(runner.run(), { code: 'RUNNER_ALREADY_RAN' });
});

test('successful waits release distinct stop subscriptions instead of accumulating one pending promise', async () => {
  const original = Promise.race, subscriptions = [], settled = [];
  Promise.race = function (values) {
    if (Array.isArray(values) && values.length === 3) {
      const wake = values[2]; subscriptions.push(wake);
      Promise.prototype.then.call(wake, value => { settled.push(value); });
    }
    return Reflect.apply(original, this, [values]);
  };
  try {
    const f = fixture(), runner = create(f);
    assert.equal((await runner.run()).status, 'COMPLETE'); await turn();
    assert(subscriptions.length > 1);
    assert.equal(new Set(subscriptions).size, subscriptions.length, 'stop waits must not share a pending promise');
    assert.equal(settled.length, subscriptions.length, 'every completed wait releases its stop subscription');
    assert(settled.every(value => value === 'DISPOSED'));
  } finally { Promise.race = original; }
});

test('pending executor wakes promptly; repeated requests never cancel synchronously or twice', async () => {
  const f = fixture(), started = deferred(), result = deferred(), settled = deferred(); let cancels = 0, intent;
  f.host.startExecutor = request => { intent = request; started.resolve(); return {
    result: result.promise, settled: settled.promise, status: () => 'BUSY', cancel: () => { cancels++; } }; };
  const runner = create(f), running = runner.run(); await started.promise;
  const first = runner.requestStop(); assert(Object.isFrozen(first));
  assert.deepEqual(first, { status: 'REQUESTED', authorizing: false });
  assert.equal(runner.requestStop().status, 'ALREADY_REQUESTED'); assert.equal(cancels, 0);
  const report = await promptly(running); stopped(report);
  assert.equal(cancels, 1); assert.equal(report.drain.status, 'UNCONFIRMED');
  assert.equal(report.records[0].executor, null); assert.equal(report.counts.oracleStarted, 0);
  assert.equal(report.counts.executorStarted, 1); assert.equal(report.counts.notStarted, 3);
  result.resolve(f.executor(intent)); settled.resolve(); await turn();
  const after = await runner.recheckDrain(); stopped(after); assert.equal(after.records[0].executor, null);
  assert.equal(cancels, 1); assert.equal(after.counts.oracleStarted, 0); finalConsistency(f);
});

test('stop during owner settlement joins both channels and confirms OFF only after actual settlement', async () => {
  const f = fixture(), started = deferred(), settled = deferred(); let cancels = 0, state = 'BUSY';
  f.host.startExecutor = intent => { started.resolve(); return { result: Promise.resolve(f.executor(intent)), settled: settled.promise,
    status: () => state, cancel: () => { cancels++; settled.resolve(); state = 'IDLE'; } }; };
  const runner = create(f), running = runner.run(); await started.promise; await turn();
  runner.requestStop(); const report = await promptly(running); stopped(report);
  assert.equal(report.drain.status, 'OFF'); assert.equal(cancels, 1); assert.equal(report.records[0].executor, null);
  assert.equal(report.counts.oracleStarted, 0); finalConsistency(f);
});

test('stop during every acknowledged retention boundary preserves rows and never overlaps FINAL writes', async () => {
  for (const [type, phase, expected] of [
    ['SCHEDULE', undefined, [0, 0, 0]], ['START_INTENT', 'EXECUTOR', [0, 0, 0]],
    ['PHASE_RESULT', 'EXECUTOR', [1, 0, 0]], ['START_INTENT', 'ORACLE', [1, 0, 0]], ['PHASE_RESULT', 'ORACLE', [1, 1, 1]],
  ]) {
    const f = fixture(), reached = deferred(), retained = deferred(); let pending = false, overlapped = false;
    f.host.retain = event => {
      if (pending) overlapped = true; f.events.push(event);
      if (event.type === type && event.phase === phase && !pending) {
        pending = true; reached.resolve(); return retained.promise.then(() => { pending = false; });
      }
      return Promise.resolve();
    };
    const runner = create(f), running = runner.run(); let finished = false; running.then(() => { finished = true; });
    await reached.promise; runner.requestStop(); await turn();
    assert.equal(finished, false); assert.equal(f.events.some(e => e.type === 'FINAL'), false);
    assert.equal(runner.inspect().retentionStatus, 'CONFIRMED'); assert.equal(overlapped, false);
    retained.resolve(); const report = await promptly(running); stopped(report); assert.equal(overlapped, false);
    assert.deepEqual([report.counts.executorStarted, report.counts.oracleStarted, report.counts.completed], expected);
    if (type === 'PHASE_RESULT') assert.equal(report.records[0][phase === 'EXECUTOR' ? 'executorRetained' : 'oracleRetained'], true);
    assert.equal(report.retentionStatus, 'CONFIRMED'); finalConsistency(f);
  }
});

test('synchronous verify/start/status stop requests block later dispatch and capture the cancel owner', async () => {
  for (const where of ['verify', 'start', 'status']) {
    const f = fixture(); let runner, cancels = 0, requested = false;
    const stop = () => { if (!requested) { requested = true; assert.equal(runner.requestStop().status, 'REQUESTED'); } };
    if (where === 'verify') f.host.verifyInputs = () => { stop(); return true; };
    else f.host.startExecutor = intent => {
      if (where === 'start') stop();
      return { ...operation(f.executor(intent)), status: () => { if (where === 'status') stop(); return 'IDLE'; }, cancel: () => { cancels++; } };
    };
    runner = create(f); const report = await runner.run(); stopped(report);
    assert.equal(report.counts.executorStarted, where === 'verify' ? 0 : 1); assert.equal(report.counts.oracleStarted, 0);
    assert.equal(cancels, where === 'verify' ? 0 : 1); finalConsistency(f);
  }
});

test('same-turn fulfilled result cannot be promoted after stop; pending oracle is also interruptible', async () => {
  for (const phase of ['EXECUTOR', 'ORACLE']) {
    const f = fixture(), started = deferred(), result = deferred(); let input, cancels = 0;
    f.host[phase === 'EXECUTOR' ? 'startExecutor' : 'startOracle'] = request => {
      input = request; started.resolve(); return { result: result.promise, settled: Promise.resolve(), status: () => 'IDLE', cancel: () => { cancels++; } };
    };
    const runner = create(f), running = runner.run(); await started.promise;
    result.resolve(phase === 'EXECUTOR' ? f.executor(input) : f.oracle(input)); runner.requestStop();
    const report = await promptly(running); stopped(report); assert.equal(cancels, 1);
    assert.equal(report.records[0][phase === 'EXECUTOR' ? 'executor' : 'oracle'], null);
    assert.equal(report.counts.completed, 0); finalConsistency(f);
  }
});

test('retention failure remains authoritative when stop overlaps it; no second write or false confirmation', async () => {
  const f = fixture(), reached = deferred(), pending = deferred();
  f.host.retain = event => { f.events.push(event); if (event.type === 'START_INTENT') { reached.resolve(); return pending.promise; } return Promise.resolve(); };
  const runner = create(f), running = runner.run(); await reached.promise; runner.requestStop(); pending.reject(Error('private failure'));
  const report = await running;
  assert.equal(report.stopReason, 'RUNNER_RETENTION_UNCONFIRMED'); assert.equal(report.retentionStatus, 'UNCONFIRMED');
  assert.equal(report.stopRequested, true); assert.equal(report.counts.executorStarted, 0); assert.equal(f.events.length, 2);
  assert.equal(f.events.some(e => e.type === 'FINAL'), false); assert(!JSON.stringify(report).includes('private failure'));
});

test('stop in the operation-return microtask gap prevents accepting or retaining that result', async () => {
  for (const phase of ['EXECUTOR', 'ORACLE']) {
    const f = fixture(); let runner, samples = 0;
    f.host[phase === 'EXECUTOR' ? 'startExecutor' : 'startOracle'] = request => ({
      ...operation(phase === 'EXECUTOR' ? f.executor(request) : f.oracle(request)),
      status: () => {
        if (++samples === 2) queueMicrotask(() => runner.requestStop());
        return 'IDLE';
      },
    });
    runner = create(f); const report = await runner.run(); stopped(report);
    assert.equal(report.records[0][phase === 'EXECUTOR' ? 'executor' : 'oracle'], null);
    assert.equal(f.events.some(e => e.type === 'PHASE_RESULT' && e.phase === phase), false);
    assert.equal(report.counts.completed, 0); finalConsistency(f);
  }
});

test('retention timeout after stop remains uncertain; late acknowledgment neither writes FINAL nor resumes', async () => {
  const f = fixture(), reached = deferred(), pending = deferred(); f.profile.retentionTimeoutMs = 5;
  f.host.retain = event => { f.events.push(event); if (event.type === 'START_INTENT') { reached.resolve(); return pending.promise; } return Promise.resolve(); };
  const runner = create(f), running = runner.run(); await reached.promise; runner.requestStop();
  const report = await running;
  assert.equal(report.stopReason, 'RUNNER_RETENTION_UNCONFIRMED'); assert.equal(report.retentionSettlement, 'PENDING');
  assert.equal(report.counts.executorStarted, 0); assert.equal(f.events.length, 2);
  pending.resolve(); await turn(); const after = await runner.recheckDrain();
  assert.equal(after.retentionSettlement, 'FULFILLED'); assert.equal(after.retentionStatus, 'UNCONFIRMED');
  assert.equal(after.counts.executorStarted, 0); assert.equal(f.events.length, 2); assert.equal(runner.requestStop().status, 'REFUSED');
});

test('stop with rejected or pending cancellation preserves uncertainty and never issues a second cancellation', async () => {
  for (const mode of ['rejected', 'pending']) {
    const f = fixture(), started = deferred(), result = deferred(), settled = deferred(), cancellation = deferred(); let calls = 0;
    f.host.startExecutor = () => { started.resolve(); return { result: result.promise, settled: settled.promise, status: () => 'IDLE',
      cancel: () => { calls++; return mode === 'rejected' ? Promise.reject(Error('private cancellation')) : cancellation.promise; } }; };
    const runner = create(f), running = runner.run(); await started.promise; runner.requestStop(); runner.requestStop();
    const report = await promptly(running); stopped(report); assert.equal(report.drain.status, 'UNCONFIRMED'); assert.equal(calls, 1);
    result.reject(Error('late result')); settled.resolve(); cancellation.resolve(); await turn();
    const after = await runner.recheckDrain(); assert.equal(calls, 1); assert.equal(after.records[0].executor, null);
    assert.equal(after.drain.status, mode === 'rejected' ? 'UNCONFIRMED' : 'OFF');
    assert(!JSON.stringify(after).includes('private cancellation')); finalConsistency(f);
  }
});

test('same-boundary adverse callbacks, rejected channels and deadlines are not relabeled user stop', async () => {
  for (const kind of ['source', 'throw', 'result', 'settled', 'deadline']) {
    const f = fixture(); let runner;
    if (kind === 'source') f.host.verifyInputs = () => { runner.requestStop(); return false; };
    else f.host.startExecutor = intent => {
      const handle = operation(f.executor(intent));
      if (kind === 'result') handle.result = Promise.reject(Error('private result'));
      if (kind === 'settled') handle.settled = Promise.reject(Error('private settlement'));
      // Queue stop after the runner's observers can see rejection; no timer race.
      if (['result', 'settled'].includes(kind)) queueMicrotask(() => runner.requestStop());
      else runner.requestStop();
      if (kind === 'throw') throw Error('private callback');
      if (kind === 'deadline') { const end = performance.now() + 8; while (performance.now() < end) {} }
      return handle;
    };
    if (kind === 'deadline') f.profile.executorTimeoutMs = 2;
    runner = create(f); const report = await runner.run();
    const expected = { source: 'RUNNER_SOURCE_UNCONFIRMED', throw: 'RUNNER_CALLBACK_OR_CONTRACT_ERROR',
      result: 'RUNNER_RESULT_UNCONFIRMED', settled: 'RUNNER_SETTLEMENT_UNCONFIRMED', deadline: 'RUNNER_DEADLINE' };
    assert.equal(report.stopReason, expected[kind], kind); assert.equal(report.stopRequested, true);
    assert.equal(report.counts.oracleStarted, 0); assert(!JSON.stringify(report).includes('private'));
  }
});

test('stop requests during drain or FINAL are refused; one cancellation and one final remain authoritative', async () => {
  const f = fixture(), started = deferred(), result = deferred(), settling = deferred(), cancelReady = deferred(), cancelled = deferred();
  let runner, cancelCalls = 0, finalStop;
  f.host.startExecutor = () => { started.resolve(); return { result: result.promise, settled: settling.promise,
    status: () => 'IDLE', cancel: () => { cancelCalls++; cancelReady.resolve(); return cancelled.promise; } }; };
  f.host.retain = async event => { f.events.push(event); if (event.type === 'FINAL') finalStop = runner.requestStop(); };
  runner = create(f); const running = runner.run(); await started.promise; runner.requestStop(); await cancelReady.promise;
  assert.equal(runner.inspect().stopAcceptanceClosed, true); assert.equal(runner.requestStop().status, 'REFUSED');
  result.reject(Error('late')); settling.resolve(); cancelled.resolve();
  const report = await running; stopped(report); assert.equal(cancelCalls, 1); assert.equal(finalStop.status, 'REFUSED'); finalConsistency(f);
  const complete = fixture(); let owner, finalRequest;
  complete.host.retain = async event => { complete.events.push(event); if (event.type === 'FINAL') finalRequest = owner.requestStop(); };
  owner = create(complete); const success = await owner.run();
  assert.equal(success.status, 'COMPLETE'); assert.equal(success.stopRequested, false); assert.equal(finalRequest.status, 'REFUSED'); finalConsistency(complete);
});

test('last oracle acknowledgment is committed before stop, preserving all completed rows in final reconciliation', async () => {
  const f = fixture(); let runner, oracleResults = 0;
  f.host.retain = async event => { f.events.push(event);
    if (event.type === 'PHASE_RESULT' && event.phase === 'ORACLE' && ++oracleResults === 4) runner.requestStop(); };
  runner = create(f); const report = await runner.run(); stopped(report);
  assert.equal(report.counts.completed, 4); assert(report.records.every(row => row.status === 'COMPLETED' && row.reason === null));
  finalConsistency(f);
});

test('a rejected FINAL attempt is not acknowledged evidence and cannot reconcile as final', async () => {
  const f = fixture(), committed = []; let runner;
  f.host.retain = async event => {
    f.events.push(event);
    if (event.type === 'FINAL') throw Error('private final failure');
    committed.push(event);
    if (event.type === 'SCHEDULE') runner.requestStop();
  };
  runner = create(f); const report = await runner.run(); stopped(report);
  assert.equal(report.retentionStatus, 'UNCONFIRMED'); assert.equal(committed.some(e => e.type === 'FINAL'), false);
  assert.equal(f.events.filter(e => e.type === 'FINAL').length, 1);
  assert.equal(reconcileTrialRetentionEventsV1({ events: committed, byteStatus: 'INCOMPLETE' }).status, 'INTERRUPTED');
  assert(!JSON.stringify(report).includes('private final failure'));
});

test('asynchronously pending FINAL refuses stop and preserves the final row snapshot', async () => {
  const f = fixture(), entered = deferred(), ack = deferred(); let final;
  f.host.retain = event => { f.events.push(event); if (event.type === 'FINAL') { final = event; entered.resolve(); return ack.promise; } return Promise.resolve(); };
  const runner = create(f), running = runner.run(); await entered.promise;
  assert.equal(runner.inspect().status, 'RUNNING'); assert.equal(runner.inspect().stopAcceptanceClosed, true);
  assert.equal(runner.requestStop().status, 'REFUSED'); assert.equal(runner.inspect().stopRequested, false);
  ack.resolve(); const report = await running; assert.equal(report.status, 'COMPLETE');
  assert.deepEqual(final.states, report.records.map(row => ({ requestId: row.intent.requestId, status: row.status, reason: row.reason })));
  finalConsistency(f);
});
