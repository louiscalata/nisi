// PRIVATE — C09 oracle for the per-runtime private-package evidence matrix.
// Pure fixtures only: synthetic retained-rehearsal receipts whose shape is the
// record written by scripts/check-private-package.mjs. No installer, network,
// child process or model is touched; a Node 22 runtime is deliberately absent.
import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {PRIVATE_PACKAGE_FILES} from '../../../scripts/private-package-contract.mjs';
import {createRuntimeMatrix, readRehearsalRecord, rehearsalCommands, NODE22_PREREQUISITE, NPM_ISOLATION_FLAGS, REHEARSAL_SCHEMA, REHEARSAL_SCRIPT, RUNTIME_MATRIX_SCHEMA, SUPPORTED_RUNTIMES, RuntimeMatrixError} from './runtime-matrix-v1.mjs';
const sha=t=>createHash('sha256').update(t,'utf8').digest('hex');
const hex=c=>c.repeat(64);
const clone=v=>JSON.parse(JSON.stringify(v));
// Fixture inventories come from the checkout so a synthetic record cannot drift from the real contract silently.
const CASES=fs.readdirSync(new URL('../../../tests/private-consumer/', import.meta.url)).sort();
const MTS=CASES.filter(f=>f.endsWith('.mts')), RUNTIME_CASES=CASES.filter(f=>f.endsWith('.test.mjs'));
assert.equal(CASES.length,12); assert.equal(MTS.length,8); assert.equal(RUNTIME_CASES.length,4); assert.equal(PRIVATE_PACKAGE_FILES.length,29);
const NODE24={version:'v24.18.0',path:'/usr/local/bin/node',sha256:hex('b')};
const NODE22={version:'v22.12.0',path:'/opt/node22/bin/node',sha256:hex('c')};
const SOURCE=Object.fromEntries(PRIVATE_PACKAGE_FILES.map(f=>[f,sha('source '+f)]));
const ROOT='/repo';
function tap(n,{skipped=0,fail=0,todo=0,cancelled=0}={}){
  return `TAP version 13\n1..${n}\n# tests ${n}\n# suites 0\n# pass ${n-skipped-fail-todo-cancelled}\n# fail ${fail}\n# cancelled ${cancelled}\n# skipped ${skipped}\n# todo ${todo}\n# duration_ms 48.9\n`;
}
// tsc diagnostics in the writer's own pattern, one per expected negative-control location.
const diagnostics=(n,mts=MTS)=>Array.from({length:n},(_,i)=>`negative-${mts[i%mts.length]}(${i+2},5): error TS2322: Type 'x' is not assignable.`).join('\n')+'\n';
// Mirrors scripts/check-private-package.mjs: field order, check names, argv shapes and boundaries.
function record({node=NODE24,evidence=ROOT+'/.build/private-package-AAAAAA',archiveSha=hex('a'),files=PRIVATE_PACKAGE_FILES,cases=CASES,ms=7,tapText=tap(11),negative={expected:73,observed:73,allExpectedLocationsDetected:true},negativeStdout=diagnostics(73),observedAt='2026-09-20T06:41:25.599Z',completedAt='2026-09-20T06:41:27.395Z'}={}){
  const archive=evidence+'/nisi-0.2.0-private.0.tgz', consumer=evidence+'/consumer', tsc=ROOT+'/node_modules/typescript/bin/tsc';
  const npmArgs=['--offline','--ignore-scripts','--no-audit','--no-fund','--cache',evidence+'/npm-cache'];
  const flags=['--noEmit','--ignoreConfig','--strict','--exactOptionalPropertyTypes','--noUncheckedIndexedAccess','--module','NodeNext','--target','ES2022','--types','node','--typeRoots',ROOT+'/node_modules/@types'];
  const mts=cases.filter(f=>f.endsWith('.mts')), tests=cases.filter(f=>f.endsWith('.test.mjs'));
  const check=(name,exe,args,cwd,exitCode,stdout='')=>({name,exe,args,cwd,elapsedMs:ms,exitCode,signal:null,error:null,stdout,stderr:''});
  const entries=Object.fromEntries(files.map(f=>[f,sha('stage '+f)]));
  return {schema:REHEARSAL_SCHEMA,status:'PASS_SCOPED',observedAt,root:ROOT,evidence,node,
    checks:[check('pack exact staged tree','npm',['pack',...npmArgs,'--json','--pack-destination',evidence],evidence+'/stage',0,'[]'),
      check('actual archive inventory','tar',['-tzf',archive],consumer,0,files.map(f=>'package/'+f).join('\n')+'\n'),
      ...files.map(f=>check('archive bytes '+f,'tar',['-xOf',archive,'package/'+f],consumer,0,'bytes')),
      check('offline script-disabled archive install','npm',['install',archive,...npmArgs,'--package-lock=false'],consumer,0),
      check('eight installed-package TypeScript consumers',node.path,[tsc,...flags,...mts],consumer,0),
      check('negative controls without suppression must fail',node.path,[tsc,...flags,...mts.map(f=>'negative-'+f)],consumer,2,negativeStdout),
      check('eleven fixed installed runtime checks',node.path,['--test','--test-reporter=tap',...tests],consumer,0,tapText)],
    sourceManifest:Object.fromEntries(files.map(f=>[f,SOURCE[f]??sha('source '+f)])),stageManifest:entries,caseManifest:Object.fromEntries(cases.map(f=>[f,sha('case '+f)])),
    boundaries:{stagedArchiveOnly:true,canonicalRootPackSupported:false,networkAllowed:false,lifecycleScriptsAllowed:false,modelInference:false,nativeExecution:false,published:false,fullMerger:false,hostileWriterIsolation:false},
    archive:{path:archive,sha256:archiveSha,byteLength:43624,entries:{...entries}},installed:{path:consumer+'/node_modules/nisi',exactArchiveMatch:true},
    toolchain:{compilerPath:tsc,compilerEntrySha256:hex('d'),typescript:'6.0.3',nodeTypes:'24.13.3',lockSha256:hex('e'),typeRoots:[ROOT+'/node_modules/@types']},
    negativeControls:negative,completedAt};
}
// A genuinely independent Node 22 rehearsal: its own binary hash, evidence directory and timestamps.
const record22=(o={})=>record({node:NODE22,evidence:ROOT+'/.build/private-package-BBBBBB',observedAt:'2026-09-20T07:02:10.000Z',completedAt:'2026-09-20T07:02:11.796Z',...o});
const find=(r,role)=>r.checks.find(c=>({install:c.args[0]==='install',pack:c.args[0]==='pack',inventory:c.args[0]==='-tzf',typescript:c.name.includes('TypeScript'),negative:c.name.startsWith('negative'),runtime:c.args[0]==='--test'})[role]);
const rows=(node24,node22=null,prerequisite=NODE22_PREREQUISITE)=>[{runtime:'node22',receipt:node22,prerequisite:node22===null?prerequisite:null},{runtime:'node24',receipt:node24,prerequisite:null}];
const matrix=(node24,node22,expected={sourceManifest:SOURCE,caseFiles:CASES})=>createRuntimeMatrix({rows:rows(node24,node22),expected});
const row=(receipt,runtime='node24',expected)=>matrix(runtime==='node24'?receipt:record(),runtime==='node22'?receipt:null,expected).rows[runtime];
const deepFrozen=(v,seen=new Set())=>{if(v===null||typeof v!=='object'||seen.has(v))return true;seen.add(v);return Object.isFrozen(v)&&Object.values(v).every(x=>deepFrozen(x,seen));};

