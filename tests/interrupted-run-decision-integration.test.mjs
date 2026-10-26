// Integration oracle (README T2/T20): the decision consumes what the REAL
// history modules expose after reopening persisted bytes — run-journal-v1,
// run-journal-store-v1 and host-journal-bundle — through a projection that
// copies data only. Fresh-process persistence itself is proven by the
// bundle-restart-demo and journal-restart-recovery suites; here the reopen is
// in-process and the point is shape fidelity and decision agreement.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRunJournal } from '../history/run-journal-v1.mjs';
import { writeSerializedJournal } from '../history/run-journal-store-v1.mjs';
import { openJournalBundle } from '../history/host-journal-bundle.mjs';
import { decideInterruptedRunV1 as decide } from '../hosts/repository/interrupted-run-decision-v1.mjs';

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const dir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'nisi-irc-')); made.push(d); return d; };
const hex = (c) => c.repeat(32);
const config = { projectId: 'project-a', maxEntries: 100, heartbeatTtlMs: 1000, redactPaths: [] };
const entry = (over) => ({ id: 'run-a:0:build', projectId: 'project-a', runId: 'run-a', attempt: 0, candidateId: 'cand-a', stage: 'build', receiptId: 'receipt-build', createdAt: 100, ttlMs: 100_000, state: 'SUCCEEDED', heartbeatAt: null, retryOf: null, revokes: null, payload: { overall: 'OBSERVED' }, ...over });
const expected = (over = {}) => ({ projectId: 'project-a', runId: 'run-b', attempt: 0, sourcePins: [{ id: 'candidateFingerprint', sha256: hex('ab') }], profile: { id: 'nisi-json-structure-v1', version: 1, rulesetSha256: hex('ef') }, consent: { grantedAtMs: 0, expiresAtMs: 10_000_000, revoked: false, scope: 'execute' }, ...over });
// Data-only projection of an opened bundle into the decision's journal input.
// The bundle already refused PROJECT_MISMATCH at open, so the header project is
// the configured one whenever a header was readable.
function project(bundle, now) {
  const clone = (v) => JSON.parse(JSON.stringify(v));
  return { projectId: bundle.recovery.reason === 'HEADER' ? null : config.projectId, observedAtMs: now,
    recovery: clone(bundle.recovery), sha256: bundle.sha256 ?? null, bytes: bundle.bytes ?? null, entries: clone(bundle.entries) };
}
function persist(appends, d = dir()) {
  const j = createRunJournal(config);
  for (const [e, at] of appends) { const r = j.append(e, at); assert.equal(r.status, 'APPENDED', JSON.stringify(r)); }
  const p = path.join(d, 'journal.jsonl');
  const w = writeSerializedJournal({ path: p, fs, serialized: j.serialize() });
  assert.equal(w.status, 'WRITTEN');
  return p;
}
const NOW = 5000;

test('T2 a crashed RUNNING row reopened from disk is RUN_UNRECONCILED; with a v1 checkpoint it is RESUME_ELIGIBLE; after a terminal sibling it is SAFE_RESTART', () => {
  const p = persist([[entry({}), 100], [entry({ id: 'run-a:0:tests', stage: 'tests', receiptId: 'receipt-tests', state: 'RUNNING', createdAt: 200, heartbeatAt: 200 }), 200]]);
  let bundle = openJournalBundle({ path: p, fs, config, now: NOW });
  assert.equal(bundle.status, 'OPEN'); assert.equal(bundle.interrupted.length, 1);
  const j = project(bundle, NOW);
  let out = decide({ now: NOW, expected: expected(), journal: j, checkpoint: null });
  assert.equal(out.reason, 'RUN_UNRECONCILED', JSON.stringify(out.checks));
  assert.deepEqual(out.interrupted, bundle.interrupted, 'the decision lists exactly what the bundle lists');
  assert.equal(out.journalSha256, bundle.sha256);
  const ck = { schemaVersion: 'nisi-interrupted-run-checkpoint/v1', projectId: 'project-a', sourcePins: expected().sourcePins, profile: expected().profile, consentGrantedAtMs: 0, entryId: 'run-a:0:tests', takenAtMs: 300, completedStages: [{ stage: 'build', entryId: 'run-a:0:build', receiptId: 'receipt-build' }] };
  out = decide({ now: NOW, expected: expected({ runId: 'run-a', attempt: 1 }), journal: j, checkpoint: ck });
  assert.equal(out.status, 'RESUME_ELIGIBLE', JSON.stringify(out.checks)); assert.equal(out.resumeGranted, false);
  // Reconcile: a terminal sibling of the same run/attempt/candidate, then rewrite and reopen.
  const p2 = persist([[entry({}), 100], [entry({ id: 'run-a:0:tests', stage: 'tests', receiptId: 'receipt-tests', state: 'RUNNING', createdAt: 200, heartbeatAt: 200 }), 200], [entry({ id: 'run-a:0:tests-done', stage: 'tests', receiptId: 'receipt-tests-done', state: 'FAILED', createdAt: 300 }), 300]]);
  bundle = openJournalBundle({ path: p2, fs, config, now: NOW });
  out = decide({ now: NOW, expected: expected(), journal: project(bundle, NOW), checkpoint: null });
  assert.equal(out.status, 'SAFE_RESTART', JSON.stringify(out.checks));
  assert.deepEqual(out.interrupted, bundle.interrupted);
});

