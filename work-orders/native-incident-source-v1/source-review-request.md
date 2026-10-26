# Private Nisi source review — Opus

Review the supplied exact source for at most five concrete correctness/privacy/identity findings. Return PASS only if no material finding in this scope; tools disabled, no execution claim. No broader repository or legal clearance. Root owns fixes.

Scope: prepare original recorded static-failure bytes for a future separately approved native rerun; this is NOT dispatch, persistence, model access or learning. Selected input must remain original failed attempt despite later repair. Original WeakMap key is in-process data access, not authorization. Refused plans unissued. Existing serialized run bundle plus ORIGINAL context valid; cloning context destroys helper issuance. Trusted host and callbacks are not a sandbox. Strict whole-preview rebinding precedes selection. Unsupported Node/operational/interrupted/PASS must refuse. Empty/exact1MiB supported; above1MiB rejected upstream before plan issuance, never truncated.

Prior design feedback adjudication: reused existing fixedProfile; canonical keyed JSON plus domain NUL hashes; already captured deep-frozen strings/arrays at creation. Accessor returns that immutable payload (not Buffer); no fresh rehash/copy required absent mutability, assess if any actual exposure changes this. No emptyArtifact or bridgeExecutable duplicate flags: byteLength0, nativeRerun NOT_RUN, executionVerified false explicit. Closed reason set rather than design examples.

Cheap tests: initial20 had5 assertion failures from oracle assumptions, retained initial-red.tap. Independent17 source checks now pass after oracle corrections including old-attempt capture; host correction/boundary tests ongoing. You have no tools, tests not supplied; review source only. Underlying createRepositoryIncidentPreviewV1 requires branded frozen preview, reconstructs full validated report and percheck identities, all row/source/payload equality under stableStringify. cloneFreeze deep freezes plain objects/arrays/strings, no Buffer exposed. exact uses data descriptors rejecting getters before reads.

## hosts/repository/native-incident-source-v1.mjs

