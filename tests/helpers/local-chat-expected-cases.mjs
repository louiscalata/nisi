// Owner-authored immutable oracle. The executor may create JSON data only.
export const expectedCases = Object.freeze([
  { id: 'repair-valid', operation: 'repair', content: '{"status":"REPAIRED","candidate":{"files":[{"path":"a.mjs","content":"export const value = 2;"}]},"note":"fixed candidate"}', expectedCode: null, resultStatus: 'REPAIRED' },
  { id: 'repair-no-change', operation: 'repair', content: '{"status":"NO_CHANGE","candidate":null,"note":"no useful change"}', expectedCode: null, resultStatus: 'NO_CHANGE' },
  { id: 'review-valid', operation: 'review', content: '{"findings":[],"summary":"fixed review"}', expectedCode: null, resultStatus: 'PASS' },
  { id: 'review-findings', operation: 'review', content: '{"findings":[{"code":"BUG","message":"fixed finding"}],"summary":"fixed finding review"}', expectedCode: null, resultStatus: 'FAIL' },
  { id: 'repair-duplicate-key', operation: 'repair', content: '{"status":"NO_CHANGE","candidate":null,"note":"one","note":"two"}', expectedCode: 'LOCAL_CHAT_JSON_DUPLICATE_KEY', resultStatus: null },
  { id: 'repair-malformed-json', operation: 'repair', content: '{"status":', expectedCode: 'LOCAL_CHAT_JSON_INVALID', resultStatus: null },
  { id: 'repair-empty-final', operation: 'repair', content: '', expectedCode: 'LOCAL_CHAT_EMPTY_RESPONSE', resultStatus: null },
  { id: 'repair-extra-key', operation: 'repair', content: '{"status":"NO_CHANGE","candidate":null,"note":"fixed note","extra":true}', expectedCode: 'LOCAL_CHAT_OUTPUT_SCHEMA', resultStatus: null },
  { id: 'repair-wrong-status', operation: 'repair', content: '{"status":"PASS","candidate":null,"note":"fixed note"}', expectedCode: 'LOCAL_CHAT_REPAIR_INVALID', resultStatus: null },
  { id: 'repair-null-candidate', operation: 'repair', content: '{"status":"REPAIRED","candidate":null,"note":"fixed note"}', expectedCode: 'LOCAL_CHAT_REPAIR_INVALID', resultStatus: null },
  { id: 'repair-missing-note', operation: 'repair', content: '{"status":"NO_CHANGE","candidate":null}', expectedCode: 'LOCAL_CHAT_OUTPUT_SCHEMA', resultStatus: null },
  { id: 'review-invented-verdict', operation: 'review', content: '{"findings":[],"summary":"fixed review","verdict":"PASS"}', expectedCode: 'LOCAL_CHAT_OUTPUT_SCHEMA', resultStatus: null },
].map(record => Object.freeze(record)));
