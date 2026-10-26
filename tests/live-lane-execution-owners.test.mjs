// Synthetic transports and checks only; no native fixture execution or inference.
import test from 'node:test';
import assert from 'node:assert/strict';
import { context, seed, deferred, tick } from './helpers/reviewed-live-model-fixture.mjs';
import { context as contextV3 } from './helpers/live-model-v3-fixture.mjs';
for(const version of [1,2,3]) {
  test(`V${version} exposes exact frozen owner cardinality without changing receipt snapshot`,async()=>{
    const c=await (version===3?contextV3():context({laneVersion:version}));const before=c.lane.snapshot();
    const owners=c.lane.executionOwners();assert.equal(owners,c.lane.executionOwners());assert.ok(Object.isFrozen(owners));
    assert.deepEqual(owners.map(x=>x.id),version===3?['model.author','model.reviewer']:['model.shared']);
    for(const o of owners){assert.ok(Object.isFrozen(o));assert.equal(o.status(),'IDLE');await o.settled();}
    assert.deepEqual(c.lane.snapshot(),before);await c.run();
    for(const o of owners){await o.settled();assert.equal(o.status(),'IDLE');}
    c.lane.revoke();for(const o of owners)assert.equal(o.status(),'OFF');
  });
  test(`V${version} model join remains pending until original transport settles after revoke`,async()=>{
    const pending=deferred();const c=await (version===3?contextV3({onRequest:()=>pending.promise}):context({laneVersion:version,onRequest:()=>pending.promise}));
    const p=seed(c),owner=c.lane.executionOwners()[0];await owner.settled();
    const run=c.lane.author.repair(p).catch(e=>e);await tick();
    let done=false;const joined=owner.settled().then(()=>{done=true;});c.lane.revoke();await tick();
    assert.equal(done,false);assert.notEqual(owner.status(),'OFF');
    pending.reject(Error('synthetic late transport'));await run;await joined;
    assert.equal(done,true);assert.equal(owner.status(),'QUARANTINED');
  });
}
