import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {bootstrapContext} from './helpers/paired-arm-bootstrap-fixture.mjs';
import {createReviewedPairedArmBootstrapV1} from '../hosts/repository/reviewed-paired-arm-bootstrap-v1.mjs';
import {readIssuedLiveModelLaneV4} from '../hosts/repository/reviewed-live-model-v4.mjs';
import {describePlannedRepositoryTrialInputsV2} from '../hosts/repository/paired-trial-projection-v2.mjs';
import {readPreventionExecutionProfileV1} from '../evaluation/prevention-execution-profile-v1.mjs';
import {readPreventionExperimentPlanV1} from '../evaluation/prevention-experiment-plan-v1.mjs';

for(const api of ['NATIVE_API','CHAT_COMPLETIONS'])for(const arm of ['OFF','ON'])
test(`${api}/${arm}: original owners run one fixed arm, retain it, and stop on unknown synthetic budget`,async t=>{
  const c=await bootstrapContext(t,{api,arm}),owner=c.create();
  assert.deepEqual(c.state.calls,['checkBuild']);assert.deepEqual(fs.readdirSync(c.root),[]);
  assert.equal(owner.inspect().state,'READY');assert.equal(owner.requestStop().status,'REFUSED');
  const result=await owner.run();
  assert.equal(result.state,'FINISHED');assert.equal(result.reason,null);assert.equal(result.recorded,true);
  assert.equal(result.expectedArms,4);assert.equal(result.reservationAttempts,1);
  assert.equal(result.lanesCreated,1);assert.equal(result.lanesClosed,1);assert.equal(result.lanesCleanupUnconfirmed,0);
  assert.equal(result.cleanup,'CONFIRMED');assert.equal(result.command.inspection.status,'OBSERVED');
  assert.equal(result.command.inspection.counts.COMPLETE,1);assert.equal(result.command.inspection.counts.NOT_STARTED,3);
  assert.deepEqual(c.state.calls,['checkBuild','host','oracle','lane']);assert.equal(c.state.requests.length,2);
  assert.equal(readIssuedLiveModelLaneV4(c.state.lanes[0]).snapshot.revoked,true);
  assert.equal(c.state.oracles[0].owner.inspect().state,'PUBLISHED');
  const workspace=c.state.hosts[0].options.parentRoot,oracle=c.state.oracles[0].options.parentRoot;
  assert.equal(path.basename(workspace),'workspace-0');assert.equal(path.basename(oracle),'oracle-0');
  assert.equal(path.dirname(workspace),path.dirname(oracle));assert.equal(path.dirname(path.dirname(workspace)),fs.realpathSync(c.root));
  const session=path.dirname(workspace),trial=fs.readdirSync(session).find(name=>name.startsWith('nisi-trial-'));
  const retained=fs.readFileSync(path.join(session,trial,'events.jsonl'),'utf8').trimEnd().split('\n').map(JSON.parse);
  assert.equal(retained.at(-1).event.stopReason,'RUNNER_REPORTED_BUDGET_UNCONFIRMED');
  assert.equal(result.measurementVerified,false);assert.equal(result.actualDispatchCount,null);assert.equal(result.remoteExecutionStopped,'UNKNOWN');
  assert(!JSON.stringify(result).includes(c.root));assert(!JSON.stringify(result).includes('synthetic.author'));
  await assert.rejects(owner.run(),{code:'ARM_BOOTSTRAP_ALREADY_RAN'});assert.equal(owner.requestStop().status,'REFUSED');
  assert.equal(c.signalSource.eventNames().length,0);
});

for(const [label,mutate] of [
  ['extra key',c=>{c.input.extra=true;}],['selection',c=>{c.input.selection.author.api='BAD';}],
  ['treatment',c=>{c.input.treatments.ON={...c.input.treatments.ON};}],
  ['budget',c=>{c.input.budgets.model.timeoutMs=0;}],['environment',c=>{c.input.build.extra=true;}],
  ['approval',c=>{c.input.approval.profileSha256='0'.repeat(64);} ],
  ['state path',c=>{c.input.stateDirectory='relative';}],['signals',c=>{c.dependencies.signalSource={};}],
])test(`preflight rejects ${label} without owner construction, callbacks, storage or listeners`,async t=>{
  const c=await bootstrapContext(t);mutate(c);assert.throws(c.create);
  assert.deepEqual(c.state.calls,[]);assert.deepEqual(c.state.observations,[]);assert.deepEqual(c.state.requests,[]);
  assert.deepEqual(fs.readdirSync(c.root),[]);assert.deepEqual(c.signalSource.eventNames(),[]);
});

