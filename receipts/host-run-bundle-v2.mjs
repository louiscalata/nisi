// PRIVATE object contract. No execution, persistence, authenticity or authority.
// Requires the trusted FINAL engine report and ORIGINAL issued expectations.
// Preserves independently validated v1 raw receipts; never rewrites them to fit
// an engine deadline. No temporal ordering is inferred from these two records.
import {cloneFreeze,stableStringify,sha256Text,RUN_OUTCOMES,validateFindings,createCandidate} from '../workflow/contracts.mjs';
import {readExecutionReceipt} from './repository-execution-v1.mjs';
import {exact} from '../integrity/record-utils.mjs';

const profiles=Object.freeze({serializationProfile:'nisi-workflow-stable-json-v1',
  reportDigestProfile:'nisi-host-final-report-v2',bundleDigestProfile:'nisi-host-run-bundle-v2'});
const hash=(domain,value)=>sha256Text(domain+'\0'+stableStringify(value));
const fail=code=>{throw Object.assign(new Error(code),{code});};
const integer=(v,max)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const text=v=>typeof v==='string'&&v.trim().length>0&&v.length<=4096&&v.isWellFormed()&&!v.includes('\0');
const bindKeys=['schemaVersion','runId','taskFingerprint','attempt','candidateFingerprint'];
const checkNames=['staticChecks','tests'];
const stageNames=['intake','authorizeContext','draft','staticChecks','tests','review','repair','completion'];
const stopOutcome=code=>code==='ABORTED'?'CANCELLED':code==='DEADLINE_EXCEEDED'?'TIMED_OUT':'BLOCKED';
const interrupted=code=>code==='ABORTED'||code==='DEADLINE_EXCEEDED';
const mapped=status=>['ERROR','INCONCLUSIVE'].includes(status)?'UNAVAILABLE':status;
const reportKeys=['schemaVersion','runId','taskId','taskFingerprint','mode','outcome','workflowOutcome','code','candidate',
  'candidateFingerprint','repairAttempts','stages','reportStored','reportStoreCode','storedReportSha256','reportStoreEvidence'];

