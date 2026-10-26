import { createRunJournal, reopen } from './run-journal-v1.mjs';
import { readSerializedJournal, writeSerializedJournal } from './run-journal-store-v1.mjs';
import { fixedRunJournalEntry } from './fixed-run-journal-entry.mjs';

const bundles = new WeakMap();
const OPEN_KEYS = ['path', 'fs', 'config', 'now'];
const RECORD_KEYS = ['bundle', 'run', 'now'];
const RUN_KEYS = ['summary', 'runId', 'attempt', 'candidateId', 'receiptId', 'createdAt', 'ttlMs'];
const FS_METHODS = ['readFileSync', 'openSync', 'writeSync', 'closeSync', 'renameSync', 'unlinkSync'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeTime = value => Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);

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
  bundles.set(bundle, { path, fs, config, journal, lastGoodSerialized: rawText });
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
    return recordResult('RECORDED', entryId, appended, stored, stored.sha256, stored.bytes);
  }

  // Rebuild from the last accepted disk text, discarding append and pruning.
  state.journal = state.lastGoodSerialized === null
    ? createRunJournal(state.config)
    : reopen(state.lastGoodSerialized).journal;
  bundle.journal = state.journal;
  return recordResult(stored.reason === 'CONFLICT' ? 'STORE_CONFLICT' : 'STORE_FAILED',
    entryId, appended, stored, bundle.sha256, bundle.bytes);
}
