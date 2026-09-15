// Fixed-run journal entry v1 (Nisi, private work order). Turns an accepted
// fixed-run summary into the entry the accepted run journal appends as-is.
// Pure and synchronous: it never mutates its input, never invokes a getter on
// it, never calls a method the input provides, and keeps no state.

const SUMMARY_SCHEMA = 'nisi-fixed-run-summary/v1';
const ENTRY_SCHEMA = 'nisi-fixed-run-entry/v1';
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const INPUT_KEYS = ['summary', 'projectId', 'runId', 'attempt', 'candidateId', 'receiptId', 'createdAt', 'ttlMs'];
const SUMMARY_KEYS = ['schemaVersion', 'identity', 'lifecycle', 'gate', 'reasons', 'adaptation', 'adjudication',
  'table', 'overall', 'isolationAccepted', 'generatedCodeExecuted', 'authorizing'];
const IDENTITY_KEYS = ['childPid', 'servicePid', 'waitObservedPid'];
const LIFECYCLE_KEYS = ['spawnReturn', 'exitCode', 'signal', 'rawWaitStatus', 'stdoutEOF', 'stderrEOF',
  'drainObserved', 'waitObserved', 'timeout', 'outputCapExceeded'];
const LIFECYCLE_INTEGERS = ['spawnReturn', 'exitCode', 'rawWaitStatus'];
const LIFECYCLE_FLAGS = ['stdoutEOF', 'stderrEOF', 'drainObserved', 'waitObserved', 'timeout', 'outputCapExceeded'];
const REASONS = ['SPAWN_FAILED', 'WAIT_NOT_OBSERVED', 'IDENTITY_UNAVAILABLE', 'PID_MISMATCH', 'SIGNALED', 'NONZERO_EXIT',
  'STDOUT_NOT_DRAINED', 'STDERR_NOT_DRAINED', 'DRAIN_NOT_OBSERVED', 'TIMEOUT', 'OUTPUT_CAP_EXCEEDED', 'CANARIES_NOT_MATCHED'];
const BAD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const UNREPRESENTABLE = Symbol('unrepresentable');
const MISSING = Symbol('missing');

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
// Reads an own enumerable data property without invoking any getter; anything
// else (absent, inherited, non-enumerable, accessor) reads as MISSING.
const data = (object, key) => {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor && descriptor.enumerable && own(descriptor, 'value') ? descriptor.value : MISSING;
};
const keysInOrder = (object, keys) => {
  const actual = Object.keys(object);
  return actual.length === keys.length && actual.every((key, i) => key === keys[i]);
};
const keySetIs = (object, keys) => {
  const actual = Object.keys(object).sort();
  const wanted = keys.slice().sort();
  return actual.length === wanted.length && actual.every((key, i) => key === wanted[i]);
};
const isId = (value) => typeof value === 'string' && ID.test(value);
const isNonNegativeInteger = (value) => Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
const isNullOrPositiveInteger = (value) => value === null || (Number.isSafeInteger(value) && value > 0);
const isNullOrInteger = (value) => value === null || Number.isSafeInteger(value);
const isNullOrFlag = (value) => value === null || value === true || value === false;
const refuse = (reason) => ({ status: 'REFUSED', reason, authorizing: false });

