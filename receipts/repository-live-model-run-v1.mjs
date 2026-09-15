// PRIVATE consistency record for an ORIGINAL issued live lane and host result.
// Reopening JSON does not recreate authority, model authenticity or execution.
import { cloneFreeze, stableStringify, sha256Text } from '../workflow/contracts.mjs';
import { exact } from '../integrity/record-utils.mjs';
import { readIssuedLiveModelLaneV1, readIssuedLiveModelLaneV2 } from '../hosts/repository/reviewed-live-model-v1.mjs';
import { readFinalEngineReportV2 } from './host-run-bundle-v2.mjs';
import { readRepositoryRunBundleV1 } from './repository-run-v1.mjs';
import { summarizeLiveUsage } from './live-usage-v1.mjs';
import { createRepositoryProposalV1 } from '../hosts/repository/proposed-changes-v1.mjs';

const hash = (domain, value) => sha256Text(domain + '\0' + stableStringify(value));
const same = (a, b) => stableStringify(a) === stableStringify(b);
const fail = code => { throw Object.assign(new Error(code), { code }); };
const isHash = value => typeof value === 'string' && value.length === 64 && /^[0-9a-f]+$/u.test(value);
const modelBaseKeys = ['schemaVersion','operation','adapterId','requestedModel','runId','taskFingerprint','attempt',
  'inputCandidateFingerprint','requestedMaxOutputTokens','requestSha256','elapsedMs','lifecycle','status','reportedModel','resultCandidateFingerprint','usage'];

