import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  createPairedTrialRunnerV1,
  readOriginalPairedTrialEventV1,
} from '../evaluation/paired-trial-runner-v1.mjs';
import {
  createRepositoryWorkflowOwnerV1,
  readIssuedRepositoryWorkflowOwnerV1,
} from '../hosts/repository/reviewed-workflow-v1.mjs';
import {
  createRepositoryTrialOracleV1,
  readIssuedRepositoryTrialOracleV1,
} from '../hosts/repository/paired-trial-oracle-v1.mjs';
import {
  createReviewedRepositoryOracleV1,
  readIssuedRepositoryOracleV1,
} from '../examples/repository-task/reviewed-oracle-fixture-v1.mjs';
import { pairedTrialFixtureInputs } from './helpers/paired-trial-fixture.mjs';
import { context as repositoryContext } from './helpers/node-repository-fixture.mjs';
import { context as liveModelContext } from './helpers/live-model-v4-fixture.mjs';
import { readIssuedLiveModelLaneIdentityV4 } from '../hosts/repository/reviewed-live-model-v4.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const operation = result => Object.freeze({
  result: Promise.resolve(result), settled: Promise.resolve(), status: () => 'IDLE', cancel() {},
});
const ownerStub = (method, state) => ({
  registrationFingerprint: 'a'.repeat(64),
  [method]: async () => { throw Error('NOT_DISPATCHED'); },
  settled: async () => [], observations: () => [], status: () => state.value,
  lateObservations: () => [],
});
const refuses = (reader, value, code) => assert.throws(() => reader(value), { code });

test('only original retained runner events carry event issuance identity', async () => {
  const { plan, profile } = pairedTrialFixtureInputs(), retained = [];
  const candidateText = 'OWNER_IDENTITY_FIXED_CANDIDATE', candidateSha256 = sha256(candidateText);
  const runner = createPairedTrialRunnerV1({ plan, profile, host: {
    retain(event) { retained.push(event); return Promise.resolve(); },
    verifyInputs: () => true,
    startExecutor(intent) {
      return operation({ requestId: intent.requestId, profileSha256: intent.profileSha256,
        candidateText, candidateSha256, completionClaim: false,
        tokenUsage: { input: 0, output: 0 }, durationMs: 0, repairAttempts: 0, modelCalls: 0 });
    },
    startOracle(request) {
      return operation({ requestId: request.requestId, oracleSha256: request.oracleSha256,
        oracleCandidateSha256: request.candidateSha256, outcome: 'PASS' });
    },
  } });
  const report = await runner.run();
  assert.equal(report.status, 'COMPLETE');
  assert(retained.length < report.events.length, 'diagnostic-only events are not passed to retention');

  for (const original of retained) {
    const issued = readOriginalPairedTrialEventV1(original);
    assert.strictEqual(issued.event, original);
    assert.equal(issued.runnerId, report.runnerId);
    assert.equal(issued.plan.planSha256, report.planSha256);
    assert.equal(issued.profile.profileSha256, report.profileSha256);
    const inspected = report.events.find(event => event.sequence === original.sequence);
    assert(inspected); assert.notStrictEqual(inspected, original);
    refuses(readOriginalPairedTrialEventV1, inspected, 'RUNNER_EVENT_NOT_ISSUED');
    refuses(readOriginalPairedTrialEventV1, { ...original }, 'RUNNER_EVENT_NOT_ISSUED');
    refuses(readOriginalPairedTrialEventV1, structuredClone(original), 'RUNNER_EVENT_NOT_ISSUED');
  }
  const reopened = JSON.parse(JSON.stringify(retained[0]));
  refuses(readOriginalPairedTrialEventV1, reopened, 'RUNNER_EVENT_NOT_ISSUED');
  assert.equal(Object.hasOwn(readOriginalPairedTrialEventV1(retained[0]), 'authorizing'), false);
});

