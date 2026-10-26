// Private staged-archive rehearsal. No publication, network installs or native/model execution.
// Trusted static checkout only: hash checks are drift detection, not hostile-writer isolation.
import fs from 'node:fs'; import path from 'node:path'; import assert from 'node:assert/strict';
import {createHash} from 'node:crypto'; import {spawnSync} from 'node:child_process'; import {fileURLToPath} from 'node:url';
import {createPrivatePackageMetadata, PRIVATE_PACKAGE_FILES, PRIVATE_RUNTIME_FILES, PRIVATE_TYPE_FILES} from './private-package-contract.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
fs.mkdirSync(path.join(root,'.build'),{recursive:true});
const evidence=fs.mkdtempSync(path.join(root,'.build/private-package-'));
const stage=path.join(evidence,'stage'),consumer=path.join(evidence,'consumer');
fs.mkdirSync(stage);fs.mkdirSync(consumer);
const sha=b=>createHash('sha256').update(b).digest('hex');
const hash=p=>sha(fs.readFileSync(p));
const record={schema:'nisi-private-package-rehearsal-v1',status:'INCOMPLETE',observedAt:new Date().toISOString(),root,evidence,node:{version:process.version,path:process.execPath,sha256:hash(process.execPath)},checks:[],sourceManifest:{},stageManifest:{},caseManifest:{},
  boundaries:{stagedArchiveOnly:true,canonicalRootPackSupported:false,networkAllowed:false,lifecycleScriptsAllowed:false,modelInference:false,nativeExecution:false,published:false,fullMerger:false,hostileWriterIsolation:false}};
