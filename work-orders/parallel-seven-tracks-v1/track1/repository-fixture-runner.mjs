// Track 1 repository-fixture-runner (OpenCode, 2026-09-14).
// Deterministic, model-free acceptance runner for the reviewed live fixture.
// Runs the product reviewed host with INERT owners/adapters: no real Swift or
// Node child is spawned, no model lane is contacted, no network/process/exit
// primitives are used. Temporary workspaces exist only inside an owned root
// created under the caller's parentRoot and are removed before return.
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createReviewedLiveFixtureV1, createReviewedLiveFixtureFromSourcesV1 } from '../../../examples/repository-task/reviewed-live-fixture-v1.mjs';
import { createRepositoryWorkflowOwnerV1 } from '../../../hosts/repository/reviewed-workflow-v1.mjs';
import { prepareRepositoryCandidate } from '../../../hosts/repository/snapshot-contract.mjs';
import { createNodeExecutorWithDependenciesV1, nodeTestAdapterResultV1 } from '../../../hosts/repository/node-executor-v1.mjs';
import { materializeRepositoryCandidateV1, TASK_WORKSPACE_PROFILE } from '../../../hosts/repository/task-workspace-v1.mjs';
import { createSwiftCheckPlanV1, issuedSwiftChecksV1 } from '../../../hosts/swift-verifier/check-plan-v1.mjs';
import { createSwiftStaticGroupV1 } from '../../../receipts/swift-static-group-v1.mjs';
import { hashBytes } from '../../../hosts/swift-verifier/protocol.mjs';

export const REPOSITORY_FIXTURE_RUNNER_PROFILE = 'repository-fixture-runner-v1';

const refuse = code => { throw Object.assign(new Error(code), { code }); };
const is = (value, type) => Object.prototype.toString.call(value) === `[object ${type}]`;

// Inert Swift execution profile. Satisfies the fixed profile gates
// (darwin/arm64, timeoutMs <= 60000, maximumOutputBytes === 16384).
const STATIC_PROFILE = Object.freeze({
  sourceSha256: '1'.repeat(64),
  buildSha256: '2'.repeat(64),
  executableSha256: '3'.repeat(64),
  argv: [],
  environmentSha256: '4'.repeat(64),
  cwd: '.',
  platform: 'darwin',
  architecture: 'arm64',
  timeoutMs: 5000,
  maximumOutputBytes: 16384,
});

// Inert Node runtime observation. Not an attestation of any real binary.
const FAKE_RUNTIME = Object.freeze({ path: '/test/node', sha256: 'a'.repeat(64), ino: '1' });

// Synthetic child report frame + wire, re-implemented inline (product helpers
// under tests/ are deliberately NOT imported; the runner is self-contained).
function passingReport(suite) {
  const total = suite.assertionNames.length;
  return { schemaVersion: suite.reportSchema, status: 'PASS', assertionsExecuted: total, assertionsPassed: total, failures: [] };
}
const wire = value => Buffer.from(JSON.stringify(value) + '\n');

// Synthetic EventEmitter child that behaves like a clean PASSing node child.
function createFakeChild(reportBytes) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.kills = [];
  child.kill = signal => { child.kills.push(signal); return true; };
  child.stdin.end = bytes => { child.input = Buffer.from(bytes); };
  queueMicrotask(() => {
    child.emit('spawn');
    child.stdout.emit('data', reportBytes);
    child.exitCode = 0;
    child.emit('exit', 0, null);
    child.emit('close', 0, null);
  });
  return child;
}

// Native report frame for one fixed-check target. Missing/unavailable frames
// are NOT synthesized as failures; every dispatched target is observed.
function nativeFrame(request, status) {
  return Buffer.from(JSON.stringify({
    ...request.header, requestSha256: request.requestSha256,
    artifactByteLength: request.artifactByteLength, status, authorizing: false,
    outcomes: [
      { id: 'DET-001-NONEMPTY', status: 'PASS', explanation: 'Fixture nonempty' },
      { id: 'DET-002-UTF8', status: 'PASS', explanation: 'Fixture UTF8' },
      { id: request.profile.kind === 'json' ? 'DET-003-JSON-STRUCTURE' : 'DET-003-REQUIRED-SECTIONS', status,
        explanation: 'Synthetic structure finding' },
    ],
  }) + '\n');
}

