import assert from 'node:assert/strict';
import { createRunJournal } from '../history/run-journal-v1.mjs';

export const PATH = '/j/owner.jsonl';
export const CONFIG = Object.freeze({ projectId: 'project-a', maxEntries: 8, heartbeatTtlMs: 10, redactPaths: ['payload.secret'] });

export function entry(id = 'entry-a', overrides = {}) {
  return {
    id, projectId: 'project-a', runId: 'run-a', attempt: 0, candidateId: 'candidate-a', stage: 'observe',
    receiptId: 'receipt-a', createdAt: 100, ttlMs: 1000, state: 'SUCCEEDED', heartbeatAt: null,
    retryOf: null, revokes: null,
    payload: { secret: '/synthetic/private', observation: { schemaVersion: 'nisi-fixed-xpc-journal-observation/v1', status: 'OBSERVED', authorizing: false } },
    ...overrides
  };
}

export function serialized(config = CONFIG, rows = [entry()], now = 100) {
  const journal = createRunJournal(config);
  for (const row of rows) assert.equal(journal.append(row, now).status, 'APPENDED');
  return journal.serialize();
}

export function assertDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

export function assertSnapshotShape(snapshot, state = 'OPEN') {
  assert.deepEqual(Object.keys(snapshot).sort(), ['authorizing', 'bytes', 'entries', 'interrupted', 'meaning', 'recovery', 'schemaVersion', 'sha256', 'state'].sort());
  assert.equal(snapshot.schemaVersion, 'nisi-journal-owner/v2');
  assert.equal(snapshot.state, state);
  assert.equal(snapshot.meaning, 'HISTORY_OBSERVATIONS_ONLY');
  assert.equal(snapshot.authorizing, false);
  assertDeepFrozen(snapshot);
}

export const simpleRefusal = reason => ({ schemaVersion: 'nisi-journal-owner/v2', status: 'REFUSED', reason, authorizing: false });

export function damageFooter(text) {
  const lines = text.trimEnd().split('\n');
  const footer = JSON.parse(lines.at(-1));
  footer.count += 1;
  lines[lines.length - 1] = JSON.stringify(footer);
  return lines.join('\n') + '\n';
}

export function truncateAfterEntries(text) {
  return text.trimEnd().split('\n').slice(0, -1).join('\n') + '\n';
}
