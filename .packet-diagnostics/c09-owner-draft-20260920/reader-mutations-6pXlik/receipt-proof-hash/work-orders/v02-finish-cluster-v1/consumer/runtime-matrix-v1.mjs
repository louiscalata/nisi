// PRIVATE — Nisi v0.2 finish cluster C09. Pure report reader for separately
// retained staged-rehearsal receipts written by scripts/check-private-package.mjs.
// It touches no filesystem, process, installer, network or model: the caller
// hands it retained receipt text per supported runtime (parsed objects are
// inspection-only through readRehearsalRecord), and
// a runtime that was never run stays NOT_RUN with the caller's concrete
// prerequisite. Reads are closed: unknown fields, accessors, foreign prototypes
// and sparse arrays refuse with a named code, and no row is ever coerced toward
// PASS. The matrix is advisory evidence (authorizing:false), not acceptance.
import {createHash} from 'node:crypto';
import {posix} from 'node:path';
import {types as nodeTypes} from 'node:util';
import {PRIVATE_PACKAGE_FILES} from '../../../scripts/private-package-contract.mjs';

export const RUNTIME_MATRIX_SCHEMA='nisi-private-runtime-matrix-v1';
export const REHEARSAL_SCHEMA='nisi-private-package-rehearsal-v1';
export const SUPPORTED_RUNTIMES=Object.freeze([Object.freeze({id:'node22',major:22}),Object.freeze({id:'node24',major:24})]);
export const ROW_STATUSES=Object.freeze(['PASS','NOT_RUN','MALFORMED','UNSUPPORTED','FAIL','MISMATCH','STALE','SKIPPED']);
export const NPM_ISOLATION_FLAGS=Object.freeze(['--offline','--ignore-scripts','--no-audit','--no-fund']);
export const ARCHIVE_FILENAME='nisi-0.2.0-private.0.tgz';
export const REHEARSAL_SCRIPT='scripts/check-private-package.mjs';
// The rehearsal's declared boundaries, verbatim. Any other value is a different rehearsal, not evidence for this matrix.
export const REHEARSAL_BOUNDARIES=Object.freeze({stagedArchiveOnly:true,canonicalRootPackSupported:false,networkAllowed:false,lifecycleScriptsAllowed:false,modelInference:false,nativeExecution:false,published:false,fullMerger:false,hostileWriterIsolation:false});
// Concrete prerequisite for the Node 22 row. Nothing here downloads, installs or selects a runtime automatically.
export const NODE22_PREREQUISITE='An approved Node 22 runtime is not installed on this host. Prerequisite: the owner places an approved Node 22 binary in an isolated prefix outside the checkout (no package-manager or network fetch by this tool), then runs the existing rehearsal under that binary from the checkout root: PATH=<node22-prefix>/bin:$PATH NISI_INSTALLED_ARCHIVE_CHECK=1 <node22-prefix>/bin/node scripts/check-private-package.mjs, and supplies the retained receipt.json as this row.';
export const MAX_RECEIPT_BYTES=4*1024*1024;
export const MAX_ARRAY_LENGTH=128;
const MAX_KEYS=64,MAX_STRING_BYTES=8192,MAX_STDOUT_BYTES=2*1024*1024,MAX_STDERR_BYTES=256*1024,MAX_DIAGNOSTICS=512;