```javascript
// PRIVATE original-source preparation, not native execution or capture permission.
// Only the issued plan's in-memory accessor exposes raw source to trusted callers.
import {cloneFreeze,sha256Text,stableStringify} from '../../workflow/contracts.mjs';
import {exact} from '../../integrity/record-utils.mjs';
import {createRepositoryIncidentPreviewV1,isIssuedRepositoryIncidentPreviewV1} from '../../history/repository-incident-candidates-v1.mjs';
import {issuedSwiftChecksV1} from '../swift-verifier/check-plan-v1.mjs';
import {fixedProfile,hashBytes,KERNEL_ARTIFACT_CAP,readNativeArtifactReport} from '../swift-verifier/protocol.mjs';

const issued=new WeakMap();
const H=(part,value)=>sha256Text('nisi/native-incident-'+part+'/v1\0'+stableStringify(value));
const incidentHash=(part,value)=>sha256Text('nisi/repository-incident-'+part+'/v1\0'+stableStringify(value));
const same=(a,b)=>stableStringify(a)===stableStringify(b);
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const codes=new Set(['INVALID_INPUT','INVALID_PREVIEW','PREVIEW_MISMATCH','ROW_MISSING','ROW_NOT_FAILURE',
  'UNSUPPORTED_STAGE','SOURCE_MISMATCH','INVALID_EVIDENCE','ARTIFACT_LIMIT','HOST_NOT_SETTLED']);
const envelope=(status,reason,selection=null,sourcePlanDigest=null)=>cloneFreeze({
  schemaVersion:'nisi-native-incident-source-plan/v1',status,reason,selection,sourcePlanDigest,
  rawContentIncluded:false,persistable:false,freshness:'ORIGINAL_SNAPSHOT_ONLY',requiresSeparateAdmission:true,
  nativeRerun:'NOT_RUN',executionVerified:false,learningEligible:false,authorizing:false});

export const nativeIncidentSourceRefusalV1=reason=>envelope('REFUSED',codes.has(reason)?reason:'INVALID_EVIDENCE');
export const isIssuedNativeIncidentSourcePlanV1=value=>issued.has(value);

export function createNativeIncidentSourcePlanV1(input){
  try{
    exact(input,['bundle','context','preview','rowId'],'INVALID_INPUT');
    const {bundle,context,preview,rowId}=input;
    if(!hex(rowId))fail('INVALID_INPUT');
    if(!isIssuedRepositoryIncidentPreviewV1(preview))fail('INVALID_PREVIEW');
    // Rebind the WHOLE preview to original-issued evidence. A selected row and
    // matching public digests alone cannot replace the original source context.
    const reconstructed=createRepositoryIncidentPreviewV1({bundle,context});
    if(!same(preview,reconstructed))fail('PREVIEW_MISMATCH');
    const row=preview.rows.find(r=>r.rowId===rowId);
    if(!row)fail('ROW_MISSING');
    if(row.binding.stage!=='staticChecks')fail('UNSUPPORTED_STAGE');
    if(row.classification!=='FAILURE_CANDIDATE'||row.reason!=='RECORDED_FAILURE'||
      row.rawStatus!=='FAIL'||row.stageStatus!=='FAIL'||row.disposition!=='RESULT_RECORDED')fail('ROW_NOT_FAILURE');
    const matching=context.plans.filter(p=>p.fingerprint===row.source.planFingerprint);
    if(matching.length!==1)fail('SOURCE_MISMATCH');
    const plan=matching[0],index=context.plans.indexOf(plan),check=issuedSwiftChecksV1(plan)[row.binding.checkIndex];
    const group=bundle.staticBundle.entries[index],child=group?.group.entries[row.binding.checkIndex];
    if(!check||!child||child.dispatch!=='OBSERVED')fail('SOURCE_MISMATCH');
    const b=check.expected.binding,p=check.preparation,header=check.request.header;
    for(const key of ['runId','taskFingerprint','baselineFingerprint','attempt','candidateFingerprint','stage'])
      if(b[key]!==row.binding[key])fail('SOURCE_MISMATCH');
    if(b.preparationFingerprint!==p.fingerprint||b.materializedFingerprint!==p.materializedFingerprint||
      row.source.preparationFingerprint!==p.fingerprint||row.source.materializedFingerprint!==p.materializedFingerprint||
      row.source.expectationFingerprint!==check.expected.fingerprint||
      row.source.groupFingerprint!==group.group.fingerprint)fail('SOURCE_MISMATCH');
    const file=p.materialized.files.find(f=>f.path===check.target.path);
    if(!file||!file.content.isWellFormed())fail('SOURCE_MISMATCH');
    const bytes=Buffer.from(file.content,'utf8');
    if(bytes.length>KERNEL_ARTIFACT_CAP)fail('ARTIFACT_LIMIT');
    if(file.byteLength!==bytes.length||file.sha256!==hashBytes(bytes)||
      row.subject.kind!=='FILE'||row.subject.pathSha256!==incidentHash('path',file.path)||
      row.binding.subjectKey!==row.subject.pathSha256||row.subject.contentSha256!==file.sha256||
      check.target.artifactSha256!==file.sha256||check.target.artifactByteLength!==bytes.length||
      header.path!==file.path||header.artifactSha256!==file.sha256||
      header.preparationFingerprint!==p.fingerprint||check.request.artifactByteLength!==bytes.length)fail('SOURCE_MISMATCH');
    const fixed=fixedProfile(check.target.profileId);
    if(!same(fixed,check.request.profile)||header.rulesFingerprint!==fixed.rulesFingerprint||
      row.source.rulesetSha256!==fixed.rulesFingerprint)fail('SOURCE_MISMATCH');
    const profile={...fixed,allowedAdvisoryDimensions:[],modelParticipationRequired:false,maximumAdvisoryDimensions:0};
    const priorReport=readNativeArtifactReport(Buffer.from(child.stdoutHex,'hex'),check.request).report;
    if(priorReport.status!=='FAIL')fail('SOURCE_MISMATCH');
    const priorTranscriptSha256=H('prior-transcript',priorReport.outcomes);
    const body={schemaVersion:'nisi-native-incident-source-input/v1',rowId:row.rowId,rowFingerprint:row.fingerprint,
      previewSha256:preview.sha256,binding:row.binding,source:row.source,
      artifact:{relativePath:file.path,content:file.content,sha256:file.sha256,byteLength:bytes.length},
      profile,priorReport,priorTranscriptSha256};
    const inputSha256=H('source-input',body);
    const selection={rowId:row.rowId,rowFingerprint:row.fingerprint,previewSha256:preview.sha256,
      binding:row.binding,source:row.source,profile,artifactByteLength:bytes.length,priorTranscriptSha256,inputSha256};
    const sourcePlanDigest=H('source-plan',selection),result=envelope('SOURCE_BOUND',null,selection,sourcePlanDigest);
    issued.set(result,cloneFreeze({...body,inputSha256,sourcePlanDigest}));
    return result;
  }catch(error){return nativeIncidentSourceRefusalV1(codes.has(error?.code)?error.code:'INVALID_EVIDENCE');}
}

export function readNativeIncidentSourceInputV1(input){
  exact(input,['plan'],'NATIVE_SOURCE_INPUT_SCHEMA');
  const payload=issued.get(input.plan);
  if(!payload)fail('NATIVE_SOURCE_NOT_ISSUED');
  return payload;
}

```

