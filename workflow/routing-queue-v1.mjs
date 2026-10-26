// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
// Nisi routing-job contract. This module only normalizes and binds a proposed
// route. The deterministic host owns the durable queue, claims, transport,
// receipts and acceptance decisions.

import {
  cloneFreeze,
  createTaskSpecification,
  sha256Text,
  stableStringify,
} from './contracts.mjs';

export const ROUTING_QUEUE_SCHEMA_VERSION = 1;
export const ROUTING_HOSTS = Object.freeze(['mac', 'windows']);
export const ROUTING_CLIENTS = Object.freeze(['codex', 'claude', 'opencode']);
export const ROUTING_PRIORITIES = Object.freeze(['low', 'normal', 'high']);

// Codex task IDs are UUID-shaped and may use UUIDv7, so the contract checks
// the shape without narrowing the version bits.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const ID = /^[a-z][a-z0-9_.-]{0,95}$/u;
const HEX64 = /^[0-9a-f]{64}$/u;
const MAX_ROUTES = 16;
const MAX_DEPENDENCIES = 8;
const MAX_SCOPE_BYTES = 512;

export class RoutingQueueError extends Error {
  constructor(code) {
    super(code);
    this.name = 'RoutingQueueError';
    this.code = code;
  }
}

const reject = code => { throw new RoutingQueueError(code); };
const isPlainRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const exactKeys = (value, expected, code = 'ROUTING_SCHEMA_INVALID') => {
  if (!isPlainRecord(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) reject(code);
  return value;
};
const isId = value => typeof value === 'string' && ID.test(value);
const isHex = value => typeof value === 'string' && HEX64.test(value);
const bytes = value => Buffer.byteLength(value, 'utf8');

function normalizeRoute(value) {
  exactKeys(value, ['id', 'targetThreadId', 'host', 'client', 'scope'], 'ROUTING_ROUTE_SCHEMA');
  if (!isId(value.id)) reject('ROUTING_ROUTE_ID_INVALID');
  if (typeof value.targetThreadId !== 'string' || !UUID.test(value.targetThreadId)) reject('ROUTING_TARGET_INVALID');
  if (!ROUTING_HOSTS.includes(value.host) || !ROUTING_CLIENTS.includes(value.client)) reject('ROUTING_ROUTE_INVALID');
  if (typeof value.scope !== 'string' || value.scope.trim() === '' || bytes(value.scope) > MAX_SCOPE_BYTES) reject('ROUTING_SCOPE_INVALID');
  return { id: value.id, targetThreadId: value.targetThreadId, host: value.host, client: value.client, scope: value.scope };
}

export function normalizeRoutingRoutes(value) {
  value = cloneFreeze(value);
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ROUTES) reject('ROUTING_ROUTES_INVALID');
  const routes = value.map(normalizeRoute);
  if (new Set(routes.map(route => route.id)).size !== routes.length ||
      new Set(routes.map(route => route.targetThreadId)).size !== routes.length) reject('ROUTING_ROUTES_DUPLICATE');
  return cloneFreeze(routes.sort((left, right) => left.id.localeCompare(right.id)));
}

function normalizeDependencies(value) {
  if (!Array.isArray(value) || value.length > MAX_DEPENDENCIES ||
      value.some(item => !isId(item)) || new Set(value).size !== value.length) reject('ROUTING_DEPENDENCIES_INVALID');
  return [...value];
}

