import test from 'node:test';
import assert from 'node:assert/strict';
import {createSharedWorkSlotScheduler,decideSlotAdmission} from '../neural/shared-work-slot-scheduler.mjs';
import {createCourierQueue} from '../neural/courier-queue.mjs';
import {makeBn01Fixture,fixtureBytes} from '../neural/bn01-fixture.mjs';
import {makeDualFixture,canonicalFixtureBytes,sealDualFixture} from '../neural/dual-face-fixture.mjs';
const base=makeBn01Fixture(),dual=makeDualFixture(base);
const baseBytes=fixtureBytes(base),dualBytes=canonicalFixtureBytes(dual);
const digest='a'.repeat(64);
const defaults={generation:1,windowSlots:10,windowDurationMs:100,maxPrimaryIds:4096,maxCourierIds:4096};
function packet(taskId='task.a',changes={}){
  return canonicalFixtureBytes({kind:'veritas-courier-f32-v1',taskId,traveler:'ELECTRON',
    graphSha256:base.graph.sha256,runSha256:base.run.sha256,topologySha256:dual.topology.sha256,planSha256:dual.plan.sha256,
    generation:1,channelId:'channel.0.forward',fromPortId:'n0.a',toPortId:'n1.b',createdAtMs:0,ttlMs:1000,hopCount:1,
    spaceSha256:base.plugins[0].record.output.spaceSha256,payloadHex:'0000803f000000400000404000008040',...changes});
}
function setup(overrides={}){
  const time={now:0,reads:0};const clock=()=>{time.reads++;return time.now;};
  const made=createSharedWorkSlotScheduler(baseBytes,dualBytes,{...defaults,clock,...overrides});
  assert.equal(made.ok,true);return {s:made.scheduler,time,made};
}
function expect(r,code,ok=true){assert.equal(r.code,code);assert.equal(r.ok,ok);return r;}
const primary=(s,id)=>expect(s.admitPrimary(id,digest),'PRIMARY_ADMITTED');
const queued=(s,id='task.a',changes={})=>expect(s.enqueueCourier(packet(id,changes)),'QUEUED');
function counters(s,t,c){const snap=expect(s.inspect(),'SNAPSHOT');assert.equal(snap.totalAdmitted,t);assert.equal(snap.courierAdmitted,c);assert.equal(snap.primaryAdmitted,t-c);return snap;}

for(const [slots,quota] of [[1,0],[9,0],[10,1],[19,1],[20,2],[1000,100]]){
  test(`shared capacity S=${slots} Q=${quota}, including primary reserved capacity`,()=>{
    const {s}=setup({windowSlots:slots});
    for(let i=0;i<quota;i++){
      queued(s,`task.${i}`,{traveler:['PROTON','ELECTRON','NEUTRON'][i%3]});
      expect(s.claim(expect(s.takeCourier(),'COURIER_ADMITTED').ticket),'COURIER_CLAIMED');
    }
    queued(s,'task.extra');expect(s.takeCourier(),'COURIER_BUDGET_EXHAUSTED',false);
    for(let i=0;i<slots-quota;i++)primary(s,`primary.${i}`);
    expect(s.admitPrimary('primary.extra',digest),'WINDOW_FULL',false);counters(s,slots,quota);
  });
}

test('three traveler labels share one allowance, never three separate allowances',()=>{
  const {s}=setup();for(const name of ['proton','electron','neutron'])queued(s,`task.${name}`,{traveler:name.toUpperCase()});
  expect(s.takeCourier(),'COURIER_ADMITTED');expect(s.takeCourier(),'COURIER_BUDGET_EXHAUSTED',false);counters(s,1,1);
});

test('primary may borrow every unused slot when no courier is queued',()=>{
  const {s}=setup();for(let i=0;i<10;i++)primary(s,`primary.${i}`);
  queued(s);expect(s.takeCourier(),'WINDOW_FULL',false);counters(s,10,0);
});

