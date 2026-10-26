// PRIVATE experiment evidence, not the TTL-pruned operational history journal.
// Hashes detect inconsistent bytes; they do not authenticate a same-user writer.
import { cloneFreeze, stableStringify, sha256Text } from '../workflow/contracts.mjs';
import { record, natural } from '../evaluation/intake-v1.mjs';

export const TRIAL_EVENT_LIMITS = Object.freeze({ maxEvents: 65538, maxEventBytes: 32 * 1024 * 1024, maxBytes: 256 * 1024 * 1024 });
export const failTrialStore = code => { throw Object.assign(Error(code), { code }); };
const fail = failTrialStore;
const digest = x => { if (typeof x !== 'string' || !/^[a-f0-9]{64}$/u.test(x) || x.length !== 64) fail('TRIAL_STORE_DIGEST'); };
function noRawCandidate(value) {
  if (value && typeof value === 'object') {
    if (Object.hasOwn(value, 'candidateText')) fail('TRIAL_STORE_RAW_CANDIDATE');
    for (const child of Object.values(value)) noRawCandidate(child);
  }
}
export function readTrialRetentionEventV1(input) {
  const event = cloneFreeze(input);
  noRawCandidate(event);
  natural(event.sequence);
  const fields = {
    SCHEDULE: ['sequence', 'type', 'runnerId', 'plan', 'profile', 'intents'],
    START_INTENT: ['sequence', 'type', 'requestId', 'phase'],
    PHASE_RESULT: ['sequence', 'type', 'requestId', 'phase', 'result', 'observation'],
    FINAL: ['sequence', 'type', 'stopReason', 'states', 'drain']
  };
  if (!Object.hasOwn(fields, event.type)) fail('TRIAL_STORE_EVENT_TYPE');
  record(event, fields[event.type]);
  if (event.type === 'START_INTENT' || event.type === 'PHASE_RESULT') {
    digest(event.requestId);
    if (!['EXECUTOR', 'ORACLE'].includes(event.phase)) fail('TRIAL_STORE_PHASE');
  }
  return event;
}
export function encodeTrialEventV1(event, ordinal, previousSha256) {
  const owned = readTrialRetentionEventV1(event);
  natural(ordinal);
  if (ordinal >= TRIAL_EVENT_LIMITS.maxEvents) fail('TRIAL_STORE_EVENT_LIMIT');
  if (ordinal === 0 ? previousSha256 !== null : typeof previousSha256 !== 'string') fail('TRIAL_STORE_CHAIN');
  if (previousSha256 !== null) digest(previousSha256);
  const body = { schemaVersion: 'nisi-trial-event-chain-v1', ordinal, previousSha256, event: owned };
  const envelope = { ...body, sha256: sha256Text(stableStringify(body)) };
  const bytes = Buffer.from(stableStringify(envelope) + '\n');
  if (bytes.length > TRIAL_EVENT_LIMITS.maxEventBytes) fail('TRIAL_STORE_EVENT_BYTES');
  return { event: owned, sha256: envelope.sha256, bytes };
}
export function decodeTrialEventV1(bytes, ordinal, previousSha256) {
  if (!Buffer.isBuffer(bytes) || bytes.length > TRIAL_EVENT_LIMITS.maxEventBytes) fail('TRIAL_STORE_EVENT_BYTES');
  const text = bytes.toString('utf8');
  if (!Buffer.from(text).equals(bytes) || !text.endsWith('\n')) fail('TRIAL_STORE_EVENT_ENCODING');
  let parsed;
  try { parsed = JSON.parse(text); } catch { fail('TRIAL_STORE_EVENT_JSON'); }
  const envelope = record(parsed, ['schemaVersion', 'ordinal', 'previousSha256', 'event', 'sha256']);
  if (envelope.schemaVersion !== 'nisi-trial-event-chain-v1' || envelope.ordinal !== ordinal ||
      envelope.previousSha256 !== previousSha256) fail('TRIAL_STORE_CHAIN');
  const expected = encodeTrialEventV1(envelope.event, ordinal, previousSha256);
  if (!expected.bytes.equals(bytes) || expected.sha256 !== envelope.sha256) fail('TRIAL_STORE_CHAIN');
  return expected;
}
