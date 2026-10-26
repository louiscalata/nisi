// Independent containment oracle for the execution coordinator (Claude,
// 2026-09-14), written from the adversarial review retained at
// work-orders/parallel-seven-tracks-v1/track4/evidence/claude-review-20260914-0540.md.
// Each test is a defect the author's suite does not discriminate: an owner
// callback reaching coordinator bookkeeping through `this`, a rejecting or
// hanging cancel(), and a live owners container defeating the 1–16 bound.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createExecutionCoordinatorV1 as create} from '../src/execution-coordinator-v1.mjs';

const owner = (id, patch = {}) => ({id, status: () => 'IDLE', settled: async () => {}, cancel: () => {}, ...patch});
const never = () => new Promise(() => {});

test('an owner callback cannot forge settlement through `this`: status() that writes this.settlement is still UNCONFIRMED when settled() rejects', async () => {
  const forger = {id: 'forge', status() { if (this && typeof this === 'object') { this.settlement = 'SETTLED'; this.error = null; } return 'IDLE'; }, settled: () => Promise.reject(new Error('NOT JOINED')), cancel: () => {}};
  const c = create({owners: [forger], settleTimeoutMs: 20});
  const r = await c.requestOff();
  assert.equal(r.status, 'UNCONFIRMED', JSON.stringify(r));
  assert.equal(r.snapshot.capacityReusable, false);
  assert.equal(r.snapshot.owners[0].settlement, 'ERROR');
  assert.equal(r.snapshot.owners[0].error, 'SETTLEMENT_ERROR');
});

test('an owner callback sees no coordinator bookkeeping as `this` (status, settled and cancel are invoked detached)', async () => {
  const seen = [];
  const spy = {id: 'spy', status() { seen.push(['status', this]); return 'IDLE'; }, settled() { seen.push(['settled', this]); return Promise.resolve(); }, cancel() { seen.push(['cancel', this]); }};
  const c = create({owners: [spy], settleTimeoutMs: 20});
  await c.requestOff();
  assert.ok(seen.length >= 3, 'all three callbacks ran');
  for (const [name, self] of seen) {
    const keys = self && typeof self === 'object' ? Object.keys(self) : [];
    assert.ok(!keys.includes('settlement') && !keys.includes('cancelRequested') && !keys.includes('ownerStatus') && !keys.includes('error'), `${name} saw coordinator keys: ${keys.join(',')}`);
  }
});

test('a cancel() that returns a rejecting promise is contained: UNCONFIRMED with CANCEL_ERROR, no unhandled rejection, no escape', async () => {
  const unhandled = [];
  const handler = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', handler);
  try {
    const c = create({owners: [owner('a', {cancel: async () => { throw new Error('async cancel failure'); }})], settleTimeoutMs: 50});
    const r = await c.requestOff();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(unhandled, [], 'the rejection never escaped the coordinator');
    assert.equal(r.status, 'UNCONFIRMED', JSON.stringify(r));
    assert.equal(r.snapshot.owners[0].error, 'CANCEL_ERROR');
    assert.equal(r.snapshot.capacityReusable, false);
    const again = await c.recheck();
    assert.equal(again.snapshot.owners[0].error, 'CANCEL_ERROR', 'a recorded cancel error is not cleared by a later settlement');
  } finally { process.off('unhandledRejection', handler); }
});

test('a cancel() that throws synchronously is CANCEL_ERROR and the error survives settle(): never OFF', async () => {
  const c = create({owners: [owner('a', {cancel: () => { throw new Error('sync'); }})], settleTimeoutMs: 50});
  const r = await c.requestOff();
  assert.equal(r.status, 'UNCONFIRMED');
  assert.equal(r.snapshot.owners[0].error, 'CANCEL_ERROR');
});

test('a cancel() that never resolves plus a pending settled() is UNCONFIRMED within the timeout, not a hang', async () => {
  const c = create({owners: [owner('a', {cancel: never, settled: never})], settleTimeoutMs: 30});
  const started = Date.now();
  const r = await c.requestOff();
  assert.ok(Date.now() - started < 2000, 'bounded by settleTimeoutMs');
  assert.equal(r.status, 'UNCONFIRMED');
  assert.equal(r.snapshot.capacityReusable, false);
});

test('a custom thenable returned by cancel() is awaited (its then is invoked), and its rejection is contained', async () => {
  let thenCalled = false;
  const thenable = {then(_res, rej) { thenCalled = true; rej(new Error('thenable cancel')); }};
  const c = create({owners: [owner('a', {cancel: () => thenable})], settleTimeoutMs: 50});
  const r = await c.requestOff();
  assert.equal(thenCalled, true);
  assert.equal(r.status, 'UNCONFIRMED');
  assert.equal(r.snapshot.owners[0].error, 'CANCEL_ERROR');
});

test('the owners container is snapshotted once: a Proxy that lies about length after the bound check cannot hide an owner', async () => {
  const busy = owner('hidden', {status: () => 'BUSY', settled: never});
  let reads = 0;
  const lying = new Proxy([busy], {get(t, k, r) { if (k === 'length') return (++reads) === 1 ? 1 : 0; return Reflect.get(t, k, r); }});
  let c;
  try { c = create({owners: lying, settleTimeoutMs: 30}); } catch (error) { assert.match(String(error.message), /SCHEMA|EXECUTION|OWNER/); return; }
  assert.equal(c.inspect().snapshot.owners.length, 1, 'the registered owner is not dropped');
  const r = await c.requestOff();
  assert.equal(r.status, 'UNCONFIRMED', 'the hidden BUSY owner keeps capacity withheld');
  assert.equal(r.snapshot.capacityReusable, false);
});

test('a Proxy that grows past 16 after the bound check is refused or bounded, never registered at 40', () => {
  const many = Array.from({length: 40}, (_, i) => owner(`o${i}`));
  let reads = 0;
  const lying = new Proxy(many, {get(t, k, r) { if (k === 'length') { reads++; return reads <= 2 ? 1 : 40; } return Reflect.get(t, k, r); }});
  let c;
  try { c = create({owners: lying, settleTimeoutMs: 30}); } catch (error) { assert.match(String(error.message), /SCHEMA|EXECUTION|OWNER/); return; }
  assert.ok(c.inspect().snapshot.owners.length <= 16, 'bound holds');
});

test('a sparse owners array is refused with the SCHEMA/OWNER vocabulary, not a raw TypeError', () => {
  const sparse = [, owner('a')];
  assert.throws(() => create({owners: sparse, settleTimeoutMs: 30}), (e) => /SCHEMA|OWNER|EXECUTION/.test(String(e.message)), 'vocabulary error');
});

test('OFF still works for honest owners after the fixes: every owner settled, IDLE, capacity reusable', async () => {
  const c = create({owners: [owner('a'), owner('b')], settleTimeoutMs: 50});
  const r = await c.requestOff();
  assert.equal(r.status, 'OFF');
  assert.equal(r.snapshot.capacityReusable, true);
  assert.deepEqual(r.snapshot.owners.map(o => [o.settlement, o.error]), [['SETTLED', null], ['SETTLED', null]]);
});
