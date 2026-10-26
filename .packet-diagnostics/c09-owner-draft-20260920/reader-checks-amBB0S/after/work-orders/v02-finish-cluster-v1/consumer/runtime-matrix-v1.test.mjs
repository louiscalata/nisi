// PRIVATE C09 oracle. Synthetic receipts mirror the exact writer schema and
// command/stdout contract; no child process, installer, network, or model runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {PRIVATE_PACKAGE_FILES} from '../../../scripts/private-package-contract.mjs';
import {createRuntimeMatrix,readRehearsalRecord,rehearsalCommands,NODE22_PREREQUISITE,REHEARSAL_SCHEMA,RUNTIME_MATRIX_SCHEMA,RuntimeMatrixError} from './runtime-matrix-v1.mjs';

const sha=v=>createHash('sha256').update(v,'utf8').digest('hex');
const hex=c=>c.repeat(64);
const CASES=fs.readdirSync(new URL('../../../tests/private-consumer/',import.meta.url)).sort();
const MTS=CASES.filter(x=>x.endsWith('.mts')),RUNTIME=CASES.filter(x=>x.endsWith('.test.mjs'));
assert.equal(PRIVATE_PACKAGE_FILES.length,29);assert.equal(CASES.length,12);assert.equal(MTS.length,8);assert.equal(RUNTIME.length,4);
const ROOT='/repo',EVIDENCE='/repo/.build/private-package-AAAAAA',TSC=ROOT+'/node_modules/typescript/bin/tsc';
const sourceManifest=Object.fromEntries(PRIVATE_PACKAGE_FILES.map(f=>[f,sha('source:'+f)]));
const stageManifest=Object.fromEntries(PRIVATE_PACKAGE_FILES.map(f=>[f,f==='package.json'?sha('metadata:'+f):sourceManifest[f]]));
const caseManifest=Object.fromEntries(CASES.map(f=>[f,sha('case:'+f)]));
const TOOLCHAIN={compilerPath:TSC,compilerEntrySha256:hex('d'),typescript:'6.0.3',nodeTypes:'24.13.3',lockSha256:hex('e'),typeRoots:[ROOT+'/node_modules/@types']};
const locations=Array.from({length:73},(_,i)=>({file:'negative-'+MTS[i%MTS.length],line:i+2}));
const tap=`TAP version 13\n1..11\n# tests 11\n# suites 0\n# pass 11\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 1\n`;
const negativeStdout=locations.map(x=>`${x.file}(${x.line},5): error TS2322: Type 'x' is not assignable.\n`).join('');
const flags=['--noEmit','--ignoreConfig','--strict','--exactOptionalPropertyTypes','--noUncheckedIndexedAccess','--module','NodeNext','--target','ES2022','--types','node','--typeRoots',TOOLCHAIN.typeRoots[0]];
const node24={version:'v24.18.0',path:'/usr/local/bin/node',sha256:hex('b')},node22={version:'v22.12.0',path:'/opt/node22/bin/node',sha256:hex('c')};
const archives=Object.fromEntries(PRIVATE_PACKAGE_FILES.map(f=>[f,stageManifest[f]]));
const check=(name,exe,args,cwd,exitCode=0,stdout='')=>({name,exe,args,cwd,elapsedMs:1,exitCode,signal:null,error:null,stdout,stderr:''});
function record({node=node24,evidence=EVIDENCE,archiveSha=hex('a'),observedAt='2026-09-20T06:41:25.000Z',completedAt='2026-09-20T06:41:27.000Z',status='PASS_SCOPED',failure,checks,source=sourceManifest,stage=stageManifest,cases=caseManifest,tapText=tap,negativeText=negativeStdout}={}){
  const archive=evidence+'/nisi-0.2.0-private.0.tgz',consumer=evidence+'/consumer';
  const cs=checks??[
    check('pack exact staged tree','npm',['pack','--offline','--ignore-scripts','--no-audit','--no-fund','--cache',evidence+'/npm-cache','--json','--pack-destination',evidence],evidence+'/stage',0,JSON.stringify([{filename:'nisi-0.2.0-private.0.tgz',files:PRIVATE_PACKAGE_FILES.map(path=>({path}))}])),
    check('actual archive inventory','tar',['-tzf',archive],consumer,0,PRIVATE_PACKAGE_FILES.map(f=>'package/'+f).sort().join('\n')+'\n'),
    ...PRIVATE_PACKAGE_FILES.map(f=>check('archive bytes '+f,'tar',['-xOf',archive,'package/'+f],consumer,0,f==='package.json'?'metadata:'+f:'source:'+f)),
    check('offline script-disabled archive install','npm',['install',archive,'--offline','--ignore-scripts','--no-audit','--no-fund','--cache',evidence+'/npm-cache','--package-lock=false'],consumer),
    check('eight installed-package TypeScript consumers',node.path,[TSC,...flags,...MTS],consumer),
    check('negative controls without suppression must fail',node.path,[TSC,...flags,...MTS.map(f=>'negative-'+f)],consumer,2,negativeText),
    check('eleven fixed installed runtime checks',node.path,['--test','--test-reporter=tap',...RUNTIME],consumer,0,tapText),
  ];
  return structuredClone({schema:REHEARSAL_SCHEMA,status,observedAt,root:ROOT,evidence,node,checks:cs,sourceManifest:source,stageManifest:stage,caseManifest:cases,boundaries:{stagedArchiveOnly:true,canonicalRootPackSupported:false,networkAllowed:false,lifecycleScriptsAllowed:false,modelInference:false,nativeExecution:false,published:false,fullMerger:false,hostileWriterIsolation:false},archive:{path:archive,sha256:archiveSha,byteLength:43624,entries:archives},installed:{path:consumer+'/node_modules/nisi',exactArchiveMatch:true},toolchain:TOOLCHAIN,negativeControls:{expected:73,observed:73,allExpectedLocationsDetected:true},completedAt,...(failure===undefined?{}:{failure})});
}
const text=r=>JSON.stringify(r,null,2)+'\n';
function expected(r24,r22=null){
  const proof=x=>x===null?null:{receiptSha256:sha(text(x)),receiptByteLength:Buffer.byteLength(text(x)),node:x.node,archive:{sha256:x.archive?.sha256??hex('a'),byteLength:x.archive?.byteLength??43624}};
  return structuredClone({sourceManifest,stageManifest,caseManifest,toolchain:TOOLCHAIN,negativeLocations:locations,notBefore:'2026-09-20T00:00:00.000Z',notAfter:'2026-09-21T00:00:00.000Z',observations:{node22:proof(r22),node24:proof(r24)}});
}
function matrix(r24,r22=null,exp=expected(r24,r22)){return createRuntimeMatrix({rows:[{runtime:'node22',receipt:r22===null?null:text(r22),prerequisite:r22===null?NODE22_PREREQUISITE:null},{runtime:'node24',receipt:text(r24)}],expected:exp});}

