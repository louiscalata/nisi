import type { Buffer } from 'node:buffer';

declare const journalOwnerBrand: unique symbol;

/** Runtime value is an empty frozen object. The private brand prevents fabrication in TypeScript. */
export interface JournalOwner {
  readonly [journalOwnerBrand]: true;
}

export type PlainData =
  | null
  | boolean
  | string
  | number
  | { readonly [key: string]: PlainData }
  | readonly PlainData[];

export interface JournalConfig {
  readonly projectId: string;
  readonly maxEntries: number;
  readonly heartbeatTtlMs: number;
  readonly redactPaths: readonly string[];
}

/** Trusted synchronous filesystem seam; implementations and proxy traps are outside the security guarantee. */
export interface JournalOwnerFs {
  readFileSync(path: string): Buffer;
  openSync(path: string, flags: string, mode?: number): number;
  writeSync(fd: number, buffer: Uint8Array, offset: number, length: number, position?: number | null): number;
  closeSync(fd: number): void;
  renameSync(oldPath: string, newPath: string): void;
  unlinkSync(path: string): void;
  fsyncSync?(fd: number): void;
}

export type JournalEntryState = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'REVOKED';
export type JournalLiveness = JournalEntryState | 'EXPIRED' | 'UNKNOWN';

export interface JournalEntry {
  readonly id: string;
  readonly projectId: string;
  readonly runId: string;
  readonly attempt: number;
  readonly candidateId: string;
  readonly stage: string;
  readonly receiptId: string | null;
  readonly createdAt: number;
  readonly ttlMs: number;
  readonly state: JournalEntryState;
  readonly heartbeatAt: number | null;
  readonly retryOf: string | null;
  readonly revokes: string | null;
  readonly payload: PlainData;
}

export interface JournalEntryView {
  readonly entry: JournalEntry;
  readonly historical: boolean;
  readonly retained: boolean;
  readonly revoked: boolean;
  readonly expired: boolean;
  readonly liveness: JournalLiveness;
  readonly authorizing: false;
}

export interface InterruptedObservation {
  readonly id: string;
  readonly runId: string;
  readonly attempt: number;
  readonly stage: string;
  readonly liveness: 'UNKNOWN';
  readonly heartbeatAt: number | null;
  readonly createdAt: number;
}

export type RecoveryStatus = 'NEW' | 'COMPLETE' | 'INCOMPLETE' | 'INVALID' | 'COMMIT_UNCERTAIN';

export interface JournalRecovery<S extends RecoveryStatus = RecoveryStatus> {
  readonly status: S;
  readonly recoveredIds: readonly string[];
  readonly rejectedLine: number | null;
  readonly reason: string | null;
  readonly authorizing: false;
}

interface SnapshotCommon {
  readonly schemaVersion: 'nisi-journal-owner/v2';
  readonly entries: readonly JournalEntryView[];
  readonly interrupted: readonly InterruptedObservation[];
  readonly meaning: 'HISTORY_OBSERVATIONS_ONLY';
  readonly authorizing: false;
}

export interface NewJournalSnapshot extends SnapshotCommon {
  readonly state: 'OPEN';
  readonly recovery: JournalRecovery<'NEW'>;
  readonly sha256: null;
  readonly bytes: 0;
}

export interface CompleteJournalSnapshot extends SnapshotCommon {
  readonly state: 'OPEN';
  readonly recovery: JournalRecovery<'COMPLETE'>;
  readonly sha256: string;
  readonly bytes: number;
}

export interface SealedJournalSnapshot extends SnapshotCommon {
  readonly state: 'SEALED';
  readonly recovery: JournalRecovery<'INCOMPLETE' | 'INVALID'>;
  readonly sha256: null;
  readonly bytes: null;
}

export interface CommitUncertainJournalSnapshot extends SnapshotCommon {
  readonly state: 'COMMIT_UNCERTAIN';
  readonly recovery: JournalRecovery<'COMMIT_UNCERTAIN'>;
  readonly sha256: null;
  readonly bytes: null;
  readonly entries: readonly [];
  readonly interrupted: readonly [];
}

