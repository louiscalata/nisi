// PRIVATE: real fixed Swift/Node checks, injected model transport only.
// No live inference, arbitrary generated-code execution, app launch or publication.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildNativeArtifactKernel } from '../../hosts/swift-verifier/build.mjs';
import { createReviewedLiveFixtureV1 } from '../../examples/repository-task/reviewed-live-fixture-v1.mjs';
import { createReviewedRepositoryHostV1 } from '../../hosts/repository/reviewed-workflow-v1.mjs';
import { createReviewedLiveModelLaneWithTransportV1 } from '../../hosts/repository/reviewed-live-model-v1.mjs';
import { createLiveDemoExecutionV1 } from '../../hosts/repository/live-demo-execution-v1.mjs';
import { createRepositoryLiveModelRunV1, readRepositoryLiveModelRunV1 } from '../../receipts/repository-live-model-run-v1.mjs';

const build = buildNativeArtifactKernel(), artifacts = [];
const scope = 'FIXED_REAL_HOST_WITH_INJECTED_MODEL_TRANSPORT';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => JSON.stringify(value, null, 2) + '\n';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function bounded(promise, label, ms = 10000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error(label)), ms);
  })]); } finally { clearTimeout(timer); }
}

async function makeRun(t, { holdRepair = false } = {}) {
  const fixture = await createReviewedLiveFixtureV1();
  const evidenceRoot = await fs.mkdtemp(path.join(build.directory, 'native-live-bridge-'));
  artifacts.push(evidenceRoot);
  const host = createReviewedRepositoryHostV1({ suite: fixture.suite, build,
    scope: 'operator-exclusive-static-local-v1', targets: fixture.targets, parentRoot: evidenceRoot,
    staticTimeoutMs: 5000, totalTestTimeoutMs: 10000, testTimeoutMs: 5000, closeGraceMs: 500 });
  const repairStarted = deferred(), releaseRepair = deferred(), requests = [];
  const lane = createReviewedLiveModelLaneWithTransportV1({ suite: fixture.suite,
    reviewedSourceFingerprint: fixture.reviewedSourceFingerprint,
    endpoint: 'http://127.0.0.1:1234/v1/chat/completions', authorModel: 'synthetic.author', reviewerModel: 'synthetic.reviewer',
    timeoutMs: 10000, maxOutputTokens: 512, approval: { id: 'native.synthetic.approval', expiresAtMs: 10000 } },
  async (_url, request) => {
    const body = JSON.parse(request.body), payload = JSON.parse(body.messages[1].content);
    requests.push(payload);
    if (payload.operation === 'repair') {
      repairStarted.resolve();
      if (holdRepair) await releaseRepair.promise;
    }
    const content = payload.operation === 'repair'
      ? { status: 'REPAIRED', candidate: { files: fixture.preparations[1].candidate.files }, note: 'Injected registered repair' }
      : { findings: [], summary: 'Injected fixed review' };
    // Deliberately omit usage: unknown token counts are not measured savings.
    return new Response(JSON.stringify({ model: body.model,
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }] }));
  }, () => 100);
  const counts = { host: 0, model: 0, revoke: 0 }, retained = new Map(), writes = [];
  const modelOwners = lane.executionOwners().map(owner => ({ ...owner,
    settled: () => { counts.model++; return owner.settled(); } }));
  const controller = new AbortController();
  const bridge = createLiveDemoExecutionV1({
    host: { ...host, settled: () => { counts.host++; return host.settled(); } },
    lane: { ...lane, executionOwners: () => modelOwners, revoke: () => { counts.revoke++; return lane.revoke(); } },
    controller, settleTimeoutMs: 50,
    binding: { scope, evidenceRoot, reviewedSourceFingerprint: fixture.reviewedSourceFingerprint },
    retain: async (name, value) => {
      const bytes = encode(value);
      await fs.writeFile(path.join(evidenceRoot, name), bytes, { flag: 'wx' });
      writes.push(name); retained.set(name, bytes);
    },
  });
  let running;
  const options = () => ({ authorizeContext: lane.authorizeContext, author: lane.author,
    reviewers: lane.reviewers, signal: controller.signal });
  // Always release the test-owned transport; preserve evidence even on failure.
  t.after(async () => {
    releaseRepair.resolve();
    if (running) {
      if (bridge.lateStatus().state === 'NOT_STARTED') bridge.interrupt();
      const deadline = Date.now() + 10000, errors = [];
      for (const [name, operation] of [ ['workflow', () => running], ['host', () => bridge.hostSettled()],
        ['bridge', () => bridge.finish()], ['late', () => bridge.lateSettled()] ]) {
        try { await bounded(Promise.resolve().then(operation), 'cleanup ' + name, Math.max(1, deadline - Date.now())); }
        catch (error) { errors.push(error); }
      }
      if (errors.length) throw new AggregateError(errors, 'native bridge cleanup incomplete');
    }
    for (const entry of fixture.reviewedSourceManifest) {
      const bytes = await fs.readFile(new URL('../../examples/repository-task/' + entry.path, import.meta.url));
      assert.equal(bytes.length, entry.byteLength); assert.equal(hash(bytes), entry.sha256);
    }
  });
  return { fixture, evidenceRoot, host, lane, bridge, controller, counts, requests, retained, writes,
    repairStarted, releaseRepair, options,
    run: () => { running = host.run(options()); running.catch(() => {}); return running; },
    read: name => fs.readFile(path.join(evidenceRoot, name), 'utf8'),
    record: (name, value) => fs.writeFile(path.join(evidenceRoot, name), encode(value), { flag: 'wx' }),
  };
}

