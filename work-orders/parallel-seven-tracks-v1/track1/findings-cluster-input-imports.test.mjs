// PRIVATE C05 draft. Intended future location:
// work-orders/parallel-seven-tracks-v1/track1/findings-cluster-input-imports.test.mjs
// This file is a proposed oracle only; it is not a canonical acceptance result.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import dgram from 'node:dgram';
import dns from 'node:dns';
import fs from 'node:fs';
import fspModule, * as realFspModule from 'node:fs/promises';
import http from 'node:http';
import http2 from 'node:http2';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createReviewedLiveFixtureV1 } from '../../../examples/repository-task/reviewed-live-fixture-v1.mjs';
import {
  inspectFixtureModuleSurfaceV1,
  installFixtureNetworkGuard,
} from './fixture-write-guard.mjs';

const trackRoot = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.join(trackRoot, 'repository-fixture-runner.mjs');
const runnerUrl = pathToFileURL(runnerPath);
const fixtureRoot = path.resolve(trackRoot, '../../../examples/repository-task');
const PROFILE = 'repository-fixture-runner-v1';

// The runner is imported after this mock is installed. It gives malformed-input
// tests an actual filesystem-call counter, not merely a zero-write assertion.
// The mock is test-only and preserves every fs/promises export not being
// counted. The canonical helper may replace this with an equivalent owner seam.
const fsCalls = [];
const realFsp = fspModule;
const auditedNames = new Set([
  'stat', 'lstat', 'realpath', 'mkdtemp', 'readFile', 'readdir', 'writeFile',
  'rm', 'chmod', 'open', 'rename', 'copyFile', 'mkdir', 'unlink',
]);
// Node's module mock can rewrite the builtin default object's properties.
// Capture callable originals first; looking them up later recurses into mocks.
const auditedOriginals = new Map([...auditedNames].map(name => [name, realFsp[name].bind(realFsp)]));
const audited = name => (...args) => {
  fsCalls.push(name);
  return auditedOriginals.get(name)(...args);
};
const mockedDefault = new Proxy(realFsp, {
  get(target, key, receiver) {
    if (typeof key === 'string' && auditedNames.has(key) && typeof target[key] === 'function') return audited(key);
    return Reflect.get(target, key, receiver);
  },
});
const mockedNamed = {};
for (const key of Object.keys(realFspModule)) {
  if (key === 'default') continue;
  mockedNamed[key] = auditedNames.has(key) && typeof realFspModule[key] === 'function' ? audited(key) : realFspModule[key];
}
mock.module('node:fs/promises', { defaultExport: mockedDefault, namedExports: mockedNamed });

let runner;
let fixture;
test.before(async () => {
  runner = await import(runnerUrl.href);
  fixture = await createReviewedLiveFixtureV1();
});

const parentRoot = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nisi-c05-parent-')));
const resetFsCalls = () => { fsCalls.length = 0; };
const cleanParent = parent => { fs.rmSync(parent, { recursive: true, force: true }); };
const baseInput = parent => ({ parentRoot: parent, profile: PROFILE });

function sourceMap({ empty = false, extra = false, pooled = false } = {}) {
  const map = {};
  for (const entry of fixture.reviewedSourceManifest) {
    const bytes = empty
      ? Buffer.alloc(0)
      : fs.readFileSync(path.join(fixtureRoot, entry.path));
    if (pooled && !empty) {
      const backing = Buffer.concat([Buffer.from('x'), bytes, Buffer.from('y')]);
      const slice = backing.subarray(1, backing.length - 1);
      // Buffer admission must use captured typed-array state, not these hooks.
      Object.defineProperty(slice, 'valueOf', { configurable: true, get() { throw Error('valueOf was read'); } });
      Object.defineProperty(slice, 'length', { configurable: true, get() { throw Error('length was read'); } });
      Object.defineProperty(slice, 'constructor', { configurable: true, get() { throw Error('constructor was read'); } });
      Object.defineProperty(slice, Symbol.iterator, { configurable: true, get() { throw Error('iterator was read'); } });
      map[entry.path] = slice;
    } else map[entry.path] = bytes;
  }
  if (extra) map['fixtures/extra/not-pinned.mjs'] = Buffer.from('not reviewed');
  return map;
}

