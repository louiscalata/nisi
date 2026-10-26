// ISOLATED C07 DRAFT.  This file is intentionally not installed in hosts/.
// It is a non-authorizing, in-memory admission/binding seam for a caller that
// already holds an issued source plan.  It never starts a process or writes.
import { types as nodeTypes } from 'node:util';
import { cloneFreeze, sha256Text, stableStringify } from '../../workflow/contracts.mjs';
import { exact } from '../../integrity/record-utils.mjs';
import { isIssuedNativeIncidentSourcePlanV1, readNativeIncidentSourceInputV1,
  readNativeIncidentExecutionIdentityV1 } from './native-incident-source-v1.mjs';
import { readExecutionReceipt } from '../../receipts/repository-execution-v1.mjs';

const issued = new WeakMap();
const refuse = code => { throw Object.assign(new Error(code), { code }); };
const isHex = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const isText = (value, max = 512) => typeof value === 'string' && value.isWellFormed() &&
  value.length > 0 && value.length <= max && !value.includes('\0');
const isTime = value => Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
const same = (a, b) => stableStringify(a) === stableStringify(b);
const GRANT_KEYS = ['schemaVersion', 'grantId', 'sourcePlanDigest', 'inputSha256', 'rowId',
  'previewSha256', 'executionProfileSha256', 'executableSha256', 'issuedAt', 'expiresAt', 'revoked', 'scope',
  'rawContentPersisted', 'networkEgress', 'learningInfluence'];
const HOST_KEYS = ['state', 'pendingTransports', 'observedAtMs'];
const FRESH_KEYS = ['expected', 'requestSha256', 'path', 'receipt', 'nativeReport', 'rawObservation',
  'executableBefore', 'executableAfter', 'reservation', 'ownerState', 'authorizing'];
const STATES = new Set(['IDLE', 'BUSY', 'QUARANTINED', 'OFF', 'TIMEOUT', 'CANCELLED']);
const statusSet = new Set(['PASS', 'FAIL', 'NOT_RUN', 'ERROR', 'INCONCLUSIVE']);
const grantScope = 'NATIVE_RERUN_ORIGINAL_SNAPSHOT_ONLY';
const RECEIPT_KEYS = ['schemaVersion', 'expectationFingerprint', 'binding', 'process', 'outputs', 'result'];
const RECEIPT_BINDING_KEYS = ['schemaVersion', 'runId', 'taskFingerprint', 'attempt', 'candidateFingerprint',
  'baselineFingerprint', 'materializedFingerprint', 'preparationFingerprint', 'checkId', 'stage', 'profileFingerprint'];
const RECEIPT_PROCESS_KEYS = ['started', 'closed', 'drain', 'exitCode', 'signal', 'errorCode',
  'deadlineExceeded', 'cancelRequested', 'durationMs'];
const RECEIPT_OUTPUTS_KEYS = ['stdout', 'stderr'];
const RECEIPT_STREAM_KEYS = ['capturedBytes', 'observedBytes', 'sha256', 'truncated'];
const RECEIPT_RESULT_KEYS = ['status', 'reason'];

