import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUsageTable } from '../src/index.mjs';

test('boundary test group 1: max durationMs preserves row, totals.durationMs null', () => {
  const input = {
    runId: 'r1',
    rows: [{
      id: 'id1',
      stage: 's1',
      provider: null,
      model: null,
      inputTokens: 1,
      outputTokens: 2,
      reasoningTokens: 1,
      durationMs: Number.MAX_VALUE
    }]
  };
  const result = buildUsageTable(input);
  assert.strictEqual(result.schemaVersion, 1);
  assert.strictEqual(result.status, 'READY');
  assert.strictEqual(result.authorizing, false);
  assert.strictEqual(result.runId, 'r1');
  assert.strictEqual(result.rows.length, 1);
  const row = result.rows[0];
  assert.strictEqual(row.durationMs, Number.MAX_VALUE);
  assert.strictEqual(row.totalTokens, 3);
  assert.strictEqual(result.totals.durationMs, null);
  assert.strictEqual(result.totals.inputTokens, 1);
  assert.strictEqual(result.totals.outputTokens, 2);
  assert.strictEqual(result.totals.reasoningTokens, 1);
  assert.strictEqual(result.totals.totalTokens, 3);
  assert.strictEqual(result.unknownRows, 0);
});

test('boundary test group 2: two rows with finite durations', () => {
  const input = {
    runId: 'r2',
    rows: [
      { id: 'id1', stage: 's1', provider: null, model: null, inputTokens: 1, outputTokens: 2, reasoningTokens: 1, durationMs: 1.25 },
      { id: 'id2', stage: 's2', provider: null, model: null, inputTokens: 1, outputTokens: 2, reasoningTokens: 1, durationMs: 2.5 }
    ]
  };
  const result = buildUsageTable(input);
  assert.strictEqual(result.totals.durationMs, 3.75);
  assert.strictEqual(result.totals.inputTokens, 2);
  assert.strictEqual(result.totals.outputTokens, 4);
  assert.strictEqual(result.totals.reasoningTokens, 2);
  assert.strictEqual(result.totals.totalTokens, 6);
  assert.strictEqual(result.unknownRows, 0);
});

test('boundary test group 3: MAX_SAFE_INTEGER inputTokens overflow totals', () => {
  const input = {
    runId: 'r3',
    rows: [{
      id: 'id1',
      stage: 's1',
      provider: null,
      model: null,
      inputTokens: Number.MAX_SAFE_INTEGER,
      outputTokens: 1,
      reasoningTokens: 0,
      durationMs: 0
    }]
  };
  const result = buildUsageTable(input);
  assert.strictEqual(result.rows[0].totalTokens, null);
  assert.strictEqual(result.totals.inputTokens, Number.MAX_SAFE_INTEGER);
  assert.strictEqual(result.totals.outputTokens, 1);
  assert.strictEqual(result.totals.reasoningTokens, 0);
  assert.strictEqual(result.totals.totalTokens, null);
  assert.strictEqual(result.totals.durationMs, 0);
  assert.strictEqual(result.unknownRows, 0);
});

test('boundary test group 4: mixed null tokens and duration', () => {
  const input = {
    runId: 'r4',
    rows: [
      { id: 'id1', stage: 's1', provider: null, model: null, inputTokens: null, outputTokens: 2, reasoningTokens: 1, durationMs: 3 },
      { id: 'id2', stage: 's2', provider: null, model: null, inputTokens: 5, outputTokens: 7, reasoningTokens: 2, durationMs: 11 }
    ]
  };
  const result = buildUsageTable(input);
  assert.strictEqual(result.totals.inputTokens, null);
  assert.strictEqual(result.totals.outputTokens, 9);
  assert.strictEqual(result.totals.reasoningTokens, 3);
  assert.strictEqual(result.totals.totalTokens, null);
  assert.strictEqual(result.totals.durationMs, 14);
  assert.strictEqual(result.unknownRows, 1);
});

test('boundary test group 5: 200 rows max cap', () => {
  const rows = [];
  for (let i = 0; i < 200; i++) {
    rows.push({
      id: `id${i}`,
      stage: 's1',
      provider: null,
      model: null,
      inputTokens: 1,
      outputTokens: 2,
      reasoningTokens: 1,
      durationMs: 0.5
    });
  }
  const input = { runId: 'r5', rows };
  const result = buildUsageTable(input);
  assert.strictEqual(result.rows.length, 200);
  for (let i = 0; i < 200; i++) {
    assert.strictEqual(result.rows[i].id, `id${i}`);
    assert.strictEqual(result.rows[i].totalTokens, 3);
  }
  assert.strictEqual(result.totals.inputTokens, 200);
  assert.strictEqual(result.totals.outputTokens, 400);
  assert.strictEqual(result.totals.reasoningTokens, 200);
  assert.strictEqual(result.totals.totalTokens, 600);
  assert.strictEqual(result.totals.durationMs, 100);
  assert.strictEqual(result.unknownRows, 0);
});
