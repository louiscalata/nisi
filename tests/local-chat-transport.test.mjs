// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
// The local-chat adapter's default loopback transport against real loopback
// servers. No model is called; every server and proxy is deterministic test code.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import { createLocalChatReviewerAdapter } from '../adapters/local-chat.mjs';

const adapterURL = new URL('../adapters/local-chat.mjs', import.meta.url).href;
const task = {
  taskId: 'transport.local-chat', mode: 'edit', language: 'json', allowedFiles: ['config.json'],
  protectedFiles: [], protectedSnapshots: {}, acceptanceCriteria: ['config is valid JSON'],
  policy: { repairBudget: 1, totalDeadlineMs: 1000, requiredReviewers: 1, requireReportStore: false },
};
const binding = { schemaVersion: 1, runId: 'transport-run', taskFingerprint: 'a'.repeat(64), attempt: 0, candidateFingerprint: null };
const payload = (overrides = {}) => ({ task, candidate: null, acceptanceCriteria: task.acceptanceCriteria, binding, ...overrides });
const reply = summary => JSON.stringify({ model: 'review-model',
  choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ findings: [], summary }) } }],
  usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } });
const reviewer = (endpoint, extra = {}) => createLocalChatReviewerAdapter({ destination: 'LOOPBACK_HTTP', endpoint,
  model: 'review-model', id: 'transport.reviewer', timeoutMs: 20_000, ...extra });

async function rejectsCode(action, code) {
  await assert.rejects(action, error => error?.code === code, `expected ${code}`);
}

// A bound that only turns a hung connection into a failure; passing runs never reach it.
function within(promise, ms, message) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })])
    .finally(() => clearTimeout(timer));
}

async function listen(server, host = '127.0.0.1') {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, host, resolve); });
  return server.address().port;
}

// Loopback server that records complete requests and tracks open connections.
async function serve(handler, host = '127.0.0.1') {
  const requests = [], sockets = new Set(), waiters = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => { requests.push({ method: request.method, url: request.url, headers: request.headers, body }); handler(request, response, body); });
  });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => { sockets.delete(socket); if (sockets.size === 0) waiters.splice(0).forEach(resolve => resolve()); });
  });
  const port = await listen(server, host);
  return {
    requests, port, url: `http://${host.includes(':') ? `[${host}]` : host}:${port}/v1/chat/completions`,
    idle: () => within(sockets.size === 0 ? Promise.resolve() : new Promise(resolve => waiters.push(resolve)), 10_000, 'client left a connection open'),
    close: () => new Promise(resolve => { for (const socket of sockets) socket.destroy(); server.close(resolve); }),
  };
}

function runNode(script, env) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ['--input-type=module', '-e', script], { env, timeout: 60_000, windowsHide: true },
      (error, stdout, stderr) => error ? reject(Object.assign(error, { stdout, stderr })) : resolve(stdout));
  });
}

test('default transport posts the request directly and reads a chunked response', async () => {
  const model = await serve((request, response) => {
    const text = reply('chunked');
    response.writeHead(200, { 'content-type': 'application/json' });
    let offset = 0;
    const next = () => { if (offset >= text.length) { response.end(); return; } response.write(text.slice(offset, offset += 7)); setImmediate(next); };
    next();
  });
  try {
    const adapter = reviewer(model.url);
    const result = await adapter.review(payload());
    assert.equal(result.status, 'PASS');
    assert.equal(result.evidence.summary, 'chunked');
    assert.equal(model.requests.length, 1);
    const [{ method, url, headers, body }] = model.requests;
    assert.equal(method, 'POST');
    assert.equal(url, '/v1/chat/completions');
    assert.equal(headers['content-type'], 'application/json');
    assert.equal(headers.accept, 'application/json');
    assert.equal(headers['accept-encoding'], 'identity');
    assert.equal(headers.connection, 'close');
    assert.equal(Number(headers['content-length']), Buffer.byteLength(body, 'utf8'));
    assert.equal(JSON.parse(body).model, 'review-model');
    const receipt = adapter.receipts().at(-1);
    assert.equal(receipt.status, 'RESPONSE_VALIDATED');
    assert.equal(receipt.httpStatus, 200);
    assert.deepEqual({ ...receipt.usage }, { promptTokens: 3, completionTokens: 2, totalTokens: 5 });
    await model.idle();
  } finally { await model.close(); }
});