// Validates the summary contract and returns the validated view, or null.
// `codes` is the builder's own list of the validated reason codes (used for
// the consistency rules); `reasons` is the input array itself, which the copy
// walk below still has to admit shape-wise before it reaches the payload.
function readSummary(summary) {
  if (!isObject(summary) || !keysInOrder(summary, SUMMARY_KEYS)) return null;
  if (data(summary, 'schemaVersion') !== SUMMARY_SCHEMA) return null;
  if (data(summary, 'isolationAccepted') !== false || data(summary, 'generatedCodeExecuted') !== false
    || data(summary, 'authorizing') !== false) return null;
  const identity = data(summary, 'identity');
  if (!isObject(identity) || !keysInOrder(identity, IDENTITY_KEYS)) return null;
  if (!IDENTITY_KEYS.every((key) => isNullOrPositiveInteger(data(identity, key)))) return null;
  const lifecycle = data(summary, 'lifecycle');
  if (!isObject(lifecycle) || !keysInOrder(lifecycle, LIFECYCLE_KEYS)) return null;
  if (!LIFECYCLE_INTEGERS.every((key) => isNullOrInteger(data(lifecycle, key)))) return null;
  if (!LIFECYCLE_FLAGS.every((key) => isNullOrFlag(data(lifecycle, key)))) return null;
  const signal = data(lifecycle, 'signal');
  if (!(signal === null || typeof signal === 'string' || typeof signal === 'number')) return null;
  const gate = data(summary, 'gate');
  if (gate !== 'RUN_COMPLETE' && gate !== 'RUN_INCOMPLETE') return null;
  const overall = data(summary, 'overall');
  if (overall !== 'OBSERVED' && overall !== 'NOT_ACCEPTED') return null;
  const reasons = data(summary, 'reasons');
  if (!Array.isArray(reasons)) return null;
  const codes = [];
  let last = -1;
  for (let i = 0; i < reasons.length; i++) {
    const code = data(reasons, String(i));
    const index = REASONS.indexOf(code);
    if (index < 0 || index <= last) return null;
    last = index;
    codes.push(code);
  }
  const lifecycleFault = codes.some((code) => code !== 'CANARIES_NOT_MATCHED');
  if ((gate === 'RUN_COMPLETE') === lifecycleFault) return null;
  if ((overall === 'OBSERVED') !== (codes.length === 0)) return null;
  const identityMissing = data(identity, 'childPid') === null || data(identity, 'servicePid') === null;
  if (codes.includes('IDENTITY_UNAVAILABLE') !== identityMissing) return null;
  const adaptation = data(summary, 'adaptation');
  const adjudication = data(summary, 'adjudication');
  const table = data(summary, 'table');
  if (identityMissing) {
    if (adaptation !== null || adjudication !== null || table !== null || codes.includes('CANARIES_NOT_MATCHED')) return null;
    return { overall, gate, codes, reasons, identity, lifecycle, adaptation: null, adjudication: null, table: null };
  }
  if (!isObject(adaptation) || typeof data(adaptation, 'version') !== 'string') return null;
  if (!isObject(data(adaptation, 'counts')) || !Array.isArray(data(adaptation, 'report'))) return null;
  if (!isObject(adjudication)) return null;
  const adjudicationOverall = data(adjudication, 'overall');
  if (adjudicationOverall !== 'ALL_MATCHED' && adjudicationOverall !== 'NOT_ACCEPTED') return null;
  if (!isObject(data(adjudication, 'counts'))) return null;
  if (data(adjudication, 'malformedLines') === MISSING || data(adjudication, 'unexpectedOperations') === MISSING) return null;
  if (data(adjudication, 'isolationAccepted') !== false) return null;
  if (typeof table !== 'string') return null;
  if (codes.includes('CANARIES_NOT_MATCHED') !== (adjudicationOverall !== 'ALL_MATCHED')) return null;
  return {
    overall,
    gate,
    codes,
    reasons,
    identity,
    lifecycle,
    adaptation: { version: data(adaptation, 'version'), counts: data(adaptation, 'counts'), report: data(adaptation, 'report') },
    adjudication: { overall: adjudicationOverall, counts: data(adjudication, 'counts'),
      malformedLines: data(adjudication, 'malformedLines'), unexpectedOperations: data(adjudication, 'unexpectedOperations') },
    table
  };
}

