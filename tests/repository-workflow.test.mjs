// Real engine with deliberately incomplete trusted adapter fixtures; not native acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as immediate } from 'node:timers/promises';
import { createRepositoryWorkflowOwnerV1 } from '../hosts/repository/reviewed-workflow-v1.mjs';
import { context } from './helpers/node-repository-fixture.mjs';
import { fixedOptions } from './helpers/repository-run-fixture.mjs';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const stub = (key, fn) => ({ [key]: fn, registrationFingerprint: 'a'.repeat(64), settled: async () => [], observations: () => [], status: () => 'IDLE', lateObservations: () => [] });
const goodStatic = p => ({ status: 'PASS', evidence: { ...p.binding, findings: [], reason: '' } });
const goodTest = p => ({ status: 'PASS', evidence: { ...p.binding, assertionsExecuted: 1, assertionsPassed: 1, failures: [], reason: '' } });
function make(c, stat = stub('check', goodStatic), node = stub('run', goodTest)) {
  return createRepositoryWorkflowOwnerV1({ suite: c.suite, staticOwner: stat, testsOwner: node });
}
test('one-shot host rejects before start settlement and duplicate calls without more dispatch', async t => {
  const c = await context(t); let calls = 0;
  const host = make(c, stub('check', p => { calls++; return goodStatic(p); }));
  await assert.rejects(host.settled(), { code: 'REPOSITORY_HOST_NOT_STARTED' });
  const run = host.run(fixedOptions(c)); assert.throws(() => host.run(fixedOptions(c)), { code: 'REPOSITORY_HOST_ALREADY_USED' });
  assert.equal((await run).outcome, 'COMPLETED'); const result = await host.settled();
  assert.equal(calls, 1); assert.equal(result.bundle, null); assert.equal(result.proposedChanges, null);
  assert.equal(result.bundleError.code, 'REPOSITORY_HISTORY_INVENTORY'); assert.equal(host.status(), 'QUARANTINED');
});
test('engine abort report remains immutable while independent owner settlement is pending', async t => {
  const c = await context(t), started = deferred(), work = deferred(), drain = deferred(), controller = new AbortController();
  t.after(() => { work.resolve(); drain.resolve(); });
  let idle = false;
  const node = { ...stub('run', async p => { started.resolve(); await work.promise; return goodTest(p); }),
    settled: async () => { await drain.promise; idle = true; return []; }, status: () => idle ? 'IDLE' : 'BUSY' };
  const host = make(c, stub('check', goodStatic), node), running = host.run({ ...fixedOptions(c), signal: controller.signal });
  await started.promise; controller.abort(); const report = await running, snapshot = JSON.stringify(report);
  assert.equal(report.outcome, 'CANCELLED'); assert(Object.isFrozen(report));
  let settled = false; const finishing = host.settled().then(r => { settled = true; return r; });
  await immediate(); assert.equal(settled, false); assert.equal(host.status(), 'SETTLING');
  work.resolve(); drain.resolve(); const result = await finishing;
  assert.equal(JSON.stringify(report), snapshot); assert.equal(result.report, report);
  assert.equal(result.proposedChanges, null); assert.equal(result.bundle, null);
});
test('synchronous settled failure still awaits the other owner and retains its evidence', async t => {
  const c = await context(t), drain = deferred(); let nodeSettledCalled = false;
  t.after(() => drain.resolve());
  const stat = { ...stub('check', goodStatic), settled: () => { throw Object.assign(new Error(), { code: 'STATIC_SETTLEMENT_FAILED' }); } };
  const node = { ...stub('run', goodTest), settled: async () => { nodeSettledCalled = true; await drain.promise; return [{ retained: 'late partial' }]; } };
  const host = make(c, stat, node); const report = await host.run(fixedOptions(c));
  let settled = false; const pending = host.settled().then(r => { settled = true; return r; });
  // Observe rejection without turning the pending owner into a fake drain.
  pending.catch(() => {});
  await immediate(); assert.equal(nodeSettledCalled, true); assert.equal(settled, false);
  drain.resolve(); const result = await pending;
  assert.equal(result.report, report); assert.equal(result.testHistory[0].retained, 'late partial');
  assert.equal(result.settlementErrors[0].code, 'STATIC_SETTLEMENT_FAILED'); assert.equal(result.bundle, null);
});
test('bound partial materialization error retains attempt and exact sanitized root without fake execution', async t => {
  const c = await context(t), node = stub('run', () => { throw Object.assign(new Error('do not retain secret details'), {
    code: 'WORKSPACE_CLOSE_UNCONFIRMED', root: '/synthetic/owned-partial', priorCode: 'WORKSPACE_IO_ERROR', systemCode: 'EIO' }); });
  const host = make(c, stub('check', goodStatic), node), report = await host.run(fixedOptions(c)), result = await host.settled();
  assert.equal(report.outcome, 'BLOCKED'); const e = result.invocations.find(e => e.stage === 'tests');
  assert.equal(e.binding.runId, report.runId); assert.equal(e.binding.attempt, 0); assert.equal(e.state, 'ERROR');
  assert.equal(e.preparation, c.preparations[0]); assert.equal(e.adapterResult, null);
  assert.deepEqual({ ...e.error }, { code: 'WORKSPACE_CLOSE_UNCONFIRMED', root: '/synthetic/owned-partial', priorCode: 'WORKSPACE_IO_ERROR', systemCode: 'EIO' });
  assert.equal(result.bundle, null); assert.equal(result.proposedChanges, null);
});
test('unregistered author candidate is refused before either verification owner is invoked', async t => {
  const c = await context(t); let calls = 0; const options = fixedOptions(c);
  const { createCandidate } = await import('../workflow/engine.mjs');
  options.author.draft = p => {
    const candidate = createCandidate({ files: [{ path: 'retry-settings.mjs', content: 'unregistered source data' }] }, { authorId: options.author.id });
    return { candidate: { files: candidate.files }, evidence: { ...p.binding, candidateFingerprint: candidate.fingerprint, note: 'Unregistered fixture' } };
  };
  const host = make(c, stub('check', p => { calls++; return goodStatic(p); }), stub('run', p => { calls++; return goodTest(p); }));
  const report = await host.run(options), result = await host.settled();
  assert.equal(report.outcome, 'BLOCKED'); assert.equal(calls, 0);
  assert.equal(result.invocations[0].error.code, 'REPOSITORY_CANDIDATE_NOT_REGISTERED'); assert.equal(result.proposedChanges, null);
});
test('callback methods are captured at construction instead of swapping after admission', async t => {
  const c = await context(t), stat = stub('check', goodStatic), node = stub('run', goodTest), host = make(c, stat, node);
  stat.check = () => { throw Error('replacement'); }; node.run = () => { throw Error('replacement'); };
  assert.equal((await host.run(fixedOptions(c))).outcome, 'COMPLETED'); await host.settled();
  assert(host.invocations().every(i => i.state === 'RETURNED'));
});
test('malformed owner history cannot discard the other owner partial evidence', async t => {
  const c = await context(t), stat = { ...stub('check', goodStatic), settled: async () => null };
  const node = { ...stub('run', goodTest), settled: async () => [{ retained: 'partial test evidence' }] };
  const host = make(c, stat, node), report = await host.run(fixedOptions(c)), result = await host.settled();
  assert.equal(result.state, 'QUARANTINED'); assert.equal(result.report, report);
  assert.equal(result.bundleError.code, 'REPOSITORY_HISTORY_SCHEMA');
  assert.equal(result.testHistory[0].retained, 'partial test evidence');
  assert.deepEqual(result.staticHistory, []); assert.equal(result.bundle, null); assert.equal(result.proposedChanges, null);
  assert.equal(result.historyErrors[0].code, 'REPOSITORY_HISTORY_SCHEMA');
});
test('throwing fallback and status are retained independently after both owners settle', async t => {
  const c = await context(t), stat = { ...stub('check', goodStatic),
    settled: () => { throw Object.assign(Error(), { code: 'STATIC_DRAIN_FAILED' }); },
    observations: () => { throw Object.assign(Error(), { code: 'STATIC_HISTORY_FAILED' }); },
    status: () => { throw Object.assign(Error(), { code: 'STATIC_STATUS_FAILED' }); } };
  const node = { ...stub('run', goodTest), settled: async () => [{ retained: 'other owner' }] };
  const host = make(c, stat, node); await host.run(fixedOptions(c)); const result = await host.settled();
  assert.equal(result.state, 'QUARANTINED'); assert.equal(result.ownerStates.staticChecks, 'UNKNOWN');
  assert.equal(result.settlementErrors[0].code, 'STATIC_DRAIN_FAILED');
  assert.equal(result.historyErrors[0].code, 'STATIC_HISTORY_FAILED');
  assert.equal(result.ownerStateErrors[0].code, 'STATIC_STATUS_FAILED');
  assert.equal(result.testHistory[0].retained, 'other owner'); assert.equal(result.bundle, null);
});
