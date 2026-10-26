import test from 'node:test';
import assert from 'node:assert/strict';
import {createScheduledRunOwner} from '../neural/scheduled-run-owner.mjs';
import {createAdmittedRunOwner} from '../neural/admitted-run-owner.mjs';
import {createSharedWorkSlotScheduler} from '../neural/shared-work-slot-scheduler.mjs';
import {fixtureBytes} from '../neural/bn01-fixture.mjs';
import {canonicalFixtureBytes} from '../neural/dual-face-fixture.mjs';
import {typedContext} from './fixtures/typed-context.mjs';
const context=typedContext();
const defaults={windowSlots:10,windowDurationMs:100,maxCourierIds:64};
const bind=over=>fixtureBytes({kind:'veritas-admitted-run-bind-v1',profile:'veritas-bn01-offline-contract-v1',
  schemaVersion:1,generation:1,runBudgetCap:10,deadlineMs:1000,...context.pins,...over});
const request=over=>fixtureBytes({kind:'veritas-admitted-run-permit-request-v1',runId:'run-one',requester:'PRIMARY',generation:1,scope:'local-diagnostic',...over}).toString();
const execution=(permitId,over)=>fixtureBytes({kind:'veritas-admitted-run-execution-v1',permitId,
  runId:'run-one',requester:'PRIMARY',generation:1,scope:'local-diagnostic',...context.pins,...over}).toString();
const packet=(id,over={})=>canonicalFixtureBytes({kind:'veritas-courier-f32-v1',taskId:id,traveler:'ELECTRON',...context.pins,
  generation:1,channelId:'channel.0.forward',fromPortId:'n0.a',toPortId:'n1.b',createdAtMs:0,ttlMs:1000,hopCount:1,
  spaceSha256:context.base.plugins[0].record.output.spaceSha256,payloadHex:'0000803f000000400000404000008040',...over});
function rig(options={},binding={}){
  const time={now:0,reads:0,hook:null};const clock=()=>{time.reads++;time.hook?.();return time.now;};
  const made=createScheduledRunOwner(bind(binding),context.baseBytes,context.dualBytes,{...defaults,clock,...options});
  assert.equal(made.code,'READY_PRIVATE_SCHEDULED_OWNER_ONLY');
  return {owner:made.owner,time};
}
const issued=r=>{const p=r.owner.requestPermit(request());assert.equal(p.code,'PERMIT_ISSUED');return p;};
const stopped=r=>{
  const s=r.owner.status();assert.equal(s.stopped,true);assert.equal(s.schedulerStopConfirmed,true);
  assert.equal(s.scheduler.state,'OFF');assert.equal(s.scheduler.pendingTickets,0);
  assert.equal(s.scheduler.courierQueue.inFlight,0);assert.equal(s.scheduler.courierQueue.queued,0);return s;
};
const flags=r=>{for(const k of ['authorizing','modelExecuted','promotionGranted','certificationGranted'])assert.equal(r[k],false);};

test('original owner inspection is non-consuming and reuses exact execution validation',()=>{
  const {owner}=createAdmittedRunOwner(bind(),{clock:()=>0});const p=owner.requestPermit(request());
  for(let i=0;i<100;i++)assert.equal(owner.inspectExecution(execution(p.permitId)).code,'EXECUTION_DECLARATION_CURRENT');
  assert.equal(owner.status().executionsUsed,0);assert.equal(owner.ledger().count,1);
  assert.equal(owner.inspectExecution(execution(p.permitId,{scope:'wrong'})).code,'EXECUTION_IDENTITY_MISMATCH');
  assert.equal(owner.checkExecution(execution(p.permitId)).code,'ADMITTED');
  assert.equal(owner.inspectExecution(execution(p.permitId)).code,'LATE_OUTPUT_REFUSED');
});

