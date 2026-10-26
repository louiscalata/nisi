// Compile-only public consumer regression. Never run this file as a program.
import type {
  LocalChatOptions, LocalChatReceipt, LocalChatReceiptBase,
  LocalChatOutputMode, LocalChatReasoningEffort,
  createLocalChatAuthorAdapter, createLocalChatReviewerAdapter,
} from 'nisi/adapters/local-chat';

const optionsBase = {
  endpoint: 'http://127.0.0.1:1234/v1/chat/completions',
  destination: 'LOOPBACK_HTTP', model: 'fixture', id: 'fixture',
} satisfies LocalChatOptions;
const none: LocalChatReasoningEffort = 'none';
const omitted: LocalChatOptions = optionsBase;
const defaultMode: LocalChatOptions = { ...optionsBase, reasoningEffort: none };
const schemaMode: LocalChatOptions = { ...defaultMode, outputMode: 'json_schema' };
const instructionMode: LocalChatOptions = { ...defaultMode, outputMode: 'json_instruction' };
type AuthorOptions = Parameters<typeof createLocalChatAuthorAdapter>[0];
type ReviewerOptions = Parameters<typeof createLocalChatReviewerAdapter>[0];
const authorOptions: AuthorOptions = schemaMode;
const reviewerOptions: ReviewerOptions = instructionMode;
declare const authorReceipts: ReturnType<ReturnType<typeof createLocalChatAuthorAdapter>['receipts']>;
declare const reviewerReceipts: ReturnType<ReturnType<typeof createLocalChatReviewerAdapter>['receipts']>;
const authorEvidence: readonly LocalChatReceipt[] = authorReceipts;
const reviewerEvidence: readonly LocalChatReceipt[] = reviewerReceipts;

declare const base: LocalChatReceiptBase;
const success = {
  status: 'RESPONSE_VALIDATED', reportedModel: 'fixture', candidateFingerprint: 'c',
  resultCandidateFingerprint: 'c', responseSha256: 'r', contentSha256: 'h',
  usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
} satisfies Extract<LocalChatReceipt, {schemaVersion: 1; status: 'RESPONSE_VALIDATED'}> extends infer R
  ? Omit<R, keyof LocalChatReceiptBase | 'schemaVersion' | 'outputMode' | 'reasoningEffort'> : never;
const unavailable = {
  status: 'UNAVAILABLE', code: 'FIXTURE', reportedModel: null,
  resultCandidateFingerprint: null, usage: null,
} satisfies Omit<Extract<LocalChatReceipt, {schemaVersion: 1; status: 'UNAVAILABLE'}>,
  keyof LocalChatReceiptBase | 'schemaVersion' | 'outputMode' | 'reasoningEffort'>;

const v1Success: LocalChatReceipt = { ...base, ...success, schemaVersion: 1 };
const v1Unavailable: LocalChatReceipt = { ...base, ...unavailable, schemaVersion: 1 };
const v2Success: LocalChatReceipt = { ...base, ...success, schemaVersion: 2, outputMode: 'json_schema' };
const v2Unavailable: LocalChatReceipt = { ...base, ...unavailable, schemaVersion: 2, outputMode: 'json_instruction' };
const v3Success: LocalChatReceipt = { ...base, ...success, schemaVersion: 3, outputMode: 'json_schema', reasoningEffort: 'none' };
const v3Unavailable: LocalChatReceipt = { ...base, ...unavailable, schemaVersion: 3, outputMode: 'json_instruction', reasoningEffort: 'none' };
const v3Instruction: LocalChatReceipt = { ...v3Success, outputMode: 'json_instruction', usage: null };
const v3SchemaUnavailable: LocalChatReceipt = { ...v3Unavailable, outputMode: 'json_schema' };

declare const receipt: LocalChatReceipt;
if (receipt.schemaVersion === 3) {
  const effort: 'none' = receipt.reasoningEffort;
  const mode: LocalChatOutputMode = receipt.outputMode;
  if (receipt.status === 'RESPONSE_VALIDATED') {
    const model: string = receipt.reportedModel;
    const fingerprint: string = receipt.resultCandidateFingerprint;
    const total: number | undefined = receipt.usage?.totalTokens;
    void [model, fingerprint, total];
  } else {
    const code: string = receipt.code;
    const model: null = receipt.reportedModel;
    const usage: null = receipt.usage;
    void [code, model, usage];
  }
  void [effort, mode];
}
if (receipt.schemaVersion === 1) {
  const mode: undefined = receipt.outputMode;
  const effort: undefined = receipt.reasoningEffort;
  void [mode, effort];
}
if (receipt.schemaVersion === 2) {
  const mode: LocalChatOutputMode = receipt.outputMode;
  const effort: undefined = receipt.reasoningEffort;
  void [mode, effort];
}

