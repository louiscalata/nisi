// PRIVATE single-process approval assertions. No process/filesystem/model work.
// The trusted host supplies user-consent assertions and tool hashes. Neither
// user identity, current-run provenance nor isolation is attested by this module.
import { randomUUID } from 'node:crypto';
import { cloneFreeze } from '../../workflow/contracts.mjs';
import { exact, digest } from '../../integrity/record-utils.mjs';
import { readIssuedCandidateReviewHandoffV1, validateIssuedCandidateReviewHandoffV1, consumeCandidateReviewHandoffV1, validateIssuedCandidateReviewConsumptionV1 } from './candidate-review-v1.mjs';
const issued = new WeakSet(), reserved = new WeakSet();
const fail = code => { throw Object.assign(new Error(code), {code}); };
const full = (value, re) => typeof value === 'string' && re.exec(value)?.[0] === value;
const id = v => full(v, /^[a-z][a-z0-9_.-]{0,95}$/u), hash = v => full(v, /^[a-f0-9]{64}$/u);
const time = v => Number.isSafeInteger(v) && v >= 0 && !Object.is(v,-0);
const note = v => typeof v === 'string' && v.isWellFormed() && v.trim().length > 0 && !v.includes('\0') && Buffer.byteLength(v) <= 4096;
const flags = Object.freeze({sourceExecuted:false,isolationVerified:false,executionAuthorized:false,
  userIdentityAttested:false,currentRunAttested:false,modelOriginAttested:false,authorizing:false});
const scopeKeys = ['packetFingerprint','decisionFingerprint','runId','attempt','taskFingerprint','candidateFingerprint',
  'materializedFingerprint','preparationFingerprint','suiteFingerprint','harnessSha256',
  'nodeRuntimeSha256','launcherSha256','profileSha256','executionId'];
