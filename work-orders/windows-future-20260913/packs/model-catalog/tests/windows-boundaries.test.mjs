import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModelCatalog } from '../src/index.mjs';

function makeRow(i) {
  const id = `m${i}`;
  const provider = 'p';
  const label = 'model';
  const availability = ['AVAILABLE', 'UNAVAILABLE', 'UNKNOWN'][i % 3];
  const location = ['LOCAL', 'REMOTE', 'UNKNOWN'][i % 3];
  return { id, provider, label, availability, location };
}

function make200Rows() {
  return Array.from({ length: 200 }, (_, i) => makeRow(i));
}

function makeLongString() {
  return 'a'.repeat(128);
}

test('buildModelCatalog: 200-row boundary', () => {
  const input = { models: make200Rows() };
  const result = buildModelCatalog(input);
  assert.strictEqual(result.schemaVersion, 1);
  assert.strictEqual(result.status, 'READY');
  assert.strictEqual(result.authorizing, false);
  assert.deepStrictEqual(result.rows, input.models);
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

test('buildModelCatalog: 128-char string boundary', () => {
  const longStr = makeLongString();
  const input = {
    models: [
      { id: longStr, provider: longStr, label: longStr, availability: 'AVAILABLE', location: 'LOCAL' }
    ]
  };
  const result = buildModelCatalog(input);
  assert.strictEqual(result.status, 'READY');
  assert.strictEqual(result.authorizing, false);
  assert.strictEqual(result.rows[0].id, longStr);
  assert.strictEqual(result.rows[0].provider, longStr);
  assert.strictEqual(result.rows[0].label, longStr);
});

test('buildModelCatalog: mixed UNKNOWN/AVAILABLE and independent axes', () => {
  const input = {
    models: [
      { id: 'a', provider: 'p1', label: 'l1', availability: 'UNKNOWN', location: 'LOCAL' },
      { id: 'b', provider: 'p2', label: 'l2', availability: 'AVAILABLE', location: 'UNKNOWN' }
    ]
  };
  const result = buildModelCatalog(input);
  assert.strictEqual(result.authorizing, false);
  assert.deepStrictEqual(result.counts, {
    total: 2,
    available: 1,
    unavailable: 0,
    unknown: 1,
    local: 1,
    remote: 0,
    unknownLocation: 1
  });
});

test('buildModelCatalog: maximum-sized post-return mutation immutability', () => {
  const rows = make200Rows();
  const input = { models: rows };
  const inputBefore = structuredClone(input);
  const result = buildModelCatalog(input);
  const expectedRows = structuredClone(result.rows);
  const expectedCounts = structuredClone(result.counts);

  assert.strictEqual(result.authorizing, false);
  assert.deepStrictEqual(input, inputBefore);
  assert.notStrictEqual(result.rows, input.models);
  assert.notStrictEqual(result.rows[0], input.models[0]);

  rows[0].id = 'MUTATED';
  rows[100].availability = 'AVAILABLE';
  rows[199].location = 'LOCAL';
  rows.push({ id: 'extra', provider: 'p', label: 'l', availability: 'AVAILABLE', location: 'LOCAL' });
  rows.reverse();

  assert.deepStrictEqual(result.rows, expectedRows);
  assert.deepStrictEqual(result.counts, expectedCounts);
});
