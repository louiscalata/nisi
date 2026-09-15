// Explicit macOS native integration command, not silently skipped in a JS suite.
// Usage: node .../scheduled-reference-probe.integration.mjs builds.json out.json
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {runScheduledReferenceProbe,encode,digest,frame,validateReady,validateResult,validateSchedulerAdmission,sha} from '../../../tooling/neural/scheduled-reference-probe.mjs';
const build=JSON.parse(fs.readFileSync(process.argv[2]));
assert.equal(build.lanes.length,2);assert.deepEqual(build.drift,[]);
const records=[];
async function check(name,fn){try{const result=await fn();records.push({name,pass:true,...(result?{evidence:result}:{})});}
  catch(e){records.push({name,pass:false,error:String(e)});}}
const zero='0'.repeat(64),nonce='a'.repeat(64);
const request={kind:'PREPARE_V1',runID:'run.'+nonce,generation:'1',nonce,fixture:'reference-text-prototype-v1',
  graphSHA256:zero,runSHA256:zero,topologySHA256:zero,planSHA256:zero};
// Raw protocol tests deliberately do NOT claim scheduler admission. Synthetic GO
// proves parser behavior only, whereas the main runner composes the REAL owner.
async function rawProbe(binary,initial,onReady,fragmented=false){
  const child=spawn(binary,['fixed-reference-v1'],{env:{PATH:'/usr/bin:/bin'},stdio:['pipe','pipe','pipe']});
  const frames=[];let raw=Buffer.alloc(0),stderr='',failure=null;
  child.on('error',e=>failure=String(e));child.stdin.on('error',()=>{});
  child.stderr.on('data',b=>stderr+=b.toString());
  const timer=setTimeout(()=>child.kill('SIGKILL'),2500);
  const completion=new Promise(resolve=>child.on('close',(code,signal)=>resolve({code,signal})));
  child.stdout.on('data',b=>{
    raw=Buffer.concat([raw,b]);if(raw.length>16384){failure='OVERFLOW';child.kill('SIGKILL');return;}
    try{while(raw.length>=4){const n=raw.readUInt32BE();assert(n>0&&n<=8192);if(raw.length<n+4)break;
      const bytes=raw.subarray(4,4+n);raw=raw.subarray(4+n);const v=JSON.parse(bytes);assert(encode(v).equals(bytes));frames.push(v);
      if(v.kind==='READY_V1')onReady?.(v,child);
    }}catch(e){failure=String(e);child.kill('SIGKILL');}
  });
  if(fragmented){for(const byte of initial)child.stdin.write(Buffer.from([byte]));}else child.stdin.write(initial);
  if(!onReady)child.stdin.end();
  const terminal=await completion;clearTimeout(timer);assert.equal(failure,null);assert.equal(stderr,'');assert.equal(raw.length,0);
  return {frames,terminal};
}
function goFor(ready){return {kind:'GO_V1',requestSHA256:digest(encode(request)),readySHA256:digest(encode(ready)),runID:request.runID,
  permitID:'permit-'+'b'.repeat(16),workSHA256:'c'.repeat(64),windowIndex:'0'};}
