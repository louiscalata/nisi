// Owner-only local verification. Does not dispatch inference or a new package rehearsal.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';

const base=path.dirname(fileURLToPath(import.meta.url));
const consumer='work-orders/v02-finish-cluster-v1/consumer/';
const names=['runtime-matrix-v1.mjs','runtime-matrix-v1.test.mjs','README.md'];
const files=[...names.map(n=>consumer+n),'scripts/private-package-contract.mjs','scripts/check-private-package.mjs',...fs.readdirSync(path.join(base,'candidate/tests/private-consumer')).sort().map(n=>'tests/private-consumer/'+n)];
const hash=b=>createHash('sha256').update(b).digest('hex');
const read=p=>{assert.equal(fs.lstatSync(p).isFile(),true,p);return fs.readFileSync(p);};
const pins=root=>Object.fromEntries(files.map(f=>[f,hash(read(path.join(root,f)))]));
const original=pins(path.join(base,'candidate'));
const output=fs.mkdtempSync(path.join(base,'reader-checks-'));
const save=(p,b)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,b,{flag:'wx',mode:0o600});};
const json=(p,o)=>save(p,JSON.stringify(o,null,2)+'\n');
json(path.join(output,'intent.json'),{startedAt:new Date().toISOString(),node:process.execPath,version:process.version,files:original,accepted:false});
for(const lane of ['after','before'])for(const f of files){
  const source=lane==='before'&&f!==consumer+'runtime-matrix-v1.test.mjs'?'before':'candidate';
  save(path.join(output,lane,f),read(path.join(base,source,f)));
}
const run=(name,exe,args,cwd,input)=>{
  const started=Date.now();
  const r=spawnSync(exe,args,{cwd,encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024,input,env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:process.env.HOME}});
  save(path.join(output,name+'.stdout.log'),r.stdout??'');save(path.join(output,name+'.stderr.log'),r.stderr??'');
  const counts={};for(const k of ['tests','pass','fail','cancelled','skipped','todo']){const m=(r.stdout??'').match(new RegExp('^# '+k+' (\\d+)$','m'));counts[k]=m?Number(m[1]):null;}
  return {command:[exe,...args],cwd,exitCode:r.status,signal:r.signal,error:r.error?.code??null,elapsedMs:Date.now()-started,counts,stdoutSha256:hash(r.stdout??''),stderrSha256:hash(r.stderr??'')};
};
const checks={};
for(const lane of ['before','after'])checks[lane]=run(lane,process.execPath,['--test','--test-reporter=tap',consumer+'runtime-matrix-v1.test.mjs'],path.join(output,lane));
const captureDir=path.join(base,'runtime-node24-TyjDOb');
const captureBytes=read(path.join(captureDir,'capture.json'));
const capture=JSON.parse(captureBytes);
assert.equal(hash(captureBytes),'38ce097e799806bea4ae87a9e9a9abae76cb191d16786a7444b5c07c59738888');
for(const [key,file] of [['retainedReceipt','receipt.json'],['retainedArchive','archive.tgz'],['retainedExpected','expected.json']]){
  const b=read(path.join(captureDir,file));assert.equal(hash(b),capture[key].sha256);assert.equal(b.length,capture[key].byteLength);
}
const expected=JSON.parse(read(path.join(captureDir,'expected.json')));
const mod=await import(pathToFileURL(path.join(output,'after',consumer+'runtime-matrix-v1.mjs')));
const matrix=mod.createRuntimeMatrix({rows:[{runtime:'node22',receipt:null,prerequisite:mod.NODE22_PREREQUISITE},{runtime:'node24',receipt:read(path.join(captureDir,'receipt.json')).toString('utf8')}],expected});
json(path.join(output,'retained-node24-matrix.json'),matrix);
assert.equal(matrix.status,'INCOMPLETE');assert.equal(matrix.rows.node24.status,'PASS');assert.equal(matrix.rows.node22.status,'NOT_RUN');
const candidate={files:names.filter(n=>n.endsWith('.mjs')).map(n=>({path:consumer+n,content:read(path.join(output,'after',consumer+n)).toString('utf8')}))};
const validation={task:{taskId:'c09.reader.local-validation',mode:'edit',language:'javascript',allowedFiles:candidate.files.map(f=>f.path),protectedFiles:[],protectedSnapshots:{},acceptanceCriteria:['Validate the exact private C09 reader and oracle syntax and candidate scope. Behavioral tests and independent source review are separate owner evidence; no acceptance or inference.'],policy:{repairBudget:0,totalDeadlineMs:60000,requiredReviewers:1,requireReportStore:false}},candidate};
json(path.join(output,'nisi-input.json'),validation);
checks.nisi=run('nisi','/Users/louiscalata/bin/initiate-online-code-mode',['--nisi','validate'],'/Users/louiscalata/nisi',JSON.stringify(validation));
const nisiResult=JSON.parse(read(path.join(output,'nisi.stdout.log')));
checks.nisi.validationStatus=nisiResult.status;
checks.nisi.contractStatus=nisiResult.checks?.contract?.status??null;
checks.nisi.syntaxStatus=nisiResult.checks?.syntax?.status??null;
const unchanged=JSON.stringify(original)===JSON.stringify(pins(path.join(base,'candidate')));
const result={schema:'nisi.c09.reader-owner-checks.v1',output,completedAt:new Date().toISOString(),files:original,sourceUnchanged:unchanged,checks,retainedCaptureSha256:hash(captureBytes),matrix:{status:matrix.status,node24:matrix.rows.node24.status,node22:matrix.rows.node22.status},accepted:false,actualNode22:'NOT_RUN',modelInference:'NOT_RUN'};
json(path.join(output,'checks.json'),result);
console.log(JSON.stringify(result));
if(!unchanged||checks.after.exitCode!==0||checks.after.counts.fail!==0||checks.after.counts.skipped!==0||checks.after.counts.cancelled!==0||checks.after.counts.todo!==0||checks.nisi.exitCode!==0||nisiResult.status!=='VALIDATED'||checks.nisi.contractStatus!=='PASS'||checks.nisi.syntaxStatus!=='PASS')process.exitCode=1;