test('queued courier reserves the remaining allowance against primary starvation',()=>{
  const {s}=setup();queued(s);for(let i=0;i<9;i++)primary(s,`primary.${i}`);
  expect(s.admitPrimary('primary.tenth',digest),'COURIER_RESERVED',false);
  expect(s.takeCourier(),'COURIER_ADMITTED');counters(s,10,1);
});

test('two-slot allowance remains reserved across partial courier admission',()=>{
  const {s}=setup({windowSlots:20});queued(s,'task.a');queued(s,'task.b');
  for(let i=0;i<18;i++)primary(s,`primary.${i}`);
  expect(s.admitPrimary('primary.more',digest),'COURIER_RESERVED',false);
  expect(s.takeCourier(),'COURIER_ADMITTED');expect(s.admitPrimary('primary.more',digest),'COURIER_RESERVED',false);
  expect(s.takeCourier(),'COURIER_ADMITTED');counters(s,20,2);
});

test('cancelled queued courier releases reservation but consumes no admission',()=>{
  const {s}=setup();queued(s);for(let i=0;i<9;i++)primary(s,`primary.${i}`);
  expect(s.cancelCourier('task.a'),'CANCELLED');primary(s,'primary.tenth');counters(s,10,0);
});

test('expired queued courier cannot reserve idle capacity',()=>{
  const {s,time}=setup();queued(s,'task.a',{ttlMs:10});for(let i=0;i<9;i++)primary(s,`primary.${i}`);
  time.now=10;primary(s,'primary.tenth');counters(s,10,0);
});

test('empty courier take does not charge, reserve a ticket or discard primary capacity',()=>{
  const {s}=setup();expect(s.takeCourier(),'EMPTY',false);counters(s,0,0);assert.equal(s.inspect().pendingTickets,0);
});

test('admitted courier retains queue capacity and exposes no payload before claim',()=>{
  const {s}=setup({windowSlots:100});for(let i=0;i<4;i++)queued(s,`task.${i}`);
  const taken=expect(s.takeCourier(),'COURIER_ADMITTED');
  assert.equal(Object.hasOwn(taken,'payload'),false);assert.equal(Object.hasOwn(taken,'inner'),false);
  let snap=s.inspect();assert.equal(snap.courierQueue.inFlight,1);assert.equal(snap.courierQueue.payloadBytes,64);
  expect(s.enqueueCourier(packet('task.extra')),'CHANNEL_FULL',false);
  const claimed=expect(s.claim(taken.ticket),'COURIER_CLAIMED');assert.deepEqual(claimed.payload,Buffer.from('0000803f000000400000404000008040','hex'));
  queued(s,'task.extra');expect(s.claim(taken.ticket),'INVALID_TICKET',false);
});

test('courier ticket cancellation does not refund its charged shared slot',()=>{
  const {s}=setup();queued(s);const ticket=expect(s.takeCourier(),'COURIER_ADMITTED').ticket;
  expect(s.cancel(ticket),'CANCELLED');queued(s,'task.b');expect(s.takeCourier(),'COURIER_BUDGET_EXHAUSTED',false);
  counters(s,1,1);expect(s.claim(ticket),'INVALID_TICKET',false);assert.equal(s.inspect().courierQueue.inFlight,0);
});

test('primary ticket cancellation never refunds total capacity or forgets its ID',()=>{
  const {s}=setup({windowSlots:1});const ticket=primary(s,'primary.a').ticket;expect(s.cancel(ticket),'CANCELLED');
  expect(s.admitPrimary('primary.b',digest),'WINDOW_FULL',false);assert.equal(expect(s.admitPrimary('primary.a',digest),'DUPLICATE').workState,'CANCELLED');
  counters(s,1,0);
});

test('direct courier task cancellation invalidates its outer claim without a refund',()=>{
  const {s}=setup();queued(s);const ticket=expect(s.takeCourier(),'COURIER_ADMITTED').ticket;
  expect(s.cancelCourier('task.a'),'CANCELLED');expect(s.claim(ticket),'INVALID_TICKET',false);
  counters(s,1,1);assert.equal(s.inspect().pendingTickets,0);
});

