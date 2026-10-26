// Owner-only verification of additive C06 acceptance controls. No provider calls.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const base=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(base,'../..'),h=b=>createHash('sha256').update(b).digest('hex');
const evidenceFile='.packet-diagnostics/c06-owner-draft-20260920/final-evidence.json';
const evidence=JSON.parse(fs.readFileSync(path.join(root,evidenceFile)));
const canonical=JSON.parse(fs.readFileSync(path.join(root,evidence.canonical.path)));
const checkpoint=JSON.parse(fs.readFileSync(path.join(root,evidence.checkpoint.path)));
const controls=['work-orders/v02-finish-cluster-v1/check-c06.mjs','tests/finish-cluster-c06.test.mjs',
  'work-orders/v02-finish-cluster-v1/check-cluster.mjs','tests/finish-cluster-inventory.test.mjs','tests/finish-cluster-dispatch.test.mjs'];
const sourceHashes=Object.fromEntries(controls.map(f=>[f,h(fs.readFileSync(path.join(root,f)))]));
const output=fs.mkdtempSync(path.join(base,'controls-')),mutation=path.join(output,'mutant');fs.mkdirSync(mutation);
const files=new Set(['work-orders/v02-finish-cluster-v1/cluster.json',evidenceFile,evidence.packet.path,evidence.checkpoint.path,evidence.review.path,
  evidence.validation.path,evidence.validation.logPath,evidence.canonical.path,evidence.prerequisite.evidence,
  ...canonical.checks.map(row=>row.logPath),...Object.keys(evidence.sourceHashes),...Object.keys(evidence.dependencyHashes),
  ...checkpoint.checks.map(row=>path.posix.join(path.posix.dirname(evidence.checkpoint.path),row.name+'.log')),
  'tests/finish-cluster-c06.test.mjs']);
for(const file of files){assert(!path.isAbsolute(file)&&!file.split('/').includes('..'));const target=path.join(mutation,file);
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,file),target);}
// Deliberately remove the guard in this owned negative-control checkout only.
fs.writeFileSync(path.join(mutation,'work-orders/v02-finish-cluster-v1/check-c06.mjs'),
  'export function assertC06Acceptance(){ return true; }\n',{flag:'wx'});
const checks=[];
function run(name,args,cwd,expected){
  const r=spawnSync(process.execPath,args,{cwd,encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024});
  const log=(r.stdout??'')+(r.stderr??''),logPath=path.relative(root,path.join(output,name+'.log'));fs.writeFileSync(path.join(root,logPath),log,{flag:'wx'});
  const counts=Object.fromEntries(['tests','pass','fail','skipped','cancelled','todo'].map(key=>[key,Number(log.match(new RegExp('^# '+key+' (\\d+)$','m'))?.[1]??-1)]));
  const ok=!r.error&&!r.signal&&r.status===expected.exitCode&&Object.entries(expected.counts).every(([k,v])=>counts[k]===v)&&counts.skipped===0&&counts.cancelled===0&&counts.todo===0;
  checks.push({name,command:[process.execPath,...args],cwd,exitCode:r.status,error:r.error?.code??null,signal:r.signal,counts,logPath,logSha256:h(log),ok});
  console.log(JSON.stringify({name,counts,ok}));
}
run('mutant-guard-disabled',['--test-reporter=tap','--test','tests/finish-cluster-c06.test.mjs'],mutation,{exitCode:1,counts:{tests:25,pass:1,fail:24}});
run('c06-controls',['--test-reporter=tap','--test','tests/finish-cluster-c06.test.mjs'],root,{exitCode:0,counts:{tests:25,pass:25,fail:0}});
const pkg=JSON.parse(fs.readFileSync(path.join(root,'work-orders/v02-finish-cluster-v1/package.json')));
for(const [name,key,count] of [['baseline','test',84],['c01','test:c01',79]]){
  const command=pkg.scripts[key];assert(/^node --test [a-zA-Z0-9./ -]+$/.test(command));
  run(name,['--test-reporter=tap','--test-concurrency=1',...command.split(' ').slice(1)],path.join(root,'work-orders/v02-finish-cluster-v1'),{exitCode:0,counts:{tests:count,pass:count,fail:0}});
}
const task={taskId:'nisi.c06.acceptance-controls',mode:'edit',language:'javascript',allowedFiles:controls,protectedFiles:[],protectedSnapshots:{},
  acceptanceCriteria:['Validate exact C06 source, prerequisite, command, dependency, review, validation, packet and canonical evidence without broadening authority or changing prior C01-C05 acceptance. Include additive negative controls and held dispatch.'],
  policy:{repairBudget:0,totalDeadlineMs:120000,requiredReviewers:1,requireReportStore:false}};
const candidate={files:controls.map(file=>({path:file,content:fs.readFileSync(path.join(root,file),'utf8')}))};
const input=JSON.stringify({task,candidate});assert(Buffer.byteLength(input)<=262144);
const vr=spawnSync('/Users/louiscalata/bin/initiate-online-code-mode',['--nisi','validate'],{input,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});
const vlog=(vr.stdout??'')+(vr.stderr??'');const validationPath=path.relative(root,path.join(output,'nisi-validation.log'));fs.writeFileSync(path.join(root,validationPath),vlog,{flag:'wx'});
let validation=null;try{validation=JSON.parse(vr.stdout);}catch{}
const validationOk=vr.status===0&&!vr.error&&!vr.signal&&validation?.status==='VALIDATED'&&validation.accepted===false&&validation.authorizing===false&&validation.checks?.contract?.status==='PASS'&&validation.checks?.syntax?.status==='PASS'&&validation.checks.syntax.checkedFiles.length===5;
const sourceUnchanged=Object.entries(sourceHashes).every(([f,d])=>h(fs.readFileSync(path.join(root,f)))===d);
const record={schema:'nisi.c06.owner-controls.v1',at:new Date().toISOString(),sourceHashes,sourceUnchanged,checks,
  validation:{exitCode:vr.status,error:vr.error?.code??null,signal:vr.signal,ok:validationOk,path:validationPath,sha256:h(vlog),binding:validation?.binding??null},
  inference:'NOT_RUN',implementationAccepted:false,nativeBuildAccepted:false,publicationAuthorized:false,ok:sourceUnchanged&&validationOk&&checks.every(c=>c.ok)};
fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output,ok:record.ok,sourceUnchanged,validationOk}));if(!record.ok)process.exitCode=1;
