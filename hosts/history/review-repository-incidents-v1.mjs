// PRIVATE trusted operator boundary. Answers are not authenticated identity.
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {stableStringify,sha256Text} from '../../workflow/contracts.mjs';
import {exact} from '../../integrity/record-utils.mjs';
import {isIssuedRepositoryIncidentPreviewV1} from '../../history/repository-incident-candidates-v1.mjs';

const active = new WeakSet(), PAGE_SIZE = 10, MAX_INTERACTIONS = 32, RETENTION = 1209600000;
const abortedGetter = Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
const listen = EventTarget.prototype.addEventListener, unlisten = EventTarget.prototype.removeEventListener;
const time = n => Number.isSafeInteger(n) && n >= 0 && !Object.is(n,-0);
const H = (part,value) => sha256Text('nisi/repository-incident-'+part+'/v1\0'+stableStringify(value));
const escaped = value => JSON.stringify(value,null,2).replace(/[\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,
  c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));

function method(host,key) {
  const d=Object.getOwnPropertyDescriptor(host,key);
  if(!d || !Object.hasOwn(d,'value') || typeof d.value!=='function') throw Error('INVALID_INPUT');
  return d.value.bind(host);
}
function previewOf(call) {
  const p=call();
  if(!isIssuedRepositoryIncidentPreviewV1(p) || p.status!=='PREVIEW') throw Error('PREVIEW_UNAVAILABLE');
  return p;
}
function permitShape(p,digest) {
  try {
    exact(p,['schemaVersion','status','reason','permit','declarationDigest','consumed','authorizing'],'INVALID');
    return Object.isFrozen(p) && p.schemaVersion==='nisi-repository-incident-permit/v1' &&
      p.status==='CREATED' && p.reason===null && p.authorizing===false && p.consumed===false &&
      p.declarationDigest===digest && p.permit!==null && typeof p.permit==='object' && Object.isFrozen(p.permit);
  } catch { return false; }
}
function captureShape(c, row, d, digest) {
  try {
    exact(c,['schemaVersion','status','reason','entryId','rowId','declarationDigest','recordAttempted',
      'consumed','journal','learningEligible','authorizing'],'INVALID');
    if(!Object.isFrozen(c) || c.schemaVersion!=='nisi-repository-incident-capture/v1' ||
        !['STORED','DUPLICATE','CONFLICT','REFUSED','STORE_FAILED','UNCERTAIN'].includes(c.status) ||
        c.learningEligible!==false || c.authorizing!==false ||
        c.rowId!==row.rowId || c.declarationDigest!==digest ||
        c.entryId!=='ric1.'+H('entry-id',{projectId:d.projectId,rowId:row.rowId}) ||
        c.reason!==null && (typeof c.reason!=='string' || !/^[A-Z][A-Z0-9_]{0,95}$/.test(c.reason)) ||
        typeof c.recordAttempted!=='boolean' || typeof c.consumed!=='boolean') return false;
    if(c.recordAttempted && !c.consumed || c.status!=='REFUSED' && !c.recordAttempted) return false;
    if(!c.recordAttempted && c.journal!==null) return false;
    if(['STORED','DUPLICATE'].includes(c.status) && c.reason!==null) return false;
    if(c.status==='REFUSED' && c.reason===null) return false;
    if(!c.recordAttempted)return c.status==='REFUSED';
    // The call having started is not evidence that a store succeeded. Preserve
    // the substrate's admitted refusals and uncertainty without inventing a
    // success when the journal is missing or contradicts the capture envelope.
    const j=c.journal;
    if(j===null)return c.status==='UNCERTAIN' && c.reason==='INTERNAL_ERROR';
    const short=j?.status==='REFUSED' && !Object.hasOwn(j,'snapshot');
    exact(j,short?['schemaVersion','status','reason','authorizing']:
      ['schemaVersion','status','reason','authorizing','entryId','append','store','snapshot'],'INVALID');
    if(!Object.isFrozen(j) || j.schemaVersion!=='nisi-journal-owner/v2' ||
      j.authorizing!==false || j.reason!==c.reason)return false;
    if(!short && j.entryId!==null && j.entryId!==c.entryId)return false;
    switch(j.status){
      case 'RECORDED':return c.status==='STORED' && j.entryId===c.entryId && j.snapshot?.state==='OPEN' &&
        j.append?.status==='APPENDED' && j.append.id===c.entryId &&
        ['WRITTEN','UNCHANGED'].includes(j.store?.status) && j.store.verified===true;
      case 'DUPLICATE':return c.status==='DUPLICATE' && j.entryId===c.entryId && j.snapshot?.state==='OPEN' &&
        j.append?.status==='DUPLICATE' && j.append.id===c.entryId && j.store===null;
      case 'CONFLICT':case 'STORE_CONFLICT':return c.status==='CONFLICT' && j.entryId===c.entryId;
      case 'REFUSED':return c.status==='REFUSED';
      case 'STORE_FAILED':return ['OPEN','SEALED','COMMIT_UNCERTAIN'].includes(j.snapshot?.state) &&
        c.status===(j.snapshot.state==='COMMIT_UNCERTAIN'?'UNCERTAIN':'STORE_FAILED');
      default:return false;
    }
  } catch { return false; }
}

