// Inert owner promises and memory-only evidence. No models, native code or disk writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { createLiveDemoExecutionV1 } from '../hosts/repository/live-demo-execution-v1.mjs';
import { liveModelOwnerStatusV1, liveHostOwnerStatusV1 } from '../hosts/repository/live-owner-status-v1.mjs';
import { sha256Text } from '../workflow/contracts.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const coded = code => Object.assign(Error(code), {code});
const hash = v => sha256Text(JSON.stringify(v,null,2)+'\n');
function setup({ hostJoin = Promise.resolve({state:'SETTLED'}), modelJoin = Promise.resolve(), hostStatus = () => 'SETTLED',
  modelStatus = () => 'IDLE', failedWrites = [], revoke = () => {}, retainHook = () => {} } = {}) {
  const files = new Map(), calls = [], notices = [], controller = new AbortController();
  const host = { status: hostStatus, settled: () => { calls.push('host.join'); return hostJoin; },
    lateObservations: () => [], materializationObservations: () => ({availability:'AVAILABLE',rows:[]}) };
  const lane = { revoke: () => {calls.push('revoke');revoke();}, snapshot: () => ({phase:'DONE'}),
    executionOwners: () => [{id:'model.shared', status:modelStatus, settled:()=>{calls.push('model.join');return modelJoin;},cancel:()=>{throw Error('unexpected raw cancel');}}] };
  const retain = async (name,value) => {
    calls.push(name); await retainHook(name);
    if(failedWrites.includes(name)) throw coded('SYNTHETIC_WRITE');
    assert.equal(files.has(name),false); files.set(name,structuredClone(value));
  };
  const bridge = createLiveDemoExecutionV1({host,lane,controller,retain,binding:{directory:'/synthetic/one'},settleTimeoutMs:5,onLateError:r=>notices.push(r)});
  return {bridge,files,calls,notices,controller};
}
test('status mapping never equates stopped quarantine, pending I/O or NEW host with idle', () => {
  const model=(state,pendingTransports=0,recoveryRequired=false)=>liveModelOwnerStatusV1({state,pendingTransports,recoveryRequired});
  assert.equal(model('STOPPED',0,true),'QUARANTINED');
  assert.equal(model('QUARANTINED'),'QUARANTINED');
  for(const state of ['BUSY','DRAINING','STOPPED_DRAINING']) assert.equal(model(state),'BUSY');
  assert.equal(model('STOPPED',1),'BUSY'); assert.equal(model('IDLE',1),'BUSY');
  assert.equal(model('STOPPED'),'OFF'); assert.equal(model('IDLE'),'IDLE');
  for(const state of ['NEW','RUNNING','SETTLING']) assert.equal(liveHostOwnerStatusV1(state),'BUSY');
  assert.equal(liveHostOwnerStatusV1('SETTLED'),'IDLE');
  assert.equal(liveHostOwnerStatusV1('QUARANTINED'),'QUARANTINED');
  for(const value of [null,[],{}, {state:'IDLE',pendingTransports:-1,recoveryRequired:false},
    {state:'IDLE',pendingTransports:0,recoveryRequired:'no'}, {state:'UNKNOWN',pendingTransports:0,recoveryRequired:false},
    Object.defineProperty({pendingTransports:0,recoveryRequired:false},'state',{enumerable:true,get(){throw Error('getter must not run');}})])
    assert.throws(()=>liveModelOwnerStatusV1(value),{code:'LIVE_EXECUTION_MODEL_STATE'});
  assert.throws(()=>liveHostOwnerStatusV1('OFF'),{code:'LIVE_EXECUTION_HOST_STATE'});
});
test('one raw host join and deferred model join; immutable separately hash-bound terminal evidence', async () => {
  const s=setup(); assert.deepEqual(s.calls,[]);
  const join=s.bridge.hostSettled(); assert.equal(s.bridge.hostSettled(),join); await join;
  assert.deepEqual(s.calls,['host.join']);
  const out=await s.bridge.finish(); assert.equal(out.observation.status,'OFF');
  assert.equal(s.bridge.finish(),s.bridge.finish()); assert.equal(out.late.state,'RETAINED');
  assert.equal(s.calls.filter(x=>x==='host.join').length,1); assert.equal(s.calls.filter(x=>x==='model.join').length,1);
  const intent=s.files.get('execution-intent.json'), final=s.files.get('execution-final.json'), terminal=s.files.get('execution-settlement.json');
  assert.equal(final.intentSha256,hash(intent)); assert.equal(terminal.observationSha256,hash(final));
  assert.equal(terminal.intentSha256,hash(intent)); assert.equal(terminal.remoteInferenceStopped,'NOT_OBSERVED');
  assert.equal(terminal.upgradesEarlierOutcome,false); assert.equal(terminal.authorizing,false);
});
test('construction never captures an unstarted host join or an idle model join', async () => {
  const s=setup();await tick();assert.deepEqual(s.calls,[]);
  await s.bridge.finish();assert.equal(s.calls.filter(x=>x==='model.join').length,1);
});
test('late host and model settlement cannot upgrade outward timeout or reacquire original joins', async () => {
  const h=deferred(),m=deferred(); let hs='SETTLING',ms='BUSY';
  const s=setup({hostJoin:h.promise,modelJoin:m.promise,hostStatus:()=>hs,modelStatus:()=>ms});
  s.bridge.interrupt(); const out=await s.bridge.finish(); const before=JSON.stringify(out), final=JSON.stringify(s.files.get('execution-final.json'));
  assert.equal(out.observation.status,'UNCONFIRMED'); assert.equal(out.late.state,'PENDING');
  assert.equal(s.files.has('execution-settlement.json'),false); assert.equal(s.calls.filter(x=>x==='revoke').length,1);
  hs='SETTLED';h.resolve({state:'SETTLED',raw:true}); await tick(); assert.equal(s.files.has('execution-settlement.json'),false);
  ms='OFF';m.resolve(); assert.equal((await s.bridge.lateSettled()).state,'RETAINED');
  assert.equal(JSON.stringify(out),before); assert.equal(JSON.stringify(s.files.get('execution-final.json')),final);
  assert.equal(s.files.get('execution-settlement.json').hostResult.value.raw,true);
  assert.equal(s.calls.filter(x=>x==='host.join').length,1); assert.equal(s.calls.filter(x=>x==='model.join').length,1);
});
test('host rejection and quarantine remain adverse after joins fulfill or reject', async () => {
  const h=deferred(); const s=setup({hostJoin:h.promise,hostStatus:()=> 'QUARANTINED',modelStatus:()=> 'QUARANTINED'});
  const done=s.bridge.finish();h.reject(coded('SYNTHETIC_HOST'));
  const out=await done; assert.equal(out.observation.status,'UNCONFIRMED');
  assert.equal(s.files.get('execution-settlement.json').outcomes[0].settlement,'REJECTED');
  assert.equal(s.files.get('execution-settlement.json').hostResult.availability,'UNAVAILABLE');
});
test('NEW host and rejected not-started join never synthesize a settled result', async () => {
  const h=deferred();const s=setup({hostJoin:h.promise,hostStatus:()=> 'NEW'});
  const done=s.bridge.finish(); h.reject(coded('REPOSITORY_HOST_NOT_STARTED'));
  assert.equal((await done).observation.status,'UNCONFIRMED');
  assert.equal(s.files.get('execution-settlement.json').hostResult.code,'REPOSITORY_HOST_NOT_STARTED');
});
test('interrupt during recheck serializes cancellation; revoke exactly once even when it throws', async () => {
  const h=deferred(); const s=setup({hostJoin:h.promise,revoke:()=>{throw coded('REVOKE_FAILED');}});
  const done=s.bridge.finish();await tick();s.bridge.interrupt();s.bridge.interrupt();h.resolve({state:'SETTLED'});
  const out=await done;assert.equal(s.controller.signal.aborted,true); assert.equal(out.observation.status,'UNCONFIRMED');
  assert.ok(out.observation.snapshot.owners.every(o=>o.error==='CANCEL_ERROR'));
  assert.equal(s.calls.filter(x=>x==='revoke').length,1);
});
test('initial write failures remain observable and do not suppress original owner joins', async () => {
  for(const file of ['execution-intent.json','execution-final.json','execution-settlement.json']) {
    const s=setup({failedWrites:[file]});const out=await s.bridge.finish();
    assert.equal(s.calls.filter(x=>x==='host.join').length,1); assert.equal(s.calls.filter(x=>x==='model.join').length,1);
    assert.equal(out.late.state,'UNRETAINED');assert.ok(out.late.errors.some(e=>e.stage===file));
    assert.equal(s.files.has('execution-settlement.json'),false);
  }
});
test('late write failure is retained in memory and notified, never unhandled or an upgraded earlier result', async () => {
  const h=deferred(),s=setup({hostJoin:h.promise,failedWrites:['execution-settlement.json']});
  const out=await s.bridge.finish(), before=JSON.stringify(out);h.resolve({state:'SETTLED'});
  const late=await s.bridge.lateSettled();assert.equal(late.state,'UNRETAINED');assert.equal(s.notices.at(-1).stage,'execution-settlement.json');
  assert.equal(JSON.stringify(out),before);assert.equal(out.observation.status,'UNCONFIRMED');
});
test('missing both raw and projected host evidence remains an explicit diagnostic failure', async () => {
  const s = setup({hostJoin: Promise.resolve({state: 'SETTLED', capability: () => {}})});
  const out = await s.bridge.finish();
  assert.deepEqual(out.late.errors.map(e => [e.stage, e.code]), [
    ['late.host-result', 'INPUT_VALUE_INVALID'], ['late.host-evidence', 'HOST_EVIDENCE_SCHEMA']]);
  const terminal = s.files.get('execution-settlement.json');
  assert.equal(terminal.schemaVersion, 'nisi-live-execution-settlement/v2');
  assert.equal(terminal.hostResult.availability, 'UNAVAILABLE');
  assert.equal(terminal.hostEvidence.availability, 'UNAVAILABLE');
});
