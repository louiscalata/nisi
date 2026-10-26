import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as immediate } from 'node:timers/promises';
import { pairedArmContext } from './helpers/paired-arm-owner-fixture.mjs';
import { createRepositoryPairedArmOwnerV1 } from '../hosts/repository/paired-trial-arm-owner-v1.mjs';

test('retention observes original native settlement despite poisoned promise properties', async t => {
  const c = await pairedArmContext(t, { retentionTimeoutMs: 20 });
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  Object.defineProperties(pending, {
    constructor: { value: Object.freeze({}), configurable: true },
    then: { value: resolve => resolve('FALSE_SETTLEMENT'), configurable: true },
  });
  c.input.retain = () => pending;
  const owner = createRepositoryPairedArmOwnerV1(c.input);
  const runner = c.makeRunner(owner.host);

  try {
    const ledger = await runner.run();
    assert.equal(ledger.stopReason, 'RUNNER_RETENTION_UNCONFIRMED');
    assert.equal(ledger.retentionStatus, 'UNCONFIRMED');
    assert.equal(c.state.reservations.length, 0, 'false then callback must not admit owner reservation');
    assert.equal(c.requests.length, 0, 'false then callback must not dispatch model transport');
    assert.equal(owner.inspect().busy, true, 'original writer settlement remains pending');
  } finally {
    release();
    await immediate();
  }
});
