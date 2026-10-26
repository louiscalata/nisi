// Private deterministic evidence capture; no native/model execution.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const files=['history/repository-incident-candidates-v1.mjs','hosts/repository/reviewed-workflow-v1.mjs',
  'tests/repository-incident-candidates.test.mjs','tests/repository-incident-host.test.mjs','tests/repository-incident-isolation.test.mjs',
  'tests/helpers/incident-host-fixture.mjs','tests/helpers/incident-candidate-fixture.mjs'].filter(f=>fs.existsSync(path.join(root,f)));
const pins=()=>Object.fromEntries(files.map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')]));
const evidence=fs.mkdtempSync(path.join(root,'.build/repository-incidents-focused-'));
const before=pins(),child=spawnSync(process.execPath,['--test','--test-reporter=tap',
  '--test-timeout=15000','tests/repository-incident-candidates.test.mjs','tests/repository-incident-host.test.mjs','tests/repository-incident-isolation.test.mjs'],
  {cwd:root,encoding:'utf8',timeout:60000,maxBuffer:16777216});
fs.writeFileSync(path.join(evidence,'stdout.tap'),child.stdout??'',{flag:'wx'});
fs.writeFileSync(path.join(evidence,'stderr.txt'),child.stderr??'',{flag:'wx'});
const counts=Object.fromEntries(['tests','pass','fail','cancelled','skipped','todo'].map(k=>{
  const m=[...(child.stdout??'').matchAll(new RegExp('^# '+k+' (\\d+)$','gm'))];return[k,m.length===1?Number(m[0][1]):null];}));
const after=pins(),stable=JSON.stringify(before)===JSON.stringify(after);
const ok=child.status===0&&child.signal===null&&!child.error&&stable&&counts.tests>0&&counts.pass===counts.tests&&['fail','cancelled','skipped','todo'].every(k=>counts[k]===0);
const receipt={status:ok?'PASS_SCOPED':'FAIL',before,after,stable,exitCode:child.status,
  signal:child.signal,error:child.error?.code??null,counts,evidence,authorizing:false};
fs.writeFileSync(path.join(evidence,'verification.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(receipt));process.exitCode=ok?0:1;
