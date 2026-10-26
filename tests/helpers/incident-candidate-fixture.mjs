// Original-issued repository evidence fixtures for incident projection tests.
// Swift/Node process observations are synthetic; no native program is executed.
import {runWorkflow,createCandidate} from '../../workflow/engine.mjs';
import {prepareRepositoryCandidate} from '../../hosts/repository/snapshot-contract.mjs';
import {registerReviewedNodeSuiteV1} from '../../hosts/repository/node-suite-v1.mjs';
import {createSwiftCheckPlanV1} from '../../hosts/swift-verifier/check-plan-v1.mjs';
import {createSwiftStaticGroupV1} from '../../receipts/swift-static-group-v1.mjs';
import {nodeTestAdapterResultV1} from '../../hosts/repository/node-executor-v1.mjs';
import {materializeRepositoryCandidateV1,TASK_WORKSPACE_PROFILE} from '../../hosts/repository/task-workspace-v1.mjs';
import {context,passing,failing} from './node-repository-fixture.mjs';
import {fixedOptions,syntheticNode,targetsFor} from './repository-run-fixture.mjs';
import {entry,profile,undispatched} from './swift-group-fixture.mjs';

async function runOwned(t,{storeFailure=false,mixedStatic=false}={}) {
  const c=await context(t,{repairBudget:mixedStatic?0:1});
  if(storeFailure){c.task={...c.task,policy:{...c.task.policy,requireReportStore:true}};c.preparations=c.preparations.map(p=>prepareRepositoryCandidate({baseline:c.baseline,task:c.task,candidate:{files:p.candidate.files},authorId:p.candidate.authorId}));c.suite=registerReviewedNodeSuiteV1({...c.registration,preparations:c.preparations});c.workspace=n=>materializeRepositoryCandidateV1({preparation:c.preparations[n],parentRoot:c.parent,profile:TASK_WORKSPACE_PROFILE});}
  const plans=[],groups=[],executions=[],node=syntheticNode(c),options=fixedOptions(c);
  if(mixedStatic)options.author.draft=p=>{const candidate=createCandidate({files:c.preparations[0].candidate.files},{authorId:'author.fixed-fixture'});return{candidate:{files:candidate.files},evidence:{...p.binding,candidateFingerprint:candidate.fingerprint,note:'Synthetic fixed input'}};};
  const report=await runWorkflow(c.task,{clock:()=>0,...(storeFailure?{reportStore:{store:()=>{throw Error('synthetic store');}}}:{}),adapters:{...options,staticChecks:{check:p=>{
    const prep=c.preparations.find(x=>x.candidateFingerprint===p.binding.candidateFingerprint),plan=createSwiftCheckPlanV1({preparation:prep,runId:p.binding.runId,attempt:p.binding.attempt,targets:targetsFor(prep),executionProfile:profile});
    const children=plan.targets.map((_,i)=>mixedStatic ? i===0 ? entry(plan,i,'FAIL') : i===1 ? entry(plan,i,'ERROR') : undispatched('CHILD_UNAVAILABLE') : entry(plan,i,'PASS'));
    const group=createSwiftStaticGroupV1(plan,children,mixedStatic?'CHILD_UNAVAILABLE':null);plans.push(plan);groups.push(group);return group.adapterResult;
  }},tests:{run:async p=>{const variant=c.preparations[0].candidateFingerprint===p.binding.candidateFingerprint?0:1,execution=await node.execute(p,variant,variant===0?failing():passing());executions.push(execution);return nodeTestAdapterResultV1(execution);}}}});
  const preparation=c.preparations.find(p=>p.candidateFingerprint===report.candidateFingerprint);
  return{c,context:{report,plans,groups,executions,suite:c.suite,nodeRegistrationFingerprint:node.executor.registrationFingerprint,preparation}};
}

export const incidentStorageFailureFixture=t=>runOwned(t,{storeFailure:true});
export const mixedStaticOperationalFixture=t=>runOwned(t,{mixedStatic:true});
