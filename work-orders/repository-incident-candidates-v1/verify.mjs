// Bounded verification for source-bound repository incident previews.
// Mutants are relocated dependency substitutions only; product files stay read-only.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const priorName='.build/repository-history-cli-verification-zl56OG/verification.json';
const hostName='hosts/repository/reviewed-workflow-v1.mjs',sourceName='history/repository-incident-candidates-v1.mjs';
const candidateTest='tests/repository-incident-candidates.test.mjs';
const focusedTests=[candidateTest,'tests/repository-incident-host.test.mjs','tests/repository-incident-isolation.test.mjs'];
const additions=[sourceName,...focusedTests,'tests/helpers/incident-host-fixture.mjs','tests/helpers/incident-candidate-fixture.mjs',
  'work-orders/repository-incident-candidates-v1/verify-focused.mjs','work-orders/repository-incident-candidates-v1/verify.mjs'];
const expected={
  [hostName]:'26a4589dbedd7d6b266bfb3fef5f54842fdfa6356df5dadea35b7380b1a26bde',
  [sourceName]:'3468b78bd5617d1c69905dfd34a90cebf457f7aa935751c9195610493c269359',
  [candidateTest]:'23f99f81296d5a11a8906634e46c5310aaf1d795ed0e0c0ef795bd204bf108d7',
  'tests/repository-incident-host.test.mjs':'2c958fdecc65d7c18ea656db5588af7a7887167914cb5f6af5387fe5299f5812',
  'tests/repository-incident-isolation.test.mjs':'d31e3f6e03bf3d9705d489c2f60ab9e07a8bdfba71ef3784abe93c40eef0fd89',
  'tests/helpers/incident-host-fixture.mjs':'7569a21cff83ea18344fa690426c989429fd8f2415f2fe0a9309faf7bdeb4bf2',
  'tests/helpers/incident-candidate-fixture.mjs':'c6939411784b32c2100ec5b660174ea3e51de0068d41e2e022faac999fade4ed',
  'work-orders/repository-incident-candidates-v1/verify-focused.mjs':'f475d4f6fcebc779ffdf86f311930d1f25390069175d75779e09c793dfc30e47'
};
const hash=v=>createHash('sha256').update(v).digest('hex'),bytes=n=>fs.readFileSync(path.join(root,n));
const prior=JSON.parse(bytes(priorName));assert.equal(prior.status,'PASS_SCOPED');assert.equal(Object.keys(prior.after).length,252);
for(const[name,pin]of Object.entries(prior.after))assert.equal(name===hostName?pin:'',name===hostName?'6b53aa8d6d88039c7905baebc2621402ad7cce4ecc23d5fa5574e4b32d881079':'');
for(const[name,pin]of Object.entries(prior.after))if(name!==hostName)assert.equal(hash(bytes(name)),pin,name);
assert.equal(Object.keys(prior.after).filter(n=>n!==hostName).length,251);assert.notEqual(hash(bytes(hostName)),prior.after[hostName]);
for(const[name,pin]of Object.entries(expected))assert.equal(hash(bytes(name)),pin,name);
const names=[...Object.keys(prior.after),...additions.filter(n=>!Object.hasOwn(prior.after,n))].sort();assert.equal(names.length,260);assert.equal(new Set(names).size,260);
const pins=()=>Object.fromEntries(names.map(n=>[n,hash(bytes(n))])),before=pins();
const evidence=fs.mkdtempSync(path.join(root,'.build/repository-incident-candidates-verification-'));
const record={schemaVersion:1,status:'INCOMPLETE',startedAt:new Date().toISOString(),evidence,node:process.version,priorVerification:priorName,
  priorPinCount:252,unchangedPriorPins:251,intentionalPriorChange:hostName,checkedFiles:260,before,focused:null,relocatedControl:null,
  variants:[],product:null,authorizing:false,scope:'Metadata-only source-bound candidate projection; synthetic adapters are not native execution, incident storage, learning, or release acceptance'};
