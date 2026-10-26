// Actual command orchestration, with inert collaborators and in-memory storage.
// These tests establish no native/model/isolation/workflow acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { register } from 'node:module';
import { setImmediate as tick } from 'node:timers/promises';
import { withPreflightGuards } from './helpers/live-cli-side-effect-guard.mjs';
import { inspectStoredDemoSummaryV1 } from '../cli/stored-summary-v1.mjs';

const cliURL = new URL('../examples/repository-live-model.mjs', import.meta.url);
register(new URL('./helpers/live-cli-main-loader.mjs', import.meta.url), { data: { target: cliURL.href } });
const { runPrivateLiveDemo } = await import(cliURL);
const key = Symbol.for('nisi.live-cli.main-test');
const coded = code => Object.assign(new Error(code), { code });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const argv = ['--approved-reviewed-fixture', '--endpoint', 'http://127.0.0.1:1234/v1/chat/completions',
  '--author-model', 'synthetic.author', '--reviewer-model', 'synthetic.reviewer'];

function scenario(overrides = {}) {
  const files = new Map(), attempts = [], calls = [];
  const report = Object.freeze({ outcome: 'COMPLETED', workflowOutcome: 'COMPLETED', code: null });
  const result = Object.freeze({ state: 'SETTLED', report });
  const materialization = Object.freeze({ schemaVersion: 'nisi-repository-materialization-diagnostics/v1',
    availability: 'AVAILABLE', reason: null, rows: [{ root: '/synthetic/retained-root', state: 'SETTLED' }], error: null, authorizing: false });
  let hostState = 'NEW';
  const host = {
    async run(options) { calls.push('run'); hostState = 'RUNNING'; return overrides.run ? overrides.run(options) : report; },
    async settled() { calls.push('settled'); hostState = 'SETTLING';
      try { const value = await (overrides.settled ? overrides.settled() : result); hostState = 'SETTLED'; return value; }
      catch (e) { hostState = 'QUARANTINED'; throw e; } },
    status() { calls.push('status'); if (overrides.statusError) throw overrides.statusError; return hostState; },
    lateObservations() { calls.push('late'); if (overrides.lateError) throw overrides.lateError; return { staticChecks: [], tests: [] }; },
    materializationObservations() { calls.push('materialization'); if (overrides.materializationError) throw overrides.materializationError;
      return overrides.materialization ?? materialization; },
  };
  let snapshots = 0;
  const lane = {
    authorizeContext() {}, author: {}, reviewers: [],
    revoke() { calls.push('revoke'); overrides.revoke?.(); },
    executionOwners: () => [Object.freeze({ id: 'model.shared',
      status: () => overrides.modelStatus?.() ?? 'IDLE',
      settled: () => { calls.push('model.settled'); return overrides.modelSettled?.() ?? Promise.resolve(); },
      cancel: () => { throw Error('bridge must use lane-wide cancelOnce'); } })],
    snapshot() { calls.push('snapshot'); snapshots++;
      if (overrides.snapshotError && snapshots > 1) throw overrides.snapshotError;
      return { phase: 'SYNTHETIC', lifecycle: { pendingTransports: 0 } }; },
  };
  const state = {
    fixture: async () => ({ suite: {}, task: {}, reviewedSourceManifest: [], reviewedSourceFingerprint: 'synthetic', preparations: [], targets: [] }),
    lane: () => lane, host: () => host, build: options => { overrides.onBuild?.(options); return { synthetic: true }; },
    receipt: () => { calls.push('receipt.create'); return { status: 'SCOPED_LIVE_REPAIR_REVIEW_PASS', fingerprint: 'a'.repeat(64), usage: null }; },
    readReceipt: () => { calls.push('receipt.read'); },
    fs: {
      async mkdir(target) {overrides.onMkdir?.(target);}, async mkdtemp(prefix) {overrides.onMkdtemp?.(prefix);return '/synthetic/repository-live-demo';},
      async writeFile(target, content, options) {
        const name = path.basename(target); attempts.push(name);
        calls.push(`write:${name}`);
        assert.deepEqual(options, { flag: 'wx', mode: 0o600 });
        if (overrides.writeFailures?.includes(name)) throw coded('SYNTHETIC_WRITE');
        if (files.has(name)) throw coded('SYNTHETIC_COLLISION');
        files.set(name, JSON.parse(content));
        await overrides.onWrite?.(name);
      },
    },
  };
  return { state, files, attempts, calls, report, result, materialization };
}
async function withScenario(s, fn) {
  assert.equal(globalThis[key], undefined);
  globalThis[key] = s.state;
  try { return await withPreflightGuards(fn); }
  finally { delete globalThis[key]; }
}
const errors = out => out.diagnosticErrors.map(row => `${row.stage}:${row.code}`);

