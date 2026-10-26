// Each control/fault has the same reviewed, bounded test scope and fixed argv.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const here=import.meta.dirname,root=path.resolve(here,'../..'),hash=b=>createHash('sha256').update(b).digest('hex');
const source=['hosts/repository/reviewed-paired-arm-bootstrap-v1.mjs','hosts/repository/reviewed-live-model-v4.mjs',
  'hosts/repository/paired-trial-projection-v2.mjs','tests/reviewed-paired-arm-bootstrap-v1.test.mjs',
  'tests/paired-arm-bootstrap-constructor-fault.test.mjs','tests/helpers/paired-arm-bootstrap-constructor-child.mjs',
  'tests/helpers/paired-arm-bootstrap-construction-child.mjs','tests/helpers/paired-arm-bootstrap-fixture.mjs'];
const pins=()=>Object.fromEntries(source.map(file=>[file,hash(fs.readFileSync(path.join(root,file)))]));
const before=pins(),out=fs.mkdtempSync(path.join(here,'mutations-')),results=[];
const closure=[...Object.keys(JSON.parse(fs.readFileSync(path.join(here,'checks-vyhV0W/checks.json'))).before),
  'examples/repository-task/oracle-only/check-retry-semantics.mjs'];
const specs={
  rollback:['hosts/repository/reviewed-live-model-v4.mjs',"if (!confirmed) fail('LIVE_CONSTRUCTOR_ROLLBACK_UNCONFIRMED');",'/* hide rollback uncertainty */',1],
  construction:['hosts/repository/reviewed-paired-arm-bootstrap-v1.mjs','constructionCleanupUnconfirmed=true;throw error;','throw error;',1],
  revocation:['hosts/repository/reviewed-paired-arm-bootstrap-v1.mjs','lane.revoke();snapshot=readIssuedLiveModelLaneV4(lane).snapshot;',
    'snapshot=readIssuedLiveModelLaneV4(lane).snapshot;',1],
  environment:['hosts/repository/reviewed-paired-arm-bootstrap-v1.mjs',"fail('ARM_BOOTSTRAP_ENVIRONMENT');",'/* ignore environment mismatch */;',2],
};
for(const fault of ['control-before','rollback','construction','revocation','environment','control-after']){
  const control=fault.startsWith('control-'),env={PATH:'/usr/local/bin:/usr/bin:/bin',HOME:process.env.HOME,LANG:'C'};
  // Keep faults on owned disposable copies so child environments need not
  // accept NODE_OPTIONS. Every helper URL remains relative to the same copy.
  const mirror=path.join(out,fault);fs.mkdirSync(mirror,{mode:0o700});
  for(const file of closure){
    if(path.isAbsolute(file)||file.startsWith('..'))throw Error('UNSAFE_COPY_PATH');
    const target=path.join(mirror,file);fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.copyFileSync(path.join(root,file),target,fs.constants.COPYFILE_EXCL);
  }
  if(!control){
    const [file,from,to,count]=specs[fault],target=path.join(mirror,file),bytes=fs.readFileSync(target,'utf8');
    if(bytes.split(from).length!==count+1)throw Error('FAULT_SITE_COUNT_CHANGED');
    fs.writeFileSync(target,bytes.replaceAll(from,to));
  }
  const command=[process.execPath,'--test','--test-reporter=tap','--test-concurrency=1',
    'tests/reviewed-paired-arm-bootstrap-v1.test.mjs','tests/paired-arm-bootstrap-constructor-fault.test.mjs'];
  const run=spawnSync(command[0],command.slice(1),{cwd:mirror,env,encoding:'utf8',timeout:15000,killSignal:'SIGKILL',maxBuffer:4*1024*1024});
  const counts=Object.fromEntries(['tests','pass','fail','skipped','cancelled','todo'].map(k=>{
    const values=[...(run.stdout??'').matchAll(new RegExp('^# '+k+' (\\d+)$','gm'))];return [k,values.length===1?Number(values[0][1]):null];
  }));
  for(const stream of ['stdout','stderr'])fs.writeFileSync(path.join(out,fault+'.'+stream+'.log'),run[stream]??'',{flag:'wx',mode:0o600});
  const detected=!run.error&&!run.signal&&counts.tests===38&&['skipped','cancelled','todo'].every(k=>counts[k]===0)&&
    (control?run.status===0&&counts.fail===0&&counts.pass===38:run.status===1&&counts.fail>0);
  results.push({fault,command,exitCode:run.status,signal:run.signal,error:run.error?.message??null,counts,detected,
    stdoutSha256:hash(run.stdout??''),stderrSha256:hash(run.stderr??'')});
}
const after=pins(),unchanged=JSON.stringify(before)===JSON.stringify(after),passed=unchanged&&results.every(row=>row.detected);
const receipt={scope:'PRIVATE_BOOTSTRAP_FOUR_FAULTS',node:process.version,before,after,unchanged,results,passed,
  models:'NOT_RUN',native:'NOT_RUN',releaseAccepted:false};
fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({out,passed,unchanged,results:results.map(({fault,counts,detected,error})=>({fault,counts,detected,error}))}));
if(!passed)process.exitCode=1;
