// Private composition of the REAL declaration owner and queue/slot scheduler.
// One facade, one generation, one primary admission, shared courier allowance.
// No model runner, native bridge, production intent or execution permission.
import {createAdmittedRunOwner} from './admitted-run-owner.mjs';
import {createSharedWorkSlotScheduler} from './shared-work-slot-scheduler.mjs';
import {BN01_LIMITS} from './bn01.mjs';
import {DUAL_FACE_LIMITS,validateDualFaceBytes} from './dual-face.mjs';

const FLAGS=Object.freeze({authorizing:false,modelExecuted:false,promotionGranted:false,certificationGranted:false});
const answer=(ok,code,fields={})=>Object.freeze({ok,code,...fields,...FLAGS});
const fail=code=>answer(false,code);
const int=(v,min,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const equal=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);
const nonterminalCourierRefusals=Object.freeze(['PACKET_BYTES_REFUSED','UTF8_INVALID','JSON_INVALID','PACKET_SCHEMA_INVALID',
  'NONCANONICAL_PACKET','GENERATION_MISMATCH','IDENTITY_MISMATCH','ROUTE_REFUSED','ENDPOINT_MISMATCH','TENSOR_MISMATCH',
  'NONFINITE_PAYLOAD','TASK_CONFLICT','PAYLOAD_LIMIT','HOP_LIMIT','TTL_LIMIT','DEADLINE_OVERFLOW','FUTURE_PACKET','EXPIRED',
  'TASK_HISTORY_FULL','CHANNEL_FULL','CAPACITY_FULL','COURIER_BUDGET_EXHAUSTED','WINDOW_FULL','EMPTY','TASK_ID_INVALID','TASK_UNKNOWN']);
function capture(value,names){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('SHAPE');
  const d=Object.getOwnPropertyDescriptors(value);
  if(!equal(Reflect.ownKeys(d).sort(),[...names].sort()))throw Error('SHAPE');
  const result=Object.create(null);
  for(const name of names){if(!Object.hasOwn(d[name],'value'))throw Error('ACCESSOR');result[name]=d[name].value;}
  return result;
}
function response(value,code,fields=[]){
  const r=capture(value,['ok','code',...Object.keys(FLAGS),...fields]);
  if(r.code!==code||r.ok!==true||Object.keys(FLAGS).some(k=>r[k]!==false))throw Error('SCHEDULER_RESPONSE');
  return r;
}
function refusal(value){
  const r=capture(value,['ok','code',...Object.keys(FLAGS)]);
  if(r.ok!==false||typeof r.code!=='string'||Object.keys(FLAGS).some(k=>r[k]!==false))throw Error('SCHEDULER_RESPONSE');
  return r.code;
}
function bytes(value,max){
  if(!Buffer.isBuffer(value)||value.length===0||value.length>max||value.buffer instanceof SharedArrayBuffer)throw Error('BYTES');
  return Buffer.from(value);
}

