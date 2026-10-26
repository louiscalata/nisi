import {createHash} from 'node:crypto';
import {createRunJournal, reopen} from './run-journal-v1.mjs';
import {writeSerializedJournal} from './run-journal-store-v1.mjs';

// Private successor: Opus drafted open/inspect/helpers; Codex owns validation,
// write staging and outcome publication. See the retained coauthor evidence.

const SCHEMA = 'nisi-journal-owner/v2';
const MEANING = 'HISTORY_OBSERVATIONS_ONLY';
const MAX_BYTES = 16 * 1024 * 1024;
const FS_METHODS = ['readFileSync', 'openSync', 'writeSync', 'closeSync', 'renameSync', 'unlinkSync'];
const CONFIG_KEYS = ['projectId', 'maxEntries', 'heartbeatTtlMs', 'redactPaths'];
const HEADER_KEYS = ['type', 'schema', 'config', 'now'];

// Private registry: opaque frozen handle -> mutable private state.
// State fields: path, fs, config, phase, busy, serialized, sha256, snapshot.
const OWNERS = new WeakMap();

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function fail(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}

function refusal(reason) {
  return Object.freeze({schemaVersion: SCHEMA, status: 'REFUSED', reason, authorizing: false});
}

function safeTime(n) {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && !Object.is(n, -0);
}

// Exact request envelope reader. Never invokes getters: values are taken from
// own data descriptors only. Returns a plain object of values or null.
function envelope(input, keys) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) return null;
  if (Reflect.ownKeys(input).length !== keys.length) return null;
  const out = {};
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(input, key);
    if (!d || !d.enumerable || !('value' in d)) return null;
    out[key] = d.value;
  }
  return out;
}

// Strict plain-data deep copy: null, boolean, well-formed string, safe non-negative-zero
// numbers, plain objects and dense arrays only. Accessors, symbol keys, functions,
// undefined, Buffers, class instances and cycles throw PLAIN_DATA. Nothing is
// silently dropped or converted.
function plainCopy(value, stack = new Set()) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (!value.isWellFormed()) throw fail('PLAIN_DATA');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw fail('PLAIN_DATA');
    return value;
  }
  if (typeof value !== 'object' || stack.has(value)) throw fail('PLAIN_DATA');
  const proto = Object.getPrototypeOf(value);
  const isArray = Array.isArray(value);
  if (isArray ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) throw fail('PLAIN_DATA');
  stack.add(value);
  const names = Reflect.ownKeys(value);
  let out;
  if (isArray) {
    if (names.length !== value.length + 1) throw fail('PLAIN_DATA');
    out = [];
    for (let i = 0; i < value.length; i++) {
      const d = Object.getOwnPropertyDescriptor(value, String(i));
      if (!d || !d.enumerable || !('value' in d)) throw fail('PLAIN_DATA');
      out.push(plainCopy(d.value, stack));
    }
  } else {
    out = {};
    for (const key of names) {
      if (typeof key !== 'string') throw fail('PLAIN_DATA');
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (!d || !d.enumerable || !('value' in d)) throw fail('PLAIN_DATA');
      Object.defineProperty(out, key, {value: plainCopy(d.value, stack), enumerable: true, writable: true, configurable: true});
    }
  }
  stack.delete(value);
  return out;
}

// Only ever applied to plainCopy output (no getters, no symbols).
function deepFreeze(value, seen = new Set()) {
  if (value !== null && typeof value === 'object' && !seen.has(value)) {
    seen.add(value);
    for (const key of Object.keys(value)) deepFreeze(value[key], seen);
    Object.freeze(value);
  }
  return value;
}

const frozenPlain = value => deepFreeze(plainCopy(value));

