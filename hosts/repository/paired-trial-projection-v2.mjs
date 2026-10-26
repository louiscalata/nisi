// PRIVATE V4 projection, not an execution entry point or admission grant.
// Only the arm owner starts operations; this module checks and projects data.
import { record } from '../../evaluation/intake-v1.mjs';
import { readScheduledPairedTrialIntentV1 } from '../../evaluation/paired-trial-runner-v1.mjs';
import { encodeRepositoryTrialCandidateV1 } from '../../evaluation/repository-trial-candidate-v1.mjs';
import { cloneFreeze,stableStringify,sha256Text } from '../../workflow/contracts.mjs';
import { createRepositoryLiveModelRunV4 } from '../../receipts/repository-live-model-run-v4.mjs';
import { readIssuedLiveModelLaneV4, prepareReviewedLiveModelLaneV4 } from './reviewed-live-model-v4.mjs';
import { describeRepairGuidancePolicyV1 } from './repair-guidance-policy-v1.mjs';

const fail = code => { throw Object.assign(Error(code),{code}); };
const hash = (domain,value) => sha256Text(domain+'\0'+stableStringify(value));
const same = (a,b) => stableStringify(a) === stableStringify(b);

export function describeRepositoryTrialInputsV2(lane) {
  const {preparations,treatment,snapshot} = readIssuedLiveModelLaneV4(lane), c = snapshot.configuration;
  return describePrepared(preparations,treatment,c);
}
// Prospective settings share the exact projection, but issue no execution
// identity. They cannot replace the original lane/intent checks below.
export function describePlannedRepositoryTrialInputsV2(input,transportKind='LOOPBACK_HTTP') {
  const {preparations,treatment,configuration}=prepareReviewedLiveModelLaneV4(input,transportKind);
  return describePrepared(preparations,treatment,configuration);
}
function describePrepared(preparations,treatment,c) {
  const policy = describeRepairGuidancePolicyV1(treatment);
  const configuration = cloneFreeze({schemaVersion:'nisi-repository-trial-configuration-v2',
    roles:{author:c.author,reviewer:c.reviewer},timeoutMs:c.timeoutMs,maxOutputTokens:c.maxOutputTokens,
    maxRequestBytes:c.maxRequestBytes,maxResponseBytes:c.maxResponseBytes,transportKind:c.transportKind,policy});
  const modelSettingsSha256 = hash('nisi/repository-trial-configuration/v2',configuration);
  return cloneFreeze({schemaVersion:'nisi-repository-trial-inputs-v2',
    model:'nisi-v4-composite:'+modelSettingsSha256,modelSettingsSha256,configuration,
    taskSha256:preparations[0].taskFingerprint,baselineSha256:preparations[0].baselineFingerprint,
    suiteFingerprint:c.suiteFingerprint,reviewedSourceFingerprint:c.reviewedSourceFingerprint,
    arm:c.arm,treatmentFingerprint:treatment.fingerprint,guidancePolicySha256:policy.sha256,
    taskDigestProfile:'nisi/workflow-task/v1',baselineDigestProfile:'nisi/repository-snapshot/v1',
    authorizing:false});
}

export function checkRepositoryTrialIntentV2(intent,lane) {
  const {profile} = readScheduledPairedTrialIntentV1(intent), inputs = describeRepositoryTrialInputsV2(lane);
  for (const key of ['model','modelSettingsSha256','taskSha256','baselineSha256','arm'])
    if (intent[key] !== inputs[key]) fail('TRIAL_V2_INTENT_BINDING');
  const expectedPolicy = {version:inputs.configuration.policy.version,sha256:inputs.guidancePolicySha256};
  if (!same(profile.trialPolicy,expectedPolicy) ||
      !same(intent.trialPolicy,intent.arm === 'ON' ? expectedPolicy : null) ||
      intent.policyMode !== (intent.arm === 'ON' ? 'ISOLATED_TRIAL' : 'OFF')) fail('TRIAL_V2_POLICY_BINDING');
  return inputs;
}