async function expectResolved(promise, message = 'admitted input must resolve without throwing') {
  let value;
  await assert.doesNotReject(async () => { value = await promise; }, message);
  return value;
}
async function run(input) {
  return expectResolved(runner.runRepositoryFixtureAcceptanceV1(input));
}

async function assertArgs(input, label) {
  resetFsCalls();
  await assert.rejects(() => runner.runRepositoryFixtureAcceptanceV1(input), error => {
    assert.equal(error?.code, 'RUNNER_ARGS', label);
    return true;
  }, label);
  assert.deepEqual(fsCalls, [], `${label}: malformed input must make zero filesystem calls`);
}

test('malformed outer records reject before getters, proxies, or filesystem calls', async () => {
  const parent = parentRoot();
  let getterReads = 0;
  const getter = { parentRoot: parent };
  Object.defineProperty(getter, 'profile', { enumerable: true, get() { getterReads++; throw Error('profile getter'); } });
  const unknownGetter = { ...baseInput(parent) };
  Object.defineProperty(unknownGetter, 'reviewHistory', { enumerable: true, get() { getterReads++; throw Error('unknown getter'); } });
  const symbol = Symbol('hidden-control');
  const symbolInput = { ...baseInput(parent), [symbol]: true };
  const hidden = { ...baseInput(parent) };
  Object.defineProperty(hidden, 'reviewIncidents', { enumerable: false, value: true });
  const unsupported = Object.assign(Object.create({ inherited: true }), baseInput(parent));
  const hostile = new Proxy(baseInput(parent), {
    get() { throw Error('proxy get trap'); },
    ownKeys() { throw Error('proxy ownKeys trap'); },
    getOwnPropertyDescriptor() { throw Error('proxy descriptor trap'); },
  });
  const revokedPair = Proxy.revocable(baseInput(parent), {});
  revokedPair.revoke();
  try {
    await assertArgs(getter, 'own accessor');
    await assertArgs(unknownGetter, 'unknown accessor');
    await assertArgs(symbolInput, 'symbol key');
    await assertArgs(hidden, 'non-enumerable hidden key');
    await assertArgs(unsupported, 'unsupported prototype');
    await assertArgs(hostile, 'ordinary proxy');
    await assertArgs(revokedPair.proxy, 'revoked proxy');
    assert.equal(getterReads, 0, 'descriptor validation must not invoke user getters');
  } finally { cleanParent(parent); }
});

test('named ignored controls and nested injection controls are closed before I/O', async () => {
  const parent = parentRoot();
  try {
    for (const [name, value] of [
      ['endpoint', 'http://127.0.0.1:9'], ['authorModel', 'model-a'], ['reviewerModel', 'model-b'],
      ['reviewHistory', true], ['reviewIncidents', true],
    ]) await assertArgs({ ...baseInput(parent), [name]: value }, `outer ${name}`);
    await assertArgs({ ...baseInput(parent), inject: { staticOwner: {} } }, 'inject.staticOwner');
    await assertArgs({ ...baseInput(parent), inject: { testsOwner: { status: () => 'IDLE' } } }, 'unknown testsOwner.status');
    await assertArgs({ ...baseInput(parent), inject: { testsOwner: { settled: 'not callable' } } }, 'non-function settled');
    await assertArgs({ ...baseInput(parent), inject: new Proxy({}, { get() { throw Error('inject trap'); } }) }, 'inject proxy');
    await assertArgs({ ...baseInput(parent), inject: { testsOwner: new Proxy({}, { get() { throw Error('owner trap'); } }) } }, 'testsOwner proxy');
  } finally { cleanParent(parent); }
});

test('invalid signal records reject without traversing public getters; genuine signal is retained', async () => {
  const parent = parentRoot();
  let signalGetterReads = 0;
  const fake = Object.create(AbortSignal.prototype);
  Object.defineProperty(fake, 'aborted', { enumerable: true, get() { signalGetterReads++; throw Error('aborted getter'); } });
  const controller = new AbortController();
  const proxied = new Proxy(controller.signal, { get() { throw Error('signal proxy'); } });
  const revoked = Proxy.revocable(controller.signal, {}); revoked.revoke();
  const symbolGetter = new AbortController().signal;
  Object.defineProperty(symbolGetter, Symbol('adverse'), { get() { signalGetterReads++; throw Error('symbol signal getter'); } });
  try {
    await assertArgs({ ...baseInput(parent), signal: 'not-a-signal' }, 'primitive signal');
    await assertArgs({ ...baseInput(parent), signal: fake }, 'public signal override');
    await assertArgs({ ...baseInput(parent), signal: proxied }, 'signal proxy');
    await assertArgs({ ...baseInput(parent), signal: revoked.proxy }, 'revoked signal proxy');
    await assertArgs({ ...baseInput(parent), signal: symbolGetter }, 'symbol signal getter');
    await assertArgs({ ...baseInput(parent), signal: Object.create(null) }, 'unsupported signal prototype');
    assert.equal(signalGetterReads, 0, 'signal validation must not read aborted/reason/EventTarget state');
    const result = await run({ ...baseInput(parent), signal: controller.signal });
    assert.equal(result.status, 'COMPLETED');
  } finally { cleanParent(parent); }
});

