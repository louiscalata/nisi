import test from 'node:test';
import assert from 'node:assert/strict';
import {fixedXpcJournalObservation as observe} from '../history/fixed-xpc-journal-observation-v1.mjs';
import {makeRecord} from './fixtures/fixed-xpc-journal-observation.mjs';
const request=r=>({serializedRecord:JSON.stringify(r),projectId:'p',candidateId:'c',receiptId:'r',createdAt:100,ttlMs:1000});
test('an adverse observation cannot retain journal SUCCEEDED',()=>{
  const changes=[
    r=>{r.status='INCONCLUSIVE';},r=>{delete r.client;},r=>{delete r.postconditions;},
    r=>{r.client.result.validated=null;},r=>{r.client.result.outputs.stdout.sha256='0'.repeat(64);},
    r=>{r.terminalPersistence={status:'FAILED_OR_UNCERTAIN',code:'EIO'};},
    r=>{r.client.result.process.deadlineExceeded=true;},
    r=>{r.client.result.lifecycle.killRequested=true;}
  ];
  for(const change of changes){const r=makeRecord();change(r);const out=observe(request(r));assert.equal(out.status,'ENTRY');assert.equal(out.entry.state,'FAILED');assert(out.entry.payload.reasons.length>0);}
});
test('timestamp order, bound case/PID and safe argument overflow are refused',()=>{
  const bad={status:'REFUSED',reason:'INVALID_INPUT',authorizing:false};
  for(const change of [
    r=>{r.completedAt='2026-09-13T19:00:00.000Z';},
    r=>{r.caseName='constructor';},
    r=>{r.client.expectedExitCode=70;},
    r=>{r.client.parentObservedPid=303;},
    r=>{r.containers[0].path='/synthetic/../'+r.hostId;}
  ]){const r=makeRecord();change(r);assert.deepEqual(observe(request(r)),bad);}
  assert.deepEqual(observe({...request(makeRecord()),createdAt:Number.MAX_SAFE_INTEGER,ttlMs:1}),bad);
});
test('no-reply fixture never substitutes an owner deadline or kill for a client timeout',()=>{
  for(const change of [
    r=>{r.client.result.process.deadlineExceeded=true;},
    r=>{r.client.result.process.cancelRequested=true;},
    r=>{r.client.result.lifecycle.killRequested=true;}
  ]){const r=makeRecord('no-reply');change(r);const out=observe(request(r));assert.equal(out.entry.state,'FAILED');}
});
test('ordinary JSON depth and node budget are independent of encoded byte budget',()=>{
  const r=makeRecord();r.platform={items:Array.from({length:100},()=>Array(201).fill(null))};
  assert(Buffer.byteLength(JSON.stringify(r))<1048576);
  assert.equal(observe(request(r)).status,'REFUSED');
});
test('root getters and hidden extra authority never execute or disappear',()=>{
  const r=request(makeRecord());let called=0;
  Object.defineProperty(r,'extra',{get(){called++;return true;}});
  assert.equal(observe(r).status,'REFUSED');assert.equal(called,0);
  const negativeZero=JSON.stringify(makeRecord()).replace('"durationMs":300','"durationMs":-0');
  assert.equal(observe({...request(makeRecord()),serializedRecord:negativeZero}).status,'REFUSED');
});