// Canonical JSON with sorted object keys; array order preserved.
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function digest(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

// Parses the already-validated first line of a serialized journal into a plain
// {config, now}. Throws on anything not shaped like the frozen journal header.
function headerOf(serialized) {
  const end = serialized.indexOf('\n');
  if (end < 0) throw fail('HEADER');
  const header = plainCopy(JSON.parse(serialized.slice(0, end)));
  if (Array.isArray(header) || header === null || typeof header !== 'object') throw fail('HEADER');
  if (Object.keys(header).length !== HEADER_KEYS.length || HEADER_KEYS.some(k => !own(header, k))) throw fail('HEADER');
  if (header.type !== 'header' || header.schema !== 'nisi-run-journal-v1' || !safeTime(header.now)) throw fail('HEADER');
  const config = header.config;
  if (config === null || typeof config !== 'object' || Array.isArray(config)) throw fail('HEADER');
  if (Object.keys(config).length !== CONFIG_KEYS.length || CONFIG_KEYS.some(k => !own(config, k))) throw fail('HEADER');
  return {config, now: header.now};
}

function recoveryOf(status, recoveredIds, rejectedLine, reason) {
  return frozenPlain({status, recoveredIds, rejectedLine, reason, authorizing: false});
}

function interruptedOf(entries) {
  const out = [];
  for (const row of entries) {
    const e = row.entry;
    if (e.state === 'RUNNING' && row.liveness === 'UNKNOWN' && !row.revoked && !row.expired) {
      out.push({id: e.id, runId: e.runId, attempt: e.attempt, stage: e.stage, liveness: row.liveness, heartbeatAt: e.heartbeatAt, createdAt: e.createdAt});
    }
  }
  return out;
}

// entries must already be a plain copy of the journal's list(now) result.
function snapshotOf(state, recovery, sha256, bytes, entries) {
  return deepFreeze({
    schemaVersion: SCHEMA,
    state,
    recovery,
    sha256,
    bytes,
    entries,
    interrupted: interruptedOf(entries),
    meaning: MEANING,
    authorizing: false,
  });
}

const NEW_RECOVERY = recoveryOf('NEW', [], null, null);

// Prebuilt cleared uncertainty publication. The write half uses this as the
// fallback when building the real COMMIT_UNCERTAIN diagnostic itself fails.
const UNCERTAIN_SNAPSHOT = snapshotOf('COMMIT_UNCERTAIN', recoveryOf('COMMIT_UNCERTAIN', [], null, 'COMMIT_UNCERTAIN'), null, null, []);

function createState(fields) {
  return {
    path: fields.path,
    fs: fields.fs,
    config: fields.config,
    phase: fields.phase,
    busy: false,
    serialized: fields.serialized,
    sha256: fields.sha256,
    snapshot: fields.snapshot,
  };
}

function publishOwner(state) {
  const owner = Object.freeze({});
  OWNERS.set(owner, state);
  return Object.freeze({schemaVersion: SCHEMA, status: 'OPENED', owner, snapshot: state.snapshot, authorizing: false});
}

export function openJournalOwner(request) {
  const req = envelope(request, ['path', 'fs', 'config', 'now']);
  if (!req) return refusal('INVALID_INPUT');
  const {path, fs, config, now} = req;
  if (typeof path !== 'string' || path.length === 0 || path.includes('\0') || !path.isWellFormed()) return refusal('INVALID_INPUT');
  if (fs === null || (typeof fs !== 'object' && typeof fs !== 'function')) return refusal('INVALID_INPUT');
  for (const name of FS_METHODS) if (typeof fs[name] !== 'function') return refusal('INVALID_INPUT');
  if (!safeTime(now)) return refusal('INVALID_INPUT');

  // Config is validated by the frozen journal; the canonical private copy comes
  // from the fresh journal's own serialized header, never from caller objects.
  let fresh;
  let canonicalConfig;
  try {
    fresh = createRunJournal(config);
    canonicalConfig = deepFreeze(headerOf(fresh.serialize()).config);
  } catch (_) {
    return refusal('INVALID_INPUT');
  }
  const configJson = canonical(canonicalConfig);

  // Single read. ENOENT means NEW; any other failure or non-Buffer is READ_FAILED.
  let raw;
  let missing = false;
  try {
    raw = fs.readFileSync(path);
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') missing = true;
    else return refusal('READ_FAILED');
  }

  if (missing) {
    let entries;
    let serialized;
    try {
      entries = frozenPlain(fresh.list(now));
      serialized = fresh.serialize();
    } catch (_) {
      return refusal('INVALID_INPUT');
    }
    const snapshot = snapshotOf('OPEN', NEW_RECOVERY, null, 0, entries);
    return publishOwner(createState({path, fs, config: canonicalConfig, phase: 'OPEN', serialized, sha256: null, snapshot}));
  }

  if (!Buffer.isBuffer(raw)) return refusal('READ_FAILED');
  const bytes = Buffer.from(raw);
  if (bytes.length > MAX_BYTES) return refusal('SIZE_LIMIT');
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) return refusal('INVALID_UTF8');

  const reopened = reopen(text);
  if (!reopened || !reopened.journal || !reopened.report) return refusal('INVALID_JOURNAL');

  // Project/config/clock binding happens before any list() or row exposure,
  // for COMPLETE, INCOMPLETE and INVALID prefixes alike.
  let persisted;
  try {
    persisted = headerOf(text);
  } catch (_) {
    return refusal('INVALID_JOURNAL');
  }
  if (persisted.config.projectId !== canonicalConfig.projectId) return refusal('PROJECT_MISMATCH');
  if (canonical(persisted.config) !== configJson) return refusal('CONFIG_MISMATCH');
  if (now < persisted.now) return refusal('CLOCK_BEHIND_JOURNAL');

  const report = reopened.report;
  const journal = reopened.journal;
  let entries;
  let recovery;
  try {
    entries = frozenPlain(journal.list(now));
    recovery = recoveryOf(report.status, report.recoveredIds, report.rejectedLine, report.reason);
  } catch (_) {
    return refusal('INVALID_JOURNAL');
  }

  if (report.status === 'COMPLETE') {
    let serialized;
    try {
      serialized = journal.serialize();
    } catch (_) {
      return refusal('INVALID_JOURNAL');
    }
    const sha256 = digest(bytes);
    const snapshot = snapshotOf('OPEN', recovery, sha256, bytes.length, entries);
    return publishOwner(createState({path, fs, config: canonicalConfig, phase: 'OPEN', serialized, sha256, snapshot}));
  }

  if (report.status === 'INCOMPLETE' || report.status === 'INVALID') {
    // Sealed prefix: display only. Never serialize a sealed journal.
    const snapshot = snapshotOf('SEALED', recovery, null, null, entries);
    return publishOwner(createState({path, fs, config: canonicalConfig, phase: 'SEALED', serialized: null, sha256: null, snapshot}));
  }

  return refusal('INVALID_JOURNAL');
}

