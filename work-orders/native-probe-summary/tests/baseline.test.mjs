import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { formatNativeProbeSummary } from '../src/native-probe-summary.mjs';

test('baseline package stays private, dependency-free and ESM', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.license, 'UNLICENSED');
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.deepEqual(Object.keys(pkg.scripts), ['test', 'test:formatter']);
});

test('baseline formatter export is synchronous text and does not mutate its view', () => {
  const view = Object.freeze({ runId: 'baseline' });
  assert.equal(typeof formatNativeProbeSummary, 'function');
  assert.equal(typeof formatNativeProbeSummary(view), 'string');
  assert.deepEqual(view, { runId: 'baseline' });
});
