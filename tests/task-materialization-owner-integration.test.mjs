// Private owner integration regression. Fixed reviewed fixture; no model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createReviewedNodeTestAdapterV1 } from '../hosts/repository/node-adapter-v1.mjs';
import { createExecutionCoordinatorV1 } from '../hosts/repository/execution-coordinator-v1.mjs';
import { createRepositoryWorkflowOwnerV1 } from '../hosts/repository/reviewed-workflow-v1.mjs';
import { context } from './helpers/node-repository-fixture.mjs';
import { fixedOptions } from './helpers/repository-run-fixture.mjs';
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function startObserved(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error('fixed materialization fixture never reached held I/O')), 2000);
  })]); } finally { clearTimeout(timer); }
}

test('adapter abort returns outwardly while materialization I/O remains owned and unsettled', async t => {
  const c = await context(t), started = deferred(), release = deferred(), controller = new AbortController();
  const adapter = createReviewedNodeTestAdapterV1({ suite: c.suite, parentRoot: c.parent,
    totalTimeoutMs: 10000, childTimeoutMs: 5000, closeGraceMs: 500 });
  const original = fs.lstat;
  // Process-local test mock, restricted to this uniquely owned parent. Restore
  // only after the suspended I/O and adapter have actually joined.
  const mock = t.mock.method(fs, 'lstat', async (...args) => {
    if (args[0] === c.parent) { started.resolve(); await release.promise; }
    return original(...args);
  });
  const p = c.preparations[1], payload = { task: p.task, candidate: p.candidate, signal: controller.signal,
    binding: { schemaVersion: 1, runId: randomUUID(), attempt: 1,
      taskFingerprint: p.taskFingerprint, candidateFingerprint: p.candidateFingerprint } };
  const outward = adapter.run(payload).then(value => ({ kind: 'returned', value }), error => ({ kind: 'rejected', error }));
  let watchdog, drained = false;
  try {
    await startObserved(started.promise); controller.abort();
    const observation = await Promise.race([outward, new Promise(resolve => {
      watchdog = setTimeout(() => resolve({ kind: 'still-waiting' }), 250);
    })]);
    assert.equal(observation.kind, 'rejected', 'caller must not wait for blocked disk I/O after abort');
    assert.equal(observation.error.code, 'WORKSPACE_ABORTED');
    const drain = adapter.settled().then(value => { drained = true; return value; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(drained, false); assert.equal(adapter.status(), 'QUARANTINED');
    assert.throws(() => adapter.run(payload), error => ['NODE_ADAPTER_BUSY', 'NODE_ADAPTER_QUARANTINED'].includes(error.code));
    release.resolve(); await drain;
    assert.equal(adapter.status(), 'QUARANTINED');
    const history = adapter.observations(); assert.equal(history.length, 1);
    assert.equal(history[0].workspace, null); assert.equal(history[0].execution, null);
  } finally {
    clearTimeout(watchdog); release.resolve(); await outward; await adapter.settled(); mock.mock.restore();
  }
});

test('creation deadline does not fabricate drain, late root disappears from neither evidence nor disk', async t => {
  const c = await context(t), started = deferred(), release = deferred();
  const adapter = createReviewedNodeTestAdapterV1({ suite: c.suite, parentRoot: c.parent,
    totalTimeoutMs: 10000, childTimeoutMs: 5000, closeGraceMs: 500, materializationTimeoutMs: 300 });
  const expectedPrefix = (await fs.realpath(c.parent)) + '/nisi-task-';
  const original = fs.mkdtemp; let created;
  const mock = t.mock.method(fs, 'mkdtemp', async (...args) => {
    if (args[0] === expectedPrefix) {
      started.resolve(); await release.promise; created = await original(...args); return created;
    }
    return original(...args);
  });
  const p = c.preparations[1], payload = { task: p.task, candidate: p.candidate,
    binding: { schemaVersion: 1, runId: randomUUID(), attempt: 1,
      taskFingerprint: p.taskFingerprint, candidateFingerprint: p.candidateFingerprint } };
  const outward = adapter.run(payload).then(value => ({ kind: 'returned', value }), error => ({ kind: 'rejected', error }));
  let watchdog;
  try {
    await startObserved(started.promise);
    const observation = await Promise.race([outward, new Promise(resolve => {
      watchdog = setTimeout(() => resolve({ kind: 'still-waiting' }), 2000);
    })]);
    assert.equal(observation.kind, 'rejected');
    assert.equal(observation.error.code, 'WORKSPACE_MATERIALIZATION_DEADLINE');
    const issued = JSON.stringify(observation.error);
    const before = JSON.stringify(adapter.materializationObservations());
    assert.equal(created, undefined); assert.equal(adapter.status(), 'QUARANTINED');
    const coordinator = createExecutionCoordinatorV1({ owners: [{ id: 'node-tests', status: adapter.status,
      settled: adapter.settled, cancel: () => {} }], settleTimeoutMs: 10 });
    const pending = await coordinator.requestOff();
    assert.equal(pending.status, 'UNCONFIRMED'); assert.equal(pending.snapshot.capacityReusable, false);
    assert.equal(pending.snapshot.owners[0].settlement, 'TIMEOUT');
    release.resolve(); await adapter.settled();
    assert.equal((await fs.lstat(created)).isDirectory(), true);
    assert.equal(JSON.stringify(observation.error), issued, 'late details cannot rewrite the issued outward error');
    const after = adapter.materializationObservations();
    assert.ok(JSON.stringify(after).includes(created), 'late-created root must remain discoverable');
    assert.notEqual(JSON.stringify(after), before);
    assert.equal(adapter.status(), 'QUARANTINED');
    const joined = await coordinator.recheck();
    assert.equal(joined.status, 'UNCONFIRMED'); assert.equal(joined.snapshot.capacityReusable, false);
    assert.equal(joined.snapshot.owners[0].settlement, 'SETTLED');
    assert.equal(adapter.observations()[0].workspace, null);
    assert.equal(adapter.observations()[0].execution, null);
  } finally {
    clearTimeout(watchdog); release.resolve(); await outward; await adapter.settled(); mock.mock.restore();
  }
});

test('combined host keeps immutable abort report separate from real disk settlement and late diagnostics', async t => {
  const c = await context(t), started = deferred(), release = deferred(), controller = new AbortController();
  const node = createReviewedNodeTestAdapterV1({ suite: c.suite, parentRoot: c.parent,
    totalTimeoutMs: 10000, childTimeoutMs: 5000, closeGraceMs: 500 });
  // Static evidence is a trusted test stub, not a Swift/native execution claim.
  const stat = { check: p => ({ status: 'PASS', evidence: { ...p.binding, findings: [], reason: '' } }),
    settled: async () => [], observations: () => [], status: () => 'IDLE', lateObservations: () => [] };
  const host = createRepositoryWorkflowOwnerV1({ suite: c.suite, staticOwner: stat, testsOwner: node });
  const original = fs.lstat;
  const mock = t.mock.method(fs, 'lstat', async (...args) => {
    if (args[0] === c.parent) { started.resolve(); await release.promise; }
    return original(...args);
  });
  const running = host.run({ ...fixedOptions(c), signal: controller.signal });
  let watchdog;
  try {
    await startObserved(started.promise); controller.abort();
    const report = await Promise.race([running, new Promise((_, reject) => {
      watchdog = setTimeout(() => reject(Error('host abort report did not return')), 1000);
    })]);
    assert.equal(report.outcome, 'CANCELLED'); assert.ok(Object.isFrozen(report));
    const snapshot = JSON.stringify(report), diagnostic = host.materializationObservations(), early = diagnostic.rows;
    assert.equal(diagnostic.availability, 'AVAILABLE'); assert.equal(diagnostic.authorizing, false);
    assert.ok(Object.isFrozen(early)); assert.equal(early[0].underlyingSettlement, 'PENDING');
    assert.equal(early[0].binding.runId, report.runId); assert.equal(early[0].binding.attempt, 0);
    let joined = false; const finishing = host.settled().then(result => { joined = true; return result; });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(joined, false);
    release.resolve(); const result = await finishing;
    assert.equal(JSON.stringify(report), snapshot); assert.equal(result.report, report);
    assert.equal(result.state, 'QUARANTINED'); assert.equal(result.ownerStates.tests, 'QUARANTINED');
    assert.equal(result.bundle, null); assert.equal(result.proposedChanges, null);
    assert.equal(result.testHistory[0].workspace, null); assert.equal(result.testHistory[0].execution, null);
    const late = host.materializationObservations().rows; assert.equal(late.length, 2);
    assert.equal(late[1].event, 'LATE_SETTLEMENT'); assert.equal(late[1].underlyingSettlement, 'REJECTED');
    assert.equal(late[1].binding.runId, report.runId); assert.equal(late[1].binding.attempt, 0);
    assert.equal(early.length, 1, 'previous observation snapshot is not retroactively changed');
  } finally {
    clearTimeout(watchdog); release.resolve(); await running; await host.settled(); mock.mock.restore();
  }
});

test('host diagnostics distinguish missing and failing callbacks from observed empty history', async t => {
  const c = await context(t);
  const stub = key => ({ [key]: () => {}, registrationFingerprint: 'a'.repeat(64),
    settled: async () => [], observations: () => [], status: () => 'IDLE', lateObservations: () => [] });
  const make = node => createRepositoryWorkflowOwnerV1({ suite: c.suite, staticOwner: stub('check'), testsOwner: node });
  const missing = make(stub('run')).materializationObservations();
  assert.equal(missing.availability, 'UNAVAILABLE'); assert.equal(missing.reason, 'NOT_SUPPORTED');
  const empty = make({ ...stub('run'), materializationObservations: () => [] }).materializationObservations();
  assert.equal(empty.availability, 'AVAILABLE'); assert.deepEqual(empty.rows, []); assert.equal(empty.reason, null);
  for (const callback of [() => { throw Object.assign(Error('private'), { code: 'DIAGNOSTIC_FAILURE' }); },
    () => null, () => Array(203).fill(null)]) {
    const failed = make({ ...stub('run'), materializationObservations: callback }).materializationObservations();
    assert.equal(failed.availability, 'UNAVAILABLE'); assert.equal(failed.reason, 'READ_FAILED');
    assert.equal(failed.authorizing, false); assert.ok(Object.isFrozen(failed));
    assert.equal(JSON.stringify(failed).includes('private'), false);
  }
});