// @ts-expect-error high is not supported
const high: LocalChatOptions = { ...optionsBase, reasoningEffort: 'high' };
// @ts-expect-error empty effort is not supported
const empty: LocalChatOptions = { ...optionsBase, reasoningEffort: '' };
// @ts-expect-error null is not an omitted effort
const nullEffort: LocalChatOptions = { ...optionsBase, reasoningEffort: null };
// @ts-expect-error numeric effort is invalid
const numberEffort: LocalChatOptions = { ...optionsBase, reasoningEffort: 0 };
// @ts-expect-error strict optional properties require omission rather than undefined
const undefinedEffort: LocalChatOptions = { ...optionsBase, reasoningEffort: undefined };
// @ts-expect-error author factory must not widen the effort option
const badAuthor: AuthorOptions = { ...optionsBase, reasoningEffort: 'high' };
// @ts-expect-error reviewer factory must not widen the effort option
const badReviewer: ReviewerOptions = { ...optionsBase, reasoningEffort: 'high' };

// @ts-expect-error v3 must contain the effort property
const missingEffort: LocalChatReceipt = { ...base, ...success, schemaVersion: 3, outputMode: 'json_schema' };
// @ts-expect-error v3 must contain the output mode property
const missingMode: LocalChatReceipt = { ...base, ...unavailable, schemaVersion: 3, reasoningEffort: 'none' };
// @ts-expect-error v3 effort cannot be undefined
const undefinedReceiptEffort: LocalChatReceipt = { ...v3Success, reasoningEffort: undefined };
// @ts-expect-error v3 output mode cannot be undefined
const undefinedReceiptMode: LocalChatReceipt = { ...v3Success, outputMode: undefined };
// @ts-expect-error v3 effort must be the supported literal
const wrongEffort: LocalChatReceipt = { ...v3Success, reasoningEffort: 'high' };
// @ts-expect-error unknown output mode
const wrongMode: LocalChatReceipt = { ...v3Unavailable, outputMode: 'text' };
// @ts-expect-error unknown receipt version
const wrongVersion: LocalChatReceipt = { ...v3Success, schemaVersion: 4 };
// @ts-expect-error legacy v1 must not carry effort
const v1Effort: LocalChatReceipt = { ...v1Unavailable, reasoningEffort: 'none' };
// @ts-expect-error legacy v2 must not carry effort
const v2Effort: LocalChatReceipt = { ...v2Success, reasoningEffort: 'none' };
// @ts-expect-error legacy v1 must not carry output mode
const v1Mode: LocalChatReceipt = { ...v1Success, outputMode: 'json_schema' };
// @ts-expect-error v2 must have output mode
const v2MissingMode: LocalChatReceipt = { ...base, ...success, schemaVersion: 2 };
const { contentSha256: omittedContentHash, ...successWithoutHash } = success;
// @ts-expect-error validated receipt must contain contentSha256
const missingSuccessField: LocalChatReceipt = { ...base, ...successWithoutHash, schemaVersion: 3, outputMode: 'json_schema', reasoningEffort: 'none' };
// @ts-expect-error unavailable receipt must not claim numeric usage
const unavailableUsage: LocalChatReceipt = { ...v3Unavailable, usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 } };
// @ts-expect-error validated receipt requires a reported model string
const successNullModel: LocalChatReceipt = { ...v3Success, reportedModel: null };
// @ts-expect-error unavailable receipt has no reported model
const unavailableModel: LocalChatReceipt = { ...v3Unavailable, reportedModel: 'fixture' };
// @ts-expect-error receipt metadata is readonly
v3Success.reasoningEffort = 'none';
// @ts-expect-error author receipt collection is readonly
authorReceipts.push(v1Success);
// @ts-expect-error reviewer receipt collection is readonly
reviewerReceipts.push(v1Unavailable);

void [none, omitted, defaultMode, schemaMode, instructionMode, authorOptions,
  reviewerOptions, authorEvidence, reviewerEvidence, v1Success, v1Unavailable,
  v2Success, v2Unavailable, v3Success, v3Unavailable, v3Instruction, v3SchemaUnavailable,
  high, empty, nullEffort, numberEffort, undefinedEffort, badAuthor, badReviewer,
  missingEffort, missingMode, undefinedReceiptEffort, undefinedReceiptMode, wrongEffort,
  wrongMode, wrongVersion, v1Effort, v2Effort, v1Mode, v2MissingMode, omittedContentHash,
  missingSuccessField, unavailableUsage, successNullModel, unavailableModel];
export {};
