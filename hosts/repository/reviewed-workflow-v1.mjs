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
import { createRepositoryIncidentAccessV1 } from '../../history/repository-incident-capture-v1.mjs';
import { createNativeIncidentSourcePlanV1, nativeIncidentSourceRefusalV1 } from './native-incident-source-v1.mjs';

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
  let nativeSourceContext = null;
  const incidents = createRepositoryIncidentAccessV1({getPreview: () => incidentPreview});
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
      try {
        incidentPreview = createRepositoryIncidentPreviewV1({bundle,context:incidentContext});
        // Retain original-issued references; cloning would erase issuance identity.
        nativeSourceContext = Object.freeze({bundle,context:Object.freeze({...incidentContext,
          plans:Object.freeze([...incidentContext.plans]),groups:Object.freeze([...incidentContext.groups]),
          executions:Object.freeze([...incidentContext.executions])})});
      }
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
  function nativeIncidentSourcePlan(input) {
    try {
      exact(input,['rowId'],'INVALID_INPUT');
      if(state!=='SETTLED'||nativeSourceContext===null)return nativeIncidentSourceRefusalV1('HOST_NOT_SETTLED');
      return createNativeIncidentSourcePlanV1({...nativeSourceContext,preview:incidentPreview,rowId:input.rowId});
    }catch{return nativeIncidentSourceRefusalV1('INVALID_INPUT');}
  }
  return Object.freeze({ run, settled, status: () => state, invocations: journal,
    historyPreview: history.preview, captureHistory: history.capture,
    incidentPreview: () => incidentPreview,
    nativeIncidentSourcePlan,
    createIncidentPermit: incidents.createPermit, captureIncident: incidents.capture,
    revokeIncidentPermit: incidents.revoke,
    lateObservations: () => Object.freeze({ staticChecks: staticOwner.lateObservations(), tests: testsOwner.lateObservations() }) });
}
