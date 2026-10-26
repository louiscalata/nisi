// Actual deterministic Nisi scope/syntax checks, never model inference or acceptance.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const base=path.dirname(fileURLToPath(import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
const files=['history/host-journal-bundle.mjs','work-orders/v02-finish-cluster-v1/restart/host-bundle-integration.test.mjs','tests/host-journal-bundle.test.mjs'];
const candidate={files:files.map(file=>({path:file,content:fs.readFileSync(path.join(base,'candidate',file),'utf8')}))};
const sourceHashes=Object.fromEntries(candidate.files.map(file=>[file.path,hash(file.content)]));
const task={taskId:'nisi.c06.host-observation',mode:'edit',language:'javascript',allowedFiles:files,protectedFiles:[],protectedSnapshots:{},
  acceptanceCriteria:['Persist a closed caller-supplied settled host observation through an issued journal bundle, with descriptor-first input validation, no caller coercion, private persistence state, exact identity crosschecks, terminal history, sourceAuthenticityAttested false, exact pre-append rollback including watermark, and legacy compatibility. Preserve pure dependency checks, explicit storage, original authority restrictions and no resume or inference.'],
  policy:{repairBudget:0,totalDeadlineMs:120000,requiredReviewers:1,requireReportStore:false}};
const input=JSON.stringify({task,candidate});assert(Buffer.byteLength(input)<=262144);
const output=fs.mkdtempSync(path.join(base,'nisi-validation-'));
const result=spawnSync('/Users/louiscalata/bin/initiate-online-code-mode',['--nisi','validate'],{input,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});
const log=(result.stdout??'')+(result.stderr??'');fs.writeFileSync(path.join(output,'nisi-validation.log'),log,{flag:'wx'});
let response=null;try{response=JSON.parse(result.stdout);}catch{}
const unchanged=Object.entries(sourceHashes).every(([p,h])=>hash(fs.readFileSync(path.join(base,'candidate',p)))===h);
const ok=result.status===0&&!result.error&&!result.signal&&unchanged&&response?.status==='VALIDATED'&&response.accepted===false&&response.checks.contract.status==='PASS'&&response.checks.syntax.status==='PASS'&&response.checks.syntax.checkedFiles.length===3;
const record={sourceHashes,exitCode:result.status,error:result.error?.code??null,signal:result.signal,unchanged,ok,binding:response?.binding??null,logSha256:hash(log),inference:'NOT_RUN',implementationAccepted:false};
fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output,...record}));if(!ok)process.exitCode=1;
