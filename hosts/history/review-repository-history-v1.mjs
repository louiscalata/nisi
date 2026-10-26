// PRIVATE trusted-host UI boundary. A terminal answer is not authenticated consent.
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {cloneFreeze,stableStringify,sha256Text} from '../../workflow/contracts.mjs';
import {exact} from '../../integrity/record-utils.mjs';

const active = new WeakSet();
const abortedGetter = Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
const listen = EventTarget.prototype.addEventListener, unlisten = EventTarget.prototype.removeEventListener;
const safeTime = v => Number.isSafeInteger(v) && v >= 0 && !Object.is(v,-0);
const hex = v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const bodyKeys = ['schemaVersion','taskFingerprint','baselineFingerprint','runId','attempt',
  'candidateFingerprint','candidatePresent','outcome','workflowOutcome','hostState','ownerStates',
  'stageCounts','stageTotal','diagnostics','bundleFingerprint','sourceAuthenticityAttested',
  'executionAttested','learningEligible','authorizing'];
const escaped = v => JSON.stringify(v,null,2).replace(/[\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,
  c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
function readPreview(call) {
  let raw;
  try { raw = call(); } catch { return {reason:'PREVIEW_UNAVAILABLE'}; }
  try {
    exact(raw,['schemaVersion','status','reason','preview','sha256','authorizing'],'PREVIEW_INVALID');
    if (raw.schemaVersion !== 'nisi-repository-history-preview/v1' || raw.authorizing !== false) throw Error();
    if (raw.status === 'REFUSED') return {reason:'PREVIEW_UNAVAILABLE'};
    if (raw.status !== 'PREVIEW' || raw.reason !== null || !hex(raw.sha256)) throw Error();
    exact(raw.preview,bodyKeys,'PREVIEW_INVALID');
    const p = cloneFreeze(raw);
    if (p.preview.schemaVersion !== 'nisi-repository-history-observation/v1' || !hex(p.preview.taskFingerprint) ||
        ['sourceAuthenticityAttested','executionAttested','learningEligible','authorizing'].some(k=>p.preview[k]!==false)) throw Error();
    const canonical = stableStringify(p.preview);
    if (Buffer.byteLength(canonical)>16384 || sha256Text('nisi/repository-history-preview/v1\0'+canonical)!==p.sha256) throw Error();
    return {reason:null,p};
  } catch { return {reason:'PREVIEW_INVALID'}; }
}
function captureShape(c) {
  try {
    exact(c,['schemaVersion','status','reason','recordAttempted','consumed','sourceDigest','declarationDigest','journal','authorizing'],'CAPTURE_INVALID');
    return Object.isFrozen(c) && c.schemaVersion==='nisi-repository-history-capture/v1' && c.authorizing===false &&
      ['STORED','DUPLICATE','CONFLICT','REFUSED','STORE_FAILED','UNCERTAIN'].includes(c.status) &&
      (c.reason===null || typeof c.reason==='string') && typeof c.recordAttempted==='boolean' && typeof c.consumed==='boolean';
  } catch { return false; }
}

export async function reviewRepositoryHistoryV1(input) {
  let req, host, previewCall, captureCall, signal=null, guarded=false, sourceDigest=null;
  let ownerOpenAttempted=false, captureCallAttempted=false, capture=null;
  const aborted = () => signal!==null && abortedGetter.call(signal);
  const result = (status,reason) => Object.freeze({schemaVersion:'nisi-repository-history-review/v1',
    status,reason,sourceDigest,ownerOpenAttempted,captureCallAttempted,capture,
    cancelledAfterCaptureCall:captureCallAttempted && aborted(),authorizing:false});
  const refused = reason => result('NOT_STORED',reason);
  try {
    try {
      exact(input,['host','runDirectory','clock','prompt','openOwner','signal','promptTimeoutMs'],'INVALID_INPUT');
      req = {...input}; host = req.host;
      if (!host || typeof host!=='object' || Array.isArray(host)) throw Error();
      const a=Object.getOwnPropertyDescriptor(host,'historyPreview'), b=Object.getOwnPropertyDescriptor(host,'captureHistory');
      if (typeof a?.value!=='function' || typeof b?.value!=='function') throw Error();
      previewCall=a.value.bind(host); captureCall=b.value.bind(host);
      if (typeof req.clock!=='function' || typeof req.prompt!=='function' || typeof req.openOwner!=='function' ||
          typeof req.runDirectory!=='string' || !req.runDirectory.isWellFormed() || req.runDirectory.length>4096 ||
          req.runDirectory.includes('\0') || !path.isAbsolute(req.runDirectory) ||
          path.resolve(req.runDirectory)===path.parse(req.runDirectory).root ||
          !Number.isSafeInteger(req.promptTimeoutMs) || req.promptTimeoutMs<1 || req.promptTimeoutMs>120000) throw Error();
      if (req.signal!==null) abortedGetter.call(req.signal);
      signal=req.signal;
    } catch { return refused('INVALID_INPUT'); }
    if (active.has(host)) return refused('REVIEW_BUSY');
    active.add(host); guarded=true;
    if (aborted()) return refused('ABORTED');
    const first=readPreview(previewCall);
    if (aborted()) return refused('ABORTED');
    if (first.reason) return refused(first.reason);
    const shown=first.p; sourceDigest=shown.sha256;
    const destination=path.join(req.runDirectory,'history-journal.jsonl');
    const expectedAnswer='STORE '+sourceDigest;
    const text=['PRIVATE Nisi history review — not authenticated consent.',
      'Existing demo raw run evidence is already retained; this choice controls ONLY an additional metadata journal.',
      'Declared retention: 14 days. NO automatic sweeper or secure erasure. Hashes are linkable, not anonymous.',
      'No learning, execution authority or publication is enabled.',
      'Destination: '+escaped(destination),'Metadata:',escaped(shown.preview),
      'Digest: '+sourceDigest,'To store, enter exactly: '+expectedAnswer,'Anything else declines.\n'].join('\n');
    const controller=new AbortController(); let timer, onAbort, answer;
    try {
      const cancelled=new Promise(resolve=>{
        onAbort=()=>{if(aborted()) resolve({kind:'signal'});};
        if(signal!==null) listen.call(signal,'abort',onAbort);
        timer=setTimeout(()=>resolve({kind:aborted()?'signal':'timeout'}),req.promptTimeoutMs);
      });
      const requested=Promise.resolve().then(()=>aborted()?{kind:'signal'}:
        req.prompt(Object.freeze({text,expectedAnswer,signal:controller.signal,timeoutMs:req.promptTimeoutMs})))
        .catch(()=>({kind:'error'}));
      answer=await Promise.race([requested,cancelled]);
    } finally {
      clearTimeout(timer); if(signal!==null && onAbort) unlisten.call(signal,'abort',onAbort);
      controller.abort();
    }
    if (aborted()) return refused('ABORTED');
    try {
      if(answer?.kind==='answer') {
        exact(answer,['kind','text'],'PROMPT_ERROR');
        if(typeof answer.text!=='string') throw Error();
        if(answer.text!==expectedAnswer) return refused(['','no','n'].includes(answer.text)?'DECLINED':'ANSWER_MISMATCH');
      } else {
        exact(answer,['kind'],'PROMPT_ERROR');
        return refused(({eof:'EOF',timeout:'TIMEOUT','no-tty':'NO_TTY',signal:'ABORTED',error:'PROMPT_ERROR'})[answer.kind]??'PROMPT_ERROR');
      }
    } catch { return refused('PROMPT_ERROR'); }
    const rechecked=readPreview(previewCall);
    if (aborted()) return refused('ABORTED');
    if (rechecked.reason || rechecked.p.sha256!==sourceDigest) return refused('DIGEST_CHANGED');
    let now;
    try { now=req.clock(); } catch { return refused(aborted()?'ABORTED':'INVALID_CLOCK'); }
    if(aborted()) return refused('ABORTED');
    if(!safeTime(now) || !safeTime(now+1209600000)) return refused('INVALID_CLOCK');
    const projectId='task:'+shown.preview.taskFingerprint;
    const declaration=Object.freeze({schemaVersion:'nisi-repository-history-declaration/v1',
      declarationId:'cli-history.'+randomUUID(),projectId,sourceDigest,issuedAt:now,expiresAt:now+60000,
      createdAt:now,retentionMs:1209600000,consentClass:'WRITTEN_DECLARATION',
      destination:'LOCAL_OBSERVATION_JOURNAL_ONLY',rawContentPersisted:false,networkEgress:false,learningInfluence:false});
    let opened; ownerOpenAttempted=true;
    try { opened=req.openOwner(Object.freeze({path:destination,config:Object.freeze({projectId,maxEntries:32,
      heartbeatTtlMs:30000,redactPaths:Object.freeze([])}),now})); }
    catch { return refused(aborted()?'ABORTED':'OPEN_FAILED'); }
    if(aborted()) return refused('ABORTED');
    if(opened?.status!=='OPENED') return refused('OPEN_FAILED');
    const clock=()=>{
      if(aborted()) throw Error('ABORTED');
      const value=req.clock();
      if(aborted()) throw Error('ABORTED');
      return value;
    };
    captureCallAttempted=true;
    try {
      const c=captureCall({owner:opened.owner,declaration,clock});
      if(!captureShape(c)) return result('UNCERTAIN','CAPTURE_UNCONFIRMED');
      capture=c; return result(c.status,c.reason);
    } catch { return result('UNCERTAIN','CAPTURE_UNCONFIRMED'); }
  } catch { return captureCallAttempted?result('UNCERTAIN','CAPTURE_UNCONFIRMED'):refused('INTERNAL_ERROR'); }
  finally { if(guarded) active.delete(host); }
}
