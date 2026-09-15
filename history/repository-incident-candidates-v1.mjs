// PRIVATE source-bound check observations, not accepted incidents or learning.
// Only original issued context may feed this projection. The trusted host and
// synthetic dependency seams are not authenticated execution evidence.
import {cloneFreeze, stableStringify, sha256Text} from '../workflow/contracts.mjs';
import {exact} from '../integrity/record-utils.mjs';
import {readRepositoryRunBundleV1} from '../receipts/repository-run-v1.mjs';
import {issuedSwiftChecksV1} from '../hosts/swift-verifier/check-plan-v1.mjs';
import {readNativeArtifactReport} from '../hosts/swift-verifier/protocol.mjs';

const H = (domain, value) => sha256Text(domain + '\0' + stableStringify(value));
const domain = part => 'nisi/repository-incident-' + part + '/v1';
const fail = () => { throw Object.assign(new Error('INCIDENT_EVIDENCE_INVALID'), {code:'INCIDENT_EVIDENCE_INVALID'}); };
const trust = 'TRUSTED_HOST_STATEMENTS_NOT_ATTESTED';
const issuedPreviews = new WeakSet();
export const isIssuedRepositoryIncidentPreviewV1 = value => issuedPreviews.has(value);

function classification(disposition, stageStatus, rawStatus) {
  if (disposition === 'ENGINE_INTERRUPTED') return ['INTERRUPTED','ENGINE_INTERRUPTED'];
  if (rawStatus === 'NOT_DISPATCHED') return ['NOT_RUN','NOT_DISPATCHED'];
  if (!['PASS','FAIL'].includes(stageStatus)) return ['OPERATIONAL','STAGE_UNAVAILABLE'];
  if (rawStatus === 'NOT_RUN') return ['NOT_RUN','CHECK_NOT_RUN'];
  if (!['PASS','FAIL'].includes(rawStatus)) return ['OPERATIONAL','CHECK_UNAVAILABLE'];
  if (rawStatus === 'FAIL' && stageStatus === 'FAIL') return ['FAILURE_CANDIDATE','RECORDED_FAILURE'];
  if (rawStatus === 'PASS') return ['PASS','RECORDED_PASS'];
  fail();
}

function makeRow({summary, expected, disposition, checkIndex, subject, subjectKey,
  receipt, evidence, planFingerprint, groupFingerprint, failureCodes}) {
  const b = expected.binding, p = expected.profile;
  const binding = {runId:b.runId, taskFingerprint:b.taskFingerprint,
    baselineFingerprint:b.baselineFingerprint, attempt:b.attempt, stage:b.stage,
    checkIndex, candidateFingerprint:b.candidateFingerprint, subjectKey};
  const familyId = H(domain('family'), {stage:b.stage, profileId:p.id,
    profileVersion:p.version, rulesetSha256:p.rulesetSha256});
  const rawStatus = receipt?.result.status ?? (b.stage === 'staticChecks' ? 'NOT_DISPATCHED' : 'NO_RECEIPT');
  const [kind, reason] = classification(disposition.kind, disposition.engineStatus, rawStatus);
  const row = {
    schemaVersion:'nisi-repository-incident-row/v1', rowId:H(domain('row-id'), binding),
    occurrenceGroupId:H(domain('occurrence'), {taskFingerprint:b.taskFingerprint,
      baselineFingerprint:b.baselineFingerprint, runId:b.runId, familyId}),
    familyId, binding, stageIndex:disposition.stageIndex, classification:kind, reason,
    rawStatus, stageStatus:disposition.engineStatus, disposition:disposition.kind,
    source:{reportSha256:summary.reportSha256, bundleFingerprint:summary.fingerprint,
      planFingerprint, groupFingerprint, expectationFingerprint:expected.fingerprint,
      profileFingerprint:b.profileFingerprint, verifierSourceSha256:p.sourceSha256,
      verifierBuildSha256:p.buildSha256, executableSha256:p.executableSha256,
      rulesetSha256:p.rulesetSha256, preparationFingerprint:b.preparationFingerprint,
      materializedFingerprint:b.materializedFingerprint,
      receiptSha256:receipt === null ? null : H(domain('receipt'), receipt),
      evidenceSha256:H(domain('evidence'), evidence)},
    subject, failureCodes:[...new Set(failureCodes)].sort(), sourceTrust:trust,
    persistable:false, executionVerified:false, learningEligible:false,
    independentOccurrence:false, authorizing:false, certificationGranted:false,
  };
  return {...row, fingerprint:H(domain('row'), row)};
}

