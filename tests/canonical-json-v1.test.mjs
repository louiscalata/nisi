// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { canonicalizeJSONV1, CanonicalJSONErrorV1, CANONICAL_JSON_PROFILE_V1 } from '../canonical/canonical-json-v1.mjs';
import { canonicalJson as independentCanonicalJson } from '../scripts/common.mjs';

const bytes = text => Buffer.from(text, 'utf8');
const canonical = input => canonicalizeJSONV1(typeof input === 'string' ? bytes(input) : input);
const refusal = (input, code) => assert.throws(() => canonical(input), error => error instanceof CanonicalJSONErrorV1 && error.code === code && error.message === code);

const valid = [
  ['numeric-key-order', '{"10":1,"9":2,"1e1":3,"010":4,"2":5}', '{"010":4,"10":1,"1e1":3,"2":5,"9":2}'],
  ['proto-survival', '{"__proto__":{"safe":true},"a":1}', '{"__proto__":{"safe":true},"a":1}'],
  ['scalar-order', '{"𐀀":1,"":2,"a":3}', '{"a":3,"":2,"𐀀":1}'],
  ['decoded-key', '{"\\u007a":0,"a":1}', '{"a":1,"z":0}'],
  ['null-value', '{"k":null}', '{"k":null}'],
  ['empty-object', '{}', '{}'],
  ['empty-array', '[]', '[]'],
  ['array-order', '[3,2,1]', '[3,2,1]'],
  ['true', 'true', 'true'], ['false', 'false', 'false'], ['null', 'null', 'null'],
  ['whitespace', ' \r\n\t { "z" : [true, null], "a" : {} }\n', '{"a":{},"z":[true,null]}'],
  ['nfd-value-preserved', '{"k":"café"}', '{"k":"café"}'],
  ['embedded-bom', '"\\ufeff"', '"﻿"'],
  ['surrogate-pair', '"\\ud83e\\uddea"', '"🧪"'],
  ['maximum-scalar', '"\\udbff\\udfff"', '"􏿿"'],
  ['escapes', '"\\\"\\\\\\/\\b\\f\\n\\r\\t\\u0000\\u001f"', '"\\\"\\\\/\\b\\f\\n\\r\\t\\u0000\\u001f"'],
  ['raw-noncontrols', '"  "', '"  "'],
];
for (const [id, input, expected] of valid) {
  test(`canonical JSON v1 exact bytes: ${id}`, () => {
    const result = canonical(input);
    assert.deepEqual(Object.keys(result).sort(), ['canonical', 'profile', 'sha256']);
    assert.equal(result.profile, CANONICAL_JSON_PROFILE_V1);
    assert.equal(result.canonical, expected);
    assert.equal(result.sha256, createHash('sha256').update(expected, 'utf8').digest('hex'));
    assert.equal(canonical(result.canonical).canonical, expected);
    assert(Object.isFrozen(result));
  });
}

for (const input of ['0', '1', '-1', '9007199254740991', '-9007199254740991']) {
  test(`canonical JSON v1 integer boundary accepts ${input}`, () => assert.equal(canonical(input).canonical, input));
}
for (const input of ['-0', '1.0', '1.5', '1e0', '1E+3', '1e-7', '01', '-01', '+1', '-', 'NaN', 'Infinity', '-Infinity', '9007199254740992', '-9007199254740992', '-9223372036854775808', '18446744073709551615', '9'.repeat(200)]) {
  test(`canonical JSON v1 number refuses exact source ${input.slice(0, 24)}`, () => refusal(input, 'INVALID_JSON_NUMBER'));
}