test('workflow reader preserves exact child identities and observes their current states', async t => {
  const fixture = await repositoryContext(t), staticState = { value: 'IDLE' }, testState = { value: 'IDLE' };
  const staticOwner = ownerStub('check', staticState), testsOwner = ownerStub('run', testState);
  const host = createRepositoryWorkflowOwnerV1({ suite: fixture.suite, staticOwner, testsOwner });
  const first = readIssuedRepositoryWorkflowOwnerV1(host);
  assert.strictEqual(first.suite, fixture.suite);
  assert.strictEqual(first.staticOwner, staticOwner);
  assert.strictEqual(first.testsOwner, testsOwner);
  assert.deepEqual(first.ownerStates, { staticChecks: 'IDLE', tests: 'IDLE' });
  assert.equal(first.state, 'NEW');

  staticState.value = 'BUSY'; testState.value = 'QUARANTINED';
  const second = readIssuedRepositoryWorkflowOwnerV1(host);
  assert.strictEqual(second.staticOwner, staticOwner);
  assert.strictEqual(second.testsOwner, testsOwner);
  assert.deepEqual(second.ownerStates, { staticChecks: 'BUSY', tests: 'QUARANTINED' });
  assert.notDeepEqual(second.ownerStates, first.ownerStates);
  assert.equal(Object.hasOwn(second, 'authorizing'), false);

  for (const copy of [{ ...host }, structuredClone({ status: 'NEW' }), Object.freeze({ ...host })])
    refuses(readIssuedRepositoryWorkflowOwnerV1, copy, 'REPOSITORY_HOST_NOT_ISSUED');
});

test('oracle reader requires exact owner and exposes exact registration, binding, and live state', async t => {
  const registration = await createReviewedRepositoryOracleV1(), registered = readIssuedRepositoryOracleV1(registration);
  const parentRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nisi-owner-identity-'));
  t.after(() => fs.rm(parentRoot, { recursive: true, force: true }));
  const binding = Object.freeze({ requestId: 'a'.repeat(64), profileSha256: 'b'.repeat(64),
    ...registration.workflow, oracleSha256: registration.oracleSha256 });
  const owner = createRepositoryTrialOracleV1({ registration, binding, parentRoot,
    materializationTimeoutMs: 10000, totalTimeoutMs: 10000, childTimeoutMs: 5000, closeGraceMs: 500 });
  const view = readIssuedRepositoryTrialOracleV1(owner);
  assert.strictEqual(view.registration, registered.registration);
  assert.deepEqual({ ...view.binding }, binding);
  assert.equal(view.state, 'NEW');
  assert.equal(Object.hasOwn(view, 'authorizing'), false);

  for (const copy of [{ ...owner }, Object.freeze({ ...owner }), structuredClone(owner.inspect())])
    refuses(readIssuedRepositoryTrialOracleV1, copy, 'ORACLE_OWNER_NOT_ISSUED');

  const originalStart = owner.start;
  assert.throws(() => owner.start({ requestId: binding.requestId, oracleSha256: binding.oracleSha256,
    candidateSha256: '0'.repeat(64), candidateText: '' }), { code: 'TRIAL_CANDIDATE_TEXT_HASH' });
  assert.strictEqual(owner.start, originalStart);
  assert.equal(readIssuedRepositoryTrialOracleV1(owner).state, 'NEW');
  assert.deepEqual(await fs.readdir(parentRoot), []);
});

test('V4 lane identity reader returns stable original owners without granting authority', async () => {
  const c = await liveModelContext(), first = readIssuedLiveModelLaneIdentityV4(c.lane);
  const second = readIssuedLiveModelLaneIdentityV4(c.lane);
  assert.strictEqual(first.suite, c.fixture.suite);
  assert.strictEqual(first.suite, second.suite);
  assert.strictEqual(first.executionOwners, second.executionOwners);
  assert.strictEqual(first.executionOwners, c.lane.executionOwners());
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.executionOwners), true);
  assert.equal(first.executionOwners.length, 2);
  for (const [index, owner] of first.executionOwners.entries()) {
    assert.strictEqual(owner, second.executionOwners[index]);
    assert.strictEqual(owner, c.lane.executionOwners()[index]);
    assert.equal(Object.isFrozen(owner), true);
  }
  for (const key of ['authorizing', 'executionGranted', 'executionAttested',
    'measurementVerified', 'publicationAuthorized', 'promotionEligible'])
    assert.equal(Object.hasOwn(first, key), false, `identity view must not grant ${key}`);
});

test('V4 lane identity reader rejects copied and reconstructed lane shapes', async () => {
  const c = await liveModelContext();
  for (const copy of [{ ...c.lane }, Object.freeze({ ...c.lane }), c.lane.snapshot(),
    Object.freeze({ executionOwners: c.lane.executionOwners, snapshot: c.lane.snapshot })])
    refuses(readIssuedLiveModelLaneIdentityV4, copy, 'LIVE_LANE_NOT_ISSUED');
  assert.strictEqual(readIssuedLiveModelLaneIdentityV4(c.lane).executionOwners, c.lane.executionOwners());
});