export class RuntimeMatrixError extends Error {
  constructor(code,detail){super(detail?code+': '+detail:code);this.name='RuntimeMatrixError';this.code=code;this.detail=detail??null;}
}
const refuse=(code,detail)=>{throw new RuntimeMatrixError(code,detail);};
const HEX64=/^[0-9a-f]{64}$/u, VERSION=/^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
// Re-derive all location-bearing TS diagnostics, including unexpected files.
// Matching only the writer's negative-* names would silently ignore extra errors.
const DIAGNOSTIC=/^([^\r\n(]+)\((\d+),\d+\): error TS\d+:/gmu;
const RECORD_STATUSES=['PASS_SCOPED','FAIL','INCOMPLETE'];
const sha=text=>createHash('sha256').update(text,'utf8').digest('hex');
const guarded=v=>{if(v!==null&&typeof v==='object'&&nodeTypes.isProxy(v))refuse('RECEIPT_SCHEMA','proxy');return v;};
const plain=v=>{guarded(v);return v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));};
// Closed object read: string keys only, required ∪ optional, data descriptors only.
function fields(value,required,optional,code){
  if(!plain(value))refuse(code,'object');
  if(Reflect.ownKeys(value).length>MAX_KEYS)refuse(code,'too many fields');
  const d=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(d);
  if(keys.some(k=>typeof k!=='string'||!(required.includes(k)||optional.includes(k))))refuse(code,'unknown field');
  for(const k of required)if(!(k in d))refuse(code,'missing '+k);
  const out=Object.create(null);
  for(const k of keys){const x=d[k];if(!x.enumerable||!Object.hasOwn(x,'value'))refuse(code,'accessor '+k);out[k]=x.value;}
  return out;
}
// Closed array read: real Array, dense, data slots only.
function list(value,code,name){
  guarded(value);
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)refuse(code,name);
  const n=Object.getOwnPropertyDescriptor(value,'length')?.value;
  if(!Number.isSafeInteger(n)||n<0||n>MAX_ARRAY_LENGTH)refuse(code,name+' shape');
  if(Reflect.ownKeys(value).length!==n+1)refuse(code,name+' shape');
  const d=Object.getOwnPropertyDescriptors(value);
  const out=[];
  for(let i=0;i<n;i+=1){const x=d[i];if(!x?.enumerable||!Object.hasOwn(x,'value'))refuse(code,name+' slot');out.push(x.value);}
  return out;
}
const bounded=(v,code,name,max=MAX_STRING_BYTES)=>{if(typeof v!=='string'||!v.isWellFormed()||Buffer.byteLength(v,'utf8')>max)refuse(code,name);return v;};
const str=(v,code,name)=>{if(v==='')refuse(code,name);return bounded(v,code,name);};
const text=(v,code,name)=>bounded(v,code,name);
const nullable=(check)=>(v,code,name)=>v===null?null:check(v,code,name);
const hex=(v,code,name)=>{if(typeof v!=='string'||!HEX64.test(v))refuse(code,name);return v;};
const bool=(v,code,name)=>{if(typeof v!=='boolean')refuse(code,name);return v;};
const count=(v,code,name)=>{if(!Number.isSafeInteger(v)||v<0)refuse(code,name);return v;};
const integer=(v,code,name)=>{if(!Number.isSafeInteger(v))refuse(code,name);return v;};
const strings=(v,code,name)=>Object.freeze(list(v,code,name).map(x=>str(x,code,name+' entry')));
const iso=(v,code,name)=>{str(v,code,name);const t=Date.parse(v);if(!Number.isFinite(t)||new Date(t).toISOString()!==v)refuse(code,name);return t;};
// {relativeFile: sha256} with sorted, frozen keys. Key types are checked before sorting: a symbol key would otherwise
// throw a foreign TypeError out of Array.prototype.sort instead of this reader's own code.
function manifest(value,code,name){
  if(!plain(value))refuse(code,name);
  const keys=Reflect.ownKeys(value),out=Object.create(null);
  if(keys.length>MAX_KEYS)refuse(code,name+' size');
  if(keys.some(k=>typeof k!=='string'))refuse(code,name+' key');
  for(const k of keys)str(k,code,name+' key');
  const d=Object.getOwnPropertyDescriptors(value);
  for(const k of keys.sort()){
    const x=d[k];if(!x.enumerable||!Object.hasOwn(x,'value'))refuse(code,name+' accessor');
    str(k,code,name+' key');out[k]=hex(x.value,code,name+' '+k);
  }
  return Object.freeze(out);
}
const sameKeys=(a,b)=>a.length===b.length&&a.every((k,i)=>k===b[i]);
const keysOf=m=>Object.keys(m);

