import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { openJournalBundle, recordFixedRun } from '../history/host-journal-bundle.mjs';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const pinned = {
  './fixtures/fixed-run/summary-observed.json': 'a00dce2160b6f271080f1297b6f426c958205dc20a1369a2671c2c657bb4e8ad',
  './fixtures/fixed-run/summary-timeout.json': '2d9180eb8a0d5fb6083489b1298fd23c26281df7c92ed85d74895d63e5bbd407'
};

test('baseline package stays private, dependency-free and ESM', async () => {
  const pkg = JSON.parse(await readFile(new URL('./fixtures/host-journal-bundle-package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.license, 'UNLICENSED');
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.deepEqual(Object.keys(pkg.scripts), ['test', 'test:bundle']);
});

test('baseline module exports the two bundle functions', () => {
  assert.equal(typeof openJournalBundle, 'function');
  assert.equal(typeof recordFixedRun, 'function');
});

test('baseline frozen modules and fixtures are byte-identical to the accepted sources', async () => {
  for (const [rel, hash] of Object.entries(pinned)) {
    assert.equal(sha256(await readFile(new URL(rel, import.meta.url))), hash, rel);
  }
});
