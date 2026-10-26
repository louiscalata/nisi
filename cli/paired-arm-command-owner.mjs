// PRIVATE in-process operator lifecycle. A trusted host must supply the original
// approval, observations and issued execution owners. This is not a shell run
// command, provider bootstrap, authorization shortcut, scheduler or resume API.
import fs from 'node:fs';
import {record} from '../evaluation/intake-v1.mjs';
import {cloneFreeze} from '../workflow/contracts.mjs';
import {createDurablePairedArmOwnerV1} from '../hosts/repository/durable-paired-arm-owner-v1.mjs';
import {inspectArmTrialDirectoryV1} from './paired-arm-inspect.mjs';

const fail=code=>{throw Object.assign(Error(code),{code});};
export function createPairedArmCommandOwnerV1(input,dependencies={signalSource:process,mainIo:fs,sidecarIo:fs,inspectDirectory:inspectArmTrialDirectoryV1}){
  // Injected inspection, like signal and IO methods, is a trusted test/host seam.
  const deps=record(dependencies,['signalSource','mainIo','sidecarIo','inspectDirectory']);
  const inspectDirectory=deps.inspectDirectory;if(typeof inspectDirectory!=='function')fail('ARM_COMMAND_INSPECTOR');
  const methods=Object.fromEntries(['on','removeListener','rawListeners'].map(name=>{
    const fn=deps.signalSource?.[name];
    if(typeof fn!=='function')fail('ARM_COMMAND_SIGNALS');
    return [name,fn.bind(deps.signalSource)];
  }));
  // The original constructor validates/captures inputs without callbacks, IO or
  // allocation. Reject invalid input before adding process signal listeners.
  const owner=createDurablePairedArmOwnerV1(input,{mainIo:deps.mainIo,sidecarIo:deps.sidecarIo});
  let state='READY',reason=null,firstSignal=null,setupStop=false,runIssued=false;
  let signalFailure=false,signalCleanup='NOT_INSTALLED',lastStopRequest=null;
  let retained=null,inspection=null,finalReport=null;
  function requestStop(...args){
    if(args.length)fail('ARM_COMMAND_ARGUMENTS');
    if(state!=='RUNNING')return Object.freeze({status:'REFUSED',reason:'ARM_COMMAND_NOT_STOPPABLE',authorizing:false});
    if(!runIssued){
      const status=setupStop?'ALREADY_REQUESTED':'REQUESTED';setupStop=true;
      lastStopRequest={phase:'SETUP',status};return Object.freeze({status,authorizing:false});
    }
    const response=owner.requestStop();
    lastStopRequest={phase:'RUNNER',status:response.status};return response;
  }
  const listeners=['SIGINT','SIGTERM'].map(signal=>[signal,()=>{
    if(state!=='RUNNING')return;
    firstSignal??=signal;
    try{requestStop();}catch{signalFailure=true;}
  }]);
  function inspect(...args){
    if(args.length)fail('ARM_COMMAND_ARGUMENTS');
    return finalReport??cloneFreeze({schemaVersion:'nisi-paired-arm-command-owner-v1',
      state,reason,firstSignal,setupStop,lastStopRequest,signalFailure,
      cleanup:{signals:signalCleanup,storage:retained?.cleanup??'NOT_OBSERVED'},
      retentionAcknowledged:retained?.recorded===true,inspectionObserved:inspection?.status==='OBSERVED',inspection,
      storageFailure:retained?.failure==='RUNNER_ARM_STORAGE_UNCONFIRMED'?'RUNNER_ARM_STORAGE_UNCONFIRMED':null,
      recorded:false,actualDispatchCount:null,authorizing:false,resumable:false,
      measurementVerified:false,causalClaim:false,promotionEligible:false,
      remoteExecutionStopped:'UNKNOWN'});
  }
  async function run(...args){
    if(args.length)fail('ARM_COMMAND_ARGUMENTS');
    if(state!=='READY')fail('ARM_COMMAND_ALREADY_RAN');
    state='RUNNING';let stage='SIGNALS';
    try{
      for(const [signal,listener] of listeners){
        methods.on(signal,listener);
        if(!methods.rawListeners(signal).includes(listener))fail('ARM_COMMAND_SIGNAL_INSTALL');
      }
      stage='RUN';
      // Store creation and initial retention can synchronously emit a signal
      // through trusted IO seams before the runner is stoppable. Latch it until
      // run() has returned its original promise; never discard a pre-run stop.
      const running=owner.run();runIssued=true;
      if(setupStop)requestStop();
      retained=await running;
      stage='INSPECTION';
      if(retained.main?.directory)inspection=inspectDirectory(retained.main.directory);
    }catch{
      reason=stage==='SIGNALS'?'ARM_COMMAND_SIGNAL_INSTALL':stage==='RUN'?
        'ARM_COMMAND_RUN_UNCONFIRMED':'ARM_COMMAND_INSPECTION_UNAVAILABLE';
    }finally{
      // Original run awaits the original runner and both store-close attempts.
      // Do not race it, reopen storage, write another FINAL or forward signals.
      signalCleanup='REMOVED';
      for(const [signal,listener] of listeners){
        try{
          methods.removeListener(signal,listener);
          if(methods.rawListeners(signal).includes(listener))signalCleanup='UNCONFIRMED';
        }catch{signalCleanup='UNCONFIRMED';}
      }
      state='FINISHED';
    }
    // Retention acknowledgement is independent of later byte inspection. An
    // observed final can never repair a failed or unconfirmed acknowledgement.
    const view=inspect();
    finalReport=cloneFreeze({...view,recorded:retained?.recorded===true&&!signalFailure&&
      signalCleanup==='REMOVED'&&reason===null&&view.inspectionObserved});
    return finalReport;
  }
  return Object.freeze({run,inspect,requestStop});
}
