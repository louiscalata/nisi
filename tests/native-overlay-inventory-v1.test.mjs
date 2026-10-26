// Owner-authored C01 oracle. Synthetic inventories only; never builds or writes the import.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateNativeOverlayInventoryV1 as validate, collectNativeOverlayHiddenV1 as collect } from '../scripts/native-overlay-inventory-v1.mjs';

// Frozen contract (owner release 2026-09-18): traversal root is frozenPackage —
// the overlay package under importedRoot. collect() never scans importedRoot as
// a whole and never follows manifest paths that live outside frozenPackage.

const prefix = 'native/macos/CodenameVeritasFramework/.build';
const historical = () => ({excluded:[prefix],hidden:[
  {path:prefix+'/.buildSystem_debug',kind:'file',bytes:10,sha256:'cd1ba1c9604b794d71cd3cb482cc02e4c16bdea56c361333fabe801a74db2b90'},
  {path:prefix+'/CACHEDIR.TAG',kind:'file',bytes:209,sha256:'61833598201b8d9bb6a18003b6be9fd00ae014cfbd583253c1f23b746bf035d1'},
]});
const refuse = input => assert.throws(() => validate(input), e => e?.code === 'NATIVE_OVERLAY_INVENTORY_INVALID');

test('clean absence is accepted without manufacturing a build cache',()=>{
  const target = fileURLToPath(new URL('../integrations/veritas/'+prefix, import.meta.url));
  const before = fs.existsSync(target);
  assert.equal(validate({excluded:[],hidden:[]}), 'CLEAN_ABSENT');
  assert.equal(fs.existsSync(target), before);
});
test('only the exact retained historical marker inventory is accepted',()=>{
  const input=historical(), before=JSON.stringify(input);
  assert.equal(validate(input),'HISTORICAL_MARKERS');
  assert.equal(JSON.stringify(input),before);
});
test('partial, duplicated, extra, reordered and cross-state inventories refuse',()=>{
  const mutations=[x=>x.hidden.pop(),x=>x.hidden.push({...x.hidden[0]}),x=>x.hidden.reverse(),
    x=>x.excluded.push(prefix),x=>x.excluded.push('node_modules'),x=>x.excluded.splice(0),
    x=>x.hidden.splice(0),x=>x.hidden.push({path:prefix+'/extra',kind:'directory',bytes:0,sha256:null})];
  for(const change of mutations){const input=historical();change(input);refuse(input);}
  refuse({excluded:[],hidden:historical().hidden});
});
test('wrong path, kind, size and hash refuse independently',()=>{
  for(const change of [r=>r.path+='/escape',r=>r.kind='symlink',r=>r.kind='directory',
    r=>r.bytes++,r=>r.bytes=String(r.bytes),r=>r.sha256='0'.repeat(64),r=>r.sha256=r.sha256.toUpperCase()]){
    const input=historical();change(input.hidden[0]);refuse(input);
  }
});
test('closed plain-data input rejects hidden fields, symbols, accessors and sparse arrays without invoking getters',()=>{
  let reads=0;
  const getter={excluded:[],get hidden(){reads++;return [];}};
  refuse(getter);assert.equal(reads,0);
  for(const change of [x=>x.extra=true,x=>Object.defineProperty(x,'extra',{value:true}),
    x=>x[Symbol('extra')]=true,x=>Object.setPrototypeOf(x,{extra:true}),
    x=>x.hidden[0].extra=true,x=>delete x.hidden[0],x=>x.hidden.extra=true]){
    const input=historical();change(input);refuse(input);
  }
  // Nested accessors on entries and arrays must be rejected before property reads.
  for(const define of [
    x=>Object.defineProperty(x.hidden[0],'bytes',{get(){reads++;return 10;}}),
    x=>Object.defineProperty(x.hidden[0],'sha256',{get(){reads++;return '0'.repeat(64);}}),
    x=>Object.defineProperty(x.hidden[1],'path',{get(){reads++;return prefix+'/mutated';}}),
    x=>Object.defineProperty(x.hidden,'0',{get(){reads++;return x.hidden[1];}}),
    x=>Object.defineProperty(x.hidden,'length',{value:3}), // a length accessor cannot be defined on an Array (non-configurable); a sparse length is the expressible shape mutation
  ]){const input=historical();define(input);refuse(input);}
  assert.equal(reads,0);
  for(const input of [null,undefined,[],{excluded:[],hidden:null}])refuse(input);
});
test('build proof validates both snapshots and preserves exact drift rejection',()=>{
  const source=fs.readFileSync(new URL('../work-orders/parallel-seven-tracks-v1/build-nisi-macos.mjs',import.meta.url),'utf8');
  assert.match(source,/import\s*\{[^}]*validateNativeOverlayInventoryV1[^}]*\}\s*from\s*['"]\.\.\/\.\.\/scripts\/native-overlay-inventory-v1\.mjs['"]/);
  assert.match(source,/collectNativeOverlayHiddenV1\(\{\s*importedRoot:\s*imported,\s*frozenPackage,\s*manifestPaths\s*\}\)/);
  assert.match(source,/validateNativeOverlayInventoryV1\(\{\s*excluded:\s*record\.sourceBefore\.excluded,\s*hidden:\s*record\.hiddenBefore\s*\}\)/);
  assert.match(source,/validateNativeOverlayInventoryV1\(\{\s*excluded:\s*record\.sourceAfter\.excluded,\s*hidden:\s*record\.hiddenAfter\s*\}\)/);
  assert.match(source,/JSON\.stringify\(record\.hiddenAfter\)\s*!==\s*JSON\.stringify\(record\.hiddenBefore\)/);
  assert.match(source,/JSON\.stringify\(record\.sourceAfter\.excluded\)\s*!==\s*JSON\.stringify\(record\.sourceBefore\.excluded\)/);
  for(const code of ['FROZEN_HIDDEN_ENTRY_DRIFT','COMPILED_SOURCE_NOT_IN_MANIFEST','COMPILED_SOURCE_HASH_MISMATCH','MANIFEST_DRIFT'])assert(source.includes(code));
});

