import type {JournalOwner, RecordJournalObservationResult} from './journal-owner-v2.mjs';
import type {RepositoryIncidentPreview, RepositoryIncidentPreviewResult, RepositoryIncidentRow} from './repository-incident-candidates-v1.mjs';

declare const incidentPermitBrand: unique symbol;
export interface RepositoryIncidentPermit { readonly [incidentPermitBrand]: true; }
export interface IncidentDeclaration {
  readonly schemaVersion: 'nisi-repository-incident-declaration/v1'; readonly declarationId: string;
  readonly projectId: string; readonly rowId: string; readonly rowFingerprint: string; readonly previewSha256: string;
  readonly issuedAt: number; readonly expiresAt: number; readonly createdAt: number; readonly retentionMs: number;
  readonly consentClass: 'WRITTEN_DECLARATION'; readonly destination: 'LOCAL_INCIDENT_OBSERVATION_ONLY';
  readonly rawContentPersisted: false; readonly networkEgress: false; readonly learningInfluence: false;
}
export interface IncidentPermitInput { readonly owner: JournalOwner; readonly declaration: IncidentDeclaration; readonly clock: () => number; }
export interface IncidentPermitCreated { readonly schemaVersion: 'nisi-repository-incident-permit/v1'; readonly status: 'CREATED'; readonly reason: null; readonly permit: RepositoryIncidentPermit; readonly declarationDigest: string; readonly consumed: false; readonly authorizing: false; }
export interface IncidentPermitRefused { readonly schemaVersion: 'nisi-repository-incident-permit/v1'; readonly status: 'REFUSED'; readonly reason: string; readonly permit: null; readonly declarationDigest: string | null; readonly consumed: boolean; readonly authorizing: false; }
export interface IncidentPermitRevoked { readonly schemaVersion: 'nisi-repository-incident-permit/v1'; readonly status: 'REVOKED'; readonly reason: null; readonly permit: null; readonly declarationDigest: string; readonly consumed: false; readonly authorizing: false; }
export type IncidentPermitResult = IncidentPermitCreated | IncidentPermitRefused | IncidentPermitRevoked;

interface IncidentCaptureCommon { readonly schemaVersion: 'nisi-repository-incident-capture/v1'; readonly entryId: string | null; readonly rowId: string | null; readonly declarationDigest: string | null; readonly learningEligible: false; readonly authorizing: false; }
export interface IncidentStored extends IncidentCaptureCommon { readonly status: 'STORED'; readonly reason: null; readonly entryId: string; readonly rowId: string; readonly declarationDigest: string; readonly recordAttempted: true; readonly consumed: true; readonly journal: Extract<RecordJournalObservationResult, {readonly status: 'RECORDED'}>; }
export interface IncidentDuplicate extends IncidentCaptureCommon { readonly status: 'DUPLICATE'; readonly reason: null; readonly entryId: string; readonly rowId: string; readonly declarationDigest: string; readonly recordAttempted: true; readonly consumed: true; readonly journal: Extract<RecordJournalObservationResult, {readonly status: 'DUPLICATE'}>; }
export interface IncidentConflict extends IncidentCaptureCommon { readonly status: 'CONFLICT'; readonly reason: string; readonly entryId: string; readonly rowId: string; readonly declarationDigest: string; readonly recordAttempted: true; readonly consumed: true; readonly journal: Extract<RecordJournalObservationResult, {readonly status: 'CONFLICT' | 'STORE_CONFLICT'}>; }
export interface IncidentStoreFailure extends IncidentCaptureCommon { readonly status: 'STORE_FAILED' | 'UNCERTAIN'; readonly reason: string; readonly entryId: string; readonly rowId: string; readonly declarationDigest: string; readonly recordAttempted: true; readonly consumed: true; readonly journal: Extract<RecordJournalObservationResult, {readonly status: 'STORE_FAILED'}> | null; }
export interface IncidentCaptureRefused extends IncidentCaptureCommon { readonly status: 'REFUSED'; readonly reason: string; readonly entryId: string | null; readonly rowId: string | null; readonly declarationDigest: string | null; readonly recordAttempted: false; readonly consumed: boolean; readonly journal: null; }
export interface IncidentAdmittedRefusal extends IncidentCaptureCommon { readonly status: 'REFUSED'; readonly reason: string; readonly entryId: string; readonly rowId: string; readonly declarationDigest: string; readonly recordAttempted: true; readonly consumed: true; readonly journal: Extract<RecordJournalObservationResult, {readonly status: 'REFUSED'}>; }
export type IncidentCaptureResult = IncidentStored | IncidentDuplicate | IncidentConflict | IncidentStoreFailure | IncidentCaptureRefused | IncidentAdmittedRefusal;
export interface IncidentCaptureInput { readonly permit: RepositoryIncidentPermit; }
export interface IncidentAccessV1 { createPermit(input: IncidentPermitInput): IncidentPermitResult; capture(input: IncidentCaptureInput): IncidentCaptureResult; revoke(input: IncidentCaptureInput): IncidentPermitResult; }
export function createRepositoryIncidentAccessV1(input: { readonly getPreview: () => RepositoryIncidentPreviewResult }): IncidentAccessV1;

export interface IncidentObservation {
  readonly schemaVersion: 'nisi-repository-incident-observation/v1'; readonly row: RepositoryIncidentRow; readonly previewSha256: string;
  readonly declarationDigest: string; readonly consentClass: 'WRITTEN_DECLARATION'; readonly consentAuthenticityAttested: false;
  readonly sourceAuthenticityAttested: false; readonly executionAttested: false; readonly nativeIncidentCaptured: false;
  readonly learningEligible: false; readonly authorizing: false;
}
interface IncidentQueryCommon { readonly schemaVersion: 'nisi-repository-incident-query/v1'; readonly entryId: string | null; readonly journalSha256: string | null; readonly sourceTrust: 'PERSISTED_UNAUTHENTICATED_OBSERVATION'; readonly learningEligible: false; readonly authorizing: false; }
export interface IncidentAvailableQuery extends IncidentQueryCommon { readonly status: 'AVAILABLE_OBSERVATION'; readonly reason: null; readonly entryId: string; readonly journalSha256: string; readonly observation: IncidentObservation; }
export interface IncidentUnavailableQuery extends IncidentQueryCommon { readonly status: 'REVOKED' | 'EXPIRED' | 'NOT_RETAINED' | 'MISSING'; readonly reason: null; readonly observation: null; }
export interface IncidentRefusedQuery extends IncidentQueryCommon { readonly status: 'REFUSED'; readonly reason: string; readonly observation: null; }
export type IncidentQueryResult = IncidentAvailableQuery | IncidentUnavailableQuery | IncidentRefusedQuery;
export interface IncidentQueryInput { readonly path: string; readonly fs: unknown; readonly config: unknown; readonly entryId: string; readonly now: number; }
export function queryRepositoryIncidentV1(input: IncidentQueryInput): IncidentQueryResult;
