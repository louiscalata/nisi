import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFixedXpcReply, parseFixedXpcClient, assertFixedXpcOutcomes } from '../hosts/macos-xpc/protocol.mjs';
import { requireFixedXpcOptIn, assertFixedXpcCase, persistFixedXpcTerminal } from '../hosts/macos-xpc/fixed-xpc-runner.mjs';

const expected = { runId: '0123456789abcdef0123456789abcdef', callerPid: 101, expectedHome: '/container/service' };
const clientExpected = { runId: expected.runId, expectedPid: 101, expectedClientHome: '/container/client', expectedServiceHome: expected.expectedHome };
const deniedRows = [[6, 2, 1], [7, 0, 0], [8, 0, 0], [9, 2, 13], [10, 0, 0], [11, 0, 0], [13, 2, 1]];
function frame({ home = expected.expectedHome, changes = deniedRows, caller = 101, service = 202 } = {}) {
  const homeBytes = Buffer.from(home), bytes = Buffer.alloc(121 + homeBytes.length);
  bytes.write('NRS1'); bytes.write(expected.runId, 4); bytes.writeUInt32BE(caller, 36); bytes.writeUInt32BE(service, 40);
  bytes.writeUInt16BE(homeBytes.length, 44); homeBytes.copy(bytes, 46);
  for (let i = 0; i < 15; i++) bytes[46 + homeBytes.length + i * 5] = 1;
  for (const [i, status, code] of changes) { const at = 46 + homeBytes.length + i * 5; bytes[at] = status; bytes.writeUInt32BE(code, at + 1); }
  return bytes;
}
function rowChange(index, status, code = 0) {
  return [...deniedRows.filter(([i]) => i !== index), [index, status, code]];
}
const read = bytes => parseFixedXpcReply(bytes, expected);
const rejected = fn => assert.throws(fn, error => typeof error?.code === 'string' && /^XPC_/u.test(error.code));
function clientRecord(changes = {}) {
  return { authorizing: false, home: clientExpected.expectedClientHome, pid: 101,
    replyBase64: frame().toString('base64'), runId: expected.runId, schemaVersion: 'nisi-fixed-xpc-client-v1', status: 'REPLY_RECEIVED', ...changes };
}
const jsonBytes = value => Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))) + '\n');
const client = changes => parseFixedXpcClient(jsonBytes(clientRecord(changes)), clientExpected);

test('reply preserves a fixed observation without authorizing or deriving PASS', () => {
  const parsed = read(frame()); assert.equal(parsed.rows.length, 15); assert.equal(parsed.servicePidSelfReported, 202);
  assert(Object.isFrozen(parsed)); assert(Object.isFrozen(parsed.rows)); assert(parsed.rows.every(Object.isFrozen));
  assert(!Object.hasOwn(parsed, 'pass')); assert(!Object.hasOwn(parsed, 'authorizing')); assertFixedXpcOutcomes(parsed);
});
test('all allowed reply parses but fails the sandbox outcome matrix', () => {
  const parsed = read(frame({ changes: [] })); assert.equal(parsed.rows[6].outcome, 'ALLOWED'); rejected(() => assertFixedXpcOutcomes(parsed));
});
for (const [name, mutate] of [
  ['magic high bit', b => { b[3] |= 0x80; }], ['run high bit', b => { b[4] |= 0x80; }],
  ['wrong magic', b => { b[0] = 0; }], ['wrong run', b => { b[4] = 120; }],
  ['wrong caller', b => { b.writeUInt32BE(303, 36); }], ['zero service', b => { b.writeUInt32BE(0, 40); }],
  ['overflow service', b => { b.writeUInt32BE(0x80000000, 40); }], ['same process', b => { b.writeUInt32BE(101, 40); }],
  ['short bytes', b => b.subarray(0, 120)], ['trailing byte', b => Buffer.concat([b, Buffer.from([0])])],
  ['zero home size', b => { b.writeUInt16BE(0, 44); }], ['wrong home size', b => { b.writeUInt16BE(1, 44); }],
  ['overflow home size', b => { b.writeUInt16BE(1025, 44); }], ['invalid UTF8', b => { b[46] = 255; }],
]) test(`reply rejects ${name} with a reader error`, () => {
  const bytes = frame(), changed = mutate(bytes); rejected(() => read(Buffer.isBuffer(changed) ? changed : bytes));
});
test('INT32_MAX is a valid self-reported service PID, not an overflow', () => assert.equal(read(frame({ service: 0x7fffffff })).servicePidSelfReported, 0x7fffffff));
for (const length of [1, 1024]) test(`reply accepts exact ${length}-byte home boundary`, () => {
  const home = 'x'.repeat(length); assert.equal(parseFixedXpcReply(frame({ home }), { ...expected, expectedHome: home }).home, home);
});
test('reply rejects a BOM rather than silently stripping it', () => rejected(() => read(frame({ home: '\uFEFF' + expected.expectedHome }))));
test('reply rejects nonmatching home', () => rejected(() => read(frame({ home: '/other' }))));
for (const value of [null, {}, [], 'bytes', new Uint8Array(225)]) test(`reply requires Buffer (${String(value)})`, () => rejected(() => read(value)));
for (const changes of [{ runId: 'bad' }, { callerPid: 0 }, { callerPid: '101' }, { callerPid: 0x80000000 }, { expectedHome: '' }, { expectedHome: 'x'.repeat(1025) }, { expectedHome: '\ud800' }, { expectedHome: 'a\0b' }])
  test(`reply expected context is bounded ${JSON.stringify(changes)}`, () => rejected(() => parseFixedXpcReply(frame(), { ...expected, ...changes })));
