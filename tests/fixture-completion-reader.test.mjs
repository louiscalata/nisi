// C03 closed-reader regressions. Pure helper tests only: no filesystem, host,
// model, network, runtime or cleanup operation is started here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveFixtureCompletionV1 } from '../work-orders/parallel-seven-tracks-v1/track1/repository-fixture-runner.mjs';

const completedReport = () => ({ outcome: 'COMPLETED', workflowOutcome: 'COMPLETED', code: null });
const completedHost = () => ({
  state: 'SETTLED', report: completedReport(), bundleError: null, proposedChanges: {},
});

test('C03 completion reader accepts only the ordinary own-data positive control', () => {
  const result = deriveFixtureCompletionV1(completedHost());
  assert.equal(result.completed, true);
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.reason, null);
  assert.deepEqual(result.clauses, {
    settled: true, outcomeCompleted: true, workflowCompleted: true,
    bundleClean: true, proposalPresent: true,
  });
});

for (const target of ['host', 'report', 'bundleError']) {
  test(`C03 completion reader rejects ${target} Symbol.toStringTag without invoking it`, () => {
    const host = completedHost();
    const value = target === 'host' ? host : target === 'report' ? host.report : (host.bundleError = { code: 'BUNDLE_ERROR' });
    let reads = 0;
    Object.defineProperty(value, Symbol.toStringTag, { enumerable: false, get() { reads++; return 'Object'; } });
    const result = deriveFixtureCompletionV1(host);
    assert.equal(reads, 0);
    assert.equal(result.completed, false);
  });
}

for (const target of ['host', 'report', 'bundleError']) {
  test(`C03 completion reader rejects ${target} data tag without trusting its label`, () => {
    const host = completedHost();
    const value = target === 'host' ? host : target === 'report' ? host.report : (host.bundleError = { code: 'BUNDLE_ERROR' });
    Object.defineProperty(value, Symbol.toStringTag, { value: 'Object' });
    assert.equal(deriveFixtureCompletionV1(host).completed, false);
  });
}

for (const [target, key] of [['host', 'state'], ['report', 'outcome'], ['bundleError', 'code']]) {
  test(`C03 completion reader treats ${target}.${key} accessor as absent without invoking it`, () => {
    const host = completedHost();
    const value = target === 'host' ? host : target === 'report' ? host.report : (host.bundleError = { code: 'BUNDLE_ERROR' });
    let reads = 0;
    Object.defineProperty(value, key, { configurable: true, enumerable: true, get() { reads++; return 'COMPLETED'; } });
    const result = deriveFixtureCompletionV1(host);
    assert.equal(reads, 0);
    assert.equal(result.completed, false);
    if (target === 'host') assert.deepEqual(result.clauses, {
      settled: false, outcomeCompleted: true, workflowCompleted: true,
      bundleClean: true, proposalPresent: true,
    });
    if (target === 'report') assert.deepEqual(result.clauses, {
      settled: true, outcomeCompleted: false, workflowCompleted: true,
      bundleClean: true, proposalPresent: true,
    });
    if (target === 'bundleError') assert.deepEqual(result.clauses, {
      settled: true, outcomeCompleted: true, workflowCompleted: true,
      bundleClean: false, proposalPresent: true,
    });
  });
}

test('C03 completion reader ignores inherited evidence without discarding own clauses', () => {
  const inherited = { state: 'SETTLED' };
  const host = Object.assign(Object.create(inherited), completedHost());
  delete host.state;
  const result = deriveFixtureCompletionV1(host);
  assert.deepEqual(result.clauses, {
    settled: false, outcomeCompleted: true, workflowCompleted: true,
    bundleClean: true, proposalPresent: true,
  });
  assert.equal(result.completed, false);
});

for (const target of ['host', 'report', 'bundleError']) {
  test(`C03 completion reader rejects ${target} Proxy before any trap`, () => {
    const host = completedHost();
    let traps = 0;
    const proxy = new Proxy(target === 'report' ? host.report : target === 'bundleError' ? { code: 'BUNDLE_ERROR' } : host, {
      getPrototypeOf() { traps++; throw new Error('GET_PROTOTYPE_TRAP'); },
      ownKeys() { traps++; throw new Error('OWN_KEYS_TRAP'); },
      getOwnPropertyDescriptor() { traps++; throw new Error('DESCRIPTOR_TRAP'); },
      get() { traps++; throw new Error('GET_TRAP'); },
    });
    const input = target === 'host' ? proxy : { ...host, [target]: proxy };
    const result = deriveFixtureCompletionV1(input);
    assert.equal(traps, 0);
    assert.equal(result.completed, false);
  });
}

test('C03 completion reader rejects a revoked host Proxy without throwing', () => {
  const { proxy, revoke } = Proxy.revocable(completedHost(), {});
  revoke();
  assert.doesNotThrow(() => deriveFixtureCompletionV1(proxy));
  assert.equal(deriveFixtureCompletionV1(proxy).completed, false);
});
