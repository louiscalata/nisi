import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseNisiArguments } from '../cli/arguments.mjs';
import { observedTrial } from './helpers/observed-repository-trial-fixture.mjs';
import { deferred, reply } from './helpers/live-model-v3-fixture.mjs';
import { retainRepositoryTrialDiagnosticV1 as retain } from '../history/repository-trial-diagnostic-store-v1.mjs';
const root = path.resolve(import.meta.dirname, '..');
function cli(parent, args, expected, extra = {}) {
  const result = spawnSync(process.execPath, ['--import', path.join(root, 'tests/helpers/nisi-cli-no-effects.mjs'), path.join(root, 'bin/nisi.mjs'), ...args], {
    cwd: parent, env: { PATH: process.env.PATH, HOME: parent, TMPDIR: parent, NISI_CLI_TEST_PACKAGE_ROOT: root,
      NISI_CLI_TEST_ALLOW_TRIAL: '1', NISI_CLI_TEST_ALLOW_DIAGNOSTIC: '1', ...extra },
    timeout: 10000, killSignal: 'SIGKILL', encoding: 'utf8', maxBuffer: 65536,
  });
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, expected, result.stderr);
  return result;
}
const metadata = file => { const s = fs.statSync(file); return Object.fromEntries(['mode', 'ctimeMs', 'mtimeMs', 'nlink', 'size', 'ino', 'dev'].map(k => [k, s[k]])); };
test('diagnostic command requires exactly one bounded absolute path before inspection', () => {
  assert.equal(parseNisiArguments(['inspect-trial-diagnostic', '/not-opened']).command, 'inspect-trial-diagnostic');
  for (const args of [['inspect-trial-diagnostic'], ['inspect-trial-diagnostic', 'relative'], ['inspect-trial-diagnostic', '/a\0b'],
    ['inspect-trial-diagnostic', '/a', 'extra'], ['inspect-trial-diagnostic', '/' + 'a'.repeat(4096)]]) assert.throws(() => parseNisiArguments(args));
});
for (const adverse of [false, true]) test(`guarded CLI reads immutable terminal diagnostic and ledger once; adverse=${adverse}`, async t => {
  const c = await observedTrial(t, adverse ? { configure(i) { i.approval.expiresAtMs = 1; } } : {}); await c.runner.run();
  const directory = c.store.inspect().directory, saved = retain({ directory, diagnostic: c.observed().captureDiagnostics() });
  const files = [saved.file, c.store.inspect().file], before = files.map(file => ({ bytes: fs.readFileSync(file), metadata: metadata(file) }));
  const listing = fs.readdirSync(directory);
  const result = cli(c.parent, ['inspect-trial-diagnostic', saved.file], 0,
    { NISI_CLI_TEST_SINGLE_CAPTURE: '1', NISI_CLI_TEST_SINGLE_DIAGNOSTIC_CAPTURE: '1' });
  assert.equal(result.stderr, ''); assert(result.stdout.length < 8192); const value = JSON.parse(result.stdout);
  assert.equal(value.status, 'OBSERVED'); assert.equal(value.diagnostic.kind, 'TERMINAL_CHANNELS'); assert.equal(value.pastAcknowledgement, 'UNKNOWN');
  assert.equal(value.authorizing, false); assert.equal(value.rawEvidenceRetained, false);
  if (adverse) assert.equal(value.diagnostic.channels.operationResult.state, 'REJECTED');
  for (const absent of [root, c.parent, 'synthetic.author', 'http://', 'retry-settings.mjs', 'candidateText']) assert(!result.stdout.includes(absent));
  for (const [i, file] of files.entries()) { assert.deepEqual(fs.readFileSync(file), before[i].bytes); assert.deepEqual(metadata(file), before[i].metadata); }
  assert.deepEqual(fs.readdirSync(directory), listing);
});
test('guarded CLI reports partial capture as incomplete and corrupt capture as unavailable', async t => {
  const started = deferred(), response = deferred(), c = await observedTrial(t, { onRequest(call) { started.resolve(call); return response.promise; } });
  const running = c.runner.run(), call = await started.promise;
  let saved;
  try {
    saved = retain({ directory: c.store.inspect().directory, diagnostic: c.observed().captureDiagnostics() });
    const r = cli(c.parent, ['inspect-trial-diagnostic', saved.file], 1);
    assert.equal(JSON.parse(r.stdout).diagnostic.kind, 'PARTIAL_CHANNELS');
  } finally { response.resolve(reply(call.envelope)); }
  await running; fs.appendFileSync(saved.file, 'corruption');
  const r = cli(c.parent, ['inspect-trial-diagnostic', saved.file], 2);
  assert.equal(JSON.parse(r.stdout).status, 'UNAVAILABLE'); assert.equal(r.stderr, '');
});
test('malformed CLI usage stays sanitized and diagnostic import needs its separate test allowance', async t => {
  const c = await observedTrial(t); await c.runner.run();
  const invalid = cli(c.parent, ['inspect-trial-diagnostic', 'PRIVATE_RELATIVE'], 2);
  assert.equal(invalid.stdout, ''); assert(!invalid.stderr.includes('PRIVATE_RELATIVE'));
  const denied = cli(c.parent, ['inspect-trial-diagnostic', path.join(c.parent, 'missing')], 2, { NISI_CLI_TEST_ALLOW_DIAGNOSTIC: '0' });
  assert.equal(denied.stdout, ''); assert.equal(JSON.parse(denied.stderr).code, 'NISI_CLI_ERROR');
});
