// PRIVATE combined Swift/Node consistency record. Requires a trusted final
// engine report and ORIGINAL issued plans/executions/preparation in this process.
// Serialized records are inspectable data, not replay authority or attestation.
import { cloneFreeze, stableStringify, sha256Text } from '../workflow/contracts.mjs';
import { exact } from '../integrity/record-utils.mjs';
import { closedList } from '../hosts/swift-verifier/group-contract-utils.mjs';
import { isIssuedRepositoryPreparation } from '../hosts/repository/snapshot-contract.mjs';
import { readFinalEngineReportV2 } from './host-run-bundle-v2.mjs';
import { createSwiftStaticRunV1, readSwiftStaticRunV1 } from './swift-static-run-v1.mjs';
import { nodeTestAdapterResultV1 } from '../hosts/repository/node-executor-v1.mjs';
import { requireReviewedNodeSuiteV1 } from '../hosts/repository/node-suite-v1.mjs';

const schemaVersion = 'nisi-repository-run-v1';
const scope = 'REVIEWED_STATIC_LOCAL_SWIFT_NODE_V1';
const hash = (domain, v) => sha256Text(domain + '\0' + stableStringify(v));
const same = (a, b) => stableStringify(a) === stableStringify(b);
const fail = code => { throw Object.assign(new Error(code), { code }); };
const bindingKeys = ['schemaVersion', 'runId', 'taskFingerprint', 'attempt', 'candidateFingerprint'];
const treeKeys = ['baselineFingerprint', 'materializedFingerprint', 'preparationFingerprint'];
const bundleKeys = ['schemaVersion', 'scope', 'report', 'reportSha256', 'preparation', 'staticPlans', 'staticBundle',
  'testEntries', 'nodeSuiteFingerprint', 'nodeRegistrationFingerprint', 'executionVerified', 'authorizing', 'certificationGranted', 'sandboxed', 'noDescendantsEnforced', 'fingerprint'];

