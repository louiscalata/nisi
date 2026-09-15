// Owner-only mutation evidence. Canonical source and protected tests are never edited.
import {readFileSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
const source=readFileSync(join(root,'history/run-journal-v1.mjs'),'utf8');
const oracle=readFileSync(join(root,'tests/run-journal.test.mjs'),'utf8');
const sha=x=>createHash('sha256').update(x).digest('hex');
const expectedOracle='2d46da21f23b6d58156db162ca5dfd45ca78b095c383411f9ac858cb20aeb12a';
if(sha(oracle)!==expectedOracle)throw new Error('Protected oracle changed');
const out=join(root,'.build','history-mutants-'+sha(source).slice(0,12));
if(existsSync(out))throw new Error('Evidence directory already exists; do not overwrite retained mutants');
mkdirSync(out,{recursive:true});
const mutations=[
  ['conflict-as-duplicate','old.fingerprint===fp ?','true ?'],
  ['reopen-as-fresh','historical:true','historical:false'],
  ['unseal-damaged-prefix','const sealed=build(c,h.now,b.records,true)','const sealed=build(c,h.now,b.records,false)'],
  ['payload-only-identity',"const fp=H('nisi-run-journal/input/v1\\n'+C(e))","const fp=H('nisi-run-journal/input/v1\\n'+C(e.payload))"],
  ['forget-reopened-revocation','if(e.revokes!==null)b.revoked.add(e.revokes);','if(false)b.revoked.add(e.revokes);'],
  ['ignore-prefix-order','v.seq!==n || v.previousHash!==prev','false'],
  ['ignore-payload-expiry','r.retained && expired(r,now)','r.retained && false'],
  ['stale-heartbeat-permits-retry','!expired(t,now) && !revoked.has(t.entry.id)','false && !revoked.has(t.entry.id)']
];
const results=[];
for(const [id,before,after] of mutations){
  if(source.split(before).length!==2)throw new Error(id+': mutation site is not unique');
  const variant=source.replace(before,after);
  writeFileSync(join(out,id+'.source.txt'),variant);
  const url='data:text/javascript;base64,'+Buffer.from(variant).toString('base64');
  const originalImport='../history/run-journal-v1.mjs';
  if(oracle.split(originalImport).length!==2)throw new Error('Oracle import site is not unique');
  const input=oracle.replace(originalImport,url);
  const run=spawnSync(process.execPath,['--input-type=module'],{cwd:root,input,encoding:'utf8',timeout:15000,maxBuffer:4*1024*1024});
  const log=(run.stdout??'')+(run.stderr??'');writeFileSync(join(out,id+'.log'),log);
  const count=name=>Number(log.match(new RegExp('^ℹ '+name+' (\\d+)$','m'))?.[1]??NaN);
  const tests=count('tests'),passed=count('pass'),failed=count('fail'),skipped=count('skipped'),cancelled=count('cancelled');
  const caught=run.status===1 && tests===18 && failed>0 && passed+failed===18 && skipped===0 && cancelled===0 && !run.error;
  results.push({id,sourceSha256:sha(variant),exit:run.status,tests,passed,failed,skipped,cancelled,status:caught?'CAUGHT':'INCONCLUSIVE_OR_SURVIVED'});
}
const summary={sourceSha256:sha(source),oracleSha256:sha(oracle),scope:'One-site deliberate variants against the unchanged 18-test oracle; only import URL redirected in memory.',results,
  status:results.every(x=>x.status==='CAUGHT')?'PASS':'FAIL'};
writeFileSync(join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
if(summary.status!=='PASS')process.exitCode=1;
