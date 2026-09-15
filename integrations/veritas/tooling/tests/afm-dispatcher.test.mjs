// Deterministic contract tests for the bounded AFM fan-out. No model runs here:
// the executor is injected, so every case is hermetic and repeatable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createAFMDispatcher, AFM_MAX_CONCURRENCY, AFM_WINDOW_SLOTS } from '../neural/afm-dispatcher.mjs';
import { fixtureBytes } from '../neural/bn01-fixture.mjs';
import { canonicalFixtureBytes } from '../neural/dual-face-fixture.mjs';
import { typedContext } from './fixtures/typed-context.mjs';

const context = typedContext();
const sha = b => createHash('sha256').update(b).digest('hex');

const bind = over => fixtureBytes({
  kind: 'veritas-admitted-run-bind-v1', profile: 'veritas-bn01-offline-contract-v1',
  schemaVersion: 1, generation: 1, runBudgetCap: AFM_WINDOW_SLOTS, deadlineMs: 1000,
  ...context.pins, ...over });

const packet = (id, over = {}) => canonicalFixtureBytes({
  kind: 'veritas-courier-f32-v1', taskId: id, traveler: 'ELECTRON', ...context.pins,
  generation: 1, channelId: 'channel.0.forward', fromPortId: 'n0.a', toPortId: 'n1.b',
  createdAtMs: 0, ttlMs: 1000, hopCount: 1,
  spaceSha256: context.base.plugins[0].record.output.spaceSha256,
  payloadHex: '0000803f000000400000404000008040', ...over });

const answered = payload => ({ ok: true, code: 'AFM_PACKET_ANSWERED', payloadSha256: sha(payload) });

function rig(execute, over = {}) {
  const made = createAFMDispatcher(bind(), context.baseBytes, context.dualBytes, {
    clock: () => 0, execute, generation: 1, windowDurationMs: 1000, maxCourierIds: 64, ...over });
  return made;
}

test('the measured ceiling is four and the window is sized to yield exactly that', () => {
  assert.equal(AFM_MAX_CONCURRENCY, 4);
  assert.equal(AFM_WINDOW_SLOTS, 40);
  // The scheduler's courier allowance is floor(windowSlots / 10).
  assert.equal(Math.floor(AFM_WINDOW_SLOTS / 10), AFM_MAX_CONCURRENCY);
});

test('binds a dispatcher and reports a non-authorizing status', () => {
  const made = rig(async (p) => answered(p));
  assert.equal(made.ok, true);
  assert.equal(made.code, 'READY_PRIVATE_AFM_DISPATCHER_ONLY');
  for (const flag of ['authorizing', 'modelExecuted', 'promotionGranted', 'certificationGranted']) {
    assert.equal(made[flag], false);
  }
  const status = made.dispatcher.status();
  assert.equal(status.maximumConcurrency, 4);
  assert.equal(status.dispatchesCompleted, 0);
});

test('a four-packet fan-out dispatches and combines in declared order', async () => {
  const seen = [];
  const made = rig(async (p, { taskId }) => { seen.push(taskId); return answered(p); });
  const packets = [packet('t.1'), packet('t.2'), packet('t.3'), packet('t.4')];
  const out = await made.dispatcher.dispatch(packets);
  assert.equal(out.ok, true);
  assert.equal(out.code, 'AFM_DISPATCH_COMPLETE');
  assert.equal(out.packetCount, 4);
  assert.equal(seen.length, 4);
  // order is the caller's, never re-sorted
  assert.deepEqual(out.payloadSha256, packets.map(p => sha(p)));
  assert.equal(out.modelParticipation, 'OBSERVED_ADVISORY_ONLY');
  assert.equal(out.authorizing, false);
  assert.equal(out.modelExecuted, false);
});

test('a fifth packet is refused structurally, before any executor call', async () => {
  let calls = 0;
  const made = rig(async (p) => { calls += 1; return answered(p); });
  const out = await made.dispatcher.dispatch([packet('t.1'), packet('t.2'), packet('t.3'), packet('t.4'), packet('t.5')]);
  assert.equal(out.ok, false);
  assert.equal(out.code, 'AFM_FANOUT_REFUSED');
  assert.equal(out.requested, 5);
  assert.equal(out.maximum, 4);
  assert.equal(calls, 0, 'no executor may run when the fan-out is refused');
});

test('the ceiling cannot be widened through configuration', () => {
  // windowSlots is not an accepted option at all, so no caller can raise the
  // courier allowance the cap is derived from.
  const made = createAFMDispatcher(bind(), context.baseBytes, context.dualBytes, {
    clock: () => 0, execute: async p => answered(p), generation: 1,
    windowDurationMs: 1000, maxCourierIds: 64, windowSlots: 400 });
  assert.equal(made.ok, false);
  assert.equal(made.code, 'CONFIGURATION_REFUSED');
});

