// Node-enhancement tests (framework wave): one genuine new capability per
// BN01 node, with deterministic validation against real BN01 fixtures.
//   1. default-contribution-rounds  -> routeStatus() audit
//   2. admitted-run-owner            -> ledger() append-only trail
//   3. contribution-admission        -> outcome ledger for every attempt
//   4. typed-contribution-combiner   -> STRING type (UTF-8, NUL-free)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createDefaultContributionRounds } from '../neural/default-contribution-rounds.mjs';
import { createAdmittedRunOwner } from '../neural/admitted-run-owner.mjs';
import { createContributionAdmission } from '../neural/contribution-admission.mjs';
import { createTypedContributionCombiner } from '../neural/typed-contribution-combiner.mjs';
import { typedContext } from './fixtures/typed-context.mjs';

const sha = s => createHash('sha256').update(s).digest('hex');
const CONTEXT = typedContext();
const PINS = Object.freeze(CONTEXT.pins);
const SPACE = sha('space');
const GEN = 5;

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// ---- 1. rounds: routeStatus audit ----
test('rounds: routeStatus audits ALLOW, remembered refusals, and unknown routes', () => {
  const session = Buffer.from(canonical({ kind: 'veritas-default-round-session-v1',
    sessionId: 'sess-audit', requester: 'PRIMARY', generation: GEN, defaultCap: 3,
    routes: [
      { channelId: 'chan-ok', fromNodeId: 'n-a', toNodeId: 'n-b', state: 'ALLOW' },
      { channelId: 'chan-deny', fromNodeId: 'n-a', toNodeId: 'n-b', state: 'DENIED' },
    ] }));
  const made = createDefaultContributionRounds(session, { generation: GEN });
  assert.equal(made.ok, true);
  const rounds = made.rounds;

  const before = rounds.routeStatus('chan-deny');
  assert.equal(before.code, 'ROUTE_STATUS');
  assert.equal(before.state, 'DENIED');
  assert.equal(before.rememberedRefusal, false);

  const refused = rounds.proposeRound(canonical({ kind: 'veritas-default-round-request-v1',
    roundId: 'round-1', sessionId: 'sess-audit', channelId: 'chan-deny',
    requester: 'PRIMARY', generation: GEN, expertise: 'x', ttlMs: 30000 }));
  assert.equal(refused.code, 'ROUND_ROUTE_DENIED');

  const after = rounds.routeStatus('chan-deny');
  assert.equal(after.rememberedRefusal, true); // recast on this channel is remembered

  const recast = rounds.proposeRound(canonical({ kind: 'veritas-default-round-request-v1',
    roundId: 'round-2', sessionId: 'sess-audit', channelId: 'chan-deny',
    requester: 'PRIMARY', generation: GEN, expertise: 'y', ttlMs: 1 }));
  assert.equal(recast.code, 'ROUND_ROUTE_REMEMBRANCE_REFUSED');

  assert.equal(rounds.routeStatus('chan-unknown').code, 'ROUTE_UNKNOWN');
  assert.equal(rounds.routeStatus('NOT AN ID').code, 'ROUTE_STATUS_INVALID_ID');
});

// ---- 2. owner: append-only ledger ----
test('owner: ledger records issue -> execution -> revocation in order', () => {
  let now = 1000;
  const bind = Buffer.from(canonical({ kind: 'veritas-admitted-run-bind-v1',
    profile: 'veritas-bn01-offline-contract-v1', schemaVersion: 1,
    generation: GEN, runBudgetCap: 4, deadlineMs: 60000, ...PINS }));
  const made = createAdmittedRunOwner(bind, { clock: () => now });
  assert.equal(made.ok, true);
  const owner = made.owner;

  assert.equal(owner.ledger().count, 0);

  const permit = owner.requestPermit(canonical({ kind: 'veritas-admitted-run-permit-request-v1',
    runId: 'run-a', requester: 'PRIMARY', generation: GEN, scope: 's' }));
  assert.equal(permit.code, 'PERMIT_ISSUED');
  now += 10;
  const exec = owner.checkExecution(canonical({ kind: 'veritas-admitted-run-execution-v1',
    permitId: permit.permitId, runId: 'run-a', requester: 'PRIMARY',
    generation: GEN, scope: 's', ...PINS }));
  assert.equal(exec.code, 'ADMITTED');
  now += 10;
  owner.revoke(permit.permitId);

  const ledger = owner.ledger();
  assert.equal(ledger.count, 3);
  assert.deepEqual(ledger.entries.map(e => e.event),
    ['PERMIT_ISSUED', 'EXECUTION_ADMITTED', 'PERMIT_REVOKED']);
  // Cancellation is clock-independent. Its timestamp explicitly names the last
  // successful operation sample, not the instant of cancellation (1020).
  assert.deepEqual(ledger.entries.map(e => e.atMs), [1000, 1010, 1010]);
  assert.deepEqual(ledger.entries.map(e => e.timeBasis),
    ['OPERATION_SAMPLE', 'OPERATION_SAMPLE', 'LAST_VALID_SAMPLE']);
  assert.equal(ledger.generation, GEN);
});

