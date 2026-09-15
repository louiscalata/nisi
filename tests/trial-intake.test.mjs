import test from 'node:test';
import assert from 'node:assert/strict';
import { record, list, natural, add } from '../evaluation/intake-v1.mjs';
test('trial record copies only exact data properties including a safe proto key', () => {
  const value = Object.create(null); Object.defineProperty(value, '__proto__', { value: 'data', enumerable: true });
  const copy = record(value, ['__proto__']); assert.equal(Object.getPrototypeOf(copy), Object.prototype);
  assert.equal(Object.hasOwn(copy, '__proto__'), true); assert.equal(copy.__proto__, 'data');
  assert.deepEqual(record({}, []), {}); assert.notEqual(copy, value);
});
test('trial record refuses malformed shapes without invoking caller accessors', () => {
  let called = 0;
  for (const v of [null, [], new Date(), Object.create({ a: 1 }), {}, { a: 1, b: 2 },
    { a: 1, [Symbol()]: 2 }, Object.defineProperty({}, 'a', { value: 1 }), { get a() { called++; return 1; } }]) {
    assert.throws(() => record(v, ['a']), { code: 'TRIAL_RECORD' });
  }
  assert.equal(called, 0); assert.throws(() => record({ a: 1 }, ['a', 'a']), { code: 'TRIAL_RECORD' });
});
test('trial list rejects sparse custom subclass and accessor arrays without reading entries', () => {
  let called = 0; const ownIterator = [1]; ownIterator[Symbol.iterator] = () => { called++; return [][Symbol.iterator](); };
  const getter = []; Object.defineProperty(getter, '0', { get() { called++; return 1; }, enumerable: true });
  const hidden = []; Object.defineProperty(hidden, '0', { value: 1, enumerable: false });
  for (const v of [null, {}, new (class extends Array {})(), new Array(1), ownIterator, getter, hidden,
    Object.assign([1], { extra: true }), [], [1, 2, 3], new Array(4294967295)]) {
    assert.throws(() => list(v, 1, 2), { code: 'TRIAL_LIST' });
  }
  assert.equal(called, 0); const a = [1, 2], b = list(a, 1, 2); assert.deepEqual(a, b); assert.notEqual(a, b);
  assert.deepEqual(list([], 0, 0), []);
});
test('trial numbers and additions reject nonintegers negative zero and unsafe sums', () => {
  for (const n of [-0, -1, 0.1, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null, new Number(1), 1n]) {
    assert.throws(() => natural(n), { code: 'TRIAL_NUMBER' });
  }
  assert.equal(natural(0), 0); assert.equal(natural(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
  assert.equal(add(Number.MAX_SAFE_INTEGER, 0), Number.MAX_SAFE_INTEGER);
  assert.throws(() => add(Number.MAX_SAFE_INTEGER, 1), { code: 'TRIAL_OVERFLOW' });
});
