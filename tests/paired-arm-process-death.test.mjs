import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {inspectPairedArmTrialV1} from '../history/paired-arm-reconciliation-v1.mjs';

const childFile=fileURLToPath(new URL('./helpers/paired-arm-crash-child.mjs',import.meta.url));
const cases=[
  ['SIDE_PREPARED','PREPARED_UNCONFIRMED','INCOMPLETE',0],
  ['MAIN_START','PREPARED_UNCONFIRMED','INCOMPLETE',0],
  ['SIDE_START','STARTED_INCOMPLETE','INCOMPLETE',0],
  ['MAIN_EXECUTOR','STARTED_INCOMPLETE','INCOMPLETE',2],
  ['MAIN_ORACLE','STARTED_INCOMPLETE','INCOMPLETE',2],
  ['MAIN_FINAL','COMPLETE','INCOMPLETE',2],
  ['SIDE_FINAL','COMPLETE','FINAL_CROSSLINKED',2],
];
for(const [cut,rowState,status,requests] of cases)test(`physical process death after ${cut}`,{timeout:20000},async t=>{
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'nisi-arm-death-')));
  let child,closed=false;
  // Never remove a fixture tree underneath an unconfirmed living child.
  t.after(()=>{if(closed)fs.rmSync(root,{recursive:true,force:true});});
  const marker=await new Promise((resolve,reject)=>{
    child=spawn(process.execPath,[childFile,cut,root],{stdio:['ignore','pipe','pipe'],
      env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:root,LANG:'C'}});
    let output='',error='',record=null,failure=null;
    const deadline=setTimeout(()=>{failure=Error('child boundary deadline');child.kill('SIGKILL');},15000);
    child.once('error',e=>{failure=e;});
    child.stdout.on('data',chunk=>{
      output+=chunk;if(output.length>16384){failure=Error('oversized child marker');child.kill('SIGKILL');return;}
      if(output.endsWith('\n')&&!record){
        try{record=JSON.parse(output);}catch{failure=Error('invalid child marker');}
        child.kill('SIGKILL');
      }
    });
    child.stderr.on('data',chunk=>{error+=chunk;if(error.length>16384){failure=Error('oversized child error');child.kill('SIGKILL');}});
    child.once('close',(code,signal)=>{
      closed=true;clearTimeout(deadline);
      if(failure)reject(failure);
      else if(!record||signal!=='SIGKILL'||code!==null)reject(Error('child did not reach exact boundary: '+error.slice(0,1000)));
      else resolve(record);
    });
  });
  assert.equal(closed,true);assert.equal(marker.cut,cut);assert.equal(marker.syntheticRequests,requests);
  assert.equal(marker.fixtureWorkspacesWithinRoot,1);
  const relative=path.relative(root,marker.directory);assert(!relative.startsWith('..')&&!path.isAbsolute(relative));
  const result=inspectPairedArmTrialV1({directory:marker.directory});
  assert.equal(result.status,status);assert.equal(result.rows[0].state,rowState);
  assert.equal(result.pastAcknowledgement,'UNKNOWN');assert.equal(result.actualDispatchCount,null);
  assert.equal(result.resumable,false);assert.equal(result.authorizing,false);assert.equal(result.remoteExecutionStopped,'UNKNOWN');
});
