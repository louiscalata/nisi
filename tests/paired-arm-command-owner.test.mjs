import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {EventEmitter} from 'node:events';
import {pairedArmContext} from './helpers/paired-arm-owner-fixture.mjs';
import {createPairedArmCommandOwnerV1} from '../cli/paired-arm-command-owner.mjs';
import {inspectArmTrialDirectoryV1} from '../cli/paired-arm-inspect.mjs';

async function context(t,options={}){
  const parentDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'nisi-arm-command-'));
  t.after(()=>fs.rmSync(parentDirectory,{recursive:true,force:true}));
  const c=await pairedArmContext(t,{...options,workspaceParentRoot:parentDirectory});
  const {retain:_a,retainAdmission:_b,...source}=c.input;
  const input={...source,parentDirectory},signalSource=new EventEmitter(),mainIo={...fs},sidecarIo={...fs};
  const inspectors={inspectDirectory:inspectArmTrialDirectoryV1};
  return {c,input,parentDirectory,signalSource,mainIo,sidecarIo,inspectors,
    create:()=>createPairedArmCommandOwnerV1(input,{signalSource,mainIo,sidecarIo,inspectDirectory:inspectors.inspectDirectory})};
}
const trialDirs=c=>fs.readdirSync(c.parentDirectory).filter(x=>x.startsWith('nisi-trial-'));
function cleanReport(report){
  assert(Object.isFrozen(report));assert.equal(report.remoteExecutionStopped,'UNKNOWN');
  assert.equal(report.authorizing,false);assert.equal(report.resumable,false);
  assert.equal(report.actualDispatchCount,null);assert.equal(report.measurementVerified,false);
  for(const forbidden of ['synthetic.author','synthetic.reviewer','fixture.owner','candidateText','ownerSetId','requestId','PRIVATE_SECRET'])
    assert(!JSON.stringify(report).includes(forbidden),forbidden);
}

test('original durable owner is single-use, projects bounded observations, preserves legacy trust flags',async t=>{
  const x=await context(t),owner=x.create();
  assert.equal(owner.inspect().state,'READY');assert.equal(owner.requestStop().status,'REFUSED');
  const result=await owner.run();cleanReport(result);
  assert.equal(result.recorded,true);assert.equal(result.retentionAcknowledged,true);
  assert.equal(result.inspection.status,'OBSERVED');assert.equal(x.c.requests.length,2);
  assert.equal(result.cleanup.storage,'CLOSED');assert.equal(result.cleanup.signals,'REMOVED');
  assert(!JSON.stringify(result).includes(x.parentDirectory));assert.strictEqual(owner.inspect(),result);
  assert.equal(owner.requestStop().status,'REFUSED');await assert.rejects(owner.run(),{code:'ARM_COMMAND_ALREADY_RAN'});
  assert.equal(x.signalSource.eventNames().length,0);assert.equal(trialDirs(x).length,1);
});

test('invalid input and call arguments do not install listeners or create trial storage',async t=>{
  const x=await context(t);let reads=0;
  Object.defineProperty(x.input,'reserve',{enumerable:true,get(){reads++;}});
  assert.throws(x.create);assert.equal(reads,0);assert.equal(x.signalSource.eventNames().length,0);assert.deepEqual(trialDirs(x),[]);
  const y=await context(t),owner=y.create();
  await assert.rejects(owner.run('unexpected'),{code:'ARM_COMMAND_ARGUMENTS'});
  assert.throws(()=>owner.inspect(1));assert.throws(()=>owner.requestStop(1));assert.equal(owner.inspect().state,'READY');
});

for(const signal of ['SIGINT','SIGTERM'])test(`setup ${signal} is latched through both listener boundaries`,async t=>{
  const x=await context(t),other=()=>{};x.signalSource.on(signal,other);
  x.signalSource.on=function(name,fn){EventEmitter.prototype.on.call(this,name,fn);this.emit(signal);return this;};
  const owner=x.create(),result=await owner.run();cleanReport(result);
  assert.equal(result.setupStop,true);assert.equal(result.firstSignal,signal);assert.equal(result.recorded,true);
  assert.equal(result.inspection.status,'OBSERVED');assert.equal(x.c.requests.length,0);
  assert.deepEqual(x.signalSource.rawListeners(signal),[other]);
});

