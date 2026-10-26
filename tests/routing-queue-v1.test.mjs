import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRoutingJob,
  enqueueRoutingJob,
  normalizeRoutingRoutes,
  routingJobExpired,
  toRoutingLedgerPayload,
} from '../workflow/routing-queue-v1.mjs';
import { sha256Text, stableStringify } from '../workflow/contracts.mjs';

const sourceThreadId = '01a0bade-766a-7642-ae1c-2e5fef990c7c';
const routes = [
  { id: 'nisi-review', targetThreadId: '01a0344b-d760-7090-93ae-ddffa423843b', host: 'mac', client: 'codex', scope: 'Nisi contract review' },
  { id: 'windows-probe', targetThreadId: '01a010c6-ab72-7f32-9867-f3223abbf101', host: 'windows', client: 'opencode', scope: 'Windows compatibility probe' },
];
const task = {
  taskId: 'routing.fixture', mode: 'review', language: 'javascript', allowedFiles: ['src/a.mjs'],
  protectedFiles: ['src/a.mjs'], protectedSnapshots: { 'src/a.mjs': 'a'.repeat(64) },
  acceptanceCriteria: ['Inspect the route contract.'],
  policy: { repairBudget: 0, totalDeadlineMs: 30_000, requiredReviewers: 1, requireReportStore: false },
};
const taskSha256 = sha256Text(stableStringify(task));
const routesSha256 = sha256Text(stableStringify(routes.slice().sort((a, b) => a.id.localeCompare(b.id))));
const advisory = {
  kind: 'nisi.jev.advisory.v1', schemaVersion: 1, capability: 'proposeRouting', status: 'RESPONSE_VALIDATED',
  advisoryOnly: true, accepted: false, checks: 'NOT_RUN', tests: 'NOT_RUN', certification: 'NOT_RUN',
  taskId: 'routing.fixture', taskSha256, model: 'jev-latest', usage: { inputTokens: 20, outputTokens: 8 },
  answers: {
    target: { type: 'choice', choice: 'nisi-review', confidence: 0.9, probabilities: { 'nisi-review': 0.9, 'windows-probe': 0.05, hold: 0.05 } },
    priority: { type: 'choice', choice: 'normal', confidence: 0.9, probabilities: { low: 0.05, normal: 0.9, high: 0.05 } },
    needsReview: { type: 'noul', noul: 0.9 },
  },
  routing: { routeId: 'nisi-review', priority: 'normal', needsReview: true, confidence: 0.9 },
  routesSha256,
  evidence: { taskSha256, requestSha256: 'b'.repeat(64), responseSha256: 'c'.repeat(64), elapsedMs: 12 },
};

function makeJob(overrides = {}) {
  return createRoutingJob({
    task, sourceRunId: 'run.route.1', sourceThreadId, routes,
    jevAdvisory: advisory, dependencies: [], nowMs: 1_000, ...overrides,
  });
}

test('createRoutingJob binds the exact task, Jev evidence, route and bounded deadline', () => {
  const job = makeJob();
  assert.equal(job.kind, 'nisi.routing.job.v1');
  assert.equal(job.taskSha256, taskSha256);
  assert.equal(job.targetThreadId, routes[0].targetThreadId);
  assert.equal(job.expiresAtMs, 31_000);
  assert.equal(job.requiresReview, true);
  assert.match(job.dedupeKey, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(job).includes('Inspect the route contract.'), false);
  assert.equal(routingJobExpired(job, 1_000), false);
  assert.equal(routingJobExpired(job, 31_000), true);
});

test('toRoutingLedgerPayload omits source text and preserves a stable dedupe payload', () => {
  const job = makeJob();
  const payload = toRoutingLedgerPayload(job);
  assert.equal(payload.targetThreadId, job.targetThreadId);
  assert.equal(payload.expiresAt, 31);
  assert.equal(payload.dedupeKey, job.dedupeKey);
  assert.equal(payload.routingJob.taskSha256, taskSha256);
  assert.equal(JSON.stringify(payload).includes('Inspect the route contract.'), false);
});

