// PRIVATE V3 consistency record for an ORIGINAL issued mixed-protocol live lane.
// Reopened JSON is data only: it does not recreate lane authority, inference, or execution.
import { cloneFreeze, stableStringify, sha256Text } from '../workflow/contracts.mjs';
import { exact } from '../integrity/record-utils.mjs';
import { readIssuedLiveModelLaneV3 } from '../hosts/repository/reviewed-live-model-v3.mjs';
import { readFinalEngineReportV2 } from './host-run-bundle-v2.mjs';
import { readRepositoryRunBundleV1 } from './repository-run-v1.mjs';
import { summarizeLiveUsage } from './live-usage-v1.mjs';
import { createRepositoryProposalV1 } from '../hosts/repository/proposed-changes-v1.mjs';

const hash = (domain, value) => sha256Text(domain + '\0' + stableStringify(value));
const same = (a, b) => stableStringify(a) === stableStringify(b);
const fail = code => { throw Object.assign(new Error(code), { code }); };
const isHash = value => typeof value === 'string' && value.length === 64 && /^[0-9a-f]{64}$/u.test(value);
const localBase = ['schemaVersion','outputMode','operation','adapterId','requestedModel','runId','taskFingerprint','attempt',
  'inputCandidateFingerprint','requestedMaxOutputTokens','requestSha256','elapsedMs','lifecycle','status','reportedModel',
  'resultCandidateFingerprint','usage'];
const nativeBase = ['schemaVersion','profile','operation','adapterId','requestedModel','expectedModelInstance','reasoning',
  'storeRequested','integrationsRequested','runId','taskFingerprint','attempt','inputCandidateFingerprint',
  'requestedMaxOutputTokens','requestSha256','elapsedMs','termination','serverCompletionAttested',
  'modelAuthenticityAttested','lifecycle','status','resultCandidateFingerprint','reportedModelInstance','usage'];
const lifecycleKeys = ['transportSettlement','remoteInferenceStopped','ownerState'];
const aggregateLifecycleKeys = ['state','pendingTransports','recoveryRequired','remoteInferenceStopped','scope','roles'];
const roleStatusKeys = ['schemaVersion','state','pendingTransports','recoveryRequired','remoteInferenceStopped','scope'];

function validateSelection(selection) {
  if (selection?.api === 'CHAT_COMPLETIONS') {
    exact(selection, ['api','endpoint','model','outputMode','adapterReceiptVersion'], 'LIVE_RUN_PROTOCOL_SCHEMA');
    if (selection.adapterReceiptVersion !== 2 || !['json_schema','json_instruction'].includes(selection.outputMode))
      fail('LIVE_RUN_PROTOCOL_SELECTION');
    return 'CHAT_COMPLETIONS';
  }
  if (selection?.api === 'NATIVE_API') {
    exact(selection, ['api','endpoint','model','expectedModelInstance','profile','reasoning','storeRequested',
      'integrationsRequested','adapterReceiptVersion'], 'LIVE_RUN_PROTOCOL_SCHEMA');
    if (selection.adapterReceiptVersion !== 'nisi-native-chat-receipt-v1' ||
        selection.profile !== 'nisi-native-chat-content-v1' || selection.reasoning !== 'off' ||
        selection.storeRequested !== false || !Array.isArray(selection.integrationsRequested) || selection.integrationsRequested.length)
      fail('LIVE_RUN_PROTOCOL_SELECTION');
    return 'NATIVE_API';
  }
  fail('LIVE_RUN_PROTOCOL_SELECTION');
}

