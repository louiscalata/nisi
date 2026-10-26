import { createRunJournal, reopen } from './run-journal-v1.mjs';
import { readSerializedJournal, writeSerializedJournal } from './run-journal-store-v1.mjs';
import { fixedRunJournalEntry } from './fixed-run-journal-entry.mjs';
import { types } from 'node:util';

const bundles = new WeakMap();
const OPEN_KEYS = ['path', 'fs', 'config', 'now'];
const RECORD_KEYS = ['bundle', 'run', 'now'];
const RUN_KEYS = ['summary', 'runId', 'attempt', 'candidateId', 'receiptId', 'createdAt', 'ttlMs'];
const OBSERVATION_KEYS = ['bundle', 'settled', 'now', 'ttlMs'];
const HOST_KEYS = ['schemaVersion', 'report', 'invocations', 'staticHistory', 'testHistory', 'settlementErrors', 'historyErrors',
  'ownerStateErrors', 'ownerStates', 'state', 'bundle', 'bundleSummary', 'bundleError', 'proposedChanges', 'applied', 'sandboxed',
  'authorizing', 'certificationGranted'];
const REPORT_KEYS = ['schemaVersion', 'runId', 'taskId', 'taskFingerprint', 'mode', 'outcome', 'workflowOutcome', 'code', 'candidate',
  'candidateFingerprint', 'repairAttempts', 'stages', 'reportStored', 'reportStoreCode', 'storedReportSha256', 'reportStoreEvidence'];
const REPOSITORY_BUNDLE_KEYS = ['schemaVersion', 'scope', 'report', 'reportSha256', 'preparation', 'staticPlans', 'staticBundle',
  'testEntries', 'nodeSuiteFingerprint', 'nodeRegistrationFingerprint', 'executionVerified', 'authorizing', 'certificationGranted',
  'sandboxed', 'noDescendantsEnforced', 'fingerprint'];
const SUMMARY_KEYS = ['status', 'scope', 'runId', 'taskFingerprint', 'candidateFingerprint', 'preparationFingerprint',
  'baselineFingerprint', 'materializedFingerprint', 'outcome', 'workflowOutcome', 'code', 'reportStoreCode', 'staticSummary',
  'nodeSuiteFingerprint', 'nodeRegistrationFingerprint', 'testCount', 'rawTestCounts', 'recordedTestPasses',
  'unrecordedRawTestPasses', 'interruptedTests', 'unknownTestDrainCount', 'finalChecksRecordedPass', 'executionVerified',
  'authorizing', 'certificationGranted', 'reportSha256', 'fingerprint'];