test('real primary reservation and claim happen before exactly one owner admission',()=>{
  const r=rig(),p=issued(r),out=r.owner.checkExecution(execution(p.permitId));
  assert.equal(out.code,'SLOT_BOUND_ADMITTED');assert.equal(out.executionsUsed,1);flags(out);
  assert.equal(out.slot.workId,'run-one');assert.equal(out.slot.workSha256,p.digest);
  assert.equal(out.slot.slotCharged,true);assert.equal(out.slot.slotClaimed,true);assert.equal(out.slot.ownerAdmitted,true);
  const s=r.owner.status();assert.equal(s.scheduler.totalAdmitted,1);assert.equal(s.scheduler.primaryAdmitted,1);
  assert.equal(s.scheduler.pendingTickets,0);assert.equal(s.chargedLifetimeSlots,1);
  for(let i=0;i<100;i++)assert.equal(r.owner.checkExecution(execution(p.permitId)).code,'LATE_OUTPUT_REFUSED');
  assert.equal(r.owner.status().chargedLifetimeSlots,1);assert.equal(r.owner.ledger().count,2);
  assert.equal(r.owner.requestPermit(request()).code,'RUN_ALREADY_ADMITTED');
});

test('actual courier claims and the primary use one shared window and allowance',()=>{
  const r=rig(),p=issued(r);
  for(const traveler of ['PROTON','ELECTRON','NEUTRON'])assert.equal(r.owner.enqueueCourier(packet('task.'+traveler.toLowerCase(),{traveler})).code,'QUEUED');
  const courier=r.owner.claimCourier();assert.equal(courier.code,'COURIER_CLAIMED');assert.equal(courier.taskId,'task.proton');
  assert.equal(courier.payload.toString('hex'),'0000803f000000400000404000008040');flags(courier);
  assert.equal(r.owner.claimCourier().code,'COURIER_BUDGET_EXHAUSTED');
  assert.equal(r.owner.checkExecution(execution(p.permitId)).code,'SLOT_BOUND_ADMITTED');
  const s=r.owner.status();assert.equal(s.scheduler.primaryAdmitted,1);assert.equal(s.scheduler.courierAdmitted,1);
  assert.equal(s.scheduler.totalAdmitted,2);assert.equal(s.chargedLifetimeSlots,2);assert.equal(s.scheduler.courierQuota,1);
  assert.equal(Object.hasOwn(courier,'ticket'),false);assert.equal(Object.hasOwn(courier,'scheduler'),false);
  r.owner.stop();stopped(r);
});

test('no courier ingress or delivery without the owner permit',()=>{
  const r=rig();assert.equal(r.owner.enqueueCourier(packet('task.a')).code,'OWNER_NOT_CURRENT');
  assert.equal(r.owner.claimCourier().code,'OWNER_NOT_CURRENT');
  const s=r.owner.status();assert.equal(s.chargedLifetimeSlots,0);assert.equal(s.scheduler.courierQueue.queued,0);
});

test('wrong execution pins and scope never reach a scheduler reservation',()=>{
  for(const [key,value] of [...Object.keys(context.pins).map(k=>[k,'0'.repeat(64)]),['scope','wrong'],['runId','wrong'],['generation',2],['requester','PROTON']]){
    const r=rig(),p=issued(r);assert.equal(r.owner.checkExecution(execution(p.permitId,{[key]:value})).ok,false);
    assert.equal(r.owner.status().scheduler.totalAdmitted,0);assert.equal(r.owner.status().owner.executionsUsed,0);
    assert.equal(r.owner.checkExecution(execution(p.permitId)).code,'SLOT_BOUND_ADMITTED');
  }
});

