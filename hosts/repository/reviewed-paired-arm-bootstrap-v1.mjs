// PRIVATE fixed-fixture owner assembly. Caller approval/clock/admission remain
// explicitly trusted inputs, not authentication or machine-capacity evidence.
// No discovery, build, install, retry, delete, resume or implicit model selection.
import fs from 'node:fs';
import path from 'node:path';
import {types} from 'node:util';
import {fileURLToPath} from 'node:url';
import {record} from '../../evaluation/intake-v1.mjs';
import {cloneFreeze,stableStringify,sha256Text} from '../../workflow/contracts.mjs';
import {readPreventionExperimentPlanV1} from '../../evaluation/prevention-experiment-plan-v1.mjs';
import {readPreventionExecutionProfileV1} from '../../evaluation/prevention-execution-profile-v1.mjs';
import {readScheduledPairedTrialIntentV1} from '../../evaluation/paired-trial-runner-v1.mjs';
import {readIssuedRepositoryOracleV1} from '../../examples/repository-task/reviewed-oracle-fixture-v1.mjs';
import {readLiveModelSelectionV3} from './live-model-selection-v3.mjs';
import {createReviewedLiveModelLaneV4,readIssuedLiveModelLaneV4} from './reviewed-live-model-v4.mjs';
import {describePlannedRepositoryTrialInputsV2,checkRepositoryTrialIntentV2} from './paired-trial-projection-v2.mjs';
import {createReviewedRepositoryHostV1,readIssuedRepositoryWorkflowIdentityV1} from './reviewed-workflow-v1.mjs';
import {createRepositoryTrialOracleV1,readIssuedRepositoryTrialOracleV1} from './paired-trial-oracle-v1.mjs';
import {isIssuedNativeArtifactBuild} from '../swift-verifier/build.mjs';
import {resolveExternalDemoStateV1,recheckExternalDemoStateV1} from './demo-state-v1.mjs';
import {createPairedArmCommandOwnerV1} from '../../cli/paired-arm-command-owner.mjs';
import {inspectArmTrialDirectoryV1} from '../../cli/paired-arm-inspect.mjs';

const sourceRoot=fileURLToPath(new URL('../../',import.meta.url));
const fail=code=>{throw Object.assign(Error(code),{code});};
const hash=(domain,value)=>sha256Text(domain+'\0'+stableStringify(value));
const exact=(value,keys)=>{if(types.isProxy(value))fail('ARM_BOOTSTRAP_SCHEMA');return record(value,keys);};
// Factories are synchronous. Observe rejected native promises without awaiting
// them or using their late values; never retry uncertain construction.
const synchronous=value=>{
  if(types.isPromise(value)){
    Promise.prototype.then.call(value,()=>{},()=>{});
    fail('ARM_BOOTSTRAP_ASYNC_DEPENDENCY');
  }
  return value;
};
const bounds=(raw,limits)=>{
  const value=cloneFreeze(exact(raw,Object.keys(limits)));
  for(const [key,max] of Object.entries(limits))
    if(!Number.isSafeInteger(value[key])||value[key]<1||value[key]>max)fail('ARM_BOOTSTRAP_BUDGET');
  return value;
};
function budgets(raw){
  const b=exact(raw,['model','host','oracle']);
  const model=bounds(b.model,{timeoutMs:90000,maxOutputTokens:4096});
  const host=bounds(b.host,{staticTimeoutMs:60000,totalTestTimeoutMs:60000,testTimeoutMs:60000,
    closeGraceMs:2000,materializationTimeoutMs:60000});
  const oracle=bounds(b.oracle,{materializationTimeoutMs:60000,totalTimeoutMs:60000,childTimeoutMs:60000,closeGraceMs:2000});
  if(host.testTimeoutMs>host.totalTestTimeoutMs||oracle.childTimeoutMs>oracle.totalTimeoutMs)fail('ARM_BOOTSTRAP_BUDGET');
  return Object.freeze({model,host,oracle});
}
// Descriptive digests only. The production constructor separately requires an
// original process-issued build; data or these digests cannot issue a build.
export function describeReviewedPairedArmEnvironmentV1(input){
  const x=exact(input,['build','budgets']);
  if(types.isProxy(x.build))fail('ARM_BOOTSTRAP_BUILD');
  return cloneFreeze({toolchainSha256:hash('nisi/paired-arm-build/v1',cloneFreeze(x.build)),
    resourceBudgetSha256:hash('nisi/paired-arm-resources/v1',budgets(x.budgets)),authorizing:false});
}
const production=Object.freeze({checkBuild(build,root){
  if(!isIssuedNativeArtifactBuild(build)||build.schemaVersion!==2||build.stateRoot!==root.directory||
    build.stateRootDev!==root.dev||build.stateRootIno!==root.ino)fail('ARM_BOOTSTRAP_BUILD');
},createHost:createReviewedRepositoryHostV1,createLane:createReviewedLiveModelLaneV4,
createOracle:createRepositoryTrialOracleV1,signalSource:process});

