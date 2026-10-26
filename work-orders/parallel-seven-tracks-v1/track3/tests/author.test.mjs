import test from 'node:test';
import assert from 'node:assert/strict';
import {readPreventionExperimentPlanV1 as read} from '../src/prevention-experiment-plan-v1.mjs';

const d = character => character.repeat(64);
const fixture = () => ({
  schemaVersion:'nisi-prevention-experiment-plan-v1', planId:'plan.one',
  policy:{version:'policy.v1',sha256:d('a'),influenceEnabled:false},
  proposer:'owner.author', acceptanceReviewer:'reviewer.independent',
  trainingDigests:[d('b')], repetitions:2,
  tasks:[{caseId:'case.one',taskSha256:d('c'),baselineSha256:d('d'),oracleSha256:d('e'),armOrder:['OFF_ON','ON_OFF']}],
  exclusions:[{code:'preexisting.failure',description:'Baseline fixture is invalid before either arm starts.'}],
  budget:{maxDurationMs:60000,maxModelCalls:4,maxInputTokens:10000,maxOutputTokens:4000},
  measuredTelemetry:'UNKNOWN_UNTIL_RUN'
});
const refused = (value, code) => assert.throws(() => read(value), {code});

test('accepted declaration is recursively frozen, copied, nonauthorizing, and makes no result claim', () => {
  const input=fixture(), result=read(input);
  assert.equal(result.status,'DECLARED'); assert.equal(result.preventionResult,null);
  assert.equal(result.promotionEligible,false); assert.equal(result.influenceEnabled,false); assert.equal(result.authorizing,false);
  assert.equal(result.measuredTelemetry,'UNKNOWN_UNTIL_RUN'); assert.match(result.planSha256,/^[a-f0-9]{64}$/);
  const visit=value=>{if(value&&typeof value==='object'){assert(Object.isFrozen(value));for(const child of Object.values(value))visit(child);}};
  visit(result); assert.notEqual(result.tasks,input.tasks); assert.notEqual(result.tasks[0],input.tasks[0]);
  input.tasks[0].caseId='changed'; assert.equal(result.tasks[0].caseId,'case.one');
  assert.throws(()=>{result.tasks[0].caseId='changed';},TypeError);
});

test('policy influence starts off and proposer cannot approve the plan', () => {
  let value=fixture(); value.policy.influenceEnabled=true; refused(value,'PLAN_INFLUENCE_MUST_BE_OFF');
  value=fixture(); value.acceptanceReviewer=value.proposer; refused(value,'PLAN_REVIEW_INDEPENDENCE');
});

test('training and held-out evaluation tasks are digest-disjoint and unique', () => {
  let value=fixture(); value.trainingDigests.push(value.trainingDigests[0]); refused(value,'PLAN_DUPLICATE_TRAINING');
  value=fixture(); value.tasks[0].taskSha256=value.trainingDigests[0]; refused(value,'PLAN_TRAINING_EVALUATION_OVERLAP');
  value=fixture(); value.tasks.push(structuredClone(value.tasks[0])); value.tasks[1].caseId='case.two'; refused(value,'PLAN_DUPLICATE_EVALUATION');
  value=fixture(); value.tasks.push(structuredClone(value.tasks[0])); value.tasks[1].taskSha256=d('f'); refused(value,'PLAN_DUPLICATE_TASK');
});

test('arm order is predeclared for every even repetition and exactly counterbalanced', () => {
  let value=fixture(); value.repetitions=3; value.tasks[0].armOrder.push('OFF_ON'); refused(value,'PLAN_COUNTERBALANCE');
  value=fixture(); value.tasks[0].armOrder=['OFF_ON','OFF_ON']; refused(value,'PLAN_COUNTERBALANCE');
  value=fixture(); value.tasks[0].armOrder=['OFF_ON']; refused(value,'PLAN_LIST');
  value=fixture(); value.tasks[0].armOrder[1]='OFF'; refused(value,'PLAN_ARM_ORDER');
});

