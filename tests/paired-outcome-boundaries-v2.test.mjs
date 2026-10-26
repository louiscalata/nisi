// Root-written independent resource/denominator boundary checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSyntheticPairedTrial } from '../evaluation/fixtures/paired-example-v1.mjs';
import { PAIRED_V2_BOUNDARIES } from '../evaluation/fixtures/paired-v2-boundaries.mjs';
import { analyzePairedTrialV2 } from '../evaluation/paired-outcome-summary-v2.mjs';
import { validatePairedTrialV1 } from '../evaluation/paired-trial-v1.mjs';

for (const boundary of PAIRED_V2_BOUNDARIES) {
  test(`synthetic token matrix: ${boundary.id}`, () => {
    const input = createSyntheticPairedTrial();
    for (const arm of ['off', 'on']) input.pairs.forEach((row, i) => {
      row[arm].tokenUsage = structuredClone(boundary[arm][i]);
    });
    const report = analyzePairedTrialV2(input), r = report.resources.tokens;
    assert.deepEqual({
      completeCaseCount: r.paired.completeCaseCount,
      offUnknownCount: r.off.unknownCount, onUnknownCount: r.on.unknownCount,
      offOverflowCount: r.off.overflowCount, onOverflowCount: r.on.overflowCount,
      offAggregateOverflow: r.off.aggregateOverflow, onAggregateOverflow: r.on.aggregateOverflow,
    }, boundary.expected);
    assert.equal(r.paired.excludedPairs.length + r.paired.completeCaseCount, 2);
    assert.equal(r.paired.onLowerCount + r.paired.offLowerCount + r.paired.tieCount, r.paired.completeCaseCount);
    assert.equal(report.outcomes.off.incorrectCompletionClaims, 1);
    assert.equal(report.outcomes.on.reportedPasses, 2);
    assert.equal(report.resources.durationMs.paired.deltaOnMinusOff, -500);
    assert.doesNotThrow(() => JSON.stringify(report));
  });
}

test('all-unknown resources retain no-data subtotals and unknown observations', () => {
  const input = createSyntheticPairedTrial();
  for (const pair of input.pairs) for (const arm of ['off', 'on']) {
    Object.assign(pair[arm], { tokenUsage: null, durationMs: null, repairAttempts: null });
  }
  const report = analyzePairedTrialV2(input);
  for (const r of Object.values(report.resources)) {
    for (const arm of ['off', 'on']) {
      assert.deepEqual(r[arm].knownSubtotal, { status: 'NO_DATA', value: null });
      assert.deepEqual(r[arm].allObservedTotal, { status: 'UNKNOWN', value: null });
    }
    assert.deepEqual(r.paired.offTotal, { status: 'NO_DATA', value: null });
    assert.deepEqual(r.paired.onTotal, { status: 'NO_DATA', value: null });
    assert.equal(r.paired.deltaOnMinusOff, null);
  }
  assert.equal(report.outcomes.off.rates.reportedPassRate.value, 0.5);
  assert.equal(validatePairedTrialV1(input).metrics, null);
});

test('rates distinguish completion claims from supplied observations and failed nonclaims', () => {
  const input = createSyntheticPairedTrial();
  input.pairs[1].off.completionClaim = false;
  const r = analyzePairedTrialV2(input).outcomes.off;
  assert.deepEqual(r.rates.incorrectCompletionRate,
    { numerator: 1, denominator: 1, denominatorDef: 'REPORTED_COMPLETION_CLAIMS', value: 1 });
  assert.deepEqual(r.rates.incorrectObservationRate,
    { numerator: 1, denominator: 2, denominatorDef: 'SUPPLIED_PAIRED_OBSERVATIONS', value: 0.5 });
  input.pairs[0].off.completionClaim = false;
  assert.equal(analyzePairedTrialV2(input).outcomes.off.incorrectCompletionClaims, 0);
  for (const outcome of ['NOT_RUN', 'ERROR', 'INCONCLUSIVE']) {
    input.pairs[0].off.outcome = outcome;
    const off = analyzePairedTrialV2(input).outcomes.off;
    assert.equal(off.counts[outcome], 1);
    assert.equal(off.unknownCompletionClaims, 0);
    assert.equal(off.rates.unknownCompletionRate.value, null);
  }
});

