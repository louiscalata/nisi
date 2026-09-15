import test from 'node:test';
import assert from 'node:assert/strict';
import {createCourierQueue} from '../neural/courier-queue.mjs';
import {makeBn01Fixture,fixtureBytes} from '../neural/bn01-fixture.mjs';
import {makeDualFixture,canonicalFixtureBytes,sealDualFixture} from '../neural/dual-face-fixture.mjs';
const base=makeBn01Fixture(),dual=makeDualFixture(base);
const baseBytes=fixtureBytes(base),dualBytes=canonicalFixtureBytes(dual);
function packet(taskId='task.first', changes={}, selectedDual=dual) {
  return canonicalFixtureBytes({kind:'veritas-courier-f32-v1',taskId,traveler:'ELECTRON',
    graphSha256:base.graph.sha256,runSha256:base.run.sha256,
    topologySha256:selectedDual.topology.sha256,planSha256:selectedDual.plan.sha256,generation:1,
    channelId:'channel.0.forward',fromPortId:'n0.a',toPortId:'n1.b',
    createdAtMs:0,ttlMs:1000,hopCount:1,spaceSha256:base.plugins[0].record.output.spaceSha256,
    payloadHex:'0000803f000000400000404000008040',...changes});
}
function make(selectedDual=dual,options={}) {
  const result=createCourierQueue(baseBytes,canonicalFixtureBytes(selectedDual),{generation:1,maxRetainedTaskIds:4,clock:()=>0,...options});
  assert.equal(result.ok,true);return result.queue;
}

test('configuration accessor is captured once before validation and bounds history',()=>{
  let reads=0;
  const options={generation:1,clock:()=>0,get maxRetainedTaskIds(){return ++reads<=3?1:5000;}};
  const made=createCourierQueue(baseBytes,dualBytes,options);
  assert.equal(made.ok,true);
  assert.equal(reads,1,'validate exactly the captured value, not a later accessor result');
  const q=made.queue;
  assert.equal(q.enqueue(packet()).code,'QUEUED');
  assert.equal(q.consume(q.take().ticket).code,'DELIVERED');
  assert.equal(q.enqueue(packet('task.second')).code,'TASK_HISTORY_FULL');
});

test('all three configuration dependencies are read once and later mutation is irrelevant',()=>{
  const counts={generation:0,maxRetainedTaskIds:0,clock:0};
  const options={};
  for(const [key,value] of Object.entries({generation:1,maxRetainedTaskIds:1,clock:()=>0})) {
    Object.defineProperty(options,key,{configurable:true,get(){counts[key]++;return value;}});
  }
  const made=createCourierQueue(baseBytes,dualBytes,options);
  assert.equal(made.ok,true);
  assert.deepEqual(counts,{generation:1,maxRetainedTaskIds:1,clock:1});
  for(const [key,value] of Object.entries({generation:7,maxRetainedTaskIds:4096,clock:()=>{throw Error('changed');}})) {
    Object.defineProperty(options,key,{value,configurable:true});
  }
  const q=made.queue;
  assert.equal(q.enqueue(packet()).code,'QUEUED');
  assert.equal(q.consume(q.take().ticket).code,'DELIVERED');
  assert.equal(q.enqueue(packet('task.second')).code,'TASK_HISTORY_FULL');
  assert.equal(q.inspect().state,'ACTIVE');
});

test('throwing configuration getter returns no partially initialized queue',()=>{
  let clockCalls=0;
  const made=createCourierQueue(baseBytes,dualBytes,{get generation(){throw Error('bad');},maxRetainedTaskIds:1,clock(){clockCalls++;return 0;}});
  assert.equal(made.ok,false);assert.equal(Object.hasOwn(made,'queue'),false);assert.equal(clockCalls,0);
});

for(const channel of dual.topology.record.channels.filter(c=>c.channelId!=='channel.0.forward')) {
  test(`unused ALLOW direction ${channel.channelId} cannot become a computation route`,()=>{
    const q=make();
    const result=q.enqueue(packet('task.first',{channelId:channel.channelId,fromPortId:channel.fromPortId,toPortId:channel.toPortId}));
    assert.equal(result.code,'ROUTE_REFUSED');assert.equal(q.inspect().retainedTaskIds,0);
    assert.equal(q.take().code,'EMPTY');
  });
}

test('DENY selected route cannot construct a queue; unused DENY cannot deliver',()=>{
  const denied=structuredClone(dual);denied.topology.record.channels[0].permission='DENY';sealDualFixture(denied);
  assert.equal(createCourierQueue(baseBytes,canonicalFixtureBytes(denied),{generation:1,maxRetainedTaskIds:4,clock:()=>0}).ok,false);
  const unused=structuredClone(dual);unused.topology.record.channels[1].permission='DENY';sealDualFixture(unused);
  const q=make(unused),ch=unused.topology.record.channels[1];
  assert.equal(q.enqueue(packet('task.first',{channelId:ch.channelId,fromPortId:ch.fromPortId,toPortId:ch.toPortId},unused)).code,'ROUTE_REFUSED');
  assert.equal(q.inspect().payloadBytes,0);
});

