// Deliberate isolated arithmetic mutant: an oversized finite duration aggregate
// is incorrectly retained instead of becoming unknown (null).
import { buildUsageTable as acceptedBuild } from '../../../../../packs/usage-table/src/index.mjs';

export function buildUsageTable(input) {
  const result = acceptedBuild(input);
  if (result.status === 'READY' && result.rows.some(row => row.durationMs === Number.MAX_VALUE)) {
    return { ...result, totals: { ...result.totals, durationMs: Number.MAX_VALUE } };
  }
  return result;
}
