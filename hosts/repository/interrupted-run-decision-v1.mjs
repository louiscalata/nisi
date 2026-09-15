// Pure interrupted-run decision (NX-07 / DX-03): refuse stale state, distinguish
// safe restart from validated resume. Reads persisted run-journal views as the
// existing modules expose them after a fresh reopen; never restarts, resumes,
// appends, revokes or authorizes anything. No imports, no clock, never throws.

const SCHEMA = 'nisi-interrupted-run-decision/v1';
const CHECKPOINT_SCHEMA = 'nisi-interrupted-run-checkpoint/v1';
const NOT_EVALUATED = 'NOT_EVALUATED';
const OK = 'OK';
const CELLS = ['journal', 'project', 'entries', 'consent', 'checkpoint', 'identity', 'stages'];
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const ENTRY_KEYS = ['id', 'projectId', 'runId', 'attempt', 'candidateId', 'stage', 'receiptId', 'createdAt', 'ttlMs', 'state', 'heartbeatAt', 'retryOf', 'revokes', 'payload'];
const ROW_KEYS = ['entry', 'historical', 'retained', 'revoked', 'expired', 'liveness', 'authorizing'];
const RECOVERY_KEYS = ['status', 'recoveredIds', 'rejectedLine', 'reason', 'authorizing'];
const JOURNAL_KEYS = ['projectId', 'observedAtMs', 'recovery', 'sha256', 'bytes', 'entries'];
const EXPECTED_KEYS = ['projectId', 'runId', 'attempt', 'sourcePins', 'profile', 'consent'];
const INPUT_KEYS = ['now', 'expected', 'journal', 'checkpoint'];
const PIN_KEYS = ['id', 'sha256'];
const PROFILE_KEYS = ['id', 'version', 'rulesetSha256'];
const CONSENT_KEYS = ['grantedAtMs', 'expiresAtMs', 'revoked', 'scope'];
const CHECKPOINT_KEYS = ['schemaVersion', 'projectId', 'sourcePins', 'profile', 'consentGrantedAtMs', 'entryId', 'takenAtMs', 'completedStages'];
const STAGE_KEYS = ['stage', 'entryId', 'receiptId'];
const STATES = new Set(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REVOKED']);
const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'REVOKED']);
const RECOVERY_STATUS = new Set(['NEW', 'COMPLETE', 'INCOMPLETE', 'INVALID', 'COMMIT_UNCERTAIN']);
const OPEN_STATUS = new Set(['NEW', 'COMPLETE']);
const MAX_ROWS = 65536;

class Invalid extends Error {}
const invalid = () => { throw new Invalid('INVALID_INPUT'); };
const nat = (v) => Number.isSafeInteger(v) && v >= 0 && !Object.is(v, -0);
const safeInt = (v) => Number.isSafeInteger(v) && !Object.is(v, -0);
const isId = (v) => typeof v === 'string' && ID.test(v);
const isHex = (v) => typeof v === 'string' && HEX64.test(v);

