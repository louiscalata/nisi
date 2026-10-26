// Protected owner-authored contract oracle (Claude, 2026-09-14; revision 3 after the second adversarial review). Drafters must not edit this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RENDER_RECEIPT_PROFILE_V1, RENDER_RECEIPT_LIMITS_V1, RENDER_RECEIPT_VERDICTS_V1, RENDER_RECEIPT_SOURCE_KINDS_V1,
  RENDER_RECEIPT_CHECK_KINDS_V1, RENDER_RECEIPT_OUTCOMES_V1, RENDER_RECEIPT_SCOPES_V1, RENDER_RECEIPT_CODES_V1,
  readRenderReceiptV1, digestRenderReceiptV1,
} from '../src/render-receipt-v1.mjs';

const D1 = '0'.repeat(63) + '1';
const D2 = '0'.repeat(63) + '2';
const check = (patch = {}) => ({ checkId: 'exr-nan', kind: 'validity', outcome: 'pass', measured: 0, threshold: 0, scope: 'cell', code: null, ...patch });
const review = (patch = {}) => ({ checkId: 'review', kind: 'quality', outcome: 'pass', measured: null, threshold: null, scope: 'row', code: null, ...patch });
const pass = () => ({
  schemaVersion: 1, profile: 'nisi-render-receipt-v1', tileId: 'shot-010', identity: D1, attempt: 0,
  source: { kind: 'worker', id: 'gen-gemma', model: 'google/gemma-4-26b-a4b-qat', block: 'mac-gpu' },
  candidate: D2, verdict: 'PASS',
  checks: [check(), review()],
  reviewer: { id: 'verifier-gptoss', model: 'openai/gpt-oss-20b' }, elapsedMs: 1234, tokens: 4321,
});
const replay = () => ({ ...pass(), source: { kind: 'journal', id: null, model: null, block: null }, verdict: 'REPLAY', checks: [], reviewer: null, elapsedMs: 2, tokens: null });
const vfail = () => ({ ...pass(), verdict: 'VALIDITY_FAIL', candidate: null, checks: [check({ outcome: 'fail', measured: 3, code: 'NAN_PIXELS' })], reviewer: null });
const qfail = () => ({ ...pass(), verdict: 'QUALITY_FAIL', checks: [check(), review({ outcome: 'fail', code: 'REVIEW_REJECTED' })] });
const stale = () => ({ ...pass(), verdict: 'APRON_STALE', checks: [], reviewer: null });
const assemble = () => ({ ...pass(), source: { kind: 'assemble', id: null, model: null, block: null } });
const LONE = String.fromCharCode(0xD800);
// every accepted receipt must re-read as accepted and must digest (no foreign codec errors)
const ok = (input, why) => {
  const r = readRenderReceiptV1(input);
  assert.equal(r.ok, true, why || JSON.stringify(r));
  assert.equal(readRenderReceiptV1(r.receipt).ok, true, 'read is idempotent');
  assert.match(digestRenderReceiptV1(r.receipt), /^[0-9a-f]{64}$/);
  assert.equal(digestRenderReceiptV1(input), digestRenderReceiptV1(r.receipt));
  return r;
};
const refuse = (input, code, path) => {
  const r = readRenderReceiptV1(input);
  assert.deepEqual({ ok: r.ok, code: r.code, path: r.path }, { ok: false, code, path });
  assert.deepEqual(Object.keys(r).sort(), ['code', 'ok', 'path', 'profile']);
  assert.ok(Object.isFrozen(r));
};
const deepFrozen = (x, seen = new Set()) => {
  if (!x || typeof x !== 'object' || seen.has(x)) return true;
  seen.add(x);
  return Object.isFrozen(x) && Object.values(x).every(v => deepFrozen(v, seen));
};

