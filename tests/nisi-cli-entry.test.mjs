import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CLI_HELP, CLI_VERSION } from '../cli/text.mjs';
import { createHash } from 'node:crypto';
import { storedSummaryFixture } from './helpers/stored-summary-fixture.mjs';
const entry = fileURLToPath(new URL('../bin/nisi.mjs', import.meta.url));
const guard = fileURLToPath(new URL('./helpers/nisi-cli-no-effects.mjs', import.meta.url));
const doublePreload = fileURLToPath(new URL('./helpers/nisi-cli-double-preload.mjs', import.meta.url));
async function environment(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nisi-cli-entry-'));
  // These roots contain only test-owned empty HOME/cwd and a known symlink.
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  await fs.mkdir(path.join(root, 'home')); await fs.mkdir(path.join(root, 'cwd'), {mode: 0o500});
  return { root, cwd: path.join(root, 'cwd'), env: {PATH: path.dirname(process.execPath) + ':/usr/bin:/bin',
    HOME: path.join(root, 'home'), LANG: 'C', LC_ALL: 'C'} };
}
function invoke(e, args, target = entry, flags = []) {
  const value = spawnSync(process.execPath, ['--import', guard, ...flags, target, ...args],
    {cwd: e.cwd, env: e.env, encoding: 'utf8', timeout: 10000, maxBuffer: 131072});
  assert.equal(value.error, undefined); assert.equal(value.signal, null); return value;
}
test('actual help/version/doctor/usage processes are offline, read-only and cwd independent', async t => {
  const e = await environment(t);
  for (const args of [[], ['help'], ['--help'], ['version'], ['--version'], ['doctor'], ['bogus'], ['doctor', 'extra'], ['--help', 'demo']]) {
    const result = invoke(e, args), invalid = ['bogus'].includes(args[0]) || args.length > 1;
    assert.equal(result.status, invalid ? 2 : 0);
    if (invalid) { assert.equal(result.stdout, ''); assert.equal(JSON.parse(result.stderr).code, 'NISI_CLI_ARGUMENTS'); }
    else {
      assert.equal(result.stderr, '');
      if (['version', '--version'].includes(args[0])) assert.equal(result.stdout, CLI_VERSION + '\n');
      else if (args[0] === 'doctor') {
        const report = JSON.parse(result.stdout); assert.equal(report.exitCode, 0);
        assert.equal(report.readyForExecution, false); assert.equal(report.modelInference, 'NOT_RUN');
        assert.equal(result.stdout.includes(e.root), false);
      } else assert.equal(result.stdout, CLI_HELP);
    }
  }
  assert.deepEqual(await fs.readdir(e.cwd), []); assert.deepEqual(await fs.readdir(path.join(e.root, 'home')), []);
});
test('ordinary executable symlink works and import does not execute the binary', async t => {
  const e = await environment(t), linked = path.join(e.root, 'nisi');
  await fs.symlink(entry, linked);
  assert.equal(invoke(e, ['--version'], linked).stdout, CLI_VERSION + '\n');
  const preserved = invoke(e, ['--version'], linked, ['--preserve-symlinks-main', '--preserve-symlinks']);
  assert.equal(preserved.status, 0); assert.equal(preserved.stderr, ''); assert.equal(preserved.stdout, CLI_VERSION + '\n');
  assert.ok((await fs.stat(entry)).mode & 0o100);
  assert.equal((await fs.readFile(entry, 'utf8')).split('\n')[0], '#!/usr/bin/env node');
  const source = `const snapshot = () => JSON.stringify([process.exitCode, process.listenerCount('SIGINT'), process.listenerCount('SIGTERM'), process.stdout.listenerCount('error'), process.stderr.listenerCount('error')]); const before = snapshot(); await import(${JSON.stringify(new URL('../bin/nisi.mjs', import.meta.url).href)}); if(snapshot() !== before) throw Error('not inert');`;
  const result = spawnSync(process.execPath, ['--import', guard, '--input-type=module', '-e', source],
    {cwd: e.cwd, env: e.env, encoding: 'utf8', timeout: 10000});
  assert.equal(result.status, 0); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
});
test('actual inspect is read-only, lazy and non-authorizing even for reported success', async t => {
  const e = await environment(t), selected = path.join(e.root, 'run');
  await fs.mkdir(selected,{mode:0o700});
  const summary = path.join(selected,'summary.json');
  for (const status of ['INCOMPLETE','SCOPED_LIVE_REPAIR_REVIEW_PASS']) {
    const bytes = Buffer.from(JSON.stringify({...storedSummaryFixture(),status},null,2)+'\n');
    await fs.writeFile(summary,bytes,{mode:0o600});
    const result = invoke(e,['inspect',selected]);
    assert.equal(result.status,0); assert.equal(result.stderr,'');
    const out = JSON.parse(result.stdout);
    assert.equal(out.summarySha256,createHash('sha256').update(bytes).digest('hex'));
    assert.equal(out.reportedStatus,status); assert.equal(out.accepted,false);
    assert.equal(out.sourceTrust,'UNVERIFIED'); assert.equal(out.currentRunState,'UNKNOWN');
    assert.equal(out.bundleValidation,'NOT_RUN'); assert.equal(out.lateSettlement,'NOT_ASSESSED');
    assert.equal(out.remoteInferenceStopped,'NOT_OBSERVED');
    assert.doesNotMatch(result.stdout,/PRIVATE_|not-read\.json/);
    assert.deepEqual(await fs.readdir(selected),['summary.json']);
    assert.deepEqual(await fs.readFile(summary),bytes);
  }
  await fs.writeFile(summary,'PRIVATE_INVALID_JSON');
  const bad = invoke(e,['inspect',selected]);
  assert.equal(bad.status,2); assert.equal(bad.stdout,'');
  assert.equal(JSON.parse(bad.stderr).code,'NISI_INSPECT_SUMMARY_INVALID');
  for (const args of [['inspect'],['inspect',selected,'extra'],['inspect','relative']]) {
    const out = invoke(e,args); assert.equal(out.status,2); assert.equal(out.stdout,'');
    assert.doesNotMatch(out.stderr,/PRIVATE_|relative/);
  }
  assert.deepEqual(await fs.readdir(e.cwd),[]); assert.deepEqual(await fs.readdir(path.join(e.root,'home')),[]);
});
test('demo wrapper preserves exact arguments and scoped exit codes using an inert double', async t => {
  const base = await environment(t), args = ['demo', '--', '--endpoint', '', '--endpoint', 'private-value'];
  for (const mode of ['0', '1', '2', 'throw', 'invalid-result']) {
    const e = {...base, env: {...base.env, NISI_CLI_TEST_ALLOW_DEMO: '1', NISI_CLI_TEST_MODE: mode}};
    const result = invoke(e, args, entry, ['--import', doublePreload]);
    if (['0', '1', '2'].includes(mode)) {
      assert.equal(result.status, Number(mode)); assert.equal(result.stderr, '');
      assert.deepEqual(JSON.parse(result.stdout), {exitCode: Number(mode), receivedArgs: args.slice(1), execution: 'TEST_DOUBLE_ONLY'});
    } else {
      assert.equal(result.status, 2); assert.equal(result.stdout, '');
      assert.equal(JSON.parse(result.stderr).code, mode === 'throw' ? 'NISI_CLI_ERROR' : 'NISI_CLI_RESULT');
      assert.equal(result.stderr.includes('SECRET'), false);
    }
  }
});
test('actual demo help is JSON and invalid demo requests remain read-only refusals', async t => {
  const base = await environment(t), e = {...base, env: {...base.env, NISI_CLI_TEST_ALLOW_DEMO: '1'}};
  const help = invoke(e, ['demo', '--help']);
  assert.equal(help.status, 0); assert.equal(help.stderr, '');
  const payload = JSON.parse(help.stdout);
  assert.equal(payload.exitCode, 0); assert.match(payload.help, /PRIVATE ONLY/u);
  assert.match(payload.help, /--approved-reviewed-fixture/u);
  for (const args of [['demo'], ['demo', '--unknown'], ['demo', '--help', 'extra']]) {
    const result = invoke(e, args);
    assert.equal(result.status, 2); assert.equal(result.stdout, '');
    assert.equal(JSON.parse(result.stderr).status, 'INCOMPLETE');
  }
  assert.deepEqual(await fs.readdir(e.cwd), []); assert.deepEqual(await fs.readdir(path.join(e.root, 'home')), []);
});
test('future dispatch and startup import failures fail closed without secret stacks', async t => {
  const base = await environment(t);
  for (const mode of ['unknown-dispatch', 'startup-main', 'startup-text']) {
    const e = {...base, env: {...base.env, NISI_CLI_TEST_MODE: mode}};
    const result = invoke(e, ['help'], entry, ['--import', doublePreload]);
    assert.equal(result.status, 2); assert.equal(result.stdout, '');
    assert.equal(JSON.parse(result.stderr).code, mode === 'unknown-dispatch' ? 'NISI_CLI_ARGUMENTS' : mode === 'startup-text' ? 'NISI_CLI_STARTUP' : 'NISI_CLI_ERROR');
    assert.equal(result.stderr.includes('SECRET'), false); assert.equal(result.stderr.includes('Error:'), false);
  }
});
test('closed stdout or stderr is an exit-2 output failure, never a successful command', async t => {
  const e = await environment(t);
  for (const channel of ['stdout', 'stderr']) {
    const child = spawn(process.execPath, ['--import', guard, entry, channel === 'stdout' ? '--help' : 'invalid'],
      {cwd: e.cwd, env: e.env, stdio: ['ignore', 'pipe', 'pipe']});
    const remaining = channel === 'stdout' ? 'stderr' : 'stdout'; let output = '';
    child[remaining].setEncoding('utf8'); child[remaining].on('data', chunk => { output += chunk; });
    child[channel].destroy();
    const outcome = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(Error('CLI output test timed out')); }, 10000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', (code, signal) => { clearTimeout(timer); resolve({code, signal}); });
    });
    assert.deepEqual(outcome, {code: 2, signal: null});
    if (channel === 'stdout') assert.equal(JSON.parse(output).code, 'EPIPE');
    else assert.equal(output, '');
  }
});
