// Deterministic contract tests for the generalized typed combiner (BN01-C09
// "arbitrary task/response/combiner types" slice). Uses real validated fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createTypedContributionCombiner, TYPED_TYPES } from '../neural/typed-contribution-combiner.mjs';
import { typedContext } from './fixtures/typed-context.mjs';

const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
const shaBuf = buf => createHash('sha256').update(buf).digest('hex');
const shaText = text => createHash('sha256').update(text).digest('hex');

const CONTEXT = typedContext();
const BASE = CONTEXT.baseBytes.toString('utf8');
const DUAL = CONTEXT.dualBytes.toString('utf8');
const PINS = CONTEXT.pins;

const f32 = vals => { const b = Buffer.alloc(4 * vals.length); vals.forEach((v, i) => b.writeFloatLE(v, i * 4)); return b; };
const f64 = vals => { const b = Buffer.alloc(8 * vals.length); vals.forEach((v, i) => b.writeDoubleLE(v, i * 8)); return b; };
const i64 = vals => { const b = Buffer.alloc(8 * vals.length); vals.forEach((v, i) => b.writeBigInt64LE(BigInt(v), i * 8)); return b; };
const bools = vals => Buffer.from(vals.map(v => (v ? 1 : 0)));
const bytes = text => Buffer.from(text, 'utf8');

const newTask = (ids, overrides = {}) => canonical({ kind: 'veritas-typed-contribution-task-v1',
  taskId: 'task-typed-01', requester: 'PRIMARY', ...PINS, generation: 7,
  requiredContributors: ids, deadlineMs: 60000, ...overrides });
// The module digests the canonical task record; forge the matching digest here.
const taskDigest = (ids, overrides = {}) =>
  shaText(`veritas/typed-contribution/veritas-typed-contribution-task-v1\0${newTask(ids, overrides)}`);
const newContributor = (id, overrides = {}) => canonical({ kind: 'veritas-typed-contribution-contributor-v1',
  contributorId: id, role: 'ex-contrib', revision: 1, outputType: 'F64', outputWidth: 2,
  spaceSha256: 'e'.repeat(64), maxPayloadBytes: 65536, ...overrides });
const newResponse = (contributorId, payload, digests, overrides = {}) => canonical({
  kind: 'veritas-typed-contribution-response-v1', contributorId, taskId: 'task-typed-01',
  taskDigest: digests.task, outcome: 'RESPONSE_OK', payloadSha256: shaBuf(payload), ...overrides });

let generation = 7;
const bind = (overrides = {}, gen = generation) => {
  const r = createTypedContributionCombiner(Buffer.from(BASE, 'utf8'), Buffer.from(DUAL, 'utf8'),
    { ...overrides, generation: gen });
  return r.ok ? { combiner: r.combiner, r } : { r };
};
const admit = (c, text) => c.admitContributor(text);
const submit = (c, text) => c.admitTask(text);
const respond = (c, text, payload) => c.admitResponse(text, payload);
const combine = (c, text, entries) => c.combine(text, entries);

// A ready single- or dual-contributor combiner; returns the forged task digest.
function readyCombiner(twoContributors = false) {
  const { combiner, r } = bind();
  assert.equal(r.code, 'READY_PRIVATE_TYPED_CONTRIBUTION_COMBINER_ONLY');
  assert.equal(admit(combiner, newContributor('c1')).ok, true);
  if (twoContributors) assert.equal(admit(combiner, newContributor('c2')).ok, true);
  const ids = twoContributors ? ['c1', 'c2'] : ['c1'];
  const t = submit(combiner, newTask(ids));
  assert.equal(t.ok, true);
  return { combiner, digests: { task: taskDigest(ids) }, ids };
}

test('factory binds canonical base/dual bytes and an exact generation', () => {
  const { r } = bind();
  assert.equal(r.ok, true);
  assert.equal(r.code, 'READY_PRIVATE_TYPED_CONTRIBUTION_COMBINER_ONLY');
  assert.equal(r.authorizing, false);
  assert.equal(bind({}, 0).r.ok, false);
  assert.equal(bind({}, -1).r.ok, false);
  const bad = createTypedContributionCombiner(Buffer.from('{bad', 'utf8'), Buffer.from(DUAL, 'utf8'), { generation: 7 });
  assert.equal(bad.ok, false);
});

