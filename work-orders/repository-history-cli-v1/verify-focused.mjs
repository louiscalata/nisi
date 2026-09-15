import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const names = ['examples/repository-live-model.mjs','hosts/history/review-repository-history-v1.mjs',
  'hosts/history/terminal-history-prompt-v1.mjs','tests/repository-history-review.test.mjs',
  'tests/terminal-history-prompt.test.mjs','tests/repository-history-cli.test.mjs'];
const pins = () => Object.fromEntries(names.map(n => [n,createHash('sha256').update(fs.readFileSync(path.join(root,n))).digest('hex')]));
const before = pins(), directory = fs.mkdtempSync(path.join(root,'.build/repository-history-cli-focused-'));
const child = spawnSync(process.execPath,['--test','--test-reporter=tap',...names.filter(n=>n.startsWith('tests/'))],
  {cwd:root,encoding:'utf8',timeout:30000,maxBuffer:8388608});
fs.writeFileSync(path.join(directory,'stdout.txt'),child.stdout??'',{flag:'wx'});
fs.writeFileSync(path.join(directory,'stderr.txt'),child.stderr??'',{flag:'wx'});
assert.equal(child.error,undefined); assert.equal(child.signal,null);
const counts = Object.fromEntries(['tests','pass','fail','cancelled','skipped','todo'].map(k=>{
  const m=[...child.stdout.matchAll(new RegExp('^# '+k+' (\\d+)$','gm'))];
  assert.equal(m.length,1);return[k,Number(m[0][1])];
}));
const after = pins(); assert.deepEqual(after,before);
const failureCodes=[...child.stdout.matchAll(/^\s+code: '([^']+)'$/gm)].map(m=>m[1]);
const result={status:child.status===0?'PASS_FOCUSED':'FAIL',exitCode:child.status,counts,
  failureCodes,before,after,authorizing:false};
fs.writeFileSync(path.join(directory,'verification.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({directory,...result})); process.exitCode=child.status===0?0:1;
