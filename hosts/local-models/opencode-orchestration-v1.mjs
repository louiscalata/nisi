// Copyright 2026 Louis Calata. Private host integration; no workflow acceptance.
import { request as httpRequest } from 'node:http';
import { Readable } from 'node:stream';
import { createLocalModelDiscovery } from './discovery.mjs';
import { createLocalChatAuthorAdapter, createLocalChatReviewerAdapter,
  createLocalChatTransportOwner } from '../../adapters/local-chat.mjs';
import { cloneFreeze, createTaskSpecification, sha256Text, stableStringify,
  validateCandidateForTask } from '../../workflow/contracts.mjs';

const ORIGIN = 'http://127.0.0.1:1234';
const MAX_BYTES = 262144;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function keys(value, allowed, required = []) {
  if (!record(value) || Reflect.ownKeys(value).some(key => !allowed.includes(key)) ||
      required.some(key => !Object.hasOwn(value, key))) fail('OPENCODE_INPUT_SCHEMA');
}
function limit(value, fallback, maximum) {
  const result = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) fail('OPENCODE_LIMIT_INVALID');
  return result;
}
function model(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim() !== value || value.length > 256 ||
      /[\u0000-\u001f\u007f]/u.test(value)) fail('OPENCODE_MODEL_INVALID');
}
function optionsSignal(options) {
  keys(options, ['signal']);
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) fail('OPENCODE_SIGNAL_INVALID');
  return options.signal;
}
function normalize(raw) {
  const input = cloneFreeze(raw);
  keys(input, ['runId', 'task', 'mode', 'authorModel', 'reviewerModel', 'candidate',
    'timeoutMs', 'maxOutputTokens', 'allowColdStart', 'outputMode', 'reasoningEffort'], ['runId', 'task', 'mode']);
  if (Buffer.byteLength(stableStringify(input)) > MAX_BYTES) fail('OPENCODE_INPUT_TOO_LARGE');
  if (typeof input.runId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$/u.test(input.runId)) fail('OPENCODE_RUN_ID_INVALID');
  if (!['draft', 'review', 'draft_review'].includes(input.mode)) fail('OPENCODE_MODE_INVALID');
  const drafting = input.mode !== 'review', reviewing = input.mode !== 'draft';
  if (drafting) model(input.authorModel);
  else if (Object.hasOwn(input, 'authorModel')) fail('OPENCODE_INPUT_SCHEMA');
  if (reviewing) model(input.reviewerModel);
  else if (Object.hasOwn(input, 'reviewerModel')) fail('OPENCODE_INPUT_SCHEMA');
  if (drafting && Object.hasOwn(input, 'candidate')) fail('OPENCODE_INPUT_SCHEMA');
  if (input.allowColdStart !== undefined && typeof input.allowColdStart !== 'boolean') fail('OPENCODE_COLD_START_INVALID');
  if (input.outputMode !== undefined && !['json_instruction', 'json_schema'].includes(input.outputMode)) {
    fail('OPENCODE_OUTPUT_MODE_INVALID');
  }
  if (input.reasoningEffort !== undefined && input.reasoningEffort !== 'none') fail('OPENCODE_REASONING_EFFORT_INVALID');
  const task = createTaskSpecification(input.task);
  if (task.mode !== (drafting ? 'edit' : 'review')) fail('OPENCODE_TASK_MODE_MISMATCH');
  const candidate = drafting ? null : validateCandidateForTask(input.candidate, task, 'opencode.supplied');
  return cloneFreeze({ ...input, task, candidate, timeoutMs: limit(input.timeoutMs, 60000, 120000),
    maxOutputTokens: limit(input.maxOutputTokens, 1024, 2048), allowColdStart: input.allowColdStart ?? false,
    outputMode: input.outputMode ?? 'json_instruction' });
}

// Direct fixed-address HTTP ignores proxy environment variables and follows no
// redirects. An injected fetch is a trusted host/test boundary, never model input.
function directFetch(endpoint, options) {
  const pathname = endpoint === `${ORIGIN}/api/v1/models` && options.method === 'GET'
    ? '/api/v1/models' : endpoint === `${ORIGIN}/v1/chat/completions` && options.method === 'POST'
      ? '/v1/chat/completions' : null;
  if (!pathname) fail('OPENCODE_DESTINATION_REFUSED');
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: '127.0.0.1', port: 1234, path: pathname,
      method: options.method, headers: options.headers, signal: options.signal, agent: false }, response => {
      const ok = response.statusCode >= 200 && response.statusCode < 300;
      // Refused status bodies need no web-stream bridge or asynchronous drain.
      if (!ok) response.destroy();
      resolve({ status: response.statusCode, ok, redirected: false, body: ok ? Readable.toWeb(response) : null });
    });
    request.on('error', reject);
    request.end(options.body);
  });
}

