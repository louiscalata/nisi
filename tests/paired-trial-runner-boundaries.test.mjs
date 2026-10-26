import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createPairedTrialRunnerV1 } from '../evaluation/paired-trial-runner-v1.mjs';
import { readPreventionExperimentPlanV1 } from '../evaluation/prevention-experiment-plan-v1.mjs';
import { readPreventionExecutionProfileV1 } from '../evaluation/prevention-execution-profile-v1.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const operation = value => ({ result: Promise.resolve(value), settled: Promise.resolve(), status: () => 'IDLE', cancel: () => {} });
function fixture() {
  const plan = { schemaVersion: 'nisi-prevention-experiment-plan-v1', planId: 'plan.config',
    policy: { version: 'policy.v1', sha256: hash('required testing and rollback'), influenceEnabled: false },
    proposer: 'author', acceptanceReviewer: 'reviewer', trainingDigests: [],
    tasks: [{ caseId: 'case.config', taskSha256: hash('write deploy config'), baselineSha256: hash('{}'),
      oracleSha256: hash('JSON required keys: testing, rollback'), armOrder: ['OFF_ON', 'ON_OFF'] }], repetitions: 2, exclusions: [],
    budget: { maxDurationMs: 5000, maxModelCalls: 100, maxInputTokens: 10000, maxOutputTokens: 10000 }, measuredTelemetry: 'UNKNOWN_UNTIL_RUN' };
  const profile = { schemaVersion: 'nisi-prevention-execution-profile-v1', planSha256: readPreventionExperimentPlanV1(plan).planSha256,
    model: 'reviewed-fixed-json-fixture', modelSettingsSha256: hash('fixed'), toolchainSha256: hash('node'), resourceBudgetSha256: hash('fixture-budget'),
    trialPolicy: { version: plan.policy.version, sha256: plan.policy.sha256 },
    executorTimeoutMs: 200, oracleTimeoutMs: 200, retentionTimeoutMs: 200, drainTimeoutMs: 10 };
  const events = [], calls = [];
  const executor = intent => {
    const candidateText = JSON.stringify(intent.arm === 'ON' ? { testing: true, rollback: true } : { testing: true });
    return { requestId: intent.requestId, profileSha256: intent.profileSha256,
      candidateText, candidateSha256: hash(candidateText), completionClaim: true,
      tokenUsage: { input: 0, output: 0 }, durationMs: null, repairAttempts: 0, modelCalls: 0 };
  };
  const host = { verifyInputs: () => true,
    retain: event => { events.push(event); return Promise.resolve(); },
    startExecutor: intent => { calls.push(intent); return operation(executor(intent)); },
    startOracle: request => {
      // This checker evaluates the actual frozen text, not a model's verdict.
      const data = JSON.parse(request.candidateText);
      return operation({ requestId: request.requestId, oracleSha256: request.oracleSha256,
        oracleCandidateSha256: hash(request.candidateText), outcome: data.testing === true && data.rollback === true ? 'PASS' : 'FAIL' });
    } };
  return { plan, profile, host, events, calls, executor };
}
const create = f => createPairedTrialRunnerV1({ plan: f.plan, profile: f.profile, host: f.host });
const rebind = f => { f.profile.planSha256 = readPreventionExperimentPlanV1(f.plan).planSha256; };

