// Independent containment oracle for the prevention experiment-plan validator,
// written from Claude's adversarial review (evidence/claude-review-20260914.md).
// It is NOT the author's suite: every case here is one the author's 9 tests do
// not discriminate. Written before the fix; must FAIL on the reviewed module.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readPreventionExperimentPlanV1 as read } from '../evaluation/prevention-experiment-plan-v1.mjs';

const d = (character) => character.repeat(64);
const hex = (n) => n.toString(16).padStart(64, '0');
const fixture = () => ({
  schemaVersion: 'nisi-prevention-experiment-plan-v1', planId: 'plan.one',
  policy: { version: 'policy.v1', sha256: d('a'), influenceEnabled: false },
  proposer: 'owner.author', acceptanceReviewer: 'reviewer.independent',
  trainingDigests: [d('b')], repetitions: 2,
  tasks: [{ caseId: 'case.one', taskSha256: d('c'), baselineSha256: d('d'), oracleSha256: d('e'), armOrder: ['OFF_ON', 'ON_OFF'] }],
  exclusions: [{ code: 'preexisting.failure', description: 'Baseline fixture is invalid before either arm starts.' }],
  budget: { maxDurationMs: 60000, maxModelCalls: 4, maxInputTokens: 10000, maxOutputTokens: 4000 },
  measuredTelemetry: 'UNKNOWN_UNTIL_RUN',
});
const GOLDEN = 'b2ef61eff575bd167f2c51610ecd365e7d0820c42891d8ffb167914d349c51df';
const refused = (value, code) => assert.throws(() => read(value), { code });
const task = (i) => ({ caseId: `case.${i}`, taskSha256: hex(1000 + i), baselineSha256: d('d'), oracleSha256: d('e'), armOrder: ['OFF_ON', 'ON_OFF'] });
// A Proxy whose `length` reads small the first `lies` times, then true. The
// validator must read length exactly once (or refuse the Proxy); either way the
// emitted plan must never exceed the declared bounds.
const lengthLiar = (real, reported, lies = 2) => { let n = 0; return new Proxy(real, { get(t, k, r) { if (k === 'length') { n++; return n <= lies ? reported : t.length; } return Reflect.get(t, k, r); } }); };

/* ---------------- #1 length-lying Proxy defeats every list bound ---------------- */

test('#1 tasks: a Proxy that reports 200 then 300 entries cannot emit a 300-task plan', () => {
  const v = fixture(); v.tasks = lengthLiar(Array.from({ length: 300 }, (_, i) => task(i)), 200);
  refused(v, 'PLAN_LIST');
});
test('#1 trainingDigests: 400 entries behind a lying length are refused', () => {
  const v = fixture(); v.trainingDigests = lengthLiar(Array.from({ length: 400 }, (_, i) => hex(5000 + i)), 100);
  refused(v, 'PLAN_LIST');
});
test('#1 exclusions: 100 entries behind a lying length are refused', () => {
  const v = fixture(); v.exclusions = lengthLiar(Array.from({ length: 100 }, (_, i) => ({ code: `x${i}`, description: 'd' })), 10);
  refused(v, 'PLAN_LIST');
});
test('#1 armOrder: four entries behind a lying length cannot pass as two repetitions', () => {
  const v = fixture(); v.tasks[0].armOrder = lengthLiar(['OFF_ON', 'ON_OFF', 'ON_OFF', 'ON_OFF'], 2);
  refused(v, 'PLAN_LIST');
});
test('#1 every accepted plan satisfies its own inventory invariants', () => {
  const v = fixture(); v.tasks = Array.from({ length: 256 }, (_, i) => task(i)); v.trainingDigests = Array.from({ length: 256 }, (_, i) => hex(5000 + i)); v.exclusions = Array.from({ length: 64 }, (_, i) => ({ code: `x${i}`, description: 'd' }));
  const r = read(v);
  assert.equal(r.tasks.length, 256); assert.equal(r.trainingDigests.length, 256); assert.equal(r.exclusions.length, 64);
  for (const t of r.tasks) { assert.equal(t.armOrder.length, r.repetitions); assert.equal(t.armOrder.filter((o) => o === 'OFF_ON').length * 2, r.repetitions); }
});

