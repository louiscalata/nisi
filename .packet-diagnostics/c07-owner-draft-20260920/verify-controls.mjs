// Owner-only control verification. Mutation writes are confined to a new directory.
import fs from 'node:fs'; import path from 'node:path'; import assert from 'node:assert/strict';
import {createHash} from 'node:crypto'; import {spawnSync} from 'node:child_process'; import {fileURLToPath} from 'node:url';
const base=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(base,'../..');
const hash=b=>createHash('sha256').update(b).digest('hex');
const read=f=>JSON.parse(fs.readFileSync(path.join(root,f)));
const controls=['work-orders/v02-finish-cluster-v1/check-c07.mjs','work-orders/v02-finish-cluster-v1/check-c06.mjs',
  'work-orders/v02-finish-cluster-v1/check-cluster.mjs','tests/finish-cluster-c07.test.mjs',
  'tests/finish-cluster-c06.test.mjs','tests/finish-cluster-inventory.test.mjs','tests/finish-cluster-dispatch.test.mjs'];
const sourceHashes=Object.fromEntries(controls.map(file=>[file,hash(fs.readFileSync(path.join(root,file)))]));
const output=fs.mkdtempSync(path.join(base,'controls-')),stage=path.join(output,'mutant'); fs.mkdirSync(stage);
const files=new Set([...controls,'work-orders/v02-finish-cluster-v1/cluster.json']);
for(const file of ['.packet-diagnostics/c07-owner-draft-20260920/final-evidence.json','.packet-diagnostics/c06-owner-draft-20260920/final-evidence.json']){
  const e=read(file);files.add(file);files.add(e.prerequisite.evidence);
  for(const kind of ['packet','candidateCheckpoint','checkpoint','mutations','validation','review','integrationReview','canonical']){
    if(e[kind]?.path)files.add(e[kind].path);if(e[kind]?.logPath)files.add(e[kind].logPath);
  }
  for(const f of [...Object.keys(e.sourceHashes),...Object.keys(e.dependencyHashes)])files.add(f);
  for(const row of read(e.checkpoint.path).checks)files.add(path.posix.join(path.posix.dirname(e.checkpoint.path),row.name+'.log'));
  for(const row of read(e.canonical.path).checks)files.add(row.logPath);
  if(e.mutations)for(const row of read(e.mutations.path).checks)files.add(path.posix.join(path.posix.dirname(e.mutations.path),row.name+'.log'));
}
for(const file of files){
  assert(!path.isAbsolute(file)&&!file.includes('\\')&&!file.split('/').includes('..'));
  const target=path.join(stage,file);fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.copyFileSync(path.join(root,file),target);
}
const guardFile=path.join(stage,controls[0]),guard=fs.readFileSync(guardFile,'utf8');
const signature='export function assertC07Acceptance({ root, cluster, sha }) {';
assert.equal(guard.split(signature).length,2);
fs.writeFileSync(guardFile,guard.replace(signature,'export function assertC07Acceptance(){ return true; }\nfunction disabledGuard({ root, cluster, sha }) {'));
const checks=[];
function run(name,args,cwd,count,mutant=false){
  const r=spawnSync(process.execPath,args,{cwd,encoding:'utf8',timeout:60000,killSignal:'SIGKILL',maxBuffer:8*1024*1024});
  const log=(r.stdout??'')+(r.stderr??''),logPath=path.relative(root,path.join(output,name+'.log'));
  fs.writeFileSync(path.join(root,logPath),log,{flag:'wx'});
  const counts=Object.fromEntries(['tests','pass','fail','skipped','cancelled','todo'].map(key=>{
    const matches=[...log.matchAll(new RegExp('^# '+key+' (\\d+)$','gm'))];return[key,matches.length===1?Number(matches[0][1]):-1];
  }));
  const clean=!r.error&&!r.signal&&counts.tests===count&&counts.skipped===0&&counts.cancelled===0&&counts.todo===0;
  const outcome=mutant?r.status===1&&counts.fail>0&&/ERR_ASSERTION/.test(log)&&!/(?:SyntaxError|ReferenceError|TypeError):/.test(log)
    :r.status===0&&counts.pass===count&&counts.fail===0;
  const ok=clean&&outcome;
  checks.push({name,command:[process.execPath,...args],cwd,exitCode:r.status,error:r.error?.code??null,signal:r.signal,counts,logPath,logSha256:hash(log),ok});
  console.log(JSON.stringify({name,counts,ok}));
}
run('mutant-guard-disabled',['--test-reporter=tap','--test','tests/finish-cluster-c07.test.mjs'],stage,31,true);
run('c07-controls',['--test-reporter=tap','--test','tests/finish-cluster-c07.test.mjs'],root,31);
run('c06-controls',['--test-reporter=tap','--test','tests/finish-cluster-c06.test.mjs'],root,25);
const pkg=read('work-orders/v02-finish-cluster-v1/package.json');
for(const[name,key,count]of[['baseline','test',117],['c01','test:c01',112]]){
  const cmd=pkg.scripts[key];assert(/^node --test [a-zA-Z0-9./ -]+$/.test(cmd));
  run(name,['--test-reporter=tap','--test-concurrency=1',...cmd.split(' ').slice(1)],path.join(root,'work-orders/v02-finish-cluster-v1'),count);
}
const task={taskId:'nisi.c07.acceptance-controls',mode:'edit',language:'javascript',allowedFiles:controls,protectedFiles:[],protectedSnapshots:{},
  acceptanceCriteria:['Preserve immutable C06 history while permitting only the exact fully evidenced C07 dependency transition. Bind current source, dependency, raw log, review, packet and historical identities. Keep the native and dispatch gates closed. All fixture writes are scratch-only.'],
  policy:{repairBudget:0,totalDeadlineMs:120000,requiredReviewers:1,requireReportStore:false}};
