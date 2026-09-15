import test from 'node:test';
import assert from 'node:assert/strict';
import {createCourierQueue} from '../neural/courier-queue.mjs';
import {createSharedWorkSlotScheduler} from '../neural/shared-work-slot-scheduler.mjs';
import {makeBn01Fixture,fixtureBytes} from '../neural/bn01-fixture.mjs';
import {makeDualFixture,canonicalFixtureBytes} from '../neural/dual-face-fixture.mjs';
const base=makeBn01Fixture(),dual=makeDualFixture(base),bb=fixtureBytes(base),db=canonicalFixtureBytes(dual);
const flags={authorizing:false,modelExecuted:false,promotionGranted:false,certificationGranted:false};
const config={generation:1,windowSlots:10,windowDurationMs:100,maxPrimaryIds:4,maxCourierIds:4,clock:()=>0};
const bytes=()=>canonicalFixtureBytes({kind:'veritas-courier-f32-v1',taskId:'task.a',traveler:'ELECTRON',
  graphSha256:base.graph.sha256,runSha256:base.run.sha256,topologySha256:dual.topology.sha256,planSha256:dual.plan.sha256,
  generation:1,channelId:'channel.0.forward',fromPortId:'n0.a',toPortId:'n1.b',createdAtMs:0,ttlMs:1000,hopCount:1,
  spaceSha256:base.plugins[0].record.output.spaceSha256,payloadHex:'0000803f000000400000404000008040'});

const cases=[
  ['unknown enqueue success','enqueue',r=>({...r,code:'MAGIC_SUCCESS'})],
  ['enqueue missing task ID','enqueue',r=>{const c={...r};delete c.taskId;return c;}],
  ['enqueue mismatched state','enqueue',r=>({...r,taskState:'DELIVERED'})],
  ['enqueue authorizing true','enqueue',r=>({...r,authorizing:true})],
  ['enqueue missing false flag','enqueue',r=>{const c={...r};delete c.modelExecuted;return c;}],
  ['enqueue unknown property','enqueue',r=>({...r,execute:true})],
  ['TAKEN missing flags','take',r=>({ok:true,code:'TAKEN',ticket:r.ticket})],
  ['TAKEN with forged non-object ticket','take',r=>({...r,ticket:42})],
  ['DELIVERED non-buffer payload','consume',r=>({...r,payload:'bytes'})],
  ['DELIVERED task ID differs from packet','consume',r=>({...r,taskId:'task.other'})],
  ['DELIVERED wrong graph identity','consume',r=>({...r,packet:{...r.packet,graphSha256:'0'.repeat(64)}})],
  ['DELIVERED nonfinite payload','consume',r=>({...r,payload:Buffer.from('0000c07f000000000000000000000000','hex')})],
  ['DELIVERED wrong payload width','consume',r=>({...r,payload:Buffer.alloc(4)})],
  ['DELIVERED missing packet field','consume',r=>{const p={...r.packet};delete p.generation;return {...r,packet:p};}],
  ['cancel missing task state','cancel',r=>{const c={...r};delete c.taskState;return c;}],
  ['cancelTicket authorizing true','cancelTicket',r=>({...r,authorizing:true})],
];
for(const [name,method,mutate] of cases){
  test(`malformed owned response: ${name} quarantines without exposure`,()=>{
    const s=createSharedWorkSlotScheduler(bb,db,config).scheduler;
    const probe=createCourierQueue(bb,db,{generation:1,maxRetainedTaskIds:4,clock:()=>0}).queue;
    const proto=Object.getPrototypeOf(probe),original=proto[method];let ticket;
    if(method!=='enqueue'){assert.equal(s.enqueueCourier(bytes()).ok,true);if(['consume','cancelTicket'].includes(method))ticket=s.takeCourier().ticket;}
    let result;
    try{
      proto[method]=function(...args){return mutate(original.apply(this,args));};
      result=method==='enqueue'?s.enqueueCourier(bytes()):method==='take'?s.takeCourier():method==='consume'?s.claim(ticket):method==='cancel'?s.cancelCourier('task.a'):s.cancel(ticket);
    }finally{proto[method]=original;probe.stop();}
    assert.equal(result.code,'QUEUE_FAILURE');assert.equal(result.ok,false);
    assert.equal(Object.hasOwn(result,'ticket'),false);assert.equal(Object.hasOwn(result,'payload'),false);
    for(const f of Object.keys(flags))assert.equal(result[f],false);
    assert.equal(s.inspect().state,'OFF');
  });
}

test('unknown queue refusal does not masquerade as a normal rejected packet',()=>{
  const s=createSharedWorkSlotScheduler(bb,db,config).scheduler;
  const probe=createCourierQueue(bb,db,{generation:1,maxRetainedTaskIds:4,clock:()=>0}).queue;
  const proto=Object.getPrototypeOf(probe),original=proto.enqueue;
  try{proto.enqueue=()=>({ok:false,code:'NOT_A_DECLARED_REFUSAL',...flags});assert.equal(s.enqueueCourier(bytes()).code,'QUEUE_FAILURE');}
  finally{proto.enqueue=original;probe.stop();}
  assert.equal(s.inspect().state,'OFF');
});

test('response descriptors are captured once before deciding success versus refusal',()=>{
  const s=createSharedWorkSlotScheduler(bb,db,config).scheduler;
  const probe=createCourierQueue(bb,db,{generation:1,maxRetainedTaskIds:4,clock:()=>0}).queue;
  const proto=Object.getPrototypeOf(probe),original=proto.enqueue;let reads=0;
  try{
    proto.enqueue=()=>new Proxy({ok:false,code:'EXPIRED',...flags},{getOwnPropertyDescriptor(target,key){
      const d=Reflect.getOwnPropertyDescriptor(target,key);return key==='ok'?{...d,value:++reads===1?false:true}:d;
    }});
    const result=s.enqueueCourier(bytes());assert.equal(result.ok,false);assert.equal(result.code,'EXPIRED');assert.equal(reads,1);
  }finally{proto.enqueue=original;probe.stop();}
  assert.equal(s.inspect().totalAdmitted,0);s.stop();
});
