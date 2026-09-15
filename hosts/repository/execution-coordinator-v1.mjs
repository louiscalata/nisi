// PRIVATE quiescence bridge over existing owners. Not admission or a scheduler.
import {cloneFreeze} from '../../workflow/contracts.mjs';
const STATES=new Set(['IDLE','BUSY','QUARANTINED','OFF']);
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(v);
const descriptors=(v,names)=>{if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))throw Error('SCHEMA');const d=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(d).length!==names.length||names.some(n=>!d[n]?.enumerable||!Object.hasOwn(d[n],'value')))throw Error('SCHEMA');return Object.fromEntries(names.map(n=>[n,d[n].value]));};
const outcome=(status,reason,snapshot)=>cloneFreeze({schemaVersion:'nisi-execution-coordinator/v1',status,reason,snapshot,authorizing:false});
function snapshotOwners(container){
  const len=container.length;
  const result=[];
  for(let i=0;i<len;i++){
    const desc=Object.getOwnPropertyDescriptor(container,i);
    if(!desc||!Object.hasOwn(desc,'value'))throw Error('SCHEMA');
    result.push(desc.value);
  }
  for(const key of Reflect.ownKeys(container))if(typeof key==='symbol')throw Error('SCHEMA');
  return result;
}
export function createExecutionCoordinatorV1(input){
  const top=descriptors(input,['owners','settleTimeoutMs']);
  if(!Array.isArray(top.owners)||Object.getPrototypeOf(top.owners)!==Array.prototype)throw Object.assign(Error('EXECUTION_COORDINATOR_CONFIG'),{code:'EXECUTION_COORDINATOR_CONFIG'});
  const rawOwners=snapshotOwners(top.owners);
  if(rawOwners.length<1||rawOwners.length>16||!Number.isSafeInteger(top.settleTimeoutMs)||top.settleTimeoutMs<1||top.settleTimeoutMs>120000)throw Object.assign(Error('EXECUTION_COORDINATOR_CONFIG'),{code:'EXECUTION_COORDINATOR_CONFIG'});
  const seen=new Set(),handles=[],owners=[];
  for(const raw of rawOwners){
    const r=descriptors(raw,['id','status','settled','cancel']);
    if(!id(r.id)||seen.has(r.id)||typeof r.status!=='function'||typeof r.settled!=='function'||typeof r.cancel!=='function')throw Error('OWNER');
    seen.add(r.id);
    handles.push({status:r.status,settled:r.settled,cancel:r.cancel});
    owners.push({id:r.id,cancelRequested:false,settlement:'NOT_REQUESTED',ownerStatus:null,error:null});
  }
  let state='ON',busy=false,revision=0;
  const snapshot=()=>cloneFreeze({schemaVersion:'nisi-execution-coordinator/v1',state,revision,owners:owners.map(o=>({id:o.id,status:o.ownerStatus,settlement:o.settlement,cancelRequested:o.cancelRequested,error:o.error})),capacityReusable:state==='OFF',authorizing:false});
  function sample(o,h){try{const value=Reflect.apply(h.status,undefined,[]);if(!STATES.has(value))throw Error('STATUS');o.ownerStatus=value;return value;}catch{o.ownerStatus=null;o.error??='STATUS_UNCONFIRMED';return null;}}
  for(let i=0;i<owners.length;i++)sample(owners[i],handles[i]);
  async function settle(o,h){o.settlement='PENDING';let timer;const timeout=new Promise(resolve=>{timer=setTimeout(()=>resolve({kind:'TIMEOUT'}),top.settleTimeoutMs);});let result;try{result=await Promise.race([Promise.resolve().then(()=>Reflect.apply(h.settled,undefined,[])).then(()=>({kind:'SETTLED'}),()=>({kind:'ERROR'})),timeout]);}finally{clearTimeout(timer);}if(result.kind==='SETTLED'){o.settlement='SETTLED';/* a fresh settlement clears a SETTLEMENT-derived error so recheck() can recover; a CANCEL_ERROR is never cleared here (only a new cancel could) */if(o.error==='SETTLEMENT_TIMEOUT'||o.error==='SETTLEMENT_ERROR')o.error=null;}else{o.settlement=result.kind;if(o.error!=='CANCEL_ERROR')o.error=result.kind==='TIMEOUT'?'SETTLEMENT_TIMEOUT':'SETTLEMENT_ERROR';}sample(o,h);}
  async function operate(cancel){if(busy)return outcome('REFUSED','COORDINATOR_BUSY',snapshot());busy=true;state='STOPPING';revision++;try{if(cancel)for(const o of owners)o.error=null;const cancelPs=[];if(cancel){for(let i=0;i<owners.length;i++){const o=owners[i],h=handles[i];if(!o.cancelRequested){o.cancelRequested=true;cancelPs.push(Promise.resolve().then(()=>Reflect.apply(h.cancel,undefined,[])).catch(()=>{o.error='CANCEL_ERROR';}));}}}if(cancelPs.length){let timer;const timeout=new Promise(resolve=>{timer=setTimeout(()=>resolve({kind:'TIMEOUT'}),top.settleTimeoutMs);});try{await Promise.race([Promise.all(cancelPs),timeout]);}finally{clearTimeout(timer);}}await Promise.all(owners.map((o,i)=>settle(o,handles[i])));const confirmed=owners.every(o=>o.settlement==='SETTLED'&&(o.ownerStatus==='IDLE'||o.ownerStatus==='OFF')&&!o.error);state=confirmed?'OFF':'UNCONFIRMED';revision++;return outcome(confirmed?'OFF':'UNCONFIRMED',confirmed?null:'DRAIN_UNCONFIRMED',snapshot());}finally{busy=false;}}
  const facade={inspect:()=>outcome('SNAPSHOT',null,snapshot()),requestOff:()=>operate(true),recheck:()=>operate(false)};
  return Object.freeze(facade);
}
