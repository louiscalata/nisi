import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBn01Fixture, fixtureBytes } from '../neural/bn01-fixture.mjs';
import { makeDualFixture, canonicalFixtureBytes } from '../neural/dual-face-fixture.mjs';
import { createCourierQueue } from '../neural/courier-queue.mjs';

const base = makeBn01Fixture();
const dual = makeDualFixture(base);
const baseBytes = fixtureBytes(base);
const dualBytes = canonicalFixtureBytes(dual);
const channel = dual.topology.record.channels.find(c => c.channelId === 'channel.0.forward');
const graph = base.graph.record;
const run = base.run.record;
const topology = dual.topology.record;
const plan = dual.plan.record;
const space = base.plugins[0].record.output.spaceSha256;
const zeros = '0000000000000000000000000000000000000000000000000000000000000000';
assert.notEqual(zeros, space, 'the substitution fixture must differ from the selected tensor space');
let now = 0;
const clock = () => now;

function bytes(value = {}) {
  const packet = {
    kind: 'veritas-courier-f32-v1', taskId: 'task.1', traveler: 'ELECTRON',
    graphSha256: base.graph.sha256, runSha256: base.run.sha256,
    topologySha256: dual.topology.sha256, planSha256: dual.plan.sha256,
    generation: 1, channelId: channel.channelId, fromPortId: channel.fromPortId,
    toPortId: channel.toPortId, createdAtMs: 0, ttlMs: 1000, hopCount: 1,
    spaceSha256: space, payloadHex: '0000803f000000400000404000008040', ...value,
  };
  return canonicalFixtureBytes(packet);
}
function makeQueue(options = {}) {
  now = 0;
  const made = createCourierQueue(baseBytes, dualBytes, { generation: 1, maxRetainedTaskIds: 4096, clock, ...options });
  assert.equal(made.ok, true);
  return made.queue;
}
function ok(result, code) { assert.equal(result.ok, true); assert.equal(result.code, code); return result; }
function refused(result, code) {
  assert.equal(result.ok, false);
  if (code) assert.equal(result.code, code);
  return result;
}
function assertCommonFlags(result) {
  for (const field of ['authorizing', 'modelExecuted', 'promotionGranted', 'certificationGranted']) {
    assert.equal(result[field], false, `${field} must remain false`);
  }
  return result;
}
function packetResult(queue, value = {}, code = 'QUEUED') { return ok(queue.enqueue(bytes(value)), code); }
function takeConsume(queue) {
  const taken = ok(queue.take(), 'TAKEN');
  const delivered = ok(queue.consume(taken.ticket), 'DELIVERED');
  return { taken, delivered };
}

test('valid ELECTRON transfer is queued and delivered only after take', () => {
  const q = makeQueue();
  packetResult(q);
  assert.equal(q.inspect().queued, 1);
  assert.equal(q.inspect().inFlight, 0);
  refused(q.consume({}), 'INVALID_TICKET');
  const { delivered } = takeConsume(q);
  assert.equal(delivered.taskId, 'task.1');
  assert.ok(Buffer.isBuffer(delivered.payload));
  assert.deepEqual(delivered.payload, Buffer.from('0000803f000000400000404000008040', 'hex'));
});

for (const traveler of ['PROTON', 'ELECTRON', 'NEUTRON']) {
  test(`valid ${traveler} transfer`, () => {
    const q = makeQueue(); packetResult(q, { traveler, taskId: `task.${traveler.toLowerCase()}` });
    assert.equal(takeConsume(q).delivered.packet.traveler, traveler);
  });
}

test('valid roles use the packet path', () => {
  for (const traveler of ['PROTON', 'ELECTRON', 'NEUTRON']) {
    const q = makeQueue(); const taskId = `task.${traveler.toLowerCase()}`;
    packetResult(q, { traveler, taskId });
    assert.equal(takeConsume(q).delivered.taskId, taskId);
  }
});