test('null-prototype records and empty injection records remain no-op compatibility controls', async () => {
  const parent = parentRoot();
  try {
    const nullOuter = Object.assign(Object.create(null), baseInput(parent));
    assert.equal((await run(nullOuter)).status, 'COMPLETED');
    assert.equal((await run({ ...baseInput(parent), inject: {} })).status, 'COMPLETED');
    assert.equal((await run({ ...baseInput(parent), inject: { testsOwner: {} } })).status, 'COMPLETED');
    assert.equal((await run({ ...baseInput(parent), inject: { testsOwner: { settled: undefined } } })).status, 'COMPLETED');
    assert.equal((await run({ ...baseInput(parent), signal: undefined, sources: undefined, inject: undefined })).status, 'COMPLETED');
    assert.equal((await run({ ...baseInput(parent), sources: Object.assign(Object.create(null), sourceMap()) })).status, 'COMPLETED');
    for (const testsOwner of [Object.create(null), Object.assign(Object.create(null), { settled: undefined })]) {
      const inject = Object.assign(Object.create(null), { testsOwner });
      assert.equal((await run({ ...baseInput(parent), inject })).status, 'COMPLETED');
    }
  } finally { cleanParent(parent); }
});

test('all nested records reject descriptor and prototype surprises before I/O', async () => {
  const parent = parentRoot(); let reads = 0;
  const builders = [value => ({ sources: value }), value => ({ inject: value }), value => ({ inject: { testsOwner: value } })];
  try {
    for (const build of builders) {
      const getter = {};
      Object.defineProperty(getter, 'settled', { enumerable: true, get() { reads++; throw Error('nested getter'); } });
      const hidden = {}; Object.defineProperty(hidden, 'extra', { value: true });
      const tagged = {};
      Object.defineProperty(tagged, Symbol.toStringTag, { get() { reads++; throw Error('tag getter'); } });
      const revoked = Proxy.revocable({}, {}); revoked.revoke();
      for (const record of [getter, hidden, tagged, { [Symbol('extra')]: 1 }, Object.create({ extra: true }), [], null,
        new Proxy({}, { ownKeys() { reads++; throw Error('ownKeys trap'); } }), revoked.proxy]) {
        await assertArgs({ ...baseInput(parent), ...build(record) }, 'nested record refusal');
      }
    }
    const callback = new Proxy(() => {}, { apply() { reads++; throw Error('callback proxy'); } });
    await assertArgs({ ...baseInput(parent), inject: { testsOwner: { settled: callback } } }, 'callback proxy');
    assert.equal(reads, 0);
  } finally { cleanParent(parent); }
});

test('Buffer brands, shared backing, and detached backing are rejected before I/O', async () => {
  const parent = parentRoot(); let hooks = 0;
  const backing = new ArrayBuffer(8), detached = Buffer.from(backing);
  structuredClone(backing, { transfer: [backing] });
  const revoked = Proxy.revocable(Buffer.from('x'), {}); revoked.revoke();
  try {
    for (const value of [new Uint8Array(8), Object.create(Buffer.prototype), Buffer.from(new SharedArrayBuffer(8)), detached,
      new Proxy(Buffer.from('x'), { get() { hooks++; throw Error('buffer trap'); } }), revoked.proxy]) {
      await assertArgs({ ...baseInput(parent), sources: { 'x.mjs': value } }, 'invalid Buffer backing');
    }
    assert.equal(hooks, 0);
  } finally { cleanParent(parent); }
});

