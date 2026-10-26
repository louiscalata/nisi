// PRIVATE trusted host integration, not authenticated consent or native evidence.
// The real host exposes preview/capture only. Publication is an internal seam;
// caller-supplied settlements through that seam cannot attest execution.
import {cloneFreeze, stableStringify, sha256Text} from '../workflow/contracts.mjs';
import {exact} from '../integrity/record-utils.mjs';
import {readFinalEngineReportV2} from '../receipts/host-run-bundle-v2.mjs';
import {inspectJournalOwner, recordJournalObservation} from './journal-owner-v2.mjs';

const fail = code => { throw Object.assign(new Error(code), {code}); };
const hex = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
const time = value => Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
const hash = (domain, value) => sha256Text(domain + '\0' + stableStringify(value));
const data = (value, key) => {
  if (value === null || typeof value !== 'object') fail('INVALID_SETTLEMENT');
  const d = Object.getOwnPropertyDescriptor(value, key);
  if (!d || !d.enumerable || !Object.hasOwn(d, 'value')) fail('INVALID_SETTLEMENT');
  return d.value;
};
const CODE_DOMAIN = 'nisi/repository-history-code/v1';
const PREVIEW_DOMAIN = 'nisi/repository-history-preview/v1';
const DECLARATION_DOMAIN = 'nisi/repository-history-declaration/v1';
const DECLARATION_KEYS = ['schemaVersion','declarationId','projectId','sourceDigest',
  'issuedAt','expiresAt','createdAt','retentionMs','consentClass','destination',
  'rawContentPersisted','networkEgress','learningInfluence'];