export type JournalSnapshot = NewJournalSnapshot | CompleteJournalSnapshot | SealedJournalSnapshot | CommitUncertainJournalSnapshot;

export type SimpleRefusalReason =
  | 'INVALID_INPUT'
  | 'READ_FAILED'
  | 'SIZE_LIMIT'
  | 'INVALID_UTF8'
  | 'INVALID_JOURNAL'
  | 'PROJECT_MISMATCH'
  | 'CONFIG_MISMATCH'
  | 'CLOCK_BEHIND_JOURNAL'
  | 'OWNER_SEALED'
  | 'COMMIT_UNCERTAIN'
  | 'OWNER_BUSY';

export interface SimpleRefusal {
  readonly schemaVersion: 'nisi-journal-owner/v2';
  readonly status: 'REFUSED';
  readonly reason: SimpleRefusalReason;
  readonly authorizing: false;
}

export interface OpenJournalOwnerInput {
  readonly path: string;
  readonly fs: JournalOwnerFs;
  readonly config: JournalConfig;
  readonly now: number;
}

export interface OpenedJournalOwner {
  readonly schemaVersion: 'nisi-journal-owner/v2';
  readonly status: 'OPENED';
  readonly owner: JournalOwner;
  readonly snapshot: JournalSnapshot;
  readonly authorizing: false;
}

export type OpenJournalOwnerResult = OpenedJournalOwner | SimpleRefusal;

export interface InspectJournalOwnerInput { readonly owner: JournalOwner }

export interface JournalOwnerInspection {
  readonly schemaVersion: 'nisi-journal-owner/v2';
  readonly status: 'SNAPSHOT';
  readonly snapshot: JournalSnapshot;
  readonly authorizing: false;
}

export type InspectJournalOwnerResult = JournalOwnerInspection | SimpleRefusal;

export type JournalAppendResult =
  | { readonly status: 'APPENDED'; readonly id: string }
  | { readonly status: 'DUPLICATE'; readonly id: string }
  | { readonly status: 'CONFLICT'; readonly id: string; readonly reason: 'ID_CONTENT_MISMATCH' }
  | { readonly status: 'REFUSED'; readonly id: string; readonly reason: string };

export interface StoreFsyncState { readonly file: boolean; readonly directory: boolean }
export interface StoreFsyncErrors { readonly file: string | null; readonly directory: string | null }

interface StoreResultCommon {
  readonly durable: boolean;
  readonly committed: boolean;
  readonly fsync: StoreFsyncState;
  readonly fsyncErrors: StoreFsyncErrors;
  readonly cleanupError?: string;
}

export interface StoreWrittenResult extends StoreResultCommon {
  readonly status: 'WRITTEN';
  readonly committed: true;
  readonly sha256: string;
  readonly bytes: number;
  readonly verified: true;
}

export interface StoreUnchangedResult extends StoreResultCommon {
  readonly status: 'UNCHANGED';
  readonly committed: false;
  readonly durable: false;
  readonly sha256: string;
  readonly bytes: number;
  readonly verified: true;
}

export interface StoreRefusedResult extends StoreResultCommon {
  readonly status: 'REFUSED';
  readonly durable: false;
  readonly reason: string;
}

export type JournalStoreResult = StoreWrittenResult | StoreUnchangedResult | StoreRefusedResult;

interface DetailedRecordResultCommon {
  readonly schemaVersion: 'nisi-journal-owner/v2';
  readonly entryId: string | null;
  readonly append: JournalAppendResult | null;
  readonly store: unknown;
  readonly snapshot: JournalSnapshot;
  readonly authorizing: false;
}

export interface RecordedObservationResult extends DetailedRecordResultCommon {
  readonly status: 'RECORDED';
  readonly reason: null;
  readonly entryId: string;
  readonly append: Extract<JournalAppendResult, { readonly status: 'APPENDED' }>;
  readonly store: StoreWrittenResult | StoreUnchangedResult;
}

export interface DuplicateObservationResult extends DetailedRecordResultCommon {
  readonly status: 'DUPLICATE';
  readonly reason: null;
  readonly entryId: string;
  readonly append: Extract<JournalAppendResult, { readonly status: 'DUPLICATE' }>;
  readonly store: null;
}

