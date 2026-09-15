import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {stableStringify} from '../workflow/contracts.mjs';
import {reviewRepositoryHistoryV1} from '../hosts/history/review-repository-history-v1.mjs';
import {createRepositoryWorkflowOwnerV1} from '../hosts/repository/reviewed-workflow-v1.mjs';
import {openJournalOwner} from '../history/journal-owner-v2.mjs';
import {context} from './helpers/node-repository-fixture.mjs';
import {fixedOptions} from './helpers/repository-run-fixture.mjs';
import {memfs} from './journal-owner-v2.memfs.mjs';
import {CONFIG, PATH, assertDeepFrozen} from './journal-owner-v2.helper.mjs';

const sha = s => createHash('sha256').update(s).digest('hex');
const RUN = '/synthetic/repository-run';
const RESULT_KEYS = ['schemaVersion','status','reason','sourceDigest','ownerOpenAttempted','captureCallAttempted','capture','cancelledAfterCaptureCall','authorizing'];
const stub = (key, fn) => ({[key]: fn, registrationFingerprint:'a'.repeat(64), settled:async()=>[], observations:()=>[], status:()=> 'IDLE', lateObservations:()=>[]});
const goodStatic = p => ({status:'PASS',evidence:{...p.binding,findings:[],reason:''}});
const goodTest = p => ({status:'PASS',evidence:{...p.binding,assertionsExecuted:1,assertionsPassed:1,failures:[],reason:''}});
async function fixture(t) {
  const c=await context(t), host=createRepositoryWorkflowOwnerV1({suite:c.suite,staticOwner:stub('check',goodStatic),testsOwner:stub('run',goodTest)});
  await host.run(fixedOptions(c)); await host.settled(); return {c,host};
}
function assertResult(r,status,reason){assert.deepEqual(Object.keys(r).sort(),RESULT_KEYS.sort());assert.equal(r.schemaVersion,'nisi-repository-history-review/v1');assert.equal(r.status,status);assert.equal(r.reason,reason);assert.equal(r.authorizing,false);assertDeepFrozen(r);}
function promptAnswer(p){return {kind:'answer',text:p.expectedAnswer};}
function base(host, extra={}) { return {host,runDirectory:RUN,clock:()=>100,prompt:promptAnswer,openOwner:()=>({status:'REFUSED'}),signal:null,promptTimeoutMs:1000,...extra}; }

test('actual settled host and memfs journal store one observation with exact declaration', async t=>{
  const {host}=await fixture(t), m=memfs(); let opened, declaration, promptInput;
  const trusted={historyPreview:host.historyPreview,captureHistory(input){declaration=input.declaration;return host.captureHistory(input);}};
  const r=await reviewRepositoryHistoryV1(base(trusted,{prompt:p=>{promptInput=p;return promptAnswer(p);},openOwner:req=>{opened=req;return openJournalOwner({...req,fs:m.fs});}}));
  assertResult(r,'STORED',null); assert.equal(r.ownerOpenAttempted,true);assert.equal(r.captureCallAttempted,true);assert.equal(r.cancelledAfterCaptureCall,false);
  assert.deepEqual(opened,{path:`${RUN}/history-journal.jsonl`,config:{projectId:`task:${host.historyPreview().preview.taskFingerprint}`,maxEntries:32,heartbeatTtlMs:30000,redactPaths:[]},now:100});
  assert.deepEqual(declaration,{schemaVersion:'nisi-repository-history-declaration/v1',declarationId:declaration.declarationId,projectId:opened.config.projectId,sourceDigest:r.sourceDigest,issuedAt:100,expiresAt:60100,createdAt:100,retentionMs:1209600000,consentClass:'WRITTEN_DECLARATION',destination:'LOCAL_OBSERVATION_JOURNAL_ONLY',rawContentPersisted:false,networkEgress:false,learningInfluence:false});
  assert.match(declaration.declarationId,/^cli-history\.[0-9a-f-]{36}$/); assert.equal(promptInput.expectedAnswer,`STORE ${r.sourceDigest}`);
  assert.equal(Object.isFrozen(promptInput),true);
  assert.equal(Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get.call(promptInput.signal),true,
    'the completed review aborts its owned prompt signal to clean up late input');
  assertDeepFrozen(opened); assertDeepFrozen(declaration);
  assert.equal(r.capture.recordAttempted,true);assert.equal(r.capture.consumed,true);assert.ok(m.bytes(`${RUN}/history-journal.jsonl`));
});

