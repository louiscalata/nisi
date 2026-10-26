// tests/paired-outcome-summary-v2.test.mjs
// Independent table-driven tests for the v2 descriptive paired summary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSyntheticPairedTrial } from '../evaluation/fixtures/paired-example-v1.mjs';
import { validatePairedTrialV1, validatePairedTrialRowsV1 } from '../evaluation/paired-trial-v1.mjs';
import { analyzePairedTrialV2 } from '../evaluation/paired-outcome-summary-v2.mjs';

const MAX = Number.MAX_SAFE_INTEGER;
const RES = ['tokens', 'durationMs', 'repairAttempts'];
const rate = (numerator, denominator, denominatorDef) =>
  ({ numerator, denominator, denominatorDef, value: denominator === 0 ? null : numerator / denominator });
const counts = (o = {}) => ({ PASS: 0, FAIL: 0, NOT_RUN: 0, ERROR: 0, INCONCLUSIVE: 0, ...o });
const T = (status, value = null) => ({ status, value });
// Build a fixture and apply per-side patches: [[pairIndex, 'off'|'on', {field: value}], ...]
function fixture(patches = []) {
  const input = createSyntheticPairedTrial();
  for (const [i, side, changes] of patches) Object.assign(input.pairs[i][side], changes);
  return input;
}
function assertDeepFrozen(value, path = 'root') {
  if (value === null || typeof value !== 'object') return;
  assert.ok(Object.isFrozen(value), `${path} not frozen`);
  for (const [k, v] of Object.entries(value)) assertDeepFrozen(v, `${path}.${k}`);
}

test('baseline fixture: exact top-level shape and outcome counts/rates', () => {
  const out = analyzePairedTrialV2(fixture());
  assert.equal(out.schemaVersion, 'nisi-paired-trial-analysis-v2');
  assert.equal(out.status, 'OBSERVED');
  assert.equal(out.pairCount, 2);
  assert.equal(out.rows.length, 2);
  assert.equal(out.sourceTrust, 'UNVERIFIED');
  assert.equal(out.measurementVerified, false);
  assert.equal(out.causalClaim, false);
  assert.equal(out.authorizing, false);
  assert.deepEqual(Object.keys(out).sort(), ['authorizing', 'causalClaim', 'measurementVerified', 'outcomes',
    'pairCount', 'resources', 'rows', 'schemaVersion', 'sourceTrust', 'status'].sort());
  assert.deepEqual(out.outcomes.off, {
    observations: 2, counts: counts({ PASS: 1, FAIL: 1 }), completionClaims: 2, reportedPasses: 1,
    incorrectCompletionClaims: 1, unknownCompletionClaims: 0,
    rates: {
      reportedPassRate: rate(1, 2, 'SUPPLIED_PAIRED_OBSERVATIONS'),
      incorrectCompletionRate: rate(1, 2, 'REPORTED_COMPLETION_CLAIMS'),
      incorrectObservationRate: rate(1, 2, 'SUPPLIED_PAIRED_OBSERVATIONS'),
      unknownCompletionRate: rate(0, 2, 'REPORTED_COMPLETION_CLAIMS'),
    },
  });
  assert.deepEqual(out.outcomes.on, {
    observations: 2, counts: counts({ PASS: 2 }), completionClaims: 2, reportedPasses: 2,
    incorrectCompletionClaims: 0, unknownCompletionClaims: 0,
    rates: {
      reportedPassRate: rate(2, 2, 'SUPPLIED_PAIRED_OBSERVATIONS'),
      incorrectCompletionRate: rate(0, 2, 'REPORTED_COMPLETION_CLAIMS'),
      incorrectObservationRate: rate(0, 2, 'SUPPLIED_PAIRED_OBSERVATIONS'),
      unknownCompletionRate: rate(0, 2, 'REPORTED_COMPLETION_CLAIMS'),
    },
  });
});

test('baseline fixture: all three resources are exact complete-case sums', () => {
  const out = analyzePairedTrialV2(fixture());
  const table = [
    ['tokens', 200, 100],
    ['durationMs', 2000, 1500],
    ['repairAttempts', 2, 0],
  ];
  for (const [name, off, on] of table) {
    const sum = total => ({ observations: 2, knownCount: 2, unknownCount: 0, overflowCount: 0,
      aggregateOverflow: false, knownSubtotal: T('KNOWN', total), allObservedTotal: T('KNOWN', total) });
    assert.deepEqual(out.resources[name], {
      off: sum(off), on: sum(on),
      paired: { completeCaseCount: 2, excludedPairs: [], offTotal: T('KNOWN', off), onTotal: T('KNOWN', on),
        deltaOnMinusOff: on - off, onLowerCount: 2, offLowerCount: 0, tieCount: 0 },
    }, name);
  }
  assert.deepEqual(Object.keys(out.resources), RES);
});

