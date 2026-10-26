// tests/repository-live-preflight.test.mjs
// Read-only --preflight-only admission. Establishes no model, compiler, workflow
// or runtime acceptance; only pinned fixture reads are permitted.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { withPreflightGuards } from './helpers/live-cli-side-effect-guard.mjs';
import { CLI_HELP } from '../cli/text.mjs';

const { runPrivateLiveDemo, parseLiveDemoInvocation } = await withPreflightGuards(() =>
  import(new URL('../examples/repository-live-model.mjs', import.meta.url)));

const endpoint = 'http://127.0.0.1:1234/v1/chat/completions';
const v1 = ['--approved-reviewed-fixture', '--endpoint', endpoint, '--author-model', 'synthetic.author', '--reviewer-model', 'synthetic.reviewer'];
const v2 = [...v1, '--author-output-mode', 'json_schema', '--reviewer-output-mode', 'json_instruction'];
const v3 = ['--approved-reviewed-fixture',
  '--author-api', 'CHAT_COMPLETIONS', '--author-endpoint', endpoint, '--author-model', 'synthetic.author', '--author-output-mode', 'json_schema',
  '--reviewer-api', 'CHAT_COMPLETIONS', '--reviewer-endpoint', endpoint, '--reviewer-model', 'synthetic.reviewer', '--reviewer-output-mode', 'json_schema'];
const nativeRole = role => [`--${role}-api`, 'NATIVE_API', `--${role}-endpoint`, 'http://127.0.0.1:1234/api/v1/chat',
  `--${role}-model`, `synthetic.${role}`, `--${role}-instance`, `synthetic.${role}.instance`,
  `--${role}-profile`, 'nisi-native-chat-content-v1', `--${role}-reasoning`, 'off'];
const chatRole = role => [`--${role}-api`, 'CHAT_COMPLETIONS', `--${role}-endpoint`, endpoint,
  `--${role}-model`, `synthetic.${role}`, `--${role}-output-mode`, 'json_schema'];
const bothNative = ['--approved-reviewed-fixture', ...nativeRole('author'), ...nativeRole('reviewer')];
const mixed = ['--approved-reviewed-fixture', ...nativeRole('author'), ...chatRole('reviewer')];
const reversed = ['--approved-reviewed-fixture', ...chatRole('author'), ...nativeRole('reviewer')];
const expected = Object.freeze({ schemaVersion: 'nisi-live-demo-preflight/v1', status: 'PREFLIGHT_VALIDATED',
  scope: 'EXACT_REVIEWED_FIXTURE_CONFIGURATION_ONLY', modelConfigurationValidated: true, runtimeAdmission: 'NOT_OBSERVED',
  serverIdleObserved: false, modelCalls: 0, compilerStarted: false, workspaceCreated: false, artifactWrites: 0,
  nx04Accepted: false, authorizing: false, publicationAuthorized: false, exitCode: 1 });
const coded = code => e => e?.code === code;

// Supplements the guard's final-listener comparison: prove no attempted registration.
async function withSignalSpy(fn) {
  const attempts = [], originals = new Map(), descriptors = new Map();
  const timers = new Map(['setTimeout', 'setInterval', 'setImmediate'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, descriptor] of timers) Object.defineProperty(globalThis, name, { ...descriptor, value() {
    attempts.push(name); throw new Error('Preflight must not schedule timers');
  } });
  for (const key of ['on', 'once', 'addListener', 'prependListener', 'prependOnceListener']) {
    originals.set(key, process[key]);
    descriptors.set(key, Object.getOwnPropertyDescriptor(process, key));
    process[key] = function spy(event, ...rest) {
      if (event === 'SIGINT' || event === 'SIGTERM') attempts.push(`${key}:${event}`);
      return originals.get(key).call(this, event, ...rest);
    };
  }
  try { return await fn(); }
  finally {
    for (const [name, descriptor] of timers) Object.defineProperty(globalThis, name, descriptor);
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(process, key, descriptor); else delete process[key];
    }
    assert.deepEqual(attempts, [], 'preflight must not register signal listeners');
  }
}
const run = (args, options) => withSignalSpy(() => withPreflightGuards(() => runPrivateLiveDemo(args, options), { allowFixtureReads: true }));

function assertReport(out, reads, fixtureFiles) {
  assert.ok(Object.isFrozen(out));
  const { reviewedSourceFingerprint, sourceFileCount, ...rest } = out;
  assert.deepEqual(rest, expected);
  assert.match(reviewedSourceFingerprint, /^[0-9a-f]{64}$/u);
  assert.equal(sourceFileCount, fixtureFiles.length);
  for (const value of Object.values(out)) assert.ok(['string', 'number', 'boolean'].includes(typeof value), 'scalar-only report');
  for (const key of ['lane', 'suite', 'approval', 'candidate', 'authorizeContext']) assert.equal(Object.hasOwn(out, key), false);
  assert.deepEqual([...reads].sort(), [...fixtureFiles].sort(), 'every pinned source must be read exactly once');
  assert.throws(() => { out.exitCode = 0; }, TypeError);
}

for (const [label, args] of [['legacy V1', v1], ['legacy V2', v2], ['V3 chat', v3],
  ['V3 native', bothNative], ['V3 native/chat', mixed], ['V3 chat/native', reversed]])
  test(`${label} --preflight-only returns exact zero-effect frozen report`, () => withSignalSpy(() =>
    withPreflightGuards(async ({ reads, fixtureFiles }) => {
      assertReport(await runPrivateLiveDemo([...args, '--preflight-only']), reads, fixtureFiles);
    }, { allowFixtureReads: true })));