const PREPARATION_KEYS = ['fingerprint', 'taskFingerprint', 'candidateFingerprint', 'baselineFingerprint', 'materializedFingerprint'];
const OUTCOME_STATE = Object.freeze({ COMPLETED: 'SUCCEEDED', CANCELLED: 'CANCELLED', TIMED_OUT: 'CANCELLED', FAILED: 'FAILED',
  BLOCKED: 'FAILED', REPAIR_LIMIT: 'FAILED', NO_PROGRESS: 'FAILED' });
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const FS_METHODS = ['readFileSync', 'openSync', 'writeSync', 'closeSync', 'renameSync', 'unlinkSync'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeTime = value => Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
const id = value => typeof value === 'string' && ID.test(value);
const hex = value => typeof value === 'string' && HEX64.test(value);

function exact(value, keys) {
  if (!object(value)) return false;
  const actual = Reflect.ownKeys(value).filter(key => Object.prototype.propertyIsEnumerable.call(value, key));
  return actual.length === keys.length && keys.every(key => actual.includes(key));
}

const refuseOpen = reason => ({ status: 'REFUSED', reason, authorizing: false });
const refuseRecord = (reason, entryId = null) => ({
  status: 'REFUSED', reason, entryId, journal: null, store: null, sha256: null, bytes: null, authorizing: false
});
const recordResult = (status, entryId, journal, store, sha256, bytes) => ({
  status, entryId, journal, store, sha256, bytes, authorizing: false
});
const observationResult = (status, reason, entryId = null, journal = null, store = null, sha256 = null, bytes = null) => ({
  status, reason, entryId, journal, store, sha256, bytes, sourceAuthenticityAttested: false,
  authorizing: false, executionGranted: false, resumeGranted: false, consentRestored: false,
  learningPromoted: false, generatedCodeExecuted: false
});

// Proxy-first, own-data-only projection. This establishes coherence of a caller
// supplied settled record; it does not establish that the record came from an
// issued host. Observation rows are terminal history and grant no authority.
function dataRecord(value, keys, code) {
  if (types.isProxy(value) || !object(value)) throw Object.assign(new Error(code), { code });
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw Object.assign(new Error(code), { code });
  const descriptors = Object.getOwnPropertyDescriptors(value), own = Reflect.ownKeys(descriptors);
  if (own.length !== keys.length || own.some(key => typeof key !== 'string') || keys.some(key => !Object.hasOwn(descriptors, key))) {
    throw Object.assign(new Error(code), { code });
  }
  const result = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw Object.assign(new Error(code), { code });
    result[key] = descriptor.value;
  }
  return result;
}

