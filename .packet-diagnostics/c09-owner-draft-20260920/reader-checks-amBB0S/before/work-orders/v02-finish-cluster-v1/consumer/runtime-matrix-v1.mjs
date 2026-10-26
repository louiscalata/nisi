// PRIVATE — Nisi v0.2 finish cluster C09. Pure report reader for separately
// retained staged-rehearsal receipts written by scripts/check-private-package.mjs.
// It touches no filesystem, process, installer, network or model: the caller
// hands it retained receipt text (or parsed objects) per supported runtime, and
// a runtime that was never run stays NOT_RUN with the caller's concrete
// prerequisite. Reads are closed: unknown fields, accessors, foreign prototypes
// and sparse arrays refuse with a named code, and no row is ever coerced toward
// PASS. The matrix is advisory evidence (authorizing:false), not acceptance.
import {createHash} from 'node:crypto';
import {posix} from 'node:path';
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

export class RuntimeMatrixError extends Error {
  constructor(code,detail){super(detail?code+': '+detail:code);this.name='RuntimeMatrixError';this.code=code;this.detail=detail??null;}
}
const refuse=(code,detail)=>{throw new RuntimeMatrixError(code,detail);};
const HEX64=/^[0-9a-f]{64}$/u, VERSION=/^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
// The writer's own diagnostic pattern (scripts/check-private-package.mjs), so observed counts are re-derived, not trusted.
const DIAGNOSTIC=/(negative-[^\s(]+\.mts)\((\d+),\d+\): error TS\d+:/gu;
const RECORD_STATUSES=['PASS_SCOPED','FAIL','INCOMPLETE'];
const sha=text=>createHash('sha256').update(text,'utf8').digest('hex');
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
// Closed object read: string keys only, required ∪ optional, data descriptors only.
function fields(value,required,optional,code){
  if(!plain(value))refuse(code,'object');
  const d=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(d);
  if(keys.some(k=>typeof k!=='string'||!(required.includes(k)||optional.includes(k))))refuse(code,'unknown field');
  for(const k of required)if(!(k in d))refuse(code,'missing '+k);
  const out=Object.create(null);
  for(const k of keys){const x=d[k];if(!x.enumerable||!Object.hasOwn(x,'value'))refuse(code,'accessor '+k);out[k]=x.value;}
  return out;
}
// Closed array read: real Array, dense, data slots only.
function list(value,code,name){
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)refuse(code,name);
  const d=Object.getOwnPropertyDescriptors(value),n=d.length?.value;
  if(!Number.isSafeInteger(n)||n<0||Reflect.ownKeys(d).length!==n+1)refuse(code,name+' shape');
  const out=[];
  for(let i=0;i<n;i+=1){const x=d[i];if(!x?.enumerable||!Object.hasOwn(x,'value'))refuse(code,name+' slot');out.push(x.value);}
  return out;
}
const str=(v,code,name)=>{if(typeof v!=='string'||v.length===0||!v.isWellFormed())refuse(code,name);return v;};
const text=(v,code,name)=>{if(typeof v!=='string'||!v.isWellFormed())refuse(code,name);return v;};
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
  const d=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(d),out=Object.create(null);
  if(keys.some(k=>typeof k!=='string'))refuse(code,name+' key');
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
  if(schema.value!==REHEARSAL_SCHEMA)refuse('UNSUPPORTED_SCHEMA',schema.value);
  const r=fields(value,RECORD_REQUIRED,RECORD_OPTIONAL,R);
  if(typeof r.status!=='string')refuse(R,'status');
  if(!RECORD_STATUSES.includes(r.status))refuse('UNSUPPORTED_STATUS',r.status);
  const node=fields(r.node,['version','path','sha256'],[],R);
  const version=str(node.version,R,'node.version'),match=VERSION.exec(version);if(!match)refuse(R,'node.version');
  const checks=list(r.checks,R,'checks').map(c=>{
    const x=fields(c,CHECK_REQUIRED,CHECK_OPTIONAL,R),error=nullable(str)(x.error,R,'check.error');
    for(const k of CHECK_OPTIONAL)if(error===null&&!(k in x))refuse(R,'missing check.'+k);
    return Object.freeze({name:str(x.name,R,'check.name'),exe:str(x.exe,R,'check.exe'),args:strings(x.args,R,'check.args'),cwd:str(x.cwd,R,'check.cwd'),
      elapsedMs:nullable(count)(x.elapsedMs,R,'check.elapsedMs'),exitCode:nullable(integer)(x.exitCode,R,'check.exitCode'),signal:nullable(str)(x.signal,R,'check.signal'),
      error,stdout:'stdout' in x?text(x.stdout,R,'check.stdout'):null,stderr:'stderr' in x?text(x.stderr,R,'check.stderr'):null});
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
  for(const k of ['tests','pass','fail','cancelled','skipped','todo']){const m=new RegExp('^# '+k+' (0|[1-9][0-9]*)$','mu').exec(stdout);if(!m)return null;out[k]=Number(m[1]);}
  const plan=/^1\.\.(0|[1-9][0-9]*)$/mu.exec(stdout);if(!plan||Number(plan[1])!==out.tests)return null;
  return Object.freeze(out);
}
const clean=c=>c.signal===null&&c.error===null;
// The writer's evidence layout: <root>/.build/private-package-<tmp>/{stage,consumer,nisi-0.2.0-private.0.tgz}.
const evidenceUnderRoot=(root,evidence)=>{const prefix=root+'/.build/private-package-',rest=evidence.slice(prefix.length);return posix.isAbsolute(root)&&root===posix.normalize(root)&&evidence.startsWith(prefix)&&rest.length>0&&!rest.includes('/');};
// First failing verdict wins; returns [status, reason]. Order: identity, retained outcome, evidence presence, staleness, then each check.
function judge(runtime,record,expected,checks){
  const {found,duplicate}=checks;
  if(!SUPPORTED_RUNTIMES.some(r=>r.major===record.node.major))return ['UNSUPPORTED','RUNTIME_UNSUPPORTED'];
  if(record.node.major!==runtime.major)return ['MISMATCH','RUNTIME_RELABELED'];
  if(record.status==='FAIL'||record.failure!==null)return ['FAIL','REHEARSAL_FAILED'];
  if(record.status!=='PASS_SCOPED')return ['FAIL','REHEARSAL_INCOMPLETE'];
  if(record.archive===null)return ['SKIPPED','ARCHIVE_EVIDENCE_MISSING'];
  if(record.installed===null)return ['SKIPPED','INSTALL_EVIDENCE_MISSING'];
  if(record.toolchain===null)return ['SKIPPED','TOOLCHAIN_EVIDENCE_MISSING'];
  if(record.negativeControls===null)return ['SKIPPED','NEGATIVE_CONTROL_EVIDENCE_MISSING'];
  for(const role of keysOf(ROLES)){if(duplicate[role])return ['FAIL',ROLE_CODES[role]+'_EVIDENCE_DUPLICATE'];if(found[role]===null)return ['SKIPPED',ROLE_CODES[role]+'_EVIDENCE_MISSING'];}
  // The 29-file inventory is the imported contract itself; no caller pin can replace it.
  const files=PRIVATE_PACKAGE_FILES;
  for(const m of [record.archive.entries,record.sourceManifest,record.stageManifest])if(!sameKeys(keysOf(m),files))return ['STALE','INVENTORY_STALE'];
  if(expected.sourceManifest!==null&&(!sameKeys(keysOf(expected.sourceManifest),files)||files.some(f=>expected.sourceManifest[f]!==record.sourceManifest[f])))return ['STALE','SOURCE_STALE'];
  const cases=keysOf(record.caseManifest);
  if(expected.caseFiles!==null&&!sameKeys(cases,expected.caseFiles))return ['STALE','CASES_STALE'];
  if(files.some(f=>record.archive.entries[f]!==record.stageManifest[f]))return ['FAIL','STAGE_ARCHIVE_DRIFT'];
  if(record.installed.exactArchiveMatch!==true)return ['FAIL','INSTALL_NOT_EXACT'];
  for(const c of record.checks)if(!clean(c))return ['FAIL','CHECK_ABORTED'];
  // Artifact identity is bound to this rehearsal's own evidence directory, not to whatever paths the receipt names.
  if(!evidenceUnderRoot(record.root,record.evidence))return ['FAIL','EVIDENCE_OUTSIDE_ROOT'];
  const route=npmRoute(record.evidence);
  if(record.archive.path!==route.install.args[1])return ['FAIL','ARCHIVE_PATH_MISMATCH'];
  if(record.installed.path!==posix.join(route.install.cwd,'node_modules/nisi'))return ['FAIL','INSTALL_PATH_MISMATCH'];
  for(const role of ['pack','install']){
    const c=found[role],code=ROLE_CODES[role];
    if(!c.args.includes('--offline'))return ['FAIL',code+'_NOT_OFFLINE'];
    if(!c.args.includes('--ignore-scripts'))return ['FAIL',code+'_SCRIPTS_ENABLED'];
    if(c.exitCode!==0)return ['FAIL',code+'_FAILED'];
    if(role==='install'&&c.args[1]!==record.archive.path)return ['FAIL','INSTALL_ARCHIVE_MISMATCH'];
    if(c.cwd!==route[role].cwd)return ['FAIL',code+'_CWD_MISMATCH'];
    if(!sameKeys(c.args,route[role].args))return ['FAIL',code+'_ARGV_MISMATCH'];
  }
  // TypeScript, negative-control and runtime evidence must have executed inside this rehearsal's installed consumer.
  for(const role of ['typescript','negative','runtime'])if(found[role].cwd!==route.install.cwd)return ['FAIL',ROLE_CODES[role]+'_CWD_MISMATCH'];
  if(found.typescript.args[0]!==record.toolchain.compilerPath||found.negative.args[0]!==record.toolchain.compilerPath)return ['FAIL','TOOLCHAIN_COMPILER_MISMATCH'];
  const typeCases=cases.filter(f=>f.endsWith('.mts')),runtimeCases=cases.filter(f=>f.endsWith('.test.mjs'));
  if(!sameKeys([...mts(found.typescript.args)].sort(),typeCases))return ['FAIL','TYPESCRIPT_CASES_MISMATCH'];
  if(!found.typescript.args.includes('--noEmit')||found.typescript.exitCode!==0)return ['FAIL','TYPESCRIPT_FAILED'];
  const negativeCases=typeCases.map(f=>'negative-'+f);
  if(!sameKeys([...mts(found.negative.args)].sort(),negativeCases))return ['FAIL','NEGATIVE_CONTROL_CASES_MISMATCH'];
  if(found.negative.exitCode!==2)return ['FAIL','NEGATIVE_CONTROL_NOT_FAILING'];
  const n=record.negativeControls;
  if(n.expected<1||n.observed<n.expected||n.allExpectedLocationsDetected!==true)return ['FAIL','NEGATIVE_CONTROLS_INCOMPLETE'];
  // The observed count is re-derived from the retained diagnostics, the same way the runtime summary is re-read from TAP.
  const diagnostics=[...found.negative.stdout.matchAll(DIAGNOSTIC)].map(m=>m[1]);
  if(diagnostics.length!==n.observed||!diagnostics.every(f=>negativeCases.includes(f)))return ['FAIL','NEGATIVE_DIAGNOSTICS_MISMATCH'];
  if(!sameKeys([...found.runtime.args.filter(a=>a.endsWith('.test.mjs'))].sort(),runtimeCases))return ['FAIL','RUNTIME_CASES_MISMATCH'];
  if(found.runtime.exitCode!==0)return ['FAIL','RUNTIME_CHECK_FAILED'];
  const t=tapSummary(found.runtime.stdout);
  if(t===null)return ['FAIL','RUNTIME_SUMMARY_MISSING'];
  if(t.tests<1||t.fail>0||t.cancelled>0||t.pass+t.fail+t.cancelled+t.skipped+t.todo!==t.tests)return ['FAIL','RUNTIME_TESTS_FAILED'];
  if(t.skipped>0||t.todo>0)return ['SKIPPED','RUNTIME_TESTS_SKIPPED'];
  return ['PASS',null];
}
const NULL_DURATIONS=Object.freeze({packMs:null,installMs:null,typescriptMs:null,negativeControlsMs:null,runtimeMs:null,wallClockMs:null});
const emptyRow=(runtime,status,reason,prerequisite,receiptSha256)=>({runtime:runtime.id,major:runtime.major,status,reason,prerequisite,receiptSha256,node:null,archive:null,evidence:null,observedAt:null,completedAt:null,toolchain:null,typescript:null,negativeControls:null,runtimeTests:null,durations:NULL_DURATIONS,tokens:null,failure:null});
function readRow(runtime,receipt,prerequisite,expected){
  if(receipt===null)return emptyRow(runtime,'NOT_RUN','RUNTIME_NOT_INSTALLED',prerequisite,null);
  let value=receipt,receiptSha256=null;
  if(typeof receipt==='string'){receiptSha256=sha(receipt);try{value=JSON.parse(receipt);}catch{return emptyRow(runtime,'MALFORMED','RECEIPT_JSON',null,receiptSha256);}}
  let record;
  try{record=readRehearsalRecord(value);}catch(error){
    if(!(error instanceof RuntimeMatrixError))throw error;
    return emptyRow(runtime,error.code.startsWith('UNSUPPORTED_')?'UNSUPPORTED':'MALFORMED',error.code,null,receiptSha256);
  }
  const checks=classify(record),[status,reason]=judge(runtime,record,expected,checks),f=checks.found;
  const ms=role=>f[role]===null||checks.duplicate[role]?null:f[role].elapsedMs;
  const tap=f.runtime===null?null:tapSummary(f.runtime.stdout);
  return {runtime:runtime.id,major:runtime.major,status,reason,prerequisite:null,receiptSha256,
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
// Optional checkout pins. The package-file inventory is deliberately not a pin: it is the imported contract.
function readExpected(value){
  const E='MATRIX_EXPECTED_SCHEMA';
  const e=value===undefined?Object.create(null):fields(value,[],['caseFiles','sourceManifest'],E);
  const caseFiles=e.caseFiles===undefined||e.caseFiles===null?null:strings(e.caseFiles,E,'caseFiles');
  if(caseFiles!==null&&(!sameKeys([...caseFiles].sort(),[...caseFiles])||new Set(caseFiles).size!==caseFiles.length))refuse(E,'caseFiles');
  const sourceManifest=e.sourceManifest===undefined||e.sourceManifest===null?null:manifest(e.sourceManifest,E,'sourceManifest');
  return {caseFiles,sourceManifest};
}
// A NOT_RUN row's prerequisite must at least name the row's major and the existing rehearsal script: a placeholder is not a prerequisite.
const concretePrerequisite=(p,runtime)=>typeof p==='string'&&p.length>0&&p.isWellFormed()&&p.includes(REHEARSAL_SCRIPT)&&p.includes('Node '+runtime.major);
const deepFreeze=v=>{if(v!==null&&typeof v==='object'&&!Object.isFrozen(v)){Object.freeze(v);for(const x of Object.values(v))deepFreeze(x);}return v;};
// rows: one {runtime, receipt: text|object|null, prerequisite?} per supported runtime. expected: optional checkout pins.
export function createRuntimeMatrix(input){
  const i=fields(input,['rows'],['expected'],'MATRIX_INPUT_SCHEMA'),expected=readExpected(i.expected);
  const rows=list(i.rows,'MATRIX_ROWS_SCHEMA','rows'),byId=Object.create(null);
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
  // one receipt or one timestamp cannot belong to two runs. A consistently relabeled copy fails every retained row.
  const retained=Object.values(out).filter(r=>r.node!==null);
  const shared=(a,b)=>a.node.sha256===b.node.sha256||a.evidence.path===b.evidence.path||a.observedAt===b.observedAt||a.completedAt===b.completedAt||(a.receiptSha256!==null&&a.receiptSha256===b.receiptSha256);
  if(retained.some((a,i)=>retained.slice(i+1).some(b=>shared(a,b)))){reasons.push('RUNTIME_IDENTITY_SHARED');for(const r of retained){r.status='MISMATCH';r.reason='RUNTIME_RELABELED';}}
  for(const r of Object.values(out))if(r.status!=='PASS')reasons.push(r.runtime+':'+r.reason);
  const statuses=Object.values(out).map(r=>r.status);
  const status=statuses.every(s=>s==='PASS')?'PASS_SCOPED':statuses.every(s=>s==='PASS'||s==='NOT_RUN')?'INCOMPLETE':'FAIL';
  return deepFreeze({schema:RUNTIME_MATRIX_SCHEMA,status,complete:status==='PASS_SCOPED',authorizing:false,runtimes:SUPPORTED_RUNTIMES.map(s=>s.id),archive,reasons,rows:out});
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
