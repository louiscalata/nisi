// PRIVATE observation admission, not native incident admission or learning.
// Issuance is process-local. Persisted hashes prove consistency, not authenticity.
import {cloneFreeze, stableStringify, sha256Text} from '../workflow/contracts.mjs';
import {exact} from '../integrity/record-utils.mjs';
import {isIssuedRepositoryIncidentPreviewV1} from './repository-incident-candidates-v1.mjs';
import {inspectJournalOwner, openJournalOwner, recordJournalObservation} from './journal-owner-v2.mjs';

const H = (part, value) => sha256Text('nisi/repository-incident-' + part + '/v1\0' + stableStringify(value));
const hex = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
const time = value => Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
const taskId = value => typeof value === 'string' && /^task:[0-9a-f]{64}$/.test(value);
const entryId = value => typeof value === 'string' && /^ric1\.[0-9a-f]{64}$/.test(value);
const fail = code => { throw Object.assign(new Error(code), {code}); };
const STAGE = 'REPOSITORY_INCIDENT_CANDIDATE_V1';
const DECLARATION_KEYS = ['schemaVersion','declarationId','projectId','rowId','rowFingerprint',
  'previewSha256','issuedAt','expiresAt','createdAt','retentionMs','consentClass',
  'destination','rawContentPersisted','networkEgress','learningInfluence'];
const ROW_FLAGS = ['persistable','executionVerified','learningEligible','independentOccurrence',
  'authorizing','certificationGranted'];
const ROW_KEYS = ['schemaVersion','rowId','occurrenceGroupId','familyId','binding','stageIndex',
  'classification','reason','rawStatus','stageStatus','disposition','source','subject',
  'failureCodes','sourceTrust',...ROW_FLAGS,'fingerprint'];
const BINDING_KEYS = ['runId','taskFingerprint','baselineFingerprint','attempt','stage','checkIndex',
  'candidateFingerprint','subjectKey'];
const SOURCE_KEYS = ['reportSha256','bundleFingerprint','planFingerprint','groupFingerprint',
  'expectationFingerprint','profileFingerprint','verifierSourceSha256','verifierBuildSha256',
  'executableSha256','rulesetSha256','preparationFingerprint','materializedFingerprint',
  'receiptSha256','evidenceSha256'];
const OBSERVATION_FLAGS = ['consentAuthenticityAttested','sourceAuthenticityAttested',
  'executionAttested','nativeIncidentCaptured','learningEligible','authorizing'];
const OBSERVATION_KEYS = ['schemaVersion','row','previewSha256','declarationDigest','consentClass',
  ...OBSERVATION_FLAGS];
const STATIC_CODES = new Set(['DET-001-NONEMPTY','DET-002-UTF8',
  'DET-003-JSON-STRUCTURE','DET-003-REQUIRED-SECTIONS']);
const JOURNAL_REASONS = new Set(['INVALID_INPUT','INVALID_OWNER','OWNER_SEALED','COMMIT_UNCERTAIN',
  'OWNER_BUSY','ENTRY','REDACTION','TIME','SEALED','PROJECT','RETRY','REVOCATION',
  'ID_CONTENT_MISMATCH','SIZE_LIMIT','PREPARATION_FAILED','STORE_RESPONSE_INVALID',
  'READ_FAILED','INVALID_JOURNAL','EXISTING_INVALID','CONFLICT','WRITE_FAILED',
  'READBACK_MISMATCH','RENAME_FAILED']);

function declarationOf(value) {
  exact(value, DECLARATION_KEYS, 'INVALID_INPUT');
  const d = cloneFreeze(value);
  if (d.schemaVersion !== 'nisi-repository-incident-declaration/v1' || !id(d.declarationId) ||
      !taskId(d.projectId) || ![d.rowId,d.rowFingerprint,d.previewSha256].every(hex) ||
      ![d.issuedAt,d.expiresAt,d.createdAt,d.retentionMs].every(time) ||
      d.expiresAt <= d.issuedAt || d.expiresAt - d.issuedAt > 3600000 ||
      d.retentionMs < 1 || d.retentionMs > 7776000000 || !time(d.createdAt + d.retentionMs) ||
      d.consentClass !== 'WRITTEN_DECLARATION' || d.destination !== 'LOCAL_INCIDENT_OBSERVATION_ONLY' ||
      d.rawContentPersisted !== false || d.networkEgress !== false || d.learningInfluence !== false)
    fail('INVALID_INPUT');
  return d;
}

