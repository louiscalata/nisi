// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
// The default transport talks to a real loopback HTTP server (no injected fetch).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createLocalChatAuthorAdapter, createLocalChatReviewerAdapter } from '../adapters/local-chat.mjs';

const task = { taskId: 'transport', mode: 'edit', language: 'json', allowedFiles: ['answer.json'], protectedFiles: [], protectedSnapshots: {},
  acceptanceCriteria: ['Return {"answer": 1}.'], policy: { repairBudget: 1, totalDeadlineMs: 5000, requiredReviewers: 1, requireReportStore: false } };
const binding = { schemaVersion: 1, runId: 'run', taskFingerprint: 'a'.repeat(64), attempt: 0, candidateFingerprint: null };
const draftPayload = () => ({ task, candidate: null, acceptanceCriteria: task.acceptanceCriteria, binding });
const completion = model => JSON.stringify({ model, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ candidate: { files: [{ path: 'answer.json', content: '{"answer":1}' }] }, note: 'ok' }) } }], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } });

async function serve(handler, host = '127.0.0.1') {
  const seen = [];
  const server = http.createServer((req, res) => { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => { seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') }); handler(req, res, seen.at(-1)); }); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, host, resolve); });
  const origin = host === '::1' ? `http://[::1]:${server.address().port}` : `http://127.0.0.1:${server.address().port}`;
  return { seen, origin, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}
const author = (origin, extra = {}) => createLocalChatAuthorAdapter({ destination: 'LOOPBACK_HTTP', endpoint: `${origin}/v1/chat/completions`, model: 'm', id: 'author', ...extra });

test('the default transport sends the documented request and returns the adapter result', async () => {
  const s = await serve((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(completion('m')); });
  try {
    const adapter = author(s.origin);
    const result = await adapter.draft(draftPayload());
    assert.equal(result.evidence.note, 'ok');
    const [seen] = s.seen;
    assert.equal(seen.method, 'POST');
    assert.equal(seen.url, '/v1/chat/completions');
    assert.equal(seen.headers['content-type'], 'application/json');
    assert.equal(seen.headers.accept, 'application/json');
    assert.equal(Number(seen.headers['content-length']), Buffer.byteLength(seen.body));
    assert.equal(JSON.parse(seen.body).model, 'm');
    assert.equal(adapter.receipts()[0].usage.totalTokens, 7);
  } finally { await s.close(); }
});

test('a slow server is waited for, up to timeoutMs', async () => {
  const s = await serve((req, res) => setTimeout(() => { res.writeHead(200); res.end(completion('m')); }, 1500));
  try {
    const started = Date.now();
    const result = await author(s.origin, { timeoutMs: 10_000 }).draft(draftPayload());
    assert.equal(result.evidence.note, 'ok');
    assert.ok(Date.now() - started >= 1400);
  } finally { await s.close(); }
});

test('a server that never answers is cut off at timeoutMs, and the caller signal aborts mid-flight', async () => {
  const s = await serve(() => {});
  try {
    const started = Date.now();
    await assert.rejects(() => author(s.origin, { timeoutMs: 1000 }).draft(draftPayload()), { code: 'LOCAL_CHAT_TIMEOUT' });
    assert.ok(Date.now() - started < 4000);
    const controller = new AbortController();
    const pending = author(s.origin, { timeoutMs: 30_000 }).draft({ ...draftPayload(), signal: controller.signal });
    setTimeout(() => controller.abort(), 300);
    await assert.rejects(() => pending, { code: 'ABORTED' });
  } finally { await s.close(); }
});

test('non-2xx statuses, redirects and oversized bodies are refused', async () => {
  const modes = { 500: (req, res) => { res.writeHead(500); res.end('boom'); },
    302: (req, res) => { res.writeHead(302, { location: 'http://127.0.0.1:9/elsewhere' }); res.end(); },
    big: (req, res) => { res.writeHead(200); res.end(`{"model":"m","pad":"${'x'.repeat(5000)}"}`); } };
  for (const [name, handler] of Object.entries(modes)) {
    const s = await serve(handler);
    try {
      const adapter = createLocalChatReviewerAdapter({ destination: 'LOOPBACK_HTTP', endpoint: `${s.origin}/chat`, model: 'm', id: 'reviewer', maxResponseBytes: 1024 });
      await assert.rejects(() => adapter.review({ task, candidate: null, acceptanceCriteria: task.acceptanceCriteria, binding }),
        { code: name === 'big' ? 'LOCAL_CHAT_RESPONSE_TOO_LARGE' : 'LOCAL_CHAT_RESPONSE_UNAVAILABLE' });
      if (name === '302') assert.equal(s.seen.length, 1);
    } finally { await s.close(); }
  }
});

test('socket failures are reported as LOCAL_CHAT_UNAVAILABLE, never as raw Node error codes', async () => {
  // Refused connection: bind a port, then close it so nothing listens there.
  const probe = await serve(() => {});
  const closedOrigin = probe.origin;
  await probe.close();
  const refused = author(closedOrigin, { timeoutMs: 5000 });
  await assert.rejects(() => refused.draft(draftPayload()), { code: 'LOCAL_CHAT_UNAVAILABLE' });
  assert.equal(refused.receipts().at(-1).code, 'LOCAL_CHAT_UNAVAILABLE');
  // A server that sends part of the body and drops the connection.
  const s = await serve((req, res) => { res.writeHead(200, { 'content-length': '1000' }); res.write('{"model"'); setTimeout(() => res.socket.destroy(), 50); });
  try {
    const adapter = author(s.origin, { timeoutMs: 5000 });
    await assert.rejects(() => adapter.draft(draftPayload()), { code: 'LOCAL_CHAT_UNAVAILABLE' });
    assert.equal(adapter.receipts().at(-1).code, 'LOCAL_CHAT_UNAVAILABLE');
  } finally { await s.close(); }
});

test('statuses that carry no body are refused as LOCAL_CHAT_RESPONSE_UNAVAILABLE', async () => {
  for (const status of [204, 205, 304, 404]) {
    const s = await serve((req, res) => { res.writeHead(status); res.end(); });
    try { await assert.rejects(() => author(s.origin, { timeoutMs: 5000 }).draft(draftPayload()), { code: 'LOCAL_CHAT_RESPONSE_UNAVAILABLE' }, String(status)); }
    finally { await s.close(); }
  }
});

test('the socket is closed when the call times out or is aborted', async () => {
  const closed = [];
  const s = await serve((req, res) => { res.writeHead(200); res.write('{"model"'); req.socket.on('close', () => closed.push('closed')); });
  const until = async count => { for (let i = 0; i < 40 && closed.length < count; i += 1) await new Promise(r => setTimeout(r, 50)); };
  try {
    await assert.rejects(() => author(s.origin, { timeoutMs: 1000 }).draft(draftPayload()), { code: 'LOCAL_CHAT_TIMEOUT' });
    await until(1);
    assert.equal(closed.length, 1, 'timeout must close the socket');
    const controller = new AbortController();
    const pending = author(s.origin, { timeoutMs: 30_000 }).draft({ ...draftPayload(), signal: controller.signal });
    setTimeout(() => controller.abort(), 300);
    await assert.rejects(() => pending, { code: 'ABORTED' });
    await until(2);
    assert.equal(closed.length, 2, 'abort must close the socket');
  } finally { await s.close(); }
});

test('the IPv6 loopback address works when the host supports it', async t => {
  let s;
  try { s = await serve((req, res) => { res.writeHead(200); res.end(completion('m')); }, '::1'); } catch { t.skip('no IPv6 loopback on this host'); return; }
  try { assert.equal((await author(s.origin).draft(draftPayload())).evidence.note, 'ok'); }
  finally { await s.close(); }
});

test('the five-minute fetch cap is not in the default transport', async () => {
  // Node's global fetch (undici) ends a request without response headers after 300 s.
  // The default transport must not be fetch, so a longer timeoutMs is honoured.
  const { default: source } = await import('node:fs').then(fs => ({ default: fs.readFileSync(new URL('../adapters/local-chat.mjs', import.meta.url), 'utf8') }));
  assert.doesNotMatch(source, /input\.fetch \?\? globalThis\.fetch/u);
  assert.match(source, /input\.fetch \?\? loopbackFetch/u);
});