test('construction binds to validated actual graph bytes, not matching-looking supplied pins',()=>{
  for(const key of Object.keys(context.pins))assert.equal(createScheduledRunOwner(bind({[key]:'0'.repeat(64)}),context.baseBytes,context.dualBytes,
    {...defaults,clock:()=>0}).code,'OWNER_GRAPH_PIN_MISMATCH');
  const broken=Buffer.from(context.dualBytes);broken[20]^=1;
  assert.equal(createScheduledRunOwner(bind(),context.baseBytes,broken,{...defaults,clock:()=>0}).ok,false);
  for(const value of [null,'text',Buffer.alloc(0),Buffer.alloc(65537),Buffer.from(new SharedArrayBuffer(16))])
    assert.equal(createScheduledRunOwner(value,context.baseBytes,context.dualBytes,{...defaults,clock:()=>0}).ok,false);
});

test('closed captured configuration refuses fake objects, accessors and over-budget windows',()=>{
  for(const extra of ['scheduler','owner','model','generation'])assert.equal(createScheduledRunOwner(bind(),context.baseBytes,context.dualBytes,
    {...defaults,clock:()=>0,[extra]:{}}).ok,false);
  let called=false;const config={...defaults,get clock(){called=true;return ()=>0;}};
  assert.equal(createScheduledRunOwner(bind(),context.baseBytes,context.dualBytes,config).ok,false);assert.equal(called,false);
  assert.equal(createScheduledRunOwner(bind({runBudgetCap:9}),context.baseBytes,context.dualBytes,{...defaults,clock:()=>0}).code,'SLOT_CAP_CONFIGURATION_REFUSED');
  for(const [key,bad] of [['windowSlots',0],['windowSlots',1001],['windowDurationMs',0],['maxCourierIds',4097],['clock',null]])
    assert.equal(createScheduledRunOwner(bind(),context.baseBytes,context.dualBytes,{...defaults,clock:()=>0,[key]:bad}).ok,false);
});

test('mutable caller declarations cannot change the owned identity or slot capacity',()=>{
  const b=bind(),base=Buffer.from(context.baseBytes),dual=Buffer.from(context.dualBytes),config={...defaults,clock:()=>0};
  const made=createScheduledRunOwner(b,base,dual,config);assert.equal(made.ok,true);
  b.fill(0);base.fill(0);dual.fill(0);config.windowSlots=1000;config.clock=()=>{throw Error('mutated');};
  const p=made.owner.requestPermit(request());assert.equal(made.owner.checkExecution(execution(p.permitId)).code,'SLOT_BOUND_ADMITTED');
  assert.equal(made.owner.status().scheduler.windowSlots,10);
});

for(let phase=1;phase<=7;phase++)test(`revocation at primary clock phase ${phase} cannot produce admission`,()=>{
  const r=rig(),p=issued(r);let calls=0;r.time.hook=()=>{if(++calls===phase)r.owner.revoke();};
  const out=r.owner.checkExecution(execution(p.permitId));r.time.hook=null;
  assert.equal(out.ok,false);const s=stopped(r);assert.equal(s.owner.executionsUsed,0);
  assert.equal(s.chargedLifetimeSlots,phase<3?0:1);
  if(s.lastPrimary){assert.equal(s.lastPrimary.ownerAdmitted,false);assert.equal(s.lastPrimary.slotCharged,true);}
});

for(let phase=1;phase<=7;phase++)test(`expiry at primary clock phase ${phase} cannot produce admission`,()=>{
  const r=rig(),p=issued(r);let calls=0;r.time.hook=()=>{if(++calls===phase)r.time.now=1000;};
  const out=r.owner.checkExecution(execution(p.permitId));r.time.hook=null;
  assert.equal(out.ok,false);assert.equal(stopped(r).owner.executionsUsed,0);
});

test('underlying owner clock failure closes the real queue, including pending payloads',()=>{
  const r=rig(),p=issued(r);r.owner.enqueueCourier(packet('task.a'));
  r.time.now=5;assert.equal(r.owner.status().stopped,false);r.time.now=4;
  assert.equal(r.owner.checkExecution(execution(p.permitId)).ok,false);
  assert.equal(stopped(r).owner.executionsUsed,0);assert.equal(r.owner.claimCourier().code,'OWNER_STOPPED');
});

