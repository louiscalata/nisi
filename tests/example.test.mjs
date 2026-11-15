// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('the README example runs and prints what the README says it prints', () => {
  const out = execFileSync(process.execPath, [fileURLToPath(new URL('../examples/allow-a-file.mjs', import.meta.url))], { encoding: 'utf8' });
  const lines = out.trim().split('\n');
  assert.match(lines[0], /^ALLOWED {2}notes\.json {2}sha256=[0-9a-f]{12}…$/);
  assert.equal(lines[1], 'REFUSED  secrets.json  CONTENT_OUT_OF_SCOPE');
  assert.equal(lines[2], 'REFUSED  notes.json  CONTENT_KIND_REFUSED');
  assert.equal(lines[3], 'REFUSED  missing.json  CONTENT_PATH_UNRESOLVABLE');
  assert.equal(lines[4], 'REFUSED  looks-safe.json  CONTENT_OUT_OF_SCOPE');
  assert.equal(lines[5], 'REFUSED  notes.json  CONSENT_REVOKED');
  assert.equal(lines[6], 'same hash for same meaning');
});

test('examples and the harder-task runner still run when invoked through a symlinked path', t => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nisi-entry-link-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const link = path.join(dir, 'nisi');
  try { fs.symlinkSync(root, link, 'dir'); } catch (error) {
    if (error.code === 'EPERM') return t.skip('creating a symlink needs extra rights on this Windows account');
    throw error;
  }
  const run = (file, args = []) => spawnSync(process.execPath, [path.join(link, file), ...args], { encoding: 'utf8' });

  const workflow = run('examples/workflow.mjs');
  assert.equal(workflow.status, 0, workflow.stderr);
  const report = JSON.parse(workflow.stdout);
  assert.equal(report.outcome, 'COMPLETED');
  assert.equal(report.reportStored, true);
  fs.rmSync(path.dirname(report.reportPath), { recursive: true, force: true });

  const localModel = run('examples/local-model-workflow.mjs');
  assert.equal(localModel.status, 2);
  assert.match(localModel.stderr, /Usage: node examples\/local-model-workflow\.mjs/);

  const harder = run('benchmarks/harder/run.mjs');
  assert.equal(harder.status, 1);
  assert.match(harder.stderr, /^USAGE: --allow-live/);
});