function validateScope(scope, handoff) {
  exact(scope,scopeKeys,'EXECUTION_APPROVAL_SCOPE');
  const p=handoff.packet;
  const expected={packetFingerprint:p.fingerprint,decisionFingerprint:handoff.decision.fingerprint,
    runId:p.runId,attempt:p.attempt,taskFingerprint:p.taskFingerprint,candidateFingerprint:p.candidateFingerprint,
    materializedFingerprint:p.materializedFingerprint,preparationFingerprint:p.preparationFingerprint,
    suiteFingerprint:p.suiteFingerprint,harnessSha256:p.harness.sha256};
  for(const[k,v]of Object.entries(expected))if(scope[k]!==v)fail('EXECUTION_APPROVAL_BINDING');
  for(const k of ['nodeRuntimeSha256','launcherSha256','profileSha256'])if(!hash(scope[k]))fail('EXECUTION_APPROVAL_TOOLS');
  if(!id(scope.executionId))fail('EXECUTION_APPROVAL_SCOPE');
}
export function createGeneratedExecutionApprovalV1(input, now=Date.now) {
  exact(input,['handoff','scope','expiresAtMs'],'EXECUTION_APPROVAL_SCHEMA');
  if(typeof now!=='function')fail('EXECUTION_APPROVAL_CLOCK');
  const handoff=readIssuedCandidateReviewHandoffV1(input.handoff);
  const {scope,expiresAtMs}=cloneFreeze({scope:input.scope,expiresAtMs:input.expiresAtMs});
  validateScope(scope,handoff);
  if(handoff.packet.origin.kind!=='CURRENT_RUN'||handoff.packet.alreadyRegistered)fail('EXECUTION_APPROVAL_ORIGIN');
  if(!time(expiresAtMs)||expiresAtMs>handoff.packet.expiresAtMs)fail('EXECUTION_APPROVAL_EXPIRY');
  if(reserved.has(handoff))fail('EXECUTION_APPROVAL_ALREADY_RESERVED');
  // Reserve before the caller's clock can reenter. A failed issuance needs a fresh
  // review session, not reuse of an ambiguous handoff.
  reserved.add(handoff);
  let createdAtMs;
  try{createdAtMs=now();}catch{fail('EXECUTION_APPROVAL_CLOCK');}
  if(!time(createdAtMs)||createdAtMs<handoff.packet.createdAtMs||createdAtMs>=expiresAtMs)fail('EXECUTION_APPROVAL_CLOCK');
  readIssuedCandidateReviewHandoffV1(handoff);
  let finalIssuedAtMs;
  try{finalIssuedAtMs=now();}catch{fail('EXECUTION_APPROVAL_CLOCK');}
  if(!time(finalIssuedAtMs)||finalIssuedAtMs<createdAtMs||finalIssuedAtMs>=expiresAtMs)fail('EXECUTION_APPROVAL_CLOCK');
  validateIssuedCandidateReviewHandoffV1(handoff,finalIssuedAtMs);
  const body=cloneFreeze({schemaVersion:'nisi-generated-execution-request-v1',issuanceId:randomUUID(),
    clockDomain:'UNIX_EPOCH_MILLISECONDS_NONDECREASING',scope,createdAtMs,expiresAtMs,
    requiredAction:'APPROVE_ONE_ISOLATED_EXECUTION',basis:'TRUSTED_HOST_ASSERTIONS_ONLY',
    nextBoundary:'ACCEPTED_ISOLATION_AND_LIVE_EXECUTION_OWNER_REQUIRED',...flags});
  const request=cloneFreeze({...body,fingerprint:digest('nisi/generated-execution-request/v1',body)});
  let state='PENDING',revoked=false,decision=null,decisionInput=null,lastTime=finalIssuedAtMs,busy=false,consumption=null,reviewClaimed=false;
  function tick(){
    if(state==='INVALID_CLOCK')fail('EXECUTION_APPROVAL_CLOCK');
    let t;try{t=now();}catch{state='INVALID_CLOCK';fail('EXECUTION_APPROVAL_CLOCK');}
    if(!time(t)||t<lastTime){state='INVALID_CLOCK';fail('EXECUTION_APPROVAL_CLOCK');}lastTime=t;
    if(t>=expiresAtMs&&!['CONSUMED','REVOKED','REJECTED','CONFLICT'].includes(state))state='EXPIRED';
    return t;
  }
  function guard(expected){
    tick();if(revoked||state!==expected||lastTime>=expiresAtMs)fail('EXECUTION_APPROVAL_STATE');
    try{readIssuedCandidateReviewHandoffV1(handoff);}catch(error){state='REVIEW_INVALID';fail('EXECUTION_APPROVAL_REVIEW_INVALID');}
    tick();if(revoked||state!==expected||lastTime>=expiresAtMs)fail('EXECUTION_APPROVAL_STATE');
    try{validateIssuedCandidateReviewHandoffV1(handoff,lastTime);}catch{state='REVIEW_INVALID';fail('EXECUTION_APPROVAL_REVIEW_INVALID');}
  }
  function operation(fn){if(busy)fail('EXECUTION_APPROVAL_REENTRANT');busy=true;try{return fn();}finally{busy=false;}}
  const owner=Object.freeze({request,
    decide(raw){return operation(()=>{
      const d=cloneFreeze(raw);exact(d,['requestFingerprint','action','actorId','assertionId','rationale'],'EXECUTION_APPROVAL_DECISION');
      tick();const fp=digest('nisi/generated-execution-decision-input/v1',d);
      if(decision&&!revoked&&lastTime<expiresAtMs&&['APPROVED','REJECTED'].includes(state)){
        if(fp!==decisionInput){state='CONFLICT';fail('EXECUTION_APPROVAL_CONFLICT');}
        guard(state);return decision;
      }
      guard('PENDING');
      if(d.requestFingerprint!==request.fingerprint||!['APPROVE_ONE_ISOLATED_EXECUTION','REJECT'].includes(d.action)||
        !id(d.actorId)||!id(d.assertionId)||!note(d.rationale))fail('EXECUTION_APPROVAL_DECISION');
      const value={schemaVersion:'nisi-generated-execution-decision-v1',...d,decidedAtMs:lastTime,basis:'TRUSTED_HOST_USER_ACTION_ASSERTION',...flags};
      const capture=cloneFreeze({...value,fingerprint:digest('nisi/generated-execution-decision/v1',value)});
      guard('PENDING');decision=capture;decisionInput=fp;state=d.action==='REJECT'?'REJECTED':'APPROVED';return decision;
    });},
    consume(raw){return operation(()=>{
      const expected=cloneFreeze(raw);exact(expected,['requestFingerprint','scope'],'EXECUTION_APPROVAL_CONSUME');
      guard('APPROVED');validateScope(expected.scope,handoff);
      if(expected.requestFingerprint!==request.fingerprint||digest('nisi/generated-execution-scope/v1',expected.scope)!==digest('nisi/generated-execution-scope/v1',scope))fail('EXECUTION_APPROVAL_CONSUME');
      guard('APPROVED');
      const claimed=consumeCandidateReviewHandoffV1(handoff,{packetFingerprint:scope.packetFingerprint,
        decisionFingerprint:scope.decisionFingerprint,executionId:scope.executionId});
      // The source clock is a callback boundary too. Expiry/clock failure during
      // that final claim must not publish success. The underlying one-use claim
      // stays burned; reviewClaimed records the loss without granting a retry.
      reviewClaimed=true;
      tick();if(revoked||state!=='APPROVED'||lastTime>=expiresAtMs)fail('EXECUTION_APPROVAL_STATE');
      const body={schemaVersion:'nisi-generated-execution-consumption-v1',requestFingerprint:request.fingerprint,
        decisionFingerprint:decision.fingerprint,scope,consumedAtMs:lastTime,...flags};
      const capture=cloneFreeze({...body,fingerprint:digest('nisi/generated-execution-consumption/v1',body)});
      tick();if(revoked||state!=='APPROVED'||lastTime>=expiresAtMs)fail('EXECUTION_APPROVAL_STATE');
      // No callback may follow this source-state check before publication.
      try{validateIssuedCandidateReviewConsumptionV1(claimed,lastTime);}catch{state='REVIEW_INVALID';fail('EXECUTION_APPROVAL_REVIEW_INVALID');}
      state='CONSUMED';consumption=capture;
      // Inspectable data only. A future launcher must retain this original owner,
      // verify actual isolation/current run and consume immediately at its launch seam.
      return Object.freeze({request,decision,consumption,reviewClaim:claimed,...flags});
    });},
    revoke(){return operation(()=>{revoked=true;try{tick();}catch{}if(['PENDING','APPROVED'].includes(state))state='REVOKED';});},
    snapshot(){return operation(()=>{
      try{tick();}catch{}
      if(['PENDING','APPROVED','REJECTED'].includes(state))try{guard(state);}catch{}
      return cloneFreeze({schemaVersion:'nisi-generated-execution-state-v1',requestFingerprint:request.fingerprint,
        state,revoked,reviewClaimed,decision,consumption,lastObservedAtMs:lastTime,...flags});
    });},
  });issued.add(owner);return owner;
}
export function readIssuedGeneratedExecutionApprovalV1(owner){
  if(!issued.has(owner))fail('EXECUTION_APPROVAL_NOT_ISSUED');return owner.snapshot();
}
