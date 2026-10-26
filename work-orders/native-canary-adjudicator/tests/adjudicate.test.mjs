import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { adjudicateFixedCanaries as adjudicate } from '../src/native-canary-adjudicator.mjs';

const EXPECTED = () => [
  { operation: 'own-write', expectedOutcome: 'ALLOWED' },
  { operation: 'own-read', expectedOutcome: 'ALLOWED', expectedErrno: 0 },
  { operation: 'outside-read', expectedOutcome: 'DENIED', expectedErrno: 1 },
  { operation: 'loopback-bind', expectedOutcome: 'DENIED' },
  { operation: 'self-report', expectedOutcome: 'SELF_REPORT', expectedPid: 9917, expectedPpid: 9916 }
];

const GOOD_OUTPUT = [
  '{"op":"own-write","outcome":"ALLOWED","errno":0}',
  '{"op":"own-read","outcome":"ALLOWED","errno":0}',
  '{"op":"outside-read","outcome":"DENIED","errno":1}',
  '{"op":"loopback-bind","outcome":"DENIED","errno":1}',
  '{"op":"self-report","pid":9917,"ppid":9916}',
  ''
].join('\n');

test('adjudicate all-matched run yields ALL_MATCHED with rows in expected order', () => {
  const r = adjudicate(GOOD_OUTPUT, EXPECTED());
  assert.equal(r.overall, 'ALL_MATCHED');
  assert.equal(r.isolationAccepted, false);
  assert.deepEqual(r.counts, { matched: 5, mismatched: 0, notObserved: 0, ambiguous: 0 });
  assert.deepEqual(r.malformedLines, []);
  assert.deepEqual(r.unexpectedOperations, []);
  assert.deepEqual(r.rows.map(x => x.operation), ['own-write', 'own-read', 'outside-read', 'loopback-bind', 'self-report']);
  assert.deepEqual(r.rows[0], { operation: 'own-write', expectedOutcome: 'ALLOWED', expectedErrno: null,
    observedOutcome: 'ALLOWED', observedErrno: 0, observedPid: null, observedPpid: null, verdict: 'MATCH' });
  assert.deepEqual(r.rows[2], { operation: 'outside-read', expectedOutcome: 'DENIED', expectedErrno: 1,
    observedOutcome: 'DENIED', observedErrno: 1, observedPid: null, observedPpid: null, verdict: 'MATCH' });
  assert.deepEqual(r.rows[4], { operation: 'self-report', expectedOutcome: 'SELF_REPORT', expectedErrno: null,
    observedOutcome: null, observedErrno: null, observedPid: 9917, observedPpid: 9916, verdict: 'MATCH' });
});

test('adjudicate empty, null or whitespace output marks every row NOT_OBSERVED and is NOT_ACCEPTED', () => {
  for (const raw of [undefined, null, '', '\n\n  \n', '\r\n']) {
    const r = adjudicate(raw, EXPECTED());
    assert.equal(r.overall, 'NOT_ACCEPTED');
    assert.deepEqual(r.counts, { matched: 0, mismatched: 0, notObserved: 5, ambiguous: 0 });
    assert.ok(r.rows.every(x => x.verdict === 'NOT_OBSERVED' && x.observedOutcome === null && x.observedErrno === null));
    assert.deepEqual(r.malformedLines, []);
  }
});

test('adjudicate outcome or errno disagreement is MISMATCH, never coerced', () => {
  const raw = [
    '{"op":"own-write","outcome":"DENIED","errno":1}',
    '{"op":"own-read","outcome":"ALLOWED","errno":5}',
    '{"op":"outside-read","outcome":"DENIED","errno":"1"}',
    '{"op":"loopback-bind","outcome":"denied","errno":1}',
    '{"op":"self-report","pid":9917,"ppid":1}'
  ].join('\n');
  const r = adjudicate(raw, EXPECTED());
  assert.deepEqual(r.rows.map(x => x.verdict), ['MISMATCH', 'MISMATCH', 'MISMATCH', 'MISMATCH', 'MISMATCH']);
  assert.equal(r.rows[2].observedErrno, null);
  assert.equal(r.rows[3].observedOutcome, 'denied');
  assert.deepEqual(r.counts, { matched: 0, mismatched: 5, notObserved: 0, ambiguous: 0 });
  assert.equal(r.overall, 'NOT_ACCEPTED');
});

test('adjudicate errno expectation absent accepts any errno; invalid errno values read as null', () => {
  for (const errno of ['0', 1.5, -1, null, true, 9007199254740992]) {
    const raw = JSON.stringify({ op: 'loopback-bind', outcome: 'DENIED', errno });
    const r = adjudicate(raw, [{ operation: 'loopback-bind', expectedOutcome: 'DENIED' }]);
    assert.equal(r.rows[0].verdict, 'MATCH');
    assert.equal(r.rows[0].observedErrno, null);
  }
  const r = adjudicate('{"op":"loopback-bind","outcome":"DENIED","errno":-1}',
    [{ operation: 'loopback-bind', expectedOutcome: 'DENIED', expectedErrno: 1 }]);
  assert.equal(r.rows[0].verdict, 'MISMATCH');
});

