// Bounded verifier for the repository history review, terminal adapter, and CLI wiring.
// Relocated controls and mutants are test-only dependency substitutions in a fresh .build directory.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const priorName='.build/repository-host-history-verification-HzMJM7/verification.json';
const cliName='examples/repository-live-model.mjs';
const reviewName='hosts/history/review-repository-history-v1.mjs';
const terminalName='hosts/history/terminal-history-prompt-v1.mjs';
const reviewTest='tests/repository-history-review.test.mjs';
const terminalTest='tests/terminal-history-prompt.test.mjs';
const cliTest='tests/repository-history-cli.test.mjs';
const additions=[cliName,reviewName,terminalName,reviewTest,terminalTest,cliTest,
  'history/repository-host-history-v1.d.mts','tests/repository-host-history-types.test.mjs',
  'tests/typechecks/repository-host-history-negative.mts','tests/typechecks/repository-host-history-positive.mts'];
const expected={
  [cliName]:'c7b81ab3d563af66fa96fd0a9d1d60f69222c4869027f5436afd753e9598a19b',
  [reviewName]:'a1042e1913e468edb322df493454f91f88f8c58231791b77c7c2eb1b00b5a090',
  [terminalName]:'282774b329890be4a0d4b0cf144558cdc5e4b7e623c8e5b2f201f911ceb02db4',
  [reviewTest]:'3e85be70375a3c5ad7cce36be73d6fa00b3d13da1638998c11afa895223ff234',
  [terminalTest]:'a070fdff11f6df36e74fd2500f0c577ec8d5c4885a4f836b0bad59af79e8d95f',
  [cliTest]:'ae85469f15f7a6415763b3f24fb27fadcd2959627392f077ef8f78793ef4da6b',
  'history/repository-host-history-v1.d.mts':'dbf1a6687491e844eecb6ac708f1092459724d08429d66f90b38388035ecf619',
  'tests/repository-host-history-types.test.mjs':'0906be1eb28387e01eceb7a1352dd41b10d3a9249b08e01804ab7e1ca07d2767',
  'tests/typechecks/repository-host-history-negative.mts':'b05a322c3c0bf15feb57190e3ac31f9e90b20151abdffc5acf21040df83e111b',
  'tests/typechecks/repository-host-history-positive.mts':'e31895f5d8ae30bdc0792a40f84d41ee8c8874e92e4ee812689f736cdacc35d4'
};
const hash=v=>createHash('sha256').update(v).digest('hex');
const bytes=n=>fs.readFileSync(path.join(root,n));
const prior=JSON.parse(bytes(priorName));
assert.equal(prior.status,'PASS_SCOPED');assert.equal(Object.keys(prior.after).length,242);
assert.equal(Object.hasOwn(prior.after,cliName),false,'the prior selected set omitted examples; do not invent a prior CLI pin');
for(const [name,pin] of Object.entries(prior.after)) assert.equal(hash(bytes(name)),pin,name);
for(const [name,pin] of Object.entries(expected)) assert.equal(hash(bytes(name)),pin,name);
const names=[...Object.keys(prior.after),...additions.filter(n=>!Object.hasOwn(prior.after,n))].sort();
assert.equal(names.length,252);assert.equal(new Set(names).size,252);
const pins=()=>Object.fromEntries(names.map(n=>[n,hash(bytes(n))]));
const before=pins(),evidence=fs.mkdtempSync(path.join(root,'.build/repository-history-cli-verification-'));
const record={schemaVersion:1,status:'INCOMPLETE',startedAt:new Date().toISOString(),evidence,node:process.version,
  priorVerification:priorName,priorPinCount:242,unchangedPriorPins:242,intentionalPriorChange:null,newlyPinnedChangedFile:cliName,
  checkedFiles:252,before,focused:null,reviewControl:null,terminalControl:null,variants:[],product:null,
  authorizing:false,scope:'Private operator review UI, terminal input, and additive CLI wiring; no live native/model run, authenticated consent, retention sweeper, or release acceptance'};

function replaceOnce(input,old,next){assert.equal(input.split(old).length,2,'exact one-site target: '+old.slice(0,100));return input.replace(old,next);}
function relocate(text,origin,destinations){return text.replace(/from '([^']+)'/g,(whole,specifier)=>{
  if(!specifier.startsWith('.'))return whole;
  const resolved=path.resolve(path.dirname(path.join(root,origin)),specifier),relative=path.relative(root,resolved);
  return "from '"+pathToFileURL(destinations[relative]??resolved).href+"'";
});}
function counters(stdout){return Object.fromEntries(['tests','pass','fail','cancelled','skipped','todo'].map(key=>{
  const found=[...stdout.matchAll(new RegExp('^(?:# |ℹ )'+key+' (\\d+)$','gm'))];assert.equal(found.length,1,'one terminal '+key+' count');return[key,Number(found[0][1])];
}));}
function execute(command,args,dir,timeout){const child=spawnSync(command,args,{cwd:root,encoding:'utf8',timeout,maxBuffer:16_777_216});
  fs.writeFileSync(path.join(dir,'stdout.txt'),child.stdout??'',{flag:'wx'});fs.writeFileSync(path.join(dir,'stderr.txt'),child.stderr??'',{flag:'wx'});
  assert.equal(child.error,undefined,'finite child');assert.equal(child.signal,null);const measured=counters(child.stdout);
  assert.equal(measured.cancelled+measured.skipped+measured.todo,0);const codes=[...child.stdout.matchAll(/^\s+code: '([^']+)'$/gm)].map(m=>m[1]);
  assert.equal(codes.length,measured.fail,'one failure code per failed test');const assertions=codes.filter(c=>c==='ERR_ASSERTION').length;
  return{exitCode:child.status,...measured,assertionFailures:assertions,nonAssertionFailures:codes.length-assertions,
    failureCodes:Object.fromEntries([...new Set(codes)].sort().map(c=>[c,codes.filter(x=>x===c).length]))};}
