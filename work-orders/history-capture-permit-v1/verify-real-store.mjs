// Synthetic source -> actual private filesystem -> new-process reopen.
// A test-written declaration is not captured/authenticated user consent.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {openJournalOwner} from '../../history/journal-owner-v2.mjs';
import {createFixedXpcHistoryPermit, captureFixedXpcHistory, revokeFixedXpcHistoryPermit} from '../../history/history-capture-permit-v1.mjs';
import {makeRecord} from '../../tests/fixtures/fixed-xpc-journal-observation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const acceptance = JSON.parse(fs.readFileSync(path.join(root, '.build/history-capture-verification-LWb99c/verification.json')));
assert.equal(acceptance.status, 'PASS_SCOPED');
const hash = value => createHash('sha256').update(value).digest('hex');
const pin = () => {
  for (const [name, expected] of Object.entries(acceptance.after))
    assert.equal(hash(fs.readFileSync(path.join(root, name))), expected, name);
};
pin();
const evidence = fs.mkdtempSync(path.join(root, '.build/history-permit-real-store-'));
const target = path.join(evidence, 'observations.jsonl');
const config = {projectId: 'synthetic-history-permit', maxEntries: 8, heartbeatTtlMs: 1000, redactPaths: []};
const now = Date.now();
const synthetic = makeRecord('valid');
synthetic.commands.push('SYNTHETIC-RAW-CONTENT-MUST-NOT-PERSIST');
const serializedRecord = JSON.stringify(synthetic);
const declaration = {schemaVersion: 'nisi-fixed-xpc-history-declaration/v1',
  declarationId: 'test-written-declaration', projectId: config.projectId,
  candidateId: 'synthetic-candidate', receiptId: 'synthetic-receipt',
  consentClass: 'WRITTEN_DECLARATION', sourceSha256: hash(serializedRecord),
  issuedAt: now, expiresAt: now + 60000, createdAt: now, retentionMs: 86400000,
  destination: 'LOCAL_OBSERVATION_JOURNAL_ONLY', rawContentPersisted: false,
  networkEgress: false, learningInfluence: false};
const receipt = {schemaVersion: 1, status: 'INCOMPLETE', evidence,
  inputKind: 'SYNTHETIC_FIXED_XPC_RECORD', authorizing: false,
  consentAuthenticityAttested: false, nativeExecutionPerformed: false};
try {
  const opened = openJournalOwner({path: target, fs, config, now});
  assert.equal(opened.status, 'OPENED');
  const created = createFixedXpcHistoryPermit({owner: opened.owner, declaration, clock: Date.now});
  assert.equal(created.status, 'CREATED');
  const result = captureFixedXpcHistory({permit: created.permit, serializedRecord});
  receipt.capture = result;
  assert.equal(result.status, 'IMPORTED');
  assert.equal(result.journal.store.status, 'WRITTEN');
  assert.equal(result.journal.store.verified, true);
  assert.equal(result.journal.store.committed, true);
  assert.equal(fs.readFileSync(target, 'utf8').includes('SYNTHETIC-RAW-CONTENT-MUST-NOT-PERSIST'), false);
  receipt.revocation = revokeFixedXpcHistoryPermit({permit: created.permit});
  const after = captureFixedXpcHistory({permit: created.permit, serializedRecord});
  assert.equal(after.reason, 'PERMIT_REVOKED');
  assert.equal(after.recordAttempted, false);
  receipt.afterRevocation = after;
  const moduleUrl = pathToFileURL(path.join(root, 'history/journal-owner-v2.mjs')).href;
  const childCode = `import fs from 'node:fs'; import assert from 'node:assert/strict';
    import {openJournalOwner} from ${JSON.stringify(moduleUrl)};
    const input=JSON.parse(process.argv[1]);
    const r=openJournalOwner({path:input.path,fs,config:input.config,now:Date.now()});
    assert.equal(r.status,'OPENED'); assert.equal(r.snapshot.recovery.status,'COMPLETE');
    assert.equal(r.snapshot.entries.length,1);
    const entry=r.snapshot.entries[0].entry;
    assert.equal(entry.payload.recordDigest,input.sourceSha256);
    assert.equal(entry.payload.historyCapture.declarationDigest,input.declarationDigest);
    assert.equal(entry.payload.historyCapture.consentAuthenticityAttested,false);
    assert.equal(entry.payload.historyCapture.sourceAuthenticityAttested,false);
    assert.equal(entry.payload.historyCapture.executionAttested,false);
    console.log(JSON.stringify({status:'REOPENED_EXACTLY',id:entry.id,
      sourceSha256:entry.payload.recordDigest,declarationDigest:entry.payload.historyCapture.declarationDigest,
      authorizing:false}));`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childCode,
    JSON.stringify({path: target, config, sourceSha256: declaration.sourceSha256, declarationDigest: created.declarationDigest})],
    {cwd: root, encoding: 'utf8', timeout: 15000, maxBuffer: 1048576});
  assert.equal(child.error, undefined); assert.equal(child.signal, null); assert.equal(child.status, 0);
  receipt.reopen = JSON.parse(child.stdout);
  receipt.file = {sha256: hash(fs.readFileSync(target)), bytes: fs.statSync(target).size};
  pin();
  receipt.status = 'PASS_SYNTHETIC_REAL_STORE';
} catch (error) {
  receipt.status = 'FAIL'; receipt.failure = String(error.message); process.exitCode = 1;
} finally {
  receipt.completedAt = new Date().toISOString();
  fs.writeFileSync(path.join(evidence, 'verification.json'), JSON.stringify(receipt, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify({status: receipt.status, evidence, store: receipt.capture?.journal?.store,
    reopen: receipt.reopen ?? null, failure: receipt.failure ?? null}));
}
