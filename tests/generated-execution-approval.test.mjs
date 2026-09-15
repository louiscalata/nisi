// Fixed candidate STRINGS only. No generated code is imported or executed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewedLiveFixtureV1 } from '../examples/repository-task/reviewed-live-fixture-v1.mjs';
import { createCandidate } from '../workflow/contracts.mjs';
import { createCandidateReviewSessionV1, readIssuedCandidateReviewHandoffV1, consumeCandidateReviewHandoffV1, validateIssuedCandidateReviewConsumptionV1 } from '../hosts/repository/candidate-review-v1.mjs';
import { createGeneratedExecutionApprovalV1, readIssuedGeneratedExecutionApprovalV1 } from '../hosts/repository/generated-execution-approval-v1.mjs';
import { requireReviewedNodeSuiteV1 } from '../hosts/repository/node-suite-v1.mjs';
const denyFlags=['sourceExecuted','isolationVerified','executionAuthorized','modelOriginAttested','authorizing'];
async function context({origin='CURRENT_RUN',registered=false}={}) {
  const fixture=await createReviewedLiveFixtureV1(),base=fixture.preparations[0];
  const content=base.candidate.files[0].content.replace('input.retryLimit || 3',registered?'input.retryLimit ?? 3':'input.retryLimit == null ? 3 : input.retryLimit');
  const candidate={files:[{path:'retry-settings.mjs',content}]};
  let reviewTime=1000,approvalTime=1000,reviewHook=null,approvalHook=null;
  const clock=kind=>{const hook=kind==='review'?reviewHook:approvalHook;hook?.();return kind==='review'?reviewTime:approvalTime;};
  const reviewInput={suite:fixture.suite,repairResult:{status:'REPAIRED',candidate,evidence:{schemaVersion:1,
    runId:'9d21cc3d-a741-4107-97c9-4d4c6f6d674b',taskFingerprint:base.taskFingerprint,attempt:1,
    candidateFingerprint:createCandidate(candidate,{authorId:base.candidate.authorId}).fingerprint,
    baseCandidateFingerprint:base.candidateFingerprint,note:'Fixed null-default test string, not an inferred model result.'}},
    origin:{kind:origin,requestSha256:'a'.repeat(64),responseSha256:'b'.repeat(64)},
    policy:{reviewId:'review.test',reviewerId:'reviewer.host',expiresAtMs:2000}};
  const createReview=()=>createCandidateReviewSessionV1(reviewInput,()=>clock('review')),s=createReview();
  s.decide({packetFingerprint:s.packet.fingerprint,reviewerId:s.packet.reviewerId,verdict:'APPROVE_FOR_ISOLATION_REVIEW',rationale:'Fixed test assertion, not user consent.'});
  const p=s.packet,handoff=s.handoff(Object.fromEntries(['packetFingerprint','runId','attempt','taskFingerprint','candidateFingerprint','materializedFingerprint'].map(k=>[k,k==='packetFingerprint'?p.fingerprint:p[k]])));
  const scope={packetFingerprint:p.fingerprint,decisionFingerprint:handoff.decision.fingerprint,runId:p.runId,attempt:p.attempt,
    taskFingerprint:p.taskFingerprint,candidateFingerprint:p.candidateFingerprint,materializedFingerprint:p.materializedFingerprint,
    preparationFingerprint:p.preparationFingerprint,suiteFingerprint:p.suiteFingerprint,harnessSha256:p.harness.sha256,
    nodeRuntimeSha256:'c'.repeat(64),launcherSha256:'d'.repeat(64),profileSha256:'e'.repeat(64),executionId:'execution.test'};
  const input={handoff,scope,expiresAtMs:1800};
  return{fixture,s,handoff,scope,input,createReview,create:()=>createGeneratedExecutionApprovalV1(input,()=>clock('approval')),
    setReview:v=>{reviewTime=v;},setApproval:v=>{approvalTime=v;},
    reviewHook:fn=>{reviewHook=fn;},approvalHook:fn=>{approvalHook=fn;}};
}
const assertion=o=>({requestFingerprint:o.request.fingerprint,action:'APPROVE_ONE_ISOLATED_EXECUTION',actorId:'user.fixture',assertionId:'assertion.fixture',rationale:'Synthetic action assertion; not real permission.'});
const consume=o=>({requestFingerprint:o.request.fingerprint,scope:structuredClone(o.request.scope)});
const claim=h=>({packetFingerprint:h.packet.fingerprint,decisionFingerprint:h.decision.fingerprint,executionId:'execution.test'});

