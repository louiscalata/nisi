import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runRecoveryRequest } from '../src/recovery-worker.mjs';
const hash = file => createHash('sha256').update(readFileSync(new URL(file, import.meta.url))).digest('hex');
test('private dependency-free ESM work order and synchronous export', () => {
  const p = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  assert.equal(p.private, true); assert.equal(p.type, 'module'); assert.equal(p.license, 'UNLICENSED');
  assert.equal(p.dependencies, undefined); assert.equal(typeof runRecoveryRequest, 'function');
});
test('accepted journal and corrected store stay frozen', () => {
  assert.equal(hash('../frozen/run-journal-v1.mjs'), 'dee9f490c091000b2560cd9464d945885e7f341091b87dde9ae4f2b7cdbd359e');
  assert.equal(hash('../frozen/run-journal-store-v1.mjs'), '1356028b65f9f8b96e3b9ec8ba3bfbb4968092af53d00e8b5dfdb11b161f4792');
});
