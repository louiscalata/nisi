import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {stableStringify} from '../workflow/contracts.mjs';
import {queryRepositoryIncidentV1} from '../history/repository-incident-capture-v1.mjs';
import {openJournalOwner, recordJournalObservation} from '../history/journal-owner-v2.mjs';
import {createIncidentHostFixture} from './helpers/incident-host-fixture.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const configFor = taskFingerprint => ({projectId: `task:${taskFingerprint}`, maxEntries: 32, heartbeatTtlMs: 30000, redactPaths: []});
const entryFrom = capture => capture.journal.snapshot.entries.find(row => row.entry.stage === 'REPOSITORY_INCIDENT_CANDIDATE_V1')?.entry;

async function captured(t, {retentionMs = 1209600000} = {}) {
  const fixture = await createIncidentHostFixture(t);
  const report = await fixture.host.run(fixture.options), settled = await fixture.host.settled();
  assert.equal(settled.state, 'SETTLED');
  const preview = fixture.host.incidentPreview();
  assert.equal(preview.status, 'PREVIEW');
  const row = preview.rows.find(value => value.classification === 'FAILURE_CANDIDATE');
  assert.ok(row, 'fixture must issue at least one failure candidate');
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'nisi-incident-query-'));
  t.after(() => fsp.rm(directory, {recursive: true, force: true}));
  const journalPath = path.join(directory, 'history-journal.jsonl');
  const now = Date.now();
  const taskFingerprint = row.binding.taskFingerprint;
  const config = configFor(taskFingerprint);
  const ownerResult = openJournalOwner({path: journalPath, fs, config, now});
  assert.equal(ownerResult.status, 'OPENED');
  const declaration = {schemaVersion: 'nisi-repository-incident-declaration/v1', declarationId: 'incident-test-a',
    projectId: `task:${taskFingerprint}`, rowId: row.rowId, rowFingerprint: row.fingerprint,
    previewSha256: preview.sha256, issuedAt: now, expiresAt: now + 60000, createdAt: now,
    retentionMs, consentClass: 'WRITTEN_DECLARATION', destination: 'LOCAL_INCIDENT_OBSERVATION_ONLY',
    rawContentPersisted: false, networkEgress: false, learningInfluence: false};
  const permit = fixture.host.createIncidentPermit({owner: ownerResult.owner, declaration, clock: () => now});
  assert.equal(permit.status, 'CREATED');
  const capture = fixture.host.captureIncident({permit: permit.permit});
  assert.equal(capture.status, 'STORED');
  const entry = entryFrom(capture);
  assert.ok(entry);
  return {fixture, preview, row, directory, journalPath, config, owner: ownerResult.owner, now, capture, entry};
}
const query = value => queryRepositoryIncidentV1(value);

test('fresh query returns the stored incident observation and does not write', {timeout: 15000}, async t => {
  const x = await captured(t), before = fs.readFileSync(x.journalPath);
  const result = query({path: x.journalPath, fs, config: x.config, entryId: x.entry.id, now: x.now + 1});
  assert.equal(result.status, 'AVAILABLE_OBSERVATION'); assert.equal(result.reason, null);
  assert.equal(result.entryId, x.entry.id); assert.equal(result.learningEligible, false); assert.equal(result.authorizing, false);
  assert.equal(result.observation.row.rowId, x.row.rowId); assert.equal(result.observation.consentAuthenticityAttested, false);
  assert.deepEqual(fs.readFileSync(x.journalPath), before);
});

test('query reopens current disk on every call and observes external revocation', {timeout: 15000}, async t => {
  const x = await captured(t, {retentionMs: 3}), first = query({path: x.journalPath, fs, config: x.config, entryId: x.entry.id, now: x.now + 1});
  assert.equal(first.status, 'AVAILABLE_OBSERVATION');
  const opened = openJournalOwner({path: x.journalPath, fs, config: x.config, now: x.now + 2}); assert.equal(opened.status, 'OPENED');
  const tombstone = {...x.entry, id: 'revoke.' + 'a'.repeat(20), state: 'REVOKED', revokes: x.entry.id, retryOf: null, createdAt: x.now + 2, ttlMs: 1000000};
  const revoked = recordJournalObservation({owner: opened.owner, entry: tombstone, now: x.now + 2}); assert.equal(revoked.status, 'RECORDED');
  const maintained = (await import('../history/journal-owner-v2.mjs')).maintainJournalOwner({owner: opened.owner, now: x.now + 3});
  assert.equal(maintained.status, 'MAINTAINED');
  const second = query({path: x.journalPath, fs, config: x.config, entryId: x.entry.id, now: x.now + 3});
  assert.equal(second.status, 'REVOKED'); assert.equal(second.observation, null); assert.equal(second.reason, null);
});

