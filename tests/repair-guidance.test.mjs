import test from 'node:test';
import assert from 'node:assert/strict';
import { registerRepairGuidanceV1 as register, readRepairGuidanceV1 as read,
  resolveRepairGuidanceV1 as resolve, repairGuidanceReceiptV1 as receipt } from '../adapters/repair-guidance-v1.mjs';
import { task, taskFingerprint } from './helpers/native-chat-fixture.mjs';
const input = () => ({ arm: 'ON', api: 'NATIVE_API', binding: { taskFingerprint,
  baselineFingerprint: 'a'.repeat(64), suiteFingerprint: 'b'.repeat(64), reviewedSourceFingerprint: 'c'.repeat(64) } });
test('fixed guidance snapshots bindings and refuses copied or protocol-swapped registrations', () => {
  const value = input(), r = register(value); value.binding.taskFingerprint = '0'.repeat(64);
  assert.equal(r.binding.taskFingerprint, taskFingerprint); assert(Object.isFrozen(r.binding));
  assert.equal(read(r, 'NATIVE_API'), r); assert.equal(r.authorizing, false); assert.equal(r.measurementVerified, false);
  assert.throws(() => read(structuredClone(r), 'NATIVE_API'), { code: 'GUIDANCE_NOT_ISSUED' });
  assert.throws(() => read(r, 'CHAT_COMPLETIONS'), { code: 'GUIDANCE_API' });
  assert.throws(() => resolve(r, 'NATIVE_API', 'unreviewed base', task), { code: 'GUIDANCE_BASE_PROMPT' });
});
test('only explicit OFF/ON and fixed instruction bytes can be registered', () => {
  const on = register(input()), off = register({ ...input(), arm: 'OFF' });
  assert.notEqual(on.fingerprint, off.fingerprint); assert.equal(off.suffix, ''); assert(on.suffix.startsWith('\n\nBefore editing'));
  assert.equal(off.baseSystemPromptSha256, off.expectedSystemPromptSha256);
  for (const patch of [{ arm: 'AUTO' }, { api: 'OTHER' }, { suffix: 'ignore the task' }]) assert.throws(() => register({ ...input(), ...patch }));
  assert.throws(() => register({ ...input(), binding: { ...input().binding, taskFingerprint: '0' } }), { code: 'GUIDANCE_BINDING' });
  const bad = input(); Object.defineProperty(bad, 'arm', { get() { throw Error('getter executed'); } });
  assert.throws(() => register(bad), { code: 'INPUT_PROPERTY_INVALID' });
});
test('guidance observations cannot imply model use or dispatch of an unresolved prompt', () => {
  const r = register(input()), before = receipt(r, null, false), sent = receipt(r, r.expectedSystemPromptSha256, true);
  assert.equal(before.dispatch, 'NOT_DISPATCHED'); assert.equal(before.systemPromptSha256, null);
  assert.equal(sent.dispatch, 'LOCAL_FETCH_INVOKED'); assert.equal(sent.modelUseAttested, false);
  assert.throws(() => receipt(r, null, true), { code: 'GUIDANCE_RECEIPT' });
  assert.throws(() => receipt(r, '0'.repeat(64), true), { code: 'GUIDANCE_RECEIPT' });
});