test('preflight preserves source-admission refusal before lane or execution effects', async () => {
  const s = scenario(), effects = [];
  s.state.fixture = async () => { throw coded('LIVE_FIXTURE_SOURCE_HASH'); };
  for (const name of ['lane', 'host', 'build', 'receipt', 'readReceipt']) s.state[name] = () => { effects.push(name); throw coded('TEST_EFFECT'); };
  for (const name of ['mkdir', 'mkdtemp', 'writeFile']) s.state.fs[name] = () => { effects.push(name); throw coded('TEST_EFFECT'); };
  await withScenario(s, async () => {
    await assert.rejects(runPrivateLiveDemo([...argv, '--preflight-only']), { code: 'LIVE_FIXTURE_SOURCE_HASH' });
    assert.deepEqual(effects, []); assert.deepEqual(s.attempts, []); assert.deepEqual(s.calls, []);
  });
});

test('explicit external state reaches run creation, native builder and separate storage metadata',async t=>{
  const state=fs.mkdtempSync(path.join(os.tmpdir(),'nisi-cli-state-propagation-'));
  t.after(()=>fs.rmSync(state,{recursive:true,force:true}));
  const canonical=fs.realpathSync(state),mkdirs=[],prefixes=[],builds=[];
  const s=scenario({onBuild:options=>builds.push(options),onMkdir:target=>mkdirs.push(target),onMkdtemp:prefix=>prefixes.push(prefix)});
  await withScenario(s,async()=>{
    const out=await runPrivateLiveDemo([...argv,'--state-dir',state],{requireExternalState:true});
    assert.equal(out.exitCode,0);assert.deepEqual(builds,[{buildRoot:canonical}]);
    assert.deepEqual(prefixes,[path.join(canonical,'repository-live-demo-')]);
    assert.deepEqual(mkdirs,['/synthetic/repository-live-demo/workspaces']);
    assert.equal(s.files.get('storage.json').stateRoot,canonical);
    assert.equal(s.files.get('storage.json').reservationScope,'STATE_ROOT_ONLY');
    assert.equal(s.files.get('storage.json').hostileWriterIsolation,false);
    assert.equal(fs.readdirSync(state).length,0); // storage collaborator is inert
  });
});

test('main command retains separate materialization diagnostics and original workflow outcome', async () => {
  const s = scenario();
  await withScenario(s, async () => {
    const out = await runPrivateLiveDemo(argv);
    assert.deepEqual(s.files.get('host-materialization-observations.json'), s.materialization);
    assert.equal(out.workflowOutcome, 'COMPLETED');
    assert.equal(out.status, 'SCOPED_LIVE_REPAIR_REVIEW_PASS');
    assert.equal(out.exitCode, 0);
    assert.equal(out.remoteInferenceStopped, 'NOT_OBSERVED');
    assert.equal(out.publicationAuthorized, false);
    assert.equal(s.calls.filter(x => x === 'settled').length, 1);
    // Actual summary producer, inert workflow/model/storage collaborators.
    const observed = inspectStoredDemoSummaryV1(Buffer.from(JSON.stringify(s.files.get('summary.json'),null,2)+'\n'));
    assert.equal(observed.reportedStatus,out.status); assert.equal(observed.accepted,false);
    assert.equal(observed.declaredArtifactCount,out.retained.length);
  });
});

test('main command keeps materialization evidence despite independent report and late-history write failures', async () => {
  const s = scenario({ writeFailures: ['engine-report.json', 'host-late-observations.json'] });
  await withScenario(s, async () => {
    const out = await runPrivateLiveDemo(argv);
    assert.equal(out.status, 'INCOMPLETE');
    assert.equal(out.workflowOutcome, 'COMPLETED');
    assert.equal(out.hostState, 'SETTLED');
    assert.deepEqual(s.files.get('host-result.json'), s.result);
    assert.deepEqual(s.files.get('host-materialization-observations.json'), s.materialization);
    assert.ok(errors(out).includes('engine-report.json:SYNTHETIC_WRITE'));
    assert.ok(errors(out).includes('host-late-observations.json:SYNTHETIC_WRITE'));
  });
});

