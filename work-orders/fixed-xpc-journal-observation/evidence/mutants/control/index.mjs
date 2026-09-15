// Private observation projection only; no I/O, native execution or authority.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {parseFixedXpcClient, assertFixedXpcOutcomes} from '../../../frozen/protocol.mjs';

const ROOT_REQUIRED = ['schemaVersion','createdAt','status','root','runId','caseName','fixtureCase','hostId','serviceId','sourceManifest','containers','commands','authorizing','generatedCodeExecuted','developerIdUsed','completeIsolation','nativeProductAccepted','serviceTerminationProven','runtimeServiceIdentityAttested','completedAt'];
const ROOT_OPTIONAL = ['inputs','platform','entitlements','bundleTree','client','postconditions','failure','terminalPersistence'];
const FLAGS = ['authorizing','generatedCodeExecuted','developerIdUsed','completeIsolation','nativeProductAccepted','serviceTerminationProven','runtimeServiceIdentityAttested'];
const SOURCES = ['hosts/macos-xpc/probe-wire.h','hosts/macos-xpc/probe-service.m','hosts/macos-xpc/probe-client.m','hosts/macos-xpc/protocol.mjs','hosts/macos-xpc/fixed-xpc-runner.mjs','hosts/swift-verifier/owned-child.mjs','hosts/swift-verifier/protocol.mjs','workflow/contracts.mjs','canonical/canonical-json-v1.mjs','hosts/repository/snapshot-contract.mjs'];
const CASES = {valid:{id:0,status:'REPLY_RECEIVED',exitCode:0},'malformed-request':{id:1,status:'MALFORMED',exitCode:70},'no-reply':{id:2,status:'TIMEOUT',exitCode:70}};
const ORDER = ['RUNNER_INCONCLUSIVE','FAILURE_PRESENT','TERMINAL_PERSISTENCE_UNCERTAIN','CONTAINER_UNCERTAIN','CLIENT_NOT_OBSERVED','PROCESS_NOT_STARTED','PROCESS_NOT_CLOSED','DRAIN_INCOMPLETE','SIGNAL_OR_ERROR','DEADLINE_OR_CANCEL','KILL_REQUESTED','EXIT_CODE_MISMATCH','DURATION_OUT_OF_RANGE','STREAM_TRUNCATED','STREAM_COUNT_MISMATCH','STREAM_DIGEST_MISMATCH','STDERR_NONEMPTY','STDOUT_PARSE_FAILED','VALIDATED_MISSING','CASE_MATRIX_MISMATCH','OUTCOME_ASSERTION_FAILED','POSTCONDITIONS_MISSING','POSTCONDITIONS_MISMATCH','LIFECYCLE_INCONSISTENT'];
const hash = value => createHash('sha256').update(value).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const safe = value => Number.isSafeInteger(value) && value >= 0 && !Object.is(value,-0);
const bool = value => typeof value === 'boolean';
const digest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const code = value => typeof value === 'string' && /^[A-Za-z0-9_]{1,96}$/.test(value);
const pid = value => safe(value) && value > 0 && value <= 0x7fffffff;
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
const need = value => { if (!value) throw Error('INVALID_INPUT'); };
const freeze = value => { if (value && typeof value === 'object') { for(const v of Object.values(value)) freeze(v); Object.freeze(value); } return value; };
function exact(value, required, optional=[]) {
  return object(value) && required.every(k=>Object.hasOwn(value,k)) && Object.keys(value).every(k=>required.includes(k)||optional.includes(k));
}
function absolute(value) {
  return typeof value === 'string' && value.startsWith('/') && value.length>1 && Buffer.byteLength(value)<=1024 &&
    !value.endsWith('/') && !value.includes('\0') && !value.split('/').slice(1).some(p=>p===''||p==='.'||p==='..');
}
function boundedTree(root) {
  const pending=[[root,0]]; let count=0;
  while(pending.length) {
    const [v,depth]=pending.pop(); need(++count<=20000 && depth<=32);
    if (v===null || typeof v==='boolean') continue;
    if (typeof v==='string') { need(v.length<=65536 && v.isWellFormed()); continue; }
    if (typeof v==='number') { need(Number.isSafeInteger(v) && !Object.is(v,-0)); continue; }
    need(object(v)||Array.isArray(v));
    const keys=Object.keys(v); need(keys.length<=256);
    for(const k of keys) { need(k.length<=65536 && k.isWellFormed()); pending.push([v[k],depth+1]); }
  }
}
function iso(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return false;
  const time=Date.parse(value); return Number.isFinite(time) && new Date(time).toISOString()===value;
}
function request(input) {
  need(object(input) && [Object.prototype,null].includes(Object.getPrototypeOf(input)));
  const keys=['serializedRecord','projectId','candidateId','receiptId','createdAt','ttlMs'];
  const names=Reflect.ownKeys(input); need(names.length===keys.length && keys.every(k=>names.includes(k)));
  const values={};
  for(const key of keys) { const d=Object.getOwnPropertyDescriptor(input,key); need(d && d.enumerable && Object.hasOwn(d,'value')); values[key]=d.value; }
  need(id(values.projectId)&&id(values.candidateId)&&id(values.receiptId)&&safe(values.createdAt)&&safe(values.ttlMs)&&values.ttlMs>0&&safe(values.createdAt+values.ttlMs));
  need(typeof values.serializedRecord==='string'&&values.serializedRecord.isWellFormed()&&Buffer.byteLength(values.serializedRecord)<=1048576);
  return values;
}
function validateRecord(r) {
  need(exact(r,ROOT_REQUIRED,ROOT_OPTIONAL));
  need(r.schemaVersion==='nisi-fixed-private-xpc-run-v1'&&['FIXED_XPC_CASE_OBSERVED','INCONCLUSIVE'].includes(r.status));
  need(iso(r.createdAt)&&iso(r.completedAt)&&r.createdAt<=r.completedAt&&absolute(r.root));
  need(typeof r.runId==='string'&&/^[0-9a-f]{32}$/.test(r.runId)&&typeof r.caseName==='string'&&Object.hasOwn(CASES,r.caseName));
  need(FLAGS.every(k=>r[k]===false)&&r.hostId==='local.nisi.xpcprobe.host.r'+r.runId&&r.serviceId==='local.nisi.xpcprobe.service.r'+r.runId);
  need(isDeepStrictEqual(r.fixtureCase,CASES[r.caseName]));
  need(exact(r.sourceManifest,SOURCES)&&Object.values(r.sourceManifest).every(digest));
  need(Array.isArray(r.containers)&&r.containers.length===2&&Array.isArray(r.commands));
  r.containers.forEach((c,i)=>{
    need(exact(c,['path','existedBefore','existsAfter','removed'],['observationError'])&&absolute(c.path));
    need(c.path.split('/').at(-1)===[r.hostId,r.serviceId][i]&&c.existedBefore===false&&c.removed===false);
    need((c.existsAfter===null||bool(c.existsAfter))&&(!Object.hasOwn(c,'observationError')||c.observationError===true));
  });
  need(r.containers[0].path!==r.containers[1].path);
  for(const k of ['inputs','platform','entitlements','bundleTree']) if(Object.hasOwn(r,k)) need(object(r[k]));
  if(Object.hasOwn(r,'failure')) need(exact(r.failure,['code','message'])&&code(r.failure.code)&&typeof r.failure.message==='string');
  if(Object.hasOwn(r,'terminalPersistence')) need(exact(r.terminalPersistence,['status','code'])&&r.terminalPersistence.status==='FAILED_OR_UNCERTAIN'&&code(r.terminalPersistence.code));
  if(Object.hasOwn(r,'postconditions')) need(Array.isArray(r.postconditions));
}
function validateChild(c,spec) {
  need(exact(c,['parentObservedPid','expectedExitCode','executableSha256','result'])&&(c.parentObservedPid===null||pid(c.parentObservedPid))&&c.expectedExitCode===spec.exitCode&&digest(c.executableSha256));
  const r=c.result;
  need(exact(r,['schemaVersion','process','outputs','stdoutHex','stderrHex','cause','validated','lifecycle','authorizing'])&&r.schemaVersion===1&&r.authorizing===false);
  const p=r.process,l=r.lifecycle;
  need(exact(p,['started','closed','drain','exitCode','signal','errorCode','cancelRequested','deadlineExceeded','durationMs']));
  need(['started','closed','cancelRequested','deadlineExceeded'].every(k=>bool(p[k]))&&['CONFIRMED','UNKNOWN','NOT_APPLICABLE'].includes(p.drain));
  need((p.exitCode===null||safe(p.exitCode)&&p.exitCode<=255)&&[p.signal,p.errorCode].every(v=>v===null||code(v))&&safe(p.durationMs));
  need(exact(l,['operation','launchCalled','closeObserved','exited','killRequested','killReturned','killAtMs','ownerState','directChildOnly']));
  need(safe(l.operation)&&l.operation>0&&['launchCalled','closeObserved','exited','killRequested'].every(k=>bool(l[k]))&&(l.killReturned===null||bool(l.killReturned))&&(l.killAtMs===null||safe(l.killAtMs))&&['IDLE','QUARANTINED'].includes(l.ownerState)&&l.directChildOnly===true);
  need((r.cause===null||object(r.cause))&&(r.validated===null||exact(r.validated,['client','reply']))&&exact(r.outputs,['stdout','stderr']));
  for(const name of ['stdout','stderr']) {
    const o=r.outputs[name],hex=r[name+'Hex'];
    need(exact(o,['capturedBytes','observedBytes','sha256','truncated'])&&safe(o.capturedBytes)&&o.capturedBytes<=16384&&safe(o.observedBytes)&&digest(o.sha256)&&bool(o.truncated));
    need(typeof hex==='string'&&hex.length<=32768&&/^(?:[0-9a-f]{2})*$/.test(hex));
  }
}
export function fixedXpcJournalObservation(input) {
  try {
    const a=request(input),r=JSON.parse(a.serializedRecord); boundedTree(r); validateRecord(r);
    const spec=CASES[r.caseName], reasons=new Set();
    const add=(condition,reason)=>{if(condition)reasons.add(reason);};
    add(r.status==='INCONCLUSIVE','RUNNER_INCONCLUSIVE');
    add(Object.hasOwn(r,'failure'),'FAILURE_PRESENT');
    add(Object.hasOwn(r,'terminalPersistence'),'TERMINAL_PERSISTENCE_UNCERTAIN');
    add(r.containers.some(c=>c.existsAfter===null||c.observationError===true),'CONTAINER_UNCERTAIN');
    let parsed=null, stdoutSha256=null, process=null, observedParentPid=null;
    if(!Object.hasOwn(r,'client')) reasons.add('CLIENT_NOT_OBSERVED');
    else {
      const c=r.client; validateChild(c,spec);
      const cr=c.result,p=cr.process,l=cr.lifecycle; process={...p}; observedParentPid=c.parentObservedPid;
      add(!p.started,'PROCESS_NOT_STARTED'); add(!p.closed,'PROCESS_NOT_CLOSED'); add(p.drain!=='CONFIRMED','DRAIN_INCOMPLETE');
      add(p.signal!==null||p.errorCode!==null||cr.cause!==null,'SIGNAL_OR_ERROR');
      add(p.deadlineExceeded||p.cancelRequested,'DEADLINE_OR_CANCEL'); add(l.killRequested,'KILL_REQUESTED');
      add(p.exitCode!==spec.exitCode,'EXIT_CODE_MISMATCH');
      add(p.durationMs>=8000||(r.caseName==='no-reply'&&p.durationMs<5000),'DURATION_OUT_OF_RANGE');
      const streams={}; let clean=true;
      for(const name of ['stdout','stderr']) {
        const o=cr.outputs[name],b=Buffer.from(cr[name+'Hex'],'hex'),h=hash(b); streams[name]=b;
        if(name==='stdout') stdoutSha256=h;
        const badCount=o.capturedBytes!==b.length||o.observedBytes<o.capturedBytes||o.truncated!==(o.observedBytes>o.capturedBytes);
        add(o.truncated,'STREAM_TRUNCATED'); add(badCount,'STREAM_COUNT_MISMATCH'); add(h!==o.sha256,'STREAM_DIGEST_MISMATCH');
        if(o.truncated||badCount||h!==o.sha256)clean=false;
      }
      add(streams.stderr.length>0,'STDERR_NONEMPTY');
      if(clean && pid(observedParentPid)) {
        try { parsed=parseFixedXpcClient(streams.stdout,{runId:r.runId,expectedPid:observedParentPid,expectedClientHome:r.containers[0].path+'/Data',expectedServiceHome:r.containers[1].path+'/Data'}); }
        catch { if(cr.validated!==null) throw Error('INVALID_INPUT'); reasons.add('STDOUT_PARSE_FAILED'); }
        if(parsed!==null) {
          if(cr.validated!==null) need(isDeepStrictEqual(cr.validated,parsed));
          else reasons.add('VALIDATED_MISSING');
          const matrix=parsed.client.status===spec.status && (r.caseName==='valid'||parsed.reply===null&&parsed.client.replyBase64==='');
          add(!matrix,'CASE_MATRIX_MISMATCH');
          if(matrix && r.caseName==='valid') {
            try { assertFixedXpcOutcomes(parsed.reply); } catch { reasons.add('OUTCOME_ASSERTION_FAILED'); }
          }
        }
      }
      add(!l.launchCalled||!l.closeObserved||!l.exited||l.ownerState!=='IDLE'||p.started&&observedParentPid===null||p.started!==l.launchCalled||p.closed!==l.closeObserved,'LIFECYCLE_INCONSISTENT');
    }
    if(!Object.hasOwn(r,'postconditions')) reasons.add('POSTCONDITIONS_MISSING');
    else {
      const known=Buffer.from('nisi fixed probe\n'), h=hash(known), own=r.containers[1].path+'/Data/nisi-fixed-probe.txt';
      const expected=[{path:r.root+'/outside-canary.txt',byteLength:known.length,sha256:h},r.caseName==='valid'?{path:own,byteLength:known.length,sha256:h}:{path:own,absent:true},{path:r.root+'/outside-write.txt',absent:true}];
      add(!isDeepStrictEqual(r.postconditions,expected),'POSTCONDITIONS_MISMATCH');
    }
    const ordered=ORDER.filter(k=>reasons.has(k));
    const payload={schemaVersion:'nisi-fixed-xpc-journal-observation/v1',meaning:'FIXED_CASE_OBSERVATION_ONLY',caseName:r.caseName,reportedStatus:r.status,clientOutcome:parsed?.client.status??null,recordDigest:hash(Buffer.from(a.serializedRecord)),sourceBindings:{...r.sourceManifest},sourceManifestVerified:false,observedParentPid,selfReportedServicePid:parsed?.reply?.servicePidSelfReported??null,operations:parsed?.reply?.rows.map(row=>({...row}))??[],process,stdoutSha256,failureCode:r.failure?.code??null,terminalPersistenceCode:r.terminalPersistence?.code??null,persistenceClaim:'NONE',failureClass:'OBSERVATION_ONLY',reasons:ordered,authorizing:false,generatedCodeExecuted:false,isolationAccepted:false,nativeProductAccepted:false,serviceIdentityAttested:false,serviceTerminationProven:false};
    return freeze({status:'ENTRY',entry:{id:r.runId+':0:fixed-xpc',projectId:a.projectId,runId:r.runId,attempt:0,candidateId:a.candidateId,stage:'fixed-xpc',receiptId:a.receiptId,createdAt:a.createdAt,ttlMs:a.ttlMs,state:ordered.length===0?'SUCCEEDED':'FAILED',heartbeatAt:null,retryOf:null,revokes:null,payload},authorizing:false});
  } catch { return freeze({status:'REFUSED',reason:'INVALID_INPUT',authorizing:false}); }
}