test('zero denominators: no completion claims yields null claim-based rates', () => {
  const out = analyzePairedTrialV2(fixture([
    [0, 'off', { completionClaim: false }], [1, 'off', { completionClaim: false }],
  ]));
  const off = out.outcomes.off;
  assert.equal(off.completionClaims, 0);
  assert.equal(off.incorrectCompletionClaims, 0);
  assert.deepEqual(off.rates.incorrectCompletionRate, rate(0, 0, 'REPORTED_COMPLETION_CLAIMS'));
  assert.deepEqual(off.rates.unknownCompletionRate, rate(0, 0, 'REPORTED_COMPLETION_CLAIMS'));
  assert.equal(off.rates.incorrectCompletionRate.value, null);
  assert.deepEqual(off.rates.reportedPassRate, rate(1, 2, 'SUPPLIED_PAIRED_OBSERVATIONS'));
  assert.deepEqual(off.rates.incorrectObservationRate, rate(0, 2, 'SUPPLIED_PAIRED_OBSERVATIONS'));
});

test('unknown outcomes: table of claimed non-PASS/FAIL outcomes count as unknown claims', () => {
  for (const outcome of ['NOT_RUN', 'ERROR', 'INCONCLUSIVE']) {
    const out = analyzePairedTrialV2(fixture([[0, 'off', { outcome, completionClaim: true }]]));
    const off = out.outcomes.off;
    assert.deepEqual(off.counts, counts({ PASS: 1, [outcome]: 1 }), outcome);
    assert.equal(off.unknownCompletionClaims, 1, outcome);
    assert.equal(off.incorrectCompletionClaims, 0, outcome);
    assert.deepEqual(off.rates.unknownCompletionRate, rate(1, 2, 'REPORTED_COMPLETION_CLAIMS'), outcome);
    // Unrelated observations (resources, other side) are not suppressed.
    assert.equal(out.resources.tokens.off.knownSubtotal.value, 200, outcome);
    assert.equal(out.outcomes.on.reportedPasses, 2, outcome);
  }
});

test('unknown telemetry: null inputs are counted, never zero-imputed, and pairs are excluded', () => {
  const out = analyzePairedTrialV2(fixture([[0, 'off', { tokenUsage: null, durationMs: null, repairAttempts: null }]]));
  const table = [['tokens', 100, 50], ['durationMs', 1000, 750], ['repairAttempts', 1, 0]];
  for (const [name, off, on] of table) {
    const r = out.resources[name];
    assert.deepEqual(r.off, { observations: 2, knownCount: 1, unknownCount: 1, overflowCount: 0, aggregateOverflow: false,
      knownSubtotal: T('KNOWN', off), allObservedTotal: T('UNKNOWN') }, name);
    assert.equal(r.on.allObservedTotal.status, 'KNOWN', name);
    assert.deepEqual(r.paired, { completeCaseCount: 1,
      excludedPairs: [{ caseId: 'case.one', offStatus: 'UNKNOWN', onStatus: 'KNOWN' }],
      offTotal: T('KNOWN', off), onTotal: T('KNOWN', on), deltaOnMinusOff: on - off,
      onLowerCount: 1, offLowerCount: 0, tieCount: 0 }, name);
  }
  assert.equal(out.outcomes.off.observations, 2);
});

test('per-row token overflow: reported explicitly without erasing outcome metrics', () => {
  const input = fixture([[1, 'off', { tokenUsage: { input: MAX, output: 1 } }]]);
  const out = analyzePairedTrialV2(input);
  const r = out.resources.tokens;
  assert.deepEqual(r.off, { observations: 2, knownCount: 1, unknownCount: 0, overflowCount: 1, aggregateOverflow: false,
    knownSubtotal: T('KNOWN', 100), allObservedTotal: T('OVERFLOW') });
  assert.deepEqual(r.paired.excludedPairs, [{ caseId: 'case.two', offStatus: 'OVERFLOW', onStatus: 'KNOWN' }]);
  assert.equal(r.paired.completeCaseCount, 1);
  assert.deepEqual(r.paired.offTotal, T('KNOWN', 100));
  assert.equal(r.paired.deltaOnMinusOff, -50);
  assert.equal(out.outcomes.off.reportedPasses, 1);
  assert.equal(out.resources.durationMs.paired.completeCaseCount, 2);
  // v1 keeps refusing the same input with TRIAL_OVERFLOW.
  assert.throws(() => validatePairedTrialV1(input), { code: 'TRIAL_OVERFLOW' });
});

test('aggregate overflow: rows individually safe, subtotal OVERFLOW, comparisons still counted', () => {
  const big = { input: MAX - 1, output: 1 };
  const out = analyzePairedTrialV2(fixture([[0, 'off', { tokenUsage: big }], [1, 'off', { tokenUsage: big }]]));
  const r = out.resources.tokens;
  assert.deepEqual(r.off, { observations: 2, knownCount: 2, unknownCount: 0, overflowCount: 0, aggregateOverflow: true,
    knownSubtotal: T('OVERFLOW'), allObservedTotal: T('OVERFLOW') });
  assert.deepEqual(r.paired, { completeCaseCount: 2, excludedPairs: [], offTotal: T('OVERFLOW'), onTotal: T('KNOWN', 100),
    deltaOnMinusOff: null, onLowerCount: 2, offLowerCount: 0, tieCount: 0 });
  assert.equal(r.paired.onLowerCount + r.paired.offLowerCount + r.paired.tieCount, r.paired.completeCaseCount);
});

