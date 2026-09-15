// Owner-authored compatibility mutant: a failed observation must stay failed.
// No canonical edit or native process execution. Keep the copied mutant receipt.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync, mkdtempSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const product = new URL('../../../', import.meta.url);
const hash = value => createHash('sha256').update(value).digest('hex');
const pins = {
  'src/index.mjs': '54777f65338a36ca6c208fc880c8ca4013ffce675c7aede2afdc2d8fa85f4e49',
  'src/run-journal-v1.mjs': 'dee9f490c091000b2560cd9464d945885e7f341091b87dde9ae4f2b7cdbd359e',
  'src/run-journal-store-v1.mjs': '1356028b65f9f8b96e3b9ec8ba3bfbb4968092af53d00e8b5dfdb11b161f4792',
  'tests/windows-xpc-integration.test.mjs': '80347a4794d664a6d806d5e0494bb0f2f551644d546c7e5353e7933d147903ef',
  'tests/memfs.mjs': 'e202da18a120645ccdf6c51da48843f64ca90b6af48e87d3fdcb5cda0f9319c0'
};
for (const [path, sha] of Object.entries(pins)) assert.equal(hash(readFileSync(join(root, path))), sha);
const directory = mkdtempSync(join(root, 'evidence', 'xpc-mutant-'));
mkdirSync(join(directory, 'src')); mkdirSync(join(directory, 'tests'));
for (const path of Object.keys(pins)) {
  let source = readFileSync(join(root, path), 'utf8');
  if (path === 'src/index.mjs') {
    const before = '    const entries = frozenPlain(staged.list(req.now));';
    assert.equal(source.split(before).length, 2);
    source = source.replace(before, "    const entries = frozenPlain(staged.list(req.now).map(row => ({...row, entry: {...row.entry, state: 'SUCCEEDED'}})));");
  }
  if (path === 'tests/windows-xpc-integration.test.mjs') {
    for (const rel of ['history/fixed-xpc-journal-observation-v1.mjs', 'tests/fixtures/fixed-xpc-journal-observation.mjs']) {
      source = source.replace(`'../../../${rel}'`, JSON.stringify(new URL(rel, product).href));
    }
  }
  writeFileSync(join(directory, path), source);
}
const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-timeout=10000', 'tests/windows-xpc-integration.test.mjs'],
  {cwd: directory, encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024});
writeFileSync(join(directory, 'stdout.tap'), result.stdout ?? '');
writeFileSync(join(directory, 'stderr.txt'), result.stderr ?? '');
const count = key => Number(result.stdout.match(new RegExp(`^# ${key} (\\d+)$`, 'm'))?.[1] ?? NaN);
const receipt = {schemaVersion: 1, variant: 'promote-failed-observation', exitCode: result.status,
  signal: result.signal, error: result.error?.code ?? null, tests: count('tests'), pass: count('pass'),
  fail: count('fail'), skipped: count('skipped'), cancelled: count('cancelled'), todo: count('todo'),
  sourceSha256: hash(readFileSync(join(directory, 'src/index.mjs'))), protected: pins, directory};
writeFileSync(join(directory, 'verification.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt, null, 2));
assert.equal(receipt.exitCode, 1); assert.equal(receipt.tests, 4);
assert.equal(receipt.pass, 3); assert.equal(receipt.fail, 1);
for (const key of ['skipped', 'cancelled', 'todo']) assert.equal(receipt[key], 0);
assert.equal(receipt.signal, null); assert.equal(receipt.error, null);
for (const [path, sha] of Object.entries(pins)) assert.equal(hash(readFileSync(join(root, path))), sha);
