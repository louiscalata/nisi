// PRIVATE source-reviewed static-local lane. No arbitrary execution-call argv,
// shell, sandbox, process-tree containment, cleanup, apply-back or durable resume.
// Filesystem deadlines are checked at settlement, not hard I/O preemption.
// Runtime observation covers the Node binary, not OS/shared-library attestation.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cloneFreeze, stableStringify, sha256Text } from '../../workflow/contracts.mjs';
import { exact, digest } from '../../integrity/record-utils.mjs';
import { createExecutionExpectation, readExecutionReceipt } from '../../receipts/repository-execution-v1.mjs';
import { createOwnedChildObserver } from '../swift-verifier/owned-child.mjs';
import { issuedTaskWorkspaceV1 } from './task-workspace-v1.mjs';
import { requireReviewedNodeSuiteV1, readNodeTestReportV1, NODE_REPORT_CAP } from './node-suite-v1.mjs';

const consumed = new WeakSet();
const issuedResults = new WeakSet();
const environment = Object.freeze({ LANG: 'C', LC_ALL: 'C' });
const refuse = code => { throw Object.assign(new Error(code), { code }); };
const int = (v, a, b) => Number.isSafeInteger(v) && v >= a && v <= b;
const same = (a, b) => stableStringify(a) === stableStringify(b);
const errorCode = e => typeof e?.code === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(e.code) ? e.code : 'NODE_HOST_ERROR';

function observeRuntime(file) {
  let fd, result, failure;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const before = fs.fstatSync(fd, { bigint: true }), hash = createHash('sha256');
    if (!before.isFile() || before.nlink !== 1n || before.size <= 0n || before.size > 512n * 1048576n) refuse('NODE_RUNTIME_FILE');
    const buffer = Buffer.alloc(1048576); let used = 0;
    while (used <= Number(before.size)) {
      const n = fs.readSync(fd, buffer, 0, Math.min(buffer.length, Number(before.size) + 1 - used), used);
      if (!n) break; hash.update(buffer.subarray(0, n)); used += n;
    }
    const after = fs.fstatSync(fd, { bigint: true }), named = fs.lstatSync(file, { bigint: true });
    const keys = ['dev', 'ino', 'uid', 'gid', 'mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs'];
    if (used !== Number(before.size) || keys.some(k => before[k] !== after[k] || after[k] !== named[k])) refuse('NODE_RUNTIME_CHANGED');
    result = cloneFreeze({ path: file, sha256: hash.digest('hex'), ...Object.fromEntries(keys.map(k => [k, String(before[k])])) });
  } catch (e) { failure = e; }
  finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { failure = Object.assign(new Error(), { code: 'NODE_RUNTIME_CLOSE_UNCONFIRMED' }); } }
  if (failure) throw failure; return result;
}

export function createReviewedNodeExecutorV1(options) { return createNodeExecutorWithDependenciesV1(options); }

