// Private, source-bound, single-use admission. Not authenticated user consent,
// execution evidence, native incident admission, erasure or commit-time revocation.
import {createHash} from 'node:crypto';
import {inspectJournalOwner, recordJournalObservation} from './journal-owner-v2.mjs';
import {fixedXpcJournalObservation} from './fixed-xpc-journal-observation-v1.mjs';

const PERMITS = new WeakMap();
const DECLARATION_KEYS = ['schemaVersion', 'declarationId', 'projectId', 'candidateId',
  'receiptId', 'consentClass', 'sourceSha256', 'issuedAt', 'expiresAt', 'createdAt',
  'retentionMs', 'destination', 'rawContentPersisted', 'networkEgress', 'learningInfluence'];
const safeTime = value => Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
const sha = value => createHash('sha256').update(value).digest('hex');

// Exact plain/null-prototype own enumerable DATA keys. Never call an accessor.
// Proxy traps, injected clocks and the owner's injected FS are trusted host code.
function read(input, keys) {
  if (input === null || typeof input !== 'object' || Array.isArray(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
      Reflect.ownKeys(input).length !== keys.length) return null;
  const values = {};
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(input, key);
    if (!d || !d.enumerable || !Object.hasOwn(d, 'value')) return null;
    values[key] = d.value;
  }
  return values;
}

function declarationOf(input) {
  const d = read(input, DECLARATION_KEYS);
  if (!d || d.schemaVersion !== 'nisi-fixed-xpc-history-declaration/v1' ||
      ![d.declarationId, d.projectId, d.candidateId, d.receiptId].every(id) ||
      d.consentClass !== 'WRITTEN_DECLARATION' || typeof d.sourceSha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(d.sourceSha256) ||
      ![d.issuedAt, d.expiresAt, d.createdAt, d.retentionMs].every(safeTime) ||
      d.expiresAt <= d.issuedAt || d.expiresAt - d.issuedAt > 3600000 ||
      d.retentionMs < 1 || d.retentionMs > 7776000000 || !safeTime(d.createdAt + d.retentionMs) ||
      d.destination !== 'LOCAL_OBSERVATION_JOURNAL_ONLY' ||
      d.rawContentPersisted !== false || d.networkEgress !== false || d.learningInfluence !== false) return null;
  return Object.freeze(d);
}

// The validated declaration has only scalar data values.
function declarationHash(d) {
  const text = '{' + Object.keys(d).sort().map(key => JSON.stringify(key) + ':' + JSON.stringify(d[key])).join(',') + '}';
  return sha('nisi-history-declaration/v1\n' + text);
}
function permitResult(status, reason = null, permit = null, declarationDigest = null) {
  return Object.freeze({schemaVersion: 'nisi-fixed-xpc-history-permit/v1', status,
    reason, permit, declarationDigest, authorizing: false});
}
function captureResult(state, status, reason, recordAttempted = false, journal = null) {
  return Object.freeze({schemaVersion: 'nisi-fixed-xpc-history-capture/v1', status,
    reason, recordAttempted, declarationDigest: state?.digest ?? null, journal,
    meaning: 'HISTORY_OBSERVATIONS_ONLY', authorizing: false});
}

function currentTime(state) {
  let now;
  try { now = state.clock(); }
  catch {
    // A trusted callback may revoke synchronously and then throw. Preserve that
    // explicit decision before classifying an unrelated invalid-clock failure.
    if (state.revoked) return {reason: 'PERMIT_REVOKED'};
    state.revoked = true;
    return {reason: 'INVALID_CLOCK'};
  }
  if (state.revoked) return {reason: 'PERMIT_REVOKED'};
  const d = state.declaration;
  let reason = null;
  if (!safeTime(now) || state.lastTime !== null && now < state.lastTime) reason = 'INVALID_CLOCK';
  else if (now < d.issuedAt) reason = 'PERMIT_NOT_YET_VALID';
  else if (now >= d.expiresAt) reason = 'PERMIT_EXPIRED';
  else if (now < d.createdAt) reason = 'OBSERVATION_IN_FUTURE';
  else if (now >= d.createdAt + d.retentionMs) reason = 'OBSERVATION_EXPIRED';
  if (reason) { state.revoked = true; return {reason}; }
  state.lastTime = now;
  return {reason: null, now};
}

