// PRIVATE redacted companion evidence. Hashes bind bytes, never authenticate a
// provider, reproduce original owner capabilities, or authorize replay.
import {types} from 'node:util';
import {stableStringify,sha256Text,cloneFreeze,RUN_OUTCOMES} from '../workflow/contracts.mjs';
import {record as readExact} from '../evaluation/intake-v1.mjs';
import {decideExecutionAdmission} from '../hosts/repository/execution-admission-v1.mjs';

export const SIDECAR_LIMITS=Object.freeze({maxRecords:4096,maxRecordBytes:1048576,maxBytes:16777216});
const fail=()=>{throw Object.assign(Error('ARM_SIDECAR_INVALID'),{code:'ARM_SIDECAR_INVALID'});};
const check=ok=>{if(!ok)fail();};
const exact=(value,keys)=>{try{return readExact(value,keys);}catch{fail();}};
const digest=x=>check(typeof x==='string'&&/^[a-f0-9]{64}$/u.test(x));
const natural=x=>check(Number.isSafeInteger(x)&&x>=0&&!Object.is(x,-0));
const uuid=x=>check(typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(x));
const code=x=>check(x===null||typeof x==='string'&&/^[A-Z][A-Z0-9_]{0,95}$/u.test(x));
const pick=(x,keys)=>Object.fromEntries(keys.map(k=>[k,x[k]]));
export const armSidecarDigestV1=value=>sha256Text('nisi/paired-arm-data/v1\0'+stableStringify(bounded(value)));
const equal=(a,b)=>stableStringify(a)===stableStringify(b);
const phases=['EXECUTOR','ORACLE'];

