import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
import {createPrivatePackageMetadata, PRIVATE_PACKAGE_FILES, PRIVATE_RUNTIME_FILES, PRIVATE_TYPE_FILES, PRIVATE_TYPED_EXPORTS} from '../scripts/private-package-contract.mjs';
const source = () => JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));
test('private checkout declares exact typed aliases and portable file inventory', () => {
  const p = source(); assert.deepEqual(p.exports, {...PRIVATE_TYPED_EXPORTS, './*': './*'});
  assert.deepEqual(p.files, [...PRIVATE_RUNTIME_FILES, ...PRIVATE_TYPE_FILES]); assert.equal(p.types, './types/index.d.ts');
});
test('every declared private payload source exists as a regular non-symlink file', () => {
  assert.equal(PRIVATE_PACKAGE_FILES.length, 27); assert.equal(new Set(PRIVATE_PACKAGE_FILES).size, 27);
  for (const f of PRIVATE_PACKAGE_FILES) {
    const stat = fs.lstatSync(new URL('../' + f, import.meta.url)); assert(stat.isFile()); assert(!stat.isSymbolicLink());
  }
});
test('staged private metadata strips scripts and development dependencies', () => {
  const p = createPrivatePackageMetadata(source());
  assert.equal(p.private, true); assert.equal(p.license, 'UNLICENSED');
  for (const key of ['scripts', 'devDependencies', 'dependencies', 'repository', 'homepage', 'bugs']) assert.equal(Object.hasOwn(p, key), false);
  assert.equal(p.exports['./*'], './*');
});
test('unreviewed payload exports or dependencies and public flags refuse staging', () => {
  const p = source();
  for (const patch of [{private: false}, {license: 'Apache-2.0'}, {dependencies: {nisi: 'file:self.tgz'}},
    {files: [...PRIVATE_RUNTIME_FILES, ...PRIVATE_TYPE_FILES, 'roadmap.md']},
    {exports: {...p.exports, './private': './roadmap.md'}}]) assert.throws(() => createPrivatePackageMetadata({...p, ...patch}));
});
test('engine compatibility cannot silently widen or disappear in staged metadata', () => {
  const p = source();
  for (const engines of [undefined, {}, {node: '>=20'}, {node: '>=22', npm: 'anything'}])
    assert.throws(() => createPrivatePackageMetadata({...p, engines}));
  assert.deepEqual(createPrivatePackageMetadata(p).engines, {node: '>=22'});
});