test('positive exact writer-shaped receipt and honest missing Node22 row',()=>{const m=matrix(record());assert.equal(m.schema,RUNTIME_MATRIX_SCHEMA);assert.equal(m.status,'INCOMPLETE');assert.equal(m.rows.node22.status,'NOT_RUN');assert.equal(m.rows.node24.status,'PASS');assert.equal(m.rows.node24.receiptByteLength,Buffer.byteLength(text(record())));assert.equal(m.authorizing,false);assert.equal(m.executionAttested,false);});
test('independent two-runtime proof is scoped to the same archive',()=>{const m=matrix(record(),record({node:node22,evidence:ROOT+'/.build/private-package-BBBBBB',observedAt:'2026-09-20T07:00:00.000Z',completedAt:'2026-09-20T07:00:02.000Z'}));assert.equal(m.status,'PASS_SCOPED');const swapped=matrix(record({archiveSha:hex('f')}),record({node:node22,evidence:ROOT+'/.build/private-package-BBBBBB'}));assert.equal(swapped.status,'FAIL');});
test('proof hash, length, node path/version and archive claims are independently checked',()=>{const r=record(),t=text(r),e=expected(r,null);e.observations.node24.receiptSha256=hex('f');assert.equal(createRuntimeMatrix({rows:[{runtime:'node22',receipt:null,prerequisite:NODE22_PREREQUISITE},{runtime:'node24',receipt:t}],expected:e}).rows.node24.status,'STALE');});
test('missing, duplicate and wrong tar evidence cannot pass',()=>{for(const mutate of [r=>r.checks=r.checks.filter(c=>c.name!=='actual archive inventory'),r=>r.checks.push({...r.checks[1]}),r=>r.checks.find(c=>c.name==='archive bytes index.mjs').stdout='wrong',r=>r.checks.find(c=>c.name==='actual archive inventory').args.push('--verbose')]){const r=record();mutate(r);assert.notEqual(matrix(r).rows.node24.status,'PASS');}});
test('strict flags, all roles and command order are binding',()=>{const r=record();r.checks.find(c=>c.name.includes('TypeScript consumers')).args=r.checks.find(c=>c.name.includes('TypeScript consumers')).args.filter(x=>x!=='--strict');assert.equal(matrix(r).rows.node24.status,'FAIL');});
test('case hashes and inclusive cutoff are binding',()=>{const r=record(),e=expected(r);e.caseManifest[CASES[0]]=hex('f');assert.equal(matrix(r,null,e).rows.node24.status,'STALE');const edge=record({observedAt:e.notBefore,completedAt:e.notBefore});assert.equal(matrix(edge,null,expected(edge)).rows.node24.status,'PASS');});
test('negative locations and duplicate TAP/diagnostics are binding',()=>{const r=record();r.checks.find(c=>c.name.startsWith('negative')).stdout=negativeStdout+'negative-'+MTS[0]+'(2,5): error TS2322: duplicate\n';assert.equal(matrix(r).rows.node24.status,'FAIL');const q=record();q.checks.find(c=>c.name.startsWith('eleven')).stdout=tap+tap;assert.equal(matrix(q).rows.node24.status,'FAIL');});
test('parsed objects cannot earn public PASS; reader remains inspectable',()=>{const r=record();assert.equal(readRehearsalRecord(r).status,'PASS_SCOPED');const m=createRuntimeMatrix({rows:[{runtime:'node22',receipt:null,prerequisite:NODE22_PREREQUISITE},{runtime:'node24',receipt:r}],expected:expected(r)});assert.equal(m.rows.node24.reason,'RECEIPT_TEXT_REQUIRED');});
test('nested and revoked proxies are refused before traps; resource bounds refuse',()=>{const r=record();class P extends Array{};const p=P.from(r.checks);assert.throws(()=>readRehearsalRecord({...r,checks:p}),{code:'RECEIPT_SCHEMA'});const target={...r};const proxy=new Proxy(target,{get(){throw new Error('trap')}});assert.throws(()=>readRehearsalRecord(proxy),{code:'RECEIPT_SCHEMA'});const revoked=Proxy.revocable({...r},{});revoked.revoke();assert.throws(()=>readRehearsalRecord(revoked),{code:'RECEIPT_SCHEMA'});assert.throws(()=>createRuntimeMatrix({rows:[{runtime:'node22',receipt:null,prerequisite:'x'},{runtime:'node24',receipt:text(r)}],expected:expected(r)}),{code:'MATRIX_ROW_SCHEMA'});});
test('rehearsal command documentation preserves offline script-disabled route',()=>{const c=rehearsalCommands({evidence:EVIDENCE,node:'/opt/node22/bin/node',checkout:ROOT});assert.equal(c.pack.args.includes('--offline'),true);assert.equal(c.install.args.includes('--ignore-scripts'),true);assert.throws(()=>rehearsalCommands({evidence:'/e',node:ROOT+'/node_modules/.bin/node',checkout:ROOT}),{code:'COMMAND_ARGS'});});