// Snapshot before reflection or serialization; reject accessors, proxies, cycles,
// unsupported scalars and hidden data. No truncation or implicit toJSON calls.
function bounded(value,depth=0,seen=new WeakSet(),budget={nodes:0,bytes:0}){
  check(++budget.nodes<=8192&&depth<=16);
  if(typeof value==='string'){
    check(value.isWellFormed()&&value.length<=4096);budget.bytes+=Buffer.byteLength(value);check(budget.bytes<=524288);return value;
  }
  if(value===null||typeof value==='boolean')return value;
  if(typeof value==='number'){check(Number.isFinite(value)&&!Object.is(value,-0));return value;}
  check(value&&typeof value==='object'&&!types.isProxy(value)&&!seen.has(value));seen.add(value);
  const keys=Reflect.ownKeys(value);check(keys.length<=257);
  let out;
  if(Array.isArray(value)){
    const length=Object.getOwnPropertyDescriptor(value,'length')?.value;
    check(Number.isSafeInteger(length)&&length<=256&&keys.length===length+1);
    out=[];for(let i=0;i<length;i++){
      const d=Object.getOwnPropertyDescriptor(value,String(i));check(d?.enumerable&&Object.hasOwn(d,'value'));
      Object.defineProperty(out,i,{value:bounded(d.value,depth+1,seen,budget),enumerable:true,writable:true,configurable:true});
    }
  }else{
    check([Object.prototype,null].includes(Object.getPrototypeOf(value)));out=Object.create(null);
    for(const k of keys){
      check(typeof k==='string'&&k.length<=96&&!['candidateText','prompt','messages','sourceCode','apiKey'].includes(k));
      const d=Object.getOwnPropertyDescriptor(value,k);check(d?.enumerable&&Object.hasOwn(d,'value'));
      Object.defineProperty(out,k,{value:bounded(d.value,depth+1,seen,budget),enumerable:true,writable:true,configurable:true});
    }
  }
  seen.delete(value);return out;
}
function reference(value){const r=exact(value,['sequence','sha256']);natural(r.sequence);digest(r.sha256);}
function approval(value){
  const a=exact(value,['id','ownerId','planSha256','profileSha256','expiresAtMs','priority']);
  for(const k of ['id','ownerId'])check(typeof a[k]==='string'&&/^[a-z][a-z0-9_.-]{0,95}$/u.test(a[k]));
  digest(a.planSha256);digest(a.profileSha256);natural(a.expiresAtMs);check(a.expiresAtMs>0&&['FOREGROUND','BACKGROUND'].includes(a.priority));
}
function observation(value,at,approved,decision){
  natural(at);approval(approved);
  const o=exact(value,['consent','scheduler','capacity','host','custody']);
  const c=exact(o.consent,['id','ownerId','planSha256','profileSha256','grantedAtMs','expiresAtMs','revoked','scope']);
  for(const key of ['id','ownerId','planSha256','profileSha256'])check(c[key]===approved[key]);
  natural(c.grantedAtMs);natural(c.expiresAtMs);check(c.grantedAtMs<=at&&at<c.expiresAtMs&&at<approved.expiresAtMs);
  const s=exact(o.scheduler,['decision','observedAtMs','freshnessMs','queueState']);
  const m=exact(o.capacity,['configuredSlots','measuredFreeSlots','measuredAtMs','freshnessMs']);
  const h=exact(o.host,['state','pendingTransports','observedAtMs']);
  const custody=exact(o.custody,['taskSha256','baselineSha256','oracleSha256','suiteFingerprint',
    'reviewedSourceFingerprint','toolchainSha256','resourceBudgetSha256','observedAtMs','freshnessMs']);
  for(const [key,v] of Object.entries(custody))if(!['observedAtMs','freshnessMs'].includes(key))digest(v);
  for(const [time,span] of [[s.observedAtMs,s.freshnessMs],[m.measuredAtMs,m.freshnessMs],[h.observedAtMs,5000],[custody.observedAtMs,custody.freshnessMs]]){
    natural(time);natural(span);check(span>0&&span<=5000&&time<=at&&at-time<span);
  }
  const expected=decideExecutionAdmission({now:at,consent:pick(c,['grantedAtMs','expiresAtMs','revoked','scope']),
    scheduler:s,capacity:m,host:h,request:pick(approved,['priority','ownerId'])});
  check(expected.status==='ADMIT'&&equal(expected,decision));
}
function projection(p){
  exact(p,['fingerprint','intentSha256','inputsSha256','repositoryRunId','reportSha256','repositoryReceiptFingerprint','repositoryReceiptStatus',
    'engineOutcome','workflowOutcome','completionClaim','candidate','treatment','usage']);
  for(const k of ['fingerprint','intentSha256','inputsSha256','reportSha256','repositoryReceiptFingerprint'])digest(p[k]);uuid(p.repositoryRunId);
  check(['INCOMPLETE','CONSISTENT_NO_PROGRESS','SCOPED_LIVE_REPAIR_REVIEW_PASS','SYNTHETIC_CONTRACT_PASS'].includes(p.repositoryReceiptStatus));
  check(RUN_OUTCOMES.includes(p.engineOutcome)&&RUN_OUTCOMES.includes(p.workflowOutcome));
  check(typeof p.completionClaim==='boolean'&&p.completionClaim===(p.engineOutcome==='COMPLETED'));
  const c=exact(p.candidate,['serializationProfile','candidateFingerprint','candidateSha256','byteLength']);
  check(c.serializationProfile==='nisi-workflow-stable-json-v1');digest(c.candidateFingerprint);digest(c.candidateSha256);natural(c.byteLength);check(c.byteLength<=1048576);
  const t=exact(p.treatment,['arm','treatmentFingerprint','policySha256','applicationPoint','requestInspection',
    'localDispatch','systemPromptSha256','modelUseAttested','effectiveness']);
  check(['OFF','ON'].includes(t.arm));digest(t.treatmentFingerprint);digest(t.policySha256);
  for(const k of ['applicationPoint','requestInspection','localDispatch'])check(typeof t[k]==='string'&&t[k].length>0);
  if(t.systemPromptSha256!==null)digest(t.systemPromptSha256);check(t.modelUseAttested===false&&t.effectiveness==='NOT_MEASURED');
  const u=exact(p.usage,['sourceKind','projectedTokens','projectedModelCalls','durationMs','durationSource']);
  check(['SYNTHETIC_FIXTURE','VALIDATED_REPORTED_COUNTERS'].includes(u.sourceKind)&&u.durationMs===null&&u.durationSource==='NOT_MEASURED');
  if(u.projectedTokens!==null){exact(u.projectedTokens,['input','output']);natural(u.projectedTokens.input);natural(u.projectedTokens.output);}
  if(u.projectedModelCalls!==null)natural(u.projectedModelCalls);
  if(u.sourceKind==='SYNTHETIC_FIXTURE')check(u.projectedTokens===null&&u.projectedModelCalls===null);
}
const shapes={
  HEADER:['runnerId','planSha256','profileSha256','intentsSha256'],
  PREPARED:['requestId','ownerSetId','phase','intentSha256','producerFingerprint','approval','inputsSha256','observedAtMs','observation','decision'],
  HISTORY:['requestId','ownerSetId','intentSha256','producerFingerprint','disposition','state','failure','entries','approval'],
  START_LINKED:['requestId','ownerSetId','phase','preparedSha256'],
  PHASE_OBSERVED:['requestId','ownerSetId','phase','startSha256','historySha256','projection'],
  FINAL:['rows','failure'],
};
export function readArmSidecarRecordV1(raw){
  const x=bounded(raw);check(typeof x?.kind==='string'&&Object.hasOwn(shapes,x.kind));
  exact(x,['kind','main',...shapes[x.kind]]);reference(x.main);
  if(x.kind==='HEADER'){
    check(x.main.sequence===0);uuid(x.runnerId);for(const k of ['planSha256','profileSha256','intentsSha256'])digest(x[k]);
  }else if(x.kind==='FINAL'){
    code(x.failure);check(Array.isArray(x.rows)&&x.rows.length>0&&x.rows.length<=256);const ids=new Set();
    for(const row of x.rows){exact(row,['requestId','state']);digest(row.requestId);check(!ids.has(row.requestId));ids.add(row.requestId);
      check(['NOT_STARTED','PREPARED_UNCONFIRMED','STARTED_INCOMPLETE','EXECUTOR_OBSERVED','COMPLETE'].includes(row.state));}
  }else{
    digest(x.requestId);uuid(x.ownerSetId);if(Object.hasOwn(x,'phase'))check(phases.includes(x.phase));
    for(const k of ['intentSha256','producerFingerprint','inputsSha256','preparedSha256','startSha256','historySha256'])if(Object.hasOwn(x,k))digest(x[k]);
    if(x.kind==='PREPARED')observation(x.observation,x.observedAtMs,x.approval,x.decision);
    if(x.kind==='HISTORY'){
      approval(x.approval);code(x.state);code(x.failure);
      check(['POST_PHASE_LOCAL_OBSERVATIONS','FINAL_LOCAL_OBSERVATIONS'].includes(x.disposition));
      check(Array.isArray(x.entries)&&x.entries.length>0&&x.entries.length<=4);
      for(const row of x.entries){exact(row,['phase','point','generation','observation','decision','observedAtMs']);
        check(phases.includes(row.phase)&&['PERMIT_MINTED','CONSUMPTION_RECHECK_PASSED'].includes(row.point));natural(row.generation);
        observation(row.observation,row.observedAtMs,x.approval,row.decision);}
    }
    if(x.kind==='PHASE_OBSERVED'){if(x.phase==='EXECUTOR')projection(x.projection);else check(x.projection===null);}
  }
  return cloneFreeze(x);
}
export function encodeArmSidecarRecordV1(raw,ordinal,previousSha256){
  const record=readArmSidecarRecordV1(raw);natural(ordinal);check(ordinal<SIDECAR_LIMITS.maxRecords);
  if(ordinal===0)check(previousSha256===null&&record.kind==='HEADER');else {digest(previousSha256);check(record.kind!=='HEADER');}
  const body={schemaVersion:'nisi-paired-arm-sidecar-chain-v1',ordinal,previousSha256,record,
    authorizing:false,resumable:false,actualDispatchCount:null};
  const sha256=sha256Text('nisi/paired-arm-sidecar-chain/v1\0'+stableStringify(body));
  const bytes=Buffer.from(stableStringify({...body,sha256})+'\n');check(bytes.length<=SIDECAR_LIMITS.maxRecordBytes);
  return {record,sha256,bytes};
}
export function decodeArmSidecarRecordV1(bytes,ordinal,previousSha256){
  check(Buffer.isBuffer(bytes)&&bytes.length<=SIDECAR_LIMITS.maxRecordBytes&&Buffer.from(bytes.toString('utf8')).equals(bytes));
  let parsed;try{parsed=JSON.parse(bytes.toString('utf8'));}catch{fail();}
  const x=exact(parsed,['schemaVersion','ordinal','previousSha256','record','authorizing','resumable','actualDispatchCount','sha256']);
  const expected=encodeArmSidecarRecordV1(x.record,ordinal,previousSha256);check(expected.bytes.equals(bytes));return expected;
}

