import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { formatNativeProbeSummary as format } from '../hosts/macos-xpc/native-probe-summary.mjs';

const caveats = 'Fixed experiment only. Generated-code execution remains disabled.\n'
  + 'Client closure does not establish service termination.\n';
const trustedView = () => ({
  runId: 'abc123', clientPid: 1234, servicePid: 9876, clientDurationMs: 42,
  statusText: 'INCOMPLETE — service settlement unconfirmed',
  operations: [
    { operation: 'own-write', outcome: 'ALLOWED', errno: 0 },
    { operation: 'outside-open-read', outcome: 'DENIED', errno: 1 },
    { operation: 'own-close-write', outcome: 'ERROR', errno: 5 }
  ]
});

test('formatter exact layout labels observed client and self-reported service separately', () => {
  assert.equal(format(trustedView()), 'Nisi fixed native probe\n'
    + 'Run ID: abc123\n'
    + 'Observed client PID: 1234\n'
    + 'Self-reported service PID: 9876\n'
    + 'Client duration: 42 ms\n'
    + 'Status: INCOMPLETE — service settlement unconfirmed\n'
    + 'Operations:\n'
    + '- own-write: ALLOWED (errno 0)\n'
    + '- outside-open-read: DENIED (errno 1)\n'
    + '- own-close-write: ERROR (errno 5)\n\n' + caveats);
});

test('formatter missing or null view uses unknown and never invents measured telemetry', () => {
  const expected = 'Nisi fixed native probe\nRun ID: Unknown\nObserved client PID: Unknown\n'
    + 'Self-reported service PID: Unknown\nClient duration: Not measured\nStatus: Unknown\n'
    + 'Operations:\n- Unknown\n\n' + caveats;
  for (const value of [undefined, null, {}, { runId: null, clientPid: null, servicePid: null,
    clientDurationMs: null, statusText: null, operations: null }]) assert.equal(format(value), expected);
});

test('formatter zero duration is measured and null duration is not measured', () => {
  assert.match(format({ clientDurationMs: 0 }), /^Client duration: 0 ms$/m);
  assert.match(format({ clientDurationMs: null }), /^Client duration: Not measured$/m);
  assert.match(format({ clientDurationMs: 2147483648 }), /^Client duration: 2147483648 ms$/m);
});

test('formatter invalid display numbers are unknown, not truncated or coerced', () => {
  for (const clientDurationMs of [-1, 1.5, NaN, Infinity, '12', Number.MAX_SAFE_INTEGER + 1]) {
    assert.match(format({ clientDurationMs }), /^Client duration: Not measured$/m);
  }
  for (const pid of [0, -1, 2.5, NaN, Infinity, '123', Number.MAX_SAFE_INTEGER + 1]) {
    assert.match(format({ clientPid: pid, servicePid: pid }), /^Observed client PID: Unknown$/m);
    assert.match(format({ clientPid: pid, servicePid: pid }), /^Self-reported service PID: Unknown$/m);
  }
});

test('formatter preserves trusted status even when operation outcomes disagree', () => {
  for (const statusText of ['PASS', 'FAIL', 'NOT_RUN', 'INCONCLUSIVE', 'Pending external review']) {
    const view = trustedView();
    view.statusText = statusText;
    assert.equal(format(view).split('\n').find(line => line.startsWith('Status: ')), `Status: ${statusText}`);
  }
  const missing = trustedView();
  delete missing.statusText;
  assert.match(format(missing), /^Status: Unknown$/m);
  assert.doesNotMatch(format(missing), /^Status: PASS$/m);
});

test('formatter does not sort deduplicate or adjudicate supplied operation rows', () => {
  const view = { operations: [
    { operation: 'z-last', outcome: 'NOT_RUN', errno: 0 },
    { operation: 'a-first', outcome: 'SERVICE_ERROR', errno: 17 },
    { operation: 'z-last', outcome: 'ALLOWED', errno: 0 }
  ] };
  assert.deepEqual(format(view).split('\n').filter(line => line.startsWith('- ')), [
    '- z-last: NOT_RUN (errno 0)', '- a-first: SERVICE_ERROR (errno 17)', '- z-last: ALLOWED (errno 0)'
  ]);
});

