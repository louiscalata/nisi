import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectImportedTree, verifyImportedTree } from '../scripts/verify-veritas-import.mjs';

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'nisi-import-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'native/macos'), { recursive: true });
  mkdirSync(path.join(root, 'tooling'));
  writeFileSync(path.join(root, '.npmrc'), 'engine-strict=true\n');
  writeFileSync(path.join(root, 'package.json'), '{}\n');
  writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
  writeFileSync(path.join(root, 'veritas.ts'), 'export const privateSource = true;\n');
  writeFileSync(path.join(root, 'native/macos/Native.swift'), 'import Foundation\n');
  writeFileSync(path.join(root, 'tooling/check.mjs'), 'export const version = 1;\n');
  const manifest = {
    schemaVersion: 1, purpose: 'PRIVATE_VERITAS_SOURCE_FREEZE', frozenAt: '2026-09-12T00:00:00.000Z',
    source: { root: '/original/private/source', head: 'a'.repeat(40), treeState: 'DIRTY_INCLUDING_UNTRACKED_SOURCE', comparison: 'EACH_INCLUDED_FILE_BYTE_MATCHED_AT_FREEZE' },
    roots: ['.npmrc', 'native/macos', 'package-lock.json', 'package.json', 'tooling', 'veritas.ts'],
    exclusionPolicy: 'explicit-root-files; subtree-exclusions:hidden-entries,node_modules,DerivedData,*.xcresult',
    files: inspectImportedTree(root).files,
  };
  return { root, manifest };
}

test('frozen import matches exact content; scope never expands to integration or release', t => {
  const { root, manifest } = fixture(t);
  const result = verifyImportedTree(root, manifest);
  assert.equal(result.status, 'PASS_SOURCE_FREEZE_ONLY');
  assert.equal(result.files, 6);
  assert.equal(result.integrationVerified, false);
  assert.equal(result.legalClearance, false);
  assert.equal(result.originRechecked, false);
});

for (const [name, change, expected] of [
  ['same-size content edit', ({ root }) => writeFileSync(path.join(root, 'tooling/check.mjs'), 'export const version = 2;\n'), /IMPORT_CONTENT_DRIFT/],
  ['new source', ({ root }) => writeFileSync(path.join(root, 'tooling/new.mjs'), 'new'), /IMPORT_INVENTORY_DRIFT/],
  ['missing source', ({ root }) => rmSync(path.join(root, 'tooling/check.mjs')), /IMPORT_INVENTORY_DRIFT/],
  ['duplicate inventory entry', ({ manifest }) => manifest.files.push(manifest.files[1]), /IMPORT_ENTRY_PATH/],
  ['path traversal', ({ manifest }) => { manifest.files[0].path = 'native/macos/../outside'; }, /IMPORT_ENTRY_PATH/],
  ['unknown authority field', ({ manifest }) => { manifest.certified = true; }, /IMPORT_MANIFEST_SCHEMA/],
  ['wrong schema', ({ manifest }) => { manifest.schemaVersion = 2; }, /IMPORT_MANIFEST_VERSION/],
  ['empty inventory', ({ manifest }) => { manifest.files = []; }, /IMPORT_FILES_INVALID/],
  ['invalid digest', ({ manifest }) => { manifest.files[0].sha256 = 'PASS'; }, /IMPORT_ENTRY_DIGEST/],
  ['scope changed', ({ manifest }) => { manifest.roots = ['tooling']; }, /IMPORT_SCOPE_INVALID/],
  ['file symlink', ({ root }) => { rmSync(path.join(root, 'tooling/check.mjs')); symlinkSync('../native/macos/Native.swift', path.join(root, 'tooling/check.mjs')); }, /IMPORT_SYMLINK/],
]) test(`import refuses ${name}`, t => {
  const state = fixture(t);
  change(state);
  assert.throws(() => verifyImportedTree(state.root, state.manifest), expected);
});

test('excluded build and hidden entries are named but not traversed or accepted as source', t => {
  const { root, manifest } = fixture(t);
  symlinkSync('/deliberately-unavailable', path.join(root, 'tooling/node_modules'));
  mkdirSync(path.join(root, 'native/macos/.build'));
  writeFileSync(path.join(root, 'native/macos/.build/private-log'), 'must not be read');
  const result = verifyImportedTree(root, manifest);
  assert.deepEqual(result.excluded, ['native/macos/.build', 'tooling/node_modules']);
  assert.equal(result.files, 6);
});
