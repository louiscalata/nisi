// Private inventory tests. No model server, weights, inference or downloads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { createLocalModelDiscovery } from '../hosts/local-models/discovery.mjs';

const runtime = overrides => ({ id: 'local.lm', provider: 'lmstudio-v1', origin: 'http://127.0.0.1:1234', ...overrides });
const lm = overrides => ({ key: 'fixture/chat', display_name: 'Fixture Chat', type: 'llm', size_bytes: 4096,
  loaded_instances: [{ id: 'fixture-instance' }], ...overrides });
const json = value => new Response(JSON.stringify(value), { status: 200 });
const make = overrides => createLocalModelDiscovery({ runtimes: [runtime()], fetch: async () => json({ models: [lm()] }), ...overrides });
const code = expected => error => error.code === expected;

test('construction is inert and discovery only uses the fixed credential-free GET', async () => {
  const calls = [];
  const client = make({ fetch: async (...args) => { calls.push(args); return json({ models: [lm()] }); } });
  assert.equal(calls.length, 0);
  const result = await client.discover();
  assert.equal(calls.length, 1);
  const [url, options] = calls[0];
  assert.equal(url, 'http://127.0.0.1:1234/api/v1/models');
  assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
  assert.equal(options.credentials, 'omit'); assert.equal(options.cache, 'no-store');
  assert.deepEqual(options.headers, { accept: 'application/json' }); assert.equal(options.body, undefined);
  assert.equal(result.schemaVersion, 1); assert.equal(result.status, 'LISTED');
  assert.equal(result.scope, 'REGISTERED_RUNTIME_INVENTORY_ONLY');
  assert.match(result.runtimes[0].responseSha256, /^[0-9a-f]{64}$/u);
  assert.ok(result.runtimes[0].bytesRead > 0);
});

test('inventory never grants use, local-only, free, licensed or inference-ready status', async () => {
  const result = await make().discover(); const model = result.runtimes[0].models[0];
  assert.equal(model.presence, 'PROVIDER_LISTED'); assert.equal(model.loadedState, 'REPORTED_LOADED');
  assert.equal(model.locality, 'NOT_VERIFIED'); assert.equal(model.inference, 'NOT_TESTED');
  assert.equal(model.license, 'NOT_REVIEWED'); assert.equal(model.providerFee, 'UNKNOWN');
  assert.equal(model.useAuthorization, 'NONE');
  assert.ok(Object.isFrozen(model.instanceIds));
  assert.throws(() => { model.useAuthorization = 'APPROVED'; }, TypeError);
});

test('unloaded and embedding entries are distinct, not silently excluded or considered chat-ready', async () => {
  const result = await make({ fetch: async () => json({ models: [lm({ type: 'embedding', loaded_instances: [] })] }) }).discover();
  assert.equal(result.runtimes[0].models[0].type, 'embedding');
  assert.equal(result.runtimes[0].models[0].loadedState, 'REPORTED_NOT_LOADED');
  assert.equal(result.runtimes[0].models[0].inference, 'NOT_TESTED');
});

test('Ollama tags preserve identity/digest but do not infer residency or local execution', async () => {
  const calls = [];
  const result = await make({ runtimes: [runtime({ id: 'local.ollama', provider: 'ollama-tags', origin: 'http://[::1]:11434/' })],
    fetch: async url => { calls.push(url); return json({ models: [{ name: 'cloud-alias', model: 'cloud-alias', size: 0,
      remote_host: 'https://example.invalid', digest: 'a'.repeat(64), details: { family: 'fake' } }] }); } }).discover();
  assert.deepEqual(calls, ['http://[::1]:11434/api/tags']);
  const model = result.runtimes[0].models[0];
  assert.equal(model.loadedState, 'UNKNOWN'); assert.equal(model.type, 'UNKNOWN');
  assert.equal(model.reportedDigest, 'a'.repeat(64)); assert.equal(model.sizeBytes, 0);
  assert.equal(model.locality, 'NOT_VERIFIED'); assert.equal(model.providerFee, 'UNKNOWN');
  assert.equal(model.useAuthorization, 'NONE');
});