test('outer cancellation tolerates a hidden ticket already cancelled by task ID',()=>{
  const {s}=setup();queued(s);const ticket=s.takeCourier().ticket;s.cancelCourier('task.a');
  expect(s.cancel(ticket),'CANCELLED');assert.equal(s.inspect().state,'ACTIVE');counters(s,1,1);
});

test('expired admitted courier cannot claim or refund capacity',()=>{
  const {s,time}=setup();queued(s,'task.a',{ttlMs:5});const ticket=s.takeCourier().ticket;time.now=5;
  expect(s.claim(ticket),'INVALID_TICKET',false);counters(s,1,1);assert.equal(s.inspect().pendingTickets,0);
});

test('rollover invalidates old tickets but preserves unrelated unadmitted queued work',()=>{
  const {s,time}=setup();queued(s,'task.a');queued(s,'task.b');
  const ct=s.takeCourier().ticket,pt=primary(s,'primary.a').ticket;time.now=100;
  const snap=counters(s,0,0);assert.equal(snap.windowIndex,1);assert.equal(snap.courierQueue.queued,1);assert.equal(snap.courierQueue.inFlight,0);
  expect(s.claim(ct),'INVALID_TICKET',false);expect(s.claim(pt),'INVALID_TICKET',false);
  assert.equal(expect(s.admitPrimary('primary.a',digest),'DUPLICATE').workState,'STALE_WINDOW');
  assert.equal(expect(s.claim(s.takeCourier().ticket),'COURIER_CLAIMED').taskId,'task.b');
});

test('rollover tolerates queue expiry that has already invalidated the hidden ticket',()=>{
  const {s,time}=setup();queued(s,'task.a',{ttlMs:100});const ticket=s.takeCourier().ticket;time.now=100;
  const snap=counters(s,0,0);assert.equal(snap.state,'ACTIVE');expect(s.claim(ticket),'INVALID_TICKET',false);
});

test('window is half-open with one-before allowed and exact boundary refused for old ticket',()=>{
  const {s,time}=setup();const before=primary(s,'primary.before').ticket;time.now=99;expect(s.claim(before),'PRIMARY_CLAIMED');
  const after=primary(s,'primary.after').ticket;time.now=100;expect(s.claim(after),'INVALID_TICKET',false);assert.equal(s.inspect().windowIndex,1);
});

test('large idle skip grants one fresh window, never accumulated credit',()=>{
  const {s,time}=setup();time.now=100000000;const snap=counters(s,0,0);assert.equal(snap.windowIndex,1000000);
  queued(s,'task.a',{createdAtMs:time.now});expect(s.takeCourier(),'COURIER_ADMITTED');
  queued(s,'task.b',{createdAtMs:time.now});expect(s.takeCourier(),'COURIER_BUDGET_EXHAUSTED',false);
});

test('primary duplicate/conflict and bounded history survive claiming and new windows',()=>{
  const {s,time}=setup({maxPrimaryIds:1});const first=primary(s,'primary.a');expect(s.claim(first.ticket),'PRIMARY_CLAIMED');
  const duplicate=expect(s.admitPrimary('primary.a',digest),'DUPLICATE');assert.equal(Object.hasOwn(duplicate,'ticket'),false);
  expect(s.admitPrimary('primary.a','b'.repeat(64)),'WORK_CONFLICT',false);time.now=100;
  expect(s.admitPrimary('primary.b',digest),'PRIMARY_HISTORY_FULL',false);counters(s,0,0);
});

test('primary borrowing refusal does not claim or poison an ID',()=>{
  const {s}=setup();queued(s);for(let i=0;i<9;i++)primary(s,`primary.${i}`);
  expect(s.admitPrimary('primary.later',digest),'COURIER_RESERVED',false);s.cancelCourier('task.a');primary(s,'primary.later');
});

