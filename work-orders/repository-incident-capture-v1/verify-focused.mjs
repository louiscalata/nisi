// Bounded focused receipt; repository fixtures are synthetic and do not launch native code.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const files=['history/repository-incident-capture-v1.mjs','history/repository-incident-candidates-v1.mjs',
  'hosts/repository/reviewed-workflow-v1.mjs','tests/repository-incident-capture.test.mjs','tests/repository-incident-query.test.mjs',
  'tests/repository-incident-boundaries.test.mjs'];
const hash=n=>createHash('sha256').update(fs.readFileSync(path.join(root,n))).digest('hex');
const before=Object.fromEntries(files.map(n=>[n,hash(n)])),evidence=fs.mkdtempSync(path.join(root,'.build/repository-incident-capture-focused-'));
const child=spawnSync(process.execPath,['--test','--test-reporter=tap',...files.filter(n=>n.startsWith('tests/'))],{cwd:root,encoding:'utf8',timeout:30000,maxBuffer:16777216});
fs.writeFileSync(path.join(evidence,'stdout.txt'),child.stdout??'',{flag:'wx'});fs.writeFileSync(path.join(evidence,'stderr.txt'),child.stderr??'',{flag:'wx'});
const counts=Object.fromEntries(['tests','pass','fail','cancelled','skipped','todo'].map(k=>{const m=[...(child.stdout??'').matchAll(new RegExp('^# '+k+' (\\d+)$','gm'))];return[k,m.length===1?Number(m[0][1]):null];}));
const after=Object.fromEntries(files.map(n=>[n,hash(n)])),stable=JSON.stringify(before)===JSON.stringify(after);
const passed=child.status===0&&child.signal===null&&!child.error&&stable&&counts.tests>0&&counts.pass===counts.tests&&['fail','cancelled','skipped','todo'].every(k=>counts[k]===0);
const receipt={schemaVersion:1,status:passed?'PASS_FOCUSED':'FAIL',exitCode:child.status,signal:child.signal,error:child.error?.code??null,counts,before,after,stable,evidence,authorizing:false};
fs.writeFileSync(path.join(evidence,'verification.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(receipt));process.exitCode=passed?0:1;