test('optional missing size stays unknown, not zero or an automatic fit', async () => {
  const result = await make({ fetch: async () => json({ models: [lm({ size_bytes: undefined })] }) }).discover();
  assert.equal(result.runtimes[0].models[0].sizeBytes, null);
  assert.equal(result.runtimes[0].models[0].useAuthorization, 'NONE');
});

test('model identity remains runtime-scoped and metadata changes affect the response digest', async () => {
  let size = 4096;
  const client = make({ runtimes: [runtime(), runtime({ id: 'second.lm', origin: 'http://127.0.0.1:1235' })],
    fetch: async () => json({ models: [lm({ size_bytes: size })] }) });
  const first = await client.discover(); size = 8192; const second = await client.discover();
  assert.notEqual(first.runtimes[0].responseSha256, second.runtimes[0].responseSha256);
  assert.notEqual(first.runtimes[0].models[0].runtimeId, first.runtimes[1].models[0].runtimeId);
  assert.equal(first.runtimes[0].models[0].sizeBytes, 4096);
});

test('bad origin/config is refused before any transport', () => {
  let calls = 0;
  const fetch = async () => { calls++; return json({ models: [] }); };
  for (const origin of ['http://localhost:1234', 'http://127.0.0.2:1234', 'https://127.0.0.1',
    'http://127.0.0.1:1234/path', 'http://127.0.0.1?token=secret', 'http://user:pass@127.0.0.1',
    'http://127.1', 'http://2130706433', 'http://127.0.0.1:99999', 'http://example.invalid']) {
    assert.throws(() => make({ fetch, runtimes: [runtime({ origin })] }), code('INVENTORY_ORIGIN_REFUSED'));
  }
  assert.throws(() => make({ fetch, headers: {} }), code('INVENTORY_CONFIG_INVALID'));
  assert.throws(() => make({ fetch, runtimes: [runtime({ provider: 'arbitrary' })] }), code('INVENTORY_RUNTIME_INVALID'));
  assert.throws(() => make({ fetch, runtimes: [runtime({ token: 'not-sent' })] }), code('INVENTORY_CONFIG_INVALID'));
  assert.equal(calls, 0);
});

test('duplicate runtime IDs/endpoints and invalid limits are refused', () => {
  assert.throws(() => make({ runtimes: [runtime(), runtime()] }), code('INVENTORY_DUPLICATE_RUNTIME'));
  assert.throws(() => make({ runtimes: [runtime(), runtime({ id: 'second.lm' })] }), code('INVENTORY_DUPLICATE_RUNTIME'));
  assert.throws(() => make({ runtimes: Array(1) }), code('INVENTORY_RUNTIMES_INVALID'));
  for (const config of [{ timeoutMs: 0 }, { maxResponseBytes: 255 }, { maxModels: 1025 }, { maxModels: 1.5 }]) {
    assert.throws(() => make(config), code('INVENTORY_LIMIT_INVALID'));
  }
});

test('captured configuration cannot redirect a later discovery', async () => {
  const input = runtime(); const sources = [input]; const calls = [];
  const client = make({ runtimes: sources, fetch: async url => { calls.push(url); return json({ models: [] }); } });
  input.origin = 'http://example.invalid'; sources.length = 0;
  await client.discover(); assert.deepEqual(calls, ['http://127.0.0.1:1234/api/v1/models']);
});

test('empty configuration is not reported as a working model inventory', async () => {
  let calls = 0;
  const result = await make({ runtimes: [], fetch: async () => { calls++; } }).discover();
  assert.equal(result.status, 'NOT_CONFIGURED'); assert.equal(calls, 0);
});