test('every independent owner proof field is binding',()=>{
  const fields=[['receiptSha256',()=>hex('f')],['receiptByteLength',()=>999],['node.version',()=> 'v22.12.0'],['node.path',()=>'/other/node'],['node.sha256',()=>hex('f')],['archive.sha256',()=>hex('f')],['archive.byteLength',()=>999]];
  for(const [name,value] of fields){const r=record(),e=structuredClone(expected(r));const p=e.observations.node24;if(name.startsWith('node.'))p.node[name.slice(5)]=value();else if(name.startsWith('archive.'))p.archive[name.slice(8)]=value();else p[name]=value();const m=matrix(r,null,e);assert.equal(m.rows.node24.status,'STALE',name);}
});

test('expected pins are closed, required, and do not self-pin the receipt',()=>{
  const r=record();for(const key of ['sourceManifest','stageManifest','caseManifest','toolchain','negativeLocations','notBefore','notAfter','observations']){const e=expected(r);delete e[key];assert.throws(()=>matrix(r,null,e),{code:'MATRIX_EXPECTED_SCHEMA'},key);}
  const stale=record({cases:{...caseManifest,[CASES[0]]:hex('f')}});assert.equal(matrix(stale).rows.node24.status,'STALE');
});

test('cutoff comparisons are inclusive and inverted windows refuse',()=>{
  const r=record({observedAt:'2026-09-20T00:00:00.000Z',completedAt:'2026-09-21T00:00:00.000Z'}),e=expected(r);assert.equal(matrix(r,null,e).rows.node24.status,'PASS');
  const before=record({observedAt:'2026-09-19T23:59:59.999Z'});assert.equal(matrix(before).rows.node24.reason,'OBSERVATION_OUTSIDE_WINDOW');
  const after=record({completedAt:'2026-09-21T00:00:00.001Z'});assert.equal(matrix(after).rows.node24.reason,'OBSERVATION_OUTSIDE_WINDOW');
  const inverted=expected(record());inverted.notBefore='2026-09-21T00:00:00.000Z';inverted.notAfter='2026-09-20T00:00:00.000Z';assert.throws(()=>matrix(record(),null,inverted),{code:'MATRIX_EXPECTED_SCHEMA'});
});

