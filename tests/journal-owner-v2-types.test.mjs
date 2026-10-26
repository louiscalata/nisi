// Source-checkout type contract only. No dependency installation or package publication.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(root, 'tests/typechecks/journal-owner-v2.mts');
const compiler = path.join(root, 'node_modules/typescript/bin/tsc');
const flags = ['--noEmit', '--ignoreConfig', '--strict', '--exactOptionalPropertyTypes',
  '--noUncheckedIndexedAccess', '--module', 'NodeNext', '--target', 'ES2022',
  '--types', 'node', '--typeRoots', path.join(root, 'node_modules/@types')];
function compile(file) {
  const result = spawnSync(process.execPath, [compiler, ...flags, file], {
    cwd: root, encoding: 'utf8', timeout: 15000, maxBuffer: 1048576,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  return result;
}

test('journal owner v2 source consumer typechecks through the real mjs import path', () => {
  const result = compile(fixture);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('journal owner v2 negative controls fail at every expected type boundary', () => {
  const lines = fs.readFileSync(fixture, 'utf8').split('\n');
  const expected = [];
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].includes('@ts-expect-error')) {
      expected.push(index + 2);
      lines[index] = lines[index].replace('@ts-expect-error', 'type-error expectation intentionally disabled');
    }
  }
  assert.equal(expected.length, 8);
  const directory = fs.mkdtempSync(path.join(root, '.build/journal-owner-types-'));
  const target = path.join(directory, 'negative.mts');
  fs.writeFileSync(target, lines.join('\n'), {flag: 'wx'});
  const result = compile(target);
  // A compiler failure alone is insufficient: require precisely the intended lines.
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.equal(result.stderr, '');
  const diagnosticLines = [...result.stdout.matchAll(/negative\.mts\((\d+),\d+\): error TS\d+:/g)]
    .map(match => Number(match[1]));
  assert.deepEqual([...new Set(diagnosticLines)].sort((a, b) => a - b), expected.sort((a, b) => a - b));
  // Unsafe store access produces both nullable-value and missing-property errors;
  // all other markers produce one diagnostic with the pinned compiler.
  assert.equal(diagnosticLines.length, 9);
});
