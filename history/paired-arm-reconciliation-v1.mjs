// PRIVATE, read-only cross-ledger observations. No replay, owner reconstruction,
// dispatch inference, authenticated provenance or measured effectiveness.
import {cloneFreeze,stableStringify} from '../workflow/contracts.mjs';
import {record} from '../evaluation/intake-v1.mjs';
import {encodeTrialEventV1} from './paired-trial-event-codec-v1.mjs';
import {inspectPairedTrialEventStoreV1} from './paired-trial-event-store-v1.mjs';
import {reconcileTrialRetentionEventsV1} from './paired-trial-reconciliation-v1.mjs';
import {inspectPairedArmSidecarStoreV1} from './paired-arm-sidecar-store-v1.mjs';
import {armSidecarDigestV1} from './paired-arm-sidecar-codec-v1.mjs';

const same=(a,b)=>stableStringify(a)===stableStringify(b);
const requireThat=ok=>{if(!ok)throw Error('ARM_CROSS_LINK_INVALID');};
const flags={authorizing:false,resumable:false,actualDispatchCount:null,
  measurementVerified:false,causalClaim:false,promotionEligible:false,
  sourceTrust:'UNAUTHENTICATED_LOCAL_BYTES',pastAcknowledgement:'UNKNOWN',
  remoteExecutionStopped:'UNKNOWN',candidateBytesRevalidated:false};
