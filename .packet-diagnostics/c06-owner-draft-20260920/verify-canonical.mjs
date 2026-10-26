// Owner-inspected canonical verification; no inference, dispatch, or acceptance.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const base=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(base,'../..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceFiles=['history/host-journal-bundle.mjs','work-orders/v02-finish-cluster-v1/restart/host-bundle-integration.test.mjs',
  'tests/host-journal-bundle.test.mjs','work-orders/v02-finish-cluster-v1/restart/README.md'];
const sourceHashes=Object.fromEntries(sourceFiles.map(file=>[file,hash(fs.readFileSync(path.join(root,file)))]));
for(const file of sourceFiles)assert.equal(sourceHashes[file],hash(fs.readFileSync(path.join(base,'candidate',file))),'candidate differs: '+file);
const prior=JSON.parse(fs.readFileSync(path.join(base,'checks-AMHMeM/checks.json')));
for(const [file,digest] of Object.entries(prior.candidateHashes))assert.equal(sourceHashes[file],digest,'reviewed source differs');
const cluster=JSON.parse(fs.readFileSync(path.join(root,'work-orders/v02-finish-cluster-v1/cluster.json')));
assert.equal(cluster.packets[4].implementationAccepted,true,'C05 prerequisite');
const c05=cluster.packets[4].ownerAcceptance;
const c05Evidence=JSON.parse(fs.readFileSync(path.join(root,c05.evidence)));
const c05Checkpoint=JSON.parse(fs.readFileSync(path.join(root,c05Evidence.checkpoint.path)));
const packagePath='work-orders/v02-finish-cluster-v1/package.json';
const pkg=JSON.parse(fs.readFileSync(path.join(root,packagePath)));
const journalTests=['host-journal-bundle','host-journal-bundle-baseline','run-journal','run-journal-baseline','run-journal-store',
  'run-journal-store-baseline','fixed-run-journal-entry','fixed-run-journal-entry-baseline',
  'journal-restart-recovery-boundaries','journal-restart-recovery-baseline','bundle-restart-demo-baseline',
  'interrupted-run-decision-integration'].map(name=>'tests/'+name+'.test.mjs');
const c06Tests=pkg.scripts['test:c06'].split(' ').slice(2).map(file=>path.relative(root,path.resolve(root,'work-orders/v02-finish-cluster-v1',file)));
// Literal imports are closed recursively. Child entry points and data fixtures
// used by nonliteral read paths are explicitly named rather than inferred away.
const queue=[...Object.keys(c05Checkpoint.sourceHashes),...sourceFiles,...journalTests,...c06Tests,
  packagePath,'package.json','package-lock.json','tests/fixtures/bundle-restart-demo-cli.mjs',
  'tests/fixtures/journal-restart-recovery-cli.mjs','tests/helpers/memfs.mjs'];
for(const name of fs.readdirSync(path.join(root,'tests/fixtures/fixed-run')))queue.push('tests/fixtures/fixed-run/'+name);
const closure=new Map();
while(queue.length){
  const file=queue.pop();if(closure.has(file))continue;
  assert(!path.isAbsolute(file)&&!file.split('/').includes('..')&&!file.includes('\\'),'contained dependency');
  const filename=path.join(root,file),stat=fs.lstatSync(filename);assert(stat.isFile()&&!stat.isSymbolicLink(),'regular dependency: '+file);
  const bytes=fs.readFileSync(filename);closure.set(file,hash(bytes));
  if(!/\.[cm]?js$/.test(file))continue;
  const text=bytes.toString('utf8');
  for(const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"\n]+)['"]/g)){
    if(match[1].startsWith('.'))queue.push(path.relative(root,path.resolve(path.dirname(filename),match[1])));
  }
  for(const match of text.matchAll(/new URL\(['"]([^'"\n]+)['"],\s*import\.meta\.url\)/g)){
    const resolved=path.resolve(path.dirname(filename),match[1]);
    if(fs.existsSync(resolved)&&fs.statSync(resolved).isFile())queue.push(path.relative(root,resolved));
  }
}
const dependencyHashes=Object.fromEntries([...closure].filter(([file])=>!sourceFiles.includes(file)).sort(([a],[b])=>a.localeCompare(b)));
for(const [file,digest] of Object.entries(dependencyHashes))assert.equal(prior.stagedHashes[file],digest,'dependency differs from inspected checkpoint: '+file);
const output=fs.mkdtempSync(path.join(base,'canonical-'));
const checks=[];
function run(name,args,relativeCwd,expectedCount){
  const result=spawnSync(process.execPath,args,{cwd:path.join(root,relativeCwd),encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024});
  const log=(result.stdout??'')+(result.stderr??'');const logPath=path.relative(root,path.join(output,name+'.log'));
  fs.writeFileSync(path.join(root,logPath),log,{flag:'wx'});
  const counts=Object.fromEntries(['tests','pass','fail','skipped','cancelled','todo'].map(key=>[key,Number(log.match(new RegExp('^# '+key+' (\\d+)$','m'))?.[1]??-1)]));
  const ok=result.status===0&&!result.error&&!result.signal&&counts.tests===expectedCount&&counts.pass===expectedCount&&counts.fail===0&&counts.skipped===0&&counts.cancelled===0&&counts.todo===0;
  checks.push({name,command:[process.execPath,...args],relativeCwd,exitCode:result.status,error:result.error?.code??null,signal:result.signal,counts,logPath,logSha256:hash(log),ok});
  console.log(JSON.stringify({name,counts,ok}));
}
for(const [name,count] of [['c06',52],['c05',111]]){
  const command=pkg.scripts['test:'+name];assert(/^node (--experimental-test-module-mocks )?--test [a-zA-Z0-9./ -]+$/.test(command));
  run(name,['--test-reporter=tap','--test-concurrency=1',...command.split(' ').slice(1)],'work-orders/v02-finish-cluster-v1',count);
}
run('journal-regressions',['--test-reporter=tap','--test-concurrency=1','--test',...journalTests],'.',80);
const sourceUnchanged=Object.entries(sourceHashes).every(([file,digest])=>hash(fs.readFileSync(path.join(root,file)))===digest);
const dependenciesUnchanged=Object.entries(dependencyHashes).every(([file,digest])=>hash(fs.readFileSync(path.join(root,file)))===digest);
const record={schema:'nisi.c06.canonical-checks.v1',at:new Date().toISOString(),node:process.version,sourceHashes,dependencyHashes,
  prerequisite:{id:'C05',evidence:c05.evidence,evidenceSha256:c05.evidenceSha256,sourceHashes:c05.sourceHashes},
  checks,sourceUnchanged,dependenciesUnchanged,implementationAccepted:false,openCodeExecuted:false,nativeBuildAccepted:false,
  publicationAuthorized:false,sourceAuthenticityAttested:false,resumeGranted:false,inference:'NOT_RUN',
  ok:sourceUnchanged&&dependenciesUnchanged&&checks.every(c=>c.ok)};
fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output,ok:record.ok,dependencyCount:Object.keys(dependencyHashes).length}));
if(!record.ok)process.exitCode=1;
