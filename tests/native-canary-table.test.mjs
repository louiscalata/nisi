import test from 'node:test';
import assert from 'node:assert/strict';
import { adjudicateFixedCanaries as adjudicate, formatCanaryTable as format } from '../hosts/macos-xpc/native-canary-adjudicator.mjs';

const caveat = 'Isolation acceptance is not established by this table.\n';
const EXPECTED = () => [
  { operation: 'own-write', expectedOutcome: 'ALLOWED' },
  { operation: 'outside-read', expectedOutcome: 'DENIED', expectedErrno: 1 },
  { operation: 'loopback-bind', expectedOutcome: 'DENIED' },
  { operation: 'self-report', expectedOutcome: 'SELF_REPORT', expectedPid: 9917, expectedPpid: 9916 }
];

test('format exact layout for an all-matched result', () => {
  const raw = [
    '{"op":"own-write","outcome":"ALLOWED","errno":0}',
    '{"op":"outside-read","outcome":"DENIED","errno":1}',
    '{"op":"loopback-bind","outcome":"DENIED","errno":1}',
    '{"op":"self-report","pid":9917,"ppid":9916}'
  ].join('\n');
  assert.equal(format(adjudicate(raw, EXPECTED())),
    'Fixed canary adjudication\n'
    + 'Overall: ALL_MATCHED\n'
    + 'Rows:\n'
    + '- own-write: expected ALLOWED, observed ALLOWED (errno 0) -> MATCH\n'
    + '- outside-read: expected DENIED errno 1, observed DENIED (errno 1) -> MATCH\n'
    + '- loopback-bind: expected DENIED, observed DENIED (errno 1) -> MATCH\n'
    + '- self-report: expected SELF_REPORT, observed pid 9917 ppid 9916 -> MATCH\n'
    + 'Malformed lines: 0\n'
    + 'Unexpected operations: none\n\n' + caveat);
});

test('format renders unknown observations, mismatches, malformed counts and unexpected operations', () => {
  const raw = [
    'garbage',
    '{"op":"own-write","outcome":"DENIED","errno":"x"}',
    '{"op":"extra","outcome":"ALLOWED"}',
    '{"op":"self-report","pid":1}'
  ].join('\n');
  assert.equal(format(adjudicate(raw, EXPECTED())),
    'Fixed canary adjudication\n'
    + 'Overall: NOT_ACCEPTED\n'
    + 'Rows:\n'
    + '- own-write: expected ALLOWED, observed DENIED (errno Unknown) -> MISMATCH\n'
    + '- outside-read: expected DENIED errno 1, observed Unknown -> NOT_OBSERVED\n'
    + '- loopback-bind: expected DENIED, observed Unknown -> NOT_OBSERVED\n'
    + '- self-report: expected SELF_REPORT, observed pid 1 ppid Unknown -> MISMATCH\n'
    + 'Malformed lines: 1\n'
    + 'Unexpected operations: extra\n\n' + caveat);
});

test('format renders ambiguous rows as Unknown and lists unexpected operations comma-separated in order', () => {
  const raw = [
    '{"op":"b","outcome":"ALLOWED"}',
    '{"op":"own-write","outcome":"ALLOWED","errno":0}',
    '{"op":"own-write","outcome":"ALLOWED","errno":0}',
    '{"op":"a","outcome":"DENIED"}',
    '{"op":"b","outcome":"DENIED"}'
  ].join('\n');
  const out = format(adjudicate(raw, [{ operation: 'own-write', expectedOutcome: 'ALLOWED' }]));
  assert.match(out, /^- own-write: expected ALLOWED, observed Unknown -> AMBIGUOUS$/m);
  assert.match(out, /^Unexpected operations: b, a, b$/m);
  assert.match(out, /^Overall: NOT_ACCEPTED$/m);
});

test('format always ends with the exact caveat once and never claims acceptance', () => {
  for (const raw of ['', '{"op":"own-write","outcome":"ALLOWED","errno":0}']) {
    const out = format(adjudicate(raw, [{ operation: 'own-write', expectedOutcome: 'ALLOWED' }]));
    assert.equal(out.split(caveat).length, 2);
    assert.ok(out.endsWith(caveat));
    assert.doesNotMatch(out, /isolation accepted|Isolation accepted|PASS\b/);
  }
});

test('format rejects anything that is not an adjudication result with TypeError', () => {
  for (const bad of [undefined, null, 'text', 42, {}, { rows: 'x' }, { rows: [] , counts: {} }]) {
    assert.throws(() => format(bad), TypeError);
  }
});

test('format does not mutate the result it renders', () => {
  const r = adjudicate('{"op":"own-write","outcome":"ALLOWED","errno":0}', [{ operation: 'own-write', expectedOutcome: 'ALLOWED' }]);
  Object.freeze(r); Object.freeze(r.rows); Object.freeze(r.counts);
  const before = JSON.stringify(r);
  const first = format(r);
  assert.equal(format(r), first);
  assert.equal(JSON.stringify(r), before);
});
