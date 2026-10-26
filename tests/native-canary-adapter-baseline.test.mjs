import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { adaptFixedCanaryOutput, fixedCanaryMappingV1, expectedMatrixFor } from '../hosts/macos-xpc/native-canary-adapter.mjs';
import { adjudicateFixedCanaries, formatCanaryTable } from '../hosts/macos-xpc/native-canary-adjudicator.mjs';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

test('baseline package stays private, dependency-free and ESM', async () => {
  const pkg = JSON.parse(await readFile(new URL('./fixtures/native-canary-adapter-package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.license, 'UNLICENSED');
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.deepEqual(Object.keys(pkg.scripts), ['test', 'test:adapter']);
});

test('baseline module exports the three named functions', () => {
  assert.equal(typeof adaptFixedCanaryOutput, 'function');
  assert.equal(typeof fixedCanaryMappingV1, 'function');
  assert.equal(typeof expectedMatrixFor, 'function');
});

test('baseline frozen fixtures are byte-identical to the accepted sources', async () => {
  assert.equal(typeof adjudicateFixedCanaries, 'function');
  assert.equal(typeof formatCanaryTable, 'function');
  const stdout = await readFile(new URL('./fixtures/native-canary/inherit-run-node.stdout', import.meta.url));
  assert.equal(stdout.length, 781);
  assert.equal(sha256(stdout), '51612e7ba818bfe7dd2a42d46e8c0cf8e84332d63f2562132842e9879bc3dddc');
});
