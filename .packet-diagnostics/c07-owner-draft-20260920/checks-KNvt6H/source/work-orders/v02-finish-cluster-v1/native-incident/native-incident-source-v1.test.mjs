// Additive C07 source-identity delta. Existing source-plan/public/private
// snapshots remain unchanged; this tests only the separate issued accessor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoundaryNativeIncidentFixture } from '../../../tests/helpers/native-incident-source-fixture.mjs';
import { issuedSwiftChecksV1 } from '../../../hosts/swift-verifier/check-plan-v1.mjs';
import { readNativeIncidentSourceInputV1, readNativeIncidentExecutionIdentityV1 } from '../../../hosts/repository/native-incident-source-v1.mjs';

async function issued(t) {
  const fixture = await createBoundaryNativeIncidentFixture(t);
  const preview = fixture.host.incidentPreview();
  const row = preview.rows.find(value => value.classification === 'FAILURE_CANDIDATE' && value.binding.stage === 'staticChecks');
  assert.ok(row, 'fixture supplies an original static failure row');
  const plan = fixture.host.nativeIncidentSourcePlan({ rowId: row.rowId });
  assert.equal(plan.status, 'SOURCE_BOUND');
  const original = fixture.plans.find(value => value.fingerprint === row.source.planFingerprint);
  const check = issuedSwiftChecksV1(original)[row.binding.checkIndex];
  return { fixture, row, plan, original, check };
}

test('additive execution identity is exact issued expectation data and leaves v1 projections byte-compatible', async t => {
  const value = await issued(t);
  const sourceBefore = readNativeIncidentSourceInputV1({ plan: value.plan });
  const identity = readNativeIncidentExecutionIdentityV1({ plan: value.plan });
  assert.deepEqual(Object.keys(identity).sort(), [
    'authorizing', 'executableSha256', 'expectationFingerprint', 'profileFingerprint', 'schemaVersion'
  ].sort());
  assert.equal(identity.schemaVersion, 'nisi-native-incident-execution-identity/v1');
  assert.equal(identity.expectationFingerprint, value.check.expected.fingerprint);
  assert.equal(identity.profileFingerprint, value.check.expected.binding.profileFingerprint);
  assert.equal(identity.executableSha256, value.check.expected.profile.executableSha256);
  assert.equal(identity.authorizing, false);
  assert.equal(Object.isFrozen(identity), true);
  assert.equal(readNativeIncidentSourceInputV1({ plan: value.plan }), sourceBefore,
    'the original private source object is returned unchanged');
  assert.equal(Object.hasOwn(value.plan.selection, 'executableSha256'), false,
    'v1 public selection does not gain additive fields');
  assert.equal(Object.hasOwn(sourceBefore, 'executionProfileSha256'), false,
    'v1 private source body does not gain additive fields');
});

test('execution identity is issued-object bound and rejects clones, hashes, and accessor inputs without traversal', async t => {
  const value = await issued(t);
  for (const plan of [structuredClone(value.plan), { ...value.plan }, { sourcePlanDigest: value.plan.sourcePlanDigest }]) {
    assert.throws(() => readNativeIncidentExecutionIdentityV1({ plan }), { code: 'NATIVE_EXECUTION_IDENTITY_NOT_ISSUED' });
  }
  let touched = 0;
  const poisoned = Object.defineProperty({}, 'plan', { enumerable: true, get() { touched += 1; throw Error('MUST_NOT_READ'); } });
  assert.throws(() => readNativeIncidentExecutionIdentityV1(poisoned), { code: 'NATIVE_EXECUTION_IDENTITY_INPUT' });
  assert.equal(touched, 0);
});

