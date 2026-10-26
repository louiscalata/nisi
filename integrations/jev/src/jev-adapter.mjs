// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
// TypeSafe Jev (System One) side-by-side integration for Nisi.
// Advisory only: a response that passes the adapter schema is NOT acceptance.
// Live calls require explicit host authorization; offline tests inject transport.
// The API key is read from the process environment only; it is never accepted
// from task text, never written to a file, and never echoed.

import { TypeSafeClient } from '@typesafe-ai/sdk';
import { cloneFreeze, sha256Text, stableStringify } from '../../../workflow/contracts.mjs';

export { choice, noul, score } from '@typesafe-ai/sdk';

const DEFAULT_MODEL = 'jev-1.14.0';
const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 60_000;
const MAX_QUESTIONS = 128;

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message = code) => { const error = new Error(message); error.code = code; throw error; };

function config(input) {
  if (!isRecord(input)) fail('JEV_CONFIG_INVALID');
  const keys = ['id', 'model', 'timeoutMs', 'apiKey', 'fetch'];
  if (Reflect.ownKeys(input).some(key => !keys.includes(key))) fail('JEV_CONFIG_INVALID');
  if (typeof input.id !== 'string' || !/^[a-z][a-z0-9_.-]{0,95}$/u.test(input.id)) fail('JEV_ID_INVALID');
  const model = input.model ?? DEFAULT_MODEL;
  if (model !== DEFAULT_MODEL) fail('JEV_MODEL_INVALID');
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) fail('JEV_TIMEOUT_INVALID');
  if (input.apiKey !== undefined && (typeof input.apiKey !== 'string' || input.apiKey.trim() === '')) fail('JEV_API_KEY_INVALID');
  if (input.fetch !== undefined && typeof input.fetch !== 'function') fail('JEV_FETCH_INVALID');
  return Object.freeze({
    id: input.id,
    model,
    timeoutMs,
    apiKey: input.apiKey ?? null,
    fetch: input.fetch ?? null,
  });
}

function resolveApiKey(state) {
  if (state.apiKey !== null) return state.apiKey;
  const env = process.env.TYPESAFE_API_KEY;
  return typeof env === 'string' && env.trim() !== '' ? env : null;
}

function validatePayload(payload) {
  if (!isRecord(payload)) fail('JEV_PAYLOAD_INVALID');
  const keys = ['state', 'questions'];
  if (Reflect.ownKeys(payload).some(key => !keys.includes(key))) fail('JEV_PAYLOAD_INVALID');
  const { state, questions } = payload;
  // EntryType: text, a JSON object or array, or null to evaluate.
  if (!(state === null || typeof state === 'string' || Array.isArray(state) || isRecord(state))) fail('JEV_STATE_INVALID');
  if (!isRecord(questions) || Reflect.ownKeys(questions).length === 0) fail('JEV_QUESTIONS_INVALID');
  if (Reflect.ownKeys(questions).length > MAX_QUESTIONS) fail('JEV_QUESTIONS_INVALID');
  for (const question of Object.values(questions)) {
    if (!isRecord(question)) fail('JEV_QUESTIONS_INVALID');
  }
  return { state, questions };
}

function validateUsage(usage) {
  if (usage === null || usage === undefined) return null;
  if (!isRecord(usage)) fail('JEV_USAGE_INVALID');
  const inputTokens = usage.input_tokens;
  const outputTokens = usage.output_tokens;
  if (!Number.isSafeInteger(inputTokens) || inputTokens < 0 || !Number.isSafeInteger(outputTokens) || outputTokens < 0) {
    fail('JEV_USAGE_INVALID');
  }
  return Object.freeze({ inputTokens, outputTokens });
}

function validateResponse(response) {
  if (!isRecord(response)) fail('JEV_RESPONSE_INVALID');
  if (typeof response.model !== 'string' || response.model.trim() === '') fail('JEV_RESPONSE_INVALID');
  const answers = response.answers;
  if (!isRecord(answers) || Reflect.ownKeys(answers).length === 0) fail('JEV_RESPONSE_INVALID');
  for (const answer of Object.values(answers)) {
    if (!isRecord(answer)) fail('JEV_RESPONSE_INVALID');
  }
  return { model: response.model, answers, usage: validateUsage(response.usage) };
}

function jsonReady(value) {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) fail('JEV_PAYLOAD_INVALID');
    return JSON.parse(encoded);
  } catch (error) {
    if (error?.code === 'JEV_PAYLOAD_INVALID') throw error;
    fail('JEV_PAYLOAD_INVALID');
  }
}

async function call(state, payload, receipts) {
  const started = performance.now();
  const { state: stateValue, questions } = validatePayload(payload);
  const requestObject = jsonReady({ model: state.model, state: stateValue, questions });
  const requestSha256 = sha256Text(stableStringify(requestObject));
  const metadata = extra => Object.freeze({
    schemaVersion: 1, adapterId: state.id, operation: 'evaluate',
    requestedModel: state.model, requestSha256, ...extra,
  });
  try {
    const apiKey = resolveApiKey(state);
    if (apiKey === null) fail('JEV_API_KEY_MISSING');
    const clientOptions = { apiKey, timeout: state.timeoutMs, retry: { maxRetries: 0 } };
    if (state.fetch !== null) clientOptions.fetch = state.fetch;
    const client = new TypeSafeClient(clientOptions);
    const response = await client.systemOne(requestObject, { retry: { maxRetries: 0 } });
    const { model: reportedModel, answers, usage } = validateResponse(response);
    if (reportedModel !== state.model) fail('JEV_MODEL_BINDING');
    const responseSha256 = sha256Text(stableStringify(response));
    const elapsedMs = Math.round(performance.now() - started);
    receipts.push(cloneFreeze(metadata({ status: 'RESPONSE_VALIDATED', reportedModel, responseSha256, usage, elapsedMs })));
    return cloneFreeze({
      model: reportedModel, answers, usage,
      evidence: Object.freeze({ requestedModel: state.model, requestSha256, responseSha256, elapsedMs }),
    });
  } catch (error) {
    const code = typeof error?.code === 'string' ? error.code : 'JEV_UNAVAILABLE';
    receipts.push(cloneFreeze(metadata({ status: 'UNAVAILABLE', code, reportedModel: null, usage: null })));
    fail(code);
  }
}

export function createJevEvaluator(input) {
  const state = config(input);
  const receipts = [];
  let stopped = false;
  return Object.freeze({
    id: state.id,
    receipts: () => cloneFreeze(receipts),
    lifecycle: () => Object.freeze({ schemaVersion: 1, state: stopped ? 'STOPPED' : 'IDLE', remoteInferenceStopped: 'NOT_OBSERVED' }),
    stop() { stopped = true; },
    async evaluate(payload) {
      if (stopped) fail('JEV_OWNER_STOPPED');
      return call(state, payload, receipts);
    },
  });
}
