// Isolated Node24 test-only observation hooks. No production injection API.
// Proves four-owner construction, NOT four executed arms, consent or accounting.
import {registerHooks} from 'node:module';
import assert from 'node:assert/strict';
import path from 'node:path';
const key=Symbol.for('nisi.test.bootstrap.construction');
const state={intents:[],sets:[],makeCommand:null};globalThis[key]=state;
const runnerUrl=new URL('../../evaluation/paired-trial-runner-v1.mjs',import.meta.url).href;
const commandUrl=new URL('../../cli/paired-arm-command-owner.mjs',import.meta.url).href;
const replaceOnce=(source,before,after)=>{assert.equal(source.split(before).length,2);return source.replace(before,after);};
registerHooks({load(url,context,nextLoad){
  const result=nextLoad(url,context);if(![runnerUrl,commandUrl].includes(url))return result;
  let source=typeof result.source==='string'?result.source:Buffer.from(result.source).toString('utf8');
  if(url===runnerUrl)source=replaceOnce(source,
    'scheduledIntents.set(intent, Object.freeze({ intent, plan, profile }));',
    'scheduledIntents.set(intent, Object.freeze({ intent, plan, profile })); globalThis[Symbol.for("nisi.test.bootstrap.construction")].intents.push(intent);');
  else source='export function createPairedArmCommandOwnerV1(input){return globalThis[Symbol.for("nisi.test.bootstrap.construction")].makeCommand(input);}';
  return {...result,source};
}});
const {createPairedTrialRunnerV1,readScheduledPairedTrialIntentV1}=await import(runnerUrl);
const {readIssuedRepositoryWorkflowIdentityV1}=await import('../../hosts/repository/reviewed-workflow-v1.mjs');
const {readIssuedLiveModelLaneIdentityV4,readIssuedLiveModelLaneV4}=await import('../../hosts/repository/reviewed-live-model-v4.mjs');
const {bootstrapContext}=await import('./paired-arm-bootstrap-fixture.mjs');
const cleanups=[],mode=process.argv[2],allowed=['four','copy','out-of-order','duplicate'];assert(allowed.includes(mode));
const c=await bootstrapContext({after:fn=>cleanups.push(fn)});
state.makeCommand=input=>({async run(){
  const runner=createPairedTrialRunnerV1({plan:input.plan,profile:input.profile,host:{
    verifyInputs(){throw Error('EXECUTION_FORBIDDEN');},startExecutor(){throw Error('EXECUTION_FORBIDDEN');},
    startOracle(){throw Error('EXECUTION_FORBIDDEN');},async retain(event){if(event.type==='SCHEDULE')runner.requestStop();},
  }});
  const report=await runner.run();assert.equal(report.counts.executorStarted,0);
  assert.equal(state.intents.length,4);
  for(const intent of state.intents)assert.strictEqual(readScheduledPairedTrialIntentV1(intent).intent,intent);
  if(mode==='copy')input.reserve(structuredClone(state.intents[0]));
  else if(mode==='out-of-order')input.reserve(state.intents[1]);
  else {
    for(const intent of state.intents){
      state.sets.push(input.reserve(intent));
      if(mode==='duplicate')input.reserve(intent);
    }
  }
  return {recorded:false,scope:'TEST_CONSTRUCTION_ONLY_NO_EXECUTION'};
},requestStop(){throw Error('UNEXPECTED_STOP');}});
try{
  const result=await c.create().run(),expected=mode==='four'?4:mode==='duplicate'?1:0;
  assert.equal(state.sets.length,expected);assert.equal(result.lanesCreated,expected);assert.equal(result.lanesClosed,expected);
  assert.equal(result.recorded,false);assert.equal(result.lanesCleanupUnconfirmed,0);assert.equal(c.state.requests.length,0);
  if(mode==='four'){
    assert.equal(result.reason,null);const identities=[];
    for(const set of state.sets){
      const host=readIssuedRepositoryWorkflowIdentityV1(set.host),lane=readIssuedLiveModelLaneIdentityV4(set.lane);
      identities.push(set.host,host.staticOwner,host.testsOwner,set.lane,...lane.executionOwners,set.oracle);
      assert.equal(readIssuedLiveModelLaneV4(set.lane).snapshot.revoked,true);
    }
    assert.equal(identities.length,28);assert.equal(new Set(identities).size,28);
    assert.deepEqual(c.state.lanes.map(lane=>readIssuedLiveModelLaneV4(lane).treatment.arm),['ON','OFF','OFF','ON']);
    const roots=[...c.state.hosts,...c.state.oracles].map(row=>row.options.parentRoot);
    assert.equal(new Set(roots).size,8);assert.equal(new Set(roots.map(value=>path.dirname(value))).size,1);
    assert.deepEqual(c.state.hosts.map(row=>path.basename(row.options.parentRoot)),['workspace-0','workspace-1','workspace-2','workspace-3']);
    assert.deepEqual(c.state.oracles.map(row=>path.basename(row.options.parentRoot)),['oracle-0','oracle-1','oracle-2','oracle-3']);
  }else assert.equal(result.reason,'ARM_BOOTSTRAP_SETUP_OR_RUN_FAILED');
  process.stdout.write(JSON.stringify({mode,scope:'CONSTRUCTION_ONLY',owners:expected,modelRequests:0,executedArms:0,accepted:false})+'\n');
}finally{for(const cleanup of cleanups.reverse())await cleanup();}
