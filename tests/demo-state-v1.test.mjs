import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveExternalDemoStateV1, recheckExternalDemoStateV1 } from '../hosts/repository/demo-state-v1.mjs';
import { parseLiveDemoInvocation, runPrivateLiveDemo } from '../examples/repository-live-model.mjs';
import { runNisiCli } from '../cli/main.mjs';
import { withPreflightGuards } from './helpers/live-cli-side-effect-guard.mjs';
const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
const args = ['--approved-reviewed-fixture','--endpoint','http://127.0.0.1:1234','--author-model','a','--reviewer-model','b'];
const code = {code:'NISI_STATE_DIRECTORY_INVALID'};
function temp(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nisi-state-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true})); return root;
}
test('external state resolves private caller-owned directory without creating files', t=>{
  const root=temp(t), observed=resolveExternalDemoStateV1(root,sourceRoot);
  assert.equal(observed.directory,fs.realpathSync(root)); assert.ok(Object.isFrozen(observed));
  assert.equal(recheckExternalDemoStateV1(observed,sourceRoot),observed.directory);
  assert.deepEqual(fs.readdirSync(root),[]);
  assert.equal(resolveExternalDemoStateV1(root+'/',sourceRoot).directory,observed.directory);
});
test('state rejects bad input, public directories, symlinks and source overlap', t=>{
  const root=temp(t), file=path.join(root,'file'), publicDir=path.join(root,'public'), link=path.join(root,'link');
  fs.writeFileSync(file,'fixture'); fs.mkdirSync(publicDir,{mode:0o755}); fs.symlinkSync(publicDir,link);
  for(const value of [null,'','relative','/missing-nisi-state-test','/a\0b','/'.repeat(4097),file,publicDir,link,
    sourceRoot,path.join(sourceRoot,'cli'),path.dirname(sourceRoot),path.parse(sourceRoot).root])
    assert.throws(()=>resolveExternalDemoStateV1(value,sourceRoot),code);
  const alias=path.join(root,'source'); fs.symlinkSync(sourceRoot,alias);
  assert.throws(()=>resolveExternalDemoStateV1(path.join(alias,'cli'),sourceRoot),code);
});
test('state identity recheck rejects replacement while retaining both test directories', t=>{
  const root=temp(t), state=path.join(root,'state'); fs.mkdirSync(state,{mode:0o700});
  const observed=resolveExternalDemoStateV1(state,sourceRoot);
  fs.renameSync(state,path.join(root,'original')); fs.mkdirSync(state,{mode:0o700});
  assert.throws(()=>recheckExternalDemoStateV1(observed,sourceRoot),code);
  assert.deepEqual(fs.readdirSync(root).sort(),['original','state']);
});
test('a private final-component symlink is refused even with trailing separators or dot', t=>{
  const root=temp(t),target=path.join(root,'private'),link=path.join(root,'private-link');
  fs.mkdirSync(target,{mode:0o700});fs.symlinkSync(target,link);
  for(const value of [link,link+'/',link+'/.'])
    assert.throws(()=>resolveExternalDemoStateV1(value,sourceRoot),code);
  const child=path.join(target,'child');fs.mkdirSync(child,{mode:0o700});
  assert.equal(resolveExternalDemoStateV1(path.join(link,'child'),sourceRoot).directory,fs.realpathSync(child));
});
test('state option is separate from model configuration and legacy invocation is unchanged',()=>{
  const legacy=parseLiveDemoInvocation(args), external=parseLiveDemoInvocation([...args,'--state-dir','/test/private-state','--review-incidents']);
  assert.equal(Object.hasOwn(legacy,'stateDirectory'),false);
  assert.deepEqual(external.selected,legacy.selected); assert.equal(external.stateDirectory,'/test/private-state');
  assert.equal(external.reviewIncidents,true); assert.equal(Object.hasOwn(external.selected,'stateDirectory'),false);
  for(const extra of [['--state-dir'],['--state-dir',''],['--state-dir','--review-history'],
    ['--state-dir','/a','--state-dir','/b']]) assert.throws(()=>parseLiveDemoInvocation([...args,...extra]),{code:'LIVE_DEMO_ARGUMENTS'});
  assert.throws(()=>parseLiveDemoInvocation(['--help','--state-dir','/a']),{code:'LIVE_DEMO_ARGUMENTS'});
});
test('new CLI always requires explicit state before fixture or side effects; legacy help remains harmless',async()=>{
  await withPreflightGuards(async()=>{
    const result=await runNisiCli(['demo',...args]);
    assert.equal(result.exitCode,2); assert.equal(JSON.parse(result.stderr).code,'NISI_STATE_DIRECTORY_REQUIRED');
    await assert.rejects(runPrivateLiveDemo([...args,'--state-dir','relative']),code);
    assert.equal((await runPrivateLiveDemo(['--help'])).exitCode,0);
  });
});
