// Source-pinned, bounded verification of explicit one-row incident review.
// Relocated variants are test-only dependency substitutions, never product injection APIs.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const priorName='.build/repository-incident-capture-verification-IC2zRR/verification.json';
const sourceName='hosts/history/review-repository-incidents-v1.mjs',liveName='examples/repository-live-model.mjs';
const behavior=['tests/repository-incident-review.test.mjs','tests/repository-incident-review-boundaries.test.mjs'];
const focused=[...behavior,'tests/repository-incident-cli.test.mjs','tests/repository-incident-types.test.mjs'];
const additions=[sourceName,'tests/helpers/incident-review-fixture.mjs',...focused,
  'history/repository-incident-candidates-v1.d.mts','history/repository-incident-capture-v1.d.mts',
  'tests/typechecks/repository-incident-positive.mts',
  'tests/typechecks/repository-incident-negative.mts','work-orders/repository-incident-review-v1/verify-focused.mjs',
  'work-orders/repository-incident-review-v1/verify-terminal-incidents.mjs','work-orders/repository-incident-review-v1/verify.mjs'];
const expected={[sourceName]:'9d614cb78939664f276f6a70ac053fce1d4cc72db78b1126c5f372f49a68008e',
  'tests/helpers/incident-review-fixture.mjs':'0df5fc78bc8f150bd8b249b3b88971415c9f0be8b758966de65a3cc58ec66ed8',
  'tests/repository-incident-review.test.mjs':'30cea4a9004fde41443cd43d149f4e7ea91c3f65049781b0fb4eb8e289473e5d',
  'tests/repository-incident-review-boundaries.test.mjs':'21e6229c4afbbec41a09795a9cbd74f04e7f6ef68d6ff454799ab2f7da47a244',
  'tests/repository-incident-cli.test.mjs':'cf4982433d018a1ad177a381fe5159da95506f5048bcf2e2c11d2bf1051a0b67',
  'tests/repository-incident-types.test.mjs':'fde4282dfd1a7ce5eed767f7d296d36abb7d299abeadfc80eb628d277e80845b',
  'history/repository-incident-candidates-v1.d.mts':'68823ff3046121cbd2a3769a56390d3d43fc3cbe40c8972b5aaf3f8808dd5ccd',
  'history/repository-incident-capture-v1.d.mts':'22d5ab2f7689507797e94cb2edf8d49432bff6a82e057c9c822a75391e896489',
  'tests/typechecks/repository-incident-positive.mts':'f5d9f8609e19a9ab10e44aae07c206af029ca03c2ac53228d53bb09ec0421310',
  'tests/typechecks/repository-incident-negative.mts':'2a64669aae4894d6df33c2adb6e4152d74578bb76106e18d16f36c86b59519bf'};
const hash=v=>createHash('sha256').update(v).digest('hex'),bytes=n=>fs.readFileSync(path.join(root,n));
const prior=JSON.parse(bytes(priorName));assert.equal(prior.status,'PASS_SCOPED');assert.equal(Object.keys(prior.after).length,267);
for(const[n,p]of Object.entries(prior.after))if(n!==liveName)assert.equal(hash(bytes(n)),p,n);assert.equal(Object.keys(prior.after).filter(n=>n!==liveName).length,266);
for(const[n,p]of Object.entries(expected))assert.equal(hash(bytes(n)),p,n);
const names=[...Object.keys(prior.after),...additions.filter(n=>!Object.hasOwn(prior.after,n))].sort();
assert.equal(names.length,280);assert.equal(new Set(names).size,280);
const pins=()=>Object.fromEntries(names.map(n=>[n,hash(bytes(n))])),before=pins();
const evidence=fs.mkdtempSync(path.join(root,'.build/repository-incident-review-verification-'));
const record={schemaVersion:1,status:'INCOMPLETE',startedAt:new Date().toISOString(),evidence,node:process.version,
  priorVerification:priorName,priorPinCount:267,unchangedPriorPins:266,intentionalPriorChanges:[liveName],checkedFiles:280,
  before,focused:null,relocatedControl:null,variants:[],product:null,terminal:'NOT_RUN_SEPARATE_PTY',authorizing:false,
  scope:'Explicit operator-selected metadata observation only; no authenticated consent, native incident, learning, erasure, model, or release acceptance'};