test('the reader is pure and only the declared runtimes exist', () => {
  const source=fs.readFileSync(new URL('./runtime-matrix-v1.mjs', import.meta.url),'utf8');
  for (const banned of ['node:fs','node:child_process','node:os','node:process','node:http','node:net','fetch(','process.','import(','require(','eval(']) assert.equal(source.includes(banned),false,banned);
  assert.deepEqual(SUPPORTED_RUNTIMES.map(r=>[r.id,r.major]),[['node22',22],['node24',24]]);
  assert.equal(Object.isFrozen(SUPPORTED_RUNTIMES),true); assert.equal(RUNTIME_MATRIX_SCHEMA,'nisi-private-runtime-matrix-v1');
  assert.deepEqual(NPM_ISOLATION_FLAGS,['--offline','--ignore-scripts','--no-audit','--no-fund']); assert.equal(REHEARSAL_SCRIPT,'scripts/check-private-package.mjs');
});

test('current-Node positive fixture plus an uninstalled Node 22 gives INCOMPLETE with a concrete NOT_RUN prerequisite', () => {
  const text=JSON.stringify(record(),null,2)+'\n';
  const m=matrix(text,null);
  assert.equal(m.schema,RUNTIME_MATRIX_SCHEMA); assert.equal(m.status,'INCOMPLETE'); assert.equal(m.complete,false); assert.equal(m.authorizing,false);
  assert.deepEqual(m.runtimes,['node22','node24']); assert.deepEqual(m.reasons,['node22:RUNTIME_NOT_INSTALLED']);
  assert.deepEqual(m.archive,{sha256:hex('a'),byteLength:43624,entries:29});
  const n22=m.rows.node22;
  assert.equal(n22.status,'NOT_RUN'); assert.equal(n22.reason,'RUNTIME_NOT_INSTALLED'); assert.equal(n22.prerequisite,NODE22_PREREQUISITE);
  for (const k of ['receiptSha256','node','archive','evidence','toolchain','typescript','negativeControls','runtimeTests','failure','observedAt','completedAt']) assert.equal(n22[k],null,k);
  assert.deepEqual(n22.durations,{packMs:null,installMs:null,typescriptMs:null,negativeControlsMs:null,runtimeMs:null,wallClockMs:null}); assert.equal(n22.tokens,null);
  const n24=m.rows.node24;
  assert.equal(n24.status,'PASS'); assert.equal(n24.reason,null); assert.equal(n24.prerequisite,null); assert.equal(n24.major,24);
  assert.equal(n24.receiptSha256,sha(text)); assert.deepEqual(n24.node,NODE24);
  assert.deepEqual(n24.archive,{path:ROOT+'/.build/private-package-AAAAAA/nisi-0.2.0-private.0.tgz',sha256:hex('a'),byteLength:43624,entries:29});
  assert.deepEqual(n24.evidence,{path:ROOT+'/.build/private-package-AAAAAA',root:ROOT});
  assert.deepEqual(n24.toolchain,{typescript:'6.0.3',nodeTypes:'24.13.3',compilerEntrySha256:hex('d'),lockSha256:hex('e')});
  assert.deepEqual(n24.typescript,{cases:8,exitCode:0}); assert.deepEqual(n24.negativeControls,{expected:73,observed:73,allExpectedLocationsDetected:true});
  assert.deepEqual(n24.runtimeTests,{tests:11,pass:11,fail:0,cancelled:0,skipped:0,todo:0});
  assert.deepEqual(n24.durations,{packMs:7,installMs:7,typescriptMs:7,negativeControlsMs:7,runtimeMs:7,wallClockMs:1796}); assert.equal(n24.tokens,null); assert.equal(n24.failure,null);
  assert.equal(deepFrozen(m),true);
  // An object receipt is read the same way but carries no text hash to bind.
  const o=matrix(record(),null).rows.node24; assert.equal(o.status,'PASS'); assert.equal(o.receiptSha256,null);
});

test('independent Node 22 and Node 24 rehearsals of the same archive PASS_SCOPED; a cross-runtime archive mismatch fails both rows', () => {
  const same=matrix(record(),record22());
  assert.equal(same.status,'PASS_SCOPED'); assert.equal(same.complete,true); assert.deepEqual(same.reasons,[]);
  assert.equal(same.rows.node22.status,'PASS'); assert.equal(same.rows.node24.status,'PASS'); assert.equal(same.rows.node22.major,22);
  assert.deepEqual(same.rows.node22.node,NODE22); assert.equal(same.archive.sha256,hex('a'));
  const split=matrix(record(),record22({archiveSha:hex('f')}));
  assert.equal(split.status,'FAIL'); assert.equal(split.complete,false); assert.equal(split.archive,null);
  assert.deepEqual(split.reasons,['ARCHIVE_MISMATCH','node22:CROSS_RUNTIME_ARCHIVE','node24:CROSS_RUNTIME_ARCHIVE']);
  for (const id of ['node22','node24']) { assert.equal(split.rows[id].status,'MISMATCH'); assert.equal(split.rows[id].reason,'CROSS_RUNTIME_ARCHIVE'); }
  // A failing sibling never lifts or lowers the other row's own verdict beyond the shared-archive and shared-identity rules.
  const half=matrix(record(),{...record22(),status:'FAIL',failure:{name:'AssertionError',message:'x',code:'ERR_ASSERTION'}});
  assert.equal(half.rows.node24.status,'PASS'); assert.equal(half.rows.node22.status,'FAIL'); assert.equal(half.status,'FAIL');
});

