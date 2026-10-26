// Test-only owners: synthetic HTTP/Swift/workflow checks, real fixed Node oracle.
// No native build, model server, unregistered source or permission change.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {createReviewedRepositoryOracleV1,readIssuedRepositoryOracleV1} from '../../examples/repository-task/reviewed-oracle-fixture-v1.mjs';
import {registerRepairGuidanceV1} from '../../adapters/repair-guidance-v1.mjs';
import {createReviewedLiveModelLaneWithTransportV4} from '../../hosts/repository/reviewed-live-model-v4.mjs';
import {describePlannedRepositoryTrialInputsV2} from '../../hosts/repository/paired-trial-projection-v2.mjs';
import {describeReviewedPairedArmEnvironmentV1,createReviewedPairedArmBootstrapWithDependenciesV1} from '../../hosts/repository/reviewed-paired-arm-bootstrap-v1.mjs';
import {createRepositoryTrialOracleV1} from '../../hosts/repository/paired-trial-oracle-v1.mjs';
import {createRepositoryWorkflowOwnerV1} from '../../hosts/repository/reviewed-workflow-v1.mjs';
import {readPreventionExperimentPlanV1} from '../../evaluation/prevention-experiment-plan-v1.mjs';
import {readPreventionExecutionProfileV1} from '../../evaluation/prevention-execution-profile-v1.mjs';
import {createSwiftCheckPlanV1} from '../../hosts/swift-verifier/check-plan-v1.mjs';
import {createSwiftStaticGroupV1} from '../../receipts/swift-static-group-v1.mjs';
import {nodeTestAdapterResultV1} from '../../hosts/repository/node-executor-v1.mjs';
import {materializeRepositoryCandidateV1,TASK_WORKSPACE_PROFILE} from '../../hosts/repository/task-workspace-v1.mjs';
import {syntheticNode,targetsFor} from './repository-run-fixture.mjs';
import {failing,passing} from './node-repository-fixture.mjs';
import {entry,profile as staticProfile} from './swift-group-fixture.mjs';
import {selection} from './live-model-v3-fixture.mjs';