function derive(input, version = 1) {
  exact(input, ['lane', 'hostResult'], 'LIVE_RUN_CONTEXT');
  const { suite, preparations, snapshot: lane } = (version === 2 ? readIssuedLiveModelLaneV2 : readIssuedLiveModelLaneV1)(input.lane);
  const host = input.hostResult;
  exact(host, ['schemaVersion','report','invocations','staticHistory','testHistory','settlementErrors','historyErrors','ownerStateErrors',
    'ownerStates','state','bundle','bundleSummary','bundleError','proposedChanges','applied','sandboxed','authorizing','certificationGranted'], 'LIVE_RUN_HOST_SCHEMA');
  if (host.schemaVersion !== 'nisi-reviewed-repository-host-v1' ||
      ['applied','sandboxed','authorizing','certificationGranted'].some(k => host[k] !== false)) fail('LIVE_RUN_HOST_CLAIM');
  const report = readFinalEngineReportV2(host.report), config = lane.configuration;
  if (report.runId !== lane.runId || report.taskFingerprint !== config.taskFingerprint) fail('LIVE_RUN_BINDING');
  const task = preparations[0].task;
  if (report.taskId !== task.taskId || report.mode !== task.mode) fail('LIVE_RUN_TASK_METADATA');
  const reasons = [];
  if (host.bundle === null || host.bundleError !== null) reasons.push('HOST_BUNDLE_UNAVAILABLE');
  let hostSummary = null, preparation = null;
  if (host.bundle !== null && host.bundleError === null) {
    preparation = preparations.find(p => p.candidateFingerprint === report.candidateFingerprint);
    hostSummary = readRepositoryRunBundleV1(host.bundle, { report, preparation, suite,
      nodeRegistrationFingerprint: host.bundleSummary?.nodeRegistrationFingerprint,
      plans: host.staticHistory.map(h => h.plan), groups: host.staticHistory.map(h => h.group), executions: host.testHistory.map(h => h.execution) });
    if (!same(hostSummary, host.bundleSummary)) fail('LIVE_RUN_HOST_SUMMARY');
  }
  for (const key of ['settlementErrors','historyErrors','ownerStateErrors']) {
    if (!Array.isArray(host[key]) || host[key].length !== 2) fail('LIVE_RUN_HOST_DIAGNOSTICS');
    if (host[key].some(value => value !== null)) reasons.push('HOST_DIAGNOSTICS_UNAVAILABLE');
  }
  if (host.state !== 'SETTLED' || host.ownerStates?.staticChecks !== 'IDLE' || host.ownerStates?.tests !== 'IDLE') reasons.push('HOST_NOT_SETTLED');
  if (!host.proposedChanges || !hostSummary) reasons.push('HOST_PROPOSAL_UNAVAILABLE');
  else if (!same(host.proposedChanges, createRepositoryProposalV1({ preparation, report, bundleSummary: hostSummary }))) fail('LIVE_RUN_HOST_PROPOSAL');
  if (report.outcome !== 'COMPLETED' || report.workflowOutcome !== 'COMPLETED' || report.code !== null ||
      report.repairAttempts !== 1 || report.candidateFingerprint !== lane.repairedCandidateFingerprint) reasons.push('WORKFLOW_NOT_COMPLETED');
  if (lane.phase !== 'REVIEWED' || lane.revoked || lane.lifecycle.state !== 'IDLE' || lane.lifecycle.pendingTransports !== 0 || lane.lifecycle.recoveryRequired)
    reasons.push('MODEL_LANE_NOT_READY');

  const inventory = [...lane.authorReceipts, ...lane.reviewerReceipts];
  if (lane.authorReceipts.length > 1 || lane.reviewerReceipts.length > 1) fail('LIVE_RUN_MODEL_INVENTORY');
  if (lane.authorReceipts.length !== 1 || lane.reviewerReceipts.length !== 1) reasons.push('MODEL_INVENTORY_INCOMPLETE');
  for (const [role, receipts] of [['author', lane.authorReceipts], ['reviewer', lane.reviewerReceipts]]) for (const r of receipts) {
    const operation = role === 'author' ? 'repair' : 'review';
    const validated = r.status === 'RESPONSE_VALIDATED';
    if (!validated && r.status !== 'UNAVAILABLE') fail('LIVE_RUN_MODEL_STATUS');
    exact(r, [...modelBaseKeys, ...(version === 2 ? ['outputMode'] : []), ...(validated ? ['candidateFingerprint','responseSha256','contentSha256'] : ['code'])], 'LIVE_RUN_MODEL_SCHEMA');
    exact(r.lifecycle, ['transportSettlement','remoteInferenceStopped','ownerState'], 'LIVE_RUN_MODEL_LIFECYCLE');
    if (r.schemaVersion !== version || (version === 2 && r.outputMode !== config[role + 'OutputMode']) ||
        r.operation !== operation || r.adapterId !== config[role + 'Id'] ||
        r.requestedModel !== config[role + 'Model'] || r.runId !== report.runId || r.taskFingerprint !== report.taskFingerprint || r.attempt !== 1 ||
        r.inputCandidateFingerprint !== (role === 'author' ? lane.baselineCandidateFingerprint : lane.repairedCandidateFingerprint) ||
        r.requestedMaxOutputTokens !== config.maxOutputTokens || !Number.isSafeInteger(r.elapsedMs) || r.elapsedMs < 0) fail('LIVE_RUN_MODEL_BINDING');
    if (validated) {
      if (r.reportedModel !== r.requestedModel || !['requestSha256','responseSha256','contentSha256'].every(k => isHash(r[k])) ||
          r.candidateFingerprint !== r.resultCandidateFingerprint) fail('LIVE_RUN_MODEL_RESPONSE');
      if (r.resultCandidateFingerprint !== lane.repairedCandidateFingerprint) reasons.push('MODEL_CANDIDATE_NOT_ADMITTED');
    } else reasons.push('MODEL_RESPONSE_UNAVAILABLE');
    if (r.lifecycle.transportSettlement !== 'CONFIRMED') reasons.push('MODEL_TRANSPORT_UNCONFIRMED');
    if (r.lifecycle.remoteInferenceStopped !== 'NOT_OBSERVED') fail('LIVE_RUN_REMOTE_STOP_CLAIM');
  }
  const stages = report.stages;
  if (report.outcome === 'COMPLETED') {
    // This deliberately narrow demonstration has one exact successful topology.
    // Correlating independently filtered arrays cannot prove their ordering.
    const topology = ['intake','authorizeContext','draft','staticChecks','tests','repair','staticChecks','tests','review'];
    const statuses = ['PASS','PASS','PASS','PASS','FAIL','REPAIRED','PASS','PASS','PASS'];
    if (!same(stages.map(s => s.stage), topology) || stages.some((s, i) => s.status !== statuses[i] || s.code !== null)) fail('LIVE_RUN_STAGE_TOPOLOGY');
    for (const [i, stage] of stages.entries()) {
      const candidate = i < 2 ? null : i < 5 ? lane.baselineCandidateFingerprint : lane.repairedCandidateFingerprint;
      const binding = { schemaVersion: 1, runId: report.runId, taskFingerprint: report.taskFingerprint,
        attempt: i < 5 ? 0 : 1, candidateFingerprint: candidate };
      if (stage.candidateFingerprint !== candidate || Object.keys(binding).some(k => stage.evidence[k] !== binding[k])) fail('LIVE_RUN_STAGE_BINDING');
      if (i === 0 && !same(stage.evidence, { ...binding, taskId: task.taskId, mode: task.mode,
        acceptanceCriteriaCount: task.acceptanceCriteria.length })) fail('LIVE_RUN_INTAKE_EVIDENCE');
      if (i === 1 && !same(stage.evidence, { ...binding, reason: '' })) fail('LIVE_RUN_AUTHORIZATION_EVIDENCE');
      if (i === 2 && !same(stage.evidence, { ...binding,
        note: 'Host-seeded source-reviewed baseline. No model draft occurred.' })) fail('LIVE_RUN_SEED_EVIDENCE');
    }
  }
  const draft = stages.filter(s => s.stage === 'draft'), repairs = stages.filter(s => s.stage === 'repair'), reviews = stages.filter(s => s.stage === 'review');
  const tests = stages.filter(s => s.stage === 'tests');
  if (draft.length !== 1 || draft[0].status !== 'PASS' || draft[0].candidateFingerprint !== lane.baselineCandidateFingerprint ||
      !draft[0].evidence.note?.includes('No model draft occurred.')) reasons.push('HOST_SEED_NOT_RECORDED');
  if (repairs.length !== 1 || repairs[0].status !== 'REPAIRED' || repairs[0].evidence.baseCandidateFingerprint !== lane.baselineCandidateFingerprint ||
      repairs[0].candidateFingerprint !== lane.repairedCandidateFingerprint) reasons.push('REPAIR_NOT_RECORDED');
  if (reviews.length !== 1 || reviews[0].status !== 'PASS' || reviews[0].evidence.reviewerId !== config.reviewerId ||
      reviews[0].candidateFingerprint !== lane.repairedCandidateFingerprint) reasons.push('REVIEW_NOT_RECORDED');
  if (tests.length !== 2 || tests[0].status !== 'FAIL' || tests[1].status !== 'PASS' ||
      tests[0].candidateFingerprint !== lane.baselineCandidateFingerprint || tests[1].candidateFingerprint !== lane.repairedCandidateFingerprint)
    reasons.push('BASELINE_FAILURE_AND_FRESH_PASS_NOT_RECORDED');
  const expectedStages = ['authorizeContext','hostSeed','repair','review'];
  if (!same(lane.events.map(e => e.stage), expectedStages) || lane.events.some(e => e.status === 'UNAVAILABLE')) reasons.push('LANE_SEQUENCE_INCOMPLETE');
  if (lane.returnedResults.length !== 2 || lane.returnedResults[0].operation !== 'repair' || lane.returnedResults[1].operation !== 'review')
    reasons.push('RETURNED_MODEL_RESULTS_INCOMPLETE');
  for (const { operation, result } of lane.returnedResults) {
    const recorded = stages.filter(s => s.stage === operation && s.status === result.status && same(s.evidence, result.evidence));
    if (recorded.length !== 1) reasons.push('MODEL_RESULT_NOT_RECORDED');
    if (operation === 'repair' && result.status === 'REPAIRED' && report.outcome === 'COMPLETED' &&
        !same(result.candidate.files, report.candidate.files)) fail('LIVE_RUN_REPAIRED_SOURCE_MISMATCH');
  }
  const usage = summarizeLiveUsage(inventory);
  const identity = cloneFreeze({ schemaVersion: `nisi-repository-live-model-run-v${version}`,
    status: reasons.length ? 'INCOMPLETE' : config.transportKind === 'LOOPBACK_HTTP' ? 'SCOPED_LIVE_REPAIR_REVIEW_PASS' : 'SYNTHETIC_CONTRACT_PASS',
    reasons: [...new Set(reasons)], runId: report.runId, taskFingerprint: report.taskFingerprint,
    finalCandidateFingerprint: report.candidateFingerprint, reportSha256: hash('nisi/repository-final-report/v1', report),
    repositoryBundleFingerprint: hostSummary?.fingerprint ?? null, lane, usage,
    hostSeedInference: false, modelAuthenticityAttested: false, executionAttested: false, causalClaim: false,
    authorizing: false, certificationGranted: false, publicationAuthorized: false });
  return cloneFreeze({ ...identity, fingerprint: hash(`nisi/repository-live-model-run/v${version}`, identity) });
}
export function createRepositoryLiveModelRunV1(input) { return derive(input); }
export function readRepositoryLiveModelRunV1(value, context) {
  const expected = derive(context);
  if (!same(cloneFreeze(value), expected)) fail('LIVE_RUN_RECORD_MISMATCH');
  return expected;
}
export function createRepositoryLiveModelRunV2(input) { return derive(input, 2); }
export function readRepositoryLiveModelRunV2(value, context) {
  const expected = derive(context, 2);
  if (!same(cloneFreeze(value), expected)) fail('LIVE_RUN_RECORD_MISMATCH');
  return expected;
}
