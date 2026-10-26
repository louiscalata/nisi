// Real-filesystem acceptance proof for incident capture/query. No native,
// provider, model, network, or live service is used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {queryRepositoryIncidentV1} from '../../history/repository-incident-capture-v1.mjs';
import {openJournalOwner} from '../../history/journal-owner-v2.mjs';
import {createIncidentHostFixture} from '../../tests/helpers/incident-host-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pinPath = process.argv[2]; assert.ok(pinPath && path.isAbsolute(pinPath), 'usage: verify-real-disk.mjs /absolute/pin-receipt.json');
const pin = fs.readFileSync(pinPath), pinHash = crypto.createHash('sha256').update(pin).digest('hex');
const pinReceipt = JSON.parse(pin.toString('utf8'));
assert.equal(pinReceipt.status, 'PASS_SCOPED', 'source verifier receipt is not PASS_SCOPED');
assert.equal(Number.isSafeInteger(pinReceipt.checkedFiles), true, 'source verifier count is missing');
assert.ok(pinReceipt.before && typeof pinReceipt.before === 'object' && !Array.isArray(pinReceipt.before));
assert.ok(pinReceipt.after && typeof pinReceipt.after === 'object' && !Array.isArray(pinReceipt.after));
const pinPaths = Object.keys(pinReceipt.before);
assert.equal(pinPaths.length, pinReceipt.checkedFiles, 'source verifier count does not match before map');
assert.deepEqual(pinPaths.sort(), Object.keys(pinReceipt.after).sort(), 'source verifier before/after path sets differ');
const requiredPinPaths = [
  'history/repository-incident-capture-v1.mjs',
  'history/repository-incident-candidates-v1.mjs',
  'hosts/repository/reviewed-workflow-v1.mjs',
  'tests/repository-incident-query.test.mjs',
  'work-orders/repository-incident-capture-v1/verify-real-disk.mjs',
];
for (const required of requiredPinPaths) assert.equal(pinPaths.includes(required), true, `required source pin missing: ${required}`);
const selectedPins = pinPaths.map(relative => {
  const rawSegments = relative.split('/');
  assert.equal(relative.length > 0 && !relative.startsWith('/') && !relative.includes('\0'), true);
  assert.equal(rawSegments.every(segment => segment !== '.' && segment !== '..' && segment.length > 0), true, 'pin contains unsafe raw path segment');
  const absolute = path.resolve(root, relative);
  assert.equal(absolute === root || absolute.startsWith(root + path.sep), true, 'pin escaped repository root');
  assert.equal(path.relative(root, absolute).split(path.sep).includes('..'), false, 'pin used traversal');
  const canonicalRoot = fs.realpathSync(root), canonicalFile = fs.realpathSync(absolute);
  assert.equal(canonicalFile === canonicalRoot || canonicalFile.startsWith(canonicalRoot + path.sep), true, 'pin realpath escaped repository root');
  const expectedBefore = pinReceipt.before[relative], expectedAfter = pinReceipt.after[relative];
  assert.equal(typeof expectedBefore, 'string'); assert.equal(typeof expectedAfter, 'string');
  assert.equal(expectedBefore, expectedAfter, `source changed during source verifier: ${relative}`);
  const actual = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
  assert.equal(actual, expectedBefore, `pin mismatch before proof: ${relative}`);
  return {path: relative, absolute, expected: expectedBefore, before: actual};
});
const cleanups = [], t = {after(fn) { cleanups.push(fn); }};
let completed;
try {
const fixture = await createIncidentHostFixture(t);
const report = await fixture.host.run(fixture.options), settled = await fixture.host.settled();
assert.equal(settled.state, 'SETTLED'); assert.equal(settled.report, report);
const preview = fixture.host.incidentPreview(), row = preview.rows.find(value => value.classification === 'FAILURE_CANDIDATE');
assert.equal(preview.status, 'PREVIEW'); assert.ok(row);
const directory = await fsp.mkdtemp(path.join(root, '.build/repository-incident-capture-v1-'));
const journalPath = path.join(directory, 'history-journal.jsonl'), now = Date.now();
const taskFingerprint = row.binding.taskFingerprint;
const config = {projectId: `task:${taskFingerprint}`, maxEntries: 32, heartbeatTtlMs: 30000, redactPaths: []};
const opened = openJournalOwner({path: journalPath, fs, config, now}); assert.equal(opened.status, 'OPENED');
const declaration = {schemaVersion:'nisi-repository-incident-declaration/v1', declarationId:'incident-disk-proof',
  projectId:config.projectId, rowId:row.rowId, rowFingerprint:row.fingerprint, previewSha256:preview.sha256,
  issuedAt:now, expiresAt:now + 60000, createdAt:now, retentionMs:1209600000,
  consentClass:'WRITTEN_DECLARATION', destination:'LOCAL_INCIDENT_OBSERVATION_ONLY', rawContentPersisted:false,
  networkEgress:false, learningInfluence:false};
const permit = fixture.host.createIncidentPermit({owner:opened.owner, declaration, clock:()=>now}); assert.equal(permit.status,'CREATED');
const capture = fixture.host.captureIncident({permit:permit.permit}); assert.equal(capture.status,'STORED');
const entry = capture.journal.snapshot.entries.find(value=>value.entry.stage==='REPOSITORY_INCIDENT_CANDIDATE_V1').entry;
const result = queryRepositoryIncidentV1({path:journalPath,fs,config,entryId:entry.id,now:now+1});
assert.equal(result.status,'AVAILABLE_OBSERVATION'); assert.equal(result.entryId,entry.id); assert.equal(result.observation.row.rowId,row.rowId);
assert.equal(result.observation.row.fingerprint,row.fingerprint); assert.equal(result.observation.previewSha256,preview.sha256);
const queryURL = pathToFileURL(path.join(root,'history/repository-incident-capture-v1.mjs')).href;
const child = spawnSync(process.execPath,['--input-type=module','-e',`
  import fs from 'node:fs'; import {queryRepositoryIncidentV1} from ${JSON.stringify(queryURL)};
  const r=queryRepositoryIncidentV1({path:${JSON.stringify(journalPath)},fs,config:${JSON.stringify(config)},entryId:${JSON.stringify(entry.id)},now:${now+2}});
  if(r.status!=='AVAILABLE_OBSERVATION'||r.entryId!==${JSON.stringify(entry.id)}||r.observation.row.rowId!==${JSON.stringify(row.rowId)}||r.observation.row.fingerprint!==${JSON.stringify(row.fingerprint)}||r.observation.previewSha256!==${JSON.stringify(preview.sha256)})process.exit(9);
`],{cwd:root,encoding:'utf8',timeout:15000});
assert.equal(child.error, undefined); assert.equal(child.signal, null); assert.equal(child.status,0,child.stdout+child.stderr);
const pinAfter = fs.readFileSync(pinPath); assert.equal(crypto.createHash('sha256').update(pinAfter).digest('hex'),pinHash);
const pinAfterEntries = selectedPins.map(pinEntry => ({...pinEntry, after: crypto.createHash('sha256').update(fs.readFileSync(pinEntry.absolute)).digest('hex')}));
assert.equal(pinAfterEntries.every(pinEntry => pinEntry.after === pinEntry.before && pinEntry.after === pinEntry.expected), true, 'selected source pin changed during proof');
const verification = {schemaVersion:'nisi-repository-incident-disk-verification/v1',journalPath,entryId:entry.id,
  rowId:row.rowId,previewSha256:preview.sha256,captureStatus:capture.status,queryStatus:result.status,
  freshChildStatus:child.status,storeEvidence:{status:capture.journal?.store?.status ?? null,verified:capture.journal?.store?.verified ?? null,durable:capture.journal?.store?.durable ?? null,fsync:capture.journal?.store?.fsync ?? null},sourcePin:{path:pinPath,sha256:pinHash,bytes:pin.length,status:'PASS',count:selectedPins.length,pins:pinAfterEntries.map(({path,expected,before,after})=>({path,expected,before,after}))},providerCalls:false,networkCalls:false,nativeLaunch:false,modelCalls:false};
const verificationPath = path.join(directory,'verification.json'); await fsp.writeFile(verificationPath,JSON.stringify(verification,null,2)+'\n',{flag:'wx',mode:0o600});
completed={status:'PASS',verificationPath,entryId:entry.id,previewSha256:preview.sha256};
} finally {
  const outcomes = await Promise.allSettled(cleanups.reverse().map(fn=>Promise.resolve().then(fn)));
  assert.equal(outcomes.filter(v=>v.status==='rejected').length,0,'owned fixture cleanup failed');
}
console.log(JSON.stringify(completed,null,2));