const RECORD_REQUIRED=['schema','status','observedAt','root','evidence','node','checks','sourceManifest','stageManifest','caseManifest','boundaries','completedAt'];
const RECORD_OPTIONAL=['archive','installed','toolchain','negativeControls','failure'];
// The writer serialises a check whose spawn failed (error set) without stdout/stderr: spawnSync leaves them undefined and
// JSON.stringify drops the keys. They are required whenever the check actually ran (error null).
const CHECK_REQUIRED=['name','exe','args','cwd','elapsedMs','exitCode','signal','error'],CHECK_OPTIONAL=['stdout','stderr'];
// Closed read of one retained receipt. Throws RECEIPT_* (malformed) or UNSUPPORTED_* (a different rehearsal).
export function readRehearsalRecord(value){
  const R='RECEIPT_SCHEMA';
  if(!plain(value))refuse(R,'object');
  const schema=Object.getOwnPropertyDescriptor(value,'schema');
  if(!schema||!Object.hasOwn(schema,'value')||typeof schema.value!=='string')refuse(R,'schema');
  str(schema.value,R,'schema');
  if(schema.value!==REHEARSAL_SCHEMA)refuse('UNSUPPORTED_SCHEMA',schema.value);
  const r=fields(value,RECORD_REQUIRED,RECORD_OPTIONAL,R);
  str(r.status,R,'status');
  if(!RECORD_STATUSES.includes(r.status))refuse('UNSUPPORTED_STATUS',r.status);
  const node=fields(r.node,['version','path','sha256'],[],R);
  const version=str(node.version,R,'node.version'),match=VERSION.exec(version);if(!match)refuse(R,'node.version');
  const checks=list(r.checks,R,'checks').map(c=>{
    const x=fields(c,CHECK_REQUIRED,CHECK_OPTIONAL,R),error=nullable(str)(x.error,R,'check.error');
    for(const k of CHECK_OPTIONAL)if(error===null&&!(k in x))refuse(R,'missing check.'+k);
    return Object.freeze({name:str(x.name,R,'check.name'),exe:str(x.exe,R,'check.exe'),args:strings(x.args,R,'check.args'),cwd:str(x.cwd,R,'check.cwd'),
      elapsedMs:nullable(count)(x.elapsedMs,R,'check.elapsedMs'),exitCode:nullable(integer)(x.exitCode,R,'check.exitCode'),signal:nullable(str)(x.signal,R,'check.signal'),
      error,stdout:'stdout' in x?bounded(x.stdout,R,'check.stdout',MAX_STDOUT_BYTES):null,stderr:'stderr' in x?bounded(x.stderr,R,'check.stderr',MAX_STDERR_BYTES):null});
  });
  const boundaries=fields(r.boundaries,keysOf(REHEARSAL_BOUNDARIES),[],R);
  for(const k of keysOf(REHEARSAL_BOUNDARIES)){bool(boundaries[k],R,'boundaries.'+k);if(boundaries[k]!==REHEARSAL_BOUNDARIES[k])refuse('UNSUPPORTED_BOUNDARY',k);}
  const observed=iso(r.observedAt,R,'observedAt'),completed=iso(r.completedAt,R,'completedAt');
  if(completed<observed)refuse(R,'timestamps');
  let archive=null,installed=null,toolchain=null,negativeControls=null,failure=null;
  if('archive' in r){const a=fields(r.archive,['path','sha256','byteLength','entries'],[],R);archive=Object.freeze({path:str(a.path,R,'archive.path'),sha256:hex(a.sha256,R,'archive.sha256'),byteLength:count(a.byteLength,R,'archive.byteLength'),entries:manifest(a.entries,R,'archive.entries')});}
  if('installed' in r){const i=fields(r.installed,['path','exactArchiveMatch'],[],R);installed=Object.freeze({path:str(i.path,R,'installed.path'),exactArchiveMatch:bool(i.exactArchiveMatch,R,'installed.exactArchiveMatch')});}
  if('toolchain' in r){const t=fields(r.toolchain,['compilerPath','compilerEntrySha256','typescript','nodeTypes','lockSha256','typeRoots'],[],R);toolchain=Object.freeze({compilerPath:str(t.compilerPath,R,'toolchain.compilerPath'),compilerEntrySha256:hex(t.compilerEntrySha256,R,'toolchain.compilerEntrySha256'),typescript:str(t.typescript,R,'toolchain.typescript'),nodeTypes:str(t.nodeTypes,R,'toolchain.nodeTypes'),lockSha256:hex(t.lockSha256,R,'toolchain.lockSha256'),typeRoots:strings(t.typeRoots,R,'toolchain.typeRoots')});}
  if('negativeControls' in r){const n=fields(r.negativeControls,['expected','observed','allExpectedLocationsDetected'],[],R);negativeControls=Object.freeze({expected:count(n.expected,R,'negativeControls.expected'),observed:count(n.observed,R,'negativeControls.observed'),allExpectedLocationsDetected:bool(n.allExpectedLocationsDetected,R,'negativeControls.allExpectedLocationsDetected')});}
  if('failure' in r){const f=fields(r.failure,['name','message','code'],[],R);failure=Object.freeze({name:str(f.name,R,'failure.name'),message:text(f.message,R,'failure.message'),code:nullable(str)(f.code,R,'failure.code')});}
  return Object.freeze({schema:REHEARSAL_SCHEMA,status:r.status,observedAt:r.observedAt,completedAt:r.completedAt,wallClockMs:completed-observed,root:str(r.root,R,'root'),evidence:str(r.evidence,R,'evidence'),
    node:Object.freeze({version,major:Number(match[1]),path:str(node.path,R,'node.path'),sha256:hex(node.sha256,R,'node.sha256')}),checks:Object.freeze(checks),
    sourceManifest:manifest(r.sourceManifest,R,'sourceManifest'),stageManifest:manifest(r.stageManifest,R,'stageManifest'),caseManifest:manifest(r.caseManifest,R,'caseManifest'),
    archive,installed,toolchain,negativeControls,failure});
}

