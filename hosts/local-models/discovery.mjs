// Copyright 2026 Louis Calata. Private next-version implementation.
// Inventory only: no inference, loading, downloads, credentials or dispatch.
import { strictJSON } from '../../adapters/local-chat.mjs';
import { cloneFreeze, sha256Text } from '../../workflow/contracts.mjs';

const PATHS = Object.freeze({ 'lmstudio-v1': '/api/v1/models', 'ollama-tags': '/api/tags' });
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = code => { throw Object.assign(new Error(code), { code }); };
function keys(value, allowed) {
  if (!record(value) || Reflect.ownKeys(value).some(key => !allowed.includes(key))) fail('INVENTORY_CONFIG_INVALID');
}
function bounded(value, fallback, min, max) {
  const result = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(result) || result < min || result > max) fail('INVENTORY_LIMIT_INVALID');
  return result;
}
function label(value, max = 256) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) fail('INVENTORY_SCHEMA_INVALID');
  return value;
}
function origin(value) {
  // No host resolution, alternative numeric addresses, credentials or arbitrary paths.
  if (typeof value !== 'string' || !/^http:\/\/(?:127\.0\.0\.1|\[::1\])(?::[1-9][0-9]{0,4})?\/?$/u.test(value)) fail('INVENTORY_ORIGIN_REFUSED');
  try { return new URL(value).origin; } catch { fail('INVENTORY_ORIGIN_REFUSED'); }
}
function optionalSize(value) {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) fail('INVENTORY_SCHEMA_INVALID');
  return value;
}
function normalize(raw, runtime, maxModels) {
  // Provider responses are data, not Nisi evidence schemas: project only the
  // supported fields; never forward arbitrary metadata into prompts or commands.
  if (!record(raw) || !Array.isArray(raw.models) || raw.models.length > maxModels) fail('INVENTORY_SCHEMA_INVALID');
  const ids = new Set();
  return raw.models.map(item => {
    if (!record(item)) fail('INVENTORY_SCHEMA_INVALID');
    let modelId, displayName, type, loadedState = 'UNKNOWN', instanceIds = [], reportedDigest = null;
    if (runtime.provider === 'lmstudio-v1') {
      modelId = label(item.key); displayName = label(item.display_name);
      if (!['llm', 'embedding'].includes(item.type) || !Array.isArray(item.loaded_instances) || item.loaded_instances.length > 64) fail('INVENTORY_SCHEMA_INVALID');
      type = item.type;
      instanceIds = item.loaded_instances.map(instance => {
        if (!record(instance)) fail('INVENTORY_SCHEMA_INVALID');
        return label(instance.id);
      });
      if (new Set(instanceIds).size !== instanceIds.length) fail('INVENTORY_SCHEMA_INVALID');
      loadedState = instanceIds.length ? 'REPORTED_LOADED' : 'REPORTED_NOT_LOADED';
    } else {
      modelId = label(item.model); displayName = label(item.name); type = 'UNKNOWN';
      if (item.digest !== undefined) {
        if (typeof item.digest !== 'string' || !/^(?:sha256:)?[a-f0-9]{64}$/u.test(item.digest)) fail('INVENTORY_SCHEMA_INVALID');
        reportedDigest = item.digest;
      }
    }
    if (ids.has(modelId)) fail('INVENTORY_DUPLICATE_MODEL');
    ids.add(modelId);
    const sizeBytes = optionalSize(runtime.provider === 'lmstudio-v1' ? item.size_bytes : item.size);
    return { runtimeId: runtime.id, modelId, displayName, type, sizeBytes, reportedDigest,
      presence: 'PROVIDER_LISTED', loadedState, instanceIds,
      // Neither a name, digest, size nor successful GET attests local inference.
      locality: 'NOT_VERIFIED', inference: 'NOT_TESTED', license: 'NOT_REVIEWED',
      providerFee: 'UNKNOWN', useAuthorization: 'NONE' };
  });
}
function cancel(body) {
  try { Promise.resolve(body?.cancel()).catch(() => {}); } catch { /* preserve original observation */ }
}
async function readBody(response, cap, signal, accounting) {
  if (!response?.body?.getReader) fail('INVENTORY_RESPONSE_INVALID');
  const reader = response.body.getReader(); const chunks = [];
  const stop = () => cancel(reader);
  signal.addEventListener('abort', stop, { once: true });
  try {
    while (true) {
      if (signal.aborted) fail('INVENTORY_INTERRUPTED');
      const part = await reader.read();
      if (part.done) break;
      if (!(part.value instanceof Uint8Array)) fail('INVENTORY_RESPONSE_INVALID');
      accounting.bytesRead += part.value.byteLength;
      if (accounting.bytesRead > cap) fail('INVENTORY_RESPONSE_TOO_LARGE');
      chunks.push(part.value);
    }
    const bytes = Buffer.concat(chunks);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { fail('INVENTORY_UTF8_INVALID'); }
  } catch (error) { stop(); throw error; }
  finally { signal.removeEventListener('abort', stop); try { reader.releaseLock(); } catch {} }
}

