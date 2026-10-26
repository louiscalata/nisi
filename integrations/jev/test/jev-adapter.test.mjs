// SPDX-License-Identifier: Apache-2.0
// Offline deterministic checks for the Jev (TypeSafe System One) integration.
// No network, no real API key: transports are stubbed, and the apiKey used in
// this file is a placeholder value that must never be sent anywhere.

import test from 'node:test';
import assert from 'node:assert/strict';
import { TypeSafeClient, choice, noul, score } from '@typesafe-ai/sdk';
import { createJevEvaluator } from '../src/jev-adapter.mjs';

const expectCode = code => error => { assert.equal(error?.code, code); return true; };

function stubFetch(captured, payload) {
  return async (url, init) => {
    captured.url = url;
    captured.init = init;
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}
const wireBody = captured => (
  typeof captured.init?.body === 'string' ? JSON.parse(captured.init.body) : captured.init?.body
);

const noulAnswer = v => ({ noul: v, type: 'noul' });
const choiceAnswer = (label, probabilities, confidence = 1) => ({ choice: label, probabilities, confidence, type: 'choice' });

test('the installed SDK imports offline and exposes the client and question builders', () => {
  assert.equal(typeof TypeSafeClient, 'function');
  assert.equal(typeof choice, 'function');
  assert.equal(typeof noul, 'function');
  assert.equal(typeof score, 'function');
  assert.equal(noul('Is the candidate valid?').type, 'noul');
  assert.equal(choice('Which kind?', { billing: null, technical: null, other: null }).type, 'choice');
  assert.equal(score('Rate quality', ['poor', 'fair', 'good']).type, 'score');
});

test('config rejects unknown keys and invalid id, model, timeout, fetch, and apiKey values', () => {
  assert.throws(() => createJevEvaluator(42), expectCode('JEV_CONFIG_INVALID'));
  assert.throws(() => createJevEvaluator({ id: 'ok', extra: true }), expectCode('JEV_CONFIG_INVALID'));
  assert.throws(() => createJevEvaluator({ id: 'BAD ID!' }), expectCode('JEV_ID_INVALID'));
  assert.throws(() => createJevEvaluator({ id: 'ok', model: ' ' }), expectCode('JEV_MODEL_INVALID'));
  assert.throws(() => createJevEvaluator({ id: 'ok', model: 'jev-latest' }), expectCode('JEV_MODEL_INVALID'));
  assert.throws(() => createJevEvaluator({ id: 'ok', model: 'jev-1.14.0', timeoutMs: 0 }), expectCode('JEV_TIMEOUT_INVALID'));
  assert.throws(() => createJevEvaluator({ id: 'ok', model: 'jev-1.14.0', timeoutMs: 61_000 }), expectCode('JEV_TIMEOUT_INVALID'));
  assert.throws(() => createJevEvaluator({ id: 'ok', fetch: 'nope' }), expectCode('JEV_FETCH_INVALID'));
  assert.throws(() => createJevEvaluator({ id: 'ok', apiKey: '' }), expectCode('JEV_API_KEY_INVALID'));
  assert.ok(createJevEvaluator({ id: 'ok' }));
});

test('evaluate fails fast with JEV_API_KEY_MISSING when no key is configured and env is unset', async () => {
  const previous = process.env.TYPESAFE_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  try {
    const evaluator = createJevEvaluator({ id: 'jev-no-key' });
    await assert.rejects(
      () => evaluator.evaluate({ state: 'sample', questions: { ok: noul('Ok?') } }),
      expectCode('JEV_API_KEY_MISSING'),
    );
    assert.equal(evaluator.lifecycle().state, 'IDLE');
  } finally {
    if (previous !== undefined) process.env.TYPESAFE_API_KEY = previous;
  }
});

test('evaluate rejects malformed payloads before any transport', async () => {
  const evaluator = createJevEvaluator({ id: 'jev-payload', apiKey: 'test-key' });
  await assert.rejects(() => evaluator.evaluate(null), expectCode('JEV_PAYLOAD_INVALID'));
  await assert.rejects(() => evaluator.evaluate({ state: 42, questions: { a: noul('a') } }), expectCode('JEV_STATE_INVALID'));
  await assert.rejects(() => evaluator.evaluate({ state: 'x', questions: {} }), expectCode('JEV_QUESTIONS_INVALID'));
  await assert.rejects(() => evaluator.evaluate({ state: 'x', questions: { a: 'not-a-question' } }), expectCode('JEV_QUESTIONS_INVALID'));
});

test('evaluate returns validated answers and receipts through a stubbed transport (no network)', async () => {
  const captured = {};
  const responseBody = {
    answers: {
      ok: noulAnswer(0.95),
      kind: choiceAnswer('billing', { billing: 0.8, technical: 0.15, other: 0.05 }, 0.8),
    },
    model: 'jev-1.14.0',
    usage: { input_tokens: 12, output_tokens: 5 },
  };
  const evaluator = createJevEvaluator({ id: 'jev-e2e', apiKey: 'test-key', fetch: stubFetch(captured, responseBody) });
  const result = await evaluator.evaluate({
    state: { document: 'Charged twice; please fix.' },
    questions: {
      ok: noul('Is the document about billing?'),
      kind: choice('Which category?', { billing: null, technical: null, other: null }),
    },
  });
  assert.equal(result.model, 'jev-1.14.0');
  assert.equal(result.answers.ok.noul, 0.95);
  assert.equal(result.answers.kind.choice, 'billing');
  assert.equal(result.answers.kind.confidence, 0.8);
  assert.equal(result.usage.inputTokens, 12);
  assert.equal(result.usage.outputTokens, 5);
  assert.match(result.evidence.requestSha256, /^[0-9a-f]{64}$/);

  // Wire-contract assertions on the documented SystemOne request fields.
  const wire = wireBody(captured);
  assert.equal(wire.model, 'jev-1.14.0');
  assert.deepEqual(wire.state, { document: 'Charged twice; please fix.' });
  assert.equal(wire.questions.ok.type, 'noul');
  assert.equal(wire.questions.kind.type, 'choice');

  const receipts = evaluator.receipts();
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].status, 'RESPONSE_VALIDATED');
  assert.equal(receipts[0].adapterId, 'jev-e2e');
  assert.equal(receipts[0].requestedModel, 'jev-1.14.0');
  assert.equal(receipts[0].reportedModel, 'jev-1.14.0');
  assert.equal(receipts[0].usage.inputTokens, 12);
  assert.match(receipts[0].responseSha256, /^[0-9a-f]{64}$/);
});

