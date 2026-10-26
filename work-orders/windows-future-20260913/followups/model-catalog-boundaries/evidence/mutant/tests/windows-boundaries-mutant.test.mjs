import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModelCatalog } from '../src/index.mjs';

function make200Rows() {
  return Array.from({ length: 200 }, (_, i) => ({
    id: `m${i}`,
    provider: 'p',
    label: 'model',
    availability: ['AVAILABLE', 'UNAVAILABLE', 'UNKNOWN'][i % 3],
    location: ['LOCAL', 'REMOTE', 'UNKNOWN'][i % 3]
  }));
}

test('maximum counts are exact and conserve the total', () => {
  const result = buildModelCatalog({ models: make200Rows() });
  assert.deepStrictEqual(result.counts, {
    total: 200,
    available: 67,
    unavailable: 67,
    unknown: 66,
    local: 67,
    remote: 67,
    unknownLocation: 66
  });
  assert.strictEqual(result.counts.available + result.counts.unavailable + result.counts.unknown, 200);
  assert.strictEqual(result.counts.local + result.counts.remote + result.counts.unknownLocation, 200);
});