// Original producer fingerprint is checked BEFORE redaction. The retained
// fingerprint is a reference to discarded raw metadata, not reopened authority.
const producerFlags=['sourceTrust','actualDispatchCount','resumable','authorizing',
  'executionAttested','measurementVerified','publicationAuthorized','fingerprint'];
const producerShapes={
  'nisi-scheduled-arm-admission-v1':['schemaVersion','disposition','ownerSetId','phase','intent',
    'inputs','approval','observation','decision','observedAtMs','ownerKinds',...producerFlags],
  'nisi-scheduled-arm-admission-history-v1':['schemaVersion','disposition','ownerSetId','intent',
    'history','state','failure',...producerFlags],
  'nisi-repository-trial-projection-v2':['schemaVersion','intent','inputs','repositoryRunId',
    'reportSha256','repositoryReceiptFingerprint','repositoryReceiptStatus','repositoryReceiptReasons',
    'engineOutcome','workflowOutcome','completionClaim','completionClaimSource','candidate','treatment',
    'usage','oracleEvaluated','modelAuthenticityAttested','executionAttested','measurementVerified',
    'causalClaim','authorizing','promotionEligible','resumable','fingerprint'],
};
function producer(raw,domain,schema){
  const x=exact(bounded(raw),producerShapes[schema]);check(x.schemaVersion===schema);digest(x.fingerprint);
  const {fingerprint,...body}=x;check(fingerprint===sha256Text(domain+'\0'+stableStringify(body)));
  for(const key of ['authorizing','resumable','executionAttested','measurementVerified'])check(x[key]===false);
  return x;
}
export function projectArmAdmissionV1(raw,main,approved=null){
  const history=raw!==null&&typeof raw==='object'&&!types.isProxy(raw)
    &&Object.getOwnPropertyDescriptor(raw,'schemaVersion')?.value==='nisi-scheduled-arm-admission-history-v1';
  const x=producer(raw,'nisi/scheduled-arm-admission/v1',history?'nisi-scheduled-arm-admission-history-v1':'nisi-scheduled-arm-admission-v1');
  check(x.publicationAuthorized===false&&x.actualDispatchCount===null&&x.sourceTrust==='TRUSTED_HOST_OBSERVATIONS_NOT_ATTESTED');
  if(!history)check(x.disposition==='PRE_DISPATCH_INTENT_ONLY'&&equal(x.ownerKinds,
    ['host','staticChecks','tests','lane','model.author','model.reviewer','oracle']));
  const common={main,requestId:x.intent.requestId,ownerSetId:x.ownerSetId,intentSha256:armSidecarDigestV1(x.intent),producerFingerprint:x.fingerprint};
  return readArmSidecarRecordV1(history?{kind:'HISTORY',...common,disposition:x.disposition,state:x.state,failure:x.failure,entries:x.history,approval:approved}
    :{kind:'PREPARED',...common,phase:x.phase,approval:x.approval,inputsSha256:armSidecarDigestV1(x.inputs),
      observedAtMs:x.observedAtMs,observation:x.observation,decision:x.decision});
}
export function projectArmProjectionV1(raw){
  const x=producer(raw,'nisi/repository-trial-projection/v2','nisi-repository-trial-projection-v2');
  for(const key of ['oracleEvaluated','modelAuthenticityAttested','causalClaim','promotionEligible'])check(x[key]===false);
  check(x.completionClaimSource==='ENGINE_OUTCOME_LABEL_COMPLETED_V1');
  const out={intentSha256:armSidecarDigestV1(x.intent),inputsSha256:armSidecarDigestV1(x.inputs),
    ...pick(x,['fingerprint','repositoryRunId','reportSha256','repositoryReceiptFingerprint','repositoryReceiptStatus',
    'engineOutcome','workflowOutcome','completionClaim','candidate','treatment']),
    usage:pick(x.usage,['sourceKind','projectedTokens','projectedModelCalls','durationMs','durationSource'])};
  projection(out);return cloneFreeze(out);
}