// Validate every retained field before exposing disk data. A recomputed digest
// cannot make an extra raw path/message or an authority flag acceptable.
function validateRow(row) {
  exact(row, ROW_KEYS, 'INVALID_OBSERVATION');
  exact(row.binding, BINDING_KEYS, 'INVALID_OBSERVATION');
  exact(row.source, SOURCE_KEYS, 'INVALID_OBSERVATION');
  exact(row.subject, ['kind','pathSha256','contentSha256'], 'INVALID_OBSERVATION');
  const b = row.binding, s = row.source, subject = row.subject;
  if (row.schemaVersion !== 'nisi-repository-incident-row/v1' ||
      ![row.rowId,row.occurrenceGroupId,row.familyId,row.fingerprint].every(hex) ||
      !id(b.runId) || ![b.taskFingerprint,b.baselineFingerprint,b.candidateFingerprint,b.subjectKey].every(hex) ||
      !time(b.attempt) || !time(b.checkIndex) || !time(row.stageIndex) ||
      !['staticChecks','tests'].includes(b.stage) ||
      row.classification !== 'FAILURE_CANDIDATE' || row.reason !== 'RECORDED_FAILURE' ||
      row.rawStatus !== 'FAIL' || row.stageStatus !== 'FAIL' || row.disposition !== 'RESULT_RECORDED' ||
      row.sourceTrust !== 'TRUSTED_HOST_STATEMENTS_NOT_ATTESTED' || ROW_FLAGS.some(k => row[k] !== false))
    fail('INVALID_OBSERVATION');
  if (SOURCE_KEYS.filter(k => !['planFingerprint','groupFingerprint'].includes(k)).some(k => !hex(s[k])))
    fail('INVALID_OBSERVATION');
  if (b.stage === 'staticChecks') {
    if (!hex(s.planFingerprint) || !hex(s.groupFingerprint) || subject.kind !== 'FILE' ||
        !hex(subject.pathSha256) || !hex(subject.contentSha256) || b.subjectKey !== subject.pathSha256)
      fail('INVALID_OBSERVATION');
  } else if (b.checkIndex !== 0 || s.planFingerprint !== null || s.groupFingerprint !== null ||
      subject.kind !== 'MATERIALIZED_TREE' || subject.pathSha256 !== null || subject.contentSha256 !== null)
    fail('INVALID_OBSERVATION');
  if (!Array.isArray(row.failureCodes) || row.failureCodes.some(c => b.stage === 'staticChecks'
    ? !STATIC_CODES.has(c) : typeof c !== 'string' || !/^NODE_ASSERTION_[a-f0-9]{16}$/.test(c)) ||
      stableStringify(row.failureCodes) !== stableStringify([...new Set(row.failureCodes)].sort()))
    fail('INVALID_OBSERVATION');
  const {fingerprint, ...body} = row;
  if (row.rowId !== H('row-id', b) || fingerprint !== H('row', body) ||
      row.occurrenceGroupId !== H('occurrence', {taskFingerprint:b.taskFingerprint,
        baselineFingerprint:b.baselineFingerprint,runId:b.runId,familyId:row.familyId}))
    fail('INVALID_OBSERVATION');
}

function selected(preview, d) {
  if (!isIssuedRepositoryIncidentPreviewV1(preview) || preview.status !== 'PREVIEW') fail('INVALID_PREVIEW');
  if (preview.sha256 !== d.previewSha256) fail('PREVIEW_MISMATCH');
  const row = preview.rows.find(r => r.rowId === d.rowId);
  if (!row) fail('ROW_MISSING');
  if (row.fingerprint !== d.rowFingerprint || 'task:' + row.binding.taskFingerprint !== d.projectId)
    fail('ROW_MISMATCH');
  validateRow(row);
  return row;
}