function stateOf(row){
  for(const phase of ['ORACLE','EXECUTOR']){
    if(row.observed[phase])return phase==='ORACLE'?'COMPLETE':'EXECUTOR_OBSERVED';
    if(row.started[phase])return 'STARTED_INCOMPLETE';
    if(row.prepared[phase])return 'PREPARED_UNCONFIRMED';
  }
  return 'NOT_STARTED';
}
function inspectCaptured(main,side){
  const base={schemaVersion:'nisi-paired-arm-reconciliation-v1',
    mainByteStatus:main.status,sidecarByteStatus:side.status,...flags};
  const result=(status,reason,rows=[],missing=[])=>cloneFreeze({...base,status,reason,rows,missing});
  if([main.status,side.status].some(s=>['CORRUPT','UNAVAILABLE'].includes(s)))
    return result('REFUSED','UNAVAILABLE_OR_CORRUPT_BYTES');
  if(main.events.length===0)return result('INCOMPLETE','NO_MAIN_SCHEDULE');
  const semantic=reconcileTrialRetentionEventsV1({events:main.events,byteStatus:main.status});
  if(semantic.status==='REFUSED')return result('REFUSED','MAIN_SEMANTICS_REFUSED');
  const schedule=main.events[0];
  const rows=schedule.intents.map(intent=>({intent,ownerSetId:null,prepared:{},started:{},observed:{},history:null}));
  const byRequest=new Map(rows.map(row=>[row.intent.requestId,row]));
  let previous=null;
  const events=main.events.map((event,index)=>{
    const encoded=encodeTrialEventV1(event,index,previous);previous=encoded.sha256;
    return {event,sha256:encoded.sha256,index};
  });
  const bySequence=new Map(events.map(x=>[x.event.sequence,x]));
  const owners=new Map(),covered=new Set();let lastMain=0,final=false;
  function custody(value,intent,prepared){
    for(const k of ['taskSha256','baselineSha256','oracleSha256','toolchainSha256','resourceBudgetSha256'])
      requireThat(value[k]===intent[k]);
    if(prepared)for(const k of ['suiteFingerprint','reviewedSourceFingerprint'])
      requireThat(value[k]===prepared.record.observation.custody[k]);
  }
  function nextPreparation(at){
    const head=events[at].event;
    if(head.type==='SCHEDULE')return {requestId:rows[0].intent.requestId,phase:'EXECUTOR'};
    if(head.type!=='PHASE_RESULT')return null;
    if(head.phase==='EXECUTOR')return {requestId:head.requestId,phase:'ORACLE'};
    const next=rows[rows.findIndex(r=>r.intent.requestId===head.requestId)+1];
    return next?{requestId:next.intent.requestId,phase:'EXECUTOR'}:null;
  }
  try{
    for(const [ordinal,entry] of side.records.entries()){
      const r=entry.record,ref=bySequence.get(r.main.sequence);
      requireThat(!final&&ref&&ref.sha256===r.main.sha256&&ref.index>=lastMain);
      lastMain=ref.index;
      if(ordinal===0){
        requireThat(r.kind==='HEADER'&&ref.index===0&&r.runnerId===schedule.runnerId&&
          r.planSha256===schedule.plan.planSha256&&r.profileSha256===schedule.profile.profileSha256&&
          r.intentsSha256===armSidecarDigestV1(schedule.intents));continue;
      }
      requireThat(r.kind!=='HEADER');
      if(r.kind==='FINAL'){
        requireThat(ref.event.type==='FINAL'&&same(r.rows,rows.map(row=>({requestId:row.intent.requestId,state:stateOf(row)}))));
        final=true;continue;
      }
      const row=byRequest.get(r.requestId);requireThat(row);
      if(row.ownerSetId===null){
        requireThat(r.kind==='PREPARED'&&!owners.has(r.ownerSetId));
        row.ownerSetId=r.ownerSetId;owners.set(r.ownerSetId,r.requestId);
      }
      requireThat(r.ownerSetId===row.ownerSetId);
      if(r.kind==='PREPARED'){
        const expected=nextPreparation(ref.index);
        requireThat(expected&&expected.requestId===r.requestId&&expected.phase===r.phase&&!row.prepared[r.phase]);
        requireThat(r.intentSha256===armSidecarDigestV1(row.intent)&&
          r.approval.planSha256===row.intent.planSha256&&r.approval.profileSha256===row.intent.profileSha256);
        if(r.phase==='ORACLE')requireThat(row.observed.EXECUTOR&&
          same(r.approval,row.prepared.EXECUTOR.record.approval)&&r.inputsSha256===row.prepared.EXECUTOR.record.inputsSha256&&
          r.observedAtMs>=row.history.record.entries.at(-1).observedAtMs);
        custody(r.observation.custody,row.intent,row.prepared.EXECUTOR);
        row.prepared[r.phase]=entry;
      }else if(r.kind==='START_LINKED'){
        const prepared=row.prepared[r.phase];
        requireThat(prepared&&!row.started[r.phase]&&r.preparedSha256===prepared.sha256&&
          ref.event.type==='START_INTENT'&&ref.event.requestId===r.requestId&&ref.event.phase===r.phase&&
          bySequence.get(prepared.record.main.sequence).index===ref.index-1);
        row.started[r.phase]=entry;covered.add(ref.event.sequence);
      }else if(r.kind==='HISTORY'){
        requireThat(r.intentSha256===armSidecarDigestV1(row.intent)&&same(r.approval,row.prepared.EXECUTOR.record.approval));
        const old=row.history?.record.entries??[];
        requireThat(r.entries.length>old.length&&same(r.entries.slice(0,old.length),old));
        let at=row.prepared.EXECUTOR.record.observedAtMs;
        for(const [index,observation] of r.entries.entries()){
          const phase=index<2?'EXECUTOR':'ORACLE',point=index%2?'CONSUMPTION_RECHECK_PASSED':'PERMIT_MINTED';
          const started=row.started[phase],prepared=row.prepared[phase];
          requireThat(started&&prepared&&observation.phase===phase&&observation.point===point&&
            observation.generation===started.record.main.sequence&&observation.observedAtMs>=at&&
            observation.observedAtMs>=prepared.record.observedAtMs);
          custody(observation.observation.custody,row.intent,prepared);at=observation.observedAtMs;
        }
        const latestPhase=r.entries.length<=2?'EXECUTOR':'ORACLE';
        requireThat(ref.event.type==='START_INTENT'&&ref.event.requestId===r.requestId&&ref.event.phase===latestPhase);
        row.history=entry;
      }else if(r.kind==='PHASE_OBSERVED'){
        const started=row.started[r.phase],prepared=row.prepared[r.phase],history=row.history;
        requireThat(started&&prepared&&history&&!row.observed[r.phase]&&r.startSha256===started.sha256&&r.historySha256===history.sha256&&
          ref.event.type==='PHASE_RESULT'&&ref.event.phase===r.phase&&ref.event.requestId===r.requestId&&
          bySequence.get(history.record.main.sequence).index===ref.index-1&&history.record.disposition==='POST_PHASE_LOCAL_OBSERVATIONS'&&
          history.record.entries.length===(r.phase==='EXECUTOR'?2:4));
        if(r.phase==='EXECUTOR'){
          const p=r.projection,e=ref.event.result;
          requireThat(p.intentSha256===prepared.record.intentSha256&&p.inputsSha256===prepared.record.inputsSha256&&
            p.candidate.candidateSha256===e.candidateSha256&&p.completionClaim===e.completionClaim&&
            same(p.usage.projectedTokens,e.tokenUsage)&&p.usage.projectedModelCalls===e.modelCalls&&p.usage.durationMs===e.durationMs&&
            p.treatment.arm===row.intent.arm&&p.treatment.policySha256===schedule.profile.trialPolicy.sha256);
        }else requireThat(row.observed.EXECUTOR&&ref.event.result.oracleCandidateSha256===row.observed.EXECUTOR.record.projection.candidate.candidateSha256);
        row.observed[r.phase]=entry;covered.add(ref.event.sequence);
      }else requireThat(false);
    }
    const missing=events.filter(x=>['START_INTENT','PHASE_RESULT'].includes(x.event.type)&&!covered.has(x.event.sequence))
      .map(x=>({sequence:x.event.sequence,requestId:x.event.requestId,phase:x.event.phase,
        missing:x.event.type==='START_INTENT'?'START_LINKED':'PHASE_OBSERVED'}));
    if(final)requireThat(missing.length===0);
    const observed=rows.map(row=>({requestId:row.intent.requestId,ownerSetId:row.ownerSetId,state:stateOf(row)}));
    const complete=final&&main.status==='FINAL_PRESENT'&&side.status==='FINAL_PRESENT';
    return result(complete?'FINAL_CROSSLINKED':'INCOMPLETE',complete?null:
      missing.length?'MISSING_SIDECAR_LINKS':side.records.length===0?'NO_SIDECAR_HEADER':'UNFINISHED_OR_PARTIAL_PREFIX',observed,missing);
  }catch{return result('REFUSED','CROSS_LEDGER_BINDING_OR_ORDER');}
}

export function inspectPairedArmTrialV1(input){
  try{
    const {directory}=record(input,['directory']);
    // Each file is captured once. No atomic two-file snapshot or hostile-writer
    // isolation is asserted; an actively changing pair can be incomplete/refused.
    const main=inspectPairedTrialEventStoreV1({directory});
    const sidecar=inspectPairedArmSidecarStoreV1({directory});
    return inspectCaptured(main,sidecar);
  }catch{return cloneFreeze({schemaVersion:'nisi-paired-arm-reconciliation-v1',status:'REFUSED',
    reason:'INSPECTION_UNAVAILABLE',rows:[],missing:[],...flags});}
}