export function createRepositoryIncidentPreviewV1(input) {
  exact(input, ['bundle','context'], 'INCIDENT_INPUT_SCHEMA');
  // Validate original issuance BEFORE cloning context. A JSON copy has no right
  // to attest execution, even if all public fields and hashes agree.
  const summary = readRepositoryRunBundleV1(input.bundle, input.context);
  const bundle = cloneFreeze(input.bundle), context = input.context, rows = [];
  for (const [index, entry] of bundle.staticBundle.entries.entries()) {
    const plan = context.plans[index], checks = issuedSwiftChecksV1(plan);
    for (const [checkIndex, check] of checks.entries()) {
      const child = entry.group.entries[checkIndex];
      const receipt = child.dispatch === 'OBSERVED' ? child.receipt : null;
      let failureCodes = [];
      if (receipt && ['PASS','FAIL'].includes(receipt.result.status)) {
        // The bundle has already validated this exact native frame; reading
        // again here extracts only its fixed deterministic IDs, never messages.
        const native = readNativeArtifactReport(Buffer.from(child.stdoutHex, 'hex'), check.request).report;
        failureCodes = native.outcomes.filter(o => o.status === 'FAIL').map(o => o.id);
      }
      const pathSha256 = H(domain('path'), check.target.path);
      rows.push(makeRow({summary, expected:check.expected, disposition:entry.disposition,
        checkIndex, subject:{kind:'FILE',pathSha256,contentSha256:check.target.artifactSha256},
        subjectKey:pathSha256, receipt, evidence:child, planFingerprint:plan.fingerprint,
        groupFingerprint:entry.group.fingerprint, failureCodes}));
    }
  }
  for (const [index, entry] of bundle.testEntries.entries()) {
    const original = context.executions[index];
    const failureCodes = entry.adapterResult.evidence.failures.map(f => f.code);
    // Original executor emits a fixed, hash-based assertion identifier. Reject
    // unexpected metadata rather than allowing free text onto this surface.
    if (failureCodes.some(c => !/^NODE_ASSERTION_[a-f0-9]{16}$/.test(c))) fail();
    rows.push(makeRow({summary, expected:original.expected, disposition:entry.disposition,
      checkIndex:0, subject:{kind:'MATERIALIZED_TREE',pathSha256:null,contentSha256:null},
      subjectKey:H(domain('suite'), bundle.nodeSuiteFingerprint), receipt:entry.execution.receipt,
      evidence:entry.execution, planFingerprint:null, groupFingerprint:null, failureCodes}));
  }
  rows.sort((a,b) => a.stageIndex - b.stageIndex || a.binding.checkIndex - b.binding.checkIndex);
  if (rows.length > 6565 || new Set(rows.map(r => r.rowId)).size !== rows.length) fail();
  const body = {schemaVersion:'nisi-repository-incident-preview/v1', status:'PREVIEW',reason:null,
    reportSha256:summary.reportSha256,bundleFingerprint:summary.fingerprint,rows,
    sourceTrust:trust,freshness:'SETTLED_SNAPSHOT_ONLY',persistable:false,learningEligible:false,authorizing:false};
  const result = {...body,sha256:H(domain('preview'),body)};
  if (Buffer.byteLength(stableStringify(result),'utf8') > 16_777_216) fail();
  const frozen = cloneFreeze(result);
  issuedPreviews.add(frozen);
  return frozen;
}