const passing=count=>({exitCode:0,tests:count,pass:count,fail:0,cancelled:0,skipped:0,todo:0,assertionFailures:0,nonAssertionFailures:0,failureCodes:{}});

const reviewSource=bytes(reviewName).toString('utf8'),terminalSource=bytes(terminalName).toString('utf8');
const variants=[
  {name:'accept-wrong-answer',kind:'review',transform:s=>replaceOnce(s,
    "if(answer.text!==expectedAnswer) return refused(['','no','n'].includes(answer.text)?'DECLINED':'ANSWER_MISMATCH');",
    "if(false) return refused(['','no','n'].includes(answer.text)?'DECLINED':'ANSWER_MISMATCH');")},
  {name:'remove-digest-recheck',kind:'review',transform:s=>replaceOnce(s,
    "if (rechecked.reason || rechecked.p.sha256!==sourceDigest) return refused('DIGEST_CHANGED');",
    "if (rechecked.reason) return refused('DIGEST_CHANGED');")},
  {name:'remove-final-abort-check-from-capture-clock',kind:'review',transform:s=>replaceOnce(s,
    "const value=req.clock();\n      if(aborted()) throw Error('ABORTED');\n      return value;",
    "const value=req.clock();\n      return value;")},
  {name:'discard-valid-post-capture-abort',kind:'review',transform:s=>replaceOnce(s,
    "capture=c; return result(c.status,c.reason);",
    "capture=c; if(aborted()) { capture=null; return refused('ABORTED'); } return result(c.status,c.reason);")},
  {name:'trim-terminal-answer',kind:'terminal',transform:s=>replaceOnce(s,
    "finish({kind:'answer',text:value});",
    "finish({kind:'answer',text:value.trim()});")},
  {name:'accept-first-of-multiple-lines',kind:'terminal',transform:s=>replaceOnce(s,
    "if(end!==buffer.length-1) return finish({kind:'error'});",
    "if(false) return finish({kind:'error'});")}
];

function relocatedRun(label,kind,source,expectedCount){
  const dir=path.join(evidence,label);fs.mkdirSync(dir);const moduleName=kind==='review'?reviewName:terminalName;
  const testName=kind==='review'?reviewTest:terminalTest;const modulePath=path.join(dir,path.basename(moduleName));const testPath=path.join(dir,path.basename(testName));
  const destinations={[moduleName]:modulePath};fs.writeFileSync(modulePath,relocate(source,moduleName,destinations),{flag:'wx'});
  fs.writeFileSync(testPath,relocate(bytes(testName).toString('utf8'),testName,destinations),{flag:'wx'});
  const outcome=execute(process.execPath,['--test','--test-reporter=tap',testPath],dir,20_000);assert.equal(outcome.tests,expectedCount);return{dir,moduleSha256:hash(source),...outcome};
}

try{
  const focusedDir=path.join(evidence,'focused');fs.mkdirSync(focusedDir);
  record.focused=execute(process.execPath,['--test','--test-reporter=tap',reviewTest,terminalTest,cliTest],focusedDir,20_000);
  assert.deepEqual(record.focused,passing(36));
  record.reviewControl=relocatedRun('review-control','review',reviewSource,16);assert.deepEqual({...record.reviewControl,dir:undefined,moduleSha256:undefined},{...passing(16),dir:undefined,moduleSha256:undefined});
  record.terminalControl=relocatedRun('terminal-control','terminal',terminalSource,15);assert.deepEqual({...record.terminalControl,dir:undefined,moduleSha256:undefined},{...passing(15),dir:undefined,moduleSha256:undefined});
  for(const variant of variants){const canonical=variant.kind==='review'?reviewSource:terminalSource,count=variant.kind==='review'?16:15;
    const altered=variant.transform(canonical),outcome=relocatedRun(variant.name,variant.kind,altered,count);
    const item={name:variant.name,kind:variant.kind,canonicalSha256:hash(canonical),semanticSha256:hash(altered),...outcome};record.variants.push(item);
    assert.equal(outcome.pass+outcome.fail,count);assert.equal(outcome.exitCode,1,variant.name+' must be killed');assert.ok(outcome.assertionFailures>0,variant.name+' requires semantic assertion failure');
  }
  const productDir=path.join(evidence,'product');fs.mkdirSync(productDir);record.product=execute('npm',['run','check'],productDir,120_000);assert.deepEqual(record.product,passing(1510));
  record.after=pins();record.changedDuringVerification=names.filter(n=>before[n]!==record.after[n]);assert.deepEqual(record.changedDuringVerification,[]);record.status='PASS_SCOPED';
}catch(error){record.status='FAIL';record.failure=String(error?.message??error);process.exitCode=1;}
finally{record.completedAt=new Date().toISOString();fs.writeFileSync(path.join(evidence,'verification.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({status:record.status,evidence,checkedFiles:record.checkedFiles,unchangedPriorPins:record.unchangedPriorPins,focused:record.focused,reviewControl:record.reviewControl,terminalControl:record.terminalControl,variants:record.variants,product:record.product,changedDuringVerification:record.changedDuringVerification??null,failure:record.failure??null}));}
