// Deterministic contract tests for the BN-03 contribution-admission glue:
// refusal dominance across rounds/owner/queue gates, bounded attempts, closed
// gate reader. The queues are declared snapshots, never real queue instances.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContributionAdmission } from '../neural/contribution-admission.mjs';

const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const newConfig = (overrides = {}) => canonical({ kind: 'veritas-contribution-admission-config-v1',
  profile: 'veritas-bn03-offline-contract-v1', schemaVersion: 1, generation: 7,
  maxAttempts: 3, packetBytesLimit: 65536, ...overrides });
const newAttempt = (overrides = {}) => canonical({ kind: 'veritas-contribution-admission-v1',
  attemptId: 'ca-01', requester: 'PRIMARY', generation: 7, ...overrides });
const roundGate = (outcome = 'DEFAULT_ROUND_DISPATCHED', channelId = 'ch-open') =>
  canonical({ outcome, channelId });
const ownerGate = (outcome = 'ADMITTED', permitId = 'permit-r1') => canonical({ outcome, permitId });
const queueGate = (overrides = {}) => canonical({ state: 'QUEUED', inFlight: 1, capacity: 4,
  retainedTasks: 7, packetBytes: 4096, ...overrides });

let time = 0;
const clock = () => time;
const bind = (configBytes = newConfig(), options = {}) =>
  createContributionAdmission(Buffer.from(configBytes, 'utf8'), { clock, ...options });
const attempt = (admit, gates, input = newAttempt()) => admit.admissionAttempt(input, gates);

test('malformed traffic cannot retain an unbounded refusal ledger', () => {
  const r = bind(newConfig({ maxAttempts: 1 }));
  assert.equal(r.admit.admissionAttempt('{bad', {}).code, 'JSON_INVALID');
  assert.equal(r.admit.admissionAttempt('{bad', {}).code, 'JSON_INVALID');
  for (let i = 0; i < 10000; i++) {
    assert.equal(r.admit.admissionAttempt('{bad', {}).code, 'LEDGER_CAP_EXHAUSTED');
  }
  assert.equal(r.admit.ledger().count, 2);
  assert.equal(r.admit.ledger().capacity, 2);
  assert.equal(r.admit.ledger().saturated, true);
  assert.equal(r.admit.status().attemptsUsed, 0);
});

test('refusal ledger never stores invalid caller-controlled attempt identity', () => {
  const r = bind();
  const raw = canonical({ attemptId: { secret: 'must-not-be-retained' } });
  assert.equal(r.admit.admissionAttempt(raw, {}).ok, false);
  assert.equal(r.admit.ledger().entries[0].attemptId, null);
  assert.equal(r.admit.admissionAttempt('x'.repeat(65537), {}).code, 'ADMISSION_BYTES_REFUSED');
});

test('factory binds a closed admission config and reports EMPTY status', () => {
  const r = bind();
  assert.equal(r.ok, true);
  assert.equal(r.code, 'READY_PRIVATE_CONTRIBUTION_ADMISSION_ONLY');
  assert.equal(r.authorizing, false);
  const s = r.admit.status();
  assert.equal(s.ok, true);
  assert.equal(s.attemptsUsed, 0);
  assert.equal(s.maxAttempts, 3);
});

test('factory refuses invalid config bytes, wrong shape or a bad cap', () => {
  assert.equal(bind(Buffer.from('{bad', 'utf8')).ok, false);
  assert.equal(bind(newConfig({ maxAttempts: 0 })).ok, false);
  assert.equal(bind(newConfig({ maxAttempts: 0.5 })).ok, false);
  assert.equal(bind(newConfig({ generation: 0 })).ok, false);
  assert.equal(bind(newConfig({ packetBytesLimit: 4 })).ok, false);
  assert.equal(bind(newConfig({ profile: 'other' })).ok, false);
  assert.equal(bind(newConfig({ kind: 'veritas-contribution-admission-config-v2' })).ok, false);
});

test('an ALLOW round with an admitted owner and room in the queue dispatches (advisory)', () => {
  const r = bind();
  assert.equal(r.ok, true);
  const d = attempt(r.admit, { round: roundGate(), owner: ownerGate(), queue: queueGate() });
  assert.equal(d.ok, true);
  assert.equal(d.code, 'CONTRIBUTION_DISPATCHED');
  assert.equal(d.queueState, 'QUEUED');
  assert.equal(d.attemptsUsed, 1);
  assert.equal(d.authorizing, false);
  assert.equal(d.modelExecuted, false);
  assert.equal(d.promotionGranted, false);
  assert.equal(d.certificationGranted, false);
});

test('a denied or unavailable round refuses the contribution at gate 1', () => {
  const r = bind();
  for (const outcome of ['ROUND_ROUTE_DENIED', 'ROUND_ROUTE_UNAVAILABLE', 'SESSION_ROUNDS_EXHAUSTED']) {
    const d = attempt(r.admit, { round: roundGate(outcome), owner: ownerGate(), queue: queueGate() });
    assert.equal(d.ok, false);
    assert.equal(d.code, 'CONTRIBUTION_ROUND_REFUSED');
    assert.equal(d.roundOutcome, outcome);
  }
});