test('main command does not certify a successful receipt with unavailable materialization diagnostics', async () => {
  const unavailable = { schemaVersion: 'nisi-repository-materialization-diagnostics/v1', availability: 'UNAVAILABLE',
    reason: 'READ_FAILED', rows: [], error: { code: 'SYNTHETIC_READ' }, authorizing: false };
  const s = scenario({ materialization: unavailable });
  await withScenario(s, async () => {
    const out = await runPrivateLiveDemo(argv);
    assert.deepEqual(s.files.get('host-materialization-observations.json'), unavailable);
    assert.equal(out.status, 'INCOMPLETE');
    assert.equal(out.exitCode, 1);
    assert.ok(errors(out).includes('host.materializationObservations:LIVE_DEMO_MATERIALIZATION_UNAVAILABLE'));
  });
});

test('main command reports failed materialization retention independently', async () => {
  const s = scenario({ writeFailures: ['host-materialization-observations.json'] });
  await withScenario(s, async () => {
    const out = await runPrivateLiveDemo(argv);
    assert.equal(out.status, 'INCOMPLETE');
    assert.ok(errors(out).includes('host-materialization-observations.json:SYNTHETIC_WRITE'));
    assert.ok(s.files.has('model-lane-final.json'));
    assert.ok(s.files.has('host-late-observations.json'));
    assert.equal(out.summaryRetained, true);
  });
});

test('main command distinguishes available empty history from an unsupported diagnostics surface', async () => {
  for (const availability of ['AVAILABLE', 'UNAVAILABLE']) {
    const materialization = { schemaVersion: 'nisi-repository-materialization-diagnostics/v1', availability,
      reason: availability === 'AVAILABLE' ? null : 'NOT_SUPPORTED', rows: [], error: null, authorizing: false };
    const s = scenario({ materialization });
    await withScenario(s, async () => {
      const out = await runPrivateLiveDemo(argv);
      assert.deepEqual(s.files.get('host-materialization-observations.json'), materialization);
      assert.equal(out.status, availability === 'AVAILABLE' ? 'SCOPED_LIVE_REPAIR_REVIEW_PASS' : 'INCOMPLETE');
      assert.equal(out.exitCode, availability === 'AVAILABLE' ? 0 : 1);
    });
  }
});

test('main command records unavailable evidence even when its own diagnostic write also fails', async () => {
  const s = scenario({ writeFailures: ['host-materialization-observations.json'],
    materialization: { schemaVersion: 'nisi-repository-materialization-diagnostics/v1', availability: 'UNAVAILABLE',
      reason: 'READ_FAILED', rows: [], error: { code: 'SYNTHETIC_READ' }, authorizing: false } });
  await withScenario(s, async () => {
    const out = await runPrivateLiveDemo(argv);
    assert.equal(out.status, 'INCOMPLETE');
    assert.ok(errors(out).includes('host-materialization-observations.json:SYNTHETIC_WRITE'));
    assert.ok(errors(out).includes('host.materializationObservations:LIVE_DEMO_MATERIALIZATION_UNAVAILABLE'));
  });
});

test('main command refuses malformed or authorizing materialization evidence without discarding it', async () => {
  for (const changed of [{ schemaVersion: 'unknown' }, { authorizing: true }, { rows: null },
    { rows: new Array(203).fill(null) }, { reason: 'READ_FAILED' }, { error: { code: 'SYNTHETIC' } }]) {
    const materialization = { schemaVersion: 'nisi-repository-materialization-diagnostics/v1', availability: 'AVAILABLE',
      reason: null, rows: [], error: null, authorizing: false, ...changed };
    const s = scenario({ materialization });
    await withScenario(s, async () => {
      const out = await runPrivateLiveDemo(argv);
      assert.deepEqual(s.files.get('host-materialization-observations.json'), materialization);
      assert.equal(out.status, 'INCOMPLETE');
      assert.ok(errors(out).includes('host.materializationObservations:LIVE_DEMO_MATERIALIZATION_SCHEMA'));
    });
  }
});

