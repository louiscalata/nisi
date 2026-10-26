# Confidential C01 oracle and contract review
Review only the supplied oracle and contract. No tools, file access or writes.
Return PASS/FAIL and at most 4 concrete correctness/scope findings. This review
may release one bounded local OpenCode edit, not native build/release approval.

Contract: implement scripts/native-overlay-inventory-v1.mjs exporting pure
validateNativeOverlayInventoryV1({excluded,hidden}). Return CLEAN_ABSENT only for
exact empty arrays; HISTORICAL_MARKERS only for the exact ordered exclusion and
file tuples in tests; otherwise throw with code NATIVE_OVERLAY_INVENTORY_INVALID.
Closed plain-data descriptors, no getters or mutation; do not execute user code.
Build proof imports this helper and validates real before/after inventories,
retains existing exact before/after equality, compiled source hashing, manifests,
allowed child programs and --scratch-path. The hidden inventory walk must record
unmanifested empty directories too, so an empty subdirectory cannot disappear.
It currently labels all non-symlink unknown leaf kinds as file; correct to report
actual directory/file/symlink/other before validation. Source files remain immutable.
Existing overlay tests currently require an obsolete .build with two markers
which no longer exists. Correct only those inventory expectations and stale
source-text assertions to accept clean absence or exact legacy markers; do not
weaken branding, compiler closure, source symlinks, metadata or effect checks.
Add a source assertion that empty-directory observation is wired, and retain
known failure codes where necessary. Never create marker files to make tests pass.

Historical receipt verifies the exact marker sizes and hashes in oracle. 225
frozen source files still match. No full-suite improvement yet. Current oracle
fails before implementation due to missing new module (expected setup red, not
semantic mutant detection). Later fault controls must fail assertions, not imports.
The packet executor cannot change this owner-authored test. Original native-overlay
test modifications will be reviewed by the owner after execution.

Oracle:
```javascript
// Owner-authored C01 oracle. Synthetic inventories only; never builds or writes the import.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateNativeOverlayInventoryV1 as validate } from '../scripts/native-overlay-inventory-v1.mjs';

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
  assert.match(source,/import\s*\{\s*validateNativeOverlayInventoryV1\s*\}\s*from\s*['"]\.\.\/\.\.\/scripts\/native-overlay-inventory-v1\.mjs['"]/);
  assert.match(source,/validateNativeOverlayInventoryV1\(\{\s*excluded:\s*record\.sourceBefore\.excluded,\s*hidden:\s*record\.hiddenBefore\s*\}\)/);
  assert.match(source,/validateNativeOverlayInventoryV1\(\{\s*excluded:\s*record\.sourceAfter\.excluded,\s*hidden:\s*record\.hiddenAfter\s*\}\)/);
  assert.match(source,/JSON\.stringify\(record\.hiddenAfter\)!==JSON\.stringify\(record\.hiddenBefore\)/);
  assert.match(source,/JSON\.stringify\(record\.sourceAfter\.excluded\)!==JSON\.stringify\(record\.sourceBefore\.excluded\)/);
  for(const code of ['FROZEN_HIDDEN_ENTRY_DRIFT','COMPILED_SOURCE_NOT_IN_MANIFEST','COMPILED_SOURCE_HASH_MISMATCH','MANIFEST_DRIFT'])assert(source.includes(code));
});

```