test('relabeling a Node 24 record as the Node 22 row (or the reverse) is refused as a mismatch, and unsupported majors never pass', () => {
  const r=row(record(),'node22'); assert.equal(r.status,'MISMATCH'); assert.equal(r.reason,'RUNTIME_RELABELED'); assert.equal(r.major,22); assert.equal(r.node.version,'v24.18.0');
  // The same receipt on both rows: the per-row major check and the cross-row identity check both fire; every retained row is marked.
  const m=matrix(record(),record()); assert.equal(m.status,'FAIL'); assert.deepEqual(m.reasons,['RUNTIME_IDENTITY_SHARED','node22:RUNTIME_RELABELED','node24:RUNTIME_RELABELED']);
  const r2=row(record22({node:NODE22}),'node24'); assert.equal(r2.status,'MISMATCH'); assert.equal(r2.reason,'RUNTIME_RELABELED');
  // The realistic forgery: copy the only receipt this host can produce and rewrite version, node.path and every check exe
  // consistently. Row-local reads cannot tell; the matrix can, because the binary hash, evidence directory and timestamps
  // still belong to the Node 24 run. Each shared field alone is enough.
  const relabel=(text)=>text.replaceAll('"v24.18.0"','"v22.12.0"').replaceAll('/usr/local/bin/node','/opt/node22/bin/node');
  const genuine=JSON.stringify(record(),null,2)+'\n', forged=relabel(genuine);
  assert.equal(JSON.parse(forged).node.sha256,NODE24.sha256);
  const copy=matrix(genuine,forged);
  assert.equal(copy.status,'FAIL'); assert.equal(copy.complete,false); assert.deepEqual(copy.reasons,['RUNTIME_IDENTITY_SHARED','node22:RUNTIME_RELABELED','node24:RUNTIME_RELABELED']);
  for (const id of ['node22','node24']) { assert.equal(copy.rows[id].status,'MISMATCH'); assert.equal(copy.rows[id].reason,'RUNTIME_RELABELED'); }
  const independent={node:{...NODE22},evidence:ROOT+'/.build/private-package-BBBBBB',observedAt:'2026-09-20T07:02:10.000Z',completedAt:'2026-09-20T07:02:11.796Z'};
  assert.equal(matrix(record(),record(independent)).status,'PASS_SCOPED');
  for (const [name,o] of [['binary hash',{node:{...NODE22,sha256:NODE24.sha256}}],['evidence directory',{evidence:ROOT+'/.build/private-package-AAAAAA'}],['observedAt',{observedAt:'2026-09-20T06:41:25.599Z'}],['completedAt',{observedAt:'2026-09-20T06:41:26.000Z',completedAt:'2026-09-20T06:41:27.395Z'}]]) {
    const shared=matrix(record(),record({...independent,...o}));
    assert.equal(shared.status,'FAIL',name); assert.equal(shared.reasons[0],'RUNTIME_IDENTITY_SHARED',name);
    assert.equal(shared.rows.node22.reason,'RUNTIME_RELABELED',name); assert.equal(shared.rows.node24.reason,'RUNTIME_RELABELED',name);
  }
  // Identical retained text on both rows is caught by the receipt hash even before any field is compared.
  const sameText=JSON.stringify(record22(),null,2)+'\n';
  assert.equal(matrix(sameText,sameText).reasons[0],'RUNTIME_IDENTITY_SHARED');
  // An otherwise independent Node 22 run whose node-executed checks were not all executed by the identified binary is
  // not evidence either, one role at a time, so no role's binding hides behind another's.
  const edited=(roles)=>{const e=record(independent);for(const role of roles)find(e,role).exe='/opt/other/bin/node';return e;};
  const r3=row(edited(['typescript','negative','runtime']),'node22'); assert.equal(r3.status,'SKIPPED'); assert.equal(r3.reason,'TYPESCRIPT_EVIDENCE_MISSING');
  const r3n=row(edited(['negative']),'node22'); assert.equal(r3n.status,'SKIPPED'); assert.equal(r3n.reason,'NEGATIVE_CONTROL_EVIDENCE_MISSING');
  const r3r=row(edited(['runtime']),'node22'); assert.equal(r3r.status,'SKIPPED'); assert.equal(r3r.reason,'RUNTIME_EVIDENCE_MISSING');
  const r3t=row(edited(['typescript']),'node22'); assert.equal(r3t.status,'SKIPPED'); assert.equal(r3t.reason,'TYPESCRIPT_EVIDENCE_MISSING');
  const r4=row(record({...independent,node:{version:'v20.19.0',path:'/opt/node20/bin/node',sha256:hex('9')}}),'node22'); assert.equal(r4.status,'UNSUPPORTED'); assert.equal(r4.reason,'RUNTIME_UNSUPPORTED');
  for (const version of ['24.18.0','v24.18','v24.18.0-rc.1','V24.18.0','']) assert.equal(row(record({node:{...NODE24,version}})).status,'MALFORMED',version);
});