test('constants', () => {
  assert.equal(RENDER_RECEIPT_PROFILE_V1, 'nisi-render-receipt-v1');
  assert.deepEqual(RENDER_RECEIPT_LIMITS_V1, { checks: 256, idLength: 128, modelLength: 128, textLength: 256 });
  assert.deepEqual(RENDER_RECEIPT_VERDICTS_V1, ['PASS', 'VALIDITY_FAIL', 'QUALITY_FAIL', 'APRON_STALE', 'REPLAY']);
  assert.deepEqual(RENDER_RECEIPT_SOURCE_KINDS_V1, ['worker', 'journal', 'assemble']);
  assert.deepEqual(RENDER_RECEIPT_CHECK_KINDS_V1, ['validity', 'quality']);
  assert.deepEqual(RENDER_RECEIPT_OUTCOMES_V1, ['pass', 'fail', 'not_run']);
  assert.deepEqual(RENDER_RECEIPT_SCOPES_V1, ['cell', 'row', 'frame']);
  assert.deepEqual(RENDER_RECEIPT_CODES_V1, [
    'RENDER_RECEIPT_NOT_OBJECT', 'RENDER_RECEIPT_UNKNOWN_MEMBER', 'RENDER_RECEIPT_MISSING_MEMBER', 'RENDER_RECEIPT_SCHEMA_VERSION',
    'RENDER_RECEIPT_PROFILE', 'RENDER_RECEIPT_ID', 'RENDER_RECEIPT_IDENTITY', 'RENDER_RECEIPT_ATTEMPT', 'RENDER_RECEIPT_SOURCE',
    'RENDER_RECEIPT_CANDIDATE', 'RENDER_RECEIPT_VERDICT', 'RENDER_RECEIPT_CHECKS', 'RENDER_RECEIPT_REVIEWER', 'RENDER_RECEIPT_ELAPSED',
    'RENDER_RECEIPT_TOKENS', 'RENDER_RECEIPT_CONSISTENCY']);
  for (const c of [RENDER_RECEIPT_LIMITS_V1, RENDER_RECEIPT_VERDICTS_V1, RENDER_RECEIPT_SOURCE_KINDS_V1, RENDER_RECEIPT_CHECK_KINDS_V1, RENDER_RECEIPT_OUTCOMES_V1, RENDER_RECEIPT_SCOPES_V1, RENDER_RECEIPT_CODES_V1]) assert.ok(Object.isFrozen(c));
});

test('every verdict has a valid shape and reads to an ordered, deep-frozen copy', () => {
  for (const f of [pass, replay, vfail, qfail, stale, assemble]) ok(f());
  const input = pass();
  const r = ok(input);
  assert.deepEqual(Object.keys(r), ['ok', 'profile', 'receipt']);
  assert.deepEqual(Object.keys(r.receipt), ['schemaVersion', 'profile', 'tileId', 'identity', 'attempt', 'source', 'candidate', 'verdict', 'checks', 'reviewer', 'elapsedMs', 'tokens']);
  assert.deepEqual(Object.keys(r.receipt.source), ['kind', 'id', 'model', 'block']);
  assert.deepEqual(Object.keys(r.receipt.checks[0]), ['checkId', 'kind', 'outcome', 'measured', 'threshold', 'scope', 'code']);
  assert.deepEqual(Object.keys(r.receipt.reviewer), ['id', 'model']);
  assert.ok(deepFrozen(r) && deepFrozen(r.receipt));
  input.checks[0].measured = 99; input.reviewer.id = 'someone-else';
  assert.equal(r.receipt.checks[0].measured, 0);
  assert.equal(r.receipt.reviewer.id, 'verifier-gptoss');
  const unordered = JSON.parse(JSON.stringify(pass()));
  const scrambled = { tokens: unordered.tokens, elapsedMs: unordered.elapsedMs, reviewer: { model: unordered.reviewer.model, id: unordered.reviewer.id }, checks: unordered.checks, verdict: unordered.verdict, candidate: unordered.candidate, source: { block: 'mac-gpu', model: unordered.source.model, id: unordered.source.id, kind: 'worker' }, attempt: 0, identity: D1, tileId: 'shot-010', profile: unordered.profile, schemaVersion: 1 };
  assert.deepEqual(Object.keys(ok(scrambled).receipt), Object.keys(r.receipt));
});

test('reader never throws and refuses non-objects', () => {
  for (const bad of [null, undefined, 'x', 1, 1n, true, [], () => {}, Symbol('s'), new Date(0), new Map()]) refuse(bad, 'RENDER_RECEIPT_NOT_OBJECT', '$');
});

