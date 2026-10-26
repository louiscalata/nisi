// Compile-only consumer oracle for types/native-chat.d.ts (tsc --noEmit, strict).
// Payloads are declared, never constructed: this checks the declared surface, not runtime behavior.
import { createNativeChatAuthorAdapterV1, createNativeChatReviewerAdapterV1, createNativeChatTransportOwnerV1 } from '../../types/native-chat.js';
import type { NativeChatOptions, NativeChatReceipt, NativeChatLifecycle, NativeChatOwnerState, NativeChatFetch, NativeChatRequest,
  NativeChatAuthorAdapter, NativeChatReviewerAdapter, NativeChatTransportOwner, NativeChatUsage } from '../../types/native-chat.js';
import type { WorkflowPayload, RepairPayload, ReviewPayload, DraftResult, RepairResult, AdapterResult, ReviewEvidence,
  AuthorAdapter, ReviewerAdapter } from '../../types/workflow.js';

declare const draftPayload: WorkflowPayload;
declare const repairPayload: RepairPayload;
declare const reviewPayload: ReviewPayload;

const fetchImpl: NativeChatFetch = (endpoint: string, request: NativeChatRequest): Response => {
  const method: 'POST' = request.method;
  const redirect: 'error' = request.redirect;
  const accept: 'application/json' = request.headers.accept;
  void [endpoint, method, redirect, accept, request.body.length, request.signal.aborted];
  return new Response('{}');
};

const owner: NativeChatTransportOwner = createNativeChatTransportOwnerV1();
const lifecycle: NativeChatLifecycle = owner.status();
const state: NativeChatOwnerState = lifecycle.state;
const schema: 'nisi-native-chat-owner-v1' = lifecycle.schemaVersion;
const scope: 'THIS_OWNER_ONLY' = lifecycle.scope;
const pending: number = lifecycle.pendingTransports;
const recovery: boolean = lifecycle.recoveryRequired;

const options: NativeChatOptions = {
  destination: 'LOOPBACK_HTTP', endpoint: 'http://127.0.0.1:1234/api/v1/chat', model: 'm', expectedModelInstance: 'm-1',
  id: 'author.one', reasoning: 'off', timeoutMs: 1000, maxOutputTokens: 512, maxRequestBytes: 4096, maxResponseBytes: 4096,
  fetch: fetchImpl, transportOwner: owner
};
const minimal: NativeChatOptions = { destination: 'LOOPBACK_HTTP', endpoint: 'http://127.0.0.1:1234/api/v1/chat', model: 'm',
  expectedModelInstance: 'm-1', id: 'a', reasoning: 'off' };

const author: NativeChatAuthorAdapter = createNativeChatAuthorAdapterV1(options);
const reviewer: NativeChatReviewerAdapter = createNativeChatReviewerAdapterV1({ ...minimal, id: 'reviewer.one' });
const asAuthor: AuthorAdapter = author;
const asReviewer: ReviewerAdapter = reviewer;
const drafted: Promise<DraftResult> = author.draft(draftPayload);
const repaired: Promise<RepairResult> = author.repair(repairPayload);
const reviewed: Promise<AdapterResult<ReviewEvidence>> = reviewer.review(reviewPayload);
const receipts: readonly NativeChatReceipt[] = author.receipts();
const id: string = author.id;
const afterStop: NativeChatLifecycle = (author.stop(), reviewer.lifecycle());

function narrow(receipt: NativeChatReceipt): string | null {
  const version: 'nisi-native-chat-receipt-v1' = receipt.schemaVersion;
  const profile: 'nisi-native-chat-content-v1' = receipt.profile;
  const reasoning: 'off' = receipt.reasoning;
  const settlement: 'NOT_STARTED' | 'CONFIRMED' | 'UNKNOWN' = receipt.lifecycle.transportSettlement;
  const attested: false = receipt.modelAuthenticityAttested;
  void [version, profile, reasoning, settlement, attested, receipt.elapsedMs.toFixed(0), receipt.runId, receipt.attempt];
  if (receipt.status === 'RESPONSE_VALIDATED') {
    const instance: string = receipt.reportedModelInstance;
    const usage: NativeChatUsage = receipt.usage;
    const total: number = usage.totalTokens;
    const cap: 'BELOW_REPORTED_OUTPUT_CAP' = receipt.truncationCheck;
    const fingerprint: string | null = receipt.resultCandidateFingerprint;
    void [total, cap, fingerprint, receipt.responseSha256.length, receipt.reportedStats.input_tokens];
    return instance;
  }
  const code: string = receipt.code;
  const nothing: null = receipt.usage;
  const noInstance: null = receipt.reportedModelInstance;
  void [nothing, noInstance];
  return code;
}

void [state, schema, scope, pending, recovery, asAuthor, asReviewer, drafted, repaired, reviewed, receipts, id, afterStop, narrow];

// @ts-expect-error reasoning must be exactly 'off'
const badReasoning: NativeChatOptions = { ...options, reasoning: 'on' };
// @ts-expect-error destination must be LOOPBACK_HTTP
const badDestination: NativeChatOptions = { ...options, destination: 'REMOTE_HTTP' };
// @ts-expect-error expectedModelInstance is required
const missingInstance: NativeChatOptions = { destination: 'LOOPBACK_HTTP', endpoint: 'http://127.0.0.1:1234/api/v1/chat', model: 'm', id: 'a', reasoning: 'off' };
// @ts-expect-error a reviewer adapter has no draft
reviewer.draft(draftPayload);
// @ts-expect-error an author adapter has no review
author.review(reviewPayload);
// @ts-expect-error receipts are readonly
author.receipts().push(receipts[0]!);
// @ts-expect-error the transport owner is branded; a structural look-alike is refused
const fakeOwner: NativeChatOptions = { ...options, transportOwner: { status: owner.status, stop: owner.stop } };
// @ts-expect-error a validated receipt never carries an error code
function noCode(receipt: NativeChatReceipt): string { return receipt.status === 'RESPONSE_VALIDATED' ? receipt.code : ''; }
// @ts-expect-error an unavailable receipt has no usage counters
function noUsage(receipt: NativeChatReceipt): number { return receipt.status === 'UNAVAILABLE' ? receipt.usage.totalTokens : 0; }
// @ts-expect-error lifecycle state is a closed union
const badState: NativeChatOwnerState = 'RUNNING';
void [badReasoning, badDestination, missingInstance, fakeOwner, noCode, noUsage, badState];
