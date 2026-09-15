/** PRIVATE declaration proposal. Types assist callers; runtime validation remains authoritative. */
export type Data = null | boolean | number | string | readonly Data[] | { readonly [key: string]: Data };
export type DeepReadonly<T> = T extends (...args: never[]) => unknown ? T : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export type MaybePromise<T> = T | PromiseLike<T>;
export type TaskMode = 'edit' | 'review';
export type AdapterStatus = 'PASS' | 'FAIL' | 'NOT_RUN' | 'UNAVAILABLE';
export type RepairStatus = 'REPAIRED' | 'NO_CHANGE' | 'FAIL' | 'NOT_RUN' | 'UNAVAILABLE';
export type RunOutcome = 'COMPLETED' | 'FAILED' | 'BLOCKED' | 'CANCELLED' | 'TIMED_OUT' | 'REPAIR_LIMIT' | 'NO_PROGRESS';
export interface CandidateFile { readonly path: string; readonly content: string }
export interface CandidateFiles { readonly files: readonly CandidateFile[] }
/** Raw normalization input. Pass { files: candidate.files } to reuse normalized files. */
export interface CandidateInput extends CandidateFiles { readonly schemaVersion?: never; readonly authorId?: never; readonly fingerprint?: never }
export interface Candidate extends CandidateFiles { readonly schemaVersion: 1; readonly authorId: string; readonly fingerprint: string }
export interface WorkflowPolicy { readonly repairBudget: number; readonly totalDeadlineMs: number; readonly requiredReviewers: number; readonly requireReportStore: boolean }
export interface TaskSpecification {
  readonly taskId: string; readonly mode: TaskMode; readonly language: string;
  readonly allowedFiles: readonly string[]; readonly protectedFiles: readonly string[];
  readonly protectedSnapshots: Readonly<Record<string, string>>;
  readonly acceptanceCriteria: readonly string[]; readonly policy: WorkflowPolicy;
}
export interface Binding { readonly schemaVersion: 1; readonly runId: string; readonly taskFingerprint: string; readonly attempt: number; readonly candidateFingerprint: string | null }
/** Checks, tests, repairs and reviews operate on an existing candidate. */
export interface CandidateBinding extends Binding { readonly candidateFingerprint: string }
export interface Finding { readonly code: string; readonly message: string }
export type AuthorizationEvidence = Binding & { readonly reason: string };
export type StaticEvidence = Binding & { readonly findings: readonly Finding[]; readonly reason: string };
export type TestEvidence = Binding & { readonly assertionsExecuted: number; readonly assertionsPassed: number; readonly failures: readonly Finding[]; readonly reason: string };
export type ReviewEvidence = Binding & { readonly reviewerId: string; readonly findings: readonly Finding[]; readonly summary: string; readonly reason: string };
export interface AdapterResult<E> { readonly status: AdapterStatus; readonly evidence: E }
export interface WorkflowPayload { readonly task: TaskSpecification; readonly candidate: Candidate | null; readonly acceptanceCriteria: readonly string[]; readonly binding: Binding; readonly signal: AbortSignal }
export interface CheckPayload extends WorkflowPayload { readonly candidate: Candidate; readonly binding: CandidateBinding }
export interface TestPayload extends CheckPayload { readonly checks: AdapterResult<StaticEvidence> }
export interface ReviewPayload extends TestPayload { readonly tests: AdapterResult<TestEvidence>; readonly reviewerId: string }
export interface RepairPayload extends CheckPayload { readonly stages: readonly StageRecord[] }
export interface DraftResult { readonly candidate: CandidateInput; readonly evidence: Binding & { readonly note: string } }
export type RepairEvidence = Binding & { readonly baseCandidateFingerprint: string; readonly note: string };
export type RepairResult = { readonly status: 'REPAIRED'; readonly candidate: CandidateInput; readonly evidence: RepairEvidence } | { readonly status: Exclude<RepairStatus, 'REPAIRED'>; readonly candidate: null; readonly evidence: RepairEvidence };
export interface AuthorAdapter { readonly id: string; draft(payload: WorkflowPayload): MaybePromise<DraftResult>; repair?(payload: RepairPayload): MaybePromise<RepairResult> }
export interface ReviewerAdapter { readonly id: string; review(payload: ReviewPayload): MaybePromise<AdapterResult<ReviewEvidence>> }
export interface WorkflowAdapters {
  readonly authorizeContext: { authorize(payload: WorkflowPayload): MaybePromise<AdapterResult<AuthorizationEvidence>> };
  readonly staticChecks: { check(payload: CheckPayload): MaybePromise<AdapterResult<StaticEvidence>> };
  readonly tests: { run(payload: TestPayload): MaybePromise<AdapterResult<TestEvidence>> };
  readonly reviewers: readonly ReviewerAdapter[]; readonly author?: AuthorAdapter;
}
export type StageName = 'intake' | 'authorizeContext' | 'draft' | 'staticChecks' | 'tests' | 'review' | 'repair' | 'completion';
export interface StageRecord {
  readonly stage: StageName; readonly status: AdapterStatus | RepairStatus; readonly candidateFingerprint: string | null; readonly code: string | null;
  readonly evidence: Binding & {
    readonly reason?: string; readonly taskId?: string; readonly mode?: TaskMode; readonly acceptanceCriteriaCount?: number;
    readonly note?: string; readonly baseCandidateFingerprint?: string; readonly findings?: readonly Finding[];
    readonly assertionsExecuted?: number; readonly assertionsPassed?: number; readonly failures?: readonly Finding[];
    readonly reviewerId?: string; readonly summary?: string;
  };
}
export interface StoreEvidence extends Binding { readonly outcome: RunOutcome; readonly reportSha256: string }
export interface RunReport {
  readonly schemaVersion: 1; readonly runId: string | null; readonly taskId: string | null; readonly taskFingerprint: string | null; readonly mode: TaskMode | null;
  readonly outcome: RunOutcome; readonly workflowOutcome: RunOutcome; readonly code: string | null;
  readonly candidate: Candidate | null; readonly candidateFingerprint: string | null; readonly repairAttempts: number;
  readonly stages: readonly StageRecord[]; readonly reportStored: boolean; readonly reportStoreCode: string | null;
  readonly storedReportSha256: string | null; readonly reportStoreEvidence: AdapterResult<StoreEvidence> | null;
}
export interface WorkflowOptions {
  readonly adapters: WorkflowAdapters; readonly candidate?: CandidateInput; readonly candidateAuthorId?: string;
  readonly signal?: AbortSignal; readonly clock?: () => number;
  readonly reportStore?: { store(payload: { readonly report: RunReport; readonly reportSha256: string; readonly binding: Binding; readonly signal: AbortSignal }): MaybePromise<AdapterResult<StoreEvidence>> };
}
/** Edit mode requires author; review mode requires candidate and candidateAuthorId. Numeric bounds, exact records and evidence identities are checked at runtime. */
export function runWorkflow(task: TaskSpecification, options: WorkflowOptions): Promise<RunReport>;
export function createTaskSpecification(value: TaskSpecification): TaskSpecification;
export function createCandidate(value: CandidateInput, options: { readonly authorId: string }): Candidate;
export function sha256Text(value: string): string;
export const RUN_OUTCOMES: readonly ['COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED', 'TIMED_OUT', 'REPAIR_LIMIT', 'NO_PROGRESS'];