async function assertRealChecks(s, result, attempts) {
  assert.equal(result.staticHistory.length, attempts); assert.equal(result.testHistory.length, attempts);
  assert.deepEqual(result.testHistory.map(h => h.adapterResult.evidence.assertionsPassed), [8, 10].slice(0, attempts));
  assert.deepEqual(result.testHistory.map(h => h.execution.receipt.result.status), ['FAIL', 'PASS'].slice(0, attempts));
  for (const [attempt, h] of result.staticHistory.entries()) {
    const n = result.testHistory[attempt];
    assert.equal(h.observations.length, 4); assert.equal(h.group.aggregate.status, 'PASS');
    for (const key of ['runId', 'taskFingerprint', 'attempt', 'candidateFingerprint', 'baselineFingerprint', 'materializedFingerprint', 'preparationFingerprint'])
      assert.equal(h.plan.binding[key], n.execution.expected.binding[key]);
    assert.equal(h.plan.binding.candidateFingerprint, s.fixture.preparations[attempt].candidateFingerprint);
    for (const o of h.observations) {
      assert.equal(o.receipt.process.started, true); assert.equal(o.receipt.process.closed, true);
      assert.equal(o.receipt.process.drain, 'CONFIRMED'); assert.equal(o.reservation.released, true);
    }
    assert.equal(n.execution.receipt.process.started, true); assert.equal(n.execution.receipt.process.closed, true);
    assert.equal(n.execution.receipt.process.drain, 'CONFIRMED');
    assert.equal(n.workspace.root.startsWith(s.evidenceRoot + path.sep), true);
    for (const file of s.fixture.baseline.files.filter(f => f.path !== 'retry-settings.mjs'))
      assert.equal(await fs.readFile(path.join(n.workspace.root, file.path), 'utf8'), file.content);
  }
  assert.equal(new Set(result.testHistory.map(h => h.workspace.root)).size, attempts);
  for (const key of ['applied', 'sandboxed', 'authorizing', 'certificationGranted']) assert.equal(result[key], false);
}