function validateJevAdvisory(value, taskSha256, routes) {
  value = cloneFreeze(value);
  if (!isPlainRecord(value) || value.kind !== 'nisi.jev.advisory.v1' || value.schemaVersion !== 1 ||
      value.capability !== 'proposeRouting' || value.status !== 'RESPONSE_VALIDATED' ||
      value.advisoryOnly !== true || value.accepted !== false ||
      value.checks !== 'NOT_RUN' || value.tests !== 'NOT_RUN' || value.certification !== 'NOT_RUN' ||
      value.taskSha256 !== taskSha256 || typeof value.model !== 'string' || value.model.trim() === '' ||
      value.taskId === null) {
    reject('ROUTING_JEV_BINDING_INVALID');
  }
  if (typeof value.routesSha256 !== 'string' || !isHex(value.routesSha256) ||
      value.routesSha256 !== sha256Text(stableStringify(routes))) reject('ROUTING_ROUTES_BINDING_INVALID');
  if (!isPlainRecord(value.answers) || JSON.stringify(Object.keys(value.answers).sort()) !== JSON.stringify(['needsReview', 'priority', 'target'])) {
    reject('ROUTING_JEV_ANSWER_INVALID');
  }
  const target = value.answers.target;
  const priority = value.answers.priority;
  const review = value.answers.needsReview;
  const routeLabels = [...routes.map(route => route.id), 'hold'].sort();
  if (!isPlainRecord(target) || JSON.stringify(Object.keys(target).sort()) !== JSON.stringify(['choice', 'confidence', 'probabilities', 'type'].sort()) ||
      target.type !== 'choice' || !routeLabels.includes(target.choice) || typeof target.confidence !== 'number' ||
      !Number.isFinite(target.confidence) || target.confidence < 0 || target.confidence > 1 ||
      !isPlainRecord(target.probabilities) || JSON.stringify(Object.keys(target.probabilities).sort()) !== JSON.stringify(routeLabels) ||
      Object.values(target.probabilities).some(item => typeof item !== 'number' || !Number.isFinite(item) || item < 0 || item > 1) ||
      Math.abs(Object.values(target.probabilities).reduce((sum, item) => sum + item, 0) - 1) > 1e-6) reject('ROUTING_JEV_ANSWER_INVALID');
  if (!isPlainRecord(priority) || JSON.stringify(Object.keys(priority).sort()) !== JSON.stringify(['choice', 'confidence', 'probabilities', 'type'].sort()) ||
      priority.type !== 'choice' || !ROUTING_PRIORITIES.includes(priority.choice) || typeof priority.confidence !== 'number' ||
      !Number.isFinite(priority.confidence) || priority.confidence < 0 || priority.confidence > 1 ||
      !isPlainRecord(priority.probabilities) || JSON.stringify(Object.keys(priority.probabilities).sort()) !== JSON.stringify([...ROUTING_PRIORITIES].sort()) ||
      Object.values(priority.probabilities).some(item => typeof item !== 'number' || !Number.isFinite(item) || item < 0 || item > 1) ||
      Math.abs(Object.values(priority.probabilities).reduce((sum, item) => sum + item, 0) - 1) > 1e-6) reject('ROUTING_JEV_ANSWER_INVALID');
  if (!isPlainRecord(review) || JSON.stringify(Object.keys(review).sort()) !== JSON.stringify(['noul', 'type']) ||
      review.type !== 'noul' || typeof review.noul !== 'number' || !Number.isFinite(review.noul) || review.noul < 0 || review.noul > 1) reject('ROUTING_JEV_PROPOSAL_INVALID');
  if (!isPlainRecord(value.routing) ||
      JSON.stringify(Object.keys(value.routing).sort()) !== JSON.stringify(['confidence', 'needsReview', 'priority', 'routeId'].sort()) ||
      !routes.some(route => route.id === value.routing.routeId) ||
      !ROUTING_PRIORITIES.includes(value.routing.priority) ||
      typeof value.routing.needsReview !== 'boolean' ||
      typeof value.routing.confidence !== 'number' || !Number.isFinite(value.routing.confidence) ||
      value.routing.confidence < 0.6 || value.routing.confidence > 1 ||
      value.routing.routeId !== target.choice || value.routing.priority !== priority.choice ||
      value.routing.needsReview !== (review.noul >= 0.5) ||
      Math.abs(value.routing.confidence - Math.min(target.confidence, priority.confidence, Math.max(review.noul, 1 - review.noul))) > 1e-9) reject('ROUTING_JEV_PROPOSAL_INVALID');
  const evidence = value.evidence;
  if (!isPlainRecord(evidence) || evidence.taskSha256 !== taskSha256 || typeof evidence.requestSha256 !== 'string' || !isHex(evidence.requestSha256) ||
      typeof evidence.responseSha256 !== 'string' || !isHex(evidence.responseSha256) ||
      !Number.isSafeInteger(evidence.elapsedMs) || evidence.elapsedMs < 0) reject('ROUTING_JEV_RECEIPT_INVALID');
  if (value.usage !== null && value.usage !== undefined &&
      (!isPlainRecord(value.usage) || !Number.isSafeInteger(value.usage.inputTokens) || value.usage.inputTokens < 0 ||
       !Number.isSafeInteger(value.usage.outputTokens) || value.usage.outputTokens < 0)) reject('ROUTING_JEV_USAGE_INVALID');
  return value;
}

