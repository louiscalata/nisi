// PRIVATE synthetic token-accounting tests; values are not measured model usage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeLiveUsage as summarize } from '../receipts/live-usage-v1.mjs';
const receipt = (promptTokens, completionTokens) => ({ usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens } });

test('live usage computes exact complete totals and distinguishes reported zero from unknown', () => {
  assert.deepEqual(summarize([receipt(40, 10), receipt(30, 5)]), { calls: 2, knownCalls: 2, unknownCalls: 0,
    totals: { promptTokens: 70, completionTokens: 15, totalTokens: 85 }, knownSubtotal: { promptTokens: 70, completionTokens: 15, totalTokens: 85 }, complete: true });
  const zero = summarize([receipt(0, 0)]); assert.equal(zero.complete, true);
  assert.deepEqual(zero.totals, { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
});

test('live usage leaves empty unknown and partially known inventories without a fabricated total', () => {
  for (const inputs of [[], [{ usage: null }], [{ usage: null }, { usage: null }], [receipt(40, 10), { usage: null }]]) {
    const result = summarize(inputs); assert.equal(result.totals, null); assert.equal(result.complete, false);
    assert.equal(result.calls, inputs.length); assert.equal(result.unknownCalls, inputs.filter(r => r.usage === null).length);
  }
  assert.deepEqual(summarize([receipt(40, 10), { usage: null }]).knownSubtotal, { promptTokens: 40, completionTokens: 10, totalTokens: 50 });
});

test('live usage rejects fractional negative-zero malformed and inconsistent supplied counts', () => {
  for (const key of ['promptTokens', 'completionTokens', 'totalTokens']) for (const value of [-0, -1, 0.5, NaN, Infinity, '1', null, Number.MAX_SAFE_INTEGER + 1]) {
    const r = receipt(1, 1); r.usage[key] = value;
    assert.throws(() => summarize([r]), { code: 'LIVE_USAGE_INVALID' });
  }
  for (const inputs of [null, {}, [null], [{}], [{ usage: {} }], [{ usage: { ...receipt(1, 1).usage, extra: 1 } }],
    [{ usage: { promptTokens: 1, completionTokens: 1, totalTokens: 3 } }], [receipt(0, 0), receipt(0, 0), receipt(0, 0)]])
    assert.throws(() => summarize(inputs), { code: 'LIVE_USAGE_INVALID' });
});

test('live usage rejects unsafe within-call sums and cross-call aggregate overflow', () => {
  assert.throws(() => summarize([{ usage: { promptTokens: Number.MAX_SAFE_INTEGER, completionTokens: 1, totalTokens: Number.MAX_SAFE_INTEGER } }]), { code: 'LIVE_USAGE_INVALID' });
  for (const inputs of [[receipt(Number.MAX_SAFE_INTEGER, 0), receipt(1, 0)],
    [receipt(0, Number.MAX_SAFE_INTEGER), receipt(0, 1)], [receipt(Number.MAX_SAFE_INTEGER, 0), receipt(0, 1)]])
    assert.throws(() => summarize(inputs), { code: 'LIVE_USAGE_OVERFLOW' });
  assert.equal(summarize([receipt(Number.MAX_SAFE_INTEGER, 0)]).totals.totalTokens, Number.MAX_SAFE_INTEGER);
});

test('live usage results freeze independent totals and subtotals without freezing receipt input', () => {
  const inputs = [receipt(40, 10)], result = summarize(inputs); inputs[0].usage.promptTokens = 1;
  assert.deepEqual(result.totals, { promptTokens: 40, completionTokens: 10, totalTokens: 50 });
  assert.notEqual(result.totals, result.knownSubtotal); assert(Object.isFrozen(result)); assert(Object.isFrozen(result.totals)); assert(Object.isFrozen(result.knownSubtotal));
  assert.equal(Object.isFrozen(inputs[0].usage), false);
  assert.throws(() => { result.totals.totalTokens = 0; }, TypeError);
});