for(const workId of ['', 'BAD', 'x\n', 'x\r', 'x\u2028', 'x'.repeat(97),null]){
  test(`malformed primary ID ${JSON.stringify(workId)} never claims history`,()=>{
    const {s}=setup();expect(s.admitPrimary(workId,digest),'PRIMARY_IDENTITY_INVALID',false);assert.equal(s.inspect().retainedPrimaryIds,0);
  });
}

test('malformed primary digest cannot consume history or quota',()=>{
  const {s}=setup();for(const d of ['', 'A'.repeat(64),digest+'\n',null])expect(s.admitPrimary('primary.a',d),'PRIMARY_IDENTITY_INVALID',false);
  counters(s,0,0);primary(s,'primary.a');
});

test('underlying generation, route and tensor refusals consume no slot',()=>{
  const {s}=setup();for(const changes of [{generation:2},{channelId:'channel.1.return'},{spaceSha256:'0'.repeat(64)},{payloadHex:'00000000'}])assert.equal(s.enqueueCourier(packet('task.a',changes)).ok,false);
  counters(s,0,0);assert.equal(s.inspect().courierQueue.retainedTaskIds,0);
});

test('opaque tickets refuse copies and foreign owners without consuming valid originals',()=>{
  const a=setup().s,b=setup().s;const pa=primary(a,'primary.a').ticket,pb=primary(b,'primary.b').ticket;
  expect(a.claim({...pa}),'INVALID_TICKET',false);expect(a.claim(pb),'INVALID_TICKET',false);expect(b.cancel(pa),'INVALID_TICKET',false);
  expect(a.claim(pa),'PRIMARY_CLAIMED');expect(b.claim(pb),'PRIMARY_CLAIMED');
});

test('public owner never exposes raw queue methods or hidden ticket',()=>{
  const {s,made}=setup();assert.deepEqual(Object.keys(s),[]);assert.equal(Object.hasOwn(made,'queue'),false);
  queued(s);const admitted=s.takeCourier();assert.deepEqual(Object.keys(admitted.ticket),[]);
  assert.equal(typeof s.take,'undefined');assert.equal(typeof s.consume,'undefined');assert.equal(typeof s.inspect().courierQueue.take,'undefined');
});

test('every result remains non-authorizing, including errors and observations',()=>{
  const {s,made}=setup();const first=primary(s,'primary.a');const responses=[made,first,s.claim(first.ticket),s.claim(first.ticket),s.inspect(),s.enqueueCourier(Buffer.from('{')),s.stop(),s.inspect()];
  for(const response of responses)for(const f of ['authorizing','modelExecuted','promotionGranted','certificationGranted'])assert.equal(response[f],false);
});

test('configuration is read once; later option mutation cannot change capacity/clock',()=>{
  const reads={};const values={...defaults,clock:()=>0};const options={};
  for(const [k,v] of Object.entries(values))Object.defineProperty(options,k,{configurable:true,get(){reads[k]=(reads[k]??0)+1;return v;}});
  const made=createSharedWorkSlotScheduler(baseBytes,dualBytes,options);assert.equal(made.ok,true);
  for(const k of Object.keys(values)){assert.equal(reads[k],1);Object.defineProperty(options,k,{value:null,configurable:true});}
  queued(made.scheduler);expect(made.scheduler.takeCourier(),'COURIER_ADMITTED');expect(made.scheduler.takeCourier(),'COURIER_BUDGET_EXHAUSTED',false);
});

for(const [field,value] of [['generation',0],['generation',Number.MAX_SAFE_INTEGER+1],['windowSlots',0],['windowSlots',1001],['windowSlots',1.5],['windowDurationMs',0],['windowDurationMs',60001],['maxPrimaryIds',0],['maxPrimaryIds',4097],['maxCourierIds',0],['maxCourierIds',4097],['clock',null]]){
  test(`factory rejects ${field}=${value}`,()=>{
    const r=createSharedWorkSlotScheduler(baseBytes,dualBytes,{...defaults,clock:()=>0,[field]:value});assert.equal(r.ok,false);assert.equal(Object.hasOwn(r,'scheduler'),false);
  });
}

