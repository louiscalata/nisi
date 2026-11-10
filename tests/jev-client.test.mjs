// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createJevJudge, JEV_API_KEY_ENV } from '../adapters/jev-client.mjs';
import { planWithJev, createJevReviewer } from '../adapters/jev-advisor.mjs';

const KEY = 'tsk_test_0123456789abcdef';
const task = { taskId: 'jev.client', mode: 'edit', language: 'json', allowedFiles: ['answer.json'], protectedFiles: [], protectedSnapshots: {},
  acceptanceCriteria: ['Return {"answer": 391} for 17*23.'], policy: { repairBudget: 1, totalDeadlineMs: 5000, requiredReviewers: 1, requireReportStore: false } };

function reply(value, { status = 200, chunks = 1 } = {}) {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
  const size = Math.max(1, Math.ceil(bytes.length / chunks));
  return { ok: status >= 200 && status < 300, status, body: { getReader() { let offset = 0;
    return { async read() { if (offset >= bytes.length) return { done: true }; const value = bytes.slice(offset, offset += size); return { done: false, value }; },
      cancel() { return Promise.resolve(); }, releaseLock() {} }; } } };
}
const answersFor = questions => Object.fromEntries(Object.entries(questions).map(([k, q]) => [k, q.type === 'choice' ? { choice: Object.keys(q.criteria)[0], confidence: 0.9 } : { noul: 0.25 }]));
function server(options = {}) {
  const seen = [];
  const fetch = async (url, request) => { seen.push({ url, request, body: JSON.parse(request.body) });
    if (options.respond) return options.respond(url, request);
    const { questions } = JSON.parse(request.body); return reply({ model: 'jev-1.14.0', answers: answersFor(questions), usage: { input_tokens: 7 } }); };
  return { fetch, seen };
}
const call = (judge, extra = {}) => judge({ state: { task: { taskId: 't' }, ...extra }, questions: { q: { type: 'noul', instructions: 'Is it true?' } } });