test('unsupported, missing, malformed, failed, skipped and stale rows remain non-PASS with named reasons', () => {
  const cases=[];
  const add=(name,status,reason,make,runtime='node24',expected)=>cases.push({name,status,reason,make,runtime,expected});
  add('foreign schema','UNSUPPORTED','UNSUPPORTED_SCHEMA',r=>({...r,schema:'nisi-private-package-rehearsal-v2'}));
  add('network boundary widened','UNSUPPORTED','UNSUPPORTED_BOUNDARY',r=>({...r,boundaries:{...r.boundaries,networkAllowed:true}}));
  add('lifecycle scripts allowed','UNSUPPORTED','UNSUPPORTED_BOUNDARY',r=>({...r,boundaries:{...r.boundaries,lifecycleScriptsAllowed:true}}));
  add('published boundary','UNSUPPORTED','UNSUPPORTED_BOUNDARY',r=>({...r,boundaries:{...r.boundaries,published:true}}));
  add('unknown status vocabulary','UNSUPPORTED','UNSUPPORTED_STATUS',r=>({...r,status:'PASS'}));
  add('not JSON','MALFORMED','RECEIPT_JSON',()=>'{"schema":');
  add('JSON array','MALFORMED','RECEIPT_SCHEMA',()=>'[]');
  add('JSON scalar','MALFORMED','RECEIPT_SCHEMA',()=>'"x"');
  add('schema field absent','MALFORMED','RECEIPT_SCHEMA',r=>{const {schema,...rest}=r;return rest;});
  add('unknown top-level field','MALFORMED','RECEIPT_SCHEMA',r=>({...r,accepted:true}));
  add('missing required field','MALFORMED','RECEIPT_SCHEMA',r=>{const {completedAt,...rest}=r;return rest;});
  add('archive sha not hex','MALFORMED','RECEIPT_SCHEMA',r=>({...r,archive:{...r.archive,sha256:'A'.repeat(64)}}));
  add('archive extra field','MALFORMED','RECEIPT_SCHEMA',r=>({...r,archive:{...r.archive,verified:true}}));
  add('node sha short','MALFORMED','RECEIPT_SCHEMA',r=>({...r,node:{...r.node,sha256:'ab'}}));
  add('check missing exitCode','MALFORMED','RECEIPT_SCHEMA',r=>{const c=clone(r);delete c.checks[0].exitCode;return c;});
  add('check that ran without retained stdout','MALFORMED','RECEIPT_SCHEMA',r=>{const c=clone(r);delete c.checks[0].stdout;return c;});
  add('check that ran without retained stderr','MALFORMED','RECEIPT_SCHEMA',r=>{const c=clone(r);delete find(c,'runtime').stderr;return c;});
  add('check args not strings','MALFORMED','RECEIPT_SCHEMA',r=>{const c=clone(r);c.checks[0].args=[1];return c;});
  add('elapsedMs fractional','MALFORMED','RECEIPT_SCHEMA',r=>{const c=clone(r);c.checks[0].elapsedMs=1.5;return c;});
  add('elapsedMs negative','MALFORMED','RECEIPT_SCHEMA',r=>{const c=clone(r);c.checks[0].elapsedMs=-1;return c;});
  add('manifest value not hex','MALFORMED','RECEIPT_SCHEMA',r=>({...r,sourceManifest:{...r.sourceManifest,'index.mjs':'nothex'}}));
  add('boundary not boolean','MALFORMED','RECEIPT_SCHEMA',r=>({...r,boundaries:{...r.boundaries,published:'false'}}));
  add('completedAt before observedAt','MALFORMED','RECEIPT_SCHEMA',r=>({...r,completedAt:'2026-09-20T06:41:25.598Z'}));
  add('observedAt not ISO','MALFORMED','RECEIPT_SCHEMA',r=>({...r,observedAt:'Sept 20'}));
  add('negativeControls flag not boolean','MALFORMED','RECEIPT_SCHEMA',r=>({...r,negativeControls:{...r.negativeControls,allExpectedLocationsDetected:1}}));
  add('failure with unknown field','MALFORMED','RECEIPT_SCHEMA',r=>({...r,status:'FAIL',failure:{name:'E',message:'m',code:null,stack:'s'}}));
  add('accessor on status','MALFORMED','RECEIPT_SCHEMA',r=>{const c=clone(r);Object.defineProperty(c,'status',{get(){return 'PASS_SCOPED';},enumerable:true,configurable:true});return c;});
  add('accessor inside the source manifest','MALFORMED','RECEIPT_SCHEMA',r=>{const s={...r.sourceManifest};Object.defineProperty(s,'index.mjs',{get(){return SOURCE['index.mjs'];},enumerable:true,configurable:true});return {...r,sourceManifest:s};});
  add('non-enumerable node','MALFORMED','RECEIPT_SCHEMA',r=>{const c=clone(r);Object.defineProperty(c,'node',{value:c.node,enumerable:false});return c;});
  add('foreign prototype','MALFORMED','RECEIPT_SCHEMA',r=>Object.assign(Object.create({schema:REHEARSAL_SCHEMA}),clone(r)));
  add('symbol key','MALFORMED','RECEIPT_SCHEMA',r=>({...r,[Symbol('x')]:1}));
  add('symbol key inside the source manifest','MALFORMED','RECEIPT_SCHEMA',r=>({...r,sourceManifest:{...r.sourceManifest,[Symbol('x')]:1}}));
  add('symbol key inside the archive entries','MALFORMED','RECEIPT_SCHEMA',r=>({...r,archive:{...r.archive,entries:{...r.archive.entries,[Symbol('x')]:1}}}));
  add('sparse checks array','MALFORMED','RECEIPT_SCHEMA',r=>{const c=clone(r);c.checks.length+=1;return c;});
  add('checks as an Array subclass','MALFORMED','RECEIPT_SCHEMA',r=>{class Checks extends Array {} return {...r,checks:Checks.from(r.checks)};});
  add('lone surrogate in a retained string','MALFORMED','RECEIPT_SCHEMA',r=>JSON.stringify(r).replace('"root":"/repo"','"root":"/repo\\ud800"'));
  add('rehearsal FAIL record','FAIL','REHEARSAL_FAILED',r=>({...r,status:'FAIL',failure:{name:'Error',message:'ENOENT: @types/node',code:'ENOENT'}}));
  add('rehearsal INCOMPLETE record','FAIL','REHEARSAL_INCOMPLETE',r=>({...r,status:'INCOMPLETE'}));
  add('PASS_SCOPED with retained failure','FAIL','REHEARSAL_FAILED',r=>({...r,failure:{name:'Error',message:'late',code:null}}));
  add('install not exact','FAIL','INSTALL_NOT_EXACT',r=>({...r,installed:{...r.installed,exactArchiveMatch:false}}));
  add('install online','FAIL','INSTALL_NOT_OFFLINE',r=>{const c=clone(r);const i=find(c,'install');i.args=i.args.filter(a=>a!=='--offline');return c;});
  add('install scripts enabled','FAIL','INSTALL_SCRIPTS_ENABLED',r=>{const c=clone(r);const i=find(c,'install');i.args=i.args.filter(a=>a!=='--ignore-scripts');return c;});
  // npm applies the last occurrence of a flag: a negation after the retained flag ran online / with scripts, and any extra token is a different route.
  add('install --no-offline appended','FAIL','INSTALL_ARGV_MISMATCH',r=>{const c=clone(r);find(c,'install').args.push('--no-offline');return c;});
  add('install --ignore-scripts=false appended','FAIL','INSTALL_ARGV_MISMATCH',r=>{const c=clone(r);find(c,'install').args.push('--ignore-scripts=false');return c;});
  add('install --registry appended','FAIL','INSTALL_ARGV_MISMATCH',r=>{const c=clone(r);find(c,'install').args.push('--registry=https://registry.npmjs.org');return c;});
  add('install --offline=false inserted before the retained flag','FAIL','INSTALL_ARGV_MISMATCH',r=>{const c=clone(r);const i=find(c,'install');i.args.splice(2,0,'--offline=false');return c;});
  add('install cache outside the evidence directory','FAIL','INSTALL_ARGV_MISMATCH',r=>{const c=clone(r);const i=find(c,'install');i.args[i.args.indexOf('--cache')+1]='/tmp/shared-npm-cache';return c;});
  add('install with the package lock left on','FAIL','INSTALL_ARGV_MISMATCH',r=>{const c=clone(r);const i=find(c,'install');i.args=i.args.filter(a=>a!=='--package-lock=false');return c;});
  add('install run from another directory','FAIL','INSTALL_CWD_MISMATCH',r=>{const c=clone(r);find(c,'install').cwd='/somewhere/else';return c;});
  add('install of a different archive','FAIL','INSTALL_ARCHIVE_MISMATCH',r=>{const c=clone(r);find(c,'install').args[1]='/elsewhere/nisi-0.2.0-private.0.tgz';return c;});
  add('install exit 1','FAIL','INSTALL_FAILED',r=>{const c=clone(r);find(c,'install').exitCode=1;return c;});
  add('pack online','FAIL','PACK_NOT_OFFLINE',r=>{const c=clone(r);const p=find(c,'pack');p.args=p.args.filter(a=>a!=='--offline');return c;});
  add('pack scripts enabled','FAIL','PACK_SCRIPTS_ENABLED',r=>{const c=clone(r);const p=find(c,'pack');p.args=p.args.filter(a=>a!=='--ignore-scripts');return c;});
  add('pack --no-offline appended','FAIL','PACK_ARGV_MISMATCH',r=>{const c=clone(r);find(c,'pack').args.push('--no-offline');return c;});
  add('pack --ignore-scripts=false appended','FAIL','PACK_ARGV_MISMATCH',r=>{const c=clone(r);find(c,'pack').args.push('--ignore-scripts=false');return c;});
  add('pack destination outside the evidence directory','FAIL','PACK_ARGV_MISMATCH',r=>{const c=clone(r);const p=find(c,'pack');p.args[p.args.length-1]='/elsewhere';return c;});
  add('pack run from another directory','FAIL','PACK_CWD_MISMATCH',r=>{const c=clone(r);find(c,'pack').cwd='/somewhere/else/stage';return c;});
  add('pack exit 1','FAIL','PACK_FAILED',r=>{const c=clone(r);find(c,'pack').exitCode=1;return c;});
  add('archive path outside the evidence directory','FAIL','ARCHIVE_PATH_MISMATCH',r=>{const c=clone(r);c.archive.path='/elsewhere/x.tgz';find(c,'install').args[1]='/elsewhere/x.tgz';return c;});
  add('installed path outside the consumer directory','FAIL','INSTALL_PATH_MISMATCH',r=>({...r,installed:{...r.installed,path:'/elsewhere/node_modules/nisi'}}));
  add('evidence directory outside the checkout root','FAIL','EVIDENCE_OUTSIDE_ROOT',r=>({...r,root:'/other/checkout'}));
  add('evidence directory not a private-package rehearsal directory','FAIL','EVIDENCE_OUTSIDE_ROOT',()=>record({evidence:ROOT+'/.build/other-AAAAAA'}));
  add('evidence directory nested below the rehearsal directory','FAIL','EVIDENCE_OUTSIDE_ROOT',()=>record({evidence:ROOT+'/.build/private-package-AAAAAA/sub'}));
  add('relative checkout root','FAIL','EVIDENCE_OUTSIDE_ROOT',r=>({...r,root:'repo'}));
  add('typescript check run in another rehearsal consumer','FAIL','TYPESCRIPT_CWD_MISMATCH',r=>{const c=clone(r);find(c,'typescript').cwd=ROOT+'/.build/private-package-ZZZZZZ/consumer';return c;});
  add('negative check run in another rehearsal consumer','FAIL','NEGATIVE_CONTROL_CWD_MISMATCH',r=>{const c=clone(r);find(c,'negative').cwd=ROOT+'/.build/private-package-ZZZZZZ/consumer';return c;});
  add('runtime check run in another rehearsal consumer','FAIL','RUNTIME_CWD_MISMATCH',r=>{const c=clone(r);find(c,'runtime').cwd=ROOT+'/.build/private-package-ZZZZZZ/consumer';return c;});
  add('toolchain names a compiler the checks did not run','FAIL','TOOLCHAIN_COMPILER_MISMATCH',r=>({...r,toolchain:{...r.toolchain,compilerPath:'/other/typescript/bin/tsc'}}));
  add('negative check run by a compiler other than the recorded toolchain','FAIL','TOOLCHAIN_COMPILER_MISMATCH',r=>{const c=clone(r);find(c,'negative').args[0]='/other/typescript/bin/tsc';return c;});
  add('typescript exit 2','FAIL','TYPESCRIPT_FAILED',r=>{const c=clone(r);find(c,'typescript').exitCode=2;return c;});
  add('typescript emitting','FAIL','TYPESCRIPT_FAILED',r=>{const c=clone(r);const t=find(c,'typescript');t.args=t.args.filter(a=>a!=='--noEmit');return c;});
  add('typescript on fewer cases than retained','FAIL','TYPESCRIPT_CASES_MISMATCH',r=>{const c=clone(r);find(c,'typescript').args.pop();return c;});
  add('negative controls compile clean','FAIL','NEGATIVE_CONTROL_NOT_FAILING',r=>{const c=clone(r);find(c,'negative').exitCode=0;return c;});
  add('negative controls on fewer cases','FAIL','NEGATIVE_CONTROL_CASES_MISMATCH',r=>{const c=clone(r);find(c,'negative').args.pop();return c;});
  add('negative controls mixed with a positive case','SKIPPED','NEGATIVE_CONTROL_EVIDENCE_MISSING',r=>{const c=clone(r);find(c,'negative').args.push(MTS[0]);return c;});
  add('negative diagnostics undercounted','FAIL','NEGATIVE_CONTROLS_INCOMPLETE',r=>({...r,negativeControls:{expected:73,observed:72,allExpectedLocationsDetected:true}}));
  add('negative locations not all detected','FAIL','NEGATIVE_CONTROLS_INCOMPLETE',r=>({...r,negativeControls:{expected:73,observed:73,allExpectedLocationsDetected:false}}));
  add('zero negative controls','FAIL','NEGATIVE_CONTROLS_INCOMPLETE',r=>({...r,negativeControls:{expected:0,observed:0,allExpectedLocationsDetected:true}}));
  add('negative diagnostics emptied while the summary still says 73/73','FAIL','NEGATIVE_DIAGNOSTICS_MISMATCH',()=>record({negativeStdout:''}));
  add('negative diagnostics exceeding the summary','FAIL','NEGATIVE_DIAGNOSTICS_MISMATCH',()=>record({negativeStdout:diagnostics(74)}));
  add('negative diagnostics one short of the summary','FAIL','NEGATIVE_DIAGNOSTICS_MISMATCH',()=>record({negativeStdout:diagnostics(72)}));
  add('negative diagnostics for a file outside the rehearsal','FAIL','NEGATIVE_DIAGNOSTICS_MISMATCH',()=>record({negativeStdout:diagnostics(73,['stranger.mts'])}));
  add('negative diagnostics of an unexpected shape','FAIL','NEGATIVE_DIAGNOSTICS_MISMATCH',()=>record({negativeStdout:diagnostics(73).replaceAll(': error TS',': warning TS')}));
  add('runtime exit 1','FAIL','RUNTIME_CHECK_FAILED',r=>{const c=clone(r);find(c,'runtime').exitCode=1;return c;});
  add('runtime signal','FAIL','CHECK_ABORTED',r=>{const c=clone(r);find(c,'runtime').signal='SIGKILL';return c;});
  add('runtime spawn error','FAIL','CHECK_ABORTED',r=>{const c=clone(r);find(c,'runtime').error='ETIMEDOUT';return c;});
  add('archive inventory check killed by a signal','FAIL','CHECK_ABORTED',r=>{const c=clone(r);find(c,'inventory').signal='SIGKILL';return c;});
  add('pack check timed out','FAIL','CHECK_ABORTED',r=>{const c=clone(r);find(c,'pack').error='ETIMEDOUT';return c;});
  add('runtime summary reports a failure despite exit 0','FAIL','RUNTIME_TESTS_FAILED',r=>record({tapText:tap(11,{fail:1})}));
  add('runtime summary reports a cancellation','FAIL','RUNTIME_TESTS_FAILED',r=>record({tapText:tap(11,{cancelled:1})}));
  add('runtime summary counts disagree','FAIL','RUNTIME_TESTS_FAILED',r=>record({tapText:tap(11).replace('# pass 11','# pass 10')}));
  add('runtime plan disagrees with summary','FAIL','RUNTIME_SUMMARY_MISSING',r=>record({tapText:tap(11).replace('1..11','1..12')}));
  add('runtime summary absent','FAIL','RUNTIME_SUMMARY_MISSING',r=>record({tapText:'ok 1 - x\n'}));
  add('runtime zero tests','FAIL','RUNTIME_TESTS_FAILED',r=>record({tapText:tap(0)}));
  add('runtime ran fewer case files than retained','FAIL','RUNTIME_CASES_MISMATCH',r=>{const c=clone(r);find(c,'runtime').args.pop();return c;});
  add('stage and archive bytes drift','FAIL','STAGE_ARCHIVE_DRIFT',r=>({...r,stageManifest:{...r.stageManifest,'index.mjs':hex('1')}}));
  add('runtime tests skipped','SKIPPED','RUNTIME_TESTS_SKIPPED',r=>record({tapText:tap(11,{skipped:1})}));
  add('runtime tests todo','SKIPPED','RUNTIME_TESTS_SKIPPED',r=>record({tapText:tap(11,{todo:1})}));
  add('runtime check never ran','SKIPPED','RUNTIME_EVIDENCE_MISSING',r=>({...r,checks:r.checks.filter(c=>c.args[0]!=='--test')}));
  add('typescript check never ran','SKIPPED','TYPESCRIPT_EVIDENCE_MISSING',r=>({...r,checks:r.checks.filter(c=>!c.name.includes('TypeScript'))}));
  add('negative check never ran','SKIPPED','NEGATIVE_CONTROL_EVIDENCE_MISSING',r=>({...r,checks:r.checks.filter(c=>!c.name.startsWith('negative'))}));
  add('negative summary absent','SKIPPED','NEGATIVE_CONTROL_EVIDENCE_MISSING',r=>{const {negativeControls,...rest}=r;return rest;});
  add('install check never ran','SKIPPED','INSTALL_EVIDENCE_MISSING',r=>({...r,checks:r.checks.filter(c=>c.args[0]!=='install')}));
  add('pack check never ran','SKIPPED','PACK_EVIDENCE_MISSING',r=>({...r,checks:r.checks.filter(c=>c.args[0]!=='pack')}));
  add('archive never produced','SKIPPED','ARCHIVE_EVIDENCE_MISSING',r=>{const {archive,...rest}=r;return rest;});
  add('install never recorded','SKIPPED','INSTALL_EVIDENCE_MISSING',r=>{const {installed,...rest}=r;return rest;});
  add('toolchain never recorded','SKIPPED','TOOLCHAIN_EVIDENCE_MISSING',r=>{const {toolchain,...rest}=r;return rest;});
  for (const role of ['pack','install','typescript','negative','runtime']) add('duplicated '+role+' check','FAIL',{pack:'PACK',install:'INSTALL',typescript:'TYPESCRIPT',negative:'NEGATIVE_CONTROL',runtime:'RUNTIME'}[role]+'_EVIDENCE_DUPLICATE',r=>({...r,checks:[...r.checks,find(r,role)]}));
  add('27-file archive from before the contract grew','STALE','INVENTORY_STALE',()=>record({files:PRIVATE_PACKAGE_FILES.slice(0,27)}));
  add('archive entry beyond the contract','STALE','INVENTORY_STALE',r=>({...r,archive:{...r.archive,entries:{...r.archive.entries,'README.md':hex('2')}}}));
  add('source manifest behind the checkout','STALE','SOURCE_STALE',r=>({...r,sourceManifest:{...r.sourceManifest,'index.mjs':hex('3')}}));
  add('consumer cases behind the checkout','STALE','CASES_STALE',()=>record({cases:CASES.slice(1)}));
  add('source manifest missing a file','STALE','INVENTORY_STALE',r=>{const s={...r.sourceManifest};delete s['index.mjs'];return {...r,sourceManifest:s};});
  for (const c of cases) {
    const r=row(c.make(record()),c.runtime,c.expected);
    assert.notEqual(r.status,'PASS',c.name); assert.equal(r.status,c.status,c.name+' status '+r.reason); assert.equal(r.reason,c.reason,c.name);
    assert.equal(matrix(c.runtime==='node24'?c.make(record()):record(),c.runtime==='node22'?c.make(record()):null,c.expected).status,'FAIL',c.name);
  }
  // Without expected checkout pins, source/case staleness is unknown and cannot be claimed either way, but inventory staleness still is.
  const unpinned=row({...record(),sourceManifest:{...record().sourceManifest,'index.mjs':hex('3')}},'node24',{});
  assert.equal(unpinned.status,'PASS');
  assert.equal(row(record({files:PRIVATE_PACKAGE_FILES.slice(0,27)}),'node24',{}).reason,'INVENTORY_STALE');
  // The inventory is the imported contract: no caller pin exists that could lift a 27-file archive to PASS.
  assert.throws(()=>row(record({files:PRIVATE_PACKAGE_FILES.slice(0,27)}),'node24',{packageFiles:PRIVATE_PACKAGE_FILES.slice(0,27)}),{code:'MATRIX_EXPECTED_SCHEMA'});
  // A failed record still surfaces what it retained, without any coercion toward PASS.
  const failed=row({...record(),status:'FAIL',failure:{name:'Error',message:'ENOENT: @types/node',code:'ENOENT'}});
  assert.deepEqual(failed.failure,{name:'Error',message:'ENOENT: @types/node',code:'ENOENT'}); assert.equal(failed.archive.sha256,hex('a')); assert.equal(failed.status,'FAIL');
  // The writer's spawn-failure path: spawnSync ENOENT leaves stdout/stderr undefined, JSON.stringify drops the keys, the
  // assert throws before pack produced anything, and the retained FAIL must be read as FAIL, not as MALFORMED or SKIPPED.
  const enoent=(()=>{const {archive,installed,toolchain,negativeControls,...r}=record();const pack=find(r,'pack');delete pack.stdout;delete pack.stderr;pack.exitCode=null;pack.error='ENOENT';
    return JSON.stringify({...r,status:'FAIL',checks:[pack],failure:{name:'AssertionError',message:'pack exact staged tree\n+ actual - expected\n+ Error: spawnSync npm ENOENT',code:'ERR_ASSERTION'}},null,2)+'\n';})();
  const dead=row(enoent); assert.equal(dead.status,'FAIL'); assert.equal(dead.reason,'REHEARSAL_FAILED'); assert.equal(dead.failure.code,'ERR_ASSERTION'); assert.deepEqual(dead.node,NODE24); assert.equal(dead.archive,null);
  assert.deepEqual(dead.durations,{packMs:7,installMs:null,typescriptMs:null,negativeControlsMs:null,runtimeMs:null,wallClockMs:1796});
  assert.equal(readRehearsalRecord(JSON.parse(enoent)).checks[0].stdout,null);
  // A runtime check whose spawn failed carries no stdout either: the row is aborted and no TAP summary is invented.
  const noTap=(()=>{const r=record();const t=find(r,'runtime');delete t.stdout;delete t.stderr;t.exitCode=null;t.error='ENOENT';return r;})();
  const aborted=row(noTap); assert.equal(aborted.status,'FAIL'); assert.equal(aborted.reason,'CHECK_ABORTED'); assert.equal(aborted.runtimeTests,null); assert.equal(aborted.durations.runtimeMs,7);
  // The accessor refusal inside a manifest is the reader's own, not a downstream hex refusal of an undefined value.
  const accessor={...record().sourceManifest}; Object.defineProperty(accessor,'index.mjs',{get(){return SOURCE['index.mjs'];},enumerable:true,configurable:true});
  assert.throws(()=>readRehearsalRecord({...record(),sourceManifest:accessor}),{code:'RECEIPT_SCHEMA',detail:'sourceManifest accessor'});
  // Malformed rows expose nothing they could not read.
  const bad=row('{"schema":'); assert.equal(bad.node,null); assert.equal(bad.archive,null); assert.equal(bad.receiptSha256,sha('{"schema":')); assert.equal(bad.tokens,null);
});

