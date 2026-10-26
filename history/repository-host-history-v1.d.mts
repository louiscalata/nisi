import type {
  JournalOwner,
  RecordJournalObservationResult,
} from './journal-owner-v2.mjs';
import type {RunOutcome} from '../types/workflow.d.ts';

interface RepositoryHistoryPreviewBodyCommon {
  readonly schemaVersion: 'nisi-repository-history-observation/v1';
  readonly taskFingerprint: string;
  readonly baselineFingerprint: string;
  readonly runId: string;
  readonly attempt: number;
  readonly outcome: RunOutcome;
  readonly workflowOutcome: RunOutcome;
  readonly hostState: 'SETTLED' | 'QUARANTINED';
  readonly ownerStates: Readonly<{
    readonly staticChecks: 'IDLE' | 'BUSY' | 'QUARANTINED' | 'UNKNOWN';
    readonly tests: 'IDLE' | 'BUSY' | 'QUARANTINED' | 'UNKNOWN';
  }>;
  readonly stageCounts: Readonly<{
    readonly PASS: number;
    readonly FAIL: number;
    readonly NOT_RUN: number;
    readonly UNAVAILABLE: number;
    readonly REPAIRED: number;
    readonly NO_CHANGE: number;
  }>;
  readonly stageTotal: number;
  readonly diagnostics: Readonly<{
    readonly reportCodeSha256: string | null;
    readonly reportStoreCodeSha256: string | null;
    readonly bundleCodeSha256: string | null;
    readonly settlementCodeSha256: readonly [string | null, string | null];
    readonly historyCodeSha256: readonly [string | null, string | null];
    readonly ownerStateCodeSha256: readonly [string | null, string | null];
  }>;
  readonly bundleFingerprint: string | null;
  readonly sourceAuthenticityAttested: false;
  readonly executionAttested: false;
  readonly learningEligible: false;
  readonly authorizing: false;
}

export type RepositoryHistoryPreviewBody = RepositoryHistoryPreviewBodyCommon & (
  | {readonly candidatePresent:true; readonly candidateFingerprint:string}
  | {readonly candidatePresent:false; readonly candidateFingerprint:null}
);

export interface RepositoryHistoryPreview {
  readonly schemaVersion: 'nisi-repository-history-preview/v1';
  readonly status: 'PREVIEW';
  readonly reason: null;
  readonly preview: RepositoryHistoryPreviewBody;
  readonly sha256: string;
  readonly authorizing: false;
}

export interface RepositoryHistoryPreviewRefusal {
  readonly schemaVersion: 'nisi-repository-history-preview/v1';
  readonly status: 'REFUSED';
  readonly reason: string;
  readonly preview: null;
  readonly sha256: null;
  readonly authorizing: false;
}

export type RepositoryHistoryPreviewResult = RepositoryHistoryPreview | RepositoryHistoryPreviewRefusal;

export interface RepositoryHistoryDeclaration {
  readonly schemaVersion: 'nisi-repository-history-declaration/v1';
  readonly declarationId: string;
  readonly projectId: string;
  readonly sourceDigest: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly createdAt: number;
  readonly retentionMs: number;
  readonly consentClass: 'WRITTEN_DECLARATION';
  readonly destination: 'LOCAL_OBSERVATION_JOURNAL_ONLY';
  readonly rawContentPersisted: false;
  readonly networkEgress: false;
  readonly learningInfluence: false;
}

export interface RepositoryHistoryCaptureInput {
  readonly owner: JournalOwner;
  readonly declaration: RepositoryHistoryDeclaration;
  readonly clock: () => number;
}

interface RepositoryHistoryCaptureCommon {
  readonly schemaVersion: 'nisi-repository-history-capture/v1';
  readonly reason: string | null;
  readonly sourceDigest: string | null;
  readonly declarationDigest: string | null;
  readonly authorizing: false;
}