test('unknown and missing members at every level', () => {
  refuse({ ...pass(), extra: 1 }, 'RENDER_RECEIPT_UNKNOWN_MEMBER', '$.extra');
  refuse({ ...pass(), extra: 1, verdict: 'bad' }, 'RENDER_RECEIPT_UNKNOWN_MEMBER', '$.extra');
  refuse({ ...pass(), source: { ...pass().source, extra: 1 } }, 'RENDER_RECEIPT_UNKNOWN_MEMBER', '$.source.extra');
  refuse({ ...pass(), checks: [{ ...check(), extra: 1 }, review()] }, 'RENDER_RECEIPT_UNKNOWN_MEMBER', '$.checks[0].extra');
  refuse({ ...pass(), reviewer: { ...pass().reviewer, extra: 1 } }, 'RENDER_RECEIPT_UNKNOWN_MEMBER', '$.reviewer.extra');
  refuse(JSON.parse('{"__proto__":1}'), 'RENDER_RECEIPT_UNKNOWN_MEMBER', '$.__proto__');
  const m1 = pass(); delete m1.tokens; refuse(m1, 'RENDER_RECEIPT_MISSING_MEMBER', '$.tokens');
  const m2 = pass(); delete m2.source.block; refuse(m2, 'RENDER_RECEIPT_MISSING_MEMBER', '$.source.block');
  const m3 = pass(); delete m3.checks[1].scope; refuse(m3, 'RENDER_RECEIPT_MISSING_MEMBER', '$.checks[1].scope');
  const m4 = pass(); delete m4.reviewer.model; refuse(m4, 'RENDER_RECEIPT_MISSING_MEMBER', '$.reviewer.model');
});

test('scalar members', () => {
  refuse({ ...pass(), schemaVersion: '1' }, 'RENDER_RECEIPT_SCHEMA_VERSION', '$.schemaVersion');
  refuse({ ...pass(), profile: 'nisi-render-receipt-v2' }, 'RENDER_RECEIPT_PROFILE', '$.profile');
  for (const id of ['', '-a', 'a b', 'a'.repeat(129), 7, null]) refuse({ ...pass(), tileId: id }, 'RENDER_RECEIPT_ID', '$.tileId');
  for (const d of ['abc', 'A'.repeat(64), null, 7]) refuse({ ...pass(), identity: d }, 'RENDER_RECEIPT_IDENTITY', '$.identity');
  for (const a of [-1, 1.5, '0', -0, null]) refuse({ ...pass(), attempt: a }, 'RENDER_RECEIPT_ATTEMPT', '$.attempt');
  for (const c of ['abc', 'A'.repeat(64), 7, undefined]) refuse({ ...pass(), candidate: c }, 'RENDER_RECEIPT_CANDIDATE', '$.candidate');
  refuse({ ...pass(), verdict: 'MAYBE' }, 'RENDER_RECEIPT_VERDICT', '$.verdict');
  for (const e of [-1, 1.5, '1', null]) refuse({ ...pass(), elapsedMs: e }, 'RENDER_RECEIPT_ELAPSED', '$.elapsedMs');
  for (const t of [-1, 1.5, '1', undefined]) refuse({ ...pass(), tokens: t }, 'RENDER_RECEIPT_TOKENS', '$.tokens');
  ok({ ...pass(), elapsedMs: 0, tokens: 0 });
});

test('source', () => {
  const src = (patch) => ({ ...pass(), source: { ...pass().source, ...patch } });
  refuse({ ...pass(), source: null }, 'RENDER_RECEIPT_SOURCE', '$.source');
  refuse({ ...pass(), source: [] }, 'RENDER_RECEIPT_SOURCE', '$.source');
  refuse(src({ kind: 'cloud' }), 'RENDER_RECEIPT_SOURCE', '$.source.kind');
  refuse(src({ id: 'bad id' }), 'RENDER_RECEIPT_SOURCE', '$.source.id');
  refuse(src({ id: 7 }), 'RENDER_RECEIPT_SOURCE', '$.source.id');
  refuse(src({ model: '' }), 'RENDER_RECEIPT_SOURCE', '$.source.model');
  refuse(src({ model: 'm'.repeat(129) }), 'RENDER_RECEIPT_SOURCE', '$.source.model');
  refuse(src({ block: '' }), 'RENDER_RECEIPT_SOURCE', '$.source.block');
  refuse(src({ model: 'm' + LONE }), 'RENDER_RECEIPT_SOURCE', '$.source.model');
  refuse(src({ block: 7 }), 'RENDER_RECEIPT_SOURCE', '$.source.block');
  ok(src({ model: 'm'.repeat(128), block: 'b'.repeat(128), id: 'i'.repeat(128) }));
  ok(src({ model: String.fromCodePoint(0x1F600).repeat(64) }));
  refuse(src({ model: String.fromCodePoint(0x1F600).repeat(65) }), 'RENDER_RECEIPT_SOURCE', '$.source.model');
  ok(src({ model: null, block: null }));
});