async function assertLinkedEvidence(s) {
  const intentBytes = await s.read('execution-intent.json'), finalBytes = await s.read('execution-final.json');
  const intent = JSON.parse(intentBytes), final = JSON.parse(finalBytes);
  const terminal = JSON.parse(await s.read('execution-settlement.json'));
  assert.equal(terminal.schemaVersion, 'nisi-live-execution-settlement/v2');
  assert.equal(intent.authorizing, false); assert.equal(final.authorizing, false);
  assert.equal(final.intentSha256, hash(intentBytes)); assert.equal(terminal.intentSha256, hash(intentBytes));
  assert.equal(terminal.observationSha256, hash(finalBytes));
  assert.equal(terminal.authorizing, false); assert.equal(terminal.upgradesEarlierOutcome, false);
  assert.equal(terminal.remoteInferenceStopped, 'NOT_OBSERVED');
  assert.deepEqual(terminal.outcomes.map(o => [o.id, o.settlement]),
    [['repository.host', 'FULFILLED'], ['model.shared', 'FULFILLED']]);
  // Full owner objects retain live capabilities and must still refuse cloning.
  assert.deepEqual(terminal.hostResult, { availability: 'UNAVAILABLE', code: 'INPUT_VALUE_INVALID' });
  assert.equal(terminal.hostEvidence.availability, 'AVAILABLE');
  assert.equal(terminal.hostEvidence.value.schemaVersion, 'nisi-reviewed-repository-host-evidence/v1');
  assert.equal(terminal.hostEvidence.value.restoresAuthority, false);
  assert.equal(terminal.materialization.availability, 'AVAILABLE');
  assert.equal(terminal.modelLane.value.remoteInferenceStopped, 'NOT_OBSERVED');
  assert.deepEqual(s.writes, ['execution-intent.json', 'execution-final.json', 'execution-settlement.json']);
  return terminal;
}

test('real fixed host and bridge retain successful checks without claiming live inference', { timeout: 60000 }, async t => {
  const s = await makeRun(t);
  assert.deepEqual(s.counts, { host: 0, model: 0, revoke: 0 });
  const report = await s.run(), join = s.bridge.hostSettled();
  assert.equal(s.bridge.hostSettled() === join, true, 'bridge must reuse the original host join');
  const result = await join;
  assert.strictEqual(result.report, report); assert.equal(report.outcome, 'COMPLETED');
  assert.equal(report.workflowOutcome, 'COMPLETED'); assert.equal(report.repairAttempts, 1);
  assert.equal(result.state, 'SETTLED'); assert.equal(result.bundleError, null);
  await assertRealChecks(s, result, 2);
  assert.deepEqual(s.requests.map(r => r.operation), ['repair', 'review']);
  assert.equal(result.proposedChanges.changes.length, 1);
  const change = result.proposedChanges.changes[0];
  assert.equal(change.path, 'retry-settings.mjs');
  assert.equal(change.before.content, s.fixture.preparations[0].candidate.files[0].content);
  assert.equal(change.after.content, s.fixture.preparations[1].candidate.files[0].content);
  const context = { lane: s.lane, hostResult: result }, receipt = createRepositoryLiveModelRunV1(context);
  assert.equal(receipt.status, 'SYNTHETIC_CONTRACT_PASS');
  for (const key of ['modelAuthenticityAttested', 'executionAttested', 'causalClaim', 'authorizing', 'certificationGranted', 'publicationAuthorized'])
    assert.equal(receipt[key], false);
  assert.throws(() => readRepositoryLiveModelRunV1({ ...receipt, status: 'SCOPED_LIVE_REPAIR_REVIEW_PASS' }, context),
    { code: 'LIVE_RUN_RECORD_MISMATCH' });
  await s.record('run-before-close.json', { scope, report, result, receipt });
  const finish = s.bridge.finish(); assert.strictEqual(s.bridge.finish(), finish);
  const finished = await finish;
  assert.equal(finished.observation.status, 'OFF'); assert.equal(finished.late.state, 'RETAINED');
  assert.deepEqual(finished.late.errors, []);
  const terminal = await assertLinkedEvidence(s);
  assert.deepEqual(terminal.hostEvidence.value.report, JSON.parse(encode(report)));
  assert.deepEqual(terminal.hostEvidence.value.bundle, JSON.parse(encode(result.bundle)));
  for (const [i, row] of terminal.hostEvidence.value.testHistory.entries()) {
    assert.equal(row.workspace.root, result.testHistory[i].workspace.root);
    assert.deepEqual(row.workspace.manifest, JSON.parse(encode(result.testHistory[i].workspace.manifest)));
    assert.equal(row.workspace.state, 'POSTCHECKED'); assert.equal(row.workspace.capabilitiesRetained, false);
    assert.equal(row.workspace.stateProvenance, 'ISSUED_OWNER_AT_CAPTURE');
    assert.deepEqual(Object.keys(row.workspace).sort(), ['capabilitiesRetained', 'manifest', 'root', 'state', 'stateProvenance']);
  }
  assert.deepEqual(s.counts, { host: 1, model: 1, revoke: 1 });
  assert.equal(s.bridge.hostSettled() === join, true, 'bridge must retain the original host join after finish');
  assert.equal(s.lane.snapshot().revoked, true); assert.equal(s.lane.snapshot().lifecycle.pendingTransports, 0);
});