function codeHash(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 ||
      !value.isWellFormed() || value.includes('\0')) fail('INVALID_SETTLEMENT');
  return sha256Text(CODE_DOMAIN + '\0' + value);
}
function errorHash(value) { return value === null ? null : codeHash(data(value, 'code')); }
function errorPair(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length !== 2 || Reflect.ownKeys(value).length !== 3) fail('INVALID_SETTLEMENT');
  return [errorHash(data(value, '0')), errorHash(data(value, '1'))];
}
function previewResult(reason, preview = null) {
  return Object.freeze({schemaVersion: 'nisi-repository-history-preview/v1',
    status: reason === null ? 'PREVIEW' : 'REFUSED', reason, preview,
    sha256: preview === null ? null : hash(PREVIEW_DOMAIN, preview), authorizing: false});
}
function project(result, taskFingerprint, baselineFingerprint) {
  let report;
  try { report = readFinalEngineReportV2(data(result, 'report')); }
  catch (error) {
    return previewResult(error?.code === 'HOST_V2_STAGES_INVALID' ? 'INVALID_SETTLEMENT' : 'INVALID_REPORT');
  }
  if (report.taskFingerprint !== taskFingerprint) return previewResult('TASK_IDENTITY_MISMATCH');
  try {
    if (data(result, 'schemaVersion') !== 'nisi-reviewed-repository-host-v1' ||
        ['applied','sandboxed','authorizing','certificationGranted'].some(k => data(result, k) !== false))
      fail('INVALID_SETTLEMENT');
    const hostState = data(result, 'state');
    if (!['SETTLED','QUARANTINED'].includes(hostState)) fail('INVALID_SETTLEMENT');
    const states = data(result, 'ownerStates');
    exact(states, ['staticChecks','tests'], 'INVALID_SETTLEMENT');
    const ownerStates = {staticChecks: states.staticChecks, tests: states.tests};
    if (Object.values(ownerStates).some(s => !['IDLE','BUSY','QUARANTINED','UNKNOWN'].includes(s)))
      fail('INVALID_SETTLEMENT');
    const stageCounts = {PASS:0, FAIL:0, NOT_RUN:0, UNAVAILABLE:0, REPAIRED:0, NO_CHANGE:0};
    for (const stage of report.stages) {
      if (!Object.hasOwn(stageCounts, stage.status)) fail('INVALID_SETTLEMENT');
      stageCounts[stage.status]++;
    }
    const summary = data(result, 'bundleSummary');
    let bundleFingerprint = null;
    if (summary !== null) {
      if (data(summary, 'status') !== 'CONSISTENT' || !hex(data(summary, 'fingerprint')))
        fail('INVALID_SETTLEMENT');
      bundleFingerprint = data(summary, 'fingerprint');
    }
    const preview = cloneFreeze({schemaVersion:'nisi-repository-history-observation/v1',
      taskFingerprint, baselineFingerprint, runId: report.runId, attempt: report.repairAttempts,
      candidateFingerprint: report.candidateFingerprint, candidatePresent: report.candidateFingerprint !== null,
      outcome: report.outcome, workflowOutcome: report.workflowOutcome, hostState, ownerStates,
      stageCounts, stageTotal: report.stages.length,
      diagnostics: {reportCodeSha256: codeHash(report.code), reportStoreCodeSha256: codeHash(report.reportStoreCode),
        bundleCodeSha256: errorHash(data(result, 'bundleError')),
        settlementCodeSha256: errorPair(data(result, 'settlementErrors')),
        historyCodeSha256: errorPair(data(result, 'historyErrors')),
        ownerStateCodeSha256: errorPair(data(result, 'ownerStateErrors'))},
      bundleFingerprint, sourceAuthenticityAttested:false, executionAttested:false,
      learningEligible:false, authorizing:false});
    if (Buffer.byteLength(stableStringify(preview), 'utf8') > 16384) fail('INVALID_SETTLEMENT');
    return previewResult(null, preview);
  } catch { return previewResult('INVALID_SETTLEMENT'); }
}
function declarationOf(value) {
  exact(value, DECLARATION_KEYS, 'INVALID_INPUT');
  const d = Object.fromEntries(DECLARATION_KEYS.map(k => [k, value[k]]));
  if (d.schemaVersion !== 'nisi-repository-history-declaration/v1' ||
      !id(d.declarationId) || !id(d.projectId) || !hex(d.sourceDigest) ||
      ![d.issuedAt,d.expiresAt,d.createdAt,d.retentionMs].every(time) ||
      d.expiresAt <= d.issuedAt || d.expiresAt - d.issuedAt > 3600000 ||
      d.retentionMs < 1 || d.retentionMs > 7776000000 || !time(d.createdAt + d.retentionMs) ||
      d.consentClass !== 'WRITTEN_DECLARATION' || d.destination !== 'LOCAL_OBSERVATION_JOURNAL_ONLY' ||
      d.rawContentPersisted !== false || d.networkEgress !== false || d.learningInfluence !== false)
    fail('INVALID_INPUT');
  return Object.freeze(d);
}
function readClock(clock, declaration, previous = null) {
  let now;
  try { now = clock(); } catch { return {reason:'INVALID_CLOCK'}; }
  if (!time(now) || previous !== null && now < previous) return {reason:'INVALID_CLOCK'};
  if (now < declaration.issuedAt) return {reason:'NOT_YET_VALID'};
  if (now >= declaration.expiresAt) return {reason:'DECLARATION_EXPIRED'};
  if (now < declaration.createdAt) return {reason:'OBSERVATION_IN_FUTURE'};
  if (now >= declaration.createdAt + declaration.retentionMs) return {reason:'OBSERVATION_EXPIRED'};
  return {reason:null, now};
}