test('nested injection is captured before an asynchronous caller change', async () => {
  const parent = parentRoot(); let callbackCalls = 0;
  const testsOwner = { settled: undefined }, inject = { testsOwner };
  try {
    const pending = runner.runRepositoryFixtureAcceptanceV1({ ...baseInput(parent), inject });
    testsOwner.settled = () => { callbackCalls++; throw Error('late override'); };
    inject.testsOwner = { settled: testsOwner.settled };
    assert.equal(callbackCalls, 0, 'callback must not be called during synchronous intake');
    assert.equal((await pending).status, 'COMPLETED');
    assert.equal(callbackCalls, 0, 'late caller mutation must not affect the captured owner');
  } finally { cleanParent(parent); }
});

test('exact source buffers, pooled slices, and post-call mutation are snapshot-safe', async () => {
  const parent = parentRoot();
  const sources = sourceMap({ pooled: true });
  const input = { ...baseInput(parent), sources };
  try {
    const pending = runner.runRepositoryFixtureAcceptanceV1(input);
    input.profile = 'mutated-after-call';
    input.endpoint = 'http://example.invalid';
    input.inject = { staticOwner: {} };
    for (const bytes of Object.values(sources)) bytes[0] ^= 0xff;
    const result = await expectResolved(pending, 'later caller mutations must not invalidate captured input');
    assert.equal(result.status, 'COMPLETED');
    assert.deepEqual(result.revealedSourceManifest, fixture.reviewedSourceManifest);
  } finally { cleanParent(parent); }
});

test('source type and pin failures retain the historical RUNNER_ARGS/SOURCE_DRIFT split', async () => {
  const parent = parentRoot();
  try {
    await assertArgs({ ...baseInput(parent), sources: { 'x.mjs': 'not-a-buffer' } }, 'source value type');
    resetFsCalls();
    const extra = await runner.runRepositoryFixtureAcceptanceV1({ ...baseInput(parent), sources: sourceMap({ extra: true }) });
    assert.equal(extra.status, 'REFUSED');
    assert.equal(extra.reason, 'SOURCE_DRIFT');
    assert.equal(extra.ownedRoot, null);
    assert.equal(extra.retained.length, 0);
    assert.equal(fsCalls.includes('mkdtemp'), false, 'source drift must not allocate an owned root');
    const empty = await runner.runRepositoryFixtureAcceptanceV1({ ...baseInput(parent), sources: sourceMap({ empty: true }) });
    assert.equal(empty.status, 'REFUSED');
    assert.equal(empty.reason, 'SOURCE_DRIFT');
    assert.equal(empty.ownedRoot, null);
  } finally { cleanParent(parent); }
});

test('settled injection remains the only supported override and preserves adverse semantics', async () => {
  const parent = parentRoot();
  const settled = async () => { throw Object.assign(new Error('synthetic'), { code: 'SYNTHETIC_SETTLEMENT' }); };
  try {
    const result = await run({ ...baseInput(parent), inject: { testsOwner: { settled } } });
    assert.equal(result.status, 'UNCONFIRMED');
    assert.ok(result.hostResult.settlementErrors.some(error => error?.code === 'SYNTHETIC_SETTLEMENT'));
    assert.equal(result.hostResult.state, 'QUARANTINED');
    assert.equal(result.receipt, null);
  } finally { cleanParent(parent); }
});

const EXPECTED_IMPORTS = [
  'node:events', 'node:crypto', 'node:util', 'node:fs/promises', 'node:path',
  '../../../examples/repository-task/reviewed-live-fixture-v1.mjs',
  '../../../hosts/repository/reviewed-workflow-v1.mjs',
  '../../../hosts/repository/snapshot-contract.mjs',
  '../../../hosts/repository/node-executor-v1.mjs',
  '../../../hosts/repository/task-workspace-v1.mjs',
  '../../../hosts/swift-verifier/check-plan-v1.mjs',
  '../../../receipts/swift-static-group-v1.mjs',
  '../../../receipts/repository-run-v1.mjs',
  '../../../hosts/swift-verifier/protocol.mjs',
];

test('actual runner has the exact frozen direct import surface', () => {
  const source = fs.readFileSync(runnerPath, 'utf8');
  const result = inspectFixtureModuleSurfaceV1(source);
  assert.deepEqual(result.parseErrors, []);
  assert.deepEqual(result.imports, EXPECTED_IMPORTS);
  assert.deepEqual(result.violations, []);
});