test('main command observes pending settlement once after run rejection without inventing a report', async () => {
  const pending = deferred(), entered = deferred();
  const s = scenario({ run: async () => { throw coded('SYNTHETIC_RUN'); }, settled: () => { entered.resolve(); return pending.promise; } });
  await withScenario(s, async () => {
    let done = false;
    const task = runPrivateLiveDemo(argv).then(value => { done = true; return value; });
    await tick();
    assert.equal(s.calls.filter(x => x === 'settled').length, 1);
    await entered.promise;
    assert.equal(done, false);
    pending.resolve(s.result);
    const out = await task;
    assert.equal(out.errorCode, 'SYNTHETIC_RUN');
    assert.equal(out.workflowOutcome, null);
    assert.equal(out.status, 'INCOMPLETE');
    assert.equal(s.files.has('engine-report.json'), false);
    assert.ok(errors(out).includes('engine-report.json:LIVE_DEMO_ENGINE_REPORT_ABSENT'));
    assert.deepEqual(s.files.get('host-result.json'), s.result);
    assert.deepEqual(s.files.get('host-materialization-observations.json'), s.materialization);
  });
});

test('main command interruption aborts, revokes and observes settlement while restoring listeners', async () => {
  const s = scenario({ run: async ({ signal }) => {
    process.listeners('SIGINT').at(-1)();
    assert.equal(signal.aborted, true);
    throw coded('ABORTED');
  } });
  await withScenario(s, async () => {
    const out = await runPrivateLiveDemo(argv);
    assert.equal(out.errorCode, 'ABORTED');
    assert.equal(out.status, 'INCOMPLETE');
    assert.equal(s.calls.filter(x => x === 'revoke').length, 1);
    assert.equal(s.calls.filter(x => x === 'settled').length, 1);
    assert.deepEqual(s.files.get('host-materialization-observations.json'), s.materialization);
  });
});

test('main command final snapshot and status errors cannot discard other retained diagnostics', async () => {
  const s = scenario({ run: async () => { throw coded('SYNTHETIC_RUN'); },
    settled: async () => { throw coded('SYNTHETIC_SETTLEMENT'); },
    snapshotError: coded('SYNTHETIC_SNAPSHOT'), statusError: coded('SYNTHETIC_STATUS'), lateError: coded('SYNTHETIC_LATE') });
  await withScenario(s, async () => {
    const out = await runPrivateLiveDemo(argv);
    assert.equal(out.errorCode, 'SYNTHETIC_RUN');
    assert.equal(out.modelPhase, 'UNKNOWN');
    assert.equal(out.hostState, 'UNKNOWN');
    assert.equal(out.summaryRetained, true);
    for (const pair of ['host.settled:SYNTHETIC_SETTLEMENT', 'model-lane.snapshot:SYNTHETIC_SNAPSHOT',
      'host.status:SYNTHETIC_STATUS', 'host.lateObservations:SYNTHETIC_LATE']) assert.ok(errors(out).includes(pair), pair);
    assert.deepEqual(s.files.get('host-materialization-observations.json'), s.materialization);
  });
});

test('main command throwing diagnostics including an unsafe error getter remain adverse and summarized', async () => {
  const s = scenario({ materializationError: Object.defineProperty({}, 'code', { get() { throw Error('do not invoke twice'); } }) });
  await withScenario(s, async () => {
    const out = await runPrivateLiveDemo(argv);
    assert.equal(out.status, 'INCOMPLETE');
    assert.equal(out.summaryRetained, true);
    assert.ok(errors(out).includes('host.materializationObservations:LIVE_DEMO_ERROR'));
  });
});

test('main command invalid or throwing settled state is adverse without losing the summary', async () => {
  for (const value of [{ state: 'NOT_A_HOST_STATE' }, Object.defineProperty({}, 'state', { get() { throw coded('SYNTHETIC_STATE'); } })]) {
    const s = scenario({ settled: async () => value });
    await withScenario(s, async () => {
      const out = await runPrivateLiveDemo(argv);
      assert.equal(out.status, 'INCOMPLETE');
      assert.equal(out.hostState, 'UNKNOWN');
      assert.equal(out.summaryRetained, true);
      assert.ok(out.diagnosticErrors.some(row => row.stage === 'host-result.state'));
      assert.deepEqual(s.files.get('host-materialization-observations.json'), s.materialization);
    });
  }
});