// Internal trusted I/O/lifecycle fault seam; callers cannot use injected evidence
// as proof of actual disk/process work. Production entry point supplies none.
export function createNodeExecutorWithDependenciesV1(options, {
  spawnChild = spawn, observeExecutable = observeRuntime, now = () => Math.floor(performance.now()),
} = {}) {
  exact(options, ['suite', 'totalTimeoutMs', 'childTimeoutMs', 'closeGraceMs'], 'NODE_EXECUTOR_SCHEMA');
  const { suite, totalTimeoutMs, childTimeoutMs, closeGraceMs } = options;
  requireReviewedNodeSuiteV1(suite);
  if (!['darwin', 'linux'].includes(process.platform) || !['arm64', 'x64'].includes(process.arch) || process.geteuid() === 0) refuse('NODE_EXECUTOR_PLATFORM');
  if (![totalTimeoutMs, childTimeoutMs].every(v => int(v, 1, 60000)) || childTimeoutMs > totalTimeoutMs || !int(closeGraceMs, 1, 2000)) refuse('NODE_EXECUTOR_BOUNDS');
  const executable = fs.realpathSync(process.execPath), registeredRuntime = observeExecutable(executable);
  const runtimeIdentity = digest('nisi/node-runtime-registration/v1', { registeredRuntime, version: process.version });
  const registrationFingerprint = digest('nisi/node-executor/v1', { suite: suite.fingerprint, runtimeIdentity, totalTimeoutMs, childTimeoutMs, closeGraceMs, environment });
  const attempts = new Map(); let state = 'IDLE', childOwner = null;
  const late = [];
  async function execute(input) {
    if (state !== 'IDLE') refuse('NODE_EXECUTOR_' + state);
    exact(input, ['workspace', 'runId', 'attempt', ...(Object.hasOwn(input ?? {}, 'signal') ? ['signal'] : [])], 'NODE_EXECUTE_SCHEMA');
    const { workspace, runId, attempt, signal } = input, view = issuedTaskWorkspaceV1(workspace);
    requireReviewedNodeSuiteV1(suite, view.preparation);
    if (signal !== undefined && !(signal instanceof AbortSignal)) refuse('NODE_EXECUTOR_SIGNAL');
    const argv = ['./' + suite.entryPath, view.root];
    const expected = createExecutionExpectation({ preparation: view.preparation, runId, attempt, checkId: suite.id, stage: 'tests',
      profile: { id: 'nisi.node.behavior', version: 1, rulesetSha256: digest('nisi/node-test-rules/v1', suite),
        sourceSha256: view.preparation.materializedFingerprint, buildSha256: runtimeIdentity,
        executableSha256: registeredRuntime.sha256, argv, environmentSha256: sha256Text(stableStringify(environment)),
        cwd: '.', platform: process.platform, architecture: process.arch, timeoutMs: childTimeoutMs, maximumOutputBytes: NODE_REPORT_CAP } });
    if (view.state !== 'MATERIALIZED' || consumed.has(workspace)) refuse('NODE_WORKSPACE_REPLAY');
    const key = runId + ':' + attempt;
    if (attempts.has(key)) refuse('NODE_ATTEMPT_REPLAY');
    if (attempts.size >= 101) refuse('NODE_ATTEMPT_LIMIT');
    // Claim synchronously before PRE's first await; another executor cannot use
    // this issued workspace while the filesystem inspection is pending.
    consumed.add(workspace); attempts.set(key, expected.fingerprint); state = 'BUSY'; childOwner = null;
    let began = null, previous = null, hostCode = null, pre = null, post = null, observation = null;
    let runtimeBefore = null, runtimeAfter = null, report = null, receipt = null, effectiveChildTimeoutMs = null;
    const issues = []; let phase = 'ADMISSION';
    const remember = code => { hostCode ??= code;
      if (!issues.some(i => i.phase === phase && i.code === code)) issues.push(Object.freeze({ phase, code })); };
    const guard = () => {
      if (signal?.aborted) remember('ABORTED');
      let value; try { value = now(); } catch { value = NaN; }
      if (!int(value, 0, Number.MAX_SAFE_INTEGER) || (previous !== null && value < previous)) { remember('NODE_HOST_CLOCK_INVALID'); return; }
      previous = value; began ??= value;
      if (value - began >= totalTimeoutMs) remember('DEADLINE_EXCEEDED');
    };
    try {
      guard();
      if (!hostCode) { phase = 'PRE'; pre = await workspace.checkpoint('PRE'); guard(); }
      if (!hostCode) {
        phase = 'RUNTIME_PRE';
        runtimeBefore = observeExecutable(executable);
        if (!same(runtimeBefore, registeredRuntime)) refuse('NODE_RUNTIME_IDENTITY_CHANGED');
        guard();
      }
      if (!hostCode) {
        phase = 'CHILD';
        effectiveChildTimeoutMs = Math.min(childTimeoutMs, totalTimeoutMs - (previous - began));
        childOwner = createOwnedChildObserver({ timeoutMs: effectiveChildTimeoutMs, closeGraceMs, maximumOutputBytes: NODE_REPORT_CAP, now,
          launch: () => spawnChild(executable, argv, { cwd: view.root, env: environment, shell: false, detached: false, stdio: ['pipe', 'pipe', 'pipe'] }) });
        observation = await childOwner.run({ input: Buffer.alloc(0), signal, validate: bytes => {
          const value = readNodeTestReportV1(bytes, suite);
          if (value.status === 'ERROR') refuse('NODE_SETUP_EXIT_MISMATCH');
          return value;
        } });
        report = observation.validated;
        // Preserve a valid, clean exit-2 setup report without converting it to a
        // quality failure. Raw observer fields remain byte-for-byte unchanged.
        const p = observation.process;
        if (observation.cause === 'CHILD_TERMINATION_INCONCLUSIVE' && p.started && p.closed && p.drain === 'CONFIRMED' &&
            p.exitCode === 2 && p.signal === null && !p.cancelRequested && !p.deadlineExceeded && p.errorCode === null &&
            observation.outputs.stderr.observedBytes === 0 && !observation.outputs.stdout.truncated) {
          try { const parsed = readNodeTestReportV1(Buffer.from(observation.stdoutHex, 'hex'), suite); if (parsed.status === 'ERROR') report = parsed; }
          catch { /* raw output/cause remains retained, with no passing credit */ }
        }
        const processState = { ...p };
        let result;
        if (report?.status === 'ERROR') { processState.errorCode = report.reason; result = { status: 'ERROR', reason: report.reason }; }
        else if (observation.cause) result = { status: p.errorCode === null ? 'INCONCLUSIVE' : 'ERROR', reason: observation.cause };
        else result = { status: report.status, reason: report.status === 'PASS' ? '' : 'NODE_ASSERTIONS_FAILED' };
        receipt = readExecutionReceipt({ schemaVersion: 1, expectationFingerprint: expected.fingerprint, binding: expected.binding,
          process: processState, outputs: observation.outputs, result }, expected);
        guard();
      }
    } catch (e) { remember(errorCode(e)); }
    // Never start POST while the child might still be working. Unknown closure
    // retains the direct-child quarantine and leaves PRECHECKED workspace intact.
    try {
      if (observation?.lifecycle.launchCalled && !observation.lifecycle.closeObserved) remember('NODE_CHILD_CLOSE_UNCONFIRMED');
      if (pre && (!observation || observation.lifecycle.closeObserved || !observation.lifecycle.launchCalled)) {
        phase = 'POST';
        post = await workspace.checkpoint('POST'); guard();
      }
      if (runtimeBefore && (!observation || observation.lifecycle.closeObserved || !observation.lifecycle.launchCalled)) {
        phase = 'RUNTIME_POST';
        runtimeAfter = observeExecutable(executable);
        if (!same(runtimeBefore, runtimeAfter)) remember('NODE_RUNTIME_IDENTITY_CHANGED');
        guard();
      }
    } catch (e) { remember(errorCode(e)); }
    try {
      phase = 'FINAL';
      guard();
      if (!receipt) {
        // Admission/pre-launch errors have no fabricated process observation.
        // A receipt-construction failure after launch stays a null receipt.
        if (!observation) {
          const interrupted = ['ABORTED', 'DEADLINE_EXCEEDED'].includes(hostCode);
          const zero = { capturedBytes: 0, observedBytes: 0, sha256: sha256Text(''), truncated: false };
          receipt = readExecutionReceipt({ schemaVersion: 1, expectationFingerprint: expected.fingerprint, binding: expected.binding,
            process: { started: false, closed: false, drain: 'NOT_APPLICABLE', exitCode: null, signal: null,
              errorCode: interrupted ? null : hostCode, cancelRequested: interrupted, deadlineExceeded: hostCode === 'DEADLINE_EXCEEDED', durationMs: 0 },
            outputs: { stdout: zero, stderr: zero }, result: { status: interrupted ? 'INCONCLUSIVE' : 'ERROR', reason: hostCode } }, expected);
        }
      }
      const prepared = cloneFreeze({ schemaVersion: 'nisi-node-execution-v1', registrationFingerprint,
        suiteFingerprint: suite.fingerprint, workspaceFingerprint: view.manifest.fingerprint,
        pre, post, receipt, testReport: report, rawObservation: observation, runtimeBefore, runtimeAfter,
        effectiveChildTimeoutMs, directChildOnly: true, noDescendantsEnforced: false, sandboxed: false,
        executionVerified: false, authorizing: false, certificationGranted: false });
      guard();
      state = hostCode || childOwner?.status() === 'QUARANTINED' ? 'QUARANTINED' : 'IDLE';
      const result = Object.freeze({ ...prepared, expected, hostCode, hostIssues: Object.freeze([...issues]), ownerState: state,
        disposition: hostCode === null && receipt !== null ? 'RECORDED' : 'HOST_UNAVAILABLE',
        totalDurationMs: previous === null || began === null ? 0 : previous - began });
      if (childOwner) late.push(childOwner); issuedResults.add(result); return result;
    } catch (e) { state = 'QUARANTINED'; throw e; }
  }
  return Object.freeze({ execute, status: () => state, registrationFingerprint,
    lateObservations: () => Object.freeze(late.flatMap((owner, index) => owner.lateObservations().map(value => Object.freeze({ executionIndex: index, ...value })))) });
}