// ---- 3. glue: outcome ledger journals refusals and dispatches ----
test('glue: every attempt lands one ledger entry, refusals included', () => {
  const config = Buffer.from(canonical({ kind: 'veritas-contribution-admission-config-v1',
    profile: 'veritas-bn03-offline-contract-v1', schemaVersion: 1,
    generation: GEN, maxAttempts: 8, packetBytesLimit: 1024 }));
  const made = createContributionAdmission(config, {});
  assert.equal(made.ok, true);
  const glue = made.admit;

  const attempt = id => canonical({ kind: 'veritas-contribution-admission-v1',
    attemptId: id, requester: 'PRIMARY', generation: GEN });
  const okGates = {
    round: canonical({ outcome: 'DEFAULT_ROUND_DISPATCHED', channelId: 'chan-1' }),
    owner: canonical({ outcome: 'ADMITTED', permitId: 'permit-1' }),
    queue: canonical({ state: 'QUEUED', inFlight: 0, capacity: 2,
      retainedTasks: 0, packetBytes: 128 }),
  };

  const r1 = glue.admissionAttempt(attempt('att-1'), {
    ...okGates, round: canonical({ outcome: 'ROUND_ROUTE_DENIED', channelId: 'chan-1' }) });
  assert.equal(r1.code, 'CONTRIBUTION_ROUND_REFUSED');
  assert.equal(r1.ok, false);

  const r2 = glue.admissionAttempt(attempt('att-2'), {
    ...okGates, owner: canonical({ outcome: 'LATE_OUTPUT_REFUSED', permitId: 'permit-1' }) });
  assert.equal(r2.code, 'CONTRIBUTION_OWNER_REFUSED');

  const r3 = glue.admissionAttempt(attempt('att-3'), okGates);
  assert.equal(r3.code, 'CONTRIBUTION_DISPATCHED');
  assert.equal(r3.ok, true);

  const r4 = glue.admissionAttempt('not json', okGates);
  assert.equal(r4.code, 'JSON_INVALID');

  const ledger = glue.ledger();
  assert.equal(ledger.count, 4);
  assert.deepEqual(ledger.entries.map(e => e.code),
    ['CONTRIBUTION_ROUND_REFUSED', 'CONTRIBUTION_OWNER_REFUSED',
     'CONTRIBUTION_DISPATCHED', 'JSON_INVALID']);
  assert.deepEqual(ledger.entries.map(e => e.attemptId),
    ['att-1', 'att-2', 'att-3', null]);
  assert.deepEqual(ledger.entries.map(e => e.ok), [false, false, true, false]);
  assert.equal(ledger.generation, GEN);
});

// ---- 4. combiner: STRING type ----
function baseBytes() {
  return Buffer.from(CONTEXT.baseBytes);
}
function dualBytes() {
  return Buffer.from(CONTEXT.dualBytes);
}
function makeCombiner() {
  const r = createTypedContributionCombiner(baseBytes(), dualBytes(), { generation: GEN });
  assert.equal(r.ok, true);
  return r.combiner;
}
function contributor(id, type, width) {
  return { kind: 'veritas-typed-contribution-contributor-v1', contributorId: id,
    role: `role-${id}`, revision: 1, outputType: type, outputWidth: width,
    spaceSha256: SPACE, maxPayloadBytes: 4096 };
}
function taskValue(ids, over = {}) {
  return { kind: 'veritas-typed-contribution-task-v1', taskId: 'task-s-1',
    requester: 'PRIMARY', graphSha256: PINS.graphSha256, runSha256: PINS.runSha256,
    topologySha256: PINS.topologySha256, planSha256: PINS.planSha256,
    generation: GEN, requiredContributors: ids, deadlineMs: 30000, ...over };
}
const taskDigest = v => sha('veritas/typed-contribution/veritas-typed-contribution-task-v1\0' + canonical(v));
function response(id, digest, payload) {
  return { kind: 'veritas-typed-contribution-response-v1', contributorId: id,
    taskId: 'task-s-1', taskDigest: digest, outcome: 'RESPONSE_OK',
    payloadSha256: sha(payload) };
}
function admitHappy(combiner, ids, payloads = ['a', 'b', 'c']) {
  for (const id of ids) {
    assert.equal(combiner.admitContributor(canonical(contributor(id, 'STRING', 3))).ok, true);
  }
  const task = taskValue(ids);
  const digest = taskDigest(task);
  assert.equal(combiner.admitTask(canonical(task)).ok, true);
  const entries = [];
  for (let i = 0; i < ids.length; i++) {
    const payload = Buffer.from(payloads[i]);
    const rec = response(ids[i], digest, payload);
    assert.equal(combiner.admitResponse(canonical(rec), payload).ok, true);
    entries.push({ text: canonical(rec), payload });
  }
  return { task, entries };
}

