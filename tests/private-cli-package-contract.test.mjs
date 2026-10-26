import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isBuiltin } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { PRIVATE_CLI_MODULES, PRIVATE_CLI_ASSETS, PRIVATE_CLI_PACKAGE_FILES,
  createPrivateCliPackageMetadata } from '../scripts/private-cli-package-contract.mjs';
import { PRIVATE_PACKAGE_FILES } from '../scripts/private-package-contract.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const metadata = JSON.parse(fs.readFileSync(path.join(root,'package.json')));
test('private CLI has exactly 87 entries and a separate reviewed 29-entry library contract',()=>{
  assert.equal(PRIVATE_CLI_MODULES.length,76); assert.equal(PRIVATE_CLI_ASSETS.length,10);
  assert.equal(PRIVATE_CLI_PACKAGE_FILES.length,87); assert.equal(new Set(PRIVATE_CLI_PACKAGE_FILES).size,87);
  assert(!PRIVATE_CLI_MODULES.includes('cli/paired-arm-command-owner.mjs'));
  assert(!PRIVATE_CLI_MODULES.includes('hosts/repository/durable-paired-arm-owner-v1.mjs'));
  assert.equal(PRIVATE_PACKAGE_FILES.length,29); assert.equal(Object.hasOwn(metadata,'bin'),false);
  assert(!metadata.files.some(f=>f.startsWith('bin/')||f.startsWith('cli/')));
  const before=JSON.stringify(metadata), staged=createPrivateCliPackageMetadata(metadata);
  assert.equal(JSON.stringify(metadata),before); assert.equal(staged.name,'nisi-private-cli');
  assert.deepEqual(staged.bin,{nisi:'bin/nisi.mjs'});
  assert.equal(staged.private,true); assert.equal(staged.license,'UNLICENSED');
  assert.deepEqual(Object.keys(staged).sort(),['name','version','private','license','type','engines','bin','files'].sort());
  for(const patch of [{name:'other'},{version:'1.0.0'},{private:false},{license:'MIT'},{engines:{node:'>=18'}}])
    assert.throws(()=>createPrivateCliPackageMetadata({...metadata,...patch}));
  assert(Object.isFrozen(PRIVATE_CLI_PACKAGE_FILES));
});
test('every allowlisted file and its ancestor directories are ordinary package-relative entries',()=>{
  for(const relative of PRIVATE_CLI_PACKAGE_FILES) {
    assert(!path.isAbsolute(relative)); assert(!relative.split('/').includes('..'));
    const pieces=relative.split('/'); let target=root;
    for(const [i,piece] of pieces.entries()) {
      target=path.join(target,piece);const stat=fs.lstatSync(target);
      assert(!stat.isSymbolicLink(),relative);
      assert(i===pieces.length-1 ? stat.isFile() : stat.isDirectory(),relative);
    }
  }
  assert(fs.statSync(path.join(root,'bin/nisi.mjs')).mode & 0o100);
});
test('actual static and fixed dynamic imports close exactly over the reviewed CLI module list',()=>{
  const visited=new Set(), pending=['bin/nisi.mjs'];
  while(pending.length) {
    const file=pending.pop(); if(visited.has(file))continue; visited.add(file);
    assert(PRIVATE_CLI_MODULES.includes(file),'unlisted import '+file);
    const ast=ts.createSourceFile(file,fs.readFileSync(path.join(root,file),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
    assert.equal(ast.parseDiagnostics.length,0,file);
    function add(node) {
      assert(node&&ts.isStringLiteralLike(node),'nonliteral module import in '+file);
      const name=node.text; if(isBuiltin(name))return;
      assert(name.startsWith('./')||name.startsWith('../'),'external dependency '+name);
      const target=path.posix.normalize(path.posix.join(path.posix.dirname(file),name));
      assert(!target.startsWith('../')); pending.push(target);
    }
    function visit(node) {
      if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier)add(node.moduleSpecifier);
      if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword) {
        const arg=node.arguments[0];
        if(ts.isNewExpression(arg)) {
          // Existing symlink-aware binary resolves two fixed imports from its physical URL.
          assert.equal(file,'bin/nisi.mjs');assert.equal(arg.expression.getText(ast),'URL');
          assert.equal(arg.arguments.length,2);assert.equal(arg.arguments[1].getText(ast),'entryURL');add(arg.arguments[0]);
        } else add(arg);
      }
      ts.forEachChild(node,visit);
    } visit(ast);
  }
  assert.deepEqual([...visited].sort(),PRIVATE_CLI_MODULES);
});
