// Private owner-run verification. Fixed commands, reviewed sources, no inference.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const here=import.meta.dirname,root=path.resolve(here,'../..');
const proposed=['history/paired-arm-sidecar-codec-v1.mjs','history/paired-arm-sidecar-store-v1.mjs',
  'history/paired-arm-reconciliation-v1.mjs','hosts/repository/durable-paired-arm-owner-v1.mjs',
  'tests/paired-arm-sidecar-codec.test.mjs','tests/paired-arm-sidecar-store.test.mjs','tests/durable-paired-arm.test.mjs',
  'tests/paired-arm-process-death.test.mjs','tests/helpers/paired-arm-crash-child.mjs',
  'tests/helpers/repository-live-run-fixture.mjs'];
const focused=proposed.filter(x=>x.endsWith('.test.mjs'));
const regressions=['paired-arm-owner','paired-arm-owner-retention','paired-arm-owner-promise','paired-arm-owner-alias',
  'paired-arm-owner-lifecycle','paired-repository-projection-v2','paired-trial-event-store','paired-trial-reconciliation',
  'paired-trial-command-owner','paired-trial-command-signals','paired-trial-user-stop','paired-trial-process-death',
  'finish-cluster-inventory','finish-cluster-dispatch'].map(x=>'tests/'+x+'.test.mjs');
const hash=x=>createHash('sha256').update(x).digest('hex');
const closure=new Set();
function collect(relative){
  if(closure.has(relative))return;closure.add(relative);
  const text=fs.readFileSync(path.join(root,relative),'utf8');
  for(const m of text.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/gu)){
    const next=path.normalize(path.join(path.dirname(relative),m[1]));
    if(next.startsWith('..')||path.isAbsolute(next))throw Error('external import');collect(next);
  }
}
for(const file of [...proposed,...regressions])collect(file);
const pins=()=>Object.fromEntries([...closure].sort().map(f=>[f,hash(fs.readFileSync(path.join(root,f)))]));
const before=pins(),out=fs.mkdtempSync(path.join(here,'checks-'));
const save=(name,value)=>fs.writeFileSync(path.join(out,name),value,{flag:'wx',mode:0o600});
const env={PATH:'/usr/local/bin:/usr/bin:/bin',HOME:process.env.HOME,LANG:'C'};
function runTests(name,cwd,files){
  const command=[process.execPath,'--test','--test-reporter=tap','--test-concurrency=1',...files];
  const r=spawnSync(command[0],command.slice(1),{cwd,env,encoding:'utf8',timeout:90000,maxBuffer:6*1024*1024});
  save(name+'.stdout.log',r.stdout??'');save(name+'.stderr.log',r.stderr??'');
  const counts=Object.fromEntries(['tests','pass','fail','skipped','cancelled','todo'].map(k=>{
    const matches=[...(r.stdout??'').matchAll(new RegExp('^# '+k+' (\\d+)$','gm'))];
    return [k,matches.length===1?Number(matches[0][1]):null];
  }));
  return {command,cwd,exitCode:r.status,signal:r.signal,error:r.error?.message??null,counts,
    passed:r.status===0&&!r.error&&r.signal===null&&counts.tests>0&&counts.tests===counts.pass&&
      ['fail','skipped','cancelled','todo'].every(k=>counts[k]===0),
    assertionFailure:(r.stdout??'').includes('ERR_ASSERTION'),
    stdoutSha256:hash(r.stdout??''),stderrSha256:hash(r.stderr??'')};
}
const current=runTests('focused',root,focused),baseline=runTests('regressions',root,regressions);