export interface ConflictingObservationResult extends DetailedRecordResultCommon {
  readonly status: 'CONFLICT';
  readonly reason: string;
  readonly entryId: string;
  readonly append: Extract<JournalAppendResult, { readonly status: 'CONFLICT' }>;
  readonly store: null;
}

export interface RefusedObservationResult extends DetailedRecordResultCommon {
  readonly status: 'REFUSED';
  readonly reason: string;
  readonly store: null;
}

export interface StoreConflictObservationResult extends DetailedRecordResultCommon {
  readonly status: 'STORE_CONFLICT';
  readonly reason: string;
  readonly entryId: string;
  readonly append: Extract<JournalAppendResult, { readonly status: 'APPENDED' }>;
  readonly store: StoreRefusedResult;
}

export interface StoreFailedObservationResult extends DetailedRecordResultCommon {
  readonly status: 'STORE_FAILED';
  readonly reason: string;
  /** May retain a representable rejected store response that did not match JournalStoreResult. */
  readonly store: PlainData;
}

export type RecordJournalObservationResult =
  | SimpleRefusal
  | RecordedObservationResult
  | DuplicateObservationResult
  | ConflictingObservationResult
  | RefusedObservationResult
  | StoreConflictObservationResult
  | StoreFailedObservationResult;

export interface MaintainJournalOwnerInput {
  readonly owner: JournalOwner;
  readonly now: number;
}

interface MaintenanceResultCommon {
  readonly schemaVersion: 'nisi-journal-maintenance/v1';
  readonly reason: string | null;
  readonly snapshot: JournalSnapshot | null;
  readonly authorizing: false;
}

export interface MaintainedJournalOwnerResult extends MaintenanceResultCommon {
  readonly status: 'MAINTAINED';
  readonly reason: null;
  readonly store: StoreWrittenResult;
  readonly snapshot: CompleteJournalSnapshot;
  readonly meaning: 'HISTORY_OBSERVATIONS_ONLY';
}

export interface UnchangedJournalOwnerResult extends MaintenanceResultCommon {
  readonly status: 'UNCHANGED';
  readonly reason: null;
  readonly store: StoreUnchangedResult;
  readonly snapshot: CompleteJournalSnapshot;
  readonly meaning: 'HISTORY_OBSERVATIONS_ONLY';
}

export interface MaintenanceStoreConflictResult extends MaintenanceResultCommon {
  readonly status: 'STORE_CONFLICT';
  readonly reason: string;
  readonly store: StoreRefusedResult;
  readonly snapshot: JournalSnapshot;
  readonly meaning: 'HISTORY_OBSERVATIONS_ONLY';
}

export interface MaintenanceStoreFailedResult extends MaintenanceResultCommon {
  readonly status: 'STORE_FAILED';
  readonly reason: string;
  /** A rejected or malformed store response is opaque PlainData, not validated store data. */
  readonly store: PlainData | null;
  readonly snapshot: JournalSnapshot;
  readonly meaning: 'HISTORY_OBSERVATIONS_ONLY';
}

export interface MaintenanceRefusedResult extends MaintenanceResultCommon {
  readonly status: 'REFUSED';
  readonly reason: string;
  readonly store: null;
  readonly snapshot: JournalSnapshot | null;
  readonly meaning: 'HISTORY_OBSERVATIONS_ONLY';
}

export type MaintainJournalOwnerResult =
  | MaintainedJournalOwnerResult
  | UnchangedJournalOwnerResult
  | MaintenanceStoreConflictResult
  | MaintenanceStoreFailedResult
  | MaintenanceRefusedResult;

export interface RecordJournalObservationInput {
  readonly owner: JournalOwner;
  readonly entry: JournalEntry;
  readonly now: number;
}

export function openJournalOwner(input: OpenJournalOwnerInput): OpenJournalOwnerResult;
export function inspectJournalOwner(input: InspectJournalOwnerInput): InspectJournalOwnerResult;
export function recordJournalObservation(input: RecordJournalObservationInput): RecordJournalObservationResult;
export function maintainJournalOwner(input: MaintainJournalOwnerInput): MaintainJournalOwnerResult;