async function inspectRuntime(runtime, config, upstream, pendingTransports) {
  const controller = new AbortController(); const started = performance.now();
  const observedAt = new Date().toISOString(); const accounting = { bytesRead: 0 };
  let stopCode = null, onStop;
  const stop = code => { if (stopCode === null) { stopCode = code; controller.abort(); } };
  const abort = () => stop('INVENTORY_CANCELLED');
  const timer = setTimeout(() => stop('INVENTORY_TIMEOUT'), config.timeoutMs);
  const base = () => ({ runtimeId: runtime.id, provider: runtime.provider, endpoint: runtime.endpoint,
    observedAt, elapsedMs: Math.round(performance.now() - started), bytesRead: accounting.bytesRead });
  const interrupted = new Promise((_, reject) => {
    onStop = () => reject(Object.assign(new Error(stopCode), { code: stopCode }));
    controller.signal.addEventListener('abort', onStop, { once: true });
  });
  // An already-aborted signal must not produce an unhandled rejected promise.
  interrupted.catch(() => {});
  upstream?.addEventListener('abort', abort, { once: true });
  if (upstream?.aborted) abort();
  try {
    if (stopCode) fail(stopCode);
    const request = async () => {
      const response = await config.fetch(runtime.endpoint, { method: 'GET', redirect: 'error',
        credentials: 'omit', cache: 'no-store', headers: { accept: 'application/json' }, signal: controller.signal });
      if (controller.signal.aborted) { cancel(response?.body); fail(stopCode); }
      if (response?.redirected || (response?.status >= 300 && response?.status < 400)) { cancel(response?.body); fail('INVENTORY_REDIRECT_REFUSED'); }
      if (response?.status === 401 || response?.status === 403) { cancel(response?.body); fail('INVENTORY_AUTH_REQUIRED'); }
      if (response?.status !== 200) { cancel(response?.body); fail('INVENTORY_HTTP_UNAVAILABLE'); }
      return readBody(response, config.maxResponseBytes, controller.signal, accounting);
    };
    const transport = request();
    pendingTransports.add(transport);
    // Observing cancellation is not evidence that a trusted/injected transport
    // settled. Keep the client quarantined until the actual request promise ends.
    transport.then(() => pendingTransports.delete(transport), () => pendingTransports.delete(transport));
    const text = await Promise.race([transport, interrupted]);
    // Provider transport must be JSON, not a markdown-wrapped model response.
    if (!text.trimStart().startsWith('{')) fail('INVENTORY_SCHEMA_INVALID');
    const models = normalize(strictJSON(text), runtime, config.maxModels);
    const result = cloneFreeze({ ...base(), status: 'LISTED', code: null, responseSha256: sha256Text(text), models });
    if (stopCode || performance.now() - started >= config.timeoutMs) fail(stopCode ?? 'INVENTORY_TIMEOUT');
    return result;
  } catch (error) {
    const code = stopCode ?? (typeof error?.code === 'string' && /^(?:INVENTORY_|LOCAL_CHAT_JSON_)/u.test(error.code) ? error.code : 'INVENTORY_UNAVAILABLE');
    const status = code === 'INVENTORY_TIMEOUT' ? 'TIMED_OUT' : code === 'INVENTORY_CANCELLED' ? 'CANCELLED'
      : code === 'INVENTORY_AUTH_REQUIRED' ? 'AUTH_REQUIRED' : 'UNAVAILABLE';
    return cloneFreeze({ ...base(), status, code, responseSha256: null, models: [] });
  } finally {
    clearTimeout(timer); upstream?.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', onStop);
  }
}