test('all 35 check roles require exact order, executable, cwd, argv, clean termination and exit',()=>{
  const edits=[];
  for(const [i,c] of record().checks.entries()){
    edits.push(['omit-'+i,r=>{r.checks.splice(i,1);}]);edits.push(['duplicate-'+i,r=>{r.checks.push({...r.checks[i]});}]);
    edits.push(['order-'+i,r=>{const j=(i+1)%r.checks.length;[r.checks[i],r.checks[j]]=[r.checks[j],r.checks[i]];}]);
    edits.push(['exe-'+i,r=>{r.checks[i].exe='/wrong';}]);edits.push(['cwd-'+i,r=>{r.checks[i].cwd='/wrong';}]);edits.push(['argv-'+i,r=>{r.checks[i].args=[...r.checks[i].args,'--wrong'];}]);edits.push(['exit-'+i,r=>{r.checks[i].exitCode=1;}]);edits.push(['abort-'+i,r=>{r.checks[i].signal='SIGKILL';}]);
  }
  for(const [name,mutate] of edits){const r=record();mutate(r);assert.notEqual(matrix(r).rows.node24.status,'PASS',name);}
});

test('all 29 extraction stdout digests and inventory/pack evidence are checked',()=>{
  for(const f of PRIVATE_PACKAGE_FILES){const r=record();r.checks.find(c=>c.name==='archive bytes '+f).stdout='wrong';assert.notEqual(matrix(r).rows.node24.status,'PASS',f);}
  for(const mutate of [r=>{r.checks[0].stdout='[]';},r=>{r.checks[0].stdout=JSON.stringify([{filename:'other.tgz',files:[]}]);},r=>{r.checks[1].stdout='wrong';},r=>{r.checks[1].args[1]='/other.tgz';}]){const r=record();mutate(r);assert.notEqual(matrix(r).rows.node24.status,'PASS');}
});

test('negative locations require exact expected coverage and bounded diagnostics',()=>{
  for(const mutate of [r=>{r.checks.find(c=>c.name.startsWith('negative')).stdout=negativeStdout.replace(/negative-[^\n]+\n/,'');},r=>{r.checks.find(c=>c.name.startsWith('negative')).stdout+='stranger.mts(1,1): error TS2322: x\n';},r=>{r.checks.find(c=>c.name.startsWith('negative')).stdout=negativeStdout+negativeStdout;},r=>{r.negativeControls.observed=72;},r=>{r.negativeControls.expected=72;}]){const r=record();mutate(r);assert.notEqual(matrix(r).rows.node24.status,'PASS');}
});

test('TAP duplicate, failure, skip and contradictory summaries remain non-PASS',()=>{for(const tapText of [tap+tap,tap.replace('# fail 0','# fail 1'),tap.replace('# skipped 0','# skipped 1'),tap.replace('# pass 11','# pass 10')]){const r=record({tapText});assert.notEqual(matrix(r).rows.node24.status,'PASS');}});

test('accessors, malformed/unsupported/partial-failed receipts, and flags are explicit',()=>{
  const r=record(),source={...r.sourceManifest};Object.defineProperty(source,'index.mjs',{get(){throw new Error('getter');},enumerable:true});assert.throws(()=>readRehearsalRecord({...r,sourceManifest:source}),{code:'RECEIPT_SCHEMA',detail:'sourceManifest accessor'});
  const entries={...r.archive.entries};Object.defineProperty(entries,'index.mjs',{get(){throw new Error('getter');},enumerable:true});assert.throws(()=>readRehearsalRecord({...r,archive:{...r.archive,entries}}),{code:'RECEIPT_SCHEMA',detail:'archive.entries accessor'});
  assert.equal(matrix({...r,schema:'other'}).rows.node24.status,'UNSUPPORTED');assert.equal(matrix({...r,status:'INCOMPLETE'}).rows.node24.status,'FAIL');
  const failed=record({status:'FAIL',failure:{name:'Error',message:'spawn failed',code:'ENOENT'},checks:[{...record().checks[0],error:'ENOENT',exitCode:null,stdout:undefined,stderr:undefined}]});const fm=matrix(failed).rows.node24;assert.equal(fm.status,'FAIL');assert.equal(fm.reason,'REHEARSAL_FAILED');
  const m=matrix(r);assert.equal(Object.isFrozen(m),true);assert.equal(Object.isFrozen(m.rows.node24),true);assert.equal(m.authorizing,false);assert.equal(m.executionAttested,false);
});

