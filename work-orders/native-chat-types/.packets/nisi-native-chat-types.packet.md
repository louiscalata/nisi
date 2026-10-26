---
packet: nisi-native-chat-types
project_root: /Users/louiscalata/nisi-next-private/work-orders/native-chat-types
created_by: claude
created: 2026-09-13T11:55:00-07:00
write_owner: opencode
status: done
---

# Nisi — TypeScript declarations for the native-chat adapter (v1)

## Context

Isolated private work-order workspace, NOT the Nisi runtime. Write one
TypeScript declaration file. Do not read or edit any parent directory.

`npm test` passes its three baseline checks against the placeholder (it pins the
frozen fixture `types/workflow.d.ts` by sha256 and requires the target to be a
module). `npm run test:types` runs the tree's TypeScript 6 compiler in strict
mode (`--strict --exactOptionalPropertyTypes --noUncheckedIndexedAccess --module
NodeNext --target ES2022 --types node`) over `tests/consumer/native-chat.mts`
and fails against the placeholder; that failure is expected unfinished work, not
permission to edit the consumer test or the fixture. The consumer test is the
contract: read it in full before writing. Every `@ts-expect-error` line in it
must be a real type error and every other line must compile.

The only implementation target is `types/native-chat.d.ts`. It declares the
public surface of the runtime module `adapters/native-chat-v1.mjs` (described
below), importing shared types from the frozen `./workflow.js`:

```ts
import type { AuthorAdapter, ReviewerAdapter, DraftResult, RepairResult, WorkflowPayload, RepairPayload,
  ReviewPayload, AdapterResult, ReviewEvidence, MaybePromise } from './workflow.js';
```

(`AuthorAdapter` is `{ readonly id: string; draft(payload: WorkflowPayload):
MaybePromise<DraftResult>; repair?(payload: RepairPayload): MaybePromise<RepairResult> }`
and `ReviewerAdapter` is `{ readonly id: string; review(payload: ReviewPayload):
MaybePromise<AdapterResult<ReviewEvidence>> }`.)

Declare exactly these exports, all `readonly` properties, in this order:

1. `export type NativeChatOwnerState = 'STOPPED_DRAINING' | 'STOPPED' | 'QUARANTINED' | 'BUSY' | 'DRAINING' | 'IDLE';`
2. `export interface NativeChatLifecycle { schemaVersion: 'nisi-native-chat-owner-v1'; state: NativeChatOwnerState; pendingTransports: number; recoveryRequired: boolean; remoteInferenceStopped: 'NOT_OBSERVED'; scope: 'THIS_OWNER_ONLY' }`
3. A branded owner: `declare const ownerBrand: unique symbol;` then
   `export interface NativeChatTransportOwner { readonly [ownerBrand]: true; status(): NativeChatLifecycle; stop(): void }`
   and `export function createNativeChatTransportOwnerV1(): NativeChatTransportOwner;`
4. `export interface NativeChatRequest { method: 'POST'; redirect: 'error'; signal: AbortSignal; headers: { 'content-type': 'application/json'; accept: 'application/json' }; body: string }`
   and `export type NativeChatFetch = (endpoint: string, request: NativeChatRequest) => MaybePromise<Response>;`
5. `export interface NativeChatOptions { destination: 'LOOPBACK_HTTP'; endpoint: string; model: string; expectedModelInstance: string; id: string; reasoning: 'off'; maxRequestBytes?: number; maxResponseBytes?: number; maxOutputTokens?: number; timeoutMs?: number; fetch?: NativeChatFetch; transportOwner?: NativeChatTransportOwner }`
   (the five required fields are `destination`, `endpoint`, `model`, `expectedModelInstance`, `id`, plus `reasoning`; the rest optional).
6. `export interface NativeChatUsage { promptTokens: number; completionTokens: number; totalTokens: number }`
   `export interface NativeChatUsageSource { promptTokens: 'REPORTED_INPUT_TOKENS'; completionTokens: 'REPORTED_TOTAL_OUTPUT_TOKENS'; totalTokens: 'DERIVED_SUM_OF_REPORTED_COUNTERS' }`
   `export interface NativeChatReportedStats { input_tokens: number; total_output_tokens: number; reasoning_output_tokens: 0; tokens_per_second: number; time_to_first_token_seconds: number; model_load_time_seconds?: number }`
