import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pairedArmContext} from './helpers/paired-arm-owner-fixture.mjs';
import {createDurablePairedArmOwnerV1} from '../hosts/repository/durable-paired-arm-owner-v1.mjs';
import {inspectPairedArmTrialV1} from '../history/paired-arm-reconciliation-v1.mjs';
import {encodeArmSidecarRecordV1} from '../history/paired-arm-sidecar-codec-v1.mjs';

async function fixture(t,options={},dependencies){
  const c=await pairedArmContext(t,options);
  const parentDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'nisi-durable-arm-'));
  t.after(()=>fs.rmSync(parentDirectory,{recursive:true,force:true}));
  const {retain:_a,retainAdmission:_b,...input}=c.input;
  const owner=createDurablePairedArmOwnerV1({...input,parentDirectory},dependencies);
  return {c,owner,parentDirectory};
}
const sideFile=directory=>path.join(directory,'arm-sidecar.jsonl');
const parsed=directory=>fs.readFileSync(sideFile(directory),'utf8').trimEnd().split('\n').map(JSON.parse);
function replaceRecords(directory,records,originalEntries=[]){
  let previous=null;const replacements=new Map();
  const bytes=records.map((record,index)=>{
    // Keep unrelated references internally consistent so semantic tests reach
    // their intended guard instead of failing on a stale downstream hash.
    for(const key of ['preparedSha256','startSha256','historySha256'])
      if(replacements.has(record[key]))record[key]=replacements.get(record[key]);
    const encoded=encodeArmSidecarRecordV1(record,index,previous);previous=encoded.sha256;
    if(originalEntries[index])replacements.set(originalEntries[index].sha256,encoded.sha256);
    return encoded.bytes;
  });
  fs.writeFileSync(sideFile(directory),Buffer.concat(bytes));
}
function faultAt(text){
  let tripped=false;
  return {...fs,writeSync(fd,bytes,offset,length,position){
    if(!tripped&&bytes.toString('utf8').includes(text)){tripped=true;throw Error('fixture write fault');}
    return fs.writeSync(fd,bytes,offset,length,position);
  }};
}

for(const api of ['NATIVE_API','CHAT_COMPLETIONS'])for(const arm of ['OFF','ON'])
for(const unchanged of [false,true])test(`durable original owner ${api}/${arm}/${unchanged?'no-progress':'repaired'}, readonly reopened crosslinks`,async t=>{
  const {c,owner}=await fixture(t,{api,arm,variant:unchanged?'no-change':'repair'});
  const result=await owner.run();
  assert.equal(result.recorded,true);assert.equal(result.runner.counts.completed,1);
  assert.equal(result.runner.stopReason,'RUNNER_REPORTED_BUDGET_UNCONFIRMED');
  assert.equal(result.main.retainedEvents,6);assert.equal(result.sidecar.retainedRecords,10);
  const directory=result.main.directory,inspection=inspectPairedArmTrialV1({directory});
  assert.equal(inspection.status,'FINAL_CROSSLINKED');assert.deepEqual(inspection.missing,[]);
  assert.deepEqual(inspection.rows.map(x=>x.state),['COMPLETE','NOT_STARTED','NOT_STARTED','NOT_STARTED']);
  assert.equal(inspection.actualDispatchCount,null);assert.equal(inspection.authorizing,false);
  assert.equal(inspection.resumable,false);assert.equal(inspection.measurementVerified,false);
  const bytes=fs.readFileSync(sideFile(directory),'utf8');
  for(const forbidden of ['candidateText','sourceCode','apiKey','"prompt"','"messages"'])assert.equal(bytes.includes(forbidden),false);
  const modulePath=new URL('../history/paired-arm-reconciliation-v1.mjs',import.meta.url).href;
  const child=execFileSync(process.execPath,['--input-type=module','-e',
    `import {inspectPairedArmTrialV1} from ${JSON.stringify(modulePath)};process.stdout.write(JSON.stringify(inspectPairedArmTrialV1({directory:process.argv[1]})));`,directory],
  {timeout:5000,encoding:'utf8',env:{PATH:process.env.PATH}});
  assert.deepEqual(JSON.parse(child),JSON.parse(JSON.stringify(inspection)));assert.equal(c.requests.length,unchanged?1:2);
  await assert.rejects(owner.run());
});

test('immediate user stop records no dispatch and does not resume',async t=>{
  const {c,owner}=await fixture(t);
  const running=owner.run();assert.equal(owner.requestStop().status,'REQUESTED');
  const result=await running;assert.equal(result.recorded,true);assert.equal(c.requests.length,0);
  assert.equal(result.runner.counts.executorStarted,0);
  const inspected=inspectPairedArmTrialV1({directory:result.main.directory});
  assert.equal(inspected.status,'FINAL_CROSSLINKED');assert(inspected.rows.every(r=>r.state==='NOT_STARTED'));
});

test('post-mint consent refusal retains final history without inventing dispatch',async t=>{
  let linked=false,checks=0;
  const sidecarIo={...fs,writeSync(fd,bytes,...args){
    const result=fs.writeSync(fd,bytes,...args);
    if(bytes.toString().includes('"kind":"START_LINKED"'))linked=true;
    return result;
  }};
  const {c,owner}=await fixture(t,{}, {mainIo:fs,sidecarIo});
  c.state.observe=(_arg,value)=>{
    if(linked&&++checks===2)value.consent.revoked=true;
    return value;
  };
  const result=await owner.run();assert.equal(result.recorded,true);assert.equal(c.requests.length,0);
  const history=parsed(result.main.directory).find(x=>x.record.kind==='HISTORY').record;
  assert.equal(history.disposition,'FINAL_LOCAL_OBSERVATIONS');assert.equal(history.entries.length,1);
  const inspected=inspectPairedArmTrialV1({directory:result.main.directory});
  assert.equal(inspected.status,'FINAL_CROSSLINKED');assert.equal(inspected.rows[0].state,'STARTED_INCOMPLETE');
});

