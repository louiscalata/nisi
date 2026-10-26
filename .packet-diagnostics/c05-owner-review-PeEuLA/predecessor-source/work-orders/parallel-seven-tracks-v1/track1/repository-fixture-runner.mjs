// Track 1 repository-fixture-runner (OpenCode, 2026-09-14).
// Deterministic, model-free acceptance runner for the reviewed live fixture.
// Runs the product reviewed host with INERT owners/adapters: no real Swift or
// Node child is spawned, no model lane is contacted, no network/process/exit
// primitives are used. Temporary workspaces exist only inside an owned root
// created under the caller's parentRoot and are removed before return.
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { types } from 'node:util';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createReviewedLiveFixtureV1, createReviewedLiveFixtureFromSourcesV1 } from '../../../examples/repository-task/reviewed-live-fixture-v1.mjs';
import { createRepositoryWorkflowOwnerV1 } from '../../../hosts/repository/reviewed-workflow-v1.mjs';
import { prepareRepositoryCandidate } from '../../../hosts/repository/snapshot-contract.mjs';
import { createNodeExecutorWithDependenciesV1, nodeTestAdapterResultV1 } from '../../../hosts/repository/node-executor-v1.mjs';
import { materializeRepositoryCandidateV1, TASK_WORKSPACE_PROFILE } from '../../../hosts/repository/task-workspace-v1.mjs';
import { createSwiftCheckPlanV1, issuedSwiftChecksV1 } from '../../../hosts/swift-verifier/check-plan-v1.mjs';
import { createSwiftStaticGroupV1 } from '../../../receipts/swift-static-group-v1.mjs';
import { readRepositoryRunBundleV1 } from '../../../receipts/repository-run-v1.mjs';
import { hashBytes } from '../../../hosts/swift-verifier/protocol.mjs';

export const REPOSITORY_FIXTURE_RUNNER_PROFILE = 'repository-fixture-runner-v1';

// A refusal carries its own code; a guard that refuses because of an
// underlying OS/IO error keeps that error as `cause` so the outcome can report
// the original code (EACCES, ENOSPC, EIO, ...) beside the guard's reason.
const refuse = (code, cause) => { throw Object.assign(cause === undefined ? new Error(code) : new Error(code, { cause }), { code }); };
const coded = (code, extra) => Object.assign(new Error(code), { code, ...extra });
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
      const rootPhysical = await fsp.realpath(ownedRoot);
      const workspacePhysical = await fsp.realpath(workspace.root);
      const workspaceStat = await fsp.lstat(workspace.root);
      if (!workspaceStat.isDirectory() || workspaceStat.isSymbolicLink() ||
          workspacePhysical === rootPhysical || !workspacePhysical.startsWith(rootPhysical + path.sep)) {
        refuse('WORKSPACE_OUTSIDE_OWNED_ROOT');
      }
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

// Exclusive retention (C02). Every retained file is created with `wx` so a
// pre-existing name is refused as RETAINED_EEXIST and never overwritten; any
// other write failure is RETAINED_WRITE_FAILED with the OS error as `cause`.
// The record's byteLength and sha256 are derived from the bytes RE-READ from
// the file, never from the in-memory text; a read-back that fails carries the
// read error as `cause`, and a read-back that differs from what was handed to
// the write carries RETAINED_BYTES_DIFFER (both surface as RETAINED_READBACK).
// Records acknowledge only successful read-backs. A failed write/read can leave
// an unacknowledged file until cleanup. These are pre-cleanup observations, not
// durable storage receipts: this temporary fixture removes its owned root.
async function retainRecord(ownedRoot, retained, name, value) {
  const target = path.join(ownedRoot, name), content = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  try { await fsp.writeFile(target, content, { flag: 'wx', mode: 0o600 }); }
  catch (error) { refuse(error?.code === 'EEXIST' ? 'RETAINED_EEXIST' : 'RETAINED_WRITE_FAILED', error); }
  let bytes;
  try { bytes = await fsp.readFile(target); } catch (error) { refuse('RETAINED_READBACK', error); }
  if (!Buffer.isBuffer(bytes) || !bytes.equals(content)) {
    refuse('RETAINED_READBACK', coded('RETAINED_BYTES_DIFFER', { expectedByteLength: content.length, actualByteLength: Buffer.isBuffer(bytes) ? bytes.length : null }));
  }
  retained.push(Object.freeze({ path: name, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }));
}
// The code of a refusal's underlying error, when the refusal has one.
const detailOf = error => typeof error?.cause?.code === 'string' ? error.cause.code : null;

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