test('an owner refusal (stale/revoked/consumed) refuses at gate 2 and never dispatches', () => {
  const r = bind(newConfig({ maxAttempts: 8 }));
  for (const outcome of ['PERMIT_STALE', 'PERMIT_REVOKED', 'LATE_OUTPUT_REFUSED', 'PERMIT_ABSENT']) {
    const d = attempt(r.admit, { round: roundGate(), owner: ownerGate(outcome), queue: queueGate() });
    assert.equal(d.ok, false);
    assert.equal(d.code, 'CONTRIBUTION_OWNER_REFUSED');
    assert.equal(d.ownerOutcome, outcome);
  }
  assert.equal(r.admit.status().attemptsUsed, 4); // every schema-valid attempt counted, even refused
});

test('an OFF or BUSY queue refuses at gate 3', () => {
  const r = bind();
  for (const state of ['OFF', 'BUSY']) {
    const d = attempt(r.admit, { round: roundGate(), owner: ownerGate(), queue: queueGate({ state }) });
    assert.equal(d.ok, false);
    assert.equal(d.code, 'CONTRIBUTION_QUEUE_REFUSED');
    assert.equal(d.queueState, state);
  }
});

test('an over-capacity or oversized packet is refused (bounded queue, never trusted)', () => {
  const r = bind();
  const over = attempt(r.admit, { round: roundGate(), owner: ownerGate(), queue: queueGate({ inFlight: 4, capacity: 4 }) });
  assert.equal(over.ok, false);
  assert.equal(over.code, 'CONTRIBUTION_QUEUE_REFUSED');
  assert.equal(over.queueState, 'CAPACITY');
  const r2 = bind();
  const big = attempt(r2.admit, { round: roundGate(), owner: ownerGate(), queue: queueGate({ packetBytes: 65537 }) });
  assert.equal(big.ok, false);
  assert.equal(big.code, 'CONTRIBUTION_QUEUE_REFUSED');
  assert.equal(big.queueState, 'PACKET_OVER_LIMIT');
});

test('the hard cap refuses even a fully allowed fourth attempt (no indefinite work)', () => {
  const r = bind();
  let last;
  for (let i = 0; i < 3; i++) last = attempt(r.admit, { round: roundGate(), owner: ownerGate(), queue: queueGate() });
  assert.equal(last.ok, true);
  const nope = attempt(r.admit, { round: roundGate(), owner: ownerGate(), queue: queueGate() });
  assert.equal(nope.ok, false);
  assert.equal(nope.code, 'CAP_EXHAUSTED');
  assert.equal(r.admit.status().attemptsUsed, 4);
});

test('an unknown outcome in any gate is refused by the closed reader (no smuggling)', () => {
  const r = bind();
  const roundBypass = attempt(r.admit, { round: roundGate('DISPATCH_ANYWAY'), owner: ownerGate(), queue: queueGate() });
  assert.equal(roundBypass.ok, false);
  assert.equal(roundBypass.code, 'GATE_DECLARATIONS_INVALID');
  const ownerBypass = attempt(r.admit, { round: roundGate(), owner: ownerGate('GO_AHEAD'), queue: queueGate() });
  assert.equal(ownerBypass.ok, false);
  const queueBypass = attempt(r.admit, { round: roundGate(), owner: ownerGate(), queue: queueGate({ state: 'EMPTY_OK' }) });
  assert.equal(queueBypass.ok, false);
});

test('non-canonical, malformed or wrong-scope attempts are refused, never a PASS', () => {
  const r = bind();
  assert.equal(attempt(r.admit, { round: roundGate(), owner: ownerGate(), queue: queueGate() }, '{bad').ok, false);
  const ugly = newAttempt().replace('"attemptId"', '"attemptId" ');
  assert.equal(attempt(r.admit, { round: roundGate(), owner: ownerGate(), queue: queueGate() }, ugly).ok, false);
  const wrongGen = attempt(r.admit, { round: roundGate(), owner: ownerGate(), queue: queueGate() },
    newAttempt({ generation: 8 }));
  assert.equal(wrongGen.ok, false);
  assert.equal(wrongGen.code, 'ADMISSION_GENERATION_MISMATCH');
  const relay = attempt(r.admit, { round: roundGate(), owner: ownerGate(), queue: queueGate() },
    newAttempt({ requester: 'RELAY' }));
  assert.equal(relay.ok, false);
  assert.equal(relay.code, 'ADMISSION_SCHEMA_INVALID');
});

test('non-canonical gate declarations are refused without a dispatch', () => {
  const r = bind();
  const gate = roundGate().replace('"channelId"', '"channelId" ');
  const d = attempt(r.admit, { round: gate, owner: ownerGate(), queue: queueGate() });
  assert.equal(d.ok, false);
  assert.equal(d.code, 'GATE_DECLARATIONS_INVALID');
  assert.equal(r.admit.status().attemptsUsed, 1); // still counted: bounded accounting
});

test('every admitted outcome stays frozen and non-authorizing across the flow', () => {
  const r = bind();
  const d = attempt(r.admit, { round: roundGate(), owner: ownerGate(), queue: queueGate() });
  for (const outcome of [d, r.admit.status()]) {
    assert.equal(outcome.authorizing, false);
    assert.equal(outcome.modelExecuted, false);
    assert.equal(outcome.promotionGranted, false);
    assert.equal(outcome.certificationGranted, false);
  }
});
