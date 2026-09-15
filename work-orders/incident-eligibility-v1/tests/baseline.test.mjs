import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('private dependency-free ESM work order with the single expected export name', async () => {
  const p = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  assert.equal(p.private, true); assert.equal(p.type, 'module'); assert.equal(p.license, 'UNLICENSED');
  assert.equal(p.dependencies, undefined);
  const ns = await import('../src/incident-eligibility-v1.mjs');
  assert.deepEqual(Object.keys(ns), ['decideIncidentEligibilityV1']);
});