export function inspectJournalOwner(request) {
  const req = envelope(request, ['owner']);
  if (!req) return refusal('INVALID_INPUT');
  const state = req.owner !== null && typeof req.owner === 'object' ? OWNERS.get(req.owner) : undefined;
  if (!state) return refusal('INVALID_INPUT');
  return Object.freeze({schemaVersion: SCHEMA, status: 'SNAPSHOT', snapshot: state.snapshot, authorizing: false});
}

function recordResult(state, status, reason, append = null, store = null) {
  return Object.freeze({schemaVersion: SCHEMA, status, reason,
    entryId: append?.id ?? null, append, store, snapshot: state.snapshot, authorizing: false});
}

// The store is pinned but its trusted injected filesystem can still fail. Validate
// the closed plain response before converting an outcome into a live publication.
function storeResponseMatches(store, sha256, bytes) {
  if (!store || typeof store !== 'object') return false;
  const common = ['durable', 'committed', 'fsync', 'fsyncErrors', 'status'];
  const keys = store.status === 'REFUSED'
    ? [...common, 'reason'] : [...common, 'sha256', 'bytes', 'verified'];
  if (own(store, 'cleanupError')) keys.push('cleanupError');
  if (!envelope(store, keys) || !['REFUSED', 'WRITTEN', 'UNCHANGED'].includes(store.status)) return false;
  if (typeof store.committed !== 'boolean' || typeof store.durable !== 'boolean') return false;
  if (!envelope(store.fsync, ['file', 'directory']) || !envelope(store.fsyncErrors, ['file', 'directory'])) return false;
  for (const kind of ['file', 'directory']) {
    if (typeof store.fsync[kind] !== 'boolean') return false;
    const error = store.fsyncErrors[kind];
    if (error !== null && (typeof error !== 'string' || !error)) return false;
    if (store.fsync[kind] && error !== null) return false;
  }
  if (own(store, 'cleanupError') && (typeof store.cleanupError !== 'string' || !store.cleanupError)) return false;
  if (store.status === 'REFUSED') return store.durable === false && typeof store.reason === 'string' && store.reason.length > 0;
  if (store.verified !== true || store.sha256 !== sha256 || store.bytes !== bytes) return false;
  if (store.status === 'UNCHANGED') return store.committed === false && store.durable === false
    && store.fsync.file === false && store.fsync.directory === false;
  return store.committed === true && store.durable === (store.fsync.file && store.fsync.directory);
}

