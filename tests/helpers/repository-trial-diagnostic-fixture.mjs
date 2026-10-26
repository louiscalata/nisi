// Synthetic data for codec/storage refusals only, never an execution receipt.
export function diagnosticFixture() {
  const hash = 'a'.repeat(64);
  return { schemaVersion: 'nisi-repository-trial-diagnostic-v1',
    binding: { requestId: hash, profileSha256: hash, model: 'nisi-v3-composite:' + hash, modelSettingsSha256: hash,
      taskSha256: hash, baselineSha256: hash, suiteFingerprint: hash, reviewedSourceFingerprint: hash },
    kind: 'PARTIAL_CHANNELS', channels: Object.fromEntries(['hostRun', 'hostCollection', 'operationResult', 'operationSettlement'].map(k => [k, { state: 'PENDING', code: null }])),
    host: { availability: 'UNAVAILABLE', runId: null, reportSha256: null, outcome: null, candidateFingerprint: null,
      repairAttempts: null, collectionState: null, reportChannelMatches: null, ownerStates: { staticChecks: null, tests: null },
      settlementFailures: [null, null], historyFailures: [null, null], stateFailures: [null, null] },
    lane: { availability: 'AVAILABLE', runId: null, phase: 'NEW', revoked: false, state: 'IDLE', pendingTransports: 0,
      recoveryRequired: false, authorReceipts: 0, reviewerReceipts: 0, unavailableReceipts: 0 },
    projection: { state: 'PENDING', fingerprint: null, candidateSha256: null, completionClaim: null,
      receiptStatus: null, inputTokens: null, outputTokens: null, modelCalls: null },
    rawEvidenceRetained: false, sourceTrust: 'OBSERVED_TRUSTED_CALLBACKS_NOT_ATTESTED', remoteExecutionStopped: 'UNKNOWN',
    authorizing: false, resumable: false, measurementVerified: false, promotionEligible: false };
}