## hosts/repository/reviewed-workflow-v1.mjs

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

```

## hosts/swift-verifier/protocol.mjs

```javascript
// PRIVATE native-kernel seam, not a process runner or a public API.
// A valid report is structurally consistent evidence, not authenticated execution.
import { createHash } from 'node:crypto';
import { cloneFreeze, sha256Text } from '../../workflow/contracts.mjs';
import { canonicalizeJSONV1 } from '../../canonical/canonical-json-v1.mjs';
import { isIssuedRepositoryPreparation } from '../repository/snapshot-contract.mjs';

export const KERNEL_SCHEMA = 'nisi-swift-artifact-v1';
export const KERNEL_ARTIFACT_CAP = 1_048_576;
export const KERNEL_OUTPUT_CAP = 16_384;
export const KERNEL_HEADER_CAP = 4096;
const issued = new WeakSet();
const refuse = code => { throw Object.assign(new Error(code), { code }); };
export const hashBytes = bytes => createHash('sha256').update(bytes).digest('hex');
const isDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const definitions = Object.freeze({
  'nisi-json-structure-v1': { kind: 'json', sections: [] },
  'nisi-markdown-sections-v1': { kind: 'markdown', sections: ['Rollback', 'Testing'] },
  'nisi-text-structure-v1': { kind: 'text', sections: [] },
});

export function fixedProfile(id) {
  if (typeof id !== 'string' || !Object.hasOwn(definitions, id)) refuse('SWIFT_PROFILE_UNSUPPORTED');
  const definition = definitions[id];
  // Exact retained Swift CheckProfile.rulesFingerprint encoding; no new hash domain
  // is substituted for the original versioned rules identity.
  const encode = s => `${Buffer.byteLength(s, 'utf8')}:${s}`;
  const fields = ['veritas-check-profile-rules-v1', 'PROFILE_ADMITTED', id].map(encode);
  fields.push(definition.sections.map(encode).join(''), '', encode('model-optional'), encode('0'));
  return cloneFreeze({ id, kind: definition.kind, requiredSections: definition.sections,
    rulesFingerprint: sha256Text(fields.join('|')) });
}

// Host-provided digest is an opaque correlation field, not an execution grant.
// The future runner must issue/recheck its actual expectation and process receipt.
export function createNativeArtifactRequest(input) {
  const descriptors = Object.getOwnPropertyDescriptors(input ?? {});
  const names = ['preparation', 'path', 'profileId', 'expectationFingerprint', 'sourceFingerprint'];
  if (!input || ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
      Reflect.ownKeys(descriptors).length !== names.length || names.some(n =>
        !descriptors[n]?.enumerable || !Object.hasOwn(descriptors[n], 'value'))) refuse('SWIFT_REQUEST_SCHEMA');
  const values = Object.fromEntries(names.map(n => [n, descriptors[n].value]));
  if (!isIssuedRepositoryPreparation(values.preparation)) refuse('SWIFT_PREPARATION_NOT_ISSUED');
  if (!isDigest(values.expectationFingerprint) || !isDigest(values.sourceFingerprint)) refuse('SWIFT_REQUEST_IDENTITY');
  const file = values.preparation.materialized.files.find(f => f.path === values.path);
  if (!file) refuse('SWIFT_ARTIFACT_NOT_IN_PREPARATION');
  const profile = fixedProfile(values.profileId);
  const artifact = Buffer.from(file.content, 'utf8');
  if (artifact.length > KERNEL_ARTIFACT_CAP) refuse('SWIFT_ARTIFACT_LIMIT');
  const header = { schemaVersion: KERNEL_SCHEMA, expectationFingerprint: values.expectationFingerprint,
    preparationFingerprint: values.preparation.fingerprint, path: file.path,
    artifactSha256: hashBytes(artifact), profileId: profile.id,
    rulesFingerprint: profile.rulesFingerprint, sourceFingerprint: values.sourceFingerprint };
  const headerBytes = Buffer.from(JSON.stringify(header));
  if (headerBytes.length > KERNEL_HEADER_CAP) refuse('SWIFT_HEADER_LIMIT');
  const prefix = Buffer.alloc(4); prefix.writeUInt32BE(headerBytes.length);
  const frame = Buffer.concat([prefix, headerBytes, artifact]);
  const request = cloneFreeze({ header, profile, artifactByteLength: artifact.length,
    requestSha256: hashBytes(frame), frameHex: frame.toString('hex'), authorizing: false });
  issued.add(request);
  return request;
}