for (const [id, input, code] of [
  ['same-key', '{"x":1,"x":2}', 'INVALID_JSON_DUPLICATE_KEY'],
  ['escaped-same-key', '{"x":1,"\\u0078":2}', 'INVALID_JSON_DUPLICATE_KEY'],
  ['nested-same-key', '{"a":{"x":1,"x":2}}', 'INVALID_JSON_DUPLICATE_KEY'],
  ['nul-key', '{"\\u0000":0}', 'INVALID_JSON_DUPLICATE_KEY'],
  ['nfd-key', '{"café":1}', 'INVALID_JSON_KEY_NOT_NFC'],
  ['nfc-nfd-collision', '{"café":1,"café":2}', 'INVALID_JSON_KEY_NOT_NFC'],
  ['lone-high', '"\\ud800"', 'INVALID_JSON_STRING_SURROGATE'],
  ['lone-low', '"\\udfff"', 'INVALID_JSON_STRING_SURROGATE'],
  ['high-then-wrong-low', '"\\ud800\\u0041"', 'INVALID_JSON_STRING_SURROGATE'],
  ['high-then-raw', '"\\ud800x"', 'INVALID_JSON_STRING_SURROGATE'],
  ['surrogate-key', '{"\\ud800":1}', 'INVALID_JSON_STRING_SURROGATE'],
  ['bad-escape', '"\\xFF"', 'INVALID_JSON_STRING'],
  ['truncated-hex', '"\\u123"', 'INVALID_JSON_STRING'],
  ['invalid-hex', '"\\uZZZZ"', 'INVALID_JSON_STRING'],
  ['truncated-escape', '"\\', 'INVALID_JSON_STRING'],
  ['raw-control', '"\n"', 'INVALID_JSON_STRING'],
  ['unterminated', '"text', 'INVALID_JSON_STRING'],
  ['object-trailing-comma', '{"x":1,}', 'INVALID_JSON_SYNTAX'],
  ['array-trailing-comma', '[1,]', 'INVALID_JSON_SYNTAX'],
  ['top-level-tail', '{}null', 'INVALID_JSON_SYNTAX'],
  ['literal-tail', 'truex', 'INVALID_JSON_SYNTAX'],
  ['empty-document', '', 'INVALID_JSON_SYNTAX'],
  ['missing-value', '{"x":}', 'INVALID_JSON_SYNTAX'],
  ['missing-colon', '{"x"1}', 'INVALID_JSON_SYNTAX'],
  ['duplicate-proto', '{"__proto__":1,"__proto__":2}', 'INVALID_JSON_DUPLICATE_KEY'],
  ['fraction-without-integer', '.1', 'INVALID_JSON_SYNTAX'],
  ['exponent-without-mantissa', 'e1', 'INVALID_JSON_SYNTAX'],
  ['negative-fraction-without-integer', '-.1', 'INVALID_JSON_NUMBER'],
]) test(`canonical JSON v1 refusal: ${id}`, () => refusal(input, code));

for (const [id, hex, code] of [
  ['invalid-ff-in-string', '7b2273223a22ff227d', 'INVALID_JSON_UTF8'],
  ['overlong', '22c0af22', 'INVALID_JSON_UTF8'],
  ['encoded-surrogate', '22eda08022', 'INVALID_JSON_UTF8'],
  ['truncated-multibyte', '22e28222', 'INVALID_JSON_UTF8'],
  ['above-unicode-range', '22f490808022', 'INVALID_JSON_UTF8'],
  ['leading-bom', 'efbbbf7b7d', 'INVALID_JSON_BOM'],
]) test(`canonical JSON v1 exact raw-byte refusal: ${id}`, () => refusal(Buffer.from(hex, 'hex'), code));

test('canonical JSON v1 depth 128 admitted, 129 and exact generated 512 refused', () => {
  const deep = n => '['.repeat(n) + ']'.repeat(n);
  assert.equal(canonical(deep(128)).canonical, deep(128));
  refusal(deep(129), 'INVALID_JSON_DEPTH');
  refusal(deep(512), 'INVALID_JSON_DEPTH');
});
test('canonical JSON v1 object limit is per object, checked at 4096/4097 and generated 10000', () => {
  const object = count => '{' + Array.from({ length: count }, (_, i) => `"k${i}":${i}`).join(',') + '}';
  assert.equal(Object.keys(JSON.parse(canonical(object(4096)).canonical)).length, 4096);
  assert.equal(Object.keys(JSON.parse(canonical('[' + object(3000) + ',' + object(3000) + ']').canonical)[1]).length, 3000);
  refusal(object(4097), 'INVALID_JSON_OBJECT_SIZE');
  refusal(object(10000), 'INVALID_JSON_OBJECT_SIZE');
});
test('canonical JSON v1 input-byte cap accepts exactly 1 MiB and refuses above it', () => {
  const input = '"' + 'x'.repeat(1_048_574) + '"';
  assert.equal(Buffer.byteLength(canonical(input).canonical), 1_048_576);
  refusal(input + ' ', 'INVALID_JSON_SIZE');
});
test('canonical JSON v1 input cannot be an arbitrary object, string, proxy or shared buffer', () => {
  let hooks = 0;
  const proxy = new Proxy(new Uint8Array([123, 125]), { get() { hooks++; throw Error('unexpected hook'); } });
  for (const input of ['{}', {}, null, [], new DataView(new ArrayBuffer(2)), proxy, new Uint8Array(new SharedArrayBuffer(2))]) {
    assert.throws(() => canonicalizeJSONV1(input), error => error.code === 'INVALID_JSON_INPUT');
  }
  assert.equal(hooks, 0);
});
test('canonical JSON v1 handles sliced views and refuses detached input', () => {
  const view = new Uint8Array([0xff, 123, 125, 0xff]);
  assert.equal(canonical(view.subarray(1, 3)).canonical, '{}');
  const detached = new Uint8Array([123, 125]);
  structuredClone(detached.buffer, { transfer: [detached.buffer] });
  refusal(detached, 'INVALID_JSON_INPUT');
});
test('canonical JSON v1 ignores spoofed typed-array properties and never consults input hooks', () => {
  const input = new Uint8Array([123, 125]);
  for (const name of ['buffer', 'byteOffset', 'byteLength', Symbol.iterator]) {
    Object.defineProperty(input, name, { get() { throw Error('unexpected input getter'); } });
  }
  assert.equal(canonical(input).canonical, '{}');
});
test('canonical JSON v1 primitive-only emission never calls container toJSON', () => {
  const previous = Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON');
  Object.defineProperty(Array.prototype, 'toJSON', { configurable: true, value() { throw Error('unexpected toJSON'); } });
  try { assert.equal(canonical('[{"__proto__":1}]').canonical, '[{"__proto__":1}]'); }
  finally { if (previous) Object.defineProperty(Array.prototype, 'toJSON', previous); else delete Array.prototype.toJSON; }
});
test('canonical JSON v1 key insertion permutations produce identical canonical digests', () => {
  const pairs = ['"10":1', '"2":2', '"𐀀":3', '"":4', '"__proto__":5'];
  const expected = canonical('{' + pairs.join(',') + '}');
  for (let i = 0; i < pairs.length; i++) {
    const rotated = [...pairs.slice(i), ...pairs.slice(0, i)].reverse();
    assert.deepEqual(canonical('{' + rotated.join(',') + '}'), expected);
  }
});
test('canonical JSON v1 agrees with the independent serializer on every corpus vector', () => {
  const fixture = JSON.parse(readFileSync(new URL('../contracts/canonical-vectors.json', import.meta.url)));
  assert.equal(fixture.vectors.length, 13);
  for (const row of fixture.vectors) {
    const output = canonical(JSON.stringify(row.value));
    assert.equal(output.canonical, row.canonical, row.id);
    assert.equal(output.sha256, row.sha256, row.id);
    assert.equal(independentCanonicalJson(row.value), row.canonical, row.id);
  }
});
test('canonical JSON v1 does not silently migrate legacy numeric-key or proto records', () => {
  // Immutable legacy outputs, not today's reporting helper: correcting that
  // helper must not silently redefine what historical digests represented.
  for (const [input, legacy] of [
    ['{"10":1,"2":2}', '{"2":2,"10":1}'],
    ['{"__proto__":1}', '{}'],
  ]) {
    assert.notEqual(canonical(input).canonical, legacy);
    assert.notEqual(canonical(input).sha256, createHash('sha256').update(legacy).digest('hex'));
  }
  assert.notEqual(canonical('{"k":null}').sha256, canonical('{}').sha256);
});