test('actual fixed JSON before/after oracle, full denominators, no performance or model claim', async () => {
  const f = fixture(), runner = create(f), report = await runner.run();
  assert.equal(report.status, 'COMPLETE');
  assert.deepEqual(f.calls.map(x => x.arm), ['OFF', 'ON', 'ON', 'OFF']);
  assert.equal(report.counts.executorStarted, 4); assert.equal(report.counts.uniqueTasks, 1);
  assert.equal(report.counts.oraclePass, 2); assert.equal(report.counts.oracleFail, 2);
  assert.equal(report.counts.claims, 4); assert.equal(report.counts.incorrectClaims, 2);
  assert.equal(report.usage.input.unknown, false); assert.equal(report.usage.modelCalls.knownSubtotal, '0');
  assert.equal(report.batches[0].pairedRows.pairs[0].off.durationMs, null);
  assert.equal(report.batches.length, 2);
  for (const batch of report.batches) {
    assert.equal(batch.pairedRows.pairs[0].caseId, 'case.config');
    assert.equal(batch.pairedRows.pairs[0].off.outcome, 'FAIL');
    assert.equal(batch.pairedRows.pairs[0].on.outcome, 'PASS');
  }
  assert.equal(JSON.stringify(report).includes('candidateText'), false);
  assert.equal(JSON.stringify(f.events).includes('candidateText'), false);
  assert.equal(report.authorizing, false); assert.equal(report.promotionEligible, false);
  assert.equal(report.measurementVerified, false); assert.equal(report.causalClaim, false);
  assert(Object.isFrozen(report.records[0].executor));
});

test('mismatching actual candidate bytes stops before oracle and leaves missing slots', async () => {
  const f = fixture(); let oracleCalls = 0;
  f.host.startExecutor = intent => operation({ ...f.executor(intent), candidateText: 'different' });
  f.host.startOracle = () => { oracleCalls++; throw Error('must not run'); };
  const report = await create(f).run();
  assert.equal(report.stopReason, 'RUNNER_CANDIDATE_BINDING'); assert.equal(oracleCalls, 0);
  assert.equal(report.counts.executorStarted, 1); assert.equal(report.counts.notStarted, 3);
  assert.equal(report.counts.missingCompletionClaim, 1); assert.equal(report.usage.modelCalls.unknown, true);
  assert.equal(report.batches[0].pairedRows, null);
});

test('start can have an effect then throw a primitive: record attempted and quarantine', async () => {
  const f = fixture(); let effects = 0;
  f.host.startExecutor = () => { effects++; throw 'not an Error'; };
  const report = await create(f).run();
  assert.equal(effects, 1); assert.equal(report.status, 'STOPPED');
  assert.equal(report.records[0].status, 'ERROR'); assert.equal(report.counts.executorStarted, 1);
  assert.equal(report.drain.status, 'UNCONFIRMED');
  assert.equal(f.events.find(e => e.type === 'START_INTENT').phase, 'EXECUTOR');
  assert.equal(report.events.find(e => e.type === 'START_ATTEMPTED').phase, 'EXECUTOR');
});

test('late retention fulfillment cannot dispatch, persist another write, or change returned snapshot', async () => {
  const f = fixture(), late = deferred(); let writes = 0;
  f.profile.retentionTimeoutMs = 5;
  f.host.retain = event => { writes++; return event.type === 'START_INTENT' ? late.promise : Promise.resolve(); };
  const runner = create(f), report = await runner.run();
  assert.equal(report.retentionStatus, 'UNCONFIRMED'); assert.equal(report.retentionSettlement, 'PENDING');
  assert.equal(f.calls.length, 0); assert.equal(writes, 2);
  late.resolve(); await late.promise;
  const after = await runner.recheckDrain();
  assert.equal(after.retentionSettlement, 'FULFILLED'); assert.equal(after.retentionStatus, 'UNCONFIRMED');
  assert.equal(report.retentionSettlement, 'PENDING'); assert.equal(f.calls.length, 0); assert.equal(writes, 2);
});

test('late original result and drain never promote timed-out arm or start a replacement', async () => {
  const f = fixture(), result = deferred(), settled = deferred(); let state = 'BUSY', cancellations = 0, original;
  f.profile.executorTimeoutMs = 5;
  f.host.startExecutor = intent => { original = intent; return { result: result.promise, settled: settled.promise,
    status: () => state, cancel: () => { cancellations++; } }; };
  const runner = create(f), report = await runner.run();
  assert.equal(report.status, 'STOPPED'); assert.equal(report.drain.status, 'UNCONFIRMED');
  assert.equal(cancellations, 1); assert.equal(report.records[0].executor, null);
  result.resolve(f.executor(original)); settled.resolve(); state = 'IDLE';
  const after = await runner.recheckDrain();
  assert.equal(after.drain.status, 'OFF'); assert.equal(after.status, 'STOPPED');
  assert.equal(after.records[0].executor, null); assert.equal(after.counts.executorStarted, 1);
  assert.equal(report.drain.status, 'UNCONFIRMED'); assert.equal(cancellations, 1);
});

