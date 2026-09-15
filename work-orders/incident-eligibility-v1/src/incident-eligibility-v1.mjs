// Pure incident-eligibility decision (NX-05 "source-bound incident eligibility"):
// over (a) one fresh queryRepositoryIncidentV1 result, (b) one native-incident-
// source plan envelope, (c) the caller's projectId, (d) the host's revocation
// decision and (e) the calling host's own capture result. Zero imports, no clock,
// never throws, never admits/persists/learns/authorizes. Digests are compared
// and echoed, never recomputed: hash consistency is the fresh query's claim.

const SCHEMA = 'nisi-incident-eligibility/v1';
const NOT_EVALUATED = 'NOT_EVALUATED';
const OK = 'OK';
const CELLS = ['journal', 'capture', 'observation', 'project', 'row', 'source', 'identity'];
const INPUT_KEYS = ['projectId', 'query', 'plan', 'revoked', 'capture'];
const CAPTURE_KEYS = ['status', 'reason'];
const CAPTURE_STATUS = new Set(['STORED', 'DUPLICATE', 'CONFLICT', 'UNCERTAIN', 'STORE_FAILED', 'REFUSED']);
const QUERY_KEYS = ['schemaVersion', 'status', 'reason', 'entryId', 'journalSha256', 'observation', 'sourceTrust', 'learningEligible', 'authorizing'];
const OBSERVATION_KEYS = ['schemaVersion', 'row', 'previewSha256', 'declarationDigest', 'consentClass', 'consentAuthenticityAttested', 'sourceAuthenticityAttested', 'executionAttested', 'nativeIncidentCaptured', 'learningEligible', 'authorizing'];
const OBSERVATION_FLAGS = ['consentAuthenticityAttested', 'sourceAuthenticityAttested', 'executionAttested', 'nativeIncidentCaptured', 'learningEligible', 'authorizing'];
const ROW_FLAGS = ['persistable', 'executionVerified', 'learningEligible', 'independentOccurrence', 'authorizing', 'certificationGranted'];
const ROW_KEYS = ['schemaVersion', 'rowId', 'occurrenceGroupId', 'familyId', 'binding', 'stageIndex', 'classification', 'reason', 'rawStatus', 'stageStatus', 'disposition', 'source', 'subject', 'failureCodes', 'sourceTrust', ...ROW_FLAGS, 'fingerprint'];
const BINDING_KEYS = ['runId', 'taskFingerprint', 'baselineFingerprint', 'attempt', 'stage', 'checkIndex', 'candidateFingerprint', 'subjectKey'];
const SOURCE_KEYS = ['reportSha256', 'bundleFingerprint', 'planFingerprint', 'groupFingerprint', 'expectationFingerprint', 'profileFingerprint', 'verifierSourceSha256', 'verifierBuildSha256', 'executableSha256', 'rulesetSha256', 'preparationFingerprint', 'materializedFingerprint', 'receiptSha256', 'evidenceSha256'];
const SUBJECT_KEYS = ['kind', 'pathSha256', 'contentSha256'];
const PLAN_KEYS = ['schemaVersion', 'status', 'reason', 'selection', 'sourcePlanDigest', 'rawContentIncluded', 'persistable', 'freshness', 'requiresSeparateAdmission', 'nativeRerun', 'executionVerified', 'learningEligible', 'authorizing'];
const SELECTION_KEYS = ['rowId', 'rowFingerprint', 'previewSha256', 'binding', 'source', 'profile', 'artifactByteLength', 'priorTranscriptSha256', 'inputSha256'];
const PROFILE_KEYS = ['id', 'kind', 'requiredSections', 'rulesFingerprint', 'allowedAdvisoryDimensions', 'modelParticipationRequired', 'maximumAdvisoryDimensions'];
const QUERY_STATUS = new Set(['AVAILABLE_OBSERVATION', 'REVOKED', 'EXPIRED', 'NOT_RETAINED', 'MISSING', 'REFUSED']);
const QUERY_REFUSALS = new Set(['INVALID_INPUT', 'JOURNAL_UNAVAILABLE', 'JOURNAL_NOT_OPEN', 'INVALID_OBSERVATION']);
const PLAN_REFUSALS = new Set(['INVALID_INPUT', 'INVALID_PREVIEW', 'PREVIEW_MISMATCH', 'ROW_MISSING', 'ROW_NOT_FAILURE', 'UNSUPPORTED_STAGE', 'SOURCE_MISMATCH', 'INVALID_EVIDENCE', 'ARTIFACT_LIMIT', 'HOST_NOT_SETTLED']);
const STATIC_CODES = new Set(['DET-001-NONEMPTY', 'DET-002-UTF8', 'DET-003-JSON-STRUCTURE', 'DET-003-REQUIRED-SECTIONS']);
const NODE_CODE = /^NODE_ASSERTION_[a-f0-9]{16}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const TASK = /^task:[0-9a-f]{64}$/;
const ENTRY = /^ric1\.[0-9a-f]{64}$/;
const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const ARTIFACT_CAP = 1048576;
const MAX_LIST = 65536;