test('T2 sealed reopen states are JOURNAL_SEALED with the bundle\'s own reason word and nothing echoed', () => {
  const p = persist([[entry({}), 100], [entry({ id: 'run-a:0:tests', stage: 'tests', receiptId: 'receipt-tests', state: 'RUNNING', createdAt: 200, heartbeatAt: 200 }), 200]]);
  const text = fs.readFileSync(p, 'utf8');
  fs.writeFileSync(p, text.slice(0, -30));
  let bundle = openJournalBundle({ path: p, fs, config, now: NOW });
  assert.equal(bundle.status, 'SEALED'); assert.equal(bundle.recovery.reason, 'TRUNCATED');
  let out = decide({ now: NOW, expected: expected(), journal: project(bundle, NOW), checkpoint: null });
  assert.equal(out.reason, 'JOURNAL_SEALED'); assert.equal(out.checks.journal, 'TRUNCATED'); assert.equal(out.interrupted, null); assert.equal(out.journalSha256, null);
  fs.writeFileSync(p, 'nope\n');
  bundle = openJournalBundle({ path: p, fs, config, now: NOW });
  assert.equal(bundle.recovery.reason, 'HEADER');
  out = decide({ now: NOW, expected: expected(), journal: project(bundle, NOW), checkpoint: null });
  assert.equal(out.reason, 'JOURNAL_SEALED'); assert.equal(out.checks.journal, 'HEADER'); assert.equal(out.interrupted, null);
  const fresh = openJournalBundle({ path: path.join(dir(), 'journal.jsonl'), fs, config, now: NOW });
  assert.equal(fresh.recovery.status, 'NEW');
  out = decide({ now: NOW, expected: expected(), journal: project(fresh, NOW), checkpoint: null });
  assert.equal(out.status, 'SAFE_RESTART'); assert.deepEqual(out.interrupted, []);
});

test('T2 a heartbeat still inside heartbeatTtlMs at reopen is HEARTBEAT_LIVE, not an interruption', () => {
  const p = persist([[entry({ id: 'run-a:0:tests', stage: 'tests', receiptId: null, state: 'RUNNING', createdAt: 4500, heartbeatAt: 4500 }), 4500]]);
  const bundle = openJournalBundle({ path: p, fs, config, now: NOW });
  assert.equal(bundle.entries[0].liveness, 'RUNNING'); assert.equal(bundle.interrupted.length, 0);
  const out = decide({ now: NOW, expected: expected(), journal: project(bundle, NOW), checkpoint: null });
  assert.equal(out.reason, 'HEARTBEAT_LIVE'); assert.equal(out.checks.entries, 'RUNNING'); assert.deepEqual(out.interrupted, []);
});

test('T20 mixed persisted state (QUEUED, RUNNING, SUCCEEDED + revoker, expired) round-trips without INVALID_INPUT and agrees with the bundle', () => {
  const p = persist([
    [entry({ id: 'run-q:0:build', runId: 'run-q', candidateId: 'cand-q', receiptId: null, state: 'QUEUED', createdAt: 50 }), 50],
    [entry({ id: 'run-e:0:build', runId: 'run-e', candidateId: 'cand-e', receiptId: 'receipt-e', state: 'SUCCEEDED', createdAt: 60, ttlMs: 100 }), 60],
    [entry({}), 100],
    [entry({ id: 'run-a:0:build-rev', stage: 'build', receiptId: null, state: 'REVOKED', revokes: 'run-a:0:build', createdAt: 150 }), 150],
    [entry({ id: 'run-a:0:tests', stage: 'tests', receiptId: 'receipt-tests', state: 'RUNNING', createdAt: 200, heartbeatAt: 200 }), 200],
  ]);
  const bundle = openJournalBundle({ path: p, fs, config, now: NOW });
  const rows = bundle.entries;
  assert.deepEqual(rows.map((r) => r.liveness), ['QUEUED', 'SUCCEEDED', 'REVOKED', 'REVOKED', 'UNKNOWN']);
  assert.equal(rows[1].expired, true); assert.equal(rows[2].revoked, true);
  const out = decide({ now: NOW, expected: expected(), journal: project(bundle, NOW), checkpoint: null });
  assert.notEqual(out.reason, 'INVALID_INPUT');
  assert.equal(out.reason, 'RUN_UNRECONCILED');
  assert.deepEqual(out.interrupted, bundle.interrupted);
  // The revoked SUCCEEDED row can never confirm a PASS.
  const ck = { schemaVersion: 'nisi-interrupted-run-checkpoint/v1', projectId: 'project-a', sourcePins: expected().sourcePins, profile: expected().profile, consentGrantedAtMs: 0, entryId: 'run-a:0:tests', takenAtMs: 300, completedStages: [{ stage: 'build', entryId: 'run-a:0:build', receiptId: 'receipt-build' }] };
  const resume = decide({ now: NOW, expected: expected({ runId: 'run-a', attempt: 1 }), journal: project(bundle, NOW), checkpoint: ck });
  assert.equal(resume.reason, 'STALE_PASS', JSON.stringify(resume.checks));
});
