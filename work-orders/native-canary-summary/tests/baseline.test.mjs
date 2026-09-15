import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { summarizeFixedRun } from '../src/native-canary-summary.mjs';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const pinned = {
  '../src/native-canary-adapter.mjs': 'ac9c9cfaacfad91a27f08d2daee461b1f0580892509dc76693ccd36bd35a5c8f',
  '../src/native-canary-adjudicator.mjs': 'cf875eaa7adf335ceab49ae16f9941e2d9b5b9780f5ca15c22eea4c97405de00',
  '../fixtures/inherit-run-service-raw.json': '00f76c88284738036b884c8242dbfa59c52f207bb2398a71d12798e591387d64',
  '../fixtures/inherit-run-node.stdout': '51612e7ba818bfe7dd2a42d46e8c0cf8e84332d63f2562132842e9879bc3dddc'
};

test('baseline package stays private, dependency-free and ESM', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.license, 'UNLICENSED');
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.deepEqual(Object.keys(pkg.scripts), ['test', 'test:summary']);
});

test('baseline module exports the summary function', () => {
  assert.equal(typeof summarizeFixedRun, 'function');
});

test('baseline frozen modules and fixtures are byte-identical to the accepted sources', async () => {
  for (const [rel, hash] of Object.entries(pinned)) {
    assert.equal(sha256(await readFile(new URL(rel, import.meta.url))), hash, rel);
  }
});