function replaceOnce(s,old,next){assert.equal(s.split(old).length,2,'one mutation target: '+old.slice(0,100));return s.replace(old,next);}
function relocate(text,origin,destinations){return text.replace(/from '([^']+)'/g,(whole,specifier)=>{if(!specifier.startsWith('.'))return whole;const resolved=path.resolve(path.dirname(path.join(root,origin)),specifier),relative=path.relative(root,resolved);return "from '"+pathToFileURL(destinations[relative]??resolved).href+"'";});}
function counters(stdout){return Object.fromEntries(['tests','pass','fail','cancelled','skipped','todo'].map(k=>{const m=[...stdout.matchAll(new RegExp('^(?:# |ℹ )'+k+' (\\d+)$','gm'))];assert.equal(m.length,1,'one '+k+' count');return[k,Number(m[0][1])];}));}
function execute(command,args,dir,timeout){const child=spawnSync(command,args,{cwd:root,encoding:'utf8',timeout,maxBuffer:16_777_216});fs.writeFileSync(path.join(dir,'stdout.txt'),child.stdout??'',{flag:'wx'});fs.writeFileSync(path.join(dir,'stderr.txt'),child.stderr??'',{flag:'wx'});assert.equal(child.error,undefined,'finite process');assert.equal(child.signal,null);const measured=counters(child.stdout);assert.equal(measured.cancelled+measured.skipped+measured.todo,0);const codes=[...child.stdout.matchAll(/^\s+code: '([^']+)'$/gm)].map(m=>m[1]);assert.equal(codes.length,measured.fail);const assertionFailures=codes.filter(c=>c==='ERR_ASSERTION').length;return{exitCode:child.status,...measured,assertionFailures,nonAssertionFailures:codes.length-assertionFailures,failureCodes:Object.fromEntries([...new Set(codes)].sort().map(c=>[c,codes.filter(x=>x===c).length]))};}
const passing=n=>({exitCode:0,tests:n,pass:n,fail:0,cancelled:0,skipped:0,todo:0,assertionFailures:0,nonAssertionFailures:0,failureCodes:{}});
const source=bytes(sourceName).toString('utf8');
const variants=[
 ['skip-original-bundle-validation',s=>replaceOnce(s,"const summary = readRepositoryRunBundleV1(input.bundle, input.context);","const summary = {reportSha256:input.bundle.reportSha256,fingerprint:input.bundle.fingerprint};")],
 ['ignore-interruption',s=>replaceOnce(s,"if (disposition === 'ENGINE_INTERRUPTED') return ['INTERRUPTED','ENGINE_INTERRUPTED'];","if (false) return ['INTERRUPTED','ENGINE_INTERRUPTED'];")],
 ['raw-fail-bypasses-stage-unavailable',s=>replaceOnce(s,"if (!['PASS','FAIL'].includes(stageStatus)) return ['OPERATIONAL','STAGE_UNAVAILABLE'];","if (rawStatus === 'FAIL') return ['FAILURE_CANDIDATE','RECORDED_FAILURE'];\n  if (!['PASS','FAIL'].includes(stageStatus)) return ['OPERATIONAL','STAGE_UNAVAILABLE'];")],
 ['drop-prior-attempt-failures',s=>replaceOnce(s,"rows.sort((a,b) => a.stageIndex - b.stageIndex || a.binding.checkIndex - b.binding.checkIndex);","rows.splice(0,rows.length,...rows.filter(r=>r.binding.attempt===Math.max(...rows.map(x=>x.binding.attempt))));\n  rows.sort((a,b) => a.stageIndex - b.stageIndex || a.binding.checkIndex - b.binding.checkIndex);")],
 ['occurrence-group-includes-candidate',s=>replaceOnce(s,"baselineFingerprint:b.baselineFingerprint, runId:b.runId, familyId}),","baselineFingerprint:b.baselineFingerprint, runId:b.runId, familyId, candidateFingerprint:b.candidateFingerprint}),")],
 ['constant-evidence-digest',s=>replaceOnce(s,"evidenceSha256:H(domain('evidence'), evidence)},","evidenceSha256:'0'.repeat(64)},")]
];
function relocated(label,altered){const dir=path.join(evidence,label);fs.mkdirSync(dir);const sourcePath=path.join(dir,'repository-incident-candidates-v1.mjs'),testPath=path.join(dir,'repository-incident-candidates.test.mjs'),destinations={[sourceName]:sourcePath};fs.writeFileSync(sourcePath,relocate(altered,sourceName,destinations),{flag:'wx'});fs.writeFileSync(testPath,relocate(bytes(candidateTest).toString('utf8'),candidateTest,destinations),{flag:'wx'});const outcome=execute(process.execPath,['--test','--test-reporter=tap',testPath],dir,20_000);return{canonicalSha256:hash(source),semanticSha256:hash(altered),...outcome};}
try{const focusedDir=path.join(evidence,'focused');fs.mkdirSync(focusedDir);record.focused=execute(process.execPath,['--test','--test-reporter=tap',...focusedTests],focusedDir,20_000);assert.deepEqual(record.focused,passing(25));record.relocatedControl=relocated('relocated-control',source);assert.deepEqual(record.relocatedControl,{canonicalSha256:hash(source),semanticSha256:hash(source),...passing(19)});
  for(const[name,mutate]of variants){const outcome=relocated(name,mutate(source)),item={name,...outcome};record.variants.push(item);assert.equal(outcome.tests,19);assert.equal(outcome.pass+outcome.fail,19);assert.equal(outcome.exitCode,1,name+' must be killed');assert.ok(outcome.assertionFailures>0,name+' runtime-only failure is not a kill');}
  const productDir=path.join(evidence,'product');fs.mkdirSync(productDir);record.product=execute('npm',['run','check'],productDir,120_000);assert.equal(record.product.exitCode,0);assert.equal(record.product.fail,0);assert.equal(record.product.pass,record.product.tests);record.after=pins();record.changedDuringVerification=names.filter(n=>before[n]!==record.after[n]);assert.deepEqual(record.changedDuringVerification,[]);record.status='PASS_SCOPED';
}catch(error){record.status='FAIL';record.failure=String(error?.message??error);process.exitCode=1;}finally{record.completedAt=new Date().toISOString();fs.writeFileSync(path.join(evidence,'verification.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:record.status,evidence,checkedFiles:record.checkedFiles,unchangedPriorPins:record.unchangedPriorPins,focused:record.focused,relocatedControl:record.relocatedControl,variants:record.variants,product:record.product,changedDuringVerification:record.changedDuringVerification??null,failure:record.failure??null}));}
