import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runRecoveryRequest } from './scratch/src/recovery-worker.mjs';

test('private dependency-free ESM work order and synchronous export', () => {
  const p = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  assert.equal(p.private, true); assert.equal(p.type, 'module'); assert.equal(p.license, 'UNLICENSED');
  assert.equal(p.dependencies, undefined); assert.equal(typeof runRecoveryRequest, 'function');
});
test('product modules are bound from the scratch history tree (no frozen-copy pins)', () => {
  // The frozen-copy hash pins are dropped deliberately: run-journal-v1 and
  // run-journal-store-v1 are product modules under history/, so the scratch
  // tree must bind them and no pin may point at a product module.
  const worker = readFileSync(new URL('./scratch/src/recovery-worker.mjs', import.meta.url), 'utf8');
  assert.match(worker, /from '\.\.\/history\/run-journal-v1\.mjs'/);
  assert.match(worker, /from '\.\.\/history\/run-journal-store-v1\.mjs'/);
  assert.doesNotMatch(worker, /frozen/);
});