function clockCheck(state) {
  if (state.revoked) return {reason:'PERMIT_REVOKED'};
  let now, invalid = false;
  try { now = state.clock(); } catch { invalid = true; }
  // The clock is a callback and may revoke the handle. Recheck before admission.
  if (state.revoked) return {reason:'PERMIT_REVOKED'};
  const d = state.declaration;
  let reason = null;
  if (invalid || !time(now) || state.lastNow !== null && now < state.lastNow) reason = 'INVALID_CLOCK';
  else if (now < d.issuedAt) reason = 'NOT_YET_VALID';
  else if (now >= d.expiresAt) reason = 'PERMIT_EXPIRED';
  else if (now < d.createdAt) reason = 'OBSERVATION_IN_FUTURE';
  else if (now >= d.createdAt + d.retentionMs) reason = 'OBSERVATION_EXPIRED';
  if (reason) state.revoked = true;
  else state.lastNow = now;
  return {reason,now};
}

const observation = state => ({schemaVersion:'nisi-repository-incident-observation/v1',
  row:state.row,previewSha256:state.preview.sha256,declarationDigest:state.digest,
  consentClass:'WRITTEN_DECLARATION',consentAuthenticityAttested:false,sourceAuthenticityAttested:false,
  executionAttested:false,nativeIncidentCaptured:false,learningEligible:false,authorizing:false});
function makeEntry(state) {
  const d = state.declaration, row = state.row;
  return {id:state.entryId,projectId:d.projectId,runId:row.binding.runId,attempt:row.binding.attempt,
    candidateId:'cand:' + row.binding.candidateFingerprint,stage:STAGE,
    receiptId:'rcpt:' + row.source.receiptSha256,createdAt:d.createdAt,ttlMs:d.retentionMs,
    state:'FAILED',heartbeatAt:null,retryOf:null,revokes:null,payload:observation(state)};
}

function journalStatus(result) {
  const short = ['schemaVersion','status','reason','authorizing'];
  exact(result, result?.status === 'REFUSED' && !Object.hasOwn(result, 'snapshot')
    ? short : [...short,'entryId','append','store','snapshot'], 'INTERNAL_ERROR');
  if (result.schemaVersion !== 'nisi-journal-owner/v2' || result.authorizing !== false ||
      result.reason !== null && !JOURNAL_REASONS.has(result.reason)) fail('INTERNAL_ERROR');
  switch (result.status) {
    case 'RECORDED': case 'DUPLICATE':
      if (result.reason !== null || result.snapshot?.state !== 'OPEN') fail('INTERNAL_ERROR');
      return result.status === 'RECORDED' ? 'STORED' : 'DUPLICATE';
    case 'CONFLICT': case 'STORE_CONFLICT': return 'CONFLICT';
    case 'REFUSED': return 'REFUSED';
    case 'STORE_FAILED':
      if (!['OPEN','SEALED','COMMIT_UNCERTAIN'].includes(result.snapshot?.state)) fail('INTERNAL_ERROR');
      return result.snapshot.state === 'COMMIT_UNCERTAIN' ? 'UNCERTAIN' : 'STORE_FAILED';
    default: fail('INTERNAL_ERROR');
  }
}

