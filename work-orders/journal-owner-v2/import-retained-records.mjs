// Explicit private demonstration on THREE already-retained engineering records.
// Never launches the native runner; original records remain read-only.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {openJournalOwner} from '../../history/journal-owner-v2.mjs';
import {importFixedXpcObservation} from '../../history/import-fixed-xpc-observation-v1.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const prior = JSON.parse(fs.readFileSync(path.join(root, '.build/xpc-history-projection-h918xQ/retained-record-projections.json')));
assert.equal(prior.length, 3);
const records = prior.map(item => {
  assert.match(item.path, /^\.build\/fixed-private-xpc-[A-Za-z0-9]+\/terminal\.json$/);
  const file = path.join(root, item.path);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let bytes;
  try {
    const stat = fs.fstatSync(fd);
    assert.ok(stat.isFile()); assert.ok(stat.size > 0 && stat.size <= 1048576);
    bytes = fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
  assert.equal(sha(bytes), item.inputSha256); assert.equal(bytes.length, item.inputBytes);
  assert.deepEqual(Buffer.from(bytes.toString('utf8')), bytes);
  assert.equal(item.result.status, 'ENTRY');
  return {path: item.path, bytes, priorEntry: item.result.entry, sha256: item.inputSha256};
});
const evidence = fs.mkdtempSync(path.join(root, '.build/retained-xpc-history-'));
const journalPath = path.join(evidence, 'observations.jsonl');
const now = Date.now();
const config = {projectId: 'nisi-private', maxEntries: 32, heartbeatTtlMs: 1000, redactPaths: []};
const report = {schemaVersion: 1, status: 'INCOMPLETE', evidence, importedAt: new Date(now).toISOString(),
  nativeExecuted: false, authorizing: false, rows: [],
  sourceManifest: Object.fromEntries(['history/import-fixed-xpc-observation-v1.mjs', 'history/journal-owner-v2.mjs',
    'history/run-journal-v1.mjs', 'history/run-journal-store-v1.mjs', 'history/fixed-xpc-journal-observation-v1.mjs',
    'hosts/macos-xpc/protocol.mjs'].map(name => [name, sha(fs.readFileSync(path.join(root, name)))]))};
try {
  const opened = openJournalOwner({path: journalPath, fs, config, now});
  assert.equal(opened.status, 'OPENED'); assert.equal(opened.snapshot.recovery.status, 'NEW');
  for (const record of records) {
    const e = record.priorEntry;
    const imported = importFixedXpcObservation({owner: opened.owner, serializedRecord: record.bytes.toString('utf8'),
      projectId: config.projectId, candidateId: e.candidateId, receiptId: e.receiptId,
      createdAt: e.createdAt, ttlMs: e.ttlMs, now});
    report.rows.push({inputPath: record.path, inputSha256: record.sha256, entryId: e.id,
      status: imported.status, projection: imported.projection, journalStatus: imported.journal?.status ?? null,
      store: imported.journal?.store ?? null});
    assert.equal(imported.status, 'IMPORTED'); assert.equal(imported.projection.entryId, e.id);
    assert.equal(imported.authorizing, false); assert.equal(imported.journal.store.verified, true);
  }
  const fresh = openJournalOwner({path: journalPath, fs, config, now});
  assert.equal(fresh.status, 'OPENED'); assert.equal(fresh.snapshot.recovery.status, 'COMPLETE');
  assert.deepEqual([...fresh.snapshot.recovery.recoveredIds].sort(), records.map(record => record.priorEntry.id).sort());
  assert.equal(fresh.snapshot.entries.length, 3);
  for (const row of fresh.snapshot.entries) {
    assert.equal(row.authorizing, false); assert.equal(row.historical, true);
    if (row.retained) {
      assert.equal(row.entry.payload.sourceManifestVerified, false);
      assert.equal(row.entry.payload.nativeProductAccepted, false);
    }
  }
  report.reopened = {state: fresh.snapshot.state, recovery: fresh.snapshot.recovery, sha256: fresh.snapshot.sha256,
    bytes: fresh.snapshot.bytes, rows: fresh.snapshot.entries.length, authorizing: false};
  for (const record of records) assert.equal(sha(fs.readFileSync(path.join(root, record.path))), record.sha256);
  for (const [name, hash] of Object.entries(report.sourceManifest)) assert.equal(sha(fs.readFileSync(path.join(root, name))), hash);
  report.status = 'PASS_SCOPED';
} catch (error) {
  report.status = 'FAIL'; report.failure = String(error.message); process.exitCode = 1;
} finally {
  report.completedAt = new Date().toISOString();
  fs.writeFileSync(path.join(evidence, 'verification.json'), JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify(report, null, 2));
}