test('channel raw-payload exact and one-under bounds enforce real bytes',()=>{
  for(const maximum of [15,16]) {
    const selected=structuredClone(dual);selected.topology.record.channels[0].maxPayloadBytes=maximum;sealDualFixture(selected);
    const q=make(selected),r=q.enqueue(packet('task.first',{},selected));
    assert.equal(r.code,maximum===16?'QUEUED':'PAYLOAD_LIMIT');
    assert.equal(q.inspect().payloadBytes,maximum===16?16:0);
  }
});

test('maximum retained IDs is a bounded tombstone history, not only live queue length',()=>{
  const q=make(dual,{maxRetainedTaskIds:4});
  for(let i=0;i<4;i++){assert.equal(q.enqueue(packet(`task.${i}`)).code,'QUEUED');assert.equal(q.consume(q.take().ticket).code,'DELIVERED');}
  assert.equal(q.inspect().retainedTaskIds,4);assert.equal(q.inspect().payloadBytes,0);
  assert.equal(q.enqueue(packet('task.fifth')).code,'TASK_HISTORY_FULL');
  assert.equal(q.enqueue(packet('task.0')).taskState,'DELIVERED');
  assert.equal(q.enqueue(packet('task.0',{traveler:'PROTON'})).code,'TASK_CONFLICT');
});

test('reentrant consume and stop refuse BUSY without delivering or revoking outer work',()=>{
  let q,ticket,nested=[];
  q=make(dual,{clock:()=>{if(ticket){nested=[q.consume(ticket),q.stop()];}return 0;}});
  assert.equal(q.enqueue(packet()).code,'QUEUED');ticket=q.take().ticket;
  assert.equal(q.inspect().inFlight,1);assert.deepEqual(nested.map(r=>r.code),['BUSY','BUSY']);
  assert.equal(nested.some(r=>Object.hasOwn(r,'payload')),false);
  const expected=ticket;ticket=null;assert.equal(q.consume(expected).code,'DELIVERED');
});

test('clock reads cease after OFF, including inspection and repeated stop',()=>{
  let reads=0;const q=make(dual,{clock:()=>{reads++;return 0;}});
  q.enqueue(packet());q.stop();const stopped=reads;
  q.inspect();q.stop();q.enqueue(packet());q.take();q.consume({});q.cancel('task.first');
  assert.equal(reads,stopped);
});

test('clock fault precedes and suppresses queued expired-work consumption',()=>{
  let value=0;const q=make(dual,{clock:()=>value});q.enqueue(packet());const ticket=q.take().ticket;
  value=NaN;assert.equal(q.consume(ticket).code,'CLOCK_INVALID');
  assert.deepEqual([q.inspect().queued,q.inspect().inFlight,q.inspect().payloadBytes],[0,0,0]);
});

test('schema-valid bad identity precedes channel TTL refusal',()=>{
  const q=make();assert.equal(q.enqueue(packet('task.first',{graphSha256:'0'.repeat(64),ttlMs:1001})).code,'IDENTITY_MISMATCH');
});

test('deadline addition overflow and future-created packets refuse without a history claim',()=>{
  const q=make(dual,{clock:()=>Number.MAX_SAFE_INTEGER-1});
  assert.equal(q.enqueue(packet('task.first',{createdAtMs:Number.MAX_SAFE_INTEGER-1,ttlMs:2})).code,'DEADLINE_OVERFLOW');
  const normal=make();assert.equal(normal.enqueue(packet('task.first',{createdAtMs:1})).code,'FUTURE_PACKET');
  assert.equal(q.inspect().retainedTaskIds,0);assert.equal(normal.inspect().retainedTaskIds,0);
});

test('canonical duplicate keys and fractional wire spelling cannot acquire IDs',()=>{
  const source=packet().toString('utf8');
  for(const changed of [source.replace('"generation":1','"generation":1,"generation":1'),source.replace('"generation":1','"generation":1.0')]) {
    const q=make();assert.equal(q.enqueue(Buffer.from(changed)).code,'NONCANONICAL_PACKET');assert.equal(q.inspect().retainedTaskIds,0);
  }
});

for(let index=0;index<4;index++) {
  test(`nonfinite f32 at tensor position ${index} refuses`,()=>{
    for(const bits of ['0000c07f','0000807f','000080ff']) {
      const words=['00000000','00000000','00000000','00000000'];words[index]=bits;
      const q=make();assert.equal(q.enqueue(packet('task.first',{payloadHex:words.join('')})).code,'NONFINITE_PAYLOAD');
      assert.equal(q.inspect().payloadBytes,0);
    }
  });
}

test('strict cancellation ID rejects all trailing line terminators',()=>{
  const q=make();q.enqueue(packet());
  for(const ending of ['\n','\r','\u2028','\u2029'])assert.equal(q.cancel(`task.first${ending}`).code,'TASK_ID_INVALID');
  assert.equal(q.inspect().queued,1);
});