function replaceOnce(s,o,n){assert.equal(s.split(o).length,2,'one target: '+o.slice(0,120));return s.replace(o,n);}
function relocate(text,origin,dest){const resolve=s=>{const r=path.resolve(path.dirname(path.join(root,origin)),s),rel=path.relative(root,r);return pathToFileURL(dest[rel]??r).href;};return text.replace(/from '([^']+)'/g,(w,s)=>s.startsWith('.')?"from '"+resolve(s)+"'":w).replace(/import\('([^']+)'\)/g,(w,s)=>s.startsWith('.')?"import('"+resolve(s)+"')":w);}
function counters(out){return Object.fromEntries(['tests','pass','fail','cancelled','skipped','todo'].map(k=>{const m=[...out.matchAll(new RegExp('^(?:# |ℹ )'+k+' (\\d+)$','gm'))];assert.equal(m.length,1,k);return[k,Number(m[0][1])];}));}
function execute(cmd,args,dir,timeout){const c=spawnSync(cmd,args,{cwd:root,encoding:'utf8',timeout,maxBuffer:16777216});fs.writeFileSync(path.join(dir,'stdout.txt'),c.stdout??'',{flag:'wx'});fs.writeFileSync(path.join(dir,'stderr.txt'),c.stderr??'',{flag:'wx'});assert.equal(c.error,undefined);assert.equal(c.signal,null);const x=counters(c.stdout);assert.equal(x.cancelled+x.skipped+x.todo,0);const codes=[...c.stdout.matchAll(/^\s+code: '([^']+)'$/gm)].map(m=>m[1]);assert.equal(codes.length,x.fail);const assertionFailures=codes.filter(v=>v==='ERR_ASSERTION').length;return{exitCode:c.status,...x,assertionFailures,nonAssertionFailures:codes.length-assertionFailures,failureCodes:Object.fromEntries([...new Set(codes)].sort().map(v=>[v,codes.filter(x=>x===v).length]))};}
const source=bytes(sourceName).toString('utf8');
const variants=[
  ['lose-malformed-permit-cleanup',s=>replaceOnce(s,"if(issued && typeof issued==='object'){","if(false){")],
  ['double-current',s=>replaceOnce(s,'const afterClock=current();if(afterClock)return notStored(afterClock);','if(current())return notStored(current());')],
  ['omit-journal-coherence',s=>replaceOnce(s,"if(!c.recordAttempted)return c.status==='REFUSED';","if(!c.recordAttempted)return c.status==='REFUSED';\n    return true;")],
  ['bypass-confirmation',s=>replaceOnce(s,"if(answer.text!==expectedAnswer)return notStored(['','no','n'].includes(answer.text)?'DECLINED':'ANSWER_MISMATCH');","if(false)return notStored('ANSWER_MISMATCH');")],
  ['select-off-page',s=>replaceOnce(s,"visible.find(r=>r.rowId===selected[1])","rows.find(r=>r.rowId===selected[1])")],
  ['interaction-limit-33',s=>replaceOnce(s,'MAX_INTERACTIONS = 32','MAX_INTERACTIONS = 33')],
  ['timeout-wrong-reason',s=>replaceOnce(s,"const stop=()=>aborted()?'ABORTED':performance.now()>=deadline?'TIMEOUT':null;","const stop=()=>aborted()?'ABORTED':performance.now()>=deadline?'PROMPT_ERROR':null;")]];
function passing(n){return{exitCode:0,tests:n,pass:n,fail:0,cancelled:0,skipped:0,todo:0,assertionFailures:0,nonAssertionFailures:0,failureCodes:{}};}
function relocated(label,altered){const dir=path.join(evidence,label);fs.mkdirSync(dir);const sp=path.join(dir,path.basename(sourceName)),dest={[sourceName]:sp};fs.writeFileSync(sp,relocate(altered,sourceName,dest),{flag:'wx'});const paths=behavior.map(n=>{const p=path.join(dir,path.basename(n));fs.writeFileSync(p,relocate(bytes(n).toString('utf8'),n,dest),{flag:'wx'});return p;});return{canonicalSha256:hash(source),semanticSha256:hash(altered),...execute(process.execPath,['--test','--test-reporter=tap',...paths],dir,20000)};}
try{const fd=path.join(evidence,'focused');fs.mkdirSync(fd);record.focused=execute(process.execPath,['--test','--test-reporter=tap',...focused],fd,30000);assert.deepEqual(record.focused,passing(31));record.relocatedControl=relocated('relocated-control',source);assert.deepEqual(record.relocatedControl,{canonicalSha256:hash(source),semanticSha256:hash(source),...passing(23)});for(const[n,m]of variants){const x=relocated(n,m(source));record.variants.push({name:n,...x});assert.equal(x.tests,23);assert.equal(x.pass+x.fail,23);assert.equal(x.exitCode,1);assert.ok(x.assertionFailures>0,n+' no semantic assertion failure');assert.equal(x.nonAssertionFailures,0,n+' includes runtime/non-assertion failures');}const pd=path.join(evidence,'product');fs.mkdirSync(pd);record.product=execute('npm',['run','check'],pd,120000);assert.equal(record.product.exitCode,0);assert.deepEqual(record.product,passing(1598));record.after=pins();record.changedDuringVerification=names.filter(n=>before[n]!==record.after[n]);assert.deepEqual(record.changedDuringVerification,[]);record.status='PASS_SCOPED';}catch(e){record.status='FAIL';record.failure=String(e?.message??e);process.exitCode=1;}finally{record.completedAt=new Date().toISOString();fs.writeFileSync(path.join(evidence,'verification.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:record.status,evidence,focused:record.focused,relocatedControl:record.relocatedControl,variants:record.variants,product:record.product,terminal:record.terminal,changedDuringVerification:record.changedDuringVerification??null,failure:record.failure??null}));}