test('enqueueRoutingJob delegates only to the host store and preserves idempotence', () => {
  const calls = [];
  const store = { enqueue(eventId, payload) { calls.push({ eventId, payload }); return { eventId, state: 'READY', payloadSha256: 'd'.repeat(64) }; } };
  const job = makeJob();
  const result = enqueueRoutingJob(store, job, 1_000);
  assert.equal(result.eventId, job.jobId);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.routingJob.routeId, 'nisi-review');
});

test('enqueueRoutingJob refuses expired jobs before calling the host store', () => {
  const calls = [];
  const store = { enqueue(...args) { calls.push(args); return { state: 'READY' }; } };
  const job = makeJob();
  assert.throws(() => enqueueRoutingJob(store, job, job.expiresAtMs), /ROUTING_JOB_EXPIRED/);
  assert.throws(() => enqueueRoutingJob(store, job, job.expiresAtMs + 1), /ROUTING_JOB_EXPIRED/);
  assert.equal(calls.length, 0);
  assert.equal(enqueueRoutingJob(store, job, job.expiresAtMs - 1).state, 'READY');
  assert.equal(calls.length, 1);
});

test('enqueueRoutingJob refuses the last partial second after ledger expiry', () => {
  const calls = [];
  const store = { enqueue(...args) { calls.push(args); return { state: 'READY' }; } };
  const job = makeJob({ nowMs: 1_001 });
  assert.equal(job.expiresAtMs, 31_001);
  assert.equal(toRoutingLedgerPayload(job).expiresAt, 31);
  // The host ledger receives whole seconds. Its expiry has arrived at
  // 31_000 ms even though the millisecond job deadline is one ms later.
  assert.equal(routingJobExpired(job, 30_999), false);
  assert.equal(routingJobExpired(job, 31_000), true);
  assert.equal(enqueueRoutingJob(store, job, 30_999).state, 'READY');
  assert.equal(calls.length, 1);
  calls.length = 0;
  assert.throws(() => enqueueRoutingJob(store, job, 31_000), /ROUTING_JOB_EXPIRED/);
  assert.equal(calls.length, 0);
});

test('enqueueRoutingJob requires a valid caller-supplied clock before calling the host store', () => {
  const calls = [];
  const store = { enqueue(...args) { calls.push(args); return { state: 'READY' }; } };
  const job = makeJob();
  for (const invalidNowMs of [undefined, null, -1, 1.5, NaN, Infinity, '1000']) {
    assert.throws(() => enqueueRoutingJob(store, job, invalidNowMs), /ROUTING_CLOCK_INVALID/);
  }
  assert.equal(calls.length, 0);
});

test('queue refuses self handoff, stale confidence, mismatched Jev binding and malformed routes', () => {
  assert.throws(() => normalizeRoutingRoutes([routes[0], { ...routes[1], id: routes[0].id }]), /ROUTING_ROUTES_DUPLICATE/);
  assert.throws(() => makeJob({ sourceThreadId: routes[0].targetThreadId }), /ROUTING_SELF_HANDOFF/);
  assert.throws(() => makeJob({ jevAdvisory: { ...advisory, taskSha256: 'e'.repeat(64) } }), /ROUTING_JEV_BINDING_INVALID/);
  assert.throws(() => makeJob({ jevAdvisory: { ...advisory, routing: { ...advisory.routing, confidence: 0.59 } } }), /ROUTING_JEV_PROPOSAL_INVALID/);
  assert.throws(() => makeJob({ jevAdvisory: { ...advisory, routing: { ...advisory.routing, routeId: 'hold' } } }), /ROUTING_JEV_PROPOSAL_INVALID/);
  assert.throws(() => makeJob({ jevAdvisory: { ...advisory, routing: null } }), /ROUTING_JEV_PROPOSAL_INVALID/);
});