test('AST surface mutants are rejected without regex false positives', () => {
  const mutants = [
    ['literal dynamic import', "const loaded = import('node:net');", 'DYNAMIC_IMPORT'],
    ['nonliteral dynamic import', 'const loaded = import(name);', 'DYNAMIC_IMPORT'],
    ['side-effect import', "import 'node:net';", 'EXTRA_IMPORT'],
    ['named re-export', "export { connect } from 'node:net';", 'MODULE_REEXPORT'],
    ['star re-export', "export * from 'node:net';", 'MODULE_REEXPORT'],
    ['require call', "const net = require('node:net');", 'REQUIRE_CALL'],
    ['computed module require', "module['require']('node:net');", 'REQUIRE_CALL'],
    ['computed global require', "globalThis['require']('node:net');", 'REQUIRE_CALL'],
    ['optional require', "require?.('node:net');", 'REQUIRE_CALL'],
    ['import equals', "import network = require('node:net');", 'REQUIRE_CALL'],
    ['imported createRequire alias', "import { createRequire as load } from 'node:module';", 'CREATE_REQUIRE'],
    ['aliased createRequire', "const load = createRequire(import.meta.url); load('node:net');", 'CREATE_REQUIRE'],
    ['computed process binding', "process['binding']('net');", 'PROCESS_BINDING'],
    ['linked process binding', "process._linkedBinding('net');", 'PROCESS_BINDING'],
    ['getBuiltinModule', "process.getBuiltinModule('node:net');", 'PROCESS_BINDING'],
    ['process destructuring', 'const { binding } = process; binding(\'net\');', 'PROCESS_BINDING'],
    ['otherwise benign extra import', "import assert from 'node:assert';", 'EXTRA_IMPORT'],
  ];
  for (const [label, addition, kind] of mutants) {
    const result = inspectFixtureModuleSurfaceV1(`const marker = 1;\n${addition}\n`);
    assert.deepEqual(result.parseErrors, [], `${label} must parse for a semantic mutant`);
    assert.ok(result.violations.some(entry => entry.kind === kind), `${label} must report ${kind}`);
  }
  const safeWords = inspectFixtureModuleSurfaceV1([
    '// require(\'node:net\') and import(\'node:net\') are words',
    'const text = "process.binding require createRequire";',
    'const unrelated = { import: true, require: false };',
  ].join('\n'));
  assert.deepEqual(safeWords.parseErrors, []);
  assert.deepEqual(safeWords.violations, []);
});

test('AST oracle bounds primitive source input and does not accept parse failures as kills', () => {
  const tooLarge = inspectFixtureModuleSurfaceV1('x'.repeat(1_048_577));
  assert.ok(tooLarge.violations.some(entry => entry.kind === 'SOURCE_TOO_LARGE'));
  const syntax = inspectFixtureModuleSurfaceV1('import {');
  assert.ok(syntax.parseErrors.length > 0);
  assert.equal(syntax.violations.some(entry => entry.kind === 'DYNAMIC_IMPORT'), false);
});

