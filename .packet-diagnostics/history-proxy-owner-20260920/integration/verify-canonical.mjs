import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const sha = b => createHash('sha256').update(b).digest('hex');
const sourceFiles = ['history/journal-owner-v2.mjs','history/run-journal-v1.mjs','tests/journal-proxy-boundaries.test.mjs',
  'tests/journal-owner-v2-store.test.mjs','tests/journal-owner-v2-baseline.test.mjs'];
const files = new Set([...sourceFiles, 'history/run-journal-store-v1.mjs', 'tests/journal-owner-v2.memfs.mjs']);
for (const name of ['c06','c07']) {
  const evidence = JSON.parse(fs.readFileSync(path.join(root, `.packet-diagnostics/${name}-owner-draft-20260920/final-evidence.json`)));
  for (const file of [...Object.keys(evidence.sourceHashes), ...Object.keys(evidence.dependencyHashes)]) files.add(file);
}
const historyTests = ['journal-maintenance-v1','journal-owner-v2','run-journal','run-journal-store',
  'journal-proxy-boundaries','journal-owner-v2-store','journal-owner-v2-baseline'].map(s => `tests/${s}.test.mjs`);
const hostTests = ['repository-host-history','repository-trial-diagnostic-store','repository-history-cli'].map(s => `tests/${s}.test.mjs`);
for (const file of [...historyTests, ...hostTests]) files.add(file);
const snapshot = () => Object.fromEntries([...files].sort().map(file => {
  const p=path.join(root,file), st=fs.lstatSync(p);assert(st.isFile()&&!st.isSymbolicLink());
  return [file,sha(fs.readFileSync(p))];
}));
const before=snapshot(), output=fs.mkdtempSync(path.join(here,'canonical-'));
const save=(file,data)=>fs.writeFileSync(path.join(output,file), data,{flag:'wx',mode:0o600});
save('intent.json',JSON.stringify({schema:'nisi.history-hardening-intent/v1',before,startedAt:new Date().toISOString(),
  node:process.execPath,version:process.version,modelInference:'NOT_RUN',nativeBuildAccepted:false,publicationAuthorized:false},null,2)+'\n');
const checks=[];
function run(name,args,cwd){
  const r=spawnSync(process.execPath,args,{cwd,encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024,
    env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:process.env.HOME,LANG:'C'}});
  save(name+'.stdout.log',r.stdout??'');save(name+'.stderr.log',r.stderr??'');
  const counts=Object.fromEntries(['tests','pass','fail','skipped','cancelled','todo'].map(k=>{
    const m=[...(r.stdout??'').matchAll(new RegExp('^# '+k+' (\\d+)$','gm'))];return [k,m.length===1?Number(m[0][1]):null];
  }));
  const ok=r.status===0&&r.signal===null&&!r.error&&counts.tests>0&&counts.tests===counts.pass
    &&['fail','skipped','cancelled','todo'].every(k=>counts[k]===0);
  checks.push({name,command:[process.execPath,...args],relativeCwd:path.relative(root,cwd)||'.',exitCode:r.status,
    signal:r.signal,error:r.error?.message??null,counts,ok,stdoutSha256:sha(r.stdout??''),stderrSha256:sha(r.stderr??'')});
}
run('history',['--test-reporter=tap','--test-concurrency=1','--test',...historyTests],root);
run('host-history',['--test-reporter=tap','--test-concurrency=1','--test',...hostTests],root);
const clusterCwd=path.join(root,'work-orders/v02-finish-cluster-v1');
const scripts=JSON.parse(fs.readFileSync(path.join(clusterCwd,'package.json'))).scripts;
for(const name of ['c05','c06','c07']){
  const command=scripts['test:'+name].split(' ');assert.equal(command.shift(),'node');
  assert(command.every(s=>/^[a-zA-Z0-9./_=-]+$/.test(s)));
  run(name,['--test-reporter=tap','--test-concurrency=1',...command],clusterCwd);
}
const after=snapshot(),unchanged=JSON.stringify(before)===JSON.stringify(after),ok=unchanged&&checks.every(c=>c.ok);
const report={schema:'nisi.history-hardening-canonical/v1',scope:'NODE_HISTORY_PROXY_BOUNDARIES',checkedAt:new Date().toISOString(),
  root,node:{path:process.execPath,version:process.version,sha256:sha(fs.readFileSync(process.execPath))},before,after,unchanged,
  sourceHashes:Object.fromEntries(sourceFiles.map(f=>[f,before[f]])),checks,ok,
  implementationAccepted:false,nativeBuildAccepted:false,publicationAuthorized:false,inference:'NOT_RUN'};
save('checks.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,ok,unchanged,checks},null,2));if(!ok)process.exitCode=1;
