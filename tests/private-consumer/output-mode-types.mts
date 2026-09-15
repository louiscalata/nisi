import { createLocalChatAuthorAdapter } from 'nisi/adapters/local-chat';
import type { LocalChatOptions, LocalChatReceipt } from 'nisi/adapters/local-chat';

const schemaOptions: LocalChatOptions = { endpoint: 'http://127.0.0.1:1234/v1/chat/completions', destination: 'LOOPBACK_HTTP', model: 'm', id: 'a', outputMode: 'json_schema' };
const instructionOptions: LocalChatOptions = { ...schemaOptions, outputMode: 'json_instruction' };
const schemaReceipt: LocalChatReceipt = { schemaVersion: 2, outputMode: 'json_schema', operation: 'review', adapterId: 'a', requestedModel: 'm', runId: null, taskFingerprint: null, attempt: null, inputCandidateFingerprint: null, requestedMaxOutputTokens: 1, requestSha256: null, elapsedMs: 0, lifecycle: { transportSettlement: 'NOT_STARTED', remoteInferenceStopped: 'NOT_OBSERVED', ownerState: 'IDLE' }, status: 'UNAVAILABLE', code: 'X', reportedModel: null, resultCandidateFingerprint: null, usage: null };
const instructionReceipt: LocalChatReceipt = { ...schemaReceipt, outputMode: 'json_instruction' };
function narrow(receipt: LocalChatReceipt): string | undefined {
  if (receipt.schemaVersion === 2) return receipt.outputMode;
  return undefined;
}
void [createLocalChatAuthorAdapter, schemaOptions, instructionOptions, narrow(schemaReceipt), narrow(instructionReceipt)];

// @ts-expect-error unknown output mode is not supported
const badMode: LocalChatOptions = { ...schemaOptions, outputMode: 'xml' };
// @ts-expect-error v2 receipts require outputMode
const missingMode: LocalChatReceipt = { ...schemaReceipt, outputMode: undefined };
// @ts-expect-error v1 receipts must omit outputMode
const v1WithMode: LocalChatReceipt = { ...schemaReceipt, schemaVersion: 1 };
void [badMode, missingMode, v1WithMode];
