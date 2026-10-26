// Owner verification of integrated history controls and offline CLI packaging.
// No inference, native launch, global install, credentials or publication.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../../..');
const hash=b=>createHash('sha256').update(b).digest('hex');
const read=f=>JSON.parse(fs.readFileSync(path.join(root,f)));
const evidencePath='.packet-diagnostics/history-proxy-owner-20260920/integration/evidence.json';
const evidence=read(evidencePath),canonical=read(evidence.canonical);
const files=new Set([evidencePath,...Object.keys(evidence.bindings),...Object.keys(canonical.before),
  ...['check-cluster.mjs','check-c06.mjs','check-c07.mjs','cluster.json','dispatch-check.mjs'].map(f=>'work-orders/v02-finish-cluster-v1/'+f),
  ...['finish-cluster-inventory','finish-cluster-history','finish-cluster-c06','finish-cluster-c07','finish-cluster-dispatch'].map(f=>'tests/'+f+'.test.mjs'),
  'scripts/check-private-cli-package.mjs','scripts/private-cli-package-contract.mjs']);
const snapshot=()=>Object.fromEntries([...files].sort().map(f=>[f,hash(fs.readFileSync(path.join(root,f)))]));
const before=snapshot(),out=fs.mkdtempSync(path.join(here,'controls-'));
const save=(name,data)=>fs.writeFileSync(path.join(out,name),data,{flag:'wx',mode:0o600});
const checks=[];
function run(name,args,timeout=60000){
  const r=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',timeout,maxBuffer:8*1024*1024,
    env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:process.env.HOME,LANG:'C'}});
  save(name+'.stdout.log',r.stdout??'');save(name+'.stderr.log',r.stderr??'');
  const row={name,command:[process.execPath,...args],exitCode:r.status,signal:r.signal,error:r.error?.message??null,
    stdoutSha256:hash(r.stdout??''),stderrSha256:hash(r.stderr??''),ok:r.status===0&&r.signal===null&&!r.error};
  checks.push(row);return {r,row};
}
save('intent.json',JSON.stringify({before,node:process.execPath,version:process.version,inference:'NOT_RUN'},null,2)+'\n');
const inventory=run('inventory',['work-orders/v02-finish-cluster-v1/check-cluster.mjs']);
if(inventory.row.ok){
  const result=JSON.parse(inventory.r.stdout);
  inventory.row.ok=result.status==='PASS_PACKET_INVENTORY_ONLY'&&result.finishPacketPercent===70&&result.overallMilestonePercent===30
    &&result.nativeBuildAccepted===false&&result.dispatchApproved.length===0;
}
const tests=run('adverse-tests',['--test-reporter=tap','--test-concurrency=1','--test',
  'tests/finish-cluster-inventory.test.mjs','tests/finish-cluster-dispatch.test.mjs']);
tests.row.counts=Object.fromEntries(['tests','pass','fail','skipped','cancelled','todo'].map(k=>{
  const m=[...(tests.r.stdout??'').matchAll(new RegExp('^# '+k+' (\\d+)$','gm'))];return [k,m.length===1?Number(m[0][1]):null];
}));
const counts=tests.row.counts;
tests.row.ok&&=counts.tests>0&&counts.pass===counts.tests&&['fail','skipped','cancelled','todo'].every(k=>counts[k]===0);
const cli=run('offline-cli',['scripts/check-private-cli-package.mjs'],180000);
if(cli.row.ok){
  const summary=JSON.parse(cli.r.stdout),receipt=JSON.parse(fs.readFileSync(summary.receipt));
  cli.row.receipt={path:path.relative(root,summary.receipt),sha256:hash(fs.readFileSync(summary.receipt))};
  cli.row.checkCount=receipt.checks.length;
  cli.row.ok=summary.status==='PASS_SCOPED'&&summary.portable==='PASS_SCOPED'&&summary.native==='NOT_RUN'
    &&receipt.boundaries.modelInference===false&&receipt.boundaries.published===false&&receipt.boundaries.globalInstall===false
    &&receipt.boundaries.networkAllowed===false&&receipt.installed.unchangedAfterChecks===true;
  for(const transition of evidence.transitions)assert.equal(receipt.sourceManifest[transition.path],transition.newSha256);
}
const after=snapshot(),unchanged=JSON.stringify(before)===JSON.stringify(after);
const report={schema:'nisi.history-integration-controls/v1',node:{path:process.execPath,version:process.version,sha256:hash(fs.readFileSync(process.execPath))},
  before,after,unchanged,checks,ok:unchanged&&checks.every(row=>row.ok),implementationAccepted:false,
  nativeBuildAccepted:false,publicationAuthorized:false,inference:'NOT_RUN'};
save('checks.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({out,ok:report.ok,unchanged,checks},null,2));if(!report.ok)process.exitCode=1;
