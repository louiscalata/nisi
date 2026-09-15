// Private POSIX host integration, not native execution or authenticated consent.
// Uses the existing trusted-static reader; no hostile-tree or hard I/O deadline claim.
import path from 'node:path';
import {createHash} from 'node:crypto';
import {captureRepositoryFromDisk, RepositoryCaptureError, DISK_CAPTURE_PROFILE} from '../repository/disk-capture.mjs';
import {createRepositorySnapshot, RepositorySnapshotError} from '../repository/snapshot-contract.mjs';
import {createFixedXpcHistoryPermit, captureFixedXpcHistory, revokeFixedXpcHistoryPermit} from '../../history/history-capture-permit-v1.mjs';

const abortedGetter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
const addListener = EventTarget.prototype.addEventListener;
const removeListener = EventTarget.prototype.removeEventListener;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const diskCodes = new Set(['DISK_CAPTURE_INPUT_SCHEMA', 'DISK_CAPTURE_PROFILE_REQUIRED',
  'DISK_CAPTURE_ROOT_INVALID', 'DISK_CAPTURE_PATHS_SCHEMA', 'DISK_CAPTURE_PATH_COUNT',
  'DISK_CAPTURE_SYMLINK', 'DISK_CAPTURE_DIRECTORY_REQUIRED', 'DISK_CAPTURE_REGULAR_FILE_REQUIRED',
  'DISK_CAPTURE_HARDLINK', 'DISK_CAPTURE_FILE_LIMIT', 'DISK_CAPTURE_CHANGED',
  'DISK_CAPTURE_UTF8_INVALID', 'DISK_CAPTURE_BINARY_UNSUPPORTED', 'DISK_CAPTURE_BYTE_ROUNDTRIP',
  'DISK_CAPTURE_CLOSE_UNCONFIRMED', 'DISK_CAPTURE_PLATFORM_UNSUPPORTED',
  'DISK_CAPTURE_CROSS_DEVICE', 'DISK_CAPTURE_TOTAL_LIMIT', 'DISK_CAPTURE_IO_ERROR']);
const snapshotCodes = new Set(['REPOSITORY_SNAPSHOT_SCHEMA', 'REPOSITORY_FILES_SCHEMA',
  'REPOSITORY_FILES_LIMIT', 'REPOSITORY_FILE_SCHEMA', 'REPOSITORY_PATH_INVALID',
  'REPOSITORY_CONTENT_LIMIT', 'REPOSITORY_CONTENT_UNICODE', 'REPOSITORY_PATH_COLLISION',
  'REPOSITORY_PATH_CASE_COLLISION', 'REPOSITORY_PATH_PREFIX_COLLISION', 'REPOSITORY_TOTAL_LIMIT']);

// Own enumerable DATA only. Trusted host proxies are not a process sandbox.
function read(input, keys) {
  if (input === null || typeof input !== 'object' || Array.isArray(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
      Reflect.ownKeys(input).length !== keys.length) return null;
  const out = {};
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(input, key);
    if (!d || !d.enumerable || !Object.hasOwn(d, 'value')) return null;
    out[key] = d.value;
  }
  return out;
}
function selection(input) {
  const value = read(input, ['schemaVersion', 'consentClass', 'root', 'relativePath',
    'profile', 'rawContentPersisted', 'networkEgress']);
  if (!value || value.schemaVersion !== 'nisi-history-source-selection/v1' ||
      value.consentClass !== 'WRITTEN_DECLARATION' || value.profile !== DISK_CAPTURE_PROFILE ||
      value.rawContentPersisted !== false || value.networkEgress !== false ||
      typeof value.root !== 'string' || !value.root.isWellFormed() || value.root.length > 4096 ||
      value.root.includes('\0') || !path.isAbsolute(value.root) ||
      path.resolve(value.root) === path.parse(value.root).root) return null;
  try { createRepositorySnapshot({files: [{path: value.relativePath, content: ''}]}); }
  catch { return null; }
  return Object.freeze(value);
}
function selectionHash(value) {
  const canonical = '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + JSON.stringify(value[key])).join(',') + '}';
  return hash('nisi-history-source-selection/v1\n' + canonical);
}
function errorCode(error) {
  if (error instanceof RepositoryCaptureError && diskCodes.has(error.code) ||
      error instanceof RepositorySnapshotError && snapshotCodes.has(error.code)) return error.code;
  return 'SOURCE_CAPTURE_FAILED';
}

