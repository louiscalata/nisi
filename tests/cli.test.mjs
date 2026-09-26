import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { runCli } from '../bin/nisi.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin/nisi.mjs');
const USAGE_LINE = 'Invalid command or arguments. Run "nisi --help" for usage.';

function invoke(args, cwd = root, { env, entry = cli, timeout = 15_000 } = {}) {
  return spawnSync(process.execPath, [entry, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    timeout,
    maxBuffer: 128 * 1024,
  });
}

// os.tmpdir() reads TMPDIR on POSIX and TEMP/TMP on Windows.
function tempEnv(directory) {
  const env = { ...process.env, TMPDIR: directory, TMP: directory, TEMP: directory };
  delete env.NODE_USE_ENV_PROXY;
  return env;
}

async function closedLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
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

test('demo runs the public deterministic workflow, reports no model calls and removes its temporary report', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nisi-cli-demo-'));
  try {
    const result = invoke(['demo'], root, { env: tempEnv(temp) });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { outcome: 'COMPLETED', code: null, repairAttempts: 1, reportStored: true, modelCalls: 0 });
    assert.equal(result.stderr, '');
    assert.deepEqual(fs.readdirSync(temp), []);

    const missing = invoke(['demo'], root, { env: tempEnv(path.join(temp, 'missing')) });
    assert.equal(missing.status, 1);
    assert.equal(missing.stdout, '');
    assert.equal(missing.stderr, 'The deterministic workflow demo failed (ENOENT).\n');
    assert.deepEqual(fs.readdirSync(temp), []);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('demo removes only its own nisi-workflow- directory and reports a failed removal by code', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nisi-cli-demo-clean-'));
  const report = { outcome: 'COMPLETED', code: null, repairAttempts: 1, reportStored: true };
  const demo = async directory => {
    const out = captureWritable();
    const err = captureWritable();
    const status = await runCli(['demo'], { stdout: out.stream, stderr: err.stream, runExample: async () => ({ report, directory }) });
    return { status, out: out.content, err: err.content };
  };
  try {
    const own = path.join(temp, 'nisi-workflow-own');
    fs.mkdirSync(own);
    fs.writeFileSync(path.join(own, 'report.json'), '{}');
    const removed = await demo(own);
    assert.equal(removed.status, 0);
    assert.equal(removed.err, '');
    assert.equal(fs.existsSync(own), false);

    const foreign = path.join(temp, 'caller-directory');
    fs.mkdirSync(foreign);
    const kept = await demo(foreign);
    assert.equal(kept.status, 0);
    assert.equal(kept.err, '');
    assert.equal(fs.existsSync(foreign), true);

    // A NUL byte makes removal fail identically on every platform.
    const failed = await demo(path.join(temp, 'nisi-workflow-\0private-detail'));
    assert.equal(failed.status, 0);
    assert.equal(JSON.parse(failed.out).outcome, 'COMPLETED');
    assert.equal(failed.err, 'The deterministic workflow demo could not remove its nisi-workflow-* temporary directory (ERR_INVALID_ARG_VALUE).\n');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
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
      cwd, env: tempEnv(cwd), encoding: 'utf8', timeout: 15_000, maxBuffer: 128 * 1024,
    });
    assert.equal(demo.status, 0, demo.stderr);
    const summary = JSON.parse(demo.stdout);
    assert.equal(summary.outcome, 'COMPLETED');
    assert.equal(summary.repairAttempts, 1);
    assert.equal(summary.reportStored, true);
    assert.deepEqual(fs.readdirSync(cwd), ['nisi-link.mjs']);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('invalid local-model arguments and unknown commands use exit 2 without echoing inputs', () => {
  const sentinel = 'sensitive-endpoint.example.invalid';
  const malformed = invoke(['local-model', `http://${sentinel}/?token=never-echo`, 'same', 'same']);
  assert.equal(malformed.status, 2);
  assert.match(malformed.stderr, /Invalid command or arguments/);
  assert.match(malformed.stderr, /\(LOCAL_MODEL_NAMES_EQUAL\)/);
  assert.doesNotMatch(`${malformed.stdout}\n${malformed.stderr}`, /sensitive-endpoint|never-echo|same/);
  assert.equal(malformed.stdout, '');

  const refusedHost = invoke(['local-model', `http://${sentinel}:1234/v1/chat/completions`, 'author-name', 'reviewer-name']);
  assert.equal(refusedHost.status, 2);
  assert.match(refusedHost.stderr, /^local-model refused ENDPOINT \(LOCAL_CHAT_DESTINATION_REFUSED\): /m);
  assert.doesNotMatch(`${refusedHost.stdout}\n${refusedHost.stderr}`, /sensitive-endpoint|author-name|reviewer-name/);

  const unknown = invoke(['definitely-not-a-command', sentinel]);
  assert.equal(unknown.status, 2);
  assert.doesNotMatch(`${unknown.stdout}\n${unknown.stderr}`, /definitely-not-a-command|sensitive-endpoint/);
});

test('local-model refusals name the argument, its rule and a fixed code, and help states the rules', async () => {
  const refusal = async args => {
    const out = captureWritable();
    const err = captureWritable();
    const status = await runCli(['local-model', ...args], { stdout: out.stream, stderr: err.stream });
    assert.equal(status, 2);
    assert.equal(out.content, '');
    const [usage, detail, ...rest] = err.content.split('\n');
    assert.equal(usage, USAGE_LINE);
    assert.deepEqual(rest, ['']);
    return detail;
  };
  const endpoint = 'http://127.0.0.1:1234/v1/chat/completions';
  const endpointRule = 'use a full http:// chat-completions URL at 127.0.0.1 or [::1]; hostnames such as localhost, HTTPS, credentials, query and fragment are refused.';
  const nameRule = 'use a non-blank configured model name of at most 128 characters.';
  assert.equal(await refusal(['http://localhost:1234/v1/chat/completions', 'author', 'reviewer']),
    `local-model refused ENDPOINT (LOCAL_CHAT_DESTINATION_REFUSED): ${endpointRule}`);
  for (const refused of ['https://127.0.0.1:1234/v1/chat/completions', 'http://user:secret@127.0.0.1/v1', 'http://127.0.0.1/v1?key=1', 'http://127.0.0.1/v1#part', 'http://10.0.0.2/v1']) {
    assert.equal(await refusal([refused, 'author', 'reviewer']), `local-model refused ENDPOINT (LOCAL_CHAT_DESTINATION_REFUSED): ${endpointRule}`);
  }
  for (const invalid of ['not a url', '   ']) {
    assert.equal(await refusal([invalid, 'author', 'reviewer']), `local-model refused ENDPOINT (LOCAL_CHAT_ENDPOINT_INVALID): ${endpointRule}`);
  }
  assert.equal(await refusal(['x'.repeat(2_049), 'author', 'reviewer']), 'local-model refused ENDPOINT (LOCAL_MODEL_ARGUMENT_TOO_LONG): use at most 2048 characters.');
  assert.equal(await refusal([endpoint, 'a'.repeat(129), 'reviewer']), `local-model refused AUTHOR_MODEL (LOCAL_MODEL_ARGUMENT_TOO_LONG): ${nameRule}`);
  assert.equal(await refusal([endpoint, 'author', ' \t ']), `local-model refused REVIEWER_MODEL (LOCAL_MODEL_NAME_BLANK): ${nameRule}`);
  assert.equal(await refusal([endpoint, ' twin ', 'twin']),
    'local-model refused AUTHOR_MODEL and REVIEWER_MODEL (LOCAL_MODEL_NAMES_EQUAL): use two different configured model names.');
  for (const count of [[], [endpoint], [endpoint, 'author'], [endpoint, 'author', 'reviewer', 'extra']]) {
    assert.equal(await refusal(count), 'local-model refused its arguments (LOCAL_MODEL_ARGUMENT_COUNT): give exactly ENDPOINT, AUTHOR_MODEL and REVIEWER_MODEL.');
  }
  // The pre-parse checks mirror the example's parser; anything it still refuses gets a generic fixed code.
  const out = captureWritable();
  const err = captureWritable();
  assert.equal(await runCli(['local-model', endpoint, 'author', 'reviewer'], { stdout: out.stream, stderr: err.stream, localModel: {
    parseLocalModelCLI() { throw new Error('private parser detail'); },
    async runLocalModelExample() { throw new Error('must not run'); },
  } }), 2);
  assert.equal(err.content, `${USAGE_LINE}\nlocal-model refused its arguments (LOCAL_MODEL_ARGUMENTS_INVALID): see the argument rules in "nisi --help".\n`);

  const help = invoke(['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /ENDPOINT {8}Full chat-completions URL over http:\/\/ at 127\.0\.0\.1 or \[::1\]/);
  assert.match(help.stdout, /at most\s+2048 characters\. Hostnames such as localhost, HTTPS,\s+credentials, query and fragment are refused\./);
  assert.match(help.stdout, /each non-blank and at most 128\s+REVIEWER_MODEL {2}characters\. The two names must differ\./);
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

  for (const [code, expected] of [
    ['ENOENT', 'The deterministic workflow demo failed (ENOENT).\n'],
    ['EROFS', 'The deterministic workflow demo failed (EROFS).\n'],
    ['/private/tmp/secret-path', 'The deterministic workflow demo failed.\n'],
    ['enoent', 'The deterministic workflow demo failed.\n'],
  ]) {
    const codedOut = captureWritable();
    const codedErr = captureWritable();
    assert.equal(await runCli(['demo'], { stdout: codedOut.stream, stderr: codedErr.stream,
      runExample: async () => { throw Object.assign(new Error('/private/tmp/secret-path'), { code }); } }), 1);
    assert.equal(codedOut.content, '');
    assert.equal(codedErr.content, expected);
  }

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
  assert.deepEqual(summary, { outcome: 'COMPLETED', code: null, repairAttempts: 1, authorCalls: 1, reviewerCalls: 1, authorCode: null, reviewerCode: null });
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
    outcome: 'INCOMPLETE', code: 'AUTHOR_UNAVAILABLE', repairAttempts: 0, authorCalls: 0, reviewerCalls: 0, authorCode: null, reviewerCode: null,
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

test('local-model summary carries each role\'s last fixed receipt code and never a free-form one', async () => {
  const endpoint = 'http://127.0.0.1:1/v1/chat/completions';
  const summarize = async (authorReceipts, reviewerReceipts) => {
    const out = captureWritable();
    const err = captureWritable();
    const status = await runCli(['local-model', endpoint, 'author-local', 'reviewer-local'], { stdout: out.stream, stderr: err.stream, localModel: {
      parseLocalModelCLI: () => ({ endpoint, authorModel: 'author-local', reviewerModel: 'reviewer-local' }),
      async runLocalModelExample() {
        return { report: { outcome: 'BLOCKED', code: 'ADAPTER_EXCEPTION', repairAttempts: 0 }, authorReceipts, reviewerReceipts };
      },
    } });
    assert.equal(status, 1);
    assert.equal(err.content, '');
    return out.content;
  };
  const mismatch = JSON.parse(await summarize([{ status: 'UNAVAILABLE', code: 'LOCAL_CHAT_MODEL_MISMATCH' }], []));
  assert.deepEqual(mismatch, { outcome: 'BLOCKED', code: 'ADAPTER_EXCEPTION', repairAttempts: 0, authorCalls: 1, reviewerCalls: 0,
    authorCode: 'LOCAL_CHAT_MODEL_MISMATCH', reviewerCode: null });
  const reviewer = JSON.parse(await summarize([{ status: 'RESPONSE_VALIDATED' }], [{ status: 'UNAVAILABLE', code: 'LOCAL_CHAT_TIMEOUT' }]));
  assert.equal(reviewer.authorCode, null);
  assert.equal(reviewer.reviewerCode, 'LOCAL_CHAT_TIMEOUT');
  const earlier = JSON.parse(await summarize([{ code: 'LOCAL_CHAT_UNAVAILABLE' }, { status: 'RESPONSE_VALIDATED' }], null));
  assert.equal(earlier.authorCode, null);
  assert.equal(earlier.reviewerCalls, 0);
  const leaked = await summarize([{ code: 'lower-case http://127.0.0.1 leak' }], [{ code: 42 }]);
  assert.equal(JSON.parse(leaked).authorCode, null);
  assert.equal(JSON.parse(leaked).reviewerCode, null);
  assert.doesNotMatch(leaked, /127\.0\.0\.1|leak/);
});

test('a local-model workflow that cannot load exits 1 instead of reporting a usage error', async () => {
  const out = captureWritable();
  const err = captureWritable();
  assert.equal(await runCli(['local-model', 'http://127.0.0.1:1/v1/chat/completions', 'author', 'reviewer'], {
    stdout: out.stream, stderr: err.stream, localModel: { runLocalModelExample() { throw new Error('must not run'); } },
  }), 1);
  assert.equal(out.content, '');
  assert.equal(err.content, 'The local-model workflow could not be loaded (LOCAL_MODEL_EXPORTS_MISSING). Reinstall Nisi.\n');

  // A bin installed without its example module, as a broken package would be.
  const partial = fs.mkdtempSync(path.join(os.tmpdir(), 'nisi-cli-partial-'));
  try {
    fs.mkdirSync(path.join(partial, 'bin'));
    fs.copyFileSync(cli, path.join(partial, 'bin', 'nisi.mjs'));
    fs.copyFileSync(path.join(root, 'package.json'), path.join(partial, 'package.json'));
    const entry = path.join(partial, 'bin', 'nisi.mjs');
    const broken = invoke(['local-model', 'http://127.0.0.1:1/v1/chat/completions', 'author', 'reviewer'], partial, { entry });
    assert.equal(broken.status, 1, broken.stderr);
    assert.equal(broken.stdout, '');
    assert.equal(broken.stderr, 'The local-model workflow could not be loaded (ERR_MODULE_NOT_FOUND). Reinstall Nisi.\n');
    const malformed = invoke(['local-model', 'http://127.0.0.1:1/v1/chat/completions', 'twin', 'twin'], partial, { entry });
    assert.equal(malformed.status, 2);
    assert.match(malformed.stderr, /\(LOCAL_MODEL_NAMES_EQUAL\)/);
  } finally {
    fs.rmSync(partial, { recursive: true, force: true });
  }
});

test('local-model against a closed loopback port blocks on the author call and names the adapter code', async () => {
  const port = await closedLoopbackPort();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nisi-cli-closed-'));
  try {
    const result = invoke(['local-model', `http://127.0.0.1:${port}/v1/chat/completions`, 'author-model', 'reviewer-model'], root,
      { env: tempEnv(temp), timeout: 60_000 });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), { outcome: 'BLOCKED', code: 'ADAPTER_EXCEPTION', repairAttempts: 0,
      authorCalls: 1, reviewerCalls: 0, authorCode: 'LOCAL_CHAT_UNAVAILABLE', reviewerCode: null });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
