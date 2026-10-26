// PRIVATE composition of the original arm controller and both evidence stores.
// Caller still supplies trusted, admitted observation/reservation callbacks.
// This is not a CLI, model picker, signal handler, scheduler, or resume API.
import fs from 'node:fs';
import {record} from '../../evaluation/intake-v1.mjs';
import {cloneFreeze} from '../../workflow/contracts.mjs';
import {createPairedTrialRunnerV1} from '../../evaluation/paired-trial-runner-v1.mjs';
import {createRepositoryPairedArmOwnerV1} from './paired-trial-arm-owner-v1.mjs';
import {createPairedTrialEventStoreV1} from '../../history/paired-trial-event-store-v1.mjs';
import {createPairedArmSidecarStoreV1} from '../../history/paired-arm-sidecar-store-v1.mjs';
import {armSidecarDigestV1,projectArmAdmissionV1,projectArmProjectionV1} from '../../history/paired-arm-sidecar-codec-v1.mjs';

const fail=()=>{throw Object.assign(Error('RUNNER_ARM_STORAGE_UNCONFIRMED'),{code:'RUNNER_ARM_STORAGE_UNCONFIRMED'});};
const ioKeys=['openSync','closeSync','writeSync','readSync','fstatSync','fsyncSync'];
const captureIo=io=>Object.fromEntries(ioKeys.map(key=>{
  const fn=Object.getOwnPropertyDescriptor(io,key)?.value;if(typeof fn!=='function')fail();return [key,fn.bind(io)];
}));
export function createDurablePairedArmOwnerV1(input,dependencies={mainIo:fs,sidecarIo:fs}){
  const top=record(input,['plan','profile','approval','now','observe','reserve','parentDirectory']);
  const deps=record(dependencies,['mainIo','sidecarIo']);
  const mainIo=captureIo(deps.mainIo),sidecarIo=captureIo(deps.sidecarIo);
  // Both the controller and history projection consume this one owned snapshot.
  // Never reread the caller-owned object after trusted callbacks have run.
  const approved=cloneFreeze(top.approval);
  let main=null,sidecar=null,head=null,schedule=null,state='READY',failure=null,pending=0,ledger=null;
  let cleanup='NOT_OPENED',report=null;
  const rows=new Map();
  const healthy=()=>{if(failure||!main||!sidecar)fail();};
  const rowState=row=>{
    for(const phase of ['ORACLE','EXECUTOR']){
      if(row?.observed[phase])return phase==='ORACLE'?'COMPLETE':'EXECUTOR_OBSERVED';
      if(row?.starts[phase])return 'STARTED_INCOMPLETE';
      if(row?.prepared[phase])return 'PREPARED_UNCONFIRMED';
    }
    return 'NOT_STARTED';
  };
  async function sideWrite(value){
    await sidecar.retain(value);
    return {record:value,sha256:sidecar.inspect().lastSha256};
  }
  async function guarded(fn){
    pending++;
    try{healthy();return await fn();}catch{failure??='RUNNER_ARM_STORAGE_UNCONFIRMED';fail();}
    finally{pending--;}
  }
  const arm=createRepositoryPairedArmOwnerV1({plan:top.plan,profile:top.profile,approval:approved,
    now:top.now,observe:top.observe,reserve:top.reserve,
    retainAdmission:raw=>guarded(async()=>{
      if(!head)fail();
      // The converter snapshots the original typed producer before field access.
      // Approval is immutable and was validated by the arm-controller constructor.
      const value=projectArmAdmissionV1(raw,head,approved);
      let row=rows.get(value.requestId);
      if(!row){
        if(value.kind!=='PREPARED')fail();
        row={ownerSetId:value.ownerSetId,prepared:{},starts:{},observed:{},history:null};rows.set(value.requestId,row);
      }
      if(value.ownerSetId!==row.ownerSetId)fail();
      const entry=await sideWrite(value);
      if(value.kind==='PREPARED')row.prepared[value.phase]=entry;
      else row.history=entry;
    }),
    retain:event=>guarded(async()=>{
      await main.retain(event);
      head=Object.freeze({sequence:event.sequence,sha256:main.inspect().lastSha256});
      if(event.type==='SCHEDULE'){
        schedule=event;
        await sideWrite({kind:'HEADER',main:head,runnerId:event.runnerId,planSha256:event.plan.planSha256,
          profileSha256:event.profile.profileSha256,intentsSha256:armSidecarDigestV1(event.intents)});
      }else if(event.type==='FINAL'){
        await sideWrite({kind:'FINAL',main:head,failure:arm.inspect().failure,
          rows:schedule.intents.map(intent=>({requestId:intent.requestId,state:rowState(rows.get(intent.requestId))}))});
      }else{
        const row=rows.get(event.requestId);if(!row)fail();
        const common={main:head,requestId:event.requestId,ownerSetId:row.ownerSetId,phase:event.phase};
        if(event.type==='START_INTENT'){
          const prepared=row.prepared[event.phase];if(!prepared)fail();
          row.starts[event.phase]=await sideWrite({kind:'START_LINKED',...common,preparedSha256:prepared.sha256});
        }else{
          const started=row.starts[event.phase];if(!started||!row.history)fail();
          const source=arm.inspect().rows.find(r=>r.requestId===event.requestId);
          const projection=event.phase==='EXECUTOR'?projectArmProjectionV1(source.projection):null;
          row.observed[event.phase]=await sideWrite({kind:'PHASE_OBSERVED',...common,
            startSha256:started.sha256,historySha256:row.history.sha256,projection});
        }
      }
    })});
  const runner=createPairedTrialRunnerV1({plan:top.plan,profile:top.profile,host:arm.host});
  // This version's declared bounded sidecar supports at most 256 scheduled arms.
  // Validate before any directory allocation rather than failing after dispatch.
  if(top.plan.tasks.length*top.plan.repetitions*2>256)fail();
  function inspect(){
    return report??cloneFreeze({schemaVersion:'nisi-durable-paired-arm-owner-v1',state,failure,cleanup,pendingRetentions:pending,
      main:main?.inspect()??null,sidecar:sidecar?.inspect()??null,
      runner:ledger?{stopReason:ledger.stopReason,counts:ledger.counts,retentionStatus:ledger.retentionStatus}:null,
      recorded:false,authorizing:false,resumable:false,actualDispatchCount:null,
      measurementVerified:false,causalClaim:false,promotionEligible:false});
  }
  async function run(...args){
    if(args.length||state!=='READY')fail();state='RUNNING';
    try{
      main=createPairedTrialEventStoreV1({parentDirectory:top.parentDirectory},{io:mainIo});
      sidecar=createPairedArmSidecarStoreV1({directory:main.inspect().directory},{io:sidecarIo});
      ledger=await runner.run();
    }catch{failure??='RUNNER_ARM_STORAGE_UNCONFIRMED';}
    finally{
      cleanup=pending?'DEFERRED_PENDING_RETENTION':'CLOSED';
      if(!pending)for(const store of [sidecar,main])if(store){
        try{if(store.close().state!=='CLOSED')cleanup='UNCONFIRMED';}catch{cleanup='UNCONFIRMED';}
      }
      state='FINISHED';
    }
    const view=inspect();
    report=cloneFreeze({...view,recorded:!failure&&cleanup==='CLOSED'&&view.main?.finalSeen===true&&
      view.sidecar?.finalSeen===true&&ledger?.retentionStatus==='CONFIRMED'});
    return report;
  }
  return Object.freeze({run,inspect,requestStop:(...args)=>{
    if(args.length)fail();return runner.requestStop();
  }});
}
