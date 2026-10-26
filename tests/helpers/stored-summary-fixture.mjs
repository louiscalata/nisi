// Synthetic summary data only. No live model, producer or execution evidence.
export function storedSummaryFixture() {
  return { schemaVersion: 'nisi-private-live-demo-summary-v1', status: 'INCOMPLETE',
    workflowOutcome: 'TIMED_OUT', errorCode: 'SYNTHETIC_TIMEOUT', diagnosticErrors: [],
    retained: [{path: 'not-read.json',byteLength: 99,sha256: 'a'.repeat(64)}],
    receiptFingerprint: null, setupDurationMs: 0, workflowDurationMs: null,
    remoteInferenceStopped: 'NOT_OBSERVED', blindBenchmark: false, comparativeBenefitMeasured: false,
    rawHttpBodyRetained: false, applied: false, nativeAppAccepted: false, publicationAuthorized: false,
    directory: '/PRIVATE_PATH_DO_NOT_ECHO', hostState: 'PRIVATE_STATE_DO_NOT_ECHO' };
}
