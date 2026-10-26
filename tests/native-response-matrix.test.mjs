import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nativeJSON, readNativeChatEnvelopeV1 } from '../adapters/native-chat-protocol-v1.mjs';
import { expectedCases } from './helpers/native-response-expected.mjs';
const rows = nativeJSON(fs.readFileSync(new URL('./fixtures/native-response-cases.json', import.meta.url), 'utf8'));
test('native OpenCode data retains exact owner-prescribed twenty cases', () => {
  assert.equal(JSON.stringify(rows), JSON.stringify(expectedCases)); assert.equal(rows.length, 20);
});
for (const expected of expectedCases) test(`native actual envelope reader: ${expected.id}`, () => {
  const matching = rows.filter(row => row.id === expected.id); assert.equal(matching.length, 1);
  assert.equal(JSON.stringify(matching[0]), JSON.stringify(expected));
  const read = () => readNativeChatEnvelopeV1(matching[0].responseText,
    { expectedModelInstance: 'synthetic.instance', maxOutputTokens: 128 });
  if (expected.expectEnvelopeAccepted) {
    let value; assert.doesNotThrow(() => { value = read(); });
    assert.equal(value.content, '{"ready":true}'); assert.equal(value.termination, 'NOT_REPORTED');
    assert.equal(value.serverCompletionAttested, false);
  } else assert.throws(read, e => typeof e.code === 'string' && e.code.startsWith('NATIVE_CHAT_'));
});
