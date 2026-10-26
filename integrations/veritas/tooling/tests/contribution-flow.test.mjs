// End-to-end contribution-flow proof (BN03 integration slice). Composes the
// REAL modules - default-contribution-rounds -> admitted-run-owner ->
// contribution-admission -> typed-contribution-combiner - with one shared
// generation and identity, proving the refusal ledger, the one-use admit gate
// and the admission cap compose refusal-dominantly and never execute anything.
// Typed admission uses the production BN01 validators and their real fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createDefaultContributionRounds } from '../neural/default-contribution-rounds.mjs';
import { createAdmittedRunOwner } from '../neural/admitted-run-owner.mjs';
import { createContributionAdmission } from '../neural/contribution-admission.mjs';
import { createTypedContributionCombiner } from '../neural/typed-contribution-combiner.mjs';
import { typedContext } from './fixtures/typed-context.mjs';

const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
const shaB = buf => createHash('sha256').update(buf).digest('hex');
const shaT = text => createHash('sha256').update(text).digest('hex');

const GENERATION = 7;
const CONTEXT = typedContext();
const PINS = CONTEXT.pins;
const ALLOW = { channelId: 'ch-open', fromNodeId: 'n-a', toNodeId: 'n-b', state: 'ALLOW' };
const DENIED = { channelId: 'ch-blocked', fromNodeId: 'n-a', toNodeId: 'n-b', state: 'DENIED' };
const UNAVAILABLE = { channelId: 'ch-busy', fromNodeId: 'n-a', toNodeId: 'n-b', state: 'UNAVAILABLE' };

const session = (routes) => canonical({ kind: 'veritas-default-round-session-v1',
  sessionId: 'sess-flow-01', requester: 'PRIMARY', generation: GENERATION, defaultCap: 3, routes });
const roundRequest = (channelId) => canonical({ kind: 'veritas-default-round-request-v1',
  roundId: 'rr-flow-01', sessionId: 'sess-flow-01', channelId, requester: 'PRIMARY',
  generation: GENERATION, expertise: 'ex-flow', ttlMs: 5000 });
const ownerBind = () => canonical({ kind: 'veritas-admitted-run-bind-v1',
  profile: 'veritas-bn01-offline-contract-v1', schemaVersion: 1, generation: GENERATION,
  runBudgetCap: 10, deadlineMs: 60000, ...PINS });
const permitRequest = () => canonical({ kind: 'veritas-admitted-run-permit-request-v1',
  runId: 'run-flow', requester: 'PRIMARY', generation: GENERATION, scope: 'contribution' });
const execution = (permitId) => canonical({ kind: 'veritas-admitted-run-execution-v1',
  permitId, runId: 'run-flow', requester: 'PRIMARY', generation: GENERATION, scope: 'contribution', ...PINS });
const admissionConfig = (overrides = {}) => canonical({ kind: 'veritas-contribution-admission-config-v1',
  profile: 'veritas-bn03-offline-contract-v1', schemaVersion: 1, generation: GENERATION,
  maxAttempts: 3, packetBytesLimit: 65536, ...overrides });
const attempt = (attemptId) => canonical({ kind: 'veritas-contribution-admission-v1',
  attemptId, requester: 'PRIMARY', generation: GENERATION });
const roundGate = (outcome, channelId = 'ch-open') => canonical({ outcome, channelId });
const ownerGate = (outcome, permitId = 'permit-flow') => canonical({ outcome, permitId });
const queueGate = () => canonical({ state: 'QUEUED', inFlight: 1, capacity: 4,
  retainedTasks: 7, packetBytes: 4096 });

let time = 0;
const clock = () => time;

function roundsFlow(routes) {
  const r = createDefaultContributionRounds(Buffer.from(session(routes), 'utf8'), { generation: GENERATION });
  assert.equal(r.ok, true);
  const channel = routes[0].channelId;
  return { rounds: r.rounds, round: r.rounds.proposeRound(roundRequest(channel)) };
}
function ownerFlow() {
  const r = createAdmittedRunOwner(Buffer.from(ownerBind(), 'utf8'), { clock });
  assert.equal(r.ok, true);
  return r.owner;
}
function admissionFlow(config = admissionConfig()) {
  const r = createContributionAdmission(Buffer.from(config, 'utf8'), { clock });
  assert.equal(r.ok, true);
  return r.admit;
}

const BASE = CONTEXT.baseBytes.toString('utf8');
const DUAL = CONTEXT.dualBytes.toString('utf8');
const f64 = vals => { const b = Buffer.alloc(8 * vals.length); vals.forEach((v, i) => b.writeDoubleLE(v, i * 8)); return b; };
const typedTask = () => canonical({ kind: 'veritas-typed-contribution-task-v1',
  taskId: 'task-flow-01', requester: 'PRIMARY', ...PINS, generation: GENERATION,
  requiredContributors: ['c1', 'c2'], deadlineMs: 60000 });
