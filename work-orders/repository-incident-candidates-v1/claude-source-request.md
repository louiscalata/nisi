# Private Nisi incident-candidate source review
Tool-disabled review; no tests executed by you. Review exact included source. Opus design corrections: occurrence group omits candidate/attempt/stageIndex; no automatic REPAIRED attribution; no truncation; hashes explicitly NOT anonymization. Candidate preview only, actual native adapter unchanged. Check correctness, privacy leakage, trust source, hidden acceptance errors, optional feature failure affecting primary workflow. ReadRepositoryRunBundleV1(bundle,context) requires original issued prep/plans/executions, rederives static/Node results and exact full bundle. It validates process/drain/deadline/truncation and result correspondence. Context is trusted plain in-process data; hostile Proxies excluded. cloneFreeze uses recursively frozen null-prototype objects. Static plan targets/checks include original request, expected receipt identity and target content hash; Node testReport failure codes are deterministic NODE_ASSERTION_ + 16hex. Review only actual material defects, <=5 findings with precise function and recommended fix. Return PASS if none.


## history/repository-incident-candidates-v1.mjs
```js
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
  return cloneFreeze(result);
}

```

## hosts/repository/reviewed-workflow-v1.mjs
```js
// PRIVATE combined host for exact source-reviewed local fixture trees.
// Real Swift/Node entry point; trusted dependency seam is not execution proof.
// No arbitrary program approval, sandbox, apply-back, cleanup or durable resume.
import { runWorkflow } from '../../workflow/engine.mjs';
import { cloneFreeze } from '../../workflow/contracts.mjs';
import { exact } from '../../integrity/record-utils.mjs';
import { closedList } from '../swift-verifier/group-contract-utils.mjs';
import { prepareRepositoryCandidate } from './snapshot-contract.mjs';
import { reviewedNodePreparationsV1 } from './node-suite-v1.mjs';
import { createReviewedNodeTestAdapterV1 } from './node-adapter-v1.mjs';
import { createSwiftStaticGroupAdapterV1 } from '../swift-verifier/group-adapter-v1.mjs';
import { createRepositoryRunBundleV1, readRepositoryRunBundleV1 } from '../../receipts/repository-run-v1.mjs';
import { createRepositoryProposalV1 } from './proposed-changes-v1.mjs';
import { createRepositoryHistoryAccessV1 } from '../../history/repository-host-history-v1.mjs';
import { createRepositoryIncidentPreviewV1 } from '../../history/repository-incident-candidates-v1.mjs';

const fail = code => { throw Object.assign(new Error(code), { code }); };
const codeOf = e => typeof e?.code === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(e.code) ? e.code : 'REPOSITORY_HOST_ERROR';
const text = v => typeof v === 'string' && v.isWellFormed() && !v.includes('\0') && v.length <= 4096 ? v : null;
const errorRecord = e => {
  try { return cloneFreeze({ code: codeOf(e), root: text(e?.root), priorCode: text(e?.priorCode), systemCode: text(e?.systemCode) }); }
  catch { return cloneFreeze({ code: 'REPOSITORY_ERROR_DETAILS_UNAVAILABLE', root: null, priorCode: null, systemCode: null }); }
};

export function createReviewedRepositoryHostV1(input) {
  exact(input, ['suite', 'build', 'scope', 'targets', 'parentRoot', 'staticTimeoutMs', 'totalTestTimeoutMs', 'testTimeoutMs', 'closeGraceMs'], 'REPOSITORY_HOST_SCHEMA');
  const preparations = reviewedNodePreparationsV1(input.suite);
  const staticOwner = createSwiftStaticGroupAdapterV1({ build: input.build, scope: input.scope,
    baseline: preparations[0].baseline, targets: input.targets, timeoutMs: input.staticTimeoutMs, closeGraceMs: input.closeGraceMs });
  const testsOwner = createReviewedNodeTestAdapterV1({ suite: input.suite, parentRoot: input.parentRoot,
    totalTimeoutMs: input.totalTestTimeoutMs, childTimeoutMs: input.testTimeoutMs, closeGraceMs: input.closeGraceMs });
  return createRepositoryWorkflowOwnerV1({ suite: input.suite, staticOwner, testsOwner });
}

// Internal trusted-owner seam for contract/lifecycle tests. Injected callbacks
// cannot turn these records into native execution or independent model evidence.
export function createRepositoryWorkflowOwnerV1(input) {
  exact(input, ['suite', 'staticOwner', 'testsOwner'], 'REPOSITORY_OWNER_SCHEMA');
  const suite = input.suite, preparations = reviewedNodePreparationsV1(suite), task = preparations[0].task;
  const nodeRegistrationFingerprint = input.testsOwner?.registrationFingerprint;
  if (typeof nodeRegistrationFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(nodeRegistrationFingerprint)) fail('REPOSITORY_OWNER_CONFIGURATION');
  function owner(source, method) {
    const methods = [method, 'settled', 'observations', 'status', 'lateObservations'];
    if (!source || methods.some(k => typeof source[k] !== 'function')) fail('REPOSITORY_OWNER_REQUIRED');
    return Object.freeze(Object.fromEntries(methods.map(k => [k, source[k].bind(source)])));
  }
  const staticOwner = owner(input.staticOwner, 'check'), testsOwner = owner(input.testsOwner, 'run');
  const invocations = []; let state = 'NEW', reportPromise = null, settlement = null;
  const history = createRepositoryHistoryAccessV1({taskFingerprint: preparations[0].taskFingerprint,
    baselineFingerprint: preparations[0].baselineFingerprint});
  const incidentRefusal = reason => cloneFreeze({schemaVersion:'nisi-repository-incident-preview/v1',
    status:'REFUSED',reason,reportSha256:null,bundleFingerprint:null,rows:[],sha256:null,
    sourceTrust:'TRUSTED_HOST_STATEMENTS_NOT_ATTESTED',freshness:'SETTLED_SNAPSHOT_ONLY',
    persistable:false,learningEligible:false,authorizing:false});
  let incidentPreview = incidentRefusal('NO_SETTLED_RESULT');
  function resolvePreparation(candidate, taskInput = task) {
    const captured = prepareRepositoryCandidate({ baseline: preparations[0].baseline, task: taskInput,
      candidate: { files: candidate.files }, authorId: candidate.authorId });
    const original = preparations.find(p => p.fingerprint === captured.fingerprint);
    if (!original) fail('REPOSITORY_CANDIDATE_NOT_REGISTERED');
    return original;
  }
  async function invoke(stage, method, payload) {
    if (invocations.length >= 202) fail('REPOSITORY_INVOCATION_LIMIT');
    // Capture attribution BEFORE calling either owner. In particular, a Node
    // materialization error has no issued execution from which to recover it.
    const entry = { stage, binding: cloneFreeze(payload.binding), preparation: null,
      state: 'STARTED', adapterResult: null, error: null };
    invocations.push(entry);
    try {
      entry.preparation = resolvePreparation(payload.candidate, payload.task);
      const result = await method(payload);
      entry.adapterResult = cloneFreeze(result); entry.state = 'RETURNED';
      return result;
    } catch (e) { entry.state = 'ERROR'; entry.error = errorRecord(e); throw e; }
  }
  const journal = () => Object.freeze(invocations.map(e => Object.freeze({ ...e })));
  async function collect(report) {
    state = 'SETTLING';
    // allSettled retains both failures; one owner's rejection never hides the
    // other owner's still-pending work. No timeout invents a drained process.
    const results = await Promise.allSettled([Promise.resolve().then(() => staticOwner.settled()),
      Promise.resolve().then(() => testsOwner.settled())]);
    const owners = [staticOwner, testsOwner], historyErrors = [null, null], ownerStateErrors = [null, null];
    // Bad diagnostics must not discard the other owner's retained observations.
    // An empty fallback means unavailable history, NEVER an observed empty run.
    const histories = results.map((r, i) => {
      try { return closedList(r.status === 'fulfilled' ? r.value : owners[i].observations(), 101, 'REPOSITORY_HISTORY_SCHEMA'); }
      catch (e) { historyErrors[i] = errorRecord(e); return []; }
    });
    const states = owners.map((o, i) => {
      try {
        const value = o.status();
        if (!['IDLE', 'BUSY', 'QUARANTINED'].includes(value)) fail('REPOSITORY_OWNER_STATE');
        return value;
      } catch (e) { ownerStateErrors[i] = errorRecord(e); return 'UNKNOWN'; }
    });
    const ownerStates = { staticChecks: states[0], tests: states[1] };
    let bundle = null, bundleSummary = null, proposedChanges = null, bundleError = null, incidentContext = null;
    try {
      const failure = results.find(r => r.status === 'rejected'); if (failure) throw failure.reason;
      const diagnostic = [...historyErrors, ...ownerStateErrors].find(Boolean); if (diagnostic) throw diagnostic;
      if (invocations.some(e => e.state !== 'RETURNED')) fail('REPOSITORY_INCOMPLETE_INVOCATION');
      const staticCalls = invocations.filter(e => e.stage === 'staticChecks'), testCalls = invocations.filter(e => e.stage === 'tests');
      if (histories[0].length !== staticCalls.length || histories[1].length !== testCalls.length) fail('REPOSITORY_HISTORY_INVENTORY');
      for (const [i, h] of histories[0].entries()) {
        if (h.error !== null || !h.group || !h.plan ||
            h.plan.binding.preparationFingerprint !== staticCalls[i].preparation.fingerprint ||
            Object.keys(staticCalls[i].binding).some(k => h.plan.binding[k] !== staticCalls[i].binding[k])) fail('REPOSITORY_STATIC_HISTORY');
      }
      for (const [i, h] of histories[1].entries()) {
        if (h.error !== null || !h.execution || h.preparation !== testCalls[i].preparation ||
            Object.keys(testCalls[i].binding).some(k => h.execution.expected.binding[k] !== testCalls[i].binding[k])) fail('REPOSITORY_TEST_HISTORY');
      }
      const preparation = resolvePreparation(report.candidate);
      const context = { report, preparation, suite, nodeRegistrationFingerprint,
        plans: histories[0].map(h => h.plan), groups: histories[0].map(h => h.group),
        executions: histories[1].map(h => h.execution) };
      bundle = createRepositoryRunBundleV1(context); bundleSummary = readRepositoryRunBundleV1(bundle, context);
      incidentContext = context;
      if (Object.values(ownerStates).every(s => s === 'IDLE')) {
        proposedChanges = createRepositoryProposalV1({ preparation, report, bundleSummary });
      }
    } catch (e) { bundleError = errorRecord(e); bundle = null; bundleSummary = null; proposedChanges = null; }
    state = Object.values(ownerStates).every(s => s === 'IDLE') && !bundleError ? 'SETTLED' : 'QUARANTINED';
    if (state !== 'SETTLED') incidentPreview = incidentRefusal('HOST_NOT_SETTLED');
    else {
      try { incidentPreview = createRepositoryIncidentPreviewV1({bundle,context:incidentContext}); }
      catch { incidentPreview = incidentRefusal('INVALID_EVIDENCE'); }
    }
    const collected = Object.freeze({ schemaVersion: 'nisi-reviewed-repository-host-v1', report,
      invocations: journal(), staticHistory: Object.freeze([...histories[0]]), testHistory: Object.freeze([...histories[1]]),
      settlementErrors: cloneFreeze(results.map(r => r.status === 'rejected' ? errorRecord(r.reason) : null)),
      historyErrors: cloneFreeze(historyErrors), ownerStateErrors: cloneFreeze(ownerStateErrors),
      ownerStates: cloneFreeze(ownerStates), state, bundle, bundleSummary, bundleError, proposedChanges,
      applied: false, sandboxed: false, authorizing: false, certificationGranted: false });
    history.publish(collected);
    return collected;
  }
  function run(options) {
    if (state !== 'NEW') fail('REPOSITORY_HOST_ALREADY_USED');
    const optional = ['candidate', 'candidateAuthorId', 'signal', 'clock', 'reportStore'];
    exact(options, ['authorizeContext', 'author', 'reviewers', ...optional.filter(k => Object.hasOwn(options ?? {}, k))], 'REPOSITORY_RUN_SCHEMA');
    const { authorizeContext, author, reviewers, ...rest } = options;
    state = 'RUNNING';
    reportPromise = runWorkflow(task, { ...rest, adapters: { authorizeContext, author, reviewers,
      staticChecks: { check: p => invoke('staticChecks', staticOwner.check, p) },
      tests: { run: p => invoke('tests', testsOwner.run, p) } } });
    // The immutable engine report remains available independently of owner drain.
    settlement = reportPromise.then(collect);
    // Attach a handler immediately; settled() still observes any collection
    // failure. Never advertise an unhandled collection error as completion.
    settlement.catch(() => { state = 'QUARANTINED'; history.reject(); incidentPreview = incidentRefusal('HOST_NOT_SETTLED'); });
    return reportPromise;
  }
  async function settled() { if (!settlement) fail('REPOSITORY_HOST_NOT_STARTED'); return settlement; }
  return Object.freeze({ run, settled, status: () => state, invocations: journal,
    historyPreview: history.preview, captureHistory: history.capture,
    incidentPreview: () => incidentPreview,
    lateObservations: () => Object.freeze({ staticChecks: staticOwner.lateObservations(), tests: testsOwner.lateObservations() }) });
}

```