export function projectRepositoryTrialV2(input) {
  const {report,hostResult,lane,intent,description} = record(input,['report','hostResult','lane','intent','description']);
  if (!hostResult || Object.getOwnPropertyDescriptor(hostResult,'report')?.value !== report) fail('TRIAL_V2_REPORT_CHANNEL');
  const current = checkRepositoryTrialIntentV2(intent,lane);
  if (!same(description,current)) fail('TRIAL_V2_CONFIGURATION_CHANGED');
  const receipt = createRepositoryLiveModelRunV4({lane,hostResult});
  if (receipt.lane.revoked || receipt.lane.lifecycle.state !== 'IDLE' || receipt.lane.lifecycle.pendingTransports !== 0 ||
      receipt.lane.lifecycle.recoveryRequired || hostResult.state !== 'SETTLED') fail('TRIAL_V2_OWNER_UNCONFIRMED');
  if (report.candidate === null) fail('TRIAL_V2_CANDIDATE_MISSING');
  const encoded = encodeRepositoryTrialCandidateV1(report.candidate);
  if (encoded.candidateFingerprint !== receipt.finalCandidateFingerprint) fail('TRIAL_V2_CANDIDATE_BINDING');
  const noProgress = receipt.status === 'CONSISTENT_NO_PROGRESS';
  const counts = {author:1,reviewer:noProgress ? 0 : 1};
  const completeInventory = ['author','reviewer'].every(role => {
    const rows = receipt.lane[role+'Receipts'];
    return rows.length === counts[role] && rows.every(r=>r.status === 'RESPONSE_VALIDATED');
  });
  const synthetic = current.configuration.transportKind === 'INJECTED_TEST_TRANSPORT';
  const tokenUsage = !synthetic && completeInventory && receipt.usage.complete
    ? {input:receipt.usage.totals.promptTokens,output:receipt.usage.totals.completionTokens} : null;
  const modelCalls = !synthetic && completeInventory ? receipt.usage.calls : null;
  const executor = cloneFreeze({requestId:intent.requestId,profileSha256:intent.profileSha256,
    candidateText:encoded.candidateText,candidateSha256:encoded.candidateSha256,completionClaim:report.outcome === 'COMPLETED',
    tokenUsage,durationMs:null,repairAttempts:report.repairAttempts,modelCalls});
  const author = receipt.lane.authorReceipts[0];
  const identity = cloneFreeze({schemaVersion:'nisi-repository-trial-projection-v2',intent,inputs:current,
    repositoryRunId:report.runId,reportSha256:receipt.reportSha256,repositoryReceiptFingerprint:receipt.fingerprint,
    repositoryReceiptStatus:receipt.status,repositoryReceiptReasons:receipt.reasons,
    engineOutcome:report.outcome,workflowOutcome:report.workflowOutcome,
    completionClaim:executor.completionClaim,completionClaimSource:'ENGINE_OUTCOME_LABEL_COMPLETED_V1',
    candidate:{serializationProfile:encoded.serializationProfile,candidateFingerprint:encoded.candidateFingerprint,
      candidateSha256:encoded.candidateSha256,byteLength:encoded.byteLength},
    treatment:{arm:current.arm,treatmentFingerprint:current.treatmentFingerprint,policySha256:current.guidancePolicySha256,
      applicationPoint:current.configuration.policy.applicationPoint,requestInspection:receipt.requestInspection.status,
      localDispatch:author?.treatment.dispatch ?? 'NOT_OBSERVED',systemPromptSha256:author?.treatment.systemPromptSha256 ?? null,
      modelUseAttested:false,effectiveness:'NOT_MEASURED'},
    usage:{sourceKind:synthetic?'SYNTHETIC_FIXTURE':'VALIDATED_REPORTED_COUNTERS',completeInventory,reported:receipt.usage,
      projectedTokens:tokenUsage,projectedModelCalls:modelCalls,modelCallsMeaning:'VALIDATED_ROLE_RECEIPT_COUNT_NOT_PROVIDER_EXECUTION',
      hostSeedInference:false,durationMs:null,durationSource:'NOT_MEASURED'},
    oracleEvaluated:false,modelAuthenticityAttested:false,executionAttested:false,measurementVerified:false,
    causalClaim:false,authorizing:false,promotionEligible:false,resumable:false});
  return Object.freeze({executor,evidence:cloneFreeze({...identity,fingerprint:hash('nisi/repository-trial-projection/v2',identity)})});
}