function settledObservation(value) {
  const host = dataRecord(value, HOST_KEYS, 'HOST_SCHEMA');
  if (host.schemaVersion !== 'nisi-reviewed-repository-host-v1') throw Object.assign(new Error('HOST_SCHEMA'), { code: 'HOST_SCHEMA' });
  if (host.state !== 'SETTLED' || host.bundle === null || host.bundleSummary === null || host.bundleError !== null) {
    throw Object.assign(new Error('HOST_NOT_SETTLED'), { code: 'HOST_NOT_SETTLED' });
  }
  if (host.applied !== false || host.sandboxed !== false || host.authorizing !== false || host.certificationGranted !== false) {
    throw Object.assign(new Error('HOST_AUTHORITY_FLAGS'), { code: 'HOST_AUTHORITY_FLAGS' });
  }
  const report = dataRecord(host.report, REPORT_KEYS, 'HOST_SCHEMA');
  const repositoryBundle = dataRecord(host.bundle, REPOSITORY_BUNDLE_KEYS, 'HOST_SCHEMA');
  const summary = dataRecord(host.bundleSummary, SUMMARY_KEYS, 'HOST_SCHEMA');
  const bundleReport = dataRecord(repositoryBundle.report, REPORT_KEYS, 'HOST_SCHEMA');
  const preparation = dataRecord(repositoryBundle.preparation, PREPARATION_KEYS, 'HOST_SCHEMA');
  if (repositoryBundle.executionVerified !== false || repositoryBundle.authorizing !== false ||
      repositoryBundle.certificationGranted !== false || repositoryBundle.sandboxed !== false ||
      repositoryBundle.noDescendantsEnforced !== false ||
      summary.executionVerified !== false || summary.authorizing !== false || summary.certificationGranted !== false) {
    throw Object.assign(new Error('HOST_AUTHORITY_FLAGS'), { code: 'HOST_AUTHORITY_FLAGS' });
  }
  if (report.schemaVersion !== 1 || bundleReport.schemaVersion !== 1 ||
      repositoryBundle.schemaVersion !== 'nisi-repository-run-v1' ||
      summary.status !== 'CONSISTENT' || summary.scope !== repositoryBundle.scope || summary.fingerprint !== repositoryBundle.fingerprint ||
      summary.reportSha256 !== repositoryBundle.reportSha256 || summary.runId !== report.runId || bundleReport.runId !== report.runId ||
      summary.taskFingerprint !== report.taskFingerprint || bundleReport.taskFingerprint !== report.taskFingerprint ||
      summary.candidateFingerprint !== report.candidateFingerprint || bundleReport.candidateFingerprint !== report.candidateFingerprint ||
      preparation.taskFingerprint !== report.taskFingerprint || preparation.candidateFingerprint !== report.candidateFingerprint ||
      preparation.fingerprint !== summary.preparationFingerprint || preparation.baselineFingerprint !== summary.baselineFingerprint ||
      preparation.materializedFingerprint !== summary.materializedFingerprint ||
      summary.outcome !== report.outcome || bundleReport.outcome !== report.outcome ||
      summary.workflowOutcome !== report.workflowOutcome || bundleReport.workflowOutcome !== report.workflowOutcome ||
      summary.code !== report.code || bundleReport.code !== report.code || summary.reportStoreCode !== report.reportStoreCode ||
      summary.nodeSuiteFingerprint !== repositoryBundle.nodeSuiteFingerprint ||
      summary.nodeRegistrationFingerprint !== repositoryBundle.nodeRegistrationFingerprint) {
    throw Object.assign(new Error('HOST_IDENTITY_MISMATCH'), { code: 'HOST_IDENTITY_MISMATCH' });
  }
  if (!id(report.runId) || !hex(report.taskFingerprint) || !hex(report.candidateFingerprint) ||
      !Number.isSafeInteger(report.repairAttempts) || report.repairAttempts < 0 ||
      typeof report.outcome !== 'string' || typeof report.workflowOutcome !== 'string' ||
      !Object.hasOwn(OUTCOME_STATE, report.outcome) || !Object.hasOwn(OUTCOME_STATE, report.workflowOutcome) ||
      !(report.code === null || typeof report.code === 'string' && report.code.length > 0 && report.code.length <= 4096 && report.code.isWellFormed() && !report.code.includes('\0')) ||
      !hex(summary.preparationFingerprint) || !hex(summary.baselineFingerprint) || !hex(summary.materializedFingerprint) ||
      !hex(repositoryBundle.fingerprint) || !hex(repositoryBundle.reportSha256) ||
      !hex(repositoryBundle.nodeSuiteFingerprint) || !hex(repositoryBundle.nodeRegistrationFingerprint) ||
      typeof summary.finalChecksRecordedPass !== 'boolean' || types.isProxy(host.invocations) ||
      !Array.isArray(host.invocations) || Object.getPrototypeOf(host.invocations) !== Array.prototype) {
    throw Object.assign(new Error('HOST_IDENTITY_MISMATCH'), { code: 'HOST_IDENTITY_MISMATCH' });
  }
  const invocationDescriptors = Object.getOwnPropertyDescriptors(host.invocations), length = invocationDescriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < 0 || Reflect.ownKeys(invocationDescriptors).length !== length + 1 ||
      Array.from({ length }, (_, index) => invocationDescriptors[index]).some(descriptor => !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value'))) {
    throw Object.assign(new Error('HOST_IDENTITY_MISMATCH'), { code: 'HOST_IDENTITY_MISMATCH' });
  }
  return { report, repositoryBundle, summary, invocationCount: length };
}

// The public bundle is an inspection view, not storage authority. The issued
// private state remains authoritative; any replacement/accessor/tampering of
// fields used by this seam is refused without invoking caller code.
function issuedViewIntact(bundle, state) {
  if (types.isProxy(bundle) || !object(bundle)) return false;
  const descriptors = Object.getOwnPropertyDescriptors(bundle);
  const sameData = (key, expected) => {
    const descriptor = descriptors[key];
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value') && descriptor.value === expected;
  };
  return sameData('status', state.status) && sameData('journal', state.journal) &&
    sameData('sha256', state.sha256) && sameData('bytes', state.bytes) && sameData('entries', state.entries);
}

