// PRIVATE — pure data contracts, not a process runner or execution authority.
// The caller supplies trusted expectations and the actual final engine report.
// Agreement among these host statements does not authenticate them or prove work.
// Object reader only: wire parsing, disk admission, sandboxing and persistence
// are separate host responsibilities. Hostile Proxies are outside this boundary.
import { cloneFreeze, sha256Text, stableStringify } from '../workflow/contracts.mjs';
import { isIssuedRepositoryPreparation } from '../hosts/repository/snapshot-contract.mjs';

const issuedExpectations = new WeakSet();
const MAX_CHECKS = 202; // staticChecks + tests for each of at most 101 attempts
const EMPTY_SHA256 = sha256Text('');
const digest = (domain, value) => sha256Text(`${domain}\0${stableStringify(value)}`);
const statuses = ['PASS', 'FAIL', 'NOT_RUN', 'ERROR', 'INCONCLUSIVE'];
export class RepositoryReceiptError extends Error {
  constructor(code) { super(code); this.name = 'RepositoryReceiptError'; this.code = code; }
}
const refuse = code => { throw new RepositoryReceiptError(code); };
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const id = value => typeof value === 'string' && /^[a-z][a-z0-9_.-]{0,95}$/u.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value);
const text = (value, maximum, empty = false) => typeof value === 'string' && value.isWellFormed() &&
  !value.includes('\0') && value.length <= maximum && Buffer.byteLength(value, 'utf8') <= maximum && (empty || value.trim().length > 0);

function fields(value, names, code) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      ![null, Object.prototype].includes(Object.getPrototypeOf(value))) refuse(code);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== names.length || keys.some(key => typeof key !== 'string' || !names.includes(key))) refuse(code);
  const out = Object.create(null);
  for (const name of names) {
    const d = descriptors[name];
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) refuse(code);
    out[name] = d.value;
  }
  return out;
}
function list(value, maximum, code, minimum = 0) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) refuse(code);
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!integer(length, minimum, maximum)) refuse(code);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== length + 1) refuse(code);
  return Array.from({ length }, (_, i) => {
    if (!descriptors[i]?.enumerable || !Object.hasOwn(descriptors[i], 'value')) refuse(code);
    return descriptors[i].value;
  });
}

function profileFrom(value) {
  const p = fields(value, ['id', 'version', 'rulesetSha256', 'sourceSha256', 'buildSha256',
    'executableSha256', 'argv', 'environmentSha256', 'cwd', 'platform', 'architecture',
    'timeoutMs', 'maximumOutputBytes'], 'EXECUTION_PROFILE_SCHEMA');
  if (!id(p.id) || !integer(p.version, 1, 1_000_000) ||
      !['rulesetSha256', 'sourceSha256', 'buildSha256', 'executableSha256', 'environmentSha256'].every(k => hex(p[k])) ||
      p.cwd !== '.' || !['darwin', 'linux', 'win32'].includes(p.platform) || !['arm64', 'x64'].includes(p.architecture) ||
      !integer(p.timeoutMs, 1, 86_400_000) || !integer(p.maximumOutputBytes, 1, 1_048_576)) refuse('EXECUTION_PROFILE_INVALID');
  p.argv = list(p.argv, 32, 'EXECUTION_ARGV_INVALID');
  if (!p.argv.every(arg => text(arg, 1024, true))) refuse('EXECUTION_ARGV_INVALID');
  // This captures a HOST-SELECTED fixed command. It does not approve arbitrary
  // commands supplied by an artifact, resolve an executable, or provide a sandbox.
  return cloneFreeze(p);
}

export function createExecutionExpectation(value) {
  const input = fields(value, ['preparation', 'runId', 'attempt', 'checkId', 'stage', 'profile'], 'EXECUTION_EXPECTATION_SCHEMA');
  if (!isIssuedRepositoryPreparation(input.preparation)) refuse('EXECUTION_PREPARATION_NOT_ISSUED');
  if (!uuid(input.runId) || !integer(input.attempt, 0, input.preparation.task.policy.repairBudget) ||
      !id(input.checkId) || !['staticChecks', 'tests'].includes(input.stage)) refuse('EXECUTION_EXPECTATION_INVALID');
  const profile = profileFrom(input.profile);
  const p = input.preparation;
  const binding = cloneFreeze({ schemaVersion: 1, runId: input.runId, attempt: input.attempt,
    taskFingerprint: p.taskFingerprint, candidateFingerprint: p.candidateFingerprint,
    baselineFingerprint: p.baselineFingerprint, materializedFingerprint: p.materializedFingerprint,
    preparationFingerprint: p.fingerprint, checkId: input.checkId, stage: input.stage,
    profileFingerprint: digest('nisi/execution-profile/v1', profile) });
  const identity = { schemaVersion: 1, binding, profile };
  const out = cloneFreeze({ ...identity, fingerprint: digest('nisi/execution-expectation/v1', identity),
    authorizing: false });
  issuedExpectations.add(out);
  return out;
}