// Exact closed record: plain (or null) prototype, string own keys only, exact
// key SET, every key an own enumerable data property. Values are read from the
// descriptor, never through a getter. Returns a fresh plain copy.
function record(value, keys) {
  if (value === null || typeof value !== 'object') invalid();
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) invalid();
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length) invalid();
  const out = {};
  for (const key of keys) {
    if (!own.includes(key)) invalid();
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !Object.hasOwn(d, 'value') || d.enumerable !== true) invalid();
    out[key] = d.value;
  }
  return out;
}
// Exact plain array: Array.prototype, no extra own keys, every index an own
// enumerable data property, length snapshotted once.
function list(value, min, max) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) invalid();
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < min || length > max) invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1 || keys.at(-1) !== 'length') invalid();
  const out = [];
  for (let i = 0; i < length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !Object.hasOwn(d, 'value') || d.enumerable !== true) invalid();
    out.push(d.value);
  }
  return out;
}
function pins(value) {
  const out = list(value, 1, 16).map((p) => { const r = record(p, PIN_KEYS); if (!isId(r.id) || !isHex(r.sha256)) invalid(); return r; });
  if (new Set(out.map((p) => p.id)).size !== out.length) invalid();
  return out;
}
function profile(value) {
  const r = record(value, PROFILE_KEYS);
  if (!isId(r.id) || !Number.isSafeInteger(r.version) || r.version < 1 || r.version > 1000000 || !isHex(r.rulesetSha256)) invalid();
  return r;
}
function consentOf(value, now) {
  if (value === null || value === undefined) return null;
  const r = record(value, CONSENT_KEYS);
  if (!safeInt(r.grantedAtMs) || !safeInt(r.expiresAtMs) || typeof r.revoked !== 'boolean' || typeof r.scope !== 'string') invalid();
  if (r.grantedAtMs > now) invalid();
  return r;
}
function expectedOf(value, now) {
  const r = record(value, EXPECTED_KEYS);
  if (!isId(r.projectId) || !isId(r.runId) || !nat(r.attempt)) invalid();
  r.sourcePins = pins(r.sourcePins);
  r.profile = profile(r.profile);
  r.consent = consentOf(r.consent, now);
  return r;
}
function entryOf(value) {
  const e = record(value, ENTRY_KEYS);
  if (!isId(e.id) || !isId(e.projectId) || !isId(e.runId) || !nat(e.attempt) || !isId(e.candidateId) || !isId(e.stage)) invalid();
  if (e.receiptId !== null && !isId(e.receiptId)) invalid();
  if (!nat(e.createdAt) || !Number.isSafeInteger(e.ttlMs) || e.ttlMs < 1 || !Number.isSafeInteger(e.createdAt + e.ttlMs)) invalid();
  if (!STATES.has(e.state)) invalid();
  if (e.heartbeatAt !== null && (!nat(e.heartbeatAt) || e.heartbeatAt > e.createdAt)) invalid();
  if (e.retryOf !== null && !isId(e.retryOf)) invalid();
  if (e.revokes !== null && !isId(e.revokes)) invalid();
  if ((e.revokes !== null) !== (e.state === 'REVOKED')) invalid();
  return e;
}
function journalOf(value, now) {
  const j = record(value, JOURNAL_KEYS);
  if (j.projectId !== null && !isId(j.projectId)) invalid();
  if (!safeInt(j.observedAtMs) || j.observedAtMs !== now) invalid();
  const rec = record(j.recovery, RECOVERY_KEYS);
  if (!RECOVERY_STATUS.has(rec.status) || rec.authorizing !== false) invalid();
  rec.recoveredIds = list(rec.recoveredIds, 0, MAX_ROWS);
  for (const id of rec.recoveredIds) if (!isId(id)) invalid();
  if (new Set(rec.recoveredIds).size !== rec.recoveredIds.length) invalid();
  if (rec.status === 'NEW' || rec.status === 'COMPLETE') { if (rec.rejectedLine !== null || rec.reason !== null) invalid(); }
  else if (rec.status === 'COMMIT_UNCERTAIN') { if (rec.rejectedLine !== null) invalid(); if (rec.reason !== null && !(typeof rec.reason === 'string' && CODE.test(rec.reason))) invalid(); }
  else { if (!Number.isSafeInteger(rec.rejectedLine) || rec.rejectedLine < 1 || typeof rec.reason !== 'string' || !CODE.test(rec.reason)) invalid(); }
  if (j.sha256 !== null && !isHex(j.sha256)) invalid();
  if (j.bytes !== null && !nat(j.bytes)) invalid();
  if (rec.status === 'NEW' && (j.sha256 !== null || j.bytes !== 0)) invalid();
  if (rec.status === 'COMPLETE' && (!isHex(j.sha256) || !nat(j.bytes) || j.bytes < 1)) invalid();
  if ((rec.status === 'INCOMPLETE' || rec.status === 'INVALID' || rec.status === 'COMMIT_UNCERTAIN') && j.sha256 !== null) invalid();
  if ((j.projectId === null) !== (rec.reason === 'HEADER')) invalid();
  j.recovery = rec;
  const rows = list(j.entries, 0, MAX_ROWS).map((v) => {
    const r = record(v, ROW_KEYS);
    r.entry = entryOf(r.entry);
    if (r.historical !== true || typeof r.retained !== 'boolean' || typeof r.revoked !== 'boolean' || typeof r.expired !== 'boolean' || r.authorizing !== false) invalid();
    if (typeof r.liveness !== 'string') invalid();
    return r;
  });
  if (rec.status === 'NEW' || rec.status === 'COMMIT_UNCERTAIN') { if (rows.length !== 0 || rec.recoveredIds.length !== 0) invalid(); }
  if (rows.length !== rec.recoveredIds.length) invalid();
  const byId = new Map();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], e = r.entry;
    if (e.id !== rec.recoveredIds[i]) invalid();
    if (byId.has(e.id)) invalid();
    byId.set(e.id, r);
    if (e.projectId !== j.projectId) invalid();
    if (e.createdAt > now) invalid();
    if (r.expired !== (now >= e.createdAt + e.ttlMs)) invalid();
    if (r.retained === false && e.payload !== null) invalid();
  }
  const revokedIds = new Set();
  for (const r of rows) if (r.entry.revokes !== null) { if (!byId.has(r.entry.revokes)) invalid(); revokedIds.add(r.entry.revokes); }
  for (const r of rows) {
    const e = r.entry;
    if (r.revoked !== revokedIds.has(e.id)) invalid();
    const expect = r.revoked ? 'REVOKED' : TERMINAL.has(e.state) ? e.state : r.expired ? 'EXPIRED' : e.state === 'RUNNING' ? null : e.state;
    if (expect === null) { if (r.liveness !== 'RUNNING' && r.liveness !== 'UNKNOWN') invalid(); }
    else if (r.liveness !== expect) invalid();
  }
  j.entries = rows;
  return j;
}
// The checkpoint's schemaVersion is read first; anything but v1 is CHECKPOINT_SCHEMA
// without further validation. Returns null (absent), 'SCHEMA' (present, not v1) or the record.
function checkpointOf(value, now) {
  if (value === null) return null;
  if (value === undefined || typeof value !== 'object') invalid();
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) invalid();
  const d = Object.getOwnPropertyDescriptor(value, 'schemaVersion');
  if (!d || !Object.hasOwn(d, 'value') || d.enumerable !== true || typeof d.value !== 'string') invalid();
  if (d.value !== CHECKPOINT_SCHEMA) return 'SCHEMA';
  const c = record(value, CHECKPOINT_KEYS);
  if (!isId(c.projectId) || !safeInt(c.consentGrantedAtMs) || !isId(c.entryId) || !nat(c.takenAtMs) || c.takenAtMs > now) invalid();
  c.sourcePins = pins(c.sourcePins);
  c.profile = profile(c.profile);
  c.completedStages = list(c.completedStages, 0, 64).map((s) => { const r = record(s, STAGE_KEYS); if (!isId(r.stage) || !isId(r.entryId) || !isId(r.receiptId)) invalid(); return r; });
  if (new Set(c.completedStages.map((s) => s.stage)).size !== c.completedStages.length) invalid();
  if (new Set(c.completedStages.map((s) => s.entryId)).size !== c.completedStages.length) invalid();
  return c;
}

