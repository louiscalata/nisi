// PRIVATE bridge from original scheduled intents to fresh V4 execution/oracle
// owners. Trusted callbacks must be bounded/cooperative and already authorized
// for source/runtime/platform access. This is not OS consent or a global lock.
// Retained records never recreate permits; failures cannot allocate replacements.
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { types } from 'node:util';
import { record } from '../../evaluation/intake-v1.mjs';
import { readPreventionExperimentPlanV1 } from '../../evaluation/prevention-experiment-plan-v1.mjs';
import { readPreventionExecutionProfileV1 } from '../../evaluation/prevention-execution-profile-v1.mjs';
import { readScheduledPairedTrialIntentV1,readOriginalPairedTrialEventV1 } from '../../evaluation/paired-trial-runner-v1.mjs';
import { cloneFreeze,stableStringify,sha256Text } from '../../workflow/contracts.mjs';
import { decideExecutionAdmission } from './execution-admission-v1.mjs';
import { readIssuedLiveModelLaneIdentityV4,readIssuedLiveModelLaneV4 } from './reviewed-live-model-v4.mjs';
import { readIssuedRepositoryWorkflowIdentityV1,readIssuedRepositoryWorkflowOwnerV1 } from './reviewed-workflow-v1.mjs';
import { readIssuedRepositoryTrialOracleV1 } from './paired-trial-oracle-v1.mjs';
import { checkRepositoryTrialIntentV2,projectRepositoryTrialV2 } from './paired-trial-projection-v2.mjs';
import { startRepositoryTrialOperationV1 } from './paired-trial-operation-v1.mjs';

const claimed = new WeakSet();
const same = (a,b) => stableStringify(a) === stableStringify(b);
const hash = value => sha256Text('nisi/scheduled-arm-admission/v1\0'+stableStringify(value));
const error = code => Object.assign(Error(code),{code});
const integer = v => Number.isSafeInteger(v) && v >= 0 && !Object.is(v,-0);
const terminal = state => state === 'IDLE' || state === 'OFF';

