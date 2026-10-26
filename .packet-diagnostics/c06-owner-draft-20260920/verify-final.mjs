import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const base=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(base,'../..'),sha=b=>createHash('sha256').update(b).digest('hex');
const output=fs.mkdtempSync(path.join(base,'final-'));
const sourceFiles=['history/host-journal-bundle.mjs','tests/host-journal-bundle.test.mjs',
  'work-orders/v02-finish-cluster-v1/restart/host-bundle-integration.test.mjs','work-orders/v02-finish-cluster-v1/restart/README.md',
  'work-orders/v02-finish-cluster-v1/check-c06.mjs','work-orders/v02-finish-cluster-v1/check-cluster.mjs',
  'work-orders/v02-finish-cluster-v1/cluster.json','tests/finish-cluster-c06.test.mjs','tests/finish-cluster-inventory.test.mjs',
  'tests/finish-cluster-dispatch.test.mjs','.packets/nisi-v02-c06-restart-integration-oracle.packet.md'];
const sourceHashes=Object.fromEntries(sourceFiles.map(f=>[f,sha(fs.readFileSync(path.join(root,f)))]));
const runs=[];
function run(name,args,expected){
  const r=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024});
  const log=(r.stdout??'')+(r.stderr??''),logPath=path.relative(root,path.join(output,name+'.log'));
  fs.writeFileSync(path.join(root,logPath),log,{flag:'wx'});
  const ok=r.status===expected&&!r.error&&!r.signal;runs.push({name,args,exitCode:r.status,error:r.error?.code??null,signal:r.signal,logPath,logSha256:sha(log),ok});
  assert(ok,log);return r;
}
const controls=run('owner-controls',['.packet-diagnostics/c06-owner-draft-20260920/verify-controls.mjs'],0);
const result=JSON.parse(controls.stdout.trim().split('\n').at(-1));assert.equal(result.ok,true);
const controlPath=path.relative(root,path.join(result.output,'checks.json'));
const inventory=JSON.parse(run('inventory',['work-orders/v02-finish-cluster-v1/check-cluster.mjs'],0).stdout);
assert.equal(inventory.implementationAccepted,6);assert.equal(inventory.finishPacketPercent,60);
assert.equal(inventory.overallMilestonePercent,30);assert.deepEqual(inventory.dispatchApproved,[]);
const dispatch=JSON.parse(run('dispatch',['work-orders/v02-finish-cluster-v1/dispatch-check.mjs','C06'],2).stderr);
assert.equal(dispatch.status,'HELD');assert.equal(dispatch.dispatchApproved,false);assert.equal(dispatch.publicationAuthorized,false);
const sourceUnchanged=Object.entries(sourceHashes).every(([f,d])=>sha(fs.readFileSync(path.join(root,f)))===d);
const record={schema:'nisi.c06.final-owner-checkpoint.v1',at:new Date().toISOString(),sourceHashes,sourceUnchanged,runs,
  controls:{path:controlPath,sha256:sha(fs.readFileSync(path.join(root,controlPath)))},inventory,dispatch,
  implementationAccepted:false,nativeBuildAccepted:false,publicationAuthorized:false,inference:'NOT_RUN',ok:sourceUnchanged};
fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output,ok:record.ok,controls:record.controls,finishPacketPercent:inventory.finishPacketPercent,overallMilestonePercent:inventory.overallMilestonePercent}));
if(!record.ok)process.exitCode=1;