function outputFrom(value, maximum) {
  const out = fields(value, ['capturedBytes', 'observedBytes', 'sha256', 'truncated'], 'EXECUTION_OUTPUT_SCHEMA');
  if (!integer(out.capturedBytes, 0, maximum) || !integer(out.observedBytes, out.capturedBytes, Number.MAX_SAFE_INTEGER) ||
      !hex(out.sha256) || typeof out.truncated !== 'boolean' ||
      out.truncated !== (out.observedBytes > out.capturedBytes) ||
      (out.capturedBytes === 0 && out.sha256 !== EMPTY_SHA256)) refuse('EXECUTION_OUTPUT_INVALID');
  return out;
}

export function readExecutionReceipt(value, expected) {
  if (!issuedExpectations.has(expected)) refuse('EXECUTION_EXPECTATION_NOT_ISSUED');
  const r = fields(value, ['schemaVersion', 'expectationFingerprint', 'binding', 'process', 'outputs', 'result'], 'EXECUTION_RECEIPT_SCHEMA');
  const binding = fields(r.binding, Object.keys(expected.binding), 'EXECUTION_BINDING_SCHEMA');
  if (r.schemaVersion !== 1 || r.expectationFingerprint !== expected.fingerprint ||
      Object.keys(binding).some(k => binding[k] !== expected.binding[k])) refuse('EXECUTION_BINDING_MISMATCH');
  const p = fields(r.process, ['started', 'closed', 'drain', 'exitCode', 'signal', 'errorCode',
    'deadlineExceeded', 'cancelRequested', 'durationMs'], 'EXECUTION_PROCESS_SCHEMA');
  if (!['started', 'closed', 'deadlineExceeded', 'cancelRequested'].every(k => typeof p[k] === 'boolean') ||
      !['CONFIRMED', 'UNKNOWN', 'NOT_APPLICABLE'].includes(p.drain) ||
      !(p.exitCode === null || integer(p.exitCode, 0, 4_294_967_295)) ||
      !(p.signal === null || (typeof p.signal === 'string' && /^SIG[A-Z0-9]{1,16}$/u.test(p.signal))) ||
      !(p.errorCode === null || (typeof p.errorCode === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/u.test(p.errorCode))) ||
      !integer(p.durationMs, 0, Number.MAX_SAFE_INTEGER)) refuse('EXECUTION_PROCESS_INVALID');
  if ((!p.started && (p.closed || p.drain !== 'NOT_APPLICABLE' || p.exitCode !== null || p.signal !== null || p.durationMs !== 0)) ||
      (p.started && p.drain === 'NOT_APPLICABLE') ||
      (!p.closed && (p.exitCode !== null || p.signal !== null || p.drain === 'CONFIRMED')) ||
      (p.exitCode !== null && p.signal !== null)) refuse('EXECUTION_PROCESS_CONTRADICTION');
  const streams = fields(r.outputs, ['stdout', 'stderr'], 'EXECUTION_OUTPUTS_SCHEMA');
  const outputs = { stdout: outputFrom(streams.stdout, expected.profile.maximumOutputBytes),
    stderr: outputFrom(streams.stderr, expected.profile.maximumOutputBytes) };
  if (!p.started && Object.values(outputs).some(o => o.observedBytes !== 0)) refuse('EXECUTION_UNSTARTED_OUTPUT');
  const result = fields(r.result, ['status', 'reason'], 'EXECUTION_RESULT_SCHEMA');
  if (!statuses.includes(result.status) || (result.status === 'PASS' ? result.reason !== '' : !text(result.reason, 2048))) refuse('EXECUTION_RESULT_INVALID');
  const clean = p.started && p.closed && p.drain === 'CONFIRMED' && p.signal === null && p.exitCode !== null &&
    p.errorCode === null && !p.deadlineExceeded && !p.cancelRequested && p.durationMs < expected.profile.timeoutMs &&
    !outputs.stdout.truncated && !outputs.stderr.truncated;
  if ((result.status === 'PASS' && (!clean || p.exitCode !== 0)) ||
      (result.status === 'FAIL' && !clean) ||
      (result.status === 'NOT_RUN' && (p.started || p.errorCode !== null)) ||
      (result.status === 'ERROR' && p.errorCode === null)) refuse('EXECUTION_RESULT_CONTRADICTION');
  return cloneFreeze({ schemaVersion: 1, expectationFingerprint: r.expectationFingerprint, binding,
    process: p, outputs, result });
}

// PASS/FAIL/NOT_RUN map identically. ERROR means an explicit host errorCode;
// INCONCLUSIVE means the host cannot establish a result (including unknown drain).
// Both map to UNAVAILABLE, never to an ordinary failed quality check.
const adapterStatus = status => ['ERROR', 'INCONCLUSIVE'].includes(status) ? 'UNAVAILABLE' : status;
const checkStages = new Set(['staticChecks', 'tests']);

