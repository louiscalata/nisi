// Original adverse controls for the exact history correction; owned fixtures only.
// Current versioned baseline qualification has separate additive coverage.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {assertHistoryHardening, HISTORY_EVIDENCE, HISTORY_TRANSITIONS} from '../work-orders/v02-finish-cluster-v1/c07-baseline-v3/history/check-c07.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT=path.resolve(HERE,'..');
const CLUSTER='work-orders/v02-finish-cluster-v1/cluster.json';
const HISTORY='work-orders/v02-finish-cluster-v1/c07-baseline-v3/history';
const sha=b=>createHash('sha256').update(b).digest('hex');
const read=(root,file)=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const write=(root,file,value)=>{const p=path.join(root,file);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,`${JSON.stringify(value,null,2)}\n`);};
const copy=(root,file)=>{const p=path.join(root,file);fs.mkdirSync(path.dirname(p),{recursive:true});fs.copyFileSync(path.join(SOURCE_ROOT,file),p);};

function restoreHistoricalFiles(root){
  for(const [source,target,digest] of [
    ['run-journal-baseline-v1.test.mjs','tests/run-journal-baseline.test.mjs','17a8de142999f7ebdbe164336d81ce5c0a7ef27b00e105ff7bf7a1113ea37e7f'],
    ['finish-package-v1.json','work-orders/v02-finish-cluster-v1/package.json','5a648d3057b70061e6947c895981df7ce9308b4a01c578e4e3abd31aff85f935'],
    ['c07-packet-v1.packet.md','.packets/nisi-v02-c07-native-incident-oracle.packet.md','872ce897b91cb3b0e93338e80060a7cb7787c97e1e15e27babf043a9c73e9af4'],
  ]){
    const bytes=fs.readFileSync(path.join(SOURCE_ROOT,HISTORY,source));
    assert.equal(sha(bytes),digest,`retained historical fixture identity: ${target}`);
    const filename=path.join(root,target);fs.mkdirSync(path.dirname(filename),{recursive:true});fs.writeFileSync(filename,bytes);
  }
}

function fixture(t){
  const scratch=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'nisi-history-adverse-')));
  t.after(()=>fs.rmSync(scratch,{recursive:true,force:true}));
  const evidence=read(SOURCE_ROOT,HISTORY_EVIDENCE),canonical=read(SOURCE_ROOT,evidence.canonical);
  const paths=new Set([HISTORY_EVIDENCE,evidence.canonical,evidence.isolated,evidence.validation,evidence.sourceReview]);
  for(const file of Object.keys(evidence.bindings??{}))paths.add(file);
  for(const file of Object.keys(canonical.before??{}))paths.add(file);
  for(const row of canonical.checks??[]){
    paths.add(path.posix.join(path.posix.dirname(evidence.canonical),row.name+'.stdout.log'));
    paths.add(path.posix.join(path.posix.dirname(evidence.canonical),row.name+'.stderr.log'));
  }
  for(const file of paths)copy(scratch,file);
  restoreHistoricalFiles(scratch);
  const cluster=read(SOURCE_ROOT,CLUSTER);
  delete cluster.c07BaselineControl;
  delete cluster.baselineSupersessions;
  return {scratch,cluster,evidence};
}
function check(f){return assertHistoryHardening({root:f.scratch,cluster:f.cluster,sha});}
function rejects(t,mutate){const f=fixture(t);mutate(f);assert.throws(()=>check(f),e=>e.code==='ERR_ASSERTION'||e.code==='ENOENT');}

test('valid history resolver remains a pure old-to-new digest mapping',t=>{
  const f=fixture(t),resolve=check(f);
  for(const row of HISTORY_TRANSITIONS){assert.equal(resolve(row.path,row.oldSha256),row.newSha256);}
  assert.equal(resolve('unrelated/path.mjs','a'.repeat(64)),'a'.repeat(64));
});

test('history evidence rejects malformed transition records',async t=>{
  await t.test('missing record',t=>rejects(t,f=>{delete f.cluster.historyHardening.transitions;}));
  await t.test('null transition',t=>rejects(t,f=>{f.cluster.historyHardening.transitions[0]=null;}));
  await t.test('boolean transition',t=>rejects(t,f=>{f.cluster.historyHardening.transitions[0]=false;}));
  await t.test('extra transition',t=>rejects(t,f=>{f.cluster.historyHardening.transitions.push({...f.cluster.historyHardening.transitions[0]});}));
  await t.test('omitted path',t=>rejects(t,f=>{delete f.cluster.historyHardening.transitions[0].path;}));
  await t.test('reordered transitions',t=>rejects(t,f=>{f.cluster.historyHardening.transitions.reverse();}));
  await t.test('swapped hashes',t=>rejects(t,f=>{const r=f.cluster.historyHardening.transitions;r[0].oldSha256=r[1].oldSha256;}));
  await t.test('wrong path',t=>rejects(t,f=>{f.cluster.historyHardening.transitions[0].path='history/other.mjs';}));
  await t.test('affected transition mismatch',t=>rejects(t,f=>{f.cluster.historyHardening.affectedAcceptances=['C07'];}));
});

