import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const here=import.meta.dirname,root=path.resolve(here,'../..'),loader=path.join(here,'mutation-loader.mjs');
const verified=JSON.parse(fs.readFileSync(path.join(here,'checks-CfudCS/checks.json'),'utf8'));
const hash=x=>createHash('sha256').update(x).digest('hex');
function pin(){for(const [file,digest] of Object.entries(verified.after))if(hash(fs.readFileSync(path.join(root,file)))!==digest)throw Error('SOURCE_DRIFT '+file);}
pin();const out=fs.mkdtempSync(path.join(here,'mutations-')),results=[];
const tests=['tests/paired-arm-cli.test.mjs','tests/paired-arm-command-owner.test.mjs'];
for(const name of ['projection','observation','setupStop','cleanup','control-after']){
  const fault=name!=='control-after';
  const args=[...(fault?['--import',loader]:[]),'--test','--test-reporter=tap','--test-concurrency=1',...tests];
  const r=spawnSync(process.execPath,args,{cwd:root,env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:process.env.HOME,LANG:'C',
    ...(fault?{NISI_OPERATOR_TEST_FAULT:name}:{})},encoding:'utf8',timeout:30000,killSignal:'SIGKILL',maxBuffer:2*1024*1024});
  const counts=Object.fromEntries(['tests','pass','fail','skipped','cancelled','todo'].map(key=>{
    const matches=[...(r.stdout??'').matchAll(new RegExp('^# '+key+' (\\d+)$','gm'))];return [key,matches.length===1?Number(matches[0][1]):null];
  }));
  fs.writeFileSync(path.join(out,name+'.stdout.log'),r.stdout??'',{flag:'wx',mode:0o600});
  fs.writeFileSync(path.join(out,name+'.stderr.log'),r.stderr??'',{flag:'wx',mode:0o600});
  const complete=!r.error&&r.signal===null&&counts.tests===32&&['skipped','cancelled','todo'].every(k=>counts[k]===0);
  const passed=complete&&(fault?r.status===1&&counts.fail>0&&(r.stdout??'').includes('ERR_ASSERTION'):r.status===0&&counts.pass===32);
  results.push({name,command:[process.execPath,...args],exitCode:r.status,signal:r.signal,error:r.error?.code??null,
    counts,passed,stdoutSha256:hash(r.stdout??''),stderrSha256:hash(r.stderr??'')});
}
pin();const passed=results.every(x=>x.passed);
fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify({scope:'TEST_ONLY_IN_MEMORY_FAULTS',node:process.version,
  loaderSha256:hash(fs.readFileSync(loader)),sourceReceiptSha256:hash(fs.readFileSync(path.join(here,'checks-CfudCS/checks.json'))),
  sourceUnchanged:true,results,passed},null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({out,passed,results:results.map(x=>({name:x.name,counts:x.counts,passed:x.passed}))}));
if(!passed)process.exitCode=1;
