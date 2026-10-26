// evaluation/paired-outcome-summary-v2.mjs
// PRIVATE descriptive summary of supplied paired OFF/ON observations.
// Additive analysis only: outcomes are the reported oracle/check values, not
// independently verified correctness. No scheduling, provenance, benefit,
// significance or eligibility claims. No model, process, network or storage work.
// OBSERVED means supplied observations summarized, not execution witnessed here.
import { validatePairedTrialRowsV1 } from './paired-trial-v1.mjs';

const OUTCOMES = ['PASS', 'FAIL', 'NOT_RUN', 'ERROR', 'INCONCLUSIVE'];
const UNKNOWN_OUTCOMES = ['NOT_RUN', 'ERROR', 'INCONCLUSIVE'];
const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const SIDES = ['off', 'on'];
const RESOURCES = ['tokens', 'durationMs', 'repairAttempts'];

// Only newly constructed, acyclic plain data (plus already-frozen rows) reaches here.
function freezeOwned(value) {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeOwned(child);
    Object.freeze(value);
  }
  return value;
}

const rate = (numerator, denominator, denominatorDef) =>
  ({ numerator, denominator, denominatorDef, value: denominator === 0 ? null : numerator / denominator });

function outcomeSummary(sides) {
  const counts = Object.fromEntries(OUTCOMES.map(k => [k, 0]));
  let completionClaims = 0, incorrectCompletionClaims = 0, unknownCompletionClaims = 0;
  for (const s of sides) {
    counts[s.outcome] += 1;
    if (s.completionClaim) {
      completionClaims += 1;
      if (s.outcome === 'FAIL') incorrectCompletionClaims += 1;
      else if (UNKNOWN_OUTCOMES.includes(s.outcome)) unknownCompletionClaims += 1;
    }
  }
  const observations = sides.length, reportedPasses = counts.PASS;
  return {
    observations, counts, completionClaims, reportedPasses, incorrectCompletionClaims, unknownCompletionClaims,
    rates: {
      reportedPassRate: rate(reportedPasses, observations, 'SUPPLIED_PAIRED_OBSERVATIONS'),
      incorrectCompletionRate: rate(incorrectCompletionClaims, completionClaims, 'REPORTED_COMPLETION_CLAIMS'),
      incorrectObservationRate: rate(incorrectCompletionClaims, observations, 'SUPPLIED_PAIRED_OBSERVATIONS'),
      unknownCompletionRate: rate(unknownCompletionClaims, completionClaims, 'REPORTED_COMPLETION_CLAIMS'),
    },
  };
}

// Per-row measurement: KNOWN(value), UNKNOWN(null input) or OVERFLOW(token sum unsafe).
function measure(side, key) {
  if (key === 'tokens') {
    const t = side.tokenUsage;
    if (t === null) return { status: 'UNKNOWN', value: null };
    const sum = BigInt(t.input) + BigInt(t.output);
    return sum > MAX ? { status: 'OVERFLOW', value: null } : { status: 'KNOWN', value: Number(sum) };
  }
  const v = side[key];
  return v === null ? { status: 'UNKNOWN', value: null } : { status: 'KNOWN', value: v };
}

const total = (count, big) => count === 0 ? { status: 'NO_DATA', value: null }
  : big > MAX ? { status: 'OVERFLOW', value: null } : { status: 'KNOWN', value: Number(big) };

function sideSum(measurements) {
  let knownCount = 0, unknownCount = 0, overflowCount = 0, big = 0n;
  for (const m of measurements) {
    if (m.status === 'KNOWN') { knownCount += 1; big += BigInt(m.value); }
    else if (m.status === 'UNKNOWN') unknownCount += 1;
    else overflowCount += 1;
  }
  const aggregateOverflow = big > MAX;
  const knownSubtotal = total(knownCount, big);
  const allObservedTotal = overflowCount > 0 || aggregateOverflow ? { status: 'OVERFLOW', value: null }
    : unknownCount > 0 ? { status: 'UNKNOWN', value: null } : knownSubtotal;
  return { observations: measurements.length, knownCount, unknownCount, overflowCount, aggregateOverflow,
    knownSubtotal, allObservedTotal };
}

function pairedSum(rows, offM, onM) {
  let completeCaseCount = 0, offBig = 0n, onBig = 0n, onLowerCount = 0, offLowerCount = 0, tieCount = 0;
  const excludedPairs = [];
  rows.forEach((row, i) => {
    const a = offM[i], b = onM[i];
    if (a.status !== 'KNOWN' || b.status !== 'KNOWN') {
      excludedPairs.push({ caseId: row.caseId, offStatus: a.status, onStatus: b.status }); return;
    }
    completeCaseCount += 1; offBig += BigInt(a.value); onBig += BigInt(b.value);
    if (b.value < a.value) onLowerCount += 1; else if (a.value < b.value) offLowerCount += 1; else tieCount += 1;
  });
  const offTotal = total(completeCaseCount, offBig), onTotal = total(completeCaseCount, onBig);
  // Both totals are nonnegative safe integers, so their difference is a safe signed integer.
  const deltaOnMinusOff = offTotal.status === 'KNOWN' && onTotal.status === 'KNOWN' ? onTotal.value - offTotal.value : null;
  return { completeCaseCount, excludedPairs, offTotal, onTotal, deltaOnMinusOff, onLowerCount, offLowerCount, tieCount };
}

function resource(rows, key) {
  const [offM, onM] = SIDES.map(s => rows.map(row => measure(row[s], key)));
  return { off: sideSum(offM), on: sideSum(onM), paired: pairedSum(rows, offM, onM) };
}

export function analyzePairedTrialV2(input) {
  // Schema/type refusals (including TRIAL_NUMBER on unsafe naturals) propagate unchanged.
  const rows = validatePairedTrialRowsV1(input);
  const outcomes = Object.fromEntries(SIDES.map(s => [s, outcomeSummary(rows.map(row => row[s]))]));
  const resources = Object.fromEntries(RESOURCES.map(k => [k, resource(rows, k)]));
  return freezeOwned({
    schemaVersion: 'nisi-paired-trial-analysis-v2', status: 'OBSERVED', pairCount: rows.length, rows,
    outcomes, resources,
    sourceTrust: 'UNVERIFIED', measurementVerified: false, causalClaim: false, authorizing: false,
  });
}
