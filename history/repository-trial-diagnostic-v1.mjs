// PRIVATE redacted diagnostic data. This is not raw evidence, authentication,
// execution proof, writable recovery or an incident/policy promotion input.
import { record, natural, list } from '../evaluation/intake-v1.mjs';
import { cloneFreeze, stableStringify, sha256Text } from '../workflow/contracts.mjs';
const fail = () => { throw Object.assign(Error('TRIAL_DIAGNOSTIC_INVALID'), { code: 'TRIAL_DIAGNOSTIC_INVALID' }); };
const choices = (x, values) => { if (!values.includes(x)) fail(); };
const nullable = (x, check) => { if (x !== null) check(x); };
const boolean = x => { if (typeof x !== 'boolean') fail(); };
const digest = x => { if (typeof x !== 'string' || x.length !== 64 || !/^[a-f0-9]{64}$/.test(x)) fail(); };
const uuid = x => { if (typeof x !== 'string' || x.length !== 36 || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(x)) fail(); };
export const DIAGNOSTIC_LIMIT = 65536;
export const DIAGNOSTIC_CODES = Object.freeze(['CALLBACK_REJECTED', 'CALLBACK_THROWN', 'INVALID_PROMISE',
  'TRIAL_OPERATION_CANCELLED', 'TRIAL_OPERATION_QUARANTINED', 'TRIAL_OPERATION_NOT_TERMINAL',
  'TRIAL_OPERATION_CALLBACK_FAILED', 'TRIAL_PROJECTION_OWNER_UNCONFIRMED', 'TRIAL_PROJECTION_REPORT_CHANNEL',
  'TRIAL_PROJECTION_CANDIDATE_MISSING', 'TRIAL_PROJECTION_CANDIDATE_BINDING', 'TRIAL_CANDIDATE_UNICODE']);