for (const index of [0, 3, 6, 9, 12]) {
  test(`group ${index} rejects a top-level skip`, () => rejected(() => read(frame({ changes: [[index, 0, 0], [index + 1, 0, 0], [index + 2, 0, 0]] }))));
  test(`group ${index} rejects work after denied opener`, () => rejected(() => read(frame({ changes: [[index, 2, 1], [index + 1, 0, 0], [index + 2, 1, 0]] }))));
  test(`group ${index} requires close attempt after successful opener`, () => rejected(() => read(frame({ changes: [[index + 2, 0, 0]] }))));
  test(`group ${index} preserves close ERROR after a successful opener`, () => {
    const parsed = read(frame({ changes: [[index + 2, 3, 5]] })); assert.equal(parsed.rows[index + 2].outcome, 'ERROR');
  });
  test(`group ${index} rejects DENIED close`, () => rejected(() => read(frame({ changes: [[index + 2, 2, 1]] }))));
}
for (const [name, index, status, code] of [['unknown status', 1, 9, 0], ['invalid denial', 13, 2, 2],
  ['allowed nonzero', 1, 1, 1], ['skip nonzero', 7, 0, 1], ['errno overflow', 1, 3, 0xffffffff]])
  test(`reply rejects ${name}`, () => rejected(() => read(frame({ changes: rowChange(index, status, code) }))));
test('socket creation denial with dependent skips is an expected fixed outcome', () => {
  const changes = [...deniedRows.filter(([i]) => i < 12), [12, 2, 13], [13, 0, 0], [14, 0, 0]];
  assertFixedXpcOutcomes(read(frame({ changes })));
});
test('partial write ERROR with errno zero is preserved but not an expected successful probe', () => {
  const parsed = read(frame({ changes: rowChange(1, 3, 0) })); assert.equal(parsed.rows[1].errno, 0); rejected(() => assertFixedXpcOutcomes(parsed));
});
test('client binds exact run/PID/home and parses the fixed reply', () => {
  const parsed = client(); assert.equal(parsed.reply.callerPid, 101); assert(Object.isFrozen(parsed)); assertFixedXpcCase(parsed, 'valid', 300);
});
for (const status of ['MALFORMED', 'TIMEOUT', 'PROXY_ERROR', 'INTERRUPTED', 'INVALIDATED', 'INCONCLUSIVE']) {
  test(`client retains ${status} with no reply, never PASS`, () => {
    const parsed = client({ status, replyBase64: '' }); assert.equal(parsed.client.status, status); assert.equal(parsed.reply, null);
    assert.equal(parsed.client.authorizing, false); rejected(() => assertFixedXpcCase(parsed, 'valid', 300));
  });
  test(`client rejects reply bytes attached to ${status}`, () => rejected(() => client({ status })));
}
for (const changes of [{ authorizing: true }, { pid: 202 }, { runId: 'f'.repeat(32) }, { home: '/other' },
  { schemaVersion: 'next' }, { status: 'PASS' }, { replyBase64: null }, { replyBase64: '!' }, { replyBase64: '' }, { extra: false }])
  test(`client rejects altered field ${JSON.stringify(changes)}`, () => rejected(() => client(changes)));