function exact(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
}

export function readNativeArtifactReport(bytes, request) {
  if (!issued.has(request)) refuse('SWIFT_REQUEST_NOT_ISSUED');
  if (!Buffer.isBuffer(bytes) || bytes.length < 2 || bytes.length > KERNEL_OUTPUT_CAP ||
      bytes[0] !== 123 || bytes.at(-2) !== 125 || bytes.at(-1) !== 10 ||
      bytes.subarray(0, -1).includes(10)) refuse('SWIFT_RESPONSE_FRAME');
  let report;
  try { report = JSON.parse(canonicalizeJSONV1(bytes).canonical); }
  catch { refuse('SWIFT_RESPONSE_JSON'); }
  const names = ['schemaVersion', 'expectationFingerprint', 'preparationFingerprint', 'path',
    'artifactSha256', 'profileId', 'rulesFingerprint', 'sourceFingerprint', 'requestSha256',
    'artifactByteLength', 'status', 'outcomes', 'authorizing'];
  if (!exact(report, names)) refuse('SWIFT_RESPONSE_SCHEMA');
  for (const [key, value] of Object.entries(request.header)) {
    if (report[key] !== value) refuse('SWIFT_RESPONSE_IDENTITY');
  }
  if (report.requestSha256 !== request.requestSha256 || report.artifactByteLength !== request.artifactByteLength ||
      report.authorizing !== false) refuse('SWIFT_RESPONSE_IDENTITY');
  const outcomes = report.outcomes;
  if (!Array.isArray(outcomes) || outcomes.length !== 3 || outcomes.some(o =>
      !exact(o, ['id', 'status', 'explanation']) || typeof o.explanation !== 'string' ||
      o.explanation.trim().length === 0 || Buffer.byteLength(o.explanation) > 1024)) refuse('SWIFT_OUTCOMES_SCHEMA');
  const structure = request.profile.kind === 'json' ? 'DET-003-JSON-STRUCTURE' : 'DET-003-REQUIRED-SECTIONS';
  if (outcomes[0].id !== 'DET-001-NONEMPTY' || outcomes[1].id !== 'DET-002-UTF8' ||
      outcomes[2].id !== structure) refuse('SWIFT_OUTCOMES_INVENTORY');
  // Issued preparations contain well-formed UTF-8 and are bounded; a different
  // native inventory/UTF8 result signals disagreement, never a downgraded PASS.
  if (outcomes[0].status !== (request.artifactByteLength === 0 ? 'FAIL' : 'PASS') ||
      outcomes[1].status !== 'PASS' || !['PASS', 'FAIL'].includes(outcomes[2].status)) refuse('SWIFT_OUTCOMES_STATUS');
  const derived = outcomes.some(o => o.status === 'FAIL') ? 'FAIL' : 'PASS';
  if (report.status !== derived) refuse('SWIFT_AGGREGATE_STATUS');
  return cloneFreeze({ report, consistency: 'CONSISTENT', executionVerified: false, authorizing: false });
}

```

## hosts/swift-verifier/check-plan-v1.mjs

```javascript
// PRIVATE fixed-checker group plan. Issuance is in-process identity, not permission.
// Covers every file in the DECLARED materialized snapshot, not an entire disk tree.
import { cloneFreeze, sha256Text, stableStringify } from '../../workflow/contracts.mjs';
import { exact } from '../../integrity/record-utils.mjs';
import { isIssuedRepositoryPreparation } from '../repository/snapshot-contract.mjs';
import { createExecutionExpectation } from '../../receipts/repository-execution-v1.mjs';
import { createNativeArtifactRequest, fixedProfile } from './protocol.mjs';
import { closedList } from './group-contract-utils.mjs';