const samePins = (a, b) => a.length === b.length && a.every((p, i) => p.id === b[i].id && p.sha256 === b[i].sha256);
const settledBy = (rows, r, from) => rows.slice(from + 1).some((s) => s.entry.runId === r.entry.runId && s.entry.attempt === r.entry.attempt && s.entry.candidateId === r.entry.candidateId && (s.liveness === 'SUCCEEDED' || s.liveness === 'FAILED' || s.liveness === 'CANCELLED'));

function result(status, reason, checks, interrupted, journalSha256) {
  const cells = {};
  for (const c of CELLS) cells[c] = checks[c];
  return Object.freeze({ schemaVersion: SCHEMA, status, reason, checks: Object.freeze(cells),
    interrupted: interrupted === null ? null : Object.freeze(interrupted.map((i) => Object.freeze({ ...i }))),
    journalSha256, authorizing: false, executionGranted: false, resumeGranted: false });
}

export function decideInterruptedRunV1(input) {
  const checks = {};
  for (const c of CELLS) checks[c] = NOT_EVALUATED;
  let now, expected, journal, checkpoint;
  try {
    const top = record(input, INPUT_KEYS);
    if (!nat(top.now)) invalid();
    now = top.now;
    expected = expectedOf(top.expected, now);
    journal = journalOf(top.journal, now);
    checkpoint = checkpointOf(top.checkpoint, now);
  } catch (error) {
    if (error instanceof Invalid) return result('REFUSE_STALE', 'INVALID_INPUT', checks, null, null);
    return result('REFUSE_STALE', 'INVALID_INPUT', checks, null, null);
  }
  const sha = journal.sha256;
  const refuse = (reason, interrupted) => result('REFUSE_STALE', reason, checks, interrupted, sha);
  // 1 journal
  const rec = journal.recovery;
  if (!OPEN_STATUS.has(rec.status)) { checks.journal = rec.status === 'COMMIT_UNCERTAIN' ? 'COMMIT_UNCERTAIN' : rec.reason; return refuse('JOURNAL_SEALED', null); }
  checks.journal = OK;
  // 2 project
  if (journal.projectId !== expected.projectId) { checks.project = 'PROJECT_MISMATCH'; return refuse('PROJECT_MISMATCH', null); }
  checks.project = OK;
  // 3 entries
  const rows = journal.entries;
  const interrupted = [];
  for (const r of rows) if (r.entry.state === 'RUNNING' && r.liveness === 'UNKNOWN' && !r.revoked && !r.expired) interrupted.push({ id: r.entry.id, runId: r.entry.runId, attempt: r.entry.attempt, stage: r.entry.stage, liveness: 'UNKNOWN', heartbeatAt: r.entry.heartbeatAt, createdAt: r.entry.createdAt });
  if (rows.some((r) => r.liveness === 'RUNNING')) { checks.entries = 'RUNNING'; return refuse('HEARTBEAT_LIVE', interrupted); }
  const exempt = checkpoint !== null && checkpoint !== 'SCHEMA' ? checkpoint.entryId : null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!(r.entry.state === 'RUNNING' && r.liveness === 'UNKNOWN' && !r.revoked && !r.expired)) continue;
    if (r.entry.id === exempt) continue;
    if (!settledBy(rows, r, i)) { checks.entries = 'UNKNOWN'; return refuse('RUN_UNRECONCILED', interrupted); }
  }
  checks.entries = OK;
  // 4 consent
  const consent = expected.consent;
  if (consent === null) { checks.consent = 'CONSENT_MISSING'; return refuse('CONSENT_MISSING', interrupted); }
  if (consent.expiresAtMs <= now) { checks.consent = 'CONSENT_EXPIRED'; return refuse('CONSENT_EXPIRED', interrupted); }
  if (consent.revoked === true) { checks.consent = 'CONSENT_REVOKED'; return refuse('CONSENT_REVOKED', interrupted); }
  if (consent.scope !== 'execute') { checks.consent = 'CONSENT_SCOPE'; return refuse('CONSENT_SCOPE', interrupted); }
  checks.consent = OK;
  // 5 checkpoint
  if (checkpoint === null) {
    checks.checkpoint = 'NONE';
    // 6 identity (restart): a safe restart uses a fresh run id
    if (rows.some((r) => r.entry.runId === expected.runId)) { checks.identity = 'RUN_ID_REUSED'; return refuse('RUN_ID_REUSED', interrupted); }
    checks.identity = OK;
    return result('SAFE_RESTART', null, checks, interrupted, sha);
  }
  if (checkpoint === 'SCHEMA') { checks.checkpoint = 'CHECKPOINT_SCHEMA'; return refuse('CHECKPOINT_SCHEMA', interrupted); }
  const ck = checkpoint;
  if (ck.projectId !== expected.projectId) { checks.checkpoint = 'CHECKPOINT_PROJECT'; return refuse('CHECKPOINT_PROJECT', interrupted); }
  if (!samePins(ck.sourcePins, expected.sourcePins)) { checks.checkpoint = 'SOURCE_DIGEST_MISMATCH'; return refuse('SOURCE_DIGEST_MISMATCH', interrupted); }
  if (ck.profile.id !== expected.profile.id || ck.profile.version !== expected.profile.version || ck.profile.rulesetSha256 !== expected.profile.rulesetSha256) { checks.checkpoint = 'CHECKPOINT_PROFILE'; return refuse('CHECKPOINT_PROFILE', interrupted); }
  if (ck.consentGrantedAtMs !== consent.grantedAtMs || ck.takenAtMs < consent.grantedAtMs || ck.takenAtMs >= consent.expiresAtMs) { checks.checkpoint = 'CHECKPOINT_CONSENT'; return refuse('CHECKPOINT_CONSENT', interrupted); }
  const citedIndex = rows.findIndex((r) => r.entry.id === ck.entryId);
  if (citedIndex < 0) { checks.checkpoint = 'NOT_FOUND'; return refuse('CHECKPOINT_TARGET', interrupted); }
  const cited = rows[citedIndex];
  if (!interrupted.some((i) => i.id === cited.entry.id)) { checks.checkpoint = cited.liveness; return refuse('CHECKPOINT_TARGET', interrupted); }
  if (citedIndex !== rows.length - 1) { checks.checkpoint = rows[rows.length - 1].liveness; return refuse('CHECKPOINT_SUPERSEDED', interrupted); }
  if (ck.takenAtMs < cited.entry.createdAt) { checks.checkpoint = 'CHECKPOINT_STALE'; return refuse('CHECKPOINT_STALE', interrupted); }
  checks.checkpoint = OK;
  // 6 identity (resume)
  if (expected.runId !== cited.entry.runId) { checks.identity = 'RUN_ID_MISMATCH'; return refuse('RUN_ID_MISMATCH', interrupted); }
  if (expected.attempt <= cited.entry.attempt || rows.some((r) => r.entry.runId === expected.runId && r.entry.attempt === expected.attempt)) { checks.identity = 'ATTEMPT_REUSED'; return refuse('ATTEMPT_REUSED', interrupted); }
  checks.identity = OK;
  // 7 stages
  if (ck.completedStages.some((s) => s.stage === cited.entry.stage)) { checks.stages = 'STAGE_ALREADY_SUCCEEDED'; return refuse('STAGE_ALREADY_SUCCEEDED', interrupted); }
  const claimed = new Set();
  for (const claim of ck.completedStages) {
    const r = rows.find((x) => x.entry.id === claim.entryId);
    if (!r || r.entry.runId !== cited.entry.runId || r.entry.attempt !== cited.entry.attempt || r.entry.candidateId !== cited.entry.candidateId || r.entry.stage !== claim.stage || r.entry.receiptId !== claim.receiptId) { checks.stages = 'PASS_UNCONFIRMED'; return refuse('PASS_UNCONFIRMED', interrupted); }
    if (r.liveness !== 'SUCCEEDED' || r.revoked || r.expired) { checks.stages = 'STALE_PASS'; return refuse('STALE_PASS', interrupted); }
    if (r.entry.createdAt > ck.takenAtMs) { checks.stages = 'CHECKPOINT_BEFORE_PASS'; return refuse('CHECKPOINT_BEFORE_PASS', interrupted); }
    claimed.add(r.entry.id);
  }
  for (const r of rows) {
    if (r.entry.runId === cited.entry.runId && r.entry.attempt === cited.entry.attempt && r.liveness === 'SUCCEEDED' && !r.revoked && !r.expired && !claimed.has(r.entry.id)) { checks.stages = 'UNCLAIMED_PASS'; return refuse('UNCLAIMED_PASS', interrupted); }
  }
  checks.stages = OK;
  return result('RESUME_ELIGIBLE', null, checks, interrupted, sha);
}
