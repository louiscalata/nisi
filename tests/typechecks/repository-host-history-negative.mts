import type {
  RepositoryHistoryCaptureInput,
  RepositoryHistoryDeclaration,
  RepositoryHistoryPreview,
} from '../../history/repository-host-history-v1.mjs';
import type {JournalOwner} from '../../history/journal-owner-v2.mjs';

const owner = {} as JournalOwner;
const good = {
  schemaVersion: 'nisi-repository-history-declaration/v1', declarationId: 'history-a', projectId: 'project-a',
  sourceDigest: 'a'.repeat(64), issuedAt: 100, expiresAt: 1000, createdAt: 100, retentionMs: 1000,
  consentClass: 'WRITTEN_DECLARATION', destination: 'LOCAL_OBSERVATION_JOURNAL_ONLY',
  rawContentPersisted: false, networkEgress: false, learningInfluence: false,
} as const satisfies RepositoryHistoryDeclaration;
const input: RepositoryHistoryCaptureInput = {owner, declaration: good, clock: () => 100};
void input;

// @ts-expect-error ordinary objects cannot forge the branded owner
const forged: RepositoryHistoryCaptureInput = {...input, owner: {}};
// @ts-expect-error authorizing is fixed to the literal false
const mutableAuthority: RepositoryHistoryPreview = {...({} as RepositoryHistoryPreview), authorizing: true};
// @ts-expect-error candidate absence is nullable, not an arbitrary number
const badCandidate: RepositoryHistoryPreview = {...({} as RepositoryHistoryPreview), preview: {...({} as RepositoryHistoryPreview).preview, candidateFingerprint: 1}};
// @ts-expect-error declaration consent cannot authorize model learning
const learning: RepositoryHistoryDeclaration = {...good, learningInfluence: true};
// @ts-expect-error capture clock must be synchronous and numeric
const badClock: RepositoryHistoryCaptureInput = {...input, clock: async () => 100};
// @ts-expect-error declaration source digest is required
const missingDigest: RepositoryHistoryDeclaration = {...good, sourceDigest: undefined};
// @ts-expect-error capture input cannot carry an arbitrary settlement
const arbitrarySettlement: RepositoryHistoryCaptureInput = {...input, report: {}};
void forged; void mutableAuthority; void badCandidate; void learning; void badClock; void missingDigest; void arbitrarySettlement;
