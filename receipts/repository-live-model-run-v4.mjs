// PRIVATE V4 consistency record for an ORIGINAL issued mixed-protocol live lane.
// Reopened JSON is data only: it does not recreate lane authority, inference, or execution.
import { cloneFreeze, stableStringify, sha256Text } from '../workflow/contracts.mjs';
import { exact } from '../integrity/record-utils.mjs';
import { readIssuedLiveModelLaneV4 } from '../hosts/repository/reviewed-live-model-v4.mjs';
import { inspectIssuedLiveModelRequestsV4 } from './live-model-request-v4.mjs';
import { registerRepairGuidanceV1, repairGuidanceReceiptV1 } from '../adapters/repair-guidance-v1.mjs';
import { readFinalEngineReportV2 } from './host-run-bundle-v2.mjs';
import { readRepositoryRunBundleV1 } from './repository-run-v1.mjs';
import { summarizeLiveUsage } from './live-usage-v1.mjs';
import { createRepositoryProposalV1 } from '../hosts/repository/proposed-changes-v1.mjs';
import { closedList } from '../hosts/swift-verifier/group-contract-utils.mjs';
import { readLiveModelSelectionV3 } from '../hosts/repository/live-model-selection-v3.mjs';

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

function validateSelection(selection, guided = false) {
  if (selection?.api === 'CHAT_COMPLETIONS') {
    exact(selection, ['api','endpoint','model','outputMode','adapterReceiptVersion'], 'LIVE_RUN_PROTOCOL_SCHEMA');
    if (selection.adapterReceiptVersion !== (guided ? 4 : 2) || !['json_schema','json_instruction'].includes(selection.outputMode))
      fail('LIVE_RUN_PROTOCOL_SELECTION');
    return 'CHAT_COMPLETIONS';
  }
  if (selection?.api === 'NATIVE_API') {
    exact(selection, ['api','endpoint','model','expectedModelInstance','profile','reasoning','storeRequested',
      'integrationsRequested','adapterReceiptVersion'], 'LIVE_RUN_PROTOCOL_SCHEMA');
    if (selection.adapterReceiptVersion !== (guided ? 'nisi-native-chat-guidance-receipt-v1' : 'nisi-native-chat-receipt-v1') ||
        selection.profile !== 'nisi-native-chat-content-v1' || selection.reasoning !== 'off' ||
        selection.storeRequested !== false || !Array.isArray(selection.integrationsRequested) || selection.integrationsRequested.length)
      fail('LIVE_RUN_PROTOCOL_SELECTION');
    return 'NATIVE_API';
  }
  fail('LIVE_RUN_PROTOCOL_SELECTION');
}

// The full run receives an original issued configuration; the exported pure
// inspector also accepts data, so it must enforce the same configuration floor.
function validateConfiguration(config) {
  exact(config, ['author','reviewer','treatment','arm','timeoutMs','maxOutputTokens','taskFingerprint',
    'suiteFingerprint','reviewedSourceFingerprint','transportKind','authorId','reviewerId',
    'maxRequestBytes','maxResponseBytes'], 'LIVE_RUN_CONFIGURATION_SCHEMA');
  const protocols = { author: validateSelection(config.author, true), reviewer: validateSelection(config.reviewer) };
  if (config.authorId !== 'author.live-model' || config.reviewerId !== 'reviewer.live-model' ||
      !Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1 || config.timeoutMs > 90000 ||
      !Number.isSafeInteger(config.maxOutputTokens) || config.maxOutputTokens < 1 || config.maxOutputTokens > 4096 ||
      config.maxRequestBytes !== 262144 || config.maxResponseBytes !== 262144 ||
      ![config.taskFingerprint,config.suiteFingerprint,config.reviewedSourceFingerprint].every(isHash) ||
      !['LOOPBACK_HTTP','INJECTED_TEST_TRANSPORT'].includes(config.transportKind)) fail('LIVE_RUN_CONFIGURATION');
  const selection = {};
  for (const role of ['author','reviewer']) {
    const { adapterReceiptVersion: _version, ...raw } = config[role];
    if (raw.api === 'NATIVE_API') { delete raw.storeRequested; delete raw.integrationsRequested; }
    selection[role] = raw;
  }
  if (!same(readLiveModelSelectionV3(selection), selection)) fail('LIVE_RUN_PROTOCOL_SELECTION');
  validateTreatment(config);
  return protocols;
}

