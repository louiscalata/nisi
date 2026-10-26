// Pure, deterministic status canaries. No I/O, models or owner mutation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { liveModelOwnerStatusV1, liveHostOwnerStatusV1 } from '../hosts/repository/live-owner-status-v1.mjs';

test('model status preserves quarantine even when stopped or still draining', () => {
  for (const state of ['IDLE','BUSY','DRAINING','STOPPED_DRAINING','STOPPED','QUARANTINED']) {
    for (const pendingTransports of [0,1])
      assert.equal(liveModelOwnerStatusV1({state,pendingTransports,recoveryRequired:true}),'QUARANTINED');
  }
  assert.equal(liveModelOwnerStatusV1({state:'QUARANTINED',pendingTransports:0,recoveryRequired:false}),'QUARANTINED');
});
test('pending or active model work never maps to idle or off', () => {
  for (const state of ['IDLE','BUSY','DRAINING','STOPPED_DRAINING','STOPPED'])
    assert.equal(liveModelOwnerStatusV1({state,pendingTransports:1,recoveryRequired:false}),'BUSY');
  for (const state of ['BUSY','DRAINING','STOPPED_DRAINING'])
    assert.equal(liveModelOwnerStatusV1({state,pendingTransports:0,recoveryRequired:false}),'BUSY');
});
test('only valid quiescent model states map to idle/off, with snapshot extras preserved', () => {
  for (const [state,expected] of [['IDLE','IDLE'],['STOPPED','OFF']]) {
    const input=Object.freeze({state,pendingTransports:0,recoveryRequired:false,remoteInferenceStopped:'NOT_OBSERVED'});
    assert.equal(liveModelOwnerStatusV1(input),expected);assert.equal(input.remoteInferenceStopped,'NOT_OBSERVED');
  }
  assert.equal(liveModelOwnerStatusV1(Object.assign(Object.create(null),{state:'IDLE',pendingTransports:0,recoveryRequired:false})),'IDLE');
});
test('malformed model snapshots fail closed without invoking required-field getters', () => {
  const valid={state:'IDLE',pendingTransports:0,recoveryRequired:false};let getterCalls=0;
  const bad=[null,undefined,[],new Date(),Object.create(valid),{}, {...valid,state:'OFF'}, {...valid,recoveryRequired:0}];
  for(const pendingTransports of [-1,0.1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'0']) bad.push({...valid,pendingTransports});
  for(const key of Object.keys(valid)) {
    const missing={...valid};delete missing[key];bad.push(missing);
    bad.push(Object.defineProperty({...valid},key,{enumerable:true,get(){getterCalls++;return valid[key];}}));
    bad.push(Object.defineProperty({...valid},key,{value:valid[key],enumerable:false}));
  }
  for(const input of bad) assert.throws(()=>liveModelOwnerStatusV1(input),{code:'LIVE_EXECUTION_MODEL_STATE'});
  assert.equal(getterCalls,0);
});
test('unstarted/running host is busy, settled is idle, quarantine stays adverse', () => {
  for(const state of ['NEW','RUNNING','SETTLING']) assert.equal(liveHostOwnerStatusV1(state),'BUSY');
  assert.equal(liveHostOwnerStatusV1('SETTLED'),'IDLE');assert.equal(liveHostOwnerStatusV1('QUARANTINED'),'QUARANTINED');
  for(const input of [undefined,null,{},'OFF','IDLE','SETTLED ']) assert.throws(()=>liveHostOwnerStatusV1(input),{code:'LIVE_EXECUTION_HOST_STATE'});
});
