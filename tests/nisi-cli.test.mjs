import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { parseNisiArguments } from '../cli/arguments.mjs';
import { runNisiCli } from '../cli/main.mjs';
import { CLI_VERSION, safeNisiCode } from '../cli/text.mjs';
import { collectNisiDoctor, DOCTOR_ASSETS } from '../cli/doctor.mjs';
import { withPreflightGuards } from './helpers/live-cli-side-effect-guard.mjs';

test('parser snapshots explicit commands and forwards demo arguments without normalization', () => {
  for (const command of ['help', '--help', '-h']) assert.equal(parseNisiArguments([command]).command, 'help');
  for (const command of ['version', '--version', '-v']) assert.equal(parseNisiArguments([command]).command, 'version');
  assert.equal(parseNisiArguments([]).command, 'help'); assert.equal(parseNisiArguments(['doctor']).command, 'doctor');
  const selection = ['inspect', '/private/run']; const inspected = parseNisiArguments(selection);
  selection[1] = '/changed'; assert.deepEqual(inspected, {command: 'inspect', args: ['/private/run']});
  assert(Object.isFrozen(inspected.args)); assert(Object.isFrozen(inspected));
  const input = ['demo', '--', '--endpoint', '', '--endpoint', 'http://127.0.0.1:1234'];
  const result = parseNisiArguments(input); assert.deepEqual(result.args, input.slice(1));
  input[1] = 'changed'; assert.equal(result.args[0], '--'); assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.args));
});
test('parser rejects malformed, oversized, accessor and unknown input without echoing it', () => {
  const arrays = [null, {}, 'help', ['--secret-private-value'], ['help', 'demo'], ['version', 'x'], ['doctor', 'x'],
    ['inspect'], ['inspect',''], ['inspect','/a','/b'], ['inspect','/a\0b'], ['inspect','/'+ 'a'.repeat(4096)],
    [1], new Array(1), Array(129).fill('x'), ['demo', 'x'.repeat(8193)], ['demo', ...Array(9).fill('x'.repeat(8192))]];
  let invoked = false; const getter = []; Object.defineProperty(getter, 0, { enumerable: true, get() { invoked = true; } });
  arrays.push(getter, Object.assign(['help'], { extra: true }));
  for (const args of arrays) assert.throws(() => parseNisiArguments(args), { code: 'NISI_CLI_ARGUMENTS', message: 'NISI_CLI_ARGUMENTS' });
  assert.equal(invoked, false);
});
test('help/version/usage and legacy demo help/refusal preserve the no-effect preflight', async () => {
  await withPreflightGuards(async () => {
    for (const args of [[], ['help'], ['version'], ['unknown'], ['demo', '--help'], ['demo'], ['demo', '--invalid']]) {
      const result = await runNisiCli(args);
      assert.equal(result.exitCode, args[0] === 'unknown' || (args[0] === 'demo' && args[1] !== '--help') ? 2 : 0);
      assert.equal(result.exitCode === 0 ? result.stderr : result.stdout, '');
    }
  });
  const metadata = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(CLI_VERSION, metadata.version); assert.equal(metadata.bin, undefined);
  assert.equal(metadata.files.some(file => file.startsWith('bin/') || file.startsWith('cli/')), false);
});
test('error sanitizer cannot print untrusted messages, getter content or long codes', () => {
  const getter = Object.defineProperty({}, 'code', { get() { throw Error('PRIVATE'); } });
  for (const value of [getter, { code: 'private value' }, { code: 'X'.repeat(97) }, { code: 1 }, Error('PRIVATE')])
    assert.equal(safeNisiCode(value), 'NISI_CLI_ERROR');
  assert.equal(safeNisiCode({ code: 'LIVE_DEMO_ARGUMENTS' }), 'LIVE_DEMO_ARGUMENTS');
});

const metadata = {name: 'nisi', version: CLI_VERSION, private: true, license: 'UNLICENSED', engines: {node: '>=22'}};
const regular = {isFile: () => true, isSymbolicLink: () => false, size: 1024};
const options = overrides => ({nodeVersion: 'v22.0.0', platform: 'test-platform', arch: 'test-arch',
  lstat: async () => regular, readFile: async () => JSON.stringify(metadata), ...overrides});
test('doctor distinguishes inventory from runtime, compatibility, authenticity and execution readiness', async () => {
  const value = await collectNisiDoctor(options());
  assert.equal(value.exitCode, 0); assert.equal(value.status, 'INVENTORY_COMPLETE');
  assert.equal(value.sourceTrust, 'NOT_ASSESSED'); assert.equal(value.nativeCompatibility, 'NOT_ASSESSED');
  assert.equal(value.readyForExecution, false); assert.equal(value.authorizing, false);
  for (const key of ['moduleResolution', 'compiler', 'nativeExecution', 'modelInference', 'network']) assert.equal(value[key], 'NOT_RUN');
  assert.equal(value.assets.length, DOCTOR_ASSETS.length);
  assert.equal(JSON.stringify(value).includes('/Users/'), false);
});
test('doctor fails closed for missing/symlink assets, invalid metadata and unsupported Node', async () => {
  for (const overrides of [
    { nodeVersion: 'v21.9.0' }, { nodeVersion: 'invalid' },
    { readFile: async () => '{invalid' }, { readFile: async () => JSON.stringify({...metadata, engines: {node: '*'}}) },
    { lstat: async () => ({...regular, isSymbolicLink: () => true}) },
    { lstat: async () => { throw Error('/private/SECRET'); } },
    { lstat: async url => url.pathname.endsWith('main.swift') ? ({...regular, isFile: () => false}) : regular },
  ]) {
    const report = await collectNisiDoctor(options(overrides));
    assert.equal(report.exitCode, 1); assert.equal(report.status, 'INCOMPLETE');
    assert.equal(JSON.stringify(report).includes('SECRET'), false);
  }
});
