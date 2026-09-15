// Synthetic accounting correctness only, not a live-model performance benchmark.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyntheticPairedTrial as fixture } from '../evaluation/fixtures/paired-example-v1.mjs';
import { validatePairedTrialV1 as validate } from '../evaluation/paired-trial-v1.mjs';
const refused = fn => assert.throws(fn, e => e instanceof Error && typeof e.code === 'string' && e.code.startsWith('TRIAL_'));
const arms = v => v.pairs.flatMap(p => [p.off, p.on]);
const expected = { pairs: 2,
  off: { accepted: 1, incorrectCompletions: 1, totalTokens: 200, totalDurationMs: 2000, totalRepairs: 2 },
  on: { accepted: 2, incorrectCompletions: 0, totalTokens: 100, totalDurationMs: 1500, totalRepairs: 0 },
  delta: { accepted: 1, incorrectCompletions: -1, totalTokens: -100, totalDurationMs: -500, totalRepairs: -2 },
  savings: { tokensPercent: 50, durationPercent: 25 } };

test('paired fixture has exact independent-arm metrics and explicitly nonauthorizing flags', () => {
  const c = fixture(), r = validate(c); assert.deepEqual(r.metrics, expected); assert.equal(r.status, 'COMPLETE');
  assert.equal(r.schemaVersion, 'nisi-paired-trial-analysis-v1'); assert.equal(r.pairCount, 2);
  assert.deepEqual(r.reasons, []); assert.deepEqual(r.rows, c.pairs);
  assert.deepEqual(Object.keys(r).sort(), ['schemaVersion','status','pairCount','rows','reasons','metrics','measurementVerified','causalClaim','authorizing'].sort());
  for (const key of ['measurementVerified', 'causalClaim', 'authorizing']) assert.equal(r[key], false);
});
test('paired output recursively freezes independent copies without freezing caller records', () => {
  const c = fixture(), fresh = fixture(), r = validate(c);
  const visit = value => { if (value && typeof value === 'object') { assert(Object.isFrozen(value)); for (const child of Object.values(value)) visit(child); } };
  visit(r); assert.notEqual(r.rows, c.pairs); assert.notEqual(r.rows[0].off.tokenUsage, c.pairs[0].off.tokenUsage);
  c.pairs[0].off.tokenUsage.input = 999; c.pairs.reverse();
  assert.deepEqual(r.rows, fresh.pairs); assert.equal(Object.isFrozen(c), false); assert.deepEqual(fixture(), fresh);
  assert.throws(() => { r.rows[0].off.tokenUsage.input = 3; }, TypeError);
  assert.throws(() => { r.metrics.off.totalTokens = 0; }, TypeError);
});
test('unknown telemetry remains unknown and suppresses all metrics while preserving rows', () => {
  const c = fixture(); c.pairs[0].off.tokenUsage = null; c.pairs[0].on.durationMs = null; c.pairs[1].on.repairAttempts = null;
  const r = validate(c); assert.equal(r.status, 'INCOMPLETE'); assert.equal(r.metrics, null); assert.deepEqual(r.rows, c.pairs);
  assert.deepEqual(r.reasons, [{ caseId: 'case.one', arm: 'off', code: 'TOKENS_UNKNOWN' },
    { caseId: 'case.one', arm: 'on', code: 'DURATION_UNKNOWN' }, { caseId: 'case.two', arm: 'on', code: 'REPAIRS_UNKNOWN' }]);
});
for (const outcome of ['NOT_RUN', 'ERROR', 'INCONCLUSIVE']) test('incomplete outcome ' + outcome + ' cannot earn aggregate success', () => {
  const c = fixture(); c.pairs[0].on.outcome = outcome; const r = validate(c);
  assert.equal(r.status, 'INCOMPLETE'); assert.equal(r.metrics, null); assert.equal(r.rows.length, 2);
  assert.deepEqual(r.reasons, [{ caseId: 'case.one', arm: 'on', code: 'OUTCOME_INCOMPLETE' }]);
});
test('every incomplete reason retains deterministic pair arm and reason order', () => {
  const c = fixture(); for (const a of arms(c)) Object.assign(a, { outcome: 'ERROR', tokenUsage: null, durationMs: null, repairAttempts: null });
  const r = validate(c); assert.equal(r.reasons.length, 16); assert.equal(r.metrics, null);
  assert.deepEqual(r.reasons, c.pairs.flatMap(p => ['off', 'on'].flatMap(arm =>
    ['OUTCOME_INCOMPLETE','TOKENS_UNKNOWN','DURATION_UNKNOWN','REPAIRS_UNKNOWN'].map(code => ({ caseId:p.caseId,arm,code })))));
  assert(Object.isFrozen(r.reasons[0]));
});
test('false completion is an adverse measurable result not a schema refusal', () => {
  const c = fixture(); c.pairs[0].on.outcome = 'FAIL';
  const r = validate(c); assert.equal(r.status, 'COMPLETE'); assert.equal(r.metrics.on.incorrectCompletions, 1);
  c.pairs[0].on.completionClaim = false; assert.equal(validate(c).metrics.on.incorrectCompletions, 0);
  c.pairs[0].on.outcome = 'PASS'; assert.equal(validate(c).metrics.on.accepted, 2);
});
test('stale candidate oracle identity is rejected separately for every arm', () => {
  for (let i = 0; i < 4; i++) { const c = fixture(); arms(c)[i].oracleCandidateSha256 = 'f'.repeat(64); refused(() => validate(c)); }
});
test('duplicate cases and global run identifiers cannot inflate sample count', () => {
  let c = fixture(); c.pairs[1].caseId = c.pairs[0].caseId; refused(() => validate(c));
  for (let i = 1; i < 4; i++) { c = fixture(); arms(c)[i].runId = arms(c)[0].runId; refused(() => validate(c)); }
});
test('each paired model setting toolchain and budget mismatch is refused', () => {
  for (const key of ['model','modelSettingsSha256','toolchainSha256','resourceBudgetSha256']) {
    const c = fixture(); c.pairs[0].on[key] = key === 'model' ? 'different.model' : '0'.repeat(64); refused(() => validate(c));
  }
});
test('different pairs may use different matched models and repeated budgets', () => {
  const c = fixture(); c.pairs[1].off.model = c.pairs[1].on.model = 'different.model';
  c.pairs[1].off.resourceBudgetSha256 = c.pairs[1].on.resourceBudgetSha256 = c.pairs[0].off.resourceBudgetSha256;
  assert.equal(validate(c).status, 'COMPLETE'); assert.deepEqual(validate(c).metrics, expected);
});
test('zero reference cost has undefined savings not a fabricated zero or hundred percent', () => {
  const c = fixture(); for (const p of c.pairs) { p.off.tokenUsage = { input:0,output:0 }; p.off.durationMs = 0; }
  const r = validate(c); assert.equal(r.metrics.savings.tokensPercent, null); assert.equal(r.metrics.savings.durationPercent, null);
  assert.equal(r.metrics.delta.totalTokens, 100);
});
test('negative and fractional savings are preserved without clamping or integer truncation', () => {
  const c = fixture(); c.pairs = [c.pairs[0]]; c.pairs[0].off.tokenUsage = { input:3,output:0 }; c.pairs[0].on.tokenUsage = { input:1,output:0 };
  c.pairs[0].off.durationMs = 3; c.pairs[0].on.durationMs = 4;
  const r = validate(c); assert.equal(r.metrics.savings.tokensPercent, 200 / 3);
  assert.equal(r.metrics.savings.durationPercent, -100 / 3); assert.equal(r.metrics.delta.totalDurationMs, 1);
});
test('unsafe individual or aggregate complete sums are refused instead of rounded', () => {
  for (const configure of [c => { c.pairs[0].off.tokenUsage = { input:Number.MAX_SAFE_INTEGER,output:1 }; },
    c => { c.pairs[0].off.tokenUsage = { input:Number.MAX_SAFE_INTEGER,output:0 }; },
    c => { c.pairs[0].off.durationMs = Number.MAX_SAFE_INTEGER; }, c => { c.pairs[0].off.repairAttempts = Number.MAX_SAFE_INTEGER; }]) {
    const c = fixture(); configure(c); assert.throws(() => validate(c), { code:'TRIAL_OVERFLOW' });
  }
  const c = fixture(); c.pairs = [c.pairs[0]]; c.pairs[0].off.tokenUsage = { input:Number.MAX_SAFE_INTEGER,output:0 };
  assert.equal(validate(c).metrics.off.totalTokens, Number.MAX_SAFE_INTEGER);
});
test('incomplete samples preserve known values without computing partial overflowed metrics', () => {
  const c = fixture(); c.pairs[0].off.tokenUsage = { input:Number.MAX_SAFE_INTEGER,output:1 }; c.pairs[1].on.durationMs = null;
  const r = validate(c); assert.equal(r.status, 'INCOMPLETE'); assert.equal(r.metrics, null);
  assert.deepEqual(r.rows[0].off.tokenUsage, c.pairs[0].off.tokenUsage);
});
test('all numeric fields reject invalid values including negative zero', () => {
  for (const key of ['input','output','durationMs','repairAttempts']) for (const value of [-0,-1,0.5,NaN,Infinity,-Infinity,Number.MAX_SAFE_INTEGER+1,'1',undefined,1n]) {
    const c = fixture(), a = c.pairs[0].off;
    if (key === 'input' || key === 'output') a.tokenUsage[key] = value; else a[key] = value;
    refused(() => validate(c));
  }
});
test('identifiers digests schema outcomes and claim types are strict', () => {
  for (const v of ['', 'UPPER', 'ok\n', 'x'.repeat(97), '\ud800', 1, null]) {
    const c = fixture(); c.pairs[0].caseId = v; refused(() => validate(c));
    const d = fixture(); d.pairs[0].off.runId = v; refused(() => validate(d));
  }
  for (const v of ['a'.repeat(63),'a'.repeat(64)+'\n','A'.repeat(64),'g'.repeat(64),null]) {
    const c = fixture(); c.pairs[0].taskSha256 = v; refused(() => validate(c));
    const d = fixture(); d.pairs[0].on.modelSettingsSha256 = v; refused(() => validate(d));
  }
  for (const [key,v] of [['outcome','CERTIFIED'],['outcome',null],['completionClaim',1],['completionClaim','true']]) {
    const c = fixture(); c.pairs[0].off[key] = v; refused(() => validate(c));
  }
  const c = fixture(); c.schemaVersion = 'nisi-paired-trial-v2'; refused(() => validate(c));
});
test('model names must be trimmed well formed bounded UTF8 without null bytes', () => {
  for (const model of ['', ' ', ' model', 'model ', 'bad\0model', '\ud800', 'é'.repeat(101), 7, {}]) {
    const c = fixture(); c.pairs[0].off.model = c.pairs[0].on.model = model; refused(() => validate(c));
  }
  const c = fixture(); c.pairs[0].off.model = c.pairs[0].on.model = 'é'.repeat(100); assert.equal(validate(c).status, 'COMPLETE');
});
test('all record layers reject missing extra symbolic hidden and accessor fields without invocation', () => {
  let calls = 0;
  const pick = [c => [c,'schemaVersion'], c => [c.pairs[0],'caseId'], c => [c.pairs[0].off,'model'], c => [c.pairs[0].off.tokenUsage,'input']];
  for (const choose of pick) for (const mode of ['missing','extra','symbol','hidden','getter']) {
    const c = fixture(), [obj,key] = choose(c);
    if (mode === 'missing') delete obj[key]; else if (mode === 'extra') obj.extra = 1; else if (mode === 'symbol') obj[Symbol()] = 1;
    else if (mode === 'hidden') Object.defineProperty(obj,key,{enumerable:false});
    else Object.defineProperty(obj,key,{get(){calls++;return 'bad';},enumerable:true});
    refused(() => validate(c));
  }
  assert.equal(calls, 0);
});
test('pair array rejects custom accessors iterators holes subclasses and excess length', () => {
  let calls = 0;
  for (const transform of [a => Object.assign(a,{ extra:true }), a => { a[Symbol.iterator] = () => { calls++;return [][Symbol.iterator](); };return a; },
    a => { Object.defineProperty(a,'0',{get(){calls++;},enumerable:true});return a; }, a => { delete a[0];return a; },
    a => Object.setPrototypeOf(a, (class extends Array {}).prototype), () => [], () => new Array(257)]) {
    const c = fixture(); c.pairs = transform(c.pairs); refused(() => validate(c));
  }
  assert.equal(calls, 0);
});
test('null-prototype records and shared input telemetry are copied into independent ordinary rows', () => {
  const c = fixture(); c.pairs[0] = Object.assign(Object.create(null),c.pairs[0]);
  c.pairs[0].on.tokenUsage = c.pairs[0].off.tokenUsage;
  const r = validate(c); assert.equal(Object.getPrototypeOf(r.rows[0]), Object.prototype);
  assert.notEqual(r.rows[0].on.tokenUsage, r.rows[0].off.tokenUsage); assert.notEqual(r.rows[0].off.tokenUsage,c.pairs[0].off.tokenUsage);
});
test('maximum pair inventory is accepted with exact sample count and no hidden filtering', () => {
  const pair = fixture().pairs[0], c = { schemaVersion:'nisi-paired-trial-v1', pairs:Array.from({length:256},(_,i)=>{
    const p = structuredClone(pair);p.caseId='case.'+i;p.off.runId='off.'+i;p.on.runId='on.'+i;return p;
  }) };
  const r = validate(c); assert.equal(r.pairCount,256);assert.equal(r.metrics.off.incorrectCompletions,256);assert.equal(r.metrics.on.accepted,256);
});