for (const [name, field, value] of [
  ['graph identity', 'graphSha256', zeros], ['run identity', 'runSha256', zeros],
  ['topology identity', 'topologySha256', zeros], ['plan identity', 'planSha256', zeros],
  ['generation', 'generation', 2], ['channel', 'channelId', 'channel.9.forward'],
  ['sender', 'fromPortId', 'n1.b'], ['receiver', 'toPortId', 'n0.a'],
  ['space', 'spaceSha256', zeros],
]) {
  test(`refuses substituted ${name}`, () => refused(makeQueue().enqueue(bytes({ [field]: value }))));
}

for (const [name, mutation] of [
  ['empty bytes', () => Buffer.alloc(0)],
  ['invalid UTF-8', () => Buffer.from([0xff, 0xfe])],
  ['malformed JSON', () => Buffer.from('{')],
  ['BOM', () => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes()])],
  ['unknown field', () => bytes({ zzz: 1 })],
  ['whitespace', () => Buffer.from(` ${bytes().toString('utf8')}`)],
  ['oversized packet', () => Buffer.concat([bytes(), Buffer.alloc(65536)])],
]) {
  test(`refuses ${name} packet`, () => refused(makeQueue().enqueue(mutation())));
}

for (const [name, value] of [
  ['negative createdAtMs', -1], ['unsafe createdAtMs', Number.MAX_SAFE_INTEGER + 1],
  ['expired createdAtMs', 1],
]) {
  test(`refuses ${name}`, () => {
    const q = makeQueue(); now = value === 1 ? 1001 : 0;
    refused(q.enqueue(bytes({ createdAtMs: value })));
  });
}

test('refuses ttl zero and ttl over channel ceiling', () => {
  const q = makeQueue(); refused(q.enqueue(bytes({ ttlMs: 0 })));
  refused(q.enqueue(bytes({ taskId: 'task.2', ttlMs: channel.ttlMs + 1 })));
});

test('refuses unsafe created plus ttl overflow', () => {
  refused(makeQueue().enqueue(bytes({ createdAtMs: Number.MAX_SAFE_INTEGER, ttlMs: 2 })));
});

test('refuses hop zero, over limit, and noninteger', () => {
  const q = makeQueue(); refused(q.enqueue(bytes({ hopCount: 0 })));
  refused(q.enqueue(bytes({ taskId: 'task.2', hopCount: channel.hopLimit + 1 })));
  refused(q.enqueue(bytes({ taskId: 'task.3', hopCount: 1.5 })));
});

test('refuses malformed payload hex and wrong tensor byte count', () => {
  const q = makeQueue();
  refused(q.enqueue(bytes({ payloadHex: '0' })));
  refused(q.enqueue(bytes({ taskId: 'task.2', payloadHex: '00000000' })));
  refused(q.enqueue(bytes({ taskId: 'task.3', payloadHex: '0000GG00' })));
});

test('refuses NaN and infinity float payloads', () => {
  const q = makeQueue();
  refused(q.enqueue(bytes({ payloadHex: '0000c07f000000000000000000000000' })));
  refused(q.enqueue(bytes({ taskId: 'task.2', payloadHex: '0000807f000000000000000000000000' })));
});

test('identical canonical packet is DUPLICATE, changed packet is TASK_CONFLICT', () => {
  const q = makeQueue(); const first = bytes(); packetResult(q);
  ok(q.enqueue(first), 'DUPLICATE');
  assert.equal(q.enqueue(bytes({ taskId: 'task.1', payloadHex: '0000803f000000400000404000000000' })).code, 'TASK_CONFLICT');
});