test('checks', () => {
  const withChecks = (checks) => ({ ...pass(), checks });
  refuse(withChecks(null), 'RENDER_RECEIPT_CHECKS', '$.checks');
  refuse(withChecks('x'), 'RENDER_RECEIPT_CHECKS', '$.checks');
  refuse(withChecks(new Array(257).fill(0).map((_, i) => check({ checkId: 'c' + i }))), 'RENDER_RECEIPT_CHECKS', '$.checks');
  refuse(withChecks([check(), 'x']), 'RENDER_RECEIPT_CHECKS', '$.checks[1]');
  refuse(withChecks([check(), null]), 'RENDER_RECEIPT_CHECKS', '$.checks[1]');
  refuse(withChecks([check({ checkId: '' }), review()]), 'RENDER_RECEIPT_CHECKS', '$.checks[0].checkId');
  refuse(withChecks([check(), review({ checkId: 'exr-nan' })]), 'RENDER_RECEIPT_CHECKS', '$.checks[1].checkId');
  refuse(withChecks([check({ kind: 'style' }), review()]), 'RENDER_RECEIPT_CHECKS', '$.checks[0].kind');
  refuse(withChecks([check({ outcome: 'maybe' }), review()]), 'RENDER_RECEIPT_CHECKS', '$.checks[0].outcome');
  refuse(withChecks([check({ measured: NaN }), review()]), 'RENDER_RECEIPT_CHECKS', '$.checks[0].measured');
  refuse(withChecks([check({ measured: Infinity }), review()]), 'RENDER_RECEIPT_CHECKS', '$.checks[0].measured');
  refuse(withChecks([check({ measured: 'x'.repeat(257) }), review()]), 'RENDER_RECEIPT_CHECKS', '$.checks[0].measured');
  refuse(withChecks([check({ threshold: true }), review()]), 'RENDER_RECEIPT_CHECKS', '$.checks[0].threshold');
  refuse(withChecks([check({ scope: 'shot' }), review()]), 'RENDER_RECEIPT_CHECKS', '$.checks[0].scope');
  refuse(withChecks([check({ code: 'lowercase' }), review()]), 'RENDER_RECEIPT_CHECKS', '$.checks[0].code');
  refuse(withChecks([check({ code: '' }), review()]), 'RENDER_RECEIPT_CHECKS', '$.checks[0].code');
  refuse(withChecks([check({ code: 'C'.repeat(65) }), review()]), 'RENDER_RECEIPT_CHECKS', '$.checks[0].code');
  ok(withChecks([check({ code: 'C'.repeat(64), checkId: 'c'.repeat(128) }), review()]));
  refuse({ ...vfail(), checks: [check({ outcome: 'fail', code: null })] }, 'RENDER_RECEIPT_CHECKS', '$.checks[0].code');
  refuse(withChecks([JSON.parse('{"__proto__":1}'), review()]), 'RENDER_RECEIPT_UNKNOWN_MEMBER', '$.checks[0].__proto__');
  ok(withChecks([check({ measured: -2, threshold: 'below 2' }), review({ outcome: 'pass', measured: 'good' })]));
  for (const bad of [0.5, -1.5, 2 ** 53, -0, 1e21, 'x' + LONE, 'y'.repeat(256) + LONE]) refuse(withChecks([check({ measured: bad }), review()]), 'RENDER_RECEIPT_CHECKS', '$.checks[0].measured');
  ok(withChecks([check({ measured: 2 ** 53 - 1, threshold: -(2 ** 53 - 1) }), review({ measured: 'm'.repeat(256), threshold: '' })]));
  ok(withChecks([check({ measured: String.fromCodePoint(0x1F600).repeat(128) }), review()]), 'TEXT length is UTF-16 code units');
  refuse(withChecks([check({ measured: String.fromCodePoint(0x1F600).repeat(129) }), review()]), 'RENDER_RECEIPT_CHECKS', '$.checks[0].measured');
  ok(withChecks(new Array(256).fill(0).map((_, i) => check({ checkId: 'c' + i })).concat([review()]).slice(0, 256).map((c, i) => i === 255 ? review() : c)));
});

