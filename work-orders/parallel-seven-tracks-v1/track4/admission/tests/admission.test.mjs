// Oracle for the execution admission decision (Claude, 2026-09-14): the Track 4
// acceptance the drain coordinator deliberately left out. A pure function over
// injected snapshots; it never probes, starts or reloads anything.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decideExecutionAdmission as decide } from '../src/execution-admission-v1.mjs';

const NOW = 1_000_000;
const good = (patch = {}) => ({
  now: NOW,
  consent: { grantedAtMs: NOW - 5_000, expiresAtMs: NOW + 60_000, revoked: false, scope: 'execute' },
  scheduler: { decision: 'ALLOW', observedAtMs: NOW - 100, freshnessMs: 5_000, queueState: 'ACTIVE' },
  capacity: { configuredSlots: 4, measuredFreeSlots: 2, measuredAtMs: NOW - 100, freshnessMs: 5_000 },
  host: { state: 'IDLE', pendingTransports: 0, observedAtMs: NOW - 50 },
  request: { priority: 'FOREGROUND', ownerId: 'owner-a' },
  ...patch
});
const REASONS = ['INVALID_INPUT', 'CONSENT_MISSING', 'CONSENT_EXPIRED', 'CONSENT_REVOKED', 'CONSENT_SCOPE', 'SCHEDULER_STALE', 'SCHEDULER_REFUSED', 'QUEUE_NOT_ACTIVE',
  'CAPACITY_STALE', 'CAPACITY_UNMEASURED', 'CAPACITY_EXHAUSTED', 'HOST_NOT_IDLE', 'HOST_STALE', 'TRANSPORTS_PENDING'];
const shape = (r) => { assert.deepEqual(Object.keys(r), ['schemaVersion', 'status', 'reason', 'checks', 'authorizing', 'executionGranted']); assert.equal(r.schemaVersion, 'nisi-execution-admission/v1'); assert.equal(r.authorizing, false); assert.equal(r.executionGranted, false); assert.ok(Object.isFrozen(r)); assert.ok(Object.isFrozen(r.checks)); };
const refused = (r, reason, label = '') => { shape(r); assert.equal(r.status, 'REFUSE', label); assert.equal(r.reason, reason, label); assert.ok(REASONS.includes(reason), reason); };

test('a fresh consented request with measured free capacity and an idle host is ADMIT, and ADMIT still grants nothing', () => {
  const r = decide(good()); shape(r);
  assert.equal(r.status, 'ADMIT'); assert.equal(r.reason, null);
  assert.deepEqual(Object.keys(r.checks), ['consent', 'scheduler', 'capacity', 'host']);
  assert.deepEqual(Object.values(r.checks), ['OK', 'OK', 'OK', 'OK']);
});

test('the result vocabulary is exactly ADMIT, REFUSE, DRAIN_UNCONFIRMED and nothing else, over every malformed or adverse input', () => {
  const inputs = [undefined, null, 'x', [], {}, good({ consent: null }), good({ scheduler: 'stale' }), good({ host: { state: 'BUSY' } }), good({ request: undefined })];
  for (const i of inputs) { const r = decide(i); assert.ok(['ADMIT', 'REFUSE', 'DRAIN_UNCONFIRMED'].includes(r.status), String(r.status)); assert.equal(r.executionGranted, false); }
});

test('foreground ordering cannot bypass consent: every consent failure refuses regardless of priority', () => {
  for (const priority of ['FOREGROUND', 'BACKGROUND']) {
    refused(decide(good({ request: { priority, ownerId: 'o' }, consent: undefined })), 'CONSENT_MISSING', priority);
    refused(decide(good({ request: { priority, ownerId: 'o' }, consent: { grantedAtMs: NOW - 5, expiresAtMs: NOW - 1, revoked: false, scope: 'execute' } })), 'CONSENT_EXPIRED', priority);
    refused(decide(good({ request: { priority, ownerId: 'o' }, consent: { grantedAtMs: NOW - 5, expiresAtMs: NOW + 5, revoked: true, scope: 'execute' } })), 'CONSENT_REVOKED', priority);
    refused(decide(good({ request: { priority, ownerId: 'o' }, consent: { grantedAtMs: NOW - 5, expiresAtMs: NOW + 5, revoked: false, scope: 'review' } })), 'CONSENT_SCOPE', priority);
  }
});