// Journal-representable deep copy: null, booleans, well-formed strings, safe
// integers (never -0), dense arrays with exactly Array.prototype, and plain or
// null-prototype objects, walked through own enumerable string-keyed data
// properties with well-formed names. Anything else, a symbol key, a forbidden
// key or a cycle yields UNREPRESENTABLE. The copy shares nothing with the
// source and no getter is ever invoked.
function copy(value, stack) {
  if (value === null || value === true || value === false) return value;
  if (typeof value === 'string') return value.isWellFormed() ? value : UNREPRESENTABLE;
  if (typeof value === 'number') return Number.isSafeInteger(value) && !Object.is(value, -0) ? value : UNREPRESENTABLE;
  if (typeof value !== 'object') return UNREPRESENTABLE;
  if (stack.includes(value)) return UNREPRESENTABLE;
  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) return UNREPRESENTABLE;
    const names = Object.getOwnPropertyNames(value);
    const length = value.length;
    if (names.length !== length + 1 || !names.includes('length') || Reflect.ownKeys(value).length !== names.length) return UNREPRESENTABLE;
    stack.push(value);
    const out = [];
    for (let i = 0; i < length; i++) {
      const item = data(value, String(i));
      if (item === MISSING) return UNREPRESENTABLE;
      const copied = copy(item, stack);
      if (copied === UNREPRESENTABLE) return UNREPRESENTABLE;
      out.push(copied);
    }
    stack.pop();
    return out;
  }
  if (prototype !== Object.prototype && prototype !== null) return UNREPRESENTABLE;
  const names = Object.getOwnPropertyNames(value);
  const keys = Object.keys(value);
  if (names.length !== keys.length || Reflect.ownKeys(value).length !== keys.length) return UNREPRESENTABLE;
  stack.push(value);
  const out = {};
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (BAD_KEYS.has(key) || !key.isWellFormed()) return UNREPRESENTABLE;
    const item = data(value, key);
    if (item === MISSING) return UNREPRESENTABLE;
    const copied = copy(item, stack);
    if (copied === UNREPRESENTABLE) return UNREPRESENTABLE;
    out[key] = copied;
  }
  stack.pop();
  return out;
}

export function fixedRunJournalEntry(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('input must be a non-null object that is neither an array nor callable');
  }
  if (!keySetIs(input, INPUT_KEYS)) return refuse('INVALID_INPUT');
  const view = readSummary(data(input, 'summary'));
  if (view === null) return refuse('INVALID_SUMMARY');
  const projectId = data(input, 'projectId');
  if (!isId(projectId)) return refuse('INVALID_PROJECT');
  const runId = data(input, 'runId');
  if (!isId(runId)) return refuse('INVALID_RUN');
  const candidateId = data(input, 'candidateId');
  if (!isId(candidateId)) return refuse('INVALID_CANDIDATE');
  const receiptId = data(input, 'receiptId');
  if (receiptId !== null && !isId(receiptId)) return refuse('INVALID_RECEIPT');
  const attempt = data(input, 'attempt');
  if (!isNonNegativeInteger(attempt)) return refuse('INVALID_ATTEMPT');
  const createdAt = data(input, 'createdAt');
  const ttlMs = data(input, 'ttlMs');
  if (!isNonNegativeInteger(createdAt) || !Number.isSafeInteger(ttlMs) || ttlMs < 1 || !Number.isSafeInteger(createdAt + ttlMs)) {
    return refuse('INVALID_TIME');
  }
  const id = `${runId}:${attempt}:fixed-run`;
  if (id.length > 128) return refuse('ID_TOO_LONG');

  const payload = copy({
    schemaVersion: ENTRY_SCHEMA,
    summarySchema: SUMMARY_SCHEMA,
    overall: view.overall,
    gate: view.gate,
    reasons: view.reasons,
    identity: view.identity,
    lifecycle: view.lifecycle,
    adaptation: view.adaptation,
    adjudication: view.adjudication,
    table: view.table,
    isolationAccepted: false,
    generatedCodeExecuted: false,
    authorizing: false
  }, []);
  if (payload === UNREPRESENTABLE) return refuse('PAYLOAD_UNREPRESENTABLE');

  const entry = {
    id,
    projectId,
    runId,
    attempt,
    candidateId,
    stage: 'fixed-run',
    receiptId,
    createdAt,
    ttlMs,
    state: view.overall === 'OBSERVED' ? 'SUCCEEDED' : 'FAILED',
    heartbeatAt: null,
    retryOf: null,
    revokes: null,
    payload
  };
  return { status: 'ENTRY', entry, authorizing: false };
}