for(const mode of ['throw-first','throw-second','silent'])test(`listener install ${mode} creates no stores and preserves unrelated listeners`,async t=>{
  const x=await context(t),other=()=>{};x.signalSource.on('SIGINT',other);
  x.signalSource.on=function(signal,fn){
    if(mode==='silent')return this;
    EventEmitter.prototype.on.call(this,signal,fn);
    if(signal===(mode==='throw-first'?'SIGINT':'SIGTERM'))throw Error('PRIVATE_SECRET');return this;
  };
  const result=await x.create().run();cleanReport(result);
  assert.equal(result.reason,'ARM_COMMAND_SIGNAL_INSTALL');assert.equal(result.recorded,false);
  assert.equal(result.inspection,null);assert.equal(result.cleanup.signals,'REMOVED');
  assert.equal(x.c.requests.length,0);assert.deepEqual(trialDirs(x),[]);
  assert.deepEqual(x.signalSource.rawListeners('SIGINT'),[other]);assert.equal(x.signalSource.listenerCount('SIGTERM'),0);
});

for(const lane of ['main','sidecar'])test(`${lane} store creation signal stops before dispatch`,async t=>{
  const x=await context(t),io=lane==='main'?x.mainIo:x.sidecarIo;let fired=false;
  io.openSync=(...args)=>{const fd=fs.openSync(...args);if(!fired){fired=true;x.signalSource.emit('SIGTERM');}return fd;};
  const result=await x.create().run();cleanReport(result);
  assert.equal(fired,true);assert.equal(result.setupStop,true);assert.equal(result.recorded,true);
  assert.equal(x.c.requests.length,0);assert.equal(result.inspection.status,'OBSERVED');
});

test('repeated and mixed signals during original execution request one cancellation with no oracle or redispatch',async t=>{
  let x,calls=0;
  x=await context(t,{onRequest(_request,response){
    calls++;x.signalSource.emit('SIGINT');x.signalSource.emit('SIGTERM');x.signalSource.emit('SIGINT');
    return new Response(JSON.stringify(response));
  }});
  const owner=x.create(),result=await owner.run();cleanReport(result);
  assert.equal(result.firstSignal,'SIGINT');assert.equal(calls,1);assert.equal(result.recorded,true);
  assert.equal(x.c.state.oracle.inspect().state,'NEW');assert.equal(result.remoteExecutionStopped,'UNKNOWN');
  const bytes=fs.readFileSync(path.join(x.parentDirectory,trialDirs(x)[0],'events.jsonl'));
  x.signalSource.emit('SIGTERM');assert.strictEqual(owner.inspect(),result);
  assert.deepEqual(fs.readFileSync(path.join(x.parentDirectory,trialDirs(x)[0],'events.jsonl')),bytes);
});

for(const [lane,marker] of [['main','"type":"SCHEDULE"'],['sidecar','"kind":"HEADER"'],
  ['sidecar','"kind":"PREPARED"'],['main','"type":"START_INTENT"'],
  ['sidecar','"kind":"PHASE_OBSERVED"'],['main','"type":"FINAL"'],['sidecar','"kind":"FINAL"']])
test(`signal during ${lane} retention ${marker} cannot overlap close`,async t=>{
  const x=await context(t),io=lane==='main'?x.mainIo:x.sidecarIo;let writing=false,triggered=false,overlap=false;
  io.writeSync=(...args)=>{writing=true;try{
    if(!triggered&&args[1].toString().includes(marker)){triggered=true;x.signalSource.emit('SIGTERM');}
    return fs.writeSync(...args);
  }finally{writing=false;}};
  io.closeSync=fd=>{if(writing)overlap=true;return fs.closeSync(fd);};
  const result=await x.create().run();cleanReport(result);
  assert.equal(triggered,true);assert.equal(overlap,false);assert.equal(result.recorded,true);
  assert.equal(result.firstSignal,'SIGTERM');assert.equal(result.cleanup.signals,'REMOVED');
});

