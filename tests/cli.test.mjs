import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from '../bin/nisi.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin/nisi.mjs');

function invoke(args, cwd = root) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 128 * 1024,
  });
}

test('help and version are side-effect free and print the package version', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'nisi-cli-help-'));
  try {
    assert.deepEqual(fs.readdirSync(cwd), []);
    const help = invoke(['--help'], cwd);
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /Usage:[\s\S]*nisi demo[\s\S]*nisi local-model/);
    assert.equal(help.stderr, '');
    assert.deepEqual(fs.readdirSync(cwd), []);

    const version = invoke(['--version'], cwd);
    assert.equal(version.status, 0, version.stderr);
    assert.equal(version.stdout.trim(), JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version);
    assert.equal(version.stderr, '');
    assert.deepEqual(fs.readdirSync(cwd), []);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('demo runs the public deterministic workflow and reports no model calls', () => {
  const result = invoke(['demo']);
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.outcome, 'COMPLETED');
  assert.equal(summary.reportStored, true);
  assert.equal(summary.modelCalls, 0);
  assert.equal(result.stderr, '');
});

test('invalid local-model arguments and unknown commands use exit 2 without echoing inputs', () => {
  const sentinel = 'sensitive-endpoint.example.invalid';
  const malformed = invoke(['local-model', `http://${sentinel}/?token=never-echo`, 'same', 'same']);
  assert.equal(malformed.status, 2);
  assert.match(malformed.stderr, /Invalid command or arguments/);
  assert.doesNotMatch(`${malformed.stdout}\n${malformed.stderr}`, /sensitive-endpoint|never-echo|same/);
  assert.equal(malformed.stdout, '');

  const unknown = invoke(['definitely-not-a-command', sentinel]);
  assert.equal(unknown.status, 2);
  assert.doesNotMatch(`${unknown.stdout}\n${unknown.stderr}`, /definitely-not-a-command|sensitive-endpoint/);
});

test('argument and workflow failures have bounded exit codes and generic diagnostics', async () => {
  let out = '';
  let err = '';
  const stdout = { write: text => { out += text; } };
  const stderr = { write: text => { err += text; } };

  assert.equal(await runCli(['local-model', 'x'.repeat(2_049), 'author', 'reviewer'], { stdout, stderr }), 2);
  assert.match(err, /Invalid command or arguments/);
  assert.doesNotMatch(err, /x{20}/);

  out = '';
  err = '';
  assert.equal(await runCli(['demo'], { stdout, stderr, runExample: async () => { throw new Error('do not expose this detail'); } }), 1);
  assert.equal(out, '');
  assert.equal(err, 'The deterministic workflow demo failed.\n');

  out = '';
  err = '';
  assert.equal(await runCli(['--help'], { stdout, stderr, nodeVersion: '20.19.1' }), 2);
  assert.equal(out, '');
  assert.equal(err, 'Nisi requires Node.js 22 or newer.\n');
});