test('main command summary storage failure returns an adverse in-memory result', async () => {
  const s = scenario({ writeFailures: ['summary.json'] });
  await withScenario(s, async () => {
    const out = await runPrivateLiveDemo(argv);
    assert.equal(out.status, 'INCOMPLETE');
    assert.equal(out.summaryRetained, false);
    assert.equal(out.exitCode, 1);
    assert.ok(errors(out).includes('summary.json:SYNTHETIC_WRITE'));
    assert.deepEqual(s.files.get('host-materialization-observations.json'), s.materialization);
  });
});

test('main command observation deadline is unconfirmed, not a host result or remote-stop claim', async t => {
  const s = scenario({ settled: () => new Promise(() => {}) });
  await withScenario(s, async () => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const task = runPrivateLiveDemo(argv);
      await tick();
      assert.equal(s.calls.filter(x => x === 'settled').length, 1);
      t.mock.timers.tick(30000);
      await tick();
      t.mock.timers.tick(2000);
      const out = await task;
      assert.equal(out.status, 'INCOMPLETE');
      assert.equal(out.hostState, 'SETTLING');
      assert.ok(errors(out).includes('host.settled:LIVE_DEMO_HOST_SETTLEMENT_UNCONFIRMED'));
      assert.equal(s.files.has('host-result.json'), false);
      assert.equal(out.remoteInferenceStopped, 'NOT_OBSERVED');
      assert.deepEqual(s.files.get('host-materialization-observations.json'), s.materialization);
      assert.equal(s.calls.filter(x => x === 'settled').length, 1);
    } finally { t.mock.timers.reset(); }
  });
});

test('main command refuses PASS when any immediate execution artifact write fails', async () => {
  for (const name of ['execution-intent.json','execution-final.json','execution-settlement.json']) {
    const s=scenario({writeFailures:[name]});
    await withScenario(s,async()=>{
      const out=await runPrivateLiveDemo(argv);
      assert.equal(out.status,'INCOMPLETE');assert.ok(errors(out).includes(`${name}:SYNTHETIC_WRITE`));
      assert.equal(s.calls.filter(x=>x==='settled').length,1);assert.equal(s.calls.filter(x=>x==='model.settled').length,1);
    });
  }
});

test('main command keeps late terminal evidence separate and linked without rewriting summary', async t => {
  const m=deferred();let settled=false;
  const s=scenario({modelSettled:()=>m.promise,modelStatus:()=>settled?'IDLE':'BUSY'});
  await withScenario(s,async()=>{
    t.mock.timers.enable({apis:['setTimeout']});
    try {
      const task=runPrivateLiveDemo(argv);await tick();t.mock.timers.tick(2000);
      const out=await task, before=JSON.stringify(out), summary=JSON.stringify(s.files.get('summary.json'));
      assert.equal(out.status,'INCOMPLETE');assert.equal(s.files.has('execution-settlement.json'),false);
      assert.equal(s.files.get('execution-final.json').observation.status,'UNCONFIRMED');
      settled=true;m.resolve();await tick();
      const late=s.files.get('execution-settlement.json');
      assert.equal(late.upgradesEarlierOutcome,false);assert.equal(late.remoteInferenceStopped,'NOT_OBSERVED');
      assert.equal(typeof late.observationSha256,'string');assert.equal(typeof late.intentSha256,'string');
      assert.equal(JSON.stringify(out),before);assert.equal(JSON.stringify(s.files.get('summary.json')),summary);
      assert.equal(s.calls.filter(x=>x==='model.settled').length,1);assert.equal(s.calls.filter(x=>x==='settled').length,1);
    } finally { t.mock.timers.reset(); }
  });
});