test('the closed registry accepts exactly the declared types', () => {
  // STRING (variable-length UTF-8) joined the registry in the 2026-09-06
  // framework wave; the list stays exact-match so silent type drift is refused.
  assert.deepEqual(Object.keys(TYPED_TYPES), ['F32', 'F64', 'I64', 'BOOL', 'BYTES', 'STRING']);
  for (const type of Object.keys(TYPED_TYPES)) {
    const { combiner } = bind();
    assert.equal(admit(combiner, newContributor('c1', { outputType: type })).ok, true);
  }
});

test('an unknown or out-of-range type/width is refused, never interpreted', () => {
  const { combiner } = bind();
  assert.equal(admit(combiner, newContributor('c1', { outputType: 'FLOAT128' })).ok, false);
  assert.equal(admit(combiner, newContributor('c1', { outputType: 'F64' })).ok, true);
  const { combiner: c2 } = bind();
  assert.equal(admit(c2, newContributor('c1', { outputWidth: 0 })).ok, false);
  assert.equal(admit(c2, newContributor('c1', { outputWidth: 8193 })).ok, false);
});

test('a task requires bound typed contributors; duplicates and unknowns are refused', () => {
  const { combiner } = bind();
  assert.equal(submit(combiner, newTask(['c-nope'])).ok, false);
  assert.equal(submit(combiner, newTask(['c1'])).ok, false); // c1 not bound yet
  admit(combiner, newContributor('c1'));
  assert.equal(submit(combiner, newTask(['c1'])).ok, true);
  assert.equal(submit(combiner, newTask(['c1', 'c1'])).ok, false);
});

test('an F64 response with a non-finite payload is refused at admit', () => {
  const { combiner, digests } = readyCombiner();
  const nanPayload = Buffer.alloc(16);
  nanPayload.writeDoubleLE(NaN, 0);
  assert.equal(respond(combiner, newResponse('c1', nanPayload, digests), nanPayload).code, 'PAYLOAD_TYPE_DOMAIN_INVALID');
  const infPayload = f64([1, Infinity]);
  assert.equal(respond(combiner, newResponse('c1', infPayload, digests), infPayload).code, 'PAYLOAD_TYPE_DOMAIN_INVALID');
});

test('an I64 response outside the safe-integer domain is refused', () => {
  const { combiner } = bind();
  admit(combiner, newContributor('c1', { outputType: 'I64' }));
  submit(combiner, newTask(['c1']));
  const big = i64([Number.MAX_SAFE_INTEGER + 1, 0]);
  assert.equal(respond(combiner, newResponse('c1', big, { task: taskDigest(['c1']) }), big).code, 'PAYLOAD_TYPE_DOMAIN_INVALID');
});

test('a BOOL payload byte that is not 0/1 is refused', () => {
  const { combiner } = bind();
  admit(combiner, newContributor('c1', { outputType: 'BOOL' }));
  submit(combiner, newTask(['c1']));
  const d = { task: taskDigest(['c1']) };
  assert.equal(respond(combiner, newResponse('c1', bools([0, 1]), d), bools([0, 1])).ok, true);
  // A fresh combiner so the bad-payload attempt is not caught as a duplicate
  const { combiner: c2 } = bind();
  admit(c2, newContributor('c1', { outputType: 'BOOL' }));
  submit(c2, newTask(['c1']));
  const d2 = { task: taskDigest(['c1']) };
  assert.equal(respond(c2, newResponse('c1', Buffer.from([1, 2]), d2), Buffer.from([1, 2])).code, 'PAYLOAD_TYPE_DOMAIN_INVALID');
});

