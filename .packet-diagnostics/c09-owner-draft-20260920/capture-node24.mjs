// Owner-only, separately bounded Node24 staged-package rehearsal. Never dispatch a model.
// The existing writer packs only its owned staged tree and installs offline there.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {PRIVATE_PACKAGE_FILES,createPrivatePackageMetadata} from '../../scripts/private-package-contract.mjs';

const base=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(base,'../..');
const node='/usr/local/bin/node',script='scripts/check-private-package.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function bytes(file){const stat=fs.lstatSync(file);assert(stat.isFile()&&!stat.isSymbolicLink(),file);return fs.readFileSync(file);}
function identity(file,container=null){
  const before=fs.lstatSync(file);assert(before.isFile()&&!before.isSymbolicLink(),file);
  const resolved=fs.realpathSync(file);
  if(container!==null)assert(resolved.startsWith(fs.realpathSync(container)+path.sep),'contained identity '+file);
  const content=bytes(file),after=fs.lstatSync(file);
  assert.equal(after.dev,before.dev);assert.equal(after.ino,before.ino);assert.equal(after.mode,before.mode);assert.equal(after.size,before.size);
  assert.equal(fs.realpathSync(file),resolved);
  return {path:file,resolved,sha256:sha(content),byteLength:content.length,device:after.dev,inode:after.ino,mode:after.mode};
}
assert.equal(process.execPath,node);assert.equal(process.version,'v24.18.0');
const nodeBefore=identity(node),writerBefore=identity(path.join(root,script));
assert.equal(writerBefore.sha256,'bf342e5e1b1c75bc89d8481ea0e20ca1641a23a60ff426b3ec10974a75806c69');
const caseNames=fs.readdirSync(path.join(root,'tests/private-consumer')).sort();assert.equal(caseNames.length,12);
const sourceManifest=Object.fromEntries(PRIVATE_PACKAGE_FILES.map(file=>[file,sha(bytes(path.join(root,file)))]));
const stageManifest={...sourceManifest,'package.json':sha(JSON.stringify(createPrivatePackageMetadata(JSON.parse(bytes(path.join(root,'package.json')))),null,2)+'\n')};
const caseManifest=Object.fromEntries(caseNames.map(file=>[file,sha(bytes(path.join(root,'tests/private-consumer',file)))]));
const negativeLocations=[];
for(const file of caseNames.filter(f=>f.endsWith('.mts'))){
  bytes(path.join(root,'tests/private-consumer',file)).toString('utf8').split('\n').forEach((line,i)=>{
    if(line.includes('@ts-expect-error'))negativeLocations.push({file:'negative-'+file,line:i+2});
  });
}
assert.equal(negativeLocations.length,73);
const compilerPath=path.join(root,'node_modules/typescript/bin/tsc'),typeRoot=path.join(root,'node_modules/@types');
const toolchain={compilerPath,compilerEntrySha256:sha(bytes(compilerPath)),typescript:JSON.parse(bytes(path.join(root,'node_modules/typescript/package.json'))).version,
  nodeTypes:JSON.parse(bytes(path.join(typeRoot,'node/package.json'))).version,lockSha256:sha(bytes(path.join(root,'package-lock.json'))),typeRoots:[typeRoot]};
const output=fs.mkdtempSync(path.join(base,'runtime-node24-'));
function save(name,value){
  assert.equal(path.basename(name),name);const file=path.join(output,name),content=Buffer.isBuffer(value)?value:Buffer.from(value,'utf8');
  let fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600),written;
  try{fs.writeFileSync(fd,content);fs.fsyncSync(fd);written=fs.fstatSync(fd);assert(written.isFile());assert.equal(written.size,content.length);}finally{fs.closeSync(fd);}
  fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{const read=fs.fstatSync(fd);assert(read.isFile());assert.equal(read.dev,written.dev);assert.equal(read.ino,written.ino);assert.equal(read.size,content.length);assert.equal(sha(fs.readFileSync(fd)),sha(content));}finally{fs.closeSync(fd);}
  fd=fs.openSync(output,fs.constants.O_RDONLY);
  try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  return {path:file,sha256:sha(content),byteLength:content.length};
}
const saveJSON=(name,value)=>save(name,JSON.stringify(value,null,2)+'\n');
const prepared={schema:'nisi.c09.owner-capture-intent.v1',node:nodeBefore,version:process.version,writer:writerBefore,sourceManifest,stageManifest,caseManifest,toolchain,negativeLocations,
  command:[node,script],cwd:root,timeoutMs:180000,maxOutputBytes:1048576,network:false,models:false,nativeApp:false,publication:false};
