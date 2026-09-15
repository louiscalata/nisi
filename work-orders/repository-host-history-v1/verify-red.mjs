// Finite contract-stub check. Run only after reading the independent test source.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const source='history/repository-host-history-v1.mjs',test='tests/repository-host-history.test.mjs';
const hash=p=>createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
assert.match(fs.readFileSync(path.join(root,source),'utf8'),/PRIVATE temporary contract stub/);
const files=[source,test,'hosts/repository/reviewed-workflow-v1.mjs'];
const before=Object.fromEntries(files.map(p=>[p,hash(p)]));
const dir=fs.mkdtempSync(path.join(root,'.build/repository-host-history-red-'));
const child=spawnSync(process.execPath,['--test','--test-reporter=tap',test],
  {cwd:root,encoding:'utf8',timeout:20000,maxBuffer:8*1024*1024});
fs.writeFileSync(path.join(dir,'stdout.txt'),child.stdout??'',{flag:'wx'});
fs.writeFileSync(path.join(dir,'stderr.txt'),child.stderr??'',{flag:'wx'});
const record={status:'FAIL',before,exitCode:child.status,signal:child.signal,
  error:child.error?.code??null,counts:{},evidence:dir,authorizing:false};
try{
  assert.equal(child.error,undefined);assert.equal(child.signal,null);assert.equal(child.status,1);
  for(const key of ['tests','pass','fail','cancelled','skipped','todo']){
    const matches=[...child.stdout.matchAll(new RegExp('^# '+key+' (\\d+)$','gm'))];
    assert.equal(matches.length,1);record.counts[key]=Number(matches[0][1]);
  }
  assert.ok(record.counts.tests>10);assert.ok(record.counts.fail>0);
  assert.equal(record.counts.tests,record.counts.pass+record.counts.fail);
  assert.equal(record.counts.cancelled+record.counts.skipped+record.counts.todo,0);
  assert.ok(child.stdout.includes("code: 'ERR_ASSERTION'"));
  for(const [p,sha]of Object.entries(before))assert.equal(hash(p),sha,p);
  record.status='EXPECTED_STUB_RED';
}catch(error){record.failure=String(error.message);process.exitCode=1;}
fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(record));