test('combiner: STRING entries combine in declared order with NUL separators', () => {
  const combiner = makeCombiner();
  const ids = ['c-1', 'c-2', 'c-3'];
  const { task, entries } = admitHappy(combiner, ids, ['alpha', 'beta', 'gamma']);
  const out = combiner.combine(canonical(task), entries);
  assert.equal(out.ok, true);
  assert.equal(out.code, 'TYPED_COMBINE_COMPLETE');
  assert.equal(out.type, 'STRING');
  assert.equal(out.width, 3);
  const joined = Buffer.concat([Buffer.from('alpha'), Buffer.from([0]),
    Buffer.from('beta'), Buffer.from([0]), Buffer.from('gamma')]);
  assert.equal(out.combinedSha256, sha(joined));
  assert.equal(out.combinedBytes, joined.length);
});

test('combiner: STRING admission refuses bad UTF-8, empty and NUL payloads', () => {
  const combiner = makeCombiner();
  const ids = ['c-1', 'c-2', 'c-3'];
  for (const id of ids) {
    assert.equal(combiner.admitContributor(canonical(contributor(id, 'STRING', 3))).ok, true);
  }
  const task = taskValue(ids);
  const digest = taskDigest(task);
  assert.equal(combiner.admitTask(canonical(task)).ok, true);
  const cases = [Buffer.from([0xff, 0xfe]), Buffer.from('a\0b'), Buffer.from('')];
  const codes = ['PAYLOAD_TYPE_DOMAIN_INVALID', 'PAYLOAD_TYPE_DOMAIN_INVALID',
    'PAYLOAD_BYTES_REFUSED'];
  for (let i = 0; i < cases.length; i++) {
    const payload = cases[i];
    const rec = response(ids[i], digest, payload);
    assert.equal(combiner.admitResponse(canonical(rec), payload).code, codes[i]);
  }
});

test('combiner: STRING width inconsistency is refused at combine', () => {
  const combiner = makeCombiner();
  const ids = ['c-1', 'c-2', 'c-3'];
  for (const [i, id] of ids.entries()) {
    // c-2 declares a different width than the others -> WIDTH_MISMATCH
    assert.equal(combiner.admitContributor(canonical(contributor(id, 'STRING',
      i === 1 ? 2 : 3))).ok, true);
  }
  const task = taskValue(ids);
  const digest = taskDigest(task);
  assert.equal(combiner.admitTask(canonical(task)).ok, true);
  const entries = [];
  for (const [i, id] of ids.entries()) {
    const payload = Buffer.from(['x', 'y', 'z'][i]);
    const rec = response(id, digest, payload);
    assert.equal(combiner.admitResponse(canonical(rec), payload).ok, true);
    entries.push({ text: canonical(rec), payload });
  }
  const out = combiner.combine(canonical(task), entries);
  assert.equal(out.ok, false);
  assert.equal(out.code, 'WIDTH_MISMATCH');
});

test('combiner: STRING vs BOOL type mixing is refused at combine', () => {
  const combiner = makeCombiner();
  const ids = ['c-1', 'c-2'];
  assert.equal(combiner.admitContributor(canonical(contributor('c-1', 'STRING', 2))).ok, true);
  assert.equal(combiner.admitContributor(canonical(contributor('c-2', 'BOOL', 2))).ok, true);
  const task = taskValue(ids);
  const digest = taskDigest(task);
  assert.equal(combiner.admitTask(canonical(task)).ok, true);
  const entries = [];
  for (const [id2, payload] of [['c-1', Buffer.from('ab')], ['c-2', Buffer.from([1, 1])]]) {
    const rec = response(id2, digest, payload);
    assert.equal(combiner.admitResponse(canonical(rec), payload).ok, true);
    entries.push({ text: canonical(rec), payload });
  }
  const out = combiner.combine(canonical(task), entries);
  assert.equal(out.ok, false);
  assert.equal(out.code, 'TYPE_MISMATCH');
});
