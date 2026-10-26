// Execute the actual final guard with controlled observations; never run Swift.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../work-orders/parallel-seven-tracks-v1/build-nisi-macos.mjs',import.meta.url),'utf8');
const start = source.indexOf('  // --show-bin-path is one more Swift subprocess');
const end = source.indexOf('  record.binPath=binPath;', start);
assert(start >= 0 && end > start, 'final guard seam must exist');
const block = source.slice(start,end);
const historical = ['native/macos/CodenameVeritasFramework/.build'];
function inspect(before, after) {
  const context = {
    imported:'mock',manifest:{},manifestPath:'mock',manifestBytes:Buffer.from('manifest'),
    frozenPackage:'mock',frozenReal:'mock',manifestPaths:new Set(),manifestByPath:new Map(),
    record:{sourceAfter:{excluded:before},hiddenAfter:[],compiledSources:[],overlayInventory:[]},
    verifyImportedTree:()=>({status:'PASS_SOURCE_FREEZE_ONLY',excluded:after}),
    knownExclusion:rows=>rows.length===0 || JSON.stringify(rows)===JSON.stringify(historical),
    fs:{readFileSync:()=>Buffer.from('manifest')},
    collectNativeOverlayHiddenV1:()=>[],compiledSources:()=>[],overlayInventory:()=>[],
  };
  // The real module realm avoids foreign-prototype artifacts in helper contracts.
  vm.compileFunction(block,Object.keys(context))(...Object.values(context));
}
test('final post-tool guard allows unchanged clean and historical exclusions',()=>{
  assert.doesNotThrow(()=>inspect([],[]));
  assert.doesNotThrow(()=>inspect([...historical],[...historical]));
});
test('final post-tool guard rejects newly ignored paths and both state transitions',()=>{
  for(const [before,after] of [[[],['tooling/node_modules']],
    [[...historical],[...historical,'tooling/node_modules']],[[],historical],[historical,[]]]) {
    assert.throws(()=>inspect(before,after),{message:'FROZEN_TREE_DRIFT_AFTER_BIN_PATH'});
  }
});