test('one refused packet refuses the whole dispatch, with no partial certificate', async () => {
  const made = rig(async (p, { taskId }) => taskId === 't.2'
    ? { ok: false, code: 'AFM_PACKET_UNAVAILABLE', payloadSha256: sha(p) }
    : answered(p));
  const out = await made.dispatcher.dispatch([packet('t.1'), packet('t.2'), packet('t.3')]);
  assert.equal(out.ok, false);
  assert.equal(out.code, 'AFM_PACKET_REFUSED_DOMINATES');
  assert.equal(out.refused, 1);
  assert.deepEqual(out.leafCodes, ['AFM_PACKET_UNAVAILABLE']);
  assert.equal(out.dispatchSha256, undefined, 'a refused dispatch carries no combined digest');
});

test('an executor that self-asserts an unknown shape or authority is refused', async () => {
  for (const bad of [
    { ok: true, code: 'AFM_PACKET_ANSWERED' },                                  // missing digest
    { ok: true, code: 'CERTIFIED', payloadSha256: 'a'.repeat(64) },             // unknown code
    { ok: true, code: 'AFM_PACKET_ANSWERED', payloadSha256: 'zz' },             // bad digest
    { ok: false, code: 'AFM_PACKET_ANSWERED', payloadSha256: 'a'.repeat(64) },  // ok/code disagree
    { ok: true, code: 'AFM_PACKET_ANSWERED', payloadSha256: 'a'.repeat(64), authorizing: true },
    null, 'ok', 42,
  ]) {
    const made = rig(async () => bad);
    const out = await made.dispatcher.dispatch([packet('t.1')]);
    assert.equal(out.ok, false, JSON.stringify(bad));
    assert.equal(out.code, 'AFM_OUTCOME_UNREADABLE');
  }
});

test('an executor that throws refuses the dispatch rather than escaping', async () => {
  const made = rig(async () => { throw new Error('boom'); });
  const out = await made.dispatcher.dispatch([packet('t.1')]);
  assert.equal(out.ok, false);
  assert.equal(out.code, 'AFM_OUTCOME_UNREADABLE');
});

test('the combined digest is reproducible and free of wall-clock', async () => {
  const packets = [packet('t.1'), packet('t.2')];
  const first = await rig(async p => answered(p)).dispatcher.dispatch(packets);
  await new Promise(r => setTimeout(r, 25));
  const second = await rig(async p => answered(p)).dispatcher.dispatch(packets);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.dispatchSha256, second.dispatchSha256);
});

test('different packets give a different combined digest', async () => {
  const a = await rig(async p => answered(p)).dispatcher.dispatch([packet('t.1')]);
  const b = await rig(async p => answered(p)).dispatcher.dispatch([packet('t.9')]);
  assert.notEqual(a.dispatchSha256, b.dispatchSha256);
});

test('empty, non-buffer and aborted dispatches are refused with exact codes', async () => {
  const made = rig(async p => answered(p));
  assert.equal((await made.dispatcher.dispatch([])).code, 'AFM_FANOUT_EMPTY');
  assert.equal((await made.dispatcher.dispatch(['not-a-buffer'])).code, 'AFM_PACKET_BYTES_REFUSED');
  assert.equal((await made.dispatcher.dispatch(packet('t.1'))).code, 'AFM_FANOUT_EMPTY');
  assert.equal((await made.dispatcher.dispatch([packet('t.1')], { nope: 1 })).code, 'ARGUMENTS');
  assert.equal((await made.dispatcher.dispatch([packet('t.1')], { signal: 'x' })).code, 'SIGNAL');
  assert.equal((await made.dispatcher.dispatch([packet('t.1')], { signal: AbortSignal.abort() })).code, 'ABORTED');
});

test('a packet the scheduler refuses stops the dispatch, carrying the queue\'s exact code', async () => {
  // The real queue refuses these, not this module, and the exact leaf code must
  // survive: a generic "admission refused" would erase which rule fired, and
  // would let the enqueue check be removed without any test noticing.
  for (const [over, leafCode] of [
    [{ generation: 9 }, 'GENERATION_MISMATCH'],
    [{ channelId: 'channel.nope' }, 'ROUTE_REFUSED'],
    [{ payloadHex: '0000803f' }, 'TENSOR_MISMATCH'],
    [{ fromPortId: 'n9.z' }, 'ENDPOINT_MISMATCH'],
  ]) {
    let calls = 0;
    const made = rig(async p => { calls += 1; return answered(p); });
    const out = await made.dispatcher.dispatch([packet('t.1', over)]);
    assert.equal(out.ok, false, leafCode);
    assert.equal(out.code, 'AFM_ADMISSION_REFUSED', leafCode);
    assert.equal(out.leafCode, leafCode);
    assert.equal(calls, 0, 'no executor may run when admission is refused');
  }
});

test('a stopped dispatcher refuses further work', async () => {
  const made = rig(async p => answered(p));
  assert.equal(made.dispatcher.stop().code, 'AFM_DISPATCHER_STOPPED');
  const out = await made.dispatcher.dispatch([packet('t.1')]);
  assert.equal(out.code, 'DISPATCHER_STOPPED');
});