test('prompt contains required warnings and escaped metadata, never raw controls', async t=>{
  const {host}=await fixture(t); let text; const r=await reviewRepositoryHistoryV1(base(host,{prompt:p=>{text=p.text;return {kind:'answer',text:'no'};}}));
  assertResult(r,'NOT_STORED','DECLINED'); for(const word of ['14','NO automatic','not authenticated','already retained','learning','publication']) assert.match(text,new RegExp(word,'i')); assert.equal(text.includes('\u001b'),false);
});

test('all prompt refusal outcomes happen before owner open', async t=>{
  const {host}=await fixture(t); const cases=[[{kind:'answer',text:''},'DECLINED'],[{kind:'answer',text:'n'},'DECLINED'],[{kind:'answer',text:'NO'},'ANSWER_MISMATCH'],[{kind:'answer',text:' STORE x'},'ANSWER_MISMATCH'],[{kind:'eof'},'EOF'],[{kind:'timeout'},'TIMEOUT'],[{kind:'no-tty'},'NO_TTY'],[{kind:'signal'},'ABORTED'],[{kind:'error'},'PROMPT_ERROR'],[null,'PROMPT_ERROR']];
  for(const [answer,reason] of cases){let opens=0;const r=await reviewRepositoryHistoryV1(base(host,{prompt:()=>answer,openOwner:()=>{opens++;}}));assertResult(r,'NOT_STORED',reason);assert.equal(opens,0);}
  const thrown=await reviewRepositoryHistoryV1(base(host,{prompt:()=>{throw Error('secret')}}));assertResult(thrown,'NOT_STORED','PROMPT_ERROR');
});

test('invalid envelopes, paths, timeout, native signal and callback getters refuse without callbacks', async t=>{
  const {host}=await fixture(t); let calls=0; const p=()=>{calls++;};
  for(const change of [{runDirectory:'/'},{runDirectory:'relative'},{runDirectory:'/bad\0x'},{promptTimeoutMs:0},{promptTimeoutMs:120001},{signal:{}},{extra:true}]){
    const r=await reviewRepositoryHistoryV1({...base(host,{prompt:p}),...change});assertResult(r,'NOT_STORED','INVALID_INPUT');
  }
  const getter={...base(host)};Object.defineProperty(getter,'prompt',{get(){throw Error('getter');}});const r=await reviewRepositoryHistoryV1(getter);assertResult(r,'NOT_STORED','INVALID_INPUT');assert.equal(calls,0);
});

test('unavailable, malformed, and digest-invalid previews refuse before prompt', async()=>{
  const body={}; const unavailable={historyPreview:()=>({schemaVersion:'nisi-repository-history-preview/v1',status:'REFUSED',reason:'NO_SETTLED_RESULT',preview:null,sha256:null,authorizing:false}),captureHistory(){}};
  let prompts=0;assertResult(await reviewRepositoryHistoryV1(base(unavailable,{prompt:()=>prompts++})),'NOT_STORED','PREVIEW_UNAVAILABLE');
  for(const value of [null,{},{schemaVersion:'nisi-repository-history-preview/v1',status:'PREVIEW',reason:null,preview:body,sha256:'0'.repeat(64),authorizing:false}]){const h={historyPreview:()=>value,captureHistory(){}};assertResult(await reviewRepositoryHistoryV1(base(h,{prompt:()=>prompts++})),'NOT_STORED','PREVIEW_INVALID');} assert.equal(prompts,0);
});

