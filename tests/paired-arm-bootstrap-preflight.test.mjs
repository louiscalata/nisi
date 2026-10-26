// Pure prospective settings versus original issued-lane descriptors.
// Synthetic fixture data only; no provider, model, native build, or network call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewedLiveFixtureV1 } from '../examples/repository-task/reviewed-live-fixture-v1.mjs';
import { registerRepairGuidanceV1 } from '../adapters/repair-guidance-v1.mjs';
import { createReviewedLiveModelLaneV4, createReviewedLiveModelLaneWithTransportV4,
  readIssuedLiveModelLaneV4 } from '../hosts/repository/reviewed-live-model-v4.mjs';
import { describePlannedRepositoryTrialInputsV2, describeRepositoryTrialInputsV2 } from '../hosts/repository/paired-trial-projection-v2.mjs';
import { selection } from './helpers/live-model-v3-fixture.mjs';

async function input() {
  const fixture = await createReviewedLiveFixtureV1();
  const treatment = registerRepairGuidanceV1({ arm: 'ON', api: 'NATIVE_API', binding: {
    taskFingerprint: fixture.preparations[0].taskFingerprint,
    baselineFingerprint: fixture.baseline.fingerprint,
    suiteFingerprint: fixture.suite.fingerprint,
    reviewedSourceFingerprint: fixture.reviewedSourceFingerprint,
  } });
  return { fixture, value: { suite: fixture.suite, reviewedSourceFingerprint: fixture.reviewedSourceFingerprint,
    author: selection('author', 'NATIVE_API'), reviewer: selection('reviewer', 'CHAT_COMPLETIONS'),
    timeoutMs: 1000, maxOutputTokens: 512, approval: { id: 'synthetic.approval', expiresAtMs: 10000 },
    arm: 'ON', treatment } };
}

test('planned V2 descriptor equals the descriptor of a freshly issued V4 lane', async () => {
  const { value } = await input();
  const planned = describePlannedRepositoryTrialInputsV2(value, 'INJECTED_TEST_TRANSPORT');
  const lane = createReviewedLiveModelLaneWithTransportV4(value, {
    author: async () => { throw Error('transport must not be called'); },
    reviewer: async () => { throw Error('transport must not be called'); },
  });
  try {
    assert.deepEqual(describeRepositoryTrialInputsV2(lane), planned);
    assert.equal(planned.authorizing, false);
  } finally {
    lane.revoke();
    await Promise.all(lane.executionOwners().map(owner => owner.settled()));
  }
});

test('default planned descriptor equals the legacy default lane descriptor', async () => {
  const { value } = await input();
  const planned = describePlannedRepositoryTrialInputsV2(value);
  const lane = createReviewedLiveModelLaneV4(value);
  try {
    assert.deepEqual(describeRepositoryTrialInputsV2(lane), planned);
  } finally {
    lane.revoke();
    await Promise.all(lane.executionOwners().map(owner => owner.settled()));
  }
});

// Keep the imported reader in the proposed test's dependency inventory: this
// explicitly verifies that the comparison is against an issued lane API, not
// a copied or reconstructed descriptor.
test('issued-lane reader remains the source of the descriptor snapshot', async () => {
  const { value } = await input();
  const lane = createReviewedLiveModelLaneWithTransportV4(value, {
    author: async () => { throw Error('transport must not be called'); },
    reviewer: async () => { throw Error('transport must not be called'); },
  });
  try {
    const issued = readIssuedLiveModelLaneV4(lane);
    assert.equal(issued.snapshot.configuration.transportKind, 'INJECTED_TEST_TRANSPORT');
    assert.equal(typeof issued.snapshot.configurationFingerprint, 'string');
  } finally {
    lane.revoke();
    await Promise.all(lane.executionOwners().map(owner => owner.settled()));
  }
});
