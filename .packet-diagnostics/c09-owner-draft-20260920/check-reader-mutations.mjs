// Owner-reviewed synthetic reader checks, in fresh owned copies only.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const base=path.dirname(fileURLToPath(import.meta.url));
const checkpoint=path.join(base,'reader-checks-amBB0S');
const proof=JSON.parse(fs.readFileSync(path.join(checkpoint,'checks.json'),'utf8'));
const module='work-orders/v02-finish-cluster-v1/consumer/runtime-matrix-v1.mjs';
const oracle='work-orders/v02-finish-cluster-v1/consumer/runtime-matrix-v1.test.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
const source=fs.readFileSync(path.join(checkpoint,'after',module),'utf8');
const mutations=[
  ['receipt-proof-hash','proof.receiptSha256!==receiptSha256||',''],
  ['case-freshness',",['caseManifest','CASES_STALE']",''],
  ['ordered-command-argv','||!sameKeys(c.args,plan.args)',''],
  ['extraction-hash','if(sha(record.checks[i+2].stdout)!==record.stageManifest[file])','if(false)'],
  ['proxy-first','&&nodeTypes.isProxy(v)','&&false'],
  ['manifest-accessor',"if(!x.enumerable||!Object.hasOwn(x,'value'))refuse(code,name+' accessor');",'if(false){};'],
  ['extra-diagnostic-file',"const DIAGNOSTIC=/^([^\\r\\n(]+)\\((\\d+),\\d+\\): error TS\\d+:/gmu;","const DIAGNOSTIC=/(negative-[^\\s(]+\\.mts)\\((\\d+),\\d+\\): error TS\\d+:/gu;"],
  ['tap-counter-uniqueness','if(ms.length!==1)return null;','if(ms.length<1)return null;'],
];
const output=fs.mkdtempSync(path.join(base,'reader-mutations-'));
const save=(f,s)=>{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,s,{flag:'wx',mode:0o600});};
const rows=[];
for(const [name,from,to] of [['control-before',null,null],...mutations,['control-after',null,null]]){
  const root=path.join(output,name);
  for(const [file,digest] of Object.entries(proof.files)){
    const bytes=fs.readFileSync(path.join(checkpoint,'after',file));assert.equal(hash(bytes),digest);
    let value=bytes;
    if(file===module&&from!==null){assert.equal(source.split(from).length,2,'exact one mutation '+name);value=source.replace(from,to);}
    save(path.join(root,file),value);
  }
  const r=spawnSync(process.execPath,['--test','--test-reporter=tap',oracle],{cwd:root,timeout:10000,maxBuffer:8*1024*1024,encoding:'utf8',env:{PATH:'/usr/local/bin:/usr/bin:/bin'}});
  save(path.join(root,'stdout.log'),r.stdout??'');save(path.join(root,'stderr.log'),r.stderr??'');
  const counts={};for(const k of ['tests','pass','fail','skipped','cancelled','todo'])counts[k]=Number((r.stdout??'').match(new RegExp('^# '+k+' (\\d+)$','m'))?.[1]??NaN);
  const assertionFailures=[...(r.stdout??'').matchAll(/code: '(?:ERR_ASSERTION|ERR_ASSERTION_FAILURE)'/g)].length;
  rows.push({name,exitCode:r.status,signal:r.signal,error:r.error?.code??null,counts,assertionFailures,moduleSha256:hash(fs.readFileSync(path.join(root,module))),stdoutSha256:hash(r.stdout??''),stderrSha256:hash(r.stderr??'')});
}
const unchanged=Object.entries(proof.files).every(([f,h])=>hash(fs.readFileSync(path.join(base,'candidate',f)))===h);
const good=row=>row.error===null&&row.signal===null&&row.counts.tests===153&&row.counts.skipped===0&&row.counts.cancelled===0&&row.counts.todo===0;
const valid=unchanged&&rows.every(row=>good(row)&&(row.name.startsWith('control-')?row.exitCode===0&&row.counts.fail===0:row.exitCode===1&&row.counts.fail>0&&row.assertionFailures>0));
const result={schema:'nisi.c09.reader-mutations.v1',output,source:proof.files,sourceUnchanged:unchanged,status:valid?'PASS_SCOPED':'FAIL',rows,accepted:false,scope:'SYNTHETIC_READER_GUARD_REGRESSIONS_ONLY',node22:'NOT_RUN'};
save(path.join(output,'checks.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));if(!valid)process.exitCode=1;
