// Synthetic issued workflow evidence only; no native execution or model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewRepositoryIncidentsV1} from '../hosts/history/review-repository-incidents-v1.mjs';
import {createIncidentHostFixture} from './helpers/incident-host-fixture.mjs';
import {openJournalOwner} from '../history/journal-owner-v2.mjs';
import {memfs} from './journal-owner-v2.memfs.mjs';
import {createPagedIncidentHostFixture} from './helpers/incident-review-fixture.mjs';

async function setup(t) {
  const f=await createIncidentHostFixture(t);await f.host.run(f.options);await f.host.settled();
  const preview=f.host.incidentPreview(),row=preview.rows.find(r=>r.classification==='FAILURE_CANDIDATE');
  const m=memfs();let prompts=0;
  return {f,preview,row,input:{host:f.host,runDirectory:'/synthetic/incident-boundaries',clock:()=>100,
    signal:null,promptTimeoutMs:1000,openOwner:req=>openJournalOwner({...req,fs:m.fs}),
    prompt:async()=>({kind:'answer',text:++prompts===1?'SELECT '+row.rowId:'STORE '+row.fingerprint+' '+preview.sha256})}};
}

test('capture success cannot discard or contradict its journal outcome',async t=>{
  for(const alter of [c=>({...c,journal:null}),c=>({...c,journal:Object.freeze({...c.journal,status:'STORE_FAILED'})}),
    c=>({...c,journal:Object.freeze({...c.journal,entryId:'ric1.'+'0'.repeat(64)})}),
    c=>({...c,journal:Object.freeze({...c.journal,authorizing:true})}),
    c=>({...c,journal:Object.freeze({...c.journal,snapshot:Object.freeze({...c.journal.snapshot,state:'COMMIT_UNCERTAIN'})})})]) {
    const {f,input}=await setup(t);
    input.host={...f.host,captureIncident:p=>Object.freeze(alter(f.host.captureIncident(p)))};
    const r=await reviewRepositoryIncidentsV1(input);
    assert.equal(r.status,'UNCERTAIN');assert.equal(r.reason,'CAPTURE_UNCONFIRMED');
    assert.equal(r.captureCallAttempted,true);assert.equal(r.capture,null);assert.equal(r.permitReleaseStatus,'CONSUMED');
  }
});

test('abort from the capture clock refuses before journal admission, not uncertain storage',async t=>{
  const {f,input}=await setup(t),controller=new AbortController();let insideCapture=false;
  input.signal=controller.signal;
  input.clock=()=>{if(insideCapture)controller.abort();return 100;};
  input.host={...f.host,captureIncident:p=>{insideCapture=true;return f.host.captureIncident(p);}};
  const r=await reviewRepositoryIncidentsV1(input);
  assert.equal(r.status,'REFUSED');assert.equal(r.reason,'INVALID_CLOCK');
  assert.equal(r.captureCallAttempted,true);assert.equal(r.capture.recordAttempted,false);
  assert.equal(r.capture.consumed,false);assert.equal(r.capture.journal,null);
  assert.equal(r.permitReleaseStatus,'REVOKED');assert.equal(r.cancelledAfterCaptureCall,true);
});

test('a genuine all-pass preview has no selectable failures and never prompts or opens',async t=>{
  const f=await createIncidentHostFixture(t),p=f.c.preparations[1];
  f.options.author.draft=payload=>({candidate:{files:p.candidate.files.map(({path,content})=>({path,content}))},
    evidence:{...payload.binding,candidateFingerprint:p.candidateFingerprint,note:'Reviewed repaired fixture as initial candidate'}});
  await f.host.run(f.options);await f.host.settled();
  assert.equal(f.host.incidentPreview().status,'PREVIEW');
  assert.ok(f.host.incidentPreview().rows.length>0);
  let calls=0;
  const r=await reviewRepositoryIncidentsV1({host:f.host,runDirectory:'/synthetic/no-failures',clock:()=>100,
    signal:null,promptTimeoutMs:1000,prompt:()=>{calls++;},openOwner:()=>{calls++;}});
  assert.equal(r.status,'NOT_STORED');assert.equal(r.reason,'NO_FAILURE_CANDIDATES');
  assert.equal(calls,0);assert.equal(r.ownerOpenAttempted,false);
});

test('invalid inputs and unissued previews cannot reach trusted storage callbacks',async t=>{
  const {f,input,preview}=await setup(t);let calls=0;
  const clean={...input,prompt:()=>{calls++;},openOwner:()=>{calls++;}};
  for(const patch of [{extra:true},{runDirectory:'/'},{runDirectory:'relative'},
    {runDirectory:'/bad\u0000path'},{signal:{}},{promptTimeoutMs:0},{promptTimeoutMs:120001}]){
    const r=await reviewRepositoryIncidentsV1({...clean,...patch});
    assert.equal(r.status,'NOT_STORED');assert.equal(r.reason,'INVALID_INPUT');
  }
  const r=await reviewRepositoryIncidentsV1({...clean,host:{...f.host,incidentPreview:()=>structuredClone(preview)}});
  assert.equal(r.reason,'PREVIEW_UNAVAILABLE');assert.equal(calls,0);
  const paged=await createPagedIncidentHostFixture();
  const hidden=paged.eligible[10];assert.ok(hidden);
  const wrongPage=await reviewRepositoryIncidentsV1({...clean,host:paged.host,
    prompt:async()=>({kind:'answer',text:'SELECT '+hidden.rowId})});
  assert.equal(wrongPage.reason,'SELECTION_MISMATCH');assert.equal(wrongPage.ownerOpenAttempted,false);
  assert.equal(calls,0);
});

test('malformed permit response still releases its recoverable opaque handle',async t=>{
  const {f,input}=await setup(t);let handle;
  input.host={...f.host,createIncidentPermit:p=>{const issued=f.host.createIncidentPermit(p);
    assert.equal(issued.status,'CREATED');handle=issued.permit;
    return Object.freeze({...issued,declarationDigest:'0'.repeat(64)});}};
  const r=await reviewRepositoryIncidentsV1(input);
  assert.equal(r.status,'NOT_STORED');assert.equal(r.reason,'PERMIT_UNCONFIRMED');
  assert.equal(r.captureCallAttempted,false);assert.equal(r.permitReleaseStatus,'REVOKED');
  const later=f.host.captureIncident({permit:handle});assert.equal(later.reason,'PERMIT_REVOKED');
  assert.equal(later.recordAttempted,false);
});