export const DIAGNOSTIC_CHANNELS = Object.freeze(['hostRun', 'hostCollection', 'operationResult', 'operationSettlement']);
export function readRepositoryTrialDiagnosticV1(raw) {
  const x = record(raw, ['schemaVersion', 'binding', 'kind', 'channels', 'host', 'lane', 'projection',
    'rawEvidenceRetained', 'sourceTrust', 'remoteExecutionStopped', 'authorizing', 'resumable', 'measurementVerified', 'promotionEligible']);
  choices(x.schemaVersion, ['nisi-repository-trial-diagnostic-v1']);
  const b = record(x.binding, ['requestId', 'profileSha256', 'model', 'modelSettingsSha256', 'taskSha256',
    'baselineSha256', 'suiteFingerprint', 'reviewedSourceFingerprint']);
  for (const [key, value] of Object.entries(b)) if (key !== 'model') digest(value);
  if (b.model !== 'nisi-v3-composite:' + b.modelSettingsSha256) fail();
  const channels = record(x.channels, DIAGNOSTIC_CHANNELS);
  for (const value of Object.values(channels)) {
    const c = record(value, ['state', 'code']);
    choices(c.state, ['NOT_CALLED', 'PENDING', 'FULFILLED', 'REJECTED', 'THREW', 'INVALID']);
    if (['NOT_CALLED', 'PENDING', 'FULFILLED'].includes(c.state)) { if (c.code !== null) fail(); }
    else choices(c.code, DIAGNOSTIC_CODES);
  }
  const terminal = Object.values(channels).every(c => !['NOT_CALLED', 'PENDING'].includes(c.state));
  if (x.kind !== (terminal ? 'TERMINAL_CHANNELS' : 'PARTIAL_CHANNELS')) fail();
  const h = record(x.host, ['availability', 'runId', 'reportSha256', 'outcome', 'candidateFingerprint', 'repairAttempts',
    'collectionState', 'reportChannelMatches', 'ownerStates', 'settlementFailures', 'historyFailures', 'stateFailures']);
  choices(h.availability, ['AVAILABLE', 'UNAVAILABLE']); nullable(h.runId, uuid); nullable(h.reportSha256, digest);
  nullable(h.outcome, value => choices(value, ['COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED', 'TIMED_OUT', 'REPAIR_LIMIT', 'NO_PROGRESS']));
  nullable(h.candidateFingerprint, digest); nullable(h.repairAttempts, natural);
  nullable(h.collectionState, value => choices(value, ['SETTLED', 'QUARANTINED'])); nullable(h.reportChannelMatches, boolean);
  const states = record(h.ownerStates, ['staticChecks', 'tests']);
  for (const v of Object.values(states)) nullable(v, value => choices(value, ['IDLE', 'BUSY', 'QUARANTINED', 'UNKNOWN']));
  for (const key of ['settlementFailures', 'historyFailures', 'stateFailures']) for (const v of list(h[key], 2, 2)) nullable(v, boolean);
  if (h.availability === 'UNAVAILABLE' && ['runId', 'reportSha256', 'outcome', 'candidateFingerprint', 'repairAttempts'].some(key => h[key] !== null)) fail();
  if (h.availability === 'AVAILABLE' && ['runId', 'reportSha256', 'outcome', 'repairAttempts'].some(key => h[key] === null)) fail();
  const l = record(x.lane, ['availability', 'runId', 'phase', 'revoked', 'state', 'pendingTransports', 'recoveryRequired',
    'authorReceipts', 'reviewerReceipts', 'unavailableReceipts']);
  choices(l.availability, ['AVAILABLE', 'UNAVAILABLE']); nullable(l.runId, uuid); nullable(l.revoked, boolean);
  nullable(l.phase, value => choices(value, ['NEW', 'AUTHORIZED', 'SEEDED', 'REPAIRING', 'REPAIRED', 'REVIEWING', 'REVIEWED', 'FAILED']));
  nullable(l.state, value => choices(value, ['IDLE', 'BUSY', 'DRAINING', 'STOPPED', 'QUARANTINED']));
  nullable(l.recoveryRequired, boolean);
  for (const key of ['pendingTransports', 'authorReceipts', 'reviewerReceipts', 'unavailableReceipts']) nullable(l[key], natural);
  if (l.availability === 'UNAVAILABLE' && Object.entries(l).some(([key, value]) => key !== 'availability' && value !== null)) fail();
  if (l.availability === 'AVAILABLE' && Object.entries(l).some(([key, value]) => !['availability', 'runId'].includes(key) && value === null)) fail();
  const p = record(x.projection, ['state', 'fingerprint', 'candidateSha256', 'completionClaim', 'receiptStatus', 'inputTokens', 'outputTokens', 'modelCalls']);
  choices(p.state, ['PENDING', 'PUBLISHED', 'UNAVAILABLE']); nullable(p.fingerprint, digest); nullable(p.candidateSha256, digest); nullable(p.completionClaim, boolean);
  nullable(p.receiptStatus, value => choices(value, ['INCOMPLETE', 'SYNTHETIC_CONTRACT_PASS', 'SCOPED_LIVE_REPAIR_REVIEW_PASS']));
  for (const key of ['inputTokens', 'outputTokens', 'modelCalls']) nullable(p[key], natural);
  if (p.state !== 'PUBLISHED' && Object.entries(p).some(([key, value]) => key !== 'state' && value !== null)) fail();
  if (p.state === 'PUBLISHED' && [p.fingerprint, p.candidateSha256, p.completionClaim, p.receiptStatus].includes(null)) fail();
  if (p.state === 'PUBLISHED' && (channels.operationResult.state !== 'FULFILLED' || h.reportChannelMatches !== true)) fail();
  for (const key of ['rawEvidenceRetained', 'authorizing', 'resumable', 'measurementVerified', 'promotionEligible']) if (x[key] !== false) fail();
  choices(x.sourceTrust, ['OBSERVED_TRUSTED_CALLBACKS_NOT_ATTESTED']); choices(x.remoteExecutionStopped, ['UNKNOWN']);
  const owned = cloneFreeze(x); if (Buffer.byteLength(stableStringify(owned)) > DIAGNOSTIC_LIMIT) fail(); return owned;
}
export function encodeRepositoryTrialDiagnosticV1(record) {
  const data = readRepositoryTrialDiagnosticV1(record), sha256 = sha256Text('nisi/repository-trial-diagnostic/v1\0' + stableStringify(data));
  return { data, sha256, bytes: Buffer.from(stableStringify({ schemaVersion: 'nisi-repository-trial-diagnostic-file-v1', data, sha256 }) + '\n') };
}
export function decodeRepositoryTrialDiagnosticV1(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > DIAGNOSTIC_LIMIT || !Buffer.from(bytes.toString('utf8')).equals(bytes)) fail();
  let parsed; try { parsed = JSON.parse(bytes.toString('utf8')); } catch { fail(); }
  const value = record(parsed, ['schemaVersion', 'data', 'sha256']);
  choices(value.schemaVersion, ['nisi-repository-trial-diagnostic-file-v1']);
  const expected = encodeRepositoryTrialDiagnosticV1(value.data);
  if (value.sha256 !== expected.sha256 || !bytes.equals(expected.bytes)) fail(); return expected;
}