saveJSON('intent.json',prepared);
const startedAt=new Date().toISOString();
let stdout=Buffer.alloc(0),stderr=Buffer.alloc(0),spawnError=null,overflow=false,timedOut=false,pid=null,spawnObservedAt=null,killAttempt=null,settlementTimer=null;
const child=spawn(node,[script],{cwd:root,env:{PATH:'/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',HOME:process.env.HOME,LANG:'en_US.UTF-8',LC_ALL:'en_US.UTF-8'},stdio:['ignore','pipe','pipe']});
let settle;
const closing=new Promise(resolve=>{settle=resolve;child.on('close',(exitCode,signal)=>resolve({exitCode,signal,closeConfirmed:true}));});
function terminate(reason){
  if(killAttempt)return;
  killAttempt={reason,at:new Date().toISOString(),sent:false,error:null};
  try{killAttempt.sent=child.kill('SIGKILL');}catch(error){killAttempt.error={name:error.name,code:error.code??null};}
  settlementTimer=setTimeout(()=>{child.stdout.destroy();child.stderr.destroy();child.unref();settle({exitCode:null,signal:null,closeConfirmed:false});},5000);
}
child.on('spawn',()=>{pid=child.pid;spawnObservedAt=new Date().toISOString();});
child.on('error',error=>{spawnError={name:error.name,code:error.code??null};});
function receive(kind,chunk){
  const next=(kind==='stdout'?stdout.length:stderr.length)+chunk.length;
  if(next>1048576){overflow=true;terminate('OUTPUT_LIMIT');return;}
  if(kind==='stdout')stdout=Buffer.concat([stdout,chunk]);else stderr=Buffer.concat([stderr,chunk]);
}
child.stdout.on('data',chunk=>receive('stdout',chunk));child.stderr.on('data',chunk=>receive('stderr',chunk));
const timer=setTimeout(()=>{timedOut=true;terminate('DEADLINE');},180000);
const closed=await closing;
clearTimeout(timer);if(settlementTimer)clearTimeout(settlementTimer);const closedAt=new Date().toISOString();
save('stdout.log',stdout);save('stderr.log',stderr);
const capture={schema:'nisi.c09.owner-runtime-capture.v1',startedAt,spawnObservedAt,closedAt,pid,...closed,spawnError,timedOut,overflow,killAttempt,
  command:prepared.command,cwd:root,stdoutSha256:sha(stdout),stderrSha256:sha(stderr),nodeBefore,writerBefore,
  status:'INCOMPLETE',descendantDrain:'NOT_ATTESTED',ownerInterventionRequired:!closed.closeConfirmed,
  accepted:false,executionAttested:false,sourceAuthenticityAttested:false,publicationAuthorized:false,modelInference:'NOT_RUN',nativeAppExecution:'NOT_RUN'};