test('production path rejects test fixture build/profile without executing or allocating',async t=>{
  const c=await bootstrapContext(t),x=c.input;
  const description=describePlannedRepositoryTrialInputsV2({suite:c.fixture.suite,reviewedSourceFingerprint:c.fixture.reviewedSourceFingerprint,
    ...x.selection,...x.budgets.model,approval:{id:x.approval.id,expiresAtMs:x.approval.expiresAtMs},arm:'ON',treatment:x.treatments.ON});
  x.profile.model=description.model;x.profile.modelSettingsSha256=description.modelSettingsSha256;
  const plan=readPreventionExperimentPlanV1(x.plan);
  x.approval.profileSha256=readPreventionExecutionProfileV1(x.profile,plan.planSha256,plan.policy).profileSha256;
  assert.throws(()=>createReviewedPairedArmBootstrapV1(x),{code:'ARM_BOOTSTRAP_BUILD'});
  assert.deepEqual(c.state.calls,[]);assert.deepEqual(fs.readdirSync(c.root),[]);
});

for(const rejected of [false,true])for(const stage of ['checkBuild','createHost','createOracle','createLane'])
test(`${stage} ${rejected?'rejected':'resolved'} native Promise is observed and cannot advance construction`,async t=>{
  const c=await bootstrapContext(t),events=[];
  for(const name of ['checkBuild','createHost','createOracle','createLane']){
    const original=c.dependencies[name];c.dependencies[name]=(...args)=>{
      events.push(name);if(name===stage)return rejected?Promise.reject(Error('PRIVATE_ERROR')):Promise.resolve(undefined);
      return original(...args);
    };
  }
  if(stage==='checkBuild')assert.throws(c.create,{code:'ARM_BOOTSTRAP_ASYNC_DEPENDENCY'});
  else {const result=await c.create().run();assert.equal(result.recorded,false);assert.equal(result.reason,'ARM_BOOTSTRAP_ASYNC_DEPENDENCY');
    assert.equal(result.constructionCleanupUnconfirmed,true);assert.equal(result.cleanup,'UNCONFIRMED');}
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(events,['checkBuild','createHost','createOracle','createLane'].slice(0,['checkBuild','createHost','createOracle','createLane'].indexOf(stage)+1));
  assert.equal(c.state.requests.length,0);
});

for(const stage of ['createHost','createOracle'])test(`unissued ${stage} stops before later factories`,async t=>{
  const c=await bootstrapContext(t);c.dependencies[stage]=()=>({});
  const result=await c.create().run();assert.equal(result.recorded,false);assert.equal(result.reason,'ARM_BOOTSTRAP_RESERVATION_FAILED');
  assert.equal(result.constructionCleanupUnconfirmed,true);assert.equal(result.cleanup,'UNCONFIRMED');
  assert.equal(c.state.lanes.length,0);assert.equal(c.state.requests.length,0);
  if(stage==='createHost')assert.equal(c.state.oracles.length,0);
});

test('downstream admission refusal closes the original unused lane without model requests',async t=>{
  const c=await bootstrapContext(t);
  c.state.observe=(_arg,value)=>c.state.lanes.length?{...value,consent:{...value.consent,revoked:true}}:value;
  const result=await c.create().run();
  assert.equal(result.lanesCreated,1);assert.equal(result.lanesClosed,1);assert.equal(result.cleanup,'CONFIRMED');
  assert.equal(c.state.requests.length,0);assert.equal(readIssuedLiveModelLaneV4(c.state.lanes[0]).snapshot.revoked,true);
});

test('changed injected build after preflight refuses before session creation',async t=>{
  const c=await bootstrapContext(t),owner=c.create();c.input.build.changed=true;
  const result=await owner.run();assert.equal(result.recorded,false);assert.equal(result.reservationAttempts,0);
  assert.deepEqual(fs.readdirSync(c.root),[]);
});