for(const lane of ['main','sidecar'])test(`${lane} final close keeps handlers installed and uncertainty cannot become acknowledged`,async t=>{
  const x=await context(t),io=lane==='main'?x.mainIo:x.sidecarIo;let fileFd,closed=false;
  io.openSync=(...args)=>{const fd=fs.openSync(...args);if(args[0].endsWith('.jsonl'))fileFd=fd;return fd;};
  io.closeSync=fd=>{
    if(fd===fileFd){closed=true;assert.equal(x.signalSource.listenerCount('SIGINT'),1);
      assert.equal(x.signalSource.listenerCount('SIGTERM'),1);x.signalSource.emit('SIGINT');}
    fs.closeSync(fd);if(fd===fileFd)throw Error('PRIVATE_SECRET');
  };
  const result=await x.create().run();cleanReport(result);
  assert.equal(closed,true);assert.equal(result.recorded,false);assert.equal(result.retentionAcknowledged,false);
  assert.equal(result.cleanup.signals,'REMOVED');assert.equal(result.firstSignal,'SIGINT');
});

for(const lane of ['main','sidecar'])test(`${lane} creation failure retains evidence and never retries`,async t=>{
  const x=await context(t),io=lane==='main'?x.mainIo:x.sidecarIo;let opens=0;
  io.openSync=()=>{opens++;throw Error('PRIVATE_SECRET');};
  const owner=x.create(),result=await owner.run();cleanReport(result);
  assert.equal(result.recorded,false);assert.equal(x.c.requests.length,0);assert.equal(opens,1);
  assert.equal(result.cleanup.signals,'REMOVED');assert.equal(trialDirs(x).length,1);
  await assert.rejects(owner.run());assert.equal(opens,1);
});

for(const mode of ['throw','silent'])test(`listener removal ${mode} cannot report command recorded`,async t=>{
  const x=await context(t);
  x.signalSource.removeListener=function(signal,fn){
    if(mode==='throw'){EventEmitter.prototype.removeListener.call(this,signal,fn);throw Error('PRIVATE_SECRET');}
    return this;
  };
  const owner=x.create(),result=await owner.run();cleanReport(result);
  assert.equal(result.retentionAcknowledged,true);assert.equal(result.recorded,false);assert.equal(result.cleanup.signals,'UNCONFIRMED');
  x.signalSource.emit('SIGINT');assert.strictEqual(owner.inspect(),result);
  // Only this test's isolated fake emitter, never the process signal source.
  x.signalSource.removeAllListeners();
});

test('post-close missing bytes cannot erase historical ack or become accepted inspection',async t=>{
  const x=await context(t);let sideFd,sideFile;
  x.sidecarIo.openSync=(...args)=>{const fd=fs.openSync(...args);if(args[0].endsWith('.jsonl')){sideFd=fd;sideFile=args[0];}return fd;};
  x.sidecarIo.closeSync=fd=>{fs.closeSync(fd);if(fd===sideFd)fs.unlinkSync(sideFile);};
  const result=await x.create().run();cleanReport(result);
  assert.equal(result.retentionAcknowledged,true);assert.equal(result.recorded,false);assert.equal(result.inspectionObserved,false);
  assert.equal(result.inspection.status,'REFUSED');assert.equal(result.inspection.authorizing,false);
});

test('throwing inspector is captured once, cannot leak errors, and cannot erase historical ack',async t=>{
  const x=await context(t);let calls=0;
  x.inspectors.inspectDirectory=()=>{calls++;throw Error('PRIVATE_SECRET');};
  const owner=x.create();x.inspectors.inspectDirectory=()=>{throw Error('MUTATED_INSPECTOR');};
  const result=await owner.run();cleanReport(result);
  assert.equal(calls,1);assert.equal(result.retentionAcknowledged,true);assert.equal(result.recorded,false);
  assert.equal(result.inspectionObserved,false);assert.equal(result.inspection,null);
  assert.equal(result.reason,'ARM_COMMAND_INSPECTION_UNAVAILABLE');assert.equal(result.cleanup.signals,'REMOVED');
  assert.strictEqual(owner.inspect(),result);await assert.rejects(owner.run());assert.equal(calls,1);
});