function refused(r,{ready=true}={}){
  assert.equal(r.terminal.code,2);assert.equal(r.terminal.signal,null);
  assert.deepEqual(r.frames.map(f=>f.kind),ready?['READY_V1','REFUSED_V1']:['REFUSED_V1']);
}
for(const lane of build.lanes){
  const prefix='Xcode '+lane.lane;
  const options={binary:lane.binary,binarySHA256:lane.binarySHA256};
  assert.equal(lane.code,0);assert.equal(lane.binarySHA256,sha(fs.readFileSync(lane.binary)));
  let successful;
  await check(prefix+' actual scheduler to native output and physical exit',async()=>{
    const r=await runScheduledReferenceProbe(options);assert.equal(r.status,'PASS_PRIVATE_SCHEDULED_NATIVE_REFERENCE_ONLY');
    assert.deepEqual(r.events.map(e=>e.event),['CHILD_STARTED','READY_VALIDATED','SLOT_CLAIMED','GO_SENT','NATIVE_BEGUN','RESULT_VALIDATED','CHILD_REAPED']);
    assert(r.childReaped);assert.equal(r.terminal.code,0);assert.equal(r.scheduler.chargedLifetimeSlots,1);
    assert(r.scheduler.schedulerStopConfirmed);assert.equal(r.scheduler.scheduler.state,'OFF');
    assert.equal(r.result.outputHex,'00001037000000000000803f0000403f');assert.equal(r.authorizing,false);
    assert.equal(r.productionAdmission,false);assert.equal(r.afmInference,false);successful=r;return r;
  });
  await check(prefix+' pre-abort never starts a child or spends a slot',async()=>{
    const c=new AbortController();c.abort();const r=await runScheduledReferenceProbe({...options,signal:c.signal});
    assert.equal(r.reason,'ABORTED');assert.equal(r.childStarted,false);assert.equal(r.scheduler.chargedLifetimeSlots,0);return r;
  });
  await check(prefix+' abort reaps the owned child and stops admission',async()=>{
    const c=new AbortController();const pending=runScheduledReferenceProbe({...options,signal:c.signal});c.abort();const r=await pending;
    assert.equal(r.reason,'ABORTED');assert(r.childReaped);assert.equal(r.terminal.signal,'SIGKILL');assert(r.scheduler.schedulerStopConfirmed);return r;
  });
  await check(prefix+' missing GO does not begin a native task',async()=>{const r=await rawProbe(lane.binary,frame(request),(_v,p)=>p.stdin.end());refused(r);return r;});
  await check(prefix+' fragmented input still produces actual native output',async()=>{
    const r=await rawProbe(lane.binary,frame(request),(v,p)=>p.stdin.end(frame(goFor(v))),true);
    assert.equal(r.terminal.code,0);assert.deepEqual(r.frames.map(f=>f.kind),['READY_V1','BEGUN_V1','RESULT_V1']);
    validateReady(r.frames[0],digest(encode(request)));validateResult(r.frames[2],digest(encode(request)),digest(encode(goFor(r.frames[0]))));return r;
  });
  for(const field of ['requestSHA256','readySHA256','runID','permitID','workSHA256','windowIndex'])await check(prefix+' rejects changed GO '+field,async()=>{
    const r=await rawProbe(lane.binary,frame(request),(v,p)=>p.stdin.end(frame({...goFor(v),[field]:'invalid'})));refused(r);return r;
  });
  await check(prefix+' duplicate GO refuses BEFORE beginning',async()=>{
    const r=await rawProbe(lane.binary,frame(request),(v,p)=>{const go=frame(goFor(v));p.stdin.end(Buffer.concat([go,go]));});refused(r);return r;
  });
  for(const [name,bytes] of [
    ['oversized frame',Buffer.from([0,0,32,1])],['zero frame',Buffer.alloc(4)],
    ['unknown request field',frame({...request,extra:'x'})],['different fixture',frame({...request,fixture:'other'})],
    ['noncanonical JSON',(()=>{const raw=Buffer.from(JSON.stringify(request)),h=Buffer.alloc(4);h.writeUInt32BE(raw.length);return Buffer.concat([h,raw]);})()],
    ['truncated frame',frame(request).subarray(0,10)]
  ])await check(prefix+' rejects '+name,async()=>{const r=await rawProbe(lane.binary,bytes);refused(r,{ready:false});return r;});
  await check(prefix+' independent numeric/result oracle rejects every changed field',()=>{
    assert(successful);for(const field of Object.keys(successful.result))assert.throws(()=>validateResult({...successful.result,[field]:'changed'},successful.requestSHA256,successful.goSHA256));
    assert.throws(()=>validateResult({...successful.result,extra:'x'},successful.requestSHA256,successful.goSHA256));
    return {alteredFields:Object.keys(successful.result).length,unknownFieldRefused:true};
  });
  await check(prefix+' wrong binary digest refuses before launch',async()=>{
    await assert.rejects(runScheduledReferenceProbe({...options,binarySHA256:zero}),/BINARY_DIGEST/);
  });
  await check(prefix+' exact scheduler identity reader rejects substitutions',()=>{
    assert(successful);const slot=successful.slot,run=slot.runId;
    const permit={ok:true,code:'PERMIT_ISSUED',runId:run,permitId:slot.permitId,digest:slot.slot.workSha256,
      authorizing:false,modelExecuted:false,promotionGranted:false,certificationGranted:false};
    validateSchedulerAdmission(permit,slot,run);
    for(const field of ['runId','permitId','executionsUsed','authorizing','modelExecuted','code'])assert.throws(()=>validateSchedulerAdmission(permit,{...slot,[field]:'changed'},run));
    for(const field of Object.keys(slot.slot))assert.throws(()=>validateSchedulerAdmission(permit,{...slot,slot:{...slot.slot,[field]:'changed'}},run));
    for(const field of Object.keys(permit))assert.throws(()=>validateSchedulerAdmission({...permit,[field]:'changed'},slot,run));
    return {slotFields:12,permitFields:9};
  });
}
const result={status:records.every(r=>r.pass)?'PASS_PRIVATE_NATIVE_INTEGRATION_ONLY':'FAIL',records,
  tests:records.length,passed:records.filter(r=>r.pass).length,authorizing:false,productionAdmission:false,uiRendered:false,fullNativeGate:'NOT_RUN'};
fs.writeFileSync(process.argv[3],JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({...result,records:records.filter(r=>!r.pass)}));if(result.status==='FAIL')process.exitCode=1;