test('exclusions and known budgets are predeclared while measurements remain unknown', () => {
  let value=fixture(); value.exclusions.push(structuredClone(value.exclusions[0])); refused(value,'PLAN_DUPLICATE_EXCLUSION');
  for(const key of ['maxDurationMs','maxModelCalls','maxInputTokens','maxOutputTokens']){
    value=fixture(); value.budget[key]=null; refused(value,'PLAN_NATURAL');
    value=fixture(); value.budget[key]=-0; refused(value,'PLAN_NATURAL');
  }
  value=fixture(); value.measuredTelemetry={input:0}; refused(value,'PLAN_TELEMETRY_BOUNDARY');
});

test('exact plain data descriptors reject accessors symbols hidden fields arrays and prototype surprises without invocation', () => {
  let calls=0,value=fixture(); Object.defineProperty(value,'planId',{enumerable:true,get(){calls++;return 'plan.one';}}); refused(value,'PLAN_DESCRIPTOR');
  value=fixture(); value[Symbol('extra')]=true; refused(value,'PLAN_FIELDS');
  value=fixture(); Object.defineProperty(value.policy,'version',{value:'policy.v1',enumerable:false}); refused(value,'PLAN_DESCRIPTOR');
  value=fixture(); value.tasks.extra=true; refused(value,'PLAN_LIST_SHAPE');
  value=fixture(); Object.setPrototypeOf(value.tasks[0],{surprise:true}); refused(value,'PLAN_RECORD');
  assert.equal(calls,0);
});

test('caller mutation cannot change the plan hash and each experimental variable changes it', () => {
  const original=fixture(), accepted=read(original), baseline=accepted.planSha256;
  original.policy.version='changed'; original.tasks[0].oracleSha256=d('f'); assert.equal(accepted.planSha256,baseline);
  const changes=[
    value=>{value.planId='plan.two';}, value=>{value.policy.version='policy.v2';}, value=>{value.policy.sha256=d('f');},
    value=>{value.proposer='owner.other';}, value=>{value.acceptanceReviewer='reviewer.other';}, value=>{value.trainingDigests=[d('f')];},
    value=>{value.tasks[0].caseId='case.two';}, value=>{value.tasks[0].taskSha256=d('f');}, value=>{value.tasks[0].baselineSha256=d('f');},
    value=>{value.tasks[0].oracleSha256=d('f');}, value=>{value.tasks[0].armOrder=['ON_OFF','OFF_ON'];},
    value=>{value.repetitions=4;value.tasks[0].armOrder=['OFF_ON','ON_OFF','ON_OFF','OFF_ON'];},
    value=>{value.exclusions[0].description='A different predeclared exclusion.';}, value=>{value.budget.maxDurationMs++;}
  ];
  for(const change of changes){const value=fixture();change(value);assert.notEqual(read(value).planSha256,baseline);}
});

test('identifier digest schema and inventory bounds are strict', () => {
  let value=fixture(); value.schemaVersion='nisi-prevention-experiment-plan-v2'; refused(value,'PLAN_SCHEMA');
  value=fixture(); value.tasks=[]; refused(value,'PLAN_LIST');
  value=fixture(); value.planId='Bad'; refused(value,'PLAN_IDENTIFIER');
  value=fixture(); value.policy.sha256='A'.repeat(64); refused(value,'PLAN_DIGEST');
  value=fixture(); value.extra=true; refused(value,'PLAN_FIELDS');
});

test('all digests reject terminal newlines and repetitions have an explicit planning cap', () => {
  for(const mutate of [v=>{v.policy.sha256+='\n';},v=>{v.trainingDigests[0]+='\n';},
    v=>{v.tasks[0].taskSha256+='\n';},v=>{v.tasks[0].baselineSha256+='\n';},v=>{v.tasks[0].oracleSha256+='\n';}]){
    const value=fixture();mutate(value);refused(value,'PLAN_DIGEST');
  }
  const value=fixture();value.repetitions=34;
  value.tasks[0].armOrder=Array.from({length:34},(_,i)=>i%2?'ON_OFF':'OFF_ON');
  refused(value,'PLAN_REPETITION_LIMIT');
});
