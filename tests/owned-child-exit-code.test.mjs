import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createOwnedChildObserver } from '../hosts/swift-verifier/owned-child.mjs';

function child({ code = 0, signal = null, stderr = false, delayMs = 0 } = {}) {
  const c = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null, kill: () => true });
  c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.stdin = Object.assign(new EventEmitter(), { end() {} });
  const emit = () => { c.emit('spawn'); c.stdout.emit('data', Buffer.from('ok')); if (stderr) c.stderr.emit('data', Buffer.from('unexpected')); c.emit('exit', signal ? null : code, signal); c.exitCode = signal ? null : code; c.signalCode = signal; c.emit('close', signal ? null : code, signal); };
  if (delayMs > 0) setTimeout(emit, delayMs); else setImmediate(emit);
  return c;
}
const make = (childOptions, options = {}) => createOwnedChildObserver({ timeoutMs: 1000, launch: () => child(childOptions), ...options });
const valid = () => ({ ok: true });
const rejected = result => { assert.notEqual(result.cause, null); assert.equal(result.validated, null); };

test('default expected exit code remains zero', async () => {
  const result = await make({ code: 0 }).run({ input: Buffer.alloc(0), validate: valid });
  assert.equal(result.cause, null);
  assert.equal(result.validated.ok, true);
  assert.equal(Object.getPrototypeOf(result.validated), null);
  assert.equal(Object.isFrozen(result.validated), true);
});
test('default exit policy still rejects 70 before calling the parser', async () => {
  let parsed = false;
  const result = await make({ code: 70 }).run({ input: Buffer.alloc(0), validate: () => { parsed = true; return {}; } });
  assert.equal(result.cause, 'CHILD_TERMINATION_INCONCLUSIVE'); assert.equal(parsed, false); assert.equal(result.validated, null);
});
test('explicit expected exit code 70 validates matching termination', async () => { const result = await make({ code: 70 }, { expectedExitCode: 70 }).run({ input: Buffer.alloc(0), validate: valid }); assert.equal(result.cause, null); assert.equal(result.process.exitCode, 70); });
for (const value of [null, '70', 1.5, -1, 256, 4294967295]) test(`invalid expected exit code ${String(value)} is CHILD_OWNER_CONFIG`, () => { assert.throws(() => make({ code: 0 }, { expectedExitCode: value }), { code: 'CHILD_OWNER_CONFIG' }); });
test('matching expected 70 still rejects stderr', async () => { rejected(await make({ code: 70, stderr: true }, { expectedExitCode: 70 }).run({ input: Buffer.alloc(0), validate: valid })); });
test('matching expected 70 still rejects cancellation', async () => { const controller = new AbortController(); controller.abort(); rejected(await make({ code: 70 }, { expectedExitCode: 70 }).run({ input: Buffer.alloc(0), signal: controller.signal, validate: valid })); });
test('matching expected 70 still rejects deadline', async () => { const result = await createOwnedChildObserver({ timeoutMs: 1, expectedExitCode: 70, launch: () => child({ code: 70, delayMs: 25 }) }).run({ input: Buffer.alloc(0), validate: valid }); rejected(result); });
test('matching expected 70 with exit 0 remains inconclusive', async () => { rejected(await make({ code: 0 }, { expectedExitCode: 70 }).run({ input: Buffer.alloc(0), validate: valid })); });
test('matching expected 70 with exit 1 remains inconclusive', async () => { rejected(await make({ code: 1 }, { expectedExitCode: 70 }).run({ input: Buffer.alloc(0), validate: valid })); });
test('matching exit does not override a named parser failure', async () => {
  const result = await make({ code: 70 }, { expectedExitCode: 70 }).run({ input: Buffer.alloc(0), validate: () => { throw Object.assign(Error('bad'), { code: 'XPC_CLIENT_JSON' }); } });
  assert.equal(result.cause, 'XPC_CLIENT_JSON'); assert.equal(result.validated, null); assert.equal(result.authorizing, false);
});
test('matching exit still rejects post-validation cancellation', async () => {
  const controller = new AbortController();
  const result = await make({ code: 70 }, { expectedExitCode: 70 }).run({ input: Buffer.alloc(0), signal: controller.signal, validate: () => { controller.abort(); return {}; } });
  assert.equal(result.cause, 'ABORTED'); assert.equal(result.validated, null);
});