export function createRepositoryIncidentAccessV1(input) {
  exact(input, ['getPreview'], 'INCIDENT_ACCESS_CONFIG');
  const getPreview = input.getPreview;
  if (typeof getPreview !== 'function') fail('INCIDENT_ACCESS_CONFIG');
  const permits = new WeakMap(), consumedRows = new Set();
  let busy = false;
  const consumed = state => Boolean(state && (state.consumed || consumedRows.has(state.row.rowId)));
  const permitResult = (status, reason, state = null, permit = null) => Object.freeze({
    schemaVersion:'nisi-repository-incident-permit/v1',status,reason,permit,
    declarationDigest:state?.digest ?? null,consumed:consumed(state),authorizing:false});
  const captureResult = (status, reason, state, recordAttempted = false, journal = null) => Object.freeze({
    schemaVersion:'nisi-repository-incident-capture/v1',status,reason,entryId:state?.entryId ?? null,
    rowId:state?.row.rowId ?? null,declarationDigest:state?.digest ?? null,
    recordAttempted,consumed:consumed(state),journal,learningEligible:false,authorizing:false});
  const handleState = input => {
    exact(input, ['permit'], 'INVALID_PERMIT');
    const state = permits.get(input.permit);
    if (!state) fail('INVALID_PERMIT');
    return state;
  };
  function createPermit(input) {
    if (busy) return permitResult('REFUSED', 'PERMIT_BUSY');
    busy = true;
    try {
      exact(input, ['owner','declaration','clock'], 'INVALID_INPUT');
      const owner = input.owner, clock = input.clock, d = declarationOf(input.declaration);
      if (typeof clock !== 'function') fail('INVALID_INPUT');
      const preview = getPreview(), row = selected(preview, d);
      if (consumedRows.has(row.rowId)) return permitResult('REFUSED', 'ROW_CONSUMED', {row,digest:H('declaration',d)});
      const inspected = inspectJournalOwner({owner});
      if (inspected.status !== 'SNAPSHOT') return permitResult('REFUSED', 'INVALID_OWNER');
      if (inspected.snapshot.state !== 'OPEN') return permitResult('REFUSED',
        inspected.snapshot.state === 'COMMIT_UNCERTAIN' ? 'COMMIT_UNCERTAIN' : 'OWNER_SEALED');
      const state = {owner,clock,declaration:d,preview,row,digest:H('declaration',d),
        entryId:'ric1.' + H('entry-id',{projectId:d.projectId,rowId:row.rowId}),
        lastNow:null,revoked:false,consumed:false};
      const checked = clockCheck(state);
      if (checked.reason) return permitResult('REFUSED', checked.reason, state);
      const permit = Object.freeze({});
      permits.set(permit,state);
      return permitResult('CREATED', null, state, permit);
    } catch (error) {
      const codes = ['INVALID_INPUT','INVALID_PREVIEW','PREVIEW_MISMATCH','ROW_MISSING','ROW_MISMATCH','INVALID_OBSERVATION'];
      return permitResult('REFUSED', codes.includes(error?.code) ? error.code : 'INTERNAL_ERROR');
    } finally { busy = false; }
  }
  function revoke(input) {
    let state;
    try { state = handleState(input); } catch { return permitResult('REFUSED','INVALID_PERMIT'); }
    if (state.consumed) return permitResult('REFUSED','PERMIT_CONSUMED',state);
    if (consumedRows.has(state.row.rowId)) return permitResult('REFUSED','ROW_CONSUMED',state);
    state.revoked = true;
    return permitResult('REVOKED',null,state);
  }
  function capture(input) {
    let state, attempted = false;
    try { state = handleState(input); } catch { return captureResult('REFUSED','INVALID_PERMIT'); }
    if (state.consumed) return captureResult('REFUSED','PERMIT_CONSUMED',state);
    if (consumedRows.has(state.row.rowId)) return captureResult('REFUSED','ROW_CONSUMED',state);
    if (state.revoked) return captureResult('REFUSED','PERMIT_REVOKED',state);
    if (busy) return captureResult('REFUSED','PERMIT_BUSY',state);
    busy = true;
    try {
      const initial = clockCheck(state);
      if (initial.reason) return captureResult('REFUSED',initial.reason,state);
      const preview = getPreview();
      if (preview !== state.preview || selected(preview,state.declaration) !== state.row)
        return captureResult('REFUSED','PREVIEW_CHANGED',state);
      const entry = makeEntry(state), final = clockCheck(state);
      if (final.reason) return captureResult('REFUSED',final.reason,state);
      // Consume BEFORE the first record callback, not after successful storage.
      state.consumed = true; consumedRows.add(state.row.rowId); attempted = true;
      const journal = recordJournalObservation({owner:state.owner,entry,now:final.now});
      return captureResult(journalStatus(journal),journal.reason,state,true,journal);
    } catch {
      return captureResult(attempted ? 'UNCERTAIN' : 'REFUSED','INTERNAL_ERROR',state,attempted);
    } finally { busy = false; }
  }
  return Object.freeze({createPermit,capture,revoke});
}