function hostObservationEntry(view, projectId, now, ttlMs) {
  const { report, repositoryBundle, summary, invocationCount } = view;
  const entryId = `${report.runId}:${report.repairAttempts}:repository-host`;
  if (!id(entryId)) throw Object.assign(new Error('ID_TOO_LONG'), { code: 'ID_TOO_LONG' });
  return {
    id: entryId, projectId, runId: report.runId, attempt: report.repairAttempts,
    candidateId: report.candidateFingerprint, stage: 'repository-host', receiptId: repositoryBundle.fingerprint,
    createdAt: now, ttlMs, state: OUTCOME_STATE[report.workflowOutcome], heartbeatAt: null, retryOf: null, revokes: null,
    payload: {
      schemaVersion: 'nisi-host-restart-observation/v1', hostSchema: 'nisi-reviewed-repository-host-v1', hostState: 'SETTLED',
      runId: report.runId, taskFingerprint: report.taskFingerprint, candidateFingerprint: report.candidateFingerprint,
      preparationFingerprint: summary.preparationFingerprint, repairAttempts: report.repairAttempts, outcome: report.outcome,
      workflowOutcome: report.workflowOutcome, code: report.code, bundleFingerprint: repositoryBundle.fingerprint,
      reportSha256: repositoryBundle.reportSha256, nodeSuiteFingerprint: repositoryBundle.nodeSuiteFingerprint,
      nodeRegistrationFingerprint: repositoryBundle.nodeRegistrationFingerprint, finalChecksRecordedPass: summary.finalChecksRecordedPass,
      invocationCount, executionVerified: false, applied: false, sandboxed: false, certificationGranted: false,
      learningEligible: false, consentRestored: false, resumeGranted: false, sourceAuthenticityAttested: false, authorizing: false
    }
  };
}

function emptySealedJournal() {
  return {
    append(entry) {
      let id = null;
      try { id = entry?.id ?? null; } catch {}
      return { status: 'REFUSED', id, reason: 'SEALED' };
    },
    list() { return []; }
  };
}

export function openJournalBundle(input) {
  let path, fs, config, now, journal;
  try {
    if (!exact(input, OPEN_KEYS)) return refuseOpen('INVALID_INPUT');
    ({ path, fs, config, now } = input);
    if (typeof path !== 'string' || path.length === 0 || fs === null || typeof fs !== 'object'
      || !FS_METHODS.every(key => typeof fs[key] === 'function') || !safeTime(now)) {
      return refuseOpen('INVALID_INPUT');
    }
    journal = createRunJournal(config);
    // Preserve the validated configuration for entry identity and NEW rollback.
    config = { ...config, redactPaths: config.redactPaths.slice() };
  } catch {
    return refuseOpen('INVALID_INPUT');
  }

  const read = readSerializedJournal({ path, fs });
  let recovery, rawText = null, sha256 = null, bytes = 0;
  if (read.status === 'REFUSED' && read.reason === 'NOT_FOUND') {
    recovery = { status: 'NEW', recoveredIds: [], rejectedLine: null, reason: null, authorizing: false };
  } else if (read.status === 'READ' || read.reason === 'INVALID_JOURNAL') {
    if (read.status === 'READ') {
      rawText = read.serialized;
      sha256 = read.sha256;
      bytes = read.bytes;
    } else {
      try {
        const rawBytes = fs.readFileSync(path);
        if (!Buffer.isBuffer(rawBytes)) return refuseOpen('READ_FAILED');
        rawText = rawBytes.toString('utf8');
        bytes = rawBytes.byteLength;
      } catch {
        return refuseOpen('READ_FAILED');
      }
    }
    const recovered = reopen(rawText);
    recovery = recovered.report;
    journal = recovered.journal ?? emptySealedJournal();
    if (recovery.status === 'COMPLETE' || recovery.status === 'INCOMPLETE') {
      // These recovery states have already validated the persisted header.
      const header = JSON.parse(rawText.split('\n', 1)[0]);
      if (header.config.projectId !== config.projectId) return refuseOpen('PROJECT_MISMATCH');
    }
  } else {
    return refuseOpen('READ_FAILED');
  }

  let entries;
  try { entries = Array.from(journal.list(now)); } catch { return refuseOpen('INVALID_INPUT'); }
  const interrupted = entries
    .filter(row => row.entry.state === 'RUNNING' && row.liveness === 'UNKNOWN' && !row.revoked && !row.expired)
    .map(({ entry, liveness }) => ({
      id: entry.id,
      runId: entry.runId,
      attempt: entry.attempt,
      stage: entry.stage,
      liveness,
      heartbeatAt: entry.heartbeatAt,
      createdAt: entry.createdAt
    }));
  const bundle = {
    status: recovery.status === 'NEW' || recovery.status === 'COMPLETE' ? 'OPEN' : 'SEALED',
    recovery: {
      status: recovery.status,
      recoveredIds: Array.from(recovery.recoveredIds),
      rejectedLine: recovery.rejectedLine,
      reason: recovery.reason,
      authorizing: false
    },
    sha256,
    bytes,
    entries,
    interrupted,
    journal,
    authorizing: false
  };
  bundles.set(bundle, { path, fs, config, journal, lastGoodSerialized: rawText,
    status: bundle.status, sha256, bytes, entries: bundle.entries });
  return bundle;
}

