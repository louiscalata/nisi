// PRIVATE complete GROUPED STATIC stage record, not a full repository host
// receipt. Test/reviewer stages are digest-bound trusted report inputs, NOT
// authenticated execution. Original issued plans are required in this process.
import { cloneFreeze, sha256Text, stableStringify } from '../workflow/contracts.mjs';
import { exact } from '../integrity/record-utils.mjs';
import { readFinalEngineReportV2 } from './host-run-bundle-v2.mjs';
import { issuedSwiftChecksV1 } from '../hosts/swift-verifier/check-plan-v1.mjs';
import { closedList } from '../hosts/swift-verifier/group-contract-utils.mjs';
import { readSwiftStaticGroupV1 } from './swift-static-group-v1.mjs';
const schema = 'nisi-swift-static-run-v1';
const fail = code => { throw Object.assign(new Error(code), { code }); };
const hash = (domain, v) => sha256Text(domain + '\0' + stableStringify(v));
const same = (a, b) => stableStringify(a) === stableStringify(b);
const bindingKeys = ['schemaVersion', 'runId', 'taskFingerprint', 'attempt', 'candidateFingerprint'];
const configuration = p => ({ executionProfile: p.executionProfile,
  targets: p.targets.map(t => ({ path: t.path, profileId: t.profileId })) });

function derive(context, groupInputs) {
  exact(context, ['report', 'plans'], 'SWIFT_RUN_CONTEXT');
  const report = readFinalEngineReportV2(context.report);
  const plans = closedList(context.plans, 101, 'SWIFT_RUN_PLANS');
  const inputs = closedList(groupInputs, 101, 'SWIFT_RUN_GROUPS');
  const stages = report.stages.map((s, i) => ({ s, i })).filter(v => v.s.stage === 'staticChecks');
  if (plans.length === 0 || plans.length !== inputs.length || inputs.length !== stages.length) fail('SWIFT_RUN_INVENTORY');
  let baseline = null, config = null;
  const entries = inputs.map((input, index) => {
    const plan = plans[index]; issuedSwiftChecksV1(plan);
    const group = readSwiftStaticGroupV1(input, plan), { s, i } = stages[index], b = plan.binding;
    if (b.attempt !== index || b.attempt > report.repairAttempts || b.runId !== report.runId ||
        b.taskFingerprint !== report.taskFingerprint || s.candidateFingerprint !== b.candidateFingerprint ||
        bindingKeys.some(k => s.evidence[k] !== b[k])) fail('SWIFT_RUN_BINDING');
    const cfg = configuration(plan);
    if (baseline !== null && baseline !== b.baselineFingerprint || config !== null && !same(config, cfg)) fail('SWIFT_RUN_CONFIGURATION');
    baseline = b.baselineFingerprint; config = cfg;
    let disposition;
    if (s.code === null) {
      if (!same({ status: s.status, evidence: s.evidence }, group.adapterResult)) fail('SWIFT_RUN_STAGE_RESULT');
      disposition = 'RESULT_RECORDED';
    } else if (s.code === 'ABORTED' || s.code === 'DEADLINE_EXCEEDED') disposition = 'ENGINE_INTERRUPTED';
    else fail('SWIFT_RUN_UNRECORDED_ERROR');
    return { group, disposition: { kind: disposition, stageIndex: i, engineStatus: s.status, engineCode: s.code } };
  });
  const last = plans.at(-1).binding;
  if (last.candidateFingerprint !== report.candidateFingerprint || report.repairAttempts > last.attempt + 1) fail('SWIFT_RUN_FINAL_CANDIDATE');
  return { report, identity: { schemaVersion: schema, scope: 'DECLARED_MATERIALIZED_STATIC_CHECKS_ONLY',
    reportSha256: hash('nisi/swift-static-final-report/v1', report), entries,
    executionVerified: false, authorizing: false, certificationGranted: false } };
}

export function createSwiftStaticRunV1(context, groups) {
  const { identity } = derive(context, groups);
  return cloneFreeze({ ...identity, fingerprint: hash('nisi/swift-static-run/v1', identity) });
}

export function readSwiftStaticRunV1(input, context) {
  exact(input, ['schemaVersion', 'scope', 'reportSha256', 'entries', 'executionVerified', 'authorizing',
    'certificationGranted', 'fingerprint'], 'SWIFT_RUN_SCHEMA');
  const entries = closedList(input.entries, 101, 'SWIFT_RUN_ENTRIES');
  entries.forEach(e => exact(e, ['group', 'disposition'], 'SWIFT_RUN_ENTRY'));
  const { report, identity } = derive(context, entries.map(e => e.group));
  if (!same(cloneFreeze(input), { ...identity, fingerprint: hash('nisi/swift-static-run/v1', identity) })) fail('SWIFT_RUN_MISMATCH');
  const rawCounts = { PASS: 0, FAIL: 0, NOT_RUN: 0, ERROR: 0, INCONCLUSIVE: 0, NOT_DISPATCHED: 0 };
  let recordedPassGroups = 0, unrecordedRawPassGroups = 0, unknownDrainCount = 0;
  for (const { group, disposition } of identity.entries) {
    for (const key of Object.keys(rawCounts)) rawCounts[key] += group.aggregate.counts[key];
    unknownDrainCount += group.aggregate.unknownDrainCount;
    if (group.adapterResult.status === 'PASS') {
      if (disposition.kind === 'RESULT_RECORDED') recordedPassGroups++;
      else unrecordedRawPassGroups++;
    }
  }
  return cloneFreeze({ status: 'CONSISTENT', scope: identity.scope, groupCount: entries.length, rawCounts,
    recordedPassGroups, unrecordedRawPassGroups, unknownDrainCount, workflowOutcome: report.workflowOutcome,
    outcome: report.outcome, code: report.code, reportStoreCode: report.reportStoreCode,
    executionVerified: false, authorizing: false, certificationGranted: false });
}