for(const [lane,marker,expectedRequests,missing] of [
  ['sidecar','"kind":"PREPARED"',0,null],
  ['main','"type":"START_INTENT"',0,null],
  ['sidecar','"kind":"START_LINKED"',0,'START_LINKED'],
  ['sidecar','"kind":"HISTORY"',2,null],
  ['sidecar','"kind":"PHASE_OBSERVED"',2,'PHASE_OBSERVED'],
  ['main','"type":"FINAL"',2,null],
  ['sidecar','"kind":"FINAL"',2,null],
])test(`failure ${lane} ${marker} preserves prefix without redispatch`,async t=>{
  const dependencies={mainIo:fs,sidecarIo:fs};dependencies[lane==='main'?'mainIo':'sidecarIo']=faultAt(marker);
  const {c,owner}=await fixture(t,{},dependencies),result=await owner.run();
  assert.equal(result.recorded,false);assert.equal(result.failure,'RUNNER_ARM_STORAGE_UNCONFIRMED');
  assert.equal(c.requests.length,expectedRequests);assert.equal(result.pendingRetentions,0);
  const inspected=inspectPairedArmTrialV1({directory:result.main.directory});
  assert.equal(inspected.status,'INCOMPLETE');
  if(missing)assert(inspected.missing.some(x=>x.missing===missing));
  if(lane==='main'&&marker.includes('START_INTENT'))assert.equal(inspected.rows[0].state,'PREPARED_UNCONFIRMED');
  await assert.rejects(owner.run());assert.equal(c.requests.length,expectedRequests);
});

test('fresh admission refusal remains a recorded stop, not task success',async t=>{
  const {c,owner}=await fixture(t);c.state.observe=(_arg,value)=>({...value,consent:{...value.consent,revoked:true}});
  const result=await owner.run();
  assert.equal(result.recorded,true);assert.equal(result.runner.counts.completed,0);assert.equal(c.requests.length,0);
  const inspected=inspectPairedArmTrialV1({directory:result.main.directory});
  assert.equal(inspected.status,'FINAL_CROSSLINKED');assert(inspected.rows.every(x=>x.state==='NOT_STARTED'));
});

test('caller mutation cannot change the controller-captured approval used for history',async t=>{
  const {c,owner}=await fixture(t),original={...c.approval};
  c.state.reserve=(intent,reserve)=>{
    const owners=reserve(intent);
    Object.assign(c.approval,{id:'changed',ownerId:'changed',planSha256:'e'.repeat(64),
      profileSha256:'e'.repeat(64),expiresAtMs:1,priority:'BACKGROUND'});
    return owners;
  };
  // Fixture observation uses the caller object too; deliberately keep those
  // independent trusted observations bound to the already approved values.
  c.state.observe=(_arg,value)=>({...value,consent:{...value.consent,...{
    id:original.id,ownerId:original.ownerId,planSha256:original.planSha256,profileSha256:original.profileSha256}}});
  const result=await owner.run();assert.equal(result.recorded,true);
  const history=parsed(result.main.directory).filter(x=>x.record.kind==='HISTORY');
  assert.equal(history.length,2);for(const entry of history)assert.deepEqual(entry.record.approval,original);
  assert.equal(inspectPairedArmTrialV1({directory:result.main.directory}).status,'FINAL_CROSSLINKED');
});

test('semantically forged rehashed sidecars refuse exact binding errors',async t=>{
  const {owner}=await fixture(t),result=await owner.run(),directory=result.main.directory;
  const originalEntries=parsed(directory),original=originalEntries.map(x=>x.record),D='f'.repeat(64);
  const cases=[
    ['header runner',r=>{r[0].runnerId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';}],
    ['header intents',r=>{r[0].intentsSha256=D;}],
    ['wrong main hash',r=>{r[1].main.sha256=D;}],
    ['wrong intent',r=>{r[1].intentSha256=D;}],
    ['wrong source',r=>{r[1].observation.custody.taskSha256=D;}],
    ['wrong owner',r=>{r[2].ownerSetId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';}],
    ['wrong prepared link',r=>{r[2].preparedSha256=D;}],
    ['wrong history generation',r=>{r[3].entries[0].generation++;}],
    ['wrong history point',r=>{r[3].entries[1].point='PERMIT_MINTED';}],
    ['wrong projection candidate',r=>{r[4].projection.candidate.candidateSha256=D;}],
    ['wrong projection inputs',r=>{r[4].projection.inputsSha256=D;}],
    ['wrong projection intent',r=>{r[4].projection.intentSha256=D;}],
    ['wrong treatment arm',r=>{r[4].projection.treatment.arm='OFF';}],
    ['wrong final state',r=>{r.at(-1).rows[0].state='NOT_STARTED';}],
  ];
  for(const [label,mutate] of cases)await t.test(label,()=>{
    const records=structuredClone(original);mutate(records);replaceRecords(directory,records,originalEntries);
    assert.equal(inspectPairedArmTrialV1({directory}).status,'REFUSED');
  });
  replaceRecords(directory,original);
  const finalBytes=fs.readFileSync(sideFile(directory));
  fs.writeFileSync(sideFile(directory),finalBytes.subarray(0,finalBytes.length-5));
  assert.equal(inspectPairedArmTrialV1({directory}).status,'INCOMPLETE');
  fs.writeFileSync(sideFile(directory),finalBytes);
  assert.equal(inspectPairedArmTrialV1({directory}).status,'FINAL_CROSSLINKED');
});