export function createFixedXpcHistoryPermit(input) {
  try {
    const req = read(input, ['owner', 'declaration', 'clock']);
    if (!req || typeof req.clock !== 'function') return permitResult('REFUSED', 'INVALID_INPUT');
    const declaration = declarationOf(req.declaration);
    if (!declaration) return permitResult('REFUSED', 'INVALID_DECLARATION');
    const inspected = inspectJournalOwner({owner: req.owner});
    if (inspected.status !== 'SNAPSHOT') return permitResult('REFUSED', 'INVALID_OWNER');
    if (inspected.snapshot.state === 'SEALED') return permitResult('REFUSED', 'OWNER_SEALED');
    if (inspected.snapshot.state === 'COMMIT_UNCERTAIN') return permitResult('REFUSED', 'COMMIT_UNCERTAIN');
    const state = {owner: req.owner, declaration, clock: req.clock, lastTime: null,
      digest: declarationHash(declaration), busy: false, revoked: false, consumed: false};
    const checked = currentTime(state);
    if (checked.reason) return permitResult('REFUSED', checked.reason);
    const permit = Object.freeze({});
    PERMITS.set(permit, state);
    return permitResult('CREATED', null, permit, state.digest);
  } catch { return permitResult('REFUSED', 'INTERNAL_ERROR'); }
}

export function revokeFixedXpcHistoryPermit(input) {
  try {
    const req = read(input, ['permit']);
    if (!req) return permitResult('REFUSED', 'INVALID_INPUT');
    const state = PERMITS.get(req.permit);
    if (!state) return permitResult('REFUSED', 'INVALID_PERMIT');
    state.revoked = true;
    return permitResult('REVOKED', null, null, state.digest);
  } catch { return permitResult('REFUSED', 'INTERNAL_ERROR'); }
}

export function captureFixedXpcHistory(input) {
  let state = null, admitted = false, busyClaimed = false;
  try {
    const req = read(input, ['permit', 'serializedRecord']);
    if (!req) return captureResult(null, 'REFUSED', 'INVALID_INPUT');
    state = PERMITS.get(req.permit);
    if (!state) return captureResult(null, 'REFUSED', 'INVALID_PERMIT');
    if (state.revoked) return captureResult(state, 'REFUSED', 'PERMIT_REVOKED');
    if (state.consumed) return captureResult(state, 'REFUSED', 'PERMIT_CONSUMED');
    if (state.busy) return captureResult(state, 'REFUSED', 'PERMIT_BUSY');
    state.busy = true; busyClaimed = true;
    const initial = currentTime(state);
    if (initial.reason) return captureResult(state, 'REFUSED', initial.reason);
    const text = req.serializedRecord;
    if (typeof text !== 'string' || text.length > 1048576 || !text.isWellFormed() ||
        Buffer.byteLength(text) > 1048576) return captureResult(state, 'REFUSED', 'INVALID_SOURCE');
    const d = state.declaration;
    if (sha(Buffer.from(text, 'utf8')) !== d.sourceSha256) return captureResult(state, 'REFUSED', 'SOURCE_DIGEST_MISMATCH');
    const projection = fixedXpcJournalObservation({serializedRecord: text,
      projectId: d.projectId, candidateId: d.candidateId, receiptId: d.receiptId,
      createdAt: d.createdAt, ttlMs: d.retentionMs});
    if (projection.status !== 'ENTRY') return captureResult(state, 'REFUSED', projection.reason);
    const entry = {...projection.entry, payload: {...projection.entry.payload, historyCapture: {
      schemaVersion: 'nisi-history-capture-provenance/v1', declarationDigest: state.digest,
      consentClass: 'WRITTEN_DECLARATION', consentAuthenticityAttested: false,
      sourceAuthenticityAttested: false, executionAttested: false}}};
    const final = currentTime(state);
    if (final.reason) return captureResult(state, 'REFUSED', final.reason);
    // Linearization boundary: revocation AFTER this point cannot undo this write.
    // Consumed before entering injected host FS; failure never silently retries.
    state.consumed = true; admitted = true;
    const journal = recordJournalObservation({owner: state.owner, entry, now: final.now});
    let status;
    switch (journal.status) {
      case 'RECORDED': status = 'IMPORTED'; break;
      case 'DUPLICATE': status = 'DUPLICATE'; break;
      case 'CONFLICT': case 'STORE_CONFLICT': status = 'CONFLICT'; break;
      case 'REFUSED': status = 'REFUSED'; break;
      case 'STORE_FAILED': status = journal.snapshot.state === 'COMMIT_UNCERTAIN' ? 'UNCERTAIN' : 'STORE_FAILED'; break;
      default: return captureResult(state, 'REFUSED', 'INTERNAL_RESULT', true);
    }
    return captureResult(state, status, journal.reason, true, journal);
  } catch { return captureResult(state, 'REFUSED', 'INTERNAL_ERROR', admitted); }
  finally { if (busyClaimed) state.busy = false; }
}