const typedDigest = () => shaT('veritas/typed-contribution/veritas-typed-contribution-task-v1\u0000' + typedTask());
const typedContributor = (id) => canonical({ kind: 'veritas-typed-contribution-contributor-v1',
  contributorId: id, role: 'ex-contrib', revision: 1, outputType: 'F64', outputWidth: 1,
  spaceSha256: 'e'.repeat(64), maxPayloadBytes: 65536 });
const typedResponse = (id, payload, d) => canonical({ kind: 'veritas-typed-contribution-response-v1',
  contributorId: id, taskId: 'task-flow-01', taskDigest: d, outcome: 'RESPONSE_OK', payloadSha256: shaB(payload) });

/** Full happy-flow rig: one ALLOW round, one admitted owner run, one dispatch. */
function happyRig() {
  const { rounds, round } = roundsFlow([ALLOW]);
  assert.equal(round.code, 'DEFAULT_ROUND_DISPATCHED');
  const owner = ownerFlow();
  const permit = owner.requestPermit(permitRequest());
  assert.equal(permit.code, 'PERMIT_ISSUED');
  const admitted = owner.checkExecution(execution(permit.permitId));
  assert.equal(admitted.code, 'ADMITTED');
  const admit = admissionFlow();
  const dispatched = admit.admissionAttempt(attempt('ca-flow-01'), {
    round: roundGate(round.code, ALLOW.channelId), owner: ownerGate('ADMITTED', permit.permitId), queue: queueGate(),
  });
  assert.equal(dispatched.code, 'CONTRIBUTION_DISPATCHED');
  return { rounds, round, owner, permit, admitted, admit, dispatched };
}

test('the full allowed flow: round dispatch -> owner admit -> glue dispatch -> typed combine', () => {
  const { dispatched } = happyRig();
  assert.equal(dispatched.ok, true);
  assert.equal(dispatched.authorizing, false);
  // typed combine after dispatch (same generation, same identity pins)
  const combiner = createTypedContributionCombiner(Buffer.from(BASE, 'utf8'), Buffer.from(DUAL, 'utf8'), { generation: GENERATION });
  assert.equal(combiner.ok, true);
  combiner.combiner.admitContributor(typedContributor('c1'));
  combiner.combiner.admitContributor(typedContributor('c2'));
  const t = combiner.combiner.admitTask(typedTask());
  assert.equal(t.code, 'TASK_ADMITTED');
  const d = typedDigest();
  const p1 = f64([1.5]);
  const p2 = f64([2.5]);
  combiner.combiner.admitResponse(typedResponse('c1', p1, d), p1);
  combiner.combiner.admitResponse(typedResponse('c2', p2, d), p2);
  const combined = combiner.combiner.combine(typedTask(), [
    { text: typedResponse('c1', p1, d), payload: p1 },
    { text: typedResponse('c2', p2, d), payload: p2 },
  ]);
  assert.equal(combined.code, 'TYPED_COMBINE_COMPLETE');
  assert.equal(combined.type, 'F64');
  assert.equal(combined.combinedBytes, 8);
  for (const outcome of [dispatched, combined]) {
    assert.equal(outcome.authorizing, false);
    assert.equal(outcome.modelExecuted, false);
    assert.equal(outcome.promotionGranted, false);
    assert.equal(outcome.certificationGranted, false);
  }
});

