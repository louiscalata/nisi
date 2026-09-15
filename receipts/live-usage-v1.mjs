// PRIVATE pure helper based on the bounded Fable 5.1 draft. Trusted copied
// receipts only; identities are validated by the enclosing live-run contract.
import { exact } from '../integrity/record-utils.mjs';
const keys = ['promptTokens', 'completionTokens', 'totalTokens'];
const fail = code => { throw Object.assign(new Error(code), { code }); };
const count = value => Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
function readUsage(usage) {
  if (usage === null) return null;
  exact(usage, keys, 'LIVE_USAGE_INVALID');
  const copy = Object.fromEntries(keys.map(key => {
    if (!count(usage[key])) fail('LIVE_USAGE_INVALID'); return [key, usage[key]];
  }));
  const sum = copy.promptTokens + copy.completionTokens;
  if (!Number.isSafeInteger(sum) || sum !== copy.totalTokens) fail('LIVE_USAGE_INVALID');
  return copy;
}
export function summarizeLiveUsage(receipts) {
  if (!Array.isArray(receipts) || receipts.length > 2) fail('LIVE_USAGE_INVALID');
  const subtotal = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }; let knownCalls = 0;
  for (const receipt of receipts) {
    if (!receipt || typeof receipt !== 'object') fail('LIVE_USAGE_INVALID');
    const usage = readUsage(receipt.usage); if (usage === null) continue; knownCalls++;
    for (const key of keys) {
      const sum = subtotal[key] + usage[key]; if (!Number.isSafeInteger(sum)) fail('LIVE_USAGE_OVERFLOW'); subtotal[key] = sum;
    }
  }
  const calls = receipts.length, complete = calls > 0 && knownCalls === calls;
  return Object.freeze({ calls, knownCalls, unknownCalls: calls - knownCalls,
    totals: complete ? Object.freeze({ ...subtotal }) : null, knownSubtotal: Object.freeze(subtotal), complete });
}