test('expiry boundary and retention pruning are reported without a write', {timeout: 15000}, async t => {
  const x = await captured(t), before = fs.readFileSync(x.journalPath);
  const expired = query({path: x.journalPath, fs, config: x.config, entryId: x.entry.id, now: x.entry.createdAt + x.entry.ttlMs});
  assert.equal(expired.status, 'EXPIRED'); assert.equal(expired.observation, null);
  const after = fs.readFileSync(x.journalPath); assert.deepEqual(after, before);
});

test('corrupt, mismatched-project, malformed-id and missing entries refuse safely', {timeout: 15000}, async t => {
  const x = await captured(t);
  assert.equal(query({path: x.journalPath, fs, config: {...x.config, projectId: 'task:' + 'f'.repeat(64)}, entryId: x.entry.id, now: x.now}).status, 'REFUSED');
  assert.equal(query({path: x.journalPath, fs, config: x.config, entryId: 'not-an-incident-id', now: x.now}).status, 'REFUSED');
  assert.equal(query({path: x.journalPath, fs, config: x.config, entryId: 'ric1.' + 'a'.repeat(64), now: x.now}).status, 'MISSING');
  await fsp.appendFile(x.journalPath, '{bad-json}\n');
  assert.equal(query({path: x.journalPath, fs, config: x.config, entryId: x.entry.id, now: x.now}).status, 'REFUSED');
});

test('tampering the persisted hashed payload is refused and never projected', {timeout: 15000}, async t => {
  const x = await captured(t), text = await fsp.readFile(x.journalPath, 'utf8');
  await fsp.writeFile(x.journalPath, text.replace('"learningEligible":false', '"learningEligible":true'), {flag: 'w'});
  const result = query({path: x.journalPath, fs, config: x.config, entryId: x.entry.id, now: x.now + 1});
  assert.equal(result.status, 'REFUSED'); assert.equal(result.observation, null); assert.equal(result.learningEligible, false);
});

test('a forged exact-schema row with recomputed row and journal hashes is still refused', {timeout: 15000}, async t => {
  const x = await captured(t);
  const lines = (await fsp.readFile(x.journalPath, 'utf8')).trimEnd().split('\n').map(value => JSON.parse(value));
  const record = lines[1].record, forgedRow = {...record.entry.payload.row, forgedExtra: 'PRIVATE_FORGED_FIELD'};
  const {fingerprint: ignored, ...rowBody} = forgedRow;
  forgedRow.fingerprint = sha('nisi/repository-incident-row/v1\0' + stableStringify(rowBody));
  record.entry.payload.row = forgedRow;
  record.fingerprint = sha('nisi-run-journal/input/v1\n' + stableStringify(record.entry));
  let previous = sha('nisi-run-journal/header/v1\n' + stableStringify(lines[0]));
  lines[1].previousHash = previous;
  lines[1].hash = sha('nisi-run-journal/record/v1\n' + stableStringify({seq:lines[1].seq, previousHash:previous, record:lines[1].record}));
  previous = lines[1].hash;
  lines[2].lastHash = previous;
  await fsp.writeFile(x.journalPath, lines.map(value => stableStringify(value)).join('\n') + '\n', {flag:'w'});
  const reopened = openJournalOwner({path:x.journalPath, fs, config:x.config, now:x.now + 1});
  assert.equal(reopened.status, 'OPENED'); assert.equal(reopened.snapshot.state, 'OPEN');
  const result = query({path:x.journalPath, fs, config:x.config, entryId:x.entry.id, now:x.now + 1});
  assert.equal(result.status, 'REFUSED'); assert.equal(result.observation, null);
});