test('reviewer', () => {
  const rev = (patch) => ({ ...pass(), reviewer: { ...pass().reviewer, ...patch } });
  refuse({ ...pass(), reviewer: [] }, 'RENDER_RECEIPT_REVIEWER', '$.reviewer');
  refuse({ ...pass(), reviewer: 'v' }, 'RENDER_RECEIPT_REVIEWER', '$.reviewer');
  refuse(rev({ id: '' }), 'RENDER_RECEIPT_REVIEWER', '$.reviewer.id');
  refuse(rev({ id: null }), 'RENDER_RECEIPT_REVIEWER', '$.reviewer.id');
  refuse(rev({ model: '' }), 'RENDER_RECEIPT_REVIEWER', '$.reviewer.model');
  refuse(rev({ model: 'm'.repeat(129) }), 'RENDER_RECEIPT_REVIEWER', '$.reviewer.model');
  refuse(rev({ model: 'm' + LONE }), 'RENDER_RECEIPT_REVIEWER', '$.reviewer.model');
  ok(rev({ model: 'm'.repeat(128), id: 'r'.repeat(128) }));
  ok(rev({ model: null }));
});

test('consistency: source kind and id', () => {
  refuse({ ...pass(), source: { ...pass().source, id: null } }, 'RENDER_RECEIPT_CONSISTENCY', '$.source.id');
  refuse({ ...replay(), source: { kind: 'journal', id: 'x', model: null, block: null } }, 'RENDER_RECEIPT_CONSISTENCY', '$.source.id');
  refuse({ ...assemble(), source: { kind: 'assemble', id: 'x', model: null, block: null } }, 'RENDER_RECEIPT_CONSISTENCY', '$.source.id');
  refuse({ ...pass(), source: { kind: 'journal', id: null, model: null, block: null } }, 'RENDER_RECEIPT_CONSISTENCY', '$.source.kind');
  refuse({ ...replay(), source: { kind: 'worker', id: 'w', model: null, block: null } }, 'RENDER_RECEIPT_CONSISTENCY', '$.source.kind');
});

test('consistency: REPLAY and APRON_STALE carry no judgement', () => {
  refuse({ ...replay(), checks: [check()] }, 'RENDER_RECEIPT_CONSISTENCY', '$.checks');
  refuse({ ...replay(), reviewer: pass().reviewer }, 'RENDER_RECEIPT_CONSISTENCY', '$.reviewer');
  refuse({ ...replay(), candidate: null }, 'RENDER_RECEIPT_CONSISTENCY', '$.candidate');
  refuse({ ...stale(), checks: [check()] }, 'RENDER_RECEIPT_CONSISTENCY', '$.checks');
  refuse({ ...stale(), reviewer: pass().reviewer }, 'RENDER_RECEIPT_CONSISTENCY', '$.reviewer');
  ok({ ...stale(), candidate: null });
});

test('consistency: PASS', () => {
  refuse({ ...pass(), candidate: null }, 'RENDER_RECEIPT_CONSISTENCY', '$.candidate');
  refuse({ ...pass(), reviewer: null }, 'RENDER_RECEIPT_CONSISTENCY', '$.reviewer');
  refuse({ ...pass(), reviewer: { id: 'gen-gemma', model: null } }, 'RENDER_RECEIPT_CONSISTENCY', '$.reviewer.id');
  refuse({ ...pass(), checks: [check({ outcome: 'fail', code: 'X' }), review()] }, 'RENDER_RECEIPT_CONSISTENCY', '$.checks');
  refuse({ ...pass(), checks: [check()] }, 'RENDER_RECEIPT_CONSISTENCY', '$.checks');
  refuse({ ...pass(), checks: [review()] }, 'RENDER_RECEIPT_CONSISTENCY', '$.checks');
  refuse({ ...pass(), checks: [check({ outcome: 'not_run' }), review()] }, 'RENDER_RECEIPT_CONSISTENCY', '$.checks');
  ok({ ...pass(), checks: [check(), check({ checkId: 'skipped', outcome: 'not_run' }), review()] });
  ok({ ...assemble(), reviewer: { id: 'verifier', model: null } });
});

