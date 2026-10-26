// PRIVATE one immutable redacted capture per trial request. No append/overwrite,
// timer/callback writes, late upgrade or writable recovery. Caller owns capture
// timing and must inspect this receipt separately from the main trial outcome.
import fs from 'node:fs';
import path from 'node:path';
import { record } from '../evaluation/intake-v1.mjs';
import { cloneFreeze } from '../workflow/contracts.mjs';
import { resolveExternalDemoStateV1, recheckExternalDemoStateV1 } from '../hosts/repository/demo-state-v1.mjs';
import { inspectPairedTrialEventStoreV1 } from './paired-trial-event-store-v1.mjs';
import { reconcileTrialRetentionEventsV1 } from './paired-trial-reconciliation-v1.mjs';
import { DIAGNOSTIC_LIMIT, encodeRepositoryTrialDiagnosticV1, decodeRepositoryTrialDiagnosticV1 } from './repository-trial-diagnostic-v1.mjs';
const ROOT = path.resolve(import.meta.dirname, '..'), prefix = 'repository-diagnostic-';
const fail = code => { throw Object.assign(Error(code), { code }); };
const identity = s => ({ dev: String(s.dev), ino: String(s.ino) });
const same = (a, b) => a.dev === String(b.dev) && a.ino === String(b.ino);
const within = (a, b) => { const relative = path.relative(a, b); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); };
function checkFile(s) {
  if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || (s.mode & 0o077) ||
      (typeof process.getuid === 'function' && s.uid !== process.getuid()) || s.size > DIAGNOSTIC_LIMIT) fail('TRIAL_DIAGNOSTIC_FILE');
}
function matchLedger(directory, binding) {
  const bytes = inspectPairedTrialEventStoreV1({ directory });
  if (!['FINAL_PRESENT', 'INCOMPLETE'].includes(bytes.status)) fail('TRIAL_DIAGNOSTIC_LEDGER');
  const meaning = reconcileTrialRetentionEventsV1({ events: bytes.events, byteStatus: bytes.status });
  if (!['FINAL_CONSISTENT', 'INTERRUPTED'].includes(meaning.status)) fail('TRIAL_DIAGNOSTIC_LEDGER');
  const schedule = bytes.events[0], intent = schedule.intents.find(row => row.requestId === binding.requestId);
  if (!intent || ['profileSha256', 'model', 'modelSettingsSha256', 'taskSha256', 'baselineSha256'].some(key => intent[key] !== binding[key]) ||
      !bytes.events.some(row => row.type === 'START_INTENT' && row.phase === 'EXECUTOR' && row.requestId === binding.requestId)) fail('TRIAL_DIAGNOSTIC_BINDING');
  return { runnerId: meaning.runnerId, planSha256: meaning.planSha256, profileSha256: meaning.profileSha256,
    ledgerBoundFields: ['requestId', 'profileSha256', 'model', 'modelSettingsSha256', 'taskSha256', 'baselineSha256'],
    executorStartIntentPresent: true, observerOnlyFields: ['suiteFingerprint', 'reviewedSourceFingerprint'],
    executionVerified: false };
}
export function retainRepositoryTrialDiagnosticV1(input, dependencies = { io: fs }) {
  const { directory: selected, diagnostic } = record(input, ['directory', 'diagnostic']);
  if (![fs.constants.O_NOFOLLOW, fs.constants.O_DIRECTORY, fs.constants.O_EXCL].every(Number.isInteger)) fail('TRIAL_DIAGNOSTIC_FLAGS');
  const encoded = encodeRepositoryTrialDiagnosticV1(diagnostic);
  if (encoded.bytes.length > DIAGNOSTIC_LIMIT) fail('TRIAL_DIAGNOSTIC_LIMIT');
  const parent = resolveExternalDemoStateV1(selected, ROOT), linkage = matchLedger(parent.directory, encoded.data.binding);
  const { io: supplied } = record(dependencies, ['io']);
  const io = Object.fromEntries(['openSync', 'writeSync', 'readSync', 'fsyncSync', 'closeSync', 'fstatSync'].map(key => {
    const fn = supplied && Object.getOwnPropertyDescriptor(supplied, key)?.value;
    if (typeof fn !== 'function') fail('TRIAL_DIAGNOSTIC_IO'); return [key, fn.bind(supplied)];
  }));
  const file = path.join(parent.directory, prefix + encoded.data.binding.requestId + '.json');
  let fd = null, created = false, openedIdentity = null, status = 'NOT_RETAINED', reason = null;
  const inspectIdentity = expectedSize => {
    recheckExternalDemoStateV1(parent, ROOT);
    const named = fs.lstatSync(file), opened = io.fstatSync(fd); checkFile(named); checkFile(opened);
    if (!same(openedIdentity, named) || !same(openedIdentity, opened) || named.size !== expectedSize || opened.size !== expectedSize) fail('TRIAL_DIAGNOSTIC_CHANGED');
  };
  try {
    recheckExternalDemoStateV1(parent, ROOT);
    fd = io.openSync(file, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    created = true; openedIdentity = identity(io.fstatSync(fd)); inspectIdentity(0);
    let offset = 0;
    while (offset < encoded.bytes.length) {
      const n = io.writeSync(fd, encoded.bytes, offset, encoded.bytes.length - offset, offset);
      if (!Number.isSafeInteger(n) || n <= 0 || n > encoded.bytes.length - offset) fail('TRIAL_DIAGNOSTIC_WRITE'); offset += n;
    }
    io.fsyncSync(fd); inspectIdentity(encoded.bytes.length);
    const readback = Buffer.alloc(encoded.bytes.length); offset = 0;
    while (offset < readback.length) {
      const n = io.readSync(fd, readback, offset, readback.length - offset, offset);
      if (!Number.isSafeInteger(n) || n <= 0 || n > readback.length - offset) fail('TRIAL_DIAGNOSTIC_READBACK'); offset += n;
    }
    if (!encoded.bytes.equals(readback)) fail('TRIAL_DIAGNOSTIC_READBACK');
    inspectIdentity(encoded.bytes.length);
    const original = fd; fd = null; io.closeSync(original);
    const directoryFd = io.openSync(parent.directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    try { io.fsyncSync(directoryFd); } finally { io.closeSync(directoryFd); }
    recheckExternalDemoStateV1(parent, ROOT);
    const named = fs.lstatSync(file); checkFile(named);
    if (!same(openedIdentity, named) || named.size !== encoded.bytes.length) fail('TRIAL_DIAGNOSTIC_CHANGED');
    status = 'RETAINED';
  } catch {
    status = created ? 'COMMIT_UNCERTAIN' : 'NOT_RETAINED'; reason = created ? 'WRITE_OR_CLOSE_UNCONFIRMED' : 'EXCLUSIVE_CREATE_REFUSED';
  } finally {
    if (fd !== null) { const original = fd; fd = null; try { io.closeSync(original); } catch { status = 'COMMIT_UNCERTAIN'; reason = 'CLOSE_UNCONFIRMED'; } }
  }
  return cloneFreeze({ schemaVersion: 'nisi-repository-trial-diagnostic-retention-v1', status, reason, file,
    sha256: encoded.sha256, kind: encoded.data.kind, linkage, capturedBytes: encoded.bytes.length,
    durability: status === 'RETAINED' ? 'OS_FSYNC_READBACK_CLOSE_ACK_ONLY' : 'UNCONFIRMED',
    powerLossVerified: false, hostileWriterIsolation: false, authorizing: false, resumable: false, promotionEligible: false });
}

// One bounded read-only descriptor snapshot. Valid bytes cannot recover a lost
// acknowledgement, prove an execution or upgrade partial diagnostics to terminal.
export function inspectRepositoryTrialDiagnosticV1(file) {
  let fd = null;
  try {
    if (typeof file !== 'string' || !path.isAbsolute(file) || file.length > 4096 || file.includes('\0')) fail('TRIAL_DIAGNOSTIC_PATH');
    const namedPath = path.resolve(file), base = path.basename(namedPath);
    if (base.length !== prefix.length + 69 || !/^repository-diagnostic-[a-f0-9]{64}\.json$/.test(base)) fail('TRIAL_DIAGNOSTIC_PATH');
    if (![fs.constants.O_NOFOLLOW, fs.constants.O_NONBLOCK].every(Number.isInteger)) fail('TRIAL_DIAGNOSTIC_FLAGS');
    const directory = path.dirname(namedPath), originalDirectory = fs.lstatSync(directory), resolvedDirectory = fs.realpathSync(directory);
    if (!originalDirectory.isDirectory() || originalDirectory.isSymbolicLink() || (originalDirectory.mode & 0o077) ||
        (typeof process.getuid === 'function' && originalDirectory.uid !== process.getuid()) ||
        within(fs.realpathSync(ROOT), resolvedDirectory) || within(resolvedDirectory, fs.realpathSync(ROOT))) fail('TRIAL_DIAGNOSTIC_PATH');
    const target = path.join(resolvedDirectory, base), before = fs.lstatSync(target); checkFile(before);
    fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const opened = fs.fstatSync(fd); checkFile(opened);
    if (!same(identity(before), opened) || before.size !== opened.size) fail('TRIAL_DIAGNOSTIC_CHANGED');
    const bytes = Buffer.alloc(opened.size); let offset = 0;
    while (offset < bytes.length) { const n = fs.readSync(fd, bytes, offset, bytes.length - offset, offset); if (n <= 0) fail('TRIAL_DIAGNOSTIC_READ'); offset += n; }
    const after = fs.lstatSync(target), last = fs.fstatSync(fd), finalDirectory = fs.lstatSync(directory); checkFile(after); checkFile(last);
    if (!same(identity(opened), after) || !same(identity(opened), last) || last.size !== opened.size || after.size !== opened.size ||
        last.mtimeMs !== opened.mtimeMs || last.ctimeMs !== opened.ctimeMs || !same(identity(originalDirectory), finalDirectory) ||
        finalDirectory.isSymbolicLink() || !finalDirectory.isDirectory() || (finalDirectory.mode & 0o077)) fail('TRIAL_DIAGNOSTIC_CHANGED');
    const original = fd; fd = null; fs.closeSync(original);
    const decoded = decodeRepositoryTrialDiagnosticV1(bytes);
    if (base !== prefix + decoded.data.binding.requestId + '.json') fail('TRIAL_DIAGNOSTIC_BINDING');
    const linkage = matchLedger(resolvedDirectory, decoded.data.binding);
    return cloneFreeze({ schemaVersion: 'nisi-repository-trial-diagnostic-inspection-v1', status: 'OBSERVED',
      diagnostic: decoded.data, sha256: decoded.sha256, linkage, sourceTrust: 'UNAUTHENTICATED_LOCAL_BYTES',
      pastAcknowledgement: 'UNKNOWN', remoteExecutionStopped: 'UNKNOWN', rawEvidenceRetained: false,
      authorizing: false, resumable: false, measurementVerified: false, promotionEligible: false });
  } catch {
    return cloneFreeze({ schemaVersion: 'nisi-repository-trial-diagnostic-inspection-v1', status: 'UNAVAILABLE',
      diagnostic: null, sha256: null, linkage: null, sourceTrust: 'UNAUTHENTICATED_LOCAL_BYTES',
      pastAcknowledgement: 'UNKNOWN', remoteExecutionStopped: 'UNKNOWN', rawEvidenceRetained: false,
      authorizing: false, resumable: false, measurementVerified: false, promotionEligible: false });
  } finally { if (fd !== null) try { fs.closeSync(fd); } catch { /* no successful observation was published */ } }
}
