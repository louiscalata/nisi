// PRIVATE matched OFF/ON accounting contract. Records are supplied by a trusted
// host; hashes correlate inputs/results, not authenticity, causality or authority.
// No model, process, network or storage work occurs here.
import { record, list, natural } from './intake-v1.mjs';
import { summarizeValidatedPairs } from './metrics-v1.mjs';

const fail = code => { throw Object.assign(new Error(code), { code }); };
const pairKeys = ['caseId', 'taskSha256', 'baselineSha256', 'oracleSha256', 'off', 'on'];
const sideKeys = ['runId', 'model', 'modelSettingsSha256', 'toolchainSha256', 'resourceBudgetSha256',
  'candidateSha256', 'oracleCandidateSha256', 'outcome', 'completionClaim', 'tokenUsage', 'durationMs', 'repairAttempts'];
const settings = ['model', 'modelSettingsSha256', 'toolchainSha256', 'resourceBudgetSha256'];
function identifier(value) {
  // Require the entire match: JS `$` alone also matches before a final LF.
  if (typeof value !== 'string' || /^[a-z][a-z0-9_.-]{0,95}$/u.exec(value)?.[0] !== value) fail('TRIAL_IDENTIFIER');
}
function digest(value) {
  if (typeof value !== 'string' || value.length !== 64 || !/^[a-f0-9]{64}$/u.test(value)) fail('TRIAL_DIGEST');
}
function side(input, runIds) {
  const out = record(input, sideKeys); identifier(out.runId);
  if (runIds.has(out.runId)) fail('TRIAL_DUPLICATE_RUN'); runIds.add(out.runId);
  if (typeof out.model !== 'string' || !out.model.isWellFormed() || out.model.length === 0 ||
      out.model.trim() !== out.model || out.model.includes('\0') || Buffer.byteLength(out.model, 'utf8') > 200) fail('TRIAL_MODEL');
  for (const key of ['modelSettingsSha256', 'toolchainSha256', 'resourceBudgetSha256', 'candidateSha256', 'oracleCandidateSha256']) digest(out[key]);
  if (out.candidateSha256 !== out.oracleCandidateSha256) fail('TRIAL_STALE_ORACLE');
  if (!['PASS', 'FAIL', 'NOT_RUN', 'ERROR', 'INCONCLUSIVE'].includes(out.outcome)) fail('TRIAL_OUTCOME');
  if (typeof out.completionClaim !== 'boolean') fail('TRIAL_COMPLETION_CLAIM');
  if (out.tokenUsage !== null) {
    out.tokenUsage = record(out.tokenUsage, ['input', 'output']);
    natural(out.tokenUsage.input); natural(out.tokenUsage.output);
  }
  if (out.durationMs !== null) natural(out.durationMs);
  if (out.repairAttempts !== null) natural(out.repairAttempts);
  return out;
}
// Only newly constructed, schema-bounded, acyclic plain data reaches this helper.
// Recursion precedes freezing, so no configurable-property test skips children.
function freezeOwned(value) {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeOwned(child);
    Object.freeze(value);
  }
  return value;
}
export function validatePairedTrialV1(input) {
  const top = record(input, ['schemaVersion', 'pairs']);
  if (top.schemaVersion !== 'nisi-paired-trial-v1') fail('TRIAL_SCHEMA');
  const values = list(top.pairs, 1, 256), caseIds = new Set(), runIds = new Set();
  const rows = values.map(value => {
    const pair = record(value, pairKeys); identifier(pair.caseId);
    if (caseIds.has(pair.caseId)) fail('TRIAL_DUPLICATE_CASE'); caseIds.add(pair.caseId);
    for (const key of ['taskSha256', 'baselineSha256', 'oracleSha256']) digest(pair[key]);
    pair.off = side(pair.off, runIds); pair.on = side(pair.on, runIds);
    if (settings.some(key => pair.off[key] !== pair.on[key])) fail('TRIAL_UNMATCHED_CONFIGURATION');
    return pair;
  });
  const { status, reasons, metrics } = summarizeValidatedPairs(rows);
  return freezeOwned({ schemaVersion: 'nisi-paired-trial-analysis-v1', status, pairCount: rows.length, rows, reasons, metrics,
    measurementVerified: false, causalClaim: false, authorizing: false });
}