function validateClock(value) {
  if (!Number.isSafeInteger(value) || value < 0) reject('ROUTING_CLOCK_INVALID');
  return value;
}

/**
 * Convert a validated Jev proposal into a queue-safe job.
 *
 * The returned job intentionally contains no task text, source files or
 * model output. It is safe to hand to the host queue, which can bind it to a
 * durable ledger without allowing either model to enqueue or dispatch work.
 */
export function createRoutingJob(input) {
  input = cloneFreeze(input);
  exactKeys(input, ['task', 'sourceRunId', 'sourceThreadId', 'routes', 'jevAdvisory', 'dependencies', 'nowMs'], 'ROUTING_JOB_INPUT_INVALID');
  const task = createTaskSpecification(input.task);
  const taskSha256 = sha256Text(stableStringify(task));
  if (!isId(input.sourceRunId)) reject('ROUTING_SOURCE_RUN_INVALID');
  if (typeof input.sourceThreadId !== 'string' || !UUID.test(input.sourceThreadId)) reject('ROUTING_SOURCE_INVALID');
  const routes = normalizeRoutingRoutes(input.routes);
  const dependencies = normalizeDependencies(input.dependencies);
  const nowMs = validateClock(input.nowMs);
  const jev = validateJevAdvisory(input.jevAdvisory, taskSha256, routes);
  if (jev.taskId !== task.taskId) reject('ROUTING_JEV_BINDING_INVALID');
  const route = routes.find(item => item.id === jev.routing.routeId);
  if (!route || route.targetThreadId === input.sourceThreadId) reject('ROUTING_SELF_HANDOFF');
  const expiresAtMs = nowMs + task.policy.totalDeadlineMs;
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= nowMs) reject('ROUTING_DEADLINE_INVALID');
  const dedupeKey = sha256Text(`nisi/routing-job/v1\0${stableStringify({
    taskSha256,
    sourceRunId: input.sourceRunId,
    sourceThreadId: input.sourceThreadId,
    routeId: route.id,
    targetThreadId: route.targetThreadId,
    dependencies,
  })}`);
  const job = {
    kind: 'nisi.routing.job.v1',
    schemaVersion: ROUTING_QUEUE_SCHEMA_VERSION,
    jobId: `routing-${dedupeKey.slice(0, 48)}`,
    taskId: task.taskId,
    taskSha256,
    sourceRunId: input.sourceRunId,
    sourceThreadId: input.sourceThreadId,
    routeId: route.id,
    targetThreadId: route.targetThreadId,
    host: route.host,
    client: route.client,
    priority: jev.routing.priority,
    requiresReview: jev.routing.needsReview,
    confidence: jev.routing.confidence,
    dependencies,
    createdAtMs: nowMs,
    expiresAtMs,
    dedupeKey,
    jev: {
      model: jev.model,
      requestSha256: jev.evidence.requestSha256,
      responseSha256: jev.evidence.responseSha256,
      usage: jev.usage ?? null,
    },
  };
  return cloneFreeze(job);
}

/**
 * Adapt a Nisi job to the existing Python ledger payload. The host still
 * performs the actual enqueue; this function never writes files or sends a
 * message.
 */
