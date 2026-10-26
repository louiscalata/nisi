// Private integration, not an app permission API. The caller must obtain exact
// approval for the reviewed binary and fixed AFM experiment before invoking it.
// No task/model/argv/endpoint/executor override. A hash is not an approval.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {canonicalizeMAC1JSONV1} from '../canonical/mac1-json-v1.mjs';
import {createScheduledRunOwner} from './scheduled-run-owner.mjs';
import {makeBn01Fixture, fixtureBytes} from './bn01-fixture.mjs';
import {makeDualFixture, canonicalFixtureBytes} from './dual-face-fixture.mjs';
import {validateSchedulerAdmission} from './scheduled-reference-probe.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Buffer.from(canonicalizeMAC1JSONV1(Buffer.from(JSON.stringify(value))).canonical);
const requireThat = (value, reason) => { if (!value) throw Error(reason); };
const hex = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const exact = (value, names) => requireThat(value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join('|') === names.split(' ').sort().join('|'), 'EVIDENCE_SCHEMA');
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function seal(value) {
  const resultSHA256 = sha(Buffer.concat([Buffer.from('veritas/scheduled-afm-observation/v1\0'),canonical(value)]));
  return freeze({...value,resultSHA256});
}
const fixedText = '{"purpose":"bounded local orchestration evidence","authority":"none"}';
const subjectDigest = sha(fixedText), profileID = 'veritas-afm-functional-probe-v1';
const tagged = value => Buffer.byteLength(value) + ':' + value;
const profileFingerprint = sha(['veritas-check-profile-rules-v1', 'PROFILE_ADMITTED', profileID].map(tagged)
  .concat(['', tagged('risk'), tagged('model-required'), tagged('1')]).join('|'));
const requestDigests = [
  {subjectDigest, artifactKind:'json', profileFingerprint},
  {subjectDigest, artifactKind:'json', excerpt:fixedText, permittedDimensionNames:['risk'], minimumDimensions:1, maximumDimensions:1},
  {subjectDigest, dimension:'risk', excerpt:fixedText}
].map(value => sha(canonical(value)));

