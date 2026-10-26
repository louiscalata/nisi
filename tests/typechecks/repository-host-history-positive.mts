import type {
  RepositoryHistoryCaptureInput,
  RepositoryHistoryCaptureResult,
  RepositoryHistoryPreviewResult,
  RepositoryHistoryAccessV1,
  ReviewedRepositoryHostHistoryV1,
} from '../../history/repository-host-history-v1.mjs';
import {createRepositoryHistoryAccessV1} from '../../history/repository-host-history-v1.mjs';
import type {JournalOwner} from '../../history/journal-owner-v2.mjs';

const owner = {} as JournalOwner;
const declaration = {
  schemaVersion: 'nisi-repository-history-declaration/v1', declarationId: 'history-a', projectId: 'project-a',
  sourceDigest: 'a'.repeat(64), issuedAt: 100, expiresAt: 1000, createdAt: 100, retentionMs: 1000,
  consentClass: 'WRITTEN_DECLARATION', destination: 'LOCAL_OBSERVATION_JOURNAL_ONLY',
  rawContentPersisted: false, networkEgress: false, learningInfluence: false,
} as const;
const input: RepositoryHistoryCaptureInput = {owner, declaration, clock: () => 100};
const access: RepositoryHistoryAccessV1 = createRepositoryHistoryAccessV1({
  taskFingerprint: 'b'.repeat(64), baselineFingerprint: 'c'.repeat(64),
});
const host: ReviewedRepositoryHostHistoryV1 = {
  historyPreview: access.preview,
  captureHistory: access.capture,
};
const before: RepositoryHistoryPreviewResult = host.historyPreview();
const after: RepositoryHistoryCaptureResult = host.captureHistory(input);
access.publish({schemaVersion: 'nisi-reviewed-repository-host-v1', report: {}, state: 'SETTLED',
  applied: false, sandboxed: false, authorizing: false, certificationGranted: false});
const preview = access.preview();
if (preview.status === 'PREVIEW') {
  const candidate: string | null = preview.preview.candidateFingerprint;
  const attested: false = preview.preview.executionAttested;
  void candidate; void attested;
  if (preview.preview.candidatePresent) {
    const actual:string = preview.preview.candidateFingerprint; void actual;
  } else {
    const absent:null = preview.preview.candidateFingerprint; void absent;
  }
}
if (after.status === 'REFUSED' && !after.recordAttempted) {
  const noJournal: null = after.journal;
  const priorConsumed:boolean = after.consumed; void noJournal; void priorConsumed;
}
if (after.status === 'REFUSED' && after.recordAttempted) {
  const actualJournal: {readonly status:'REFUSED'} = after.journal; void actualJournal;
}
void before; void preview; void after;