function list(value,max,code){
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)fail(code);
  const d=Object.getOwnPropertyDescriptors(value),n=d.length.value;
  if(!integer(n,max)||Reflect.ownKeys(d).length!==n+1)fail(code);
  const out=[];for(let i=0;i<n;i++){if(!d[i]?.enumerable||!Object.hasOwn(d[i],'value'))fail(code);out.push(d[i].value);}return out;
}
function reportFrom(input){
  const report=cloneFreeze(input);exact(report,reportKeys,'HOST_V2_REPORT_SCHEMA');
  if(report.schemaVersion!==1||!uuid(report.runId)||!hex(report.taskFingerprint)||
      !RUN_OUTCOMES.includes(report.outcome)||!RUN_OUTCOMES.includes(report.workflowOutcome)||
      !integer(report.repairAttempts,100)||typeof report.reportStored!=='boolean'||
      !(report.code===null||text(report.code))||!(report.reportStoreCode===null||text(report.reportStoreCode)))fail('HOST_V2_REPORT_INVALID');
  if(report.candidate===null){if(report.candidateFingerprint!==null)fail('HOST_V2_FINAL_CANDIDATE');}
  else {
    exact(report.candidate,['schemaVersion','authorId','files','fingerprint'],'HOST_V2_CANDIDATE_SCHEMA');
    const candidate=createCandidate({files:report.candidate.files},{authorId:report.candidate.authorId});
    if(report.candidate.schemaVersion!==1||candidate.fingerprint!==report.candidate.fingerprint||candidate.fingerprint!==report.candidateFingerprint)fail('HOST_V2_FINAL_CANDIDATE');
  }
  const stages=list(report.stages,2300,'HOST_V2_STAGES_INVALID');let terminalStop=null;
  for(let i=0;i<stages.length;i++){
    const s=stages[i];exact(s,['stage','status','candidateFingerprint','code','evidence'],'HOST_V2_STAGE_SCHEMA');
    if(!stageNames.includes(s.stage)||!(s.code===null||text(s.code)))fail('HOST_V2_STAGE_INVALID');
    if(s.code!==null){
      exact(s.evidence,[...bindKeys,'reason'],'HOST_V2_STOP_SCHEMA');
      if(i!==stages.length-1||s.status!=='UNAVAILABLE'||s.evidence.reason!==s.code||
          s.evidence.schemaVersion!==1||s.evidence.runId!==report.runId||s.evidence.taskFingerprint!==report.taskFingerprint||
          s.evidence.attempt!==report.repairAttempts||s.evidence.candidateFingerprint!==s.candidateFingerprint||
          s.candidateFingerprint!==report.candidateFingerprint||report.workflowOutcome!==stopOutcome(s.code))fail('HOST_V2_STOP_CONTRADICTION');
      terminalStop=s;
    }
  }
  if(['CANCELLED','TIMED_OUT'].includes(report.workflowOutcome)&&!terminalStop)fail('HOST_V2_STOP_MISSING');
  // Store failure can change the final outcome/code after workflow execution.
  // Validate this linkage, not a full replay of the engine or its store policy.
  if(report.outcome!==report.workflowOutcome||terminalStop&&report.code!==terminalStop.code){
    if(report.reportStored||!text(report.reportStoreCode)||report.code!==report.reportStoreCode||
        report.outcome!==stopOutcome(report.reportStoreCode))fail('HOST_V2_FINAL_OUTCOME_CONTRADICTION');
  }
  if(report.reportStored&&(report.reportStoreCode!==null||!hex(report.storedReportSha256)))fail('HOST_V2_STORE_CONTRADICTION');
  if(report.outcome==='COMPLETED'&&report.code!==null)fail('HOST_V2_FINAL_OUTCOME_CONTRADICTION');
  return report;
}
// Shared closed final-report linkage validator; this does not replay or
// authenticate every engine stage. Existing v2 bundle semantics are unchanged.
export { reportFrom as readFinalEngineReportV2 };
function ordinaryStage(s,receipt){
  const extra=s.stage==='tests'?['assertionsExecuted','assertionsPassed','failures','reason']:['findings','reason'];
  exact(s.evidence,[...bindKeys,...extra],'HOST_V2_EVIDENCE_SCHEMA');
  if(mapped(receipt.result.status)!==s.status)fail('HOST_V2_STAGE_STATUS_MISMATCH');
  if(receipt.result.reason!==s.evidence.reason)fail('HOST_V2_STAGE_REASON_MISMATCH');
  const findings=s.stage==='tests'?s.evidence.failures:s.evidence.findings;
  validateFindings(findings,'HOST_V2');
  if((s.status==='FAIL')!==(findings.length>0))fail('HOST_V2_FINDINGS_CONTRADICTION');
  if(s.stage==='tests'){
    const a=s.evidence.assertionsExecuted,b=s.evidence.assertionsPassed;
    if(!integer(a,Number.MAX_SAFE_INTEGER)||!integer(b,a)||
        (s.status==='PASS'&&(a===0||b!==a))||(s.status==='FAIL'&&(a===0||b===a))||
        (['NOT_RUN','UNAVAILABLE'].includes(s.status)&&(a!==0||b!==0)))fail('HOST_V2_ASSERTION_CONTRADICTION');
  }
}
function derive(contextInput,receiptInputs){
  exact(contextInput,['report','expectations'],'HOST_V2_CONTEXT_SCHEMA');
  const report=reportFrom(contextInput.report);
  const expected=list(contextInput.expectations,202,'HOST_V2_EXPECTATIONS_INVALID');
  const inputs=list(receiptInputs,202,'HOST_V2_RECEIPTS_INVALID');
  const checks=report.stages.map((stage,index)=>({stage,index})).filter(v=>checkNames.includes(v.stage.stage));
  if(expected.length!==checks.length||inputs.length!==expected.length)fail('HOST_V2_INVENTORY');
  const seen=new Set(),attempts=new Map();let baseline=null,previousAttempt=-1;
  const entries=inputs.map((input,i)=>{
    // This is also the factory-issued expectation check; no caller clone is trusted.
    const receipt=readExecutionReceipt(input,expected[i]);
    const b=receipt.binding,{stage:s,index}=checks[i],key=b.attempt+':'+b.stage;
    if(seen.has(key))fail('HOST_V2_DUPLICATE');seen.add(key);
    if(b.attempt<previousAttempt||b.attempt>previousAttempt+1||b.attempt!==previousAttempt&&b.stage!=='staticChecks')fail('HOST_V2_ATTEMPT_ORDER');
    previousAttempt=b.attempt;
    if(b.attempt>report.repairAttempts||b.runId!==report.runId||b.taskFingerprint!==report.taskFingerprint||
        s.stage!==b.stage||s.candidateFingerprint!==b.candidateFingerprint||
        bindKeys.some(k=>s.evidence?.[k]!==b[k]))fail('HOST_V2_BINDING');
    if(baseline!==null&&baseline!==b.baselineFingerprint||attempts.has(b.attempt)&&attempts.get(b.attempt)!==b.preparationFingerprint)fail('HOST_V2_SNAPSHOT');
    baseline=b.baselineFingerprint;attempts.set(b.attempt,b.preparationFingerprint);
    let kind;
    if(s.code===null){ordinaryStage(s,receipt);kind='RESULT_RECORDED';}
    else if(interrupted(s.code)){kind='ENGINE_INTERRUPTED';}
    else {
      if(receipt.result.status!=='ERROR'||receipt.process.errorCode!==s.code||receipt.result.reason!==s.code)fail('HOST_V2_UNSUPPORTED_MISMATCH');
      kind='ENGINE_ERROR_RECORDED';
    }
    return {receipt,disposition:{kind,stageIndex:index,engineStatus:s.status,engineCode:s.code,engineReason:s.evidence.reason}};
  });
  const last=entries.at(-1)?.receipt.binding;
  if(last&&(report.repairAttempts>last.attempt+1||last.candidateFingerprint!==report.candidateFingerprint))fail('HOST_V2_FINAL_CANDIDATE');
  const reportSha256=hash('nisi/host-final-report/v2',{...profiles,report});
  return {report,identity:{schemaVersion:2,...profiles,reportSha256,entries}};
}
export function createHostRunBundleV2(context,receiptInputs){
  const {identity}=derive(context,receiptInputs);
  return cloneFreeze({...identity,fingerprint:hash('nisi/host-run-bundle/v2',identity)});
}
export function readHostRunBundleV2(input,context){
  const value=cloneFreeze(input);
  exact(value,['schemaVersion',...Object.keys(profiles),'reportSha256','entries','fingerprint'],'HOST_V2_BUNDLE_SCHEMA');
  if(value.schemaVersion!==2||Object.entries(profiles).some(([k,v])=>value[k]!==v))fail('HOST_V2_PROFILE');
  const entries=list(value.entries,202,'HOST_V2_ENTRIES_INVALID');
  for(const e of entries)exact(e,['receipt','disposition'],'HOST_V2_ENTRY_SCHEMA');
  const {report,identity}=derive(context,entries.map(e=>e.receipt));
  if(value.reportSha256!==identity.reportSha256)fail('HOST_V2_REPORT_DIGEST');
  if(stableStringify(entries)!==stableStringify(identity.entries))fail('HOST_V2_DISPOSITION_MISMATCH');
  if(value.fingerprint!==hash('nisi/host-run-bundle/v2',identity))fail('HOST_V2_BUNDLE_DIGEST');
  const rawStatusCounts={PASS:0,FAIL:0,NOT_RUN:0,ERROR:0,INCONCLUSIVE:0};
  let recordedPassCount=0,interruptedCount=0,unknownDrainCount=0;
  for(const {receipt,disposition} of identity.entries){
    rawStatusCounts[receipt.result.status]++;
    if(disposition.kind==='RESULT_RECORDED'&&receipt.result.status==='PASS')recordedPassCount++;
    if(disposition.kind==='ENGINE_INTERRUPTED')interruptedCount++;
    if(receipt.process.drain==='UNKNOWN')unknownDrainCount++;
  }
  return cloneFreeze({schemaVersion:2,status:'CONSISTENT',...profiles,reportSha256:identity.reportSha256,fingerprint:value.fingerprint,
    workflowOutcome:report.workflowOutcome,outcome:report.outcome,code:report.code,reportStoreCode:report.reportStoreCode,receiptCount:entries.length,
    rawStatusCounts,recordedPassCount,unrecordedRawPassCount:rawStatusCounts.PASS-recordedPassCount,interruptedCount,unknownDrainCount,
    executionVerified:false,authorizing:false,certificationGranted:false});
}