class Invalid extends Error {}
const invalid = () => { throw new Invalid('INVALID_INPUT'); };
const nat = (v) => Number.isSafeInteger(v) && v >= 0 && !Object.is(v, -0);
const isHex = (v) => typeof v === 'string' && HEX64.test(v);
const hexOrNull = (v) => v === null || isHex(v);
const isCode = (v) => typeof v === 'string' && CODE.test(v);

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
function bindingOf(value) {
  const b = record(value, BINDING_KEYS);
  if (typeof b.runId !== 'string' || !ID.test(b.runId) || ![b.taskFingerprint, b.baselineFingerprint, b.candidateFingerprint, b.subjectKey].every(isHex)) invalid();
  if (!nat(b.attempt) || !nat(b.checkIndex) || (b.stage !== 'staticChecks' && b.stage !== 'tests')) invalid();
  return b;
}
function sourceOf(value) {
  const s = record(value, SOURCE_KEYS);
  for (const k of SOURCE_KEYS) {
    if (k === 'planFingerprint' || k === 'groupFingerprint') { if (!hexOrNull(s[k])) invalid(); }
    else if (!isHex(s[k])) invalid();
  }
  return s;
}
// Structural (hash-free) mirror of repository-incident-capture-v1 validateRow.
// Digests are NOT recomputed here; that is the query's job (capture L87-89).
function rowOf(value) {
  const r = record(value, ROW_KEYS);
  if (r.schemaVersion !== 'nisi-repository-incident-row/v1') invalid();
  if (![r.rowId, r.occurrenceGroupId, r.familyId, r.fingerprint].every(isHex)) invalid();
  r.binding = bindingOf(r.binding);
  if (!nat(r.stageIndex)) invalid();
  if (![r.classification, r.reason, r.rawStatus, r.stageStatus, r.disposition].every(isCode)) invalid();
  r.source = sourceOf(r.source);
  const subject = record(r.subject, SUBJECT_KEYS);
  if ((subject.kind !== 'FILE' && subject.kind !== 'MATERIALIZED_TREE') || !hexOrNull(subject.pathSha256) || !hexOrNull(subject.contentSha256)) invalid();
  const b = r.binding, s = r.source;
  if (b.stage === 'staticChecks') {
    if (!isHex(s.planFingerprint) || !isHex(s.groupFingerprint) || subject.kind !== 'FILE' || !isHex(subject.pathSha256) || !isHex(subject.contentSha256) || b.subjectKey !== subject.pathSha256) invalid();
  } else if (b.checkIndex !== 0 || s.planFingerprint !== null || s.groupFingerprint !== null || subject.kind !== 'MATERIALIZED_TREE' || subject.pathSha256 !== null || subject.contentSha256 !== null) invalid();
  r.subject = subject;
  const codes = list(r.failureCodes, 0, MAX_LIST);
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i];
    if (typeof c !== 'string') invalid();
    if (b.stage === 'staticChecks' ? !STATIC_CODES.has(c) : !NODE_CODE.test(c)) invalid();
    if (i > 0 && !(codes[i - 1] < c)) invalid(); // sorted, deduped
  }
  r.failureCodes = codes;
  if (r.sourceTrust !== 'TRUSTED_HOST_STATEMENTS_NOT_ATTESTED') invalid();
  for (const k of ROW_FLAGS) if (r[k] !== false) invalid();
  return r;
}
function observationOf(value) {
  const o = record(value, OBSERVATION_KEYS);
  if (o.schemaVersion !== 'nisi-repository-incident-observation/v1' || o.consentClass !== 'WRITTEN_DECLARATION') invalid();
  if (!isHex(o.previewSha256) || !isHex(o.declarationDigest)) invalid();
  for (const k of OBSERVATION_FLAGS) if (o[k] !== false) invalid();
  o.row = rowOf(o.row);
  return o;
}
function queryOf(value) {
  const q = record(value, QUERY_KEYS);
  if (q.schemaVersion !== 'nisi-repository-incident-query/v1' || !QUERY_STATUS.has(q.status)) invalid();
  if (q.sourceTrust !== 'PERSISTED_UNAUTHENTICATED_OBSERVATION' || q.learningEligible !== false || q.authorizing !== false) invalid();
  if (q.entryId !== null && !(typeof q.entryId === 'string' && ENTRY.test(q.entryId))) invalid();
  if (!hexOrNull(q.journalSha256)) invalid();
  // Nullability matrix of repository-incident-capture-v1 queryRepositoryIncidentV1.
  if (q.status === 'REFUSED') {
    if (!QUERY_REFUSALS.has(q.reason) || q.observation !== null) invalid();
    if (q.reason === 'INVALID_INPUT') { if (q.entryId !== null || q.journalSha256 !== null) invalid(); }
    else if (q.reason === 'INVALID_OBSERVATION') { if (q.journalSha256 !== null && q.entryId === null) invalid(); }
    else if (q.entryId === null || q.journalSha256 !== null) invalid();
    return q;
  }
  if (q.reason !== null || q.entryId === null) invalid();
  if (q.status !== 'MISSING' && q.journalSha256 === null) invalid();
  if (q.status === 'AVAILABLE_OBSERVATION') q.observation = observationOf(q.observation);
  else if (q.observation !== null) invalid();
  return q;
}
function planOf(value) {
  const p = record(value, PLAN_KEYS);
  if (p.schemaVersion !== 'nisi-native-incident-source-plan/v1' || (p.status !== 'SOURCE_BOUND' && p.status !== 'REFUSED')) invalid();
  if (p.rawContentIncluded !== false || p.persistable !== false || p.freshness !== 'ORIGINAL_SNAPSHOT_ONLY' || p.requiresSeparateAdmission !== true || p.nativeRerun !== 'NOT_RUN' || p.executionVerified !== false || p.learningEligible !== false || p.authorizing !== false) invalid();
  if (p.status === 'REFUSED') {
    if (!PLAN_REFUSALS.has(p.reason) || p.selection !== null || p.sourcePlanDigest !== null) invalid();
    return p;
  }
  if (p.reason !== null || !isHex(p.sourcePlanDigest)) invalid();
  const sel = record(p.selection, SELECTION_KEYS);
  if (![sel.rowId, sel.rowFingerprint, sel.previewSha256, sel.priorTranscriptSha256, sel.inputSha256].every(isHex)) invalid();
  sel.binding = bindingOf(sel.binding);
  if (sel.binding.stage !== 'staticChecks') invalid();
  sel.source = sourceOf(sel.source);
  if (!isHex(sel.source.planFingerprint) || !isHex(sel.source.groupFingerprint)) invalid();
  const prof = record(sel.profile, PROFILE_KEYS);
  if (typeof prof.id !== 'string' || !ID.test(prof.id) || typeof prof.kind !== 'string' || !isHex(prof.rulesFingerprint)) invalid();
  prof.requiredSections = list(prof.requiredSections, 0, 64);
  for (const s of prof.requiredSections) if (typeof s !== 'string') invalid();
  prof.allowedAdvisoryDimensions = list(prof.allowedAdvisoryDimensions, 0, 0);
  if (prof.modelParticipationRequired !== false || prof.maximumAdvisoryDimensions !== 0) invalid();
  if (prof.rulesFingerprint !== sel.source.rulesetSha256) invalid();
  sel.profile = prof;
  if (!nat(sel.artifactByteLength) || sel.artifactByteLength > ARTIFACT_CAP) invalid();
  p.selection = sel;
  return p;
}