function sealUncertain(state, reason) {
  // Clear authority first. If diagnostic copying fails, inspection and later writes
  // still see a sealed, empty publication instead of a stale pre-write snapshot.
  state.phase = 'COMMIT_UNCERTAIN';
  state.sha256 = null;
  state.serialized = null;
  state.snapshot = UNCERTAIN_SNAPSHOT;
  try {
    state.snapshot = snapshotOf('COMMIT_UNCERTAIN',
      recoveryOf('COMMIT_UNCERTAIN', [], null, reason), null, null, []);
  } catch { /* the prebuilt uncertainty snapshot remains authoritative */ }
}

export function recordJournalObservation(request) {
  const req = envelope(request, ['owner', 'entry', 'now']);
  if (!req || !safeTime(req.now)) return refusal('INVALID_INPUT');
  const state = req.owner !== null && typeof req.owner === 'object' ? OWNERS.get(req.owner) : undefined;
  if (!state) return refusal('INVALID_INPUT');
  if (state.phase === 'SEALED') return refusal('OWNER_SEALED');
  if (state.phase === 'COMMIT_UNCERTAIN') return refusal('COMMIT_UNCERTAIN');
  if (state.busy) return refusal('OWNER_BUSY');

  state.busy = true;
  let storeEntered = false;
  let append = null;
  let store = null;
  try {
    const restored = reopen(state.serialized);
    if (!restored.journal || restored.report.status !== 'COMPLETE') throw fail('STAGING_FAILED');
    const staged = restored.journal;
    try {
      append = frozenPlain(staged.append(req.entry, req.now));
    } catch (error) {
      const reason = typeof error?.code === 'string' ? error.code : 'ENTRY';
      return recordResult(state, 'REFUSED', reason);
    }
    if (append.status !== 'APPENDED') {
      return recordResult(state, append.status, append.reason ?? null, append);
    }

    const entries = frozenPlain(staged.list(req.now));
    const serialized = staged.serialize();
    const bytes = Buffer.byteLength(serialized, 'utf8');
    if (bytes > MAX_BYTES) return recordResult(state, 'STORE_FAILED', 'SIZE_LIMIT', append);
    const sha256 = digest(serialized);
    const recovery = recoveryOf('COMPLETE', entries.map(row => row.entry.id), null, null);
    const snapshot = snapshotOf('OPEN', recovery, sha256, bytes, entries);
    const options = {path: state.path, fs: state.fs, serialized};
    if (state.sha256 !== null) options.expectedPreviousSha256 = state.sha256;

    storeEntered = true;
    const response = writeSerializedJournal(options);
    store = frozenPlain(response);
    if (!storeResponseMatches(store, sha256, bytes)) {
      sealUncertain(state, 'STORE_RESPONSE_INVALID');
      return recordResult(state, 'STORE_FAILED', 'STORE_RESPONSE_INVALID', append, store);
    }
    if (store.status === 'REFUSED') {

      const status = !store.committed && store.reason === 'CONFLICT' ? 'STORE_CONFLICT' : 'STORE_FAILED';
      return recordResult(state, status, store.reason, append, store);
    }

    // Every fallible preparation and store check precedes publication. There is
    // no callback or mutable journal operation between these private assignments.
    state.serialized = serialized;
    state.sha256 = sha256;
    state.snapshot = snapshot;
    return recordResult(state, 'RECORDED', null, append, store);
  } catch {
    if (storeEntered) {
      sealUncertain(state, 'STORE_RESPONSE_INVALID');
      return recordResult(state, 'STORE_FAILED', 'STORE_RESPONSE_INVALID', append, store);
    }
    return recordResult(state, 'STORE_FAILED', 'PREPARATION_FAILED', append);
  } finally {
    state.busy = false;
  }
}