test('main command surfaces late retention failure without changing earlier summary', async t => {
  const m=deferred(),notices=[],original=console.error;
  const s=scenario({modelSettled:()=>m.promise,writeFailures:['execution-settlement.json']});
  await withScenario(s,async()=>{
    t.mock.timers.enable({apis:['setTimeout']});console.error=value=>notices.push(JSON.parse(value));
    try {
      const task=runPrivateLiveDemo(argv);await tick();t.mock.timers.tick(2000);
      const out=await task,before=JSON.stringify(out);assert.equal(out.status,'INCOMPLETE');
      m.resolve();await tick();assert.equal(JSON.stringify(out),before);
      assert.equal(s.files.has('execution-settlement.json'),false);
      assert.ok(notices.some(r=>r.stage==='execution-settlement.json'&&r.code==='SYNTHETIC_WRITE'));
    } finally { console.error=original;t.mock.timers.reset(); }
  });
});

test('main command notices interrupt during final diagnostics, after successful receipt binding', async () => {
  const s=scenario({onWrite:async name=>{if(name==='model-lane-final.json')process.listeners('SIGINT').at(-1)();}});
  await withScenario(s,async()=>{
    const out=await runPrivateLiveDemo(argv);assert.equal(s.files.has('live-run-receipt.json'),true);
    assert.equal(out.status,'INCOMPLETE');assert.equal(out.errorCode,'ABORTED');assert.equal(s.calls.filter(x=>x==='revoke').length,1);
  });
});

test('main command closes one-shot lane only after successful receipt is bound and retained', async () => {
  const s=scenario();await withScenario(s,async()=>{
    const out=await runPrivateLiveDemo(argv);assert.equal(out.status,'SCOPED_LIVE_REPAIR_REVIEW_PASS');
    const sequence=['receipt.create','receipt.read','write:live-run-receipt.json','revoke','write:execution-final.json'];
    const offsets=sequence.map(name=>s.calls.indexOf(name));assert.ok(offsets.every(n=>n>=0));
    assert.deepEqual(offsets,[...offsets].sort((a,b)=>a-b));assert.equal(s.calls.filter(x=>x==='revoke').length,1);
  });
});

test('main command early signal contains revocation failure and preserves adverse summary', async () => {
  const s=scenario({onWrite:async name=>{if(name==='preflight.json')assert.doesNotThrow(()=>process.listeners('SIGINT').at(-1)());},
    revoke:()=>{throw coded('SYNTHETIC_REVOKE');}});
  await withScenario(s,async()=>{
    const out=await runPrivateLiveDemo(argv);assert.equal(out.status,'INCOMPLETE');assert.equal(out.errorCode,'ABORTED');
    assert.ok(errors(out).includes('early.cancel:SYNTHETIC_REVOKE'));assert.equal(s.calls.includes('run'),false);
    assert.equal(s.calls.filter(x=>x==='revoke').length,1);
  });
});

test('main command early abort throw cannot skip revocation or escape signal callback', async () => {
  const Original=globalThis.AbortController;
  const s=scenario({onWrite:async name=>{if(name==='preflight.json')assert.doesNotThrow(()=>process.listeners('SIGINT').at(-1)());}});
  await withScenario(s,async()=>{
    globalThis.AbortController=class extends Original {abort(){super.abort();throw coded('SYNTHETIC_ABORT');}};
    try {const out=await runPrivateLiveDemo(argv);assert.equal(out.status,'INCOMPLETE');assert.ok(errors(out).includes('early.cancel:SYNTHETIC_ABORT'));
      assert.equal(s.calls.filter(x=>x==='revoke').length,1);assert.equal(s.calls.includes('run'),false);
    } finally {globalThis.AbortController=Original;}
  });
});

test('main command normal close failure never earns successful summary', async () => {
  const s=scenario({revoke:()=>{throw coded('SYNTHETIC_CLOSE');}});
  await withScenario(s,async()=>{
    const out=await runPrivateLiveDemo(argv);assert.equal(out.status,'INCOMPLETE');assert.ok(errors(out).includes('execution.close:SYNTHETIC_CLOSE'));
    assert.equal(s.calls.filter(x=>x==='revoke').length,1);
  });
});

test('main command cannot pass with a settled but quarantined model owner', async () => {
  const s=scenario({modelStatus:()=> 'QUARANTINED'});await withScenario(s,async()=>{
    const out=await runPrivateLiveDemo(argv);assert.equal(out.status,'INCOMPLETE');
    assert.ok(errors(out).includes('execution.final:LIVE_DEMO_DRAIN_UNCONFIRMED'));
    assert.equal(s.files.has('execution-settlement.json'),true);
  });
});