function validateEntry(entry, projectId, now) {
  if (entry.stage !== STAGE || entry.projectId !== projectId || !entryId(entry.id) ||
      entry.state !== 'FAILED' || !id(entry.runId) || !time(entry.attempt) ||
      !/^cand:[0-9a-f]{64}$/.test(entry.candidateId) || !/^rcpt:[0-9a-f]{64}$/.test(entry.receiptId) ||
      !time(entry.createdAt) || entry.createdAt > now || !time(entry.ttlMs) || entry.ttlMs < 1 ||
      entry.ttlMs > 7776000000 || !time(entry.createdAt + entry.ttlMs) ||
      entry.heartbeatAt !== null || entry.retryOf !== null || entry.revokes !== null) fail('INVALID_OBSERVATION');
}
function validateObservation(entry) {
  const p = entry.payload;
  exact(p, OBSERVATION_KEYS, 'INVALID_OBSERVATION');
  if (p.schemaVersion !== 'nisi-repository-incident-observation/v1' ||
      p.consentClass !== 'WRITTEN_DECLARATION' || !hex(p.previewSha256) || !hex(p.declarationDigest) ||
      OBSERVATION_FLAGS.some(k => p[k] !== false)) fail('INVALID_OBSERVATION');
  validateRow(p.row);
  const r = p.row;
  if (entry.projectId !== 'task:' + r.binding.taskFingerprint || entry.runId !== r.binding.runId ||
      entry.attempt !== r.binding.attempt || entry.candidateId !== 'cand:' + r.binding.candidateFingerprint ||
      entry.receiptId !== 'rcpt:' + r.source.receiptSha256 ||
      entry.id !== 'ric1.' + H('entry-id',{projectId:entry.projectId,rowId:r.rowId})) fail('INVALID_OBSERVATION');
  return p;
}

export function queryRepositoryIncidentV1(input) {
  let requestedId = null, journalSha256 = null;
  const result = (status, reason = null, observation = null) => cloneFreeze({
    schemaVersion:'nisi-repository-incident-query/v1',status,reason,entryId:requestedId,
    journalSha256,observation,sourceTrust:'PERSISTED_UNAUTHENTICATED_OBSERVATION',
    learningEligible:false,authorizing:false});
  try {
    exact(input, ['path','fs','config','entryId','now'], 'INVALID_INPUT');
    if (!entryId(input.entryId) || !time(input.now)) return result('REFUSED','INVALID_INPUT');
    const {path,fs,now} = input, config = cloneFreeze(input.config);
    if (!taskId(config.projectId)) return result('REFUSED','INVALID_INPUT');
    requestedId = input.entryId;
    // A cached owner/snapshot is deliberately not an input. Reopen every read.
    const opened = openJournalOwner({path,fs,config,now});
    if (opened.status !== 'OPENED') return result('REFUSED','JOURNAL_UNAVAILABLE');
    if (opened.snapshot.state !== 'OPEN') return result('REFUSED','JOURNAL_NOT_OPEN');
    const snapshot = opened.snapshot;
    journalSha256 = snapshot.sha256;
    const saved = snapshot.entries.find(row => row.entry.id === requestedId);
    if (!saved) return result('MISSING');
    validateEntry(saved.entry,config.projectId,now);
    // Tombstones preserve identity after payload pruning. Never return payload
    // for these statuses, or imply that prior content is currently eligible.
    if (saved.revoked) return result('REVOKED');
    if (saved.expired || now >= saved.entry.createdAt + saved.entry.ttlMs) return result('EXPIRED');
    if (!saved.retained) return result('NOT_RETAINED');
    return result('AVAILABLE_OBSERVATION',null,validateObservation(saved.entry));
  } catch {
    return result('REFUSED','INVALID_OBSERVATION');
  }
}