// This reader recomputes identities of fixed inputs and the receipt. Response
// digests remain reported commitments: no transcript, semantic regrading or
// protected model/process attestation is available in this format.
export function validateAFMProbeEvidence(raw) {
  requireThat(Buffer.isBuffer(raw) && raw.length > 1 && raw.length <= 16384
    && !(raw.buffer instanceof SharedArrayBuffer) && raw.at(-1) === 10, 'EVIDENCE_BYTES');
  const value = JSON.parse(canonicalizeMAC1JSONV1(raw.subarray(0, -1)).canonical);
  exact(value, 'schemaVersion status evidenceClass target subjectDigest profileFingerprint deterministicChecks deterministicPassed modelParticipation disposition advisoryReceiptDigest advisoryReceipt quiescent limitationCodes rawArtifactPersisted transcriptPersisted externalToolsEnabled acceptanceAuthorityGranted');
  requireThat(value.schemaVersion === 1 && value.status === 'PASS'
    && value.evidenceClass === 'SELF_ADMINISTERED_NATIVE_AFM_FUNCTIONAL_PROBE'
    && value.target === 'macOS 27.0+ · Apple Silicon · arm64 only'
    && value.subjectDigest === subjectDigest && value.profileFingerprint === profileFingerprint, 'EVIDENCE_IDENTITY');
  requireThat(value.deterministicPassed === true && value.modelParticipation === 'PARTICIPATED'
    && value.disposition === 'READY' && value.quiescent === true, 'EVIDENCE_COMPLETION');
  requireThat(['rawArtifactPersisted','transcriptPersisted','externalToolsEnabled','acceptanceAuthorityGranted']
    .every(key => value[key] === false), 'EVIDENCE_AUTHORITY');
  requireThat(JSON.stringify(value.limitationCodes) === JSON.stringify([
    'MODEL_FINDINGS_NON_AUTHORIZING', 'PROTOTYPE_IN_MEMORY_ACCEPTANCE_ONLY']), 'EVIDENCE_LIMITATIONS');
  const checks = [
    ['DET-001-NONEMPTY','The artifact contains bytes.'],
    ['DET-002-UTF8','The complete snapshot decodes as UTF-8.'],
    ['DET-003-JSON-STRUCTURE','The snapshot is a JSON object or array.']
  ];
  requireThat(Array.isArray(value.deterministicChecks) && value.deterministicChecks.length === checks.length, 'EVIDENCE_CHECKS');
  value.deterministicChecks.forEach((check,i) => {
    exact(check, 'id status explanation');
    requireThat(check.id === checks[i][0] && check.status === 'PASS' && check.explanation === checks[i][1], 'EVIDENCE_CHECKS');
  });
  const receipt = value.advisoryReceipt;
  exact(receipt, 'schemaVersion subjectDigest artifactKind profileFingerprint provider route adapterContractVersion modelIdentityStatus runtimeFingerprint nonAuthorizing outcome reasonCode stages');
  requireThat(receipt.schemaVersion === 1 && receipt.subjectDigest === subjectDigest && receipt.artifactKind === 'json'
    && receipt.profileFingerprint === profileFingerprint && receipt.provider === 'apple-foundation-models'
    && receipt.route === 'system-on-device-requested' && receipt.adapterContractVersion === 'apple-foundation-advisory-v1'
    && receipt.modelIdentityStatus === 'MODEL_ID_NOT_EXPOSED_BY_API' && hex(receipt.runtimeFingerprint)
    && receipt.nonAuthorizing === true && receipt.outcome === 'COMPLETED' && receipt.reasonCode === null, 'RECEIPT_IDENTITY');
  requireThat(Array.isArray(receipt.stages) && receipt.stages.length === 3, 'RECEIPT_STAGES');
  receipt.stages.forEach((stage,i) => {
    exact(stage, 'ordinal stage outcome requestDigest responseDigest reasonCode');
    requireThat(stage.ordinal === i && stage.stage === ['PROBE','PLAN','FINDING'][i]
      && stage.outcome === 'OBSERVED' && stage.reasonCode === null
      && stage.requestDigest === requestDigests[i] && hex(stage.responseDigest), 'RECEIPT_STAGES');
  });
  requireThat(hex(value.advisoryReceiptDigest) && value.advisoryReceiptDigest === sha(canonical(receipt)), 'RECEIPT_DIGEST');
  return freeze(value);
}

let active = false;
let serviceCompletionUnknown = false;
const limits = Object.freeze({maxStdoutBytes:16384, maxStderrBytes:0, workflowSlots:1,
  modelServiceOccupancy:'NOT_MEASURED', modelServiceDeadline:'NOT_GUARANTEED'});
const baseResult = () => ({schemaVersion:1, authorizing:false, productionAdmission:false,
  appIntegrated:false, globalGovernor:false, modelIdentityAttested:false,
  binaryIdentityScope:'PATHNAME_OBSERVATION_ONLY', executedImageSHA256:null, limits});

function inspectBinary(binary, expected) {
  const fd = fs.openSync(binary, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    requireThat(stat.isFile() && stat.uid === process.getuid() && stat.nlink === 1
      && stat.size > 0 && stat.size <= 64000000 && (stat.mode & 0o111) !== 0, 'BINARY_IDENTITY');
    requireThat(fs.realpathSync(binary) === binary && sha(fs.readFileSync(fd)) === expected, 'BINARY_DIGEST');
    return [stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs];
  } finally { fs.closeSync(fd); }
}