// Group entry replica of tests/helpers/swift-group-fixture.mjs entry(): an
// observed dispatched child with a clean CONFIRMED close and matching hex.
function swiftEntry(p, index, status) {
  const { expected, request } = issuedSwiftChecksV1(p)[index];
  const bytes = !['PASS', 'FAIL'].includes(status) ? Buffer.alloc(0) : nativeFrame(request, status);
  const output = b => ({ capturedBytes: b.length, observedBytes: b.length, sha256: hashBytes(b), truncated: false });
  const process = { started: true, closed: true, drain: 'CONFIRMED', exitCode: 0, signal: null,
    errorCode: status === 'ERROR' ? 'FIXTURE_ERROR' : null, deadlineExceeded: false, cancelRequested: false,
    durationMs: 1 };
  return { dispatch: 'OBSERVED', receipt: { schemaVersion: 1, expectationFingerprint: expected.fingerprint,
    binding: expected.binding, process, outputs: { stdout: output(bytes), stderr: output(Buffer.alloc(0)) },
    result: { status, reason: status === 'PASS' ? '' : status === 'FAIL' ? 'SWIFT_ARTIFACT_FAILED' : 'FIXTURE_UNAVAILABLE' } },
    stdoutHex: bytes.toString('hex'), stderrHex: '' };
}

// Inert static owner: issues plans/groups directly (no spawned checker) and
// exposes the owner seam the reviewed host requires. attempt 0 FAILs every
// target (baseline), attempt 1+ PASSes them (repaired candidate).
function createInertStaticOwner({ baseline, targets, preparations }) {
  let nextAttempt = 0, boundRun = null;
  const history = [];
  async function check(payload) {
    const { task, candidate, binding, signal } = payload;
    if (signal !== undefined && !(signal instanceof AbortSignal)) refuse('STATIC_OWNER_SIGNAL');
    const preparation = prepareRepositoryCandidate({ baseline, task, candidate: { files: candidate.files }, authorId: candidate.authorId });
    if (binding.schemaVersion !== 1 || preparation.taskFingerprint !== binding.taskFingerprint ||
        preparation.candidateFingerprint !== binding.candidateFingerprint || binding.attempt !== nextAttempt ||
        (boundRun !== null && binding.runId !== boundRun)) refuse('STATIC_OWNER_BINDING');
    boundRun = binding.runId; nextAttempt++;
    const plan = createSwiftCheckPlanV1({ preparation, runId: binding.runId, attempt: binding.attempt, targets, executionProfile: STATIC_PROFILE });
    const status = binding.attempt === 0 ? 'FAIL' : 'PASS';
    const entries = issuedSwiftChecksV1(plan).map((_, index) => swiftEntry(plan, index, status));
    const group = createSwiftStaticGroupV1(plan, entries, null);
    history.push(Object.freeze({ plan, group, observations: Object.freeze([]), error: null }));
    return group.adapterResult;
  }
  async function settled() { return Object.freeze([...history]); }
  return Object.freeze({ check, settled, observations: () => Object.freeze([...history]),
    status: () => 'IDLE', lateObservations: () => Object.freeze([]) });
}

// Inert tests owner: materializes the candidate workspace under the OWNED root
// and executes through the product node executor with an injected synthetic
// child. No real node process is launched; evidence is synthetic and never
// attests native execution.
function createInertTestsOwner({ suite, preparations, ownedRoot, inject }) {
  const executor = createNodeExecutorWithDependenciesV1(
    { suite, totalTimeoutMs: 1000, childTimeoutMs: 500, closeGraceMs: 10 },
    { observeExecutable: () => FAKE_RUNTIME, now: () => 0, spawnChild: () => createFakeChild(wire(passingReport(suite))) },
  );
  const history = [];
  let inFlight = null, boundRun = null, lastAttempt = -1, quarantined = false;
  const base = { run: null, settled: null, observations: null, status: null, lateObservations: null,
    registrationFingerprint: executor.registrationFingerprint };
  async function work(payload) {
    const { task, candidate, binding, signal } = payload;
    const captured = prepareRepositoryCandidate({ baseline: preparations[0].baseline, task,
      candidate: { files: candidate.files }, authorId: candidate.authorId });
    const preparation = preparations.find(p => p.fingerprint === captured.fingerprint);
    if (!preparation || binding.schemaVersion !== 1 || binding.taskFingerprint !== preparation.taskFingerprint ||
        binding.candidateFingerprint !== preparation.candidateFingerprint || !Number.isSafeInteger(binding.attempt) ||
        binding.attempt < 0 || binding.attempt > preparation.task.policy.repairBudget || binding.attempt <= lastAttempt ||
        (boundRun !== null && boundRun !== binding.runId)) refuse('TESTS_OWNER_BINDING');
    if (signal !== undefined && !(signal instanceof AbortSignal)) refuse('TESTS_OWNER_SIGNAL');
    boundRun = binding.runId; lastAttempt = binding.attempt;
    let workspace = null, execution = null;
    try {
      workspace = await materializeRepositoryCandidateV1({ preparation, parentRoot: ownedRoot, profile: TASK_WORKSPACE_PROFILE });
      execution = await executor.execute({ workspace, runId: binding.runId, attempt: binding.attempt, signal });
      const adapterResult = nodeTestAdapterResultV1(execution);
      history.push(Object.freeze({ preparation, workspace, execution, adapterResult, error: null }));
      return adapterResult;
    } catch (error) {
      quarantined = true;
      history.push(Object.freeze({ preparation, workspace, execution, adapterResult: null,
        error: typeof error?.code === 'string' ? error.code : 'TESTS_OWNER_ERROR' }));
      throw error;
    }
  }
  const owner = {
    registrationFingerprint: executor.registrationFingerprint,
    run: payload => {
      if (inFlight) refuse('TESTS_OWNER_BUSY');
      if (quarantined || executor.status() !== 'IDLE') refuse('TESTS_OWNER_QUARANTINED');
      if (history.length >= 101) refuse('TESTS_OWNER_HISTORY_LIMIT');
      const operation = Promise.resolve().then(() => work(payload));
      inFlight = operation;
      return operation.finally(() => { inFlight = null; });
    },
    async settled() { if (inFlight) { try { await inFlight; } catch {} await Promise.resolve(); } return Object.freeze([...history]); },
    observations: () => Object.freeze([...history]),
    status: () => quarantined ? 'QUARANTINED' : inFlight ? 'BUSY' : executor.status(),
    lateObservations: executor.lateObservations,
  };
// The test-only inject seam replaces methods (e.g. settled) with synthetic
// failures while every other method stays inert. Merging preserves the
// registration fingerprint the reviewed host requires.
  const overrides = inject && is(inject, 'Object') && inject.testsOwner && is(inject.testsOwner, 'Object') ? inject.testsOwner : {};
  return Object.freeze({ ...owner, ...overrides });
}

