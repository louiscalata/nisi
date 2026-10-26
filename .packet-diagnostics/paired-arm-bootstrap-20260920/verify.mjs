// Private fixed verification; no inference, native build, package publication,
// global installation or credential access. Owned diagnostic outputs only.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const here=import.meta.dirname,root=path.resolve(here,'../..');
const source=['hosts/repository/reviewed-paired-arm-bootstrap-v1.mjs','hosts/repository/reviewed-live-model-v4.mjs',
  'hosts/repository/paired-trial-projection-v2.mjs','tests/reviewed-paired-arm-bootstrap-v1.test.mjs',
  'tests/paired-arm-bootstrap-preflight.test.mjs','tests/paired-arm-bootstrap-constructor-fault.test.mjs',
  'tests/helpers/paired-arm-bootstrap-fixture.mjs','tests/helpers/paired-arm-bootstrap-construction-child.mjs',
  'tests/helpers/paired-arm-bootstrap-constructor-child.mjs'];
const tests=['reviewed-paired-arm-bootstrap-v1','paired-arm-bootstrap-preflight','paired-arm-bootstrap-constructor-fault',
  'live-model-v4','live-model-v4-call','live-model-v4-receipt','repair-guidance','native-chat','local-chat',
  'paired-arm-command-owner','paired-arm-command-signals','paired-arm-cli','private-cli-package-contract',
  'nisi-cli','nisi-cli-entry','paired-trial-cli','paired-trial-diagnostic-cli','paired-arm-sidecar-codec',
  'paired-arm-sidecar-store','durable-paired-arm','paired-arm-process-death','paired-arm-owner','paired-arm-owner-retention',
  'paired-arm-owner-promise','paired-arm-owner-alias','paired-arm-owner-lifecycle','paired-repository-projection-v2',
  'paired-trial-event-store','paired-trial-reconciliation','paired-trial-command-owner','paired-trial-command-signals',
  'paired-trial-user-stop','paired-trial-process-death','finish-cluster-inventory','finish-cluster-dispatch'].map(x=>'tests/'+x+'.test.mjs');