test('formatter absent optional row values remain unknown and zero errno remains zero', () => {
  const view = { runId: '', statusText: '', operations: [null, {},
    { operation: 'probe', outcome: null, errno: null }, { operation: 'zero', outcome: '', errno: 0 }] };
  assert.match(format(view), /^Run ID: Unknown$/m);
  assert.match(format(view), /^Status: Unknown$/m);
  assert.deepEqual(format(view).split('\n').filter(line => line.startsWith('- ')), [
    '- Unknown: Unknown (errno Unknown)', '- Unknown: Unknown (errno Unknown)',
    '- probe: Unknown (errno Unknown)', '- zero: Unknown (errno 0)'
  ]);
  assert.match(format({ operations: [] }), /^- Unknown$/m);
});

test('formatter does not mutate frozen input and has no cross-call remembered values', () => {
  const view = trustedView();
  for (const row of view.operations) Object.freeze(row);
  Object.freeze(view.operations); Object.freeze(view);
  const before = JSON.stringify(view);
  const first = format(view);
  assert.equal(format(view), first);
  assert.equal(JSON.stringify(view), before);
  assert.match(format({ runId: 'different-run', clientPid: 4321 }), /^Run ID: different-run$/m);
  assert.doesNotMatch(format({}), /abc123|1234|9876/);
});

test('formatter always includes both exact caveats once without inferred settlement', () => {
  for (const view of [undefined, trustedView(), { statusText: 'PASS', operations: [] }]) {
    const output = format(view);
    assert.equal(output.split(caveats).length, 2);
    assert.ok(output.endsWith(caveats));
    assert.doesNotMatch(output, /Service terminated|Product accepted|Generated-code execution enabled/);
  }
});

test('formatter module is presentation-only with no external effects or HTML template', async () => {
  const source = await readFile(new URL('../hosts/macos-xpc/native-probe-summary.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:import|require|process|fetch|XMLHttpRequest|eval|Function|setTimeout|setInterval)\b/);
  assert.doesNotMatch(source, /\b(?:Date|performance)\b|Math\s*\.\s*random\b/);
  assert.doesNotMatch(source, /<(?:html|body|script|div|table)\b/i);
  const output = format(trustedView());
  assert.equal(typeof output, 'string');
  assert.match(output, /^Nisi fixed native probe\n/);
});

test('formatter does not coerce non-string text fields into display values', () => {
  for (const value of [42, false, {}, [], new String('boxed')]) {
    const output = format({ runId: value, statusText: value,
      operations: [{ operation: value, outcome: value, errno: 0 }] });
    assert.match(output, /^Run ID: Unknown$/m);
    assert.match(output, /^Status: Unknown$/m);
    assert.match(output, /^- Unknown: Unknown \(errno 0\)$/m);
  }
});

test('formatter non-array operations are unknown rather than iterated or stringified', () => {
  for (const operations of ['rows', {}, 42, false]) {
    assert.deepEqual(format({ operations }).split('\n').filter(line => line.startsWith('- ')), ['- Unknown']);
  }
});

test('formatter invalid errno is unknown while safe integers are preserved', () => {
  for (const errno of [-1, 1.5, NaN, Infinity, '13', Number.MAX_SAFE_INTEGER + 1]) {
    assert.match(format({ operations: [{ operation: 'probe', outcome: 'ERROR', errno }] }),
      /^- probe: ERROR \(errno Unknown\)$/m);
  }
  assert.match(format({ operations: [{ operation: 'probe', outcome: 'ERROR', errno: Number.MAX_SAFE_INTEGER }] }),
    /^- probe: ERROR \(errno 9007199254740991\)$/m);
});
