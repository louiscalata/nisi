// Owner-reviewed synthetic model fixture. Parent owns TMPDIR and kills this
// child only after a fixed, fsynced record boundary has been reported on stdout.
import fs from 'node:fs';
import path from 'node:path';
import {pairedArmContext} from './paired-arm-owner-fixture.mjs';
import {createDurablePairedArmOwnerV1} from '../../hosts/repository/durable-paired-arm-owner-v1.mjs';

const [cut,root]=process.argv.slice(2),directories=new Map();
if(!['SIDE_PREPARED','MAIN_START','SIDE_START','MAIN_EXECUTOR','MAIN_ORACLE','MAIN_FINAL','SIDE_FINAL'].includes(cut)||
  !root||!path.isAbsolute(root)||fs.realpathSync(process.env.TMPDIR)!==fs.realpathSync(root))throw Error('INVALID_CHILD_SCOPE');
const c=await pairedArmContext({after(){/* Parent removes its private TMPDIR after confirmed child termination. */}},
  {workspaceParentRoot:root});
const {retain:_a,retainAdmission:_b,...input}=c.input;
const parentDirectory=path.join(root,'trial-parent');fs.mkdirSync(parentDirectory,{mode:0o700});
const io={...fs,
  openSync(file,...args){const fd=fs.openSync(file,...args);directories.set(fd,file);return fd;},
  closeSync(fd){directories.delete(fd);return fs.closeSync(fd);},
  fsyncSync(fd){
    fs.fsyncSync(fd);
    const file=directories.get(fd);if(!file||!file.endsWith('.jsonl'))return;
    const text=fs.readFileSync(file,'utf8').trimEnd();if(!text)return;
    const envelope=JSON.parse(text.split('\n').at(-1)),e=envelope.event,r=envelope.record;
    const label=r?.kind==='PREPARED'&&r.phase==='EXECUTOR'?'SIDE_PREPARED':
      e?.type==='START_INTENT'&&e.phase==='EXECUTOR'?'MAIN_START':
      r?.kind==='START_LINKED'&&r.phase==='EXECUTOR'?'SIDE_START':
      e?.type==='PHASE_RESULT'&&e.phase==='EXECUTOR'?'MAIN_EXECUTOR':
      e?.type==='PHASE_RESULT'&&e.phase==='ORACLE'?'MAIN_ORACLE':
      e?.type==='FINAL'?'MAIN_FINAL':r?.kind==='FINAL'?'SIDE_FINAL':null;
    if(label!==cut)return;
    const fixtureWorkspacesWithinRoot=fs.readdirSync(root).filter(name=>name.startsWith('live-receipt-workspaces-')&&
      fs.lstatSync(path.join(root,name)).isDirectory()).length;
    fs.writeSync(1,JSON.stringify({cut,directory:path.dirname(file),syntheticRequests:c.requests.length,fixtureWorkspacesWithinRoot})+'\n');
    // Test-only blocking seam: no event-loop advance, additional dispatch or
    // acknowledgement can happen between the marker and the parent's SIGKILL.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
  },
};
await createDurablePairedArmOwnerV1({...input,parentDirectory},{mainIo:io,sidecarIo:io}).run();
throw Error('REQUESTED_CRASH_BOUNDARY_NOT_REACHED');