test('clock exception closes admission and does not leak an exception or permit',()=>{
  const r=rig();r.time.hook=()=>{throw Error('private error');};
  const out=r.owner.requestPermit(request());r.time.hook=null;assert.equal(out.ok,false);
  assert(!JSON.stringify(out).includes('private error'));assert.equal(stopped(r).owner.admitted,0);
});

for(const operation of ['enqueueCourier','claimCourier','cancelCourier'])test(`scheduler fault during ${operation} also closes the facade`,()=>{
  const r=rig();issued(r);r.owner.enqueueCourier(packet('task.a'));let calls=0;
  r.time.hook=()=>{if(++calls===2)throw Error('scheduler clock failed');};
  const out=operation==='enqueueCourier'?r.owner.enqueueCourier(packet('task.b')):
    operation==='cancelCourier'?r.owner.cancelCourier('task.a'):r.owner.claimCourier();
  r.time.hook=null;assert.equal(out.ok,false);
  // Do not let status() repair the state before testing immediate closure.
  assert.equal(r.owner.requestPermit(request()).code,'OWNER_STOPPED');
  assert.equal(stopped(r).owner.executionsUsed,0);
  assert.equal(r.owner.claimCourier().code,'OWNER_STOPPED');
});

for(let phase=1;phase<=5;phase++)test(`courier revocation at clock phase ${phase} suppresses payload delivery`,()=>{
  const r=rig();issued(r);r.owner.enqueueCourier(packet('task.a'));let calls=0;
  r.time.hook=()=>{if(++calls===phase)r.owner.revoke();};
  const out=r.owner.claimCourier();r.time.hook=null;
  assert.equal(out.ok,false);assert.equal(Object.hasOwn(out,'payload'),false);
  const s=stopped(r);assert.equal(s.owner.executionsUsed,0);assert.equal(s.chargedLifetimeSlots,phase===1?0:1);
});

test('expired courier claim never returns a previously admitted payload',()=>{
  const r=rig();issued(r);r.owner.enqueueCourier(packet('task.a'));let calls=0;
  r.time.hook=()=>{if(++calls===5)r.time.now=1000;};
  const out=r.owner.claimCourier();r.time.hook=null;
  assert.equal(out.ok,false);assert.equal(Object.hasOwn(out,'payload'),false);
  assert.equal(stopped(r).chargedLifetimeSlots,1);
});

test('rollover between real primary reservation and claim rejects stale work without refund',()=>{
  const r=rig(),p=issued(r);let calls=0;r.time.hook=()=>{if(++calls===4)r.time.now=100;};
  assert.equal(r.owner.checkExecution(execution(p.permitId)).code,'SLOT_CLAIM_REFUSED');r.time.hook=null;
  const s=stopped(r);assert.equal(s.chargedLifetimeSlots,1);assert.equal(s.lastPrimary.slotClaimed,false);
  assert.equal(s.owner.executionsUsed,0);assert.equal(s.scheduler.windowIndex,1);
});

test('lifetime charged-slot cap does not reset when scheduler windows roll over',()=>{
  const r=rig(),p=issued(r);assert.equal(r.owner.checkExecution(execution(p.permitId)).ok,true);
  for(let i=0;i<9;i++){
    r.time.now=i*100;assert.equal(r.owner.enqueueCourier(packet('task.'+i,{createdAtMs:r.time.now})).code,'QUEUED');
    assert.equal(r.owner.claimCourier().code,'COURIER_CLAIMED');
  }
  r.time.now=900;r.owner.enqueueCourier(packet('task.more',{createdAtMs:900}));
  assert.equal(r.owner.claimCourier().code,'RUN_SLOT_CAP');assert.equal(r.owner.status().chargedLifetimeSlots,10);
  assert.equal(r.owner.status().scheduler.courierAdmitted,0); // New window did not restore lifetime budget.
});