test('payload digest, task digest, endpoint and duplicate violations are refused', () => {
  const { combiner, digests } = readyCombiner();
  const payload = f64([1, 2]);
  assert.equal(respond(combiner, newResponse('c1', payload, digests, { payloadSha256: 'f'.repeat(64) }), payload).code, 'PAYLOAD_DIGEST_MISMATCH');
  assert.equal(respond(combiner, newResponse('c1', payload, { task: '9'.repeat(64) }), payload).code, 'RESPONSE_TASK_DIGEST_MISMATCH');
  assert.equal(respond(combiner, newResponse('c1', payload, digests), payload).ok, true);
  assert.equal(respond(combiner, newResponse('c1', payload, digests), payload).code, 'RESPONSE_DUPLICATE');
});

test('combining F64 responses sums element-wise with exact order and count', () => {
  const { combiner, digests, ids } = readyCombiner(true);
  const p1 = f64([1.5, 2]);
  const p2 = f64([0.5, 3]);
  respond(combiner, newResponse('c1', p1, digests), p1);
  respond(combiner, newResponse('c2', p2, digests), p2);
  const ok = combine(combiner, newTask(ids), [
    { text: newResponse('c1', p1, digests), payload: p1 },
    { text: newResponse('c2', p2, digests), payload: p2 },
  ]);
  assert.equal(ok.ok, true);
  assert.equal(ok.code, 'TYPED_COMBINE_COMPLETE');
  assert.equal(ok.type, 'F64');
  assert.equal(ok.contributors, 2);
  assert.equal(ok.combinedBytes, 16);
});

test('reversed contributor order is refused at combine (order is part of the contract)', () => {
  const { combiner, digests, ids } = readyCombiner(true);
  const p1 = f64([1, 0]);
  const p2 = f64([2, 0]);
  respond(combiner, newResponse('c1', p1, digests), p1);
  respond(combiner, newResponse('c2', p2, digests), p2);
  const reversed = combine(combiner, newTask(ids), [
    { text: newResponse('c2', p2, digests), payload: p2 },
    { text: newResponse('c1', p1, digests), payload: p1 },
  ]);
  assert.equal(reversed.ok, false);
  assert.equal(reversed.code, 'RESPONSE_ORDER_MISMATCH');
});

test('count, width and type-consistency violations refuse the combine', () => {
  // type mismatch: c1 declares F32 while c2 declares F64 for the same task
  const { combiner: c2c } = bind();
  admit(c2c, newContributor('c1', { outputType: 'F32', outputWidth: 2 }));
  admit(c2c, newContributor('c2', { outputType: 'F64', outputWidth: 2 }));
  submit(c2c, newTask(['c1', 'c2']));
  const d = { task: taskDigest(['c1', 'c2']) };
  const p1 = f32([1, 2]);
  const p2 = f64([3, 4]);
  respond(c2c, newResponse('c1', p1, d), p1);
  respond(c2c, newResponse('c2', p2, d), p2);
  const mixed = combine(c2c, newTask(['c1', 'c2']), [
    { text: newResponse('c1', p1, d), payload: p1 },
    { text: newResponse('c2', p2, d), payload: p2 },
  ]);
  assert.equal(mixed.ok, false);
  assert.equal(mixed.code, 'TYPE_MISMATCH');
  // width mismatch
  const { combiner: c3c } = bind();
  admit(c3c, newContributor('c1', { outputWidth: 2 }));
  admit(c3c, newContributor('c2', { outputWidth: 3 }));
  submit(c3c, newTask(['c1', 'c2']));
  const d3 = { task: taskDigest(['c1', 'c2']) };
  const q1 = f64([1, 2]);
  const q2 = f64([1, 2, 3]);
  respond(c3c, newResponse('c1', q1, d3), q1);
  respond(c3c, newResponse('c2', q2, d3), q2);
  const wide = combine(c3c, newTask(['c1', 'c2']), [
    { text: newResponse('c1', q1, d3), payload: q1 },
    { text: newResponse('c2', q2, d3), payload: q2 },
  ]);
  assert.equal(wide.ok, false);
  assert.equal(wide.code, 'WIDTH_MISMATCH');
  // count mismatch
  const { combiner: c4c, digests: d4 } = readyCombiner(true);
  assert.equal(combine(c4c, newTask(['c1', 'c2']), [{ text: newResponse('c1', f64([1, 2]), d4), payload: f64([1, 2]) }]).code, 'RESPONSE_COUNT_MISMATCH');
});

