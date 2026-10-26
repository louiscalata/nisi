// Synthetic process evidence; the real native pairing is exercised separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import {runWorkflow} from '../workflow/engine.mjs';
import {stableStringify,sha256Text,createCandidate} from '../workflow/contracts.mjs';
import {createRepositorySnapshot,prepareRepositoryCandidate} from '../hosts/repository/snapshot-contract.mjs';
import {createExecutionExpectation,createHostRunBundle,readHostRunBundle} from '../receipts/repository-execution-v1.mjs';
import {createHostRunBundleV2,readHostRunBundleV2} from '../receipts/host-run-bundle-v2.mjs';
const copy=v=>structuredClone(v),hash=sha256Text;
const reject=(fn,code)=>assert.throws(fn,e=>e.code===code);
async function fixture({interrupt=null,rawStatus='PASS',error=false,store=null,late=false,repair=false,repairEnding=null}={}){
  const task={taskId:'fixture.v2',mode:repair?'edit':'review',language:'javascript',allowedFiles:['x.json'],protectedFiles:[],protectedSnapshots:{},acceptanceCriteria:['valid'],
    policy:{repairBudget:repair?1:0,totalDeadlineMs:1000,requiredReviewers:1,requireReportStore:store==='error'}};
  const baseline=createRepositorySnapshot({files:[{path:'x.json',content:'{}'}]});
  const candidate={files:[{path:'x.json',content:'{"ok":true}'}]};
  const profile={id:'fixture.v2',version:1,rulesetSha256:hash('rules'),sourceSha256:hash('source'),buildSha256:hash('build'),executableSha256:hash('exec'),
    argv:[],environmentSha256:hash('env'),cwd:'.',platform:'darwin',architecture:'arm64',timeoutMs:500,maximumOutputBytes:1024};
  const expectations=[],receipts=[];let now=0,finishLate;const controller=new AbortController();
  const callback=stage=>async p=>{
    const prep=prepareRepositoryCandidate({baseline,task,candidate:{files:p.candidate.files},authorId:p.candidate.authorId});
    const expected=createExecutionExpectation({preparation:prep,runId:p.binding.runId,attempt:p.binding.attempt,checkId:'fixture.'+stage.toLowerCase(),stage,profile});expectations.push(expected);
    const status=stage==='tests'?(repair&&p.binding.attempt===0?'FAIL':rawStatus):'PASS';
    const output={capturedBytes:0,observedBytes:0,sha256:hash(''),truncated:false};
    const r={schemaVersion:1,expectationFingerprint:expected.fingerprint,binding:copy(expected.binding),
      process:{started:true,closed:true,drain:'CONFIRMED',exitCode:status==='FAIL'?1:0,signal:null,errorCode:null,deadlineExceeded:false,cancelRequested:false,durationMs:1},
      outputs:{stdout:{...output},stderr:{...output}},result:{status,reason:status==='PASS'?'':'fixture adverse'}};
    if(status==='ERROR')r.process.errorCode='FIXTURE';
    if(status==='INCONCLUSIVE')r.process.drain='UNKNOWN';
    if(status==='NOT_RUN')Object.assign(r.process,{started:false,closed:false,drain:'NOT_APPLICABLE',exitCode:null,durationMs:0});
    if(stage==='tests'&&error){r.process.errorCode='ADAPTER_EXCEPTION';r.result={status:'ERROR',reason:'ADAPTER_EXCEPTION'};receipts.push(r);throw Error('synthetic adapter');}
    if(stage==='tests'&&interrupt){
      if(late){await new Promise(resolve=>{finishLate=resolve;controller.abort();});}
      else if(interrupt==='cancel')controller.abort();else now=1000;
    }
    receipts.push(r);
    const failures=status==='FAIL'?[{code:'FAILED',message:'fixture failed'}]:[];
    return {status:['ERROR','INCONCLUSIVE'].includes(status)?'UNAVAILABLE':status,evidence:{...p.binding,reason:r.result.reason,
      ...(stage==='tests'?{assertionsExecuted:['PASS','FAIL'].includes(status)?1:0,assertionsPassed:status==='PASS'?1:0,failures}:{findings:failures})}};
  };
  const adapters={authorizeContext:{authorize:p=>({status:'PASS',evidence:{...p.binding,reason:''}})},staticChecks:{check:callback('staticChecks')},tests:{run:callback('tests')},
    reviewers:[{id:'reviewer.fixture',review:p=>({status:'PASS',evidence:{...p.binding,reviewerId:'reviewer.fixture',findings:[],summary:'fixture only',reason:''}})}]};
  if(repair){
    const prep=c=>prepareRepositoryCandidate({baseline,task,candidate:c,authorId:'author.fixture'});
    adapters.author={id:'author.fixture',draft:p=>({candidate,evidence:{...p.binding,candidateFingerprint:prep(candidate).candidateFingerprint,note:'fixture'}}),
      repair:p=>{
        if(repairEnding){
          if(repairEnding==='ABORTED')controller.abort();
          return{status:repairEnding==='ABORTED'?'NO_CHANGE':repairEnding,candidate:null,evidence:{...p.binding,baseCandidateFingerprint:p.candidate.fingerprint,note:'terminal fixture repair'}};
        }
        const c={files:[{path:'x.json',content:'{"fixed":true}'}]};return{status:'REPAIRED',candidate:c,evidence:{...p.binding,candidateFingerprint:prep(c).candidateFingerprint,baseCandidateFingerprint:p.candidate.fingerprint,note:'repair'}};}};
  }
  const options={adapters,clock:()=>now,signal:controller.signal,...(repair?{}:{candidate,candidateAuthorId:'author.fixture'})};
  if(store)options.reportStore={store:()=>{if(store==='timeout'){now=1000;return null;}if(store==='cancel'){controller.abort();return null;}throw Error('fixture storage');}};
  const report=await runWorkflow(task,options);
  if(finishLate){finishLate();await new Promise(resolve=>setImmediate(resolve));}
  return{context:{report,expectations},receipts};
}
const read=f=>readHostRunBundleV2(createHostRunBundleV2(f.context,f.receipts),f.context);
function rehash(b){const {fingerprint,...identity}=b;return{...identity,fingerprint:hash('nisi/host-run-bundle/v2\0'+stableStringify(identity))};}

