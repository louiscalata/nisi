import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../docs/editor/editor.js', import.meta.url), 'utf8');
const ast = ts.createSourceFile('editor.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function functions(...names) {
  const found = new Map();
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) found.set(node.name.text, node.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return names.map(name => { assert.ok(found.has(name), `missing ${name}`); return found.get(name); }).join('\n');
}
const state = () => ({schemaVersion:1,id:'nisi-brigade-editor-20260911-v1',baseRevision:'a'.repeat(64),editorBuild:'b'.repeat(64),savedAt:0,about:'About',sections:[{id:'section-1',current:'# Hello\n',baseline:'# Hello\n'}]});

test('editor rejects invalid initial state before storage, DOM mutation or provider use', () => {
  const bad = [null, {}, {...state(),about:42}, {...state(),savedAt:-1}, {...state(),baseRevision:'bad'},
    {...state(),sections:[]}, {...state(),sections:[state().sections[0],state().sections[0]]}];
  for (const id of ['section-1\" autofocus onfocus=\"bad', 'save', '__proto__', 'section-', 'section-a\n', 'section-'+'a'.repeat(130)]) bad.push({...state(),sections:[{...state().sections[0],id}]});
  for (const value of bad) {
    const ctx = vm.createContext({document:{getElementById(id){assert.equal(id,'state');return {textContent:JSON.stringify(value)};}},get localStorage(){throw Error('STORAGE_TOUCHED');}});
    assert.throws(() => vm.runInContext(source,ctx,{timeout:1000}), /EDITOR_STATE_INVALID/);
  }
});

test('initial and restored editor state share structural validation and revision binding', () => {
  const ctx = vm.createContext({state:state(),value:state()});
  vm.runInContext(functions('validState','validSaved'),ctx);
  assert.equal(vm.runInContext('validState(value) && validSaved(value)',ctx),true);
  for (const change of [{id:'other'}, {baseRevision:'c'.repeat(64)}, {sections:[{id:'save',current:'hi',baseline:''}]}, {savedAt:NaN}, {sections:[{id:'section-1',current:'hi',baseline:5}]}]) {
    ctx.value={...state(),...change};
    assert.equal(vm.runInContext('validSaved(value)',ctx),false);
  }
});

test('section attributes are assigned as DOM properties, never interpolated markup', () => {
  const fields = new Map();
  const element = {style:{},querySelector(key){if(!fields.has(key))fields.set(key,{style:{},setAttribute(){},addEventListener(){}});return fields.get(key);}};
  const ctx = vm.createContext({state:{sections:[{id:'section-1\" data-canary=\"test',current:'hello',baseline:''}]},document:{createElement:()=>element},$:()=>({replaceChildren(){},append(){}}),titleOf:()=>'',render:()=>'',buildNav(){},tally(){},onEdit(){}});
  vm.runInContext(functions('buildSections')+'\nbuildSections()',ctx);
  assert.ok(!element.innerHTML.includes('data-canary'));
  assert.equal(fields.get('textarea').id,'edit-section-1\" data-canary=\"test');
  assert.equal(fields.get('label').htmlFor,fields.get('textarea').id);
});

test('builder validates supplied section IDs and shape even with Python assertions disabled', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nisi-editor-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const editor=path.join(root,'editor');fs.mkdirSync(editor);
  for(const file of ['build-editor.py','editor.js','editor.css','chrome.html'])fs.copyFileSync(new URL('../docs/editor/'+file,import.meta.url),path.join(editor,file));
  const markdown='# Hello\n';fs.writeFileSync(path.join(root,'README-draft.md'),markdown);
  const run=value=>{fs.writeFileSync(path.join(root,'input.json'),JSON.stringify(value));return spawnSync('python3',['-O',path.join(editor,'build-editor.py'),'result.html',path.join(root,'input.json')],{encoding:'utf8',timeout:10000,maxBuffer:65536});};
  for(const supplied of [{about:'ok',sections:[{id:'section-1\" data-canary=\"test',current:markdown}]},{about:1,sections:[{id:'section-1',current:markdown}]},{about:'ok',sections:[{id:'save',current:markdown}]},{about:'ok',sections:[{id:'section-1',current:markdown,baseline:3}]}]) {
    const result=run(supplied);assert.equal(result.error,undefined);assert.notEqual(result.status,0);assert.equal(fs.existsSync(path.join(editor,'result.html')),false);
  }
  const result=run({about:'ok',sections:[{id:'section-1',current:markdown}]});
  assert.equal(result.status,0,result.stderr);
  const html=fs.readFileSync(path.join(editor,'result.html'),'utf8');
  const embedded=JSON.parse(html.match(/<script id="state" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(embedded.sections[0].baseline,markdown);
  assert.equal(embedded.sections.map(s=>s.current).join(''),markdown);
});
