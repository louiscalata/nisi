import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdmittedRunOwner } from '../neural/admitted-run-owner.mjs';
import { fixtureBytes } from '../neural/bn01-fixture.mjs';
const c = value => fixtureBytes(value).toString('utf8');
const pins = { graphSha256: 'a'.repeat(64), runSha256: 'b'.repeat(64), topologySha256: 'c'.repeat(64), planSha256: 'd'.repeat(64) };
const bind = over => fixtureBytes({ kind: 'veritas-admitted-run-bind-v1', profile: 'veritas-bn01-offline-contract-v1',
  schemaVersion: 1, generation: 1, runBudgetCap: 10, deadlineMs: 10, ...pins, ...over });
const request = over => c({ kind: 'veritas-admitted-run-permit-request-v1', runId: 'run-one', requester: 'PRIMARY', generation: 1, scope: 'contribution', ...over });
const execution = (id, over) => c({ kind: 'veritas-admitted-run-execution-v1', permitId: id,
  runId: 'run-one', requester: 'PRIMARY', generation: 1, scope: 'contribution', ...pins, ...over });
function rig(options = {}, over = {}) {
  let now = 0, reads = 0;
  const made = createAdmittedRunOwner(bind(over), { clock: () => { reads++; return now; }, ...options });
  assert.equal(made.ok, true);
  return { owner: made.owner, setTime: t => { now = t; }, reads: () => reads };
}

test('mint samples the clock once: a second read cannot throw after hidden admission', () => {
  let reads = 0; const r = rig({ clock: () => { if (++reads > 1) throw Error('second read'); return 7; } });
  let result;
  assert.doesNotThrow(() => { result = r.owner.requestPermit(request()); });
  assert.equal(result.code, 'PERMIT_ISSUED'); assert.equal(reads, 1);
  assert.equal(r.owner.ledger().entries[0].atMs, 7);
});

test('execution samples once and atomically records its consumed state', () => {
  let reads = 0; const r = rig({ clock: () => { if (++reads > 2) throw Error('extra read'); return 0; } });
  const p = r.owner.requestPermit(request()); let e;
  assert.doesNotThrow(() => { e = r.owner.checkExecution(execution(p.permitId)); });
  assert.equal(e.code, 'ADMITTED'); assert.equal(reads, 2);
  assert.equal(r.owner.status().executionsUsed, 1); assert.equal(r.owner.ledger().count, 2);
});

test('invalid clock values and exceptions never mint and terminally revoke', () => {
  for (const bad of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, '0', null, undefined]) {
    const r = rig({ clock: () => bad });
    assert.equal(r.owner.requestPermit(request()).code, 'CLOCK_REFUSED');
    assert.equal(r.owner.status().admitted, 0); assert.equal(r.owner.status().revoked, true);
    assert.equal(r.owner.requestPermit(request()).code, 'OWNER_REVOKED');
  }
  const r = rig({ clock: () => { throw Error('clock'); } });
  assert.doesNotThrow(() => assert.equal(r.owner.requestPermit(request()).code, 'CLOCK_REFUSED'));
});

test('clock rollback cannot revive a permit; equality is accepted', () => {
  const r = rig(); r.setTime(5); const p = r.owner.requestPermit(request());
  r.setTime(4); assert.equal(r.owner.checkExecution(execution(p.permitId)).code, 'CLOCK_REFUSED');
  r.setTime(5); assert.equal(r.owner.checkExecution(execution(p.permitId)).code, 'PERMIT_REVOKED');
  assert.equal(r.owner.status().executionsUsed, 0);
  const same = rig(); const q = same.owner.requestPermit(request());
  assert.equal(same.owner.checkExecution(execution(q.permitId)).code, 'ADMITTED');
});

test('deadline is exclusive and stale state remains bounded and non-live', () => {
  for (const time of [9, 10, 11]) {
    const r = rig(); const p = r.owner.requestPermit(request()); r.setTime(time);
    assert.equal(r.owner.checkExecution(execution(p.permitId)).code, time < 10 ? 'ADMITTED' : 'PERMIT_STALE');
    assert.equal(r.owner.status().permitLive, false);
    if (time >= 10) {
      const count = r.owner.ledger().count;
      for (let i = 0; i < 10; i++) assert.equal(r.owner.checkExecution(execution(p.permitId)).code, 'PERMIT_STALE');
      assert.equal(r.owner.ledger().count, count);
      assert.equal(r.owner.requestPermit(request()).code, 'RUN_ALREADY_ADMITTED');
    }
  }
});

test('unsafe deadline addition refuses before committing a permit', () => {
  const r = rig(); r.setTime(Number.MAX_SAFE_INTEGER - 1);
  assert.equal(r.owner.requestPermit(request()).code, 'DEADLINE_OVERFLOW');
  assert.equal(r.owner.status().admitted, 0); assert.equal(r.owner.status().permitLive, false);
});

test('pre-mint revoke is terminal, idempotent and clock-free', () => {
  const r = rig({ clock: () => { throw Error('must not read'); } });
  assert.equal(r.owner.revoke().code, 'OWNER_REVOKED');
  assert.equal(r.owner.revoke().code, 'OWNER_REVOKED');
  assert.equal(r.owner.requestPermit(request()).code, 'OWNER_REVOKED');
  assert.equal(r.owner.ledger().count, 1); assert.equal(r.owner.ledger().entries[0].atMs, null);
});