// Only the new files are copied/mutated. All other imported code is a read-only
// symlink to this exact checkout. These are deliberate faults, not source fixes.
function mirror(name){
  const destination=path.join(out,name);fs.mkdirSync(destination,{mode:0o700});
  function tree(relative,depth){
    const src=path.join(root,relative),dest=path.join(destination,relative);fs.mkdirSync(dest,{recursive:true,mode:0o700});
    for(const item of fs.readdirSync(src,{withFileTypes:true})){
      const rel=path.join(relative,item.name),target=path.join(destination,rel);
      if(proposed.includes(rel))fs.copyFileSync(path.join(root,rel),target);
      else if(depth>0&&proposed.some(p=>p.startsWith(rel+'/')))tree(rel,depth-1);
      else fs.symlinkSync(path.join(root,rel),target);
    }
  }
  for(const dir of ['history','hosts','tests'])tree(dir,2);
  for(const dir of ['evaluation','workflow'])fs.symlinkSync(path.join(root,dir),path.join(destination,dir));
  return destination;
}
const specs=[
  ['producer-shape',proposed[0],'const x=exact(bounded(raw),producerShapes[schema]);','const x=bounded(raw);'],
  ['nullable-terminal',proposed[0],
    "check(RUN_OUTCOMES.includes(p.engineOutcome)&&RUN_OUTCOMES.includes(p.workflowOutcome));",
    "code(p.engineOutcome);code(p.workflowOutcome);"],
  ['header-intent-binding',proposed[2],'r.intentsSha256===armSidecarDigestV1(schedule.intents)','true'],
  ['approval-alias',proposed[3],'const approved=cloneFreeze(top.approval);','const approved=top.approval;'],
];
const mutations=[];
for(const [name,file,needle,replacement] of specs){
  const cwd=mirror('mutant-'+name),target=path.join(cwd,file),text=fs.readFileSync(target,'utf8');
  if(text.split(needle).length!==2)throw Error('mutation is not exactly one site: '+name);
  fs.writeFileSync(target,text.replace(needle,replacement));
  const run=runTests(name,cwd,focused);
  mutations.push({name,file,beforeSha256:hash(text),mutatedSha256:hash(fs.readFileSync(target)),...run,
    caught:run.exitCode===1&&run.counts.fail>0&&run.assertionFailure&&run.counts.cancelled===0&&run.counts.skipped===0&&run.counts.todo===0});
}
const control=runTests('control-after',mirror('control-after'),focused);
const candidate={files:proposed.map(file=>({path:file,content:fs.readFileSync(path.join(root,file),'utf8')}))};
const validation={task:{taskId:'paired-arm.durable-storage',mode:'edit',language:'javascript',allowedFiles:proposed,
  protectedFiles:[],protectedSnapshots:{},acceptanceCriteria:[
    'Validate scope and syntax of the private sidecar codec/store/reconciler/composition and deterministic tests; no inference, replay, publication or acceptance.'],
  policy:{repairBudget:0,totalDeadlineMs:60000,requiredReviewers:1,requireReportStore:false}},candidate};
save('nisi-input.json',JSON.stringify(validation,null,2)+'\n');
const nr=spawnSync('/Users/louiscalata/bin/initiate-online-code-mode',['--nisi','validate'],
  {cwd:root,env,encoding:'utf8',input:JSON.stringify(validation),timeout:20000,maxBuffer:2*1024*1024});
save('nisi.stdout.log',nr.stdout??'');save('nisi.stderr.log',nr.stderr??'');
let nv;try{nv=JSON.parse(nr.stdout);}catch{}
const nisi={exitCode:nr.status,signal:nr.signal,error:nr.error?.message??null,status:nv?.status??null,
  contract:nv?.checks?.contract?.status??null,syntax:nv?.checks?.syntax?.status??null,inputSha256:hash(JSON.stringify(validation))};
const after=pins(),unchanged=JSON.stringify(before)===JSON.stringify(after);
const passed=current.passed&&baseline.passed&&control.passed&&mutations.every(x=>x.caught)&&unchanged&&
  nisi.exitCode===0&&!nisi.error&&nisi.signal===null&&nisi.status==='VALIDATED'&&nisi.contract==='PASS'&&nisi.syntax==='PASS';
save('checks.json',JSON.stringify({scope:'PRIVATE_PAIRED_ARM_DURABLE_COMPONENT',node:process.version,
  before,after,unchanged,current,baseline,mutations,control,nisi,passed,
  inference:'NOT_RUN',nativeApp:'NOT_RUN',releaseAccepted:false,powerLossDurability:'NOT_TESTED'},null,2)+'\n');
console.log(JSON.stringify({out,passed,unchanged,inputs:closure.size,current:current.counts,baseline:baseline.counts,
  mutations:mutations.map(x=>({name:x.name,caught:x.caught,counts:x.counts})),control:control.counts,nisi}));
if(!passed)process.exitCode=1;
