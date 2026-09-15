import type { AuthorAdapter, ReviewerAdapter, DraftResult, RepairResult, WorkflowPayload, RepairPayload, ReviewPayload, AdapterResult, ReviewEvidence, Data, MaybePromise } from './workflow.js';
export type TransportState = 'STOPPED_DRAINING' | 'STOPPED' | 'QUARANTINED' | 'BUSY' | 'DRAINING' | 'IDLE';
export interface LocalChatLifecycle { readonly schemaVersion: 1; readonly state: TransportState; readonly pendingTransports: number; readonly recoveryRequired: boolean; readonly remoteInferenceStopped: 'NOT_OBSERVED'; readonly scope: 'THIS_OWNER_ONLY' }
declare const ownerBrand: unique symbol;
export interface LocalChatTransportOwner { readonly [ownerBrand]: true; status(): LocalChatLifecycle; stop(): void }
export function createLocalChatTransportOwner(): LocalChatTransportOwner;
export interface LocalChatRequest {
  readonly method: 'POST'; readonly redirect: 'error'; readonly signal: AbortSignal;
  readonly headers: { readonly 'content-type': 'application/json'; readonly accept: 'application/json' };
  readonly body: string;
}
/** The injected transport may return a Response synchronously or asynchronously. */
export type LocalChatFetch = (endpoint: string, request: LocalChatRequest) => MaybePromise<Response>;
export type LocalChatOutputMode = 'json_schema' | 'json_instruction';
export interface LocalChatOptions {
  readonly endpoint: string; readonly destination: 'LOOPBACK_HTTP'; readonly model: string; readonly id: string;
  readonly maxResponseBytes?: number; readonly maxRequestBytes?: number; readonly maxOutputTokens?: number; readonly timeoutMs?: number;
  readonly fetch?: LocalChatFetch; readonly transportOwner?: LocalChatTransportOwner; readonly outputMode?: LocalChatOutputMode;
}
export interface LocalChatReceiptBase {
  readonly operation: 'draft' | 'repair' | 'review'; readonly adapterId: string; readonly requestedModel: string;
  readonly runId: string | null; readonly taskFingerprint: string | null; readonly attempt: number | null; readonly inputCandidateFingerprint: string | null;
  readonly requestedMaxOutputTokens: number; readonly requestSha256: string | null; readonly elapsedMs: number;
  readonly lifecycle: { readonly transportSettlement: 'NOT_STARTED' | 'CONFIRMED' | 'UNKNOWN'; readonly remoteInferenceStopped: 'NOT_OBSERVED'; readonly ownerState: TransportState };
}
export type LocalChatReceipt = (
  LocalChatReceiptBase & { readonly schemaVersion: 1; readonly outputMode?: never } & (
    { readonly status: 'RESPONSE_VALIDATED'; readonly reportedModel: string; readonly candidateFingerprint: string; readonly resultCandidateFingerprint: string; readonly responseSha256: string; readonly contentSha256: string; readonly usage: { readonly promptTokens: number; readonly completionTokens: number; readonly totalTokens: number } | null }
    | { readonly status: 'UNAVAILABLE'; readonly code: string; readonly reportedModel: null; readonly resultCandidateFingerprint: null; readonly usage: null }
  )
) | (
  LocalChatReceiptBase & { readonly schemaVersion: 2; readonly outputMode: LocalChatOutputMode } & (
    { readonly status: 'RESPONSE_VALIDATED'; readonly reportedModel: string; readonly candidateFingerprint: string; readonly resultCandidateFingerprint: string; readonly responseSha256: string; readonly contentSha256: string; readonly usage: { readonly promptTokens: number; readonly completionTokens: number; readonly totalTokens: number } | null }
    | { readonly status: 'UNAVAILABLE'; readonly code: string; readonly reportedModel: null; readonly resultCandidateFingerprint: null; readonly usage: null }
  )
);
export interface LocalChatControl { receipts(): readonly LocalChatReceipt[]; lifecycle(): LocalChatLifecycle; stop(): void }
export interface LocalChatAuthorAdapter extends AuthorAdapter, LocalChatControl { draft(payload: WorkflowPayload): Promise<DraftResult>; repair(payload: RepairPayload): Promise<RepairResult> }
export interface LocalChatReviewerAdapter extends ReviewerAdapter, LocalChatControl { review(payload: ReviewPayload): Promise<AdapterResult<ReviewEvidence>> }
export function createLocalChatAuthorAdapter(options: LocalChatOptions): LocalChatAuthorAdapter;
export function createLocalChatReviewerAdapter(options: LocalChatOptions): LocalChatReviewerAdapter;
/** Parsed JSON data; this standalone parser does not freeze its result. */
export function strictJSON(source: string): Data;