test('I64, BOOL and BYTES combine with their own semantics', () => {
  // I64 sum
  const { combiner: ic } = bind();
  admit(ic, newContributor('c1', { outputType: 'I64', outputWidth: 2 }));
  admit(ic, newContributor('c2', { outputType: 'I64', outputWidth: 2 }));
  submit(ic, newTask(['c1', 'c2']));
  const d = { task: taskDigest(['c1', 'c2']) };
  const i1 = i64([10, 20]);
  const i2 = i64([5, -3]);
  respond(ic, newResponse('c1', i1, d), i1);
  respond(ic, newResponse('c2', i2, d), i2);
  assert.equal(combine(ic, newTask(['c1', 'c2']), [
    { text: newResponse('c1', i1, d), payload: i1 },
    { text: newResponse('c2', i2, d), payload: i2 },
  ]).type, 'I64');
  // BOOL OR
  const { combiner: bc } = bind();
  admit(bc, newContributor('c1', { outputType: 'BOOL', outputWidth: 3 }));
  admit(bc, newContributor('c2', { outputType: 'BOOL', outputWidth: 3 }));
  submit(bc, newTask(['c1', 'c2']));
  const b1 = bools([0, 1, 0]);
  const b2 = bools([0, 0, 1]);
  respond(bc, newResponse('c1', b1, d), b1);
  respond(bc, newResponse('c2', b2, d), b2);
  assert.equal(combine(bc, newTask(['c1', 'c2']), [
    { text: newResponse('c1', b1, d), payload: b1 },
    { text: newResponse('c2', b2, d), payload: b2 },
  ]).type, 'BOOL');
  // BYTES concat
  const { combiner: xc } = bind();
  admit(xc, newContributor('c1', { outputType: 'BYTES', outputWidth: 3 }));
  admit(xc, newContributor('c2', { outputType: 'BYTES', outputWidth: 3 }));
  submit(xc, newTask(['c1', 'c2']));
  const x1 = bytes('abc');
  const x2 = bytes('def');
  respond(xc, newResponse('c1', x1, d), x1);
  respond(xc, newResponse('c2', x2, d), x2);
  const xok = combine(xc, newTask(['c1', 'c2']), [
    { text: newResponse('c1', x1, d), payload: x1 },
    { text: newResponse('c2', x2, d), payload: x2 },
  ]);
  assert.equal(xok.ok, true);
  assert.equal(xok.type, 'BYTES');
  assert.equal(xok.combinedBytes, 6);
});

test('an I64 combine overflow is refused, never silently wrapped', () => {
  const { combiner: oc } = bind();
  admit(oc, newContributor('c1', { outputType: 'I64', outputWidth: 1 }));
  admit(oc, newContributor('c2', { outputType: 'I64', outputWidth: 1 }));
  submit(oc, newTask(['c1', 'c2']));
  const d = { task: taskDigest(['c1', 'c2']) };
  const big1 = i64([Number.MAX_SAFE_INTEGER]);
  const big2 = i64([2]);
  respond(oc, newResponse('c1', big1, d), big1);
  respond(oc, newResponse('c2', big2, d), big2);
  const overflow = combine(oc, newTask(['c1', 'c2']), [
    { text: newResponse('c1', big1, d), payload: big1 },
    { text: newResponse('c2', big2, d), payload: big2 },
  ]);
  assert.equal(overflow.ok, false);
  assert.equal(overflow.code, 'COMBINED_OVERFLOW_REFUSED');
});

test('a non-canonical task at combine is refused and a foreign task never combines', () => {
  const { combiner, digests } = readyCombiner();
  const p = f64([1, 2]);
  respond(combiner, newResponse('c1', p, digests), p);
  const foreign = combine(combiner, newTask(['c1'], { taskId: 'task-other' }), [
    { text: newResponse('c1', p, { task: taskDigest([]), taskId: 'task-other' }), payload: p },
  ]);
  assert.equal(foreign.ok, false);
  assert.equal(foreign.code, 'TASK_UNKNOWN');
  const ugly = newTask(['c1']).replace('"taskId"', '"taskId" ');
  assert.equal(combine(combiner, ugly, []).ok, false);
});

