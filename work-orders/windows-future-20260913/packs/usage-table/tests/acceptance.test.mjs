import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUsageTable } from '../src/index.mjs';

const baseRow = (patch = {}) => ({
  id: 'r1', stage: 'draft', provider: 'local', model: 'model-a',
  inputTokens: 2, outputTokens: 3, reasoningTokens: 1, durationMs: 4, ...patch
});
const input = (rows = [baseRow()], patch = {}) => ({ runId: 'run-1', rows, ...patch });
const refused = { status: 'REFUSED', reason: 'INVALID_INPUT', authorizing: false };

test('empty input returns the exact ready shape with zero totals', () => {
  assert.deepEqual(buildUsageTable(input([])), {
    schemaVersion: 1, status: 'READY', runId: 'run-1', rows: [],
    totals: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0, durationMs: 0 },
    unknownRows: 0, authorizing: false
  });
});

test('known zero counters and duration remain numeric zero', () => {
  const row = baseRow({ inputTokens: 0, outputTokens: 0, reasoningTokens: 0, durationMs: 0 });
  const out = buildUsageTable(input([row]));
  assert.deepEqual(out.rows, [{ ...row, totalTokens: 0 }]);
  assert.deepEqual(out.totals, { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0, durationMs: 0 });
  assert.equal(out.unknownRows, 0);
});

test('nullable metrics produce row and column unknowns without inventing zeros', () => {
  const out = buildUsageTable(input([baseRow({ outputTokens: null, reasoningTokens: null, durationMs: null })]));
  assert.deepEqual(out.rows[0], { ...baseRow({ outputTokens: null, reasoningTokens: null, durationMs: null }), totalTokens: null });
  assert.deepEqual(out.totals, { inputTokens: 2, outputTokens: null, reasoningTokens: null, totalTokens: null, durationMs: null });
  assert.equal(out.unknownRows, 1);
});

test('reasoning tokens are reported as a subset and are not double-counted in totalTokens', () => {
  const out = buildUsageTable(input([baseRow({ inputTokens: 10, outputTokens: 20, reasoningTokens: 7 })]));
  assert.equal(out.rows[0].totalTokens, 30);
  assert.equal(out.totals.totalTokens, 30);
  assert.equal(out.totals.reasoningTokens, 7);
});

test('multiple rows sum each known column and count unknown rows', () => {
  const rows = [baseRow({ id: 'a', inputTokens: 1, outputTokens: 2, reasoningTokens: 1, durationMs: 3 }),
    baseRow({ id: 'b', inputTokens: null, outputTokens: 4, reasoningTokens: 2, durationMs: null })];
  const out = buildUsageTable(input(rows));
  assert.deepEqual(out.totals, { inputTokens: null, outputTokens: 6, reasoningTokens: 3, totalTokens: null, durationMs: null });
  assert.equal(out.unknownRows, 1);
});

test('input is exact and invalid ordinary values are refused', () => {
  for (const value of [null, [], {}, { runId: 'r', rows: [], extra: true }, { runId: '', rows: [] },
    { runId: 'x'.repeat(129), rows: [] }, { runId: 'r', rows: new Array(201).fill(baseRow()) },
    { runId: 'r', rows: [{ ...baseRow(), extra: true }] }, { runId: 'r', rows: [{ ...baseRow(), id: '' }] },
    { runId: 'r', rows: [{ ...baseRow(), id: 'x'.repeat(129) }] },
    { runId: 'r', rows: [{ ...baseRow(), id: 'r1' }, baseRow({ id: 'r1' })] }]) {
    assert.deepEqual(buildUsageTable(value), refused);
  }
});

test('provider and model may be null but non-null labels must be bounded nonempty strings', () => {
  assert.equal(buildUsageTable(input([baseRow({ provider: null, model: null })])).status, 'READY');
  for (const patch of [{ provider: '' }, { model: '' }, { provider: 'x'.repeat(129) }, { model: 'x'.repeat(129) },
    { provider: 3 }, { model: {} }]) assert.deepEqual(buildUsageTable(input([baseRow(patch)])), refused);
});

test('negative, unsafe, negative-zero and invalid duration metrics are refused', () => {
  for (const patch of [{ inputTokens: -1 }, { outputTokens: -1 }, { reasoningTokens: -1 },
    { inputTokens: Number.MAX_SAFE_INTEGER + 1 }, { outputTokens: Number.MAX_SAFE_INTEGER + 1 },
    { reasoningTokens: Number.MAX_SAFE_INTEGER + 1 }, { inputTokens: -0 }, { outputTokens: -0 },
    { reasoningTokens: -0 }, { durationMs: -1 }, { durationMs: -0 }, { durationMs: Infinity },
    { durationMs: NaN }, { reasoningTokens: 4, outputTokens: 3 }]) {
    assert.deepEqual(buildUsageTable(input([baseRow(patch)])), refused);
  }
});

test('known reasoning count with unknown output does not invent a contradiction', () => {
  const out = buildUsageTable(input([baseRow({ reasoningTokens: 1, outputTokens: null })]));
  assert.equal(out.status, 'READY');
  assert.equal(out.rows[0].totalTokens, null);
  assert.equal(out.totals.reasoningTokens, 1);
});

test('numeric overflow makes the affected totals null', () => {
  const n = Number.MAX_SAFE_INTEGER;
  const rows = [baseRow({ id: 'a', inputTokens: n, outputTokens: 0, reasoningTokens: 0, durationMs: n }),
    baseRow({ id: 'b', inputTokens: 1, outputTokens: 0, reasoningTokens: 0, durationMs: 1 })];
  const out = buildUsageTable(input(rows));
  assert.equal(out.rows[0].totalTokens, n);
  assert.equal(out.totals.inputTokens, null);
  assert.equal(out.totals.totalTokens, null);
  assert.equal(out.totals.durationMs, null);
});

test('output is cloned and does not mutate or alias the input', () => {
  const row = baseRow(); const request = input([row]);
  const before = structuredClone(request); const out = buildUsageTable(request);
  assert.deepEqual(request, before);
  assert.notStrictEqual(out.rows, request.rows);
  assert.notStrictEqual(out.rows[0], request.rows[0]);
  out.rows[0].id = 'changed'; out.totals.inputTokens = 999;
  assert.equal(request.rows[0].id, 'r1'); assert.equal(request.rows[0].inputTokens, 2);
});

test('identical input is deterministic', () => {
  const request = input([baseRow(), baseRow({ id: 'r2', durationMs: 1.5 })]);
  assert.deepEqual(buildUsageTable(request), buildUsageTable(request));
});