test('FIFO returns opaque ticket and no payload from take', () => {
  const q = makeQueue(); packetResult(q); packetResult(q, { taskId: 'task.2' });
  const a = ok(q.take(), 'TAKEN'); const b = ok(q.take(), 'TAKEN');
  assert.equal(Object.hasOwn(a, 'payload'), false); assert.equal(Object.hasOwn(a, 'packet'), false);
  assert.notEqual(a.ticket, b.ticket);
  assert.equal(ok(q.consume(a.ticket), 'DELIVERED').taskId, 'task.1');
  assert.equal(ok(q.consume(b.ticket), 'DELIVERED').taskId, 'task.2');
});

test('empty queue is explicit EMPTY', () => refused(makeQueue().take(), 'EMPTY'));
test('foreign and forged tickets refuse', () => {
  const q = makeQueue(); const other = makeQueue(); packetResult(q); packetResult(other);
  const ticket = ok(q.take(), 'TAKEN').ticket; const foreign = ok(other.take(), 'TAKEN').ticket;
  refused(q.consume({})); refused(q.consume({ ...ticket }));
  refused(other.consume(ticket), 'INVALID_TICKET'); refused(q.consume(foreign), 'INVALID_TICKET');
  ok(q.consume(ticket), 'DELIVERED');
});

test('consume is exact once', () => {
  const q = makeQueue(); packetResult(q); const ticket = ok(q.take(), 'TAKEN').ticket;
  ok(q.consume(ticket), 'DELIVERED'); refused(q.consume(ticket), 'INVALID_TICKET');
});

test('returned packet metadata is frozen and payload is copied', () => {
  const q = makeQueue(); packetResult(q); const out = takeConsume(q).delivered;
  assert.equal(Object.isFrozen(out.packet), true); const original = out.payload[0]; out.payload[0] ^= 0xff;
  assert.notEqual(out.payload[0], original);
  const q2 = makeQueue(); packetResult(q2); const second = takeConsume(q2).delivered;
  assert.equal(second.payload[0], original);
});

test('queue owns the submitted packet bytes before later caller mutation', () => {
  const q = makeQueue(); const submitted = bytes(); ok(q.enqueue(submitted), 'QUEUED');
  submitted.fill(0); const delivered = takeConsume(q).delivered;
  assert.equal(delivered.packet.taskId, 'task.1');
  assert.deepEqual(delivered.payload, Buffer.from('0000803f000000400000404000008040', 'hex'));
});

test('per-channel queue limit refuses without retaining rejected ID', () => {
  const q = makeQueue();
  for (let i = 0; i < channel.queueLimit; i++) packetResult(q, { taskId: `task.${i}` });
  refused(q.enqueue(bytes({ taskId: 'task.over' })));
  assert.equal(q.inspect().queued, channel.queueLimit);
  ok(q.consume(ok(q.take(), 'TAKEN').ticket), 'DELIVERED');
  packetResult(q, { taskId: 'task.over' });
});

test('in-flight reservation consumes capacity until delivery', () => {
  const q = makeQueue();
  for (let i = 0; i < channel.queueLimit; i++) packetResult(q, { taskId: `task.${i}` });
  const ticket = ok(q.take(), 'TAKEN').ticket;
  assert.equal(q.inspect().inFlight, 1); refused(q.enqueue(bytes({ taskId: 'task.over' })));
  ok(q.consume(ticket), 'DELIVERED'); packetResult(q, { taskId: 'task.over' });
});

test('history cap refuses replay instead of evicting tombstones', () => {
  const q = makeQueue({ maxRetainedTaskIds: 1 }); packetResult(q); takeConsume(q);
  refused(q.enqueue(bytes({ taskId: 'task.2' })), 'TASK_HISTORY_FULL');
  ok(q.enqueue(bytes()), 'DUPLICATE');
});

test('queued expiry is refused and swept', () => {
  const q = makeQueue(); packetResult(q); now = 1000; refused(q.take(), 'EMPTY');
  assert.equal(q.inspect().queued, 0); assert.equal(q.inspect().retainedTaskIds, 1);
  const replay = ok(q.enqueue(bytes()), 'DUPLICATE'); assert.equal(replay.taskState, 'EXPIRED');
});

