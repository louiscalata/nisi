// Synthetic lifecycle/clock, actual private filesystem and fresh Node reopen.
// No live stores, native apps, automatic sweeps, publication or secure-erasure claim.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {openJournalOwner, inspectJournalOwner, recordJournalObservation, maintainJournalOwner} from '../../history/journal-owner-v2.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const acceptanceName = process.argv[2];
assert.match(acceptanceName ?? '', /^\.build\/journal-maintenance-verification-[A-Za-z0-9]+\/verification\.json$/);
const acceptance = JSON.parse(fs.readFileSync(path.join(root, acceptanceName)));
assert.equal(acceptance.status, 'PASS_SCOPED'); assert.equal(acceptance.checkedFiles, 240);
assert.equal(Object.keys(acceptance.after).length, 240);
function pins() {
  for (const [name, expected] of Object.entries(acceptance.after))
    assert.equal(hash(fs.readFileSync(path.join(root, name))), expected, name);
}
pins();
const evidence = fs.mkdtempSync(path.join(root, '.build/journal-maintenance-real-'));
const journalPath = path.join(evidence, 'observations.jsonl');
const config = {projectId: 'nisi-synthetic-lifecycle', maxEntries: 8, heartbeatTtlMs: 10, redactPaths: ['payload.secret']};
const target = {id: 'target', projectId: config.projectId, runId: 'run-a', attempt: 0,
  candidateId: 'candidate-a', stage: 'observation', receiptId: 'receipt-a',
  createdAt: 100, ttlMs: 1000, state: 'SUCCEEDED', heartbeatAt: null, retryOf: null, revokes: null,
  payload: {secret: 'REDACT-BEFORE-PERSIST', retainedCanary: 'EXPIRE-ONLY-AT-TTL', authorizing: false}};
const revocation = {...target, id: 'revoke', stage: 'revoke', receiptId: 'receipt-revoke', createdAt: 110,
  ttlMs: 10, state: 'REVOKED', revokes: 'target',
  payload: {secret: 'REDACT-REVOCATION', note: 'SYNTHETIC_REVOKE', authorizing: false}};
const report = {schemaVersion: 1, status: 'INCOMPLETE', evidence, acceptance: acceptanceName,
  inputKind: 'SYNTHETIC_OBSERVATIONS_WITH_SYNTHETIC_CLOCK', authorizing: false,
  nativeExecutionPerformed: false, consentAuthenticityAttested: false, steps: []};

function confirmedWrite(result, expectedStatus) {
  assert.equal(result.status, expectedStatus);
  assert.equal(result.store.status, 'WRITTEN'); assert.equal(result.store.verified, true);
  assert.equal(result.store.committed, true); assert.equal(result.store.durable, true);
  assert.deepEqual(result.store.fsync, {file: true, directory: true});
  assert.equal(result.authorizing, false);
}
function reopenChild(now, targetExpired) {
  const moduleUrl = pathToFileURL(path.join(root, 'history/journal-owner-v2.mjs')).href;
  const code = `import fs from 'node:fs'; import assert from 'node:assert/strict';
    import {openJournalOwner,recordJournalObservation} from ${JSON.stringify(moduleUrl)};
    const x=JSON.parse(process.argv[1]);
    const opened=openJournalOwner({path:x.path,fs,config:x.config,now:x.now});
    assert.equal(opened.status,'OPENED'); assert.equal(opened.snapshot.recovery.status,'COMPLETE');
    assert.deepEqual(opened.snapshot.recovery.recoveredIds,['target','revoke']);
    const [target,revoke]=opened.snapshot.entries;
    assert.equal(target.revoked,true); assert.equal(target.liveness,'REVOKED');
    assert.equal(target.retained,!x.targetExpired); assert.equal(revoke.retained,false);
    assert.equal(revoke.entry.payload,null); assert.equal(revoke.entry.revokes,'target');
    if(x.targetExpired) assert.equal(target.entry.payload,null);
    else assert.equal(target.entry.payload.retainedCanary,'EXPIRE-ONLY-AT-TTL');
    for(const row of opened.snapshot.entries){assert.equal(row.historical,true);assert.equal(row.authorizing,false);}
    const beforeReplay=fs.readFileSync(x.path);
    const original=recordJournalObservation({owner:opened.owner,entry:x.original,now:x.now});
    assert.equal(fs.readFileSync(x.path).equals(beforeReplay),true);
    const changed=recordJournalObservation({owner:opened.owner,entry:{...x.original,candidateId:'wrong'},now:x.now});
    assert.equal(fs.readFileSync(x.path).equals(beforeReplay),true);
    assert.equal(original.status,'DUPLICATE'); assert.equal(original.store,null);
    assert.equal(changed.status,'CONFLICT'); assert.equal(changed.reason,'ID_CONTENT_MISMATCH');
    assert.equal(changed.store,null);
    console.log(JSON.stringify({status:'REOPENED_EXACTLY',ids:opened.snapshot.recovery.recoveredIds,
      targetExpired:x.targetExpired,targetRevoked:target.revoked,duplicate:original.status,conflict:changed.status,replayBytesUnchanged:true,authorizing:false}));`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', code,
    JSON.stringify({path: journalPath, config, now, targetExpired, original: target})],
    {cwd: root, encoding: 'utf8', timeout: 15000, maxBuffer: 1048576});
  assert.equal(child.error, undefined); assert.equal(child.signal, null); assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}