test('default transport ignores a replaced global fetch and http.globalAgent', async () => {
  const model = await serve((request, response) => response.end(reply('direct')));
  const originalFetch = globalThis.fetch, originalAgent = http.globalAgent;
  let fetchCalls = 0, agentConnections = 0;
  class RefusingAgent extends http.Agent { createConnection() { agentConnections += 1; throw new Error('global agent must not be used'); } }
  globalThis.fetch = async () => { fetchCalls += 1; throw new Error('global fetch must not be used'); };
  http.globalAgent = new RefusingAgent();
  try {
    const result = await reviewer(model.url).review(payload());
    assert.equal(result.status, 'PASS');
    assert.equal(result.evidence.summary, 'direct');
  } finally { globalThis.fetch = originalFetch; http.globalAgent = originalAgent; await model.close(); }
  assert.equal(fetchCalls, 0);
  assert.equal(agentConnections, 0);
  assert.equal(model.requests.length, 1);
});

test('Node environment proxy settings do not reroute the default transport', async t => {
  const proxyLog = [];
  const proxy = http.createServer((request, response) => { proxyLog.push(`${request.method} ${request.url}`); request.resume(); response.writeHead(502).end(); });
  proxy.on('connect', (request, socket) => { proxyLog.push(`CONNECT ${request.url}`); socket.end('HTTP/1.1 502 Bad Gateway\r\ncontent-length: 0\r\n\r\n'); });
  const proxyPort = await listen(proxy);
  const model = await serve((request, response) => response.end(reply('direct')));
  const probe = await serve((request, response) => response.end('probe'));
  const proxyURL = `http://127.0.0.1:${proxyPort}`;
  // Inherited proxy settings (including NO_PROXY exemptions for loopback) are removed first.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/proxy/iu.test(key)));
  Object.assign(env, { NODE_USE_ENV_PROXY: '1', HTTP_PROXY: proxyURL, http_proxy: proxyURL });
  const script = `
    import { createLocalChatReviewerAdapter } from ${JSON.stringify(adapterURL)};
    const reviewer = createLocalChatReviewerAdapter({ destination: 'LOOPBACK_HTTP', endpoint: ${JSON.stringify(model.url)},
      model: 'review-model', id: 'env.reviewer', timeoutMs: 20000 });
    const result = await reviewer.review(${JSON.stringify(payload())})
      .then(value => ({ status: value.status, summary: value.evidence.summary }), error => ({ code: error.code }));
    // Control: the global fetch in this same process honors the environment proxy when Node supports it.
    let control;
    try { control = (await fetch(${JSON.stringify(`http://127.0.0.1:${probe.port}/probe`)}, { signal: AbortSignal.timeout(20000) })).status; }
    catch { control = 'failed'; }
    console.log(JSON.stringify({ result, control }));`;
  try {
    const output = JSON.parse((await runNode(script, env)).trim().split('\n').at(-1));
    assert.deepEqual(output.result, { status: 'PASS', summary: 'direct' });
    assert.equal(model.requests.length, 1);
    assert.deepEqual(proxyLog.filter(line => line.includes(`:${model.port}`)), []);
    if (!proxyLog.some(line => line.includes(`:${probe.port}`))) {
      t.skip('this Node version ignores NODE_USE_ENV_PROXY, so the proxied case was not exercised');
    } else {
      assert.equal(output.control, 'failed');
      assert.equal(probe.requests.length, 0);
    }
  } finally { await Promise.all([model.close(), probe.close(), new Promise(resolve => proxy.close(resolve))]); }
});

test('other statuses keep their HTTP status, expose no body and never follow a redirect', async () => {
  const target = await serve((request, response) => response.end(reply('redirected')));
  // An endpoint may not carry a query, so each status has its own path. 600 cannot form a Response.
  // The 503 body never ends, so only the transport's own destroy can release that connection.
  const model = await serve((request, response) => {
    const status = Number(request.url.split('/').at(-1));
    response.writeHead(status, [301, 302, 303, 307, 308].includes(status) ? { location: target.url } : {});
    if (status === 503) response.write('x'.repeat(4096));
    else response.end([204, 205, 304].includes(status) ? undefined : reply('not read'));
  });
  try {
    for (const [status, httpStatus] of [[204, 204], [205, 205], [304, 304], [302, 302], [307, 307], [400, 400], [404, 404], [500, 500], [503, 503], [600, null]]) {
      const adapter = reviewer(`http://127.0.0.1:${model.port}/status/${status}`);
      await rejectsCode(() => adapter.review(payload()), 'LOCAL_CHAT_RESPONSE_UNAVAILABLE');
      const receipt = adapter.receipts().at(-1);
      assert.equal(receipt.code, 'LOCAL_CHAT_RESPONSE_UNAVAILABLE', String(status));
      assert.equal(receipt.httpStatus, httpStatus, String(status));
      assert.equal(receipt.responseSha256, null, String(status));
      await model.idle();
    }
    assert.equal(target.requests.length, 0);
  } finally { await Promise.all([model.close(), target.close()]); }
});

