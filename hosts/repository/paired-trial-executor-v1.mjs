// PRIVATE original-owner repository projection. Caller must already hold runtime,
// source and execution admission. This adds no OFF/ON treatment or oracle.
// A projected candidate is data, including a coherent failed workflow's output;
// it is not task success, provider authenticity or permission to apply changes.
import { record } from '../../evaluation/intake-v1.mjs';
import { encodeRepositoryTrialCandidateV1 } from '../../evaluation/repository-trial-candidate-v1.mjs';
import { cloneFreeze, stableStringify, sha256Text } from '../../workflow/contracts.mjs';
import { readFinalEngineReportV2 } from '../../receipts/host-run-bundle-v2.mjs';
import { createRepositoryLiveModelRunV3 } from '../../receipts/repository-live-model-run-v3.mjs';
import { readIssuedLiveModelLaneV3 } from './reviewed-live-model-v3.mjs';
import { startRepositoryTrialOperationV1 } from './paired-trial-operation-v1.mjs';

const fail = code => { throw Object.assign(Error(code), { code }); };
const hash = (domain, value) => sha256Text(domain + '\0' + stableStringify(value));
const digest = value => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value) || value.length !== 64) fail('TRIAL_PROJECTION_DIGEST');
};
const bindingKeys = ['requestId', 'profileSha256', 'model', 'modelSettingsSha256', 'taskSha256',
  'baselineSha256', 'suiteFingerprint', 'reviewedSourceFingerprint'];

// Composite identity deliberately excludes task-specific source identities;
// those are separately bound below. "model" is NOT one served-model name.
export function describeRepositoryTrialInputsV1(lane) {
  const { preparations, snapshot } = readIssuedLiveModelLaneV3(lane), c = snapshot.configuration;
  const configuration = cloneFreeze({ schemaVersion: 'nisi-repository-trial-configuration-v1',
    roles: { author: c.author, reviewer: c.reviewer },
    timeoutMs: c.timeoutMs, maxOutputTokens: c.maxOutputTokens, maxRequestBytes: c.maxRequestBytes,
    maxResponseBytes: c.maxResponseBytes, transportKind: c.transportKind });
  const modelSettingsSha256 = hash('nisi/repository-trial-configuration/v1', configuration);
  return cloneFreeze({ schemaVersion: 'nisi-repository-trial-inputs-v1',
    model: 'nisi-v3-composite:' + modelSettingsSha256, modelSettingsSha256, configuration,
    taskSha256: preparations[0].taskFingerprint, baselineSha256: preparations[0].baselineFingerprint,
    suiteFingerprint: c.suiteFingerprint, reviewedSourceFingerprint: c.reviewedSourceFingerprint,
    taskDigestProfile: 'nisi/workflow-task/v1', baselineDigestProfile: 'nisi/repository-snapshot/v1',
    oracleToolchainAndResourceAdmission: 'CALLER_VERIFY_INPUTS_REQUIRED', authorizing: false });
}
function readBinding(value, description) {
  const binding = record(value, bindingKeys);
  for (const key of bindingKeys.filter(key => key !== 'model')) digest(binding[key]);
  for (const key of bindingKeys.filter(key => !['requestId', 'profileSha256'].includes(key)))
    if (binding[key] !== description[key]) fail('TRIAL_PROJECTION_BINDING');
  return cloneFreeze(binding);
}
function project(report, hostResult, lane, binding, description) {
  // The operation passes its original channels directly. V3 does not authenticate
  // arbitrary host JSON; this identity check detects a mismatched report channel.
  if (!hostResult || Object.getOwnPropertyDescriptor(hostResult, 'report')?.value !== report) fail('TRIAL_PROJECTION_REPORT_CHANNEL');
  const final = readFinalEngineReportV2(report);
  const receipt = createRepositoryLiveModelRunV3({ lane, hostResult });
  const current = describeRepositoryTrialInputsV1(lane);
  if (stableStringify(current) !== stableStringify(description)) fail('TRIAL_PROJECTION_CONFIGURATION_CHANGED');
  if (receipt.lane.revoked || receipt.lane.lifecycle.state !== 'IDLE' || receipt.lane.lifecycle.pendingTransports !== 0 ||
      receipt.lane.lifecycle.recoveryRequired || hostResult.state !== 'SETTLED') fail('TRIAL_PROJECTION_OWNER_UNCONFIRMED');
  if (final.candidate === null) fail('TRIAL_PROJECTION_CANDIDATE_MISSING');
  const encoded = encodeRepositoryTrialCandidateV1(final.candidate);
  const { candidateText, candidateSha256 } = encoded;
  if (encoded.candidateFingerprint !== final.candidateFingerprint ||
      final.candidateFingerprint !== receipt.finalCandidateFingerprint) fail('TRIAL_PROJECTION_CANDIDATE_BINDING');
  const roles = ['author', 'reviewer'].map(role => ({ role, receipts: receipt.lane[role + 'Receipts'] }));
  const completeInventory = roles.every(({ receipts }) => receipts.length === 1 && receipts[0].status === 'RESPONSE_VALIDATED');
  const synthetic = description.configuration.transportKind === 'INJECTED_TEST_TRANSPORT';
  const tokenUsage = !synthetic && completeInventory && receipt.usage.complete
    ? { input: receipt.usage.totals.promptTokens, output: receipt.usage.totals.completionTokens } : null;
  const modelCalls = !synthetic && completeInventory ? receipt.usage.calls : null;
  const executor = cloneFreeze({ requestId: binding.requestId, profileSha256: binding.profileSha256,
    candidateText, candidateSha256, completionClaim: final.outcome === 'COMPLETED', tokenUsage,
    durationMs: null, repairAttempts: final.repairAttempts, modelCalls });
  const identity = cloneFreeze({ schemaVersion: 'nisi-repository-trial-projection-v1', binding, inputs: description,
    repositoryRunId: final.runId, reportSha256: receipt.reportSha256, repositoryReceiptFingerprint: receipt.fingerprint,
    repositoryReceiptStatus: receipt.status, repositoryReceiptReasons: receipt.reasons,
    engineOutcome: final.outcome, workflowOutcome: final.workflowOutcome,
    completionClaim: executor.completionClaim, completionClaimSource: 'ENGINE_OUTCOME_LABEL_COMPLETED_V1',
    candidate: { serializationProfile: encoded.serializationProfile, candidateFingerprint: encoded.candidateFingerprint,
      candidateSha256, byteLength: encoded.byteLength },
    usage: { sourceKind: synthetic ? 'SYNTHETIC_FIXTURE' : 'VALIDATED_REPORTED_COUNTERS',
      completeInventory, reported: receipt.usage, projectedTokens: tokenUsage, projectedModelCalls: modelCalls,
      modelCallsMeaning: 'VALIDATED_ROLE_RECEIPT_COUNT_NOT_PROVIDER_EXECUTION',
      hostSeedInference: false, durationMs: null, durationSource: 'NOT_MEASURED' },
    oracleEvaluated: false, policyTreatmentApplied: false, modelAuthenticityAttested: false,
    executionAttested: false, measurementVerified: false, causalClaim: false, authorizing: false,
    promotionEligible: false, resumable: false });
  return { executor, evidence: cloneFreeze({ ...identity, fingerprint: hash('nisi/repository-trial-projection/v1', identity) }) };
}