try {
  const opened = openJournalOwner({path: journalPath, fs, config, now: 100}); assert.equal(opened.status, 'OPENED');
  const first = recordJournalObservation({owner: opened.owner, entry: target, now: 100}); confirmedWrite(first, 'RECORDED');
  const revoked = recordJournalObservation({owner: opened.owner, entry: revocation, now: 110}); confirmedWrite(revoked, 'RECORDED');
  report.steps.push({stage: 'TARGET_AND_REVOCATION', store: revoked.store});
  let bytes = fs.readFileSync(journalPath, 'utf8');
  assert.equal(bytes.includes('REDACT-BEFORE-PERSIST'), false); assert.equal(bytes.includes('REDACT-REVOCATION'), false);
  assert.equal(bytes.includes('EXPIRE-ONLY-AT-TTL'), true);
  const maintenance = maintainJournalOwner({owner: opened.owner, now: 120}); confirmedWrite(maintenance, 'MAINTAINED');
  report.steps.push({stage: 'REVOCATION_PAYLOAD_EXPIRED', store: maintenance.store, reopen: reopenChild(120, false)});
  const repeated = maintainJournalOwner({owner: opened.owner, now: 120});
  assert.equal(repeated.status, 'UNCHANGED'); assert.equal(repeated.store.durable, false); assert.equal(repeated.store.committed, false);
  const expired = maintainJournalOwner({owner: opened.owner, now: 1100}); confirmedWrite(expired, 'MAINTAINED');
  bytes = fs.readFileSync(journalPath, 'utf8'); assert.equal(bytes.includes('EXPIRE-ONLY-AT-TTL'), false);
  assert.equal(bytes.includes('SYNTHETIC_REVOKE'), false);
  report.steps.push({stage: 'BOTH_PAYLOADS_EXPIRED', store: expired.store, reopen: reopenChild(1100, true)});

  // Actual write succeeds, but a trusted test FS seam refuses the final readback.
  const faultPath = path.join(evidence, 'uncertain-observations.jsonl');
  const seeded = openJournalOwner({path: faultPath, fs, config, now: 100});
  confirmedWrite(recordJournalObservation({owner: seeded.owner, entry: target, now: 100}), 'RECORDED');
  let renamed = false;
  const faultyFs = {...fs,
    renameSync(a, b) { fs.renameSync(a, b); if (b === faultPath) renamed = true; },
    readFileSync(file, ...args) { if (renamed && file === faultPath) throw Object.assign(Error('synthetic readback fault'), {code: 'EIO'});
      return fs.readFileSync(file, ...args); }
  };
  const faulty = openJournalOwner({path: faultPath, fs: faultyFs, config, now: 100});
  const uncertain = maintainJournalOwner({owner: faulty.owner, now: 1100});
  assert.equal(uncertain.status, 'STORE_FAILED'); assert.equal(uncertain.reason, 'READBACK_MISMATCH');
  assert.equal(uncertain.store.committed, true); assert.equal(uncertain.snapshot.state, 'COMMIT_UNCERTAIN');
  assert.deepEqual(uncertain.snapshot.entries, []);
  assert.equal(maintainJournalOwner({owner: faulty.owner, now: 1101}).reason, 'COMMIT_UNCERTAIN');
  assert.equal(recordJournalObservation({owner: faulty.owner, entry: revocation, now: 1101}).reason, 'COMMIT_UNCERTAIN');
  const fresh = openJournalOwner({path: faultPath, fs, config, now: 1100});
  assert.equal(fresh.status, 'OPENED'); assert.equal(fresh.snapshot.recovery.status, 'COMPLETE');
  assert.equal(fresh.snapshot.entries[0].entry.payload, null);
  assert.equal(inspectJournalOwner({owner: faulty.owner}).snapshot.state, 'COMMIT_UNCERTAIN');
  report.uncertainty = {status: uncertain.status, reason: uncertain.reason, store: uncertain.store,
    oldOwnerState: uncertain.snapshot.state, freshOwnerState: fresh.snapshot.state, payloadRemoved: true};
  report.file = {bytes: Buffer.byteLength(bytes), sha256: hash(bytes)};
  pins(); report.sourcePinsUnchanged = true; report.status = 'PASS_REAL_FILESYSTEM_LIFECYCLE';
} catch (error) {
  report.status = 'FAIL'; report.failure = String(error.message); process.exitCode = 1;
} finally {
  report.completedAt = new Date().toISOString();
  fs.writeFileSync(path.join(evidence, 'verification.json'), JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify({status: report.status, evidence, steps: report.steps,
    uncertainty: report.uncertainty ?? null, failure: report.failure ?? null}));
}