test('modifier position is irrelevant and omitted from legacy invocation shape', () => {
  assert.equal(parseLiveDemoInvocation(['--preflight-only', ...v1]).preflightOnly, true);
  assert.equal(parseLiveDemoInvocation([...v1, '--preflight-only']).preflightOnly, true);
  const legacy = parseLiveDemoInvocation(v1);
  assert.deepEqual(Object.keys(legacy), ['selected', 'reviewHistory']);
});

test('preflight-only may omit state even when external state is required', async () => {
  const out = await run([...v1, '--preflight-only'], { requireExternalState: true });
  assert.equal(out.status, 'PREFLIGHT_VALIDATED');
});

test('mandatory state remains enforced without the modifier', async () => {
  await assert.rejects(run(v1, { requireExternalState: true }), coded('NISI_STATE_DIRECTORY_REQUIRED'));
});

test('supplied --state-dir is validated, not created, under preflight', async () => {
  const missing = path.join(os.tmpdir(), `nisi-preflight-missing-${process.pid}-${Date.now()}`);
  await assert.rejects(run([...v1, '--preflight-only', '--state-dir', missing]), coded('NISI_STATE_DIRECTORY_INVALID'));
});

test('refuses duplicate modifier, --help, history and incident combinations', () => {
  for (const args of [[...v1, '--preflight-only', '--preflight-only'], ['--help', '--preflight-only'], ['--preflight-only', '--help'],
    [...v1, '--preflight-only', '--review-history'], [...v1, '--review-incidents', '--preflight-only']])
    assert.throws(() => parseLiveDemoInvocation(args), coded('LIVE_DEMO_ARGUMENTS'));
});

test('preflight still enforces model/API validation', async () => {
  await assert.rejects(run(['--approved-reviewed-fixture', '--endpoint', 'http://198.51.100.7:1234/v1/chat/completions',
    '--author-model', 'a', '--reviewer-model', 'b', '--preflight-only']), coded('LOCAL_CHAT_DESTINATION_REFUSED'));
  await assert.rejects(run(['--approved-reviewed-fixture', '--endpoint', endpoint, '--author-model', 'same', '--reviewer-model', 'same', '--preflight-only']), coded('LIVE_MODELS_NOT_DISTINCT'));
  await assert.rejects(run(['--endpoint', endpoint, '--author-model', 'a', '--reviewer-model', 'b', '--preflight-only']), coded('LIVE_DEMO_EXPLICIT_APPROVAL_REQUIRED'));
});

test('native/mixed preflight refuses malformed and absent role fields before source reads', async () => {
  const cases = [
    ['--author-instance', undefined, 'LIVE_ROLE_SCHEMA'], ['--author-instance', ' invalid', 'LIVE_MODEL_ID'],
    ['--author-profile', undefined, 'LIVE_ROLE_SCHEMA'], ['--author-profile', 'unsupported', 'LIVE_NATIVE_PROFILE'],
    ['--author-reasoning', undefined, 'LIVE_ROLE_SCHEMA'], ['--author-reasoning', 'auto', 'LIVE_NATIVE_PROFILE'],
    ['--reviewer-output-mode', undefined, 'LIVE_ROLE_SCHEMA'], ['--reviewer-output-mode', 'other', 'LIVE_OUTPUT_MODE_INVALID'],
  ];
  await withSignalSpy(() => withPreflightGuards(async ({ reads }) => {
    for (const [flag, value, code] of cases) {
      const args = [...mixed], index = args.indexOf(flag);
      if (value === undefined) args.splice(index, 2); else args[index + 1] = value;
      await assert.rejects(runPrivateLiveDemo([...args, '--preflight-only']), { code });
    }
    assert.deepEqual(reads, []);
  }));
});

test('help texts describe the modifier as deliberate non-acceptance', async () => {
  const out = await runPrivateLiveDemo(['--help']);
  assert.equal(out.exitCode, 0);
  assert.match(out.help, /--preflight-only/u);
  assert.match(out.help, /exitCode 1/u);
  assert.match(CLI_HELP, /--preflight-only/u);
});

test('preflight validates an explicit private state directory without writing in it', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nisi-preflight-state-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.chmodSync(directory, 0o700);
  const before = fs.statSync(directory);
  const out = await run([...v1, '--preflight-only', '--state-dir', directory], { requireExternalState: true });
  assert.equal(out.exitCode, 1);
  assert.deepEqual(fs.readdirSync(directory), []);
  const after = fs.statSync(directory);
  assert.deepEqual([after.ino, after.dev, after.mode, after.mtimeMs, after.ctimeMs],
    [before.ino, before.dev, before.mode, before.mtimeMs, before.ctimeMs]);
});

test('actual CLI reports non-acceptance without side effects or process hangs', () => {
  const bin = fileURLToPath(new URL('../bin/nisi.mjs', import.meta.url));
  const guard = fileURLToPath(new URL('./helpers/nisi-cli-no-effects.mjs', import.meta.url));
  const child = spawnSync(process.execPath, ['--import', guard, bin, 'demo', ...v1, '--preflight-only'], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 65536,
    env: { NISI_CLI_TEST_ALLOW_DEMO: '1', LANG: 'C', LC_ALL: 'C' },
  });
  assert.equal(child.error, undefined); assert.equal(child.signal, null);
  assert.equal(child.status, 1); assert.equal(child.stderr, '');
  const out = JSON.parse(child.stdout);
  assert.equal(out.status, 'PREFLIGHT_VALIDATED'); assert.equal(out.exitCode, 1);
  assert.equal(out.runtimeAdmission, 'NOT_OBSERVED'); assert.equal(out.modelCalls, 0);
  assert.equal(out.artifactWrites, 0); assert.equal(out.nx04Accepted, false);
});