function captureOf(value) {
  if (value === null) return null;
  const c = record(value, CAPTURE_KEYS);
  if (!CAPTURE_STATUS.has(c.status)) invalid();
  if (c.reason !== null && !isCode(c.reason)) invalid();
  return c;
}

function result(status, reason, checks, entryId, journalSha256, sourcePlanDigest) {
  const cells = {};
  for (const c of CELLS) cells[c] = checks[c];
  return Object.freeze({ schemaVersion: SCHEMA, status, reason, checks: Object.freeze(cells), entryId, journalSha256, sourcePlanDigest, authorizing: false, admitted: false, learningEnabled: false });
}

export function decideIncidentEligibilityV1(input) {
  const checks = {};
  for (const c of CELLS) checks[c] = NOT_EVALUATED;
  let projectId, query, plan, revoked, capture;
  try {
    const top = record(input, INPUT_KEYS);
    if (typeof top.projectId !== 'string' || !TASK.test(top.projectId)) invalid();
    projectId = top.projectId;
    query = queryOf(top.query);
    plan = planOf(top.plan);
    if (typeof top.revoked !== 'boolean') invalid();
    revoked = top.revoked;
    capture = captureOf(top.capture);
  } catch {
    return result('INELIGIBLE', 'INVALID_INPUT', checks, null, null, null);
  }
  const pins = [query.entryId, query.journalSha256, plan.sourcePlanDigest];
  const out = (status, reason) => result(status, reason, checks, ...pins);
  // 1 journal: a ledger that could not be read to an OPEN state is uncertain, not refused
  if (query.status === 'REFUSED' && (query.reason === 'JOURNAL_UNAVAILABLE' || query.reason === 'JOURNAL_NOT_OPEN')) { checks.journal = query.reason; return out('UNCERTAIN', query.reason); }
  checks.journal = OK;
  // 2 capture: the caller's own uncertain write is unresolved state; every other capture word is the fresh read's business
  if (capture !== null && capture.status === 'UNCERTAIN') { checks.capture = capture.reason ?? 'UNCERTAIN'; return out('UNCERTAIN', 'COMMIT_UNCERTAIN'); }
  checks.capture = OK;
  // 3 observation lifecycle as the fresh query reports it, plus the host's own revocation decision
  if (query.status === 'REFUSED') { checks.observation = query.reason; return out('INELIGIBLE', 'INVALID_OBSERVATION'); }
  if (query.status === 'MISSING') { checks.observation = 'MISSING'; return out(query.journalSha256 === null ? 'UNCERTAIN' : 'INELIGIBLE', 'MISSING'); }
  if (query.status !== 'AVAILABLE_OBSERVATION') { checks.observation = query.status; return out('INELIGIBLE', query.status); }
  if (revoked) { checks.observation = 'REVOKED'; return out('INELIGIBLE', 'REVOKED'); }
  checks.observation = OK;
  const obs = query.observation, row = obs.row;
  // 4 project isolation: the row's task fingerprint IS the project identity (capture-v1 entryId derivation)
  if ('task:' + row.binding.taskFingerprint !== projectId) { checks.project = 'PROJECT_MISMATCH'; return out('INELIGIBLE', 'PROJECT_MISMATCH'); }
  checks.project = OK;
  // 5 report-to-incident mapping (mirrors native-incident-source-v1): static-check recorded FAIL only
  if (row.binding.stage !== 'staticChecks') { checks.row = 'UNSUPPORTED_STAGE'; return out('INELIGIBLE', 'UNSUPPORTED_STAGE'); }
  if (row.classification !== 'FAILURE_CANDIDATE' || row.reason !== 'RECORDED_FAILURE' || row.rawStatus !== 'FAIL' || row.stageStatus !== 'FAIL' || row.disposition !== 'RESULT_RECORDED') { checks.row = 'ROW_NOT_FAILURE'; return out('INELIGIBLE', 'ROW_NOT_FAILURE'); }
  checks.row = OK;
  // 6 source binding: the plan must be SOURCE_BOUND; its own refusal word is echoed
  if (plan.status !== 'SOURCE_BOUND') { checks.source = plan.reason; return out('INELIGIBLE', plan.reason === 'INVALID_INPUT' ? 'INVALID_EVIDENCE' : plan.reason); }
  checks.source = OK;
  // 7 identity join: same row, same bound content, same settled snapshot
  const sel = plan.selection;
  if (sel.rowId !== row.rowId) { checks.identity = 'ROW_MISMATCH'; return out('INELIGIBLE', 'ROW_MISMATCH'); }
  if (sel.rowFingerprint !== row.fingerprint) { checks.identity = 'ID_CONTENT_MISMATCH'; return out('INELIGIBLE', 'CONFLICT'); }
  if (BINDING_KEYS.some((k) => sel.binding[k] !== row.binding[k]) || SOURCE_KEYS.some((k) => sel.source[k] !== row.source[k])) { checks.identity = 'SOURCE_MISMATCH'; return out('INELIGIBLE', 'CONFLICT'); }
  if (sel.previewSha256 !== obs.previewSha256) { checks.identity = 'PREVIEW_MISMATCH'; return out('INELIGIBLE', 'PREVIEW_MISMATCH'); }
  checks.identity = OK;
  return out('ELIGIBLE', null);
}