export function createRepositoryHistoryAccessV1(input) {
  exact(input, ['taskFingerprint','baselineFingerprint'], 'REPOSITORY_HISTORY_CONFIG');
  const {taskFingerprint, baselineFingerprint} = input;
  if (!hex(taskFingerprint) || !hex(baselineFingerprint)) fail('REPOSITORY_HISTORY_CONFIG');
  let published = false, rejected = false, collected = null, cached = null, busy = false, consumed = false;
  function publish(result) {
    if (published || rejected) fail('REPOSITORY_HISTORY_ALREADY_PUBLISHED');
    collected = result; published = true;
  }
  function reject() { if (!published) rejected = true; }
  function preview() {
    if (!published) return previewResult(rejected ? 'SETTLEMENT_REJECTED' : 'NO_SETTLED_RESULT');
    return cached ??= project(collected, taskFingerprint, baselineFingerprint);
  }
  function capture(input) {
    let sourceDigest = null, declarationDigest = null, recordAttempted = false;
    const output = (status, reason, journal = null) => Object.freeze({
      schemaVersion:'nisi-repository-history-capture/v1', status, reason, recordAttempted,
      consumed, sourceDigest, declarationDigest, journal, authorizing:false});
    if (!published) return output('REFUSED', rejected ? 'SETTLEMENT_REJECTED' : 'NO_SETTLED_RESULT');
    if (consumed) return output('REFUSED', 'ALREADY_CAPTURED');
    if (busy) return output('REFUSED', 'BUSY');
    let req, d;
    try {
      exact(input, ['owner','declaration','clock'], 'INVALID_INPUT');
      req = {owner:input.owner, clock:input.clock};
      if (typeof req.clock !== 'function') fail('INVALID_INPUT');
      d = declarationOf(input.declaration);
    } catch { return output('REFUSED', 'INVALID_INPUT'); }
    const p = preview();
    if (p.status !== 'PREVIEW') return output('REFUSED', p.reason);
    sourceDigest = p.sha256;
    if (d.sourceDigest !== sourceDigest) return output('REFUSED', 'SOURCE_DIGEST_MISMATCH');
    declarationDigest = hash(DECLARATION_DOMAIN, d);
    const inspected = inspectJournalOwner({owner:req.owner});
    if (inspected.status !== 'SNAPSHOT') return output('REFUSED', 'INVALID_OWNER');
    if (inspected.snapshot.state === 'SEALED') return output('REFUSED', 'OWNER_SEALED');
    if (inspected.snapshot.state === 'COMMIT_UNCERTAIN') return output('REFUSED', 'COMMIT_UNCERTAIN');
    busy = true;
    try {
      const initial = readClock(req.clock, d);
      if (initial.reason) return output('REFUSED', initial.reason);
      const body = p.preview;
      const entry = {id:'rh1.' + sha256Text('nisi/repository-history-id/v1\0' + sourceDigest),
        projectId:d.projectId, runId:body.runId, attempt:body.attempt,
        candidateId:body.candidatePresent ? 'cand:' + body.candidateFingerprint : 'none:' + body.runId,
        stage:'REPOSITORY_SETTLEMENT', receiptId:null, createdAt:d.createdAt, ttlMs:d.retentionMs,
        state:body.outcome === 'CANCELLED' ? 'CANCELLED' : body.outcome === 'COMPLETED' && body.hostState === 'SETTLED' ? 'SUCCEEDED' : 'FAILED',
        heartbeatAt:null, retryOf:null, revokes:null,
        payload:{preview:body, sourceDigest, declarationDigest}};
      const final = readClock(req.clock, d, initial.now);
      if (final.reason) return output('REFUSED', final.reason);
      // One record attempt, including refusal/failure. No callback can refund it.
      consumed = true; recordAttempted = true;
      const journal = recordJournalObservation({owner:req.owner, entry, now:final.now});
      let status;
      switch (journal.status) {
        case 'RECORDED': status = 'STORED'; break;
        case 'DUPLICATE': status = 'DUPLICATE'; break;
        case 'CONFLICT': case 'STORE_CONFLICT': status = 'CONFLICT'; break;
        case 'REFUSED': status = 'REFUSED'; break;
        case 'STORE_FAILED':
          if (!['OPEN','SEALED','COMMIT_UNCERTAIN'].includes(journal.snapshot?.state))
            return output('UNCERTAIN', 'INTERNAL_ERROR');
          status = journal.snapshot.state === 'COMMIT_UNCERTAIN' ? 'UNCERTAIN' : 'STORE_FAILED'; break;
        default: return output('UNCERTAIN', 'INTERNAL_ERROR');
      }
      return output(status, journal.reason, journal);
    } catch {
      // Entry into the record dependency is irreversible from this host's view.
      // Unexpected output cannot establish whether storage occurred; do not retry.
      return output(recordAttempted ? 'UNCERTAIN' : 'REFUSED', 'INTERNAL_ERROR');
    }
    finally { busy = false; }
  }
  return Object.freeze({publish, reject, preview, capture});
}
