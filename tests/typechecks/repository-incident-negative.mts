import type {JournalOwner} from '../../history/journal-owner-v2.mjs';
import type {IncidentCaptureInput, IncidentCaptureResult, IncidentDeclaration, IncidentPermitCreated, IncidentObservation, IncidentQueryResult} from '../../history/repository-incident-capture-v1.mjs';
import type {RepositoryIncidentPreview} from '../../history/repository-incident-candidates-v1.mjs';
const owner = {} as JournalOwner;
const declaration = {schemaVersion:'nisi-repository-incident-declaration/v1', declarationId:'incident-a', projectId:'task:'+'a'.repeat(64), rowId:'b'.repeat(64), rowFingerprint:'c'.repeat(64), previewSha256:'d'.repeat(64), issuedAt:100, expiresAt:1000, createdAt:100, retentionMs:1000, consentClass:'WRITTEN_DECLARATION', destination:'LOCAL_INCIDENT_OBSERVATION_ONLY', rawContentPersisted:false, networkEgress:false, learningInfluence:false} as const satisfies IncidentDeclaration;
const good = {owner, declaration, clock: () => 100};
// @ts-expect-error opaque permit handles cannot be forged
const forgedInput: IncidentCaptureInput = {permit: {}};
// @ts-expect-error raw content persistence is fixed false
const raw: IncidentDeclaration = {...declaration, rawContentPersisted: true};
// @ts-expect-error destination cannot be changed to the general journal
const destination: IncidentDeclaration = {...declaration, destination: 'LOCAL_OBSERVATION_JOURNAL_ONLY'};
// @ts-expect-error learning eligibility is fixed false
const preview: RepositoryIncidentPreview = {...({} as RepositoryIncidentPreview), learningEligible: true};
// @ts-expect-error a CREATED permit requires an opaque permit, not null
const created: IncidentPermitCreated = {...({} as IncidentPermitCreated), permit: null};
// @ts-expect-error query observation is nullable and must be narrowed
const observation: IncidentObservation = ({} as IncidentQueryResult).observation;
// @ts-expect-error pre-admission refusal does not expose an admitted journal record
const admitted: Extract<IncidentCaptureResult, {readonly status: 'REFUSED'; readonly recordAttempted: true}> = {} as IncidentCaptureResult;
// @ts-expect-error non-available query statuses have no observation to dereference
const unavailableRowId: string = ({} as IncidentQueryResult & {readonly status: 'MISSING'}).observation.row.rowId;
// @ts-expect-error a query result is not an observation without status narrowing
const result: RepositoryIncidentPreview = {} as IncidentQueryResult;
void owner; void good; void forgedInput; void raw; void destination; void preview; void created; void observation; void result;
