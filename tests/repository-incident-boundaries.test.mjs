// Owner-added boundary tests. Trusted fixtures, no native/model execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRepositoryIncidentAccessV1,queryRepositoryIncidentV1} from '../history/repository-incident-capture-v1.mjs';
import {createRepositoryIncidentPreviewV1} from '../history/repository-incident-candidates-v1.mjs';
import {createRepositoryRunBundleV1} from '../receipts/repository-run-v1.mjs';
import {openJournalOwner,recordJournalObservation} from '../history/journal-owner-v2.mjs';
import {createRunJournal} from '../history/run-journal-v1.mjs';
import {sha256Text,stableStringify} from '../workflow/contracts.mjs';
import {combinedFixture} from './helpers/repository-run-fixture.mjs';
import {mixedStaticOperationalFixture} from './helpers/incident-candidate-fixture.mjs';
import {memfs} from './journal-owner-v2.memfs.mjs';

const PATH='/j/incidents.jsonl',root=fileURLToPath(new URL('../',import.meta.url));
const H=(part,value)=>sha256Text('nisi/repository-incident-'+part+'/v1\0'+stableStringify(value));
async function setup(t,options={}) {
  const f=await combinedFixture(t,options),preview=createRepositoryIncidentPreviewV1({bundle:createRepositoryRunBundleV1(f.context),context:f.context});
  const row=preview.rows.find(r=>r.classification==='FAILURE_CANDIDATE');assert.ok(row);
  const config={projectId:'task:'+row.binding.taskFingerprint,maxEntries:32,heartbeatTtlMs:30000,redactPaths:[]};
  const m=memfs(),owner=openJournalOwner({path:PATH,fs:m.fs,config,now:100}).owner;
  const declaration={schemaVersion:'nisi-repository-incident-declaration/v1',declarationId:'boundary.a',
    projectId:config.projectId,rowId:row.rowId,rowFingerprint:row.fingerprint,previewSha256:preview.sha256,
    issuedAt:100,expiresAt:1000,createdAt:100,retentionMs:10000,consentClass:'WRITTEN_DECLARATION',
    destination:'LOCAL_INCIDENT_OBSERVATION_ONLY',rawContentPersisted:false,networkEgress:false,learningInfluence:false};
  return{preview,row,config,m,owner,declaration};
}
function capture(x,access=createRepositoryIncidentAccessV1({getPreview:()=>x.preview})) {
  const p=access.createPermit({owner:x.owner,declaration:x.declaration,clock:()=>100});assert.equal(p.status,'CREATED');
  const r=access.capture({permit:p.permit});assert.equal(r.status,'STORED');
  const entry=r.journal.snapshot.entries.find(v=>v.entry.id===r.entryId).entry;
  return{access,p,r,entry};
}
const query=(x,id,now=100)=>queryRepositoryIncidentV1({path:PATH,fs:x.m.fs,config:x.config,entryId:id,now});

test('original static-check failure can be captured and freshly read without native admission',async t=>{
  const x=await setup(t,{staticOnly:true});assert.equal(x.row.binding.stage,'staticChecks');
  const {r}=capture(x),q=query(x,r.entryId);assert.equal(q.status,'AVAILABLE_OBSERVATION');
  assert.equal(q.observation.row.subject.kind,'FILE');assert.ok(q.observation.row.failureCodes.length);
  assert.equal(q.observation.nativeIncidentCaptured,false);assert.equal(q.observation.row.persistable,false);
});

test('raw static FAIL in unavailable group is not eligible for an incident permit',async t=>{
  const x=await setup(t),f=await mixedStaticOperationalFixture(t);
  const preview=createRepositoryIncidentPreviewV1({bundle:createRepositoryRunBundleV1(f.context),context:f.context});
  const row=preview.rows.find(r=>r.rawStatus==='FAIL');assert.equal(row.classification,'OPERATIONAL');
  const access=createRepositoryIncidentAccessV1({getPreview:()=>preview}),before=x.m.events.length;
  const p=access.createPermit({owner:x.owner,clock:()=>100,declaration:{...x.declaration,
    projectId:'task:'+row.binding.taskFingerprint,rowId:row.rowId,rowFingerprint:row.fingerprint,previewSha256:preview.sha256}});
  assert.equal(p.status,'REFUSED');assert.equal(p.permit,null);assert.equal(x.m.events.length,before);
});

test('preview replacement during capture clock refuses without consuming or writing',async t=>{
  const x=await setup(t);let current=x.preview,n=0;
  const access=createRepositoryIncidentAccessV1({getPreview:()=>current});
  const p=access.createPermit({owner:x.owner,declaration:x.declaration,clock:()=>{if(++n===2)current=structuredClone(current);return 100;}});
  assert.equal(p.status,'CREATED');
  const before=x.m.events.length,r=access.capture({permit:p.permit});
  assert.equal(r.status,'REFUSED');assert.equal(r.reason,'PREVIEW_CHANGED');
  assert.equal(r.recordAttempted,false);assert.equal(r.consumed,false);assert.equal(x.m.events.length,before);
});

