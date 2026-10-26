// Trusted portable test guard. Block all effects used by the CLI and its owners
// before import or preflight; permit only the five pinned fixture source reads.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import childProcess from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const fixtureDirectory = fs.realpathSync(fileURLToPath(new URL('../../examples/repository-task/', import.meta.url)));
const fixtureFiles = Object.freeze([
  'fixtures/live-baseline/retry-settings.mjs',
  'fixtures/live-repair/retry-settings.mjs',
  'fixtures/baseline/config.json',
  'fixtures/baseline/README.md',
  'fixtures/harness/check-retry-settings.mjs',
].map(relative => path.join(fixtureDirectory, relative)));

export async function withPreflightGuards(run, { allowFixtureReads = false } = {}) {
  const restores = [], forbidden = [], reads = [];
  const originalExitCode = process.exitCode;
  const originalListeners = ['SIGINT', 'SIGTERM'].map(signal => [signal, process.listeners(signal)]);
  const originalReadFile = fsp.readFile;
  function replace(object, key, replacement) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor || !('value' in descriptor)) throw new Error(`Test guard cannot patch ${key}`);
    restores.push(() => Object.defineProperty(object, key, descriptor));
    Object.defineProperty(object, key, { ...descriptor, value: replacement });
  }
  function deny(label) {
    return () => {
      forbidden.push(label);
      throw Object.assign(new Error(`Forbidden CLI preflight effect: ${label}`), { code: 'TEST_FORBIDDEN_SIDE_EFFECT' });
    };
  }
  try {
    replace(globalThis, 'fetch', deny('fetch'));
    replace(process, 'exit', deny('process.exit'));
    for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) replace(childProcess, key, deny(`child_process.${key}`));
    for (const key of ['mkdir', 'mkdtemp', 'writeFile', 'appendFile', 'rm', 'unlink', 'rename', 'copyFile', 'cp', 'chmod', 'symlink', 'link']) replace(fsp, key, deny(`fs.promises.${key}`));
    for (const key of ['mkdir', 'mkdtemp', 'writeFile', 'appendFile', 'rm', 'unlink', 'rename', 'copyFile', 'cp', 'chmod', 'symlink', 'link']) {
      replace(fs, key, deny(`fs.${key}`));
      replace(fs, `${key}Sync`, deny(`fs.${key}Sync`));
    }
    // Node's module loader uses openSync to read imported source. Read-only opens
    // are harmless; every potentially writing open remains blocked before I/O.
    for (const [label, object, key] of [['fs.promises.open', fsp, 'open'], ['fs.open', fs, 'open'], ['fs.openSync', fs, 'openSync']]) {
      const original = object[key];
      replace(object, key, function guardedOpen(target, flags, ...rest) {
        if (flags !== 'r' && flags !== 'rs' && flags !== fs.constants.O_RDONLY) return deny(label)(target);
        return original.call(this, target, flags, ...rest);
      });
    }
    replace(fs, 'createWriteStream', deny('fs.createWriteStream'));
    for (const [label, object, keys] of [
      ['http', http, ['request', 'get']], ['https', https, ['request', 'get']],
      ['net', net, ['connect', 'createConnection']], ['tls', tls, ['connect']],
    ]) for (const key of keys) replace(object, key, deny(`${label}.${key}`));
    replace(fsp, 'readFile', function guardedReadFile(target, ...rest) {
      const absolute = target instanceof URL ? fileURLToPath(target) : typeof target === 'string' ? path.resolve(target) : null;
      reads.push(absolute);
      if (!allowFixtureReads || !fixtureFiles.includes(absolute)) return deny('fs.promises.readFile outside pinned fixture')(target);
      return originalReadFile.call(this, target, ...rest);
    });
    syncBuiltinESMExports();
    return await run({ reads, forbidden, fixtureFiles });
  } finally {
    for (const restore of restores.reverse()) restore();
    syncBuiltinESMExports();
    assert.deepEqual(forbidden, [], 'Preflight must not attempt filesystem mutation, process exit, child execution, or network');
    assert.equal(process.exitCode, originalExitCode, 'Imported CLI calls must not alter process.exitCode');
    for (const [signal, listeners] of originalListeners) assert.deepEqual(process.listeners(signal), listeners, `Preflight must preserve ${signal} listeners`);
  }
}
