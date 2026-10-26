// PRIVATE isolated C09 owner-capture consistency checker. Read-only: it never
// launches the rehearsal, installs a runtime, changes evidence, or authorizes.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {types as nodeTypes} from 'node:util';
import {createRuntimeMatrix,NODE22_PREREQUISITE} from '../candidate/work-orders/v02-finish-cluster-v1/consumer/runtime-matrix-v1.mjs';

const NAMES=Object.freeze(['capture.json','intent.json','receipt.json','archive.tgz','expected.json','stdout.log','stderr.log']);
const MAX={json:4*1024*1024,archive:64*1024*1024,stdout:2*1024*1024,stderr:256*1024};
const fail=(code,detail=null)=>{const e=new Error(detail?code+': '+detail:code);e.code=code;throw e;};
const sha=b=>createHash('sha256').update(b).digest('hex');
const hex=v=>typeof v==='string'&&/^[0-9a-f]{64}$/u.test(v);
const string=v=>typeof v==='string'&&v.length>0&&v.isWellFormed();
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const MAX_DEPTH=8,MAX_KEYS=64,MAX_ARRAY=128,MAX_STRING=8192;
function snapshot(v,depth=0,seen=new WeakSet(),large=false){
  if(typeof v==='string'){if(v.length>MAX_STRING||!v.isWellFormed())fail('CAPTURE_INPUT_BOUNDS');return v;}
  if(v===null||typeof v==='boolean'||typeof v==='number'){if(typeof v==='number'&&!Number.isFinite(v))fail('CAPTURE_INPUT_BOUNDS');return v;}
  if(typeof v!=='object'||nodeTypes.isProxy(v))fail('CAPTURE_INPUT_SCHEMA');
  if(depth>=MAX_DEPTH||seen.has(v))fail('CAPTURE_INPUT_BOUNDS');seen.add(v);
  if(Array.isArray(v)){
    if(v.length>MAX_ARRAY||Reflect.ownKeys(v).length!==v.length+1)fail('CAPTURE_INPUT_BOUNDS');
    const out=[];for(let i=0;i<v.length;i++){const d=Object.getOwnPropertyDescriptor(v,String(i));if(!d?.enumerable||!('value' in d))fail('CAPTURE_INPUT_ACCESSOR');out.push(snapshot(d.value,depth+1,seen,large));}
    seen.delete(v);return Object.freeze(out);
  }
  const keys=Reflect.ownKeys(v);if(keys.length>(large?MAX_ARRAY:MAX_KEYS)||keys.some(k=>typeof k!=='string'))fail('CAPTURE_INPUT_BOUNDS');
  const out=Object.create(null);
  for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);if(!d?.enumerable||!('value' in d))fail('CAPTURE_INPUT_ACCESSOR');out[k]=snapshot(d.value,depth+1,seen,large);}
  seen.delete(v);return Object.freeze(out);
}
const same=(a,b)=>JSON.stringify(snapshot(a))===JSON.stringify(snapshot(b));
const sameLarge=(a,b)=>JSON.stringify(snapshot(a,0,new WeakSet(),true))===JSON.stringify(snapshot(b,0,new WeakSet(),true));
function closed(v,required,optional=[],code='CAPTURE_SCHEMA'){
  if(typeof optional==='string'){code=optional;optional=[];}
  if(v===null||typeof v!=='object'||nodeTypes.isProxy(v)||Array.isArray(v))fail(code,'object');
  const keys=Reflect.ownKeys(v);if(keys.some(k=>typeof k!=='string'||(!required.includes(k)&&!optional.includes(k))))fail(code,'fields');
  for(const k of required)if(!own(v,k))fail(code,'missing '+k);
  const out=Object.create(null);for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);if(!d?.enumerable||!('value' in d))fail(code,'accessor');out[k]=d.value;}return out;
}
function readFile(root,name,limit){
  if(path.basename(name)!==name||!NAMES.includes(name))fail('CAPTURE_PATH',name);
  const file=path.join(root,name),s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o077)||s.size>limit)fail('CAPTURE_FILE',name);
  const resolved=fs.realpathSync(file);if(resolved!==file)fail('CAPTURE_PATH',name);
  let fd;try {
    fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    const opened=fs.fstatSync(fd);if(!opened.isFile()||opened.dev!==s.dev||opened.ino!==s.ino||opened.size!==s.size||opened.mode!==s.mode)fail('CAPTURE_CHANGED',name);
    const bytes=Buffer.alloc(opened.size);let offset=0;while(offset<bytes.length){const n=fs.readSync(fd,bytes,offset,bytes.length-offset,null);if(n<=0)fail('CAPTURE_EOF',name);offset+=n;}
    const probe=Buffer.alloc(1);if(fs.readSync(fd,probe,0,1,null)!==0)fail('CAPTURE_GROWTH',name);
    const after=fs.fstatSync(fd);if(after.dev!==opened.dev||after.ino!==opened.ino||after.size!==opened.size||after.mode!==opened.mode)fail('CAPTURE_CHANGED',name);
    return {name,bytes,sha256:sha(bytes),byteLength:bytes.length,device:opened.dev,inode:opened.ino,mode:opened.mode};
  } finally {if(fd!==undefined)fs.closeSync(fd);}
}
function json(file){try{return JSON.parse(file.bytes.toString('utf8'));}catch{fail('CAPTURE_JSON',file.name);}}
function descriptor(pins,name,file){const p=closed(pins[name],['sha256','byteLength'],'CAPTURE_PIN');if(!hex(p.sha256)||p.sha256!==file.sha256||p.byteLength!==file.byteLength)fail('CAPTURE_PIN_MISMATCH',name);}
function iso(v){if(!string(v)||!Number.isFinite(Date.parse(v))||new Date(Date.parse(v)).toISOString()!==v)fail('CAPTURE_SCHEMA','time');return Date.parse(v);}
function validate(root,capture,intent,receipt,archive,expected,stdout,stderr,pins,contract,ownerPins){
  const c=closed(capture,['schema','startedAt','spawnObservedAt','closedAt','pid','exitCode','signal','closeConfirmed','spawnError','timedOut','overflow','killAttempt','command','cwd','stdoutSha256','stderrSha256','nodeBefore','nodeAfter','writerBefore','writerAfter','status','descendantDrain','ownerInterventionRequired','accepted','executionAttested','sourceAuthenticityAttested','publicationAuthorized','modelInference','nativeAppExecution','node22','receiptBefore','receiptAfter','retainedReceipt','retainedArchive','retainedExpected','archiveBefore','archiveAfter','expectedSha256'],['failure'],'CAPTURE_SCHEMA');
  const i=closed(intent,['schema','node','version','writer','sourceManifest','stageManifest','caseManifest','toolchain','negativeLocations','command','cwd','timeoutMs','maxOutputBytes','network','models','nativeApp','publication'],'CAPTURE_INTENT');
  if(c.schema!=='nisi.c09.owner-runtime-capture.v1'||i.schema!=='nisi.c09.owner-capture-intent.v1')fail('CAPTURE_SCHEMA');
  const start=iso(c.startedAt),spawnAt=iso(c.spawnObservedAt),end=iso(c.closedAt);if(start>spawnAt||spawnAt>end)fail('CAPTURE_TIME');
  if(c.failure!==undefined||!Number.isSafeInteger(c.pid)||c.pid<1||c.exitCode!==0||c.signal!==null||c.closeConfirmed!==true||c.spawnError!==null||c.timedOut!==false||c.overflow!==false||c.killAttempt!==null||c.accepted!==false||c.executionAttested!==false||c.sourceAuthenticityAttested!==false||c.publicationAuthorized!==false||c.modelInference!=='NOT_RUN'||c.nativeAppExecution!=='NOT_RUN'||c.node22!=='NOT_RUN'||c.status!=='COLLECTED_NODE24_ONLY'||c.descendantDrain!=='NOT_ATTESTED'||c.ownerInterventionRequired!==false)fail('CAPTURE_LIFECYCLE');
  if(!Array.isArray(c.command)||c.command.length!==2||c.command[0]!==i.command[0]||c.command[1]!==i.command[1]||c.cwd!==i.cwd||i.timeoutMs!==180000||i.maxOutputBytes!==1048576||i.network!==false||i.models!==false||i.nativeApp!==false||i.publication!==false)fail('CAPTURE_INTENT');
  if(sha(stdout.bytes)!==c.stdoutSha256||sha(stderr.bytes)!==c.stderrSha256||stderr.byteLength!==0)fail('CAPTURE_LOG');
  const summary=closed(JSON.parse(stdout.bytes.toString('utf8')),['status','evidence','archive','negativeControls','failure'],'CAPTURE_SUMMARY');
  const summaryArchive=closed(summary.archive,['path','sha256'],'CAPTURE_SUMMARY'),summaryNegative=closed(summary.negativeControls,['expected','observed','allExpectedLocationsDetected'],'CAPTURE_SUMMARY');
  if(summary.status!=='PASS_SCOPED'||summary.evidence!==receipt.value.evidence||summaryArchive.sha256!==archive.sha256||summaryArchive.path!==receipt.value.archive?.path||summaryNegative.expected!==73||summaryNegative.observed!==73||summaryNegative.allExpectedLocationsDetected!==true||summary.failure!==null)fail('CAPTURE_SUMMARY');
  const identity=(value,code='CAPTURE_IDENTITY')=>{
    const d=closed(value,['path','resolved','sha256','byteLength','device','inode','mode'],code);
    const absolute=v=>string(v)&&!v.includes('\0')&&path.isAbsolute(v)&&path.resolve(v)===v;
    if(!absolute(d.path)||!absolute(d.resolved)||d.path!==d.resolved||!hex(d.sha256)
      ||!['byteLength','device','inode','mode'].every(k=>Number.isSafeInteger(d[k])&&d[k]>=0)
      ||d.mode>0xffff||(d.mode&0o170000)!==0o100000)fail(code,'identity fields');
    return d;
  };
  const node=identity(i.node),writer=identity(i.writer),nodeBefore=identity(c.nodeBefore),writerBefore=identity(c.writerBefore),nodeAfter=identity(c.nodeAfter),writerAfter=identity(c.writerAfter);
  if(!hex(node.sha256)||!hex(writer.sha256)||!same(nodeBefore,node)||!same(nodeAfter,nodeBefore)||!same(writerBefore,writer)||!same(writerAfter,writerBefore))fail('CAPTURE_IDENTITY');
  const frozenNode=identity(ownerPins.node),frozenWriter=identity(ownerPins.writer);
  if(!same(node,frozenNode)||!same(writer,frozenWriter)||!same(i.command,ownerPins.command)||i.cwd!==ownerPins.cwd||i.version!==ownerPins.version)fail('CAPTURE_OWNER_PINS');
  const rtext=receipt.bytes.toString('utf8'),r=closed(receipt.value,['schema','status','observedAt','root','evidence','node','checks','sourceManifest','stageManifest','caseManifest','boundaries','archive','installed','toolchain','negativeControls','completedAt'],['failure'],'RECEIPT_SCHEMA');
  if(r.status!=='PASS_SCOPED'||r.schema!=='nisi-private-package-rehearsal-v1'||r.node.sha256!==node.sha256||r.node.version!==i.version||r.node.path!==node.path)fail('CAPTURE_RECEIPT');
  if(!r.archive||r.archive.sha256!==archive.sha256||r.archive.byteLength!==archive.byteLength||r.archive.path!==path.join(r.evidence,'nisi-0.2.0-private.0.tgz'))fail('CAPTURE_ARCHIVE');
  const retained=(value,file,name)=>{const d=closed(value,['path','sha256','byteLength'],'CAPTURE_DESCRIPTOR');if(d.path!==path.join(root,name)||d.sha256!==file.sha256||d.byteLength!==file.byteLength)fail('CAPTURE_DESCRIPTOR');return d;};
  retained(c.retainedReceipt,receipt,'receipt.json');retained(c.retainedArchive,archive,'archive.tgz');
  const retainedExpected=closed(c.retainedExpected,['path','sha256','byteLength'],'CAPTURE_DESCRIPTOR');if(retainedExpected.path!==path.join(root,'expected.json')||retainedExpected.sha256!==pins['expected.json'].sha256||retainedExpected.byteLength!==pins['expected.json'].byteLength)fail('CAPTURE_DESCRIPTOR');
  const archiveBefore=identity(c.archiveBefore),archiveAfter=identity(c.archiveAfter),receiptBefore=identity(c.receiptBefore),receiptAfter=identity(c.receiptAfter);
  const receiptEvidence=path.join(r.evidence,'receipt.json'),archiveEvidence=path.join(r.evidence,'nisi-0.2.0-private.0.tgz');
  if(!same(archiveBefore,archiveAfter)||!same(receiptBefore,receiptAfter)||archiveBefore.path!==archiveEvidence||archiveBefore.resolved!==archiveEvidence||archiveBefore.sha256!==archive.sha256||archiveBefore.byteLength!==archive.byteLength||receiptBefore.path!==receiptEvidence||receiptBefore.resolved!==receiptEvidence||receiptBefore.sha256!==receipt.sha256||receiptBefore.byteLength!==receipt.byteLength||c.expectedSha256!==pins['expected.json'].sha256)fail('CAPTURE_DESCRIPTOR');
  if(!same(r.sourceManifest,i.sourceManifest)||!same(r.stageManifest,i.stageManifest)||!same(r.caseManifest,i.caseManifest)||!same(r.toolchain,i.toolchain))fail('CAPTURE_INTENT');
  if(!same(contract.sourceManifest,i.sourceManifest)||!same(contract.stageManifest,i.stageManifest)||!same(contract.caseManifest,i.caseManifest)||!same(contract.toolchain,i.toolchain)||!sameLarge(contract.negativeLocations,i.negativeLocations))fail('CAPTURE_CONTRACT');
  if(!same(expected.sourceManifest,contract.sourceManifest)||!same(expected.stageManifest,contract.stageManifest)||!same(expected.caseManifest,contract.caseManifest)||!same(expected.toolchain,contract.toolchain)||!sameLarge(expected.negativeLocations,contract.negativeLocations))fail('CAPTURE_EXPECTED');
  if(r.observedAt<expected.notBefore||r.completedAt>expected.notAfter||start> Date.parse(r.observedAt)||Date.parse(r.completedAt)>end)fail('CAPTURE_TIME');
  const matrix=createRuntimeMatrix({rows:[{runtime:'node22',receipt:null,prerequisite:NODE22_PREREQUISITE},{runtime:'node24',receipt:rtext}],expected});if(matrix.status!=='INCOMPLETE'||matrix.rows.node22.status!=='NOT_RUN'||matrix.rows.node24.status!=='PASS')fail('CAPTURE_MATRIX');
  return {schema:'nisi.c09.owner-capture-consistency-v1',status:'CONSISTENT_NODE24_ONLY',node22:'NOT_RUN',matrixStatus:matrix.status,scope:'TRUSTED_OWNER_CAPTURE_CONSISTENCY',authorizing:false,executionAttested:false,sourceAuthenticityAttested:false,files:Object.fromEntries(NAMES.map(n=>[n,{sha256:pins[n].sha256,byteLength:pins[n].byteLength}]))};
}
export function inspectOwnerCapture(input){
  try{
    const a=closed(input,['root','pins','contract','ownerPins'],'CAPTURE_INPUT');
    const fields=closed(a.contract,['sourceManifest','stageManifest','caseManifest','toolchain','negativeLocations'],'CAPTURE_CONTRACT');
    const contract=Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,snapshot(value,0,new WeakSet(),key==='negativeLocations')]));
    const ownerPins=closed(snapshot(a.ownerPins),['node','writer','command','cwd','version'],'CAPTURE_OWNER_PINS');
    const root=a.root;if(!path.isAbsolute(root)||root!==path.resolve(root))fail('CAPTURE_PATH');
    if(!Array.isArray(ownerPins.command)||ownerPins.command.length!==2||typeof ownerPins.cwd!=='string'||typeof ownerPins.version!=='string')fail('CAPTURE_OWNER_PINS');
    const s=fs.lstatSync(root);if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o077)||fs.realpathSync(root)!==root)fail('CAPTURE_PATH');
    const files=Object.fromEntries(NAMES.map(n=>[n,readFile(root,n,n==='archive.tgz'?MAX.archive:n==='stdout.log'?MAX.stdout:n==='stderr.log'?MAX.stderr:MAX.json)]));
    const pins=closed(a.pins,NAMES,'CAPTURE_PINS');for(const n of NAMES)descriptor(pins,n,files[n]);
    const parsed=Object.fromEntries(['capture.json','intent.json','receipt.json','expected.json'].map(n=>[n,json(files[n])]));
    return validate(root,parsed['capture.json'],parsed['intent.json'],{...files['receipt.json'],value:parsed['receipt.json']},files['archive.tgz'],parsed['expected.json'],files['stdout.log'],files['stderr.log'],pins,contract,ownerPins);
  }catch(error){return Object.freeze({schema:'nisi.c09.owner-capture-consistency-v1',status:'REFUSED',reason:error.code??'CAPTURE_ERROR',node22:'NOT_RUN',authorizing:false,executionAttested:false,sourceAuthenticityAttested:false,scope:'TRUSTED_OWNER_CAPTURE_CONSISTENCY'});}
}
