# Confidential C01 revised oracle review
Prior review FAIL is retained. We added actual owned-filesystem scanner tests and whitespace-tolerant equality checks. Review revised oracle below and contract; return PASS/FAIL plus concrete findings only. Tool-disabled, no file reads/writes.

Implement two exports in scripts/native-overlay-inventory-v1.mjs:
1) validateNativeOverlayInventoryV1({excluded,hidden}): closed descriptor-safe plain data. Return CLEAN_ABSENT for exactly empty arrays; HISTORICAL_MARKERS for exactly the two retained ordered tuples in tests and sole .build exclusion. Otherwise throw code NATIVE_OVERLAY_INVENTORY_INVALID. Reject extras, sparse arrays, accessors and custom prototypes before property reads. No mutation.
2) collectNativeOverlayHiddenV1({importedRoot,frozenPackage,manifestPaths}): trusted-owner supplied paths and Set; read-only fs traversal using lstat (no following symlinks), deterministic sorted inventory. Ignore exact manifest files; skip inventory entry for manifest-ancestor directories and the one expected .build directory, but visit their contents. Record every other directory including empty ones, every unknown file, symlink and nonregular kind. Entries {path relative to importedRoot,kind:'file'|'directory'|'symlink'|'other',bytes:stat.size,sha256:file hash or null}. No writes, process calls or network. Existing hiddenSnapshot wrapper delegates to this function; before/after validation and exact snapshot comparison preserved.

Nisi build script changes are only this import/wrapper and inventory checks. Compiled-source closure, branding and frozen hashes unchanged. Existing two failing overlay tests now support exact starting state clean or legacy but never transitions during builds. Historical tuples independently read from saved debug receipt. Tests are protected from OpenCode edits. Missing-module test failure before implementation is setup discrimination, not semantic mutant detection. Owner tests actual faults after implementation. No native build or app launch is authorized by this packet.

```javascript
// Owner-authored C01 oracle. Synthetic inventories only; never builds or writes the import.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { validateNativeOverlayInventoryV1 as validate, collectNativeOverlayHiddenV1 as collect } from '../scripts/native-overlay-inventory-v1.mjs';

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
  const manifestPaths=new Set(['native/macos/CodenameVeritasFramework/Sources/known.swift']);
  assert.deepEqual(collect({importedRoot,frozenPackage,manifestPaths}),[]);
  fs.mkdirSync(path.join(frozenPackage,'.build/extra-empty'),{recursive:true});
  fs.mkdirSync(path.join(importedRoot,'outside'));
  fs.writeFileSync(path.join(importedRoot,'outside/secret'),'not to be read',{flag:'wx'});
  fs.symlinkSync(path.join(importedRoot,'outside'),path.join(frozenPackage,'.build/escape'));
  fs.writeFileSync(path.join(frozenPackage,'.build/CACHEDIR.TAG'),'wrong',{flag:'wx'});
  const rows=collect({importedRoot,frozenPackage,manifestPaths});
  assert.deepEqual(rows.map(r=>[r.path,r.kind]),[
    [prefix+'/CACHEDIR.TAG','file'],[prefix+'/escape','symlink'],[prefix+'/extra-empty','directory'],
  ]);
  assert.equal(rows[0].bytes,5);
  assert.equal(rows[1].sha256,null);
  assert.equal(rows[2].sha256,null);
  assert(!JSON.stringify(rows).includes('secret'));
  refuse({excluded:[prefix],hidden:rows});
});

```