7. `export interface NativeChatReceiptBase { schemaVersion: 'nisi-native-chat-receipt-v1'; profile: 'nisi-native-chat-content-v1'; operation: 'draft' | 'repair' | 'review'; adapterId: string; requestedModel: string; expectedModelInstance: string; reasoning: 'off'; storeRequested: false; integrationsRequested: readonly []; runId: string | null; taskFingerprint: string | null; attempt: number | null; inputCandidateFingerprint: string | null; requestedMaxOutputTokens: number; requestSha256: string | null; elapsedMs: number; termination: 'NOT_REPORTED'; serverCompletionAttested: false; modelAuthenticityAttested: false; lifecycle: { transportSettlement: 'NOT_STARTED' | 'CONFIRMED' | 'UNKNOWN'; remoteInferenceStopped: 'NOT_OBSERVED'; ownerState: NativeChatOwnerState } }`
8. `export type NativeChatReceipt = NativeChatReceiptBase & (
     { status: 'RESPONSE_VALIDATED'; resultCandidateFingerprint: string | null; reportedModelInstance: string; responseSha256: string; contentSha256: string; usage: NativeChatUsage; usageSource: NativeChatUsageSource; reportedStats: NativeChatReportedStats; truncationCheck: 'BELOW_REPORTED_OUTPUT_CAP' }
   | { status: 'UNAVAILABLE'; code: string; resultCandidateFingerprint: null; reportedModelInstance: null; usage: null } );`
   The two branches must be a discriminated union on `status`; the `UNAVAILABLE` branch must not declare `code` as optional and must not declare `usage` as anything but `null`; the `RESPONSE_VALIDATED` branch must not declare `code` at all.
9. `export interface NativeChatControl { id: string; receipts(): readonly NativeChatReceipt[]; lifecycle(): NativeChatLifecycle; stop(): void }`
10. `export interface NativeChatAuthorAdapter extends AuthorAdapter, NativeChatControl { draft(payload: WorkflowPayload): Promise<DraftResult>; repair(payload: RepairPayload): Promise<RepairResult> }`
    `export interface NativeChatReviewerAdapter extends ReviewerAdapter, NativeChatControl { review(payload: ReviewPayload): Promise<AdapterResult<ReviewEvidence>> }`
    (an author adapter has no `review`; a reviewer adapter has no `draft`/`repair`).
11. `export function createNativeChatAuthorAdapterV1(options: NativeChatOptions): NativeChatAuthorAdapter;`
    `export function createNativeChatReviewerAdapterV1(options: NativeChatOptions): NativeChatReviewerAdapter;`

Mark every property `readonly` (interfaces and the inline object types). Use
`.js` import specifiers, no `export default`, no runtime code, no `any`.

## Constraints

- Write ONLY `types/native-chat.d.ts`. Everything else is read-only:
  `package.json`, `roadmap.md`, `tests/`, the frozen `types/workflow.d.ts`, `.packets/`.
  No parent-tree exploration.
- The executor owns only this draft. Claude authored the contract; Astra (Codex)
  owns review and integration; packet completion is not product completion.
- No dependencies, installs, network or model calls, and no changes to the
  actual Nisi runtime or its `types/` directory.
- Keep all work private. No commits, pushes, packages, public README/demo or
  disclosures. Nothing in this packet grants publication permission.
- Do not run commands, tests or nested packets yourself. The installed wrapper
  runs the inspected acceptance checks and writes the execution receipt.
- Do not alter tests, fixtures, acceptance commands, order or receipt to obtain
  DONE. If required context is missing, leave a concrete blocker, not an
  invented result.

## Items

### P1 — Write the native-chat declarations
- **files**: types/native-chat.d.ts
- **do**: Replace the placeholder with the complete declaration module specified above (the eleven numbered exports, all properties readonly, shared types imported from ./workflow.js) so that tests/consumer/native-chat.mts compiles in strict mode with every @ts-expect-error line remaining a genuine error.
- **accept**: npm run test:types

## Packet acceptance
npm test
