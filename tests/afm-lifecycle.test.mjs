// Synthetic child events only: no AFM, model, shell or native app is executed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {createAFMContentExecutor} from '../gate/afm-content-executor.mjs';
import {createOwnedChildObserver} from '../hosts/swift-verifier/owned-child.mjs';
import {createSwiftArtifactExecutor} from '../hosts/swift-verifier/executor.mjs';
import {ownedTemp} from './helpers/owned-temp.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function childFixture(t){
  const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();
  child.exitCode=null;child.signalCode=null;child.kills=[];child.stdin.end=()=>{};
  child.kill=signal=>{child.kills.push(signal);return false;};
  let launches=0,admissions=0;
  const original=cp.spawn;cp.spawn=()=>{launches++;queueMicrotask(()=>child.emit('spawn'));return child;};syncBuiltinESMExports();
  t.after(()=>{cp.spawn=original;syncBuiltinESMExports();});
  const root=ownedTemp(t,'nisi-afm-lifecycle-'),binary=path.join(root,'unexecuted-fixture');fs.writeFileSync(binary,'synthetic');
  const grant={admitContent(){admissions++;return {ok:true,bytes:Buffer.from('safe'),consentDigest:'a'.repeat(64),contentSha256:'b'.repeat(64),contentBytes:4,maxAdvisoryChars:32,kind:'text'};}};
  const made=createAFMContentExecutor({binary,binarySHA256:createHash('sha256').update('synthetic').digest('hex'),grant,items:{task:{filePath:path.join(root,'unused.txt'),kind:'text'}},timeoutMs:1000});
  assert.equal(made.ok,true,made.code);
  return {child,made,run:signal=>made.execute(Buffer.from('packet'),{taskId:'task',signal}),counts:()=>({launches,admissions})};
}
test('AFM abort with failed kill and unknown close quarantines rather than reusing capacity',{timeout:4000},async t=>{
  const f=childFixture(t),c=new AbortController(),p=f.run(c.signal);await tick();c.abort();const result=await p;
  assert.equal(result.ok,false);assert.equal(f.made.refusals()[0].cause,'ABORTED');
  const observation=f.made.observations()[0];assert.equal(observation.process.drain,'UNKNOWN');assert.equal(observation.lifecycle.killReturned,false);
  assert.equal(f.made.status(),'QUARANTINED');
  await f.run();assert.equal(f.made.refusals()[1].cause,'CHILD_OWNER_QUARANTINED');assert.deepEqual(f.counts(),{launches:1,admissions:1});
  f.child.emit('close',null,'SIGKILL');f.child.stdout.emit('data',Buffer.from('late'));
  assert.equal(f.made.status(),'QUARANTINED');assert.equal(observation.process.closed,false);assert.equal(f.made.readings().length,0);
});
test('AFM busy excludes admission; STOP waits for known close and remains terminal',{timeout:4000},async t=>{
  const f=childFixture(t),p=f.run();await tick();await f.run();assert.equal(f.made.refusals()[0].cause,'CHILD_OWNER_BUSY');
  f.made.stop();assert.equal(f.made.status(),'STOPPED_DRAINING');
  f.child.emit('exit',null,'SIGKILL');f.child.emit('close',null,'SIGKILL');await p;
  assert.equal(f.made.status(),'STOPPED');assert.equal(f.made.observations()[0].process.drain,'CONFIRMED');
  await f.run();assert.equal(f.made.refusals().at(-1).cause,'EXECUTOR_STOPPED');assert.deepEqual(f.counts(),{launches:1,admissions:1});
});
test('explicit AFM stderr-ignore and 120s allowance do not widen the Swift host contract',async()=>{
  const child=new EventEmitter();for(const s of ['stdin','stdout','stderr'])child[s]=new EventEmitter();child.stdin.end=()=>{};child.exitCode=null;child.signalCode=null;
  const owner=createOwnedChildObserver({launch:()=>child,timeoutMs:120000,stderrPolicy:'ignore',maximumOutputBytes:16});
  const p=owner.run({input:Buffer.from('x'),validate:()=>({accepted:true})});child.emit('spawn');child.stderr.emit('data',Buffer.alloc(1000));child.emit('close',0,null);
  const observation=await p;assert.equal(observation.cause,null);assert.equal(observation.outputs.stderr.observedBytes,0);
  assert.throws(()=>createSwiftArtifactExecutor({timeoutMs:60001}),{code:'SWIFT_EXECUTION_SCOPE_REQUIRED'});
  assert.throws(()=>createOwnedChildObserver({launch:()=>child,timeoutMs:120001}),{code:'CHILD_OWNER_CONFIG'});
  assert.throws(()=>createOwnedChildObserver({launch:()=>child,timeoutMs:100,stderrPolicy:'typo'}),{code:'CHILD_OWNER_CONFIG'});
});