test('refused, reset and truncated connections are LOCAL_CHAT_UNAVAILABLE and oversized bodies are cancelled', async () => {
  const model = await serve((request, response) => {
    const mode = request.url.split('/').at(-1);
    if (mode === 'drop') request.socket.destroy();
    else if (mode === 'truncate') { response.writeHead(200, { 'content-length': '1000' }); response.write('{"model":', () => request.socket.end()); }
    else { response.writeHead(200); response.write('x'.repeat(4096)); }
  });
  try {
    for (const [mode, code, httpStatus] of [['drop', 'LOCAL_CHAT_UNAVAILABLE', null], ['truncate', 'LOCAL_CHAT_UNAVAILABLE', 200],
      ['large', 'LOCAL_CHAT_RESPONSE_TOO_LARGE', 200]]) {
      const adapter = reviewer(`http://127.0.0.1:${model.port}/mode/${mode}`, { maxResponseBytes: 256 });
      await rejectsCode(() => adapter.review(payload()), code);
      assert.equal(adapter.receipts().at(-1).code, code, mode);
      assert.equal(adapter.receipts().at(-1).httpStatus, httpStatus, mode);
      await model.idle();
    }
  } finally { await model.close(); }
});

test('abort during the response body and a timeout before headers release the connection', async () => {
  const model = await serve((request, response) => {
    if (request.url.endsWith('/partial')) { response.writeHead(200, { 'content-type': 'application/json' }); response.write('{"model":'); }
  });
  const controller = new AbortController();
  let received = null;
  // Published once response headers are parsed; the abort waits one turn so reading has begun.
  const onResponse = ({ response }) => { received = response; setImmediate(() => controller.abort()); };
  subscribe('http.client.response.finish', onResponse);
  try {
    const aborted = reviewer(`http://127.0.0.1:${model.port}/partial`);
    await rejectsCode(() => aborted.review(payload({ signal: controller.signal })), 'ABORTED');
    unsubscribe('http.client.response.finish', onResponse);
    assert.equal(aborted.receipts().at(-1).code, 'ABORTED');
    assert.equal(aborted.receipts().at(-1).httpStatus, 200);
    await model.idle();
    assert.equal(received.destroyed, true);
    const slow = reviewer(`http://127.0.0.1:${model.port}/silent`, { timeoutMs: 100 });
    await rejectsCode(() => slow.review(payload()), 'LOCAL_CHAT_TIMEOUT');
    assert.equal(slow.receipts().at(-1).code, 'LOCAL_CHAT_TIMEOUT');
    assert.equal(slow.receipts().at(-1).httpStatus, null);
    await model.idle();
    assert.equal(model.requests.length, 2);
  } finally { unsubscribe('http.client.response.finish', onResponse); await model.close(); }
});

const ipv6 = await new Promise(resolve => {
  const server = http.createServer();
  server.once('error', () => resolve(false));
  server.listen(0, '::1', () => server.close(() => resolve(true)));
});

test('default transport reaches an IPv6 loopback endpoint', { skip: ipv6 ? false : 'IPv6 loopback is unavailable on this host' }, async () => {
  const model = await serve((request, response) => response.end(reply('ipv6')), '::1');
  try {
    const result = await reviewer(model.url).review(payload());
    assert.equal(result.evidence.summary, 'ipv6');
    assert.equal(model.requests[0].headers.host, `[::1]:${model.port}`);
  } finally { await model.close(); }
});