test('consent expiry is a closed boundary: expiresAtMs === now is expired; grantedAtMs in the future is invalid', () => {
  refused(decide(good({ consent: { grantedAtMs: NOW - 5, expiresAtMs: NOW, revoked: false, scope: 'execute' } })), 'CONSENT_EXPIRED', 'expiresAt == now');
  assert.equal(decide(good({ consent: { grantedAtMs: NOW - 5, expiresAtMs: NOW + 1, revoked: false, scope: 'execute' } })).status, 'ADMIT', 'expiresAt == now+1');
  refused(decide(good({ consent: { grantedAtMs: NOW + 1, expiresAtMs: NOW + 5, revoked: false, scope: 'execute' } })), 'INVALID_INPUT', 'granted in the future');
});

test('stale scheduler snapshots refuse at the freshness boundary; a non-ALLOW scheduler decision refuses with its own vocabulary preserved', () => {
  refused(decide(good({ scheduler: { decision: 'ALLOW', observedAtMs: NOW - 5_000, freshnessMs: 5_000, queueState: 'ACTIVE' } })), 'SCHEDULER_STALE', 'age == freshness');
  assert.equal(decide(good({ scheduler: { decision: 'ALLOW', observedAtMs: NOW - 4_999, freshnessMs: 5_000, queueState: 'ACTIVE' } })).status, 'ADMIT');
  for (const d of ['WINDOW_FULL', 'COURIER_RESERVED', 'COURIER_BUDGET_EXHAUSTED', 'INPUT_INVALID']) {
    const r = decide(good({ scheduler: { decision: d, observedAtMs: NOW - 100, freshnessMs: 5_000, queueState: 'ACTIVE' } }));
    refused(r, 'SCHEDULER_REFUSED', d); assert.equal(r.checks.scheduler, d, 'the scheduler word is preserved in the check');
  }
  refused(decide(good({ scheduler: { decision: 'ALLOW', observedAtMs: NOW - 100, freshnessMs: 5_000, queueState: 'OFF' } })), 'QUEUE_NOT_ACTIVE');
  refused(decide(good({ scheduler: { decision: 'ADMIT', observedAtMs: NOW - 100, freshnessMs: 5_000, queueState: 'ACTIVE' } })), 'INVALID_INPUT', 'unknown scheduler word');
});

test('configured capacity alone cannot admit: unmeasured, stale or zero measured free slots refuse even with slots configured', () => {
  refused(decide(good({ capacity: { configuredSlots: 8, measuredFreeSlots: null, measuredAtMs: NOW - 100, freshnessMs: 5_000 } })), 'CAPACITY_UNMEASURED');
  refused(decide(good({ capacity: { configuredSlots: 8, measuredFreeSlots: 0, measuredAtMs: NOW - 100, freshnessMs: 5_000 } })), 'CAPACITY_EXHAUSTED');
  refused(decide(good({ capacity: { configuredSlots: 8, measuredFreeSlots: 3, measuredAtMs: NOW - 5_000, freshnessMs: 5_000 } })), 'CAPACITY_STALE', 'age == freshness');
  refused(decide(good({ capacity: { configuredSlots: 2, measuredFreeSlots: 3, measuredAtMs: NOW - 100, freshnessMs: 5_000 } })), 'INVALID_INPUT', 'measured exceeds configured');
});

test('host state: a non-idle host refuses; a stale host observation refuses; pending transports with an OFF or timed-out host is DRAIN_UNCONFIRMED, never ADMIT or a plain REFUSE', () => {
  refused(decide(good({ host: { state: 'BUSY', pendingTransports: 0, observedAtMs: NOW - 50 } })), 'HOST_NOT_IDLE');
  refused(decide(good({ host: { state: 'QUARANTINED', pendingTransports: 0, observedAtMs: NOW - 50 } })), 'HOST_NOT_IDLE');
  refused(decide(good({ host: { state: 'IDLE', pendingTransports: 0, observedAtMs: NOW - 5_000 } })), 'HOST_STALE');
  for (const state of ['OFF', 'TIMEOUT', 'CANCELLED']) {
    const r = decide(good({ host: { state, pendingTransports: 2, observedAtMs: NOW - 50 } })); shape(r);
    assert.equal(r.status, 'DRAIN_UNCONFIRMED', state); assert.equal(r.reason, 'TRANSPORTS_PENDING', state); assert.equal(r.checks.host, state);
  }
  refused(decide(good({ host: { state: 'IDLE', pendingTransports: 1, observedAtMs: NOW - 50 } })), 'TRANSPORTS_PENDING', 'idle but transports pending is a refuse, not unconfirmed');
});

