// Proposed isolated oracle for c09-owner-context.mjs. No execution or
// acceptance claim is made from this draft.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {collectOwnerContext} from './c09-owner-context.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(HERE,'../../..');
const RETAINED=path.resolve(HERE,'../runtime-node24-TyjDOb');
const EXPECTED=JSON.parse(fs.readFileSync(path.join(RETAINED,'expected.json'),'utf8'));
const INTENT=JSON.parse(fs.readFileSync(path.join(RETAINED,'intent.json'),'utf8'));

function copy(root,relative){const from=path.join(ROOT,relative),to=path.join(root,relative);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);}
function scratch(t){
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'nisi-owner-context-')));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const baseline=collectOwnerContext({projectRoot:ROOT,nodePath:process.execPath});
  for(const relative of Object.keys(baseline.inputs)){
    if(path.isAbsolute(relative))continue;
    copy(root,relative);
  }
  collectOwnerContext({projectRoot:root,nodePath:process.execPath});
  return root;
}
function assertShape(context){
  assert.equal(context.contract.sourceManifest && Object.keys(context.contract.sourceManifest).length,29);
  assert.equal(context.contract.stageManifest && Object.keys(context.contract.stageManifest).length,29);
  assert.equal(context.contract.caseManifest && Object.keys(context.contract.caseManifest).length,12);
  assert.equal(context.contract.negativeLocations?.length,73);
  assert.equal(context.ownerPins.version,'v24.18.0');
  assert.equal(context.ownerPins.command[1],'scripts/check-private-package.mjs');
  assert.equal(context.ownerPins.cwd,ROOT);
}

test('real current checkout derives the frozen-sized context without capture input',()=>{
  const context=collectOwnerContext({projectRoot:ROOT,nodePath:process.execPath});
  assertShape(context);
  assert.deepEqual(context.contract.sourceManifest,EXPECTED.sourceManifest);
  assert.deepEqual(context.contract.stageManifest,EXPECTED.stageManifest);
  assert.deepEqual(context.contract.caseManifest,EXPECTED.caseManifest);
  assert.deepEqual(context.contract.negativeLocations,EXPECTED.negativeLocations);
  assert.deepEqual(context.ownerPins.node,INTENT.node);
  assert.deepEqual(context.ownerPins.writer,INTENT.writer);
});

test('owned scratch closure is a positive independent-source context',t=>{
  const root=scratch(t);
  const context=collectOwnerContext({projectRoot:root,nodePath:process.execPath});
  assert.equal(Object.keys(context.contract.sourceManifest).length,29);
  assert.equal(Object.keys(context.contract.caseManifest).length,12);
  assert.equal(context.ownerPins.cwd,root);
});

test('source and case mutations produce new observations; inventory breaks refuse',async t=>{
  await t.test('package source digest changes',t=>{const root=scratch(t),before=collectOwnerContext({projectRoot:root,nodePath:process.execPath});fs.appendFileSync(path.join(root,'index.mjs'),'\n// owned mutation\n');const after=collectOwnerContext({projectRoot:root,nodePath:process.execPath});assert.notEqual(after.contract.sourceManifest['index.mjs'],before.contract.sourceManifest['index.mjs']);});
  await t.test('case digest changes',t=>{const root=scratch(t),before=collectOwnerContext({projectRoot:root,nodePath:process.execPath});fs.appendFileSync(path.join(root,'tests/private-consumer/baseline.mts'),'\n// owned mutation\n');const after=collectOwnerContext({projectRoot:root,nodePath:process.execPath});assert.notEqual(after.contract.caseManifest['baseline.mts'],before.contract.caseManifest['baseline.mts']);});
  await t.test('case omission refuses',t=>{const root=scratch(t);fs.unlinkSync(path.join(root,'tests/private-consumer/baseline.mts'));assert.throws(()=>collectOwnerContext({projectRoot:root,nodePath:process.execPath}),/CONTEXT_/);});
  await t.test('extra case refuses',t=>{const root=scratch(t);fs.writeFileSync(path.join(root,'tests/private-consumer/extra.mts'),'');assert.throws(()=>collectOwnerContext({projectRoot:root,nodePath:process.execPath}),/CONTEXT_/);});
  for(const relative of ['package.json','node_modules/typescript/package.json','node_modules/@types/node/package.json','tests/private-consumer/baseline.mts'])await t.test('malformed UTF8 '+relative,t=>{const root=scratch(t);fs.writeFileSync(path.join(root,relative),Buffer.from([0xc3,0x28]));assert.throws(()=>collectOwnerContext({projectRoot:root,nodePath:process.execPath}),/CONTEXT_UTF8/);});
  await t.test('moved marker changes locations while preserving count',t=>{const root=scratch(t),before=collectOwnerContext({projectRoot:root,nodePath:process.execPath});const file=path.join(root,'tests/private-consumer/declaration-regressions.mts');const bytes=fs.readFileSync(file,'utf8');fs.writeFileSync(file,'\n'+bytes);const after=collectOwnerContext({projectRoot:root,nodePath:process.execPath});assert.equal(after.contract.negativeLocations.length,73);assert.notDeepEqual(after.contract.negativeLocations,before.contract.negativeLocations);});
});

