// Fixed synthetic transport; parent owns TMPDIR cleanup after confirmed close.
import fs from 'node:fs';
import path from 'node:path';
import {pairedArmContext} from './paired-arm-owner-fixture.mjs';
import {createPairedArmCommandOwnerV1} from '../../cli/paired-arm-command-owner.mjs';
const [root,nonce]=process.argv.slice(2);
if(!root||!path.isAbsolute(root)||fs.realpathSync(process.env.TMPDIR)!==fs.realpathSync(root)||!/^[a-f0-9]{32}$/.test(nonce??''))throw Error('CHILD_SCOPE');
const stat=fs.lstatSync(root);if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077))throw Error('CHILD_ROOT');
const write=value=>fs.writeSync(1,JSON.stringify({nonce,pid:process.pid,...value})+'\n');
let active=false,aborted=false;
const c=await pairedArmContext({after(){/* parent removes exact root after close */}}, {
  workspaceParentRoot:root,configure(input){input.timeoutMs=5000;},
  onRequest(call,response){
    if(active||call.request.signal.aborted)throw Error('CHILD_REQUEST');active=true;
    const pending=new Promise(resolve=>call.request.signal.addEventListener('abort',()=>{
      aborted=true;resolve(new Response(JSON.stringify(response)));
    },{once:true}));
    const trial=fs.readdirSync(root).filter(name=>name.startsWith('nisi-trial-'));
    if(trial.length!==1)throw Error('CHILD_TRIAL');
    write({type:'ACTIVE',directory:fs.realpathSync(path.join(root,trial[0]))});
    return pending;
  },
});
const {retain:_a,retainAdmission:_b,...input}=c.input;
const owner=createPairedArmCommandOwnerV1({...input,parentDirectory:root}),report=await owner.run();
if(!report.recorded||!report.inspectionObserved||report.authorizing||report.resumable||report.actualDispatchCount!==null)throw Error('CHILD_REPORT');
if(c.requests.length!==1||!aborted||owner.requestStop().status!=='REFUSED')throw Error('CHILD_REQUEST_COUNT');
try{await owner.run();throw Error('CHILD_RERUN');}catch(e){if(e?.code!=='ARM_COMMAND_ALREADY_RAN')throw e;}
write({type:'REPORT',report,requests:c.requests.length,aborted});