test('query distinguishes capacity-pruned observation from missing or expired without writes',async t=>{
  const x=await setup(t);x.config={...x.config,maxEntries:1};x.owner=openJournalOwner({path:PATH,fs:x.m.fs,config:x.config,now:100}).owner;
  const {entry}=capture(x);
  const added=recordJournalObservation({owner:x.owner,entry:{...entry,id:'unrelated.second',payload:null},now:100});
  assert.equal(added.status,'RECORDED');const before=x.m.events.length,q=query(x,entry.id);
  assert.equal(q.status,'NOT_RETAINED');assert.equal(q.observation,null);
  assert.deepEqual(x.m.events.slice(before).map(e=>e.name),['readFileSync']);
  assert.equal(query(x,entry.id,10100).status,'EXPIRED');
});

test('valid journal hashes do not excuse extra fields, raw codes, upgraded flags or broken row bindings',async t=>{
  const x=await setup(t),{entry}=capture(x);
  const variants=[r=>{r.extra='PRIVATE_RAW_DATA';},r=>{r.source.extra='PRIVATE_RAW_DATA';},
    r=>{r.failureCodes=['PRIVATE_RAW_DATA'];},r=>{r.executionVerified=true;},
    r=>{r.binding.runId='different-run';r.rowId=H('row-id',r.binding);},
    r=>{r.source.receiptSha256='0'.repeat(64);},r=>{r.schemaVersion='unknown';}];
  for(const mutate of variants){
    const e=structuredClone(entry);mutate(e.payload.row);const{fingerprint,...body}=e.payload.row;
    e.payload.row.fingerprint=H('row',body);
    const j=createRunJournal(x.config);assert.equal(j.append(e,100).status,'APPENDED');x.m.seed(PATH,Buffer.from(j.serialize()));
    const opened=openJournalOwner({path:PATH,fs:x.m.fs,config:x.config,now:100});
    assert.equal(opened.status,'OPENED');assert.equal(opened.snapshot.state,'OPEN');
    const q=query(x,entry.id);assert.equal(q.status,'REFUSED');assert.equal(q.reason,'INVALID_OBSERVATION');
    assert.equal(q.observation,null);assert(!JSON.stringify(q).includes('PRIVATE_RAW_DATA'));
  }
});

test('input accessors never execute and unknown properties do not reach filesystem',async t=>{
  const x=await setup(t),access=createRepositoryIncidentAccessV1({getPreview:()=>x.preview});let touched=0;
  const before=x.m.events.length;
  const d={...x.declaration};Object.defineProperty(d,'declarationId',{enumerable:true,get(){touched++;return 'no';}});
  assert.equal(access.createPermit({owner:x.owner,declaration:d,clock:()=>100}).status,'REFUSED');
  const q=queryRepositoryIncidentV1({path:PATH,fs:x.m.fs,config:x.config,entryId:'ric1.'+'0'.repeat(64),now:100,extra:true});
  assert.equal(q.status,'REFUSED');assert.equal(touched,0);assert.equal(x.m.events.length,before);
});

test('unexpected record exception or malformed response is uncertain and never retried',async t=>{
  const x=await setup(t),dir=await fs.mkdtemp(path.join(os.tmpdir(),'nisi-incident-record-boundary-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const origin='history/repository-incident-capture-v1.mjs',source=await fs.readFile(path.join(root,origin),'utf8');
  const originalJournal=pathToFileURL(path.join(root,'history/journal-owner-v2.mjs')).href;
  for(const[index,response]of ["throw Error('PRIVATE_ERROR')","return undefined","return {status:'MADE_UP'}",
    "return {schemaVersion:'nisi-journal-owner/v2',status:'RECORDED',reason:null,authorizing:false}"].entries()){
    const stub=path.join(dir,`journal-${index}.mjs`),module=path.join(dir,`capture-${index}.mjs`);
    await fs.writeFile(stub,`export {inspectJournalOwner,openJournalOwner} from ${JSON.stringify(originalJournal)};\nexport function recordJournalObservation(){${response}}`,{flag:'wx'});
    const changed=source.replace(/from '([^']+)'/g,(full,s)=>s.startsWith('.')?"from '"+pathToFileURL(s==='./journal-owner-v2.mjs'?stub:path.resolve(root,'history',s)).href+"'":full);
    await fs.writeFile(module,changed,{flag:'wx'});
    const {createRepositoryIncidentAccessV1:factory}=await import(pathToFileURL(module).href),a=factory({getPreview:()=>x.preview});
    const p=a.createPermit({owner:x.owner,declaration:x.declaration,clock:()=>100});assert.equal(p.status,'CREATED');
    const r=a.capture({permit:p.permit});assert.equal(r.status,'UNCERTAIN');assert.equal(r.reason,'INTERNAL_ERROR');
    assert.equal(r.journal,null);assert.equal(r.recordAttempted,true);assert.equal(r.consumed,true);
    assert.equal(a.capture({permit:p.permit}).reason,'PERMIT_CONSUMED');assert(!JSON.stringify(r).includes('PRIVATE_ERROR'));
  }
});
