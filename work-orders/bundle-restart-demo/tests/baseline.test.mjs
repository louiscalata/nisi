import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { runBundleDemoRequest } from '../src/bundle-restart-demo.mjs';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const pinned = {
  '../frozen/run-journal-v1.mjs': 'dee9f490c091000b2560cd9464d945885e7f341091b87dde9ae4f2b7cdbd359e',
  '../frozen/run-journal-store-v1.mjs': '1356028b65f9f8b96e3b9ec8ba3bfbb4968092af53d00e8b5dfdb11b161f4792',
  '../frozen/fixed-run-journal-entry.mjs': 'ba888a4f4d5b1b78f799045e44fbdfe79b75545847ab9b3ed2673fd7b353585c',
  '../frozen/host-journal-bundle.mjs': '97b2554b7fe50812fcb0065197964967d2beefc0c8cb322a38154ec16ebb9894',
  '../fixtures/summary-observed.json': 'a00dce2160b6f271080f1297b6f426c958205dc20a1369a2671c2c657bb4e8ad',
  '../fixtures/summary-timeout.json': '2d9180eb8a0d5fb6083489b1298fd23c26281df7c92ed85d74895d63e5bbd407'
};

test('baseline package stays private, dependency-free and ESM', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.license, 'UNLICENSED');
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.deepEqual(Object.keys(pkg.scripts), ['test', 'test:demo']);
});

test('baseline module exports the demo request function', () => {
  assert.equal(typeof runBundleDemoRequest, 'function');
});

test('baseline frozen modules are byte-identical to the integrated product modules', async () => {
  for (const [rel, hash] of Object.entries(pinned)) {
    assert.equal(sha256(await readFile(new URL(rel, import.meta.url))), hash, rel);
  }
});
