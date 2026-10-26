import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {ownedTemp,guardTempCleanup} from './helpers/owned-temp.mjs';
test('temporary fixture registers exact cleanup before later setup can throw',()=>{
  const hooks=[];const root=ownedTemp({after:hook=>hooks.push(hook)},'nisi-cleanup-test-');
  try {fs.writeFileSync(path.join(root,'created'),'fixture');throw Error('synthetic setup failure');}
  catch(error){assert.equal(error.message,'synthetic setup failure');}
  finally {for(const hook of hooks)hook();}
  assert.equal(hooks.length,1);assert.equal(fs.existsSync(root),false);
});
test('uncertain child drain retains the exact fixture and makes cleanup fail',()=>{
  const hooks=[];const context={after:hook=>hooks.push(hook)};const root=ownedTemp(context,'nisi-cleanup-test-');
  let safe=false;guardTempCleanup(context,()=>safe);
  try {assert.throws(()=>hooks[0](),/TEST_CLEANUP_QUARANTINED/);assert.equal(fs.existsSync(root),true);}
  finally {safe=true;hooks[0]();}
  assert.equal(fs.existsSync(root),false);
});