test('evaluate resolves the API key from the environment and never leaks it', async () => {
  const previous = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = 'env-key-for-test';
  const captured = {};
  try {
    const evaluator = createJevEvaluator({
      id: 'jev-env',
      fetch: stubFetch(captured, { answers: { ok: noulAnswer(0.9) }, model: 'jev-1.14.0', usage: { input_tokens: 3, output_tokens: 1 } }),
    });
    await evaluator.evaluate({ state: 'x', questions: { ok: noul('Ok?') } });
    const headers = captured.init?.headers;
    const authorization = typeof headers?.get === 'function'
      ? headers.get('authorization')
      : new Headers(headers ?? {}).get('authorization');
    assert.ok(typeof authorization === 'string' && authorization.startsWith('Bearer '));
    assert.ok(authorization.length > 'Bearer '.length);
    // The key must never appear in receipts, evidence, or any produced artifact.
    assert.ok(!JSON.stringify(evaluator.receipts()).includes('env-key-for-test'));
  } finally {
    if (previous !== undefined) process.env.TYPESAFE_API_KEY = previous; else delete process.env.TYPESAFE_API_KEY;
  }
});

test('evaluate rejects invalid usage metadata', async () => {
  const body = { answers: { ok: noulAnswer(0.5) }, model: 'jev-1.14.0', usage: { input_tokens: -1, output_tokens: 1 } };
  const evaluator = createJevEvaluator({ id: 'jev-usage', apiKey: 'test-key', fetch: stubFetch({}, body) });
  await assert.rejects(() => evaluator.evaluate({ state: 'x', questions: { ok: noul('Ok?') } }), expectCode('JEV_USAGE_INVALID'));
});

test('evaluate rejects a response without answers or model', async () => {
  const body = { answers: {}, model: 'jev-1.14.0' };
  const evaluator = createJevEvaluator({ id: 'jev-resp', apiKey: 'test-key', fetch: stubFetch({}, body) });
  await assert.rejects(() => evaluator.evaluate({ state: 'x', questions: { ok: noul('Ok?') } }), expectCode('JEV_RESPONSE_INVALID'));
});

test('stop() prevents further evaluations', async () => {
  const evaluator = createJevEvaluator({ id: 'jev-stop', apiKey: 'test-key' });
  assert.equal(evaluator.lifecycle().state, 'IDLE');
  evaluator.stop();
  assert.equal(evaluator.lifecycle().state, 'STOPPED');
  await assert.rejects(() => evaluator.evaluate({ state: 'x', questions: { ok: noul('Ok?') } }), expectCode('JEV_OWNER_STOPPED'));
});