test('sends one bounded POST to the fixed endpoint with a Bearer key and returns model and answers', async () => {
  const s = server();
  const judge = createJevJudge({ apiKey: KEY, fetch: s.fetch });
  const out = await call(judge);
  assert.deepEqual(out, { model: 'jev-1.14.0', answers: { q: { noul: 0.25 } } });
  const [seen] = s.seen;
  assert.equal(seen.url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(seen.request.method, 'POST');
  assert.equal(seen.request.redirect, 'error');
  assert.equal(seen.request.headers.authorization, `Bearer ${KEY}`);
  assert.equal(seen.request.headers['content-type'], 'application/json');
  assert.deepEqual(Object.keys(seen.body).sort(), ['model', 'questions', 'state']);
  assert.equal(seen.body.model, 'jev-latest');
  const pinned = createJevJudge({ apiKey: KEY, model: 'jev-1.14.0', fetch: s.fetch });
  await call(pinned);
  assert.equal(s.seen[1].body.model, 'jev-1.14.0');
});

test('the key comes from the argument or TYPESAFE_API_KEY and is validated', () => {
  const saved = process.env[JEV_API_KEY_ENV];
  try {
    delete process.env[JEV_API_KEY_ENV];
    assert.throws(() => createJevJudge({}), { code: 'JEV_API_KEY_REQUIRED' });
    process.env[JEV_API_KEY_ENV] = KEY;
    assert.equal(typeof createJevJudge({ fetch: async () => reply({}) }), 'function');
    for (const bad of ['', 'has space', 'new\nline', 'x'.repeat(513), 'é']) {
      assert.throws(() => createJevJudge({ apiKey: bad }), { code: bad === '' ? 'JEV_API_KEY_REQUIRED' : 'JEV_API_KEY_INVALID' });
    }
  } finally { if (saved === undefined) delete process.env[JEV_API_KEY_ENV]; else process.env[JEV_API_KEY_ENV] = saved; }
  for (const bad of ['Jev', 'a b', '', 7]) assert.throws(() => createJevJudge({ apiKey: KEY, model: bad }), { code: 'JEV_MODEL_INVALID' });
  assert.equal(typeof createJevJudge({ apiKey: KEY, timeoutMs: 301_000, fetch: async () => reply({}) }), 'function');
  assert.equal(typeof createJevJudge({ apiKey: KEY, timeoutMs: 86_400_000, fetch: async () => reply({}) }), 'function');
  for (const bad of [10, 0.5, 999, 86_400_001]) assert.throws(() => createJevJudge({ apiKey: KEY, timeoutMs: bad }), { code: 'JEV_TIMEOUT_INVALID' });
  assert.throws(() => createJevJudge({ apiKey: KEY, fetch: 1 }), { code: 'JEV_UNAVAILABLE' });
  assert.throws(() => createJevJudge({ apiKey: KEY, request: 1 }), { code: 'JEV_UNAVAILABLE' });
});

test('failures map to named codes and never expose the key or the response body', async () => {
  const cases = [
    [() => reply('secret body', { status: 401 }), 'JEV_AUTH_FAILED'], [() => reply('x', { status: 403 }), 'JEV_AUTH_FAILED'],
    [() => reply('x', { status: 429 }), 'JEV_RATE_LIMITED'], [() => reply('x', { status: 500 }), 'JEV_HTTP_ERROR'],
    [() => reply('not json'), 'JEV_RESPONSE_INVALID'], [() => reply({ model: 'm' }), 'JEV_RESPONSE_INVALID'],
    [() => reply({ model: 7, answers: {} }), 'JEV_RESPONSE_INVALID'],
    [() => reply(`{"model":"m","answers":{},"pad":"${'x'.repeat(1_100_000)}"}`, { chunks: 40 }), 'JEV_RESPONSE_TOO_LARGE'],
    [() => { throw new TypeError(`fetch failed for ${KEY}`); }, 'JEV_UNAVAILABLE'],
  ];
  for (const [respond, code] of cases) {
    const judge = createJevJudge({ apiKey: KEY, fetch: server({ respond }).fetch });
    await assert.rejects(() => call(judge), error => {
      assert.equal(error.code, code);
      assert.ok(!error.message.includes(KEY) && !error.message.includes('secret body'), 'message must not leak');
      return true;
    });
  }
  const judge = createJevJudge({ apiKey: KEY, fetch: server().fetch });
  await assert.rejects(() => judge({ state: {}, questions: {} }), { code: 'JEV_REQUEST_INVALID' });
  await assert.rejects(() => judge({ state: 'x', questions: { q: {} } }), { code: 'JEV_REQUEST_INVALID' });
  await assert.rejects(() => call(judge, { big: 'x'.repeat(1_100_000) }), { code: 'JEV_REQUEST_TOO_LARGE' });
});

test('a call that outlives its timeout is aborted and reported as JEV_TIMEOUT', async () => {
  const hang = (_url, request) => new Promise((_, reject) => request.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  const judge = createJevJudge({ apiKey: KEY, timeoutMs: 1000, fetch: hang });
  const started = Date.now();
  await assert.rejects(() => call(judge), { code: 'JEV_TIMEOUT' });
  assert.ok(Date.now() - started < 4000);
});

test('the built-in client runs only with remote: true; the key alone sends nothing', async () => {
  const saved = process.env[JEV_API_KEY_ENV], savedFetch = globalThis.fetch;
  const s = server();
  let globalFetches = 0;
  const notes = [];
  const write = process.stderr.write;
  process.stderr.write = chunk => { notes.push(String(chunk)); return true; };
  try {
    delete process.env[JEV_API_KEY_ENV];
    await assert.rejects(() => planWithJev(task), { code: 'JEV_JUDGE_REQUIRED' });
    await assert.rejects(() => planWithJev(task, { fetch: s.fetch }), { code: 'JEV_JUDGE_REQUIRED' });
    assert.throws(() => createJevReviewer({ id: 'jev.review' }), { code: 'JEV_JUDGE_REQUIRED' });
    assert.throws(() => createJevReviewer({ id: 'jev.review', fetch: s.fetch }), { code: 'JEV_JUDGE_REQUIRED' });
    assert.equal(s.seen.length, 0);
    assert.equal(notes.length, 0);
    process.env[JEV_API_KEY_ENV] = KEY;
    globalThis.fetch = () => { globalFetches += 1; throw new Error('global fetch must not be used'); };
    await assert.rejects(() => planWithJev(task, { fetch: s.fetch }), { code: 'JEV_JUDGE_REQUIRED' });
    assert.throws(() => createJevReviewer({ id: 'jev.review', fetch: s.fetch }), { code: 'JEV_JUDGE_REQUIRED' });
    assert.equal(s.seen.length, 0);
    assert.equal(notes.length, 2);
    assert.ok(notes.every(line => line === 'TYPESAFE_API_KEY is set; pass remote: true or --judge typesafe before any task state is sent. Nothing was sent.\n' && !line.includes(KEY)));
    const plan = await planWithJev(task, { fetch: s.fetch, remote: true });
    assert.equal(plan.plan, 'direct');
    assert.equal(plan.evidence.jevModel, 'jev-1.14.0');
    assert.equal(s.seen[0].url, 'https://api.typesafe.ai/v1/systemone');
    assert.deepEqual(Object.keys(s.seen[0].body.state), ['task']);
    const review = await createJevReviewer({ id: 'jev.review', fetch: s.fetch, remote: true }).review({ task, candidate: { files: [{ path: 'answer.json', content: '{"answer":391}' }] }, tests: { status: 'PASS' }, binding: {} });
    assert.equal(review.status, 'PASS');
    assert.match(review.evidence.summary, /0\.25 \(advisory\)/u);
    // An explicit judge always wins over the environment.
    let explicit = 0;
    await planWithJev(task, { fetch: s.fetch, judge: async request => { explicit += 1; return { model: 'x', answers: answersFor(request.questions) }; } });
    assert.equal(explicit, 1);
    assert.equal(s.seen.length, 2);
    assert.equal(globalFetches, 0);
    assert.equal(notes.length, 2);
    // A bad key is checked only after remote: true, and still before any request.
    process.env[JEV_API_KEY_ENV] = 'bad key';
    await assert.rejects(() => planWithJev(task, { remote: true }), { code: 'JEV_API_KEY_INVALID' });
    assert.equal(s.seen.length, 2);
    assert.equal(notes.length, 2);
  } finally {
    process.stderr.write = write;
    globalThis.fetch = savedFetch;
    if (saved === undefined) delete process.env[JEV_API_KEY_ENV]; else process.env[JEV_API_KEY_ENV] = saved;
  }
});

test('timeoutMs on planWithJev and createJevReviewer reaches the built-in client', async () => {
  const saved = process.env[JEV_API_KEY_ENV];
  process.env[JEV_API_KEY_ENV] = KEY;
  const hang = (_url, request) => new Promise((_, reject) => request.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  const quick = async () => reply({ model: 'jev-1.14.0', answers: { plan: { choice: 'direct' }, underspecified: { noul: 0.1 } } });
  try {
    await planWithJev(task, { fetch: quick, timeoutMs: 301_000, remote: true });
    await assert.rejects(() => planWithJev(task, { fetch: hang, timeoutMs: 86_400_001, remote: true }), { code: 'JEV_TIMEOUT_INVALID' });
    const started = Date.now();
    await assert.rejects(() => planWithJev(task, { fetch: hang, timeoutMs: 1000, remote: true }), { code: 'JEV_TIMEOUT' });
    assert.ok(Date.now() - started < 4000);
    const reviewer = createJevReviewer({ id: 'jev.review', fetch: hang, timeoutMs: 1000, remote: true });
    const startedReview = Date.now();
    const review = await reviewer.review({ task, candidate: { files: [{ path: 'answer.json', content: '{"answer":1}' }] }, tests: { status: 'PASS' }, binding: {} });
    assert.equal(review.status, 'UNAVAILABLE');
    assert.equal(review.evidence.reason, 'JEV_TIMEOUT');
    assert.ok(Date.now() - startedReview < 4000);
    let explicit = 0;
    await planWithJev(task, { fetch: hang, timeoutMs: 1000, judge: async request => { explicit += 1; return { model: 'x', answers: answersFor(request.questions) }; } });
    assert.equal(explicit, 1);
  } finally { if (saved === undefined) delete process.env[JEV_API_KEY_ENV]; else process.env[JEV_API_KEY_ENV] = saved; }
});
