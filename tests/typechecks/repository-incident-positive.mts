import type {JournalOwner} from '../../history/journal-owner-v2.mjs';
import type {IncidentAccessV1, IncidentCaptureResult, IncidentDeclaration, IncidentQueryResult} from '../../history/repository-incident-capture-v1.mjs';
import type {RepositoryIncidentPreviewResult} from '../../history/repository-incident-candidates-v1.mjs';
import {createRepositoryIncidentAccessV1, queryRepositoryIncidentV1} from '../../history/repository-incident-capture-v1.mjs';
import type {RepositoryIncidentPreview} from '../../history/repository-incident-candidates-v1.mjs';

declare const owner: JournalOwner;
const declaration = {schemaVersion:'nisi-repository-incident-declaration/v1', declarationId:'incident-a', projectId:'task:'+'a'.repeat(64), rowId:'b'.repeat(64), rowFingerprint:'c'.repeat(64), previewSha256:'d'.repeat(64), issuedAt:100, expiresAt:1000, createdAt:100, retentionMs:1000, consentClass:'WRITTEN_DECLARATION', destination:'LOCAL_INCIDENT_OBSERVATION_ONLY', rawContentPersisted:false, networkEgress:false, learningInfluence:false} as const satisfies IncidentDeclaration;
declare const issuedPreview: RepositoryIncidentPreview;
const access: IncidentAccessV1 = createRepositoryIncidentAccessV1({getPreview: () => issuedPreview});
const created = access.createPermit({owner, declaration, clock: () => 100});
if (created.status === 'CREATED') {
  const captured: IncidentCaptureResult = access.capture({permit: created.permit});
  if (captured.status === 'REFUSED' && !captured.recordAttempted) { const nullable: null = captured.journal; void nullable; }
}
declare const admittedRefusal: Extract<IncidentCaptureResult, {readonly status: 'REFUSED'; readonly recordAttempted: true}>;
const admittedJournal: Extract<IncidentCaptureResult, {readonly status: 'REFUSED'; readonly recordAttempted: true}>['journal'] = admittedRefusal.journal;
void admittedJournal;
const query: IncidentQueryResult = queryRepositoryIncidentV1({path:'/tmp/journal', fs:{}, config:{}, entryId:'ric1.'+'e'.repeat(64), now:100});
if (query.status === 'AVAILABLE_OBSERVATION') {
  const rowId: string = query.observation.row.rowId; void rowId;
}
void query;
