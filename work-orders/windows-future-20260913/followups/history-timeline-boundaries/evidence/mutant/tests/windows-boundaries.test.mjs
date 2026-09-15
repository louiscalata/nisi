import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline } from '../src/index.mjs';

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const LONG_STR = 'x'.repeat(128);

const makeEvent = (id, attempt, createdAt, stage, status, durationMs, receiptId) => ({
  id, attempt, createdAt, stage, status, durationMs, receiptId
});

test('buildTimeline: exactly 200 events with bounded fields', () => {
  const events = Array.from({ length: 200 }, (_, i) => makeEvent(
    `e${i}`, 2, 10, 'check', 'PASS', i % 2 === 0 ? null : 1.5, null
  ));
  const input = { runId: 'r1', events };
  const result = buildTimeline(input);

  assert.strictEqual(result.schemaVersion, 1);
  assert.strictEqual(result.status, 'READY');
  assert.strictEqual(result.authorizing, false);
  assert.strictEqual(result.runId, 'r1');
  assert.strictEqual(result.events.length, 200);

  // All events sorted by attempt=2, createdAt=10, original index
  result.events.forEach((ev, i) => {
    assert.strictEqual(ev.id, `e${i}`);
    assert.strictEqual(ev.sequence, i + 1);
  });

  assert.strictEqual(result.attempts.length, 1);
  assert.strictEqual(result.attempts[0].attempt, 2);
  assert.deepStrictEqual(result.attempts[0].eventIds, events.map(e => e.id));
  assert.strictEqual(result.attempts[0].unknownDurations, 100);
});

test('buildTimeline: 128-char strings accepted unchanged', () => {
  const input = {
    runId: LONG_STR,
    events: [{
      id: LONG_STR,
      attempt: 0,
      createdAt: 0,
      stage: LONG_STR,
      status: 'INCONCLUSIVE',
      durationMs: 0,
      receiptId: LONG_STR
    }]
  };
  const result = buildTimeline(input);

  assert.strictEqual(result.authorizing, false);
  assert.strictEqual(result.runId, LONG_STR);
  assert.strictEqual(result.events[0].id, LONG_STR);
  assert.strictEqual(result.events[0].stage, LONG_STR);
  assert.strictEqual(result.events[0].status, 'INCONCLUSIVE');
  assert.strictEqual(result.events[0].receiptId, LONG_STR);
});

test('buildTimeline: MAX_SAFE attempt and createdAt', () => {
  const input = {
    runId: 'r1',
    events: [{
      id: 'e1',
      attempt: MAX_SAFE,
      createdAt: MAX_SAFE,
      stage: 's1',
      status: 'PASS',
      durationMs: null,
      receiptId: null
    }]
  };
  const result = buildTimeline(input);

  assert.strictEqual(result.authorizing, false);
  assert.strictEqual(result.events[0].attempt, MAX_SAFE);
  assert.strictEqual(result.events[0].createdAt, MAX_SAFE);
});

test('buildTimeline: large finite durations preserved', () => {
  const input = {
    runId: 'r1',
    events: [
      { id: 'e1', attempt: 1, createdAt: 1, stage: 's', status: 'PASS', durationMs: Number.MAX_VALUE, receiptId: null },
      { id: 'e2', attempt: 1, createdAt: 2, stage: 's', status: 'FAIL', durationMs: 1.5, receiptId: null }
    ]
  };
  const result = buildTimeline(input);

  assert.strictEqual(result.authorizing, false);
  assert.deepStrictEqual(result.events.map(event => event.status), ['PASS', 'FAIL']);
  assert.strictEqual(result.events[0].durationMs, Number.MAX_VALUE);
  assert.strictEqual(result.events[1].durationMs, 1.5);
  assert.strictEqual(result.attempts[0].unknownDurations, 0);
});

test('buildTimeline: out-of-order events sorted correctly', () => {
  const input = {
    runId: 'r1',
    events: [
      { id: 'A', attempt: MAX_SAFE, createdAt: MAX_SAFE, stage: 's', status: 'PASS', durationMs: null, receiptId: null },
      { id: 'B', attempt: MAX_SAFE - 1, createdAt: MAX_SAFE, stage: 's', status: 'FAIL', durationMs: 0, receiptId: null },
      { id: 'C', attempt: MAX_SAFE, createdAt: MAX_SAFE - 1, stage: 's', status: 'INCONCLUSIVE', durationMs: 1, receiptId: null }
    ]
  };
  const result = buildTimeline(input);

  assert.strictEqual(result.authorizing, false);
  assert.deepStrictEqual(result.events.map(event => event.status), ['FAIL', 'INCONCLUSIVE', 'PASS']);
  // Sort: B (attempt-1), then C (same attempt as A but earlier createdAt), then A
  assert.strictEqual(result.events[0].id, 'B');
  assert.strictEqual(result.events[0].sequence, 1);
  assert.strictEqual(result.events[1].id, 'C');
  assert.strictEqual(result.events[1].sequence, 2);
  assert.strictEqual(result.events[2].id, 'A');
  assert.strictEqual(result.events[2].sequence, 3);

  assert.strictEqual(result.attempts.length, 2);
  assert.strictEqual(result.attempts[0].attempt, MAX_SAFE - 1);
  assert.deepStrictEqual(result.attempts[0].eventIds, ['B']);
  assert.strictEqual(result.attempts[0].unknownDurations, 0);
  assert.strictEqual(result.attempts[1].attempt, MAX_SAFE);
  assert.deepStrictEqual(result.attempts[1].eventIds, ['C', 'A']);
  assert.strictEqual(result.attempts[1].unknownDurations, 1);
});