try{
  assert.equal(closed.closeConfirmed,true);assert.equal(spawnError,null);assert.equal(timedOut,false);assert.equal(overflow,false);assert.equal(closed.signal,null);assert.equal(closed.exitCode,0);assert(Number.isInteger(pid)&&pid>0);
  const summary=JSON.parse(stdout.toString('utf8'));
  assert.equal(summary.status,'PASS_SCOPED');
  const evidence=summary.evidence,relative=path.relative(path.join(root,'.build'),evidence);
  assert(!relative.includes(path.sep)&&/^private-package-[A-Za-z0-9]+$/.test(relative));
  assert.equal(fs.realpathSync(evidence),evidence);
  const receiptPath=path.join(evidence,'receipt.json'),receiptBefore=identity(receiptPath,evidence),receiptBytes=bytes(receiptPath),record=JSON.parse(receiptBytes);
  assert.equal(sha(receiptBytes),receiptBefore.sha256);assert.deepEqual(identity(receiptPath,evidence),receiptBefore);
  assert.equal(record.status,'PASS_SCOPED');assert.equal(record.evidence,evidence);assert.equal(record.root,root);
  assert.deepEqual(record.node,{version:process.version,path:node,sha256:nodeBefore.sha256});
  assert.deepEqual(record.sourceManifest,sourceManifest);assert.deepEqual(record.stageManifest,stageManifest);assert.deepEqual(record.caseManifest,caseManifest);assert.deepEqual(record.toolchain,toolchain);
  assert(startedAt<=spawnObservedAt&&spawnObservedAt<=record.observedAt&&record.observedAt<=record.completedAt&&record.completedAt<=closedAt);
  assert.equal(record.checks.length,35);
  const archivePath=path.join(evidence,'nisi-0.2.0-private.0.tgz');assert.equal(record.archive.path,archivePath);
  const archiveBefore=identity(archivePath,evidence),archiveBytes=bytes(archivePath),archiveAfter=identity(archivePath,evidence);
  assert.deepEqual(archiveAfter,archiveBefore);assert.equal(sha(archiveBytes),archiveBefore.sha256);assert.equal(record.archive.sha256,archiveBefore.sha256);assert.equal(record.archive.byteLength,archiveBefore.byteLength);
  const nodeAfter=identity(node),writerAfter=identity(path.join(root,script));assert.deepEqual(nodeAfter,nodeBefore);assert.deepEqual(writerAfter,writerBefore);
  for(const[file,digest]of Object.entries(sourceManifest))assert.equal(sha(bytes(path.join(root,file))),digest);
  for(const[file,digest]of Object.entries(caseManifest))assert.equal(sha(bytes(path.join(root,'tests/private-consumer',file))),digest);
  const receiptAfter=identity(receiptPath,evidence);assert.deepEqual(receiptAfter,receiptBefore);assert.equal(sha(bytes(receiptPath)),sha(receiptBytes));
  const retainedReceipt=save('receipt.json',receiptBytes),retainedArchive=save('archive.tgz',archiveBytes);
  const observation={receiptSha256:sha(receiptBytes),receiptByteLength:receiptBytes.length,node:record.node,archive:{sha256:archiveBefore.sha256,byteLength:archiveBefore.byteLength}};
  const expected={sourceManifest,stageManifest,caseManifest,toolchain,negativeLocations,notBefore:startedAt,notAfter:closedAt,observations:{node22:null,node24:observation}};
  const retainedExpected=saveJSON('expected.json',expected);
  assert.deepEqual(identity(archivePath,evidence),archiveBefore);assert.deepEqual(identity(receiptPath,evidence),receiptBefore);
  Object.assign(capture,{status:'COLLECTED_NODE24_ONLY',receiptBefore,receiptAfter,retainedReceipt,retainedArchive,retainedExpected,
    archiveBefore,archiveAfter,nodeAfter,writerAfter,expectedSha256:retainedExpected.sha256,node22:'NOT_RUN'});
}catch(error){capture.status='FAILED_CAPTURE';capture.failure={name:error.name,code:error.code??null,message:error.message};process.exitCode=1;}
let finalArtifact=null,finalStatus=capture.status;
try{finalArtifact=saveJSON('capture.json',capture);if(capture.status==='COLLECTED_NODE24_ONLY')finalStatus='CAPTURED_NODE24_ONLY';}
catch(error){finalStatus='COMMIT_UNCERTAIN';process.exitCode=1;capture.failure={name:error.name,code:error.code??null,message:'Final evidence retention not confirmed; no retry authorized.'};}
console.log(JSON.stringify({output,status:finalStatus,finalArtifact,exitCode:closed.exitCode,signal:closed.signal,closeConfirmed:closed.closeConfirmed,node22:'NOT_RUN',accepted:false,failure:capture.failure??null}));
