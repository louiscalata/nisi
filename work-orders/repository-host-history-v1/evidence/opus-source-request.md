# Private exact-source review

Review ONLY the two supplied current source files for the new actual-host history integration. Tools disabled, no repository access. 30 independent integration groups pass after a stub failed29/30, but that is not proof: identify up to5 actual correctness/privacy/one-attempt/lifecycle defects with exact function and proposed repair. Return PASS only if none found, otherwise FAIL. Do not restate speculative features as bugs. No code was executed by you.

Required: new historyPreview/captureHistory on actual host, no change to existing report/settled identity/schema/state; after collected result only; explicit separate written declaration matching metadata digest; no authenticated consent or native attestation; no raw source/path/arbitrary diagnostic messages; diagnostic code hashes allowed. Existing readFinalEngineReportV2 is closed final linkage validator, NOT complete stage attestation. Source hashes identify snapshots, not authority. Early preflight runId:null refused INVALID_REPORT; valid UUID with null candidate uses explicit none:UUID marker and null/false body, actual candidates cand:hex. LearningEligible alwaysfalse. One actual record attempt only, consumed before entering record even for REFUSED/failure; busy before clocks; inspect success SNAPSHOT, not INSPECTED. Wrong-project cannot be prechecked because owner config private; actual record refusal consumes. No native incident admission, publication, auto cleanup or live-store scope. Internal helper publish/reject only trusted host seam, never exposed on actual host; synthetic fabricated helper inputs cannot attest source. Journal owner v2 unchanged has fully frozen results; record returns RECORDED/DUPLICATE/CONFLICT/STORE_CONFLICT/STORE_FAILED/REFUSED. Unknown/throw after admission must not imply rollback. Non-durable actual writes must not become durable claims. Contract codes/counts and exact actual response mapping prevail over prior conceptual suggestions.

