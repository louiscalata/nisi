import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {assertC07BaselineV3} from '../work-orders/v02-finish-cluster-v1/check-c07-baseline-v3.mjs';

// Current source-control tests are separate from the retained historical tests.
// These fixtures copy only the exact reviewed dependency map and its metadata.
// They grant no native/dispatch/owner acceptance and do not execute copied code.
const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PREFIX = 'work-orders/v02-finish-cluster-v1/';
const MAP = PREFIX+'c07-baseline-v3/dependency-map-v3.json';
const PROPOSAL = PREFIX+'c07-baseline-v3/proposed-transition-v3.json';
const CLUSTER = PREFIX+'cluster.json';
const PACKET = '.packets/nisi-v02-c07-native-incident-oracle.packet.md';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nisi-c07-v3-source-')));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const map = JSON.parse(fs.readFileSync(path.join(SOURCE_ROOT, MAP)));
  const files = [...Object.keys(map.entries), MAP, PROPOSAL];
  assert.equal(new Set(files).size, files.length, 'fixture inventory unique');
  for (const file of files) {
    assert(file && !path.isAbsolute(file) && !file.split('/').includes('..'));
    const from = path.join(SOURCE_ROOT,file), to = path.join(root,file);
    assert(fs.lstatSync(from).isFile() && !fs.lstatSync(from).isSymbolicLink());
    fs.mkdirSync(path.dirname(to), {recursive:true});
    fs.copyFileSync(from,to);
  }
  // The one declared packet normalization changes exactly one root line.
  const packetPath = path.join(root,PACKET), bytes = fs.readFileSync(packetPath,'utf8');
  assert.equal((bytes.match(/^project_root: .+$/gm) ?? []).length,1);
  fs.writeFileSync(packetPath,bytes.replace(/^project_root: .+$/m,`project_root: ${root}`));
  return {root, cluster:JSON.parse(fs.readFileSync(path.join(root,CLUSTER))), map};
}
function verify(f) { return assertC07BaselineV3({root:f.root,cluster:f.cluster,sha}); }
function append(f,file,tail='\n// independent source drift\n') {
  const target=path.join(f.root,file); fs.appendFileSync(target,tail);
}

test('v3 validates the complete selected current map and exact P3 without self-acceptance',t=>{
  const f=fixture(t), result=verify(f);
  assert.equal(result.currentVersion,3);
  assert.equal(result.historicalVersion,1);
  assert.equal(result.ownerAcceptanceEstablished,false);
  assert.equal(result.nativeOrDispatchAuthorized,false);
  assert.equal(result.dependencyTransitions.length,2);
  assert.deepEqual(result.dependencyTransitions.map(row=>row.path),[
    'tests/run-journal-baseline.test.mjs',PREFIX+'package.json',
  ]);
  assert(result.allowedPaths.includes('tests/finish-cluster-c07-baseline-v3.test.mjs'));
});

test('v3 rejects semantic caller selector changes with all disk hashes intact',async t=>{
  for (const [name,mutate] of [
    ['missing selector',c=>{delete c.c07BaselineControl;}],
    ['old generation',c=>{c.c07BaselineControl.version=1;}],
    ['historical command',c=>{c.c07BaselineControl.currentCommand='npm run test:c07 --prefix '+PREFIX.slice(0,-1);}],
    ['missing transition',c=>{c.baselineSupersessions.pop();}],
    ['extra transition',c=>{c.baselineSupersessions.push({...c.baselineSupersessions[0]});}],
    ['changed old digest',c=>{c.baselineSupersessions[0].oldSha256='0'.repeat(64);}],
  ]) await t.test(name,t=>{
    const f=fixture(t); verify(f); mutate(f.cluster);
    assert.throws(()=>verify(f),/C07 v3 (selected generation|exact transitions)/);
  });
});

test('v3 rejects exact protected and selected data changes',async t=>{
  for (const file of [
    'history/run-journal-v1.mjs',
    'tests/parse-static-imports-child.mjs',
    'tests/run-journal-baseline.test.mjs',
    PREFIX+'package.json',
    PREFIX+'c07-baseline-v3/history/c07-packet-v1.packet.md',
    PREFIX+'c07-baseline-v3/history/check-c07.mjs',
    PREFIX+'c07-baseline-v3/history/finish-package-v1.json',
  ]) await t.test(file,t=>{
    const f=fixture(t); verify(f); append(f,file);
    assert.throws(()=>verify(f),/C07 v3 (predecessor|dependency|journal|parser|baseline|package)/);
  });
});

test('v3 normalizes only the one root line and refuses a changed active P3 scope',t=>{
  const f=fixture(t); verify(f);
  append(f,PACKET,'\nAn unreviewed extra owner permission.\n');
  assert.throws(()=>verify(f),/C07 v3 (active packet|packet amendment|dependency)/);
});

test('v3 refuses a packet with duplicate root lines',t=>{
  const f=fixture(t); verify(f);
  append(f,PACKET,`\nproject_root: ${f.root}\n`);
  assert.throws(()=>verify(f),/C07 v3 packet root row/);
});

test('v3 does not treat modified proposal status as actual acceptance',t=>{
  const f=fixture(t); verify(f);
  const file=path.join(f.root,PROPOSAL), record=JSON.parse(fs.readFileSync(file));
  record.status='ACCEPTED'; fs.writeFileSync(file,JSON.stringify(record));
  assert.throws(()=>verify(f),/C07 v3 immutable proposal identity/);
});

test('v3 rejects an edited dependency map before accepting its rows',t=>{
  const f=fixture(t); verify(f);
  const file=path.join(f.root,MAP), map=JSON.parse(fs.readFileSync(file));
  map.entries['history/run-journal-v1.mjs']='0'.repeat(64);
  fs.writeFileSync(file,JSON.stringify(map));
  assert.throws(()=>verify(f),/C07 v3 map digest/);
});
