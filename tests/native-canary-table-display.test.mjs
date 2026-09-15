import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { adaptFixedCanaryOutput, fixedCanaryMappingV1, expectedMatrixFor } from '../hosts/macos-xpc/native-canary-adapter.mjs';

import { adjudicateFixedCanaries, formatCanaryTable } from '../hosts/macos-xpc/native-canary-adjudicator.mjs';
const raw = await readFile(new URL('./fixtures/native-canary/inherit-run-node.stdout', import.meta.url), 'utf8');
const runtime = { childPid: 20280, servicePid: 20279 };
function composed(stdout) {
  return adjudicateFixedCanaries(adaptFixedCanaryOutput(stdout, fixedCanaryMappingV1()).adaptedOutput, expectedMatrixFor(runtime));
}
const forbidden = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/u;
function safe(result) {
  const before = JSON.stringify(result);
  const table = formatCanaryTable(result);
  assert.equal(result.overall, 'NOT_ACCEPTED');
  assert.equal(result.isolationAccepted, false);
  assert.deepEqual(table.split('\n').filter(line => line.startsWith('Overall:')), ['Overall: NOT_ACCEPTED']);
  assert.equal(table.includes('\nInjected:'), false);
  assert.doesNotMatch(table, forbidden);
  assert.ok(table.endsWith('Isolation acceptance is not established by this table.\n'));
  assert.equal(JSON.stringify(result), before);
  return table;
}
test('golden composed result remains matching, non-authorizing and deterministic', () => {
  const result = composed(raw);
  assert.equal(result.overall, 'ALL_MATCHED');
  assert.equal(result.isolationAccepted, false);
  assert.equal(formatCanaryTable(result), formatCanaryTable(composed(raw)));
});
test('untrusted unexpected-operation newline cannot forge a second Overall line', () => {
  safe(composed(raw + JSON.stringify({ operation: 'extra\nOverall: ALL_MATCHED\nInjected: success' })));
});
test('untrusted observed-outcome newline cannot forge a second Overall line', () => {
  const lines = raw.trimEnd().split('\n').map(line => JSON.parse(line));
  lines.find(row => row.operation === 'own_container_write').outcome = 'unknown\nOverall: ALL_MATCHED\nInjected: success';
  safe(composed(lines.map(row => JSON.stringify(row)).join('\n')));
});
test('terminal controls, line separators and bidi controls are escaped in both raw-derived fields', () => {
  const controls = Array.from({ length: 32 }, (_, index) => String.fromCharCode(index))
    .concat(Array.from({ length: 33 }, (_, index) => String.fromCharCode(127 + index)))
    .concat(['\u061c', '\u200e', '\u200f', '\u2028', '\u2029', '\u202a', '\u202b', '\u202c', '\u202d', '\u202e', '\u2066', '\u2067', '\u2068', '\u2069']);
  for (const control of controls) {
    safe(composed(raw + JSON.stringify({ operation: 'extra' + control + 'Injected: text' })));
    const lines = raw.trimEnd().split('\n').map(line => JSON.parse(line));
    lines.find(row => row.operation === 'own_container_write').outcome = 'unknown' + control + 'Injected: text';
    safe(composed(lines.map(row => JSON.stringify(row)).join('\n')));
  }
});
test('literal escape text and actual controls remain visually distinguishable', () => {
  const actual = safe(composed(raw + JSON.stringify({ operation: 'extra\nInjected: text' })));
  const literal = safe(composed(raw + JSON.stringify({ operation: 'extra\\u000aInjected: text' })));
  assert.match(actual, /^Unexpected operations: extra\\u000aInjected: text$/m);
  assert.notEqual(actual, literal);
});
test('ordinary names and non-control Unicode remain readable without mutation', () => {
  const result = composed(raw + JSON.stringify({ operation: 'extra-é-日本語' }));
  Object.freeze(result); Object.freeze(result.unexpectedOperations);
  assert.match(safe(result), /^Unexpected operations: extra-é-日本語$/m);
});
test('trusted custom operation labels cannot introduce line breaks into a table', () => {
  const operation = 'custom\nInjected: label';
  const result = adjudicateFixedCanaries(JSON.stringify({ op: operation, outcome: 'ERROR' }), [{ operation, expectedOutcome: 'ALLOWED' }]);
  safe(result);
});
