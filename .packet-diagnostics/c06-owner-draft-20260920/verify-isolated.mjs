// Owner-only isolated verification of reviewed C06 source; no inference or application.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const base=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(base,'../..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const candidateFiles=['history/host-journal-bundle.mjs','work-orders/v02-finish-cluster-v1/restart/host-bundle-integration.test.mjs','tests/host-journal-bundle.test.mjs'];
const candidateHashes=Object.fromEntries(candidateFiles.map(file=>[file,hash(fs.readFileSync(path.join(base,'candidate',file)))]));
const listed=spawnSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8',timeout:10000,maxBuffer:8*1024*1024});
assert.equal(listed.status,0);assert.equal(listed.error,undefined);assert.equal(listed.signal,null);
const output=fs.mkdtempSync(path.join(base,'checks-')),stage=path.join(output,'source');fs.mkdirSync(stage);
const canonicalHashes={},stagedHashes={};
for(const file of new Set([...listed.stdout.split('\0').filter(Boolean),...candidateFiles])){
  assert(!path.isAbsolute(file)&&!file.split('/').includes('..')&&!file.includes('\\'));
  const canonical=path.join(root,file),source=candidateFiles.includes(file)?path.join(base,'candidate',file):canonical;
  const target=path.join(stage,file);fs.mkdirSync(path.dirname(target),{recursive:true});
  const stat=fs.lstatSync(source);
  if(stat.isSymbolicLink()){
    const link=fs.readlinkSync(source);assert(!path.isAbsolute(link)&&path.resolve(path.dirname(source),link).startsWith(root+path.sep));
    fs.symlinkSync(link,target);
  }else{
    assert(stat.isFile());const bytes=fs.readFileSync(source);stagedHashes[file]=hash(bytes);fs.writeFileSync(target,bytes,{flag:'wx'});
  }
  if(fs.existsSync(canonical)&&fs.lstatSync(canonical).isFile())canonicalHashes[file]=hash(fs.readFileSync(canonical));
}
fs.symlinkSync(path.join(root,'node_modules'),path.join(stage,'node_modules'),'dir');
const pkg=JSON.parse(fs.readFileSync(path.join(stage,'work-orders/v02-finish-cluster-v1/package.json')));
const checks=[];
function run(name,args,cwd=stage){
  const result=spawnSync(process.execPath,args,{cwd,encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024});
  const log=(result.stdout??'')+(result.stderr??'');fs.writeFileSync(path.join(output,name+'.log'),log,{flag:'wx'});
  const counts=Object.fromEntries(['tests','pass','fail','skipped','cancelled','todo'].map(key=>[key,Number(log.match(new RegExp('^# '+key+' (\\d+)$','m'))?.[1]??-1)]));
  const ok=result.status===0&&!result.error&&!result.signal&&counts.tests>0&&counts.pass===counts.tests&&counts.fail===0&&counts.skipped===0&&counts.cancelled===0&&counts.todo===0;
  checks.push({name,command:[process.execPath,...args],cwd,exitCode:result.status,error:result.error?.code??null,signal:result.signal,counts,logSha256:hash(log),ok});
  console.log(JSON.stringify({name,counts,ok}));
}
for(const name of ['c06','c05']){
  const command=pkg.scripts['test:'+name];assert(/^node (--experimental-test-module-mocks )?--test [a-zA-Z0-9./ -]+$/.test(command));
  run(name,['--test-reporter=tap','--test-concurrency=1',...command.split(' ').slice(1)],path.join(stage,'work-orders/v02-finish-cluster-v1'));
}
run('journal-regressions',['--test-reporter=tap','--test-concurrency=1','--test',...[
  'host-journal-bundle','host-journal-bundle-baseline','run-journal','run-journal-baseline','run-journal-store',
  'run-journal-store-baseline','fixed-run-journal-entry','fixed-run-journal-entry-baseline',
  'journal-restart-recovery-boundaries','journal-restart-recovery-baseline','bundle-restart-demo-baseline',
  'interrupted-run-decision-integration'].map(name=>'tests/'+name+'.test.mjs')]);
const canonicalUnchanged=Object.entries(canonicalHashes).every(([f,h])=>hash(fs.readFileSync(path.join(root,f)))===h);
const candidatesUnchanged=Object.entries(candidateHashes).every(([f,h])=>hash(fs.readFileSync(path.join(base,'candidate',f)))===h);
const stageUnchanged=Object.entries(stagedHashes).every(([f,h])=>hash(fs.readFileSync(path.join(stage,f)))===h);
const record={at:new Date().toISOString(),node:process.version,output,candidateHashes,canonicalHashes,stagedHashes,checks,canonicalUnchanged,candidatesUnchanged,stageUnchanged,
  implementationAccepted:false,nativeBuildAccepted:false,publicationAuthorized:false,inference:'NOT_RUN',ok:canonicalUnchanged&&candidatesUnchanged&&stageUnchanged&&checks.every(c=>c.ok)};
fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output,ok:record.ok,canonicalUnchanged,candidatesUnchanged,stageUnchanged}));if(!record.ok)process.exitCode=1;