test('unknown durations stay null instead of zero; tokens are never invented; wall clock comes only from retained timestamps', () => {
  const r=record(); find(r,'typescript').elapsedMs=null; find(r,'pack').elapsedMs=null;
  const out=row(r); assert.equal(out.status,'PASS');
  assert.deepEqual(out.durations,{packMs:null,installMs:7,typescriptMs:null,negativeControlsMs:7,runtimeMs:7,wallClockMs:1796});
  assert.equal(out.tokens,null); assert.equal(Object.hasOwn(out,'tokens'),true);
  assert.equal(row(record({ms:0})).durations.runtimeMs,0);
  const partial=row({...record(),status:'INCOMPLETE',checks:record().checks.slice(0,1)});
  assert.deepEqual(partial.durations,{packMs:7,installMs:null,typescriptMs:null,negativeControlsMs:null,runtimeMs:null,wallClockMs:1796});
  const rec=readRehearsalRecord(record()); assert.equal(rec.wallClockMs,1796); assert.equal(Object.isFrozen(rec),true); assert.equal(rec.node.major,24);
  assert.throws(()=>readRehearsalRecord({...record(),schema:'x'}),{code:'UNSUPPORTED_SCHEMA'});
  assert.throws(()=>readRehearsalRecord({...record(),extra:1}),{code:'RECEIPT_SCHEMA'});
  assert.throws(()=>readRehearsalRecord(null),{code:'RECEIPT_SCHEMA'});
});

