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

test('buildModelCatalog: mutation immutability', () => {
  const rows = [
    { id: 'first', provider: 'p', label: 'l', availability: 'AVAILABLE', location: 'LOCAL' },
    { id: 'middle', provider: 'p', label: 'l', availability: 'UNAVAILABLE', location: 'REMOTE' },
    { id: 'last', provider: 'p', label: 'l', availability: 'UNKNOWN', location: 'UNKNOWN' }
  ];
  const input = { models: rows };
  const result = buildModelCatalog(input);
  const expectedRows = result.rows;
  const expectedCounts = result.counts;

  rows[0].id = 'MUTATED';
  rows[1].availability = 'AVAILABLE';
  rows[2].location = 'LOCAL';
  rows.push({ id: 'extra', provider: 'p', label: 'l', availability: 'AVAILABLE', location: 'LOCAL' });
  rows.reverse();

  assert.deepStrictEqual(result.rows, expectedRows);
  assert.deepStrictEqual(result.counts, expectedCounts);
});
