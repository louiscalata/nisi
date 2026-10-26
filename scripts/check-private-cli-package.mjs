// PRIVATE exact archive rehearsal. No global install, network, publication or
// model inference. --native adds only the inspected fixed Swift/Node fixture.
// Static operator-owned filesystem only; hashes do not isolate hostile writers.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPrivateCliPackageMetadata, PRIVATE_CLI_PACKAGE_FILES } from './private-cli-package-contract.mjs';
import { storedSummaryFixture } from '../tests/helpers/stored-summary-fixture.mjs';
import { pairedTrialFixtureEvents, pairedTrialFixtureInputs } from '../tests/helpers/paired-trial-fixture.mjs';
import { encodeTrialEventV1 } from '../history/paired-trial-event-codec-v1.mjs';
import { createPairedTrialRunnerV1 } from '../evaluation/paired-trial-runner-v1.mjs';
import { armSidecarDigestV1, encodeArmSidecarRecordV1 } from '../history/paired-arm-sidecar-codec-v1.mjs';
assert(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--native'),'Only --native is supported');
const native=process.argv[2]==='--native',root=fileURLToPath(new URL('../',import.meta.url));
if(native)assert(process.platform==='darwin'&&process.arch==='arm64','Native acceptance requires an Apple Silicon Mac');
fs.mkdirSync(path.join(root,'.build'),{recursive:true});
const evidence=fs.mkdtempSync(path.join(root,'.build/private-cli-package-'));
const stage=path.join(evidence,'stage'),consumer=path.join(evidence,'consumer'),home=path.join(evidence,'home');
for(const dir of [stage,consumer,home])fs.mkdirSync(dir,{mode:0o700});
const userConfig=path.join(home,'user.npmrc'),globalConfig=path.join(home,'global.npmrc');
for(const file of [userConfig,globalConfig])fs.writeFileSync(file,'',{flag:'wx',mode:0o600});
const hashBytes=b=>createHash('sha256').update(b).digest('hex'),hash=p=>hashBytes(fs.readFileSync(p));
const record={schema:'nisi-private-cli-package-rehearsal/v1',status:'INCOMPLETE',root,evidence,observedAt:new Date().toISOString(),
  node:{path:process.execPath,version:process.version,sha256:hash(process.execPath)},checks:[],sourceManifest:{},stageManifest:{},
  boundaries:{privateOnly:true,networkAllowed:false,lifecycleScriptsAllowed:false,globalInstall:false,published:false,
    modelInference:false,nativeRequested:native,hostileWriterIsolation:false,arbitraryCandidateExecution:false,fullMerger:false}};
record.verificationInputs=Object.fromEntries(['scripts/check-private-cli-package.mjs', 'scripts/private-cli-package-contract.mjs',
  'tests/helpers/stored-summary-fixture.mjs', 'tests/helpers/paired-trial-fixture.mjs', 'evaluation/paired-trial-runner-v1.mjs',
  'tests/helpers/nisi-cli-no-effects.mjs', 'tests/helpers/nisi-cli-no-heavy-loader.mjs',
  'history/paired-arm-sidecar-codec-v1.mjs', 'hosts/repository/execution-admission-v1.mjs',
  'evaluation/intake-v1.mjs', 'workflow/contracts.mjs'].map(file=>[file,hash(path.join(root,file))]));
const env={PATH:process.env.PATH,HOME:home,LANG:'en_US.UTF-8',LC_ALL:'en_US.UTF-8',
  NPM_CONFIG_USERCONFIG:userConfig,NPM_CONFIG_GLOBALCONFIG:globalConfig,NISI_CLI_TEST_ALLOW_DEMO:'1'};
function run(name,exe,args,{cwd=consumer,expected=0,timeout=30000,childEnv=env}={}) {
  const start=performance.now(),r=spawnSync(exe,args,{cwd,env:childEnv,timeout,maxBuffer:8388608,killSignal:'SIGKILL'});
  const stdout=r.stdout??Buffer.alloc(0),stderr=r.stderr??Buffer.alloc(0);
  record.checks.push({name,exe,args,cwd,exitCode:r.status,signal:r.signal,error:r.error?.code??null,
    elapsedMs:Math.ceil(performance.now()-start),stdoutBytes:stdout.length,stdoutSha256:hashBytes(stdout),
    stderr:stderr.toString('utf8').slice(-4000)});
  assert.equal(r.signal,null,name);assert.equal(r.error,undefined,name);
  assert.equal(r.status,expected,name+' '+stderr.toString('utf8').slice(-800));return stdout;
}
function plainFile(base,relative) {
  let current=base;const pieces=relative.split('/');assert(!path.isAbsolute(relative)&&!pieces.includes('..'));
  for(const [index,piece]of pieces.entries()) {
    current=path.join(current,piece);const s=fs.lstatSync(current);
    assert(!s.isSymbolicLink(),current);assert(index===pieces.length-1?s.isFile():s.isDirectory(),current);
  }return fs.readFileSync(current);
}
function walk(directory,prefix='') {
  assert(!fs.lstatSync(directory).isSymbolicLink());
  return fs.readdirSync(directory,{withFileTypes:true}).flatMap(d=>{
    assert(!d.isSymbolicLink(),path.join(directory,d.name));
    if(d.isDirectory())return walk(path.join(directory,d.name),prefix+d.name+'/');
    assert(d.isFile());return [prefix+d.name];
  }).sort();
}
function snapshot(directory) {
  return Object.fromEntries(walk(directory).map(f=>[f,{sha256:hash(path.join(directory,f)),
    mode:fs.statSync(path.join(directory,f)).mode&0o777}]));
}
function writeFile(base,relative,bytes,mode=0o600) {
  const target=path.join(base,relative);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
  fs.writeFileSync(target,bytes,{flag:'wx',mode});
}
try {
  const metadata=createPrivateCliPackageMetadata(JSON.parse(plainFile(root,'package.json')));
  for(const file of PRIVATE_CLI_PACKAGE_FILES) {
    const bytes=plainFile(root,file);record.sourceManifest[file]=hashBytes(bytes);
    writeFile(stage,file,file==='package.json'?JSON.stringify(metadata,null,2)+'\n':bytes,file==='bin/nisi.mjs'?0o755:0o600);
    record.stageManifest[file]=hash(path.join(stage,file));
  }
  assert.deepEqual(walk(stage),PRIVATE_CLI_PACKAGE_FILES);
  const flags=['--offline','--ignore-scripts','--no-audit','--no-fund','--cache',path.join(evidence,'npm-cache')];
  record.npmVersion=run('npm version','npm',['--version']).toString().trim();
  const pack=JSON.parse(run('pack private CLI','npm',['pack',...flags,'--json','--pack-destination',evidence],{cwd:stage}));
  assert.equal(pack.length,1);assert.equal(pack[0].filename,'nisi-private-cli-0.2.0-private.0.tgz');
  assert.deepEqual(pack[0].files.map(f=>f.path).sort(),PRIVATE_CLI_PACKAGE_FILES);
  const archive=path.join(evidence,pack[0].filename);
  record.archive={path:archive,sha256:hash(archive),entries:{}};
  const names=run('actual tar archive inventory','tar',['-tzf',archive]).toString().trim().split('\n').sort();
  assert.deepEqual(names,PRIVATE_CLI_PACKAGE_FILES.map(f=>'package/'+f));
  for(const file of PRIVATE_CLI_PACKAGE_FILES) {
    const bytes=run('actual archive bytes '+file,'tar',['-xOf',archive,'package/'+file]);
    assert.equal(hashBytes(bytes),record.stageManifest[file],file);record.archive.entries[file]=hashBytes(bytes);
  }
  writeFile(consumer,'package.json',JSON.stringify({name:'nisi-cli-offline-consumer',version:'0.0.0',private:true,type:'module'})+'\n');
  run('offline script-disabled private install','npm',['install',archive,...flags,'--package-lock=false']);
  const installed=path.join(consumer,'node_modules/nisi-private-cli'),bin=path.join(consumer,'node_modules/.bin/nisi');
  assert.deepEqual(walk(installed),PRIVATE_CLI_PACKAGE_FILES);assert(fs.lstatSync(bin).isSymbolicLink());
  assert.equal(fs.realpathSync(bin),path.join(installed,'bin/nisi.mjs'));assert(fs.statSync(bin).mode&0o100);
  for(const[file,sha]of Object.entries(record.stageManifest))assert.equal(hash(path.join(installed,file)),sha,file);
  const before=snapshot(installed);
  record.installed={path:installed,bin,exactArchiveMatch:true,before};
  const guard=path.join(root,'tests/helpers/nisi-cli-no-effects.mjs');
  record.guardSha256=hash(guard);
  function cli(name,args,expected=0,nodeFlags=[],childEnv=env) {
    return run(name,process.execPath,[...nodeFlags,'--import',guard,bin,...args],{expected,childEnv}).toString();
  }
  assert.match(cli('installed help',['--help']),/Nisi/i);
  assert.equal(cli('installed version',['--version']).trim(),metadata.version);
  for(const flag of ['--preserve-symlinks-main','--preserve-symlinks'])
    assert.equal(cli('installed symlink '+flag,['--version'],0,[flag]).trim(),metadata.version);
  // Direct operating-system shebang execution as well as explicit node invocation.
  assert.equal(run('installed executable shebang',bin,['--version'],{childEnv:{...env,
    NODE_OPTIONS:'--import='+guard}}).toString().trim(),metadata.version);
  const doctor=JSON.parse(cli('installed inventory doctor',['doctor']));
  assert.equal(doctor.status,'INVENTORY_COMPLETE');assert.equal(doctor.readyForExecution,false);
  assert.equal(doctor.modelInference,'NOT_RUN');assert.equal(doctor.compiler,'NOT_RUN');
  record.installed.doctor=doctor;
  const summaryRoot=path.join(evidence,'synthetic-summary');fs.mkdirSync(summaryRoot,{mode:0o700});
  const summaryBytes=Buffer.from(JSON.stringify(storedSummaryFixture(),null,2)+'\n');
  writeFile(summaryRoot,'summary.json',summaryBytes);
  const summaryBefore=snapshot(summaryRoot);
  const observed=JSON.parse(cli('installed summary observation',['inspect',summaryRoot]));
  assert.equal(observed.reportedStatus,'INCOMPLETE');assert.equal(observed.reportedOutcome,'TIMED_OUT');
  assert.equal(observed.summarySha256,hashBytes(summaryBytes));assert.equal(observed.accepted,false);
  assert.equal(observed.authorizing,false);assert.equal(observed.currentRunState,'UNKNOWN');
  assert.equal(observed.bundleValidation,'NOT_RUN');assert.equal(observed.lateSettlement,'NOT_ASSESSED');
  assert.equal(observed.remoteInferenceStopped,'NOT_OBSERVED');assert.equal(observed.sourceTrust,'UNVERIFIED');
  assert(!JSON.stringify(observed).includes('PRIVATE_'));assert.deepEqual(snapshot(summaryRoot),summaryBefore);
  record.installed.inspection=observed;
  cli('installed inspect requires one explicit directory',['inspect'],2);
  cli('installed inspect refuses relative directory',['inspect','relative'],2);
  const invalidRoot=path.join(evidence,'invalid-summary');fs.mkdirSync(invalidRoot,{mode:0o700});
  writeFile(invalidRoot,'summary.json',Buffer.from('PRIVATE_INVALID_JSON'));
  cli('installed inspect refuses malformed summary',['inspect',invalidRoot],2);
  assert.match(record.checks.at(-1).stderr,/NISI_INSPECT_SUMMARY_INVALID/);
  assert(!record.checks.at(-1).stderr.includes('PRIVATE_INVALID'));
  // Parent-owned synthetic bytes only. The installed command cannot write,
  // launch the fixture runner or load any neighboring execution/history module.
  const trialEnv={...env,NISI_CLI_TEST_ALLOW_DEMO:'0',NISI_CLI_TEST_ALLOW_TRIAL:'1',NISI_CLI_TEST_PACKAGE_ROOT:installed};
  const events=await pairedTrialFixtureEvents();
  function trialBytes(selected) {
    let previous=null;
    return Buffer.concat(selected.map((event,index)=>{
      const encoded=encodeTrialEventV1(event,index,previous);previous=encoded.sha256;return encoded.bytes;
    }));
  }
  record.installed.trialInspections=[];
  for(const[name,bytes,expected,status,byteStatus,semanticStatus]of [
    ['final',trialBytes(events),0,'OBSERVED','FINAL_PRESENT','FINAL_CONSISTENT'],
    ['intent',trialBytes(events.slice(0,2)),1,'INCOMPLETE','INCOMPLETE','INTERRUPTED'],
    ['empty',Buffer.alloc(0),1,'INCOMPLETE','EMPTY','NOT_PERFORMED'],
    ['partial',Buffer.concat([trialBytes(events.slice(0,2)),Buffer.from('PRIVATE_PARTIAL')]),1,'INCOMPLETE','PARTIAL_TAIL','INTERRUPTED'],
    ['invalid',Buffer.from('PRIVATE_INVALID\n'),2,'REFUSED','CORRUPT','REFUSED'],
  ]) {
    const directory=path.join(evidence,'synthetic-trial-'+name);fs.mkdirSync(directory,{mode:0o700});
    writeFile(directory,'events.jsonl',bytes);const beforeTrial=snapshot(directory);
    const observedTrial=JSON.parse(cli('installed trial '+name,['inspect-trial',directory],expected,[],
      {...trialEnv,NISI_CLI_TEST_SINGLE_CAPTURE:'1'}));
    assert.equal(record.checks.at(-1).stderr,'');
    assert.equal(observedTrial.schemaVersion,'nisi-cli-trial-inspection-v1');assert.equal(observedTrial.status,status);
    assert.equal(observedTrial.exitCode,expected);assert.equal(observedTrial.byteStatus,byteStatus);
    assert.equal(observedTrial.semanticStatus,semanticStatus);assert.equal(observedTrial.actualDispatchCount,null);
    assert.equal(observedTrial.sourceTrust,'UNAUTHENTICATED_HOST_STATEMENTS');
    for(const field of ['candidateBytesRevalidated','measurementVerified','causalClaim','authorizing','resumable','promotionEligible'])
      assert.equal(observedTrial[field],false);
    for(const field of ['creationAcknowledgement','durabilityAcknowledgement','remoteExecutionStopped'])assert.equal(observedTrial[field],'UNKNOWN');
    for(const field of ['events','rows','batches','directory','file','candidateText'])assert.equal(Object.hasOwn(observedTrial,field),false);
    assert(!JSON.stringify(observedTrial).includes('PRIVATE_'));assert(!JSON.stringify(observedTrial).includes(directory));
    if(expected===0)assert.equal(observedTrial.counts.completePhaseRecords,4);
    if(name==='intent') {assert.equal(observedTrial.counts.planned,4);assert.equal(observedTrial.counts.startIntents,1);}
    if(name==='empty'||name==='invalid')assert.equal(observedTrial.counts,null);
    assert.deepEqual(snapshot(directory),beforeTrial);
    record.installed.trialInspections.push({name,report:observedTrial,bytesUnchanged:true});
  }
  const unavailable=JSON.parse(cli('installed trial missing event file',['inspect-trial',summaryRoot],2,[],trialEnv));
  assert.equal(unavailable.status,'REFUSED');assert.equal(unavailable.byteStatus,'UNAVAILABLE');
  assert.equal(unavailable.semanticStatus,'NOT_PERFORMED');assert.equal(unavailable.counts,null);
  assert.deepEqual(snapshot(summaryRoot),summaryBefore);assert.equal(record.checks.at(-1).stderr,'');
  cli('installed trial malformed usage',['inspect-trial','PRIVATE_RELATIVE'],2,[],trialEnv);
  assert.equal(JSON.parse(record.checks.at(-1).stderr).code,'NISI_CLI_ARGUMENTS');
  assert(!record.checks.at(-1).stderr.includes('PRIVATE_RELATIVE'));
  // A real runner stopped during schedule retention, with ZERO execution calls.
  // Build synthetic sidecar linkage only for installed read-only verification;
  // this is not proof of a completed model trial or live owner admission.
  const stoppedEvents=[];let stoppedRunner;
  stoppedRunner=createPairedTrialRunnerV1({...pairedTrialFixtureInputs(),host:{
    retain:async event=>{stoppedEvents.push(event);if(event.type==='SCHEDULE')stoppedRunner.requestStop();},
    verifyInputs:()=>{throw Error('UNEXPECTED_FIXTURE_ADMISSION');},
    startExecutor:()=>{throw Error('UNEXPECTED_FIXTURE_EXECUTION');},
    startOracle:()=>{throw Error('UNEXPECTED_FIXTURE_ORACLE');},
  }});
  const stopped=await stoppedRunner.run();assert.equal(stopped.counts.executorStarted,0);
  assert.equal(stoppedEvents.length,2);const [schedule,final]=stoppedEvents;
  const scheduleEncoded=encodeTrialEventV1(schedule,0,null),finalEncoded=encodeTrialEventV1(final,1,scheduleEncoded.sha256);
  const header=encodeArmSidecarRecordV1({kind:'HEADER',main:{sequence:schedule.sequence,sha256:scheduleEncoded.sha256},
    runnerId:schedule.runnerId,planSha256:schedule.plan.planSha256,profileSha256:schedule.profile.profileSha256,
    intentsSha256:armSidecarDigestV1(schedule.intents)},0,null);
  const sideFinal=encodeArmSidecarRecordV1({kind:'FINAL',main:{sequence:final.sequence,sha256:finalEncoded.sha256},
    rows:schedule.intents.map(intent=>({requestId:intent.requestId,state:'NOT_STARTED'})),failure:null},1,header.sha256);
  const mainBytes=Buffer.concat([scheduleEncoded.bytes,finalEncoded.bytes]);
  const sideBytes=Buffer.concat([header.bytes,sideFinal.bytes]);
  const armEnv={...trialEnv,NISI_CLI_TEST_ALLOW_ARM:'1'};record.installed.armInspections=[];
  for(const [name,bytes,expected,status] of [
    ['final',sideBytes,0,'OBSERVED'],['header',header.bytes,1,'INCOMPLETE'],
    ['empty',Buffer.alloc(0),1,'INCOMPLETE'],
    ['partial',Buffer.concat([sideBytes,Buffer.from('{partial')]),1,'INCOMPLETE'],
    ['corrupt',Buffer.from('PRIVATE_INVALID\n'),2,'REFUSED'],['missing',null,2,'REFUSED'],
  ]){
    const directory=path.join(evidence,'synthetic-arm-'+name);fs.mkdirSync(directory,{mode:0o700});
    writeFile(directory,'events.jsonl',mainBytes);if(bytes!==null)writeFile(directory,'arm-sidecar.jsonl',bytes);
    const beforeArm=snapshot(directory);
    const observedArm=JSON.parse(cli('installed arm '+name,['inspect-arm-trial',directory],expected,[],
      {...armEnv,NISI_CLI_TEST_SINGLE_CAPTURE:'1',...(bytes!==null?{NISI_CLI_TEST_SINGLE_SIDECAR_CAPTURE:'1'}:{})}));
    assert.equal(record.checks.at(-1).stderr,'');assert.equal(observedArm.status,status);
    assert.equal(observedArm.schemaVersion,'nisi-cli-paired-arm-inspection-v1');assert.equal(observedArm.actualDispatchCount,null);
    for(const key of ['authorizing','resumable','measurementVerified','causalClaim','promotionEligible','candidateBytesRevalidated'])assert.equal(observedArm[key],false);
    assert(!JSON.stringify(observedArm).includes(directory));assert(!JSON.stringify(observedArm).includes('PRIVATE_'));
    for(const key of ['requestId','ownerSetId','rows','events','candidateText'])assert(!JSON.stringify(observedArm).includes('"'+key+'"'));
    if(expected===0){assert.equal(observedArm.counts.NOT_STARTED,4);assert.equal(observedArm.counts.COMPLETE,0);}
    assert.deepEqual(snapshot(directory),beforeArm);
    record.installed.armInspections.push({name,report:observedArm,bytesUnchanged:true});
  }
  cli('installed arm malformed usage',['inspect-arm-trial','PRIVATE_RELATIVE'],2,[],armEnv);
  assert.equal(JSON.parse(record.checks.at(-1).stderr).code,'NISI_CLI_ARGUMENTS');
  assert(!record.checks.at(-1).stderr.includes('PRIVATE_RELATIVE'));
  assert.equal(JSON.parse(cli('installed demo help',['demo','--help'])).exitCode,0);
  const preflight=JSON.parse(cli('installed offline fixture preflight',['demo','--approved-reviewed-fixture',
    '--endpoint','http://127.0.0.1:1234/v1/chat/completions',
    '--author-model','synthetic.author','--reviewer-model','synthetic.reviewer','--preflight-only'],1));
  assert.equal(preflight.status,'PREFLIGHT_VALIDATED');assert.equal(preflight.exitCode,1);
  assert.equal(preflight.runtimeAdmission,'NOT_OBSERVED');assert.equal(preflight.serverIdleObserved,false);
  assert.equal(preflight.modelCalls,0);assert.equal(preflight.compilerStarted,false);
  assert.equal(preflight.workspaceCreated,false);assert.equal(preflight.artifactWrites,0);
  assert.equal(preflight.nx04Accepted,false);assert.equal(preflight.authorizing,false);
  assert.equal(preflight.publicationAuthorized,false);assert.equal(preflight.sourceFileCount,5);
  record.installed.preflight=preflight;
  cli('installed unsupported command',['run'],2);
  const args=['demo','--approved-reviewed-fixture','--endpoint','http://127.0.0.1:1234',
    '--author-model','not-contacted-a','--reviewer-model','not-contacted-b'];
  cli('installed state required',args,2);
  assert.match(record.checks.at(-1).stderr,/NISI_STATE_DIRECTORY_REQUIRED/);
  for(const state of [installed,path.join(installed,'cli'),path.dirname(installed),'relative']) {
    cli('installed invalid state refused',[...args,'--state-dir',state],2);
    assert.match(record.checks.at(-1).stderr,/NISI_STATE_DIRECTORY_INVALID/);
  }
  assert(!fs.existsSync(path.join(installed,'.build')));assert.deepEqual(snapshot(installed),before);
  record.portable='PASS_SCOPED';record.native={status:'NOT_RUN'};
  if(native) {
    const state=path.join(evidence,'native-state');fs.mkdirSync(state,{mode:0o700});
    const helper=path.join(root,'tests/helpers/private-cli-installed-native.mjs');
    record.native={status:'INCOMPLETE',helperSha256:hash(helper),stateRoot:state};
    const result=JSON.parse(run('installed fixed native and host acceptance',process.execPath,
      [helper,installed,state,'full'],{timeout:120000}));
    assert.equal(result.status,'PASS_SCOPED');record.native={...record.native,...result};
    record.native.receiptSha256=hash(result.evidence);
    assert.deepEqual(snapshot(installed),before);

    // Deliberate known mutation in an owned copy only, never canonical source.
    // It must be rejected by the active-marker assertion, not a launch error.
    const mutant=path.join(evidence,'reservation-mutant'),mutantState=path.join(evidence,'mutant-state');
    fs.mkdirSync(mutant,{mode:0o700});fs.mkdirSync(mutantState,{mode:0o700});
    const needle="build.schemaVersion===2 ? build.stateRoot : path.join(root,'.build')";
    for(const file of PRIVATE_CLI_PACKAGE_FILES) {
      let bytes=plainFile(installed,file);
      if(file==='hosts/swift-verifier/executor.mjs') {
        const source=bytes.toString('utf8');assert.equal(source.split(needle).length,2);
        bytes=Buffer.from(source.replace(needle,"path.join(root,'.build')"));
      }
      writeFile(mutant,file,bytes,file==='bin/nisi.mjs'?0o755:0o600);
    }
    // Legacy reservation's parent existed in a checkout. Give this mutant the
    // same prerequisite so the control tests location, not missing directory.
    fs.mkdirSync(path.join(mutant,'.build'),{mode:0o700});
    const denied=JSON.parse(run('old package-local reservation mutation must fail',process.execPath,
      [helper,mutant,mutantState,'reservation-only'],{expected:1,timeout:90000}));
    assert.equal(denied.status,'FAIL');assert.match(denied.failure.message,/MISSING_EXTERNAL_RESERVATION/);
    record.mutation={detected:true,result:denied,receiptSha256:hash(denied.evidence)};
  }
  for(const[file,sha]of Object.entries(record.sourceManifest))assert.equal(hash(path.join(root,file)),sha,'source drift '+file);
  for(const[file,sha]of Object.entries(record.stageManifest))assert.equal(hash(path.join(stage,file)),sha,'stage drift '+file);
  assert.deepEqual(snapshot(installed),before);assert.equal(hash(archive),record.archive.sha256);
  assert.equal(hash(guard),record.guardSha256);record.installed.unchangedAfterChecks=true;
  for(const[file,sha]of Object.entries(record.verificationInputs))assert.equal(hash(path.join(root,file)),sha,'verification input drift '+file);
  record.status='PASS_SCOPED';
} catch(error) {
  record.status='FAIL';record.failure={name:error.name,message:error.message,code:error.code??null};process.exitCode=1;
} finally {
  record.completedAt=new Date().toISOString();
  const receipt=path.join(evidence,'receipt.json');fs.writeFileSync(receipt,JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({status:record.status,receipt,archive:record.archive?.path??null,
    portable:record.portable??'INCOMPLETE',native:record.native?.status??'NOT_RUN',failure:record.failure??null}));
}