export function recordFixedRun(input) {
  let bundle, run, now, state;
  try {
    if (!exact(input, RECORD_KEYS)) return refuseRecord('INVALID_INPUT');
    ({ bundle, run, now } = input);
    if (!object(bundle) || !['OPEN', 'SEALED'].includes(bundle.status)
      || !object(bundle.journal) || typeof bundle.journal.append !== 'function'
      || !object(bundle.recovery) || !object(run) || !safeTime(now)) {
      return refuseRecord('INVALID_INPUT');
    }
    state = bundles.get(bundle);
    if (!state) return refuseRecord('INVALID_INPUT');
  } catch {
    return refuseRecord('INVALID_INPUT');
  }
  if (bundle.status === 'SEALED') return refuseRecord('BUNDLE_SEALED');

  let built;
  try {
    if (!exact(run, RUN_KEYS)) return refuseRecord('INVALID_INPUT');
    built = fixedRunJournalEntry({ ...run, projectId: state.config.projectId });
  } catch {
    return refuseRecord('INVALID_INPUT');
  }
  if (built.status === 'REFUSED') return refuseRecord(built.reason);

  const entryId = built.entry.id;
  let appended;
  try { appended = bundle.journal.append(built.entry, now); } catch (error) {
    return refuseRecord(error?.code ?? 'INVALID_INPUT', entryId);
  }
  if (appended.status === 'REFUSED') return refuseRecord(appended.reason, entryId);
  if (appended.status === 'DUPLICATE' || appended.status === 'CONFLICT') {
    return recordResult(appended.status, entryId, appended, null, bundle.sha256, bundle.bytes);
  }

  const serialized = bundle.journal.serialize();
  const options = { path: state.path, serialized, fs: state.fs };
  if (typeof bundle.sha256 === 'string') options.expectedPreviousSha256 = bundle.sha256;
  const stored = writeSerializedJournal(options);
  if (stored.status === 'WRITTEN' || stored.status === 'UNCHANGED') {
    state.lastGoodSerialized = serialized;
    state.journal = bundle.journal;
    bundle.sha256 = stored.sha256;
    bundle.bytes = stored.bytes;
    bundle.entries = Array.from(bundle.journal.list(now));
    state.sha256 = bundle.sha256;
    state.bytes = bundle.bytes;
    state.entries = bundle.entries;
    return recordResult('RECORDED', entryId, appended, stored, stored.sha256, stored.bytes);
  }

  // Rebuild from the last accepted disk text, discarding append and pruning.
  state.journal = state.lastGoodSerialized === null
    ? createRunJournal(state.config)
    : reopen(state.lastGoodSerialized).journal;
  bundle.journal = state.journal;
  state.entries = bundle.entries;
  return recordResult(stored.reason === 'CONFLICT' ? 'STORE_CONFLICT' : 'STORE_FAILED',
    entryId, appended, stored, bundle.sha256, bundle.bytes);
}