export interface RepositoryHistoryStored extends RepositoryHistoryCaptureCommon {
  readonly status: 'STORED';
  readonly recordAttempted: true;
  readonly consumed: true;
  readonly reason: string | null;
  readonly sourceDigest: string;
  readonly declarationDigest: string;
  readonly journal: Extract<RecordJournalObservationResult, { readonly status: 'RECORDED' }>;
}

export interface RepositoryHistoryDuplicate extends RepositoryHistoryCaptureCommon {
  readonly status: 'DUPLICATE';
  readonly recordAttempted: true;
  readonly consumed: true;
  readonly sourceDigest: string;
  readonly declarationDigest: string;
  readonly journal: Extract<RecordJournalObservationResult, { readonly status: 'DUPLICATE' }>;
}

export interface RepositoryHistoryConflict extends RepositoryHistoryCaptureCommon {
  readonly status: 'CONFLICT';
  readonly recordAttempted: true;
  readonly consumed: true;
  readonly sourceDigest: string;
  readonly declarationDigest: string;
  readonly journal: Extract<RecordJournalObservationResult, { readonly status: 'CONFLICT' | 'STORE_CONFLICT' }>;
}

export interface RepositoryHistoryStoreFailure extends RepositoryHistoryCaptureCommon {
  readonly status: 'STORE_FAILED' | 'UNCERTAIN';
  readonly recordAttempted: true;
  readonly consumed: true;
  readonly sourceDigest: string;
  readonly declarationDigest: string;
  readonly journal: Extract<RecordJournalObservationResult, { readonly status: 'STORE_FAILED' }> | null;
}

export interface RepositoryHistoryRefusal extends RepositoryHistoryCaptureCommon {
  readonly status: 'REFUSED';
  readonly recordAttempted: false;
  /** ALREADY_CAPTURED has no new record attempt, but remains consumed. */
  readonly consumed: boolean;
  readonly reason: string;
  readonly journal: null;
}

export interface RepositoryHistoryRecordRefusal extends RepositoryHistoryCaptureCommon {
  readonly status: 'REFUSED';
  readonly recordAttempted: true;
  readonly consumed: true;
  readonly sourceDigest: string;
  readonly declarationDigest: string;
  readonly journal: Extract<RecordJournalObservationResult, { readonly status: 'REFUSED' }>;
}

export type RepositoryHistoryCaptureResult =
  | RepositoryHistoryStored
  | RepositoryHistoryDuplicate
  | RepositoryHistoryConflict
  | RepositoryHistoryStoreFailure
  | RepositoryHistoryRefusal
  | RepositoryHistoryRecordRefusal;

export interface RepositorySettledHistoryResult {
  readonly schemaVersion: 'nisi-reviewed-repository-host-v1';
  readonly report: unknown;
  readonly state: 'SETTLED' | 'QUARANTINED';
  readonly applied: false;
  readonly sandboxed: false;
  readonly authorizing: false;
  readonly certificationGranted: false;
  readonly [key: string]: unknown;
}

/** Trusted internal publication is not exposed by the reviewed host. */
export interface RepositoryHistoryAccessV1 {
  readonly publish: (result: RepositorySettledHistoryResult) => void;
  readonly reject: () => void;
  readonly preview: () => RepositoryHistoryPreviewResult;
  readonly capture: (input: RepositoryHistoryCaptureInput) => RepositoryHistoryCaptureResult;
}

export interface RepositoryHistoryAccessConfig {
  readonly taskFingerprint: string;
  readonly baselineFingerprint: string;
}

export function createRepositoryHistoryAccessV1(input: RepositoryHistoryAccessConfig): RepositoryHistoryAccessV1;

export interface ReviewedRepositoryHostHistoryV1 {
  readonly historyPreview: () => RepositoryHistoryPreviewResult;
  readonly captureHistory: (input: RepositoryHistoryCaptureInput) => RepositoryHistoryCaptureResult;
}
