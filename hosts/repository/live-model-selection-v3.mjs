// PRIVATE pure V3 role selection. No discovery, credentials, model calls or authority.
import { cloneFreeze } from '../../workflow/contracts.mjs';
import { exact } from '../../integrity/record-utils.mjs';
import { NATIVE_CHAT_PROFILE_V1 } from '../../adapters/native-chat-protocol-v1.mjs';

const fail = code => { throw Object.assign(new Error(code), { code }); };
function modelId(value) {
  if (typeof value !== 'string' || !value || !value.isWellFormed() || value.trim() !== value ||
      value.includes('\0') || Buffer.byteLength(value) > 200) fail('LIVE_MODEL_ID');
}
function role(raw) {
  const value = cloneFreeze(raw);
  const native = value?.api === 'NATIVE_API';
  if (!native && value?.api !== 'CHAT_COMPLETIONS') fail('LIVE_ROLE_API');
  exact(value, ['api', 'endpoint', 'model', ...(native
    ? ['expectedModelInstance', 'profile', 'reasoning'] : ['outputMode'])], 'LIVE_ROLE_SCHEMA');
  modelId(value.model);
  if (native) {
    modelId(value.expectedModelInstance);
    if (value.profile !== NATIVE_CHAT_PROFILE_V1 || value.reasoning !== 'off') fail('LIVE_NATIVE_PROFILE');
  } else if (!['json_schema', 'json_instruction'].includes(value.outputMode)) fail('LIVE_OUTPUT_MODE_INVALID');
  if (typeof value.endpoint !== 'string' || value.endpoint.length > 2048 || value.endpoint.trim() !== value.endpoint) fail('LIVE_ROLE_ENDPOINT');
  let url; try { url = new URL(value.endpoint); } catch { fail('LIVE_ROLE_ENDPOINT'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.pathname !== (native ? '/api/v1/chat' : '/v1/chat/completions') ||
      url.username || url.password || url.search || url.hash) fail('LIVE_ROLE_ENDPOINT');
  return { ...value, endpoint: url.href };
}
export function readLiveModelSelectionV3(input) {
  exact(input, ['author', 'reviewer'], 'LIVE_ROLE_SELECTION');
  const author = role(input.author), reviewer = role(input.reviewer);
  if (author.model === reviewer.model) fail('LIVE_MODELS_NOT_DISTINCT');
  if (author.api === 'NATIVE_API' && reviewer.api === 'NATIVE_API' &&
      author.expectedModelInstance === reviewer.expectedModelInstance) fail('LIVE_INSTANCES_NOT_DISTINCT');
  return cloneFreeze({ author, reviewer });
}