// The actual reader returns frozen objects; never expose file paths/content.
function evidenceOf(result, source) {
  const s = result?.snapshot, c = result?.capture;
  if (!s || !c || !Array.isArray(s.files) || s.files.length !== 1 ||
      c.schemaVersion !== 1 || c.profile !== DISK_CAPTURE_PROFILE ||
      c.status !== 'CAPTURED_TRUSTED_STATIC_INPUT' || c.handlesClosed !== true ||
      c.atomicSnapshot !== false || c.executionStatus !== 'NOT_RUN' || c.authorizing !== false ||
      ![s.fingerprint, c.rootFingerprint, c.snapshotFingerprint, c.fingerprint].every(hex) ||
      s.fingerprint !== c.snapshotFingerprint) return null;
  const file = s.files[0];
  if (file.path !== source.relativePath || typeof file.content !== 'string' ||
      !file.content.isWellFormed() || Buffer.byteLength(file.content) > 1048576 ||
      file.byteLength !== Buffer.byteLength(file.content) || file.sha256 !== hash(file.content)) return null;
  return Object.freeze({profile: DISK_CAPTURE_PROFILE, rootFingerprint: c.rootFingerprint,
    snapshotFingerprint: s.fingerprint, captureFingerprint: c.fingerprint,
    sourceSha256: file.sha256, sourceBytes: file.byteLength, handlesClosed: true,
    atomicSnapshot: false, sourceAuthenticityAttested: false, executionAttested: false, authorizing: false});
}

export async function importFixedXpcHistoryFromDisk(input) {
  let permit = null, signal = null, listening = false;
  let sourceReadAttempted = false, captureAttempted = false, retainedCapture = null;
  let sourceSelectionDigest = null, declarationDigest = null, sourceEvidence = null, sourceFailure = null;
  const aborted = () => signal !== null && abortedGetter.call(signal);
  const revoke = () => { if (permit !== null) revokeFixedXpcHistoryPermit({permit}); };
  // Do not use once:true: a synthetic event is not a real abort, and must not
  // consume the listener needed for a subsequent real controller.abort().
  const onAbort = () => { if (aborted()) revoke(); };
  const result = (status, reason, capture = null) => Object.freeze({
    schemaVersion: 'nisi-disk-fixed-xpc-history-import/v1', status, reason,
    sourceReadAttempted, captureAttempted, sourceSelectionDigest, declarationDigest,
    sourceEvidence, sourceFailure, capture, meaning: 'HISTORY_OBSERVATIONS_ONLY', authorizing: false});
  try {
    const req = read(input, ['owner', 'declaration', 'source', 'clock', 'signal']);
    if (!req || typeof req.clock !== 'function') return result('REFUSED', 'INVALID_INPUT');
    // Native getter performs the AbortSignal brand check without caller overrides.
    if (req.signal !== null) {
      try { abortedGetter.call(req.signal); } catch { return result('REFUSED', 'INVALID_INPUT'); }
    }
    signal = req.signal;
    const source = selection(req.source);
    if (source === null) return result('REFUSED', 'INVALID_SOURCE_SELECTION');
    sourceSelectionDigest = selectionHash(source);
    if (aborted()) return result('CANCELLED', 'ABORTED');
    if (signal !== null) { addListener.call(signal, 'abort', onAbort); listening = true; }
    // Explicit native-aborted check after EVERY supplied clock callback also
    // catches an earlier listener stopping event propagation. Never read reason.
    const clock = () => { try { return req.clock(); } finally { onAbort(); } };
    const created = createFixedXpcHistoryPermit({owner: req.owner, declaration: req.declaration, clock});
    if (created.status === 'CREATED') { permit = created.permit; declarationDigest = created.declarationDigest; }
    if (aborted()) { revoke(); return result('CANCELLED', 'ABORTED'); }
    if (created.status !== 'CREATED') return result('REFUSED', created.reason);
    let captured;
    sourceReadAttempted = true;
    try { captured = await captureRepositoryFromDisk({root: source.root, paths: [source.relativePath], profile: source.profile}); }
    catch (error) { sourceFailure = errorCode(error); }
    if (aborted()) return result('CANCELLED', 'ABORTED');
    if (sourceFailure !== null) return result('REFUSED', sourceFailure);
    sourceEvidence = evidenceOf(captured, source);
    if (sourceEvidence === null) return result('REFUSED', 'SOURCE_CAPTURE_INVALID');
    captureAttempted = true;
    const capture = captureFixedXpcHistory({permit, serializedRecord: captured.snapshot.files[0].content});
    retainedCapture = capture;
    // A post-admission abort cannot turn a real write into an unattempted cancel.
    return result(capture.status, capture.reason, capture);
  } catch {
    return result(captureAttempted ? 'UNCERTAIN' : 'REFUSED', 'INTERNAL_ERROR', retainedCapture);
  } finally {
    revoke();
    if (listening) removeListener.call(signal, 'abort', onAbort);
  }
}