test('client rejects duplicate keys even when values agree', () => {
  const raw = jsonBytes(clientRecord()).toString().replace('{', '{"authorizing":false,'); rejected(() => parseFixedXpcClient(Buffer.from(raw), clientExpected));
});
test('client rejects whitespace and lexical aliases in its closed native encoding', () => {
  for (const raw of [' ' + jsonBytes(clientRecord()).toString(), jsonBytes(clientRecord()).toString().replace('101', '1.01e2'), JSON.stringify(clientRecord(), null, 2) + '\n'])
    rejected(() => parseFixedXpcClient(Buffer.from(raw), clientExpected));
});
test('client rejects missing newline, multiple lines and oversized bytes', () => {
  const bytes = jsonBytes(clientRecord()); for (const b of [bytes.subarray(0, bytes.length - 1), Buffer.concat([bytes, bytes]), Buffer.alloc(16385)]) rejected(() => parseFixedXpcClient(b, clientExpected));
});
test('native malformed case requires exact failure, empty reply and bounded client duration', () => {
  assertFixedXpcCase(client({ status: 'MALFORMED', replyBase64: '' }), 'malformed-request', 300);
  rejected(() => assertFixedXpcCase(client(), 'malformed-request', 300));
});
test('native no-reply case accepts only client TIMEOUT within its observation window', () => {
  const parsed = client({ status: 'TIMEOUT', replyBase64: '' });
  for (const duration of [5000, 7999]) assertFixedXpcCase(parsed, 'no-reply', duration);
  for (const duration of [0, 4999, 8000, NaN]) rejected(() => assertFixedXpcCase(parsed, 'no-reply', duration));
  for (const status of ['PROXY_ERROR', 'INVALIDATED', 'INTERRUPTED', 'MALFORMED']) rejected(() => assertFixedXpcCase(client({ status, replyBase64: '' }), 'no-reply', 5300));
});
for (const argv of [[], ['--help'], ['--run-fixed-private-xpc-probe', '--case=duplicate'], ['--case=valid'], ['--run-fixed-private-xpc-probe', '--case=__proto__'], ['--run-fixed-private-xpc-probe', '--case=no-reply', 'extra'], null])
  test(`opt-in refuses ${JSON.stringify(argv)}`, () => rejected(() => requireFixedXpcOptIn(argv)));
test('opt-in selects only fixed compiled cases', () => {
  assert.equal(requireFixedXpcOptIn(['--run-fixed-private-xpc-probe']), 'valid');
  for (const name of ['valid', 'malformed-request', 'no-reply']) assert.equal(requireFixedXpcOptIn(['--run-fixed-private-xpc-probe', '--case=' + name]), name);
});
test('terminal writer failure cannot keep an observed result', () => {
  const record = { root: '/fixed/run', status: 'FIXED_XPC_CASE_OBSERVED', authorizing: false };
  const result = persistFixedXpcTerminal(record, () => { throw Object.assign(Error('disk'), { code: 'ENOSPC' }); });
  assert.equal(result.status, 'INCONCLUSIVE'); assert.equal(result.root, record.root); assert.equal(result.authorizing, false);
  assert.equal(result.terminalPersistence.code, 'ENOSPC'); assert.equal(record.status, 'FIXED_XPC_CASE_OBSERVED');
});
test('terminal writer must finish synchronously with a void result', () => {
  const record = { root: '/fixed/run', status: 'INCONCLUSIVE' }; let seen;
  assert.equal(persistFixedXpcTerminal(record, value => { seen = value; }), record); assert.equal(seen, record);
  for (const returned of [false, 1, Promise.resolve()]) assert.equal(persistFixedXpcTerminal(record, () => returned).status, 'INCONCLUSIVE');
  rejected(() => persistFixedXpcTerminal({ root: null, status: 'INCONCLUSIVE' }, () => {}));
});