const retainedRecord = (pathText, text) => Object.freeze({
  path: pathText, byteLength: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex'),
});

// Shape validation. Argument-shape errors THROW RUNNER_ARGS before any write;
// profile/source mismatches are refused results, not argument errors.
async function validateArgs(input, parentRoot, profile) {
  if (input === undefined || input === null || typeof input !== 'object' || Array.isArray(input)) refuse('RUNNER_ARGS');
  if (typeof parentRoot !== 'string' || parentRoot.length === 0 || parentRoot.length > 4096 ||
      !parentRoot.isWellFormed() || parentRoot.includes('\0') || !path.isAbsolute(parentRoot)) refuse('RUNNER_ARGS');
  if (typeof profile !== 'string' || profile.length === 0) refuse('RUNNER_ARGS');
  let stat;
  try { stat = await fsp.stat(parentRoot); } catch { refuse('RUNNER_ARGS'); }
  if (!stat.isDirectory()) refuse('RUNNER_ARGS');
  if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) refuse('RUNNER_ARGS');
  if (input.inject !== undefined && (!is(input.inject, 'Object') ||
      (input.inject.testsOwner !== undefined && !is(input.inject.testsOwner, 'Object')))) refuse('RUNNER_ARGS');
  if (input.sources !== undefined) {
    if (!is(input.sources, 'Object')) refuse('RUNNER_ARGS');
    for (const key of Object.keys(input.sources)) if (!Buffer.isBuffer(input.sources[key])) refuse('RUNNER_ARGS');
  }
}

const refusalResult = reason => Object.freeze({
  status: 'REFUSED', reason, workflowOutcome: null, repairAttempts: 0, candidateFingerprint: null,
  preparationFingerprints: Object.freeze([]), revealedSourceManifest: null, reviewedSourceFingerprint: null,
  modelContacted: false, authorizing: false, publishingAllowed: false, settledBeforeReceipt: false,
  hostResult: null, receipt: null, retained: Object.freeze([]), ownedRoot: null, cleaned: true,
});

