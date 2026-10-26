// Fixed-run summary v1 (Nisi, private work order). Composes the frozen adapter
// and adjudicator into one typed run summary. Pure and synchronous: it never
// mutates its inputs and keeps no state between calls.
import { fixedCanaryMappingV1, adaptFixedCanaryOutput, expectedMatrixFor } from './native-canary-adapter.mjs';
import { adjudicateFixedCanaries, formatCanaryTable } from './native-canary-adjudicator.mjs';

const SCHEMA_VERSION = 'nisi-fixed-run-summary/v1';
const own = (object, key) => (Object.hasOwn(object, key) ? object[key] : null);
const positiveInteger = (value) => (Number.isSafeInteger(value) && value > 0 ? value : null);
const integer = (value) => (Number.isSafeInteger(value) ? value : null);
const flag = (value) => (value === true || value === false ? value : null);
const signalOf = (value) => (value === null || value === undefined ? null
  : typeof value === 'number' || typeof value === 'string' ? value : null);

export function summarizeFixedRun(receipt, stdout) {
  if (receipt === null || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new TypeError('receipt must be a non-null, non-array object');
  }
  const text = stdout === null || stdout === undefined ? '' : stdout;
  if (typeof text !== 'string') throw new TypeError('stdout must be a string, null or undefined');

  const identity = {
    childPid: positiveInteger(own(receipt, 'childPid')),
    servicePid: positiveInteger(own(receipt, 'servicePid')),
    waitObservedPid: positiveInteger(own(receipt, 'waitObservedPid'))
  };
  const lifecycle = {
    spawnReturn: integer(own(receipt, 'spawnReturn')),
    exitCode: integer(own(receipt, 'exitCode')),
    signal: signalOf(own(receipt, 'signal')),
    rawWaitStatus: integer(own(receipt, 'rawWaitStatus')),
    stdoutEOF: flag(own(receipt, 'stdoutEOF')),
    stderrEOF: flag(own(receipt, 'stderrEOF')),
    drainObserved: flag(own(receipt, 'drainObserved')),
    waitObserved: flag(own(receipt, 'waitObserved')),
    timeout: flag(own(receipt, 'timeout')),
    outputCapExceeded: flag(own(receipt, 'outputCapExceeded'))
  };

  const identityAvailable = identity.childPid !== null && identity.servicePid !== null;
  const reasons = [];
  if (lifecycle.spawnReturn !== 0) reasons.push('SPAWN_FAILED');
  if (lifecycle.waitObserved !== true) reasons.push('WAIT_NOT_OBSERVED');
  if (!identityAvailable) reasons.push('IDENTITY_UNAVAILABLE');
  if (identityAvailable && identity.waitObservedPid !== identity.childPid) reasons.push('PID_MISMATCH');
  if (lifecycle.signal !== null) reasons.push('SIGNALED');
  if (lifecycle.exitCode !== 0) reasons.push('NONZERO_EXIT');
  if (lifecycle.stdoutEOF !== true) reasons.push('STDOUT_NOT_DRAINED');
  if (lifecycle.stderrEOF !== true) reasons.push('STDERR_NOT_DRAINED');
  if (lifecycle.drainObserved !== true) reasons.push('DRAIN_NOT_OBSERVED');
  if (lifecycle.timeout !== false) reasons.push('TIMEOUT');
  if (lifecycle.outputCapExceeded !== false) reasons.push('OUTPUT_CAP_EXCEEDED');
  const gate = reasons.length === 0 ? 'RUN_COMPLETE' : 'RUN_INCOMPLETE';

  let adaptation = null;
  let adjudication = null;
  let table = null;
  if (identityAvailable) {
    adaptation = adaptFixedCanaryOutput(text, fixedCanaryMappingV1());
    adjudication = adjudicateFixedCanaries(
      adaptation.adaptedOutput,
      expectedMatrixFor({ childPid: identity.childPid, servicePid: identity.servicePid })
    );
    table = formatCanaryTable(adjudication);
    if (adjudication.overall !== 'ALL_MATCHED') reasons.push('CANARIES_NOT_MATCHED');
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    identity,
    lifecycle,
    gate,
    reasons,
    adaptation,
    adjudication,
    table,
    overall: reasons.length === 0 ? 'OBSERVED' : 'NOT_ACCEPTED',
    isolationAccepted: false,
    generatedCodeExecuted: false,
    authorizing: false
  };
}
