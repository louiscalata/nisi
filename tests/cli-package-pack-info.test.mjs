// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
// `npm pack --json` output shapes read by scripts/check-cli-package.mjs.
// The fixtures are recorded shapes; no npm process or network is used.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readPackInfo } from '../scripts/pack-info.mjs';

const entry = {
  id: 'nisi@0.3.1',
  name: 'nisi',
  version: '0.3.1',
  filename: 'nisi-0.3.1.tgz',
  files: [
    { path: 'LICENSE', size: 11358, mode: 420 },
    { path: 'bin/nisi.mjs', size: 100, mode: 493 },
  ],
  entryCount: 2,
  bundled: [],
};

// npm 10 and 11 print an array with one entry per packed package.
const npm11Stdout = `${JSON.stringify([entry], null, 2)}\n`;
// npm 12 prints an object keyed by package name.
const npm12Stdout = `${JSON.stringify({ nisi: entry }, null, 2)}\n`;

test('reads the npm 10/11 array shape', () => {
  const info = readPackInfo(npm11Stdout, 'nisi');
  assert.equal(info.filename, 'nisi-0.3.1.tgz');
  assert.deepEqual(info.files.map(file => file.path), ['LICENSE', 'bin/nisi.mjs']);
});

test('reads the npm 12 object shape keyed by package name', () => {
  const info = readPackInfo(npm12Stdout, 'nisi');
  assert.equal(info.filename, 'nisi-0.3.1.tgz');
  assert.deepEqual(info.files.map(file => file.path), ['LICENSE', 'bin/nisi.mjs']);
});

test('reads a single bare entry object', () => {
  const info = readPackInfo(JSON.stringify(entry), 'nisi');
  assert.equal(info.filename, 'nisi-0.3.1.tgz');
});

test('selects the named package when the npm 12 object has several keys', () => {
  const other = { ...entry, id: 'other@1.0.0', name: 'other', filename: 'other-1.0.0.tgz' };
  const info = readPackInfo(JSON.stringify({ other, nisi: entry }), 'nisi');
  assert.equal(info.filename, 'nisi-0.3.1.tgz');
});

test('refuses output that is not JSON', () => {
  assert.throws(() => readPackInfo('npm notice Tarball Contents\n', 'nisi'),
    /npm pack --json output is not JSON/);
});

test('refuses an empty array and an array with more than one entry', () => {
  assert.throws(() => readPackInfo('[]', 'nisi'), /expected exactly one packed package, got 0/);
  assert.throws(() => readPackInfo(JSON.stringify([entry, entry]), 'nisi'),
    /expected exactly one packed package, got 2/);
});

test('refuses an object without the named package', () => {
  const other = { ...entry, name: 'other', filename: 'other-1.0.0.tgz' };
  assert.throws(() => readPackInfo(JSON.stringify({ other, third: other }), 'nisi'),
    /no entry for package nisi/);
  assert.throws(() => readPackInfo('{}', 'nisi'), /no entry for package nisi/);
});

test('refuses non-object JSON', () => {
  for (const stdout of ['null', '"nisi-0.3.1.tgz"', '3']) {
    assert.throws(() => readPackInfo(stdout, 'nisi'), /unexpected npm pack --json shape/);
  }
});

test('refuses an entry for a different package', () => {
  assert.throws(() => readPackInfo(JSON.stringify([{ ...entry, name: 'other' }]), 'nisi'),
    /entry is for package other, expected nisi/);
});

test('refuses a missing or unsafe filename', () => {
  for (const filename of [undefined, '', 7, '../nisi-0.3.1.tgz', 'dir/nisi-0.3.1.tgz', 'dir\\nisi.tgz']) {
    assert.throws(() => readPackInfo(JSON.stringify([{ ...entry, filename }]), 'nisi'),
      /filename/, String(filename));
  }
});

test('refuses missing or malformed files', () => {
  for (const files of [undefined, {}, [{ size: 1 }], [null], [{ path: '' }]]) {
    assert.throws(() => readPackInfo(JSON.stringify([{ ...entry, files }]), 'nisi'),
      /files/, JSON.stringify(files));
  }
});