test('matrix input is a closed schema: every supported runtime exactly once, a concrete prerequisite for every unrun row, no unknown fields', () => {
  const ok=rows(record());
  const throwsCode=(input,code)=>assert.throws(()=>createRuntimeMatrix(input),e=>e instanceof RuntimeMatrixError&&e.code===code,String(JSON.stringify(input)).slice(0,80));
  throwsCode(undefined,'MATRIX_INPUT_SCHEMA'); throwsCode({},'MATRIX_INPUT_SCHEMA'); throwsCode({rows:ok,extra:1},'MATRIX_INPUT_SCHEMA'); throwsCode({rows:'x'},'MATRIX_ROWS_SCHEMA');
  throwsCode({rows:[ok[1]]},'MATRIX_ROWS_SCHEMA'); throwsCode({rows:[ok[1],ok[1]]},'MATRIX_ROWS_SCHEMA'); throwsCode({rows:[...ok,{runtime:'node20',receipt:null,prerequisite:NODE22_PREREQUISITE}]},'MATRIX_ROWS_SCHEMA');
  throwsCode({rows:[{runtime:'node22',receipt:null},ok[1]]},'MATRIX_ROW_SCHEMA'); throwsCode({rows:[{runtime:'node22',receipt:null,prerequisite:''},ok[1]]},'MATRIX_ROW_SCHEMA');
  // A placeholder is not a prerequisite: it must name the row's major and the existing rehearsal script.
  throwsCode({rows:[{runtime:'node22',receipt:null,prerequisite:'x'},ok[1]]},'MATRIX_ROW_SCHEMA');
  throwsCode({rows:[{runtime:'node22',receipt:null,prerequisite:NODE22_PREREQUISITE.replace('scripts/check-private-package.mjs','some-other-script.mjs')},ok[1]]},'MATRIX_ROW_SCHEMA');
  throwsCode({rows:[{runtime:'node22',receipt:null,prerequisite:NODE22_PREREQUISITE.replaceAll('Node 22','Node 20')},ok[1]]},'MATRIX_ROW_SCHEMA');
  throwsCode({rows:[{runtime:'node22',receipt:null,prerequisite:NODE22_PREREQUISITE},{runtime:'node24',receipt:null,prerequisite:NODE22_PREREQUISITE}]},'MATRIX_ROW_SCHEMA');
  throwsCode({rows:[{runtime:'node22',receipt:null,prerequisite:NODE22_PREREQUISITE,note:'y'},ok[1]]},'MATRIX_ROW_SCHEMA'); throwsCode({rows:[{runtime:'node22',receipt:undefined,prerequisite:NODE22_PREREQUISITE},ok[1]]},'MATRIX_ROW_SCHEMA');
  throwsCode({rows:[{runtime:'node22',receipt:7,prerequisite:null},ok[1]]},'MATRIX_ROW_SCHEMA'); throwsCode({rows:[ok[0],{...ok[1],prerequisite:NODE22_PREREQUISITE}]},'MATRIX_ROW_SCHEMA');
  throwsCode({rows:ok,expected:{unknown:1}},'MATRIX_EXPECTED_SCHEMA'); throwsCode({rows:ok,expected:{caseFiles:'x'}},'MATRIX_EXPECTED_SCHEMA'); throwsCode({rows:ok,expected:{sourceManifest:{a:'nothex'}}},'MATRIX_EXPECTED_SCHEMA');
  throwsCode({rows:ok,expected:{packageFiles:PRIVATE_PACKAGE_FILES}},'MATRIX_EXPECTED_SCHEMA'); throwsCode({rows:ok,expected:{caseFiles:[...CASES].reverse()}},'MATRIX_EXPECTED_SCHEMA');
  const withGetter=[{runtime:'node22',receipt:null,prerequisite:NODE22_PREREQUISITE},{runtime:'node24',get receipt(){return record();},prerequisite:null}]; throwsCode({rows:withGetter},'MATRIX_ROW_SCHEMA');
  assert.equal(createRuntimeMatrix({rows:ok}).status,'INCOMPLETE');
  assert.equal(createRuntimeMatrix({rows:[ok[1],ok[0]]}).rows.node22.status,'NOT_RUN');
  const both=createRuntimeMatrix({rows:[{runtime:'node22',receipt:null,prerequisite:NODE22_PREREQUISITE},{runtime:'node24',receipt:null,prerequisite:'Node 24 is absent; run scripts/check-private-package.mjs under it'}]});
  assert.equal(both.status,'INCOMPLETE'); assert.equal(both.archive,null); assert.deepEqual(both.reasons,['node22:RUNTIME_NOT_INSTALLED','node24:RUNTIME_NOT_INSTALLED']);
});

