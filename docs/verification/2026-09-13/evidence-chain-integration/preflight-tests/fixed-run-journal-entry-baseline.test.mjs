import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fixedRunJournalEntry } from '../history/fixed-run-journal-entry.mjs';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const pinned = {
  './fixtures/fixed-run/summary-observed.json': 'a00dce2160b6f271080f1297b6f426c958205dc20a1369a2671c2c657bb4e8ad',
  './fixtures/fixed-run/summary-canaries-not-matched.json': '855b60f16c134943e9b04bbdc6c5385f686991728161d1ae58052b5e894f9ddf',
  './fixtures/fixed-run/summary-timeout.json': '2d9180eb8a0d5fb6083489b1298fd23c26281df7c92ed85d74895d63e5bbd407',
  './fixtures/fixed-run/summary-identity-unavailable.json': '2468510c52d2ff361a68fc9c636361d73995d5453a9db3bf4b804ced9ae9bbf2'
};

test('baseline package stays private, dependency-free and ESM', async () => {
  const pkg = JSON.parse(await readFile(new URL('./fixtures/fixed-run-journal-entry-package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.license, 'UNLICENSED');
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.deepEqual(Object.keys(pkg.scripts), ['test', 'test:entry']);
});

test('baseline module exports the entry builder', () => {
  assert.equal(typeof fixedRunJournalEntry, 'function');
});

test('baseline frozen journal module and summary fixtures are byte-identical to the accepted sources', async () => {
  for (const [rel, hash] of Object.entries(pinned)) {
    assert.equal(sha256(await readFile(new URL(rel, import.meta.url))), hash, rel);
  }
});