// Engine consumers use BOTH layers, not raw receipt.result alone. This reader
// requires an original issued result; it is not a serialized replay/attestation API.
export function nodeTestAdapterResultV1(result) {
  if (!issuedResults.has(result)) refuse('NODE_EXECUTION_NOT_ISSUED');
  const quality = result.disposition === 'RECORDED' && ['PASS', 'FAIL'].includes(result.receipt?.result.status);
  const status = quality ? result.receipt.result.status : 'UNAVAILABLE';
  const b = result.expected.binding;
  const binding = Object.fromEntries(['schemaVersion', 'runId', 'taskFingerprint', 'attempt', 'candidateFingerprint'].map(k => [k, b[k]]));
  return cloneFreeze({ status, evidence: { ...binding,
    assertionsExecuted: quality ? result.testReport.assertionsExecuted : 0,
    assertionsPassed: quality ? result.testReport.assertionsPassed : 0,
    failures: status === 'FAIL' ? result.testReport.failures.map(f => ({ code: 'NODE_ASSERTION_' + sha256Text(f.name).slice(0, 16), message: f.name + ': ' + f.message })) : [],
    reason: status === 'PASS' ? '' : result.hostCode ?? result.receipt?.result.reason ?? 'NODE_HOST_UNAVAILABLE' } });
}
