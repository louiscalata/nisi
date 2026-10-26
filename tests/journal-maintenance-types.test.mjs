// Source-checkout type contract only. No dependency installation or publication.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(root, 'tests/typechecks/journal-maintenance-v1.mts');
const compiler = path.join(root, 'node_modules/typescript/bin/tsc');
const flags = ['--noEmit', '--ignoreConfig', '--strict', '--exactOptionalPropertyTypes',
  '--noUncheckedIndexedAccess', '--module', 'NodeNext', '--target', 'ES2022',
  '--types', 'node', '--typeRoots', path.join(root, 'node_modules/@types')];
function compile(file) {
  return spawnSync(process.execPath, [compiler, ...flags, file], {
    cwd: root, encoding: 'utf8', timeout: 15000, maxBuffer: 1048576,
  });
}

test('journal maintenance consumer typechecks with real fs compatibility and narrowing', () => {
  const result = compile(fixture);
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('journal maintenance negative controls fail at every intended boundary', () => {
  const lines = fs.readFileSync(fixture, 'utf8').split('\n');
  const expected = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].includes('@ts-expect-error')) {
      expected.push(index + 2);
      lines[index] = lines[index].replace('@ts-expect-error', 'type-error expectation intentionally disabled');
    }
  }
  assert.equal(expected.length, 7);
  const directory = fs.mkdtempSync(path.join(root, '.build/journal-maintenance-types-'));
  const target = path.join(directory, 'negative.mts');
  fs.writeFileSync(target, lines.join('\n'), {flag: 'wx'});
  const result = compile(target);
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.equal(result.stderr, '');
  const diagnosticLines = [...result.stdout.matchAll(/negative\.mts\((\d+),\d+\): error TS\d+:/g)]
    .map(match => Number(match[1]));
  assert.deepEqual([...new Set(diagnosticLines)].sort((a, b) => a - b), expected.sort((a, b) => a - b));
  // Opaque failed-store access yields both nullable and missing-property errors.
  assert.equal(diagnosticLines.length, 8);
});
