// Private, fixed-input diagnostic integration. NOT production model permission.
// A real scheduler claim gates the actual Swift reference owner. Same-user binary
// hash checks are integrity observations, not protected launch attestation.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {canonicalizeMAC1JSONV1} from '../canonical/mac1-json-v1.mjs';
import {createScheduledRunOwner} from './scheduled-run-owner.mjs';
import {makeBn01Fixture, fixtureBytes} from './bn01-fixture.mjs';
import {makeDualFixture, canonicalFixtureBytes} from './dual-face-fixture.mjs';

export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const encode = value => Buffer.from(canonicalizeMAC1JSONV1(Buffer.from(JSON.stringify(value))).canonical);
export const digest = bytes => sha(Buffer.concat([Buffer.from('veritas/scheduled-reference-probe/v1\0'),bytes]));
export function frame(value) {
  const raw=encode(value);if(raw.length<1||raw.length>8192)throw Error('FRAME_SIZE');
  const header=Buffer.alloc(4);header.writeUInt32BE(raw.length);return Buffer.concat([header,raw]);
}
const hex = v => typeof v==='string' && /^[0-9a-f]{64}$/.test(v);
const requireThat = (v,reason) => {if(!v)throw Error(reason);};
const keys = (v,names) => requireThat(v&&typeof v==='object'&&!Array.isArray(v)&&
  Object.keys(v).sort().join('|')===[...names].sort().join('|')&&Object.values(v).every(x=>typeof x==='string'),'FRAME_SCHEMA');
const authority='DEBUG_SYNTHETIC_ONLY';
const profileID='veritas-macos-one-file-v1',packageSHA='c4598e88e9e0a2ce52345bd4ff063359af603e2cbf275570f2453d5aca29fa5f';
const tagged=s=>Buffer.byteLength(s)+':'+s;
// Independent oracle from CheckProfile's documented fixed fixture, not child claims.
const profileSHA=sha(['veritas-check-profile-rules-v1','PROFILE_ADMITTED',profileID].map(tagged).concat([
  '', ['completeness','factual_support','style','risk'].sort().map(tagged).join(''),tagged('model-optional'),tagged('3')]).join('|'));
const output=Buffer.alloc(16);[9/1048576,0,1,3/4].forEach((v,i)=>output.writeFloatLE(v,i*4));
const weights=Buffer.alloc(160);for(let layer=0;layer<2;layer++)for(let i=0;i<4;i++)weights.writeFloatLE(1,layer*80+(i*4+i)*4);
const modelSHA=sha(Buffer.concat([Buffer.from('veritas-bn02-reference-mlp-prep-v1\0'+'4:4:4\0'),weights]));

export function validateReady(r,requestSHA) {
  keys(r,['kind','requestSHA256','subjectSHA256','profileID','profileSHA256','packageSHA256','buildReceiptSHA256',
    'declaredBytes','scalarOperations','taskSlots','authority','execution']);
  requireThat(r.kind==='READY_V1'&&r.requestSHA256===requestSHA&&r.subjectSHA256===sha('reference')&&
    r.profileID===profileID&&r.profileSHA256===profileSHA&&r.packageSHA256===packageSHA&&
    r.buildReceiptSHA256==='0'.repeat(64)&&r.authority===authority&&r.execution==='NOT_BEGUN'&&r.taskSlots==='1','READY_IDENTITY');
  // 9 input + 72 preparation + 65536 metadata + 160 weights + 80 numeric
  // + 16400 result + 65536 task envelope. Logical accounting, not RSS.
  requireThat(r.declaredBytes==='147793'&&r.scalarOperations==='68','READY_RESOURCE');
}
export function validateResult(r,requestSHA,goSHA) {
  keys(r,['kind','requestSHA256','goSHA256','nativeRunID','subjectSHA256','profileSHA256','hostEpoch','preparedSHA256',
    'contextSHA256','outputSHA256','resultSHA256','outputHex','buildReceiptSHA256','authority','cleanup']);
  requireThat(r.kind==='RESULT_V1'&&r.requestSHA256===requestSHA&&r.goSHA256===goSHA&&
    /^run\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(r.nativeRunID)&&
    r.subjectSHA256===sha('reference')&&r.profileSHA256===profileSHA&&r.hostEpoch==='1'&&
    r.outputHex===output.toString('hex')&&r.outputSHA256===sha(output)&&
    r.buildReceiptSHA256==='0'.repeat(64)&&r.authority===authority&&r.cleanup==='JOINED_UNBOUND'&&hex(r.contextSHA256),'RESULT_IDENTITY');
  // Recompute numeric preparation/result identities, never accept opaque PASS.
  const context=`context=${r.contextSHA256}\0`,inputSHA=sha(output);
  const prepared=sha(Buffer.concat([Buffer.from('veritas/bn02/prepared-evaluation/v2\0'+
    `scope=scope.bn01.native\0run=${r.nativeRunID}\0model=${modelSHA}\0shape=4:4:4\0input=${inputSHA}\0`+context),output]));
  const result=sha(Buffer.concat([Buffer.from('veritas/bn02/evaluation-result/v2\0'+
    `scope=scope.bn01.native\0run=${r.nativeRunID}\0prepared=${prepared}\0model=${modelSHA}\0shape=4\0input=${inputSHA}\0output=${sha(output)}\0`+context),output]));
  requireThat(r.preparedSHA256===prepared&&r.resultSHA256===result,'RESULT_DIGEST');
}