test('a DENIED round stops the flow before the owner is ever consulted', () => {
  const { round } = roundsFlow([DENIED]);
  assert.equal(round.code, 'ROUND_ROUTE_DENIED');
  // No owner exists yet: the glue refuses at gate 1 without one (declared gates only).
  const admit = admissionFlow();
  const verdict = admit.admissionAttempt(attempt('ca-flow-02'), {
    round: roundGate(round.code, DENIED.channelId), owner: ownerGate('ADMITTED'), queue: queueGate(),
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, 'CONTRIBUTION_ROUND_REFUSED');
  assert.equal(verdict.roundOutcome, 'ROUND_ROUTE_DENIED');
});

test('an UNAVAILABLE round refuses the contribution with its route state intact', () => {
  const { round } = roundsFlow([UNAVAILABLE]);
  assert.equal(round.code, 'ROUND_ROUTE_UNAVAILABLE');
  const admit = admissionFlow();
  const verdict = admit.admissionAttempt(attempt('ca-flow-03'), {
    round: roundGate(round.code, UNAVAILABLE.channelId), owner: ownerGate('ADMITTED'), queue: queueGate(),
  });
  assert.equal(verdict.code, 'CONTRIBUTION_ROUND_REFUSED');
  assert.equal(verdict.roundOutcome, 'ROUND_ROUTE_UNAVAILABLE');
});

test('a round dispatch with a stale owner check refuses at gate 2', () => {
  const { round } = roundsFlow([ALLOW]);
  const owner = ownerFlow();
  const permit = owner.requestPermit(permitRequest());
  time = 0;
  const owner2 = ownerFlow();
  const permit2 = owner2.requestPermit(permitRequest());
  time = 60001; // past the 60000ms window
  const stale = owner2.checkExecution(execution(permit2.permitId));
  assert.equal(stale.code, 'PERMIT_STALE');
  const admit = admissionFlow();
  const verdict = admit.admissionAttempt(attempt('ca-flow-04'), {
    round: roundGate(round.code, ALLOW.channelId), owner: ownerGate(stale.code, permit2.permitId), queue: queueGate(),
  });
  assert.equal(verdict.code, 'CONTRIBUTION_OWNER_REFUSED');
  assert.equal(verdict.ownerOutcome, 'PERMIT_STALE');
});

test('a revoked owner refuses the flow permanently for that generation', () => {
  const { round } = roundsFlow([ALLOW]);
  const owner = ownerFlow();
  const permit = owner.requestPermit(permitRequest());
  owner.revoke(permit.permitId);
  assert.equal(owner.checkExecution(execution(permit.permitId)).code, 'PERMIT_REVOKED');
  const admit = admissionFlow();
  const verdict = admit.admissionAttempt(attempt('ca-flow-05'), {
    round: roundGate('DEFAULT_ROUND_DISPATCHED', ALLOW.channelId), owner: ownerGate('PERMIT_REVOKED', permit.permitId), queue: queueGate(),
  });
  assert.equal(verdict.code, 'CONTRIBUTION_OWNER_REFUSED');
  assert.equal(verdict.ownerOutcome, 'PERMIT_REVOKED');
});

test('the admission cap exhausts the whole flow after exactly three attempts', () => {
  const admit = admissionFlow();
  const gates = { round: roundGate('DEFAULT_ROUND_DISPATCHED'), owner: ownerGate('ADMITTED'), queue: queueGate() };
  for (let i = 1; i <= 3; i++) {
    assert.equal(admit.admissionAttempt(attempt(`ca-flow-cap-${i}`), gates).code, 'CONTRIBUTION_DISPATCHED');
  }
  const exhausted = admit.admissionAttempt(attempt('ca-flow-cap-4'), gates);
  assert.equal(exhausted.code, 'CAP_EXHAUSTED');
  assert.equal(exhausted.ok, false);
});

test('a generation mismatch at any layer refuses that layer', () => {
  const r = createDefaultContributionRounds(Buffer.from(session([ALLOW]), 'utf8'),
    { generation: GENERATION });
  assert.equal(r.rounds.proposeRound(canonical({ kind: 'veritas-default-round-request-v1',
    roundId: 'rr-gen', sessionId: 'sess-flow-01', channelId: 'ch-open', requester: 'PRIMARY',
    generation: GENERATION + 1, expertise: 'ex-flow', ttlMs: 5000 })).code, 'ROUND_GENERATION_MISMATCH');
  const owner = ownerFlow();
  assert.equal(owner.requestPermit(canonical({ kind: 'veritas-admitted-run-permit-request-v1',
    runId: 'run-flow', requester: 'PRIMARY', generation: GENERATION + 1, scope: 'contribution' })).code, 'PERMIT_GENERATION_MISMATCH');
  const admit = admissionFlow();
  const mismatch = admit.admissionAttempt(canonical({ kind: 'veritas-contribution-admission-v1',
    attemptId: 'ca-gen', requester: 'PRIMARY', generation: GENERATION + 1 }), {
    round: roundGate('DEFAULT_ROUND_DISPATCHED'), owner: ownerGate('ADMITTED'), queue: queueGate(),
  });
  assert.equal(mismatch.code, 'ADMISSION_GENERATION_MISMATCH');
  // The combiner now refuses a foreign generation before task admission too.
  const combiner = createTypedContributionCombiner(Buffer.from(BASE, 'utf8'), Buffer.from(DUAL, 'utf8'), { generation: GENERATION });
  assert.equal(combiner.ok, true);
  combiner.combiner.admitContributor(typedContributor('c1'));
  const genTask = canonical({ kind: 'veritas-typed-contribution-task-v1',
    taskId: 'task-flow-01', requester: 'PRIMARY', ...PINS, generation: GENERATION + 1,
    requiredContributors: ['c1'], deadlineMs: 60000 });
  assert.equal(combiner.combiner.admitTask(genTask).code, 'TASK_GENERATION_MISMATCH');
  assert.equal(combiner.combiner.combine(genTask, []).code, 'TASK_GENERATION_MISMATCH');
});

test('a non-finite payload never reaches the flow: the refusal precedes any dispatch', () => {
  const combiner = createTypedContributionCombiner(Buffer.from(BASE, 'utf8'), Buffer.from(DUAL, 'utf8'), { generation: GENERATION });
  assert.equal(combiner.ok, true);
  combiner.combiner.admitContributor(typedContributor('c1'));
  combiner.combiner.admitContributor(typedContributor('c2'));
  combiner.combiner.admitTask(typedTask());
  const d = typedDigest();
  const bad = Buffer.alloc(8);
  bad.writeDoubleLE(NaN, 0);
  const refused = combiner.combiner.admitResponse(typedResponse('c1', bad, d), bad);
  assert.equal(refused.code, 'PAYLOAD_TYPE_DOMAIN_INVALID');
  assert.equal(refused.modelExecuted, false);
});