test('rehearsal commands are the retained offline, script-disabled route and the Node 22 prerequisite names no download', () => {
  const c=rehearsalCommands({evidence:'/e/private-package-X',node:'/opt/node22/bin/node',checkout:'/repo'});
  assert.equal(Object.isFrozen(c),true);
  assert.deepEqual(c.pack,{cwd:'/e/private-package-X/stage',exe:'npm',args:['pack',...NPM_ISOLATION_FLAGS,'--cache','/e/private-package-X/npm-cache','--json','--pack-destination','/e/private-package-X']});
  assert.deepEqual(c.install,{cwd:'/e/private-package-X/consumer',exe:'npm',args:['install','/e/private-package-X/nisi-0.2.0-private.0.tgz',...NPM_ISOLATION_FLAGS,'--cache','/e/private-package-X/npm-cache','--package-lock=false']});
  assert.deepEqual(c.rehearsal,{cwd:'/repo',exe:'/opt/node22/bin/node',args:['scripts/check-private-package.mjs'],env:{PATH:'/opt/node22/bin:$PATH',NISI_INSTALLED_ARCHIVE_CHECK:'1'}});
  for (const cmd of [c.pack,c.install]) { assert.equal(cmd.args.includes('--offline'),true); assert.equal(cmd.args.includes('--ignore-scripts'),true); assert.equal(cmd.args.some(a=>/publish|registry|nvm|brew|curl/.test(a)),false); }
  // The route the judge binds retained argv to is this same route: a receipt whose pack/install checks equal it reads PASS.
  const r=record(); assert.deepEqual([find(r,'pack').args,find(r,'install').args],[[...rehearsalCommands({evidence:r.evidence,node:'/opt/n/bin/node',checkout:ROOT}).pack.args],[...rehearsalCommands({evidence:r.evidence,node:'/opt/n/bin/node',checkout:ROOT}).install.args]]);
  assert.throws(()=>rehearsalCommands({evidence:'relative',node:'/n',checkout:'/repo'}),{code:'COMMAND_ARGS'});
  assert.throws(()=>rehearsalCommands({evidence:'/e',node:'/n',checkout:'/repo',extra:1}),{code:'COMMAND_ARGS'});
  assert.throws(()=>rehearsalCommands({evidence:'/e',node:'node',checkout:'/repo'}),{code:'COMMAND_ARGS'});
  // The runtime binary must live in an isolated prefix outside the checkout, as the prerequisite says.
  assert.throws(()=>rehearsalCommands({evidence:'/e',node:'/repo/node_modules/.bin/node',checkout:'/repo'}),{code:'COMMAND_ARGS'});
  assert.throws(()=>rehearsalCommands({evidence:'/e',node:'/repo',checkout:'/repo'}),{code:'COMMAND_ARGS'});
  assert.equal(rehearsalCommands({evidence:'/e',node:'/repo-node22/bin/node',checkout:'/repo'}).rehearsal.exe,'/repo-node22/bin/node');
  assert.match(NODE22_PREREQUISITE,/Node 22/); assert.match(NODE22_PREREQUISITE,/not installed/i); assert.match(NODE22_PREREQUISITE,/scripts\/check-private-package\.mjs/); assert.match(NODE22_PREREQUISITE,/outside the checkout/);
  assert.doesNotMatch(NODE22_PREREQUISITE,/download|nvm install|brew install|curl/i);
});
