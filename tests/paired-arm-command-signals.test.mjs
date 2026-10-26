import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {inspectPairedArmTrialV1} from '../history/paired-arm-reconciliation-v1.mjs';
const root=fs.realpathSync(path.resolve(import.meta.dirname,'..'));
function bounded(promise,ms,code){let timer;return Promise.race([promise,new Promise((_,reject)=>{
  timer=setTimeout(()=>reject(Error(code)),ms);
})]).finally(()=>clearTimeout(timer));}

for(const signal of ['SIGINT','SIGTERM'])test(`real paired-arm child ${signal} drains its original synthetic request`,async t=>{
  const parent=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'nisi-arm-signal-'));
  const identity=fs.lstatSync(parent),nonce=randomBytes(16).toString('hex');
  const child=spawn(process.execPath,[path.join(root,'tests/helpers/paired-arm-command-child.mjs'),parent,nonce],
    {cwd:parent,env:{PATH:process.env.PATH,HOME:parent,TMPDIR:parent,LANG:'C'},stdio:['ignore','pipe','pipe'],detached:false});
  let closed=false,failure=null,stdout='',stderr='',active=null,report=null,resolveReady,rejectReady;
  const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  const terminal=new Promise(resolve=>child.once('close',(code,terminationSignal)=>{
    closed=true;if(!active)rejectReady(Error('CHILD_CLOSED_BEFORE_ACTIVE'));resolve({code,signal:terminationSignal});
  }));
  function refuse(code){failure??=code;rejectReady(Error(code));if(!closed)child.kill('SIGKILL');}
  child.once('error',()=>refuse('CHILD_ERROR'));
  child.stdout.on('data',bytes=>{
    if(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)+bytes.length>16384){refuse('CHILD_OUTPUT_LIMIT');return;}
    stdout+=bytes.toString('utf8');const lines=stdout.split('\n');
    try{
      if(lines.length>3)throw Error('EXTRA_FRAME');
      if(lines.length>=2&&!active){active=JSON.parse(lines[0]);resolveReady(active);}
      if(lines.length===3){if(lines[2])throw Error('TRAILING_OUTPUT');report=JSON.parse(lines[1]);}
    }catch{refuse('CHILD_FRAME_INVALID');}
  });
  child.stderr.on('data',bytes=>{if(Buffer.byteLength(stderr)+bytes.length<=8192)stderr+=bytes.toString('utf8');refuse('CHILD_STDERR');});
  t.after(async()=>{
    if(!closed)child.kill('SIGKILL');
    await bounded(terminal,3000,'CHILD_CLOSE_UNCONFIRMED_ROOT_RETAINED');assert.equal(closed,true);
    const current=fs.lstatSync(parent);assert(current.isDirectory()&&!current.isSymbolicLink());
    assert.equal(current.dev,identity.dev);assert.equal(current.ino,identity.ino);assert.equal(fs.realpathSync(parent),parent);
    fs.rmSync(parent,{recursive:true,force:false});
  });
  const frame=await bounded(ready,5000,'CHILD_ACTIVE_TIMEOUT');
  assert.deepEqual(Object.keys(frame).sort(),['directory','nonce','pid','type']);
  assert.equal(frame.type,'ACTIVE');assert.equal(frame.nonce,nonce);assert.equal(frame.pid,child.pid);
  assert.equal(path.dirname(frame.directory),parent);assert(path.basename(frame.directory).startsWith('nisi-trial-'));
  assert.equal(fs.realpathSync(frame.directory),frame.directory);assert.equal(closed,false);assert.equal(child.kill(signal),true);
  const exit=await bounded(terminal,8000,'CHILD_SIGNAL_TIMEOUT');
  assert.equal(failure,null);assert.equal(stderr,'');assert.deepEqual(exit,{code:0,signal:null});
  assert.deepEqual(Object.keys(report).sort(),['aborted','nonce','pid','report','requests','type']);
  assert.equal(report.type,'REPORT');assert.equal(report.nonce,nonce);assert.equal(report.pid,child.pid);
  assert.equal(report.requests,1);assert.equal(report.aborted,true);
  const r=report.report;assert.equal(r.firstSignal,signal);assert.equal(r.recorded,true);assert.equal(r.retentionAcknowledged,true);
  assert.equal(r.inspectionObserved,true);assert.equal(r.cleanup.signals,'REMOVED');assert.equal(r.cleanup.storage,'CLOSED');
  assert.equal(r.authorizing,false);assert.equal(r.resumable,false);assert.equal(r.actualDispatchCount,null);
  assert(!JSON.stringify(r).includes(parent));
  const bytes=inspectPairedArmTrialV1({directory:frame.directory});assert.equal(bytes.status,'FINAL_CROSSLINKED');
  assert.equal(bytes.remoteExecutionStopped,'UNKNOWN');assert.equal(bytes.pastAcknowledgement,'UNKNOWN');
  assert.equal(bytes.rows[0].state,'STARTED_INCOMPLETE');
});