export function createLocalModelDiscovery(input) {
  keys(input, ['runtimes', 'fetch', 'timeoutMs', 'maxResponseBytes', 'maxModels']);
  if (!Array.isArray(input.runtimes) || input.runtimes.length > 8 ||
      Array.from({ length: input.runtimes.length }, (_, index) => index).some(index => !Object.hasOwn(input.runtimes, index))) fail('INVENTORY_RUNTIMES_INVALID');
  const runtimeIds = new Set(), endpoints = new Set();
  const runtimes = input.runtimes.map(runtime => {
    keys(runtime, ['id', 'provider', 'origin']);
    if (typeof runtime.id !== 'string' || !/^[a-z][a-z0-9_.-]{0,95}$/u.test(runtime.id) || !Object.hasOwn(PATHS, runtime.provider)) fail('INVENTORY_RUNTIME_INVALID');
    const endpoint = origin(runtime.origin) + PATHS[runtime.provider];
    if (runtimeIds.has(runtime.id) || endpoints.has(endpoint)) fail('INVENTORY_DUPLICATE_RUNTIME');
    runtimeIds.add(runtime.id); endpoints.add(endpoint);
    return Object.freeze({ id: runtime.id, provider: runtime.provider, endpoint });
  });
  const config = Object.freeze({
    timeoutMs: bounded(input.timeoutMs, 2000, 1, 10000),
    maxResponseBytes: bounded(input.maxResponseBytes, 262144, 256, 1048576),
    maxModels: bounded(input.maxModels, 256, 1, 1024), fetch: input.fetch ?? globalThis.fetch,
  });
  if (typeof config.fetch !== 'function') fail('INVENTORY_FETCH_INVALID');
  let active = false;
  const pendingTransports = new Set();
  return Object.freeze({ async discover(options = {}) {
    keys(options, ['signal']);
    if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) fail('INVENTORY_SIGNAL_INVALID');
    if (active) fail('INVENTORY_ALREADY_RUNNING');
    if (pendingTransports.size) fail('INVENTORY_TRANSPORT_UNSETTLED');
    active = true;
    try {
      const results = [];
      // Serial, bounded list requests; no port scan or per-model generation.
      for (const runtime of runtimes) {
        if (pendingTransports.size) {
          results.push({ runtimeId: runtime.id, provider: runtime.provider, endpoint: runtime.endpoint,
            observedAt: null, elapsedMs: 0, bytesRead: 0, status: 'NOT_RUN',
            code: 'INVENTORY_PRIOR_TRANSPORT_UNSETTLED', responseSha256: null, models: [] });
        } else results.push(await inspectRuntime(runtime, config, options.signal, pendingTransports));
      }
      const listed = results.filter(result => result.status === 'LISTED').length;
      return cloneFreeze({ schemaVersion: 1, scope: 'REGISTERED_RUNTIME_INVENTORY_ONLY',
        status: !results.length ? 'NOT_CONFIGURED' : listed === results.length ? 'LISTED'
          : listed ? 'PARTIAL' : 'UNAVAILABLE', runtimes: results });
    } finally { active = false; }
  } });
}