export function validateSchedulerAdmission(permit,slot,runId) {
  const flags=['authorizing','modelExecuted','promotionGranted','certificationGranted'];
  const exact=(v,names)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===[...names].sort().join('|');
  requireThat(exact(permit,['ok','code',...flags,'permitId','runId','digest'])&&permit.ok===true&&permit.code==='PERMIT_ISSUED'&&
    permit.runId===runId&&/^permit-[0-9a-f]{16}$/.test(permit.permitId)&&hex(permit.digest)&&flags.every(k=>permit[k]===false),'PERMIT_REFUSED');
  requireThat(exact(slot,['ok','code',...flags,'runId','permitId','executionsUsed','slot'])&&slot.ok===true&&
    slot.code==='SLOT_BOUND_ADMITTED'&&slot.runId===runId&&slot.permitId===permit.permitId&&slot.executionsUsed===1&&
    flags.every(k=>slot[k]===false)&&exact(slot.slot,['workId','workSha256','windowIndex','slotCharged','slotClaimed','ownerAdmitted'])&&
    slot.slot.workId===runId&&slot.slot.workSha256===permit.digest&&Number.isSafeInteger(slot.slot.windowIndex)&&slot.slot.windowIndex>=0&&
    slot.slot.slotCharged===true&&slot.slot.slotClaimed===true&&slot.slot.ownerAdmitted===true,'SLOT_REFUSED');
}

