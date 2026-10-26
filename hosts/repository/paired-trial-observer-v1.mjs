// PRIVATE passive observation of original channels. No timer, cancellation,
// second settlement call, disk write or model admission is introduced here.
import { types } from 'node:util';
import { record, list } from '../../evaluation/intake-v1.mjs';
import { cloneFreeze, stableStringify, sha256Text } from '../../workflow/contracts.mjs';
import { readFinalEngineReportV2 } from '../../receipts/host-run-bundle-v2.mjs';
import { DIAGNOSTIC_CHANNELS, DIAGNOSTIC_CODES, readRepositoryTrialDiagnosticV1 } from '../../history/repository-trial-diagnostic-v1.mjs';
import { startRepositoryPairedExecutorV1 } from './paired-trial-executor-v1.mjs';
import { readIssuedLiveModelLaneV3 } from './reviewed-live-model-v3.mjs';
const data = (x, key) => { const d = x && ['object', 'function'].includes(typeof x) && Object.getOwnPropertyDescriptor(x, key); return d && Object.hasOwn(d, 'value') ? d.value : undefined; };
const method = (x, key) => { const fn = data(x, key); if (typeof fn !== 'function') throw Object.assign(Error('TRIAL_DIAGNOSTIC_CAPABILITY'), { code: 'TRIAL_DIAGNOSTIC_CAPABILITY' }); return fn.bind(x); };
const errorCode = (e, fallback) => DIAGNOSTIC_CODES.includes(data(e, 'code')) ? data(e, 'code') : fallback;
const failures = value => { try { return list(value, 2, 2).map(v => v !== null); } catch { return [null, null]; } };
export function startObservedRepositoryPairedExecutorV1(input) {
  const { host, lane, binding } = record(input, ['host', 'lane', 'binding']);
  const run = method(host, 'run'), settled = method(host, 'settled'), status = method(host, 'status');
  // Existing executor validates the original issued lane/binding before dispatch.
  const cells = Object.fromEntries(DIAGNOSTIC_CHANNELS.map(key => [key, { state: 'NOT_CALLED', code: null, value: undefined }]));
  let terminal = null, executor = null, captureFailed = false;
  const terminalChannels = () => Object.values(cells).every(c => !['NOT_CALLED', 'PENDING'].includes(c.state));
  function observe(promise, cell) {
    if (!types.isPromise(promise)) { cell.state = 'INVALID'; cell.code = 'INVALID_PROMISE'; return promise; }
    cell.state = 'PENDING';
    Promise.prototype.then.call(promise, value => {
      cell.state = 'FULFILLED'; cell.value = value; publish();
    }, error => { cell.state = 'REJECTED'; cell.code = errorCode(error, 'CALLBACK_REJECTED'); publish(); });
    return promise; // Never substitute a derived promise for the original channel.
  }
  function invoke(fn, args, key) {
    try { return observe(Reflect.apply(fn, undefined, args), cells[key]); }
    catch (error) { cells[key].state = 'THREW'; cells[key].code = errorCode(error, 'CALLBACK_THROWN'); throw error; }
  }
  function snapshot() {
    const h = { availability: 'UNAVAILABLE', runId: null, reportSha256: null, outcome: null, candidateFingerprint: null,
      repairAttempts: null, collectionState: null, reportChannelMatches: null, ownerStates: { staticChecks: null, tests: null },
      settlementFailures: [null, null], historyFailures: [null, null], stateFailures: [null, null] };
    try {
      if (cells.hostRun.state === 'FULFILLED') {
        const report = readFinalEngineReportV2(cells.hostRun.value);
        Object.assign(h, { availability: 'AVAILABLE', runId: report.runId,
          reportSha256: sha256Text('nisi/repository-final-report/v1\0' + stableStringify(report)), outcome: report.outcome,
          candidateFingerprint: report.candidateFingerprint, repairAttempts: report.repairAttempts });
      }
    } catch { /* Unavailable report summary does not discard other channels. */ }
    try {
      if (cells.hostCollection.state === 'FULFILLED') {
        const value = cells.hostCollection.value, state = data(value, 'state'), owners = data(value, 'ownerStates');
        if (['SETTLED', 'QUARANTINED'].includes(state)) h.collectionState = state;
        h.reportChannelMatches = cells.hostRun.state === 'FULFILLED' ? data(value, 'report') === cells.hostRun.value : null;
        for (const role of ['staticChecks', 'tests']) {
          const state = data(owners, role); if (['IDLE', 'BUSY', 'QUARANTINED', 'UNKNOWN'].includes(state)) h.ownerStates[role] = state;
        }
        h.settlementFailures = failures(data(value, 'settlementErrors'));
        h.historyFailures = failures(data(value, 'historyErrors'));
        h.stateFailures = failures(data(value, 'ownerStateErrors'));
      }
    } catch { /* Other independently captured data survives unavailable diagnostics. */ }
    let l = { availability: 'UNAVAILABLE', runId: null, phase: null, revoked: null, state: null, pendingTransports: null,
      recoveryRequired: null, authorReceipts: null, reviewerReceipts: null, unavailableReceipts: null };
    try {
      const s = readIssuedLiveModelLaneV3(lane).snapshot;
      l = { availability: 'AVAILABLE', runId: s.runId, phase: s.phase, revoked: s.revoked, state: s.lifecycle.state,
        pendingTransports: s.lifecycle.pendingTransports, recoveryRequired: s.lifecycle.recoveryRequired,
        authorReceipts: s.authorReceipts.length, reviewerReceipts: s.reviewerReceipts.length,
        unavailableReceipts: [...s.authorReceipts, ...s.reviewerReceipts].filter(r => r.status === 'UNAVAILABLE').length };
    } catch { /* Unavailable lane snapshot never erases original host evidence. */ }
    const p = executor.inspectProjection(), e = p.evidence;
    const projection = { state: p.state, fingerprint: e?.fingerprint ?? null, candidateSha256: e?.candidate.candidateSha256 ?? null,
      completionClaim: e?.completionClaim ?? null, receiptStatus: e?.repositoryReceiptStatus ?? null,
      inputTokens: e?.usage.projectedTokens?.input ?? null, outputTokens: e?.usage.projectedTokens?.output ?? null,
      modelCalls: e?.usage.projectedModelCalls ?? null };
    return readRepositoryTrialDiagnosticV1({ schemaVersion: 'nisi-repository-trial-diagnostic-v1', binding: ownedBinding,
      kind: terminalChannels() ? 'TERMINAL_CHANNELS' : 'PARTIAL_CHANNELS',
      channels: Object.fromEntries(Object.entries(cells).map(([key, c]) => [key, { state: c.state, code: c.code }])),
      host: h, lane: l, projection, rawEvidenceRetained: false, sourceTrust: 'OBSERVED_TRUSTED_CALLBACKS_NOT_ATTESTED',
      remoteExecutionStopped: 'UNKNOWN', authorizing: false, resumable: false, measurementVerified: false, promotionEligible: false });
  }
  function publish() {
    // The operation result observer is attached after the projector's own publish
    // observer. Host observers only record cells; they cannot freeze early state.
    if (executor && !terminal && !captureFailed && terminalChannels()) {
      try { terminal = snapshot(); } catch { captureFailed = true; }
    }
  }
  const ownedBinding = cloneFreeze(binding);
  executor = startRepositoryPairedExecutorV1({ lane, binding: ownedBinding, host: Object.freeze({
    run: (...args) => invoke(run, args, 'hostRun'), settled: (...args) => invoke(settled, args, 'hostCollection'), status,
  }) });
  observe(executor.operation.result, cells.operationResult); observe(executor.operation.settled, cells.operationSettlement);
  return Object.freeze({ operation: executor.operation, inspectProjection: executor.inspectProjection,
    captureDiagnostics() {
      if (captureFailed) throw Object.assign(Error('TRIAL_DIAGNOSTIC_CAPTURE_UNAVAILABLE'), { code: 'TRIAL_DIAGNOSTIC_CAPTURE_UNAVAILABLE' });
      return terminal ?? snapshot();
    } });
}