test('digest drift after exact answer refuses before opening owner', async t=>{
  const {host}=await fixture(t), first=host.historyPreview(), second=structuredClone(first); second.preview.runId='f'.repeat(32);second.sha256=sha('nisi/repository-history-preview/v1\0'+stableStringify(second.preview));let n=0,opens=0;
  const h={historyPreview:()=>n++?second:first,captureHistory:host.captureHistory};const r=await reviewRepositoryHistoryV1(base(h,{openOwner:()=>opens++}));assertResult(r,'NOT_STORED','DIGEST_CHANGED');assert.equal(opens,0);
});

test('invalid clock and owner refusal have precise attempted flags', async t=>{
  const {host}=await fixture(t); for(const clock of [()=>NaN,()=>Number.MAX_SAFE_INTEGER]){const r=await reviewRepositoryHistoryV1(base(host,{clock}));assertResult(r,'NOT_STORED','INVALID_CLOCK');assert.equal(r.ownerOpenAttempted,false);}
  const r=await reviewRepositoryHistoryV1(base(host));assertResult(r,'NOT_STORED','OPEN_FAILED');assert.equal(r.ownerOpenAttempted,true);assert.equal(r.captureCallAttempted,false);
});

test('abort before and during prompt prevents owner open despite suppressed listeners', async t=>{
  const {host}=await fixture(t), pre=new AbortController();pre.abort();let prompts=0;let r=await reviewRepositoryHistoryV1(base(host,{signal:pre.signal,prompt:()=>prompts++}));assertResult(r,'NOT_STORED','ABORTED');assert.equal(prompts,0);
  const c=new AbortController();c.signal.addEventListener('abort',e=>e.stopImmediatePropagation());r=await reviewRepositoryHistoryV1(base(host,{signal:c.signal,prompt:p=>{c.abort();return promptAnswer(p);}}));assertResult(r,'NOT_STORED','ABORTED');assert.equal(r.ownerOpenAttempted,false);
});

test('synthetic abort and overridden signal instance members cannot forge or intercept state', async t=>{
  const {host}=await fixture(t), c=new AbortController(); let touched=0; for(const k of ['aborted','reason','addEventListener','removeEventListener'])Object.defineProperty(c.signal,k,{get(){touched++;throw Error(k)}});
  c.signal.dispatchEvent(new Event('abort'));const r=await reviewRepositoryHistoryV1(base(host,{signal:c.signal,prompt:()=>({kind:'answer',text:'no'})}));assertResult(r,'NOT_STORED','DECLINED');assert.equal(touched,0);
});

test('final wrapped-clock abort prevents admission; post-call abort preserves valid capture and flags', async t=>{
  const {host}=await fixture(t), m=memfs(), c=new AbortController();let clocks=0;
  const r=await reviewRepositoryHistoryV1(base(host,{signal:c.signal,clock:()=>{if(++clocks===2)c.abort();return 100;},openOwner:req=>openJournalOwner({...req,fs:m.fs})}));
  assert.equal(r.captureCallAttempted,true);assert.equal(r.cancelledAfterCaptureCall,true);assert.equal(r.capture?.recordAttempted,false);
  const c2=new AbortController(), m2=memfs(); let actual;
  const h={historyPreview:host.historyPreview,captureHistory(input){actual=host.captureHistory(input);c2.abort();return actual;}};
  const r2=await reviewRepositoryHistoryV1(base(h,{signal:c2.signal,openOwner:req=>openJournalOwner({...req,fs:m2.fs})}));
  assert.equal(r2.capture,actual);assert.equal(r2.status,'STORED');assert.equal(r2.reason,null);assert.equal(actual.recordAttempted,true);assert.equal(r2.cancelledAfterCaptureCall,true);
});

