// Fakes exercise lifecycle faults; only the final test executes inspected fixture code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createReviewedNodeExecutorV1, createNodeExecutorWithDependenciesV1, nodeTestAdapterResultV1 } from '../hosts/repository/node-executor-v1.mjs';
import { createReviewedNodeTestAdapterV1 } from '../hosts/repository/node-adapter-v1.mjs';
import { runWorkflow } from '../workflow/engine.mjs';
import { readExecutionReceipt } from '../receipts/repository-execution-v1.mjs';
import { context, passing, failing, setup, wire } from './helpers/node-repository-fixture.mjs';
const opts = suite => ({ suite, totalTimeoutMs: 1000, childTimeoutMs: 500, closeGraceMs: 10 });
const runtime = Object.freeze({ path: '/test/node', sha256: 'a'.repeat(64), ino: '1' });
function fake(c, behavior, overrides = {}, options = {}) {
  let launches = 0; const children = [], invocations = [];
  const deps = { observeExecutable: () => runtime, now: () => 0, spawnChild: (...args) => {
    launches++; invocations.push(args); const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
    child.exitCode = null; child.signalCode = null; child.kills = [];
    child.kill = signal => { child.kills.push(signal); return true; };
    child.stdin.end = bytes => { child.input = Buffer.from(bytes); };
    children.push(child); queueMicrotask(() => behavior(child)); return child;
  }, ...overrides };
  const executor = createNodeExecutorWithDependenciesV1({ ...opts(c.suite), ...options }, deps);
  return { executor, children, invocations, launches: () => launches };
}
function finish(child, report = passing(), exitCode = 0, stderr = '') {
  child.emit('spawn'); child.stdout.emit('data', Buffer.isBuffer(report) ? report : wire(report));
  if (stderr) child.stderr.emit('data', Buffer.from(stderr));
  child.exitCode = exitCode; child.emit('exit', exitCode, null); child.emit('close', exitCode, null);
}
const run = async (c, f, extra = {}, variant = 1) => f.executor.execute({ workspace: await c.workspace(variant), runId: randomUUID(), attempt: variant, ...extra });

