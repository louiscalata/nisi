import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModelCatalog } from '../src/index.mjs';

const row = (patch = {}) => ({
  id: 'model-1',
  provider: 'local',
  label: 'Model One',
  availability: 'AVAILABLE',
  location: 'LOCAL',
  ...patch
});
const refused = { status: 'REFUSED', reason: 'INVALID_INPUT', authorizing: false };
const clone = value => JSON.parse(JSON.stringify(value));

test('empty catalog is READY with exact keys and zero counts', () => {
  assert.deepEqual(buildModelCatalog({ models: [] }), {
    schemaVersion: 1,
    status: 'READY',
    rows: [],
    counts: { total: 0, available: 0, unavailable: 0, unknown: 0, local: 0, remote: 0, unknownLocation: 0 },
    authorizing: false
  });
});

test('preserves row order and counts every availability and location enum', () => {
  const models = [
    row(),
    row({ id: 'model-2', availability: 'UNAVAILABLE', location: 'REMOTE' }),
    row({ id: 'model-3', availability: 'UNKNOWN', location: 'UNKNOWN' }),
    row({ id: 'model-4', availability: 'AVAILABLE', location: 'REMOTE' })
  ];
  const result = buildModelCatalog({ models });
  assert.deepEqual(result.rows, models);
  assert.deepEqual(result.counts, { total: 4, available: 2, unavailable: 1, unknown: 1, local: 1, remote: 2, unknownLocation: 1 });
});

test('accepts non-ASCII names as inert catalog data', () => {
  const models = [row({ id: 'm-日本', provider: '研究室', label: '模型 Café 🧪' })];
  assert.deepEqual(buildModelCatalog({ models }).rows, models);
});

test('output is a copy and later input mutation cannot change it', () => {
  const input = { models: [row()] };
  const result = buildModelCatalog(input);
  input.models[0].label = 'changed';
  input.models.push(row({ id: 'model-2' }));
  assert.equal(result.rows[0].label, 'Model One');
  assert.equal(result.rows.length, 1);
  assert.notEqual(result.rows, input.models);
});

test('equivalent ordinary JSON input is deterministic', () => {
  const input = { models: [row(), row({ id: 'model-2', availability: 'UNKNOWN', location: 'REMOTE' })] };
  assert.deepEqual(buildModelCatalog(clone(input)), buildModelCatalog(clone(input)));
});

test('refuses missing, extra, and wrong top-level keys with the exact refusal', () => {
  for (const input of [{}, { models: [], extra: true }, { model: [] }, { models: null }, { models: {} }]) {
    assert.deepEqual(buildModelCatalog(input), refused);
  }
});

test('refuses malformed row shapes, missing fields, and extra fields', () => {
  for (const bad of [
    {},
    { ...row(), extra: true },
    { id: 'x', provider: 'p', label: 'l', availability: 'AVAILABLE' },
    ['x'],
    null
  ]) assert.deepEqual(buildModelCatalog({ models: [bad] }), refused);
});

test('refuses empty, non-string, and overlong identity text', () => {
  for (const field of ['id', 'provider', 'label']) {
    for (const value of ['', 1, null, 'x'.repeat(129)]) {
      assert.deepEqual(buildModelCatalog({ models: [row({ [field]: value })] }), refused, `${field}:${typeof value}`);
    }
  }
});

test('refuses unknown or incorrectly cased availability and location enums', () => {
  for (const patch of [
    { availability: 'PARTIAL' }, { availability: 'available' }, { availability: null },
    { location: 'HYBRID' }, { location: 'local' }, { location: 1 }
  ]) assert.deepEqual(buildModelCatalog({ models: [row(patch)] }), refused);
});

test('refuses duplicate ids and more than 200 rows', () => {
  assert.deepEqual(buildModelCatalog({ models: [row(), row({ label: 'Different' })] }), refused);
  const models = Array.from({ length: 201 }, (_, index) => row({ id: `model-${index}` }));
  assert.deepEqual(buildModelCatalog({ models }), refused);
});

test('dangerous ordinary-JSON keys are data-shape violations and never alter prototypes', () => {
  const before = Object.prototype.polluted;
  const top = JSON.parse('{"models":[],"__proto__":{"polluted":true}}');
  const nested = JSON.parse('{"id":"m","provider":"p","label":"l","availability":"AVAILABLE","location":"LOCAL","constructor":"bad"}');
  assert.deepEqual(buildModelCatalog(top), refused);
  assert.deepEqual(buildModelCatalog({ models: [nested] }), refused);
  assert.equal(Object.prototype.polluted, before);
});
