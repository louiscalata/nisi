// Bounded real-TTY proof for the operator-facing incident review. The answer
// is typed by the operator; this script never auto-approves or launches work.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {reviewRepositoryIncidentsV1} from '../../hosts/history/review-repository-incidents-v1.mjs';
import {promptRepositoryHistoryV1} from '../../hosts/history/terminal-history-prompt-v1.mjs';
import {openJournalOwner} from '../../history/journal-owner-v2.mjs';
import {queryRepositoryIncidentV1} from '../../history/repository-incident-capture-v1.mjs';
import {createIncidentHostFixture} from '../../tests/helpers/incident-host-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mode = process.argv[2], pinPath = process.argv[3];
assert.ok(mode === 'approve' || mode === 'decline', 'usage: verify-terminal-incidents.mjs approve|decline /absolute/source-acceptance.json');
assert.ok(pinPath && path.isAbsolute(pinPath), 'source acceptance receipt must be absolute');
assert.equal(process.stdin.isTTY, true, 'proof must run from a TTY'); assert.equal(process.stdout.isTTY, true, 'proof must run from a TTY');
const pinBytes = fs.readFileSync(pinPath), pinHash = crypto.createHash('sha256').update(pinBytes).digest('hex'), receipt = JSON.parse(pinBytes.toString('utf8'));
assert.equal(receipt.status, 'PASS_SCOPED'); assert.ok(Number.isSafeInteger(receipt.checkedFiles));
const before = receipt.before, after = receipt.after; assert.ok(before && after && !Array.isArray(before) && !Array.isArray(after));
const paths = Object.keys(before); assert.equal(paths.length, receipt.checkedFiles); assert.deepEqual([...paths].sort(), Object.keys(after).sort());
for (const required of ['history/repository-incident-capture-v1.mjs','hosts/history/review-repository-incidents-v1.mjs','hosts/history/terminal-history-prompt-v1.mjs','hosts/repository/reviewed-workflow-v1.mjs','tests/helpers/incident-host-fixture.mjs','examples/repository-live-model.mjs','work-orders/repository-incident-review-v1/verify-terminal-incidents.mjs']) assert.ok(paths.includes(required), `required pin missing: ${required}`);
const pinRows = paths.map(relative => {
  const parts = relative.split('/'); assert.ok(parts.length && parts.every(part => part && part !== '.' && part !== '..') && !relative.startsWith('/'));
  const absolute = path.resolve(root, relative); assert.equal(path.relative(root, absolute).split(path.sep).includes('..'), false);
  const canonicalRoot = fs.realpathSync(root), canonicalFile = fs.realpathSync(absolute); assert.ok(canonicalFile === canonicalRoot || canonicalFile.startsWith(canonicalRoot + path.sep));
  const digest = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex'); assert.equal(digest, before[relative]); assert.equal(before[relative], after[relative]);
  return {path:relative, absolute, expected:digest, before:digest};
});