export function createReviewedPairedArmBootstrapV1(input){return make(input,production,'LOOPBACK_HTTP');}
// Trusted test factories cannot establish native/provider authenticity. The
// distinct transport kind is bound into the profile and all resulting receipts.
export function createReviewedPairedArmBootstrapWithDependenciesV1(input,dependencies){
  return make(input,dependencies,'INJECTED_TEST_TRANSPORT');
}
function make(input,dependencies,transportKind){
  const x=exact(input,['plan','profile','approval','now','observe','registration','build','selection','treatments','budgets','stateDirectory']);
  const deps=exact(dependencies,['checkBuild','createHost','createLane','createOracle','signalSource']);
  for(const name of ['checkBuild','createHost','createLane','createOracle'])if(typeof deps[name]!=='function')fail('ARM_BOOTSTRAP_DEPENDENCY');
  const signalSource=Object.freeze(Object.fromEntries(['on','removeListener','rawListeners'].map(name=>{
    const fn=deps.signalSource?.[name];if(typeof fn!=='function')fail('ARM_BOOTSTRAP_SIGNALS');
    return [name,fn.bind(deps.signalSource)];
  })));
  if(typeof x.now!=='function'||typeof x.observe!=='function')fail('ARM_BOOTSTRAP_CALLBACK');
  const now=x.now,observe=x.observe,rawPlan=cloneFreeze(x.plan),rawProfile=cloneFreeze(x.profile);
  const plan=readPreventionExperimentPlanV1(rawPlan),profile=readPreventionExecutionProfileV1(rawProfile,plan.planSha256,plan.policy);
  const approval=cloneFreeze(exact(x.approval,['id','ownerId','planSha256','profileSha256','expiresAtMs','priority']));
  if(![approval.id,approval.ownerId].every(v=>typeof v==='string'&&/^[a-z][a-z0-9_.-]{0,95}$/u.exec(v)?.[0]===v)||
    approval.planSha256!==plan.planSha256||approval.profileSha256!==profile.profileSha256||
    !Number.isSafeInteger(approval.expiresAtMs)||approval.expiresAtMs<1||!['FOREGROUND','BACKGROUND'].includes(approval.priority))
    fail('ARM_BOOTSTRAP_APPROVAL');
  const registration=x.registration,owned=readIssuedRepositoryOracleV1(registration),fixture=owned.workflow;
  const selected=readLiveModelSelectionV3(x.selection),treatments=Object.freeze(exact(x.treatments,['OFF','ON'])),b=budgets(x.budgets);
  const build=x.build,environment=describeReviewedPairedArmEnvironmentV1({build,budgets:b});
  if(profile.toolchainSha256!==environment.toolchainSha256||profile.resourceBudgetSha256!==environment.resourceBudgetSha256)
    fail('ARM_BOOTSTRAP_ENVIRONMENT');
  const expectedArms=plan.tasks.length*plan.repetitions*2;
  if(expectedArms>256||plan.tasks.some(task=>['taskSha256','baselineSha256'].some(k=>task[k]!==registration.workflow[k])||
    task.oracleSha256!==registration.oracleSha256))fail('ARM_BOOTSTRAP_POPULATION');
  const laneInput=arm=>Object.freeze({suite:fixture.suite,reviewedSourceFingerprint:fixture.reviewedSourceFingerprint,
    ...selected,...b.model,approval:Object.freeze({id:approval.id,expiresAtMs:approval.expiresAtMs}),arm,treatment:treatments[arm]});
  for(const arm of ['OFF','ON']){
    const description=describePlannedRepositoryTrialInputsV2(laneInput(arm),transportKind);
    if(profile.model!==description.model||profile.modelSettingsSha256!==description.modelSettingsSha256||
      profile.trialPolicy.version!==description.configuration.policy.version||profile.trialPolicy.sha256!==description.guidancePolicySha256)
      fail('ARM_BOOTSTRAP_MODEL_PROFILE');
  }
  // Last preflight reads only the explicit existing private directory. No build,
  // directory creation, transport owner or command listener has been started.
  const root=resolveExternalDemoStateV1(x.stateDirectory,sourceRoot);
  if(synchronous(deps.checkBuild(build,root))!==undefined)fail('ARM_BOOTSTRAP_BUILD');
  const schedule=Array.from({length:plan.repetitions},(_,repetition)=>plan.tasks.flatMap(task=>
    task.armOrder[repetition].split('_').map(arm=>({caseId:task.caseId,repetition,arm})))).flat();
  let state='READY',reason=null,command=null,report=null,session=null,cursor=0,runnerId=null;
  let cleanup='NOT_STARTED',setupStop=false,attempts=0,lanesClosed=0,lanesCleanupUnconfirmed=0;
  let constructionCleanupUnconfirmed=false;
  const lanes=[],reservations=new Set();
  function construct(factory,options,validate=()=>{}){
    try{const value=synchronous(factory(options));validate(value);return value;}
    catch(error){
      // A throwing/async factory returned no inspectable owner. Even if its
      // internal rollback succeeded, this outer layer cannot attest that fact.
      constructionCleanupUnconfirmed=true;throw error;
    }
  }
  function reserve(intent){
    if(state!=='RUNNING'||reason)fail('ARM_BOOTSTRAP_NOT_RUNNING');
    const issued=readScheduledPairedTrialIntentV1(intent),expected=schedule[cursor];
    if(issued.plan.planSha256!==plan.planSha256||issued.profile.profileSha256!==profile.profileSha256||
      (runnerId!==null&&runnerId!==intent.runnerId)||!expected||
      Object.keys(expected).some(k=>expected[k]!==intent[k])||reservations.has(intent.requestId))fail('ARM_BOOTSTRAP_INTENT');
    runnerId??=intent.runnerId;reservations.add(intent.requestId);const ordinal=cursor++;attempts++;
    try{
      recheckExternalDemoStateV1(root,sourceRoot);
      const workspaceParentRoot=path.join(session,'workspace-'+ordinal),oracleParentRoot=path.join(session,'oracle-'+ordinal);
      fs.mkdirSync(workspaceParentRoot,{mode:0o700});fs.mkdirSync(oracleParentRoot,{mode:0o700});
      const host=construct(deps.createHost,{suite:fixture.suite,build,scope:'operator-exclusive-static-local-v1',targets:fixture.targets,
        parentRoot:workspaceParentRoot,...b.host},readIssuedRepositoryWorkflowIdentityV1);
      const oracle=construct(deps.createOracle,{registration,binding:{...registration.workflow,requestId:intent.requestId,
        profileSha256:profile.profileSha256,oracleSha256:registration.oracleSha256},parentRoot:oracleParentRoot,...b.oracle},readIssuedRepositoryTrialOracleV1);
      const lane=construct(deps.createLane,laneInput(intent.arm));
      // Own the lane before any later fallible check. Downstream admission can
      // still refuse; final cleanup will close this unused original lane.
      lanes.push(lane);checkRepositoryTrialIntentV2(intent,lane);
      return Object.freeze({host,lane,oracle});
    }catch(error){reason??=error?.code==='ARM_BOOTSTRAP_ASYNC_DEPENDENCY'?error.code:'ARM_BOOTSTRAP_RESERVATION_FAILED';
      throw Object.assign(Error(reason),{code:reason});}
  }
  function closeLanes(){
    cleanup='CONFIRMED';
    for(const lane of lanes){
      try{
        let snapshot=readIssuedLiveModelLaneV4(lane).snapshot;
        if(!snapshot.revoked){lane.revoke();snapshot=readIssuedLiveModelLaneV4(lane).snapshot;}
        if(!snapshot.revoked||snapshot.lifecycle.state!=='STOPPED'||snapshot.lifecycle.pendingTransports!==0||snapshot.lifecycle.recoveryRequired)
          lanesCleanupUnconfirmed++;
        else lanesClosed++;
      }catch{lanesCleanupUnconfirmed++;}
    }
    if(lanesCleanupUnconfirmed||constructionCleanupUnconfirmed)cleanup='UNCONFIRMED';
  }
  function inspect(...args){
    if(args.length)fail('ARM_BOOTSTRAP_ARGUMENTS');
    return cloneFreeze({schemaVersion:'nisi-reviewed-paired-arm-bootstrap-v1',state,reason,transportKind,
      expectedArms,reservationAttempts:attempts,lanesCreated:lanes.length,lanesClosed,lanesCleanupUnconfirmed,
      constructionCleanupUnconfirmed,cleanup,command:report,
      recorded:report?.recorded===true&&reason===null&&cleanup==='CONFIRMED',
      authorizing:false,resumable:false,measurementVerified:false,causalClaim:false,promotionEligible:false,
      actualDispatchCount:null,remoteExecutionStopped:'UNKNOWN'});
  }
  function requestStop(...args){
    if(args.length)fail('ARM_BOOTSTRAP_ARGUMENTS');
    if(state!=='RUNNING')return Object.freeze({status:'REFUSED',reason:'ARM_BOOTSTRAP_NOT_RUNNING',authorizing:false});
    if(command)return command.requestStop();
    const status=setupStop?'ALREADY_REQUESTED':'REQUESTED';setupStop=true;return Object.freeze({status,authorizing:false});
  }
  async function run(...args){
    if(args.length||state!=='READY')fail('ARM_BOOTSTRAP_ALREADY_RAN');
    state='RUNNING';
    try{
      const directory=recheckExternalDemoStateV1(root,sourceRoot);
      if(stableStringify(describeReviewedPairedArmEnvironmentV1({build,budgets:b}))!==stableStringify(environment))
        fail('ARM_BOOTSTRAP_ENVIRONMENT');
      session=fs.mkdtempSync(path.join(directory,'paired-arm-'));
      command=createPairedArmCommandOwnerV1({plan:rawPlan,profile:rawProfile,approval,now,observe,reserve,parentDirectory:session},
        {signalSource,mainIo:fs,sidecarIo:fs,inspectDirectory:inspectArmTrialDirectoryV1});
      const running=command.run();if(setupStop)command.requestStop();report=await running;
    }catch{reason??='ARM_BOOTSTRAP_SETUP_OR_RUN_FAILED';}
    finally{closeLanes();state='FINISHED';}
    return inspect();
  }
  return Object.freeze({run,requestStop,inspect});
}