test('declared model/token limits prevent subsequent dispatch but do not claim provider enforcement', async () => {
  for (const category of ['modelCalls', 'input', 'output']) {
    const f = fixture();
    f.host.startExecutor = intent => operation({ ...f.executor(intent),
      modelCalls: category === 'modelCalls' ? 100 : 0,
      tokenUsage: { input: category === 'input' ? 10000 : 0, output: category === 'output' ? 10000 : 0 } });
    const report = await create(f).run();
    assert.equal(report.counts.executorStarted, 1); assert.equal(report.counts.oracleStarted, 1);
    assert.equal(report.reportedBudgetExhausted, true);
    assert.equal(report.stopReason, 'RUNNER_REPORTED_BUDGET_EXHAUSTED');
    assert.match(report.budgetEnforcement.modelCalls, /NOT_PROVIDER_ENFORCED/);
  }
});

test('source drift caused during retention refuses dispatch after previously successful check', async () => {
  const f = fixture(); let valid = true;
  f.host.verifyInputs = () => valid;
  f.host.retain = event => { if (event.type === 'START_INTENT') valid = false; return Promise.resolve(); };
  const report = await create(f).run();
  assert.equal(report.counts.executorStarted, 0); assert.equal(report.stopReason, 'RUNNER_SOURCE_UNCONFIRMED');
});

test('time spent retaining counts against total dispatch eligibility', async () => {
  const f = fixture(); f.plan.budget.maxDurationMs = 5; rebind(f);
  f.host.retain = () => new Promise(resolve => setTimeout(resolve, 10));
  const report = await create(f).run();
  assert.equal(report.stopReason, 'RUNNER_DEADLINE'); assert.equal(report.counts.executorStarted, 0);
});

test('upper plan bound remains 32 batches of 256 original cases, even if no work starts', async () => {
  const f = fixture(); f.plan.repetitions = 32;
  f.plan.tasks = Array.from({ length: 256 }, (_, n) => ({ ...f.plan.tasks[0], caseId: `case.${n}`,
    taskSha256: hash(`task.${n}`), armOrder: Array.from({ length: 32 }, (_, r) => r % 2 ? 'ON_OFF' : 'OFF_ON') }));
  rebind(f); f.host.verifyInputs = () => false;
  const report = await create(f).run();
  assert.equal(report.counts.planned, 16384); assert.equal(report.counts.uniqueTasks, 256);
  assert.equal(report.batches.length, 32);
  for (const batch of report.batches) { assert.equal(batch.unpaired.length, 256); assert.equal(batch.pairedRows, null); }
  assert.equal(new Set(report.records.map(r => r.intent.requestId)).size, 16384);
});

test('execution profile exact schema, bound hashes, timeouts and descriptor safety', () => {
  const f = fixture(); let calls = 0;
  const read = value => readPreventionExecutionProfileV1(value, f.profile.planSha256, f.plan.policy);
  assert(Object.isFrozen(read(f.profile).trialPolicy));
  for (const key of ['planSha256', 'modelSettingsSha256', 'toolchainSha256', 'resourceBudgetSha256']) {
    assert.throws(() => read({ ...f.profile, [key]: `${f.profile[key]}\n` }));
  }
  for (const value of [0, -0, 120001, null, NaN, 1.5]) assert.throws(() => read({ ...f.profile, executorTimeoutMs: value }));
  assert.throws(() => read({ ...f.profile, trialPolicy: { ...f.profile.trialPolicy, sha256: hash('other') } }));
  const accessor = { ...f.profile }; Object.defineProperty(accessor, 'model', { enumerable: true, get() { calls++; return 'bad'; } });
  assert.throws(() => read(accessor)); assert.equal(calls, 0);
  assert.throws(() => read({ ...f.profile, extra: true }));
});