test('evidence and canonical receipts cannot be rebound around contradictions',async t=>{
  await t.test('forged outer evidence hash',t=>rejects(t,f=>{
    const e=read(f.scratch,HISTORY_EVIDENCE);e.transitions[0].newSha256='f'.repeat(64);write(f.scratch,HISTORY_EVIDENCE,e);
    f.cluster.historyHardening.evidenceSha256=sha(Buffer.from(JSON.stringify(e)+'\n'));
  }));
  await t.test('missing raw log',t=>rejects(t,f=>{fs.unlinkSync(path.join(f.scratch,'.packet-diagnostics/history-proxy-owner-20260920/integration/canonical-jwtGZe/history.stdout.log'));}));
  await t.test('changed unchanged store',t=>rejects(t,f=>{const p=path.join(f.scratch,'.packet-diagnostics/history-proxy-owner-20260920/integration/canonical-jwtGZe/checks.json');const c=JSON.parse(fs.readFileSync(p));c.unchanged=false;write(f.scratch,'.packet-diagnostics/history-proxy-owner-20260920/integration/canonical-jwtGZe/checks.json',c);}));
  await t.test('partial source revert',t=>rejects(t,f=>{const row=HISTORY_TRANSITIONS[0];fs.copyFileSync(path.join(f.scratch,'.packet-diagnostics/history-proxy-owner-20260920/before',row.path),path.join(f.scratch,row.path));}));
  await t.test('changed regression count',t=>rejects(t,f=>{const p='.packet-diagnostics/history-proxy-owner-20260920/integration/canonical-jwtGZe/checks.json';const c=read(f.scratch,p);c.checks[0].counts.tests++;write(f.scratch,p,c);}));
  await t.test('mismatched old digest',t=>rejects(t,f=>{const p='.packet-diagnostics/history-proxy-owner-20260920/before/'+HISTORY_TRANSITIONS[0].path;fs.appendFileSync(path.join(f.scratch,p),'\n');}));
});

test('unrelated copied files remain outside the transition oracle and source cluster stays unchanged',t=>{
  const f=fixture(t),before=JSON.stringify(f.cluster);
  const unrelated=path.join(f.scratch,'.packet-diagnostics/history-proxy-owner-20260920/integration/unrelated.txt');fs.writeFileSync(unrelated,'owned fixture mutation');
  check(f);assert.equal(JSON.stringify(f.cluster),before);
  assert.deepEqual(f.cluster.dependencySupersessions?.at(-1),JSON.parse(fs.readFileSync(path.join(SOURCE_ROOT,CLUSTER))).dependencySupersessions?.at(-1));
});

test('history resolver never accepts an unreviewed predecessor digest',t=>{
  const f=fixture(t),resolve=check(f);
  for(const row of HISTORY_TRANSITIONS)assert.throws(()=>resolve(row.path,row.newSha256),/history predecessor digest/);
  delete f.cluster.historyHardening;
  assert.equal(check(f)(HISTORY_TRANSITIONS[0].path,HISTORY_TRANSITIONS[0].oldSha256),HISTORY_TRANSITIONS[0].oldSha256);
});
test('current store, regression and protected oracle bytes remain exact',t=>{
  for(const file of ['history/run-journal-store-v1.mjs','tests/journal-owner-v2.memfs.mjs','tests/journal-proxy-boundaries.test.mjs',
    'tests/journal-owner-v2-store.test.mjs','tests/journal-owner-v2-baseline.test.mjs'])
    rejects(t,f=>fs.appendFileSync(path.join(f.scratch,file),'\n// changed\n'));
});
test('rebound review, validation, authority and command evidence still fails the frozen owner identity',t=>{
  for(const [field,mutate] of [['sourceReview',x=>{x.verdict='FAIL';}],['validation',x=>{x.sourceHashes={};}],
    ['canonical',x=>{x.checks[0].command=['node','--version'];}],['canonical',x=>{x.publicationAuthorized=true;}]])
    rejects(t,f=>{
      const file=f.evidence[field],value=read(f.scratch,file);mutate(value);write(f.scratch,file,value);
      f.evidence.bindings[file]=sha(fs.readFileSync(path.join(f.scratch,file)));
      write(f.scratch,HISTORY_EVIDENCE,f.evidence);
      f.cluster.historyHardening.evidenceSha256=sha(fs.readFileSync(path.join(f.scratch,HISTORY_EVIDENCE)));
    });
});