function record(value, keys, code) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || nodeTypes.isProxy(value)) refuse(code);
  let proto, descriptors;
  try { proto = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); }
  catch { refuse(code); }
  if (![null, Object.prototype].includes(proto)) refuse(code);
  const names = Reflect.ownKeys(descriptors);
  if (names.length !== keys.length || names.some(key => typeof key !== 'string' || !keys.includes(key))) refuse(code);
  const out = Object.create(null);
  for (const key of keys) {
    const d = descriptors[key];
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) refuse(code);
    out[key] = d.value;
  }
  return out;
}
function list(value, code) {
  if (!Array.isArray(value) || nodeTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) refuse(code);
  const d = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(d).length !== value.length + 1) refuse(code);
  return Array.from({ length: value.length }, (_, i) => {
    if (!d[i]?.enumerable || !Object.hasOwn(d[i], 'value')) refuse(code);
    return d[i].value;
  });
}
// Snapshot the complete receipt graph without invoking any caller accessor or
// proxy trap. The existing receipt reader then sees only inert null-prototype
// data, while its original issued expectation remains the authority.
function receiptRecord(value, keys, code) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || nodeTypes.isProxy(value)) refuse(code);
  let proto, descriptors;
  try { proto = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); }
  catch { refuse(code); }
  if (![null, Object.prototype].includes(proto)) refuse(code);
  const names = Reflect.ownKeys(descriptors);
  if (names.length !== keys.length || names.some(key => typeof key !== 'string' || !keys.includes(key))) refuse(code);
  const out = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) refuse(code);
    out[key] = descriptor.value;
  }
  return out;
}
function snapshotReceipt(value) {
  const receipt = receiptRecord(value, RECEIPT_KEYS, 'FRESH_RECEIPT_INVALID');
  receipt.binding = receiptRecord(receipt.binding, RECEIPT_BINDING_KEYS, 'FRESH_RECEIPT_INVALID');
  receipt.process = receiptRecord(receipt.process, RECEIPT_PROCESS_KEYS, 'FRESH_RECEIPT_INVALID');
  receipt.outputs = receiptRecord(receipt.outputs, RECEIPT_OUTPUTS_KEYS, 'FRESH_RECEIPT_INVALID');
  receipt.outputs.stdout = receiptRecord(receipt.outputs.stdout, RECEIPT_STREAM_KEYS, 'FRESH_RECEIPT_INVALID');
  receipt.outputs.stderr = receiptRecord(receipt.outputs.stderr, RECEIPT_STREAM_KEYS, 'FRESH_RECEIPT_INVALID');
  receipt.result = receiptRecord(receipt.result, RECEIPT_RESULT_KEYS, 'FRESH_RECEIPT_INVALID');
  return receipt;
}
function outcomeRows(value) {
  const rows = list(value, 'NATIVE_OUTCOMES_SCHEMA');
  return rows.map(row => {
    const out = record(row, ['id', 'status', 'explanation'], 'NATIVE_OUTCOME_SCHEMA');
    if (!isText(out.id, 128) || !['PASS', 'FAIL'].includes(out.status) || !isText(out.explanation, 1024)) {
      refuse('NATIVE_OUTCOME_SCHEMA');
    }
    return frozen(out);
  });
}
function frozen(value) { return cloneFreeze(value); }
function digest(domain, value) { return sha256Text(`${domain}\0${stableStringify(value)}`); }
function flagsFalse(grant) {
  return grant.rawContentPersisted === false && grant.networkEgress === false && grant.learningInfluence === false;
}
function grantDigest(grant) { return digest('nisi/native-incident-grant/v1', grant); }
function checks(status, reason, sourcePlanDigest = null, grantDigestValue = null) {
  return frozen({ sourcePlan: status === 'ADMITTED' ? 'BOUND' : status, grant: status === 'ADMITTED' ? 'VALID' : status,
    host: status === 'ADMITTED' ? 'IDLE' : status, fresh: 'NOT_EVALUATED', outcome: 'NOT_EVALUATED',
    status, reason, sourcePlanDigest, grantDigest: grantDigestValue });
}
function admissionRefusal(reason, sourcePlanDigest = null, grantDigestValue = null, status = 'REFUSED') {
  return frozen({ schemaVersion: 'nisi-native-incident-admission/v1', status, reason,
    checks: checks(status, reason, sourcePlanDigest, grantDigestValue), sourcePlanDigest,
    grantDigest: grantDigestValue, admission: null, nativeRerun: 'NOT_RUN', executionVerified: false,
    learningEligible: false, persistable: false, authorizing: false, executionGranted: false });
}
function handleDigest(handle) { return digest('nisi/native-incident-admission/v1', handle); }
function cleanExecutable(value, code) {
  const e = record(value, ['sha256'], code);
  if (!isHex(e.sha256)) refuse(code);
  return e;
}
function compareBinding(actual, expected, code) {
  if (!actual || typeof actual !== 'object') refuse(code);
  for (const key of ['runId', 'attempt', 'taskFingerprint', 'candidateFingerprint', 'baselineFingerprint',
    'preparationFingerprint', 'materializedFingerprint', 'stage', 'checkId']) {
    if (actual[key] !== expected[key]) refuse(code);
  }
}
function sourceSelection(payload) {
  if (!payload?.selection || !payload.sourcePlanDigest) refuse('SOURCE_PLAN_PAYLOAD_INVALID');
  return payload.selection;
}

