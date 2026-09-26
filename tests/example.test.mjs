// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const example = fileURLToPath(new URL('../examples/allow-a-file.mjs', import.meta.url));
const SKIPPED_LINK = /^SKIPPED {2}looks-safe\.json {2}symlink creation not permitted \((?:EPERM|EACCES)\)$/;

// Replaces fs.symlinkSync before the example loads, as Windows without symlink privilege would.
const failSymlink = code => `data:text/javascript,import fs from 'node:fs'; fs.symlinkSync = () => { throw Object.assign(new Error('simulated symlink failure'), { code: '${code}' }); };`;

function runInFreshTemp(nodeArgs) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nisi-example-temp-'));
  try {
    const result = spawnSync(process.execPath, [...nodeArgs, example], {
      encoding: 'utf8', timeout: 15_000, env: { ...process.env, TMPDIR: temp, TMP: temp, TEMP: temp },
    });
    return { result, leftovers: fs.readdirSync(temp) };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

test('the README example runs and prints what the README says it prints', () => {
  const out = execFileSync(process.execPath, ['examples/allow-a-file.mjs'], { encoding: 'utf8' });
  const lines = out.trim().split('\n');
  assert.equal(lines.length, 7);
  assert.match(lines[0], /^ALLOWED {2}notes\.json {2}sha256=[0-9a-f]{12}…$/);
  assert.equal(lines[1], 'REFUSED  secrets.json  CONTENT_OUT_OF_SCOPE');
  assert.equal(lines[2], 'REFUSED  notes.json  CONTENT_KIND_REFUSED');
  assert.equal(lines[3], 'REFUSED  missing.json  CONTENT_PATH_UNRESOLVABLE');
  // Windows without Developer Mode or administrator rights cannot create the link.
  if (!(process.platform === 'win32' && SKIPPED_LINK.test(lines[4]))) assert.equal(lines[4], 'REFUSED  looks-safe.json  CONTENT_OUT_OF_SCOPE');
  assert.equal(lines[5], 'REFUSED  notes.json  CONSENT_REVOKED');
  assert.equal(lines[6], 'same hash for same meaning');
});

test('the example skips only the symlink case when symlink creation is not permitted, and removes both scratch folders', () => {
  for (const code of ['EPERM', 'EACCES']) {
    const { result, leftovers } = runInFreshTemp(['--import', failSymlink(code)]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    const lines = result.stdout.trim().split('\n');
    assert.equal(lines.length, 7);
    assert.equal(lines[4], `SKIPPED  looks-safe.json  symlink creation not permitted (${code})`);
    assert.equal(lines[5], 'REFUSED  notes.json  CONSENT_REVOKED');
    assert.deepEqual(leftovers, []);
  }
});

test('the example removes both scratch folders when a step fails and does not hide the failure', () => {
  const failed = runInFreshTemp(['--import', failSymlink('ENOSPC')]);
  assert.equal(failed.result.status, 1);
  assert.match(failed.result.stderr, /simulated symlink failure/);
  assert.doesNotMatch(failed.result.stdout, /SKIPPED/);
  assert.deepEqual(failed.leftovers, []);

  const passed = runInFreshTemp([]);
  assert.equal(passed.result.status, 0, passed.result.stderr);
  assert.deepEqual(passed.leftovers, []);
});