test('unknown budget telemetry stops future executors after current oracle, not zero-filled', async () => {
  const f = fixture(); f.host.startExecutor = intent => operation({ ...f.executor(intent), tokenUsage: null, modelCalls: null });
  const report = await create(f).run();
  assert.equal(report.stopReason, 'RUNNER_REPORTED_BUDGET_UNCONFIRMED');
  assert.equal(report.counts.executorStarted, 1); assert.equal(report.counts.oracleStarted, 1);
  assert.equal(report.reportedBudgetStatus, 'UNKNOWN'); assert.equal(report.reportedBudgetExhausted, false);
  assert.equal(report.records[0].executor.tokenUsage, null); assert.equal(report.counts.notStarted, 3);
});

test('unretained oracle result is adverse and cannot complete a pair', async () => {
  const f = fixture(); let oracleWrites = 0;
  f.host.retain = event => {
    if (event.type === 'PHASE_RESULT' && event.phase === 'ORACLE' && ++oracleWrites === 2) return Promise.reject(Error('store failed'));
    return Promise.resolve();
  };
  const report = await create(f).run();
  assert.equal(report.retentionStatus, 'UNCONFIRMED'); assert.equal(report.counts.completed, 1);
  assert.equal(report.records[1].status, 'ERROR'); assert.equal(report.records[1].oracle.outcome, 'PASS');
  assert.equal(report.records[1].oracleRetained, false); assert.equal(report.batches[0].pairedRows, null);
  assert.equal(report.counts.executorStarted, 2); assert.equal(report.counts.notStarted, 2);
});

test('success retains original settlement observations before marking complete', async () => {
  const f = fixture(), report = await create(f).run();
  for (const row of report.records) {
    for (const phase of ['executor', 'oracle']) {
      assert.deepEqual(row[`${phase}Observation`], { resultSettlement: 'FULFILLED', ownerSettlement: 'FULFILLED',
        ownerStatus: 'IDLE', deadline: 'WITHIN_OBSERVATION_WINDOW' });
      assert.equal(row[`${phase}Retained`], true);
    }
  }
  assert.equal(f.events.filter(e => e.type === 'PHASE_RESULT' && e.observation.ownerSettlement === 'FULFILLED').length, 8);
});

test('unknown verdict claims are separate from missing completion fields', async () => {
  const f = fixture();
  f.host.startOracle = request => operation({ requestId: request.requestId, oracleSha256: request.oracleSha256,
    oracleCandidateSha256: request.candidateSha256, outcome: 'INCONCLUSIVE' });
  const report = await create(f).run();
  assert.equal(report.counts.claims, 4); assert.equal(report.counts.unknownClaims, 4);
  assert.equal(report.counts.missingCompletionClaim, 0); assert.equal(report.counts.incorrectClaims, 0);
});

test('synchronous late-returning start is attempted but never accepted; this is not preemption', async () => {
  const f = fixture(); f.profile.executorTimeoutMs = 2; let cancels = 0;
  f.host.startExecutor = intent => {
    const until = performance.now() + 8; while (performance.now() < until) { /* reviewed bounded blocking control */ }
    return { ...operation(f.executor(intent)), cancel: () => { cancels++; } };
  };
  const report = await create(f).run();
  assert.equal(report.status, 'STOPPED'); assert.equal(report.counts.executorStarted, 1);
  assert.equal(report.counts.completed, 0); assert.equal(cancels, 1);
});

test('capture host and operation refs; subsequent caller mutation cannot redirect callbacks', async () => {
  const f = fixture(), original = f.host.startExecutor; let replacements = 0;
  const runner = create(f);
  f.host.startExecutor = () => { replacements++; throw Error('not captured'); };
  f.profile.model = 'mutated'; f.plan.tasks[0].caseId = 'mutated';
  const report = await runner.run();
  assert.equal(report.status, 'COMPLETE'); assert.equal(replacements, 0); assert.equal(f.calls.length, 4);
  assert.equal(report.records[0].intent.caseId, 'case.config'); assert.equal(typeof original, 'function');
});