test('original live handoff and one-use approval preserve all nonauthority boundaries',async()=>{
  const c=await context(),o=c.create();assert.equal(readIssuedCandidateReviewHandoffV1(c.handoff),c.handoff);
  const d=o.decide(assertion(o));assert.equal(o.decide(structuredClone(assertion(o))),d);
  const result=o.consume(consume(o));assert.equal(result.reviewClaim.handoff,c.handoff);
  assert.equal(o.snapshot().state,'CONSUMED');assert.equal(result.request.basis,'TRUSTED_HOST_ASSERTIONS_ONLY');
  for(const v of [o.request,d,result,result.consumption,result.reviewClaim.receipt])for(const f of denyFlags)assert.equal(v[f],false);
  for(const f of ['userIdentityAttested','currentRunAttested'])assert.equal(result[f],false);
  assert.throws(()=>requireReviewedNodeSuiteV1(c.fixture.suite,c.handoff.preparation),{code:'NODE_SUITE_PREPARATION_NOT_REGISTERED'});
  assert.throws(()=>o.consume(consume(o)));assert.throws(()=>readIssuedCandidateReviewHandoffV1(c.handoff),{code:'CANDIDATE_HANDOFF_CONSUMED'});
  assert.throws(()=>c.create()); // No refund after a simulated downstream failure.
});
test('handoff claim itself is original-identity-bound and one-way',async()=>{
  const c=await context();const first=consumeCandidateReviewHandoffV1(c.handoff,claim(c.handoff));
  assert.equal(first.receipt.authorizing,false);assert.throws(()=>consumeCandidateReviewHandoffV1(c.handoff,claim(c.handoff)),{code:'CANDIDATE_HANDOFF_CONSUMED'});
});
for(const transform of [v=>({...v}),v=>structuredClone(v),v=>JSON.parse(JSON.stringify(v))])test('copied handoff is inert even with identical hashes',async()=>{
  const c=await context(),copy=transform(c.handoff);assert.throws(()=>readIssuedCandidateReviewHandoffV1(copy),{code:'CANDIDATE_HANDOFF_NOT_ISSUED'});
  assert.throws(()=>createGeneratedExecutionApprovalV1({...c.input,handoff:copy},()=>1000),{code:'CANDIDATE_HANDOFF_NOT_ISSUED'});
});
test('copied approval owner or request cannot impersonate the issued owner',async()=>{
  const c=await context(),o=c.create();assert.equal(readIssuedGeneratedExecutionApprovalV1(o).state,'PENDING');
  for(const copy of [{...o},structuredClone(o.request)])assert.throws(()=>readIssuedGeneratedExecutionApprovalV1(copy),{code:'EXECUTION_APPROVAL_NOT_ISSUED'});
});
test('two factories and changed execution IDs cannot reserve the same original handoff',async()=>{
  const c=await context(),o=c.create();c.input.scope.executionId='execution.other';assert.throws(c.create,{code:'EXECUTION_APPROVAL_ALREADY_RESERVED'});
  assert.equal(o.request.scope.executionId,'execution.test');assert.ok(Object.isFrozen(o.request.scope));
});
test('reentrant factory clock cannot issue a second approval owner',async()=>{
  const c=await context();let nested;
  c.approvalHook(()=>{c.approvalHook(null);try{nested=c.create();}catch(e){nested=e.code;}});
  const o=c.create();assert.equal(nested,'EXECUTION_APPROVAL_ALREADY_RESERVED');assert.equal(o.snapshot().state,'PENDING');
});
test('failed construction burns reservation instead of silently reissuing',async()=>{
  const c=await context();c.approvalHook(()=>{throw Error('private clock detail');});assert.throws(c.create,{code:'EXECUTION_APPROVAL_CLOCK'});
  c.approvalHook(null);assert.throws(c.create,{code:'EXECUTION_APPROVAL_ALREADY_RESERVED'});
});
for(const kind of ['RETAINED_OBSERVATION','REGISTERED'])test(`refuse ${kind} as new execution request`,async()=>{
  const c=await context(kind==='REGISTERED'?{registered:true}:{origin:kind});assert.throws(c.create,{code:'EXECUTION_APPROVAL_ORIGIN'});
});
for(const key of ['packetFingerprint','decisionFingerprint','runId','attempt','taskFingerprint','candidateFingerprint','materializedFingerprint','preparationFingerprint','suiteFingerprint','harnessSha256'])test(`creation binds ${key}`,async()=>{
  const c=await context();c.scope[key]=key==='attempt'?2:'f'.repeat(64);assert.throws(c.create,{code:'EXECUTION_APPROVAL_BINDING'});
});
for(const key of ['packetFingerprint','decisionFingerprint','runId','attempt','taskFingerprint','candidateFingerprint','materializedFingerprint','preparationFingerprint','suiteFingerprint','harnessSha256','nodeRuntimeSha256','launcherSha256','profileSha256','executionId'])test(`consume binds ${key}`,async()=>{
  const c=await context(),o=c.create();o.decide(assertion(o));const d=consume(o);d.scope[key]=key==='attempt'?2:key==='executionId'?'execution.other':'f'.repeat(64);
  assert.throws(()=>o.consume(d));assert.equal(o.snapshot().state,'APPROVED');assert.equal(o.consume(consume(o)).consumption.scope[key],o.request.scope[key]);
});
for(const key of ['nodeRuntimeSha256','launcherSha256','profileSha256','executionId'])test(`refuse malformed or newline ${key}`,async()=>{
  const c=await context();c.scope[key]+='\n';assert.throws(c.create);
});
test('extra and accessor fields are rejected without calling accessors',async()=>{
  const c=await context();let calls=0;
  assert.throws(()=>createGeneratedExecutionApprovalV1({...c.input,get scope(){calls++;return c.scope;}},()=>1000));assert.equal(calls,0);
  c.scope.extraAuthority=true;assert.throws(c.create);delete c.scope.extraAuthority;
  const o=c.create(),d=assertion(o);Object.defineProperty(d,'rationale',{get(){calls++;return 'x';},enumerable:true});assert.throws(()=>o.decide(d));assert.equal(calls,0);
});
for(const exp of [2001,1000,-0,NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER+1])test(`invalid approval expiry ${String(exp)}`,async()=>{
  const c=await context();c.input.expiresAtMs=exp;assert.throws(c.create);
});
test('approval may share review expiry, but refuses the exact boundary',async()=>{
  const c=await context();c.input.expiresAtMs=2000;const o=c.create();o.decide(assertion(o));c.setApproval(2000);assert.throws(()=>o.consume(consume(o)));assert.equal(o.snapshot().state,'EXPIRED');
});
for(const phase of ['pending','approved'])test(`approval expiry blocks ${phase} and backward time cannot revive`,async()=>{
  const c=await context(),o=c.create();if(phase==='approved')o.decide(assertion(o));c.setApproval(1800);
  assert.throws(()=>o.decide(assertion(o)));assert.throws(()=>o.consume(consume(o)));assert.equal(o.snapshot().state,'EXPIRED');
  c.setApproval(1700);assert.equal(o.snapshot().state,'INVALID_CLOCK');c.setApproval(1750);assert.equal(o.snapshot().state,'INVALID_CLOCK');
});
for(const bad of [999,-0,NaN,Infinity,1000.5,Number.MAX_SAFE_INTEGER+1])test(`invalid runtime clock ${String(bad)} is sticky`,async()=>{
  const c=await context(),o=c.create();o.decide(assertion(o));c.setApproval(bad);assert.throws(()=>o.consume(consume(o)),{code:'EXECUTION_APPROVAL_CLOCK'});
  c.setApproval(1100);assert.equal(o.snapshot().state,'INVALID_CLOCK');assert.equal(o.snapshot().consumption,null);
});
test('throwing runtime clock never leaks details or revives',async()=>{
  const c=await context(),o=c.create();c.approvalHook(()=>{throw Error('secret');});assert.throws(()=>o.decide(assertion(o)),{message:'EXECUTION_APPROVAL_CLOCK'});
  c.approvalHook(null);assert.equal(o.snapshot().state,'INVALID_CLOCK');
});
for(const phase of ['before-request','pending','approved'])for(const bad of ['revoke','expire','throw','backward'])test(`underlying review ${bad} at ${phase} is refused`,async()=>{
  const c=await context(),o=phase==='before-request'?null:c.create();if(phase==='approved')o.decide(assertion(o));
  if(bad==='revoke')c.s.revoke();if(bad==='expire')c.setReview(2000);if(bad==='backward')c.setReview(999);if(bad==='throw')c.reviewHook(()=>{throw Error('private');});
  if(o){assert.throws(()=>o.decide(assertion(o)));assert.throws(()=>o.consume(consume(o)));assert.equal(o.snapshot().state,'REVIEW_INVALID');assert.equal(o.snapshot().consumption,null);}
  else assert.throws(c.create);
});
test('reject, conflicting decisions and explicit revocation cannot consume',async()=>{
  for(const action of ['reject','conflict','revoke']){
    const c=await context(),o=c.create(),d=assertion(o);o.decide({...d,action:action==='reject'?'REJECT':d.action});
    if(action==='conflict')assert.throws(()=>o.decide({...d,rationale:'changed'}),{code:'EXECUTION_APPROVAL_CONFLICT'});if(action==='revoke')o.revoke();
    assert.throws(()=>o.consume(consume(o)));assert.equal(o.snapshot().consumption,null);assert.throws(c.create);
  }
});
test('approval consume callback reentrancy is refused while outer consume stays one-use',async()=>{
  const c=await context(),o=c.create();o.decide(assertion(o));let nested;
  c.approvalHook(()=>{c.approvalHook(null);try{o.consume(consume(o));}catch(e){nested=e.code;}});
  o.consume(consume(o));assert.equal(nested,'EXECUTION_APPROVAL_REENTRANT');assert.throws(()=>o.consume(consume(o)));
});
test('handoff clock reentrancy refuses a nested claim',async()=>{
  const c=await context();let nested;c.reviewHook(()=>{c.reviewHook(null);try{consumeCandidateReviewHandoffV1(c.handoff,claim(c.handoff));}catch(e){nested=e.code;}});
  consumeCandidateReviewHandoffV1(c.handoff,claim(c.handoff));assert.equal(nested,'CANDIDATE_HANDOFF_REENTRANT');
});
test('revocation during review guard prevents outer consume',async()=>{
  const c=await context(),o=c.create();o.decide(assertion(o));c.reviewHook(()=>{c.reviewHook(null);c.s.revoke();});
  assert.throws(()=>o.consume(consume(o)));assert.equal(o.snapshot().consumption,null);
  assert.equal(o.snapshot().reviewClaimed,false);
});
test('review revocation during post-claim approval clock prevents success without refund',async()=>{
  const c=await context(),o=c.create();o.decide(assertion(o));let checks=0;
  c.reviewHook(()=>{if(++checks===5)c.approvalHook(()=>{c.approvalHook(null);c.s.revoke();});});
  assert.throws(()=>o.consume(consume(o)));assert.equal(o.snapshot().consumption,null);assert.equal(o.snapshot().reviewClaimed,true);
  assert.throws(c.create);
});
test('expiry during decision capture prevents publication of a decision',async()=>{
  const c=await context(),o=c.create();let ticks=0;c.approvalHook(()=>{if(++ticks===3)c.setApproval(1800);});
  assert.throws(()=>o.decide(assertion(o)));assert.equal(o.snapshot().decision,null);
});
test('expiry during final handoff claim burns that claim but never returns successful consumption',async()=>{
  const c=await context(),o=c.create();o.decide(assertion(o));let checks=0;
  c.reviewHook(()=>{if(++checks===5)c.setApproval(1800);});
  assert.throws(()=>o.consume(consume(o)));assert.equal(o.snapshot().consumption,null);
  assert.throws(()=>consumeCandidateReviewHandoffV1(c.handoff,claim(c.handoff)),{code:'CANDIDATE_HANDOFF_CONSUMED'});
  assert.throws(c.create);assert.equal(o.snapshot().state,'EXPIRED');
});
for(const phase of ['decide','handoff','snapshot'])test(`source review ${phase} callback refuses nested session operation`,async()=>{
  const c=await context(),s=c.createReview();let nested;
  const d={packetFingerprint:s.packet.fingerprint,reviewerId:s.packet.reviewerId,verdict:'APPROVE_FOR_ISOLATION_REVIEW',rationale:'Fixed test only.'};
  const b=Object.fromEntries(['packetFingerprint','runId','attempt','taskFingerprint','candidateFingerprint','materializedFingerprint'].map(k=>[k,k==='packetFingerprint'?s.packet.fingerprint:s.packet[k]]));
  if(phase==='handoff')s.decide(d);
  const invoke=()=>phase==='decide'?s.decide(d):phase==='handoff'?s.handoff(b):s.snapshot();
  c.reviewHook(()=>{c.reviewHook(null);try{invoke();}catch(e){nested=e.code;}});
  invoke();assert.equal(nested,'CANDIDATE_REVIEW_REENTRANT');
});
test('post-claim source validator is identity-bound and has no clock callbacks',async()=>{
  const c=await context(),result=consumeCandidateReviewHandoffV1(c.handoff,claim(c.handoff));let calls=0;c.reviewHook(()=>{calls++;throw Error('must not be called');});
  assert.equal(validateIssuedCandidateReviewConsumptionV1(result,1000),result);assert.equal(calls,0);
  for(const copy of [{...result},structuredClone(result)])assert.throws(()=>validateIssuedCandidateReviewConsumptionV1(copy,1000),{code:'CANDIDATE_HANDOFF_CLAIM_NOT_ISSUED'});
  for(const t of [999,-0,NaN,Infinity,1000.5,2000])assert.throws(()=>validateIssuedCandidateReviewConsumptionV1(result,t));assert.equal(calls,0);
});
test('post-claim validator uses latest observed source state, not a fresh source clock',async()=>{
  const c=await context(),result=consumeCandidateReviewHandoffV1(c.handoff,claim(c.handoff));c.setReview(1100);c.s.snapshot();
  assert.throws(()=>validateIssuedCandidateReviewConsumptionV1(result,1000),{code:'CANDIDATE_HANDOFF_CLOCK'});
  assert.equal(validateIssuedCandidateReviewConsumptionV1(result,1100),result);c.s.revoke();
  assert.throws(()=>validateIssuedCandidateReviewConsumptionV1(result,1100),{code:'CANDIDATE_HANDOFF_REVOKED'});
});
for(const change of ['throw','backward','review-newer','expire'])test(`post-claim clock ${change} refuses success and preserves burn`,async()=>{
  const c=await context(),o=c.create();o.decide(assertion(o));let checks=0;
  c.reviewHook(()=>{if(++checks===5)c.approvalHook(()=>{
    c.approvalHook(null);
    if(change==='throw')throw Error('secret');if(change==='backward')c.setApproval(999);if(change==='expire')c.setApproval(1800);
    if(change==='review-newer'){c.setReview(1100);c.s.snapshot();}
  });});
  assert.throws(()=>o.consume(consume(o)));assert.equal(o.snapshot().reviewClaimed,true);assert.equal(o.snapshot().consumption,null);assert.throws(c.create);
});
test('later revocation cannot rewrite an already consumed historical receipt',async()=>{
  const c=await context(),o=c.create();o.decide(assertion(o));const out=o.consume(consume(o)),frozen=JSON.stringify(out.consumption);
  c.s.revoke();o.revoke();assert.equal(JSON.stringify(out.consumption),frozen);assert.equal(o.snapshot().state,'CONSUMED');assert.equal(o.snapshot().revoked,true);
  assert.equal(out.executionAuthorized,false);assert.throws(()=>o.consume(consume(o)));
  assert.throws(()=>validateIssuedCandidateReviewConsumptionV1(out.reviewClaim,1000),{code:'CANDIDATE_HANDOFF_REVOKED'});
});
test('source callback crossing approval expiry during issuance cannot return an owner',async()=>{
  const c=await context();let n=0;c.reviewHook(()=>{if(++n===2)c.setApproval(1800);});assert.throws(c.create);assert.throws(c.create);
});
test('source callback crossing approval expiry during final decision guard cannot publish a decision',async()=>{
  const c=await context(),o=c.create();let n=0;c.reviewHook(()=>{if(++n===2)c.setApproval(1800);});
  assert.throws(()=>o.decide(assertion(o)));assert.equal(o.snapshot().decision,null);
});
