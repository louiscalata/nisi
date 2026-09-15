// PRIVATE pure structured diff, based on a Fable 5.1 draft reviewed by Codex.
// Summary/report are trusted host inputs, not authenticity or application grants.
import { cloneFreeze, stableStringify, sha256Text, RUN_OUTCOMES } from '../../workflow/contracts.mjs';
import { exact } from '../../integrity/record-utils.mjs';
import { isIssuedRepositoryPreparation } from './snapshot-contract.mjs';

const fail = code => { throw Object.assign(new Error(code), { code }); };
const same = (a, b) => typeof a === 'string' && a.length > 0 && a === b;
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const snap = f => ({ content: f.content, sha256: f.sha256, byteLength: f.byteLength });
// Fable 5.1 linkage draft: correlation with the exact evidence, not authority.
function linkEvidence(report, bundleSummary) {
  const { fingerprint, reportSha256 } = bundleSummary;
  if (typeof fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(fingerprint) ||
      typeof reportSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(reportSha256) ||
      reportSha256 !== sha256Text('nisi/repository-final-report/v1\0' + stableStringify(report))) fail('PROPOSAL_EVIDENCE_LINKAGE');
  return { bundleFingerprint: fingerprint, reportSha256 };
}
export function createRepositoryProposalV1(input) {
  exact(input, ['preparation', 'report', 'bundleSummary'], 'PROPOSAL_SCHEMA');
  const { preparation: prep, report, bundleSummary: sum } = input;
  if (!isIssuedRepositoryPreparation(prep)) fail('PROPOSAL_PREPARATION_NOT_ISSUED');
  if (!object(report) || !object(sum) || !RUN_OUTCOMES.includes(report.outcome) || !RUN_OUTCOMES.includes(report.workflowOutcome) ||
      !(report.code === null || typeof report.code === 'string') || !(report.reportStoreCode === null || typeof report.reportStoreCode === 'string') ||
      typeof sum.finalChecksRecordedPass !== 'boolean') fail('PROPOSAL_INPUT_INVALID');
  if (!same(report.taskFingerprint, prep.taskFingerprint) || !same(sum.taskFingerprint, prep.taskFingerprint)) fail('PROPOSAL_TASK_MISMATCH');
  if (!same(report.candidateFingerprint, prep.candidateFingerprint) || !same(sum.candidateFingerprint, prep.candidateFingerprint)) fail('PROPOSAL_CANDIDATE_MISMATCH');
  if (!same(sum.preparationFingerprint, prep.fingerprint) || !same(sum.baselineFingerprint, prep.baselineFingerprint) ||
      !same(sum.materializedFingerprint, prep.materializedFingerprint)) fail('PROPOSAL_PREPARATION_MISMATCH');
  if (!same(sum.runId, report.runId)) fail('PROPOSAL_RUN_MISMATCH');
  if (sum.status !== 'CONSISTENT') fail('PROPOSAL_SUMMARY_INCONSISTENT');
  if (report.outcome !== sum.outcome || report.workflowOutcome !== sum.workflowOutcome || report.code !== sum.code ||
      report.reportStoreCode !== sum.reportStoreCode) fail('PROPOSAL_OUTCOME_MISMATCH');
  const completed = report.outcome === 'COMPLETED' && report.workflowOutcome === 'COMPLETED';
  if (completed && (!object(report.candidate) || stableStringify(report.candidate) !== stableStringify(prep.candidate))) fail('PROPOSAL_CANDIDATE_MISMATCH');
  if (!completed || report.code !== null || report.reportStoreCode !== null || !sum.finalChecksRecordedPass) return null;
  const evidence = linkEvidence(report, sum);
  const baseline = new Map(prep.baseline.files.map(f => [f.path, f])), changes = [];
  for (const file of prep.materialized.files) {
    const before = baseline.get(file.path);
    if (before === undefined) changes.push({ path: file.path, kind: 'ADD', before: null, after: snap(file) });
    else if (before.content !== file.content) changes.push({ path: file.path, kind: 'MODIFY', before: snap(before), after: snap(file) });
  }
  changes.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const body = { schemaVersion: 'nisi-proposed-changes-v1', runId: report.runId, taskFingerprint: prep.taskFingerprint,
    candidateFingerprint: prep.candidateFingerprint, preparationFingerprint: prep.fingerprint,
    baselineFingerprint: prep.baselineFingerprint, materializedFingerprint: prep.materializedFingerprint,
    ...evidence, changes, applied: false, authorizing: false };
  return cloneFreeze({ ...body, fingerprint: sha256Text('nisi/proposed-changes/v1\0' + stableStringify(body)) });
}