test('one-shot invocation, invalid args and separate fresh experiment identities', async () => {
  const f = fixture(), a = create(f), b = create(f);
  assert.notEqual(a.inspect().records[0].intent.requestId, b.inspect().records[0].intent.requestId);
  await assert.rejects(a.run({}), { code: 'RUNNER_ARGUMENTS' });
  await a.run(); await assert.rejects(a.run(), { code: 'RUNNER_ALREADY_RAN' });
});

test('rejected promises in malformed handles remain observed; no accessor invocation', async () => {
  const f = fixture(); let getters = 0;
  f.host.startExecutor = () => ({ result: Promise.reject(Error('private')), settled: Promise.reject(Error('private')),
    get status() { getters++; return () => 'IDLE'; }, cancel() {} });
  const report = await create(f).run();
  assert.equal(getters, 0); assert.equal(report.status, 'STOPPED'); assert.equal(report.drain.status, 'UNCONFIRMED');
  assert.equal(report.counts.executorStarted, 1);
});

test('stale oracle binds exact request, declared oracle and candidate, not another arm', async () => {
  for (const field of ['requestId', 'oracleSha256', 'oracleCandidateSha256']) {
    const f = fixture();
    f.host.startOracle = request => operation({ requestId: request.requestId, oracleSha256: request.oracleSha256,
      oracleCandidateSha256: request.candidateSha256, outcome: 'PASS', [field]: hash('stale') });
    const report = await create(f).run();
    assert.equal(report.stopReason, 'RUNNER_ORACLE_BINDING'); assert.equal(report.counts.executorStarted, 1);
    assert.equal(report.counts.unknownClaims, 1); assert.equal(report.counts.missingOracle, 1);
    assert.equal(report.batches[0].pairedRows, null);
  }
});

test('unknown ownership status and rejected or pending cancellation cannot clear drain', async () => {
  for (const kind of ['status-throws', 'cancel-rejects', 'cancel-pending', 'settlement-rejects']) {
    const f = fixture(); let cancellations = 0;
    f.profile.executorTimeoutMs = 5;
    f.host.startExecutor = intent => ({ result: kind === 'settlement-rejects' ? Promise.resolve(f.executor(intent)) : new Promise(() => {}),
      settled: kind === 'settlement-rejects' ? Promise.reject(Error('settlement failed')) : Promise.resolve(),
      status: () => { if (kind === 'status-throws') throw Error('cannot inspect'); return 'IDLE'; },
      cancel: () => { cancellations++; if (kind === 'cancel-rejects') return Promise.reject(Error('cancel failed'));
        if (kind === 'cancel-pending') return new Promise(() => {}); } });
    const runner = create(f), report = await runner.run();
    assert.equal(report.status, 'STOPPED'); assert.equal(report.drain.status, 'UNCONFIRMED');
    assert.equal(report.counts.executorStarted, 1); assert.equal(cancellations, 1);
    await runner.recheckDrain(); assert.equal(cancellations, 1);
  }
});

test('status BUSY despite fulfilled result/settled refuses oracle and cancels exactly once', async () => {
  const f = fixture(); let cancels = 0;
  f.host.startExecutor = intent => ({ ...operation(f.executor(intent)), status: () => 'BUSY', cancel: () => { cancels++; } });
  const runner = create(f), report = await runner.run();
  assert.equal(report.stopReason, 'RUNNER_OWNER_UNCONFIRMED'); assert.equal(report.counts.oracleStarted, 0);
  assert.equal(report.drain.status, 'UNCONFIRMED'); await runner.recheckDrain(); assert.equal(cancels, 1);
});

test('callback-thrown messages and raw content are not copied into diagnostic errors', async () => {
  const f = fixture();
  f.host.startExecutor = () => { throw Object.assign(Error('private raw candidate'), { code: 'RUNNER_FAKE\n' }); };
  const report = await create(f).run();
  assert.equal(report.stopReason, 'RUNNER_CALLBACK_OR_CONTRACT_ERROR');
  assert.equal(JSON.stringify(report).includes('private raw candidate'), false);
});