test('canonical JSON v1 decoded astral duplicates and prefix/scalar key boundaries', () => {
  refusal('{"🧪":1,"\\ud83e\\uddea":2}', 'INVALID_JSON_DUPLICATE_KEY');
  const input = '{"\\udbff\\udfff":5,"aa":2,"𐀀":4,"a":1,"":3}';
  assert.equal(canonical(input).canonical, '{"a":1,"aa":2,"":3,"𐀀":4,"􏿿":5}');
});
test('canonical JSON v1 size is the view length, not its larger backing allocation', () => {
  const backing = new ArrayBuffer(1_048_580);
  const view = new Uint8Array(backing, 1_048_578, 2);
  view.set([123, 125]);
  assert.equal(canonical(view).canonical, '{}');
  refusal(new Uint8Array(backing, 0, 1_048_577), 'INVALID_JSON_SIZE');
});
test('canonical JSON v1 captures current resized views and refuses out-of-bounds views', () => {
  const backing = new ArrayBuffer(8, { maxByteLength: 16 });
  const fixed = new Uint8Array(backing, 4, 2);
  const tracking = new Uint8Array(backing, 4);
  fixed.set([123, 125]);
  backing.resize(6);
  assert.equal(canonical(fixed).canonical, '{}');
  assert.equal(canonical(tracking).canonical, '{}');
  backing.resize(2);
  refusal(fixed, 'INVALID_JSON_INPUT');
  refusal(tracking, 'INVALID_JSON_INPUT');
});
test('canonical JSON v1 exact documented 400002-byte mixed string is admitted unchanged', () => {
  const input = Buffer.from('22' + 'c3a95c6e'.repeat(100_000) + '22', 'hex');
  assert.equal(input.length, 400_002);
  const expectedHash = '5b0ec276f38c77fd0a1353a398601cf989fdb212834ad49eaaf33267ac7e5cdf';
  assert.equal(createHash('sha256').update(input).digest('hex'), expectedHash);
  const result = canonical(input);
  assert.equal(result.canonical, input.toString('utf8'));
  assert.equal(result.sha256, expectedHash);
});

test('canonical JSON v1 integer magnitude is checked by value, not by digit count', () => {
  // 2^53 - 1 has sixteen digits and is the largest admitted magnitude.
  assert.equal(canonical('{"n":9007199254740991}').canonical, '{"n":9007199254740991}');
  assert.equal(canonical('{"n":-9007199254740991}').canonical, '{"n":-9007199254740991}');
  // One more is refused even though it is still sixteen digits …
  refusal('{"n":9007199254740992}', 'INVALID_JSON_NUMBER');
  // … and a seventeen-digit value is refused even if a length guard drifted.
  refusal('{"n":10000000000000000}', 'INVALID_JSON_NUMBER');
  refusal('{"n":-10000000000000000}', 'INVALID_JSON_NUMBER');
});