test('consistency: VALIDITY_FAIL and QUALITY_FAIL', () => {
  refuse({ ...vfail(), checks: [check()] }, 'RENDER_RECEIPT_CONSISTENCY', '$.checks');
  refuse({ ...vfail(), checks: [review({ outcome: 'fail', code: 'X' })] }, 'RENDER_RECEIPT_CONSISTENCY', '$.checks');
  ok({ ...vfail(), reviewer: pass().reviewer });
  ok({ ...vfail(), candidate: D2 });
  refuse({ ...qfail(), checks: [check({ outcome: 'fail', code: 'X' }), review({ outcome: 'fail', code: 'Y' })] }, 'RENDER_RECEIPT_CONSISTENCY', '$.checks');
  refuse({ ...qfail(), checks: [check(), review()] }, 'RENDER_RECEIPT_CONSISTENCY', '$.checks');
  refuse({ ...qfail(), reviewer: null }, 'RENDER_RECEIPT_CONSISTENCY', '$.reviewer');
  refuse({ ...qfail(), reviewer: { id: 'gen-gemma', model: null } }, 'RENDER_RECEIPT_CONSISTENCY', '$.reviewer.id');
});

test('digest is pinned, order-independent, and refuses what the reader refuses', () => {
  assert.equal(digestRenderReceiptV1(pass()), '8fd3552fa31c07273380fadc49d51eed2be00d07fd9c925960672230cec45d99');
  assert.equal(digestRenderReceiptV1(replay()), '35de9571e03045ff7e9e178c2b008c0af048211522bef181b9e5e70874aa6813');
  const scrambled = { tokens: 4321, elapsedMs: 1234, reviewer: { model: 'openai/gpt-oss-20b', id: 'verifier-gptoss' }, checks: pass().checks, verdict: 'PASS', candidate: D2, source: { block: 'mac-gpu', model: 'google/gemma-4-26b-a4b-qat', id: 'gen-gemma', kind: 'worker' }, attempt: 0, identity: D1, tileId: 'shot-010', profile: 'nisi-render-receipt-v1', schemaVersion: 1 };
  assert.equal(digestRenderReceiptV1(scrambled), digestRenderReceiptV1(pass()));
  assert.equal(digestRenderReceiptV1(readRenderReceiptV1(pass()).receipt), digestRenderReceiptV1(pass()));
  assert.notEqual(digestRenderReceiptV1({ ...pass(), elapsedMs: 1235 }), digestRenderReceiptV1(pass()));
  assert.throws(() => digestRenderReceiptV1({ ...pass(), verdict: 'MAYBE' }), (e) => e instanceof Error && e.code === 'RENDER_RECEIPT_VERDICT');
  assert.throws(() => digestRenderReceiptV1(null), (e) => e.code === 'RENDER_RECEIPT_NOT_OBJECT');
  assert.throws(() => digestRenderReceiptV1({ ...pass(), reviewer: null }), (e) => e.code === 'RENDER_RECEIPT_CONSISTENCY');
});

