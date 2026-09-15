// PRIVATE host-selected fixed-program lane. One Swift process per receipt.
// Not an arbitrary command runner, sandbox, model scheduler or multi-file stage.
// Operator-exclusive local source/build/marker directories are a precondition.
// Pre/post hashes are observations, NOT executed-image attestation or protection
// against a same-account actor replacing a pathname between system calls.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { cloneFreeze, sha256Text, stableStringify } from '../../workflow/contracts.mjs';
import { createExecutionExpectation, readExecutionReceipt } from '../../receipts/repository-execution-v1.mjs';
import { createNativeArtifactRequest, fixedProfile, hashBytes, KERNEL_OUTPUT_CAP, readNativeArtifactReport } from './protocol.mjs';
import { isIssuedNativeArtifactBuild } from './build.mjs';
import { createOwnedChildObserver } from './owned-child.mjs';
import { acquireKernelReservation, releaseKernelReservation } from './reservation.mjs';
import { createSwiftCheckPlanV1, issuedSwiftChecksV1 } from './check-plan-v1.mjs';
import { exact } from '../../integrity/record-utils.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const reservationPath = path.join(root, '.build/nisi-swift-owner-v1.reservation');
const environment = Object.freeze({ LANG: 'C', LC_ALL: 'C' });
const refuse = code => { throw Object.assign(new Error(code), { code }); };
function observedFile(file, cap) {
  let fd = null;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const a = fs.fstatSync(fd, { bigint: true });
    if (!a.isFile() || a.nlink !== 1n || a.size < 0n || a.size > BigInt(cap)) refuse('SWIFT_BUILD_FILE_REFUSED');
    const bytes = Buffer.alloc(Number(a.size) + 1); let offset = 0;
    while (offset < bytes.length) { const n = fs.readSync(fd, bytes, offset, bytes.length - offset, offset); if (n === 0) break; offset += n; }
    const b = fs.fstatSync(fd, { bigint: true }), named = fs.lstatSync(file, { bigint: true });
    const keys = ['dev', 'ino', 'mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs'];
    if (offset !== Number(a.size) || keys.some(k => a[k] !== b[k] || b[k] !== named[k])) refuse('SWIFT_BUILD_FILE_CHANGED');
    const closing = fd; fd = null; fs.closeSync(closing);
    return cloneFreeze({ sha256: hashBytes(bytes.subarray(0, offset)), ...Object.fromEntries(keys.map(k => [k, String(a[k])])) });
  } catch (error) {
    if (fd !== null) { try { fs.closeSync(fd); } catch {} }
    refuse(error?.code?.startsWith('SWIFT_') ? error.code : 'SWIFT_BUILD_FILE_UNAVAILABLE');
  }
}
function verifyBuild(build) {
  for (const source of build.sourceFiles) {
    if (observedFile(path.join(root, source.path), 2_097_152).sha256 !== source.sha256 ||
        observedFile(path.join(build.directory, path.basename(source.path)), 2_097_152).sha256 !== source.sha256) refuse('SWIFT_BUILD_SOURCE_STALE');
  }
  const executable = observedFile(build.executable, 16 * 1_048_576);
  if (executable.sha256 !== build.executableSha256) refuse('SWIFT_EXECUTABLE_CHANGED');
  return executable;
}

export function createSwiftArtifactExecutor({ build, scope, timeoutMs = 5000, closeGraceMs = 500 } = {}) {
  return createExecutor({ build, scope, timeoutMs, closeGraceMs }, false);
}

// Explicit successor API: preissued per-file expectations, never an aggregate
// process. The legacy entry point retains its constant ID and run/attempt replay.
export function createSwiftPlannedArtifactExecutorV1({ build, scope, timeoutMs = 5000, closeGraceMs = 500 } = {}) {
  return createExecutor({ build, scope, timeoutMs, closeGraceMs }, true);
}