function validateOwnerStatus(value, protocol) {
  exact(value, roleStatusKeys, 'LIVE_RUN_ROLE_LIFECYCLE');
  if ((protocol === 'CHAT_COMPLETIONS' ? value.schemaVersion !== 1 : value.schemaVersion !== 'nisi-native-chat-owner-v1') ||
      !['IDLE','BUSY','DRAINING','STOPPED','STOPPED_DRAINING','QUARANTINED'].includes(value.state) ||
      !Number.isSafeInteger(value.pendingTransports) || value.pendingTransports < 0 ||
      typeof value.recoveryRequired !== 'boolean' || value.remoteInferenceStopped !== 'NOT_OBSERVED' ||
      value.scope !== 'THIS_OWNER_ONLY') fail('LIVE_RUN_ROLE_LIFECYCLE');
}

function validateAggregateLifecycle(value, protocols) {
  exact(value, aggregateLifecycleKeys, 'LIVE_RUN_LANE_LIFECYCLE');
  exact(value.roles, ['author','reviewer'], 'LIVE_RUN_LANE_LIFECYCLE');
  if (!['IDLE','BUSY','STOPPED','DRAINING','QUARANTINED'].includes(value.state) ||
      !Number.isSafeInteger(value.pendingTransports) || value.pendingTransports < 0 ||
      typeof value.recoveryRequired !== 'boolean' || value.remoteInferenceStopped !== 'NOT_OBSERVED' ||
      value.scope !== 'THIS_LANE_ONLY') fail('LIVE_RUN_LANE_LIFECYCLE');
  validateOwnerStatus(value.roles.author, protocols.author);
  validateOwnerStatus(value.roles.reviewer, protocols.reviewer);
  const states = Object.values(value.roles).map(status => status.state);
  const expectedState = Object.values(value.roles).some(s => s.recoveryRequired) ? 'QUARANTINED'
    : states.some(state => ['STOPPED_DRAINING','DRAINING'].includes(state)) ? 'DRAINING'
      : states.includes('BUSY') ? 'BUSY'
        : states.includes('STOPPED') ? 'STOPPED' : states.every(state => state === 'IDLE') ? 'IDLE' : null;
  if (value.pendingTransports !== value.roles.author.pendingTransports + value.roles.reviewer.pendingTransports ||
      value.recoveryRequired !== (value.roles.author.recoveryRequired || value.roles.reviewer.recoveryRequired) ||
      value.state !== expectedState)
    fail('LIVE_RUN_LANE_LIFECYCLE');
}

function validateUsageSource(value) {
  exact(value, ['promptTokens','completionTokens','totalTokens'], 'LIVE_RUN_NATIVE_USAGE_SOURCE');
  if (value.promptTokens !== 'REPORTED_INPUT_TOKENS' || value.completionTokens !== 'REPORTED_TOTAL_OUTPUT_TOKENS' ||
      value.totalTokens !== 'DERIVED_SUM_OF_REPORTED_COUNTERS') fail('LIVE_RUN_NATIVE_USAGE_SOURCE');
}

function validateReportedStats(value, usage, maxOutputTokens) {
  const required = ['input_tokens','total_output_tokens','reasoning_output_tokens','tokens_per_second','time_to_first_token_seconds'];
  const keys = Object.keys(value ?? {}).sort();
  if (!same(keys, required.sort()) && !same(keys, [...required,'model_load_time_seconds'].sort())) fail('LIVE_RUN_NATIVE_STATS');
  summarizeLiveUsage([{ usage }]);
  if (![value.input_tokens, value.total_output_tokens, value.reasoning_output_tokens].every(n =>
      Number.isSafeInteger(n) && n >= 0 && !Object.is(n, -0)) ||
      usage.completionTokens === 0 || usage.completionTokens >= maxOutputTokens ||
      value.input_tokens !== usage.promptTokens || value.total_output_tokens !== usage.completionTokens ||
      value.reasoning_output_tokens !== 0) fail('LIVE_RUN_NATIVE_STATS');
  for (const key of ['tokens_per_second','time_to_first_token_seconds','model_load_time_seconds'])
    if (Object.hasOwn(value, key) && (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0))
      fail('LIVE_RUN_NATIVE_STATS');
}

