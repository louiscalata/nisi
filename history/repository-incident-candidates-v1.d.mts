export type IncidentTrust = 'TRUSTED_HOST_STATEMENTS_NOT_ATTESTED';
export type IncidentClassification = 'FAILURE_CANDIDATE' | 'PASS' | 'NOT_RUN' | 'OPERATIONAL' | 'INTERRUPTED';
export type IncidentReason = 'RECORDED_FAILURE' | 'RECORDED_PASS' | 'NOT_DISPATCHED' | 'CHECK_NOT_RUN' | 'STAGE_UNAVAILABLE' | 'CHECK_UNAVAILABLE' | 'ENGINE_INTERRUPTED';
export type IncidentRawStatus = 'PASS' | 'FAIL' | 'NOT_RUN' | 'ERROR' | 'INCONCLUSIVE' | 'NOT_DISPATCHED' | 'NO_RECEIPT';
export type IncidentStageStatus = 'PASS' | 'FAIL' | 'NOT_RUN' | 'UNAVAILABLE' | 'REPAIRED' | 'NO_CHANGE';
export type IncidentDisposition = 'RESULT_RECORDED' | 'ENGINE_INTERRUPTED';

export interface IncidentBinding {
  readonly runId: string; readonly taskFingerprint: string; readonly baselineFingerprint: string;
  readonly attempt: number; readonly stage: 'staticChecks' | 'tests'; readonly checkIndex: number;
  readonly candidateFingerprint: string; readonly subjectKey: string;
}
export interface IncidentSource {
  readonly reportSha256: string; readonly bundleFingerprint: string; readonly planFingerprint: string | null;
  readonly groupFingerprint: string | null; readonly expectationFingerprint: string; readonly profileFingerprint: string;
  readonly verifierSourceSha256: string; readonly verifierBuildSha256: string; readonly executableSha256: string;
  readonly rulesetSha256: string; readonly preparationFingerprint: string; readonly materializedFingerprint: string;
  readonly receiptSha256: string | null; readonly evidenceSha256: string;
}
export interface IncidentSubject {
  readonly kind: 'FILE' | 'MATERIALIZED_TREE'; readonly pathSha256: string | null; readonly contentSha256: string | null;
}
export interface RepositoryIncidentRow {
  readonly schemaVersion: 'nisi-repository-incident-row/v1'; readonly rowId: string; readonly occurrenceGroupId: string;
  readonly familyId: string; readonly binding: IncidentBinding; readonly stageIndex: number;
  readonly classification: IncidentClassification; readonly reason: IncidentReason; readonly rawStatus: IncidentRawStatus;
  readonly stageStatus: IncidentStageStatus; readonly disposition: IncidentDisposition;
  readonly source: IncidentSource; readonly subject: IncidentSubject; readonly failureCodes: readonly string[];
  readonly sourceTrust: IncidentTrust; readonly persistable: false; readonly executionVerified: false;
  readonly learningEligible: false; readonly independentOccurrence: false; readonly authorizing: false;
  readonly certificationGranted: false; readonly fingerprint: string;
}
export interface RepositoryIncidentPreview {
  readonly schemaVersion: 'nisi-repository-incident-preview/v1'; readonly status: 'PREVIEW'; readonly reason: null;
  readonly reportSha256: string; readonly bundleFingerprint: string; readonly rows: readonly RepositoryIncidentRow[];
  readonly sha256: string; readonly sourceTrust: IncidentTrust; readonly freshness: 'SETTLED_SNAPSHOT_ONLY';
  readonly persistable: false; readonly learningEligible: false; readonly authorizing: false;
}
export interface RepositoryIncidentPreviewRefusal {
  readonly schemaVersion: 'nisi-repository-incident-preview/v1'; readonly status: 'REFUSED';
  readonly reason: 'NO_SETTLED_RESULT' | 'HOST_NOT_SETTLED' | 'INVALID_EVIDENCE'; readonly reportSha256: null;
  readonly bundleFingerprint: null; readonly rows: readonly []; readonly sha256: null; readonly sourceTrust: IncidentTrust;
  readonly freshness: 'SETTLED_SNAPSHOT_ONLY'; readonly persistable: false; readonly learningEligible: false;
  readonly authorizing: false;
}
export type RepositoryIncidentPreviewResult = RepositoryIncidentPreview | RepositoryIncidentPreviewRefusal;

export function isIssuedRepositoryIncidentPreviewV1(value: unknown): value is RepositoryIncidentPreview;
export function createRepositoryIncidentPreviewV1(input: { readonly bundle: unknown; readonly context: unknown }): RepositoryIncidentPreview;
