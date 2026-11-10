// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
// The default Jev transport builds a fixed https.request. Tests point that request
// function at a local HTTP server so nothing is sent to api.typesafe.ai.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createJevJudge } from '../adapters/jev-client.mjs';

const KEY = 'nisi-test-key';
const call = judge => judge({ state: { task: { taskId: 't' } }, questions: { q: { type: 'noul', instructions: 'Is it true?' } } });
const okBody = JSON.stringify({ model: 'jev-1.14.0', answers: { q: { noul: 0.25 } } });

function serve(handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
      handler(req, res, seen.at(-1));
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const request = (options, callback) => {
        assert.equal(options.host, 'api.typesafe.ai');
        assert.equal(options.port, 443);
        assert.equal(options.servername, 'api.typesafe.ai');
        assert.equal(options.path, '/v1/systemone');
        assert.equal(options.method, 'POST');
        const { host, port: fixedPort, servername, ...rest } = options;
        void host; void fixedPort; void servername;
        return http.request({ ...rest, host: '127.0.0.1', port }, callback);
      };
      resolve({ seen, port, request, close: () => new Promise(done => { server.closeAllConnections(); server.close(done); }) });
    });
  });
}

test('the default transport is node:https to the fixed host, not global fetch', () => {
  const source = fs.readFileSync(new URL('../adapters/jev-client.mjs', import.meta.url), 'utf8');
  assert.match(source, /import https from 'node:https'/u);
  assert.match(source, /requestImpl = https\.request/u);
  assert.doesNotMatch(source, /globalThis\.fetch/u);
  assert.doesNotMatch(source, /timeoutMs > 300_000/u);
});

test('a timeout above five minutes is accepted and the call waits for the body', async () => {
  const saved = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = () => { fetches += 1; throw new Error('global fetch must not be used'); };
  const s = await serve((req, res) => setTimeout(() => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(okBody); }, 300));
  try {
    const started = Date.now();
    const judge = createJevJudge({ apiKey: KEY, timeoutMs: 301_000, request: s.request });
    const out = await call(judge);
    assert.deepEqual(out, { model: 'jev-1.14.0', answers: { q: { noul: 0.25 } } });
    assert.ok(Date.now() - started >= 250);
    assert.ok(Date.now() - started < 5000);
    assert.equal(fetches, 0);
    const [seen] = s.seen;
    assert.equal(seen.method, 'POST');
    assert.equal(seen.url, '/v1/systemone');
    assert.equal(seen.headers.authorization, `Bearer ${KEY}`);
    assert.equal(seen.headers.accept, 'application/json');
    assert.equal(Number(seen.headers['content-length']), Buffer.byteLength(seen.body));
    assert.equal(JSON.parse(seen.body).model, 'jev-latest');
    assert.deepEqual(Object.keys(JSON.parse(seen.body)).sort(), ['model', 'questions', 'state']);
  } finally { globalThis.fetch = saved; await s.close(); }
});

test('a server that never answers is cut off at timeoutMs and the socket closes', async () => {
  const closed = [];
  const s = await serve(req => { req.socket.on('close', () => closed.push('closed')); });
  try {
    const started = Date.now();
    const judge = createJevJudge({ apiKey: KEY, timeoutMs: 1000, request: s.request });
    await assert.rejects(() => call(judge), error => {
      assert.equal(error.code, 'JEV_TIMEOUT');
      assert.equal(error.message, 'JEV_TIMEOUT');
      assert.ok(!error.message.includes(KEY));
      return true;
    });
    assert.ok(Date.now() - started < 4000);
    for (let i = 0; i < 40 && closed.length < 1; i += 1) await new Promise(r => setTimeout(r, 50));
    assert.equal(closed.length, 1);
  } finally { await s.close(); }
});

test('redirects are not followed, and error text omits the key and the response body', async () => {
  const cases = [
    [(req, res) => { res.writeHead(302, { location: 'https://evil.example/steal' }); res.end(KEY); }, 'JEV_HTTP_ERROR'],
    [(req, res) => { res.writeHead(401); res.end(KEY); }, 'JEV_AUTH_FAILED'],
    [(req, res) => { res.writeHead(500); res.end(`secret ${KEY}`); }, 'JEV_HTTP_ERROR'],
    [(req, res) => { res.writeHead(200); res.end(`{"model":"m","answers":{},"pad":"${'x'.repeat(1_100_000)}"}`); }, 'JEV_RESPONSE_TOO_LARGE'],
  ];
  for (const [handler, code] of cases) {
    const s = await serve(handler);
    try {
      const judge = createJevJudge({ apiKey: KEY, request: s.request });
      await assert.rejects(() => call(judge), error => {
        assert.equal(error.code, code);
        assert.equal(error.message, code);
        assert.ok(!error.message.includes(KEY) && !error.message.includes('evil.example'));
        return true;
      });
      assert.equal(s.seen.length, 1);
      assert.equal(s.seen[0].url, '/v1/systemone');
    } finally { await s.close(); }
  }
});

test('a refused connection is JEV_UNAVAILABLE and does not include the key', async () => {
  const gate = http.createServer();
  await new Promise((resolve, reject) => { gate.once('error', reject); gate.listen(0, '127.0.0.1', resolve); });
  const port = gate.address().port;
  await new Promise(resolve => gate.close(resolve));
  const request = (options, callback) => {
    assert.equal(options.host, 'api.typesafe.ai');
    assert.equal(options.path, '/v1/systemone');
    return http.request({ host: '127.0.0.1', port, method: 'POST', path: options.path, signal: options.signal, headers: options.headers }, callback);
  };
  const judge = createJevJudge({ apiKey: KEY, timeoutMs: 5000, request });
  await assert.rejects(() => call(judge), error => {
    assert.equal(error.code, 'JEV_UNAVAILABLE');
    assert.equal(error.message, 'JEV_UNAVAILABLE');
    assert.ok(!String(error.cause ?? '').includes(KEY) && !error.message.includes(KEY));
    return true;
  });
});