test('real scanner records empty directories and symlinks without traversing their targets',t=>{
  const importedRoot=fs.mkdtempSync(path.join(os.tmpdir(),'nisi-overlay-oracle-'));
  t.after(()=>fs.rmSync(importedRoot,{recursive:true,force:true}));
  const frozenPackage=path.join(importedRoot,'native/macos/CodenameVeritasFramework');
  fs.mkdirSync(path.join(frozenPackage,'Sources'),{recursive:true});
  fs.writeFileSync(path.join(frozenPackage,'Sources/known.swift'),'// known\n',{flag:'wx'});
  const manifestPaths=new Set(['native/macos/CodenameVeritasFramework/Sources/known.swift','outside/orphan.swift']);
  assert.deepEqual(collect({importedRoot,frozenPackage,manifestPaths}),[]);
  fs.mkdirSync(path.join(frozenPackage,'.build/extra-empty'),{recursive:true});
  fs.mkdirSync(path.join(importedRoot,'outside'));
  fs.writeFileSync(path.join(importedRoot,'outside/secret'),'not to be read',{flag:'wx'});
  fs.writeFileSync(path.join(importedRoot,'outside/orphan.swift'),'// orphan\n',{flag:'wx'});
  fs.symlinkSync(path.join(importedRoot,'outside'),path.join(frozenPackage,'.build/escape'));
  fs.writeFileSync(path.join(frozenPackage,'.build/CACHEDIR.TAG'),'wrong',{flag:'wx'});
  const rows=collect({importedRoot,frozenPackage,manifestPaths});
  assert.deepEqual(rows.map(r=>[r.path,r.kind]),[
    [prefix+'/CACHEDIR.TAG','file'],[prefix+'/escape','symlink'],[prefix+'/extra-empty','directory'],
  ]);
  assert.equal(rows[0].bytes,5);
  assert.equal(rows[0].sha256, createHash('sha256').update('wrong').digest('hex'));
  assert.equal(rows[1].sha256,null);
  assert.equal(rows[2].sha256,null);
  assert(!JSON.stringify(rows).includes('secret'));
  assert(!JSON.stringify(rows).includes('orphan'));
  refuse({excluded:[prefix],hidden:rows});
});