test('resource caps and zero-trap proxy boundaries are represented',()=>{
  const huge=record();huge.checks[34].stdout='x'.repeat(2*1024*1024+1);assert.equal(matrix(huge).rows.node24.status,'MALFORMED');
  const many=record();many.checks=Array.from({length:129},()=>many.checks[0]);assert.equal(matrix(many).rows.node24.status,'MALFORMED');
  const manyKeys=record();manyKeys.sourceManifest={...manyKeys.sourceManifest,...Object.fromEntries(Array.from({length:40},(_,i)=>['x'+i,hex('a')]))};assert.equal(matrix(manyKeys).rows.node24.status,'MALFORMED');
  const long=record();long.root='x'.repeat(8193);assert.equal(matrix(long).rows.node24.status,'MALFORMED');
  const giant=text(record())+'x'.repeat(4*1024*1024);assert.equal(createRuntimeMatrix({rows:[{runtime:'node22',receipt:null,prerequisite:NODE22_PREREQUISITE},{runtime:'node24',receipt:giant}],expected:expected(record())}).rows.node24.status,'MALFORMED');
  const trap=()=>{throw new Error('trap');};const nested=new Proxy({archive:new Proxy({}, {get:trap})},{get:trap});assert.throws(()=>readRehearsalRecord(nested),{code:'RECEIPT_SCHEMA'});const revoked=Proxy.revocable({},{});revoked.revoke();assert.throws(()=>readRehearsalRecord(revoked),{code:'RECEIPT_SCHEMA'});
});

// Owner-expanded regressions. Fixture pins are independent snapshots; only the
// receipt-byte observation is refreshed for semantic mutations below. These
// synthetic records never establish that either runtime actually ran.
const adverse=[
  ['schema absent',r=>delete r.schema,'MALFORMED'],
  ['extra top-level field',r=>r.accepted=true,'MALFORMED'],
  ['missing completion',r=>delete r.completedAt,'MALFORMED'],
  ['unknown status',r=>r.status='PASS','UNSUPPORTED'],
  ['network boundary',r=>r.boundaries.networkAllowed=true,'UNSUPPORTED'],
  ['lifecycle boundary',r=>r.boundaries.lifecycleScriptsAllowed=true,'UNSUPPORTED'],
  ['publication boundary',r=>r.boundaries.published=true,'UNSUPPORTED'],
  ['boundary not boolean',r=>r.boundaries.published='false','MALFORMED'],
  ['node hash short',r=>r.node.sha256='ab','MALFORMED'],
  ['archive hash uppercase',r=>r.archive.sha256='A'.repeat(64),'MALFORMED'],
  ['archive extra field',r=>r.archive.verified=true,'MALFORMED'],
  ['missing check exit',r=>delete r.checks[0].exitCode,'MALFORMED'],
  ['missing ran stdout',r=>delete r.checks[0].stdout,'MALFORMED'],
  ['missing ran stderr',r=>delete r.checks[34].stderr,'MALFORMED'],
  ['non-string argument',r=>r.checks[0].args=[1],'MALFORMED'],
  ['fractional duration',r=>r.checks[0].elapsedMs=1.5,'MALFORMED'],
  ['negative duration',r=>r.checks[0].elapsedMs=-1,'MALFORMED'],
  ['invalid source hash',r=>r.sourceManifest['index.mjs']='bad','MALFORMED'],
  ['reversed timestamps',r=>r.completedAt='2026-09-20T06:41:24.999Z','MALFORMED'],
  ['non-ISO timestamp',r=>r.observedAt='September 20','MALFORMED'],
  ['invalid negative flag',r=>r.negativeControls.allExpectedLocationsDetected=1,'MALFORMED'],
  ['invalid failure shape',r=>r.failure={name:'E',message:'m',code:null,stack:'s'},'MALFORMED'],
  ['unpaired surrogate',r=>r.root='/repo\ud800','MALFORMED'],
  ['missing archive',r=>delete r.archive,'SKIPPED'],
  ['missing installed',r=>delete r.installed,'SKIPPED'],
  ['missing toolchain',r=>delete r.toolchain,'SKIPPED'],
  ['missing negatives',r=>delete r.negativeControls,'SKIPPED'],
  ['inexact installed copy',r=>r.installed.exactArchiveMatch=false,'FAIL'],
  ['wrong installed path',r=>r.installed.path='/elsewhere','FAIL'],
  ['wrong archive path',r=>r.archive.path='/elsewhere.tgz','FAIL'],
  ['outside evidence root',r=>r.evidence='/elsewhere','FAIL'],
  ['source inventory short',r=>delete r.sourceManifest['index.mjs'],'STALE'],
  ['archive extra file',r=>r.archive.entries['unexpected']=hex('a'),'STALE'],
  ['stage archive drift',r=>r.archive.entries['index.mjs']=hex('a'),'FAIL'],
  ['source pin stale',r=>r.sourceManifest['index.mjs']=hex('a'),'STALE'],
  ['stage pin stale',r=>r.stageManifest['index.mjs']=hex('a'),'STALE'],
  ['case pin stale',r=>r.caseManifest[CASES[0]]=hex('a'),'STALE'],
  ['toolchain pin stale',r=>r.toolchain.compilerEntrySha256=hex('a'),'STALE'],
  ['unclaimed extra TS file',r=>r.checks[33].stdout+='other.ts(1,1): error TS2322: x\n','FAIL'],
  ['global TS diagnostic',r=>r.checks[33].stdout+='error TS9999: x\n','FAIL'],
  ['wrong negative location',r=>r.checks[33].stdout=negativeStdout.replace('(2,5)','(9999,5)'),'FAIL'],
  ['duplicate substitutes missing location',r=>{
    const lines=negativeStdout.trimEnd().split('\n');lines[1]=lines[0];r.checks[33].stdout=lines.join('\n')+'\n';
  },'FAIL'],
  ['observed count mismatch',r=>r.negativeControls.observed=74,'FAIL'],
  ['diagnostic count above bound',r=>r.negativeControls.observed=513,'FAIL'],
  ['diagnostic text above bound',r=>{
    r.negativeControls.observed=512;r.checks[33].stdout=negativeStdout+Array(441).fill(negativeStdout.split('\n')[0]).join('\n')+'\n';
  },'FAIL'],
  ['TAP cancellation',r=>r.checks[34].stdout=tap.replace('# cancelled 0','# cancelled 1'),'FAIL'],
  ['TAP todo',r=>r.checks[34].stdout=tap.replace('# todo 0','# todo 1'),'SKIPPED'],
  ['TAP no summary',r=>r.checks[34].stdout='ok 1\n','FAIL'],
  ['TAP wrong plan',r=>r.checks[34].stdout=tap.replace('1..11','1..12'),'FAIL'],
  ['TAP duplicate plan',r=>r.checks[34].stdout=tap+'1..11\n','FAIL'],
  ['TAP duplicate one counter',r=>r.checks[34].stdout=tap+'# pass 11\n','FAIL'],
  ['pack JSON syntax',r=>r.checks[0].stdout='{','FAIL'],
  ['pack duplicate entry',r=>{
    const p=JSON.parse(r.checks[0].stdout);p[0].files[1]=p[0].files[0];r.checks[0].stdout=JSON.stringify(p);
  },'FAIL'],
  ['tar duplicate entry',r=>{
    const p=r.checks[1].stdout.trim().split('\n');p[1]=p[0];r.checks[1].stdout=p.join('\n')+'\n';
  },'FAIL'],
];
for(const [name,mutate,status] of adverse)test('adverse: '+name,()=>{
  const r=record(),e=expected(r);mutate(r);
  e.observations.node24.receiptSha256=sha(text(r));e.observations.node24.receiptByteLength=Buffer.byteLength(text(r));
  assert.equal(matrix(r,null,e).rows.node24.status,status);
});

