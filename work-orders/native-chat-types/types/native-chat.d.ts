import type { AuthorAdapter, ReviewerAdapter, DraftResult, RepairResult, WorkflowPayload, RepairPayload,
  ReviewPayload, AdapterResult, ReviewEvidence, MaybePromise } from './workflow.js';

export type NativeChatOwnerState = 'STOPPED_DRAINING' | 'STOPPED' | 'QUARANTINED' | 'BUSY' | 'DRAINING' | 'IDLE';

export interface NativeChatLifecycle {
  readonly schemaVersion: 'nisi-native-chat-owner-v1';
  readonly state: NativeChatOwnerState;
  readonly pendingTransports: number;
  readonly recoveryRequired: boolean;
  readonly remoteInferenceStopped: 'NOT_OBSERVED';
  readonly scope: 'THIS_OWNER_ONLY';
}

// Type-only brand models the runtime WeakMap identity check; no symbol is exposed at runtime.
declare const ownerBrand: unique symbol;

export interface NativeChatTransportOwner {
  readonly [ownerBrand]: true;
  readonly status: () => NativeChatLifecycle;
  readonly stop: () => void;
}

export function createNativeChatTransportOwnerV1(): NativeChatTransportOwner;

export interface NativeChatRequest {
  readonly method: 'POST';
  readonly redirect: 'error';
  readonly signal: AbortSignal;
  readonly headers: { readonly 'content-type': 'application/json'; readonly 'accept': 'application/json' };
  readonly body: string;
}

export type NativeChatFetch = (endpoint: string, request: NativeChatRequest) => MaybePromise<Response>;

export interface NativeChatOptions {
  readonly destination: 'LOOPBACK_HTTP';
  readonly endpoint: string;
  readonly model: string;
  readonly expectedModelInstance: string;
  readonly id: string;
  readonly reasoning: 'off';
  readonly maxRequestBytes?: number | undefined;
  readonly maxResponseBytes?: number | undefined;
  readonly maxOutputTokens?: number | undefined;
  readonly timeoutMs?: number | undefined;
  readonly fetch?: NativeChatFetch | undefined;
  readonly transportOwner?: NativeChatTransportOwner | undefined;
}

export interface NativeChatUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface NativeChatUsageSource {
  readonly promptTokens: 'REPORTED_INPUT_TOKENS';
  readonly completionTokens: 'REPORTED_TOTAL_OUTPUT_TOKENS';
  readonly totalTokens: 'DERIVED_SUM_OF_REPORTED_COUNTERS';
}

export interface NativeChatReportedStats {
  readonly input_tokens: number;
  readonly total_output_tokens: number;
  readonly reasoning_output_tokens: 0;
  readonly tokens_per_second: number;
  readonly time_to_first_token_seconds: number;
  readonly model_load_time_seconds?: number;
}

export interface NativeChatReceiptBase {
  readonly schemaVersion: 'nisi-native-chat-receipt-v1';
  readonly profile: 'nisi-native-chat-content-v1';
  readonly operation: 'draft' | 'repair' | 'review';
  readonly adapterId: string;
  readonly requestedModel: string;
  readonly expectedModelInstance: string;
  readonly reasoning: 'off';
  readonly storeRequested: false;
  readonly integrationsRequested: readonly [];
  readonly runId: string | null;
  readonly taskFingerprint: string | null;
  readonly attempt: number | null;
  readonly inputCandidateFingerprint: string | null;
  readonly requestedMaxOutputTokens: number;
  readonly requestSha256: string | null;
  readonly elapsedMs: number;
  readonly termination: 'NOT_REPORTED';
  readonly serverCompletionAttested: false;
  readonly modelAuthenticityAttested: false;
  readonly lifecycle: {
    readonly transportSettlement: 'NOT_STARTED' | 'CONFIRMED' | 'UNKNOWN';
    readonly remoteInferenceStopped: 'NOT_OBSERVED';
    readonly ownerState: NativeChatOwnerState;
  };
}

export type NativeChatReceipt = NativeChatReceiptBase & (
  | { readonly status: 'RESPONSE_VALIDATED'; readonly resultCandidateFingerprint: string; readonly reportedModelInstance: string; readonly responseSha256: string; readonly contentSha256: string; readonly usage: NativeChatUsage; readonly usageSource: NativeChatUsageSource; readonly reportedStats: NativeChatReportedStats; readonly truncationCheck: 'BELOW_REPORTED_OUTPUT_CAP' }
  | { readonly status: 'UNAVAILABLE'; readonly code: string; readonly resultCandidateFingerprint: null; readonly reportedModelInstance: null; readonly usage: null }
);

export interface NativeChatControl {
  readonly id: string;
  readonly receipts: () => readonly NativeChatReceipt[];
  readonly lifecycle: () => NativeChatLifecycle;
  readonly stop: () => void;
}

export interface NativeChatAuthorAdapter extends AuthorAdapter, NativeChatControl {
  readonly draft: (payload: WorkflowPayload) => Promise<DraftResult>;
  readonly repair: (payload: RepairPayload) => Promise<RepairResult & { readonly status: 'REPAIRED' | 'NO_CHANGE' }>;
}

export interface NativeChatReviewerAdapter extends ReviewerAdapter, NativeChatControl {
  readonly review: (payload: ReviewPayload) => Promise<AdapterResult<ReviewEvidence> & { readonly status: 'PASS' | 'FAIL' }>;
}

export function createNativeChatAuthorAdapterV1(options: NativeChatOptions): NativeChatAuthorAdapter;

export function createNativeChatReviewerAdapterV1(options: NativeChatOptions): NativeChatReviewerAdapter;