test('invalid declarations do not construct a scheduler',()=>{
  const denied=structuredClone(dual);denied.topology.record.channels[0].permission='DENY';sealDualFixture(denied);
  const r=createSharedWorkSlotScheduler(baseBytes,canonicalFixtureBytes(denied),{...defaults,clock:()=>0});expect(r,'QUEUE_CONSTRUCTION_REFUSED',false);
});

test('clock exactly once per host operation, including multiple internal queue calls',()=>{
  let time=98,reads=0;const {s}=setup({clock:()=>{reads++;return time++;},windowDurationMs:100});
  assert.equal(reads,1);queued(s,'task.a',{createdAtMs:98});assert.equal(reads,2);
  const ticket=s.takeCourier().ticket;assert.equal(reads,3);expect(s.claim(ticket),'COURIER_CLAIMED');assert.equal(reads,4);
  primary(s,'primary.a');assert.equal(reads,5);s.inspect();assert.equal(reads,6);
});

test('clock cannot straddle an internal queue call at the window edge',()=>{
  const times=[0,98,99,100];let reads=0;const {s}=setup({clock:()=>times[reads++]});
  queued(s);const ticket=expect(s.takeCourier(),'COURIER_ADMITTED').ticket;assert.equal(reads,3);
  expect(s.claim(ticket),'INVALID_TICKET',false);assert.equal(reads,4);
});

for(const [name,value,code] of [['negative',-1,'CLOCK_INVALID'],['fraction',0.5,'CLOCK_INVALID'],['unsafe',Number.MAX_SAFE_INTEGER+1,'CLOCK_INVALID'],['nan',NaN,'CLOCK_INVALID'],['regression',4,'CLOCK_REGRESSION']]){
  test(`${name} clock atomically stops admissions and releases tickets`,()=>{
    let now=5;const {s}=setup({clock:()=>now});queued(s);const ticket=s.takeCourier().ticket;primary(s,'primary.a');now=value;
    expect(s.claim(ticket),code,false);const snap=s.inspect();assert.equal(snap.state,'OFF');assert.equal(snap.pendingTickets,0);assert.equal(snap.courierQueue.payloadBytes,0);
  });
}

test('throwing host clock fails closed before input processing',()=>{
  let bad=false;const {s}=setup({clock:()=>{if(bad)throw Error('clock');return 0;}});queued(s);bad=true;
  expect(s.enqueueCourier(Buffer.from('{')),'CLOCK_ERROR',false);assert.equal(s.inspect().state,'OFF');
});

test('checked window end refuses overflow at construction and on rollover',()=>{
  expect(createSharedWorkSlotScheduler(baseBytes,dualBytes,{...defaults,clock:()=>Number.MAX_SAFE_INTEGER}),'CLOCK_RANGE',false);
  let now=Number.MAX_SAFE_INTEGER-100;const {s}=setup({clock:()=>now});assert.equal(s.inspect().windowEnd,Number.MAX_SAFE_INTEGER);
  now=Number.MAX_SAFE_INTEGER;expect(s.inspect(),'CLOCK_RANGE',false);assert.equal(s.inspect().state,'OFF');
});

test('reentrant host callback cannot admit, stop or claim work',()=>{
  let s,enabled=false;let nested=[];
  ({s}=setup({clock:()=>{if(enabled)nested=[s.admitPrimary('primary.nested',digest),s.takeCourier(),s.stop()];return 0;}}));
  enabled=true;queued(s);assert.deepEqual(nested.map(r=>r.code),['BUSY','BUSY','BUSY']);enabled=false;counters(s,0,0);
});

test('OFF invalidates both kinds, releases payloads and never reads host clock again',()=>{
  const {s,time}=setup();queued(s);const ct=s.takeCourier().ticket,pt=primary(s,'primary.a').ticket;
  expect(s.stop(),'STOPPED');const reads=time.reads;expect(s.claim(ct),'OFF',false);expect(s.claim(pt),'OFF',false);
  expect(s.takeCourier(),'OFF',false);expect(s.enqueueCourier(packet()),'OFF',false);expect(s.stop(),'OFF',false);
  const snap=s.inspect();assert.equal(time.reads,reads);assert.equal(snap.queueStopConfirmed,true);assert.equal(snap.courierQueue.payloadBytes,0);
});