test('checks are evaluated in a fixed order and the FIRST failure is the reason: consent, then scheduler, then capacity, then host', () => {
  const r = decide(good({ consent: { grantedAtMs: NOW - 5, expiresAtMs: NOW - 1, revoked: true, scope: 'review' }, scheduler: { decision: 'WINDOW_FULL', observedAtMs: NOW - 9_000, freshnessMs: 5_000, queueState: 'OFF' }, capacity: { configuredSlots: 1, measuredFreeSlots: 0, measuredAtMs: NOW - 9_000, freshnessMs: 5_000 }, host: { state: 'BUSY', pendingTransports: 3, observedAtMs: NOW - 9_000 } }));
  refused(r, 'CONSENT_EXPIRED', 'expired outranks revoked and scope within consent; consent outranks everything after');
  assert.deepEqual(r.checks, { consent: 'CONSENT_EXPIRED', scheduler: 'NOT_EVALUATED', capacity: 'NOT_EVALUATED', host: 'NOT_EVALUATED' });
  const s = decide(good({ scheduler: { decision: 'WINDOW_FULL', observedAtMs: NOW - 100, freshnessMs: 5_000, queueState: 'ACTIVE' }, capacity: { configuredSlots: 1, measuredFreeSlots: 0, measuredAtMs: NOW - 100, freshnessMs: 5_000 } }));
  refused(s, 'SCHEDULER_REFUSED'); assert.equal(s.checks.capacity, 'NOT_EVALUATED');
});

test('input is validated exactly and never mutated; results are fresh and frozen; no clock is read (now is the only time source)', () => {
  const deepFreeze = (x) => { if (x && typeof x === 'object') { Object.freeze(x); Object.values(x).forEach(deepFreeze); } return x; };
  const frozen = deepFreeze(good()); const before = JSON.stringify(frozen);
  const a = decide(frozen), b = decide(frozen);
  assert.notEqual(a, b); assert.deepEqual(a, b); assert.equal(JSON.stringify(frozen), before);
  for (const bad of [good({ extra: 1 }), good({ now: -1 }), good({ now: 1.5 }), good({ request: { priority: 'URGENT', ownerId: 'o' } }), good({ request: { priority: 'FOREGROUND', ownerId: '' } }), good({ consent: { grantedAtMs: NOW - 5, expiresAtMs: NOW + 5, revoked: false, scope: 'execute', extra: true } }), good({ host: { state: 'IDLE', pendingTransports: -1, observedAtMs: NOW } })]) {
    refused(decide(bad), 'INVALID_INPUT', JSON.stringify(bad).slice(0, 80));
  }
  const withGetter = good(); Object.defineProperty(withGetter, 'consent', { get() { throw new Error('getter'); }, enumerable: true });
  refused(decide(withGetter), 'INVALID_INPUT', 'accessor input');
  const withSymbol = good(); withSymbol[Symbol('x')] = 1; refused(decide(withSymbol), 'INVALID_INPUT', 'symbol-keyed extra');
  const withHidden = good(); Object.defineProperty(withHidden, 'hidden', { value: 1, enumerable: false }); refused(decide(withHidden), 'INVALID_INPUT', 'non-enumerable extra');
  const nested = good(); nested.host[Symbol('h')] = 1; refused(decide(nested), 'INVALID_INPUT', 'symbol-keyed extra at a nested level');
});

test('module is pure: imports nothing, uses no clock, timers or randomness, and exports only the decision', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/execution-admission-v1.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bimport\b/);
  assert.doesNotMatch(source, /\b(?:require|process|fetch|setTimeout|setInterval|Date|performance|globalThis)\b|Math\s*\.\s*random\b/);
  const ns = await import('../src/execution-admission-v1.mjs');
  assert.deepEqual(Object.keys(ns), ['decideExecutionAdmission']);
});