test('hostile inputs are refused, never thrown on', () => {
  const getter = pass(); Object.defineProperty(getter, 'verdict', { get() { throw new Error('boom'); }, enumerable: true });
  refuse(getter, 'RENDER_RECEIPT_NOT_OBJECT', '$');
  let reads = 0; const flip = pass(); Object.defineProperty(flip, 'elapsedMs', { get() { return reads++ === 0 ? 1 : -1; }, enumerable: true });
  refuse(flip, 'RENDER_RECEIPT_NOT_OBJECT', '$');
  refuse(new Proxy(pass(), { getPrototypeOf() { throw new Error('trap'); } }), 'RENDER_RECEIPT_NOT_OBJECT', '$');
  refuse(new Proxy(pass(), { ownKeys() { throw new Error('trap'); } }), 'RENDER_RECEIPT_NOT_OBJECT', '$');
  class Sub extends Array {}
  refuse({ ...pass(), checks: Sub.from(pass().checks) }, 'RENDER_RECEIPT_NOT_OBJECT', '$');
  refuse({ ...pass(), checks: Object.setPrototypeOf(pass().checks, null) }, 'RENDER_RECEIPT_NOT_OBJECT', '$');
  refuse({ ...pass(), checks: Object.assign(pass().checks, { map: () => [{ anything: 'at all' }] }) }, 'RENDER_RECEIPT_NOT_OBJECT', '$');
  const species = pass().checks; species.constructor = { [Symbol.species]: function () { return Object.freeze({}); } };
  refuse({ ...pass(), checks: species }, 'RENDER_RECEIPT_NOT_OBJECT', '$');
  const sym = pass(); sym[Symbol('extra')] = 1;
  refuse(sym, 'RENDER_RECEIPT_NOT_OBJECT', '$');
  const hidden = pass(); Object.defineProperty(hidden, 'tokens', { value: null, enumerable: false });
  refuse(hidden, 'RENDER_RECEIPT_NOT_OBJECT', '$');
  const deep = JSON.parse('['.repeat(20000) + ']'.repeat(20000));
  refuse({ ...pass(), checks: deep }, 'RENDER_RECEIPT_NOT_OBJECT', '$');
  const cyc = pass(); cyc.checks[0].measured = cyc;
  refuse(cyc, 'RENDER_RECEIPT_NOT_OBJECT', '$');
  const r = readRenderReceiptV1(pass());
  assert.equal(Object.getPrototypeOf(r.receipt.checks), Array.prototype);
});

test('check order: the first-listed failure wins', () => {
  const both = { ...pass(), source: { ...pass().source, extra: 1 } }; delete both.source.block;
  refuse(both, 'RENDER_RECEIPT_UNKNOWN_MEMBER', '$.source.extra');
  refuse({ ...pass(), candidate: 'zz', verdict: 'MAYBE' }, 'RENDER_RECEIPT_CANDIDATE', '$.candidate');
  refuse({ ...pass(), checks: [check(), review({ checkId: 'exr-nan', kind: 'style' })] }, 'RENDER_RECEIPT_CHECKS', '$.checks[1].checkId');
  refuse({ ...pass(), source: { ...pass().source, id: null }, verdict: 'REPLAY' }, 'RENDER_RECEIPT_CONSISTENCY', '$.source.id');
  refuse({ ...replay(), checks: [check()], reviewer: pass().reviewer }, 'RENDER_RECEIPT_CONSISTENCY', '$.checks');
  refuse({ ...pass(), reviewer: null, checks: [check({ outcome: 'fail', code: 'X' }), review()] }, 'RENDER_RECEIPT_CONSISTENCY', '$.reviewer');
  refuse({ ...pass(), reviewer: { id: 'gen-gemma', model: null }, checks: [check({ outcome: 'fail', code: 'X' }), review()] }, 'RENDER_RECEIPT_CONSISTENCY', '$.reviewer.id');
  refuse({ ...qfail(), checks: [check({ outcome: 'fail', code: 'X' }), review({ outcome: 'fail', code: 'Y' })], reviewer: null }, 'RENDER_RECEIPT_CONSISTENCY', '$.checks');
  refuse({ ...stale(), checks: [check()], reviewer: pass().reviewer }, 'RENDER_RECEIPT_CONSISTENCY', '$.checks');
  refuse({ ...pass(), candidate: null, reviewer: null }, 'RENDER_RECEIPT_CONSISTENCY', '$.candidate');
  refuse({ ...replay(), checks: [check()], candidate: null }, 'RENDER_RECEIPT_CONSISTENCY', '$.checks');
  refuse({ ...qfail(), checks: [check(), review()], reviewer: null }, 'RENDER_RECEIPT_CONSISTENCY', '$.checks');
  refuse({ ...pass(), reviewer: { id: 'v', extra: 1 } }, 'RENDER_RECEIPT_UNKNOWN_MEMBER', '$.reviewer.extra');
  refuse({ ...pass(), schemaVersion: 2, profile: 'x' }, 'RENDER_RECEIPT_SCHEMA_VERSION', '$.schemaVersion');
  refuse({ ...pass(), identity: 'zz', attempt: -1 }, 'RENDER_RECEIPT_IDENTITY', '$.identity');
  refuse({ ...pass(), source: { ...pass().source, kind: 'cloud', id: 7 } }, 'RENDER_RECEIPT_SOURCE', '$.source.kind');
  refuse({ ...pass(), checks: [check({ kind: 'style', outcome: 'maybe' }), review()] }, 'RENDER_RECEIPT_CHECKS', '$.checks[0].kind');
  refuse({ ...pass(), elapsedMs: -1, tokens: -1 }, 'RENDER_RECEIPT_ELAPSED', '$.elapsedMs');
  refuse({ ...pass(), tileId: '', identity: 'zz' }, 'RENDER_RECEIPT_ID', '$.tileId');
  refuse({ ...vfail(), checks: [check()], reviewer: { id: 'gen-gemma', model: null } }, 'RENDER_RECEIPT_CONSISTENCY', '$.checks');
  refuse({ ...pass(), reviewer: { id: 'gen-gemma', model: null }, checks: [check()] }, 'RENDER_RECEIPT_CONSISTENCY', '$.reviewer.id');
});