test('failed owned-queue snapshot cannot be treated as empty primary borrowing',()=>{
  const {s}=setup();queued(s);for(let i=0;i<9;i++)primary(s,`primary.${i}`);
  const probe=createCourierQueue(baseBytes,dualBytes,{generation:1,maxRetainedTaskIds:4,clock:()=>0}).queue;
  const proto=Object.getPrototypeOf(probe),original=proto.inspect;
  try{proto.inspect=()=>({ok:false,code:'ERROR'});expect(s.admitPrimary('primary.extra',digest),'QUEUE_FAILURE',false);}
  finally{proto.inspect=original;probe.stop();}
  const snap=s.inspect();assert.equal(snap.state,'OFF');assert.equal(snap.totalAdmitted,9);assert.equal(snap.queueStopConfirmed,false);assert.equal(snap.courierQueue,null);
});

test('failed owned queue stop reports uncertainty rather than invented released capacity',()=>{
  const {s}=setup();queued(s);const ticket=s.takeCourier().ticket;
  const probe=createCourierQueue(baseBytes,dualBytes,{generation:1,maxRetainedTaskIds:4,clock:()=>0}).queue;
  const proto=Object.getPrototypeOf(probe),original=proto.stop;
  try{proto.stop=()=>{throw Error('injected stop');};expect(s.stop(),'QUEUE_FAILURE',false);}
  finally{proto.stop=original;probe.stop();}
  expect(s.claim(ticket),'OFF',false);assert.equal(s.inspect().queueStopConfirmed,false);assert.equal(s.inspect().pendingTickets,0);
});

test('queue cancelTicket releases only its owned in-flight reservation and tombstone',()=>{
  const q=createCourierQueue(baseBytes,dualBytes,{generation:1,maxRetainedTaskIds:4,clock:()=>0}).queue;
  q.enqueue(packet('task.a'));q.enqueue(packet('task.b'));const ticket=q.take().ticket;
  expect(q.cancelTicket(ticket),'CANCELLED');expect(q.consume(ticket),'INVALID_TICKET',false);expect(q.cancelTicket(ticket),'INVALID_TICKET',false);
  assert.equal(q.inspect().queued,1);assert.equal(q.inspect().inFlight,0);assert.equal(q.inspect().payloadBytes,16);
  assert.equal(expect(q.enqueue(packet('task.a')),'DUPLICATE').taskState,'CANCELLED');q.stop();
});

test('queue cancelTicket rejects foreign/copied/expired and OFF tickets',()=>{
  let now=0;const make=()=>createCourierQueue(baseBytes,dualBytes,{generation:1,maxRetainedTaskIds:4,clock:()=>now}).queue;
  const a=make(),b=make();a.enqueue(packet());const ticket=a.take().ticket;
  expect(a.cancelTicket({...ticket}),'INVALID_TICKET',false);expect(b.cancelTicket(ticket),'INVALID_TICKET',false);
  now=1000;expect(a.cancelTicket(ticket),'INVALID_TICKET',false);a.stop();expect(a.cancelTicket(ticket),'OFF',false);b.stop();
});

test('pure decision validates bounds and never mutates supplied counters',()=>{
  const input=Object.freeze({windowSlots:10,totalAdmitted:9,courierAdmitted:0,courierQueued:1,kind:'PRIMARY'});
  assert.equal(decideSlotAdmission(input),'COURIER_RESERVED');
  for(const changes of [{windowSlots:0},{windowSlots:1001},{totalAdmitted:11},{courierAdmitted:2},{courierQueued:-1},{kind:'NEUTRON'}])assert.equal(decideSlotAdmission({...input,...changes}),'INPUT_INVALID');
  assert.equal(decideSlotAdmission(null),'INPUT_INVALID');
});