test('canonical promise handlers are used even if caller replaced then method', async () => {
  const f = fixture(); let traps = 0;
  f.host.startExecutor = intent => {
    const handle = operation(f.executor(intent));
    handle.result.then = () => { traps++; throw Error('not called'); };
    handle.settled.then = () => { traps++; throw Error('not called'); };
    return handle;
  };
  const report = await create(f).run(); assert.equal(report.status, 'COMPLETE'); assert.equal(traps, 0);
});

test('two-task declaration order, retained intents and oracle isolation are exact', async () => {
  const f = fixture(); f.plan.tasks.push({ ...f.plan.tasks[0], caseId: 'case.second', taskSha256: hash('second'), armOrder: ['ON_OFF', 'OFF_ON'] });
  rebind(f);
  const start = f.host.startExecutor, oracle = f.host.startOracle;
  f.host.startExecutor = intent => {
    assert.equal(f.events.at(-1).type, 'START_INTENT'); assert.equal(f.events.at(-1).phase, 'EXECUTOR');
    assert.equal(f.events.at(-1).requestId, intent.requestId); assert(Object.isFrozen(intent));
    assert.equal(intent.policyMode, intent.arm === 'ON' ? 'ISOLATED_TRIAL' : 'OFF');
    assert.equal(intent.trialPolicy === null, intent.arm === 'OFF');
    return start(intent);
  };
  f.host.startOracle = request => {
    assert.deepEqual(Object.keys(request).sort(), ['candidateSha256', 'candidateText', 'oracleSha256', 'requestId']);
    assert.equal(f.events.at(-1).phase, 'ORACLE'); assert.equal(f.events.at(-1).requestId, request.requestId);
    assert(Object.isFrozen(request)); return oracle(request);
  };
  const report = await create(f).run();
  assert.equal(report.status, 'COMPLETE'); assert.equal(report.counts.executorStarted, 8);
  assert.deepEqual(f.calls.map(x => `${x.repetition}/${x.caseId}/${x.arm}`), [
    '0/case.config/OFF', '0/case.config/ON', '0/case.second/ON', '0/case.second/OFF',
    '1/case.config/ON', '1/case.config/OFF', '1/case.second/OFF', '1/case.second/ON']);
  assert.equal(new Set(f.calls.map(x => x.requestId)).size, 8);
});

test('profile digest is independent of input property insertion order', () => {
  const f = fixture(), reordered = Object.fromEntries(Object.entries(f.profile).reverse());
  reordered.trialPolicy = Object.fromEntries(Object.entries(reordered.trialPolicy).reverse());
  const read = value => readPreventionExecutionProfileV1(value, f.profile.planSha256, f.plan.policy);
  assert.equal(read(f.profile).profileSha256, read(reordered).profileSha256);
});

test('pending result cannot clear drain even if settled fulfills and owner reports IDLE', async () => {
  for (const outcome of ['fulfill', 'reject']) {
    const f = fixture(), result = deferred(); let cancels = 0, intent;
    f.profile.executorTimeoutMs = 5;
    f.host.startExecutor = request => { intent = request; return { result: result.promise, settled: Promise.resolve(),
      status: () => 'IDLE', cancel: () => { cancels++; } }; };
    const runner = create(f), report = await runner.run();
    assert.equal(report.drain.status, 'UNCONFIRMED');
    assert.equal((await runner.recheckDrain()).drain.status, 'UNCONFIRMED');
    if (outcome === 'fulfill') result.resolve(f.executor(intent)); else result.reject(Error('late failure'));
    const after = await runner.recheckDrain();
    assert.equal(after.drain.status, 'OFF'); assert.equal(after.status, 'STOPPED');
    assert.equal(after.records[0].status, 'ERROR'); assert.equal(after.records[0].executor, null);
    assert.equal(after.counts.executorStarted, 1); assert.equal(after.counts.notStarted, 3); assert.equal(cancels, 1);
    assert.equal(after.events.at(-1).result, outcome === 'fulfill' ? 'FULFILLED' : 'REJECTED');
  }
});