test('fixture mutations cannot leak across records or independent expected pins',()=>{
  const a=record(),b=record(),e=expected(a);a.caseManifest[CASES[0]]=hex('f');
  a.node.path='/different';a.toolchain.typeRoots[0]='/different';a.archive.entries['index.mjs']=hex('f');
  assert.deepEqual(b,record());assert.deepEqual(e,expected(b));
});
test('null proof and absent expected contract stay non-PASS',()=>{
  const r=record(),e=expected(r);e.observations.node24=null;
  assert.equal(matrix(r,null,e).rows.node24.reason,'CALLER_PROOF_MISMATCH');
  assert.equal(matrix(r,null,null).rows.node24.reason,'EXPECTED_CONTRACT_MISSING');
});
test('coherent non-metadata stage/source substitution still fails',()=>{
  const r=record(),e=expected(r);r.stageManifest['index.mjs']=r.archive.entries['index.mjs']=sha('different');
  r.checks[2+PRIVATE_PACKAGE_FILES.indexOf('index.mjs')].stdout='different';
  e.stageManifest['index.mjs']=sha('different');e.observations=expected(r).observations;
  assert.equal(matrix(r,null,e).rows.node24.reason,'SOURCE_STAGE_DRIFT');
});
test('extra diagnostics at known locations retain truthful counts',()=>{
  const r=record();r.checks[33].stdout+=negativeStdout.split('\n')[0]+'\n';r.negativeControls.observed=74;
  assert.equal(matrix(r).rows.node24.status,'PASS');
});
test('timestamps alone do not imply shared execution; reused identities do',()=>{
  const make22=()=>record({node:node22,evidence:ROOT+'/.build/private-package-BBBBBB'});
  assert.equal(matrix(record(),make22()).status,'PASS_SCOPED');
  for(const mutate of [r=>r.node.sha256=node24.sha256,r=>r.evidence=EVIDENCE]){
    const r=make22();mutate(r);assert.equal(matrix(record(),r).reasons.includes('RUNTIME_IDENTITY_SHARED'),true);
  }
  assert.equal(matrix(record(),record()).reasons.includes('RUNTIME_IDENTITY_SHARED'),true);
  const r=make22();r.archive.byteLength+=1;assert.equal(matrix(record(),r).reasons.includes('ARCHIVE_MISMATCH'),true);
});
test('runtime relabeling, unsupported major and malformed version remain explicit',()=>{
  assert.equal(matrix(record({node:node22})).rows.node24.status,'MISMATCH');
  assert.equal(matrix(record({node:{...node24,version:'v20.19.0'}})).rows.node24.status,'UNSUPPORTED');
  for(const version of ['24.18.0','v24.18','v24.18.0-rc.1','V24.18.0','']){
    const r=record({node:{...node24,version}});assert.equal(matrix(r,null,expected(record())).rows.node24.status,'MALFORMED');
  }
});
test('unknown durations remain null, zero remains zero, and output is deeply frozen',()=>{
  const r=record();r.checks[0].elapsedMs=null;r.checks[34].elapsedMs=0;
  const m=matrix(r);assert.equal(m.rows.node24.durations.packMs,null);assert.equal(m.rows.node24.durations.runtimeMs,0);
  assert.equal(m.rows.node24.tokens,null);assert.equal(m.rows.node22.tokens,null);
  const frozen=v=>{if(v&&typeof v==='object'){assert.equal(Object.isFrozen(v),true);for(const x of Object.values(v))frozen(x);}};
  frozen(m);frozen(readRehearsalRecord(r));assert.equal(m.sourceAuthenticityAttested,false);
  assert.equal(m.scope,'CALLER_SUPPLIED_REHEARSAL_EVIDENCE_ONLY');
});
test('spawn failure without output retains the actual failure, not invented TAP',()=>{
  const r=record({status:'FAIL',failure:{name:'AssertionError',message:'spawn failed',code:'ERR_ASSERTION'}});
  r.checks=[{...r.checks[0],exitCode:null,error:'ENOENT'}];delete r.checks[0].stdout;delete r.checks[0].stderr;
  for(const k of ['archive','installed','toolchain','negativeControls'])delete r[k];
  const out=matrix(r).rows.node24;assert.equal(out.reason,'REHEARSAL_FAILED');assert.equal(out.archive,null);
  assert.equal(out.runtimeTests,null);assert.equal(out.failure.code,'ERR_ASSERTION');
  assert.equal(readRehearsalRecord(r).checks[0].stdout,null);
});

