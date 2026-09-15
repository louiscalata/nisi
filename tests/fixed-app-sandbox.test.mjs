import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFixedProbeV1 } from '../hosts/macos-sandbox/fixed-probe-parser.mjs';
import { requireFixedProbeOptIn, assertFixedProbeOutcomes } from '../hosts/macos-sandbox/fixed-probe-runner.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const names = ['own-open-write','own-write','own-close-write','own-open-read','own-read','own-close-read','outside-open-read','outside-read','outside-close-read','outside-open-write','outside-write','outside-close-write','socket-create','socket-bind','socket-close','fixed-child-spawn','fixed-child-wait'];
const expected = { runId: '0123456789abcdef0123456789abcdef', mode: 'sandbox', expectedPid: 1234, expectedHome: '/container/home' };
const make = rows => Buffer.from(JSON.stringify({schemaVersion:'nisi-fixed-probe-v1',runId:expected.runId,mode:expected.mode,pid:expected.expectedPid,home:expected.expectedHome})+'\n'+rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
const all = names.map(operation => ({operation, outcome:'ALLOWED', errno:0}));

test('parses all-success data, preserves order, and freezes the result', () => {
  const result = parseFixedProbeV1(make(all), expected);
  assert.deepEqual(result.rows, all); assert(Object.isFrozen(result)); assert(Object.isFrozen(result.meta)); assert(Object.isFrozen(result.rows));
});
test('accepts sandbox denials and operational errors without deriving status', () => {
  const rows = all.map(row => ({...row}));
  rows[7] = {operation:'outside-read', outcome:'DENIED', errno:1};
  rows[8] = {operation:'outside-close-read', outcome:'ALLOWED', errno:0};
  rows[13] = {operation:'socket-bind', outcome:'ERROR', errno:48}; rows[14] = {operation:'socket-close', outcome:'ALLOWED', errno:0};
  const result = parseFixedProbeV1(make(rows), expected); assert.equal(result.rows[7].outcome, 'DENIED'); assert.equal(result.rows[13].outcome, 'ERROR');
});
test('requires dependent rows to be NOT_RUN after open/create/spawn refusal', () => {
  const rows = all.map(row => ({...row})); rows[0] = {operation:'own-open-write', outcome:'DENIED', errno:1}; rows[1] = {operation:'own-write', outcome:'NOT_RUN', errno:0}; rows[2] = {operation:'own-close-write', outcome:'NOT_RUN', errno:0};
  assert.doesNotThrow(() => parseFixedProbeV1(make(rows), expected));
  rows[15] = {operation:'fixed-child-spawn', outcome:'DENIED', errno:13}; rows[16] = {operation:'fixed-child-wait', outcome:'NOT_RUN', errno:0};
  assert.doesNotThrow(() => parseFixedProbeV1(make(rows), expected));
  rows[1] = {operation:'own-write', outcome:'ALLOWED', errno:0};
  assert.throws(() => parseFixedProbeV1(make(rows), expected), {code:'FIXED_PROBE_DEPENDENCY'});
});
test('requires close after a read/write/bind failure when open/create succeeded', () => {
  const rows = all.map(row => ({...row})); rows[4] = {operation:'own-read', outcome:'ERROR', errno:5}; rows[5] = {operation:'own-close-read', outcome:'ERROR', errno:5};
  assert.doesNotThrow(() => parseFixedProbeV1(make(rows), expected));
  rows[5] = {operation:'own-close-read', outcome:'NOT_RUN', errno:0};
  assert.throws(() => parseFixedProbeV1(make(rows), expected), {code:'FIXED_PROBE_DEPENDENCY'});
});
for (const mutate of [
  lines => lines.slice(0, -1), lines => [...lines, '', ''], lines => [lines[0], lines[2], lines[1], ...lines.slice(3)],
  lines => [lines[0].replace('"home":"/container/home"', '"home":"/other"'), ...lines.slice(1)],
  lines => [lines[0].replace('"runId":"0123456789abcdef0123456789abcdef"', '"runId":"fedcba9876543210fedcba9876543210"'), ...lines.slice(1)],
  lines => [lines[0].replace('"home":"/container/home"', '"home":"/container/home","home":"/duplicate"'), ...lines.slice(1)],
  lines => [lines[0], lines[1].replace('"errno":0', '"errno":2'), ...lines.slice(2)],
]) test('rejects malformed or contradictory frame', () => {
  const lines = make(all).toString('utf8').trimEnd().split('\n');
  assert.throws(() => parseFixedProbeV1(Buffer.from(mutate(lines).join('\n')), expected), error =>
    typeof error?.code === 'string' && error.code.startsWith('FIXED_PROBE_'));
});
test('rejects oversized, invalid UTF-8, unknown outcome, and wrong mode', () => {
  assert.throws(() => parseFixedProbeV1(Buffer.alloc(32769), expected), {code:'FIXED_PROBE_BYTES'});
  assert.throws(() => parseFixedProbeV1(Buffer.from([0xff]), expected), {code:'FIXED_PROBE_UTF8'});
  const rows = all.map(row => ({...row})); rows[1] = {operation:'own-write', outcome:'PASS', errno:0}; assert.throws(() => parseFixedProbeV1(make(rows), expected), {code:'FIXED_PROBE_OUTCOME'});
  const control = {...expected, mode:'control'}; assert.throws(() => parseFixedProbeV1(make(all), control), {code:'FIXED_PROBE_META_IDENTITY'});
});

test('first syscalls cannot be skipped without a prerequisite', () => {
  for (const i of [0, 3, 6, 9, 12, 15]) {
    const rows = all.map(row => ({ ...row }));
    for (let k = i; k < Math.min(i + (i === 15 ? 2 : 3), rows.length); k++) rows[k] = { ...rows[k], outcome: 'NOT_RUN', errno: 0 };
    assert.throws(() => parseFixedProbeV1(make(rows), expected), { code: 'FIXED_PROBE_DEPENDENCY' });
  }
});

test('every opened resource must attempt closure even when I/O succeeded', () => {
  for (const i of [2, 5, 8, 11, 14, 16]) {
    const rows = all.map(row => ({ ...row }));
    rows[i].outcome = 'NOT_RUN';
    assert.throws(() => parseFixedProbeV1(make(rows), expected), { code: 'FIXED_PROBE_DEPENDENCY' });
    rows[i] = { ...rows[i], outcome: 'ERROR', errno: 5 };
    assert.equal(parseFixedProbeV1(make(rows), expected).rows[i].outcome, 'ERROR');
  }
});

test('strict frames reject duplicate escaped keys and expose typed JSON errors', () => {
  const text = make(all).toString();
  for (const header of [
    text.replace('"pid":1234', '"pid":1234,"\\u0070id":1234'),
    text.replace('"pid":1234', '"pid":1234,"extra":true'),
    text.replace('"pid":1234', '"pid":-1'),
    text.replace('"pid":1234', '"pid":1235'),
    text.replace('"pid":1234', '"pid":"1234"'),
    text.replace('"home"', '"\\x"'),
    text.replace('"errno":0', '"errno":-1'),
    text.replace('"errno":0', '"errno":null'),
  ]) assert.throws(() => parseFixedProbeV1(header, expected), error => error.code?.startsWith('FIXED_PROBE_'));
});

test('string values resembling object keys do not create duplicate keys', () => {
  const tricky = { ...expected, expectedHome: '/container/"pid":1234/\\path' };
  const text = make(all).toString().replace(JSON.stringify(expected.expectedHome), JSON.stringify(tricky.expectedHome));
  assert.equal(parseFixedProbeV1(text, tricky).meta.home, tricky.expectedHome);
});

test('incorrect errno values never qualify as a permission denial', () => {
  for (const errno of [0, 2, 5, 24, 48, 61, 110]) {
    const rows = all.map(row => ({ ...row })); rows[13] = { ...rows[13], outcome: 'DENIED', errno };
    assert.throws(() => parseFixedProbeV1(make(rows), expected), { code: 'FIXED_PROBE_ERRNO' });
  }
});

function sandboxRows(denySocketCreate = false) {
  const rows = all.map(row => ({ ...row }));
  for (const i of [6, 9]) {
    rows[i] = { ...rows[i], outcome: 'DENIED', errno: 1 };
    rows[i + 1].outcome = rows[i + 2].outcome = 'NOT_RUN';
  }
  if (denySocketCreate) {
    rows[12] = { ...rows[12], outcome: 'DENIED', errno: 13 };
    rows[13].outcome = rows[14].outcome = 'NOT_RUN';
  } else rows[13] = { ...rows[13], outcome: 'DENIED', errno: 1 };
  return rows;
}

test('pure adjudication distinguishes socket creation denial from bind denial', () => {
  for (const createDenied of [false, true]) {
    const parsed = parseFixedProbeV1(make(sandboxRows(createDenied)), expected);
    assert.doesNotThrow(() => assertFixedProbeOutcomes(parsed, 'sandbox'));
    assert.equal(Object.hasOwn(parsed, 'authorizing'), false);
    assert.equal(Object.hasOwn(parsed, 'completeIsolation'), false);
  }
});

test('unexpected success and operational failures cannot satisfy expected sandbox matrix', () => {
  assert.throws(() => assertFixedProbeOutcomes(parseFixedProbeV1(make(all), expected), 'sandbox'), { code: 'PROBE_UNEXPECTED_OPERATION' });
  for (const index of [0, 1, 2, 3, 4, 5, 6, 9, 13, 14, 15, 16]) {
    const rows = sandboxRows(); rows[index] = { ...rows[index], outcome: 'ERROR', errno: 5 };
    if ([0, 3, 6, 9, 15].includes(index)) for (let j = index + 1; j <= Math.min(index + (index === 15 ? 1 : 2), 16); j++) rows[j] = { ...rows[j], outcome: 'NOT_RUN', errno: 0 };
    const parsed = parseFixedProbeV1(make(rows), expected);
    assert.throws(() => assertFixedProbeOutcomes(parsed, 'sandbox'), { code: 'PROBE_UNEXPECTED_OPERATION' });
  }
});

test('fixed control requires every recorded operation to succeed', () => {
  const controlExpected = { ...expected, mode: 'control' };
  const frame = rows => make(rows).toString().replace('"mode":"sandbox"', '"mode":"control"');
  assert.doesNotThrow(() => assertFixedProbeOutcomes(parseFixedProbeV1(frame(all), controlExpected), 'control'));
  const rows = all.map(row => ({ ...row })); rows[13] = { ...rows[13], outcome: 'ERROR', errno: 48 };
  assert.throws(() => assertFixedProbeOutcomes(parseFixedProbeV1(frame(rows), controlExpected), 'control'), { code: 'PROBE_CONTROL_FAILED' });
});

test('exact opt-in is mandatory; absence/extra input refuses before native side effects', () => {
  const flag = '--run-fixed-app-sandbox-probe';
  assert.doesNotThrow(() => requireFixedProbeOptIn([flag]));
  for (const value of [undefined, [], [flag, flag], ['--help'], ['--root', '/tmp'], [flag, '--extra']]) {
    assert.throws(() => requireFixedProbeOptIn(value), { code: 'PROBE_EXPLICIT_OPT_IN_REQUIRED' });
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const before = fs.readdirSync(path.join(root, '.build')).filter(name => name.startsWith('fixed-app-sandbox-')).sort();
  for (const argv of [[], ['--help'], [flag, '--extra']]) {
    const result = spawnSync(process.execPath, [path.join(root, 'hosts/macos-sandbox/fixed-probe-runner.mjs'), ...argv], {
      encoding: 'utf8', timeout: 5000, maxBuffer: 32768, env: { PATH: '/usr/bin:/bin' }, cwd: root
    });
    assert.equal(result.error, undefined); assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.deepEqual(JSON.parse(result.stderr), { status: 'NOT_RUN', code: 'PROBE_EXPLICIT_OPT_IN_REQUIRED', authorizing: false });
  }
  assert.deepEqual(fs.readdirSync(path.join(root, '.build')).filter(name => name.startsWith('fixed-app-sandbox-')).sort(), before);
});