test('every outcome is frozen with all authority flags false', () => {
  const { combiner, digests } = readyCombiner();
  const p = f64([1, 2]);
  const r = respond(combiner, newResponse('c1', p, digests), p);
  for (const outcome of [r, combine(combiner, newTask(['c1']), [{ text: newResponse('c1', p, digests), payload: p }])]) {
    assert.equal(outcome.authorizing, false);
    assert.equal(outcome.modelExecuted, false);
    assert.equal(outcome.promotionGranted, false);
    assert.equal(outcome.certificationGranted, false);
  }
});
test('combine binds each entry to the response that was actually admitted', () => {
  // Previously combine() only checked that SOME admitted response existed for
  // the (taskId, contributorId) key and then trusted the caller's own record
  // and payload, so a fabricated record rode on a real admission.
  const { combiner, digests } = readyCombiner();
  const good = f64([1, 2]);
  const goodRec = newResponse('c1', good, digests);
  assert.equal(respond(combiner, goodRec, good).code, 'RESPONSE_ADMITTED');

  const forgedRec = newResponse('c1', good, digests, { taskDigest: '0'.repeat(64) });
  assert.equal(combine(combiner, newTask(['c1']), [{ text: forgedRec, payload: good }]).code,
    'RESPONSE_ADMITTED_RECORD_MISMATCH');

  const otherPayload = f64([9, 9]);
  const swapped = newResponse('c1', otherPayload, digests);
  assert.equal(combine(combiner, newTask(['c1']), [{ text: swapped, payload: otherPayload }]).code,
    'RESPONSE_ADMITTED_RECORD_MISMATCH');

  // the honest entry still combines
  assert.equal(combine(combiner, newTask(['c1']), [{ text: goodRec, payload: good }]).code,
    'TYPED_COMBINE_COMPLETE');
});

test('BYTES is not exempt from the declared width bound at combine time', () => {
  // domainValid's BYTES rule IS the width bound, and combine used to skip it,
  // certifying a declared width of 4 over a 4096-byte payload.
  const { combiner, r } = bind();
  assert.equal(r.ok, true);
  assert.equal(admit(combiner, newContributor('c1', { outputType: 'BYTES', outputWidth: 4, maxPayloadBytes: 4096 })).ok, true);
  assert.equal(submit(combiner, newTask(['c1'])).ok, true);
  const digests = { task: taskDigest(['c1']) };
  const oversized = Buffer.alloc(4096, 0x41);
  const rec = newResponse('c1', oversized, digests);
  assert.equal(respond(combiner, rec, oversized).code, 'PAYLOAD_TYPE_DOMAIN_INVALID');
  assert.equal(combine(combiner, newTask(['c1']), [{ text: rec, payload: oversized }]).code,
    'RESPONSE_NOT_ADMITTED');
  // exactly the declared width is admitted and combines
  const exact = Buffer.from('ABCD');
  const okRec = newResponse('c1', exact, digests);
  assert.equal(respond(combiner, okRec, exact).code, 'RESPONSE_ADMITTED');
  assert.equal(combine(combiner, newTask(['c1']), [{ text: okRec, payload: exact }]).code, 'TYPED_COMBINE_COMPLETE');
});

test('every declared type width bound is pinned, including I64', () => {
  // A mutation widening I64's maxWidth from 4096 to 8192 survived the suite.
  assert.equal(TYPED_TYPES.F32.maxWidth, 4096);
  assert.equal(TYPED_TYPES.F64.maxWidth, 4096);
  assert.equal(TYPED_TYPES.I64.maxWidth, 4096);
  assert.equal(TYPED_TYPES.I64.elementBytes, 8);
  assert.equal(TYPED_TYPES.BOOL.maxWidth, 8192);
  assert.equal(TYPED_TYPES.BYTES.maxWidth, 32768);
  assert.equal(TYPED_TYPES.STRING.maxWidth, 64);
  // a contributor beyond the declared ceiling is refused at admission
  const { combiner } = bind();
  assert.equal(admit(combiner, newContributor('c9', { outputType: 'I64', outputWidth: 4097 })).ok, false);
});
