// SPDX-License-Identifier: Apache-2.0
// Explicit negative controls against private copies of the current source.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

const repository = fileURLToPath(new URL('../', import.meta.url));
const root = fs.mkdtempSync(join(tmpdir(), 'journal-integration-mutations-'));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_CONFIG_')));
env.TMPDIR = root;
const mutations = JSON.parse(fs.readFileSync(new URL('./journal-integration-mutations.json', import.meta.url), 'utf8'));
const digest = text => createHash('sha256').update(text).digest('hex');
const groups = {
  store: ['tests/run-journal-store-read-bounds.test.mjs', 'tests/run-journal-read-anchor-compatibility.test.mjs'],
  anchor: ['tests/run-journal-anchor.test.mjs'],
};
const invoke = args => spawnSync(process.execPath, args, {
  cwd: root, env, encoding: 'utf8', timeout: 20_000, maxBuffer: 8 * 1024 * 1024,
});
const run = group => invoke(['--test', '--test-reporter=tap', '--test-concurrency=1', '--test-timeout=15000', ...groups[group]]);
const results = [];
try {
  const files = execFileSync('git', ['-C', repository, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { env }).toString('utf8').split('\0').filter(Boolean);
  for (const file of files) {
    fs.mkdirSync(dirname(join(root, file)), { recursive: true });
    fs.cpSync(join(repository, file), join(root, file), { dereference: false });
  }
  const originals = new Map(mutations.map(({ file }) => [file, fs.readFileSync(join(root, file), 'utf8')]));
  const sourceSha256 = Object.fromEntries([...originals].map(([file, source]) => [file, digest(source)]));
  const sourceTexts = new Set();
  for (const group of Object.keys(groups)) {
    const baseline = run(group);
    assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);
    assert.equal(baseline.error, undefined);
  }
  for (const mutation of mutations) {
    const source = originals.get(mutation.file);
    assert.equal(source.split(mutation.before).length - 1, 1, mutation.id + ': edit must be unique');
    const changed = source.replace(mutation.before, mutation.after);
    const sha256 = digest(changed);
    assert(!sourceTexts.has(sha256), mutation.id + ': duplicate source');
    sourceTexts.add(sha256);
    const target = join(root, mutation.file);
    fs.writeFileSync(target, changed);
    let status;
    let failures = null;
    try {
      const syntax = invoke(['--check', target]);
      if (syntax.status !== 0) status = 'INVALID';
      else {
        const output = run(mutation.file.includes('store') ? 'store' : 'anchor');
        failures = Number(output.stdout.match(/^# fail (\d+)$/m)?.[1] ?? 0);
        if (output.error?.code === 'ETIMEDOUT' || /testTimeoutFailure|test timed out/.test(output.stdout)) status = 'TIMEOUT';
        else if (output.status === 0) status = 'SURVIVED';
        else if (failures > 0 && /ERR_ASSERTION/.test(output.stdout)) status = 'ASSERTION_KILL';
        else status = 'ERROR';
      }
    } finally { fs.writeFileSync(target, source); }
    const result = { id: mutation.id, file: mutation.file, sha256, status, failures };
    results.push(result);
    console.log(JSON.stringify(result));
  }
  const statuses = Object.fromEntries(['ASSERTION_KILL', 'TIMEOUT', 'SURVIVED', 'INVALID', 'ERROR'].map(status => [status, results.filter(result => result.status === status).length]));
  console.log(JSON.stringify({ sourceSha256, distinctSourceTexts: sourceTexts.size, statuses, results }, null, 2));
  assert.equal(statuses.INVALID, 0, 'invalid controls do not count as tested mutations');
  assert.equal(statuses.ERROR, 0, 'harness errors do not count as assertion kills');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
