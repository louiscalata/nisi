// PRIVATE controller fault injection with synthetic executor evidence only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSwiftStaticGroupOwnerV1 } from '../hosts/swift-verifier/group-adapter-v1.mjs';
import { createSwiftCheckPlanV1 } from '../hosts/swift-verifier/check-plan-v1.mjs';
import { baseline, targets, profile, prep, entry, runId } from './helpers/swift-group-fixture.mjs';
const input = (signal, attempt = 0) => { const p = prep(); return { task: p.task, candidate: p.candidate, signal,
  binding: { schemaVersion: 1, runId, taskFingerprint: p.taskFingerprint, candidateFingerprint: p.candidateFingerprint, attempt } }; };
function fixture(run) {
  const calls = []; let state = 'IDLE';
  const executor = { plan: p => createSwiftCheckPlanV1({ ...p, executionProfile: profile }),
    status: () => state, lateObservations: () => [], execute: async ({ plan, index, signal }) => {
      calls.push(index); const e = await run({ plan, index, signal, quarantine: () => { state = 'QUARANTINED'; } });
      return Object.freeze({ receipt: e.receipt, rawObservation: { stdoutHex: e.stdoutHex, stderrHex: e.stderrHex } });
    } };
  return { owner: createSwiftStaticGroupOwnerV1({ executor, baseline, targets }), calls };
}

test('group owner quarantines an unrecorded operation without fabricating a receipt or complete group', async () => {
  const { owner, calls } = fixture(({ plan, index }) => {
    if (index === 1) throw Object.assign(new Error('Injected operation failure'), { code: 'FIXTURE_UNRECORDED' });
    return entry(plan, index);
  });
  await assert.rejects(owner.check(input()), e => e.code === 'FIXTURE_UNRECORDED');
  const [h] = await owner.settled(); assert.deepEqual(calls, [0, 1]);
  assert.equal(h.group, null); assert.equal(h.error, 'FIXTURE_UNRECORDED');
  assert.equal(h.observations.length, 1); assert.equal(h.partialEntries.length, 1);
  assert.equal(h.partialEntries[0].dispatch, 'OBSERVED'); assert.equal(owner.status(), 'QUARANTINED');
  assert.throws(() => owner.check(input(undefined, 1)), e => e.code === 'SWIFT_GROUP_ADAPTER_UNAVAILABLE');
  assert.deepEqual(calls, [0, 1]);
});

test('group owner preserves child-only deadline and refuses reuse when drain remains unknown', async () => {
  const { owner, calls } = fixture(({ plan, index, quarantine }) => {
    quarantine(); return entry(plan, index, 'INCONCLUSIVE', { reason: 'DEADLINE_EXCEEDED', process: {
      closed: false, exitCode: null, drain: 'UNKNOWN', cancelRequested: true, deadlineExceeded: true, durationMs: 5000 } });
  });
  assert.equal((await owner.check(input())).status, 'UNAVAILABLE');
  const [h] = await owner.settled(); assert.deepEqual(calls, [0]);
  assert.equal(h.group.stopReason, 'CHILD_UNAVAILABLE'); assert.equal(h.group.aggregate.unknownDrainCount, 1);
  assert.equal(h.group.aggregate.counts.NOT_DISPATCHED, 2);
  assert.equal(h.group.entries[0].receipt.result.reason, 'DEADLINE_EXCEEDED');
  assert.throws(() => owner.check(input(undefined, 1)), e => e.code === 'SWIFT_GROUP_ADAPTER_UNAVAILABLE');
});

test('group owner stops between children on abort without rewriting a completed raw PASS', async () => {
  const c = new AbortController(), { owner, calls } = fixture(({ plan, index }) => { c.abort(); return entry(plan, index); });
  assert.equal((await owner.check(input(c.signal))).status, 'UNAVAILABLE');
  const [h] = await owner.settled(); assert.deepEqual(calls, [0]);
  assert.equal(h.group.stopReason, 'ABORTED'); assert.equal(h.group.aggregate.counts.PASS, 1);
  assert.equal(h.group.entries[0].receipt.process.cancelRequested, false);
  assert.equal(h.group.aggregate.counts.NOT_DISPATCHED, 2);
});

test('group owner preserves host abort over uncertain child cleanup and stays quarantined', async () => {
  const c = new AbortController(), { owner, calls } = fixture(({ plan, index, quarantine }) => {
    c.abort(); quarantine(); return entry(plan, index, 'INCONCLUSIVE', { reason: 'ABORTED', process: {
      closed: false, exitCode: null, drain: 'UNKNOWN', cancelRequested: true } });
  });
  const result = await owner.check(input(c.signal)), [h] = await owner.settled();
  assert.equal(result.status, 'UNAVAILABLE'); assert.deepEqual(calls, [0]);
  assert.equal(h.group.stopReason, 'ABORTED'); assert.equal(h.group.aggregate.unknownDrainCount, 1);
  assert.equal(h.group.aggregate.counts.PASS, 0); assert.equal(h.group.aggregate.counts.NOT_DISPATCHED, 2);
  assert.equal(h.group.entries[0].receipt.process.closed, false);
  assert.equal(h.group.entries[0].receipt.result.reason, 'ABORTED'); assert.equal(owner.status(), 'QUARANTINED');
  assert.throws(() => owner.check(input(undefined, 1)), e => e.code === 'SWIFT_GROUP_ADAPTER_UNAVAILABLE');
});

test('group owner continues clean quality failures and freezes accumulated findings', async () => {
  const { owner, calls } = fixture(({ plan, index }) => entry(plan, index, index < 2 ? 'FAIL' : 'PASS'));
  const result = await owner.check(input()), [h] = await owner.settled();
  assert.equal(result.status, 'FAIL'); assert.deepEqual(calls, [0, 1, 2]);
  assert.equal(h.group.aggregate.knownFindings.length, 2); assert.equal(h.group.aggregate.counts.PASS, 1);
  assert(Object.isFrozen(h.group.entries[0].receipt)); assert(Object.isFrozen(result.evidence.findings));
  await assert.rejects(owner.check(input()), e => e.code === 'SWIFT_GROUP_ADAPTER_BINDING');
});

test('group owner rejects missing targets or bad task binding before dispatch', async () => {
  const { owner, calls } = fixture(({ plan, index }) => entry(plan, index));
  const p = input(); p.binding.taskFingerprint = '0'.repeat(64);
  await assert.rejects(owner.check(p), e => e.code === 'SWIFT_GROUP_ADAPTER_BINDING');
  assert.deepEqual(calls, []); assert.equal(owner.status(), 'IDLE'); assert.deepEqual(owner.observations(), []);
  assert.throws(() => createSwiftStaticGroupOwnerV1({ executor: {}, baseline, targets }), e => e.code === 'SWIFT_GROUP_EXECUTOR_REQUIRED');
  assert.equal((await owner.check(input())).status, 'PASS');
});