test('malformed returned lane cannot report cleanup confirmed or continue',async t=>{
  const c=await bootstrapContext(t);c.dependencies.createLane=()=>({revoke(){throw Error('PRIVATE_ERROR');}});
  const result=await c.create().run();assert.equal(result.recorded,false);assert.equal(result.lanesCreated,1);
  assert.equal(result.lanesClosed,0);assert.equal(result.lanesCleanupUnconfirmed,1);assert.equal(result.cleanup,'UNCONFIRMED');
  assert.equal(c.state.requests.length,0);assert(!JSON.stringify(result).includes('PRIVATE_ERROR'));
});

for(const mode of ['four','copy','out-of-order','duplicate'])test(`isolated construction-only ${mode}: original issued intents and fresh identities, no execution`,()=>{
  const stdout=execFileSync(process.execPath,[new URL('./helpers/paired-arm-bootstrap-construction-child.mjs',import.meta.url).pathname,mode],
    {timeout:10000,encoding:'utf8',maxBuffer:1024*1024,env:{PATH:process.env.PATH,HOME:process.env.HOME}});
  const result=JSON.parse(stdout);assert.equal(result.mode,mode);assert.equal(result.modelRequests,0);assert.equal(result.executedArms,0);
  assert.equal(result.accepted,false);
});

test('state root identity change after session creation refuses before first owner construction, with no retry',async t=>{
  const c=await bootstrapContext(t),moved=c.root+'-moved';let swapped=false;
  c.state.observe=(_arg,value)=>{
    if(!swapped){swapped=true;fs.renameSync(c.root,moved);fs.mkdirSync(c.root,{mode:0o700});}
    return value;
  };
  try{
    const owner=c.create(),result=await owner.run();assert.equal(swapped,true);assert.equal(result.recorded,false);
    assert.equal(result.reason,'ARM_BOOTSTRAP_RESERVATION_FAILED');assert.equal(result.reservationAttempts,1);
    assert.deepEqual(c.state.calls,['checkBuild']);assert.equal(c.state.requests.length,0);
    const session=fs.readdirSync(moved).find(name=>name.startsWith('paired-arm-'));assert(session);
    assert(!fs.readdirSync(path.join(moved,session)).some(name=>/^(workspace|oracle)-/.test(name)));
    await assert.rejects(owner.run());assert.deepEqual(fs.readdirSync(c.root),[]);
  }finally{if(swapped){fs.rmdirSync(c.root);fs.renameSync(moved,c.root);}}
});

test('constructor snapshots selection, budgets, plan and factory methods before later caller mutation',async t=>{
  const c=await bootstrapContext(t),owner=c.create();
  c.input.selection.author.model='mutated';c.input.budgets.model.maxOutputTokens=1;c.input.plan.planId='changed';
  c.dependencies.createLane=()=>{throw Error('MUTATED_FACTORY');};
  const result=await owner.run();assert.equal(result.recorded,true);assert.equal(c.state.requests.length,2);
  assert.equal(readIssuedLiveModelLaneV4(c.state.lanes[0]).snapshot.configuration.maxOutputTokens,512);
  assert(!JSON.stringify(c.state.requests).includes('mutated'));
});

test('setup signal and in-flight user stop close only original owners',async t=>{
  const setup=await bootstrapContext(t);
  const original=setup.signalSource.on.bind(setup.signalSource);
  setup.signalSource.on=function(signal,listener){original(signal,listener);this.emit('SIGTERM');return this;};
  const first=await setup.create().run();assert.equal(first.recorded,true);assert.equal(first.lanesCreated,0);
  assert.equal(first.command.firstSignal,'SIGTERM');assert.equal(setup.state.requests.length,0);
  let active,owner;
  active=await bootstrapContext(t,{onRequest(_request,response){owner.requestStop();return new Response(JSON.stringify(response));}});
  owner=active.create();const second=await owner.run();
  // A retained stop does not clear the adapter's sticky recovery uncertainty.
  assert.equal(second.recorded,false);assert.equal(second.command.retentionAcknowledged,true);
  assert.equal(second.cleanup,'UNCONFIRMED');assert.equal(second.lanesCleanupUnconfirmed,1);
  assert.equal(readIssuedLiveModelLaneV4(active.state.lanes[0]).snapshot.revoked,true);
  assert.equal(active.state.requests.length,1);assert.equal(active.state.oracles[0].owner.inspect().state,'NEW');
});