const input=JSON.stringify({task,candidate:{files:controls.map(file=>({path:file,content:fs.readFileSync(path.join(root,file),'utf8')}))}});
assert(Buffer.byteLength(input)<=262144);
const vr=spawnSync('/Users/louiscalata/bin/initiate-online-code-mode',['--nisi','validate'],{input,encoding:'utf8',timeout:30000,killSignal:'SIGKILL',maxBuffer:8*1024*1024});
const vlog=(vr.stdout??'')+(vr.stderr??''),validationPath=path.relative(root,path.join(output,'nisi-validation.log'));
fs.writeFileSync(path.join(root,validationPath),vlog,{flag:'wx'});
let validation=null;try{validation=JSON.parse(vr.stdout);}catch{}
const validationOk=vr.status===0&&!vr.error&&!vr.signal&&validation?.status==='VALIDATED'&&validation.accepted===false&&validation.authorizing===false&&
  validation.checks?.contract?.status==='PASS'&&validation.checks?.syntax?.status==='PASS'&&validation.checks.syntax.checkedFiles.length===controls.length;
const sourceUnchanged=Object.entries(sourceHashes).every(([file,h])=>hash(fs.readFileSync(path.join(root,file)))===h);
const acceptanceObservations=[];
for(const[name,args,exitCode]of[['inventory',['work-orders/v02-finish-cluster-v1/check-cluster.mjs'],0],['dispatch',['work-orders/v02-finish-cluster-v1/dispatch-check.mjs','C07'],2]]){
  const result=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
  const log=(result.stdout??'')+(result.stderr??''),logPath=path.relative(root,path.join(output,name+'.log'));
  fs.writeFileSync(path.join(root,logPath),log,{flag:'wx'});
  let value=null;try{value=JSON.parse(log);}catch{}
  const matches=name==='inventory'?value?.implementationAccepted===7&&value.finishPacketPercent===70&&value.overallMilestonePercent===30&&value.nativeBuildAccepted===false&&Array.isArray(value.dispatchApproved)&&value.dispatchApproved.length===0
    :value?.status==='HELD'&&value.dispatchApproved===false&&value.publicationAuthorized===false;
  const ok=result.status===exitCode&&!result.error&&!result.signal&&matches;
  acceptanceObservations.push({name,command:[process.execPath,...args],exitCode:result.status,error:result.error?.code??null,signal:result.signal,logPath,logSha256:hash(log),value,ok});
}
const record={schema:'nisi.c07.owner-controls.v1',at:new Date().toISOString(),sourceHashes,sourceUnchanged,checks,
  validation:{exitCode:vr.status,error:vr.error?.code??null,signal:vr.signal,ok:validationOk,path:validationPath,sha256:hash(vlog),binding:validation?.binding??null},
  acceptanceObservations,ledgerSha256:hash(fs.readFileSync(path.join(root,'work-orders/v02-finish-cluster-v1/cluster.json'))),
  inference:'NOT_RUN',implementationAccepted:false,nativeBuildAccepted:false,publicationAuthorized:false,
  ok:sourceUnchanged&&validationOk&&checks.every(row=>row.ok)&&acceptanceObservations.every(row=>row.ok)};
fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output,ok:record.ok,sourceUnchanged,validationOk}));if(!record.ok)process.exitCode=1;