test('cancellation and OFF keep charged slots visible and never issue an extra permit',()=>{
  const r=rig(),p=issued(r);r.owner.checkExecution(execution(p.permitId));r.owner.enqueueCourier(packet('task.a'));
  assert.equal(r.owner.cancelCourier('task.a').code,'CANCELLED');assert.equal(r.owner.status().chargedLifetimeSlots,1);
  const reads=r.time.reads;for(let i=0;i<1000;i++)r.owner.stop();assert.equal(r.time.reads,reads);
  assert.equal(stopped(r).chargedLifetimeSlots,1);assert.equal(r.owner.requestPermit(request()).code,'OWNER_STOPPED');
  assert.equal(r.owner.ledger().count,3);
});

test('wrong revoke target and reentrant ordinary operations do not hijack a run',()=>{
  const r=rig(),p=issued(r);assert.equal(r.owner.revoke('permit.wrong').ok,false);assert.equal(r.owner.status().stopped,false);
  let reentered=false;r.time.hook=()=>{reentered=true;assert.equal(r.owner.checkExecution(execution(p.permitId)).code,'BUSY');};
  assert.equal(r.owner.checkExecution(execution(p.permitId)).code,'SLOT_BOUND_ADMITTED');r.time.hook=null;assert(reentered);
});

test('facade retains no raw scheduler, owner, tickets, arbitrary primary route or mutable methods',()=>{
  const {owner}=rig();assert.equal(Object.getPrototypeOf(owner),null);assert(Object.isFrozen(owner));
  assert.deepEqual(Object.keys(owner).sort(),['requestPermit','checkExecution','enqueueCourier','claimCourier','cancelCourier','revoke','stop','ledger','status'].sort());
  assert.throws(()=>owner.stop=()=>{},TypeError);flags(owner.status());
});

// Deliberate same-process method faults, not a production injection API. Each
// synchronous test restores the shared prototype before another test can run.
const prototype=Object.getPrototypeOf(createSharedWorkSlotScheduler(context.baseBytes,context.dualBytes,
  {...defaults,maxPrimaryIds:1,generation:1,clock:()=>0}).scheduler);
function fault(method,replacement,body){const original=prototype[method];try{prototype[method]=replacement(original);body();}finally{prototype[method]=original;}}
test('scheduler capacity refusal does not consume the owner permit; the real retry can succeed',()=>{
  const r=rig(),p=issued(r);
  fault('admitPrimary',()=>()=>({ok:false,code:'WINDOW_FULL',authorizing:false,modelExecuted:false,promotionGranted:false,certificationGranted:false}),()=>{
    assert.equal(r.owner.checkExecution(execution(p.permitId)).code,'SLOT_WINDOW_FULL');assert.equal(r.owner.status().owner.executionsUsed,0);
  });
  assert.equal(r.owner.checkExecution(execution(p.permitId)).code,'SLOT_BOUND_ADMITTED');
});
test('scheduler duplicate cannot masquerade as a reservation held by this owner',()=>{
  const r=rig(),p=issued(r);
  fault('admitPrimary',()=>()=>({ok:true,code:'DUPLICATE',workId:'run-one',workState:'CLAIMED',authorizing:false,modelExecuted:false,promotionGranted:false,certificationGranted:false}),()=>{
    assert.equal(r.owner.checkExecution(execution(p.permitId)).code,'SLOT_ADMISSION_REFUSED');
  });assert.equal(stopped(r).owner.executionsUsed,0);
});
test('wrong claim identity and forged tickets cannot commit owner admission',()=>{
  for(const method of ['claim','admitPrimary']){
    const r=rig(),p=issued(r);
    fault(method,original=>function(...args){const real=original.apply(this,args);return method==='claim'?{...real,workSha256:'0'.repeat(64)}:{...real,ticket:Object.freeze({})};},()=>{
      assert.equal(r.owner.checkExecution(execution(p.permitId)).ok,false);
    });const s=stopped(r);assert.equal(s.owner.executionsUsed,0);assert.equal(s.chargedLifetimeSlots,1);
  }
});