export const SWIFT_GROUP_LIMIT = 64;
const issued = new WeakMap();
const fail = code => { throw Object.assign(new Error(code), { code }); };
const hash = (domain, value) => sha256Text(domain + '\0' + stableStringify(value));

export function createSwiftCheckPlanV1(input) {
  exact(input, ['preparation', 'runId', 'attempt', 'targets', 'executionProfile'], 'SWIFT_PLAN_SCHEMA');
  const { preparation: p, runId, attempt } = input;
  if (!isIssuedRepositoryPreparation(p)) fail('SWIFT_PLAN_PREPARATION');
  const targets = closedList(input.targets, SWIFT_GROUP_LIMIT, 'SWIFT_PLAN_INVENTORY');
  exact(input.executionProfile, ['sourceSha256', 'buildSha256', 'executableSha256', 'argv', 'environmentSha256',
    'cwd', 'platform', 'architecture', 'timeoutMs', 'maximumOutputBytes'], 'SWIFT_PLAN_PROFILE_SCHEMA');
  closedList(input.executionProfile.argv, 0, 'SWIFT_PLAN_PROFILE_SCHEMA');
  const baseProfile = cloneFreeze(input.executionProfile);
  if (baseProfile.platform !== 'darwin' || baseProfile.architecture !== 'arm64' ||
      baseProfile.timeoutMs > 60000 || baseProfile.maximumOutputBytes !== 16384) fail('SWIFT_PLAN_PROFILE_INVALID');
  if (targets.length < 1 ||
      targets.length !== p.materialized.files.length) fail('SWIFT_PLAN_INVENTORY');
  const byPath = new Map();
  for (const target of targets) {
    exact(target, ['path', 'profileId'], 'SWIFT_PLAN_TARGET_SCHEMA');
    if (typeof target.path !== 'string' || byPath.has(target.path)) fail('SWIFT_PLAN_DUPLICATE');
    fixedProfile(target.profileId); byPath.set(target.path, target.profileId);
  }
  const selected = p.materialized.files.map(file => {
    if (!byPath.has(file.path)) fail('SWIFT_PLAN_INVENTORY');
    return { path: file.path, profileId: byPath.get(file.path), artifactSha256: file.sha256, artifactByteLength: file.byteLength };
  });
  const binding = { schemaVersion: 1, runId, taskFingerprint: p.taskFingerprint, attempt,
    candidateFingerprint: p.candidateFingerprint, baselineFingerprint: p.baselineFingerprint,
    materializedFingerprint: p.materializedFingerprint, preparationFingerprint: p.fingerprint, stage: 'staticChecks' };
  const identity = { schemaVersion: 'nisi-swift-check-plan-v1', binding, executionProfile: baseProfile, targets: selected };
  const fingerprint = hash('nisi/swift-check-plan/v1', identity);
  const checks = selected.map((target, index) => {
    const profile = fixedProfile(target.profileId);
    const checkId = 'nisi.swift.group.' + hash('nisi/swift-check-child/v1', { planFingerprint: fingerprint, index, path: target.path });
    const expected = createExecutionExpectation({ preparation: p, runId, attempt, checkId, stage: 'staticChecks',
      profile: { ...baseProfile, id: profile.id, version: 1, rulesetSha256: profile.rulesFingerprint } });
    const request = createNativeArtifactRequest({ preparation: p, path: target.path, profileId: target.profileId,
      expectationFingerprint: expected.fingerprint, sourceFingerprint: expected.profile.sourceSha256 });
    return Object.freeze({ expected, request, preparation: p, target: cloneFreeze(target) });
  });
  const plan = cloneFreeze({ ...identity, fingerprint, authorizing: false });
  issued.set(plan, Object.freeze(checks));
  return plan;
}

export function issuedSwiftChecksV1(plan) {
  const checks = issued.get(plan);
  if (!checks) fail('SWIFT_PLAN_NOT_ISSUED');
  return checks;
}

```

## receipts/repository-run-v1.mjs

```javascript
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

```