test('in-flight expiry invalidates ticket', () => {
  const q = makeQueue(); packetResult(q); const ticket = ok(q.take(), 'TAKEN').ticket;
  now = 1000; refused(q.consume(ticket), 'INVALID_TICKET'); assert.equal(q.inspect().inFlight, 0);
});

test('cancel queued and in-flight releases capacity but retains terminal ID', () => {
  const q = makeQueue(); packetResult(q); packetResult(q, { taskId: 'task.2' });
  assert.equal(q.cancel('task.1').code, 'CANCELLED');
  assert.equal(q.cancel('missing').code, 'TASK_UNKNOWN');
  const ticket = ok(q.take(), 'TAKEN').ticket; assert.equal(q.cancel('task.2').code, 'CANCELLED');
  refused(q.consume(ticket), 'INVALID_TICKET'); assert.equal(q.cancel('task.2').code, 'ALREADY_TERMINAL');
});

test('stop is terminal OFF and invalidates all live work', () => {
  const q = makeQueue(); packetResult(q); packetResult(q, { taskId: 'task.2' });
  const ticket = ok(q.take(), 'TAKEN').ticket; ok(q.stop(), 'STOPPED');
  assert.equal(q.inspect().state, 'OFF'); refused(q.enqueue(bytes({ taskId: 'task.3' })), 'OFF');
  refused(q.take(), 'OFF'); refused(q.consume(ticket), 'OFF'); refused(q.cancel('task.2'), 'OFF');
  refused(q.stop(), 'OFF');
});

test('terminal OFF precedes malformed-packet parsing', () => {
  const q = makeQueue(); ok(q.stop(), 'STOPPED'); refused(q.enqueue(Buffer.from('{')), 'OFF');
});

test('clock fault precedes packet validation and atomically cancels work', () => {
  let mode = 'ok'; let reads = 0;
  const faultClock = () => { reads++; if (mode === 'throw') throw new Error('clock'); if (mode === 'invalid') return -1; return 0; };
  const q = ok(createCourierQueue(baseBytes, dualBytes, { generation: 1, maxRetainedTaskIds: 4096, clock: faultClock }), 'READY_PRIVATE_COURIER_QUEUE_ONLY').queue;
  packetResult(q); packetResult(q, { taskId: 'task.2' }); const ticket = ok(q.take(), 'TAKEN').ticket;
  mode = 'throw'; refused(q.enqueue(Buffer.from('{')), 'CLOCK_ERROR');
  assert.equal(q.inspect().state, 'OFF'); assert.equal(q.inspect().queued, 0);
  assert.equal(q.inspect().inFlight, 0); assert.equal(q.inspect().payloadBytes, 0);
  refused(q.consume(ticket), 'OFF'); assert.equal(q.inspect().retainedTaskIds, 2);
  assert.ok(reads >= 4); // factory + two enqueues + take + faulting enqueue
});

test('invalid clock atomically stops queue and releases all reservations', () => {
  let value = 0; const q = makeQueue({ clock: () => value }); packetResult(q);
  const ticket = ok(q.take(), 'TAKEN').ticket; value = -1;
  refused(q.consume(ticket), 'CLOCK_INVALID');
  const snapshot = q.inspect(); assert.equal(snapshot.state, 'OFF');
  assert.equal(snapshot.queued, 0); assert.equal(snapshot.inFlight, 0); assert.equal(snapshot.payloadBytes, 0);
});

test('regressing clock returns distinct fault and retains terminal tombstones', () => {
  let value = 10; const q = makeQueue({ clock: () => value }); packetResult(q);
  value = 9; refused(q.take(), 'CLOCK_REGRESSION');
  assert.equal(q.inspect().state, 'OFF'); assert.equal(q.inspect().retainedTaskIds, 1);
});

test('identity validation precedes TTL validation for mixed-fault packet', () => {
  const result = makeQueue().enqueue(bytes({ graphSha256: zeros, ttlMs: channel.ttlMs + 1 }));
  assert.equal(result.ok, false); assert.notEqual(result.code, 'TTL_INVALID');
});