test('v2 ordinary results round-trip without changing v1 identity or inputs',async()=>{
  const f=await fixture(),before=stableStringify(f);const v1=createHostRunBundle(f.context,f.receipts);
  assert.equal(readHostRunBundle(v1,f.context).status,'CONSISTENT');
  const b=createHostRunBundleV2(f.context,f.receipts),r=readHostRunBundleV2(copy(b),f.context);
  const {fingerprint,...identity}=b;
  assert.equal(fingerprint,hash('nisi/host-run-bundle/v2\0'+stableStringify(identity)));
  const {serializationProfile,reportDigestProfile,bundleDigestProfile}=b;
  assert.equal(b.reportSha256,hash('nisi/host-final-report/v2\0'+stableStringify({serializationProfile,reportDigestProfile,bundleDigestProfile,report:f.context.report})));
  assert.equal(r.status,'CONSISTENT');assert.equal(r.outcome,'COMPLETED');assert.equal(r.recordedPassCount,2);
  assert.equal(r.rawStatusCounts.PASS,2);assert.equal(r.interruptedCount,0);assert.equal(r.unrecordedRawPassCount,0);
  assert.equal(r.executionVerified,false);assert.equal(r.authorizing,false);assert.equal(r.certificationGranted,false);
  assert.equal(stableStringify(f),before);assert.notEqual(v1.fingerprint,b.fingerprint);
  assert.throws(()=>readHostRunBundleV2(v1,f.context));assert.throws(()=>readHostRunBundle(b,f.context));
});
test('native-like PASS and workflow timeout coexist, but interrupted PASS is not recorded acceptance',async()=>{
  const f=await fixture({interrupt:'timeout'});reject(()=>createHostRunBundle(f.context,f.receipts),'HOST_STAGE_STATUS_MISMATCH');
  const b=createHostRunBundleV2(f.context,f.receipts),r=readHostRunBundleV2(b,f.context);
  assert.equal(r.workflowOutcome,'TIMED_OUT');assert.equal(r.outcome,'TIMED_OUT');assert.equal(r.recordedPassCount,1);
  assert.equal(r.rawStatusCounts.PASS,2);assert.equal(r.unrecordedRawPassCount,1);assert.equal(r.interruptedCount,1);
  assert.equal(b.entries[1].disposition.kind,'ENGINE_INTERRUPTED');assert.equal(b.entries[1].receipt.process.cancelRequested,false);
  assert.equal(b.entries[1].receipt.result.status,'PASS');assert.equal(b.entries[1].disposition.engineCode,'DEADLINE_EXCEEDED');
  assert.equal(Object.hasOwn(b.entries[1].disposition,'ordering'),false);
});
test('a genuine engine cancellation can precede a late fixture result without rewriting either',async()=>{
  const f=await fixture({interrupt:'cancel',late:true});const r=read(f);
  assert.equal(r.outcome,'CANCELLED');assert.equal(r.unrecordedRawPassCount,1);assert.equal(r.unknownDrainCount,0);
  assert.equal(f.context.report.stages.at(-1).evidence.reason,'ABORTED');assert.equal(f.receipts[1].result.status,'PASS');
});
test('interruption retains every independently valid raw status, but never an invalid PASS',async()=>{
  for(const status of ['PASS','FAIL','NOT_RUN','ERROR','INCONCLUSIVE']){
    const f=await fixture({interrupt:'timeout',rawStatus:status}),r=read(f);
    assert.equal(r.rawStatusCounts[status],status==='PASS'?2:1);assert.equal(r.recordedPassCount,1);assert.equal(r.interruptedCount,1);
    assert.equal(r.unknownDrainCount,status==='INCONCLUSIVE'?1:0);
  }
  const f=await fixture({interrupt:'timeout'});f.receipts[1].process.drain='UNKNOWN';
  reject(()=>createHostRunBundleV2(f.context,f.receipts),'EXECUTION_RESULT_CONTRADICTION');
});
test('ordinary adverse results and matching engine errors preserve supported v1 behavior',async()=>{
  for(const rawStatus of ['FAIL','NOT_RUN','ERROR','INCONCLUSIVE']){
    const f=await fixture({rawStatus});assert.equal(readHostRunBundle(createHostRunBundle(f.context,f.receipts),f.context).status,'CONSISTENT');
    const b=createHostRunBundleV2(f.context,f.receipts);assert.equal(b.entries[1].disposition.kind,'RESULT_RECORDED');assert.equal(read(f).recordedPassCount,1);
  }
  const f=await fixture({error:true}),b=createHostRunBundleV2(f.context,f.receipts);
  assert.equal(b.entries[1].disposition.kind,'ENGINE_ERROR_RECORDED');
  f.receipts[1].process.errorCode=null;f.receipts[1].result={status:'PASS',reason:''};
  reject(()=>createHostRunBundleV2(f.context,f.receipts),'HOST_V2_UNSUPPORTED_MISMATCH');
});
test('forged completed workflow, wrong stop code, extra stop evidence and trailing stages refuse',async()=>{
  const f=await fixture({interrupt:'timeout'});
  for(const edit of [r=>{r.workflowOutcome='COMPLETED';},r=>{r.outcome='COMPLETED';},r=>{r.stages.at(-1).code='ABORTED';},
    r=>{r.stages.at(-1).evidence.findings=[];},r=>{r.stages.push(copy(r.stages[0]));},r=>{r.stages.at(-1).evidence.attempt=1;},
    r=>{r.candidateFingerprint=hash('wrong');},r=>{r.stages.at(-1).status='PASS';}]){
    const context={...f.context,report:copy(f.context.report)};edit(context.report);assert.throws(()=>createHostRunBundleV2(context,f.receipts));
  }
  const impossible={...f.context,report:{...f.context.report,workflowOutcome:'BLOCKED',outcome:'BLOCKED'}};
  reject(()=>createHostRunBundleV2(impossible,f.receipts),'HOST_V2_STOP_CONTRADICTION');
});
test('report-store deadline or failure keeps original workflow outcome separate',async()=>{
  for(const store of ['timeout','error','cancel']){
    const f=await fixture({store}),r=read(f);
    assert.equal(r.workflowOutcome,'COMPLETED');assert.equal(r.outcome,store==='timeout'?'TIMED_OUT':store==='cancel'?'CANCELLED':'BLOCKED');
    assert.equal(r.recordedPassCount,2);assert.equal(r.interruptedCount,0);
    const bad={...f.context,report:{...f.context.report,reportStoreCode:null}};
    reject(()=>createHostRunBundleV2(bad,f.receipts),'HOST_V2_FINAL_OUTCOME_CONTRADICTION');
    const wrongOutcome={...f.context,report:{...f.context.report,outcome:store==='timeout'?'CANCELLED':'TIMED_OUT'}};
    reject(()=>createHostRunBundleV2(wrongOutcome,f.receipts),'HOST_V2_FINAL_OUTCOME_CONTRADICTION');
  }
});
test('missing extra reordered duplicate and forged expectation inventories refuse',async()=>{
  const f=await fixture();
  for(const receipts of [[],f.receipts.slice(1),[...f.receipts,f.receipts[0]],[...f.receipts].reverse(),[f.receipts[0],f.receipts[0]]])assert.throws(()=>createHostRunBundleV2(f.context,receipts));
  for(const expectations of [[],copy(f.context.expectations),[...f.context.expectations].reverse()])assert.throws(()=>createHostRunBundleV2({...f.context,expectations},f.receipts));
  const r=copy(f.context.report);r.stages.splice(3,0,copy(r.stages[2]));
  reject(()=>createHostRunBundleV2({report:r,expectations:[f.context.expectations[0],...f.context.expectations]},[f.receipts[0],...f.receipts]),'HOST_V2_DUPLICATE');
});
test('every execution binding remains enforced and final report changes invalidate v2',async()=>{
  const f=await fixture(),b=createHostRunBundleV2(f.context,f.receipts);
  for(const key of Object.keys(f.receipts[0].binding)){
    const rows=copy(f.receipts);rows[0].binding[key]=typeof rows[0].binding[key]==='number'?99:'wrong';
    reject(()=>createHostRunBundleV2(f.context,rows),'EXECUTION_BINDING_MISMATCH');
  }
  reject(()=>readHostRunBundleV2(b,{...f.context,report:{...f.context.report,taskId:'different'}}),'HOST_V2_REPORT_DIGEST');
  const changedCandidate=createCandidate({files:[{path:'x.json',content:'{"different":true}'}]},{authorId:'author.fixture'});
  reject(()=>createHostRunBundleV2({...f.context,report:{...f.context.report,candidate:changedCandidate,candidateFingerprint:changedCandidate.fingerprint}},f.receipts),'HOST_V2_FINAL_CANDIDATE');
  reject(()=>createHostRunBundleV2({...f.context,report:{...f.context.report,taskFingerprint:hash('different task')}},f.receipts),'HOST_V2_BINDING');
});
test('ordinary semantic mismatch remains refused independently of outer bundle hashes',async()=>{
  const f=await fixture(),bad=copy(f.receipts);bad[1].result={status:'FAIL',reason:'failed'};bad[1].process.exitCode=1;
  const report=copy(f.context.report);report.stages.find(s=>s.stage==='tests').evidence.reason='failed';
  reject(()=>createHostRunBundleV2({...f.context,report},bad),'HOST_V2_STAGE_STATUS_MISMATCH');
  const failed=await fixture({rawStatus:'FAIL'});failed.receipts[1].result.reason='different adverse reason';
  reject(()=>createHostRunBundleV2(failed.context,failed.receipts),'HOST_V2_STAGE_REASON_MISMATCH');
});
test('caller-supplied disposition cannot be forged even with a recomputed bundle hash',async()=>{
  const f=await fixture({interrupt:'timeout'}),b=createHostRunBundleV2(f.context,f.receipts);
  for(const change of [{kind:'RESULT_RECORDED'},{engineStatus:'PASS'},{engineCode:null},{stageIndex:0},{engineReason:''},{authorizing:true}]){
    const altered=copy(b);Object.assign(altered.entries[1].disposition,change);
    reject(()=>readHostRunBundleV2(rehash(altered),f.context),'HOST_V2_DISPOSITION_MISMATCH');
  }
  for(const change of [{schemaVersion:1},{bundleDigestProfile:'legacy'},{reportDigestProfile:'legacy'},{serializationProfile:'legacy'}])reject(()=>readHostRunBundleV2(rehash({...copy(b),...change}),f.context),'HOST_V2_PROFILE');
  reject(()=>readHostRunBundleV2({...b,fingerprint:hash('wrong')},f.context),'HOST_V2_BUNDLE_DIGEST');
});
test('v2 deeply captures output and refuses hidden getters extra fields and malformed arrays',async()=>{
  const f=await fixture(),b=createHostRunBundleV2(f.context,f.receipts),r=readHostRunBundleV2(b,f.context);
  assert.throws(()=>{b.entries[0].receipt.process.closed=false;},TypeError);assert.throws(()=>{r.rawStatusCounts.PASS=99;},TypeError);
  let getters=0;const getter=copy(b);Object.defineProperty(getter,'entries',{get(){getters++;return b.entries;}});assert.throws(()=>readHostRunBundleV2(getter,f.context));assert.equal(getters,0);
  for(const input of [{...b,extra:true},Object.assign(copy(b),{entries:new Array(2)}),Object.defineProperty(copy(b),'hidden',{value:true})])assert.throws(()=>readHostRunBundleV2(input,f.context));
  const rows=[...f.receipts];rows.extra=true;assert.throws(()=>createHostRunBundleV2(f.context,rows));
});
test('repaired candidate retains failed history and cannot reuse earlier attempt receipts',async()=>{
  const f=await fixture({repair:true}),r=read(f);assert.equal(r.outcome,'COMPLETED');assert.equal(r.receiptCount,4);assert.equal(r.rawStatusCounts.FAIL,1);
  assert.notEqual(f.receipts[0].binding.candidateFingerprint,f.receipts[2].binding.candidateFingerprint);
  reject(()=>createHostRunBundleV2(f.context,[...f.receipts.slice(0,2),...f.receipts.slice(0,2)]),'EXECUTION_BINDING_MISMATCH');
  const stale={...f.context,report:copy(f.context.report)};stale.report.candidateFingerprint=f.receipts[0].binding.candidateFingerprint;
  reject(()=>createHostRunBundleV2(stale,f.receipts),'HOST_V2_FINAL_CANDIDATE');
});
test('terminal repair without new checks must retain the last checked candidate',async()=>{
  for(const repairEnding of ['NO_CHANGE','FAIL','NOT_RUN','UNAVAILABLE','ABORTED']){
    const f=await fixture({repair:true,repairEnding}),r=read(f);
    assert.equal(f.context.report.repairAttempts,1);assert.equal(r.receiptCount,2);assert.notEqual(r.outcome,'COMPLETED');
    const candidate=createCandidate({files:[{path:'x.json',content:'{"unrelated":true}'}]},{authorId:'author.fixture'});
    const report={...f.context.report,candidate,candidateFingerprint:candidate.fingerprint};
    // An interrupted repair also has an exact stop binding, which independently refuses.
    assert.throws(()=>createHostRunBundleV2({...f.context,report},f.receipts));
  }
});