export function isIssuedNativeIncidentAdmissionV1(value) { return issued.has(value); }

export function admitNativeIncidentRerunV1(input) {
  try {
    const top = record(input, ['plan', 'grant', 'host', 'now'], 'INVALID_INPUT');
    if (!isTime(top.now)) refuse('INVALID_CLOCK');
    if (!isIssuedNativeIncidentSourcePlanV1(top.plan)) refuse('SOURCE_PLAN_NOT_ISSUED');
    const payload = readNativeIncidentSourceInputV1({ plan: top.plan });
    let executionIdentity;
    try { executionIdentity = readNativeIncidentExecutionIdentityV1({ plan: top.plan }); }
    catch { refuse('SOURCE_EXECUTION_IDENTITY_UNAVAILABLE'); }
    const selection = sourceSelection(payload);
    const grant = record(top.grant, GRANT_KEYS, 'GRANT_SCHEMA');
    if (grant.schemaVersion !== 'nisi-native-incident-rerun-grant/v1' || !isText(grant.grantId, 96) || !isHex(grant.sourcePlanDigest) ||
        !isHex(grant.inputSha256) || !isHex(grant.rowId) || !isHex(grant.previewSha256) || !isHex(grant.executionProfileSha256) ||
        !isHex(grant.executableSha256) || !isTime(grant.issuedAt) || !isTime(grant.expiresAt) ||
        typeof grant.revoked !== 'boolean') refuse('GRANT_SCHEMA');
    if (grant.scope !== grantScope || !flagsFalse(grant)) refuse('GRANT_SCOPE');
    const gd = grantDigest(grant);
    if (grant.sourcePlanDigest !== payload.sourcePlanDigest || grant.inputSha256 !== selection.inputSha256 ||
        grant.rowId !== selection.rowId || grant.previewSha256 !== selection.previewSha256 ||
        grant.expiresAt <= grant.issuedAt || grant.expiresAt - grant.issuedAt > 3_600_000) refuse('GRANT_MISMATCH');
    if (grant.revoked) refuse('GRANT_REVOKED');
    if (top.now < grant.issuedAt) refuse('GRANT_NOT_YET_VALID');
    if (top.now >= grant.expiresAt) refuse('GRANT_EXPIRED');
    const host = record(top.host, HOST_KEYS, 'HOST_SCHEMA');
    if (!STATES.has(host.state) || !Number.isSafeInteger(host.pendingTransports) || host.pendingTransports < 0 ||
        !isTime(host.observedAtMs)) refuse('HOST_SCHEMA');
    if (host.observedAtMs > top.now) refuse('HOST_FUTURE');
    if (top.now - host.observedAtMs >= 5000) refuse('HOST_STALE');
    if (host.pendingTransports > 0) {
      if (['OFF', 'TIMEOUT', 'CANCELLED'].includes(host.state)) return admissionRefusal('DRAIN_UNCONFIRMED', payload.sourcePlanDigest, gd, 'DRAIN_UNCONFIRMED');
      refuse('TRANSPORTS_PENDING');
    }
    if (host.state !== 'IDLE') refuse('HOST_NOT_IDLE');
    // The separate source identity accessor is the only authority for the
    // executor profile/executable. Never copy either value from the grant.
    if (grant.executionProfileSha256 !== executionIdentity.profileFingerprint) refuse('GRANT_EXECUTION_PROFILE_MISMATCH');
    if (grant.executableSha256 !== executionIdentity.executableSha256) refuse('GRANT_EXECUTABLE_MISMATCH');
    const handle = frozen({ schemaVersion: 'nisi-native-incident-admission-handle/v1', sourcePlanDigest: payload.sourcePlanDigest,
      grantDigest: gd, expiresAt: grant.expiresAt, executionProfileSha256: grant.executionProfileSha256,
      executableSha256: grant.executableSha256 });
    const admission = frozen({ schemaVersion: 'nisi-native-incident-admission/v1', status: 'ADMITTED', reason: null,
      checks: checks('ADMITTED', null, payload.sourcePlanDigest, gd), sourcePlanDigest: payload.sourcePlanDigest,
      grantDigest: gd, admission: handle, nativeRerun: 'NOT_RUN', executionVerified: false,
      learningEligible: false, persistable: false, authorizing: false, executionGranted: false });
    issued.set(handle, { plan: top.plan, source: payload, executionIdentity, grantDigest: gd, expiresAt: grant.expiresAt,
      executableSha256: grant.executableSha256, consumed: false });
    issued.set(admission, issued.get(handle));
    return admission;
  } catch (error) {
    return admissionRefusal(typeof error?.code === 'string' ? error.code : 'INVALID_INPUT');
  }
}

