// cli/stored-summary-v1.mjs
// Nisi v0.2 read-only inspection slice: stored demo summary codec.
// Validates SELECTED fields of a producer-written pretty-JSON summary and
// returns a frozen observation. It never follows retained paths, never
// verifies declared hashes, and never treats reported status as host acceptance.
import { createHash } from 'node:crypto';

export const MAX_SUMMARY_BYTES = 262144;

const ERR_CODE = 'NISI_INSPECT_SUMMARY_INVALID';
const SCHEMAS = new Set(['nisi-private-live-demo-summary-v1', 'nisi-private-live-demo-summary-v3']);
const STATUSES = new Set(['SCOPED_LIVE_REPAIR_REVIEW_PASS', 'INCOMPLETE']);
const OUTCOMES = new Set(['COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED', 'TIMED_OUT', 'REPAIR_LIMIT', 'NO_PROGRESS']);
const CODE_RE = /^[A-Z][A-Z0-9_]{0,95}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;
const PATH_RE = /^[a-z0-9][a-z0-9.-]*\.json$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const MUST_BE_FALSE = ['blindBenchmark', 'comparativeBenefitMeasured', 'rawHttpBodyRetained', 'applied', 'nativeAppAccepted', 'publicationAuthorized'];
const MAX_ROOT_KEYS = 64;
const MAX_DIAGNOSTICS = 256;
const MAX_RETAINED = 64;
const MAX_STAGE_LEN = 128;
const MAX_PATH_LEN = 100;

// Errors carry a fixed label only: no source text, path or raw content.
function fail(label) {
  const err = new Error(`stored summary invalid: ${label}`);
  err.code = ERR_CODE;
  return err;
}

function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function hasExactKeys(obj, keys) {
  const own = Object.keys(obj);
  if (own.length !== keys.length) return false;
  for (const k of keys) if (!Object.prototype.hasOwnProperty.call(obj, k)) return false;
  return true;
}

function isNonNegSafeInt(v) {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && !Object.is(v, -0);
}

function isHex64(v) {
  return typeof v === 'string' && v.length === 64 && HEX64_RE.test(v);
}

function isErrorCode(v) {
  return typeof v === 'string' && !CONTROL_RE.test(v) && CODE_RE.test(v);
}

function decodeExact(snapshot) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(snapshot);
  } catch {
    throw fail('utf8');
  }
  if (text.length > 0 && text.charCodeAt(0) === 0xfeff) throw fail('bom');
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw fail('json');
  }
  // Accept only exact producer serialization of the parsed value. Noncanonical
  // encodings (including duplicate-key encodings) cannot reproduce these bytes.
  let canonical;
  try {
    canonical = JSON.stringify(value, null, 2) + '\n';
  } catch {
    throw fail('serialize');
  }
  if (canonical !== text) throw fail('noncanonical');
  return value;
}

function validateDiagnostics(list) {
  if (!Array.isArray(list) || list.length > MAX_DIAGNOSTICS) throw fail('diagnosticErrors');
  for (const item of list) {
    if (!isPlainObject(item) || !hasExactKeys(item, ['stage', 'code'])) throw fail('diagnostic.shape');
    const { stage, code } = item;
    if (typeof stage !== 'string' || stage.length === 0 || stage.length > MAX_STAGE_LEN || CONTROL_RE.test(stage)) {
      throw fail('diagnostic.stage');
    }
    if (!isErrorCode(code)) throw fail('diagnostic.code');
  }
}

function validateRetained(list) {
  if (!Array.isArray(list) || list.length > MAX_RETAINED) throw fail('retained');
  const seen = new Set();
  for (const item of list) {
    if (!isPlainObject(item) || !hasExactKeys(item, ['path', 'byteLength', 'sha256'])) throw fail('retained.shape');
    const { path, byteLength, sha256 } = item;
    if (typeof path !== 'string' || path.length > MAX_PATH_LEN || !PATH_RE.test(path) || CONTROL_RE.test(path) || path.includes('..')) {
      throw fail('retained.path');
    }
    if (seen.has(path)) throw fail('retained.duplicate');
    seen.add(path);
    if (!isNonNegSafeInt(byteLength)) throw fail('retained.byteLength');
    if (!isHex64(sha256)) throw fail('retained.sha256');
  }
}

function validateRoot(root) {
  if (!isPlainObject(root)) throw fail('root');
  if (Object.keys(root).length > MAX_ROOT_KEYS) throw fail('root.keys');
  if (typeof root.schemaVersion !== 'string' || !SCHEMAS.has(root.schemaVersion)) throw fail('schemaVersion');
  if (typeof root.status !== 'string' || !STATUSES.has(root.status)) throw fail('status');
  if (root.workflowOutcome !== null && !(typeof root.workflowOutcome === 'string' && OUTCOMES.has(root.workflowOutcome))) {
    throw fail('workflowOutcome');
  }
  if (root.errorCode !== null && !isErrorCode(root.errorCode)) throw fail('errorCode');
  validateDiagnostics(root.diagnosticErrors);
  validateRetained(root.retained);
  if (root.receiptFingerprint !== null && !isHex64(root.receiptFingerprint)) throw fail('receiptFingerprint');
  if (root.setupDurationMs !== null && !isNonNegSafeInt(root.setupDurationMs)) throw fail('setupDurationMs');
  if (root.workflowDurationMs !== null && !isNonNegSafeInt(root.workflowDurationMs)) throw fail('workflowDurationMs');
  if (root.remoteInferenceStopped !== 'NOT_OBSERVED') throw fail('remoteInferenceStopped');
  for (const key of MUST_BE_FALSE) {
    if (root[key] !== false) throw fail(`flag.${key}`);
  }
}

/**
 * Inspect stored demo summary bytes (synchronous, pure).
 * Accepts only a Buffer of 1..MAX_SUMMARY_BYTES; the input is snapshotted
 * before any decoding. Throws Error{code:'NISI_INSPECT_SUMMARY_INVALID'}
 * on any invalid input. Returned values are producer REPORTED values only.
 */
export function inspectStoredDemoSummaryV1(bytes) {
  if (!Buffer.isBuffer(bytes)) throw fail('type');
  if (bytes.length < 1 || bytes.length > MAX_SUMMARY_BYTES) throw fail('length');
  const snapshot = Buffer.from(bytes);
  const summarySha256 = createHash('sha256').update(snapshot).digest('hex');
  const root = decodeExact(snapshot);
  validateRoot(root);
  return Object.freeze({
    schemaVersion: 'nisi-cli-inspection/v1',
    status: 'OBSERVED',
    scope: 'STORED_SUMMARY_ONLY',
    summarySha256,
    producerSchema: root.schemaVersion,
    reportedStatus: root.status,
    reportedOutcome: root.workflowOutcome,
    reportedErrorCode: root.errorCode,
    diagnosticCount: root.diagnosticErrors.length,
    declaredArtifactCount: root.retained.length,
    receiptFingerprint: root.receiptFingerprint,
    timings: Object.freeze({
      setupDurationMs: root.setupDurationMs,
      workflowDurationMs: root.workflowDurationMs,
    }),
    sourceTrust: 'UNVERIFIED',
    integrity: 'SUMMARY_BYTES_HASHED_ONLY',
    bundleValidation: 'NOT_RUN',
    lateSettlement: 'NOT_ASSESSED',
    currentRunState: 'UNKNOWN',
    remoteInferenceStopped: 'NOT_OBSERVED',
    authorizing: false,
    accepted: false,
    applied: false,
  });
}