const cleanups = [], t = {after(fn) { cleanups.push(fn); }}, proofDirectory = {value:null};
try {
  const fixture = await createIncidentHostFixture(t), report = await fixture.host.run(fixture.options), settled = await fixture.host.settled();
  assert.equal(settled.state, 'SETTLED'); assert.equal(settled.report, report);
  const preview = fixture.host.incidentPreview(), row = preview.rows.find(value => value.classification === 'FAILURE_CANDIDATE');
  assert.equal(preview.status, 'PREVIEW'); assert.ok(row);
  const directory = await fsp.mkdtemp(path.join(root, '.build/repository-incident-review-v1-pty-')); proofDirectory.value = directory;
  const config = {projectId:`task:${row.binding.taskFingerprint}`,maxEntries:32,heartbeatTtlMs:30000,redactPaths:[]};
  const settledBeforeReview = settled, reportBeforeReview = report;
  const review = await reviewRepositoryIncidentsV1({host:fixture.host,runDirectory:directory,clock:()=>100,
    prompt:request=>promptRepositoryHistoryV1({...request,input:process.stdin,output:process.stdout}),
    openOwner:request=>openJournalOwner({path:request.path,fs,config:request.config,now:request.now}),signal:null,promptTimeoutMs:30000});
  assert.equal(review.authorizing,false);
  let childEvidence=null,storeEvidence=null;
  if (mode === 'approve') {
    assert.equal(review.status,'STORED',JSON.stringify(review)); assert.equal(review.capture?.status,'STORED');
    assert.equal(review.selectedRowId,row.rowId); assert.equal(review.previewSha256,preview.sha256);
    const entry = review.capture.journal.snapshot.entries.find(value=>value.entry.stage==='REPOSITORY_INCIDENT_CANDIDATE_V1').entry;
    const queried = queryRepositoryIncidentV1({path:path.join(directory,'incident-journal.jsonl'),fs,config,entryId:entry.id,now:101});
    assert.equal(queried.status,'AVAILABLE_OBSERVATION'); assert.equal(queried.entryId,entry.id); assert.equal(queried.observation.row.rowId,row.rowId); assert.equal(queried.observation.row.fingerprint,row.fingerprint); assert.equal(queried.observation.previewSha256,preview.sha256);
    const moduleURL = pathToFileURL(path.join(root,'history/repository-incident-capture-v1.mjs')).href;
    const child = spawnSync(process.execPath,['--input-type=module','-e',`import fs from 'node:fs';import {queryRepositoryIncidentV1} from ${JSON.stringify(moduleURL)};const r=queryRepositoryIncidentV1({path:${JSON.stringify(path.join(directory,'incident-journal.jsonl'))},fs,config:${JSON.stringify(config)},entryId:${JSON.stringify(entry.id)},now:102});if(r.status!=='AVAILABLE_OBSERVATION')process.exit(11);console.log(JSON.stringify({entryId:r.entryId,rowId:r.observation.row.rowId,rowFingerprint:r.observation.row.fingerprint,previewSha256:r.observation.previewSha256}));`],{cwd:root,encoding:'utf8',timeout:15000});
    assert.equal(child.error,undefined); assert.equal(child.signal,null); assert.equal(child.status,0,child.stdout+child.stderr);
    assert.equal(child.stderr,'');const observed=JSON.parse(child.stdout);
    assert.deepEqual(observed,{entryId:entry.id,rowId:row.rowId,rowFingerprint:row.fingerprint,previewSha256:preview.sha256});
    childEvidence={status:child.status,signal:child.signal,error:null,observed};
    const store=review.capture.journal.store;
    storeEvidence={status:store.status,verified:store.verified,committed:store.committed,durable:store.durable,fsync:store.fsync};
    assert.deepEqual(storeEvidence,{status:'WRITTEN',verified:true,committed:true,durable:true,fsync:{file:true,directory:true}});
  } else {
    assert.equal(review.status,'NOT_STORED',JSON.stringify(review)); assert.equal(review.reason,'DECLINED'); assert.equal(review.ownerOpenAttempted,false); assert.equal(review.captureCallAttempted,false); assert.equal(review.capture,null); assert.equal(fs.existsSync(path.join(directory,'incident-journal.jsonl')),false);
  }
  assert.equal(process.stdin.readableFlowing,false);
  assert.equal(await fixture.host.settled(),settledBeforeReview);assert.equal(settledBeforeReview.report,reportBeforeReview);
  const pinAfterRows=pinRows.map(p=>({...p,after:crypto.createHash('sha256').update(fs.readFileSync(p.absolute)).digest('hex')}));
  for(const p of pinAfterRows)assert.equal(p.after,p.before,p.path);
  const pinAfter = fs.readFileSync(pinPath); assert.equal(crypto.createHash('sha256').update(pinAfter).digest('hex'),pinHash);
  const verification={schemaVersion:'nisi-repository-incident-review-pty-verification/v1',status:'PASS_PTY_SCOPED',mode,
    previewSha256:preview.sha256,settlementStable:true,stdinReleased:true,review,child:childEvidence,storeEvidence,
    sourcePin:{path:pinPath,sha256:pinHash,status:'PASS_SCOPED',count:pinAfterRows.length,
      pins:pinAfterRows.map(({path,expected,before,after})=>({path,expected,before,after}))},
    operatorAnswerSource:'Synthetic fixture PTY; terminal answer is supplied externally and is not authenticated user consent.',
    providerCalls:false,networkCalls:false,nativeLaunch:false,modelCalls:false};
  // Cleanup must finish before a success receipt is published.
  for(const cleanup of cleanups.splice(0).reverse())await cleanup();
  const verificationPath=path.join(directory,'verification.json');
  await fsp.writeFile(verificationPath,JSON.stringify(verification,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({status:'PASS_PTY_SCOPED',mode,verificationPath,previewSha256:preview.sha256},null,2));
} catch (error) {
  if (proofDirectory.value) { try { await fsp.writeFile(path.join(proofDirectory.value,'verification-failure.json'),JSON.stringify({schemaVersion:'nisi-repository-incident-review-pty-verification/v1',status:'FAIL',mode,error:error?.message ?? String(error)},null,2)+'\n',{flag:'wx',mode:0o600}); } catch {} }
  throw error;
} finally { for (const cleanup of cleanups.reverse()) await cleanup(); }