test('adjudicate duplicate observations of one operation are AMBIGUOUS, not first-wins', () => {
  const raw = [
    '{"op":"own-write","outcome":"ALLOWED","errno":0}',
    '{"op":"own-write","outcome":"DENIED","errno":1}'
  ].join('\n');
  const r = adjudicate(raw, [{ operation: 'own-write', expectedOutcome: 'ALLOWED' }]);
  assert.equal(r.rows[0].verdict, 'AMBIGUOUS');
  assert.equal(r.rows[0].observedOutcome, null);
  assert.equal(r.rows[0].observedErrno, null);
  assert.deepEqual(r.counts, { matched: 0, mismatched: 0, notObserved: 0, ambiguous: 1 });
  assert.equal(r.overall, 'NOT_ACCEPTED');
});

test('adjudicate malformed lines are recorded with 1-based line numbers and reasons, never thrown', () => {
  const raw = [
    'not json',
    '[1,2]',
    'null',
    '{"outcome":"ALLOWED"}',
    '{"op":"","outcome":"ALLOWED"}',
    '{"op":"own-write","outcome":"ALLOWED","errno":0}'
  ].join('\n');
  const r = adjudicate(raw, [{ operation: 'own-write', expectedOutcome: 'ALLOWED' }]);
  assert.deepEqual(r.malformedLines, [
    { line: 1, reason: 'INVALID_JSON' },
    { line: 2, reason: 'NOT_AN_OBJECT' },
    { line: 3, reason: 'NOT_AN_OBJECT' },
    { line: 4, reason: 'MISSING_OP' },
    { line: 5, reason: 'MISSING_OP' }
  ]);
  assert.equal(r.rows[0].verdict, 'MATCH');
  assert.equal(r.overall, 'NOT_ACCEPTED');
});

test('adjudicate observed operations outside the expected matrix are reported in order with duplicates', () => {
  const raw = [
    '{"op":"extra-two","outcome":"ALLOWED"}',
    '{"op":"own-write","outcome":"ALLOWED","errno":0}',
    '{"op":"extra-one","outcome":"DENIED"}',
    '{"op":"extra-two","outcome":"DENIED"}'
  ].join('\n');
  const r = adjudicate(raw, [{ operation: 'own-write', expectedOutcome: 'ALLOWED' }]);
  assert.deepEqual(r.unexpectedOperations, ['extra-two', 'extra-one', 'extra-two']);
  assert.equal(r.rows[0].verdict, 'MATCH');
  assert.equal(r.overall, 'NOT_ACCEPTED');
});

test('adjudicate self-report requires positive safe integers equal to the expected identities', () => {
  const cases = [
    ['{"op":"self-report","pid":9917,"ppid":9916}', 'MATCH', 9917, 9916],
    ['{"op":"self-report","pid":"9917","ppid":9916}', 'MISMATCH', null, 9916],
    ['{"op":"self-report","pid":0,"ppid":9916}', 'MISMATCH', null, 9916],
    ['{"op":"self-report","pid":9917}', 'MISMATCH', 9917, null],
    ['{"op":"self-report","pid":9917,"ppid":9916,"outcome":"ALLOWED"}', 'MATCH', 9917, 9916]
  ];
  for (const [raw, verdict, pid, ppid] of cases) {
    const r = adjudicate(raw, [{ operation: 'self-report', expectedOutcome: 'SELF_REPORT', expectedPid: 9917, expectedPpid: 9916 }]);
    assert.equal(r.rows[0].verdict, verdict, raw);
    assert.equal(r.rows[0].observedPid, pid, raw);
    assert.equal(r.rows[0].observedPpid, ppid, raw);
    assert.equal(r.rows[0].observedOutcome, null, raw);
  }
  const partial = adjudicate('{"op":"self-report","pid":1,"ppid":2}',
    [{ operation: 'self-report', expectedOutcome: 'SELF_REPORT', expectedPpid: 2 }]);
  assert.equal(partial.rows[0].verdict, 'MATCH');
});

test('adjudicate rejects an invalid expected matrix with TypeError before reading output', () => {
  for (const bad of [undefined, null, [], 'own-write', [{ operation: '', expectedOutcome: 'ALLOWED' }],
    [{ operation: 'x', expectedOutcome: 'MAYBE' }], [{ operation: 'x', expectedOutcome: 'DENIED', expectedErrno: 1.5 }],
    [{ operation: 'x', expectedOutcome: 'ALLOWED' }, { operation: 'x', expectedOutcome: 'DENIED' }]]) {
    assert.throws(() => adjudicate(GOOD_OUTPUT, bad), TypeError);
  }
});

test('adjudicate does not mutate frozen inputs and returns fresh objects each call', () => {
  const expected = EXPECTED();
  for (const row of expected) Object.freeze(row);
  Object.freeze(expected);
  const before = JSON.stringify(expected);
  const a = adjudicate(GOOD_OUTPUT, expected);
  const b = adjudicate(GOOD_OUTPUT, expected);
  assert.notEqual(a, b);
  assert.notEqual(a.rows, b.rows);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(expected), before);
  a.rows[0].verdict = 'MISMATCH';
  assert.equal(adjudicate(GOOD_OUTPUT, expected).rows[0].verdict, 'MATCH');
});

test('adjudicate module is pure: no I/O, process, clock or randomness in the source', async () => {
  const source = await readFile(new URL('../src/native-canary-adjudicator.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:import|require|process|fetch|XMLHttpRequest|eval|Function|setTimeout|setInterval)\b/);
  assert.doesNotMatch(source, /\b(?:Date|performance)\b|Math\s*\.\s*random\b/);
});
