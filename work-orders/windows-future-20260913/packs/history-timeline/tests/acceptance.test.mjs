import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline } from '../src/index.mjs';

const baseEvent = (patch = {}) => ({
  id: 'e1', attempt: 0, stage: 'draft', status: 'PASS', createdAt: 10, durationMs: 2, receiptId: 'receipt-1', ...patch
});
const input = (events = [baseEvent()], patch = {}) => ({ runId: 'run-1', events, ...patch });
const refused = { status: 'REFUSED', reason: 'INVALID_INPUT', authorizing: false };

test('empty input returns the exact ready shape', () => {
  assert.deepEqual(buildTimeline(input([])), { schemaVersion: 1, status: 'READY', runId: 'run-1', events: [], attempts: [], authorizing: false });
});

test('events sort by attempt then createdAt, with input order as the tie-breaker', () => {
  const events = [baseEvent({ id: 'late', attempt: 1, createdAt: 1 }), baseEvent({ id: 'first', attempt: 0, createdAt: 20 }),
    baseEvent({ id: 'tie-a', attempt: 0, createdAt: 20 }), baseEvent({ id: 'early', attempt: 0, createdAt: 2 })];
  const out = buildTimeline(input(events));
  assert.deepEqual(out.events.map(e => [e.sequence, e.id]), [[1, 'early'], [2, 'first'], [3, 'tie-a'], [4, 'late']]);
});

test('all terminal and nonterminal statuses remain distinct', () => {
  const statuses = ['PASS', 'FAIL', 'NOT_RUN', 'ERROR', 'INCONCLUSIVE', 'CANCELLED', 'TIMED_OUT'];
  const out = buildTimeline(input(statuses.map((status, i) => baseEvent({ id: `e${i}`, status, createdAt: i }))));
  assert.deepEqual(out.events.map(e => e.status), statuses);
});

test('duplicate stage observations with different IDs are retained', () => {
  const out = buildTimeline(input([baseEvent({ id: 'a' }), baseEvent({ id: 'b', createdAt: 11 })]));
  assert.deepEqual(out.events.map(e => e.id), ['a', 'b']);
  assert.deepEqual(out.attempts, [{ attempt: 0, eventIds: ['a', 'b'], unknownDurations: 0 }]);
});

test('attempt groups retain sorted event IDs and count unknown durations', () => {
  const events = [baseEvent({ id: 'z', attempt: 2, createdAt: 4, durationMs: null }), baseEvent({ id: 'a', attempt: 1, createdAt: 3, durationMs: null }),
    baseEvent({ id: 'b', attempt: 1, createdAt: 4, durationMs: 0 })];
  const out = buildTimeline(input(events));
  assert.deepEqual(out.attempts, [{ attempt: 1, eventIds: ['a', 'b'], unknownDurations: 1 }, { attempt: 2, eventIds: ['z'], unknownDurations: 1 }]);
});

test('input is exact and invalid ordinary values are refused', () => {
  for (const value of [null, [], {}, { runId: 'r', events: [], extra: true }, { runId: '', events: [] },
    { runId: 'x'.repeat(129), events: [] }, { runId: 'r', events: new Array(201).fill(baseEvent()) },
    { runId: 'r', events: [{ ...baseEvent(), extra: true }] }, { runId: 'r', events: [{ ...baseEvent(), id: '' }] },
    { runId: 'r', events: [{ ...baseEvent(), id: 'x'.repeat(129) }] },
    { runId: 'r', events: [{ ...baseEvent(), id: 'a' }, baseEvent({ id: 'a' })] }]) {
    assert.deepEqual(buildTimeline(value), refused);
  }
});

test('attempt and createdAt require safe nonnegative integers excluding negative zero', () => {
  for (const patch of [{ attempt: -1 }, { attempt: -0 }, { attempt: Number.MAX_SAFE_INTEGER + 1 },
    { createdAt: -1 }, { createdAt: -0 }, { createdAt: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.deepEqual(buildTimeline(input([baseEvent(patch)])), refused);
  }
});

test('stage, status, receiptId and duration validation is bounded and exact', () => {
  for (const patch of [{ stage: '' }, { stage: 'x'.repeat(129) }, { stage: 3 }, { status: 'UNKNOWN' },
    { receiptId: '' }, { receiptId: 'x'.repeat(129) }, { receiptId: 3 }, { durationMs: -1 }, { durationMs: -0 },
    { durationMs: Infinity }, { durationMs: NaN }]) {
    assert.deepEqual(buildTimeline(input([baseEvent(patch)])), refused);
  }
  assert.equal(buildTimeline(input([baseEvent({ receiptId: null, durationMs: null })])).status, 'READY');
});

test('output is cloned and does not mutate or alias the input', () => {
  const request = input([baseEvent()]); const before = structuredClone(request); const out = buildTimeline(request);
  assert.deepEqual(request, before); assert.notStrictEqual(out.events, request.events); assert.notStrictEqual(out.events[0], request.events[0]);
  out.events[0].id = 'changed'; assert.equal(request.events[0].id, 'e1');
});

test('unknown duration is represented only in the attempt count; no outcome is inferred', () => {
  const out = buildTimeline(input([baseEvent({ status: 'NOT_RUN', durationMs: null })]));
  assert.deepEqual(out.events[0], { ...baseEvent({ status: 'NOT_RUN', durationMs: null }), sequence: 1 });
  assert.deepEqual(out.attempts, [{ attempt: 0, eventIds: ['e1'], unknownDurations: 1 }]);
  assert.equal(Object.hasOwn(out, 'outcome'), false); assert.equal(Object.hasOwn(out, 'completeness'), false);
});

test('identical input is deterministic', () => {
  const request = input([baseEvent(), baseEvent({ id: 'e2', attempt: 1, createdAt: 1 })]);
  assert.deepEqual(buildTimeline(request), buildTimeline(request));
});