function validateModelReceipt(receipt, role, selection, config, report, lane, reasons) {
  const operation = role === 'author' ? 'repair' : 'review';
  const inputFingerprint = role === 'author' ? lane.baselineCandidateFingerprint : lane.repairedCandidateFingerprint;
  const validated = receipt.status === 'RESPONSE_VALIDATED';
  if (!validated && receipt.status !== 'UNAVAILABLE') fail('LIVE_RUN_MODEL_STATUS');
  const protocol = validateSelection(selection);
  if (protocol === 'CHAT_COMPLETIONS') {
    exact(receipt, [...localBase, ...(validated ? ['candidateFingerprint','responseSha256','contentSha256'] : ['code'])], 'LIVE_RUN_MODEL_SCHEMA');
    if (receipt.schemaVersion !== 2 || receipt.outputMode !== selection.outputMode ||
        (validated && receipt.reportedModel !== selection.model) || (!validated && receipt.reportedModel !== null))
      fail('LIVE_RUN_PROTOCOL_RECEIPT');
  } else {
    exact(receipt, [...nativeBase, ...(validated
      ? ['responseSha256','contentSha256','usageSource','reportedStats','truncationCheck'] : ['code'])], 'LIVE_RUN_MODEL_SCHEMA');
    if (receipt.schemaVersion !== selection.adapterReceiptVersion || receipt.profile !== selection.profile ||
        receipt.expectedModelInstance !== selection.expectedModelInstance || receipt.reasoning !== selection.reasoning ||
        receipt.storeRequested !== false || !same(receipt.integrationsRequested, []) ||
        receipt.termination !== 'NOT_REPORTED' || receipt.serverCompletionAttested !== false ||
        receipt.modelAuthenticityAttested !== false) fail('LIVE_RUN_PROTOCOL_RECEIPT');
    if (validated) {
      if (receipt.reportedModelInstance !== selection.expectedModelInstance || receipt.truncationCheck !== 'BELOW_REPORTED_OUTPUT_CAP' ||
          receipt.usage === null) fail('LIVE_RUN_MODEL_RESPONSE');
      validateUsageSource(receipt.usageSource);
      validateReportedStats(receipt.reportedStats, receipt.usage, config.maxOutputTokens);
    } else if (receipt.reportedModelInstance !== null || receipt.usage !== null) fail('LIVE_RUN_PROTOCOL_RECEIPT');
  }
  exact(receipt.lifecycle, lifecycleKeys, 'LIVE_RUN_MODEL_LIFECYCLE');
  if (receipt.operation !== operation || receipt.adapterId !== config[role + 'Id'] || receipt.requestedModel !== selection.model ||
      receipt.runId !== report.runId || receipt.taskFingerprint !== report.taskFingerprint || receipt.attempt !== 1 ||
      receipt.inputCandidateFingerprint !== inputFingerprint || receipt.requestedMaxOutputTokens !== config.maxOutputTokens ||
      !Number.isSafeInteger(receipt.elapsedMs) || receipt.elapsedMs < 0 || Object.is(receipt.elapsedMs, -0)) fail('LIVE_RUN_MODEL_BINDING');
  if (validated) {
    if (!['requestSha256','responseSha256','contentSha256'].every(key => isHash(receipt[key])) ||
        (protocol === 'CHAT_COMPLETIONS' && receipt.candidateFingerprint !== receipt.resultCandidateFingerprint))
      fail('LIVE_RUN_MODEL_RESPONSE');
    if (receipt.resultCandidateFingerprint !== lane.repairedCandidateFingerprint) reasons.push('MODEL_CANDIDATE_NOT_ADMITTED');
  } else {
    if (typeof receipt.code !== 'string' || !/^[A-Z][A-Z0-9_]{0,95}$/u.test(receipt.code) ||
        receipt.resultCandidateFingerprint !== null || receipt.usage !== null ||
        !(receipt.requestSha256 === null || isHash(receipt.requestSha256))) fail('LIVE_RUN_MODEL_REFUSAL');
    reasons.push('MODEL_RESPONSE_UNAVAILABLE');
  }
  if (!['CONFIRMED', 'UNKNOWN', 'NOT_STARTED'].includes(receipt.lifecycle.transportSettlement) ||
      !['IDLE', 'BUSY', 'DRAINING', 'STOPPED', 'STOPPED_DRAINING', 'QUARANTINED'].includes(receipt.lifecycle.ownerState)) fail('LIVE_RUN_MODEL_LIFECYCLE');
  if (receipt.lifecycle.transportSettlement !== 'CONFIRMED') reasons.push('MODEL_TRANSPORT_UNCONFIRMED');
  if (receipt.lifecycle.remoteInferenceStopped !== 'NOT_OBSERVED') fail('LIVE_RUN_REMOTE_STOP_CLAIM');
}