export function createOpenCodeLocalOrchestrator(config = {}) {
  keys(config, ['fetch']);
  if (config.fetch !== undefined && typeof config.fetch !== 'function') fail('OPENCODE_FETCH_INVALID');
  const fetch = config.fetch ?? directFetch;
  const discovery = createLocalModelDiscovery({ runtimes: [{ id: 'opencode.local', provider: 'lmstudio-v1', origin: ORIGIN }],
    fetch, timeoutMs: 10000, maxResponseBytes: 65536, maxModels: 64 });
  const owner = createLocalChatTransportOwner();
  let active = false, quarantine = false;
  const status = () => cloneFreeze({ state: quarantine ? 'QUARANTINED' : active ? 'BUSY' : 'IDLE',
    recoveryRequired: quarantine, transport: owner.status() });
  const available = () => {
    if (active) fail('OPENCODE_ALREADY_RUNNING');
    if (quarantine) fail('OPENCODE_ORCHESTRATOR_QUARANTINED');
  };
  const seal = result => {
    const snapshot = cloneFreeze(result), canonical = stableStringify(snapshot);
    if (Buffer.byteLength(canonical) > 4 * MAX_BYTES) fail('OPENCODE_OUTPUT_TOO_LARGE');
    return cloneFreeze({ ...snapshot, outputSha256: sha256Text(canonical) });
  };

  async function discover(options = {}) {
    const signal = optionsSignal(options); available(); active = true;
    try {
      const result = await discovery.discover({ signal });
      if (result.status !== 'LISTED') quarantine = true;
      return result;
    } catch (error) { quarantine = true; throw error; }
    finally { active = false; }
  }

  async function work(raw, options = {}) {
    const started = performance.now();
    const input = normalize(raw), upstream = optionsSignal(options);
    available(); active = true;
    const controller = new AbortController();
    let stopCode = null, transportAttempted = false, candidate = input.candidate, note = null, review = null;
    const inventories = [], receipts = [];
    const stop = code => { if (!stopCode) { stopCode = code; controller.abort(); } };
    const abort = () => stop('OPENCODE_CANCELLED');
    const timer = setTimeout(() => stop('OPENCODE_DEADLINE_EXCEEDED'), input.timeoutMs);
    upstream?.addEventListener('abort', abort, { once: true });
    if (upstream?.aborted) abort();
    const guard = () => {
      if (stopCode) fail(stopCode);
      if (performance.now() - started >= input.timeoutMs) { stop('OPENCODE_DEADLINE_EXCEEDED'); fail(stopCode); }
    };
    const taskFingerprint = sha256Text(`nisi/workflow-task/v1\0${stableStringify(input.task)}`);
    const binding = () => cloneFreeze({ schemaVersion: 1, runId: `opencode.advisory:${input.runId}`,
      taskFingerprint, attempt: 0, candidateFingerprint: candidate?.fingerprint ?? null });
    const base = () => ({ kind: 'nisi.opencode.local-advisory.v1', advisoryOnly: true, accepted: false,
      checks: 'NOT_RUN', tests: 'NOT_RUN', certification: 'NOT_RUN', runId: input.runId,
      bindingNamespace: 'OPENCODE_ADVISORY_NOT_WORKFLOW', binding: binding(), mode: input.mode,
      outputMode: input.outputMode,
      ...(input.reasoningEffort !== undefined ? { reasoningEffort: input.reasoningEffort } : {}),
      independentReviewerCount: 0, inventories, receipts, elapsedMs: Math.round(performance.now() - started),
      recoveryRequired: quarantine });
    async function ready(requestedModel) {
      guard();
      transportAttempted = true;
      const inventory = await discovery.discover({ signal: controller.signal });
      guard(); inventories.push(inventory.runtimes[0]);
      if (inventory.status !== 'LISTED') fail(inventory.runtimes[0]?.code ?? 'OPENCODE_INVENTORY_UNAVAILABLE');
      const models = inventory.runtimes[0].models;
      const selected = models.find(item => item.modelId === requestedModel && item.type === 'llm');
      if (!selected) fail('OPENCODE_MODEL_NOT_LISTED_LLM');
      if (selected.loadedState === 'REPORTED_LOADED') {
        if (selected.instanceIds.length !== 1 || selected.instanceIds[0] !== selected.modelId ||
            models.filter(item => item.instanceIds.includes(selected.modelId)).length !== 1) fail('OPENCODE_MODEL_INSTANCE_AMBIGUOUS');
      } else if (!input.allowColdStart || models.some(item => item.type === 'llm' && item.loadedState === 'REPORTED_LOADED')) {
        fail('OPENCODE_MODEL_NOT_RESIDENT');
      }
    }
    async function invoke(operation, requestedModel) {
      await ready(requestedModel); guard();
      const bound = binding();
      const settings = { destination: 'LOOPBACK_HTTP', endpoint: `${ORIGIN}/v1/chat/completions`,
        model: requestedModel, id: `opencode.${operation}`, fetch, transportOwner: owner,
        timeoutMs: Math.max(1, Math.ceil(input.timeoutMs - (performance.now() - started))),
        maxOutputTokens: input.maxOutputTokens, maxRequestBytes: MAX_BYTES, maxResponseBytes: MAX_BYTES,
        outputMode: input.outputMode,
        ...(input.reasoningEffort !== undefined ? { reasoningEffort: input.reasoningEffort } : {}) };
      const adapter = operation === 'draft' ? createLocalChatAuthorAdapter(settings) : createLocalChatReviewerAdapter(settings);
      const payload = { task: input.task, candidate, acceptanceCriteria: input.task.acceptanceCriteria,
        binding: bound, signal: controller.signal };
      if (operation === 'review') Object.assign(payload, { reviewerId: adapter.id,
        checks: { status: 'NOT_RUN', evidence: { ...bound, findings: [], reason: 'Advisory orchestration does not execute checks.' } },
        tests: { status: 'NOT_RUN', evidence: { ...bound, assertionsExecuted: 0, assertionsPassed: 0,
          failures: [], reason: 'Advisory orchestration does not execute tests.' } } });
      try {
        const result = await adapter[operation](payload); guard();
        // Adapters stamp binding from the immutable host payload, never model text.
        for (const key of ['schemaVersion', 'runId', 'taskFingerprint', 'attempt']) {
          if (result.evidence[key] !== bound[key]) fail('OPENCODE_EVIDENCE_STALE');
        }
        if (operation === 'draft') {
          const next = validateCandidateForTask(result.candidate, input.task, adapter.id);
          if (result.evidence.candidateFingerprint !== next.fingerprint) fail('OPENCODE_EVIDENCE_STALE');
          candidate = next; note = result.evidence.note;
        } else {
          if (result.evidence.candidateFingerprint !== candidate.fingerprint) fail('OPENCODE_EVIDENCE_STALE');
          review = cloneFreeze({ findings: result.evidence.findings, summary: result.evidence.summary });
        }
      } finally { receipts.push(...adapter.receipts()); }
      guard();
    }
    try {
      guard();
      if (input.mode !== 'review') await invoke('draft', input.authorModel);
      if (input.mode !== 'draft') await invoke('review', input.reviewerModel);
      guard();
      const distinctReportedModelCount = new Set(receipts.map(receipt => receipt.reportedModel).filter(Boolean)).size;
      const result = seal({ ...base(), status: 'RESPONSE_VALIDATED', code: null,
        candidate: { files: candidate.files }, candidateFingerprint: candidate.fingerprint, note, review,
        reviewRelationship: input.mode === 'draft' ? 'not_requested' : input.mode === 'review' ? 'review_only'
          : distinctReportedModelCount === 1 ? 'self_review' : 'different_reported_model', distinctReportedModelCount });
      guard(); return result;
    } catch (error) {
      // A caller stop before any transport does not poison a never-used owner.
      // Once discovery starts, failure still requires explicit external recovery.
      if (transportAttempted || !stopCode) { quarantine = true; owner.stop(); }
      const code = stopCode ?? (/^[A-Z0-9_]+$/u.test(error?.code ?? '') ? error.code : 'OPENCODE_UNAVAILABLE');
      return seal({ ...base(), status: 'UNAVAILABLE', code, candidate: null, candidateFingerprint: null,
        note: null, review: null, reviewRelationship: 'unavailable', distinctReportedModelCount: 0 });
    } finally { clearTimeout(timer); upstream?.removeEventListener('abort', abort); active = false; }
  }
  return Object.freeze({ discover, work, status });
}