// A trusted final engine report is a separate input, NOT extracted from a bundle
// or authenticated here. We validate check-stage links, not the whole v1 state
// machine. These helpers preserve error stages with binding + reason only.
function contextFrom(value) {
  const input = fields(value, ['report', 'expectations'], 'HOST_CONTEXT_SCHEMA');
  let report;
  try { report = cloneFreeze(input.report); } catch { refuse('HOST_REPORT_INVALID'); }
  if (report?.schemaVersion !== 1 || !uuid(report.runId) || !hex(report.taskFingerprint) ||
      !Array.isArray(report.stages) || report.stages.length > 2300) refuse('HOST_REPORT_INVALID');
  const expectations = list(input.expectations, MAX_CHECKS, 'HOST_EXPECTATIONS_INVALID');
  if (expectations.some(e => !issuedExpectations.has(e))) refuse('EXECUTION_EXPECTATION_NOT_ISSUED');
  const stages = report.stages.filter(s => checkStages.has(s?.stage));
  if (stages.length !== expectations.length) refuse('HOST_EXPECTATION_INVENTORY');
  const stageKeys = new Set();
  const attemptPreparations = new Map();
  stages.forEach((s, i) => {
    const b = expectations[i].binding;
    const key = `${b.attempt}:${b.stage}`;
    if (stageKeys.has(key)) refuse('HOST_EXPECTATION_DUPLICATE');
    stageKeys.add(key);
    if (b.baselineFingerprint !== expectations[0].binding.baselineFingerprint ||
        (attemptPreparations.has(b.attempt) && attemptPreparations.get(b.attempt) !== b.preparationFingerprint)) refuse('HOST_SNAPSHOT_MISMATCH');
    attemptPreparations.set(b.attempt, b.preparationFingerprint);
    if (b.runId !== report.runId || b.taskFingerprint !== report.taskFingerprint || s.stage !== b.stage ||
        s.candidateFingerprint !== b.candidateFingerprint ||
        ['schemaVersion', 'runId', 'taskFingerprint', 'attempt', 'candidateFingerprint'].some(k => s.evidence?.[k] !== b[k])) refuse('HOST_STAGE_BINDING_MISMATCH');
  });
  return { report, expectations, stages,
    reportSha256: digest('nisi/host-final-report/v1', report) };
}

function checkedReceipts(value, context) {
  const inputs = list(value, MAX_CHECKS, 'HOST_RECEIPTS_INVALID');
  if (inputs.length !== context.expectations.length) refuse('HOST_RECEIPT_INVENTORY');
  return inputs.map((value, i) => {
    const receipt = readExecutionReceipt(value, context.expectations[i]);
    const stage = context.stages[i];
    if (adapterStatus(receipt.result.status) !== stage.status) refuse('HOST_STAGE_STATUS_MISMATCH');
    if (receipt.result.reason !== stage.evidence.reason) refuse('HOST_STAGE_REASON_MISMATCH');
    // Engine-generated stops (non-null code) must not masquerade as ordinary
    // PASS/FAIL/NOT_RUN checks. A stop has only the v1 binding and reason.
    if (stage.code !== null && (stage.status !== 'UNAVAILABLE' || !text(stage.code, 4096))) refuse('HOST_STAGE_CODE_MISMATCH');
    if (stage.code !== null) {
      const interruption = ['ABORTED', 'DEADLINE_EXCEEDED'].includes(stage.code);
      if (stage.evidence.reason !== stage.code || (interruption
        ? receipt.result.status !== 'INCONCLUSIVE' || !receipt.process.cancelRequested || receipt.process.errorCode !== null
        : receipt.result.status !== 'ERROR' || receipt.process.errorCode !== stage.code)) refuse('HOST_STAGE_STOP_MISMATCH');
    }
    return receipt;
  });
}

export function createHostRunBundle(contextInput, receiptInputs) {
  const context = contextFrom(contextInput);
  const receipts = checkedReceipts(receiptInputs, context);
  const identity = { schemaVersion: 1, reportSha256: context.reportSha256, receipts };
  return cloneFreeze({ ...identity, fingerprint: digest('nisi/host-run-bundle/v1', identity) });
}

export function readHostRunBundle(value, contextInput) {
  const context = contextFrom(contextInput);
  const bundle = fields(value, ['schemaVersion', 'reportSha256', 'receipts', 'fingerprint'], 'HOST_BUNDLE_SCHEMA');
  if (bundle.schemaVersion !== 1 || bundle.reportSha256 !== context.reportSha256) refuse('HOST_REPORT_DIGEST_MISMATCH');
  const receipts = checkedReceipts(bundle.receipts, context);
  const identity = { schemaVersion: 1, reportSha256: bundle.reportSha256, receipts };
  if (bundle.fingerprint !== digest('nisi/host-run-bundle/v1', identity)) refuse('HOST_BUNDLE_DIGEST_MISMATCH');
  return cloneFreeze({ status: 'CONSISTENT', reportSha256: bundle.reportSha256,
    fingerprint: bundle.fingerprint, receiptCount: receipts.length,
    allChecksReportedPass: receipts.length > 0 && receipts.every(r => r.result.status === 'PASS'),
    executionVerified: false, authorizing: false });
}