export async function bootstrapContext(t,{api='NATIVE_API',arm='ON',onRequest}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nisi-bootstrap-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const registration=await createReviewedRepositoryOracleV1(),fixture=readIssuedRepositoryOracleV1(registration).workflow;
  const selected={author:selection('author',api),reviewer:selection('reviewer',api)};
  const treatments=Object.fromEntries(['OFF','ON'].map(arm=>[arm,registerRepairGuidanceV1({arm,api,binding:{
    taskFingerprint:fixture.preparations[0].taskFingerprint,baselineFingerprint:fixture.baseline.fingerprint,
    suiteFingerprint:fixture.suite.fingerprint,reviewedSourceFingerprint:fixture.reviewedSourceFingerprint}})]));
  const build={schemaVersion:'SYNTHETIC_NOT_A_NATIVE_BUILD'};
  const budgets={model:{timeoutMs:1000,maxOutputTokens:512},host:{staticTimeoutMs:1000,totalTestTimeoutMs:2000,
    testTimeoutMs:1000,closeGraceMs:500,materializationTimeoutMs:5000},
    oracle:{materializationTimeoutMs:5000,totalTimeoutMs:5000,childTimeoutMs:3000,closeGraceMs:500}};
  const d=describePlannedRepositoryTrialInputsV2({suite:fixture.suite,reviewedSourceFingerprint:fixture.reviewedSourceFingerprint,
    ...selected,...budgets.model,approval:{id:'synthetic.bootstrap',expiresAtMs:10000},arm,treatment:treatments[arm]},'INJECTED_TEST_TRANSPORT');
  const rawPlan={schemaVersion:'nisi-prevention-experiment-plan-v1',planId:'plan.bootstrap',
    policy:{version:d.configuration.policy.version,sha256:d.guidancePolicySha256,influenceEnabled:false},
    proposer:'fixture.author',acceptanceReviewer:'fixture.reviewer',trainingDigests:[],
    tasks:[{caseId:'repository.bootstrap',taskSha256:d.taskSha256,baselineSha256:d.baselineSha256,
      oracleSha256:registration.oracleSha256,armOrder:arm==='ON'?['ON_OFF','OFF_ON']:['OFF_ON','ON_OFF']}],
    repetitions:2,exclusions:[],measuredTelemetry:'UNKNOWN_UNTIL_RUN',
    budget:{maxDurationMs:30000,maxModelCalls:100,maxInputTokens:1000,maxOutputTokens:1000}};
  const plan=readPreventionExperimentPlanV1(rawPlan),environment=describeReviewedPairedArmEnvironmentV1({build,budgets});
  const rawProfile={schemaVersion:'nisi-prevention-execution-profile-v1',planSha256:plan.planSha256,
    model:d.model,modelSettingsSha256:d.modelSettingsSha256,toolchainSha256:environment.toolchainSha256,
    resourceBudgetSha256:environment.resourceBudgetSha256,trialPolicy:{version:d.configuration.policy.version,sha256:d.guidancePolicySha256},
    executorTimeoutMs:10000,oracleTimeoutMs:10000,retentionTimeoutMs:1000,drainTimeoutMs:100};
  const profile=readPreventionExecutionProfileV1(rawProfile,plan.planSha256,plan.policy);
  const approval={id:'synthetic.bootstrap',ownerId:'fixture.owner',planSha256:plan.planSha256,
    profileSha256:profile.profileSha256,expiresAtMs:10000,priority:'FOREGROUND'};
  const state={now:100,calls:[],requests:[],hosts:[],oracles:[],lanes:[],observations:[],observe:null};
  function observe(arg){
    const {intent,now}=arg;
    const result={consent:{...approval,grantedAtMs:0,revoked:false,scope:'execute'},
      scheduler:{decision:'ALLOW',observedAtMs:now,freshnessMs:1000,queueState:'ACTIVE'},
      capacity:{configuredSlots:1,measuredFreeSlots:1,measuredAtMs:now,freshnessMs:1000},
      host:{state:'IDLE',pendingTransports:0,observedAtMs:now},
      custody:{taskSha256:intent.taskSha256,baselineSha256:intent.baselineSha256,oracleSha256:intent.oracleSha256,
        suiteFingerprint:d.suiteFingerprint,reviewedSourceFingerprint:d.reviewedSourceFingerprint,
        toolchainSha256:intent.toolchainSha256,resourceBudgetSha256:intent.resourceBudgetSha256,observedAtMs:now,freshnessMs:1000}};
    delete result.consent.priority;
    state.observations.push(arg);return state.observe?state.observe(arg,result):result;
  }
  const signalSource=new EventEmitter();
  const dependencies={signalSource,checkBuild(){state.calls.push('checkBuild');},createHost(options){
    state.calls.push('host');const workspaces=[],staticHistory=[],testHistory=[];
    const node=syntheticNode({suite:fixture.suite,workspace:async variant=>{
      const workspace=await materializeRepositoryCandidateV1({preparation:fixture.preparations[variant],parentRoot:options.parentRoot,profile:TASK_WORKSPACE_PROFILE});
      workspaces.push(workspace);return workspace;
    }});
    const observationOwner=history=>({settled:async()=>Object.freeze([...history]),observations:()=>Object.freeze([...history]),
      status:()=> 'IDLE',lateObservations:()=>Object.freeze([])});
    const staticOwner={...observationOwner(staticHistory),check(payload){
      const preparation=fixture.preparations.find(p=>p.candidateFingerprint===payload.binding.candidateFingerprint);
      const plan=createSwiftCheckPlanV1({preparation,runId:payload.binding.runId,attempt:payload.binding.attempt,
        targets:targetsFor(preparation),executionProfile:staticProfile});
      const group=createSwiftStaticGroupV1(plan,plan.targets.map((_,i)=>entry(plan,i)));
      staticHistory.push(Object.freeze({plan,group,error:null}));return group.adapterResult;
    }};
    const testsOwner={...observationOwner(testHistory),registrationFingerprint:node.executor.registrationFingerprint,async run(payload){
      const variant=fixture.preparations[0].candidateFingerprint===payload.binding.candidateFingerprint?0:1;
      const execution=await node.execute(payload,variant,variant===0?failing():passing()),adapterResult=nodeTestAdapterResultV1(execution);
      testHistory.push(Object.freeze({execution,adapterResult,preparation:fixture.preparations[variant],workspace:workspaces.at(-1),error:null}));return adapterResult;
    }};
    const host=createRepositoryWorkflowOwnerV1({suite:fixture.suite,staticOwner,testsOwner});
    state.hosts.push({owner:host,options});return host;
  },createOracle(options){state.calls.push('oracle');const oracle=createRepositoryTrialOracleV1(options);state.oracles.push({owner:oracle,options});return oracle;},
  createLane(options){
    state.calls.push('lane');
    const transport=role=>async(_url,request)=>{
      const body=JSON.parse(request.body),output=role==='author'?{status:'REPAIRED',candidate:{files:fixture.preparations[1].candidate.files},note:'Synthetic response'}:
        {findings:[],summary:'Synthetic review'};
      const response=options[role].api==='NATIVE_API'?{model_instance_id:options[role].expectedModelInstance,
        output:[{type:'message',content:JSON.stringify(output)}],stats:{input_tokens:10,total_output_tokens:5,reasoning_output_tokens:0,
          tokens_per_second:10,time_to_first_token_seconds:0.1}}:
        {model:body.model,choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}};
      state.requests.push({role,body});return onRequest?onRequest({role,body,request},response):new Response(JSON.stringify(response));
    };
    const lane=createReviewedLiveModelLaneWithTransportV4(options,{author:transport('author'),reviewer:transport('reviewer')},()=>state.now);
    state.lanes.push(lane);return lane;
  }};
  const input={plan:rawPlan,profile:rawProfile,approval,now:()=>state.now,observe,registration,build,
    selection:selected,treatments,budgets,stateDirectory:root};
  return {input,dependencies,state,root,signalSource,fixture,description:d,
    create:()=>createReviewedPairedArmBootstrapWithDependenciesV1(input,dependencies)};
}