function runNetworkChild(mode = 'coverage') {
  const helperUrl = pathToFileURL(path.join(trackRoot, 'fixture-write-guard.mjs')).href;
  const source = `
    import assert from 'node:assert/strict';
    import dgram from 'node:dgram';
    import dns from 'node:dns';
    import http from 'node:http';
    import http2 from 'node:http2';
    import https from 'node:https';
    import net from 'node:net';
    import tls from 'node:tls';
    import { installFixtureNetworkGuard } from ${JSON.stringify(helperUrl)};
    const mode = ${JSON.stringify(mode)};
    const entries = [
      [globalThis, 'fetch', 'fetch'],
      [http, 'request', 'http.request'], [http, 'get', 'http.get'],
      [https, 'request', 'https.request'], [https, 'get', 'https.get'],
      [net, 'connect', 'net.connect'], [net, 'createConnection', 'net.createConnection'],
      [net.Socket.prototype, 'connect', 'net.Socket.prototype.connect'],
      [tls, 'connect', 'tls.connect'], [tls.TLSSocket.prototype, 'connect', 'tls.TLSSocket.prototype.connect'],
      [dgram, 'createSocket', 'dgram.createSocket'],
      [dgram.Socket.prototype, 'send', 'dgram.Socket.prototype.send'],
      [dgram.Socket.prototype, 'sendto', 'dgram.Socket.prototype.sendto'],
      [dgram.Socket.prototype, 'connect', 'dgram.Socket.prototype.connect'],
      [http2, 'connect', 'http2.connect'],
    ];
    const baseResolve = ['resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCaa', 'resolveCname', 'resolveMx',
      'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse'];
    for (const [target, prefix, top] of [
      [dns, 'dns', true], [dns.promises, 'dns.promises', true],
      [dns.Resolver.prototype, 'dns.Resolver.prototype', false],
      [dns.promises.Resolver.prototype, 'dns.promises.Resolver.prototype', false],
    ]) {
      const required = [...baseResolve, ...(top ? ['lookup', 'lookupService'] : [])];
      for (const key of required) assert.equal(typeof target[key], 'function', prefix + '.' + key + ' missing on runtime');
      const methods = [...new Set([...required,
        ...Object.getOwnPropertyNames(target).filter(key => key.startsWith('resolve') && typeof target[key] === 'function')])];
      for (const key of methods) entries.push([target, key, prefix + '.' + key]);
    }
    // Replace real primitives before testing: a missing guard reaches only a sentinel.
    const unguarded = [];
    for (const [target, key, label] of entries) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (descriptor === undefined && target === tls.TLSSocket.prototype) continue;
      assert.ok(descriptor && 'value' in descriptor, 'expected own data method: ' + label);
      Object.defineProperty(target, key, { ...descriptor, value() {
        unguarded.push(label); throw Object.assign(Error('sentinel'), { code: 'UNGUARDED_SENTINEL' });
      } });
    }
    const before = entries.map(([target, key]) => Object.getOwnPropertyDescriptor(target, key));
    const restored = () => entries.forEach(([target, key, label], index) =>
      assert.deepEqual(Object.getOwnPropertyDescriptor(target, key), before[index], 'restore ' + label));
    if (mode === 'missing') {
      for (const label of ['fetch', 'dgram.Socket.prototype.sendto', 'dns.lookup', 'dns.promises.lookupService',
        'dns.Resolver.prototype.reverse', 'dns.promises.Resolver.prototype.resolve']) {
        const [target, key] = entries.find(entry => entry[2] === label);
        const descriptor = Object.getOwnPropertyDescriptor(target, key);
        Object.defineProperty(target, key, { ...descriptor, value: undefined });
        const missingState = entries.map(([object, property]) => Object.getOwnPropertyDescriptor(object, property));
        assert.throws(() => installFixtureNetworkGuard(), { code: 'NETWORK_GUARD_API_MISSING' }, label);
        entries.forEach(([object, property], index) =>
          assert.deepEqual(Object.getOwnPropertyDescriptor(object, property), missingState[index], 'rollback ' + label));
        Object.defineProperty(target, key, descriptor);
      }
      restored();
    }
    const guard = installFixtureNetworkGuard();
    assert.throws(() => installFixtureNetworkGuard(), { code: 'NETWORK_GUARD_NESTED' });
    const expected = entries.map(entry => entry[2]);
    for (const [target, key, label] of entries) {
      assert.throws(() => target[key].call(null), { code: 'TEST_FORBIDDEN_SIDE_EFFECT:' + label }, label);
    }
    guard.close(); guard.close(); guard.assertClean(); restored();
    assert.deepEqual(unguarded, [], 'no primitive sentinel may be reached');
    assert.deepEqual(guard.attempts, expected);
    process.stdout.write(JSON.stringify({ attempts: guard.attempts, expected, mode, unguarded }));
  `;
  return childProcess.spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

for (const mode of ['coverage', 'missing']) {
  test('network guard exact families and transactional restoration: ' + mode, () => {
    const result = runNetworkChild(mode);
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.deepEqual(parsed.attempts, parsed.expected);
    assert.deepEqual(parsed.unguarded, []);
    assert.equal(parsed.mode, mode);
  });
}

test('normal runner execution makes no guarded network attempt', async () => {
  const parent = parentRoot();
  const guard = installFixtureNetworkGuard();
  try {
    const result = await runner.runRepositoryFixtureAcceptanceV1(baseInput(parent));
    assert.equal(result.status, 'COMPLETED');
    assert.deepEqual(guard.attempts, []);
  } finally {
    guard.close();
    guard.assertClean();
    cleanParent(parent);
  }
});