export async function runRepositoryFixtureAcceptanceV1(input) {
  const parentRoot = input?.parentRoot, profile = input?.profile;
  await validateArgs(input, parentRoot, profile);
  if (profile !== REPOSITORY_FIXTURE_RUNNER_PROFILE) return refusalResult('PROFILE_REQUIRED');

  let fixture;
  try {
    fixture = input.sources !== undefined
      ? createReviewedLiveFixtureFromSourcesV1(input.sources)
      : await createReviewedLiveFixtureV1();
  } catch { return refusalResult('SOURCE_DRIFT'); }

  const ownedRoot = await fsp.mkdtemp(path.join(parentRoot, 'nisi-fixture-'));
  await fsp.chmod(ownedRoot, 0o700);

  let outcome;
  try {
    const { suite, baseline, task, preparations, targets } = fixture;
    const staticOwner = createInertStaticOwner({ baseline, targets, preparations });
    const testsOwner = createInertTestsOwner({ suite, preparations, ownedRoot, inject: input.inject });
    const host = createRepositoryWorkflowOwnerV1({ suite, staticOwner, testsOwner });

    const evidence = (binding, extra) => Object.freeze({
      schemaVersion: binding.schemaVersion, runId: binding.runId, taskFingerprint: binding.taskFingerprint,
      attempt: binding.attempt, candidateFingerprint: extra.candidateFingerprint, ...extra.rest });
    const draft = async ({ binding }) => ({
      candidate: { files: preparations[0].candidate.files },
      evidence: evidence(binding, { candidateFingerprint: preparations[0].candidate.fingerprint, rest: { note: 'inert draft' } }),
    });
    const repair = async ({ binding }) => ({
      status: 'REPAIRED',
      candidate: { files: preparations[1].candidate.files },
      evidence: evidence(binding, { candidateFingerprint: preparations[1].candidate.fingerprint,
        rest: { baseCandidateFingerprint: binding.candidateFingerprint, note: 'inert repair' } }),
    });
    const review = async ({ binding, reviewerId }) => ({
      status: 'PASS',
      evidence: evidence(binding, { candidateFingerprint: binding.candidateFingerprint,
        rest: { reviewerId, findings: Object.freeze([]), summary: 'inert review', reason: '' } }),
    });
    const authorizeContext = { authorize: async ({ binding }) => ({
      status: 'PASS',
      evidence: Object.freeze({
        schemaVersion: binding.schemaVersion, runId: binding.runId,
        taskFingerprint: binding.taskFingerprint, attempt: binding.attempt,
        candidateFingerprint: binding.candidateFingerprint, reason: '',
      }),
    }) };

    const options = { authorizeContext, author: Object.freeze({ id: 'author.live-model', draft, repair }),
      reviewers: Object.freeze([Object.freeze({ id: 'reviewer.inert', review })]) };
    if (input.signal !== undefined) options.signal = input.signal;

    await host.run(options);
    const hostResult = await host.settled();
    const report = hostResult.report;

    const settled = hostResult.state === 'SETTLED';
    const status = settled ? 'COMPLETED' : report.outcome === 'CANCELLED' ? 'CANCELLED' : 'UNCONFIRMED';
    const receipt = settled ? Object.freeze({ schemaVersion: 'nisi-repository-fixture-receipt-v1', hostResultState: hostResult.state,
      runId: report.runId, workflowOutcome: report.workflowOutcome, candidateFingerprint: report.candidateFingerprint,
      modelContacted: false, authorizing: false, publishingAllowed: false }) : null;

    const engineText = JSON.stringify(report, null, 2) + '\n';
    const hostText = JSON.stringify(hostResult, null, 2) + '\n';
    const retained = settled
      ? Object.freeze([retainedRecord('engine-report.json', engineText), retainedRecord('host-result.json', hostText),
        retainedRecord('runner-receipt.json', JSON.stringify(receipt, null, 2) + '\n')])
      : Object.freeze([retainedRecord('engine-report.json', engineText), retainedRecord('host-result.json', hostText)]);
    await fsp.writeFile(path.join(ownedRoot, 'engine-report.json'), engineText);
    await fsp.writeFile(path.join(ownedRoot, 'host-result.json'), hostText);
    if (settled) await fsp.writeFile(path.join(ownedRoot, 'runner-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');

    outcome = Object.freeze({
      status, reason: settled ? null : hostResult.bundleError?.code ?? report.code ?? 'UNCONFIRMED',
      workflowOutcome: report.workflowOutcome, repairAttempts: report.repairAttempts,
      candidateFingerprint: report.candidateFingerprint,
      preparationFingerprints: Object.freeze(preparations.map(p => p.fingerprint)),
      revealedSourceManifest: fixture.reviewedSourceManifest, reviewedSourceFingerprint: fixture.reviewedSourceFingerprint,
      modelContacted: false, authorizing: false, publishingAllowed: false,
      settledBeforeReceipt: settled, hostResult, receipt, retained, ownedRoot, cleaned: true,
    });
  } catch (error) {
    outcome = Object.freeze({ status: 'UNCONFIRMED', reason: error?.code ?? 'RUNNER_ERROR',
      workflowOutcome: null, repairAttempts: 0, candidateFingerprint: null,
      preparationFingerprints: Object.freeze([]), revealedSourceManifest: null, reviewedSourceFingerprint: null,
      modelContacted: false, authorizing: false, publishingAllowed: false, settledBeforeReceipt: false,
      hostResult: null, receipt: null, retained: Object.freeze([]), ownedRoot, cleaned: true });
  } finally {
    try { await fsp.rm(ownedRoot, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  }
  return outcome;
}