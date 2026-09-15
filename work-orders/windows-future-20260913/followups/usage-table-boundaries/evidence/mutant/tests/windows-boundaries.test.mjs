import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUsageTable } from '../src/index.mjs';

// Exact copied arithmetic boundary from the installed five-group oracle.
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
