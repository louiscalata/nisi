import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
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

function captureWritable({ delayMs = 0, fail } = {}) {
  let content = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      const finish = () => {
        if (fail) callback(Object.assign(new Error('private stream detail'), { code: fail }));
        else { content += chunk.toString(); callback(); }
      };
      if (delayMs) setTimeout(finish, delayMs);
      else finish();
    },
  });
  return { stream, get content() { return content; } };
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

test('external symlink invokes the physical CLI with --preserve-symlinks-main', t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'nisi-cli-symlink-'));
  const link = path.join(cwd, 'nisi-link.mjs');
  try {
    fs.symlinkSync(cli, link, 'file');
  } catch (error) {
    fs.rmSync(cwd, { recursive: true, force: true });
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
      t.skip(`Windows symlink creation unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  try {
    const result = spawnSync(process.execPath, ['--preserve-symlinks-main', link, '--version'], {
      cwd, encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version);
    assert.equal(result.stderr, '');

    const demo = spawnSync(process.execPath, ['--preserve-symlinks-main', link, 'demo'], {
      cwd, encoding: 'utf8', timeout: 15_000, maxBuffer: 128 * 1024,
    });
    assert.equal(demo.status, 0, demo.stderr);
    const summary = JSON.parse(demo.stdout);
    assert.equal(summary.outcome, 'COMPLETED');
    assert.equal(summary.repairAttempts, 1);
    assert.equal(summary.reportStored, true);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
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
  const out = captureWritable();
  const err = captureWritable();

  assert.equal(await runCli(['local-model', 'x'.repeat(2_049), 'author', 'reviewer'], { stdout: out.stream, stderr: err.stream }), 2);
  assert.match(err.content, /Invalid command or arguments/);
  assert.doesNotMatch(err.content, /x{20}/);

  const failedDemoOut = captureWritable();
  const failedDemoErr = captureWritable();
  assert.equal(await runCli(['demo'], { stdout: failedDemoOut.stream, stderr: failedDemoErr.stream, runExample: async () => { throw new Error('do not expose this detail'); } }), 1);
  assert.equal(failedDemoOut.content, '');
  assert.equal(failedDemoErr.content, 'The deterministic workflow demo failed.\n');

  const oldNodeOut = captureWritable();
  const oldNodeErr = captureWritable();
  assert.equal(await runCli(['--help'], { stdout: oldNodeOut.stream, stderr: oldNodeErr.stream, nodeVersion: '20.19.1' }), 2);
  assert.equal(oldNodeOut.content, '');
  assert.equal(oldNodeErr.content, 'Nisi requires Node.js 22 or newer.\n');
});

test('CLI awaits asynchronous writes and converts EPIPE errors to exit 2 without stack output', async () => {
  const stdout = captureWritable({ delayMs: 20 });
  const stderr = captureWritable();
  const status = await runCli(['--version'], { stdout: stdout.stream, stderr: stderr.stream });
  assert.equal(status, 0);
  assert.equal(stdout.content.trim(), JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version);

  const brokenOut = captureWritable({ fail: 'EPIPE' });
  const cleanErr = captureWritable();
  assert.equal(await runCli(['--version'], { stdout: brokenOut.stream, stderr: cleanErr.stream }), 2);
  assert.equal(cleanErr.content, '');
  assert.doesNotMatch(cleanErr.content, /Error|private stream detail/);

  const cleanOut = captureWritable();
  const brokenErr = captureWritable({ fail: 'EPIPE' });
  assert.equal(await runCli(['unknown-command'], { stdout: cleanOut.stream, stderr: brokenErr.stream }), 2);
  assert.equal(cleanOut.content, '');
});

test('local-model wrapper prints only a fixed report summary for injected success and failure', async () => {
  const endpoint = 'http://127.0.0.1:1/v1/chat/completions';
  const inputMarker = 'private-prompt-marker';
  let calls = 0;
  const localModel = {
    parseLocalModelCLI(args) {
      assert.deepEqual(args, [endpoint, 'author-local', 'reviewer-local']);
      return { endpoint, authorModel: 'author-local', reviewerModel: 'reviewer-local' };
    },
    async runLocalModelExample() {
      calls += 1;
      return {
        report: { outcome: 'COMPLETED', repairAttempts: 1, code: null, prompt: inputMarker },
        authorReceipts: [{ prompt: inputMarker, candidate: 'must not print' }],
        reviewerReceipts: [{ source: 'must not print' }],
      };
    },
  };
  const out = captureWritable();
  const err = captureWritable();
  assert.equal(await runCli(['local-model', endpoint, 'author-local', 'reviewer-local'], {
    stdout: out.stream, stderr: err.stream, localModel,
  }), 0);
  assert.equal(calls, 1);
  const summary = JSON.parse(out.content);
  assert.deepEqual(summary, { outcome: 'COMPLETED', code: null, repairAttempts: 1, authorCalls: 1, reviewerCalls: 1 });
  assert.doesNotMatch(out.content, /private-prompt-marker|candidate|source|receipts|127\.0\.0\.1/);
  assert.equal(err.content, '');

  const failedOut = captureWritable();
  const failedErr = captureWritable();
  const incompleteModel = {
    parseLocalModelCLI: localModel.parseLocalModelCLI,
    async runLocalModelExample() {
      return { report: { outcome: 'INCOMPLETE', code: 'AUTHOR_UNAVAILABLE', repairAttempts: 0 }, authorReceipts: [], reviewerReceipts: [] };
    },
  };
  assert.equal(await runCli(['local-model', endpoint, 'author-local', 'reviewer-local'], {
    stdout: failedOut.stream, stderr: failedErr.stream, localModel: incompleteModel,
  }), 1);
  assert.deepEqual(JSON.parse(failedOut.content), {
    outcome: 'INCOMPLETE', code: 'AUTHOR_UNAVAILABLE', repairAttempts: 0, authorCalls: 0, reviewerCalls: 0,
  });
  assert.equal(failedErr.content, '');

  const thrownOut = captureWritable();
  const thrownErr = captureWritable();
  assert.equal(await runCli(['local-model', endpoint, 'author-local', 'reviewer-local'], {
    stdout: thrownOut.stream,
    stderr: thrownErr.stream,
    localModel: {
      parseLocalModelCLI: localModel.parseLocalModelCLI,
      async runLocalModelExample() { throw new Error(inputMarker); },
    },
  }), 1);
  assert.equal(thrownOut.content, '');
  assert.equal(thrownErr.content, 'The local-model workflow failed. Check the local endpoint and model configuration.\n');
  assert.doesNotMatch(thrownErr.content, /private-prompt-marker|127\.0\.0\.1/);
});