function bindRefusal(state, reason, sourcePlanDigest = null, admissionDigest = null, status = 'REFUSED') {
  return frozen({ schemaVersion: 'nisi-native-incident-rerun/v1', status, reason, sourcePlanDigest,
    admissionDigest, original: null, fresh: null, evidenceDistinct: false, rawContentIncluded: false,
    persistable: false, nativeRerun: 'NOT_RUN', nativeExecutionAttested: false, executionVerified: false,
    learningEligible: false, authorizing: false });
}

export function bindNativeIncidentRerunV1(input) {
  let state, admissionDigest = null;
  try {
    const top = record(input, ['admission', 'fresh', 'now'], 'INVALID_INPUT');
    if (!isTime(top.now)) refuse('INVALID_CLOCK');
    state = issued.get(top.admission);
    if (!state) refuse('ADMISSION_NOT_ISSUED');
    admissionDigest = handleDigest(top.admission);
    if (state.consumed) refuse('ADMISSION_CONSUMED');
    state.consumed = true;
    if (top.now >= state.expiresAt) refuse('ADMISSION_EXPIRED');
    const fresh = record(top.fresh, FRESH_KEYS, 'FRESH_SCHEMA');
    if (fresh.authorizing !== false || !isHex(fresh.requestSha256) || !isText(fresh.path, 512)) refuse('FRESH_SCHEMA');
    let receipt, receiptWire;
    // This is deliberately before any property access on the caller's
    // expectation. The existing reader first authenticates its private
    // WeakSet issuance and rejects proxies/clones without traversing them.
    try {
      receiptWire = snapshotReceipt(fresh.receipt);
      receipt = readExecutionReceipt(receiptWire, fresh.expected);
    } catch { refuse('FRESH_RECEIPT_INVALID'); }
    const source = sourceSelection(state.source);
    if (fresh.path !== source.binding.subjectKey && fresh.path !== source.artifact.relativePath) refuse('FRESH_PATH_MISMATCH');
    const expected = fresh.expected;
    if (!expected || typeof expected !== 'object') refuse('FRESH_EXPECTATION_INVALID');
    const expectedBinding = record(expected.binding, ['schemaVersion', 'runId', 'taskFingerprint', 'attempt', 'candidateFingerprint',
      'baselineFingerprint', 'materializedFingerprint', 'preparationFingerprint', 'checkId', 'stage', 'profileFingerprint'], 'FRESH_BINDING_SCHEMA');
    compareBinding(expectedBinding, source.binding, 'FRESH_BINDING_MISMATCH');
    if (expected.fingerprint !== state.executionIdentity.expectationFingerprint ||
        expected.fingerprint !== source.source?.expectationFingerprint) refuse('FRESH_EXPECTATION_MISMATCH');
    if (expected.binding.profileFingerprint !== state.executionIdentity.profileFingerprint ||
        expected.profile?.executableSha256 !== state.executionIdentity.executableSha256) refuse('EXECUTABLE_MISMATCH');
    const before = cleanExecutable(fresh.executableBefore, 'EXECUTABLE_BEFORE_INVALID');
    const after = cleanExecutable(fresh.executableAfter, 'EXECUTABLE_AFTER_INVALID');
    if (before.sha256 !== after.sha256 || before.sha256 !== state.executableSha256) refuse('EXECUTABLE_MISMATCH');
    const reservation = record(fresh.reservation, ['acquired', 'released', 'presentRequiresReconciliation'], 'RESERVATION_SCHEMA');
    if (reservation.acquired !== true || reservation.released !== true || reservation.presentRequiresReconciliation !== false) refuse('RESERVATION_UNRECONCILED');
    if (!['IDLE', 'OFF'].includes(fresh.ownerState)) refuse('OWNER_QUARANTINED');
    if (!statusSet.has(receipt.result.status)) refuse('FRESH_RECEIPT_INVALID');
    const payload = readNativeIncidentSourceInputV1({ plan: state.plan });
    const expectedReport = payload.priorReport;
    const original = frozen({ kind: 'ORIGINAL_HISTORICAL', priorTranscriptSha256: payload.priorTranscriptSha256,
      receiptSha256: source.receiptSha256, expectationFingerprint: source.expectationFingerprint, status: expectedReport.status });
    const report = fresh.nativeReport;
    if (report !== null) {
      const r = record(report, ['schemaVersion', 'expectationFingerprint', 'preparationFingerprint', 'path', 'artifactSha256',
        'profileId', 'rulesFingerprint', 'sourceFingerprint', 'requestSha256', 'artifactByteLength', 'status', 'outcomes', 'authorizing'], 'NATIVE_REPORT_SCHEMA');
      if (r.schemaVersion !== 'nisi-swift-artifact-v1' || r.authorizing !== false || r.expectationFingerprint !== state.executionIdentity.expectationFingerprint ||
          r.preparationFingerprint !== expected.binding.preparationFingerprint || r.sourceFingerprint !== expected.profile.sourceSha256 ||
          r.path !== source.artifact.relativePath ||
          r.artifactSha256 !== source.artifact.sha256 || r.artifactByteLength !== source.artifact.byteLength ||
          r.requestSha256 !== fresh.requestSha256 || r.profileId !== source.profile.id || r.rulesFingerprint !== source.profile.rulesFingerprint ||
          !statusSet.has(r.status)) refuse('NATIVE_REPORT_MISMATCH');
      r.outcomes = outcomeRows(r.outcomes);
    }
    const cancelled = receipt.process.cancelRequested === true;
    const drainUnknown = receipt.process.drain === 'UNKNOWN' || receipt.result.status === 'INCONCLUSIVE';
    let status, reason;
    if (cancelled) { status = 'INTERRUPTED'; reason = 'RERUN_CANCELLED'; }
    else if (drainUnknown) { status = 'INCONCLUSIVE'; reason = 'DRAIN_UNCONFIRMED'; }
    else if (receipt.result.status === 'ERROR' || report === null) { status = 'ERROR'; reason = receipt.result.reason || 'NO_NATIVE_REPORT'; }
    else {
      const equal = same(outcomeRows(report.outcomes), outcomeRows(expectedReport.outcomes));
      status = receipt.result.status === 'FAIL' && report.status === 'FAIL' && equal ? 'MATCHED' : 'DIVERGED';
      reason = status === 'MATCHED' ? null : 'OUTCOMES_DIFFER';
    }
    const freshDigest = digest('nisi/native-incident-fresh-transcript/v1', report?.outcomes ?? null);
    const freshRecord = frozen({ kind: 'FRESH_RERUN', transcriptSha256: freshDigest,
      receiptSha256: digest('nisi/native-incident-fresh-receipt/v1', receiptWire),
      expectationFingerprint: expected.fingerprint, status: receipt.result.status });
    const terminal = status === 'MATCHED' || status === 'DIVERGED';
    return frozen({ schemaVersion: 'nisi-native-incident-rerun/v1', status, reason,
      sourcePlanDigest: state.source.sourcePlanDigest, admissionDigest, original: terminal ? original : null,
      fresh: terminal ? freshRecord : null, evidenceDistinct: terminal, rawContentIncluded: false,
      persistable: false, nativeRerun: 'NOT_RUN', nativeExecutionAttested: false,
      executionVerified: false, learningEligible: false, authorizing: false });
  } catch (error) {
    return bindRefusal(state, typeof error?.code === 'string' ? error.code : 'INVALID_INPUT', state?.source?.sourcePlanDigest ?? null,
      admissionDigest, error?.code === 'DRAIN_UNCONFIRMED' ? 'DRAIN_UNCONFIRMED' : 'REFUSED');
  }
}
