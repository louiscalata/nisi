import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const positive = path.join(root, 'tests/typechecks/repository-host-history-positive.mts');
const negative = path.join(root, 'tests/typechecks/repository-host-history-negative.mts');
const compiler = path.join(root, 'node_modules/typescript/bin/tsc');
const flags = ['--noEmit', '--ignoreConfig', '--strict', '--exactOptionalPropertyTypes', '--noUncheckedIndexedAccess',
  '--module', 'NodeNext', '--target', 'ES2022', '--types', 'node', '--typeRoots', path.join(root, 'node_modules/@types')];
function compile(file) { return spawnSync(process.execPath, [compiler, ...flags, file], {cwd: root, encoding: 'utf8', timeout: 15000, maxBuffer: 1048576}); }

test('repository host history positive consumer typechecks', () => {
  const result = compile(positive);
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
});

test('repository host history negative controls hit every intended boundary', () => {
  const lines = fs.readFileSync(negative, 'utf8').split('\n');
  const expected = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes('@ts-expect-error')) {
      expected.push(i + 2);
      lines[i] = lines[i].replace('@ts-expect-error', 'type-error expectation intentionally disabled');
    }
  }
  assert.equal(expected.length, 7);
  const directory = fs.mkdtempSync(path.join(root, '.build/repository-host-history-types-'));
  const target = path.join(directory, 'negative.mts'); fs.writeFileSync(target, lines.join('\n'), {flag: 'wx'});
  const result = compile(target);
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.equal(result.stderr, '');
  const actual = [...result.stdout.matchAll(/negative\.mts\((\d+),\d+\): error TS\d+:/g)].map(m => Number(m[1]));
  assert.deepEqual([...new Set(actual)].sort((a, b) => a - b), expected.sort((a, b) => a - b));
  assert.equal(actual.length, 7);
});
