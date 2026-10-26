// Owner-run tests only; no package rehearsal, inference, install or acceptance.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const here = path.dirname(fileURLToPath(import.meta.url));
const names = ['c09-owner-capture-check.mjs', 'c09-owner-capture-check.test.mjs',
  'c09-owner-context.mjs', 'owner-context.proposed.test.mjs', 'verify-current-capture.mjs', 'verify.mjs',
  '../../../scripts/private-package-contract.mjs', '../../../scripts/check-private-package.mjs',
  '../candidate/work-orders/v02-finish-cluster-v1/consumer/runtime-matrix-v1.mjs',
  '../candidate/scripts/private-package-contract.mjs', ...['capture.json', 'intent.json',
    'receipt.json', 'archive.tgz', 'expected.json', 'stdout.log', 'stderr.log'].map(n => '../runtime-node24-TyjDOb/' + n)];
const hash = b => createHash('sha256').update(b).digest('hex');
const pins = () => Object.fromEntries(names.map(n => [n, hash(fs.readFileSync(path.join(here, n)))]));
const before = pins(), out = fs.mkdtempSync(path.join(here, 'checks-'));
const command = [process.execPath, '--test-reporter=tap', '--test-concurrency=1', '--test', 'c09-owner-capture-check.test.mjs', 'owner-context.proposed.test.mjs'];
const r = spawnSync(command[0], command.slice(1), {cwd: here, encoding: 'utf8', timeout: 20000,
  maxBuffer: 2 * 1024 * 1024, env: {PATH: path.dirname(process.execPath), HOME: process.env.HOME, LANG: 'C'}});
for (const [name, text] of [['stdout.log', r.stdout ?? ''], ['stderr.log', r.stderr ?? '']])
  fs.writeFileSync(path.join(out, name), text, {flag: 'wx', mode: 0o600});
const counts = Object.fromEntries(['tests','pass','fail','skipped','cancelled','todo'].map(k => {
  const m = [...(r.stdout ?? '').matchAll(new RegExp('^# '+k+' (\\d+)$', 'gm'))];
  return [k, m.length === 1 ? Number(m[0][1]) : null];
}));
const candidate={files:['c09-owner-context.mjs','c09-owner-capture-check.mjs',
  'c09-owner-capture-check.test.mjs','owner-context.proposed.test.mjs','verify-current-capture.mjs']
  .map(name=>({path:name,content:fs.readFileSync(path.join(here,name),'utf8')}))};
const validation={task:{taskId:'c09.owner-context.local-validation',mode:'edit',language:'javascript',
  allowedFiles:candidate.files.map(f=>f.path),protectedFiles:[],protectedSnapshots:{},
  acceptanceCriteria:['Validate the exact private C09 current-source owner checker and oracle scope and syntax. Real tests and independent source review are separate; no inference or acceptance.'],
  policy:{repairBudget:0,totalDeadlineMs:60000,requiredReviewers:1,requireReportStore:false}},candidate};
fs.writeFileSync(path.join(out,'nisi-input.json'),JSON.stringify(validation,null,2)+'\n',{flag:'wx',mode:0o600});
const nisiCommand=['/Users/louiscalata/bin/initiate-online-code-mode','--nisi','validate'];
const nr=spawnSync(nisiCommand[0],nisiCommand.slice(1),{cwd:path.resolve(here,'../../..'),encoding:'utf8',
  timeout:20000,maxBuffer:2*1024*1024,input:JSON.stringify(validation),
  env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:process.env.HOME,LANG:'C'}});
for(const [name,text] of [['nisi.stdout.log',nr.stdout??''],['nisi.stderr.log',nr.stderr??'']])
  fs.writeFileSync(path.join(out,name),text,{flag:'wx',mode:0o600});
let nv=null;try{nv=JSON.parse(nr.stdout);}catch{}
const nisi={command:nisiCommand,exitCode:nr.status,signal:nr.signal,error:nr.error?.message??null,
  status:nv?.status??null,contract:nv?.checks?.contract?.status??null,syntax:nv?.checks?.syntax?.status??null,
  inputSha256:hash(JSON.stringify(validation)),stdoutSha256:hash(nr.stdout??''),stderrSha256:hash(nr.stderr??'')};
const nisiPassed=nr.status===0&&!nr.error&&nr.signal===null&&nisi.status==='VALIDATED'&&nisi.contract==='PASS'&&nisi.syntax==='PASS';
const after = pins(), unchanged = JSON.stringify(before) === JSON.stringify(after);
const passed = r.status === 0 && !r.error && r.signal === null && unchanged && counts.tests > 0
  && counts.pass === counts.tests && ['fail','skipped','cancelled','todo'].every(k => counts[k] === 0)&&nisiPassed;
const receipt = {scope: 'ISOLATED_C09_CAPTURE_CONTROL_TESTS', command, cwd: here,
  node: process.version, exitCode: r.status, signal: r.signal, error: r.error?.message ?? null,
  before, after, unchanged, counts, passed, nisi, stdoutSha256: hash(r.stdout ?? ''), stderrSha256: hash(r.stderr ?? ''),
  accepted: false, nativeExecution: 'NOT_RUN', inference: 'NOT_RUN', node22: 'NOT_RUN'};
fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify(receipt, null, 2)+'\n', {flag: 'wx', mode: 0o600});
console.log(JSON.stringify({out, passed, unchanged, counts, exitCode: r.status, error: r.error?.message ?? null}));
assert(unchanged, 'source or retained bundle drift');
if (!passed) process.exitCode = 1;