function createExecutor({ build, scope, timeoutMs, closeGraceMs }, planned) {
  if (scope !== 'operator-exclusive-static-local-v1') refuse('SWIFT_EXECUTION_SCOPE_REQUIRED');
  if (!isIssuedNativeArtifactBuild(build)) refuse('SWIFT_BUILD_NOT_ISSUED');
  if (process.platform !== 'darwin' || process.arch !== 'arm64') refuse('SWIFT_EXECUTION_PLATFORM');
  // The shared child observer also serves a 120s AFM lane; this host keeps its
  // original 60s bound and receipt contract, after existing admission guards.
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) refuse('CHILD_OWNER_CONFIG');
  const buildSha256 = sha256Text(`nisi/native-build-observation/v1\0${stableStringify(build)}`);
  const executionProfile = cloneFreeze({ sourceSha256: build.sourceFingerprint, buildSha256,
    executableSha256: build.executableSha256, argv: [], environmentSha256: sha256Text(stableStringify(environment)),
    cwd: '.', platform: 'darwin', architecture: 'arm64', timeoutMs, maximumOutputBytes: KERNEL_OUTPUT_CAP });
  let latched = false, active = false;
  const attempts = new Map();
  const plans = new Map();
  const owner = createOwnedChildObserver({ timeoutMs, closeGraceMs, maximumOutputBytes: KERNEL_OUTPUT_CAP,
    launch: () => spawn(build.executable, [], { cwd: build.directory, env: environment, shell: false,
      detached: false, stdio: ['pipe', 'pipe', 'pipe'] }) });
  const status = () => latched ? 'QUARANTINED' : active ? 'BUSY' : owner.status();

  async function execute(input) {
    if (status() !== 'IDLE') refuse(`SWIFT_EXECUTOR_${status()}`);
    if (planned) exact(input, Object.hasOwn(input ?? {}, 'signal') ? ['plan', 'index', 'signal'] : ['plan', 'index'], 'SWIFT_PLANNED_INPUT_SCHEMA');
    let { preparation, path: artifactPath, profileId, runId, attempt, signal } = input;
    if (signal !== undefined && !(signal instanceof AbortSignal)) refuse('SWIFT_SIGNAL_INVALID');
    let expected, request;
    if (planned) {
      const checks = issuedSwiftChecksV1(input.plan);
      if (!Number.isSafeInteger(input.index) || input.index < 0 || input.index >= checks.length) refuse('SWIFT_PLAN_INDEX');
      if (stableStringify(input.plan.executionProfile) !== stableStringify(executionProfile)) refuse('SWIFT_PLAN_EXECUTOR_MISMATCH');
      const check = checks[input.index];
      ({ expected, request, preparation } = check);
      ({ path: artifactPath, profileId } = check.target);
      ({ runId, attempt } = expected.binding);
      const planKey = `${runId}:${attempt}`;
      if (plans.has(planKey) && plans.get(planKey) !== input.plan.fingerprint) refuse('SWIFT_PLAN_IDENTITY_CONFLICT');
      if (!plans.has(planKey) && plans.size >= 101) refuse('SWIFT_PLAN_HISTORY_LIMIT');
      plans.set(planKey, input.plan.fingerprint);
    } else {
      const profile = fixedProfile(profileId);
      expected = createExecutionExpectation({ preparation, runId, attempt, checkId: 'nisi.swift.artifact', stage: 'staticChecks',
      profile: { id: profileId, version: 1, rulesetSha256: profile.rulesFingerprint, sourceSha256: build.sourceFingerprint,
        buildSha256, executableSha256: build.executableSha256, argv: [],
        environmentSha256: sha256Text(stableStringify(environment)), cwd: '.', platform: 'darwin', architecture: 'arm64',
        timeoutMs, maximumOutputBytes: KERNEL_OUTPUT_CAP } });
      request = createNativeArtifactRequest({ preparation, path: artifactPath, profileId,
      expectationFingerprint: expected.fingerprint, sourceFingerprint: build.sourceFingerprint });
    }
    const attemptKey = planned ? `${runId}:${attempt}:${artifactPath}` : `${runId}:${attempt}`;
    if (attempts.has(attemptKey)) refuse(attempts.get(attemptKey) === expected.fingerprint
      ? 'SWIFT_EXECUTION_REPLAY' : 'SWIFT_EXECUTION_IDENTITY_CONFLICT');
    if (attempts.size >= (planned ? 64 * 101 : 1024)) refuse('SWIFT_EXECUTION_HISTORY_LIMIT');
    attempts.set(attemptKey, expected.fingerprint);
    active = true;
    let ticket = null, released = false, before = null, after = null, observation = null, setupError = null;
    try {
      if (!signal?.aborted) {
        before = verifyBuild(build);
        if (!signal?.aborted) ticket = acquireKernelReservation(reservationPath, {
          expectationFingerprint: expected.fingerprint, sourceFingerprint: build.sourceFingerprint,
          executableSha256: build.executableSha256, executable: build.executable });
      }
      observation = await owner.run({ input: Buffer.from(request.frameHex, 'hex'), signal,
        validate: stdout => {
          after = verifyBuild(build);
          if (stableStringify(before) !== stableStringify(after)) refuse('SWIFT_EXECUTABLE_IDENTITY_CHANGED');
          const result = readNativeArtifactReport(stdout, request);
          releaseKernelReservation(ticket); released = true;
          return result;
        } });
    } catch (error) {
      setupError = typeof error?.code === 'string' ? error.code : 'SWIFT_EXECUTOR_ERROR';
    }
    // No-launch means launch() was NEVER called, not merely that no spawn event
    // arrived. A timeout-before-spawn has launchCalled=true and retains the marker
    // unless close was observed. Crashes require explicit manual reconciliation;
    // this API has no marker-clear/recovery operation.
    if (ticket && !released && observation && (observation.lifecycle.closeObserved || !observation.lifecycle.launchCalled)) {
      try { releaseKernelReservation(ticket); released = true; }
      catch { setupError ??= 'SWIFT_RESERVATION_RELEASE_UNCERTAIN'; }
    }
    if ((ticket && !released) || owner.status() === 'QUARANTINED' || setupError === 'SWIFT_RESERVATION_RELEASE_UNCERTAIN') latched = true;
    const zero = { capturedBytes: 0, observedBytes: 0, sha256: hashBytes(Buffer.alloc(0)), truncated: false };
    const processState = observation?.process ?? { started: false, closed: false, drain: 'NOT_APPLICABLE',
      exitCode: null, signal: null, errorCode: setupError, deadlineExceeded: false, cancelRequested: false, durationMs: 0 };
    let result;
    const cause = observation?.cause ?? setupError;
    if (cause) result = { status: processState.errorCode !== null || setupError ? 'ERROR' : 'INCONCLUSIVE', reason: cause };
    else {
      const native = observation.validated.report;
      result = { status: native.status, reason: native.status === 'PASS' ? '' : 'SWIFT_ARTIFACT_FAILED' };
    }
    const receiptProcess = { ...processState };
    if (result.status === 'ERROR' && receiptProcess.errorCode === null) receiptProcess.errorCode = setupError;
    try {
      const receipt = readExecutionReceipt({ schemaVersion: 1, expectationFingerprint: expected.fingerprint,
        binding: expected.binding, process: receiptProcess, outputs: observation?.outputs ?? { stdout: zero, stderr: zero }, result }, expected);
      // Preserve the actual issued expectation; serializing/cloning it loses the
      // reader's in-process issuance identity. Other output remains deeply frozen.
      return Object.freeze({ expected, ...cloneFreeze({ requestSha256: request.requestSha256, path: artifactPath,
        receipt, nativeReport: observation?.validated?.report ?? null, rawObservation: observation,
        executableBefore: before, executableAfter: after,
        reservation: { acquired: ticket !== null, released, presentRequiresReconciliation: ticket !== null && !released },
        ownerState: latched ? 'QUARANTINED' : owner.status(), authorizing: false }) });
    } catch (error) { latched = true; throw error; }
    finally { active = false; }
  }
  // Bounded in-memory late-event evidence, keyed by rawObservation.lifecycle.operation.
  // It does not revise a receipt, clear quarantine or implement a durable journal.
  return Object.freeze({ execute, status, lateObservations: owner.lateObservations,
    ...(planned ? { plan: ({ preparation, runId, attempt, targets }) => createSwiftCheckPlanV1({
      preparation, runId, attempt, targets, executionProfile }) } : {}) });
}
