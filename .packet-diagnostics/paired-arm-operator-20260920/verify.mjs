// Fixed owner verification. Reviewed Node-only code, private temp evidence,
// no model inference, native build, publication or global installation.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const here=import.meta.dirname,root=path.resolve(here,'../..');
const source=['cli/paired-arm-command-owner.mjs','cli/paired-arm-inspect.mjs','cli/arguments.mjs','cli/main.mjs','cli/text.mjs',
  'tests/paired-arm-command-owner.test.mjs','tests/paired-arm-command-signals.test.mjs','tests/helpers/paired-arm-command-child.mjs',
  'tests/paired-arm-cli.test.mjs','tests/helpers/nisi-cli-no-effects.mjs','scripts/private-cli-package-contract.mjs',
  'scripts/check-private-cli-package.mjs','tests/private-cli-package-contract.test.mjs'];
const tests=[...source.filter(x=>x.endsWith('.test.mjs')),...['nisi-cli','nisi-cli-entry','paired-trial-cli',
  'paired-trial-diagnostic-cli','paired-arm-sidecar-codec','paired-arm-sidecar-store','durable-paired-arm','paired-arm-process-death',
  'paired-arm-owner','paired-arm-owner-retention','paired-arm-owner-promise','paired-arm-owner-alias','paired-arm-owner-lifecycle',
  'paired-repository-projection-v2','paired-trial-event-store','paired-trial-reconciliation','paired-trial-command-owner',
  'paired-trial-command-signals','paired-trial-user-stop','paired-trial-process-death','finish-cluster-inventory','finish-cluster-dispatch']
  .map(x=>'tests/'+x+'.test.mjs')];
const hash=x=>createHash('sha256').update(x).digest('hex'),closure=new Set();
function collect(relative){
  if(closure.has(relative))return;closure.add(relative);
  const content=fs.readFileSync(path.join(root,relative),'utf8');
  for(const m of content.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/gu)){
    const next=path.normalize(path.join(path.dirname(relative),m[1]));
    if(next.startsWith('..')||path.isAbsolute(next))throw Error('EXTERNAL_RELATIVE_IMPORT');collect(next);
  }
}
for(const p of [...source,...tests])collect(p);
const packagePath='.build/private-cli-package-b8cCay/receipt.json';
const packageBytes=fs.readFileSync(path.join(root,packagePath)),pack=JSON.parse(packageBytes);
if(path.resolve(pack.root)!==root||pack.status!=='PASS_SCOPED'||pack.native.status!=='NOT_RUN'||!pack.installed.unchangedAfterChecks)throw Error('PACKAGE_NOT_ACCEPTED');
for(const [file,digest] of Object.entries({...pack.sourceManifest,...pack.verificationInputs})){
  if(hash(fs.readFileSync(path.join(root,file)))!==digest)throw Error('PACKAGE_INPUT_DRIFT '+file);closure.add(file);
}
if(hash(fs.readFileSync(pack.archive.path))!==pack.archive.sha256)throw Error('ARCHIVE_DRIFT');
for(const [file,item] of Object.entries(pack.installed.before)){
  const full=path.join(pack.installed.path,file);
  if(hash(fs.readFileSync(full))!==item.sha256||(fs.statSync(full).mode&0o777)!==item.mode)throw Error('INSTALL_DRIFT '+file);
}
const pins=()=>Object.fromEntries([...closure].sort().map(f=>[f,hash(fs.readFileSync(path.join(root,f)))]));
const before=pins(),out=fs.mkdtempSync(path.join(here,'checks-'));
const save=(name,value)=>fs.writeFileSync(path.join(out,name),value,{flag:'wx',mode:0o600});
save('package-receipt.json',packageBytes);
const command=[process.execPath,'--test','--test-reporter=tap','--test-concurrency=1',...tests];
const env={PATH:'/usr/local/bin:/usr/bin:/bin',HOME:process.env.HOME,LANG:'C'};
const result=spawnSync(command[0],command.slice(1),{cwd:root,env,encoding:'utf8',timeout:90000,killSignal:'SIGKILL',maxBuffer:8*1024*1024});
save('tests.stdout.log',result.stdout??'');save('tests.stderr.log',result.stderr??'');
const counts=Object.fromEntries(['tests','pass','fail','skipped','cancelled','todo'].map(k=>{
  const matches=[...(result.stdout??'').matchAll(new RegExp('^# '+k+' (\\d+)$','gm'))];
  return [k,matches.length===1?Number(matches[0][1]):null];
}));
const task={taskId:'paired-arm.operator-cli',mode:'edit',language:'javascript',allowedFiles:source,protectedFiles:[],protectedSnapshots:{},
  acceptanceCriteria:['Validate exact source/test scope and JavaScript syntax for private paired-arm operator lifecycle, read-only CLI and package checks; no inference or behavioral-test mode.'],
  policy:{repairBudget:0,totalDeadlineMs:60000,requiredReviewers:1,requireReportStore:false}};
const input={task,candidate:{files:source.map(p=>({path:p,content:fs.readFileSync(path.join(root,p),'utf8')}))}};
save('nisi-input.json',JSON.stringify(input,null,2)+'\n');
const nr=spawnSync('/Users/louiscalata/bin/initiate-online-code-mode',['--nisi','validate'],
  {cwd:root,env,encoding:'utf8',input:JSON.stringify(input),timeout:30000,killSignal:'SIGKILL',maxBuffer:2*1024*1024});
save('nisi.stdout.log',nr.stdout??'');save('nisi.stderr.log',nr.stderr??'');
let nv;try{nv=JSON.parse(nr.stdout);}catch{}
const after=pins(),unchanged=JSON.stringify(before)===JSON.stringify(after);
const passed=result.status===0&&!result.error&&result.signal===null&&counts.tests>0&&counts.tests===counts.pass&&
  ['fail','skipped','cancelled','todo'].every(k=>counts[k]===0)&&unchanged&&nr.status===0&&!nr.error&&nr.signal===null&&
  nv?.status==='VALIDATED'&&nv?.checks.contract.status==='PASS'&&nv?.checks.syntax.status==='PASS';
const receipt={scope:'PRIVATE_PAIRED_ARM_OPERATOR_CLI',node:process.version,command,source,before,after,unchanged,
  tests:{exitCode:result.status,signal:result.signal,error:result.error?.message??null,counts,
    stdoutSha256:hash(result.stdout??''),stderrSha256:hash(result.stderr??'')},
  package:{receiptSource:packagePath,receiptSha256:hash(packageBytes),entries:Object.keys(pack.stageManifest).length,
    checks:pack.checks.length,status:pack.status,archiveSha256:pack.archive.sha256,currentArchiveAndInstalledMatch:true},
  nisi:{status:nv?.status??null,contract:nv?.checks.contract.status??null,syntax:nv?.checks.syntax.status??null,
    exitCode:nr.status,signal:nr.signal,error:nr.error?.message??null,inputSha256:hash(JSON.stringify(input))},
  passed,inference:'NOT_RUN',nativeApp:'NOT_RUN',releaseAccepted:false};
save('checks.json',JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({out,passed,unchanged,inputs:closure.size,tests:receipt.tests,nisi:receipt.nisi,package:receipt.package}));
if(!passed)process.exitCode=1;