/* ---------------- #2 held-out oracle and baseline identity ---------------- */

test('#2 an oracle digest that is a training example is not held out', () => {
  const v = fixture(); v.tasks[0].oracleSha256 = v.trainingDigests[0];
  refused(v, 'PLAN_TRAINING_EVALUATION_OVERLAP');
});
test('#2 a baseline digest that is a training example is not held out', () => {
  const v = fixture(); v.tasks[0].baselineSha256 = v.trainingDigests[0];
  refused(v, 'PLAN_TRAINING_EVALUATION_OVERLAP');
});
test('#2 the task digest control still refuses, and overlap is checked against every training digest', () => {
  const v = fixture(); v.trainingDigests = [d('b'), d('f')]; v.tasks[0].oracleSha256 = d('f');
  refused(v, 'PLAN_TRAINING_EVALUATION_OVERLAP');
  const c = fixture(); c.tasks[0].taskSha256 = c.trainingDigests[0]; refused(c, 'PLAN_TRAINING_EVALUATION_OVERLAP');
});

/* ---------------- #3 two-sided bounds the author's suite never exercises ---------------- */

test('#3 budget keys are naturals of at least one on both sides', () => {
  for (const key of ['maxDurationMs', 'maxModelCalls', 'maxInputTokens', 'maxOutputTokens']) {
    for (const bad of [0, -1, 1.5, 2 ** 53 + 2, '4', null]) { const v = fixture(); v.budget[key] = bad; refused(v, 'PLAN_NATURAL'); }
    const ok = fixture(); ok.budget[key] = 1; assert.equal(read(ok).budget[key], 1);
  }
});
test('#3 repetitions floor, cap and parity', () => {
  let v = fixture(); v.repetitions = 0; v.tasks[0].armOrder = []; refused(v, 'PLAN_NATURAL');
  v = fixture(); v.repetitions = 1; v.tasks[0].armOrder = ['OFF_ON']; refused(v, 'PLAN_NATURAL');
  v = fixture(); v.repetitions = 3; v.tasks[0].armOrder = ['OFF_ON', 'ON_OFF', 'OFF_ON']; refused(v, 'PLAN_COUNTERBALANCE');
  v = fixture(); v.repetitions = 34; v.tasks[0].armOrder = Array.from({ length: 34 }, (_, i) => (i % 2 ? 'ON_OFF' : 'OFF_ON')); refused(v, 'PLAN_REPETITION_LIMIT');
  v = fixture(); v.repetitions = 32; v.tasks[0].armOrder = Array.from({ length: 32 }, (_, i) => (i % 2 ? 'ON_OFF' : 'OFF_ON')); assert.equal(read(v).repetitions, 32);
});
test('#3 armOrder length must equal repetitions exactly and be counterbalanced in both directions', () => {
  let v = fixture(); v.tasks[0].armOrder = ['OFF_ON', 'ON_OFF', 'OFF_ON']; refused(v, 'PLAN_LIST');
  v = fixture(); v.tasks[0].armOrder = ['OFF_ON']; refused(v, 'PLAN_LIST');
  v = fixture(); v.tasks[0].armOrder = ['ON_OFF', 'ON_OFF']; refused(v, 'PLAN_COUNTERBALANCE');
  v = fixture(); v.tasks[0].armOrder = ['OFF_ON', 'OFF_ON']; refused(v, 'PLAN_COUNTERBALANCE');
  v = fixture(); v.tasks[0].armOrder = ['ON_OFF', 'OFF_ON']; assert.deepEqual(read(v).tasks[0].armOrder, ['ON_OFF', 'OFF_ON']);
});
test('#3 inventory caps are exact: 256 tasks, 256 training digests, 64 exclusions', () => {
  let v = fixture(); v.tasks = Array.from({ length: 257 }, (_, i) => task(i)); refused(v, 'PLAN_LIST');
  v = fixture(); v.trainingDigests = Array.from({ length: 257 }, (_, i) => hex(5000 + i)); refused(v, 'PLAN_LIST');
  v = fixture(); v.exclusions = Array.from({ length: 65 }, (_, i) => ({ code: `x${i}`, description: 'd' })); refused(v, 'PLAN_LIST');
  v = fixture(); v.tasks = []; refused(v, 'PLAN_LIST');
});