// Exclusivity and the unknown-service fence cover this imported module instance
// only. Other processes, imports, callers and Apple's service are not governed.
// Ancestors and the selected binary must be trusted; pathname checks cannot
// prevent a hostile same-user swap between verification and exec.
export async function runScheduledAFMProbe(options) {
  const descriptors = options && typeof options === 'object' && !Array.isArray(options)
    ? Object.getOwnPropertyDescriptors(options) : {};
  requireThat(Reflect.ownKeys(descriptors).every(k => typeof k === 'string'
    && ['binary','binarySHA256','signal','timeoutMs'].includes(k) && Object.hasOwn(descriptors[k], 'value')), 'ARGUMENTS');
  const {binary, binarySHA256, signal, timeoutMs = 45000} = Object.fromEntries(
    Object.entries(descriptors).map(([k,d]) => [k,d.value]));
  requireThat(process.platform === 'darwin' && process.arch === 'arm64', 'PLATFORM');
  requireThat(typeof binary === 'string' && path.isAbsolute(binary) && hex(binarySHA256), 'BINARY_ARGUMENTS');
  requireThat(Number.isSafeInteger(timeoutMs) && timeoutMs >= 50 && timeoutMs <= 60000, 'DEADLINE_ARGUMENT');
  requireThat(signal === undefined || signal instanceof AbortSignal, 'SIGNAL');
  if (active || serviceCompletionUnknown) return seal({...baseResult(),status:'REFUSED',
    reason:active ? 'MODULE_BUSY' : 'MODEL_SERVICE_COMPLETION_UNKNOWN', childStarted:false, childReaped:false,
    modelParticipation:'NOT_REQUESTED', modelServiceQuiescence:serviceCompletionUnknown ? 'UNKNOWN' : 'NOT_OBSERVED'});
  if (signal?.aborted) return seal({...baseResult(),status:'REFUSED',reason:'ABORTED',childStarted:false,
    childReaped:false,modelParticipation:'NOT_REQUESTED',modelServiceQuiescence:'NOT_REQUESTED'});
  active = true;
  const now = () => Math.floor(performance.now()), started = now(), events = [];
  const record = event => events.push({event, elapsedMs:now()-started});
  let owner = null, child = null, timer = null, reason = null, terminal = null, slot = null;
  let raw = Buffer.alloc(0), evidence = null, scope = null, runID = null, before = null, childStarted = false;
  const refuse = code => {
    reason ??= code;
    owner?.stop();
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  };
  const abort = () => refuse('ABORTED');
  let scheduler = null;
  try {
    before = inspectBinary(binary, binarySHA256); record('BINARY_VERIFIED');
    const base = makeBn01Fixture(), dual = makeDualFixture(base);
    const pins = {graphSha256:base.graph.sha256,runSha256:base.run.sha256,
      topologySha256:dual.topology.sha256,planSha256:dual.plan.sha256};
    const made = createScheduledRunOwner(fixtureBytes({kind:'veritas-admitted-run-bind-v1',
      profile:'veritas-bn01-offline-contract-v1',schemaVersion:1,generation:1,runBudgetCap:10,deadlineMs:timeoutMs,...pins}),
      fixtureBytes(base), canonicalFixtureBytes(dual), {clock:now,windowSlots:10,windowDurationMs:1000,maxCourierIds:8});
    requireThat(made.ok, 'SCHEDULER_REFUSED'); owner = made.owner;
    runID = 'run.' + randomBytes(32).toString('hex');
    scope = 'afm.' + sha(canonical({domain:'veritas/scheduled-afm-probe/v1',runID,requestedBinarySHA256:binarySHA256,
      subjectDigest,profileFingerprint,timeoutMs,limits}));
    signal?.addEventListener('abort', abort, {once:true});
    requireThat(!signal?.aborted && now()-started < timeoutMs, 'BEFORE_LAUNCH_REFUSED');
    const permit = owner.requestPermit(fixtureBytes({kind:'veritas-admitted-run-permit-request-v1',runId:runID,
      requester:'PRIMARY',generation:1,scope}).toString());
    requireThat(permit.ok, 'PERMIT_REFUSED');
    slot = owner.checkExecution(fixtureBytes({kind:'veritas-admitted-run-execution-v1',runId:runID,
      permitId:permit.permitId,requester:'PRIMARY',generation:1,scope,...pins}).toString());
    validateSchedulerAdmission(permit, slot, runID); record('SLOT_CLAIMED');
    requireThat(!signal?.aborted && now()-started < timeoutMs, 'BEFORE_LAUNCH_REFUSED');
    // No await between claim and this sole spawn. No physical GPU atomicity claim.
    child = spawn(binary, [], {cwd:path.dirname(binary),env:{PATH:'/usr/bin:/bin'},stdio:['ignore','pipe','pipe']});
    const closed = new Promise(resolve => child.once('close', (code,signal) => resolve({code,signal})));
    child.once('spawn', () => {childStarted = true; record('CHILD_STARTED');});
    child.on('error', () => refuse('SPAWN_ERROR'));
    child.stdout.on('data', chunk => {
      if (reason) return;
      if (raw.length + chunk.length > limits.maxStdoutBytes) {refuse('OUTPUT_LIMIT'); return;}
      raw = Buffer.concat([raw,chunk]);
    });
    child.stderr.on('data', () => refuse('UNEXPECTED_STDERR'));
    timer = setTimeout(() => refuse('DEADLINE'), Math.max(1,timeoutMs-(now()-started)));
    terminal = await closed; record('CHILD_REAPED');
    if (signal?.aborted) refuse('ABORTED');
    if (now()-started >= timeoutMs) refuse('DEADLINE');
    requireThat(!reason && terminal.code === 0 && terminal.signal === null, reason ?? 'NATIVE_NOT_COMPLETED');
    evidence = validateAFMProbeEvidence(raw); record('EVIDENCE_VALIDATED');
    try {
      requireThat(JSON.stringify(inspectBinary(binary,binarySHA256)) === JSON.stringify(before), 'BINARY_CHANGED');
    } catch { throw Error('BINARY_CHANGED'); }
    requireThat(!signal?.aborted && now()-started < timeoutMs, 'DELIVERY_EXPIRED');
  } catch (error) {
    const known = ['BINARY_IDENTITY','BINARY_DIGEST','SCHEDULER_REFUSED','BEFORE_LAUNCH_REFUSED','PERMIT_REFUSED',
      'SLOT_REFUSED','NATIVE_NOT_COMPLETED','EVIDENCE_BYTES','EVIDENCE_SCHEMA','EVIDENCE_IDENTITY','EVIDENCE_COMPLETION',
      'EVIDENCE_AUTHORITY','EVIDENCE_LIMITATIONS','EVIDENCE_CHECKS','RECEIPT_IDENTITY','RECEIPT_STAGES','RECEIPT_DIGEST',
      'BINARY_CHANGED','DELIVERY_EXPIRED','ABORTED','DEADLINE','OUTPUT_LIMIT','UNEXPECTED_STDERR','SPAWN_ERROR'];
    refuse(known.includes(error.message) ? error.message : 'INPUT_OR_EVIDENCE_REFUSED');
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort',abort); owner?.stop(); scheduler = owner?.status() ?? null;
    if (owner && (!scheduler.stopped || !scheduler.schedulerStopConfirmed)) reason ??= 'SCHEDULER_NOT_STOPPED';
    if (reason && childStarted) serviceCompletionUnknown = true;
    active = false;
  }
  // No raw stderr or unsuccessful model output is returned. Adverse result hashes
  // can be retained; there is no output pathname to reuse or automatically delete.
  return seal({...baseResult(),status:reason ? 'REFUSED' : 'PASS_PRIVATE_SCHEDULED_AFM_REPORTED_COMPLETION_ONLY',
    reason,runID,scope,requestedBinarySHA256:binarySHA256,events,terminal,childStarted,childReaped:terminal !== null,slot,scheduler,
    stdoutSHA256:sha(raw),stdoutBytes:raw.length,modelParticipation:reason ? (childStarted ? 'UNKNOWN' : 'NOT_REQUESTED') : 'REPORTED_PARTICIPATED',
    modelServiceQuiescence:reason ? (childStarted ? 'UNKNOWN' : 'NOT_REQUESTED') : 'REPORTED_QUIESCENT',
    modelServiceCompletionFence:serviceCompletionUnknown,receipt:reason ? null : evidence,
    evidenceLimitations:['CALLER_REVIEW_AND_EXACT_RUN_APPROVAL_REQUIRED','SAME_USER_DIAGNOSTIC_NOT_LAUNCH_ATTESTATION',
      'ONE_SLOT_COVERS_SERIAL_PROBE_PLAN_FINDING','MODULE_INSTANCE_EXCLUSIVITY_ONLY',
      'RESPONSE_DIGESTS_NOT_SEMANTIC_REGRADE','APPLE_SERVICE_NOT_OWNED_BY_CHILD','NO_FALLBACK_INITIATED_BY_WRAPPER']});
}