function derive(context) {
  exact(context, ['report', 'plans', 'groups', 'executions', 'preparation', 'suite', 'nodeRegistrationFingerprint'], 'REPOSITORY_RUN_CONTEXT');
  const p = context.preparation;
  if (!isIssuedRepositoryPreparation(p)) fail('REPOSITORY_RUN_PREPARATION');
  requireReviewedNodeSuiteV1(context.suite, p);
  const nodeSuiteFingerprint = context.suite.fingerprint, nodeRegistrationFingerprint = context.nodeRegistrationFingerprint;
  if (typeof nodeRegistrationFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(nodeRegistrationFingerprint)) fail('REPOSITORY_RUN_NODE_CONFIGURATION');
  const report = readFinalEngineReportV2(context.report);
  const plans = closedList(context.plans, 101, 'REPOSITORY_RUN_PLANS');
  const groups = closedList(context.groups, 101, 'REPOSITORY_RUN_GROUPS');
  const executions = closedList(context.executions, 101, 'REPOSITORY_RUN_EXECUTIONS');
  const staticContext = { report, plans }, staticBundle = createSwiftStaticRunV1(staticContext, groups);
  const staticSummary = readSwiftStaticRunV1(staticBundle, staticContext);
  const finalBinding = plans.at(-1).binding;
  if (p.taskFingerprint !== report.taskFingerprint || p.candidateFingerprint !== report.candidateFingerprint ||
      p.fingerprint !== finalBinding.preparationFingerprint || p.baselineFingerprint !== finalBinding.baselineFingerprint ||
      p.materializedFingerprint !== finalBinding.materializedFingerprint) fail('REPOSITORY_RUN_FINAL_PREPARATION');
  const stages = report.stages.map((s, stageIndex) => ({ s, stageIndex })).filter(v => v.s.stage === 'tests');
  if (executions.length !== stages.length) fail('REPOSITORY_RUN_TEST_INVENTORY');
  let previousAttempt = -1;
  const testEntries = executions.map((execution, i) => {
    // This original-issued check MUST precede cloning or serializing execution.
    const adapter = nodeTestAdapterResultV1(execution), b = execution.expected.binding, { s, stageIndex } = stages[i];
    if (b.stage !== 'tests' || b.attempt <= previousAttempt || b.attempt > report.repairAttempts ||
        b.runId !== report.runId || b.taskFingerprint !== report.taskFingerprint ||
        b.candidateFingerprint !== s.candidateFingerprint || bindingKeys.some(k => s.evidence[k] !== b[k])) fail('REPOSITORY_RUN_TEST_BINDING');
    previousAttempt = b.attempt;
    const plan = plans.find(pl => pl.binding.attempt === b.attempt);
    if (!plan || bindingKeys.some(k => plan.binding[k] !== b[k]) || treeKeys.some(k => plan.binding[k] !== b[k])) fail('REPOSITORY_RUN_CROSS_LANE');
    if (nodeRegistrationFingerprint !== execution.registrationFingerprint || nodeSuiteFingerprint !== execution.suiteFingerprint) fail('REPOSITORY_RUN_TEST_CONFIGURATION');
    let kind;
    if (s.code === null) {
      if (!same({ status: s.status, evidence: s.evidence }, adapter)) fail('REPOSITORY_RUN_TEST_RESULT');
      kind = 'RESULT_RECORDED';
    } else if (s.code === 'ABORTED' || s.code === 'DEADLINE_EXCEEDED') kind = 'ENGINE_INTERRUPTED';
    else fail('REPOSITORY_RUN_UNRECORDED_ERROR');
    return { execution, adapterResult: adapter, disposition: { kind, stageIndex, engineStatus: s.status, engineCode: s.code } };
  });
  const identity = cloneFreeze({ schemaVersion, scope, report, reportSha256: hash('nisi/repository-final-report/v1', report),
    preparation: { fingerprint: p.fingerprint, taskFingerprint: p.taskFingerprint, candidateFingerprint: p.candidateFingerprint,
      baselineFingerprint: p.baselineFingerprint, materializedFingerprint: p.materializedFingerprint },
    staticPlans: plans, staticBundle, testEntries, nodeSuiteFingerprint, nodeRegistrationFingerprint, executionVerified: false, authorizing: false,
    certificationGranted: false, sandboxed: false, noDescendantsEnforced: false });
  const rawTestCounts = { PASS: 0, FAIL: 0, ERROR: 0, INCONCLUSIVE: 0, NOT_RUN: 0, NO_RECEIPT: 0 };
  let recordedTestPasses = 0, interruptedTests = 0, unknownTestDrainCount = 0;
  for (const { execution, adapterResult, disposition } of testEntries) {
    rawTestCounts[execution.receipt?.result.status ?? 'NO_RECEIPT']++;
    if (adapterResult.status === 'PASS' && disposition.kind === 'RESULT_RECORDED') recordedTestPasses++;
    if (disposition.kind === 'ENGINE_INTERRUPTED') interruptedTests++;
    if (execution.receipt?.process.drain === 'UNKNOWN') unknownTestDrainCount++;
  }
  const finalStatic = staticBundle.entries.at(-1), finalTest = testEntries.at(-1);
  const finalChecksRecordedPass = finalStatic.disposition.kind === 'RESULT_RECORDED' && finalStatic.group.adapterResult.status === 'PASS' &&
    Boolean(finalTest && finalTest.execution.expected.binding.attempt === finalBinding.attempt &&
      finalTest.disposition.kind === 'RESULT_RECORDED' && finalTest.adapterResult.status === 'PASS');
  return { identity, summary: { status: 'CONSISTENT', scope, runId: report.runId, taskFingerprint: report.taskFingerprint,
    candidateFingerprint: report.candidateFingerprint, preparationFingerprint: p.fingerprint,
    baselineFingerprint: p.baselineFingerprint, materializedFingerprint: p.materializedFingerprint,
    outcome: report.outcome, workflowOutcome: report.workflowOutcome, code: report.code, reportStoreCode: report.reportStoreCode,
    staticSummary, nodeSuiteFingerprint, nodeRegistrationFingerprint, testCount: testEntries.length, rawTestCounts, recordedTestPasses,
    unrecordedRawTestPasses: rawTestCounts.PASS - recordedTestPasses, interruptedTests, unknownTestDrainCount, finalChecksRecordedPass,
    executionVerified: false, authorizing: false, certificationGranted: false } };
}

export function createRepositoryRunBundleV1(context) {
  const { identity } = derive(context);
  return cloneFreeze({ ...identity, fingerprint: hash('nisi/repository-run/v1', identity) });
}
export function readRepositoryRunBundleV1(input, context) {
  exact(input, bundleKeys, 'REPOSITORY_RUN_SCHEMA');
  const { identity, summary } = derive(context), expected = { ...identity, fingerprint: hash('nisi/repository-run/v1', identity) };
  if (!same(cloneFreeze(input), expected)) fail('REPOSITORY_RUN_MISMATCH');
  return cloneFreeze({ ...summary, reportSha256: identity.reportSha256, fingerprint: expected.fingerprint });
}