// Pure evidence inspection, deliberately separate from ORIGINAL-issued lane authority.
// Caller-supplied context can establish consistency only, never that a model ran.
export function inspectLiveModelCallV3(input) {
  const v = cloneFreeze(input);
  exact(v, ['receipt', 'role', 'configuration', 'runId', 'taskFingerprint',
    'baselineCandidateFingerprint', 'repairedCandidateFingerprint'], 'LIVE_CALL_CONTEXT');
  if (!['author', 'reviewer'].includes(v.role) ||
      ![v.taskFingerprint, v.baselineCandidateFingerprint, v.repairedCandidateFingerprint].every(isHash)) fail('LIVE_CALL_CONTEXT');
  const reasons = [];
  validateModelReceipt(v.receipt, v.role, v.configuration[v.role], v.configuration,
    { runId: v.runId, taskFingerprint: v.taskFingerprint }, v, reasons);
  return cloneFreeze({ reasons, usage: summarizeLiveUsage([v.receipt]), consistencyOnly: true, authorizing: false });
}

function derive(input) {
  exact(input, ['lane','hostResult'], 'LIVE_RUN_CONTEXT');
  const { suite, preparations, snapshot: lane } = readIssuedLiveModelLaneV3(input.lane);
  const host = input.hostResult;
  exact(host, ['schemaVersion','report','invocations','staticHistory','testHistory','settlementErrors','historyErrors','ownerStateErrors',
    'ownerStates','state','bundle','bundleSummary','bundleError','proposedChanges','applied','sandboxed','authorizing','certificationGranted'], 'LIVE_RUN_HOST_SCHEMA');
  if (host.schemaVersion !== 'nisi-reviewed-repository-host-v1' ||
      ['applied','sandboxed','authorizing','certificationGranted'].some(key => host[key] !== false)) fail('LIVE_RUN_HOST_CLAIM');
  const report = readFinalEngineReportV2(host.report), config = lane.configuration;
  const protocols = { author: validateSelection(config.author), reviewer: validateSelection(config.reviewer) };
  if (!['LOOPBACK_HTTP','INJECTED_TEST_TRANSPORT'].includes(config.transportKind)) fail('LIVE_RUN_TRANSPORT_KIND');
  validateAggregateLifecycle(lane.lifecycle, protocols);
  if (report.runId !== lane.runId || report.taskFingerprint !== config.taskFingerprint) fail('LIVE_RUN_BINDING');
  const task = preparations[0].task;
  if (report.taskId !== task.taskId || report.mode !== task.mode) fail('LIVE_RUN_TASK_METADATA');
  const reasons = [];
  if (host.bundle === null || host.bundleError !== null) reasons.push('HOST_BUNDLE_UNAVAILABLE');
  let hostSummary = null, preparation = null;
  if (host.bundle !== null && host.bundleError === null) {
    preparation = preparations.find(item => item.candidateFingerprint === report.candidateFingerprint);
    hostSummary = readRepositoryRunBundleV1(host.bundle, { report, preparation, suite,
      nodeRegistrationFingerprint: host.bundleSummary?.nodeRegistrationFingerprint,
      plans: host.staticHistory.map(item => item.plan), groups: host.staticHistory.map(item => item.group),
      executions: host.testHistory.map(item => item.execution) });
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
  if (lane.phase !== 'REVIEWED' || lane.revoked || lane.lifecycle.state !== 'IDLE' || lane.lifecycle.pendingTransports !== 0 ||
      lane.lifecycle.recoveryRequired || Object.values(lane.lifecycle.roles).some(status => status.state !== 'IDLE')) reasons.push('MODEL_LANE_NOT_READY');

  const inventory = [...lane.authorReceipts, ...lane.reviewerReceipts];
  if (lane.authorReceipts.length > 1 || lane.reviewerReceipts.length > 1) fail('LIVE_RUN_MODEL_INVENTORY');
  if (lane.authorReceipts.length !== 1 || lane.reviewerReceipts.length !== 1) reasons.push('MODEL_INVENTORY_INCOMPLETE');
  for (const [role, receipts] of [['author',lane.authorReceipts],['reviewer',lane.reviewerReceipts]])
    for (const receipt of receipts) {
      const inspected = inspectLiveModelCallV3({ receipt, role, configuration: config, runId: report.runId,
        taskFingerprint: report.taskFingerprint, baselineCandidateFingerprint: lane.baselineCandidateFingerprint,
        repairedCandidateFingerprint: lane.repairedCandidateFingerprint });
      reasons.push(...inspected.reasons);
    }

  const stages = report.stages;
  if (report.outcome === 'COMPLETED') {
    const topology = ['intake','authorizeContext','draft','staticChecks','tests','repair','staticChecks','tests','review'];
    const statuses = ['PASS','PASS','PASS','PASS','FAIL','REPAIRED','PASS','PASS','PASS'];
    if (!same(stages.map(stage => stage.stage), topology) || stages.some((stage, index) => stage.status !== statuses[index] || stage.code !== null))
      fail('LIVE_RUN_STAGE_TOPOLOGY');
    for (const [index, stage] of stages.entries()) {
      const candidate = index < 2 ? null : index < 5 ? lane.baselineCandidateFingerprint : lane.repairedCandidateFingerprint;
      const binding = { schemaVersion: 1, runId: report.runId, taskFingerprint: report.taskFingerprint,
        attempt: index < 5 ? 0 : 1, candidateFingerprint: candidate };
      if (stage.candidateFingerprint !== candidate || Object.keys(binding).some(key => stage.evidence[key] !== binding[key]))
        fail('LIVE_RUN_STAGE_BINDING');
      if (index === 0 && !same(stage.evidence, { ...binding, taskId: task.taskId, mode: task.mode,
        acceptanceCriteriaCount: task.acceptanceCriteria.length })) fail('LIVE_RUN_INTAKE_EVIDENCE');
      if (index === 1 && !same(stage.evidence, { ...binding, reason: '' })) fail('LIVE_RUN_AUTHORIZATION_EVIDENCE');
      if (index === 2 && !same(stage.evidence, { ...binding,
        note: 'Host-seeded source-reviewed baseline. No model draft occurred.' })) fail('LIVE_RUN_SEED_EVIDENCE');
    }
  }
  const draft = stages.filter(stage => stage.stage === 'draft');
  const repairs = stages.filter(stage => stage.stage === 'repair');
  const reviews = stages.filter(stage => stage.stage === 'review');
  const tests = stages.filter(stage => stage.stage === 'tests');
  if (draft.length !== 1 || draft[0].status !== 'PASS' || draft[0].candidateFingerprint !== lane.baselineCandidateFingerprint ||
      !draft[0].evidence.note?.includes('No model draft occurred.')) reasons.push('HOST_SEED_NOT_RECORDED');
  if (repairs.length !== 1 || repairs[0].status !== 'REPAIRED' || repairs[0].evidence.baseCandidateFingerprint !== lane.baselineCandidateFingerprint ||
      repairs[0].candidateFingerprint !== lane.repairedCandidateFingerprint) reasons.push('REPAIR_NOT_RECORDED');
  if (reviews.length !== 1 || reviews[0].status !== 'PASS' || reviews[0].evidence.reviewerId !== config.reviewerId ||
      reviews[0].candidateFingerprint !== lane.repairedCandidateFingerprint) reasons.push('REVIEW_NOT_RECORDED');
  if (tests.length !== 2 || tests[0].status !== 'FAIL' || tests[1].status !== 'PASS' ||
      tests[0].candidateFingerprint !== lane.baselineCandidateFingerprint || tests[1].candidateFingerprint !== lane.repairedCandidateFingerprint)
    reasons.push('BASELINE_FAILURE_AND_FRESH_PASS_NOT_RECORDED');
  if (!same(lane.events.map(event => event.stage), ['authorizeContext','hostSeed','repair','review']) ||
      lane.events.some(event => event.status === 'UNAVAILABLE')) reasons.push('LANE_SEQUENCE_INCOMPLETE');
  if (lane.returnedResults.length !== 2 || lane.returnedResults[0].operation !== 'repair' || lane.returnedResults[1].operation !== 'review')
    reasons.push('RETURNED_MODEL_RESULTS_INCOMPLETE');
  for (const { operation, result } of lane.returnedResults) {
    if (stages.filter(stage => stage.stage === operation && stage.status === result.status && same(stage.evidence, result.evidence)).length !== 1)
      reasons.push('MODEL_RESULT_NOT_RECORDED');
    if (operation === 'repair' && result.status === 'REPAIRED' && report.outcome === 'COMPLETED' &&
        !same(result.candidate.files, report.candidate.files)) fail('LIVE_RUN_REPAIRED_SOURCE_MISMATCH');
  }
  const usage = summarizeLiveUsage(inventory);
  const identity = cloneFreeze({ schemaVersion: 'nisi-repository-live-model-run-v3',
    status: reasons.length ? 'INCOMPLETE' : config.transportKind === 'LOOPBACK_HTTP' ? 'SCOPED_LIVE_REPAIR_REVIEW_PASS' : 'SYNTHETIC_CONTRACT_PASS',
    reasons: [...new Set(reasons)], runId: report.runId, taskFingerprint: report.taskFingerprint,
    finalCandidateFingerprint: report.candidateFingerprint, reportSha256: hash('nisi/repository-final-report/v1', report),
    repositoryBundleFingerprint: hostSummary?.fingerprint ?? null, lane, usage,
    usageProvenance: { aggregateTotals: usage.totals === null ? null : 'DERIVED_SUM_OF_VALIDATED_CALL_COUNTERS', measurementsVerified: false,
      roles: ['author', 'reviewer'].map(role => ({ role, api: config[role].api,
        totalTokensSource: lane[role + 'Receipts'][0]?.usage == null ? null : config[role].api === 'NATIVE_API'
          ? 'DERIVED_SUM_OF_REPORTED_COUNTERS' : 'REPORTED_TOTAL_TOKENS' })) },
    nativeCompletion: { roles: ['author', 'reviewer'].filter(role => config[role].api === 'NATIVE_API'),
      termination: 'NOT_REPORTED', serverCompletionAttested: false }, hostSeedInference: false,
    modelAuthenticityAttested: false, executionAttested: false, causalClaim: false, authorizing: false,
    certificationGranted: false, publicationAuthorized: false });
  return cloneFreeze({ ...identity, fingerprint: hash('nisi/repository-live-model-run/v3', identity) });
}

export function createRepositoryLiveModelRunV3(input) { return derive(input); }
export function readRepositoryLiveModelRunV3(value, context) {
  const expected = derive(context);
  if (!same(cloneFreeze(value), expected)) fail('LIVE_RUN_RECORD_MISMATCH');
  return expected;
}