test('resource-specific complete cases cannot include another arm\'s unmatched known rows', () => {
  const input = createSyntheticPairedTrial();
  input.pairs[0].off.durationMs = null;
  input.pairs[1].on.durationMs = null;
  const r = analyzePairedTrialV2(input).resources;
  assert.equal(r.tokens.paired.completeCaseCount, 2);
  assert.equal(r.durationMs.off.knownSubtotal.value, 1000);
  assert.equal(r.durationMs.on.knownSubtotal.value, 750);
  assert.equal(r.durationMs.paired.completeCaseCount, 0);
  assert.equal(r.durationMs.paired.deltaOnMinusOff, null);
});

test('unknown arm values never reach known-only numeric conversion', () => {
  const input = createSyntheticPairedTrial();
  input.pairs[0].off.tokenUsage = null;
  assert.doesNotThrow(() => analyzePairedTrialV2(input));
});

test('safe signed extremes and zero are real known measurements', () => {
  for (const arm of ['off', 'on']) {
    const input = createSyntheticPairedTrial();
    for (const pair of input.pairs) for (const side of ['off', 'on']) {
      Object.assign(pair[side], { tokenUsage: { input: 0, output: 0 }, durationMs: 0, repairAttempts: 0 });
    }
    Object.assign(input.pairs[0][arm], { tokenUsage: { input: Number.MAX_SAFE_INTEGER, output: 0 },
      durationMs: Number.MAX_SAFE_INTEGER, repairAttempts: Number.MAX_SAFE_INTEGER });
    for (const r of Object.values(analyzePairedTrialV2(input).resources)) {
      assert.equal(r.paired.deltaOnMinusOff, arm === 'on' ? Number.MAX_SAFE_INTEGER : -Number.MAX_SAFE_INTEGER);
      assert.equal(r.paired.onLowerCount, arm === 'off' ? 1 : 0);
      assert.equal(r.paired.offLowerCount, arm === 'on' ? 1 : 0);
      assert.equal(r.paired.tieCount, 1);
      assert.equal(r.off.unknownCount + r.on.unknownCount, 0);
    }
  }
});

test('duration and repair aggregate overflow never round or erase other summaries', () => {
  const input = createSyntheticPairedTrial();
  for (const pair of input.pairs) for (const arm of ['off', 'on']) {
    Object.assign(pair[arm], { durationMs: Number.MAX_SAFE_INTEGER, repairAttempts: Number.MAX_SAFE_INTEGER });
  }
  const out = analyzePairedTrialV2(input);
  for (const name of ['durationMs', 'repairAttempts']) {
    const r = out.resources[name];
    assert.equal(r.paired.completeCaseCount, 2);
    assert.equal(r.paired.tieCount, 2);
    assert.equal(r.paired.deltaOnMinusOff, null);
    for (const arm of ['off', 'on']) {
      assert.equal(r[arm].knownCount, 2);
      assert.equal(r[arm].overflowCount, 0);
      assert.equal(r[arm].aggregateOverflow, true);
      assert.deepEqual(r[arm].knownSubtotal, { status: 'OVERFLOW', value: null });
      assert.deepEqual(r.paired[`${arm}Total`], { status: 'OVERFLOW', value: null });
    }
  }
  assert.equal(out.resources.tokens.paired.deltaOnMinusOff, -100);
  assert.equal(out.outcomes.on.reportedPasses, 2);
});