test('async host binds exact workspace, runtime argv/env, raw result and unchanged PRE/POST', async t => {
  const c = await context(t), f = fake(c, child => finish(child)), r = await run(c, f);
  assert.equal(r.disposition, 'RECORDED'); assert.equal(r.receipt.result.status, 'PASS');
  assert.equal(r.testReport.assertionsPassed, 10); assert.equal(r.rawObservation.process.drain, 'CONFIRMED');
  assert.equal(r.post.previousFingerprint, r.pre.fingerprint); assert.equal(r.hostCode, null);
  assert.equal(r.authorizing, false); assert.equal(r.noDescendantsEnforced, false);
  assert.deepEqual(readExecutionReceipt(r.receipt, r.expected), r.receipt);
  assert.equal(r.expected.binding.stage, 'tests'); assert.equal(r.expected.binding.attempt, 1);
  assert.equal(r.expected.binding.preparationFingerprint, c.preparations[1].fingerprint);
  assert.equal(nodeTestAdapterResultV1(r).status, 'PASS');
  assert.throws(() => nodeTestAdapterResultV1({ ...r }), { code: 'NODE_EXECUTION_NOT_ISSUED' });
  assert.deepEqual(f.invocations[0][1], r.expected.profile.argv);
  assert.deepEqual(f.invocations[0][2], { cwd: r.expected.profile.argv[1], env: { LANG: 'C', LC_ALL: 'C' }, shell: false, detached: false, stdio: ['pipe', 'pipe', 'pipe'] });
  assert.equal(f.children[0].input.length, 0); assert(Object.isFrozen(r.receipt));
});
test('clean behavior FAIL is recorded and setup ERROR retains explicit zero assertions plus raw exit two', async t => {
  const c = await context(t);
  const a = await run(c, fake(c, child => finish(child, failing())));
  assert.equal(a.receipt.result.status, 'FAIL'); assert.equal(a.receipt.result.reason, 'NODE_ASSERTIONS_FAILED');
  const b = await run(c, fake(c, child => finish(child, setup(), 2)));
  assert.equal(b.receipt.result.status, 'ERROR'); assert.equal(b.receipt.process.errorCode, 'FIXTURE_SETUP_FAILED');
  assert.equal(b.rawObservation.process.errorCode, null); assert.equal(b.rawObservation.process.exitCode, 2);
  assert.equal(b.testReport.assertionsExecuted, 0);
  assert.equal(nodeTestAdapterResultV1(a).status, 'FAIL');
  assert.equal(nodeTestAdapterResultV1(a).evidence.failures.length, 2);
  assert.equal(nodeTestAdapterResultV1(b).status, 'UNAVAILABLE');
  assert.equal(nodeTestAdapterResultV1(b).evidence.assertionsExecuted, 0);
});
test('unissued registration, extra execution arguments and cloned workspace refuse before consuming PRE', async t => {
  const c = await context(t), workspace = await c.workspace(), f = fake(c, child => finish(child));
  assert.throws(() => createReviewedNodeExecutorV1(opts(structuredClone(c.suite))), { code: 'NODE_SUITE_NOT_ISSUED' });
  const input = { workspace, runId: randomUUID(), attempt: 1 };
  for (const field of ['command', 'argv', 'env', 'cwd', 'authorizing']) await assert.rejects(f.executor.execute({ ...input, [field]: true }), { code: 'NODE_EXECUTE_SCHEMA' });
  await assert.rejects(f.executor.execute({ ...input, workspace: { ...workspace } }), { code: 'WORKSPACE_OWNER_NOT_ISSUED' });
  assert.equal(workspace.status(), 'MATERIALIZED'); assert.equal(f.launches(), 0);
  assert.equal((await f.executor.execute(input)).receipt.result.status, 'PASS');
});
test('issued but unregistered preparation is refused without a launch', async t => {
  const c = await context(t), other = await context(t), f = fake(c, child => finish(child));
  await assert.rejects(f.executor.execute({ workspace: await other.workspace(), runId: randomUUID(), attempt: 1 }), { code: 'NODE_SUITE_PREPARATION_NOT_REGISTERED' });
  assert.equal(f.launches(), 0);
});
test('workspace one-shot claim prevents cross-executor overlap and run/attempt replay', async t => {
  const c = await context(t), workspace = await c.workspace(), f = fake(c, child => finish(child)), g = fake(c, child => finish(child));
  const input = { workspace, runId: randomUUID(), attempt: 1 }, pending = f.executor.execute(input);
  await assert.rejects(g.executor.execute(input), { code: 'NODE_WORKSPACE_REPLAY' });
  await assert.rejects(f.executor.execute(input), { code: 'NODE_EXECUTOR_BUSY' });
  await pending;
  await assert.rejects(f.executor.execute({ ...input, workspace: await c.workspace() }), { code: 'NODE_ATTEMPT_REPLAY' });
  await assert.rejects(g.executor.execute({ ...input, runId: randomUUID() }), { code: 'NODE_WORKSPACE_REPLAY' });
});
test('PRE drift prevents launch and quarantines; clean raw PASS survives separate POST drift refusal', async t => {
  const c = await context(t), workspace = await c.workspace(), f = fake(c, child => finish(child));
  await fs.writeFile(path.join(workspace.root, 'unexpected'), 'drift');
  const before = await f.executor.execute({ workspace, runId: randomUUID(), attempt: 1 });
  assert.equal(f.launches(), 0); assert.equal(before.receipt.process.started, false); assert.equal(before.disposition, 'HOST_UNAVAILABLE');
  assert.equal(before.ownerState, 'QUARANTINED'); assert.equal(before.pre, null);
  const second = await c.workspace();
  const g = fake(c, child => { fs.writeFile(path.join(second.root, 'retry-settings.mjs'), 'changed').then(() => finish(child)); });
  const after = await g.executor.execute({ workspace: second, runId: randomUUID(), attempt: 1 });
  assert.equal(after.receipt.result.status, 'PASS'); assert.equal(after.rawObservation.cause, null);
  assert.equal(after.disposition, 'HOST_UNAVAILABLE'); assert.equal(after.post, null); assert.equal(second.status(), 'QUARANTINED');
  assert.deepEqual(readExecutionReceipt(after.receipt, after.expected), after.receipt);
  assert.equal(nodeTestAdapterResultV1(after).status, 'UNAVAILABLE');
  assert.equal(nodeTestAdapterResultV1(after).evidence.assertionsExecuted, 0);
});
test('pre-abort produces no launch or fabricated assertions', async t => {
  const c = await context(t), controller = new AbortController(); controller.abort();
  const f = fake(c, child => finish(child)), workspace = await c.workspace();
  const r = await f.executor.execute({ workspace, runId: randomUUID(), attempt: 1, signal: controller.signal });
  assert.equal(f.launches(), 0); assert.equal(r.hostCode, 'ABORTED'); assert.equal(r.rawObservation, null);
  assert.equal(r.receipt.result.status, 'INCONCLUSIVE'); assert.equal(r.testReport, null);
  const fresh = fake(c, child => finish(child));
  await assert.rejects(fresh.executor.execute({ workspace, runId: randomUUID(), attempt: 1 }), { code: 'NODE_WORKSPACE_REPLAY' });
});
test('abort with unknown close retains raw bytes, quarantines and never POST-checks a possibly active workspace', async t => {
  const c = await context(t), controller = new AbortController();
  const f = fake(c, child => { child.emit('spawn'); child.stdout.emit('data', wire(passing())); controller.abort(); });
  const r = await run(c, f, { signal: controller.signal });
  assert.equal(r.receipt.result.status, 'INCONCLUSIVE'); assert.equal(r.rawObservation.process.drain, 'UNKNOWN');
  assert.equal(r.hostCode, 'ABORTED'); assert(r.hostIssues.some(i => i.code === 'NODE_CHILD_CLOSE_UNCONFIRMED'));
  assert.equal(r.post, null); assert.equal(f.executor.status(), 'QUARANTINED');
  f.children[0].emit('close', null, 'SIGKILL'); assert.equal(f.executor.status(), 'QUARANTINED');
  assert.equal(r.rawObservation.process.closed, false);
});
test('deadline while PRE settles prevents child launch but seals POST', async t => {
  const c = await context(t); let n = 0;
  const f = fake(c, child => finish(child), { now: () => ++n === 1 ? 0 : 1000 });
  const r = await run(c, f); assert.equal(f.launches(), 0); assert.equal(r.hostCode, 'DEADLINE_EXCEEDED');
  assert.equal(r.post.status, 'UNCHANGED_AT_CHECKPOINT'); assert.equal(r.receipt.process.started, false);
});
test('late total deadline during runtime POST preserves clean child PASS but vetoes outer completion', async t => {
  const c = await context(t); let time = 0, calls = 0;
  const f = fake(c, child => finish(child), { now: () => time, observeExecutable: () => { if (++calls === 3) time = 1000; return runtime; } });
  const r = await run(c, f); assert.equal(r.receipt.result.status, 'PASS'); assert.equal(r.receipt.process.deadlineExceeded, false);
  assert.equal(r.hostCode, 'DEADLINE_EXCEEDED'); assert.equal(r.disposition, 'HOST_UNAVAILABLE');
  assert(r.hostIssues.some(i => i.phase === 'RUNTIME_POST' && i.code === 'DEADLINE_EXCEEDED'));
  assert.equal(nodeTestAdapterResultV1(r).status, 'UNAVAILABLE');
  assert.deepEqual(nodeTestAdapterResultV1(r).evidence.failures, []);
});
test('runtime identity drift refuses before launch or separately after a clean result', async t => {
  const c = await context(t);
  for (const at of [2, 3]) {
    let calls = 0; const f = fake(c, child => finish(child), { observeExecutable: () => ++calls === at ? { ...runtime, ino: '2' } : runtime });
    const r = await run(c, f); assert.equal(r.hostCode, 'NODE_RUNTIME_IDENTITY_CHANGED'); assert.equal(r.disposition, 'HOST_UNAVAILABLE');
    assert.equal(f.launches(), at === 2 ? 0 : 1); if (at === 3) assert.equal(r.receipt.result.status, 'PASS');
  }
});
for (const [name, report, exitCode, stderr] of [
  ['malformed zero-exit output', Buffer.from('{}\n'), 0, ''], ['setup with exit zero', setup(), 0, ''],
  ['quality PASS with exit two', passing(), 2, ''], ['unexpected stderr', passing(), 0, 'warning'],
  ['overflow', Buffer.alloc(65537, 32), 0, ''],
]) test('host never passes ' + name, async t => {
  const c = await context(t), r = await run(c, fake(c, child => finish(child, report, exitCode, stderr)));
  assert.notEqual(r.receipt.result.status, 'PASS'); assert.notEqual(r.receipt.result.status, 'FAIL'); assert.equal(r.testReport, null);
});
test('invalid and throwing total clocks refuse without execution', async t => {
  const c = await context(t);
  for (const now of [() => NaN, () => { throw Error('private'); }]) {
    const f = fake(c, child => finish(child), { now }), r = await run(c, f);
    assert.equal(f.launches(), 0); assert.equal(r.hostCode, 'NODE_HOST_CLOCK_INVALID'); assert.equal(r.ownerState, 'QUARANTINED');
  }
});
test('REAL owned async Node fixture records baseline FAIL and corrected PASS on separate exact trees', async t => {
  const c = await context(t), executor = createReviewedNodeExecutorV1({ suite: c.suite, totalTimeoutMs: 10000, childTimeoutMs: 5000, closeGraceMs: 500 });
  const runId = randomUUID(), results = [];
  for (const attempt of [0, 1]) results.push(await executor.execute({ workspace: await c.workspace(attempt), runId, attempt }));
  assert.deepEqual(results.map(r => r.receipt.result.status), ['FAIL', 'PASS']);
  assert.deepEqual(results.map(r => r.testReport.assertionsPassed), [8, 10]);
  for (const r of results) {
    assert.equal(r.disposition, 'RECORDED'); assert.equal(r.rawObservation.process.started, true);
    assert.equal(r.rawObservation.process.closed, true); assert.equal(r.rawObservation.process.drain, 'CONFIRMED');
    assert.equal(r.rawObservation.process.exitCode, 0); assert.equal(r.post.previousFingerprint, r.pre.fingerprint);
    assert.deepEqual(r.runtimeBefore, r.runtimeAfter); assert.equal(r.authorizing, false);
  }
  assert.notEqual(results[0].workspaceFingerprint, results[1].workspaceFingerprint);
  assert.notEqual(results[0].expected.binding.candidateFingerprint, results[1].expected.binding.candidateFingerprint);
});
test('REAL Nisi workflow repairs the reviewed retry fixture and records fresh async behavior evidence for both candidates', async t => {
  const c = await context(t), adapter = createReviewedNodeTestAdapterV1({ suite: c.suite, parentRoot: c.parent,
    totalTimeoutMs: 10000, childTimeoutMs: 5000, closeGraceMs: 500 });
  const candidate = n => ({ files: c.preparations[n].candidate.files.map(({ path, content }) => ({ path, content })) });
  let reviewed = 0, repaired = 0;
  const report = await runWorkflow(c.task, { adapters: {
    authorizeContext: { authorize: p => ({ status: 'PASS', evidence: { ...p.binding, reason: '' } }) },
    author: { id: 'author.fixed-fixture', draft: p => ({ candidate: candidate(0), evidence: { ...p.binding,
      candidateFingerprint: c.preparations[0].candidateFingerprint, note: 'Fixed inspected baseline' } }),
    repair: p => { repaired++; return { status: 'REPAIRED', candidate: candidate(1), evidence: { ...p.binding,
      baseCandidateFingerprint: p.binding.candidateFingerprint, candidateFingerprint: c.preparations[1].candidateFingerprint,
      note: 'Fixed inspected one-file correction' } }; } },
    staticChecks: { check: p => ({ status: 'PASS', evidence: { ...p.binding, findings: [], reason: '' } }) },
    tests: adapter,
    reviewers: [{ id: 'reviewer.fixed-fixture', review: p => { reviewed++; return { status: 'PASS', evidence: { ...p.binding,
      reviewerId: 'reviewer.fixed-fixture', findings: [], summary: 'Fixed reviewer callback, not model review', reason: '' } }; } }],
  } });
  const history = await adapter.settled();
  assert.equal(report.outcome, 'COMPLETED', JSON.stringify(report)); assert.equal(repaired, 1); assert.equal(reviewed, 1);
  assert.equal(history.length, 2); assert.deepEqual(history.map(h => h.execution.receipt.result.status), ['FAIL', 'PASS']);
  const stages = report.stages.filter(s => s.stage === 'tests'); assert.equal(stages.length, 2);
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(stages[i].evidence, history[i].adapterResult.evidence);
    assert.equal(history[i].execution.expected.binding.runId, report.runId);
    assert.equal(history[i].execution.expected.binding.attempt, i);
    assert.equal(history[i].execution.rawObservation.process.drain, 'CONFIRMED');
    assert.equal(history[i].workspace.status(), 'POSTCHECKED');
  }
  assert.notEqual(history[0].workspace.root, history[1].workspace.root);
  assert.equal(adapter.status(), 'IDLE');
});
test('REAL workflow may first invoke Node tests at attempt one after a static-check failure', async t => {
  const c = await context(t), adapter = createReviewedNodeTestAdapterV1({ suite: c.suite, parentRoot: c.parent,
    totalTimeoutMs: 10000, childTimeoutMs: 5000, closeGraceMs: 500 });
  const candidate = n => ({ files: c.preparations[n].candidate.files.map(({ path, content }) => ({ path, content })) });
  const report = await runWorkflow(c.task, { adapters: {
    authorizeContext: { authorize: p => ({ status: 'PASS', evidence: { ...p.binding, reason: '' } }) },
    author: { id: 'author.fixed-fixture', draft: p => ({ candidate: candidate(0), evidence: { ...p.binding,
      candidateFingerprint: c.preparations[0].candidateFingerprint, note: 'Fixed baseline' } }),
    repair: p => ({ status: 'REPAIRED', candidate: candidate(1), evidence: { ...p.binding,
      baseCandidateFingerprint: p.binding.candidateFingerprint, candidateFingerprint: c.preparations[1].candidateFingerprint,
      note: 'Fixed correction after static failure' } }) },
    staticChecks: { check: p => ({ status: p.binding.attempt === 0 ? 'FAIL' : 'PASS', evidence: { ...p.binding,
      findings: p.binding.attempt === 0 ? [{ code: 'FIXTURE_STATIC_FAILURE', message: 'Deliberate static fixture failure' }] : [],
      reason: p.binding.attempt === 0 ? 'FIXTURE_STATIC_FAILURE' : '' } }) },
    tests: adapter,
    reviewers: [{ id: 'reviewer.fixed-fixture', review: p => ({ status: 'PASS', evidence: { ...p.binding,
      reviewerId: 'reviewer.fixed-fixture', findings: [], summary: 'Fixed reviewer, not model review', reason: '' } }) }],
  } });
  const history = await adapter.settled();
  assert.equal(report.outcome, 'COMPLETED', JSON.stringify(report)); assert.equal(history.length, 1);
  assert.equal(history[0].execution.expected.binding.attempt, 1);
  assert.equal(history[0].execution.receipt.result.status, 'PASS');
  assert.deepEqual(report.stages.filter(s => s.stage === 'tests').map(s => s.evidence.attempt), [1]);
});
test('REAL adapter permits a later attempt gap but refuses repeated, lower and invalid attempts', async t => {
  const c = await context(t, { repairBudget: 2 }), adapter = createReviewedNodeTestAdapterV1({ suite: c.suite, parentRoot: c.parent,
    totalTimeoutMs: 10000, childTimeoutMs: 5000, closeGraceMs: 500 });
  const runId = randomUUID();
  const payload = (attempt, variant = 1) => ({ task: c.preparations[variant].task, candidate: c.preparations[variant].candidate,
    binding: { schemaVersion: 1, runId, attempt, taskFingerprint: c.preparations[variant].taskFingerprint,
      candidateFingerprint: c.preparations[variant].candidateFingerprint } });
  assert.equal((await adapter.run(payload(0, 0))).status, 'FAIL');
  await assert.rejects(adapter.run({ ...payload(1), binding: { ...payload(1).binding, runId: randomUUID() } }), { code: 'NODE_ADAPTER_BINDING' });
  assert.equal((await adapter.run(payload(2))).status, 'PASS');
  for (const attempt of [2, 1, 0, -1, 3, 2.5, NaN]) await assert.rejects(adapter.run(payload(attempt)), { code: 'NODE_ADAPTER_BINDING' });
  assert.equal((await adapter.settled()).length, 2);
});
