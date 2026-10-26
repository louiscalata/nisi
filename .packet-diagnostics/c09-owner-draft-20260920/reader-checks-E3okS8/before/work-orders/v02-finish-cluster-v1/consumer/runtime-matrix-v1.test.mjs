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
const ROOT='/repo',EVIDENCE='/repo/.build/private-package-AAAAAA',CONSUMER=EVIDENCE+'/consumer',ARCHIVE=EVIDENCE+'/nisi-0.2.0-private.0.tgz',TSC=ROOT+'/node_modules/typescript/bin/tsc';
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
const jsonFiles=JSON.stringify(PRIVATE_PACKAGE_FILES.map(path=>({path:'package/'+path})),null,0);
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
  return {schema:REHEARSAL_SCHEMA,status,observedAt,root:ROOT,evidence,node,checks:cs,sourceManifest:source,stageManifest:stage,caseManifest:cases,boundaries:{stagedArchiveOnly:true,canonicalRootPackSupported:false,networkAllowed:false,lifecycleScriptsAllowed:false,modelInference:false,nativeExecution:false,published:false,fullMerger:false,hostileWriterIsolation:false},archive:{path:archive,sha256:archiveSha,byteLength:43624,entries:archives},installed:{path:consumer+'/node_modules/nisi',exactArchiveMatch:true},toolchain:TOOLCHAIN,negativeControls:{expected:73,observed:73,allExpectedLocationsDetected:true},completedAt,failure};
}
const text=r=>JSON.stringify(r,null,2)+'\n';
function expected(r24,r22=null){const t=x=>x===null?null:text(x);const proof=(r,x)=>x===null?null:{receiptSha256:sha(t(x)),receiptByteLength:Buffer.byteLength(t(x)),node:x.node,archive:{sha256:x.archive.sha256,byteLength:x.archive.byteLength}};return {sourceManifest,stageManifest,caseManifest,toolchain:TOOLCHAIN,negativeLocations:locations,notBefore:'2026-09-20T00:00:00.000Z',notAfter:'2026-09-21T00:00:00.000Z',observations:{node22:proof(t,r22),node24:proof(t,r24)}};}
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