// A refusal before any owned root exists (PROFILE_REQUIRED, SOURCE_DRIFT, a
// refused mkdtemp). `cleaned:true` beside `ownedRoot:null` means no root was
// ever created, so there was nothing to remove and nothing to verify; it is
// NOT the post-removal lstat verdict a rooted run reports (C03 owner note).
const refusalResult = (reason, reasonDetail = null) => Object.freeze({
  status: 'REFUSED', reason, reasonDetail, workflowOutcome: null, repairAttempts: 0, candidateFingerprint: null,
  preparationFingerprints: Object.freeze([]), revealedSourceManifest: null, reviewedSourceFingerprint: null,
  modelContacted: false, authorizing: false, publishingAllowed: false, settledBeforeReceipt: false,
  preflight: null, hostResult: null, receipt: null, retained: Object.freeze([]), ownedRoot: null,
  cleaned: true, cleanupState: 'NOT_CREATED', cleanupError: null, residue: null,
});

// Derive-specific own-data projections. Proxy detection precedes reflection,
// including for revoked proxies. Arrays and Symbol.toStringTag records are
// refused, so classification never invokes or trusts an object label. Other
// accessors and inherited values are not record-wide schema failures: the
// descriptor snapshot lets ownData treat only that field as absent while
// preserving independent own-data clauses. No prototype value is inspected.
// Subsequent field reads use only the internal descriptor table.
function closedOwnDataRecord(value) {
  if (types.isProxy(value) || value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  let descriptors;
  try { descriptors = Object.getOwnPropertyDescriptors(value); }
  catch { return null; }
  for (const key of Reflect.ownKeys(descriptors)) {
    if (key === Symbol.toStringTag) return null;
  }
  return descriptors;
}
function ownData(record, key) {
  const descriptor = record === null ? undefined : Object.getOwnPropertyDescriptor(record, key)?.value;
  return descriptor !== undefined && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}
const codeOf = value => typeof value === 'string' && value.length > 0 ? value : null;

// Completion is DERIVED from the observed outcomes (C03), never from host
// settlement alone: the product's SETTLED means the owners drained and the
// evidence is consistent, and its bundle admits interrupted (CANCELLED,
// TIMED_OUT) and FAILED reports. The predicate is a closed reader over the
// exported surface: hostResult and report must be plain objects and every
// clause reads an own data property, so an unknown, absent, inherited or
// accessor-backed value is false and never coerces toward COMPLETED. Every
// clause is reported so a false one names itself. This preliminary completion
// observation does NOT authorize a receipt: the caller additionally requires
// the independently reconstructed C02 bundle and successful cleanup. An interrupted report
// keeps the engine's own code (ABORTED, DEADLINE_EXCEEDED) as the reason
// ahead of any host bundle error, because the interruption is the cause and
// the bundle error its consequence.
export function deriveFixtureCompletionV1(hostResult) {
  const host = closedOwnDataRecord(hostResult);
  const reportValue = ownData(host, 'report');
  const report = closedOwnDataRecord(reportValue);
  const outcome = ownData(report, 'outcome'), bundleError = ownData(host, 'bundleError'), proposal = ownData(host, 'proposedChanges');
  const clauses = Object.freeze({
    settled: ownData(host, 'state') === 'SETTLED',
    outcomeCompleted: outcome === 'COMPLETED',
    workflowCompleted: ownData(report, 'workflowOutcome') === 'COMPLETED',
    bundleClean: bundleError === null,
    proposalPresent: proposal !== null && proposal !== undefined,
  });
  const completed = Object.values(clauses).every(Boolean);
  const interrupted = outcome === 'CANCELLED' || outcome === 'TIMED_OUT';
  const reportCode = codeOf(ownData(report, 'code'));
  const bundleCode = codeOf(ownData(closedOwnDataRecord(bundleError), 'code'));
  const status = completed ? 'COMPLETED' : interrupted ? outcome : 'UNCONFIRMED';
  const reason = completed ? null
    : interrupted ? reportCode ?? bundleCode ?? 'INTERRUPTED'
    : bundleCode ?? reportCode ??
      (!clauses.settled ? 'HOST_NOT_SETTLED' : !clauses.proposalPresent ? 'REPOSITORY_PROPOSAL_MISSING' : 'COMPLETION_UNOBSERVED');
  return Object.freeze({ completed, status, reason, clauses });
}

// Owned-root permission handling (C03) runs inside the controlled error path:
// a chmod failure is refused as OWNED_ROOT_UNAVAILABLE with the OS error as
// cause, the exact root is reported, and it is removed like any other root.
// After the chmod the root is verified by lstat, and each verification guard
// reports its own failure: a root that is no longer a directory (a swapped or
// symlinked entry) is refused with cause OWNED_ROOT_NOT_DIRECTORY, so nothing
// is ever written through it, and a root whose mode did not become 0o700 (a
// filesystem that accepts chmod without persisting POSIX modes) is refused
// with cause OWNED_ROOT_MODE, so no record is retained in a root the runner
// alone cannot enter.
async function establishOwnedRoot(ownedRoot) {
  let stat;
  try { await fsp.chmod(ownedRoot, 0o700); stat = await fsp.lstat(ownedRoot); }
  catch (error) { refuse('OWNED_ROOT_UNAVAILABLE', error); }
  if (!stat.isDirectory()) refuse('OWNED_ROOT_UNAVAILABLE', coded('OWNED_ROOT_NOT_DIRECTORY'));
  if ((stat.mode & 0o777) !== 0o700) refuse('OWNED_ROOT_UNAVAILABLE', coded('OWNED_ROOT_MODE'));
}

// Cleanup (C03). Requires a trusted, stable parent and owned-root pathname;
// exact-path removal is not identity protection against a hostile concurrent
// filesystem writer. Containment hardening is a separate contract (C04).
// The owned root, and only the owned root, is removed; then a
// post-removal lstat verifies it. cleaned:true requires BOTH a removal that
// resolved AND an lstat ENOENT: a rejected removal is never reported cleaned,
// even when the lstat afterwards finds the root gone (its ENOENT is still
// recorded as lstatCode beside the rm code). A removal rejection, a root that
// is still present, and an lstat error other than ENOENT are each their own
// cleanup error with the OS code that produced them; the residue (what is
// still inside the root) is listed when the root can be read and null when
// it cannot. cleaned:true is produced only with error:null. Nothing is
// swallowed.
async function removeOwnedRoot(ownedRoot) {
  let removal = null, lstatCode = null, present = false, residue = null;
  try { await fsp.rm(ownedRoot, { recursive: true, force: true }); }
  catch (error) { removal = typeof error?.code === 'string' ? error.code : 'REMOVE_FAILED'; }
  try { await fsp.lstat(ownedRoot); present = true; }
  catch (error) { lstatCode = typeof error?.code === 'string' ? error.code : 'LSTAT_FAILED'; }
  const cleanupState = lstatCode === 'ENOENT' ? 'REMOVED' : present ? 'PRESENT' : 'UNKNOWN';
  const cleaned = removal === null && cleanupState === 'REMOVED';
  if (present) { try { residue = Object.freeze([...await fsp.readdir(ownedRoot)].sort()); } catch { residue = null; } }
  const code = removal !== null ? 'OWNED_ROOT_REMOVE_FAILED' : present ? 'OWNED_ROOT_RETAINED' : cleaned ? null : 'OWNED_ROOT_UNVERIFIED';
  const error = code === null ? null : Object.freeze({ code, systemCode: removal ?? (present ? null : lstatCode), lstatCode });
  return Object.freeze({ cleaned, cleanupState, error, residue });
}

// The returned frozen result is built AFTER cleanup (C03). A run observed
// complete over a root that was not verifiably removed is not complete: it is
// UNCONFIRMED with the cleanup error as its reason and its receipt withdrawn,
// while the records that were written (receipt bytes included) stay listed in
// `retained` and, if still on disk, in `residue`, as adverse retained evidence.
// An already adverse status keeps its own reason; the cleanup error is reported
// beside it. `cleaned` alone decides, because removeOwnedRoot never reports
// cleaned:true together with a cleanup error.
function finalResult(observed, cleanup, ownedRoot) {
  const demoted = observed.status === 'COMPLETED' && !cleanup.cleaned;
  return Object.freeze({
    status: demoted ? 'UNCONFIRMED' : observed.status,
    reason: demoted ? cleanup.error.code : observed.reason,
    reasonDetail: demoted ? cleanup.error.systemCode : observed.reasonDetail,
    workflowOutcome: observed.workflowOutcome, repairAttempts: observed.repairAttempts,
    candidateFingerprint: observed.candidateFingerprint, preparationFingerprints: observed.preparationFingerprints,
    revealedSourceManifest: observed.revealedSourceManifest, reviewedSourceFingerprint: observed.reviewedSourceFingerprint,
    modelContacted: false, authorizing: false, publishingAllowed: false,
    settledBeforeReceipt: observed.settledBeforeReceipt, preflight: observed.preflight, hostResult: observed.hostResult,
    receipt: demoted ? null : observed.receipt, retained: Object.freeze([...observed.retained]),
    ownedRoot, cleaned: cleanup.cleaned, cleanupState: cleanup.cleanupState, cleanupError: cleanup.error, residue: cleanup.residue,
  });
}

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

  // Owned-root creation (C03) is a refused result with the OS code, never a
  // raw exception; nothing exists yet, so there is nothing to clean.
  let ownedRoot;
  try { ownedRoot = await fsp.mkdtemp(path.join(parentRoot, 'nisi-fixture-')); }
  catch (error) { return refusalResult('OWNED_ROOT_UNAVAILABLE', typeof error?.code === 'string' ? error.code : null); }

  // Preflight record: the exact reviewed manifest and its fingerprint, bound to
  // this profile. Retained FIRST, before any owner, host or workspace exists.
  const preflight = Object.freeze({ schemaVersion: 'nisi-repository-fixture-preflight-v1', profile: REPOSITORY_FIXTURE_RUNNER_PROFILE,
    reviewedSourceManifest: fixture.reviewedSourceManifest, reviewedSourceFingerprint: fixture.reviewedSourceFingerprint,
    sourceFileCount: fixture.reviewedSourceManifest.length,
    preparationFingerprints: Object.freeze(fixture.preparations.map(p => p.fingerprint)),
    modelContacted: false, authorizing: false, publishingAllowed: false });
  const retained = [];
  const shared = {
    preparationFingerprints: Object.freeze(fixture.preparations.map(p => p.fingerprint)),
    revealedSourceManifest: fixture.reviewedSourceManifest, reviewedSourceFingerprint: fixture.reviewedSourceFingerprint,
  };
  let observed, hostResult = null, settled = false;
  try {
    await establishOwnedRoot(ownedRoot);
    await retainRecord(ownedRoot, retained, 'preflight.json', preflight);
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
    hostResult = await host.settled();
    const report = hostResult.report;
    settled = hostResult.state === 'SETTLED';

    // Engine report and host result are retained on every settled-or-not path.
    // Completion is derived from the observed outcomes first (C03); only a
    // derived completion is then checked for receipt eligibility against the
    // product bundle independently re-read here (C02), and the receipt is
    // completion-only, written LAST.
    await retainRecord(ownedRoot, retained, 'engine-report.json', report);
    await retainRecord(ownedRoot, retained, 'host-result.json', hostResult);
    const completion = deriveFixtureCompletionV1(hostResult);
    let receipt = null, completionEligible = false;
    if (completion.completed) {
      // Independently reconstruct and read the actual product bundle from the
      // original issued plans/groups/executions. A host reaching SETTLED is a
      // drain fact only; it is not completion eligibility.
      let bundleSummary;
      try {
        bundleSummary = readRepositoryRunBundleV1(hostResult.bundle, {
          report, preparation: preparations[1], suite,
          nodeRegistrationFingerprint: testsOwner.registrationFingerprint,
          plans: hostResult.staticHistory.map(entry => entry.plan),
          groups: hostResult.staticHistory.map(entry => entry.group),
          executions: hostResult.testHistory.map(entry => entry.execution),
        });
      } catch (error) { refuse('RECEIPT_BUNDLE_BINDING', error); }
      const bundleFingerprint = bundleSummary.fingerprint;
      completionEligible = report.outcome === 'COMPLETED' && report.workflowOutcome === 'COMPLETED' &&
        report.candidateFingerprint === preparations[1].candidateFingerprint &&
        bundleSummary.status === 'CONSISTENT' && bundleSummary.runId === report.runId &&
        bundleSummary.candidateFingerprint === preparations[1].candidateFingerprint &&
        bundleSummary.preparationFingerprint === preparations[1].fingerprint &&
        bundleSummary.outcome === 'COMPLETED' && bundleSummary.workflowOutcome === 'COMPLETED' &&
        bundleSummary.finalChecksRecordedPass === true &&
        bundleFingerprint === hostResult.bundleSummary?.fingerprint &&
        bundleFingerprint === hostResult.bundle.fingerprint;
      if (completionEligible) {
        // Bound to THIS completed run, the exact repaired candidate, reviewed
        // sources, and independently re-read product bundle. The history and
        // incident review hosts remain outside this fixture runner.
        receipt = Object.freeze({ schemaVersion: 'nisi-repository-fixture-receipt-v1', hostResultState: hostResult.state,
          runId: bundleSummary.runId, workflowOutcome: bundleSummary.workflowOutcome,
          candidateFingerprint: bundleSummary.candidateFingerprint,
          reviewedSourceFingerprint: fixture.reviewedSourceFingerprint, bundleFingerprint,
          reviewDefaults: Object.freeze({ history: false, incident: false }),
          modelContacted: false, authorizing: false, publishingAllowed: false });
        await retainRecord(ownedRoot, retained, 'runner-receipt.json', receipt);
      }
    }
    // A derived completion whose bundle re-read is not eligible for a receipt
    // is UNCONFIRMED with the C02 reason; an adverse derivation keeps its own
    // status (CANCELLED, TIMED_OUT, UNCONFIRMED) and exact reason.
    observed = { status: completionEligible ? 'COMPLETED' : completion.completed ? 'UNCONFIRMED' : completion.status,
      reason: completionEligible ? null : completion.completed ? 'RECEIPT_COMPLETION_REQUIRED' : completion.reason, reasonDetail: null,
      workflowOutcome: report.workflowOutcome, repairAttempts: report.repairAttempts, candidateFingerprint: report.candidateFingerprint,
      ...shared, settledBeforeReceipt: settled, preflight, hostResult, receipt, retained };
  } catch (error) {
    // A refusal after the root exists keeps everything that was observed: the
    // host result if there is one, the records that were actually retained
    // (a receipt that was not retained is no receipt, a preflight record that
    // was not retained is no preflight), and the run is never COMPLETED. A
    // root whose permissions could not be established is REFUSED; every other
    // refusal is UNCONFIRMED. reasonDetail is the underlying error code (OS
    // code, OWNED_ROOT_* verification cause, or RETAINED_BYTES_DIFFER) when
    // the refusal has one.
    const report = hostResult?.report ?? null;
    const preflightRetained = retained.some(r => r.path === 'preflight.json');
    observed = { status: error?.code === 'OWNED_ROOT_UNAVAILABLE' ? 'REFUSED' : 'UNCONFIRMED',
      reason: typeof error?.code === 'string' ? error.code : 'RUNNER_ERROR', reasonDetail: detailOf(error),
      workflowOutcome: report?.workflowOutcome ?? null, repairAttempts: report?.repairAttempts ?? 0,
      candidateFingerprint: report?.candidateFingerprint ?? null, ...shared, settledBeforeReceipt: settled,
      preflight: preflightRetained ? preflight : null, hostResult, receipt: null, retained };
  }
  return finalResult(observed, await removeOwnedRoot(ownedRoot), ownedRoot);
}