const hash=x=>createHash('sha256').update(x).digest('hex'),closure=new Set();
function collect(file){
  if(closure.has(file))return;
  if(file.startsWith('..')||path.isAbsolute(file))throw Error('EXTERNAL_SOURCE');
  closure.add(file);const bytes=fs.readFileSync(path.join(root,file),'utf8');
  for(const match of bytes.matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+)['"]/gu))
    collect(path.normalize(path.join(path.dirname(file),match[1])));
}
for(const file of [...source,...tests,'.packet-diagnostics/paired-arm-bootstrap-20260920/verify.mjs'])collect(file);
// Retain the previous command/sidecar closure plus fixture assets, but hash
// current bytes rather than replaying prior test results against changed code.
const previous=JSON.parse(fs.readFileSync(path.join(root,'.packet-diagnostics/paired-arm-operator-20260920/checks-CfudCS/checks.json')));
for(const file of Object.keys(previous.before))collect(file);
for(const dir of ['examples/repository-task/fixtures','examples/repository-task/oracle-only']){
  if(!fs.existsSync(path.join(root,dir)))continue;
  function assets(current){for(const e of fs.readdirSync(path.join(root,current),{withFileTypes:true})){
    const file=path.join(current,e.name);if(e.isDirectory())assets(file);else if(e.isFile())closure.add(file);else throw Error('FIXTURE_NONREGULAR');
  }}assets(dir);
}
const pins=()=>Object.fromEntries([...closure].sort().map(file=>[file,hash(fs.readFileSync(path.join(root,file)))]));
const before=pins(),out=fs.mkdtempSync(path.join(here,'checks-'));
const save=(name,value)=>fs.writeFileSync(path.join(out,name),value,{flag:'wx',mode:0o600});
const env={PATH:'/usr/local/bin:/usr/bin:/bin',HOME:process.env.HOME,LANG:'C'};
const command=[process.execPath,'--test','--test-reporter=tap','--test-concurrency=1',...tests];
const run=spawnSync(command[0],command.slice(1),{cwd:root,env,encoding:'utf8',timeout:120000,killSignal:'SIGKILL',maxBuffer:8*1024*1024});
save('tests.stdout.log',run.stdout??'');save('tests.stderr.log',run.stderr??'');
const counts=Object.fromEntries(['tests','pass','fail','skipped','cancelled','todo'].map(k=>{
  const matches=[...(run.stdout??'').matchAll(new RegExp('^# '+k+' (\\d+)$','gm'))];return [k,matches.length===1?Number(matches[0][1]):null];
}));
const task={taskId:'paired-arm.bootstrap',mode:'edit',language:'javascript',allowedFiles:source,protectedFiles:[],protectedSnapshots:{},
  acceptanceCriteria:['Validate exact private fixed-fixture owner-bootstrap and test scope and syntax. No provider inference, native build or behavioral-test mode.'],
  policy:{repairBudget:0,totalDeadlineMs:60000,requiredReviewers:1,requireReportStore:false}};
const input={task,candidate:{files:source.map(file=>({path:file,content:fs.readFileSync(path.join(root,file),'utf8')}))}};
save('nisi-input.json',JSON.stringify(input,null,2)+'\n');
const nr=spawnSync('/Users/louiscalata/bin/initiate-online-code-mode',['--nisi','validate'],{cwd:root,env,
  input:JSON.stringify(input),encoding:'utf8',timeout:30000,killSignal:'SIGKILL',maxBuffer:2*1024*1024});
save('nisi.stdout.log',nr.stdout??'');save('nisi.stderr.log',nr.stderr??'');let nv;try{nv=JSON.parse(nr.stdout);}catch{}
const inventory=spawnSync(process.execPath,['work-orders/v02-finish-cluster-v1/check-cluster.mjs'],{cwd:root,env,encoding:'utf8',timeout:10000,maxBuffer:1024*1024});
save('inventory.stdout.log',inventory.stdout??'');save('inventory.stderr.log',inventory.stderr??'');
const after=pins(),unchanged=JSON.stringify(before)===JSON.stringify(after);
const passed=run.status===0&&!run.error&&!run.signal&&counts.tests>0&&counts.tests===counts.pass&&
  ['fail','skipped','cancelled','todo'].every(k=>counts[k]===0)&&unchanged&&nr.status===0&&!nr.error&&!nr.signal&&
  nv?.status==='VALIDATED'&&nv?.checks.contract.status==='PASS'&&nv?.checks.syntax.status==='PASS'&&inventory.status===0;
const receipt={scope:'PRIVATE_FIXED_FIXTURE_PAIRED_ARM_BOOTSTRAP',node:process.version,command,source,before,after,unchanged,
  tests:{exitCode:run.status,signal:run.signal,error:run.error?.message??null,counts,stdoutSha256:hash(run.stdout??''),stderrSha256:hash(run.stderr??'')},
  nisi:{status:nv?.status??null,contract:nv?.checks.contract.status??null,syntax:nv?.checks.syntax.status??null,exitCode:nr.status,
    inputSha256:hash(JSON.stringify(input)),stdoutSha256:hash(nr.stdout??''),stderrSha256:hash(nr.stderr??'')},
  inventory:{exitCode:inventory.status,stdoutSha256:hash(inventory.stdout??'')},passed,
  constructionTest:'FOUR_FRESH_SETS_WITHOUT_EXECUTION',syntheticRun:'FIRST_ARM_ONLY_THEN_UNKNOWN_BUDGET_STOP',
  native:'NOT_RUN',inference:'NOT_RUN',shellExecutionCommand:'NOT_IMPLEMENTED',releaseAccepted:false};
save('checks.json',JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({out,passed,inputs:closure.size,tests:receipt.tests,nisi:receipt.nisi,inventory:receipt.inventory}));
if(!passed)process.exitCode=1;
