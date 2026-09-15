// Private canonical acceptance after exact-copy audit; no native/model execution.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {auditRelocation} from './verify-relocation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hash = file => createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
// This guard reads bytes only, BEFORE npm can import any relocated source.
const relocation = auditRelocation();
const previous = JSON.parse(fs.readFileSync(path.join(root, '.build/xpc-history-projection-h918xQ/product-post-integration.json'))).before;
const names = [...Object.keys(previous), ...relocation.files.map(file => file.destination),
  'history/journal-owner-v2.d.mts', 'history/import-fixed-xpc-observation-v1.mjs',
  'tests/import-fixed-xpc-observation.test.mjs', 'tests/typechecks/journal-owner-v2.mts',
  'tests/journal-owner-v2-types.test.mjs'].sort();
assert.equal(new Set(names).size, names.length);
const before = Object.fromEntries(names.map(name => [name, hash(name)]));
const evidence = fs.mkdtempSync(path.join(root, '.build/journal-owner-integration-'));
const record = {schemaVersion: 1, status: 'INCOMPLETE', startedAt: new Date().toISOString(),
  command: 'npm run check', cwd: root, evidence, node: process.version, before, relocation,
  authorizing: false, scope: 'Portable private product tests; no native launch or release acceptance'};
try {
  const result = spawnSync('npm', ['run', 'check'], {cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 16777216});
  Object.assign(record, {exitCode: result.status, signal: result.signal, error: result.error?.code ?? null});
  fs.writeFileSync(path.join(evidence, 'check.stdout'), result.stdout ?? '', {flag: 'wx'});
  fs.writeFileSync(path.join(evidence, 'check.stderr'), result.stderr ?? '', {flag: 'wx'});
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0);
  const counts = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(key => {
    const matches = [...result.stdout.matchAll(new RegExp('^(?:# |ℹ )' + key + ' (\\d+)$', 'gm'))];
    assert.equal(matches.length, 1, `exactly one terminal ${key} count`);
    return [key, Number(matches[0][1])];
  }));
  Object.assign(record, counts);
  assert.deepEqual(counts, {tests: 1331, pass: 1331, fail: 0, cancelled: 0, skipped: 0, todo: 0});
  const after = Object.fromEntries(names.map(name => [name, hash(name)]));
  record.after = after;
  record.changed = names.filter(name => before[name] !== after[name]);
  assert.deepEqual(record.changed, []);
  auditRelocation();
  record.status = 'PASS_SCOPED';
} catch (error) {
  record.status = 'FAIL'; record.failure = String(error.message); process.exitCode = 1;
} finally {
  record.completedAt = new Date().toISOString();
  fs.writeFileSync(path.join(evidence, 'verification.json'), JSON.stringify(record, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify({status: record.status, evidence, checkedFiles: names.length,
    tests: record.tests ?? null, pass: record.pass ?? null, fail: record.fail ?? null,
    failure: record.failure ?? null}));
}