export function toRoutingLedgerPayload(job) {
  job = cloneFreeze(job);
  const expectedKeys = ['client', 'confidence', 'createdAtMs', 'dedupeKey', 'dependencies', 'expiresAtMs', 'host', 'jev', 'jobId', 'kind', 'priority', 'requiresReview', 'routeId', 'schemaVersion', 'sourceRunId', 'sourceThreadId', 'targetThreadId', 'taskId', 'taskSha256'];
  if (!isPlainRecord(job) || JSON.stringify(Object.keys(job).sort()) !== JSON.stringify(expectedKeys.sort()) ||
      job.kind !== 'nisi.routing.job.v1' || job.schemaVersion !== ROUTING_QUEUE_SCHEMA_VERSION ||
      !isId(job.jobId) || !isId(job.taskId) || !isHex(job.taskSha256) || !isHex(job.dedupeKey) ||
      !isId(job.sourceRunId) || typeof job.sourceThreadId !== 'string' || !UUID.test(job.sourceThreadId) ||
      typeof job.targetThreadId !== 'string' || !UUID.test(job.targetThreadId) ||
      !ROUTING_HOSTS.includes(job.host) || !ROUTING_CLIENTS.includes(job.client) || !isId(job.routeId) ||
      !ROUTING_PRIORITIES.includes(job.priority) || typeof job.requiresReview !== 'boolean' ||
      typeof job.confidence !== 'number' || !Number.isFinite(job.confidence) || job.confidence < 0.6 || job.confidence > 1 ||
      !Number.isSafeInteger(job.createdAtMs) || job.createdAtMs < 0 || !Number.isSafeInteger(job.expiresAtMs) || job.expiresAtMs <= job.createdAtMs ||
      !Array.isArray(job.dependencies) || job.dependencies.length > MAX_DEPENDENCIES || job.dependencies.some(item => !isId(item)) ||
      new Set(job.dependencies).size !== job.dependencies.length || !isPlainRecord(job.jev) ||
      JSON.stringify(Object.keys(job.jev).sort()) !== JSON.stringify(['model', 'requestSha256', 'responseSha256', 'usage']) ||
      typeof job.jev.model !== 'string' || job.jev.model.trim() === '' || !isHex(job.jev.requestSha256) || !isHex(job.jev.responseSha256) ||
      (job.jev.usage !== null && (!isPlainRecord(job.jev.usage) || !Number.isSafeInteger(job.jev.usage.inputTokens) || job.jev.usage.inputTokens < 0 ||
        !Number.isSafeInteger(job.jev.usage.outputTokens) || job.jev.usage.outputTokens < 0))) reject('ROUTING_JOB_INVALID');
  const expectedDedupe = sha256Text(`nisi/routing-job/v1\0${stableStringify({
    taskSha256: job.taskSha256, sourceRunId: job.sourceRunId, sourceThreadId: job.sourceThreadId,
    routeId: job.routeId, targetThreadId: job.targetThreadId, dependencies: job.dependencies,
  })}`);
  if (job.dedupeKey !== expectedDedupe || job.jobId !== `routing-${expectedDedupe.slice(0, 48)}`) reject('ROUTING_JOB_BINDING_INVALID');
  return cloneFreeze({
    targetThreadId: job.targetThreadId,
    expiresAt: Math.max(1, Math.floor(job.expiresAtMs / 1000)),
    dependencies: [...job.dependencies],
    dedupeKey: job.dedupeKey,
    routingJob: {
      schemaVersion: job.schemaVersion,
      jobId: job.jobId,
      taskId: job.taskId,
      taskSha256: job.taskSha256,
      sourceRunId: job.sourceRunId,
      sourceThreadId: job.sourceThreadId,
      routeId: job.routeId,
      host: job.host,
      client: job.client,
      priority: job.priority,
      requiresReview: job.requiresReview,
      confidence: job.confidence,
      createdAtMs: job.createdAtMs,
      expiresAtMs: job.expiresAtMs,
      jev: job.jev,
    },
  });
}

/**
 * Host adapter for the durable ledger. A store must expose only `enqueue`;
 * claim/send/receipt/verification remain separate host operations.
 */
export function enqueueRoutingJob(store, job, nowMs) {
  if (!store || typeof store.enqueue !== 'function') reject('ROUTING_STORE_INVALID');
  const payload = toRoutingLedgerPayload(job);
  validateClock(nowMs);
  // The ledger stores whole seconds, rounded down. The final fractional
  // second is already expired to that store even while the ms deadline is
  // still ahead; refuse before enqueue rather than admit an expired record.
  if (nowMs >= job.expiresAtMs || Math.floor(nowMs / 1000) >= payload.expiresAt) {
    reject('ROUTING_JOB_EXPIRED');
  }
  return cloneFreeze(store.enqueue(job.jobId, payload));
}

export function routingJobExpired(job, nowMs) {
  validateClock(nowMs);
  // Reuse the complete adapter validation so callers cannot ask the expiry
  // helper to bless an object that would later fail at the ledger boundary.
  if (!isPlainRecord(job) || !Number.isSafeInteger(job.expiresAtMs)) reject('ROUTING_JOB_INVALID');
  const payload = toRoutingLedgerPayload(job);
  return nowMs >= job.expiresAtMs || Math.floor(nowMs / 1000) >= payload.expiresAt;
}
