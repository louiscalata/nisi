// PRIVATE trusted internal accounting. Based on SharedChami Qwen's reason and
// metric draft, corrected for arm selection, safe arithmetic and fractional rates.
// Caller supplies copied, closed-schema pairs. No inference or measurement here.
import { add } from './intake-v1.mjs';
export function summarizeValidatedPairs(pairs) {
  const reasons = [];
  for (const pair of pairs) {
    for (const arm of ['off', 'on']) {
      const data = pair[arm];
      if (!['PASS', 'FAIL'].includes(data.outcome)) reasons.push({ caseId: pair.caseId, arm, code: 'OUTCOME_INCOMPLETE' });
      if (data.tokenUsage === null) reasons.push({ caseId: pair.caseId, arm, code: 'TOKENS_UNKNOWN' });
      if (data.durationMs === null) reasons.push({ caseId: pair.caseId, arm, code: 'DURATION_UNKNOWN' });
      if (data.repairAttempts === null) reasons.push({ caseId: pair.caseId, arm, code: 'REPAIRS_UNKNOWN' });
    }
  }
  // No aggregate is computed from partially known observations.
  if (reasons.length > 0) return { status: 'INCOMPLETE', reasons, metrics: null };
  const empty = () => ({ accepted: 0, incorrectCompletions: 0, totalTokens: 0, totalDurationMs: 0, totalRepairs: 0 });
  const totals = { off: empty(), on: empty() };
  for (const pair of pairs) {
    for (const arm of ['off', 'on']) {
      const data = pair[arm], sum = totals[arm];
      sum.accepted = add(sum.accepted, data.outcome === 'PASS' ? 1 : 0);
      sum.incorrectCompletions = add(sum.incorrectCompletions, data.completionClaim && data.outcome === 'FAIL' ? 1 : 0);
      sum.totalTokens = add(sum.totalTokens, add(data.tokenUsage.input, data.tokenUsage.output));
      sum.totalDurationMs = add(sum.totalDurationMs, data.durationMs);
      sum.totalRepairs = add(sum.totalRepairs, data.repairAttempts);
    }
  }
  const delta = Object.fromEntries(Object.keys(totals.off).map(key => [key, totals.on[key] - totals.off[key]]));
  const savings = (off, on) => off === 0 ? null : 100 * (off - on) / off;
  return { status: 'COMPLETE', reasons, metrics: { pairs: pairs.length, ...totals, delta,
    savings: { tokensPercent: savings(totals.off.totalTokens, totals.on.totalTokens),
      durationPercent: savings(totals.off.totalDurationMs, totals.on.totalDurationMs) } } };
}