test('repeated revoke cannot grow the ledger or read the clock again', () => {
  const r = rig(); const p = r.owner.requestPermit(request()); const reads = r.reads();
  for (let i = 0; i < 10000; i++) assert.equal(r.owner.revoke(p.permitId).code, 'PERMIT_REVOKED');
  assert.equal(r.owner.ledger().count, 2); assert.equal(r.reads(), reads);
  assert.equal(r.owner.ledger().entries[1].timeBasis, 'LAST_VALID_SAMPLE');
});

test('wrong explicit revoke target never revokes an honest owner', () => {
  const r = rig(); assert.equal(r.owner.revoke('permit-wrong').code, 'PERMIT_ABSENT');
  assert.equal(r.owner.status().revoked, false);
  const p = r.owner.requestPermit(request());
  assert.equal(r.owner.revoke('permit-wrong').code, 'PERMIT_ABSENT');
  assert.equal(r.owner.checkExecution(execution(p.permitId)).code, 'ADMITTED');
});

test('clock callback can revoke before mint; outer mint cannot overwrite it', () => {
  let owner; const r = rig({ clock: () => { owner.revoke(); return 0; } }); owner = r.owner;
  assert.equal(owner.requestPermit(request()).code, 'OWNER_REVOKED');
  assert.equal(owner.status().admitted, 0); assert.equal(owner.status().permitLive, false);
  assert.deepEqual(owner.ledger().entries.map(e => e.event), ['OWNER_REVOKED']);
});

test('clock callback revocation defeats execution before its state commit', () => {
  let owner, revoke = false, calls = 0; const r = rig({ clock: () => {
    calls++; if (revoke) { revoke = false; owner.revoke(); } return 0;
  } }); owner = r.owner; const p = owner.requestPermit(request()); revoke = true;
  assert.equal(owner.checkExecution(execution(p.permitId)).code, 'PERMIT_REVOKED');
  assert.equal(owner.status().executionsUsed, 0);
  assert.deepEqual(owner.ledger().entries.map(e => e.event), ['PERMIT_ISSUED', 'PERMIT_REVOKED']);
  assert.equal(calls, 2);
});

test('clock callback cannot reenter mint or execution, but observational reads remain safe', () => {
  let owner, first = true; const nested = [];
  const r = rig({ clock: () => {
    if (first) { first = false; nested.push(owner.requestPermit(request()).code);
      nested.push(owner.checkExecution(execution('permit-other')).code);
      assert.equal(owner.ledger().ok, true); assert.equal(owner.status().ok, true); }
    return 0;
  } }); owner = r.owner;
  assert.equal(owner.requestPermit(request()).code, 'PERMIT_ISSUED'); assert.deepEqual(nested, ['BUSY', 'BUSY']);
});

test('malformed intake is bounded without coercion, recursion throws or owner mutation', () => {
  for (const input of ['x'.repeat(65537), 'é'.repeat(40000), '['.repeat(10000) + '0' + ']'.repeat(10000),
    { toString() { throw Error('no coercion'); } }, null]) {
    const r = rig();
    assert.doesNotThrow(() => assert.equal(r.owner.requestPermit(input).ok, false));
    assert.doesNotThrow(() => assert.equal(r.owner.checkExecution(input).ok, false));
    assert.equal(r.owner.status().admitted, 0); assert.equal(r.owner.status().executionsUsed, 0);
  }
});

test('factory captures the clock once and owns its declaration bytes', () => {
  let reads = 0; const bytes = bind();
  const result = createAdmittedRunOwner(bytes, { get clock() { reads++; return () => 0; } });
  assert.equal(reads, 1); assert.equal(result.ok, true); bytes.fill(0);
  const p = result.owner.requestPermit(request()); assert.equal(p.code, 'PERMIT_ISSUED');
  assert.equal(result.owner.checkExecution(execution(p.permitId)).code, 'ADMITTED');
  for (const input of [Buffer.alloc(0), Buffer.alloc(65537), Buffer.from(new SharedArrayBuffer(50))]) {
    assert.equal(createAdmittedRunOwner(input, {}).ok, false);
  }
});

test('revoked owner rejects before coercion or further clock calls', () => {
  const r = rig(); const p = r.owner.requestPermit(request()); r.owner.revoke(); const reads = r.reads();
  const bad = { toString() { throw Error('must not coerce'); } };
  assert.equal(r.owner.requestPermit(bad).code, 'OWNER_REVOKED');
  assert.equal(r.owner.checkExecution(bad).code, 'PERMIT_REVOKED');
  assert.equal(r.owner.checkExecution(execution(p.permitId, { generation: 9 })).code, 'PERMIT_REVOKED');
  assert.equal(r.reads(), reads);
});

test('terminal events and successful results stay frozen, bounded and non-authorizing', () => {
  const r = rig(); const p = r.owner.requestPermit(request());
  const e = r.owner.checkExecution(execution(p.permitId)); const revoked = r.owner.revoke();
  for (let i = 0; i < 100; i++) { r.owner.revoke(); r.owner.checkExecution(execution(p.permitId)); }
  const ledger = r.owner.ledger(); assert.equal(ledger.count, 3);
  assert.ok(Object.isFrozen(ledger.entries)); for (const entry of ledger.entries) assert.ok(Object.isFrozen(entry));
  for (const result of [p, e, revoked, ledger, r.owner.status()]) {
    assert.ok(Object.isFrozen(result));
    for (const key of ['authorizing', 'modelExecuted', 'promotionGranted', 'certificationGranted']) assert.equal(result[key], false);
  }
});
