import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalChatAuthorAdapter,createLocalChatReviewerAdapter,createLocalChatTransportOwner} from '../adapters/local-chat.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const task={allowedFiles:['x.json']};
const payload=signal=>({task,candidate:null,acceptanceCriteria:['valid'],binding:{runId:'r',taskFingerprint:'a'.repeat(64),attempt:0,candidateFingerprint:null},signal});
const config=(fetch,more={})=>({destination:'LOOPBACK_HTTP',endpoint:'http://127.0.0.1/chat',model:'test-model',id:'test.author',timeoutMs:20,fetch,...more});
const response=()=>new Response(JSON.stringify({model:'test-model',choices:[{finish_reason:'stop',message:{content:JSON.stringify({candidate:{files:[{path:'x.json',content:'{}'}]},note:'draft'})}}]}));

test('timeout returns promptly but unresolved fetch keeps capacity quarantined',async()=>{
  let resolve,calls=0;const adapter=createLocalChatAuthorAdapter(config(()=>{calls++;return new Promise(r=>{resolve=r;});}));
  await assert.rejects(adapter.draft(payload()),{code:'LOCAL_CHAT_TIMEOUT'});
  const receipt=adapter.receipts()[0];assert.equal(receipt.lifecycle.transportSettlement,'UNKNOWN');
  assert.equal(adapter.lifecycle().state,'QUARANTINED');assert.equal(adapter.lifecycle().pendingTransports,1);
  await assert.rejects(adapter.draft(payload()),{code:'LOCAL_CHAT_TRANSPORT_QUARANTINED'});assert.equal(calls,1);
  resolve(response());await tick();await tick();
  assert.equal(adapter.lifecycle().pendingTransports,0);
  // Local settlement cannot attest remote inference stopped or silently reset the owner.
  assert.equal(adapter.lifecycle().state,'QUARANTINED');assert.equal(receipt.lifecycle.transportSettlement,'UNKNOWN');
  await assert.rejects(adapter.draft(payload()),{code:'LOCAL_CHAT_TRANSPORT_QUARANTINED'});assert.equal(calls,1);
});
test('shared owner excludes overlapping adapters and STOP aborts without claiming drain',async t=>{
  const owner=createLocalChatTransportOwner();let reject,calls=0;
  const fetch=()=>{calls++;return new Promise((_,r)=>{reject=r;});};
  const a=createLocalChatAuthorAdapter(config(fetch,{transportOwner:owner,timeoutMs:1000}));
  const b=createLocalChatReviewerAdapter(config(fetch,{transportOwner:owner,id:'test.reviewer'}));
  const result=a.draft(payload());
  result.catch(()=>{});
  t.after(async()=>{owner.stop();reject?.(Error('test cleanup'));await result.catch(()=>{});});
  await assert.rejects(b.review(payload()),{code:'LOCAL_CHAT_TRANSPORT_BUSY'});
  owner.stop();await assert.rejects(result,{code:'LOCAL_CHAT_OWNER_STOPPED'});
  assert.equal(owner.status().state,'STOPPED_DRAINING');assert.equal(calls,1);
  reject(Error('late rejection'));await tick();
  assert.equal(owner.status().state,'STOPPED');
  await assert.rejects(a.draft(payload()),{code:'LOCAL_CHAT_OWNER_STOPPED'});
});
test('body cancellation is observed; pending cancellation is not local settlement',async()=>{
  let finishRead,finishCancel;
  const reader={read:()=>new Promise(r=>{finishRead=r;}),cancel:()=>new Promise(r=>{finishCancel=r;}),releaseLock(){}};
  const adapter=createLocalChatAuthorAdapter(config(async()=>({ok:true,body:{getReader:()=>reader}})));
  await assert.rejects(adapter.draft(payload()),{code:'LOCAL_CHAT_TIMEOUT'});
  finishRead({done:true});await tick();assert.equal(adapter.lifecycle().pendingTransports,1);
  finishCancel();await tick();await tick();assert.equal(adapter.lifecycle().pendingTransports,0);
  assert.equal(adapter.lifecycle().state,'QUARANTINED');
});
test('normal completion is reusable; pre-abort has no transport and no quarantine',async()=>{
  let calls=0;const adapter=createLocalChatAuthorAdapter(config(async()=>{calls++;return response();},{timeoutMs:1000}));
  const c=new AbortController();c.abort();await assert.rejects(adapter.draft(payload(c.signal)),{code:'ABORTED'});
  assert.equal(adapter.lifecycle().state,'IDLE');assert.equal(calls,0);
  await adapter.draft(payload());await adapter.draft(payload());assert.equal(calls,2);
  assert.equal(adapter.receipts()[1].lifecycle.transportSettlement,'CONFIRMED');assert.equal(adapter.lifecycle().state,'IDLE');
  assert.throws(()=>createLocalChatAuthorAdapter(config(async()=>response(),{transportOwner:{}})),{code:'LOCAL_CHAT_OWNER_INVALID'});
});
