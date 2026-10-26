import test from 'node:test';
import assert from 'node:assert/strict';
import { registerReviewedNodeSuiteV1, readNodeTestReportV1 } from '../hosts/repository/node-suite-v1.mjs';
import { context, passing, failing, setup, wire } from './helpers/node-repository-fixture.mjs';

test('issued suite reads exact PASS, FAIL and zero-assertion setup ERROR records', async t => {
  const c = await context(t);
  for (const value of [passing(), failing(), setup()]) {
    const result = readNodeTestReportV1(wire(value), c.suite);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), value);
    assert.equal(Object.getPrototypeOf(result), null); assert(Object.isFrozen(result));
  }
  assert.equal(c.suite.authorizing, false); assert.equal(c.suite.noDescendantsEnforced, false);
  assert.throws(() => readNodeTestReportV1(wire(passing()), structuredClone(c.suite)), { code: 'NODE_SUITE_NOT_ISSUED' });
});
test('registration refuses unknown scope, cloned preparations, missing/unprotected entry and changed inventory', async t => {
  const c = await context(t);
  for (const delta of [{ scope: 'sandbox' }, { preparations: [structuredClone(c.preparations[0])] },
    { preparations: [] }, { preparations: [c.preparations[0], c.preparations[0]] },
    { entryPath: 'missing.mjs' }, { entryPath: 'retry-settings.mjs' },
    { assertionNames: ['a', 'a'] }, { assertionNames: [] }, { setupReason: null }, { authorizing: true }]) {
    assert.throws(() => registerReviewedNodeSuiteV1({ ...c.registration, ...delta }));
  }
});
for (const field of ['preparations', 'assertionNames']) for (const kind of ['extra', 'iterator', 'getter', 'subclass']) {
  test('registration rejects closed-array violation without invoking code: ' + field + ' ' + kind, async t => {
    const c = await context(t), original = c.registration[field]; let calls = 0;
    let value = [...original];
    if (kind === 'extra') value.hiddenAuthority = true;
    if (kind === 'iterator') value[Symbol.iterator] = function* () { calls++; yield* original; };
    if (kind === 'getter') Object.defineProperty(value, '0', { enumerable: true, get() { calls++; return original[0]; } });
    if (kind === 'subclass') { class DifferentArray extends Array {} value = new DifferentArray(...original); }
    assert.throws(() => registerReviewedNodeSuiteV1({ ...c.registration, [field]: value }),
      { code: field === 'preparations' ? 'NODE_SUITE_PREPARATIONS' : 'NODE_SUITE_ASSERTIONS' });
    assert.equal(calls, 0);
  });
}
const malformed = [
  ['PASS count mismatch', () => ({ ...passing(), assertionsPassed: 9 }), 'NODE_REPORT_COUNTS'],
  ['PASS with failed assertions', () => ({ ...failing(), status: 'PASS' }), 'NODE_REPORT_COUNTS'],
  ['FAIL with all passed', () => ({ ...passing(), status: 'FAIL' }), 'NODE_REPORT_COUNTS'],
  ['executed count mismatch', () => ({ ...passing(), assertionsExecuted: 9 }), 'NODE_REPORT_COUNTS'],
  ['extra failure not counted', () => ({ ...failing(), assertionsPassed: 9 }), 'NODE_REPORT_COUNTS'],
  ['negative pass count', () => ({ ...failing(), assertionsPassed: -1 }), 'NODE_REPORT_COUNTS'],
  ['duplicate failure', () => { const r = failing(); r.failures[1] = r.failures[0]; return r; }, 'NODE_REPORT_FAILURE_INVALID'],
  ['unknown failure', () => { const r = failing(); r.failures[0].name = 'invented'; return r; }, 'NODE_REPORT_FAILURE_INVALID'],
  ['empty failure message', () => { const r = failing(); r.failures[0].message = ''; return r; }, 'NODE_REPORT_FAILURE_INVALID'],
  ['extra failure key', () => { const r = failing(); r.failures[0].passed = true; return r; }, 'NODE_REPORT_FAILURE_SCHEMA'],
  ['unknown schema', () => ({ ...passing(), schemaVersion: 'other-v1' }), 'NODE_REPORT_IDENTITY'],
  ['unknown status', () => ({ ...passing(), status: 'CERTIFIED' }), 'NODE_REPORT_IDENTITY'],
  ['unknown root key', () => ({ ...passing(), authorizing: true }), 'NODE_REPORT_SCHEMA'],
  ['setup invented assertions', () => ({ ...setup(), assertionsExecuted: 10 }), 'NODE_REPORT_SETUP'],
  ['setup unknown reason', () => ({ ...setup(), reason: 'SOME_ERROR' }), 'NODE_REPORT_SETUP'],
];
for (const [name, build, code] of malformed) test('node result refuses ' + name, async t => {
  const c = await context(t); assert.throws(() => readNodeTestReportV1(wire(build()), c.suite), { code });
});
test('wire parser rejects duplicate keys, invalid UTF8/BOM/numbers, extra documents and multiline framing', async t => {
  const c = await context(t), clean = JSON.stringify(passing());
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(65537, 32), Buffer.from('null'),
    Buffer.from(clean.replace('"status":"PASS"', '"status":"FAIL","status":"PASS"')),
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), wire(passing())]), Buffer.from([0xff]),
    Buffer.from(clean.replace('"assertionsPassed":10', '"assertionsPassed":1e1')),
    Buffer.from(clean + '\n{}\n'), Buffer.from(clean + '\n\n'), Buffer.from('{\n"status":"PASS"}'), Buffer.from(clean + 'x')]) {
    assert.throws(() => readNodeTestReportV1(bytes, c.suite));
  }
});
