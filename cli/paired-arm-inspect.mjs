// PRIVATE read-only observation of both ledgers. No raw records or row identities.
import {isAbsolute} from 'node:path';
import {types} from 'node:util';
import {cloneFreeze} from '../workflow/contracts.mjs';
import {inspectPairedArmTrialV1} from '../history/paired-arm-reconciliation-v1.mjs';

const states=['NOT_STARTED','PREPARED_UNCONFIRMED','STARTED_INCOMPLETE','EXECUTOR_OBSERVED','COMPLETE'];
const reasons=new Set(['NO_MAIN_SCHEDULE','UNAVAILABLE_OR_CORRUPT_BYTES','MAIN_SEMANTICS_REFUSED',
  'CROSS_LEDGER_BINDING_OR_ORDER','NO_SIDECAR_HEADER','MISSING_SIDECAR_LINKS','UNFINISHED_OR_PARTIAL_PREFIX',
  'INSPECTION_UNAVAILABLE']);
const byteStates=new Set(['EMPTY','UNAVAILABLE','INCOMPLETE','PARTIAL_TAIL','CORRUPT','FINAL_PRESENT']);
const value=(x,key)=>{
  if(!x||typeof x!=='object'||types.isProxy(x))throw Error('INVALID_PROJECTION');
  const d=Object.getOwnPropertyDescriptor(x,key);
  if(!d||!Object.hasOwn(d,'value'))throw Error('INVALID_PROJECTION');return d.value;
};
function array(x,max){
  if(types.isProxy(x)||!Array.isArray(x)||Object.getPrototypeOf(x)!==Array.prototype)throw Error('INVALID_PROJECTION');
  const n=value(x,'length');if(!Number.isSafeInteger(n)||n<0||n>max||Reflect.ownKeys(x).length!==n+1)throw Error('INVALID_PROJECTION');
  return Array.from({length:n},(_,i)=>value(x,String(i)));
}
// Closed pure projection boundary: future/invalid states cannot silently vanish
// from aggregate counts while retaining an OBSERVED result.
export function projectArmTrialInspectionV1(result){
  let status='REFUSED',exitCode=2,mainByteStatus='NOT_OBSERVED',sidecarByteStatus='NOT_OBSERVED';
  let reason='INSPECTION_UNAVAILABLE',counts=null,missingLinks=null;
  try{
    if(value(result,'schemaVersion')!=='nisi-paired-arm-reconciliation-v1')throw Error('INVALID_PROJECTION');
    const kernelStatus=value(result,'status'),why=value(result,'reason');
    if(!['FINAL_CROSSLINKED','INCOMPLETE','REFUSED'].includes(kernelStatus)||!(why===null||reasons.has(why)))throw Error('INVALID_PROJECTION');
    const rows=array(value(result,'rows'),256),missing=array(value(result,'missing'),4096);
    const projected=Object.fromEntries(states.map(state=>[state,0]));
    for(const row of rows){const state=value(row,'state');if(!states.includes(state))throw Error('INVALID_PROJECTION');projected[state]++;}
    for(const entry of missing)if(!['START_LINKED','PHASE_OBSERVED'].includes(value(entry,'missing')))throw Error('INVALID_PROJECTION');
    const main=Object.getOwnPropertyDescriptor(result,'mainByteStatus'),side=Object.getOwnPropertyDescriptor(result,'sidecarByteStatus');
    const mainState=main?value(result,'mainByteStatus'):'NOT_OBSERVED',sideState=side?value(result,'sidecarByteStatus'):'NOT_OBSERVED';
    if(![...byteStates,'NOT_OBSERVED'].includes(mainState)||![...byteStates,'NOT_OBSERVED'].includes(sideState))throw Error('INVALID_PROJECTION');
    if(kernelStatus==='FINAL_CROSSLINKED'&&(mainState!=='FINAL_PRESENT'||sideState!=='FINAL_PRESENT'||why!==null||missing.length))throw Error('INVALID_PROJECTION');
    [status,exitCode]=kernelStatus==='FINAL_CROSSLINKED'?['OBSERVED',0]:kernelStatus==='INCOMPLETE'?['INCOMPLETE',1]:['REFUSED',2];
    mainByteStatus=mainState;sidecarByteStatus=sideState;reason=why;counts=projected;missingLinks=missing.length;
  }catch{/* Keep only a bounded refusal. Never invoke a getter or echo input. */}
  return cloneFreeze({schemaVersion:'nisi-cli-paired-arm-inspection-v1',status,exitCode,
    mainByteStatus,sidecarByteStatus,reason,counts,missingLinks,actualDispatchCount:null,
    sourceTrust:'UNAUTHENTICATED_LOCAL_BYTES',pastAcknowledgement:'UNKNOWN',remoteExecutionStopped:'UNKNOWN',
    candidateBytesRevalidated:false,measurementVerified:false,causalClaim:false,
    authorizing:false,resumable:false,promotionEligible:false});
}
export function inspectArmTrialDirectoryV1(directory){
  if(typeof directory!=='string'||!directory||directory.length>4096||directory.includes('\0')||!isAbsolute(directory))
    throw Object.assign(Error('NISI_CLI_ARGUMENTS'),{code:'NISI_CLI_ARGUMENTS'});
  return projectArmTrialInspectionV1(inspectPairedArmTrialV1({directory}));
}
