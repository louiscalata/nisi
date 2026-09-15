import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as store from '../src/run-journal-store-v1.mjs';

test('private dependency-free ESM baseline with exactly the store exports', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.license, 'UNLICENSED');
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.deepEqual(Object.keys(pkg.scripts), ['test', 'test:store']);
  assert.deepEqual(Object.keys(store).sort(), ['readSerializedJournal', 'writeSerializedJournal']);
});

test('source imports only deterministic crypto and path helpers; effects require injected fs', () => {
  const source = readFileSync(new URL('../src/run-journal-store-v1.mjs', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)].map(match => match[1]);
  assert.ok(imports.every(name => ['node:crypto', 'node:path'].includes(name)));
  assert.doesNotMatch(source, /node:(?:fs|os|child_process|net|http|https)|\b(?:process|require|fetch|eval|Function|Date|performance|setTimeout|setInterval)\b|Math\.random|randomUUID|randomBytes|import\s*\(|import\s*['"]/);
});