test('interrupt waits for the original held model transport without upgrading earlier evidence', { timeout: 60000 }, async t => {
  const s = await makeRun(t, { holdRepair: true }), running = s.run();
  await bounded(s.repairStarted.promise, 'native host never reached repair');
  assert.equal(s.retained.size, 0); s.bridge.interrupt();
  const report = await bounded(running, 'interrupt did not return outwardly');
  assert.equal(report.outcome, 'CANCELLED'); assert.equal(report.workflowOutcome, 'CANCELLED');
  const join = s.bridge.hostSettled();
  assert.equal(s.bridge.hostSettled() === join, true, 'interrupted bridge must reuse the original host join');
  const result = await bounded(join, 'native host did not settle');
  await assertRealChecks(s, result, 1); assert.equal(result.proposedChanges, null);
  await s.record('interrupted-report.json', report);
  const finish = s.bridge.finish(); assert.strictEqual(s.bridge.finish(), finish);
  const finished = await bounded(finish, 'bounded bridge did not return');
  assert.equal(finished.observation.status, 'UNCONFIRMED'); assert.equal(finished.late.state, 'PENDING');
  assert.equal(s.bridge.lateStatus().state, 'PENDING');
  assert.equal(s.retained.has('execution-settlement.json'), false);
  await assert.rejects(s.read('execution-settlement.json'), { code: 'ENOENT' });
  const before = await Promise.all(['execution-intent.json', 'execution-final.json', 'interrupted-report.json'].map(s.read));
  const reportBytes = encode(report);
  assert.equal(s.lane.snapshot().lifecycle.pendingTransports, 1);
  s.releaseRepair.resolve();
  assert.equal((await bounded(s.bridge.lateSettled(), 'original model transport did not settle')).state, 'RETAINED');
  assert.deepEqual(s.bridge.lateStatus().errors, []);
  assert.deepEqual(await Promise.all(['execution-intent.json', 'execution-final.json', 'interrupted-report.json'].map(s.read)), before);
  assert.equal(encode(report), reportBytes); assert.strictEqual(await s.bridge.finish(), finished);
  const terminal = await assertLinkedEvidence(s);
  assert.deepEqual(terminal.hostEvidence.value.report, JSON.parse(reportBytes));
  assert.equal(terminal.hostEvidence.value.testHistory.length, 1);
  assert.equal(terminal.outcomes.find(o => o.id === 'model.shared').status.value, 'QUARANTINED');
  assert.equal(s.lane.snapshot().lifecycle.pendingTransports, 0); assert.equal(s.lane.snapshot().lifecycle.recoveryRequired, true);
  assert.deepEqual(s.requests.map(r => r.operation), ['repair']);
  assert.deepEqual(s.counts, { host: 1, model: 1, revoke: 1 });
  assert.throws(() => s.host.run(s.options()), { code: 'REPOSITORY_HOST_ALREADY_USED' });
  assert.throws(() => s.lane.authorizeContext.authorize({}), { code: 'LIVE_APPROVAL_REVOKED' });
});

test.after(() => console.log(JSON.stringify({ scope, buildManifest: path.join(build.directory, 'build-manifest.json'),
  artifacts, modelInference: false, nativeApp: false, fullMerger: false })));
