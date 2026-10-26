import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {parseNisiArguments} from '../cli/arguments.mjs';
import {runNisiCli} from '../cli/main.mjs';
import {projectArmTrialInspectionV1} from '../cli/paired-arm-inspect.mjs';
import {pairedArmContext} from './helpers/paired-arm-owner-fixture.mjs';
import {createDurablePairedArmOwnerV1} from '../hosts/repository/durable-paired-arm-owner-v1.mjs';
import {encodeArmSidecarRecordV1} from '../history/paired-arm-sidecar-codec-v1.mjs';
const root=fs.realpathSync(path.resolve(import.meta.dirname,'..'));
function temporary(t){const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'nisi-arm-cli-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
async function fixture(t){
  const parent=temporary(t),c=await pairedArmContext(t,{workspaceParentRoot:parent});
  const {retain:_a,retainAdmission:_b,...input}=c.input;
  const report=await createDurablePairedArmOwnerV1({...input,parentDirectory:parent}).run();
  assert.equal(report.recorded,true);return {parent,directory:report.main.directory};
}
function cli(parent,args,expected,extra={}){
  const r=spawnSync(process.execPath,['--import',path.join(root,'tests/helpers/nisi-cli-no-effects.mjs'),path.join(root,'bin/nisi.mjs'),...args],
    {cwd:parent,env:{PATH:process.env.PATH,HOME:parent,TMPDIR:parent,NISI_CLI_TEST_ALLOW_TRIAL:'1',
      NISI_CLI_TEST_ALLOW_ARM:'1',NISI_CLI_TEST_PACKAGE_ROOT:root,...extra},encoding:'utf8',timeout:10000,killSignal:'SIGKILL',maxBuffer:65536});
  assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,expected,r.stderr);return r;
}
function view(r,directory){
  assert.equal(r.stderr,'');assert(r.stdout.length<4096);const v=JSON.parse(r.stdout);
  assert.equal(v.schemaVersion,'nisi-cli-paired-arm-inspection-v1');assert.equal(v.actualDispatchCount,null);
  for(const key of ['authorizing','resumable','measurementVerified','causalClaim','promotionEligible','candidateBytesRevalidated'])assert.equal(v[key],false);
  for(const forbidden of [directory,'candidateText','sourceCode','apiKey','synthetic.author','synthetic.reviewer','ownerSetId','requestId','PRIVATE_'])assert(!r.stdout.includes(forbidden),forbidden);
  return v;
}
test('parser keeps the distinct read-only command bounded and immutable',()=>{
  const original=['inspect-arm-trial','/example'],parsed=parseNisiArguments(original);original[1]='/changed';
  assert.equal(parsed.command,'inspect-arm-trial');assert.deepEqual(parsed.args,['/example']);assert(Object.isFrozen(parsed.args));
  for(const args of [['inspect-arm-trial'],['inspect-arm-trial','relative'],['inspect-arm-trial',''],
    ['inspect-arm-trial','/a\0b'],['inspect-arm-trial','/'+'a'.repeat(4096)],['inspect-arm-trial','/a','extra']])
    assert.throws(()=>parseNisiArguments(args),{code:'NISI_CLI_ARGUMENTS'});
});
test('projection refuses unknown states, malformed arrays, proxy/accessor fields and future schemas',()=>{
  const base={schemaVersion:'nisi-paired-arm-reconciliation-v1',status:'FINAL_CROSSLINKED',reason:null,
    mainByteStatus:'FINAL_PRESENT',sidecarByteStatus:'FINAL_PRESENT',rows:[{state:'COMPLETE'}],missing:[]};
  assert.equal(projectArmTrialInspectionV1(base).status,'OBSERVED');let traps=0;
  const accessor=Object.defineProperty({},'state',{get(){traps++;return 'COMPLETE';}});
  const proxy=new Proxy({state:'COMPLETE'},{getOwnPropertyDescriptor(){traps++;throw Error('PRIVATE_SECRET');}});
  for(const patch of [{rows:[{state:'FUTURE'}]},{rows:null},{rows:[accessor]},{rows:[proxy]},{missing:null},
    {missing:[{missing:'FUTURE'}]},{schemaVersion:'future'},{status:'FUTURE'},{mainByteStatus:'EMPTY'},
    {sidecarByteStatus:'NEW'},{rows:new Array(1)},{rows:Array(257).fill({state:'COMPLETE'})}]){
    const v=projectArmTrialInspectionV1({...base,...patch});assert.equal(v.status,'REFUSED');assert.equal(v.exitCode,2);
    assert.equal(v.counts,null);assert.equal(v.reason,'INSPECTION_UNAVAILABLE');
  }
  assert.equal(traps,0);
});
test('malformed arguments remain sanitized stderr; absent storage is bounded stdout refusal',t=>{
  const parent=temporary(t);
  const bad=cli(parent,['inspect-arm-trial','PRIVATE_RELATIVE'],2);
  assert.equal(bad.stdout,'');assert.equal(JSON.parse(bad.stderr).code,'NISI_CLI_ARGUMENTS');assert(!bad.stderr.includes('PRIVATE_RELATIVE'));
  const missing=path.join(parent,'PRIVATE_MISSING'),v=view(cli(parent,['inspect-arm-trial',missing],2),missing);
  assert.equal(v.status,'REFUSED');assert.equal(v.reason,'UNAVAILABLE_OR_CORRUPT_BYTES');
});
test('actual binary opens each ledger once, emits aggregates only and leaves bytes/metadata unchanged',async t=>{
  const {parent,directory}=await fixture(t),files=['events.jsonl','arm-sidecar.jsonl'].map(f=>path.join(directory,f));
  const before=files.map(f=>({bytes:fs.readFileSync(f),stat:fs.statSync(f)}));
  for(let i=0;i<2;i++){
    const v=view(cli(parent,['inspect-arm-trial',directory],0,{NISI_CLI_TEST_SINGLE_CAPTURE:'1',NISI_CLI_TEST_SINGLE_SIDECAR_CAPTURE:'1'}),directory);
    assert.equal(v.status,'OBSERVED');assert.equal(v.mainByteStatus,'FINAL_PRESENT');assert.equal(v.sidecarByteStatus,'FINAL_PRESENT');
    assert.deepEqual(v.counts,{NOT_STARTED:3,PREPARED_UNCONFIRMED:0,STARTED_INCOMPLETE:0,EXECUTOR_OBSERVED:0,COMPLETE:1});
    assert.equal(v.missingLinks,0);assert.equal(v.reason,null);
  }
  for(const [i,f] of files.entries()){
    assert.deepEqual(fs.readFileSync(f),before[i].bytes);
    for(const key of ['mode','ctimeMs','mtimeMs','nlink','size','ino','dev'])assert.equal(fs.statSync(f)[key],before[i].stat[key]);
  }
  assert.deepEqual(fs.readdirSync(directory),['arm-sidecar.jsonl','events.jsonl']);
});
test('empty, missing, partial, corrupt and rehashed mismatching sidecars are distinguished',async t=>{
  const {parent,directory}=await fixture(t),file=path.join(directory,'arm-sidecar.jsonl'),original=fs.readFileSync(file);
  for(const [kind,bytes,expected,status] of [
    ['empty',Buffer.alloc(0),1,'INCOMPLETE'],['partial',Buffer.concat([original,Buffer.from('{partial')]),1,'INCOMPLETE'],
    ['corrupt',Buffer.concat([original,Buffer.from('PRIVATE_BAD\n')]),2,'REFUSED'],
  ]){
    fs.writeFileSync(file,bytes);const v=view(cli(parent,['inspect-arm-trial',directory],expected),directory);
    assert.equal(v.status,status,kind);
  }
  // Rehash every sidecar record after corrupting a semantic header binding.
  const records=original.toString().trimEnd().split('\n').map(x=>JSON.parse(x).record);records[0].intentsSha256='f'.repeat(64);
  let previous=null;const forged=records.map((r,i)=>{const encoded=encodeArmSidecarRecordV1(r,i,previous);previous=encoded.sha256;return encoded.bytes;});
  fs.writeFileSync(file,Buffer.concat(forged));
  assert.equal(view(cli(parent,['inspect-arm-trial',directory],2),directory).reason,'CROSS_LEDGER_BINDING_OR_ORDER');
  fs.unlinkSync(file);assert.equal(view(cli(parent,['inspect-arm-trial',directory],2),directory).status,'REFUSED');
  fs.writeFileSync(file,original,{flag:'wx',mode:0o600});
  const old=JSON.parse(cli(parent,['inspect-trial',directory],0).stdout);
  assert.equal(old.schemaVersion,'nisi-cli-trial-inspection-v1');assert.equal(old.status,'OBSERVED');
  assert.equal(Object.hasOwn(old,'sidecarByteStatus'),false);
});
test('help preserves all existing warnings and adds observation-only paired-arm guidance',async()=>{
  const r=await runNisiCli(['help']);
  for(const line of ['inspect-arm-trial ABSOLUTE_DIR','--preflight-only','No automatic model selection',
    'No retry, overwrite or late upgrade','No row identifiers','separate CLI archive','arm64-apple-macosx27.0'])assert(r.stdout.includes(line),line);
});
test('paired-arm loader permission stays exact and never loads execution owners or model modules',t=>{
  const parent=temporary(t),guard=path.join(root,'tests/helpers/nisi-cli-no-effects.mjs');
  for(const file of ['hosts/repository/durable-paired-arm-owner-v1.mjs','hosts/repository/paired-trial-arm-owner-v1.mjs',
    'hosts/repository/node-executor-v1.mjs','adapters/local-chat.mjs']){
    const r=spawnSync(process.execPath,['--import',guard,'--input-type=module','-e',`await import(${JSON.stringify(path.join(root,file))})`],
      {cwd:parent,env:{PATH:process.env.PATH,HOME:parent,NISI_CLI_TEST_ALLOW_TRIAL:'1',NISI_CLI_TEST_ALLOW_ARM:'1',NISI_CLI_TEST_PACKAGE_ROOT:root},
        encoding:'utf8',timeout:10000,killSignal:'SIGKILL',maxBuffer:65536});
    assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,1);assert.match(r.stderr,/CLI_TEST_HEAVY_IMPORT/);
  }
});
