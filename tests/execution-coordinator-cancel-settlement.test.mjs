// Regression oracle for cancellation-operation ownership, not remote-stop proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { createExecutionCoordinatorV1 } from '../hosts/repository/execution-coordinator-v1.mjs';
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
function setup(cancel) {
  let cancelCalls=0, settledCalls=0;
  const coordinator=createExecutionCoordinatorV1({settleTimeoutMs:5,owners:[{
    id:'original.owner',status:()=> 'IDLE',cancel:()=>{cancelCalls++;return cancel();},
    settled:async()=>{settledCalls++;},
  }]});
  return {coordinator,counts:()=>({cancelCalls,settledCalls})};
}

test('pending cancellation cannot report OFF even when resource settlement says IDLE',async()=>{
  const pending=deferred(),{coordinator,counts}=setup(()=>pending.promise);
  try {
    const result=await coordinator.requestOff();
    assert.equal(result.status,'UNCONFIRMED');
    assert.equal(result.snapshot.capacityReusable,false);
    assert.equal(result.snapshot.owners[0].error,'CANCEL_TIMEOUT');
    assert.equal(result.snapshot.owners[0].settlement,'SETTLED');
    assert.deepEqual(counts(),{cancelCalls:1,settledCalls:1});
  } finally {pending.resolve();}
});

test('same pending cancellation remains owned across requestOff and recheck without reinvocation',async()=>{
  const pending=deferred(),{coordinator,counts}=setup(()=>pending.promise);
  try {
    for(const method of ['requestOff','requestOff','recheck']) {
      const result=await coordinator[method]();
      assert.equal(result.status,'UNCONFIRMED',method);
      assert.equal(result.snapshot.owners[0].error,'CANCEL_TIMEOUT',method);
      assert.equal(counts().cancelCalls,1);
    }
  } finally {pending.resolve();}
});

test('late cancellation success requires explicit recheck and does not revise retained timeout',async()=>{
  const pending=deferred(),{coordinator,counts}=setup(()=>pending.promise);
  const first=await coordinator.requestOff();
  assert.equal(first.status,'UNCONFIRMED');
  pending.resolve();await tick();
  assert.equal(coordinator.inspect().snapshot.capacityReusable,false,'late success is not automatic recovery');
  const next=await coordinator.recheck();
  assert.equal(next.status,'OFF');
  assert.equal(next.snapshot.owners[0].error,null);
  assert.equal(first.snapshot.owners[0].error,'CANCEL_TIMEOUT');
  assert.deepEqual(counts(),{cancelCalls:1,settledCalls:2});
});

test('late cancellation failure is contained and neither repeated operation may erase it',async()=>{
  const pending=deferred(),{coordinator,counts}=setup(()=>pending.promise);
  const first=await coordinator.requestOff();
  assert.equal(first.status,'UNCONFIRMED');
  pending.reject(Error('private late rejection'));await tick();
  assert.equal(coordinator.inspect().snapshot.owners[0].error,'CANCEL_TIMEOUT',
    'inspect is the last completed observation, not an implicit recheck');
  for(const method of ['recheck','requestOff']) {
    const result=await coordinator[method]();
    assert.equal(result.status,'UNCONFIRMED',method);
    assert.equal(result.snapshot.owners[0].error,'CANCEL_ERROR',method);
    assert.equal(result.snapshot.capacityReusable,false);
    assert.equal(JSON.stringify(result).includes('private late rejection'),false);
  }
  assert.equal(counts().cancelCalls,1);
  assert.equal(first.snapshot.owners[0].error,'CANCEL_TIMEOUT');
});

test('overlapping operations during cancellation cannot duplicate owner callbacks',async()=>{
  const pending=deferred(),{coordinator,counts}=setup(()=>pending.promise);
  const first=coordinator.requestOff(); await tick();
  for(const method of ['requestOff','recheck']) {
    const result=await coordinator[method]();
    assert.equal(result.status,'REFUSED'); assert.equal(result.reason,'COORDINATOR_BUSY');
  }
  assert.deepEqual(counts(),{cancelCalls:1,settledCalls:0});
  pending.resolve(); assert.equal((await first).status,'OFF');
  assert.deepEqual(counts(),{cancelCalls:1,settledCalls:1});
});

test('fresh valid status clears only prior status uncertainty, not cancellation failure',async()=>{
  for(const cancelFails of [false,true]) {
    let readable=false;
    const coordinator=createExecutionCoordinatorV1({settleTimeoutMs:5,owners:[{
      id:'status.owner',status:()=>{if(!readable)throw Error('unreadable');return 'IDLE';},
      settled:async()=>{},cancel:()=>{if(cancelFails)throw Error('cancel failed');},
    }]});
    assert.equal((await coordinator.requestOff()).status,'UNCONFIRMED');readable=true;
    const result=await coordinator.recheck();
    assert.equal(result.status,cancelFails?'UNCONFIRMED':'OFF');
    assert.equal(result.snapshot.owners[0].error,cancelFails?'CANCEL_ERROR':null);
  }
});

test('settlement errors can recover but cannot erase a failed cancellation',async()=>{
  for(const cancelFails of [false,true]) {
    let ready=false,cancels=0;
    const coordinator=createExecutionCoordinatorV1({settleTimeoutMs:5,owners:[{
      id:'mixed.owner',status:()=> 'IDLE',
      settled:async()=>{if(!ready)throw Error('settlement failure');},
      cancel:()=>{cancels++;if(cancelFails)throw Error('cancel failure');},
    }]});
    const first=await coordinator.requestOff();
    assert.equal(first.status,'UNCONFIRMED');
    assert.equal(first.snapshot.owners[0].error,cancelFails?'CANCEL_ERROR':'SETTLEMENT_ERROR');
    ready=true;const next=await coordinator.recheck();
    assert.equal(next.status,cancelFails?'UNCONFIRMED':'OFF');assert.equal(cancels,1);
  }
});

test('synchronous cancellation failure stays sticky across repeated requestOff',async()=>{
  const {coordinator,counts}=setup(()=>{throw Error('private cancellation error');});
  for(let i=0;i<3;i++) {
    const result=await coordinator.requestOff();
    assert.equal(result.status,'UNCONFIRMED');
    assert.equal(result.snapshot.owners[0].error,'CANCEL_ERROR');
    assert.equal(counts().cancelCalls,1);
  }
});

test('pending cancellation on one owner cannot be hidden by other settled owners',async()=>{
  const pending=deferred();let a=0,b=0;
  const coordinator=createExecutionCoordinatorV1({settleTimeoutMs:5,owners:[
    {id:'a',status:()=> 'OFF',settled:async()=>{},cancel:()=>{a++;return pending.promise;}},
    {id:'b',status:()=> 'IDLE',settled:async()=>{},cancel:()=>{b++;}},
  ]});
  try {
    const result=await coordinator.requestOff();
    assert.equal(result.status,'UNCONFIRMED');
    assert.equal(result.snapshot.owners[0].error,'CANCEL_TIMEOUT');
    assert.equal(result.snapshot.owners[1].error,null);
    assert.deepEqual([a,b],[1,1]);
  } finally {pending.resolve();}
});