test('identity, containment, and size boundaries refuse',async t=>{
  await t.test('altered writer hash',t=>{const root=scratch(t);fs.appendFileSync(path.join(root,'scripts/check-private-package.mjs'),'\n');assert.throws(()=>collectOwnerContext({projectRoot:root,nodePath:process.execPath}),/CONTEXT_/);});
  await t.test('altered contract pin',t=>{const root=scratch(t);fs.appendFileSync(path.join(root,'scripts/private-package-contract.mjs'),'\n');assert.throws(()=>collectOwnerContext({projectRoot:root,nodePath:process.execPath}),/CONTEXT_CONTRACT/);});
  await t.test('contract executable mutation is never imported',t=>{const root=scratch(t);fs.appendFileSync(path.join(root,'scripts/private-package-contract.mjs'),'\nglobalThis.__c09ContractExecuted=true;\n');assert.throws(()=>collectOwnerContext({projectRoot:root,nodePath:process.execPath}),/CONTEXT_CONTRACT/);assert.equal(globalThis.__c09ContractExecuted,undefined);});
  await t.test('forbidden package dependency',t=>{const root=scratch(t),file=path.join(root,'package.json'),value=JSON.parse(fs.readFileSync(file));value.dependencies={bad:'1.0.0'};fs.writeFileSync(file,JSON.stringify(value));assert.throws(()=>collectOwnerContext({projectRoot:root,nodePath:process.execPath}),/CONTEXT_/);});
  await t.test('symlink ancestor',t=>{const root=scratch(t),alias=root+'-alias';t.after(()=>fs.rmSync(alias,{recursive:true,force:true}));fs.symlinkSync(root,alias,'dir');assert.throws(()=>collectOwnerContext({projectRoot:alias,nodePath:process.execPath}),/CONTEXT_/);});
  await t.test('case directory instead of file',t=>{const root=scratch(t),file=path.join(root,'tests/private-consumer/baseline.mts');fs.unlinkSync(file);fs.mkdirSync(file);assert.throws(()=>collectOwnerContext({projectRoot:root,nodePath:process.execPath}),/CONTEXT_/);});
  await t.test('case symlink instead of file',t=>{const root=scratch(t),file=path.join(root,'tests/private-consumer/baseline.mts');fs.unlinkSync(file);fs.symlinkSync(path.join(root,'tests/private-consumer/edge-cases.mts'),file);assert.throws(()=>collectOwnerContext({projectRoot:root,nodePath:process.execPath}),/CONTEXT_/);});
  await t.test('oversize source',t=>{const root=scratch(t),file=path.join(root,'index.mjs');fs.writeFileSync(file,'x'.repeat(8*1024*1024));assert.throws(()=>collectOwnerContext({projectRoot:root,nodePath:process.execPath}),/CONTEXT_/);});
});

test('options reject proxies and accessors without invoking traps',()=>{
  let traps=0;const options=Object.defineProperty({projectRoot:ROOT,nodePath:process.execPath},'projectRoot',{enumerable:true,get(){traps++;throw new Error('trap');}});assert.throws(()=>collectOwnerContext(options),/CONTEXT_INPUT/);assert.equal(traps,0);
  const revoked=Proxy.revocable({projectRoot:ROOT,nodePath:process.execPath},{});revoked.revoke();assert.throws(()=>collectOwnerContext(revoked.proxy),/CONTEXT_INPUT/);
  const nested=Object.defineProperty({projectRoot:ROOT,nodePath:process.execPath},'nodePath',{enumerable:true,get(){traps++;throw new Error('trap');}});assert.throws(()=>collectOwnerContext(nested),/CONTEXT_INPUT/);assert.equal(traps,0);
});

test('repeated snapshots do not mutate the checkout or change their byte maps',()=>{
  const a=collectOwnerContext({projectRoot:ROOT,nodePath:process.execPath});
  const b=collectOwnerContext({projectRoot:ROOT,nodePath:process.execPath});
  assert.deepEqual(a,b);
});