export function recordHostObservationV1(input) {
  let bundle, settled, now, ttlMs, state, view, entry;
  try {
    ({ bundle, settled, now, ttlMs } = dataRecord(input, OBSERVATION_KEYS, 'INVALID_INPUT'));
    state = bundles.get(bundle);
    if (!state) return observationResult('REFUSED', 'INVALID_INPUT');
    if (!issuedViewIntact(bundle, state)) return observationResult('REFUSED', 'BUNDLE_TAMPERED');
    if (state.status === 'SEALED') return observationResult('REFUSED', 'BUNDLE_SEALED');
    if (state.status !== 'OPEN') return observationResult('REFUSED', 'INVALID_INPUT');
    if (!safeTime(now) || !Number.isSafeInteger(ttlMs) || ttlMs < 1 || !safeTime(now + ttlMs)) {
      return observationResult('REFUSED', 'INVALID_TIME');
    }
    view = settledObservation(settled);
    entry = hostObservationEntry(view, state.config.projectId, now, ttlMs);
  } catch (error) {
    return observationResult('REFUSED', typeof error?.code === 'string' ? error.code : 'INVALID_INPUT');
  }

  // Opening or listing advances the in-memory watermark without writing disk.
  // Restore that exact pre-append state, including NEW journals, on failure.
  let preAppendSerialized;
  try { preAppendSerialized = state.journal.serialize(); }
  catch (error) { return observationResult('REFUSED', error?.code ?? 'INVALID_INPUT', entry.id); }
  const rollback = () => {
    state.journal = reopen(preAppendSerialized).journal;
    bundle.journal = state.journal;
    bundle.sha256 = state.sha256;
    bundle.bytes = state.bytes;
    bundle.entries = state.entries;
  };

  let appended;
  try { appended = bundle.journal.append(entry, now); }
  catch (error) { return observationResult('REFUSED', error?.code ?? 'INVALID_INPUT', entry.id); }
  if (appended.status === 'REFUSED') return observationResult('REFUSED', appended.reason, entry.id);
  if (appended.status === 'DUPLICATE' || appended.status === 'CONFLICT') {
    return observationResult(appended.status, appended.reason ?? null, entry.id, appended, null, bundle.sha256, bundle.bytes);
  }

  let stored;
  try {
    const serialized = bundle.journal.serialize();
    const options = { path: state.path, serialized, fs: state.fs };
    if (typeof state.sha256 === 'string') options.expectedPreviousSha256 = state.sha256;
    stored = writeSerializedJournal(options);
    if (stored.status === 'WRITTEN' || stored.status === 'UNCHANGED') {
      state.lastGoodSerialized = serialized;
      state.journal = bundle.journal;
      bundle.sha256 = stored.sha256;
      bundle.bytes = stored.bytes;
      bundle.entries = Array.from(bundle.journal.list(now));
      state.sha256 = bundle.sha256;
      state.bytes = bundle.bytes;
      state.entries = bundle.entries;
      return observationResult('OBSERVED', null, entry.id, appended, stored, stored.sha256, stored.bytes);
    }
  } catch (error) {
    rollback();
    return observationResult('STORE_FAILED', error?.code ?? 'STORE_FAILED', entry.id, appended, null, bundle.sha256, bundle.bytes);
  }

  rollback();
  return observationResult(stored.reason === 'CONFLICT' ? 'STORE_CONFLICT' : 'STORE_FAILED', stored.reason,
    entry.id, appended, stored, bundle.sha256, bundle.bytes);
}
