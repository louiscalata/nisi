// Inert transports only: settlement is local cleanup, never remote inference stop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalChatAuthorAdapter, createLocalChatTransportOwner } from '../adapters/local-chat.mjs';
import { createNativeChatAuthorAdapterV1, createNativeChatTransportOwnerV1 } from '../adapters/native-chat-v1.mjs';
import { config, payload, output, envelope, deferred, tick } from './helpers/native-chat-fixture.mjs';

const protocols = [
  { name: 'local', owner: createLocalChatTransportOwner, make: (fetch, owner, extra = {}) =>
    createLocalChatAuthorAdapter({ destination: 'LOOPBACK_HTTP', endpoint: 'http://127.0.0.1/chat',
      model: 'synthetic.model', id: 'synthetic.adapter', timeoutMs: 1000, fetch, transportOwner: owner, ...extra }),
    reply: () => new Response(JSON.stringify({ model: 'synthetic.model', choices: [{ finish_reason: 'stop',
      message: { content: JSON.stringify(output('draft')) } }] })), prefix: 'LOCAL_CHAT' },
  { name: 'native', owner: createNativeChatTransportOwnerV1, make: (fetch, owner, extra = {}) =>
    createNativeChatAuthorAdapterV1(config(fetch, { transportOwner: owner, ...extra })),
    reply: () => new Response(JSON.stringify(envelope(JSON.stringify(output('draft'))))), prefix: 'NATIVE_CHAT' },
];
function observe(owner) {
  let done = false, stateAtSettlement = null;
  const promise = owner.settled().then(() => { done = true; stateAtSettlement = owner.status(); });
  return { promise, get done() { return done; }, get stateAtSettlement() { return stateAtSettlement; } };
}

for (const p of protocols) {
  test(`${p.name}: idle settlement is not reused for two later active requests`, { timeout: 2000 }, async t => {
    const owner = p.owner(); await owner.settled();
    const pending = []; let calls = 0;
    const adapter = p.make(() => { calls++; const d = deferred(); pending.push(d); return d.promise; }, owner);
    t.after(async () => { owner.stop(); for (const d of pending) d.resolve(p.reply()); await owner.settled(); });
    for (let i = 0; i < 2; i++) {
      const run = adapter.draft(payload('draft')); run.catch(() => {});
      const a = observe(owner), b = observe(owner); await tick();
      assert.equal(a.done, false); assert.equal(b.done, false);
      assert.equal(owner.status().state, 'BUSY');
      pending[i].resolve(p.reply()); await run; await Promise.all([a.promise, b.promise]);
      assert.equal(a.stateAtSettlement.state, 'IDLE'); assert.equal(b.stateAtSettlement.state, 'IDLE');
      assert.equal(owner.status().state, 'IDLE'); assert.equal(owner.status().pendingTransports, 0);
    }
    assert.equal(calls, 2); await owner.settled();
  });

  test(`${p.name}: timeout is not pending-fetch settlement and old receipt stays UNKNOWN`, { timeout: 2000 }, async t => {
    const owner = p.owner(), fetch = deferred();
    assert.equal(typeof owner.settled, 'function');
    const adapter = p.make(() => fetch.promise, owner, { timeoutMs: 15 });
    t.after(async () => { fetch.resolve(p.reply()); await owner.settled(); });
    const run = adapter.draft(payload('draft')), joined = observe(owner);
    await assert.rejects(run, { code: `${p.prefix}_TIMEOUT` });
    const receipt = adapter.receipts()[0]; await tick();
    assert.equal(joined.done, false); assert.equal(owner.status().pendingTransports, 1);
    fetch.resolve(p.reply()); await joined.promise;
    assert.equal(owner.status().pendingTransports, 0); assert.equal(owner.status().state, 'QUARANTINED');
    assert.equal(receipt.lifecycle.transportSettlement, 'UNKNOWN');
    assert.equal(receipt.lifecycle.remoteInferenceStopped, 'NOT_OBSERVED');
    await assert.rejects(adapter.draft(payload('draft')), { code: `${p.prefix}_TRANSPORT_QUARANTINED` });
  });

  test(`${p.name}: completed read does not bypass pending body cancellation`, { timeout: 2000 }, async t => {
    const owner = p.owner(), read = deferred(), cancel = deferred();
    assert.equal(typeof owner.settled, 'function');
    let cancels = 0;
    const adapter = p.make(async () => ({ ok: true, body: { getReader: () => ({
      read: () => read.promise, cancel: () => { cancels++; return cancel.promise; }, releaseLock() {},
    }) } }), owner, { timeoutMs: 15 });
    t.after(async () => { read.resolve({ done: true }); cancel.resolve(); await owner.settled(); });
    const run = adapter.draft(payload('draft')), joined = observe(owner);
    await assert.rejects(run, { code: `${p.prefix}_TIMEOUT` });
    read.resolve({ done: true }); await tick();
    assert.equal(cancels, 1); assert.equal(joined.done, false); assert.equal(owner.status().pendingTransports, 1);
    cancel.resolve(); await joined.promise;
    assert.equal(owner.status().pendingTransports, 0); assert.equal(owner.status().recoveryRequired, true);
  });

  test(`${p.name}: stop and a refused second request cannot settle the first request`, { timeout: 2000 }, async t => {
    const owner = p.owner(), fetch = deferred();
    assert.equal(typeof owner.settled, 'function');
    const adapter = p.make(() => fetch.promise, owner);
    t.after(async () => { fetch.resolve(p.reply()); await owner.settled(); });
    const run = adapter.draft(payload('draft')); run.catch(() => {});
    const joined = observe(owner);
    await assert.rejects(adapter.draft(payload('draft')), { code: `${p.prefix}_TRANSPORT_BUSY` });
    owner.stop(); await assert.rejects(run, { code: `${p.prefix}_OWNER_STOPPED` }); await tick();
    assert.equal(joined.done, false); assert.equal(owner.status().state, 'STOPPED_DRAINING');
    fetch.resolve(p.reply()); await joined.promise;
    assert.equal(owner.status().state, 'STOPPED'); assert.equal(owner.status().recoveryRequired, true);
    await assert.rejects(adapter.draft(payload('draft')), { code: `${p.prefix}_OWNER_STOPPED` });
  });

  test(`${p.name}: pre-dispatch refusal releases active ownership without transport`, { timeout: 2000 }, async () => {
    const owner = p.owner(); assert.equal(typeof owner.settled, 'function'); let calls = 0;
    const adapter = p.make(() => { calls++; return p.reply(); }, owner, { maxRequestBytes: 256 });
    await assert.rejects(adapter.draft(payload('draft')), { code: `${p.prefix}_REQUEST_TOO_LARGE` });
    await owner.settled(); assert.equal(calls, 0); assert.equal(owner.status().state, 'IDLE');
  });
}

test('native: throwing listener cleanup cannot strand acquired ownership', { timeout: 2000 }, async () => {
  const owner = createNativeChatTransportOwnerV1(); assert.equal(typeof owner.settled, 'function');
  const controller = new AbortController();
  controller.signal.removeEventListener = () => { throw Object.assign(Error('test cleanup'), { code: 'TEST_CLEANUP' }); };
  const adapter = createNativeChatAuthorAdapterV1(config(async () => new Response(JSON.stringify(envelope(JSON.stringify(output('draft'))))), { transportOwner: owner }));
  await assert.rejects(adapter.draft({ ...payload('draft'), signal: controller.signal }), { code: 'TEST_CLEANUP' });
  await owner.settled(); assert.equal(owner.status().state, 'IDLE');
});
