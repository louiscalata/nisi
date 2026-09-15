// Private observation import, not native execution, approval or a correctness claim.
import {inspectJournalOwner, recordJournalObservation} from './journal-owner-v2.mjs';
import {fixedXpcJournalObservation} from './fixed-xpc-journal-observation-v1.mjs';

const KEYS = ['owner', 'serializedRecord', 'projectId', 'candidateId', 'receiptId', 'createdAt', 'ttlMs', 'now'];
function readRequest(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
  if (![Object.prototype, null].includes(Object.getPrototypeOf(input))) return null;
  if (Reflect.ownKeys(input).length !== KEYS.length) return null;
  const values = {};
  for (const key of KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    values[key] = descriptor.value;
  }
  if (!Number.isSafeInteger(values.now) || values.now < 0 || Object.is(values.now, -0)) return null;
  return values;
}

// Both dependencies publish deeply frozen values. The consumer adds only frozen
// metadata and never echoes the full pre-journal projection, which could undo a
// host's stricter journal redaction policy.
function result(status, reason, recordAttempted = false, projection = null, journal = null) {
  return Object.freeze({schemaVersion: 'nisi-fixed-xpc-history-import/v1', status, reason,
    recordAttempted, projection, journal, meaning: 'HISTORY_OBSERVATIONS_ONLY', authorizing: false});
}

export function importFixedXpcObservation(input) {
  const request = readRequest(input);
  if (!request) return result('REFUSED', 'INVALID_INPUT');
  const inspected = inspectJournalOwner({owner: request.owner});
  if (inspected.status !== 'SNAPSHOT') return result('REFUSED', inspected.reason);
  if (inspected.snapshot.state === 'SEALED') return result('REFUSED', 'OWNER_SEALED');
  if (inspected.snapshot.state === 'COMMIT_UNCERTAIN') return result('REFUSED', 'COMMIT_UNCERTAIN');

  const projected = fixedXpcJournalObservation({serializedRecord: request.serializedRecord,
    projectId: request.projectId, candidateId: request.candidateId, receiptId: request.receiptId,
    createdAt: request.createdAt, ttlMs: request.ttlMs});
  if (projected.status !== 'ENTRY') return result('REFUSED', projected.reason, false, projected);
  const summary = Object.freeze({status: 'ENTRY', entryId: projected.entry.id,
    state: projected.entry.state, authorizing: false});
  // inspect is not a lock or disk check. This actual result is authoritative for
  // the attempted operation, including a reentrant OWNER_BUSY refusal.
  const journal = recordJournalObservation({owner: request.owner, entry: {...projected.entry, state: 'SUCCEEDED'}, now: request.now});
  let status;
  switch (journal.status) {
    case 'RECORDED': status = 'IMPORTED'; break;
    case 'DUPLICATE': status = 'DUPLICATE'; break;
    case 'CONFLICT':
    case 'STORE_CONFLICT': status = 'CONFLICT'; break;
    case 'REFUSED': status = 'REFUSED'; break;
    case 'STORE_FAILED':
      status = journal.snapshot.state === 'COMMIT_UNCERTAIN' ? 'UNCERTAIN' : 'STORE_FAILED';
      break;
    default: return result('REFUSED', 'INTERNAL_RESULT', true, summary, journal);
  }
  return result(status, journal.reason, true, summary, journal);
}
