import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { verifyImportedTree } from '../scripts/verify-veritas-import.mjs';

test('retained real private snapshot matches its frozen inventory', () => {
  const root = new URL('../integrations/veritas/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('import-manifest.json', root), 'utf8'));
  assert.equal(verifyImportedTree(fileURLToPath(root), manifest).files, 225);
});