test('partial runtime failure retains successful inventory and explicit auth failure without retry', async () => {
  const calls = [];
  const result = await make({ runtimes: [runtime(), runtime({ id: 'second.lm', origin: 'http://127.0.0.1:1235' })],
    fetch: async url => { calls.push(url); return url.includes('1235') ? new Response('sign in', { status: 401 }) : json({ models: [lm()] }); } }).discover();
  assert.equal(result.status, 'PARTIAL'); assert.equal(result.runtimes[1].status, 'AUTH_REQUIRED');
  assert.equal(result.runtimes[1].models.length, 0); assert.equal(calls.length, 2);
});

test('malformed provider shape, entries, duplicate IDs and oversized model count refuse the entire runtime', async () => {
  for (const value of [{ data: [] }, { models: [null] }, { models: [lm(), lm()] },
    { models: [lm({ loaded_instances: [{}] })] }, { models: [lm({ type: 'future-type' })] },
    { models: [lm({ size_bytes: -1 })] }, { models: [lm({ key: 'bad\nname' })] },
    { models: [lm(), lm({ key: 'second' })] }]) {
    const result = await make({ maxModels: 1, fetch: async () => json(value) }).discover();
    assert.equal(result.runtimes[0].status, 'UNAVAILABLE'); assert.deepEqual(result.runtimes[0].models, []);
  }
  const duplicate = await make({ fetch: async () => json({ models: [lm(), lm()] }) }).discover();
  assert.equal(duplicate.runtimes[0].code, 'INVENTORY_DUPLICATE_MODEL');
});

test('transport rejects duplicate JSON keys, markdown, malformed JSON and invalid UTF-8', async () => {
  for (const body of ['{"models":[],"models":[]}', '```json\n{"models":[]}\n```', '{"models":', new Uint8Array([0xff])]) {
    const result = await make({ fetch: async () => new Response(body) }).discover();
    assert.equal(result.runtimes[0].status, 'UNAVAILABLE');
    assert.deepEqual(result.runtimes[0].models, []);
  }
});

test('oversized response is refused and its body cancelled', async () => {
  let cancelled = 0, sent = false;
  const body = new ReadableStream({ pull(controller) { if (!sent) { sent = true; controller.enqueue(new Uint8Array(257)); } },
    cancel() { cancelled++; } });
  const result = await make({ maxResponseBytes: 256, fetch: async () => new Response(body) }).discover();
  assert.equal(result.runtimes[0].code, 'INVENTORY_RESPONSE_TOO_LARGE'); assert.equal(cancelled, 1);
  assert.equal(result.runtimes[0].bytesRead, 257);
});

test('pre-aborted discovery sends no request, invalid signal is refused', async () => {
  let calls = 0; const controller = new AbortController(); controller.abort();
  const client = make({ fetch: async () => { calls++; } });
  const result = await client.discover({ signal: controller.signal });
  assert.equal(result.runtimes[0].status, 'CANCELLED'); assert.equal(calls, 0);
  await assert.rejects(client.discover({ signal: {} }), code('INVENTORY_SIGNAL_INVALID'));
});

test('deadline settles even if an injected fetch ignores abort, without starting another request', async () => {
  let calls = 0, signal;
  const result = await make({ timeoutMs: 20, fetch: async (_url, options) => { calls++; signal = options.signal; return new Promise(() => {}); } }).discover();
  assert.equal(result.runtimes[0].status, 'TIMED_OUT'); assert.equal(signal.aborted, true); assert.equal(calls, 1);
});