class ScheduledRunOwner {
  #owner;#scheduler;#clock;#cap;#deadline;#busy=false;#stopped=false;#stopConfirmed=false;
  #permit=null;#expires=null;#charged=0;#lastPrimary=null;
  constructor(owner,scheduler,clock,cap,deadline){
    this.#owner=owner;this.#scheduler=scheduler;this.#clock=clock;this.#cap=cap;this.#deadline=deadline;
  }
  #close(){this.#stopped=true;this.#owner.revoke();}
  #drain(){
    if(!this.#stopped||this.#stopConfirmed)return;
    try{
      const stopped=this.#scheduler.stop();
      try{response(stopped,'STOPPED');}catch{if(refusal(stopped)!=='OFF')return;}
      const s=this.#scheduler.inspect();
      this.#stopConfirmed=s.ok===true&&s.code==='SNAPSHOT'&&s.state==='OFF'&&s.queueStopConfirmed===true;
    }catch{this.#stopConfirmed=false;}
  }
  #operate(action){
    if(this.#busy)return fail('BUSY');
    if(this.#stopped)return fail('OWNER_STOPPED');
    this.#busy=true;
    try{return action();}
    catch{this.#close();return fail('COMPOSITION_REFUSED');}
    finally{
      const state=this.#owner.status();
      if(state.revoked||state.expired)this.#close();
      this.#busy=false;this.#drain();
    }
  }
  #current(){
    if(this.#stopped)return false;
    if(this.#owner.status().revoked){this.#close();return false;}
    const now=this.#clock();
    if(this.#stopped)return false; // Host clock callbacks may synchronously revoke.
    if(!this.#permit||this.#expires===null)return false;
    if(now>=this.#expires){this.#close();return false;}
    return true;
  }
  #slotRoom(){return this.#charged<this.#cap;}
  #courierRefusal(raw){
    const code=refusal(raw);
    // Expected packet/capacity refusal leaves a valid owner usable. OFF, clock,
    // queue faults, unknown results and impossible BUSY state close the facade.
    if(!nonterminalCourierRefusals.includes(code))this.#close();
    return fail(code);
  }
  requestPermit(text){return this.#operate(()=>{
    const p=this.#owner.requestPermit(text);
    if(this.#stopped)return fail('OWNER_STOPPED');
    if(!p.ok)return p;
    // The owner sampled the same monotonic clock immediately before issuing.
    // Use its last successful sample, not another callback that could mutate time.
    this.#permit=Object.freeze({runId:p.runId,permitId:p.permitId});
    this.#expires=this.#clock.last()+this.#deadline;
    if(!int(this.#expires,1)){this.#close();return fail('DEADLINE_REFUSED');}
    return p;
  });}
  checkExecution(text){return this.#operate(()=>{
    const inspected=this.#owner.inspectExecution(text);
    if(this.#stopped)return fail('OWNER_STOPPED');
    if(!inspected.ok)return inspected;
    if(!this.#current())return fail('OWNER_NOT_CURRENT');
    if(!this.#slotRoom())return fail('RUN_SLOT_CAP');
    const admitted=this.#scheduler.admitPrimary(inspected.runId,inspected.workSha256);
    let a;
    try{a=response(admitted,'PRIMARY_ADMITTED',['ticket','windowIndex']);}
    catch{
      let code;try{code=refusal(admitted);}catch{this.#close();return fail('SLOT_ADMISSION_REFUSED');}
      if(!['COURIER_RESERVED','WINDOW_FULL','PRIMARY_HISTORY_FULL'].includes(code))this.#close();
      return fail('SLOT_'+code);
    }
    if(!a.ticket||typeof a.ticket!=='object'||!int(a.windowIndex,0))throw Error('SLOT_IDENTITY');
    this.#charged++;
    this.#lastPrimary=Object.freeze({workId:inspected.runId,workSha256:inspected.workSha256,
      windowIndex:a.windowIndex,slotCharged:true,slotClaimed:false,ownerAdmitted:false});
    if(!this.#current())return fail('OWNER_NOT_CURRENT');
    let claimed;
    try{claimed=response(this.#scheduler.claim(a.ticket),'PRIMARY_CLAIMED',['workId','workSha256']);}
    catch{this.#close();return fail('SLOT_CLAIM_REFUSED');}
    if(claimed.workId!==inspected.runId||claimed.workSha256!==inspected.workSha256){this.#close();return fail('SLOT_IDENTITY_REFUSED');}
    this.#lastPrimary=Object.freeze({...this.#lastPrimary,slotClaimed:true});
    if(!this.#current())return fail('OWNER_NOT_CURRENT');
    // The original owner rechecks time, identity, revocation and one-use state.
    // Only this call commits its admission, after the actual scheduler claim.
    const committed=this.#owner.checkExecution(text);
    if(this.#stopped||!committed.ok){this.#close();return fail('OWNER_FINAL_CHECK_REFUSED');}
    this.#lastPrimary=Object.freeze({...this.#lastPrimary,ownerAdmitted:true});
    return answer(true,'SLOT_BOUND_ADMITTED',{runId:committed.runId,permitId:committed.permitId,
      executionsUsed:committed.executionsUsed,slot:this.#lastPrimary});
  });}
  enqueueCourier(packet){return this.#operate(()=>{
    if(!this.#current())return fail('OWNER_NOT_CURRENT');
    const r=this.#scheduler.enqueueCourier(packet);
    if(!this.#current())return fail('OWNER_NOT_CURRENT');
    // The real scheduler/queue own and validate all packet bytes; no second copy
    // is retained here, and malformed packets never gain a slot.
    if(r.ok===true){
      const code=r.code;
      const v=response(r,code,['taskId','taskState']);
      if(!['QUEUED','DUPLICATE'].includes(code))throw Error('COURIER_RESPONSE');
      return answer(true,code,{taskId:v.taskId,taskState:v.taskState});
    }
    return this.#courierRefusal(r);
  });}
  claimCourier(){return this.#operate(()=>{
    if(!this.#current())return fail('OWNER_NOT_CURRENT');
    if(!this.#slotRoom())return fail('RUN_SLOT_CAP');
    const raw=this.#scheduler.takeCourier();
    if(raw.ok===false)return this.#courierRefusal(raw);
    const taken=response(raw,'COURIER_ADMITTED',['ticket','windowIndex']);
    if(!taken.ticket||typeof taken.ticket!=='object'||!int(taken.windowIndex,0))throw Error('COURIER_RESPONSE');
    this.#charged++;
    if(!this.#current())return fail('OWNER_NOT_CURRENT');
    const delivered=response(this.#scheduler.claim(taken.ticket),'COURIER_CLAIMED',['taskId','packet','payload']);
    if(!this.#current())return fail('OWNER_NOT_CURRENT');
    if(!Buffer.isBuffer(delivered.payload)||delivered.payload.buffer instanceof SharedArrayBuffer)throw Error('COURIER_RESPONSE');
    return answer(true,'COURIER_CLAIMED',{taskId:delivered.taskId,packet:delivered.packet,payload:Buffer.from(delivered.payload)});
  });}
  cancelCourier(taskId){return this.#operate(()=>{
    if(!this.#current())return fail('OWNER_NOT_CURRENT');
    const r=this.#scheduler.cancelCourier(taskId);
    if(!this.#current())return fail('OWNER_NOT_CURRENT');
    if(r.ok===false)return this.#courierRefusal(r);
    const v=response(r,r.code,['taskId','taskState']);
    if(!['CANCELLED','ALREADY_TERMINAL'].includes(v.code))throw Error('COURIER_RESPONSE');
    return answer(true,v.code,{taskId:v.taskId,taskState:v.taskState});
  });}
  revoke(permitId=null){
    const r=this.#owner.revoke(permitId);
    if(!r.ok)return r; // A wrong explicit target must not stop an honest owner.
    this.#stopped=true;if(!this.#busy)this.#drain();
    return answer(true,'OWNER_STOP_REQUESTED',{schedulerStopConfirmed:this.#stopConfirmed});
  }
  stop(){return this.revoke();}
  ledger(){return this.#owner.ledger();}
  status(){
    if(this.#busy)return fail('BUSY');
    this.#busy=true;
    let snapshot=null;
    try{
      snapshot=this.#scheduler.inspect();
      if(snapshot.ok!==true||snapshot.code!=='SNAPSHOT'||snapshot.state!=='ACTIVE')this.#close();
      if(this.#owner.status().revoked)this.#close();
      if(this.#permit&&!this.#stopped)this.#current();
    }catch{this.#close();}
    finally{this.#busy=false;this.#drain();}
    // Never expose a pre-stop ACTIVE observation as current after a callback.
    if(this.#stopped)try{snapshot=this.#scheduler.inspect();}catch{snapshot=null;}
    return answer(true,'SCHEDULED_OWNER_STATUS',{owner:this.#owner.status(),scheduler:snapshot,
      stopped:this.#stopped,schedulerStopConfirmed:this.#stopConfirmed,chargedLifetimeSlots:this.#charged,
      runSlotCap:this.#cap,lastPrimary:this.#lastPrimary});
  }
}

export function createScheduledRunOwner(bindBytes,baseBytes,dualBytes,options){
  let scheduler=null;
  try{
    const bindCopy=bytes(bindBytes,65536),baseCopy=bytes(baseBytes,BN01_LIMITS.bytes),dualCopy=bytes(dualBytes,DUAL_FACE_LIMITS.bytes);
    // Closed, data-only options. No injected scheduler/owner, accessor or route.
    const config=capture(options,['clock','windowSlots','windowDurationMs','maxCourierIds']);
    if(typeof config.clock!=='function'||!int(config.windowSlots,1,1000)||!int(config.windowDurationMs,1,60000)||!int(config.maxCourierIds,1,4096))return fail('CONFIGURATION_REFUSED');
    let last=null;
    const clock=()=>{const now=config.clock();if(!int(now,0)||(last!==null&&now<last))throw Error('CLOCK_REFUSED');last=now;return now;};
    clock.last=()=>last;
    const made=createAdmittedRunOwner(bindCopy,{clock});
    if(!made.ok)return fail('OWNER_DECLARATION_REFUSED');
    if(!validateDualFaceBytes(baseCopy,dualCopy).ok)return fail('GRAPH_DECLARATION_REFUSED');
    const bind=JSON.parse(bindCopy.toString('utf8')),base=JSON.parse(baseCopy.toString('utf8')),dual=JSON.parse(dualCopy.toString('utf8'));
    const pins={graphSha256:base.graph.sha256,runSha256:base.run.sha256,topologySha256:dual.topology.sha256,planSha256:dual.plan.sha256};
    if(Object.keys(pins).some(k=>bind[k]!==pins[k]))return fail('OWNER_GRAPH_PIN_MISMATCH');
    if(config.windowSlots>bind.runBudgetCap)return fail('SLOT_CAP_CONFIGURATION_REFUSED');
    const s=createSharedWorkSlotScheduler(baseCopy,dualCopy,{generation:bind.generation,windowSlots:config.windowSlots,
      windowDurationMs:config.windowDurationMs,maxPrimaryIds:1,maxCourierIds:config.maxCourierIds,clock});
    if(!s.ok)return fail('SCHEDULER_CONSTRUCTION_REFUSED');scheduler=s.scheduler;
    const composite=new ScheduledRunOwner(made.owner,scheduler,clock,bind.runBudgetCap,bind.deadlineMs);
    const facade=Object.create(null);
    for(const name of ['requestPermit','checkExecution','enqueueCourier','claimCourier','cancelCourier','revoke','stop','ledger','status'])
      facade[name]=composite[name].bind(composite);
    return answer(true,'READY_PRIVATE_SCHEDULED_OWNER_ONLY',{owner:Object.freeze(facade)});
  }catch{if(scheduler)try{scheduler.stop();}catch{}return fail('CONSTRUCTION_REFUSED');}
}