// The runner host returns this wrapper's operation (exactly four capabilities).
// inspectProjection is a separate private observation; do not dump it to stdout.
// It becomes available only after outward result publication, never from an
// intermediate projector callback that a late cancellation might invalidate.
export function startRepositoryPairedExecutorV1(input) {
  const { host, lane, binding: rawBinding } = record(input, ['host', 'lane', 'binding']);
  const description = describeRepositoryTrialInputsV1(lane), binding = readBinding(rawBinding, description);
  const initial = readIssuedLiveModelLaneV3(lane).snapshot;
  if (initial.revoked || initial.phase !== 'NEW' || initial.lifecycle.state !== 'IDLE' ||
      initial.lifecycle.pendingTransports !== 0 || initial.lifecycle.recoveryRequired) fail('TRIAL_PROJECTION_LANE_NOT_READY');
  let provisional = null, published = null, state = 'PENDING';
  const operation = startRepositoryTrialOperationV1({ host, lane,
    projectResult(report, hostResult) {
      const value = project(report, hostResult, lane, binding, description);
      provisional = value.evidence; return value.executor;
    } });
  Promise.prototype.then.call(operation.result,
    () => { published = provisional; provisional = null; state = 'PUBLISHED'; },
    () => { provisional = null; state = 'UNAVAILABLE'; });
  return Object.freeze({ operation, inspectProjection: () => cloneFreeze({
    schemaVersion: 'nisi-repository-trial-projection-observation-v1', state, evidence: published,
    persisted: false, authorizing: false, publicationAuthorized: false }) });
}