## history/repository-host-history-v1.mjs
SHA256 e72b514e73ac3059a759b21c71341450e1e99d353352843b7e3ef4d13ea779c8
```javascript
// PRIVATE trusted host integration, not authenticated consent or native evidence.
// The real host exposes preview/capture only. Publication is an internal seam;
// caller-supplied settlements through that seam cannot attest execution.
import {cloneFreeze, stableStringify, sha256Text} from '../workflow/contracts.mjs';
import {exact} from '../integrity/record-utils.mjs';
import {readFinalEngineReportV2} from '../receipts/host-run-bundle-v2.mjs';
import {inspectJournalOwner, recordJournalObservation} from './journal-owner-v2.mjs';

const fail = code => { throw Object.assign(new Error(code), {code}); };
const hex = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
const time = value => Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
const hash = (domain, value) => sha256Text(domain + '\0' + stableStringify(value));
const data = (value, key) => {
  if (value === null || typeof value !== 'object') fail('INVALID_SETTLEMENT');
  const d = Object.getOwnPropertyDescriptor(value, key);
  if (!d || !d.enumerable || !Object.hasOwn(d, 'value')) fail('INVALID_SETTLEMENT');
  return d.value;
};
const CODE_DOMAIN = 'nisi/repository-history-code/v1';
const PREVIEW_DOMAIN = 'nisi/repository-history-preview/v1';
const DECLARATION_DOMAIN = 'nisi/repository-history-declaration/v1';
const DECLARATION_KEYS = ['schemaVersion','declarationId','projectId','sourceDigest',
  'issuedAt','expiresAt','createdAt','retentionMs','consentClass','destination',
  'rawContentPersisted','networkEgress','learningInfluence'];

function codeHash(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 ||
      !value.isWellFormed() || value.includes('\0')) fail('INVALID_SETTLEMENT');
  return sha256Text(CODE_DOMAIN + '\0' + value);
}
function errorHash(value) { return value === null ? null : codeHash(data(value, 'code')); }
function errorPair(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length !== 2 || Reflect.ownKeys(value).length !== 3) fail('INVALID_SETTLEMENT');
  return [errorHash(data(value, '0')), errorHash(data(value, '1'))];
}
function previewResult(reason, preview = null) {
  return Object.freeze({schemaVersion: 'nisi-repository-history-preview/v1',
    status: reason === null ? 'PREVIEW' : 'REFUSED', reason, preview,
    sha256: preview === null ? null : hash(PREVIEW_DOMAIN, preview), authorizing: false});
}
function project(result, taskFingerprint, baselineFingerprint) {
  let report;
  try { report = readFinalEngineReportV2(data(result, 'report')); }
  catch (error) {
    return previewResult(error?.code === 'HOST_V2_STAGES_INVALID' ? 'INVALID_SETTLEMENT' : 'INVALID_REPORT');
  }
  if (report.taskFingerprint !== taskFingerprint) return previewResult('TASK_IDENTITY_MISMATCH');
  try {
    if (data(result, 'schemaVersion') !== 'nisi-reviewed-repository-host-v1' ||
        ['applied','sandboxed','authorizing','certificationGranted'].some(k => data(result, k) !== false))
      fail('INVALID_SETTLEMENT');
    const hostState = data(result, 'state');
    if (!['SETTLED','QUARANTINED'].includes(hostState)) fail('INVALID_SETTLEMENT');
    const states = data(result, 'ownerStates');
    exact(states, ['staticChecks','tests'], 'INVALID_SETTLEMENT');
    const ownerStates = {staticChecks: states.staticChecks, tests: states.tests};
    if (Object.values(ownerStates).some(s => !['IDLE','BUSY','QUARANTINED','UNKNOWN'].includes(s)))
      fail('INVALID_SETTLEMENT');
    const stageCounts = {PASS:0, FAIL:0, NOT_RUN:0, UNAVAILABLE:0, REPAIRED:0, NO_CHANGE:0};
    for (const stage of report.stages) {
      if (!Object.hasOwn(stageCounts, stage.status)) fail('INVALID_SETTLEMENT');
      stageCounts[stage.status]++;
    }
    const summary = data(result, 'bundleSummary');
    let bundleFingerprint = null;
    if (summary !== null) {
      if (data(summary, 'status') !== 'CONSISTENT' || !hex(data(summary, 'fingerprint')))
        fail('INVALID_SETTLEMENT');
      bundleFingerprint = data(summary, 'fingerprint');
    }
    const preview = cloneFreeze({schemaVersion:'nisi-repository-history-observation/v1',
      taskFingerprint, baselineFingerprint, runId: report.runId, attempt: report.repairAttempts,
      candidateFingerprint: report.candidateFingerprint, candidatePresent: report.candidateFingerprint !== null,
      outcome: report.outcome, workflowOutcome: report.workflowOutcome, hostState, ownerStates,
      stageCounts, stageTotal: report.stages.length,
      diagnostics: {reportCodeSha256: codeHash(report.code), reportStoreCodeSha256: codeHash(report.reportStoreCode),
        bundleCodeSha256: errorHash(data(result, 'bundleError')),
        settlementCodeSha256: errorPair(data(result, 'settlementErrors')),
        historyCodeSha256: errorPair(data(result, 'historyErrors')),
        ownerStateCodeSha256: errorPair(data(result, 'ownerStateErrors'))},
      bundleFingerprint, sourceAuthenticityAttested:false, executionAttested:false,
      learningEligible:false, authorizing:false});
    if (Buffer.byteLength(stableStringify(preview), 'utf8') > 16384) fail('INVALID_SETTLEMENT');
    return previewResult(null, preview);
  } catch { return previewResult('INVALID_SETTLEMENT'); }
}
function declarationOf(value) {
  exact(value, DECLARATION_KEYS, 'INVALID_INPUT');
  const d = Object.fromEntries(DECLARATION_KEYS.map(k => [k, value[k]]));
  if (d.schemaVersion !== 'nisi-repository-history-declaration/v1' ||
      !id(d.declarationId) || !id(d.projectId) || !hex(d.sourceDigest) ||
      ![d.issuedAt,d.expiresAt,d.createdAt,d.retentionMs].every(time) ||
      d.expiresAt <= d.issuedAt || d.expiresAt - d.issuedAt > 3600000 ||
      d.retentionMs < 1 || d.retentionMs > 7776000000 || !time(d.createdAt + d.retentionMs) ||
      d.consentClass !== 'WRITTEN_DECLARATION' || d.destination !== 'LOCAL_OBSERVATION_JOURNAL_ONLY' ||
      d.rawContentPersisted !== false || d.networkEgress !== false || d.learningInfluence !== false)
    fail('INVALID_INPUT');
  return Object.freeze(d);
}
function readClock(clock, declaration, previous = null) {
  let now;
  try { now = clock(); } catch { return {reason:'INVALID_CLOCK'}; }
  if (!time(now) || previous !== null && now < previous) return {reason:'INVALID_CLOCK'};
  if (now < declaration.issuedAt) return {reason:'NOT_YET_VALID'};
  if (now >= declaration.expiresAt) return {reason:'DECLARATION_EXPIRED'};
  if (now < declaration.createdAt) return {reason:'OBSERVATION_IN_FUTURE'};
  if (now >= declaration.createdAt + declaration.retentionMs) return {reason:'OBSERVATION_EXPIRED'};
  return {reason:null, now};
}

export function createRepositoryHistoryAccessV1(input) {
  exact(input, ['taskFingerprint','baselineFingerprint'], 'REPOSITORY_HISTORY_CONFIG');
  const {taskFingerprint, baselineFingerprint} = input;
  if (!hex(taskFingerprint) || !hex(baselineFingerprint)) fail('REPOSITORY_HISTORY_CONFIG');
  let published = false, rejected = false, collected = null, cached = null, busy = false, consumed = false;
  function publish(result) {
    if (published || rejected) fail('REPOSITORY_HISTORY_ALREADY_PUBLISHED');
    collected = result; published = true;
  }
  function reject() { if (!published) rejected = true; }
  function preview() {
    if (!published) return previewResult(rejected ? 'SETTLEMENT_REJECTED' : 'NO_SETTLED_RESULT');
    return cached ??= project(collected, taskFingerprint, baselineFingerprint);
  }
  function capture(input) {
    let sourceDigest = null, declarationDigest = null, recordAttempted = false;
    const output = (status, reason, journal = null) => Object.freeze({
      schemaVersion:'nisi-repository-history-capture/v1', status, reason, recordAttempted,
      consumed, sourceDigest, declarationDigest, journal, authorizing:false});
    if (!published) return output('REFUSED', rejected ? 'SETTLEMENT_REJECTED' : 'NO_SETTLED_RESULT');
    if (consumed) return output('REFUSED', 'ALREADY_CAPTURED');
    if (busy) return output('REFUSED', 'BUSY');
    let req, d;
    try {
      exact(input, ['owner','declaration','clock'], 'INVALID_INPUT');
      req = {owner:input.owner, clock:input.clock};
      if (typeof req.clock !== 'function') fail('INVALID_INPUT');
      d = declarationOf(input.declaration);
    } catch { return output('REFUSED', 'INVALID_INPUT'); }
    const p = preview();
    if (p.status !== 'PREVIEW') return output('REFUSED', p.reason);
    sourceDigest = p.sha256;
    if (d.sourceDigest !== sourceDigest) return output('REFUSED', 'SOURCE_DIGEST_MISMATCH');
    declarationDigest = hash(DECLARATION_DOMAIN, d);
    const inspected = inspectJournalOwner({owner:req.owner});
    if (inspected.status !== 'SNAPSHOT') return output('REFUSED', 'INVALID_OWNER');
    if (inspected.snapshot.state === 'SEALED') return output('REFUSED', 'OWNER_SEALED');
    if (inspected.snapshot.state === 'COMMIT_UNCERTAIN') return output('REFUSED', 'COMMIT_UNCERTAIN');
    busy = true;
    try {
      const initial = readClock(req.clock, d);
      if (initial.reason) return output('REFUSED', initial.reason);
      const body = p.preview;
      const entry = {id:'rh1.' + sha256Text('nisi/repository-history-id/v1\0' + sourceDigest),
        projectId:d.projectId, runId:body.runId, attempt:body.attempt,
        candidateId:body.candidatePresent ? 'cand:' + body.candidateFingerprint : 'none:' + body.runId,
        stage:'REPOSITORY_SETTLEMENT', receiptId:null, createdAt:d.createdAt, ttlMs:d.retentionMs,
        state:body.outcome === 'CANCELLED' ? 'CANCELLED' : body.outcome === 'COMPLETED' && body.hostState === 'SETTLED' ? 'SUCCEEDED' : 'FAILED',
        heartbeatAt:null, retryOf:null, revokes:null,
        payload:{preview:body, sourceDigest, declarationDigest}};
      const final = readClock(req.clock, d, initial.now);
      if (final.reason) return output('REFUSED', final.reason);
      // One record attempt, including refusal/failure. No callback can refund it.
      consumed = true; recordAttempted = true;
      const journal = recordJournalObservation({owner:req.owner, entry, now:final.now});
      let status;
      switch (journal.status) {
        case 'RECORDED': status = 'STORED'; break;
        case 'DUPLICATE': status = 'DUPLICATE'; break;
        case 'CONFLICT': case 'STORE_CONFLICT': status = 'CONFLICT'; break;
        case 'REFUSED': status = 'REFUSED'; break;
        case 'STORE_FAILED': status = journal.snapshot.state === 'COMMIT_UNCERTAIN' ? 'UNCERTAIN' : 'STORE_FAILED'; break;
        default: return output('REFUSED', 'INTERNAL_ERROR');
      }
      return output(status, journal.reason, journal);
    } catch { return output('REFUSED', 'INTERNAL_ERROR'); }
    finally { busy = false; }
  }
  return Object.freeze({publish, reject, preview, capture});
}

```

## hosts/repository/reviewed-workflow-v1.mjs
SHA256 6b53aa8d6d88039c7905baebc2621402ad7cce4ecc23d5fa5574e4b32d881079
```javascript
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
    let bundle = null, bundleSummary = null, proposedChanges = null, bundleError = null;
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
      if (Object.values(ownerStates).every(s => s === 'IDLE')) {
        proposedChanges = createRepositoryProposalV1({ preparation, report, bundleSummary });
      }
    } catch (e) { bundleError = errorRecord(e); bundle = null; bundleSummary = null; proposedChanges = null; }
    state = Object.values(ownerStates).every(s => s === 'IDLE') && !bundleError ? 'SETTLED' : 'QUARANTINED';
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
    settlement.catch(() => { state = 'QUARANTINED'; history.reject(); });
    return reportPromise;
  }
  async function settled() { if (!settlement) fail('REPOSITORY_HOST_NOT_STARTED'); return settlement; }
  return Object.freeze({ run, settled, status: () => state, invocations: journal,
    historyPreview: history.preview, captureHistory: history.capture,
    lateObservations: () => Object.freeze({ staticChecks: staticOwner.lateObservations(), tests: testsOwner.lateObservations() }) });
}

```

