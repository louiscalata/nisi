import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as journal from '../src/run-journal-v1.mjs';

test('private dependency-free ESM package and declared exports', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.license, 'UNLICENSED');
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.deepEqual(Object.keys(pkg.scripts), ['test', 'test:journal']);
  assert.deepEqual(Object.keys(journal).sort(), ['createRunJournal', 'reopen']);
});

test('source uses no ambient effects and at most the declared deterministic hash import', async () => {
  const src = await readFile(new URL('../src/run-journal-v1.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\b(?:process|require|fetch|XMLHttpRequest|eval|Function|Date|performance|setTimeout|setInterval)\b|Math\.random|import\s*\(/);
  const imports = [...src.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)].map(x => x[1]);
  assert.ok(imports.every(x => x === 'node:crypto'));
  assert.doesNotMatch(src, /node:(?:fs|child_process|net|http|https)|randomUUID|randomBytes/);
});