test('unknown outcome and resources coexist without erasing reported counts', () => {
  const input = createSyntheticPairedTrial();
  Object.assign(input.pairs[0].off, { outcome: 'NOT_RUN', completionClaim: true,
    tokenUsage: null, durationMs: null, repairAttempts: null });
  const out = analyzePairedTrialV2(input);
  assert.equal(out.outcomes.off.counts.NOT_RUN, 1);
  assert.equal(out.outcomes.off.unknownCompletionClaims, 1);
  assert.equal(out.outcomes.off.rates.unknownCompletionRate.value, 0.5);
  for (const r of Object.values(out.resources)) {
    assert.equal(r.off.unknownCount, 1);
    assert.equal(r.on.knownCount, 2);
    assert.equal(r.paired.completeCaseCount, 1);
    assert.deepEqual(r.paired.excludedPairs, [{ caseId: 'case.one', offStatus: 'UNKNOWN', onStatus: 'KNOWN' }]);
  }
});

test('known rows retain separate unknown and aggregate-overflow evidence', () => {
  const input = createSyntheticPairedTrial();
  const third = structuredClone(input.pairs[0]);
  third.caseId = 'case.three'; third.off.runId = 'off.three'; third.on.runId = 'on.three';
  input.pairs.push(third);
  input.pairs[0].off.tokenUsage = null;
  input.pairs[1].off.tokenUsage = { input: Number.MAX_SAFE_INTEGER, output: 0 };
  input.pairs[2].off.tokenUsage = { input: 1, output: 0 };
  const r = analyzePairedTrialV2(input).resources.tokens;
  assert.deepEqual(r.off, { observations: 3, knownCount: 2, unknownCount: 1, overflowCount: 0,
    aggregateOverflow: true, knownSubtotal: { status: 'OVERFLOW', value: null },
    allObservedTotal: { status: 'OVERFLOW', value: null } });
  assert.equal(r.paired.completeCaseCount, 2);
  assert.equal(r.paired.excludedPairs.length, 1);
  assert.equal(r.paired.deltaOnMinusOff, null);
  assert.equal(r.paired.onLowerCount, 1);
  assert.equal(r.paired.offLowerCount, 1);
  input.pairs[1].off.tokenUsage = { input: 5, output: 0 };
  const after = analyzePairedTrialV2(input).resources.tokens.off;
  assert.deepEqual(after.knownSubtotal, { status: 'KNOWN', value: 6 });
  assert.deepEqual(after.allObservedTotal, { status: 'UNKNOWN', value: null });
});

test('v2 shares descriptor-safe refusals without invoking getters or accepting mismatched evidence', () => {
  let invoked = 0;
  const cases = [
    [i => Object.defineProperty(i.pairs[0].off, 'outcome', { enumerable: true, get() { invoked++; return 'PASS'; } }), 'TRIAL_RECORD'],
    [i => { i.pairs[0].off[Symbol('hidden')] = 1; }, 'TRIAL_RECORD'],
    [i => { delete i.pairs[1]; }, 'TRIAL_LIST'],
    [i => { i.pairs.extra = 1; }, 'TRIAL_LIST'],
    [i => { i.pairs[1].on.runId = i.pairs[0].off.runId; }, 'TRIAL_DUPLICATE_RUN'],
    [i => { i.pairs[0].off.modelSettingsSha256 = 'f'.repeat(64); }, 'TRIAL_UNMATCHED_CONFIGURATION'],
    [i => { i.pairs[0].taskSha256 = 'x'.repeat(64); }, 'TRIAL_DIGEST'],
    [i => { i.pairs[0].caseId += '\n'; }, 'TRIAL_IDENTIFIER'],
    [i => { i.pairs[0].on.model = '\ud800'; }, 'TRIAL_MODEL'],
    [i => { i.pairs[0].on.durationMs = -0; }, 'TRIAL_NUMBER'],
    [i => { i.pairs[0].on.repairAttempts = 0.5; }, 'TRIAL_NUMBER'],
    [i => { i.pairs[0].on.tokenUsage.input = Number.MAX_SAFE_INTEGER + 1; }, 'TRIAL_NUMBER'],
  ];
  for (const [mutate, code] of cases) {
    const input = createSyntheticPairedTrial(); mutate(input);
    assert.throws(() => analyzePairedTrialV2(input), { code });
    assert.throws(() => validatePairedTrialV1(input), { code });
  }
  assert.equal(invoked, 0);
});
