import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { adjudicateFixedCanaries, formatCanaryTable } from '../src/native-canary-adjudicator.mjs';

test('baseline package stays private, dependency-free and ESM', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.license, 'UNLICENSED');
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.deepEqual(Object.keys(pkg.scripts), ['test', 'test:adjudicate', 'test:format']);
});

test('baseline module exports the two named functions', () => {
  assert.equal(typeof adjudicateFixedCanaries, 'function');
  assert.equal(typeof formatCanaryTable, 'function');
});