const cleanEnv={PATH:process.env.PATH,HOME:process.env.HOME,LANG:'en_US.UTF-8',LC_ALL:'en_US.UTF-8',NISI_INSTALLED_ARCHIVE_CHECK:'1'};
// Explicit CLI flags below override package-manager scripts/network settings.
function run(name,exe,args,cwd=consumer,expected=0){
  const start=performance.now(),r=spawnSync(exe,args,{cwd,env:cleanEnv,encoding:'utf8',timeout:30000,maxBuffer:8388608});
  const check={name,exe,args,cwd,elapsedMs:Math.ceil(performance.now()-start),exitCode:r.status,signal:r.signal,error:r.error?.code??null,stdout:r.stdout,stderr:r.stderr};
  record.checks.push(check);assert.equal(r.signal,null,name);assert.equal(r.error,undefined,name);assert.equal(r.status,expected,name+' '+r.stderr.slice(-800));return r.stdout;
}
function plainFile(p){const s=fs.lstatSync(p);assert(s.isFile()&&!s.isSymbolicLink(),p);return fs.readFileSync(p);}
function walk(directory,prefix=''){
  return fs.readdirSync(directory,{withFileTypes:true}).flatMap(d=>{
    const f=prefix+d.name,p=path.join(directory,d.name);assert(!d.isSymbolicLink(),p);
    return d.isDirectory()?walk(p,f+'/'):[f];
  }).sort();
}
try {
  const source=JSON.parse(plainFile(path.join(root,'package.json')));
  const staged=createPrivatePackageMetadata(source);
  for(const f of PRIVATE_PACKAGE_FILES){
    const bytes=plainFile(path.join(root,f));record.sourceManifest[f]=sha(bytes);
    const target=path.join(stage,f);fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.writeFileSync(target,f==='package.json'?JSON.stringify(staged,null,2)+'\n':bytes,{flag:'wx'});
    record.stageManifest[f]=hash(target);
  }
  assert.deepEqual(walk(stage),PRIVATE_PACKAGE_FILES);
  const npmArgs=['--offline','--ignore-scripts','--no-audit','--no-fund','--cache',path.join(evidence,'npm-cache')];
  const pack=JSON.parse(run('pack exact staged tree','npm',['pack',...npmArgs,'--json','--pack-destination',evidence],stage));
  assert.equal(pack.length,1);assert.equal(pack[0].filename,'nisi-0.2.0-private.0.tgz');
  assert.deepEqual(pack[0].files.map(f=>f.path).sort(),PRIVATE_PACKAGE_FILES);
  const archive=path.join(evidence,pack[0].filename);
  record.archive={path:archive,sha256:hash(archive),byteLength:fs.statSync(archive).size,entries:{}};
  const names=run('actual archive inventory','tar',['-tzf',archive]).trim().split('\n').sort();
  assert.deepEqual(names,PRIVATE_PACKAGE_FILES.map(f=>'package/'+f));
  for(const f of PRIVATE_PACKAGE_FILES){
    const bytes=run('archive bytes '+f,'tar',['-xOf',archive,'package/'+f]);
    assert.equal(sha(bytes),record.stageManifest[f],f);record.archive.entries[f]=sha(bytes);
  }
  for(const[f,h]of Object.entries(record.sourceManifest))assert.equal(hash(path.join(root,f)),h,'source drift '+f);
  for(const[f,h]of Object.entries(record.stageManifest))assert.equal(hash(path.join(stage,f)),h,'stage drift '+f);
  fs.writeFileSync(path.join(consumer,'package.json'),JSON.stringify({name:'nisi-private-consumer-check',version:'0.0.0',private:true,type:'module'})+'\n',{flag:'wx'});
  assert.equal(hash(archive),record.archive.sha256);
  run('offline script-disabled archive install','npm',['install',archive,...npmArgs,'--package-lock=false'],consumer);
  assert.equal(hash(archive),record.archive.sha256);
  const installed=path.join(consumer,'node_modules/nisi');assert(!fs.lstatSync(installed).isSymbolicLink());
  assert.deepEqual(walk(installed),PRIVATE_PACKAGE_FILES);
  for(const[f,h]of Object.entries(record.archive.entries))assert.equal(hash(path.join(installed,f)),h,'installed '+f);
  record.installed={path:installed,exactArchiveMatch:true};
  const fixtures=path.join(root,'tests/private-consumer');
  const cases=fs.readdirSync(fixtures).sort();assert.equal(cases.length,7);
  for(const f of cases){const b=plainFile(path.join(fixtures,f));record.caseManifest[f]=sha(b);fs.writeFileSync(path.join(consumer,f),b,{flag:'wx'});}
  const compiler=path.join(root,'node_modules/typescript/bin/tsc'),typeRoot=path.join(root,'node_modules/@types');
  record.toolchain={compilerPath:compiler,compilerEntrySha256:hash(compiler),typescript:JSON.parse(fs.readFileSync(path.join(root,'node_modules/typescript/package.json'))).version,
    nodeTypes:JSON.parse(fs.readFileSync(path.join(typeRoot,'node/package.json'))).version,lockSha256:hash(path.join(root,'package-lock.json')),typeRoots:[typeRoot]};
  const flags=['--noEmit','--ignoreConfig','--strict','--exactOptionalPropertyTypes','--noUncheckedIndexedAccess','--module','NodeNext','--target','ES2022','--types','node','--typeRoots',typeRoot];
  const typeCases=cases.filter(f=>f.endsWith('.mts'));assert.equal(typeCases.length,5);
  run('five installed-package TypeScript consumers',process.execPath,[compiler,...flags,...typeCases]);
  const expected=[];
  for(const f of typeCases){
    const lines=fs.readFileSync(path.join(consumer,f),'utf8').split('\n');
    const name='negative-'+f;
    lines.forEach((line,i)=>{if(line.includes('@ts-expect-error')){expected.push({file:name,line:i+2});lines[i]=line.replace('@ts-expect-error','expected diagnostic marker removed');}});
    fs.writeFileSync(path.join(consumer,name),lines.join('\n'),{flag:'wx'});
  }
  assert.equal(expected.length,29);
  const diagnostics=run('negative controls without suppression must fail',process.execPath,[compiler,...flags,...typeCases.map(f=>'negative-'+f)],consumer,2);
  const observed=[...diagnostics.matchAll(/(negative-[^\s(]+\.mts)\((\d+),\d+\): error TS\d+:/g)].map(m=>({file:m[1],line:Number(m[2])}));
  for(const item of expected)assert(observed.some(o=>o.file===item.file&&o.line===item.line),'missing diagnostic '+JSON.stringify(item));
  record.negativeControls={expected:expected.length,observed:observed.length,allExpectedLocationsDetected:true};
  const tap=run('seven fixed installed runtime checks',process.execPath,['--test','--test-reporter=tap',...cases.filter(f=>f.endsWith('.test.mjs'))]);
  for(const[k,v]of Object.entries({tests:7,pass:7,fail:0,cancelled:0,skipped:0,todo:0}))assert(new RegExp('^# '+k+' '+v+'$','m').test(tap),k);
  for(const[f,h]of Object.entries(record.sourceManifest))assert.equal(hash(path.join(root,f)),h,'final source '+f);
  for(const[f,h]of Object.entries(record.archive.entries))assert.equal(hash(path.join(installed,f)),h,'final installed '+f);
  for(const[f,h]of Object.entries(record.caseManifest)){assert.equal(hash(path.join(fixtures,f)),h);assert.equal(hash(path.join(consumer,f)),h);}
  assert.equal(hash(archive),record.archive.sha256);record.status='PASS_SCOPED';
} catch(error) {
  record.status='FAIL';record.failure={name:error.name,message:error.message,code:error.code??null};process.exitCode=1;
} finally {
  record.completedAt=new Date().toISOString();
  fs.writeFileSync(path.join(evidence,'receipt.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({status:record.status,evidence,archive:record.archive?{path:record.archive.path,sha256:record.archive.sha256}:null,negativeControls:record.negativeControls??null,failure:record.failure??null}));
}