export async function reviewRepositoryIncidentsV1(input) {
  let req,host,previewCall,permitCall,captureCall,revokeCall,signal=null,guarded=false;
  let shown=null,row=null,deadline=Infinity,interactions=0,permit=null,permitDigest=null;
  let ownerOpenAttempted=false,permitCallAttempted=false,captureCallAttempted=false,capture=null;
  let permitReleaseStatus='NOT_CREATED',outcome={status:'NOT_STORED',reason:'INTERNAL_ERROR'};
  const aborted=()=>signal!==null && abortedGetter.call(signal);
  const stop=()=>aborted()?'ABORTED':performance.now()>=deadline?'TIMEOUT':null;
  const notStored=reason=>({status:'NOT_STORED',reason});
  const current=()=>{
    const stopped=stop();if(stopped)return stopped;
    let p;try{p=previewOf(previewCall);}catch{return stop()??'PREVIEW_CHANGED';}
    return stop()??(p!==shown?'PREVIEW_CHANGED':null);
  };
  async function ask(text,expectedAnswer) {
    if(interactions>=MAX_INTERACTIONS) return {reason:'INTERACTION_LIMIT'};
    const stopped=current();if(stopped)return{reason:stopped};
    interactions++;
    const remaining=Math.max(1,Math.ceil(deadline-performance.now()));
    const controller=new AbortController();let timer,onAbort,answer;
    try {
      const cancelled=new Promise(resolve=>{
        onAbort=()=>{if(aborted())resolve({kind:'signal'});};
        if(signal!==null)listen.call(signal,'abort',onAbort);
        timer=setTimeout(()=>resolve({kind:aborted()?'signal':'timeout'}),remaining);
      });
      const requested=Promise.resolve().then(()=>stop()?{kind:aborted()?'signal':'timeout'}:
        req.prompt(Object.freeze({text,expectedAnswer,signal:controller.signal,timeoutMs:remaining})))
        .catch(()=>({kind:'error'}));
      answer=await Promise.race([requested,cancelled]);
    } finally {
      clearTimeout(timer);if(signal!==null && onAbort)unlisten.call(signal,'abort',onAbort);
      controller.abort();
    }
    const stoppedAfter=current();if(stoppedAfter)return{reason:stoppedAfter};
    try {
      if(answer?.kind==='answer'){
        exact(answer,['kind','text'],'INVALID');
        if(typeof answer.text!=='string' || !answer.text.isWellFormed() || Buffer.byteLength(answer.text)>1024)throw Error();
        return{reason:null,text:answer.text};
      }
      exact(answer,['kind'],'INVALID');
      return{reason:({eof:'EOF',timeout:'TIMEOUT','no-tty':'NO_TTY',signal:'ABORTED',error:'PROMPT_ERROR'})[answer.kind]??'PROMPT_ERROR'};
    } catch { return{reason:'PROMPT_ERROR'}; }
  }
  async function review() {
    if(stop())return notStored(stop());
    try{shown=previewOf(previewCall);}catch{return notStored(stop()??'PREVIEW_UNAVAILABLE');}
    if(stop())return notStored(stop());
    const rows=shown.rows.filter(r=>r.classification==='FAILURE_CANDIDATE' && r.reason==='RECORDED_FAILURE' &&
      r.rawStatus==='FAIL' && r.stageStatus==='FAIL' && r.disposition==='RESULT_RECORDED');
    if(rows.length===0)return notStored('NO_FAILURE_CANDIDATES');
    const pages=Math.ceil(rows.length/PAGE_SIZE);let page=0;
    while(row===null){
      const visible=rows.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE);
      const text=['PRIVATE Nisi failure-observation selection — selection does NOT permit storage.',
        `Eligible observations: ${rows.length}. Page ${page+1} of ${pages}.`,
        ...visible.map(r=>`${r.binding.stage}, attempt ${r.binding.attempt}, row ${r.rowId}`),
        'SELECT <full row ID> chooses a row on this page. NEXT / PREV / PAGE <number> navigates.',
        'Enter no or an empty line to decline. No automatic storage or learning.\n'].join('\n');
      const a=await ask(text,'SELECT '+visible[0].rowId);
      if(a.reason)return notStored(a.reason);
      if(['','no','n'].includes(a.text))return notStored('DECLINED');
      if(a.text==='NEXT'){if(page+1>=pages)return notStored('PAGE_INVALID');page++;continue;}
      if(a.text==='PREV'){if(page===0)return notStored('PAGE_INVALID');page--;continue;}
      const target=/^PAGE ([1-9][0-9]{0,3})$/.exec(a.text);
      if(target){const value=Number(target[1]);if(value>pages)return notStored('PAGE_INVALID');page=value-1;continue;}
      const selected=/^SELECT ([0-9a-f]{64})$/.exec(a.text);
      if(!selected || !(row=visible.find(r=>r.rowId===selected[1])??null))return notStored('SELECTION_MISMATCH');
    }
    const destination=path.join(req.runDirectory,'incident-journal.jsonl');
    const expectedAnswer='STORE '+row.fingerprint+' '+shown.sha256;
    const text=['PRIVATE Nisi selected failure review — not authenticated consent.',
      'Existing demo raw run evidence is already retained; this choice controls ONLY an additional metadata journal.',
      'Declared retention: 14 days. NO automatic sweeper or secure erasure. Hashes are linkable, not anonymous.',
      'No learning, native incident admission, execution authority or publication is enabled.',
      'Destination: '+escaped(destination),'Task namespace: task:'+row.binding.taskFingerprint,
      'Selected metadata:',escaped(row),'Preview digest: '+shown.sha256,
      'To store exactly this observation, enter exactly: '+expectedAnswer,'Anything else declines.\n'].join('\n');
    const answer=await ask(text,expectedAnswer);
    if(answer.reason)return notStored(answer.reason);
    if(answer.text!==expectedAnswer)return notStored(['','no','n'].includes(answer.text)?'DECLINED':'ANSWER_MISMATCH');
    let now;try{now=req.clock();}catch{return notStored(stop()??'INVALID_CLOCK');}
    const afterClock=current();if(afterClock)return notStored(afterClock);
    if(!time(now) || !time(now+RETENTION))return notStored('INVALID_CLOCK');
    const d=Object.freeze({schemaVersion:'nisi-repository-incident-declaration/v1',
      declarationId:'cli-incident.'+randomUUID(),projectId:'task:'+row.binding.taskFingerprint,
      rowId:row.rowId,rowFingerprint:row.fingerprint,previewSha256:shown.sha256,
      issuedAt:now,expiresAt:now+60000,createdAt:now,retentionMs:RETENTION,
      consentClass:'WRITTEN_DECLARATION',destination:'LOCAL_INCIDENT_OBSERVATION_ONLY',
      rawContentPersisted:false,networkEgress:false,learningInfluence:false});
    const digest=H('declaration',d);permitDigest=digest;let opened;
    ownerOpenAttempted=true;
    try{opened=req.openOwner(Object.freeze({path:destination,config:Object.freeze({projectId:d.projectId,
      maxEntries:32,heartbeatTtlMs:30000,redactPaths:Object.freeze([])}),now}));}
    catch{return notStored(stop()??'OPEN_FAILED');}
    const afterOpen=current();if(afterOpen)return notStored(afterOpen);
    if(opened?.status!=='OPENED')return notStored('OPEN_FAILED');
    const clock=()=>{
      if(stop())throw Error('STOPPED');
      const value=req.clock();
      if(stop() || !time(value) || value<now)throw Error('STOPPED');
      return value;
    };
    permitCallAttempted=true;let issued;
    try{issued=permitCall({owner:opened.owner,declaration:d,clock});}
    catch{return notStored(stop()??'PERMIT_UNCONFIRMED');}
    // Recover a returned handle for cleanup even when the surrounding response
    // is malformed. It never becomes capture authority before full validation.
    if(issued && typeof issued==='object'){
      const pd=Object.getOwnPropertyDescriptor(issued,'permit');
      if(pd && Object.hasOwn(pd,'value') && pd.value!==null && typeof pd.value==='object' &&
        Object.isFrozen(pd.value)){permit=pd.value;permitReleaseStatus='UNCONFIRMED';}
    }
    if(!permitShape(issued,digest))return notStored(stop()??'PERMIT_UNCONFIRMED');
    permit=issued.permit;permitReleaseStatus='UNCONFIRMED';
    const beforeCapture=current();if(beforeCapture)return notStored(beforeCapture);
    captureCallAttempted=true;
    try{
      const c=captureCall({permit});
      if(!captureShape(c,row,d,digest))return{status:'UNCERTAIN',reason:'CAPTURE_UNCONFIRMED'};
      capture=c;return{status:c.status,reason:c.reason};
    }catch{return{status:'UNCERTAIN',reason:'CAPTURE_UNCONFIRMED'};}
  }
  try {
    try {
      exact(input,['host','runDirectory','clock','prompt','openOwner','signal','promptTimeoutMs'],'INVALID_INPUT');
      req={...input};host=req.host;
      if(!host || typeof host!=='object' || Array.isArray(host))throw Error();
      previewCall=method(host,'incidentPreview');permitCall=method(host,'createIncidentPermit');
      captureCall=method(host,'captureIncident');revokeCall=method(host,'revokeIncidentPermit');
      if(typeof req.clock!=='function' || typeof req.prompt!=='function' || typeof req.openOwner!=='function' ||
          typeof req.runDirectory!=='string' || !req.runDirectory.isWellFormed() || req.runDirectory.length>4096 ||
          req.runDirectory.includes('\0') || !path.isAbsolute(req.runDirectory) ||
          path.resolve(req.runDirectory)===path.parse(req.runDirectory).root ||
          !Number.isSafeInteger(req.promptTimeoutMs) || req.promptTimeoutMs<1 || req.promptTimeoutMs>120000)throw Error();
      if(req.signal!==null)abortedGetter.call(req.signal);
      signal=req.signal;
    }catch{outcome=notStored('INVALID_INPUT');return finish();}
    if(active.has(host)){outcome=notStored('REVIEW_BUSY');return finish();}
    active.add(host);guarded=true;deadline=performance.now()+req.promptTimeoutMs;
    outcome=await review();
  }catch{outcome=captureCallAttempted?{status:'UNCERTAIN',reason:'CAPTURE_UNCONFIRMED'}:notStored('INTERNAL_ERROR');}
  finally{
    if(permit!==null){
      try{
        const released=revokeCall({permit});
        exact(released,['schemaVersion','status','reason','permit','declarationDigest','consumed','authorizing'],'INVALID');
        if(Object.isFrozen(released) && released.schemaVersion==='nisi-repository-incident-permit/v1' &&
          released.authorizing===false && released.permit===null && released.declarationDigest===permitDigest){
          if(released.status==='REVOKED' && released.reason===null && released.consumed===false)permitReleaseStatus='REVOKED';
          else if(released.status==='REFUSED' && released.reason==='PERMIT_CONSUMED' && released.consumed===true)permitReleaseStatus='CONSUMED';
        }
      }catch{/* Unconfirmed release remains explicit; it cannot rewrite storage evidence. */}
    }
    if(guarded)active.delete(host);
  }
  return finish();
  function finish(){return Object.freeze({schemaVersion:'nisi-repository-incident-review/v1',...outcome,
    previewSha256:shown?.sha256??null,selectedRowId:row?.rowId??null,ownerOpenAttempted,permitCallAttempted,
    captureCallAttempted,capture,cancelledAfterCaptureCall:captureCallAttempted&&aborted(),
    permitReleaseStatus,learningEligible:false,authorizing:false});}
}