test('mixed unknown + overflow: concurrent counts, NO_DATA subtotal, no complete cases', () => {
  const out = analyzePairedTrialV2(fixture([
    [0, 'off', { tokenUsage: null }], [1, 'off', { tokenUsage: { input: 1, output: MAX } }],
  ]));
  const r = out.resources.tokens;
  assert.deepEqual(r.off, { observations: 2, knownCount: 0, unknownCount: 1, overflowCount: 1, aggregateOverflow: false,
    knownSubtotal: T('NO_DATA'), allObservedTotal: T('OVERFLOW') });
  assert.deepEqual(r.paired, { completeCaseCount: 0,
    excludedPairs: [{ caseId: 'case.one', offStatus: 'UNKNOWN', onStatus: 'KNOWN' },
      { caseId: 'case.two', offStatus: 'OVERFLOW', onStatus: 'KNOWN' }],
    offTotal: T('NO_DATA'), onTotal: T('NO_DATA'), deltaOnMinusOff: null, onLowerCount: 0, offLowerCount: 0, tieCount: 0 });
  assert.deepEqual(r.on.knownSubtotal, T('KNOWN', 100));
});

test('tie counting and equal-value pairs', () => {
  const out = analyzePairedTrialV2(fixture([[0, 'on', { durationMs: 1000 }]]));
  const p = out.resources.durationMs.paired;
  assert.deepEqual([p.onLowerCount, p.offLowerCount, p.tieCount], [1, 0, 1]);
  assert.equal(p.deltaOnMinusOff, 1750 - 2000);
});

test('output is deeply frozen and input is left untouched', () => {
  const input = fixture([[0, 'off', { tokenUsage: null }]]);
  const snapshot = structuredClone(input);
  const out = analyzePairedTrialV2(input);
  assertDeepFrozen(out);
  assert.deepEqual(input, snapshot);
  assert.equal(Object.isFrozen(input), false);
  assert.equal(Object.isFrozen(input.pairs[0].off), false);
  assert.notEqual(out.rows[0], input.pairs[0]);
});

test('validatePairedTrialRowsV1: frozen owned rows, same refusals', () => {
  const rows = validatePairedTrialRowsV1(fixture());
  assert.equal(rows.length, 2);
  assertDeepFrozen(rows);
  assert.equal(rows[0].caseId, 'case.one');
  assert.equal(rows[1].on.tokenUsage.output, 10);
  const bad = fixture(); bad.schemaVersion = 'other';
  assert.throws(() => validatePairedTrialRowsV1(bad), { code: 'TRIAL_SCHEMA' });
});

test('schema/type refusals propagate from v1 helper unchanged in v2', () => {
  const table = [
    ['schema', i => { i.schemaVersion = 'nisi-paired-trial-v2'; }, 'TRIAL_SCHEMA'],
    ['extra key', i => { i.extra = 1; }, 'TRIAL_RECORD'],
    ['empty pairs', i => { i.pairs = []; }, 'TRIAL_LIST'],
    ['bad outcome', i => { i.pairs[0].on.outcome = 'OK'; }, 'TRIAL_OUTCOME'],
    ['negative tokens', i => { i.pairs[0].on.tokenUsage = { input: -1, output: 0 }; }, 'TRIAL_NUMBER'],
    ['duplicate case', i => { i.pairs[1].caseId = 'case.one'; }, 'TRIAL_DUPLICATE_CASE'],
    ['stale oracle', i => { i.pairs[0].off.oracleCandidateSha256 = 'f'.repeat(64); }, 'TRIAL_STALE_ORACLE'],
  ];
  for (const [name, mutate, code] of table) {
    const input = fixture(); mutate(input);
    assert.throws(() => analyzePairedTrialV2(input), { code }, `v2 ${name}`);
    assert.throws(() => validatePairedTrialV1(input), { code }, `v1 ${name}`);
  }
  assert.throws(() => analyzePairedTrialV2(null), { code: 'TRIAL_RECORD' });
});

test('v1 output preserved: same shape, frozen, no v2 fields', () => {
  const out = validatePairedTrialV1(fixture());
  assert.equal(out.schemaVersion, 'nisi-paired-trial-analysis-v1');
  assert.equal(out.pairCount, 2);
  assert.equal(out.rows.length, 2);
  assert.ok(Array.isArray(out.reasons));
  assert.ok('metrics' in out && 'status' in out);
  assert.deepEqual([out.measurementVerified, out.causalClaim, out.authorizing], [false, false, false]);
  assert.equal('resources' in out, false);
  assert.equal('sourceTrust' in out, false);
  assertDeepFrozen(out);
});