// For the pure data inspector this checks a closed, pinned configuration, not
// original issuance or authority. The full run uses the original lane reader.
function validateTreatment(config) {
  const r = config.treatment;
  const expected = registerRepairGuidanceV1({ arm: config.arm, api: config.author.api, binding: r?.binding });
  if (!same(r, expected) || r.binding.taskFingerprint !== config.taskFingerprint ||
      r.binding.suiteFingerprint !== config.suiteFingerprint ||
      r.binding.reviewedSourceFingerprint !== config.reviewedSourceFingerprint) fail('LIVE_RUN_TREATMENT_CONFIGURATION');
  return expected;
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
  const guided = role === 'author', protocol = validateSelection(selection, guided);
  const treatmentKeys = guided ? ['treatment'] : [];
  if (protocol === 'CHAT_COMPLETIONS') {
    exact(receipt, [...localBase, ...treatmentKeys, ...(validated ? ['candidateFingerprint','responseSha256','contentSha256'] : ['code'])], 'LIVE_RUN_MODEL_SCHEMA');
    if (receipt.schemaVersion !== selection.adapterReceiptVersion || receipt.outputMode !== selection.outputMode ||
        (validated && receipt.reportedModel !== selection.model) || (!validated && receipt.reportedModel !== null))
      fail('LIVE_RUN_PROTOCOL_RECEIPT');
  } else {
    exact(receipt, [...nativeBase, ...treatmentKeys, ...(validated
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
  if (guided) {
    const treatment = validateTreatment(config), observation = receipt.treatment;
    if (!['LOCAL_FETCH_INVOKED','NOT_DISPATCHED'].includes(observation?.dispatch)) fail('LIVE_RUN_TREATMENT_RECEIPT');
    const sent = observation.dispatch === 'LOCAL_FETCH_INVOKED';
    if (!same(observation, repairGuidanceReceiptV1(treatment, observation.systemPromptSha256, sent)) ||
        (validated && (!sent || observation.systemPromptSha256 !== treatment.expectedSystemPromptSha256)) ||
        (sent && !isHash(receipt.requestSha256)) ||
        (!sent && receipt.lifecycle?.transportSettlement !== 'NOT_STARTED') ||
        (sent && receipt.lifecycle?.transportSettlement === 'NOT_STARTED')) fail('LIVE_RUN_TREATMENT_RECEIPT');
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
    if (!isHash(receipt.resultCandidateFingerprint)) fail('LIVE_RUN_MODEL_RESPONSE');
    const admitted = guided ? [lane.baselineCandidateFingerprint, lane.repairedCandidateFingerprint] : [lane.repairedCandidateFingerprint];
    if (!admitted.includes(receipt.resultCandidateFingerprint)) reasons.push('MODEL_CANDIDATE_NOT_ADMITTED');
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
export function inspectLiveModelCallV4(input) {
  const v = cloneFreeze(input);
  exact(v, ['receipt', 'role', 'configuration', 'runId', 'taskFingerprint',
    'baselineCandidateFingerprint', 'repairedCandidateFingerprint'], 'LIVE_CALL_CONTEXT');
  if (!['author', 'reviewer'].includes(v.role) ||
      typeof v.runId !== 'string' || v.runId.length !== 36 || !/^[a-f0-9-]{36}$/u.test(v.runId) ||
      ![v.taskFingerprint, v.baselineCandidateFingerprint, v.repairedCandidateFingerprint].every(isHash) ||
      v.baselineCandidateFingerprint === v.repairedCandidateFingerprint ||
      v.configuration?.taskFingerprint !== v.taskFingerprint) fail('LIVE_CALL_CONTEXT');
  const reasons = [];
  validateConfiguration(v.configuration);
  validateModelReceipt(v.receipt, v.role, v.configuration[v.role], v.configuration,
    { runId: v.runId, taskFingerprint: v.taskFingerprint }, v, reasons);
  return cloneFreeze({ reasons, usage: summarizeLiveUsage([v.receipt]), consistencyOnly: true, authorizing: false });
}

function validateHostJournal(host, report, preparations, reasons) {
  const rows = closedList(host.invocations, 202, 'LIVE_RUN_HOST_INVOCATIONS');
  const checks = report.stages.filter(s => ['staticChecks','tests'].includes(s.stage));
  if (rows.length !== checks.length) fail('LIVE_RUN_HOST_INVOCATIONS');
  for (const [index, row] of rows.entries()) {
    exact(row, ['stage','binding','preparation','state','adapterResult','error'], 'LIVE_RUN_HOST_INVOCATION');
    const stage = checks[index], b = row.binding;
    exact(b, ['schemaVersion','runId','taskFingerprint','attempt','candidateFingerprint'], 'LIVE_RUN_HOST_INVOCATION');
    if (row.stage !== stage.stage || !same(b, { schemaVersion: 1, runId: report.runId,
      taskFingerprint: report.taskFingerprint, attempt: stage.evidence.attempt, candidateFingerprint: stage.candidateFingerprint }) ||
      !['STARTED','RETURNED','ERROR'].includes(row.state)) fail('LIVE_RUN_HOST_INVOCATION');
    if (row.preparation !== null && row.preparation !== preparations.find(p => p.candidateFingerprint === b.candidateFingerprint))
      fail('LIVE_RUN_HOST_INVOCATION_PREPARATION');
    if (stage.code === null) {
      if (row.state !== 'RETURNED' || row.error !== null || row.preparation === null ||
          !same(row.adapterResult, { status: stage.status, evidence: stage.evidence })) fail('LIVE_RUN_HOST_INVOCATION_RESULT');
    } else reasons.push('HOST_INVOCATION_INTERRUPTED');
  }
}

function validateTopology(report, lane, task, noProgress) {
  const stages = report.stages;
  const topology = ['intake','authorizeContext','draft','staticChecks','tests','repair',
    ...(noProgress ? [] : ['staticChecks','tests','review'])];
  const repairStatus = noProgress ? stages[5]?.status : 'REPAIRED';
  const statuses = ['PASS','PASS','PASS','PASS','FAIL',repairStatus, ...(noProgress ? [] : ['PASS','PASS','PASS'])];
  if (!['NO_CHANGE','REPAIRED'].includes(repairStatus) || !same(stages.map(s => s.stage), topology) ||
      stages.some((s, i) => s.status !== statuses[i] || s.code !== null)) fail('LIVE_RUN_STAGE_TOPOLOGY');
  for (const [i, stage] of stages.entries()) {
    const candidate = i < 2 ? null : i < 5 || noProgress ? lane.baselineCandidateFingerprint : lane.repairedCandidateFingerprint;
    const binding = { schemaVersion: 1, runId: report.runId, taskFingerprint: report.taskFingerprint,
      attempt: i < 5 ? 0 : 1, candidateFingerprint: candidate };
    if (stage.candidateFingerprint !== candidate || Object.keys(binding).some(k => stage.evidence[k] !== binding[k])) fail('LIVE_RUN_STAGE_BINDING');
    if (i === 0 && !same(stage.evidence, { ...binding, taskId: task.taskId, mode: task.mode,
      acceptanceCriteriaCount: task.acceptanceCriteria.length })) fail('LIVE_RUN_INTAKE_EVIDENCE');
    if (i === 1 && !same(stage.evidence, { ...binding, reason: '' })) fail('LIVE_RUN_AUTHORIZATION_EVIDENCE');
    if (i === 2 && !same(stage.evidence, { ...binding, note: 'Host-seeded source-reviewed baseline. No model draft occurred.' })) fail('LIVE_RUN_SEED_EVIDENCE');
  }
}

// Link what the original adapters saw/returned, not merely rehashed report data.
function validateModelLinks(report, lane, invocations, preparations, strict, reasons) {
  const stages = report.stages;
  for (const invocation of invocations) {
    const index = stages.findIndex(s => s.stage === invocation.operation);
    if (index < 0) { reasons.push('MODEL_INVOCATION_NOT_RECORDED'); continue; }
    const stage = stages[index], p = invocation.payload;
    if (!p) { if (strict) fail('LIVE_RUN_REQUEST_PAYLOAD_MISSING'); continue; }
    if (invocation.operation === 'repair') {
      const prefix = stages.slice(0, index).filter(s => s.evidence.attempt === p.binding.attempt - 1);
      if (!same(p.stages, prefix) || p.checks !== undefined || p.tests !== undefined) fail('LIVE_RUN_REPAIR_INPUT_MISMATCH');
    } else {
      const checks = stages.slice(0,index).findLast(s => s.stage === 'staticChecks' && s.evidence.attempt === p.binding.attempt);
      const tests = stages.slice(0,index).findLast(s => s.stage === 'tests' && s.evidence.attempt === p.binding.attempt);
      if (!checks || !tests || !same(p.checks, {status:checks.status,evidence:checks.evidence}) ||
          !same(p.tests, {status:tests.status,evidence:tests.evidence}) || p.stages !== undefined ||
          p.reviewerId !== lane.configuration.reviewerId) fail('LIVE_RUN_REVIEW_INPUT_MISMATCH');
    }
    const expectedCandidate = invocation.operation === 'repair' ? lane.baselineCandidateFingerprint : lane.repairedCandidateFingerprint;
    if (p.binding.runId !== report.runId || p.binding.taskFingerprint !== report.taskFingerprint ||
        p.binding.attempt !== stage.evidence.attempt || p.binding.candidateFingerprint !== expectedCandidate)
      fail('LIVE_RUN_MODEL_INPUT_BINDING');
  }
  for (const {operation,result} of lane.returnedResults) {
    const matches = stages.filter(s => s.stage === operation && s.status === result.status && same(s.evidence, result.evidence));
    if (matches.length !== 1) { if (strict) fail('LIVE_RUN_MODEL_RESULT_MISMATCH'); reasons.push('MODEL_RESULT_NOT_RECORDED'); }
    if (operation === 'repair') {
      if (result.status === 'NO_CHANGE') {
        if (result.candidate !== null || result.evidence.candidateFingerprint !== lane.baselineCandidateFingerprint) fail('LIVE_RUN_NO_CHANGE_SOURCE');
      } else if (result.status === 'REPAIRED') {
        const p = preparations.find(item => item.candidateFingerprint === result.evidence.candidateFingerprint);
        if (p && !same(result.candidate?.files, p.candidate.files)) fail('LIVE_RUN_REPAIRED_SOURCE_MISMATCH');
        if (strict && (!p || !same(result.candidate?.files, report.candidate?.files))) fail('LIVE_RUN_REPAIRED_SOURCE_MISMATCH');
      } else fail('LIVE_RUN_REPAIR_STATUS');
    }
  }
  for (const event of lane.events) {
    const name = event.stage === 'hostSeed' ? 'draft' : event.stage;
    const stage = stages.find(s => s.stage === name);
    const inputCandidate = ['authorizeContext','hostSeed'].includes(event.stage) ? null :
      event.stage === 'repair' ? lane.baselineCandidateFingerprint : lane.repairedCandidateFingerprint;
    const expected = { schemaVersion: 1, runId: report.runId, taskFingerprint: report.taskFingerprint,
      attempt: ['authorizeContext','hostSeed'].includes(event.stage) ? 0 : 1, candidateFingerprint: inputCandidate };
    if (!same(event.binding,expected)) fail('LIVE_RUN_EVENT_BINDING');
    if (event.status === 'UNAVAILABLE') continue;
    if (!stage || stage.status !== event.status || stage.candidateFingerprint !== event.resultCandidateFingerprint || event.code !== null) {
      if (strict) fail('LIVE_RUN_EVENT_MISMATCH'); reasons.push('LANE_EVENT_NOT_RECORDED');
    }
  }
}

function derive(input) {
  exact(input, ['lane','hostResult'], 'LIVE_RUN_CONTEXT');
  const { suite, preparations, invocations, snapshot: lane } = readIssuedLiveModelLaneV4(input.lane);
  const requestInspection = inspectIssuedLiveModelRequestsV4({ lane: input.lane });
  const host = input.hostResult;
  exact(host, ['schemaVersion','report','invocations','staticHistory','testHistory','settlementErrors','historyErrors','ownerStateErrors',
    'ownerStates','state','bundle','bundleSummary','bundleError','proposedChanges','applied','sandboxed','authorizing','certificationGranted'], 'LIVE_RUN_HOST_SCHEMA');
  if (host.schemaVersion !== 'nisi-reviewed-repository-host-v1' ||
      ['applied','sandboxed','authorizing','certificationGranted'].some(key => host[key] !== false)) fail('LIVE_RUN_HOST_CLAIM');
  const report = readFinalEngineReportV2(host.report), config = lane.configuration;
  const protocols = validateConfiguration(config);
  validateAggregateLifecycle(lane.lifecycle, protocols);
  if ((lane.runId !== null && report.runId !== lane.runId) || report.taskFingerprint !== config.taskFingerprint) fail('LIVE_RUN_BINDING');
  const task = preparations[0].task;
  if (report.taskId !== task.taskId || report.mode !== task.mode) fail('LIVE_RUN_TASK_METADATA');
  const completed = report.outcome === 'COMPLETED', noProgress = report.outcome === 'NO_PROGRESS';
  if (completed || noProgress) {
    if (report.workflowOutcome !== report.outcome || report.code !== (noProgress ? 'NO_PROGRESS' : null) ||
        report.repairAttempts !== 1 || report.candidateFingerprint !== (noProgress ? lane.baselineCandidateFingerprint : lane.repairedCandidateFingerprint) ||
        !same(report.candidate, preparations[noProgress ? 0 : 1].candidate)) fail('LIVE_RUN_FINAL_OUTCOME');
    if ((completed && lane.phase === 'NO_PROGRESS') || (noProgress && lane.phase === 'REVIEWED')) fail('LIVE_RUN_PHASE_CONTRADICTION');
    validateTopology(report, lane, task, noProgress);
  }
  const reasons = [];
  if (!completed && !noProgress) reasons.push('WORKFLOW_NOT_COMPLETED');
  if (lane.runId === null) reasons.push('LANE_NOT_STARTED');
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
    const values = closedList(host[key], 2, 'LIVE_RUN_HOST_DIAGNOSTICS');
    if (values.length !== 2) fail('LIVE_RUN_HOST_DIAGNOSTICS');
    if (values.some(value => value !== null)) reasons.push('HOST_DIAGNOSTICS_UNAVAILABLE');
  }
  exact(host.ownerStates, ['staticChecks','tests'], 'LIVE_RUN_HOST_OWNER_STATES');
  if (host.state !== 'SETTLED' || host.ownerStates.staticChecks !== 'IDLE' || host.ownerStates.tests !== 'IDLE') reasons.push('HOST_NOT_SETTLED');
  validateHostJournal(host, report, preparations, reasons);
  if (hostSummary) {
    const expectedProposal = createRepositoryProposalV1({ preparation, report, bundleSummary: hostSummary });
    if (!same(host.proposedChanges, expectedProposal)) fail('LIVE_RUN_HOST_PROPOSAL');
    if (completed && expectedProposal === null) reasons.push('HOST_PROPOSAL_UNAVAILABLE');
  } else if (host.proposedChanges !== null) fail('LIVE_RUN_HOST_PROPOSAL');
  if (noProgress && host.proposedChanges !== null) fail('LIVE_RUN_HOST_PROPOSAL_ON_NO_PROGRESS');
  if (lane.phase !== (noProgress ? 'NO_PROGRESS' : 'REVIEWED') || lane.revoked || lane.lifecycle.state !== 'IDLE' ||
      lane.lifecycle.pendingTransports !== 0 || lane.lifecycle.recoveryRequired ||
      Object.values(lane.lifecycle.roles).some(status => status.state !== 'IDLE')) reasons.push('MODEL_LANE_NOT_READY');
  if (requestInspection.status !== 'CONSISTENT') reasons.push('ORIGINAL_REQUEST_EVIDENCE_INCOMPLETE');

  const inventory = [...lane.authorReceipts, ...lane.reviewerReceipts];
  if (lane.authorReceipts.length > 1 || lane.reviewerReceipts.length > 1) fail('LIVE_RUN_MODEL_INVENTORY');
  if (noProgress && (lane.reviewerReceipts.length || lane.returnedResults.some(r => r.operation === 'review') ||
      lane.events.some(e => e.stage === 'review'))) fail('LIVE_RUN_REVIEW_AFTER_NO_PROGRESS');
  if (lane.authorReceipts.length !== 1 || lane.reviewerReceipts.length !== (noProgress ? 0 : 1)) reasons.push('MODEL_INVENTORY_INCOMPLETE');
  for (const [role, receipts] of [['author',lane.authorReceipts],['reviewer',lane.reviewerReceipts]]) for (const receipt of receipts) {
    const inspected = inspectLiveModelCallV4({ receipt, role, configuration: config, runId: report.runId,
      taskFingerprint: report.taskFingerprint, baselineCandidateFingerprint: lane.baselineCandidateFingerprint,
      repairedCandidateFingerprint: lane.repairedCandidateFingerprint });
    reasons.push(...inspected.reasons);
    const result = lane.returnedResults.find(item => item.operation === (role === 'author' ? 'repair' : 'review'));
    if (receipt.status === 'RESPONSE_VALIDATED' && (!result || result.result.evidence.candidateFingerprint !== receipt.resultCandidateFingerprint))
      fail('LIVE_RUN_MODEL_RESULT_BINDING');
  }

  const expectedEvents = ['authorizeContext','hostSeed','repair', ...(noProgress ? [] : ['review'])];
  if (!same(lane.events.map(e => e.stage), expectedEvents) || lane.events.some(e => e.status === 'UNAVAILABLE'))
    reasons.push('LANE_SEQUENCE_INCOMPLETE');
  const expectedResults = ['repair', ...(noProgress ? [] : ['review'])];
  if (!same(lane.returnedResults.map(r => r.operation), expectedResults)) reasons.push('RETURNED_MODEL_RESULTS_INCOMPLETE');
  validateModelLinks(report, lane, invocations, preparations, completed || noProgress, reasons);
  if ((completed || noProgress) && lane.authorReceipts[0]?.resultCandidateFingerprint !== report.candidateFingerprint)
    fail('LIVE_RUN_FINAL_MODEL_CANDIDATE');
  const usage = summarizeLiveUsage(inventory);
  const identity = cloneFreeze({ schemaVersion: 'nisi-repository-live-model-run-v4',
    status: reasons.length ? 'INCOMPLETE' : noProgress ? 'CONSISTENT_NO_PROGRESS'
      : config.transportKind === 'LOOPBACK_HTTP' ? 'SCOPED_LIVE_REPAIR_REVIEW_PASS' : 'SYNTHETIC_CONTRACT_PASS',
    outcome: report.outcome, workflowOutcome: report.workflowOutcome, code: report.code,
    reasons: [...new Set(reasons)], runId: report.runId, taskFingerprint: report.taskFingerprint,
    finalCandidateFingerprint: report.candidateFingerprint, reportSha256: hash('nisi/repository-final-report/v1', report),
    repositoryBundleFingerprint: hostSummary?.fingerprint ?? null, lane, requestInspection, usage,
    usageProvenance: { aggregateTotals: usage.totals === null ? null : 'DERIVED_SUM_OF_VALIDATED_CALL_COUNTERS', measurementsVerified: false,
      roles: ['author', 'reviewer'].map(role => ({ role, api: config[role].api,
        totalTokensSource: lane[role + 'Receipts'][0]?.usage == null ? null : config[role].api === 'NATIVE_API'
          ? 'DERIVED_SUM_OF_REPORTED_COUNTERS' : 'REPORTED_TOTAL_TOKENS' })) },
    nativeCompletion: { roles: ['author', 'reviewer'].filter(role => config[role].api === 'NATIVE_API'),
      termination: 'NOT_REPORTED', serverCompletionAttested: false }, hostSeedInference: false,
    source: 'ORIGINAL_ISSUED_LANE', consistencyOnly: true, modelAuthenticityAttested: false,
    providerDeliveryAttested: false, modelUseAttested: false, executionAttested: false, causalClaim: false,
    promotionEligible: false, proposalEligible: false, measurementVerified: false, authorizing: false,
    certificationGranted: false, publicationAuthorized: false });
  return cloneFreeze({ ...identity, fingerprint: hash('nisi/repository-live-model-run/v4', identity) });
}

export function createRepositoryLiveModelRunV4(input) { return derive(input); }
export function readRepositoryLiveModelRunV4(value, context) {
  const expected = derive(context);
  if (!same(cloneFreeze(value), expected)) fail('LIVE_RUN_RECORD_MISMATCH');
  return expected;
}
