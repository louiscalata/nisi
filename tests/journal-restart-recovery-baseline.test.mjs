import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runRecoveryRequest } from '../history/recovery-worker.mjs';
test('private dependency-free ESM work order and synchronous export', () => {
  const p = JSON.parse(readFileSync(new URL('./fixtures/journal-restart-recovery-package.json', import.meta.url)));
  assert.equal(p.private, true); assert.equal(p.type, 'module'); assert.equal(p.license, 'UNLICENSED');
  assert.equal(p.dependencies, undefined); assert.equal(typeof runRecoveryRequest, 'function');
});
