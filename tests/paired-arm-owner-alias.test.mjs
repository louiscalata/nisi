import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pairedArmContext } from './helpers/paired-arm-owner-fixture.mjs';
import {
  createRepositoryWorkflowOwnerV1,
  readIssuedRepositoryWorkflowOwnerV1,
} from '../hosts/repository/reviewed-workflow-v1.mjs';
import { createRepositoryPairedArmOwnerV1 } from '../hosts/repository/paired-trial-arm-owner-v1.mjs';
import { createRepositoryTrialOracleV1 } from '../hosts/repository/paired-trial-oracle-v1.mjs';

for (const distinctTopLevel of [false, true]) test(
  `${distinctTopLevel ? 'distinct wrappers sharing children' : 'same top-level owners'} stay spent after child status failure`,
  async t => {
  const c = await pairedArmContext(t);
  const children = readIssuedRepositoryWorkflowOwnerV1(c.host);
  let childStatusCalls = 0, shared = null, reservations = 0;
  const failingStaticOwner = {
    ...children.staticOwner,
    status() {
      childStatusCalls++;
      throw Object.assign(Error('synthetic child status failure'), { code: 'SYNTHETIC_STATUS_FAILURE' });
    },
  };
  const failingHost = createRepositoryWorkflowOwnerV1({
    suite: children.suite,
    staticOwner: failingStaticOwner,
    testsOwner: children.testsOwner,
  });
  c.state.reserve = (intent, reserveDefault) => {
    reservations++;
    if (!shared) {
      const issued = reserveDefault(intent);
      shared = Object.freeze({ host: failingHost, lane: issued.lane, oracle: issued.oracle });
    }
    return shared;
  };

  const first = await c.runner.run();
  assert.equal(first.stopReason, 'RUNNER_ARM_CALLBACK');
  assert.equal(c.owner.inspect().failure, 'RUNNER_ARM_CALLBACK');
  assert.equal(childStatusCalls, 1);
  assert.equal(c.requests.length, 0);
  assert.deepEqual(await fs.readdir(c.parentRoot), []);

  if (distinctTopLevel) {
    // Different top-level identities retain the exact same already-spent child
    // owners. This proves incremental child claiming rather than only top-level
    // host/lane/oracle reuse detection.
    const alternate = await pairedArmContext(t);
    assert.equal(alternate.plan.planSha256, c.plan.planSha256);
    assert.equal(alternate.profile.profileSha256, c.profile.profileSha256);
    const secondHost = createRepositoryWorkflowOwnerV1({
      suite: children.suite,
      staticOwner: failingStaticOwner,
      testsOwner: children.testsOwner,
    });
    c.state.reserve = intent => {
      reservations++;
      const oracle = createRepositoryTrialOracleV1({ registration: c.registration,
        binding: { ...c.registration.workflow, requestId: intent.requestId,
          profileSha256: intent.profileSha256, oracleSha256: c.registration.oracleSha256 },
        parentRoot: c.parentRoot, materializationTimeoutMs: 5000,
        totalTimeoutMs: 5000, childTimeoutMs: 3000, closeGraceMs: 500 });
      return Object.freeze({ host: secondHost, lane: alternate.lane, oracle });
    };
  }
  const secondOwner = createRepositoryPairedArmOwnerV1(c.input);
  const second = await c.makeRunner(secondOwner.host).run();
  assert.equal(second.stopReason, 'RUNNER_ARM_OWNER_REUSED');
  assert.equal(secondOwner.inspect().failure, 'RUNNER_ARM_OWNER_REUSED');
  assert.equal(reservations, 2);
  assert.equal(childStatusCalls, 1, 'reuse must refuse before invoking the failed child again');
  assert.equal(c.requests.length, 0, 'neither failed claim may dispatch model transport');
  assert.equal(c.state.oracle.inspect().state, 'NEW');
  assert.deepEqual(await fs.readdir(c.parentRoot), []);
});
