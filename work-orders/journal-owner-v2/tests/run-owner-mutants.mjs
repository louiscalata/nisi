// Owner-authored mutation harness. Only copied, hash-pinned source is changed.
// Retain every variant and terminal result under this work order's evidence/.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync, mkdtempSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const pins = {
  'src/index.mjs': '54777f65338a36ca6c208fc880c8ca4013ffce675c7aede2afdc2d8fa85f4e49',
  'src/run-journal-v1.mjs': 'dee9f490c091000b2560cd9464d945885e7f341091b87dde9ae4f2b7cdbd359e',
  'src/run-journal-store-v1.mjs': '1356028b65f9f8b96e3b9ec8ba3bfbb4968092af53d00e8b5dfdb11b161f4792',
  'tests/owner.test.mjs': 'db64b647aa4fc955eca89a048791df81be8e5e935b74e1e5554ef9bed047bd6d',
  'tests/helper.mjs': '67fc7262cc751d58000bb626cde33151c60f572329b4f52ca374821e8886b334',
  'tests/adjudication-boundaries.test.mjs': '4b7571a789e47f1bd27f686291a9b6579fed1199ba9f720cbf628a9fd3b8afb5'
};
const hash = value => createHash('sha256').update(value).digest('hex');
const source = readFileSync(join(root, 'src/index.mjs'), 'utf8');
for (const [path, sha] of Object.entries(pins)) assert.equal(hash(readFileSync(join(root, path))), sha, path);
const variants = [
  ['lossy-utf8', "  if (!Buffer.from(text, 'utf8').equals(bytes)) return refusal('INVALID_UTF8');", ''],
  ['foreign-invalid-prefix',
    "  if (persisted.config.projectId !== canonicalConfig.projectId) return refusal('PROJECT_MISMATCH');\n  if (canonical(persisted.config) !== configJson) return refusal('CONFIG_MISMATCH');",
    "  if (reopened.report.status !== 'INVALID' && persisted.config.projectId !== canonicalConfig.projectId) return refusal('PROJECT_MISMATCH');\n  if (reopened.report.status !== 'INVALID' && canonical(persisted.config) !== configJson) return refusal('CONFIG_MISMATCH');"],
  ['committed-refusal-stale-state', '      if (store.committed) sealUncertain(state, store.reason);', ''],
  ['fresh-disk-instead-of-private-cas',
    '    if (state.sha256 !== null) options.expectedPreviousSha256 = state.sha256;',
    '    if (state.sha256 !== null) options.expectedPreviousSha256 = digest(state.fs.readFileSync(state.path));'],
  ['mutable-public-handle', '  const owner = Object.freeze({});', '  const owner = {};'],
  ['publish-before-store-outcome',
    '    const options = {path: state.path, fs: state.fs, serialized};',
    '    state.snapshot = snapshot;\n    const options = {path: state.path, fs: state.fs, serialized};'],
  ['accept-config-drift', "  if (canonical(persisted.config) !== configJson) return refusal('CONFIG_MISMATCH');", ''],
  ['missing-busy-guard', "  if (state.busy) return refusal('OWNER_BUSY');", '']
];
const evidence = mkdtempSync(join(root, 'evidence', 'owner-mutants-'));
const records = [];
for (const [id, before, after] of variants) {
  assert.equal(source.split(before).length, 2, `unique mutation anchor: ${id}`);
  const directory = join(evidence, id);
  mkdirSync(join(directory, 'src'), {recursive: true});
  mkdirSync(join(directory, 'tests'));
  for (const path of [...Object.keys(pins), 'tests/memfs.mjs']) {
    writeFileSync(join(directory, path), path === 'src/index.mjs'
      ? source.replace(before, after) : readFileSync(join(root, path)));
  }
  const syntax = spawnSync(process.execPath, ['--check', 'src/index.mjs'], {cwd: directory, encoding: 'utf8', timeout: 5000});
  assert.equal(syntax.status, 0, syntax.stderr);
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-timeout=10000',
    'tests/owner.test.mjs', 'tests/adjudication-boundaries.test.mjs'],
  {cwd: directory, encoding: 'utf8', timeout: 20000, maxBuffer: 2 * 1024 * 1024});
  writeFileSync(join(directory, 'stdout.tap'), result.stdout ?? '');
  writeFileSync(join(directory, 'stderr.txt'), result.stderr ?? '');
  const count = key => Number(result.stdout.match(new RegExp(`^# ${key} (\\d+)$`, 'm'))?.[1] ?? NaN);
  const record = {id, sourceSha256: hash(readFileSync(join(directory, 'src/index.mjs'))),
    exitCode: result.status, signal: result.signal, error: result.error?.code ?? null,
    tests: count('tests'), pass: count('pass'), fail: count('fail'),
    cancelled: count('cancelled'), skipped: count('skipped'), todo: count('todo')};
  records.push(record);
  assert.equal(record.tests, 34, id);
  assert.equal(record.exitCode, 1, id);
  assert.equal(record.signal, null, id);
  assert.equal(record.error, null, id);
  assert.ok(record.fail > 0, id);
  assert.equal(record.pass + record.fail, 34, id);
  for (const key of ['cancelled', 'skipped', 'todo']) assert.equal(record[key], 0, id);
}
for (const [path, sha] of Object.entries(pins)) assert.equal(hash(readFileSync(join(root, path))), sha, path);
const report = {schemaVersion: 1, status: 'ALL_TARGETED_VARIANTS_CAUGHT',
  baseSourceSha256: pins['src/index.mjs'], protected: pins, variants: records,
  scope: 'Copied owner source only; no canonical or frozen dependency changes; not product acceptance', evidence};
writeFileSync(join(evidence, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