// The exact npm route the rehearsal takes for a given evidence directory (scripts/check-private-package.mjs lines 39-55).
// Both the judge and rehearsalCommands() spell it from here, so a retained argv is bound to this route token for token:
// npm applies the last occurrence of a flag, so '--offline ... --no-offline' would otherwise read as offline.
function npmRoute(evidence){
  const cache=posix.join(evidence,'npm-cache');
  return {pack:{cwd:posix.join(evidence,'stage'),exe:'npm',args:['pack',...NPM_ISOLATION_FLAGS,'--cache',cache,'--json','--pack-destination',evidence]},
    install:{cwd:posix.join(evidence,'consumer'),exe:'npm',args:['install',posix.join(evidence,ARCHIVE_FILENAME),...NPM_ISOLATION_FLAGS,'--cache',cache,'--package-lock=false']}};
}
// Check roles are derived from what was executed, not from the free-text name.
// TypeScript, negative-control and runtime checks count only when the identified
// runtime binary executed them; anything else is not evidence for this row.
const isTsc=c=>c.args[0]!==undefined&&c.args[0].endsWith('/typescript/bin/tsc');
const mts=args=>args.filter(a=>a.endsWith('.mts'));
const ROLES={
  pack:(c)=>c.exe==='npm'&&c.args[0]==='pack',
  install:(c)=>c.exe==='npm'&&c.args[0]==='install',
  typescript:(c,node)=>c.exe===node.path&&isTsc(c)&&mts(c.args).length>0&&!mts(c.args).some(a=>a.startsWith('negative-')),
  negative:(c,node)=>c.exe===node.path&&isTsc(c)&&mts(c.args).length>0&&mts(c.args).every(a=>a.startsWith('negative-')),
  runtime:(c,node)=>c.exe===node.path&&c.args[0]==='--test',
};
const ROLE_CODES={pack:'PACK',install:'INSTALL',typescript:'TYPESCRIPT',negative:'NEGATIVE_CONTROL',runtime:'RUNTIME'};
function classify(record){
  const found=Object.create(null),duplicate=Object.create(null);
  for(const role of keysOf(ROLES)){const hits=record.checks.filter(c=>ROLES[role](c,record.node));found[role]=hits[0]??null;duplicate[role]=hits.length>1;}
  return {found,duplicate};
}
function tapSummary(stdout){
  if(stdout===null)return null;
  const out=Object.create(null);
  for(const k of ['tests','pass','fail','cancelled','skipped','todo']){const ms=[...stdout.matchAll(new RegExp('^# '+k+' (0|[1-9][0-9]*)$','gmu'))];if(ms.length!==1)return null;out[k]=Number(ms[0][1]);}
  const plans=[...stdout.matchAll(/^1\.\.(0|[1-9][0-9]*)$/gmu)];if(plans.length!==1||Number(plans[0][1])!==out.tests)return null;
  return Object.freeze(out);
}
const clean=c=>c.signal===null&&c.error===null;
// The writer's evidence layout: <root>/.build/private-package-<tmp>/{stage,consumer,nisi-0.2.0-private.0.tgz}.
const evidenceUnderRoot=(root,evidence)=>{const prefix=root+'/.build/private-package-',rest=evidence.slice(prefix.length);return posix.isAbsolute(root)&&root===posix.normalize(root)&&evidence.startsWith(prefix)&&rest.length>0&&!rest.includes('/');};
// First failing verdict wins; returns [status, reason]. Order: identity, retained outcome, evidence presence, staleness, then each check.
function judge(runtime,record,expected){
  if(!SUPPORTED_RUNTIMES.some(r=>r.major===record.node.major))return ['UNSUPPORTED','RUNTIME_UNSUPPORTED'];
  if(record.node.major!==runtime.major)return ['MISMATCH','RUNTIME_RELABELED'];
  if(record.status==='FAIL'||record.failure!==null)return ['FAIL','REHEARSAL_FAILED'];
  if(record.status!=='PASS_SCOPED')return ['FAIL','REHEARSAL_INCOMPLETE'];
  if(expected===null)return ['SKIPPED','EXPECTED_CONTRACT_MISSING'];
  const observed=Date.parse(record.observedAt),completed=Date.parse(record.completedAt);
  if(observed<expected.notBefore||observed>completed||completed>expected.notAfter)return ['STALE','OBSERVATION_OUTSIDE_WINDOW'];
  for(const [field,reason] of [['archive','ARCHIVE'],['installed','INSTALL'],['toolchain','TOOLCHAIN'],['negativeControls','NEGATIVE_CONTROL']])
    if(record[field]===null)return ['SKIPPED',reason+'_EVIDENCE_MISSING'];
  const files=PRIVATE_PACKAGE_FILES,cases=keysOf(record.caseManifest);
  for(const m of [record.archive.entries,record.sourceManifest,record.stageManifest])
    if(!sameKeys(keysOf(m),files))return ['STALE','INVENTORY_STALE'];
  for(const [field,reason] of [['sourceManifest','SOURCE_STALE'],['stageManifest','STAGE_STALE'],['caseManifest','CASES_STALE']]){
    const keys=keysOf(expected[field]);
    if(!sameKeys(keysOf(record[field]),keys)||keys.some(f=>record[field][f]!==expected[field][f]))return ['STALE',reason];
  }
  if(files.some(f=>f!=='package.json'&&record.stageManifest[f]!==record.sourceManifest[f]))return ['FAIL','SOURCE_STAGE_DRIFT'];
  if(JSON.stringify(record.toolchain)!==JSON.stringify(expected.toolchain))return ['STALE','TOOLCHAIN_STALE'];
  if(files.some(f=>record.archive.entries[f]!==record.stageManifest[f]))return ['FAIL','STAGE_ARCHIVE_DRIFT'];
  if(record.installed.exactArchiveMatch!==true)return ['FAIL','INSTALL_NOT_EXACT'];
  if(!evidenceUnderRoot(record.root,record.evidence))return ['FAIL','EVIDENCE_OUTSIDE_ROOT'];
  const route=npmRoute(record.evidence),cwd=route.install.cwd;
  if(record.archive.path!==route.install.args[1])return ['FAIL','ARCHIVE_PATH_MISMATCH'];
  if(record.installed.path!==posix.join(cwd,'node_modules/nisi'))return ['FAIL','INSTALL_PATH_MISMATCH'];
  const typeCases=cases.filter(f=>f.endsWith('.mts')),runtimeCases=cases.filter(f=>f.endsWith('.test.mjs'));
  const flags=['--noEmit','--ignoreConfig','--strict','--exactOptionalPropertyTypes','--noUncheckedIndexedAccess','--module','NodeNext','--target','ES2022','--types','node','--typeRoots',record.toolchain.typeRoots[0]];
  const plans=[
    {...route.pack,exitCode:0,role:'PACK'},
    {exe:'tar',args:['-tzf',record.archive.path],cwd,exitCode:0,role:'ARCHIVE_INVENTORY'},
    ...files.map(f=>({exe:'tar',args:['-xOf',record.archive.path,'package/'+f],cwd,exitCode:0,role:'ARCHIVE_EXTRACTION'})),
    {...route.install,exitCode:0,role:'INSTALL'},
    {exe:record.node.path,args:[record.toolchain.compilerPath,...flags,...typeCases],cwd,exitCode:0,role:'TYPESCRIPT'},
    {exe:record.node.path,args:[record.toolchain.compilerPath,...flags,...typeCases.map(f=>'negative-'+f)],cwd,exitCode:2,role:'NEGATIVE_CONTROL'},
    {exe:record.node.path,args:['--test','--test-reporter=tap',...runtimeCases],cwd,exitCode:0,role:'RUNTIME'}
  ];
  if(record.checks.length!==plans.length)return ['FAIL','CHECK_SET_MISMATCH'];
  for(const [i,plan] of plans.entries()){
    const c=record.checks[i];
    if(!clean(c))return ['FAIL','CHECK_ABORTED'];
    if(c.exe!==plan.exe||c.cwd!==plan.cwd||!sameKeys(c.args,plan.args))return ['FAIL',plan.role+'_COMMAND_MISMATCH'];
    if(c.exitCode!==plan.exitCode)return ['FAIL',plan.role+'_EXIT_MISMATCH'];
  }
  const [pack,inventory]=record.checks,negative=record.checks[33],runtimeCheck=record.checks[34];
  let packed;try{packed=JSON.parse(pack.stdout);}catch{return ['FAIL','PACK_JSON_MISSING'];}
  if(!Array.isArray(packed)||packed.length!==1||packed[0]===null||typeof packed[0]!=='object'||packed[0].filename!==ARCHIVE_FILENAME||
    !Array.isArray(packed[0].files)||packed[0].files.length!==files.length||
    packed[0].files.some(f=>f===null||typeof f!=='object'||typeof f.path!=='string'||Buffer.byteLength(f.path)>MAX_STRING_BYTES)||
    !sameKeys(packed[0].files.map(f=>f.path).sort(),files))return ['FAIL','PACK_INVENTORY_MISMATCH'];
  const names=inventory.stdout.trim().split('\n');
  if(names.length!==files.length||!sameKeys(names.sort(),files.map(f=>'package/'+f)))return ['FAIL','ARCHIVE_INVENTORY_MISMATCH'];
  for(const [i,file] of files.entries())if(sha(record.checks[i+2].stdout)!==record.stageManifest[file])return ['FAIL','ARCHIVE_EXTRACTION_HASH_MISMATCH'];
  const n=record.negativeControls;
  if(n.expected!==73||n.observed<73||n.observed>MAX_DIAGNOSTICS||n.allExpectedLocationsDetected!==true)return ['FAIL','NEGATIVE_CONTROLS_INCOMPLETE'];
  if(/^error TS\d+:/mu.test(negative.stdout))return ['FAIL','NEGATIVE_DIAGNOSTICS_MISMATCH'];
  const expectedLocations=new Set(expected.negativeLocations.map(d=>d.file+'\0'+d.line)),seen=new Set();let observedCount=0;
  for(const match of negative.stdout.matchAll(DIAGNOSTIC)){
    observedCount+=1;if(observedCount>MAX_DIAGNOSTICS)return ['FAIL','NEGATIVE_DIAGNOSTICS_TOO_MANY'];
    const location=match[1]+'\0'+Number(match[2]);
    if(!expectedLocations.has(location))return ['FAIL','NEGATIVE_DIAGNOSTICS_MISMATCH'];
    seen.add(location);
  }
  if(observedCount!==n.observed||seen.size!==expectedLocations.size)return ['FAIL','NEGATIVE_DIAGNOSTICS_MISMATCH'];
  const summary=tapSummary(runtimeCheck.stdout);
  if(summary===null)return ['FAIL','RUNTIME_SUMMARY_MISSING'];
  if(summary.skipped>0||summary.todo>0)return ['SKIPPED','RUNTIME_TESTS_SKIPPED'];
  if(summary.tests!==11||summary.pass!==11||summary.fail!==0||summary.cancelled!==0)return ['FAIL','RUNTIME_TESTS_FAILED'];
  return ['PASS',null];
}
const NULL_DURATIONS=Object.freeze({packMs:null,installMs:null,typescriptMs:null,negativeControlsMs:null,runtimeMs:null,wallClockMs:null});
const emptyRow=(runtime,status,reason,prerequisite,receiptSha256)=>({runtime:runtime.id,major:runtime.major,status,reason,prerequisite,receiptSha256,receiptByteLength:null,node:null,archive:null,evidence:null,observedAt:null,completedAt:null,toolchain:null,typescript:null,negativeControls:null,runtimeTests:null,durations:NULL_DURATIONS,tokens:null,failure:null});
function readRow(runtime,receipt,prerequisite,expected){
  if(receipt===null)return emptyRow(runtime,'NOT_RUN','RUNTIME_NOT_INSTALLED',prerequisite,null);
  let value=receipt,receiptSha256=null;
  let receiptByteLength=null;
  if(typeof receipt==='string'){receiptByteLength=Buffer.byteLength(receipt,'utf8');if(receiptByteLength>MAX_RECEIPT_BYTES)return emptyRow(runtime,'MALFORMED','RECEIPT_TOO_LARGE',null,null);receiptSha256=sha(receipt);try{value=JSON.parse(receipt);}catch{return emptyRow(runtime,'MALFORMED','RECEIPT_JSON',null,receiptSha256);}}
  else return emptyRow(runtime,'MALFORMED','RECEIPT_TEXT_REQUIRED',null,null);
  let record;
  try{record=readRehearsalRecord(value);}catch(error){
    if(!(error instanceof RuntimeMatrixError))throw error;
    return emptyRow(runtime,error.code.startsWith('UNSUPPORTED_')?'UNSUPPORTED':'MALFORMED',error.code,null,receiptSha256);
  }
  const checks=classify(record),verdict=judge(runtime,record,expected);let [status,reason]=verdict;const f=checks.found;
  const ms=role=>f[role]===null||checks.duplicate[role]?null:f[role].elapsedMs;
  const tap=f.runtime===null?null:tapSummary(f.runtime.stdout);
  const proof=expected?.observations[runtime.id];
  if(status==='PASS'&&(!proof||proof.receiptByteLength!==receiptByteLength||proof.node.major!==record.node.major||proof.node.version!==record.node.version||proof.node.path!==record.node.path||proof.node.sha256!==record.node.sha256||proof.archive.sha256!==(record.archive?.sha256??null)||proof.archive.byteLength!==(record.archive?.byteLength??null))) {status='STALE';reason='CALLER_PROOF_MISMATCH';}
  return {runtime:runtime.id,major:runtime.major,status,reason,prerequisite:null,receiptSha256,receiptByteLength,
    node:{version:record.node.version,path:record.node.path,sha256:record.node.sha256},
    archive:record.archive===null?null:{path:record.archive.path,sha256:record.archive.sha256,byteLength:record.archive.byteLength,entries:keysOf(record.archive.entries).length},
    evidence:{path:record.evidence,root:record.root},observedAt:record.observedAt,completedAt:record.completedAt,
    toolchain:record.toolchain===null?null:{typescript:record.toolchain.typescript,nodeTypes:record.toolchain.nodeTypes,compilerEntrySha256:record.toolchain.compilerEntrySha256,lockSha256:record.toolchain.lockSha256},
    typescript:f.typescript===null?null:{cases:mts(f.typescript.args).length,exitCode:f.typescript.exitCode},
    negativeControls:record.negativeControls===null?null:{...record.negativeControls},
    runtimeTests:tap===null?null:{...tap},
    // Unknown per-check durations stay null; tokens are always null because the rehearsal declares modelInference:false.
    durations:{packMs:ms('pack'),installMs:ms('install'),typescriptMs:ms('typescript'),negativeControlsMs:ms('negative'),runtimeMs:ms('runtime'),wallClockMs:record.wallClockMs},
    tokens:null,failure:record.failure===null?null:{...record.failure}};
}
// Explicit owner-supplied pins: missing pins are inspectable but never earn PASS.
// The package-file inventory is the imported contract, not an authenticity claim.
function readExpected(value){
  const E='MATRIX_EXPECTED_SCHEMA';
  if(value===undefined||value===null)return null;
  const e=fields(value,['sourceManifest','stageManifest','caseManifest','toolchain','negativeLocations','notBefore','notAfter','observations'],[],E);
  const maps={sourceManifest:manifest(e.sourceManifest,E,'sourceManifest'),stageManifest:manifest(e.stageManifest,E,'stageManifest'),caseManifest:manifest(e.caseManifest,E,'caseManifest')};
  for(const [name,m] of Object.entries(maps))if(!sameKeys(keysOf(m),PRIVATE_PACKAGE_FILES)&&name!=='caseManifest')refuse(E,name+' inventory');
  const caseFiles=Object.keys(maps.caseManifest).sort();
  if(caseFiles.length!==12||caseFiles.filter(f=>f.endsWith('.mts')).length!==8||caseFiles.filter(f=>f.endsWith('.test.mjs')).length!==4)refuse(E,'caseManifest inventory');
  const t=fields(e.toolchain,['compilerPath','compilerEntrySha256','typescript','nodeTypes','lockSha256','typeRoots'],[],E);
  const toolchain={compilerPath:str(t.compilerPath,E,'toolchain.compilerPath'),compilerEntrySha256:hex(t.compilerEntrySha256,E,'toolchain.compilerEntrySha256'),typescript:str(t.typescript,E,'toolchain.typescript'),nodeTypes:str(t.nodeTypes,E,'toolchain.nodeTypes'),lockSha256:hex(t.lockSha256,E,'toolchain.lockSha256'),typeRoots:strings(t.typeRoots,E,'toolchain.typeRoots')};
  if(toolchain.typeRoots.length!==1)refuse(E,'toolchain.typeRoots');
  const locations=list(e.negativeLocations,E,'negativeLocations').map((x)=>{const q=fields(x,['file','line'],[],E);return Object.freeze({file:str(q.file,E,'negativeLocations.file'),line:integer(q.line,E,'negativeLocations.line')});});
  const negativeFiles=new Set(caseFiles.filter(f=>f.endsWith('.mts')).map(f=>'negative-'+f));
  if(locations.length!==73||locations.some(x=>x.line<1||!negativeFiles.has(x.file))||new Set(locations.map(x=>x.file+'\0'+x.line)).size!==locations.length)refuse(E,'negativeLocations');
  const notBefore=iso(e.notBefore,E,'notBefore'),notAfter=iso(e.notAfter,E,'notAfter');if(notAfter<notBefore)refuse(E,'cutoff');
  const rawObs=fields(e.observations,['node22','node24'],[],E),observations=Object.create(null);
  for(const runtime of SUPPORTED_RUNTIMES){const o=rawObs[runtime.id];if(o===null){observations[runtime.id]=null;continue;}const q=fields(o,['receiptSha256','receiptByteLength','node','archive'],[],E),n=fields(q.node,['version','path','sha256'],[],E),a=fields(q.archive,['sha256','byteLength'],[],E);const version=str(n.version,E,'observation.node.version'),match=VERSION.exec(version);if(!match)refuse(E,'observation.node.version');observations[runtime.id]=Object.freeze({receiptSha256:hex(q.receiptSha256,E,'observation.receiptSha256'),receiptByteLength:count(q.receiptByteLength,E,'observation.receiptByteLength'),node:Object.freeze({version,path:str(n.path,E,'observation.node.path'),sha256:hex(n.sha256,E,'observation.node.sha256'),major:Number(match[1])}),archive:Object.freeze({sha256:hex(a.sha256,E,'observation.archive.sha256'),byteLength:count(a.byteLength,E,'observation.archive.byteLength')})});}
  return {sourceManifest:maps.sourceManifest,stageManifest:maps.stageManifest,caseManifest:maps.caseManifest,caseFiles,toolchain,negativeLocations:locations,notBefore,notAfter,observations};
}
// A NOT_RUN row's prerequisite must at least name the row's major and the existing rehearsal script: a placeholder is not a prerequisite.
const concretePrerequisite=(p,runtime)=>typeof p==='string'&&p.length>0&&p.isWellFormed()&&Buffer.byteLength(p,'utf8')<=MAX_STRING_BYTES&&p.includes(REHEARSAL_SCRIPT)&&p.includes('Node '+runtime.major);
const deepFreeze=v=>{if(v!==null&&typeof v==='object'&&!Object.isFrozen(v)){Object.freeze(v);for(const x of Object.values(v))deepFreeze(x);}return v;};
// rows: one {runtime, receipt: text|null, prerequisite?} per supported runtime.
// Missing expected pins cannot PASS; an object receipt is visibly MALFORMED.
export function createRuntimeMatrix(input){
  const i=fields(input,['rows'],['expected'],'MATRIX_INPUT_SCHEMA'),expected=readExpected(i.expected);
  const rows=list(i.rows,'MATRIX_ROWS_SCHEMA','rows'),byId=Object.create(null);
  if(rows.length!==2)refuse('MATRIX_ROWS_SCHEMA','exactly two runtimes');
  for(const value of rows){
    const r=fields(value,['runtime','receipt'],['prerequisite'],'MATRIX_ROW_SCHEMA');
    const runtime=SUPPORTED_RUNTIMES.find(s=>s.id===r.runtime);
    if(!runtime)refuse('MATRIX_ROWS_SCHEMA','unknown runtime');
    if(byId[runtime.id])refuse('MATRIX_ROWS_SCHEMA','duplicate '+runtime.id);
    const prerequisite=r.prerequisite===undefined?null:r.prerequisite;
    if(r.receipt===null){if(!concretePrerequisite(prerequisite,runtime))refuse('MATRIX_ROW_SCHEMA','prerequisite');}
    else{if(typeof r.receipt!=='string'&&typeof r.receipt!=='object')refuse('MATRIX_ROW_SCHEMA','receipt');if(prerequisite!==null)refuse('MATRIX_ROW_SCHEMA','prerequisite on a retained row');}
    byId[runtime.id]=readRow(runtime,r.receipt,prerequisite,expected);
  }
  if(SUPPORTED_RUNTIMES.some(s=>!byId[s.id]))refuse('MATRIX_ROWS_SCHEMA','every supported runtime needs a row');
  const out=Object.create(null);for(const s of SUPPORTED_RUNTIMES)out[s.id]=byId[s.id];
  const reasons=[];
  // Independent rows must still describe one artifact: differing archives fail every retained row.
  const archives=new Set(Object.values(out).filter(r=>r.archive!==null).map(r=>r.archive.sha256));
  let archive=null;
  if(archives.size>1){reasons.push('ARCHIVE_MISMATCH');for(const r of Object.values(out))if(r.archive!==null){r.status='MISMATCH';r.reason='CROSS_RUNTIME_ARCHIVE';}}
  else if(archives.size===1){const first=Object.values(out).find(r=>r.archive!==null);archive={sha256:first.archive.sha256,byteLength:first.archive.byteLength,entries:first.archive.entries};if(Object.values(out).some(r=>r.archive!==null&&(r.archive.byteLength!==archive.byteLength||r.archive.entries!==archive.entries))){archive=null;reasons.push('ARCHIVE_MISMATCH');for(const r of Object.values(out))if(r.archive!==null){r.status='MISMATCH';r.reason='CROSS_RUNTIME_ARCHIVE';}}}
  // Independent rows must also be independent rehearsals: one binary cannot be two majors, one evidence directory,
  // or one receipt cannot belong to two runs. Coincident timestamps alone do
  // not imply shared execution. A consistently relabeled copy fails retained rows.
  const retained=Object.values(out).filter(r=>r.node!==null);
  const shared=(a,b)=>a.node.sha256===b.node.sha256||a.evidence.path===b.evidence.path||(a.receiptSha256!==null&&a.receiptSha256===b.receiptSha256);
  if(retained.some((a,i)=>retained.slice(i+1).some(b=>shared(a,b)))){reasons.push('RUNTIME_IDENTITY_SHARED');for(const r of retained){r.status='MISMATCH';r.reason='RUNTIME_RELABELED';}}
  for(const r of Object.values(out))if(r.status!=='PASS')reasons.push(r.runtime+':'+r.reason);
  const statuses=Object.values(out).map(r=>r.status);
  const status=statuses.every(s=>s==='PASS')?'PASS_SCOPED':statuses.every(s=>s==='PASS'||s==='NOT_RUN')?'INCOMPLETE':'FAIL';
  return deepFreeze({schema:RUNTIME_MATRIX_SCHEMA,status,complete:status==='PASS_SCOPED',authorizing:false,executionAttested:false,sourceAuthenticityAttested:false,scope:'CALLER_SUPPLIED_REHEARSAL_EVIDENCE_ONLY',runtimes:SUPPORTED_RUNTIMES.map(s=>s.id),archive,reasons,rows:out});
}
// The exact isolated local route the existing rehearsal already takes (scripts/check-private-package.mjs),
// spelled out for later owner execution under a chosen runtime. Documentation only: nothing here runs.
// The runtime binary must live outside the checkout: an isolated prefix, never node_modules/.bin or the repo tree.
export function rehearsalCommands(input){
  const C='COMMAND_ARGS',a=fields(input,['evidence','node','checkout'],[],C);
  for(const k of ['evidence','node','checkout'])if(!posix.isAbsolute(str(a[k],C,k))||a[k]!==posix.normalize(a[k]))refuse(C,k);
  if(a.node===a.checkout||a.node.startsWith(a.checkout+'/'))refuse(C,'node inside checkout');
  const route=npmRoute(a.evidence);
  return deepFreeze({pack:route.pack,install:route.install,
    rehearsal:{cwd:a.checkout,exe:a.node,args:[REHEARSAL_SCRIPT],env:{PATH:posix.dirname(a.node)+':$PATH',NISI_INSTALLED_ARCHIVE_CHECK:'1'}},
  });
}
