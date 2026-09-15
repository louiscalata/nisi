// Fixture generator (Claude, 2026-09-13). Builds fixed-run summary objects
// exactly as the accepted native-canary-summary contract specifies, from the
// frozen adapter/adjudicator and the real inherit-run evidence. Re-run once the
// summary module is accepted and diff: the outputs must be byte-identical.
import { readFile, writeFile } from 'node:fs/promises';
import { fixedCanaryMappingV1, adaptFixedCanaryOutput, expectedMatrixFor } from '../../native-canary-summary/src/native-canary-adapter.mjs';
import { adjudicateFixedCanaries, formatCanaryTable } from '../../native-canary-summary/src/native-canary-adjudicator.mjs';
const here = new URL('../fixtures/', import.meta.url);
const RECEIPT = JSON.parse(await readFile(new URL('../../native-canary-summary/fixtures/inherit-run-service-raw.json', import.meta.url), 'utf8'));
const STDOUT = await readFile(new URL('../../native-canary-summary/fixtures/inherit-run-node.stdout', import.meta.url), 'utf8');
const own = (o, k) => Object.hasOwn(o, k) ? o[k] : null;
const posInt = v => Number.isSafeInteger(v) && v > 0 ? v : null;
const int = v => Number.isSafeInteger(v) ? v : null;
const bool = v => v === true || v === false ? v : null;
function summarize(receipt, stdout) {
  const s = stdout ?? '';
  const identity = { childPid: posInt(own(receipt, 'childPid')), servicePid: posInt(own(receipt, 'servicePid')), waitObservedPid: posInt(own(receipt, 'waitObservedPid')) };
  const sig = own(receipt, 'signal');
  const lifecycle = { spawnReturn: int(own(receipt, 'spawnReturn')), exitCode: int(own(receipt, 'exitCode')),
    signal: sig === undefined || sig === null ? null : (typeof sig === 'number' || typeof sig === 'string') ? sig : null,
    rawWaitStatus: int(own(receipt, 'rawWaitStatus')), stdoutEOF: bool(own(receipt, 'stdoutEOF')), stderrEOF: bool(own(receipt, 'stderrEOF')),
    drainObserved: bool(own(receipt, 'drainObserved')), waitObserved: bool(own(receipt, 'waitObserved')), timeout: bool(own(receipt, 'timeout')), outputCapExceeded: bool(own(receipt, 'outputCapExceeded')) };
  const reasons = [];
  if (lifecycle.spawnReturn !== 0) reasons.push('SPAWN_FAILED');
  if (lifecycle.waitObserved !== true) reasons.push('WAIT_NOT_OBSERVED');
  const idOk = identity.childPid !== null && identity.servicePid !== null;
  if (!idOk) reasons.push('IDENTITY_UNAVAILABLE');
  if (idOk && identity.waitObservedPid !== identity.childPid) reasons.push('PID_MISMATCH');
  if (lifecycle.signal !== null) reasons.push('SIGNALED');
  if (lifecycle.exitCode !== 0) reasons.push('NONZERO_EXIT');
  if (lifecycle.stdoutEOF !== true) reasons.push('STDOUT_NOT_DRAINED');
  if (lifecycle.stderrEOF !== true) reasons.push('STDERR_NOT_DRAINED');
  if (lifecycle.drainObserved !== true) reasons.push('DRAIN_NOT_OBSERVED');
  if (lifecycle.timeout !== false) reasons.push('TIMEOUT');
  if (lifecycle.outputCapExceeded !== false) reasons.push('OUTPUT_CAP_EXCEEDED');
  const gate = reasons.length === 0 ? 'RUN_COMPLETE' : 'RUN_INCOMPLETE';
  let adaptation = null, adjudication = null, table = null;
  if (idOk) {
    adaptation = adaptFixedCanaryOutput(s, fixedCanaryMappingV1());
    adjudication = adjudicateFixedCanaries(adaptation.adaptedOutput, expectedMatrixFor({ childPid: identity.childPid, servicePid: identity.servicePid }));
    table = formatCanaryTable(adjudication);
    if (adjudication.overall !== 'ALL_MATCHED') reasons.push('CANARIES_NOT_MATCHED');
  }
  return { schemaVersion: 'nisi-fixed-run-summary/v1', identity, lifecycle, gate, reasons, adaptation, adjudication, table,
    overall: reasons.length === 0 ? 'OBSERVED' : 'NOT_ACCEPTED', isolationAccepted: false, generatedCodeExecuted: false, authorizing: false };
}
const tampered = STDOUT.split('\n'); tampered[3] = '{"operation":"outside_read","outcome":"allowed","errno":0,"generatedCodeExecuted":false,"completeIsolation":false,"authorizing":false}';
const out = {
  'summary-observed.json': summarize(RECEIPT, STDOUT),
  'summary-canaries-not-matched.json': summarize(RECEIPT, tampered.join('\n')),
  'summary-timeout.json': summarize({ ...RECEIPT, timeout: true, exitCode: null, signal: 'SIGKILL', stdoutEOF: false }, STDOUT),
  'summary-identity-unavailable.json': summarize({ ...RECEIPT, childPid: undefined }, STDOUT),
};
for (const [name, value] of Object.entries(out)) await writeFile(new URL(name, here), JSON.stringify(value, null, 2) + '\n');
console.log(Object.entries(out).map(([n, v]) => `${n}: overall=${v.overall} reasons=${JSON.stringify(v.reasons)} table=${v.table === null ? 'null' : v.table.length + ' chars'}`).join('\n'));
