import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalChatAuthorAdapter} from '../adapters/local-chat.mjs';
test('two sequential requests cannot overlap an unsettled transport after timeout',{timeout:1000},async()=>{
  let calls=0;
  const adapter=createLocalChatAuthorAdapter({destination:'LOOPBACK_HTTP',endpoint:'http://127.0.0.1/chat',model:'fixture',id:'fixture.author',timeoutMs:10,
    fetch:()=>{calls++;return new Promise(()=>{});}});
  const payload={task:{allowedFiles:['x.json']},binding:{runId:'r',taskFingerprint:'a'.repeat(64),attempt:0,candidateFingerprint:null},acceptanceCriteria:['valid']};
  const causes=[];for(let i=0;i<2;i++){try{await adapter.draft(payload);}catch(e){causes.push(e.code);}}
  assert.equal(calls,1);assert.deepEqual(causes,['LOCAL_CHAT_TIMEOUT','LOCAL_CHAT_TRANSPORT_QUARANTINED']);
});
