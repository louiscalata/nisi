// Fixed package import/lifecycle check; no native process or model request.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as native from 'nisi/adapters/native-chat';
import * as direct from 'nisi/adapters/native-chat-v1.mjs';

test('native-chat package aliases share factories and a synthetic owner lifecycle', () => {
  assert.equal(native, direct);
  assert.deepEqual(Object.keys(native).sort(), [
    'createNativeChatAuthorAdapterV1',
    'createNativeChatReviewerAdapterV1',
    'createNativeChatTransportOwnerV1',
  ]);
  const owner = native.createNativeChatTransportOwnerV1();
  const options = {
    destination: 'LOOPBACK_HTTP', endpoint: 'http://127.0.0.1:1234/api/v1/chat',
    model: 'synthetic', expectedModelInstance: 'synthetic-1', reasoning: 'off',
    transportOwner: owner,
    fetch: () => { throw new Error('This fixture must not request transport'); },
  };
  const author = native.createNativeChatAuthorAdapterV1({...options, id: 'consumer.native.author'});
  const reviewer = native.createNativeChatReviewerAdapterV1({...options, id: 'consumer.native.reviewer'});
  assert.equal(typeof author.draft, 'function');
  assert.equal(typeof author.repair, 'function');
  assert.equal(typeof reviewer.review, 'function');
  assert.deepEqual(author.receipts(), []);
  assert.deepEqual(reviewer.receipts(), []);
  assert.deepEqual(owner.status(), {
    schemaVersion: 'nisi-native-chat-owner-v1', state: 'IDLE', pendingTransports: 0,
    recoveryRequired: false, remoteInferenceStopped: 'NOT_OBSERVED', scope: 'THIS_OWNER_ONLY',
  });
  author.stop();
  assert.equal(owner.status().state, 'STOPPED');
  assert.equal(reviewer.lifecycle().state, 'STOPPED');
  assert.equal(reviewer.lifecycle().remoteInferenceStopped, 'NOT_OBSERVED');
});