test('capture throw or malformed return is uncertain without fabricated capture fields', async t=>{
  const {host}=await fixture(t);for(const captureHistory of [()=>{throw Error('secret')},()=>null,()=>({status:'STORED'})]){const h={historyPreview:host.historyPreview,captureHistory};const r=await reviewRepositoryHistoryV1(base(h,{openOwner:req=>openJournalOwner({...req,fs:memfs().fs})}));assertResult(r,'UNCERTAIN','CAPTURE_UNCONFIRMED');assert.equal(r.captureCallAttempted,true);assert.equal(r.capture,null);}
});

test('same-host overlap is busy while different host remains independent and guard releases', async t=>{
  const {host}=await fixture(t);let release;const wait=new Promise(r=>release=r);const first=reviewRepositoryHistoryV1(base(host,{prompt:()=>wait}));await new Promise(r=>setImmediate(r));const busy=await reviewRepositoryHistoryV1(base(host));assertResult(busy,'NOT_STORED','REVIEW_BUSY');release({kind:'answer',text:'no'});assertResult(await first,'NOT_STORED','DECLINED');assertResult(await reviewRepositoryHistoryV1(base(host,{prompt:()=>({kind:'answer',text:'no'})})),'NOT_STORED','DECLINED');
});

test('owned outer deadline resolves a non-settling prompt, aborts its inner signal, and never opens owner', async t=>{
  const {host}=await fixture(t); let inner, opens=0;
  const r=await reviewRepositoryHistoryV1(base(host,{promptTimeoutMs:5,prompt:p=>{inner=p.signal;return new Promise(()=>{});},openOwner:()=>{opens++;}}));
  assertResult(r,'NOT_STORED','TIMEOUT');assert.equal(opens,0);
  assert.equal(Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get.call(inner),true);
});

test('native abort during openOwner prevents capture after the admitted open callback', async t=>{
  const {host}=await fixture(t), c=new AbortController(), m=memfs();let captures=0;
  const trusted={historyPreview:host.historyPreview,captureHistory(input){captures++;return host.captureHistory(input);}};
  const r=await reviewRepositoryHistoryV1(base(trusted,{signal:c.signal,openOwner:req=>{const opened=openJournalOwner({...req,fs:m.fs});c.abort();return opened;}}));
  assertResult(r,'NOT_STORED','ABORTED');assert.equal(r.ownerOpenAttempted,true);assert.equal(r.captureCallAttempted,false);assert.equal(captures,0);
});

test('rendered destination escapes ESC, C1, and bidi controls without changing the selected path', async t=>{
  const {host}=await fixture(t);const runDirectory='/synthetic/esc\u001b-c1\u0085-bidi\u202e-root';let promptText,opened;
  const r=await reviewRepositoryHistoryV1(base(host,{runDirectory,prompt:p=>{promptText=p.text;return {kind:'answer',text:'no'};},openOwner:req=>{opened=req;}}));
  assertResult(r,'NOT_STORED','DECLINED');assert.equal(opened,undefined);
  for(const raw of ['\u001b','\u0085','\u202e'])assert.equal(promptText.includes(raw),false);
  for(const escaped of ['\\u001b','\\u0085','\\u202e'])assert.equal(promptText.includes(escaped),true);
  assert.match(promptText,/history-journal\\u002ejsonl|history-journal\.jsonl/);
});

test('abort in the LAST capture clock cannot enter record even when earlier clock was valid', async t=>{
  const {host}=await fixture(t),c=new AbortController(),m=memfs();let clocks=0;
  const r=await reviewRepositoryHistoryV1(base(host,{signal:c.signal,
    clock:()=>{if(++clocks===3)c.abort();return 100;},openOwner:req=>openJournalOwner({...req,fs:m.fs})}));
  assert.equal(clocks,3);assert.equal(r.captureCallAttempted,true);assert.equal(r.cancelledAfterCaptureCall,true);
  assert.equal(r.capture.reason,'INVALID_CLOCK');assert.equal(r.capture.recordAttempted,false);
  assert.equal(r.capture.consumed,false);assert.equal(m.bytes(`${RUN}/history-journal.jsonl`),undefined);
});
