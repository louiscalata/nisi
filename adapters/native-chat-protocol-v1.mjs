// Private Nisi native-chat profile. Local reported metadata is not attestation.
import { cloneFreeze, sha256Text } from '../workflow/contracts.mjs';
import { strictJSON } from './local-chat.mjs';

export const NATIVE_CHAT_PROFILE_V1 = 'nisi-native-chat-content-v1';
const fail = code => { throw Object.assign(new Error(code), { code }); };
export function nativeExact(value, required, optional = [], code = 'NATIVE_CHAT_ENVELOPE_INVALID') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  const keys = Reflect.ownKeys(value);
  if (required.some(k => !Object.hasOwn(value, k)) || keys.some(k => !required.includes(k) && !optional.includes(k))) fail(code);
}
export function nativeJSON(text, outer = false) {
  // The existing content parser permits one complete fence. HTTP envelopes do not.
  if (outer && (typeof text !== 'string' || !/^[ \r\n\t]*\{/u.test(text))) fail('NATIVE_CHAT_ENVELOPE_INVALID');
  try { return strictJSON(text); }
  catch (error) { fail(error.code?.startsWith('LOCAL_CHAT_') ? error.code.replace('LOCAL_CHAT_', 'NATIVE_CHAT_') : 'NATIVE_CHAT_JSON_INVALID'); }
}

export function readNativeChatEnvelopeV1(raw, options) {
  const selection = cloneFreeze(options);
  nativeExact(selection, ['expectedModelInstance', 'maxOutputTokens'], [], 'NATIVE_CHAT_SELECTION_INVALID');
  if (typeof selection.expectedModelInstance !== 'string' || !selection.expectedModelInstance.trim() ||
      selection.expectedModelInstance.length > 256 || !Number.isSafeInteger(selection.maxOutputTokens) ||
      selection.maxOutputTokens < 1 || selection.maxOutputTokens > 32768) fail('NATIVE_CHAT_SELECTION_INVALID');
  const envelope = nativeJSON(raw, true);
  nativeExact(envelope, ['model_instance_id', 'output', 'stats']);
  if (envelope.model_instance_id !== selection.expectedModelInstance) fail('NATIVE_CHAT_MODEL_INSTANCE_MISMATCH');
  if (!Array.isArray(envelope.output) || envelope.output.length !== 1) fail('NATIVE_CHAT_OUTPUT_INVALID');
  const item = envelope.output[0];
  nativeExact(item, ['type', 'content'], [], 'NATIVE_CHAT_OUTPUT_INVALID');
  if (item.type !== 'message') fail('NATIVE_CHAT_OUTPUT_KIND_REFUSED');
  if (typeof item.content !== 'string' || item.content.trim() === '') fail('NATIVE_CHAT_EMPTY_RESPONSE');
  const stats = envelope.stats;
  nativeExact(stats, ['input_tokens', 'total_output_tokens', 'reasoning_output_tokens',
    'tokens_per_second', 'time_to_first_token_seconds'], ['model_load_time_seconds'], 'NATIVE_CHAT_STATS_INVALID');
  const promptTokens = stats.input_tokens, completionTokens = stats.total_output_tokens;
  if (![promptTokens, completionTokens, stats.reasoning_output_tokens].every(n => Number.isSafeInteger(n) && n >= 0 && !Object.is(n, -0)) ||
      completionTokens === 0 || !Number.isSafeInteger(promptTokens + completionTokens)) fail('NATIVE_CHAT_USAGE_INVALID');
  if (stats.reasoning_output_tokens !== 0) fail('NATIVE_CHAT_REASONING_REFUSED');
  if (completionTokens >= selection.maxOutputTokens) fail('NATIVE_CHAT_OUTPUT_CAP_REACHED');
  for (const key of ['tokens_per_second', 'time_to_first_token_seconds', 'model_load_time_seconds']) {
    if (Object.hasOwn(stats, key) && (typeof stats[key] !== 'number' || !Number.isFinite(stats[key]) || stats[key] < 0)) fail('NATIVE_CHAT_STATS_INVALID');
  }
  return cloneFreeze({ profile: NATIVE_CHAT_PROFILE_V1, content: item.content,
    reportedModelInstance: envelope.model_instance_id,
    responseSha256: sha256Text(raw), contentSha256: sha256Text(item.content),
    usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
    usageSource: { promptTokens: 'REPORTED_INPUT_TOKENS', completionTokens: 'REPORTED_TOTAL_OUTPUT_TOKENS',
      totalTokens: 'DERIVED_SUM_OF_REPORTED_COUNTERS' },
    reportedStats: stats, termination: 'NOT_REPORTED', truncationCheck: 'BELOW_REPORTED_OUTPUT_CAP',
    modelAuthenticityAttested: false, serverCompletionAttested: false });
}