// Every injection starts with a valid object and replaces only one boundary.
// A proxy must be rejected before ANY reflection trap, not only before .get.
const recordBoundaries=[
  ['record',(_,p)=>p],['node',(r,p)=>(r.node=p,r)],['checks',(r,p)=>(r.checks=p,r)],
  ['check',(r,p)=>(r.checks[0]=p,r)],['args',(r,p)=>(r.checks[0].args=p,r)],
  ['source',(r,p)=>(r.sourceManifest=p,r)],['stage',(r,p)=>(r.stageManifest=p,r)],
  ['cases',(r,p)=>(r.caseManifest=p,r)],['archive',(r,p)=>(r.archive=p,r)],
  ['entries',(r,p)=>(r.archive.entries=p,r)],['installed',(r,p)=>(r.installed=p,r)],
  ['toolchain',(r,p)=>(r.toolchain=p,r)],['typeRoots',(r,p)=>(r.toolchain.typeRoots=p,r)],
  ['negative',(r,p)=>(r.negativeControls=p,r)],['boundary',(r,p)=>(r.boundaries=p,r)],
  ['failure',(r,p)=>(r.failure=p,r)],
];
for(const [name,inject] of recordBoundaries)for(const revoked of [false,true])test(`zero-trap ${revoked?'revoked':'live'} proxy: ${name}`,()=>{
  let traps=0;const hit=()=>{traps+=1;throw new Error('trap executed');};
  const p=Proxy.revocable({}, {get:hit,getPrototypeOf:hit,getOwnPropertyDescriptor:hit,ownKeys:hit});
  if(revoked)p.revoke();assert.throws(()=>readRehearsalRecord(inject(record(),p.proxy)),RuntimeMatrixError);assert.equal(traps,0);
});
const inputFor=r=>({rows:[{runtime:'node22',receipt:null,prerequisite:NODE22_PREREQUISITE},{runtime:'node24',receipt:text(r)}],expected:expected(r)});
const inputBoundaries=[
  ['input',(_,p)=>p],['rows',(i,p)=>(i.rows=p,i)],['row',(i,p)=>(i.rows[0]=p,i)],
  ['expected',(i,p)=>(i.expected=p,i)],['source',(i,p)=>(i.expected.sourceManifest=p,i)],
  ['stage',(i,p)=>(i.expected.stageManifest=p,i)],['cases',(i,p)=>(i.expected.caseManifest=p,i)],
  ['toolchain',(i,p)=>(i.expected.toolchain=p,i)],['typeRoots',(i,p)=>(i.expected.toolchain.typeRoots=p,i)],
  ['locations',(i,p)=>(i.expected.negativeLocations=p,i)],['location',(i,p)=>(i.expected.negativeLocations[0]=p,i)],
  ['observations',(i,p)=>(i.expected.observations=p,i)],['proof',(i,p)=>(i.expected.observations.node24=p,i)],
  ['node',(i,p)=>(i.expected.observations.node24.node=p,i)],['archive',(i,p)=>(i.expected.observations.node24.archive=p,i)],
];
for(const [name,inject] of inputBoundaries)for(const revoked of [false,true])test(`matrix zero-trap ${revoked?'revoked':'live'} proxy: ${name}`,()=>{
  let traps=0;const hit=()=>{traps+=1;throw new Error('trap executed');};
  const p=Proxy.revocable({}, {get:hit,getPrototypeOf:hit,getOwnPropertyDescriptor:hit,ownKeys:hit});
  if(revoked)p.revoke();assert.throws(()=>createRuntimeMatrix(inject(inputFor(record()),p.proxy)),RuntimeMatrixError);assert.equal(traps,0);
});
test('descriptor, prototype, symbol and sparse-array guards preserve zero access',()=>{
  const mutations=[
    r=>Object.defineProperty(r,'status',{get(){throw new Error('getter');},enumerable:true}),
    r=>Object.defineProperty(r,'node',{value:r.node,enumerable:false}),
    r=>Object.setPrototypeOf(r,{schema:REHEARSAL_SCHEMA}),
    r=>{r[Symbol('x')]=1;return r;},
    r=>{r.sourceManifest[Symbol('x')]=hex('a');return r;},
    r=>{r.archive.entries[Symbol('x')]=hex('a');return r;},
    r=>{delete r.checks[0];return r;},
    r=>{Object.defineProperty(r.checks,'0',{get(){throw new Error('getter');},enumerable:true});return r;},
  ];
  for(const mutate of mutations)assert.throws(()=>readRehearsalRecord(mutate(record())),RuntimeMatrixError);
  const r=record();Object.setPrototypeOf(r,null);assert.equal(readRehearsalRecord(r).status,'PASS_SCOPED');
});
for(const [name,mutate] of [
  ['schema',r=>r.schema='x'.repeat(8193)],['status',r=>r.status='x'.repeat(8193)],
  ['UTF8 string bytes',r=>r.root='é'.repeat(4097)],['stderr',r=>r.checks[0].stderr='x'.repeat(256*1024+1)],
  ['argument count',r=>r.checks[0].args=Array(129).fill('x')],
  ['manifest key',r=>r.sourceManifest['x'.repeat(8193)]=hex('a')],
  ['record keys',r=>Object.assign(r,Object.fromEntries(Array.from({length:65},(_,i)=>['extra'+i,1])))],
])test('resource bound: '+name,()=>{const r=record();mutate(r);assert.throws(()=>readRehearsalRecord(r),RuntimeMatrixError);});
test('matrix input and expected-contract bounds cannot be bypassed',()=>{
  for(const mutate of [
    i=>i.rows[0].prerequisite=NODE22_PREREQUISITE+'x'.repeat(8193),
    i=>i.expected.negativeLocations=Array(129).fill(locations[0]),
    i=>i.expected.negativeLocations[0].line=0,
    i=>i.expected.negativeLocations[1]=i.expected.negativeLocations[0],
    i=>i.expected.negativeLocations[0].file='other.mts',
    i=>i.expected.toolchain.typeRoots.push('/other'),
    i=>i.expected.extra=1,
    i=>i.expected.observations.node24.archive.extra=1,
    i=>i.rows.pop(),i=>i.rows[1]=i.rows[0],
    i=>i.rows[0].runtime='node20',i=>i.rows[0].prerequisite='placeholder',
    i=>i.rows[1].prerequisite=NODE22_PREREQUISITE,
    i=>Object.defineProperty(i.rows[1],'receipt',{get(){throw new Error('getter');}}),
  ]){const input=inputFor(record());mutate(input);assert.throws(()=>createRuntimeMatrix(input),RuntimeMatrixError);}
});
test('malformed text keeps no invented evidence and all-unrun input stays incomplete',()=>{
  for(const receipt of ['{','[]','null','"scalar"']){
    const input=inputFor(record());input.rows[1].receipt=receipt;
    const r=createRuntimeMatrix(input).rows.node24;assert.equal(r.status,'MALFORMED');assert.equal(r.node,null);assert.equal(r.receiptSha256,sha(receipt));
  }
  const m=createRuntimeMatrix({rows:[{runtime:'node22',receipt:null,prerequisite:NODE22_PREREQUISITE},{runtime:'node24',receipt:null,prerequisite:'Node 24 absent; scripts/check-private-package.mjs requires this runtime'}]});
  assert.equal(m.status,'INCOMPLETE');assert.equal(m.archive,null);
});