// No executor callback, arbitrary argv, external artifact, model path or source text.
// Each invocation owns exactly one no-descendant Swift probe. Abort terminates that
// direct ChildProcess before settlement; there is no detached PID/group reuse.
export async function runScheduledReferenceProbe({binary,binarySHA256,signal,timeoutMs=5000}) {
  requireThat(process.platform==='darwin'&&process.arch==='arm64','PLATFORM');
  requireThat(typeof binary==='string'&&path.isAbsolute(binary)&&hex(binarySHA256),'BINARY_ARGUMENTS');
  requireThat(Number.isInteger(timeoutMs)&&timeoutMs>=50&&timeoutMs<=10000,'DEADLINE');
  requireThat(signal===undefined||signal instanceof AbortSignal,'SIGNAL');
  const fd=fs.openSync(binary,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  let before;
  try {
    before=fs.fstatSync(fd);requireThat(before.isFile()&&before.uid===process.getuid()&&before.nlink===1&&
      before.size>0&&before.size<64000000&&(before.mode&0o111)!==0,'BINARY_IDENTITY');
    requireThat(sha(fs.readFileSync(fd))===binarySHA256,'BINARY_DIGEST');
  } finally {fs.closeSync(fd);}
  // Caller must control the ancestors. This is not protection from a hostile UID.
  requireThat(fs.realpathSync(binary)===binary,'BINARY_PATH');
  const now=()=>Math.floor(performance.now()),started=now();
  const base=makeBn01Fixture(),dual=makeDualFixture(base),pins={graphSha256:base.graph.sha256,runSha256:base.run.sha256,
    topologySha256:dual.topology.sha256,planSha256:dual.plan.sha256};
  const made=createScheduledRunOwner(fixtureBytes({kind:'veritas-admitted-run-bind-v1',profile:'veritas-bn01-offline-contract-v1',
    schemaVersion:1,generation:1,runBudgetCap:10,deadlineMs:timeoutMs,...pins}),fixtureBytes(base),canonicalFixtureBytes(dual),
    {clock:now,windowSlots:10,windowDurationMs:1000,maxCourierIds:8});
  requireThat(made.ok,'SCHEDULER');const owner=made.owner;
  const nonce=randomBytes(32).toString('hex'),runId='run.'+nonce;
  const request={kind:'PREPARE_V1',runID:runId,generation:'1',nonce,fixture:'reference-text-prototype-v1',
    graphSHA256:pins.graphSha256,runSHA256:pins.runSha256,topologySHA256:pins.topologySha256,planSHA256:pins.planSha256};
  const requestSHA=digest(encode(request));
  const events=[];let reason=null,child=null,phase=0,goSHA=null,result=null,slot=null,pending=Buffer.alloc(0),total=0,stderr=0;
  const record=name=>events.push({event:name,elapsedMs:now()-started});
  const abort=(code)=>{if(reason===null){reason=code;record(code);}owner.stop();if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');};
  if(signal?.aborted){abort('ABORTED');return {status:'REFUSED',reason,events,childStarted:false,childReaped:false,scheduler:owner.status(),authorizing:false};}
  const onAbort=()=>abort('ABORTED');signal?.addEventListener('abort',onAbort,{once:true});
  let terminal;
  const timer=setTimeout(()=>abort('DEADLINE'),timeoutMs);
  try {
    child=spawn(binary,['fixed-reference-v1'],{cwd:path.dirname(binary),env:{PATH:'/usr/bin:/bin'},stdio:['pipe','pipe','pipe']});
    record('CHILD_STARTED');
    const completion=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
    child.on('error',()=>abort('SPAWN_ERROR'));
    child.stdin.on('error',()=>abort('INPUT_CLOSED'));
    child.stderr.on('data',b=>{stderr+=b.length;if(stderr>0)abort('UNEXPECTED_STDERR');});
    child.stdout.on('data',chunk=>{
      if(reason)return;
      try {
        total+=chunk.length;requireThat(total<=16384,'OUTPUT_LIMIT');pending=Buffer.concat([pending,chunk]);
        while(pending.length>=4){
          const length=pending.readUInt32BE();requireThat(length>0&&length<=8192,'FRAME_SIZE');
          if(pending.length<length+4)break;
          const raw=pending.subarray(4,length+4);pending=pending.subarray(length+4);
          requireThat(encode(JSON.parse(canonicalizeMAC1JSONV1(raw).canonical)).equals(raw),'NONCANONICAL');
          const value=JSON.parse(raw);
          requireThat(now()-started<timeoutMs,'DEADLINE');
          if(phase===0){
            validateReady(value,requestSHA);record('READY_VALIDATED');
            const readySHA=digest(raw),scope='bridge.'+sha(requestSHA+readySHA);
            const permit=owner.requestPermit(fixtureBytes({kind:'veritas-admitted-run-permit-request-v1',runId,requester:'PRIMARY',generation:1,scope}).toString());
            requireThat(permit.ok,'PERMIT_REFUSED');
            slot=owner.checkExecution(fixtureBytes({kind:'veritas-admitted-run-execution-v1',runId,permitId:permit.permitId,
              requester:'PRIMARY',generation:1,scope,...pins}).toString());
            validateSchedulerAdmission(permit,slot,runId);
            record('SLOT_CLAIMED');
            const go={kind:'GO_V1',requestSHA256:requestSHA,readySHA256:readySHA,runID:runId,
              permitID:permit.permitId,workSHA256:slot.slot.workSha256,windowIndex:String(slot.slot.windowIndex)};
            goSHA=digest(encode(go));phase=1;child.stdin.end(frame(go));record('GO_SENT');
          } else if(phase===1){
            keys(value,['kind','goSHA256','authority']);requireThat(value.kind==='BEGUN_V1'&&value.goSHA256===goSHA&&value.authority===authority,'BEGIN_IDENTITY');
            phase=2;record('NATIVE_BEGUN');
          } else if(phase===2){validateResult(value,requestSHA,goSHA);result=value;phase=3;record('RESULT_VALIDATED');}
          else throw Error('EXTRA_OUTPUT');
        }
      }catch(e){abort(['OUTPUT_LIMIT','FRAME_SIZE','NONCANONICAL','PERMIT_REFUSED','SLOT_REFUSED','BEGIN_IDENTITY','EXTRA_OUTPUT',
        'READY_IDENTITY','READY_RESOURCE','RESULT_IDENTITY','RESULT_DIGEST','FRAME_SCHEMA','DEADLINE'].includes(e.message)?e.message:'OUTPUT_REFUSED');}
    });
    child.stdin.write(frame(request));
    terminal=await completion;record('CHILD_REAPED');
    if(!reason&&(terminal.code!==0||terminal.signal||phase!==3||pending.length))reason='INCOMPLETE_PROCESS';
  } finally {
    clearTimeout(timer);signal?.removeEventListener('abort',onAbort);owner.stop();
  }
  const scheduler=owner.status();
  if(!scheduler.stopped||!scheduler.schedulerStopConfirmed)reason='SCHEDULER_NOT_STOPPED';
  try {
    const check=fs.openSync(binary,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    try {
      const after=fs.fstatSync(check);
      if(!after.isFile()||after.dev!==before.dev||after.ino!==before.ino||after.size!==before.size||
        after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||sha(fs.readFileSync(check))!==binarySHA256)reason='BINARY_CHANGED';
    }finally{fs.closeSync(check);}
  }catch{reason='BINARY_CHANGED';}
  return {status:reason?'REFUSED':'PASS_PRIVATE_SCHEDULED_NATIVE_REFERENCE_ONLY',reason,events,terminal,
    childStarted:true,childReaped:true,requestSHA256:requestSHA,goSHA256:goSHA,slot,scheduler,
    result:reason?null:result,binarySHA256,authorizing:false,productionAdmission:false,afmInference:false,globalGovernor:false};
}