export function createRepositoryPairedArmOwnerV1(input) {
  const x = record(input,['plan','profile','approval','now','observe','reserve','retain','retainAdmission']);
  const plan = readPreventionExperimentPlanV1(x.plan);
  const profile = readPreventionExecutionProfileV1(x.profile,plan.planSha256,plan.policy);
  const approval = cloneFreeze(record(x.approval,['id','ownerId','planSha256','profileSha256','expiresAtMs','priority']));
  if (![approval.id,approval.ownerId].every(v=>typeof v==='string' && /^[a-z][a-z0-9_.-]{0,95}$/u.exec(v)?.[0]===v) ||
      approval.planSha256!==plan.planSha256 || approval.profileSha256!==profile.profileSha256 ||
      !integer(approval.expiresAtMs) || approval.expiresAtMs===0 || !['FOREGROUND','BACKGROUND'].includes(approval.priority) ||
      ['now','observe','reserve','retain','retainAdmission'].some(k=>typeof x[k]!=='function')) throw error('RUNNER_ARM_CONFIGURATION');
  const clock=x.now,observe=x.observe,reserve=x.reserve,write=x.retain,writeAdmission=x.retainAdmission;
  const rows = new Map(); let runnerId=null,schedule=null,cursor=0,busy=false,closed=false,failure=null,lastWall=null,lastSequence=-1;
  const fail = code => { failure ??= code; throw error(code); };
  function active() { if(failure) throw error(failure); if(closed) fail('RUNNER_ARM_CLOSED'); }
  function enter(allowFinal=false) {
    if(busy) fail('RUNNER_ARM_REENTRANT');
    if(!allowFinal) active();
    busy=true;
  }
  function abort(reason) {
    const code=reason && typeof reason==='object' ? Object.getOwnPropertyDescriptor(reason,'code')?.value : null;
    failure ??= typeof code==='string' && /^RUNNER_[A-Z_]+$/u.exec(code)?.[0]===code ? code : 'RUNNER_ARM_CALLBACK';
    throw error(failure);
  }
  function wall() {
    const value=Reflect.apply(clock,undefined,[]); active();
    if(!integer(value) || lastWall!==null && value<lastWall) fail('RUNNER_ARM_CLOCK');
    lastWall=value; if(value>=approval.expiresAtMs) fail('RUNNER_ARM_APPROVAL_EXPIRED'); return value;
  }
  function original(intent) {
    const issued=readScheduledPairedTrialIntentV1(intent);
    if(!runnerId || intent.runnerId!==runnerId || issued.plan.planSha256!==plan.planSha256 ||
        issued.profile.profileSha256!==profile.profileSha256) fail('RUNNER_ARM_INTENT');
    return issued;
  }
  function freshness(at,span,now) {
    if(!integer(at) || at>now || !integer(span) || span<1 || span>5000 || now-at>=span) fail('RUNNER_ARM_STALE_OBSERVATION');
  }
  function ownersReady(row,phase) {
    if(!row.owners) return;
    const {host,lane,oracle}=row.owners;
    const h=readIssuedRepositoryWorkflowOwnerV1(host), l=readIssuedLiveModelLaneV4(lane).snapshot;
    const o=readIssuedRepositoryTrialOracleV1(oracle); active();
    if(Object.values(h.ownerStates).some(s=>s!=='IDLE') || l.lifecycle.pendingTransports!==0 || l.lifecycle.recoveryRequired ||
        o.state!=='NEW') fail('RUNNER_ARM_OWNER_NOT_READY');
    if(phase==='EXECUTOR') {
      if(h.state!=='NEW' || l.phase!=='NEW' || l.revoked || l.lifecycle.state!=='IDLE') fail('RUNNER_ARM_OWNER_NOT_READY');
    } else {
      if(h.state!=='SETTLED' || !l.revoked || l.lifecycle.state!=='STOPPED' ||
          row.executorResult!=='FULFILLED' || row.executorSettlement!=='FULFILLED' ||
          !terminal(row.executorOperation.status()) || !row.executorRetained) fail('RUNNER_ARM_OWNER_NOT_READY');
      active();
    }
    if(l.approval.id!==approval.id || wall()>=l.approval.expiresAtMs) fail('RUNNER_ARM_LANE_APPROVAL');
  }
  function fresh(row,phase) {
    const first=wall();
    const observation=cloneFreeze(record(Reflect.apply(observe,undefined,[Object.freeze({intent:row.intent,phase,now:first})]),
      ['consent','scheduler','capacity','host','custody'])); active();
    const now=wall(), c=record(observation.consent,['id','ownerId','planSha256','profileSha256','grantedAtMs','expiresAtMs','revoked','scope']);
    if(c.id!==approval.id || c.ownerId!==approval.ownerId || c.planSha256!==plan.planSha256 ||
        c.profileSha256!==profile.profileSha256 || !integer(c.grantedAtMs) || c.grantedAtMs>now ||
        !integer(c.expiresAtMs)) fail('RUNNER_ARM_CONSENT_BINDING');
    freshness(observation.scheduler.observedAtMs,observation.scheduler.freshnessMs,now);
    freshness(observation.capacity.measuredAtMs,observation.capacity.freshnessMs,now);
    freshness(observation.host.observedAtMs,5000,now);
    const custody=record(observation.custody,['taskSha256','baselineSha256','oracleSha256','suiteFingerprint',
      'reviewedSourceFingerprint','toolchainSha256','resourceBudgetSha256','observedAtMs','freshnessMs']);
    freshness(custody.observedAtMs,custody.freshnessMs,now);
    for(const k of ['taskSha256','baselineSha256','oracleSha256','toolchainSha256','resourceBudgetSha256'])
      if(custody[k]!==row.intent[k]) fail('RUNNER_ARM_SOURCE_BINDING');
    if(row.description) for(const k of ['suiteFingerprint','reviewedSourceFingerprint'])
      if(custody[k]!==row.description[k]) fail('RUNNER_ARM_SOURCE_BINDING');
    const decision=decideExecutionAdmission({now,consent:{grantedAtMs:c.grantedAtMs,expiresAtMs:c.expiresAtMs,revoked:c.revoked,scope:c.scope},
      scheduler:observation.scheduler,capacity:observation.capacity,host:observation.host,
      request:{priority:approval.priority,ownerId:approval.ownerId}});
    if(decision.status!=='ADMIT') fail('RUNNER_ARM_ADMISSION_REFUSED');
    ownersReady(row,phase); active();
    const last=wall();
    // External status/clock callbacks must not extend freshness or consent.
    freshness(observation.scheduler.observedAtMs,observation.scheduler.freshnessMs,last);
    freshness(observation.capacity.measuredAtMs,observation.capacity.freshnessMs,last);
    freshness(observation.host.observedAtMs,5000,last); freshness(custody.observedAtMs,custody.freshnessMs,last);
    if(last>=c.expiresAtMs) fail('RUNNER_ARM_CONSENT_EXPIRED');
    row.observation=observation; row.decision=decision; row.observedAtMs=last;
  }
  function claim(row) {
    // A failed factory consumes this scheduled reservation; no retry can replace it.
    const raw=Reflect.apply(reserve,undefined,[row.intent]); active();
    if(types.isPromise(raw)) { Promise.prototype.then.call(raw,()=>{},()=>{}); fail('RUNNER_ARM_ASYNC_FACTORY'); }
    const owned=record(raw,['host','lane','oracle']);
    function spend(identities) {
      for(const value of identities) {
        if(!value || typeof value!=='object' || claimed.has(value)) fail('RUNNER_ARM_OWNER_REUSED');
        claimed.add(value);
      }
    }
    // Spend returned top-level identities before any fallible owner inspection.
    // Then discover children without callbacks and spend them before live status.
    // Partial failures never roll back claims, even across controller instances.
    spend([owned.host,owned.lane,owned.oracle]);
    const h=readIssuedRepositoryWorkflowIdentityV1(owned.host);
    spend([h.staticOwner,h.testsOwner]);
    const models=readIssuedLiveModelLaneIdentityV4(owned.lane).executionOwners;
    if(models.length!==2) fail('RUNNER_ARM_OWNER_REUSED');
    spend(models);
    const l=readIssuedLiveModelLaneV4(owned.lane);
    const o=readIssuedRepositoryTrialOracleV1(owned.oracle); active();
    row.owners=Object.freeze(owned); row.description=checkRepositoryTrialIntentV2(row.intent,owned.lane);
    if(h.suite!==l.suite || o.state!=='NEW' || o.binding.requestId!==row.intent.requestId ||
        o.binding.profileSha256!==row.intent.profileSha256 || o.binding.oracleSha256!==row.intent.oracleSha256)
      fail('RUNNER_ARM_OWNER_BINDING');
    for(const k of ['taskSha256','baselineSha256','suiteFingerprint','reviewedSourceFingerprint'])
      if(o.binding[k]!==row.description[k]) fail('RUNNER_ARM_OWNER_BINDING');
  }
  function verifyInputs(intent) {
    enter();
    try {
      original(intent); let row=rows.get(intent.requestId);
      if(!row) {
        if(schedule[cursor]!==intent.requestId) fail('RUNNER_ARM_ORDER');
        row={intent,ownerSetId:randomUUID(),state:'RESERVED',owners:null,description:null,barrier:null,permit:null,
          executorRetained:false,executorResult:'NOT_STARTED',executorSettlement:'NOT_STARTED',
          oracleResult:'NOT_STARTED',oracleSettlement:'NOT_STARTED',projection:null,admissionHistory:[],historyRetained:0};
        rows.set(intent.requestId,row); fresh(row,'EXECUTOR'); claim(row); fresh(row,'EXECUTOR');
      } else if(row.intent!==intent) fail('RUNNER_ARM_INTENT');
      const phase=row.state==='RESERVED'?'EXECUTOR':row.state==='EXECUTOR_RETAINED'?'ORACLE':null;
      if(!phase) fail('RUNNER_ARM_PHASE');
      fresh(row,phase);
      if(row.barrier) {
        if(!row.barrier.acknowledged || row.barrier.phase!==phase || row.permit) fail('RUNNER_ARM_BARRIER');
        // No await or external callback between final verification and mint.
        row.permit=Object.freeze({intent,phase,ownerSetId:row.ownerSetId,generation:row.barrier.sequence,armedAt:performance.now()});
        row.state=phase+'_ARMED';
        captureAdmission(row,phase,'PERMIT_MINTED');
      }
      return true;
    } catch(e) { abort(e); } finally { busy=false; }
  }
  function consume(row,phase) {
    if(!row || row.state!==phase+'_ARMED' || !row.permit || row.permit.intent!==row.intent ||
        row.permit.phase!==phase || row.permit.ownerSetId!==row.ownerSetId ||
        row.permit.generation!==row.barrier?.sequence) fail('RUNNER_ARM_PERMIT');
    const permit=row.permit; row.permit=null; row.state=phase+'_STARTING';
    if(performance.now()-permit.armedAt>=Math.min(5000,profile[phase==='EXECUTOR'?'executorTimeoutMs':'oracleTimeoutMs'])) fail('RUNNER_ARM_PERMIT_EXPIRED');
    fresh(row,phase); active();
    captureAdmission(row,phase,'CONSUMPTION_RECHECK_PASSED');
  }
  function observeOperation(row,phase,operation) {
    const prefix=phase==='EXECUTOR'?'executor':'oracle'; row[prefix+'Operation']=operation; row.state=phase+'_RUNNING';
    Promise.prototype.then.call(operation.result,value=>{
      row[prefix+'Result']='FULFILLED'; row[prefix+'Value']=value;
      if(phase==='EXECUTOR') { row.projection=row.provisional; row.provisional=null; }
    },()=>{ row[prefix+'Result']='REJECTED'; row.provisional=null; });
    Promise.prototype.then.call(operation.settled,()=>{row[prefix+'Settlement']='FULFILLED';},()=>{row[prefix+'Settlement']='REJECTED';});
    return operation;
  }
  function startExecutor(intent) {
    enter();
    try {
      original(intent); const row=rows.get(intent.requestId); consume(row,'EXECUTOR');
      const operation=startRepositoryTrialOperationV1({host:row.owners.host,lane:row.owners.lane,
        projectResult(report,hostResult) {
          const result=projectRepositoryTrialV2({report,hostResult,lane:row.owners.lane,intent,description:row.description});
          row.provisional=result.evidence; return result.executor;
        }});
      return observeOperation(row,'EXECUTOR',operation);
    } catch(e) { abort(e); } finally { busy=false; }
  }
  function startOracle(input) {
    enter();
    try {
      const request=cloneFreeze(record(input,['requestId','oracleSha256','candidateSha256','candidateText']));
      const row=rows.get(request.requestId); original(row?.intent);
      if(!row.executorRetained || request.oracleSha256!==row.intent.oracleSha256 ||
          request.candidateSha256!==row.executorValue?.candidateSha256 || request.candidateText!==row.executorValue?.candidateText)
        fail('RUNNER_ARM_ORACLE_CANDIDATE');
      consume(row,'ORACLE');
      return observeOperation(row,'ORACLE',row.owners.oracle.start(request));
    } catch(e) { abort(e); } finally { busy=false; }
  }
  function admissionRecord(row,phase) {
    const identity=cloneFreeze({schemaVersion:'nisi-scheduled-arm-admission-v1',disposition:'PRE_DISPATCH_INTENT_ONLY',
      ownerSetId:row.ownerSetId,phase,intent:row.intent,inputs:row.description,approval,
      observation:row.observation,decision:row.decision,observedAtMs:row.observedAtMs,
      ownerKinds:['host','staticChecks','tests','lane','model.author','model.reviewer','oracle'],
      sourceTrust:'TRUSTED_HOST_OBSERVATIONS_NOT_ATTESTED',actualDispatchCount:null,resumable:false,
      authorizing:false,executionAttested:false,measurementVerified:false,publicationAuthorized:false});
    return cloneFreeze({...identity,fingerprint:hash(identity)});
  }
  function captureAdmission(row,phase,point) {
    // Locally observed decisions, never server execution attestation. There are
    // at most two entries per phase; retained after the phase or on FINAL.
    row.admissionHistory.push(cloneFreeze({phase,point,generation:row.barrier.sequence,
      observation:row.observation,decision:row.decision,observedAtMs:row.observedAtMs}));
  }
  function admissionHistory(row,disposition) {
    const identity=cloneFreeze({schemaVersion:'nisi-scheduled-arm-admission-history-v1',disposition,
      ownerSetId:row.ownerSetId,intent:row.intent,history:row.admissionHistory,state:row.state,failure,
      sourceTrust:'TRUSTED_HOST_OBSERVATIONS_NOT_ATTESTED',actualDispatchCount:null,resumable:false,
      authorizing:false,executionAttested:false,measurementVerified:false,publicationAuthorized:false});
    return cloneFreeze({...identity,fingerprint:hash(identity)});
  }
  async function retain(event) {
    const issued=readOriginalPairedTrialEventV1(event), final=event.type==='FINAL'; enter(final);
    try {
      if(closed || issued.plan.planSha256!==plan.planSha256 || issued.profile.profileSha256!==profile.profileSha256 ||
          !integer(event.sequence) || event.sequence<=lastSequence) fail('RUNNER_ARM_RETENTION_BINDING');
      if(event.type==='SCHEDULE') {
        if(runnerId || event.sequence!==0) fail('RUNNER_ARM_SCHEDULE');
        runnerId=issued.runnerId; schedule=event.intents.map(i=>i.requestId);
      } else if(issued.runnerId!==runnerId) fail('RUNNER_ARM_RETENTION_BINDING');
      lastSequence=event.sequence;
      const row=rows.get(event.requestId); let sidecar=null;
      if(event.type==='START_INTENT') {
        const phase=event.phase;
        if(!row || row.barrier || row.state!==(phase==='EXECUTOR'?'RESERVED':phase==='ORACLE'?'EXECUTOR_RETAINED':null)) fail('RUNNER_ARM_BARRIER');
        row.barrier={phase,sequence:event.sequence,acknowledged:false}; sidecar=admissionRecord(row,phase);
      } else if(event.type==='PHASE_RESULT') {
        const prefix=event.phase==='EXECUTOR'?'executor':event.phase==='ORACLE'?'oracle':null;
        if(!row || !prefix || row.state!==event.phase+'_RUNNING' || row[prefix+'Result']!=='FULFILLED' ||
            row[prefix+'Settlement']!=='FULFILLED' || !terminal(row[prefix+'Operation'].status())) fail('RUNNER_ARM_RESULT_UNCONFIRMED');
        if(prefix==='executor') {
          const {candidateText:_private,...redacted}=row.executorValue;
          if(!same(redacted,event.result) || !row.projection) fail('RUNNER_ARM_RESULT_BINDING');
          const l=readIssuedLiveModelLaneV4(row.owners.lane).snapshot;
          if(!l.revoked || l.lifecycle.pendingTransports || l.lifecycle.recoveryRequired) fail('RUNNER_ARM_REVOCATION_UNCONFIRMED');
        } else if(!same(row.oracleValue,event.result)) fail('RUNNER_ARM_RESULT_BINDING');
      } else if(!['SCHEDULE','FINAL'].includes(event.type)) fail('RUNNER_ARM_RETENTION_TYPE');
      // Hold the latch across BOTH native promises. Partial or late writes are
      // retained evidence only, never restart/dispatch capabilities.
      const deadline=performance.now()+profile.retentionTimeoutMs;
      async function persist(fn,value) {
        const promise=Reflect.apply(fn,undefined,[value]);
        if(!types.isPromise(promise)) fail('RUNNER_ARM_RETENTION_PROMISE');
        // Await a fresh native observer, not caller-controlled then/constructor.
        // Even a genuine native promise can otherwise fake await assimilation.
        await new Promise((resolve,reject)=>{
          Promise.prototype.then.call(promise,()=>resolve(),reject);
        });
        if(performance.now()>=deadline) fail('RUNNER_ARM_RETENTION_LATE');
        if(!final) active();
      }
      if(sidecar) await persist(writeAdmission,sidecar);
      const histories=event.type==='PHASE_RESULT'?[row]:final?[...rows.values()]:[];
      for(const entry of histories) if(entry.admissionHistory.length>entry.historyRetained) {
        await persist(writeAdmission,admissionHistory(entry,final?'FINAL_LOCAL_OBSERVATIONS':'POST_PHASE_LOCAL_OBSERVATIONS'));
        entry.historyRetained=entry.admissionHistory.length;
      }
      await persist(write,event);
      if(event.type==='START_INTENT') row.barrier.acknowledged=true;
      if(event.type==='PHASE_RESULT') {
        row.barrier=null;
        if(event.phase==='EXECUTOR') {row.executorRetained=true;row.state='EXECUTOR_RETAINED';}
        else {row.state='COMPLETE';cursor++;}
      }
      if(final) {closed=true;for(const row of rows.values()) row.permit=null;}
    } catch(e) {abort(e);} finally {busy=false;}
  }
  const host=Object.freeze({verifyInputs,startExecutor,startOracle,retain});
  return Object.freeze({host,inspect:()=>cloneFreeze({schemaVersion:'nisi-paired-arm-owner-observation-v1',runnerId,
    closed,busy,failure,ownersReserved:rows.size,
    rows:[...rows.values()].map(r=>({requestId:r.intent.requestId,ownerSetId:r.ownerSetId,state:r.state,
      arm:r.intent.arm,executorResult:r.executorResult,executorSettlement:r.executorSettlement,
      oracleResult:r.oracleResult,oracleSettlement:r.oracleSettlement,projection:r.projection,
      admissionHistory:r.admissionHistory,historyRetained:r.historyRetained})),
    actualDispatchCount:null,resumable:false,authorizing:false,measurementVerified:false,publicationAuthorized:false})});
}