/* ---------------- hardening: sentinels, echo fidelity, validators, golden digest ---------------- */

test('influence sentinel accepts only the boolean false', () => {
  for (const bad of ['true', 1, 0, '', null, undefined, 'false', 'off', true]) { const v = fixture(); v.policy.influenceEnabled = bad; refused(v, 'PLAN_INFLUENCE_MUST_BE_OFF'); }
  assert.equal(read(fixture()).policy.influenceEnabled, false); assert.equal(read(fixture()).influenceEnabled, false);
});
test('telemetry sentinel accepts only the exact string', () => {
  for (const bad of ['0', '', 'UNKNOWN', 'unknown_until_run', 0, null, undefined, { input: 0 }, 'UNKNOWN_UNTIL_RUN ']) { const v = fixture(); v.measuredTelemetry = bad; refused(v, 'PLAN_TELEMETRY_BOUNDARY'); }
});
test('the accepted plan echoes exactly the declaration plus the fixed result fields, in canonical key order', () => {
  const r = read(fixture());
  assert.deepEqual({ ...r }, { ...fixture(), planSha256: GOLDEN, status: 'DECLARED', preventionResult: null, promotionEligible: false, influenceEnabled: false, authorizing: false });
  assert.deepEqual(Object.keys(r), ['schemaVersion', 'planId', 'policy', 'proposer', 'acceptanceReviewer', 'trainingDigests', 'tasks', 'repetitions', 'exclusions', 'budget', 'measuredTelemetry', 'planSha256', 'status', 'preventionResult', 'promotionEligible', 'influenceEnabled', 'authorizing']);
});
test('identifier and text validators are enforced at every site', () => {
  const sites = [['proposer', (v, x) => { v.proposer = x; }], ['acceptanceReviewer', (v, x) => { v.acceptanceReviewer = x; }], ['policy.version', (v, x) => { v.policy.version = x; }], ['tasks[].caseId', (v, x) => { v.tasks[0].caseId = x; }], ['exclusions[].code', (v, x) => { v.exclusions[0].code = x; }], ['planId', (v, x) => { v.planId = x; }]];
  for (const [, set] of sites) for (const bad of [{}, 7, 'a ', 'Upper', '', 'a'.repeat(97), '-lead', 'x\n']) { const v = fixture(); set(v, bad); refused(v, 'PLAN_IDENTIFIER'); }
  for (const bad of ['', 'x'.repeat(257), ' padded', 'nul\0', '\uD800', 7]) { const v = fixture(); v.exclusions[0].description = bad; refused(v, 'PLAN_TEXT'); }
});
test('the plan digest is a golden value, key-order independent, and every declared variable moves it', () => {
  const base = read(fixture()).planSha256; assert.equal(base, GOLDEN);
  const f = fixture(); const flip = (o) => Object.fromEntries(Object.entries(o).reverse());
  const perm = flip(f); perm.policy = flip(f.policy); perm.tasks = [flip(f.tasks[0])]; perm.budget = flip(f.budget); perm.exclusions = [flip(f.exclusions[0])];
  assert.equal(read(perm).planSha256, GOLDEN);
  const moves = [(v) => { v.planId = 'plan.two'; }, (v) => { v.policy.sha256 = d('1'); }, (v) => { v.trainingDigests = []; }, (v) => { v.tasks[0].oracleSha256 = d('2'); }, (v) => { v.tasks[0].armOrder = ['ON_OFF', 'OFF_ON']; }, (v) => { v.exclusions = []; }, (v) => { v.budget.maxModelCalls = 5; }, (v) => { v.repetitions = 4; v.tasks[0].armOrder = ['OFF_ON', 'ON_OFF', 'ON_OFF', 'OFF_ON']; }];
  const seen = new Set([base]); for (const move of moves) { const v = fixture(); move(v); const h = read(v).planSha256; assert.ok(!seen.has(h)); seen.add(h); }
});
