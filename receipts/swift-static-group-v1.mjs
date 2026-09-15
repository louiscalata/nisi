// PRIVATE grouped static-check evidence. Not a v1/v2 host bundle or a process
// receipt. Requires the original issued plan and trusted host dispatch observations.
import { cloneFreeze, sha256Text, stableStringify } from '../workflow/contracts.mjs';
import { exact } from '../integrity/record-utils.mjs';
import { issuedSwiftChecksV1 } from '../hosts/swift-verifier/check-plan-v1.mjs';
import { readNativeArtifactReport, hashBytes } from '../hosts/swift-verifier/protocol.mjs';
import { readExecutionReceipt } from './repository-execution-v1.mjs';
import { closedList } from '../hosts/swift-verifier/group-contract-utils.mjs';

const schema = 'nisi-swift-static-group-v1';
const fail = code => { throw Object.assign(new Error(code), { code }); };
const hash = value => sha256Text('nisi/swift-static-group/v1\0' + stableStringify(value));
const operational = status => !['PASS', 'FAIL'].includes(status);
const bindKeys = ['schemaVersion', 'runId', 'taskFingerprint', 'attempt', 'candidateFingerprint'];

function stream(hex, observation, cap) {
  if (typeof hex !== 'string' || hex.length > cap * 2 || !/^(?:[a-f0-9]{2})*$/.test(hex)) fail('SWIFT_GROUP_STREAM');
  const bytes = Buffer.from(hex, 'hex');
  if (bytes.length !== observation.capturedBytes || hashBytes(bytes) !== observation.sha256) fail('SWIFT_GROUP_STREAM_BINDING');
  return bytes;
}

function derive(plan, entriesInput, stopReason) {
  const checks = issuedSwiftChecksV1(plan), entries = closedList(entriesInput, 64, 'SWIFT_GROUP_INVENTORY');
  if (entries.length !== checks.length) fail('SWIFT_GROUP_INVENTORY');
  if (![null, 'ABORTED', 'CHILD_UNAVAILABLE'].includes(stopReason)) fail('SWIFT_GROUP_STOP');
  const counts = { PASS: 0, FAIL: 0, NOT_RUN: 0, ERROR: 0, INCONCLUSIVE: 0, NOT_DISPATCHED: 0 };
  const knownFindings = []; let stopped = false, unavailable = false, lastObserved = null, rawAborted = false, unknownDrainCount = 0;
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index], check = checks[index];
    if (entry && Object.getOwnPropertyDescriptor(entry, 'dispatch')?.value === 'NOT_DISPATCHED') {
      exact(entry, ['dispatch', 'reason'], 'SWIFT_GROUP_UNDISPATCHED_SCHEMA');
      if (stopReason === null || entry.reason !== stopReason) fail('SWIFT_GROUP_STOP');
      stopped = true; counts.NOT_DISPATCHED++; continue;
    }
    exact(entry, ['dispatch', 'receipt', 'stdoutHex', 'stderrHex'], 'SWIFT_GROUP_CHILD_SCHEMA');
    if (entry.dispatch !== 'OBSERVED' || stopped || unavailable) fail('SWIFT_GROUP_DISPATCH_ORDER');
    const receipt = readExecutionReceipt(entry.receipt, check.expected);
    const stdout = stream(entry.stdoutHex, receipt.outputs.stdout, check.expected.profile.maximumOutputBytes);
    stream(entry.stderrHex, receipt.outputs.stderr, check.expected.profile.maximumOutputBytes);
    const status = receipt.result.status; counts[status]++; lastObserved = status;
    rawAborted ||= receipt.result.reason === 'ABORTED' && receipt.process.cancelRequested;
    if (receipt.process.drain === 'UNKNOWN') unknownDrainCount++;
    if (operational(status)) unavailable = true;
    else {
      if (receipt.process.exitCode !== 0 || receipt.outputs.stderr.observedBytes !== 0) fail('SWIFT_GROUP_TERMINATION');
      const native = readNativeArtifactReport(stdout, check.request).report;
      if (native.status !== status || receipt.result.reason !== (status === 'PASS' ? '' : 'SWIFT_ARTIFACT_FAILED')) fail('SWIFT_GROUP_RESULT_BINDING');
      for (const outcome of native.outcomes.filter(o => o.status === 'FAIL')) {
        knownFindings.push({ code: outcome.id.replaceAll('-', '_'), message: `${check.target.path}: ${outcome.explanation}` });
      }
    }
  }
  if (unavailable && stopReason === null || rawAborted && stopReason !== 'ABORTED' ||
      stopReason === 'CHILD_UNAVAILABLE' && !operational(lastObserved)) fail('SWIFT_GROUP_STOP');
  if (stopReason === 'CHILD_UNAVAILABLE' && lastObserved === null) fail('SWIFT_GROUP_STOP');
  const status = stopReason !== null || unavailable || stopped ? 'UNAVAILABLE' : counts.FAIL > 0 ? 'FAIL' : 'PASS';
  const reason = status === 'PASS' ? '' : status === 'FAIL' ? 'SWIFT_GROUP_FAILED' : 'SWIFT_GROUP_UNAVAILABLE';
  const binding = Object.fromEntries(bindKeys.map(k => [k, plan.binding[k]]));
  const adapterResult = { status, evidence: { ...binding, findings: status === 'FAIL' ? knownFindings : [], reason } };
  return cloneFreeze({ schemaVersion: schema, planFingerprint: plan.fingerprint, entries, stopReason,
    aggregate: { status, reason, counts, knownFindings, unknownDrainCount }, adapterResult,
    executionVerified: false, authorizing: false, certificationGranted: false });
}

export function createSwiftStaticGroupV1(plan, entries, stopReason = null) {
  const identity = derive(plan, entries, stopReason);
  return cloneFreeze({ ...identity, fingerprint: hash(identity) });
}

export function readSwiftStaticGroupV1(input, plan) {
  exact(input, ['schemaVersion', 'planFingerprint', 'entries', 'stopReason', 'aggregate', 'adapterResult',
    'executionVerified', 'authorizing', 'certificationGranted', 'fingerprint'], 'SWIFT_GROUP_SCHEMA');
  const identity = derive(plan, input.entries, input.stopReason), value = cloneFreeze(input);
  if (stableStringify(value) !== stableStringify({ ...identity, fingerprint: hash(identity) })) fail('SWIFT_GROUP_MISMATCH');
  return cloneFreeze({ ...identity, fingerprint: hash(identity) });
}