test('successful result shapes carry the four non-authorizing flags', () => {
  const q = makeQueue(); assertCommonFlags(q.inspect());
  assertCommonFlags(packetResult(q));
  const ticket = assertCommonFlags(ok(q.take(), 'TAKEN')).ticket;
  assertCommonFlags(ok(q.consume(ticket), 'DELIVERED'));
  assertCommonFlags(q.cancel('task.1'));
});

for (const [name, option] of [
  ['zero generation', { generation: 0 }], ['fractional generation', { generation: 1.5 }],
  ['zero history cap', { maxRetainedTaskIds: 0 }], ['oversized history cap', { maxRetainedTaskIds: 4097 }],
]) test(`factory refuses ${name}`, () => refused(createCourierQueue(baseBytes, dualBytes, { generation: 1, maxRetainedTaskIds: 4096, ...option, clock })));

test('factory owns input snapshots', () => {
  const sourceBase = Buffer.from(baseBytes); const sourceDual = Buffer.from(dualBytes);
  const q = ok(createCourierQueue(sourceBase, sourceDual, { generation: 1, maxRetainedTaskIds: 4096, clock }), 'READY_PRIVATE_COURIER_QUEUE_ONLY').queue;
  sourceBase[0] ^= 0xff; sourceDual[0] ^= 0xff; packetResult(q); assert.equal(takeConsume(q).delivered.taskId, 'task.1');
});

test('factory refuses SharedArrayBuffer-backed input', () => {
  const shared = new SharedArrayBuffer(baseBytes.length); new Uint8Array(shared).set(baseBytes);
  const dualShared = new SharedArrayBuffer(dualBytes.length); new Uint8Array(dualShared).set(dualBytes);
  refused(createCourierQueue(Buffer.from(shared), dualBytes, { generation: 1, maxRetainedTaskIds: 4096, clock }));
  refused(createCourierQueue(baseBytes, Buffer.from(dualShared), { generation: 1, maxRetainedTaskIds: 4096, clock }));
});

test('enqueue refuses SharedArrayBuffer-backed packet input', () => {
  const q = makeQueue(); const shared = new SharedArrayBuffer(bytes().length);
  new Uint8Array(shared).set(bytes()); refused(q.enqueue(Buffer.from(shared)));
});

for (const [name, badClock] of [
  ['missing', undefined], ['throwing', () => { throw new Error('clock'); }],
  ['negative', () => -1], ['fractional', () => 1.5], ['unsafe', () => Number.MAX_SAFE_INTEGER + 1],
]) test(`factory refuses ${name} clock`, () => refused(createCourierQueue(baseBytes, dualBytes, { generation: 1, maxRetainedTaskIds: 4096, clock: badClock })));

test('regressing clock terminally refuses existing queue', () => {
  let value = 0; const q = makeQueue({ clock: () => value }); packetResult(q); value = -1;
  refused(q.inspect()); refused(q.enqueue(bytes({ taskId: 'task.2' })));
});

test('reentrant clock call refuses operation without delivery', () => {
  let q; let reentered = false; const reentrant = () => { if (q) { reentered = true; q.inspect(); } return 0; };
  q = ok(createCourierQueue(baseBytes, dualBytes, { generation: 1, maxRetainedTaskIds: 4096, clock: reentrant }), 'READY_PRIVATE_COURIER_QUEUE_ONLY').queue;
  packetResult(q); assert.equal(reentered, true); assert.equal(q.inspect().queued, 1);
});

test('all successful observations preserve non-authorizing ceiling', () => {
  const q = makeQueue(); const results = [q.inspect(), q.enqueue(bytes()), q.take()];
  for (const result of results) for (const field of ['authorizing','modelExecuted','promotionGranted','certificationGranted']) assert.equal(result[field], false);
});