test('unsettled timeout prevents later runtimes and repeated discovery until actual settlement', async () => {
  let finish, calls = 0;
  const client = make({ runtimes: [runtime(), runtime({ id: 'second.lm', origin: 'http://127.0.0.1:1235' })], timeoutMs: 20,
    fetch: async () => { calls++; return calls === 1 ? new Promise(resolve => { finish = resolve; }) : json({ models: [] }); } });
  const result = await client.discover();
  assert.equal(result.runtimes[0].status, 'TIMED_OUT'); assert.equal(result.runtimes[1].status, 'NOT_RUN');
  assert.equal(result.runtimes[1].observedAt, null); assert.equal(calls, 1);
  await assert.rejects(client.discover(), code('INVENTORY_TRANSPORT_UNSETTLED'));
  assert.equal(calls, 1);
  finish(json({ models: [lm()] })); await new Promise(resolve => setImmediate(resolve));
  const fresh = await client.discover(); assert.equal(fresh.status, 'LISTED'); assert.equal(calls, 3);
  assert.deepEqual(result.runtimes[0].models, []); // late success cannot rewrite prior failure
});

test('unsettled cancellation also prevents replacement transport', async () => {
  const controller = new AbortController(); let calls = 0;
  const client = make({ fetch: async () => { calls++; return new Promise(() => {}); } });
  const pending = client.discover({ signal: controller.signal }); controller.abort();
  assert.equal((await pending).runtimes[0].status, 'CANCELLED');
  await assert.rejects(client.discover(), code('INVENTORY_TRANSPORT_UNSETTLED')); assert.equal(calls, 1);
});

test('stalled response body is cancelled at the deadline', async () => {
  let cancelled = 0;
  const body = new ReadableStream({ cancel() { cancelled++; } });
  const result = await make({ timeoutMs: 20, fetch: async () => new Response(body) }).discover();
  assert.equal(result.runtimes[0].status, 'TIMED_OUT'); assert.equal(cancelled, 1);
});

test('caller cancellation wins and concurrent discovery is refused', async () => {
  const controller = new AbortController();
  const client = make({ fetch: async () => new Promise(() => {}), timeoutMs: 1000 });
  const pending = client.discover({ signal: controller.signal });
  await assert.rejects(client.discover(), code('INVENTORY_ALREADY_RUNNING'));
  controller.abort(); const result = await pending;
  assert.equal(result.runtimes[0].status, 'CANCELLED');
});

test('late synchronous response cannot pass a missed deadline', async () => {
  const result = await make({ timeoutMs: 10, fetch: async () => {
    const start = performance.now(); while (performance.now() - start < 15) { /* deterministic lateness */ }
    return json({ models: [] });
  } }).discover();
  assert.equal(result.runtimes[0].status, 'TIMED_OUT');
});

test('final hashing delay cannot turn a late inventory into LISTED', async () => {
  // Isolated Node test-file process, serial top-level tests; restore the builtin
  // before returning. This targets post-parse work rather than a flaky big input.
  const original = crypto.createHash;
  crypto.createHash = (...args) => {
    const start = performance.now(); while (performance.now() - start < 30) { /* final-work delay */ }
    return original(...args);
  };
  syncBuiltinESMExports();
  try {
    assert.notEqual(createHash, original);
    const result = await make({ timeoutMs: 20 }).discover();
    assert.equal(result.runtimes[0].status, 'TIMED_OUT');
    assert.equal(result.runtimes[0].responseSha256, null);
  } finally { crypto.createHash = original; syncBuiltinESMExports(); }
});

test('real loopback fixture: only GET list, redirect never followed, no model execution', async t => {
  const calls = []; let redirect = false;
  const server = createServer((request, response) => {
    calls.push({ method: request.method, path: request.url, authorization: request.headers.authorization });
    if (redirect) { response.writeHead(302, { location: '/should-not-follow' }); response.end(); }
    else { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ models: [lm()] })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const client = createLocalModelDiscovery({ runtimes: [runtime({ origin: `http://127.0.0.1:${server.address().port}` })] });
  assert.equal((await client.discover()).status, 'LISTED'); redirect = true;
  assert.equal((await client.discover()).runtimes[0].status, 'UNAVAILABLE');
  assert.deepEqual(calls, [0, 1].map(() => ({ method: 'GET', path: '/api/v1/models', authorization: undefined })));
});