test('nested accessors and proxies are refused; shared references are copied, not refused', () => {
  const withGetter = (obj, key, get) => { Object.defineProperty(obj, key, { get, enumerable: true }); return obj; };
  const a = pass(); withGetter(a.source, 'id', () => { throw new Error('boom'); });
  refuse(a, 'RENDER_RECEIPT_NOT_OBJECT', '$');
  let n = 0; const b = pass(); withGetter(b.source, 'id', () => n++ === 0 ? 'gen-gemma' : 'other');
  refuse(b, 'RENDER_RECEIPT_NOT_OBJECT', '$');
  const c = pass(); withGetter(c.checks[0], 'measured', () => 0);
  refuse(c, 'RENDER_RECEIPT_NOT_OBJECT', '$');
  const d = pass(); withGetter(d.reviewer, 'id', () => 'verifier-gptoss');
  refuse(d, 'RENDER_RECEIPT_NOT_OBJECT', '$');
  ok({ ...pass(), source: new Proxy(pass().source, { get() { throw new Error('trap'); } }) }, 'the reader never uses [[Get]] on the input, only descriptor reads');
  refuse({ ...pass(), source: new Proxy(pass().source, { getOwnPropertyDescriptor() { throw new Error('trap'); } }) }, 'RENDER_RECEIPT_NOT_OBJECT', '$');
  refuse({ ...pass(), checks: [new Proxy(check(), { ownKeys() { throw new Error('trap'); } }), review()] }, 'RENDER_RECEIPT_NOT_OBJECT', '$');
  const shared = check();
  refuse({ ...pass(), checks: [shared, shared] }, 'RENDER_RECEIPT_CHECKS', '$.checks[1].checkId');
  const empty = [];
  refuse({ ...pass(), checks: empty, tokens: empty }, 'RENDER_RECEIPT_TOKENS', '$.tokens');
  const same = { kind: 'worker', id: 'w', model: null, block: null };
  refuse({ ...pass(), source: same, reviewer: same }, 'RENDER_RECEIPT_UNKNOWN_MEMBER', '$.reviewer.kind');
  const nestArr = (k) => { let v = 1; for (let i = 0; i < k; i++) v = [v]; return v; };
  refuse({ ...pass(), tokens: nestArr(64) }, 'RENDER_RECEIPT_TOKENS', '$.tokens');
  refuse({ ...pass(), tokens: nestArr(65) }, 'RENDER_RECEIPT_NOT_OBJECT', '$');
  refuse({ ...pass(), tokens: () => 1 }, 'RENDER_RECEIPT_TOKENS', '$.tokens');
  refuse({ ...pass(), ['k'.repeat(4097)]: 1 }, 'RENDER_RECEIPT_NOT_OBJECT', '$');
  let expo = { s: 'a'.repeat(10000) };
  for (let i = 0; i < 16; i++) expo = { l: expo, r: expo };
  refuse({ ...pass(), tokens: expo }, 'RENDER_RECEIPT_NOT_OBJECT', '$');
});

