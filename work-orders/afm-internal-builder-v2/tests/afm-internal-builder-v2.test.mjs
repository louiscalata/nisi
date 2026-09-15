// Protected oracle for the AFM internal builder rung-2 (deterministic test-run
// grant grammar). Contract-first, written from work-orders/afm-internal-builder-v2/SPEC.md
// before the module was filled. Drafters must not edit this file to make a draft pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AFM_INTERNAL_BUILDER_V2_PROFILE, AFM_INTERNAL_BUILDER_V2_LIMITS_V1, AFM_INTERNAL_BUILDER_V2_CODES_V1,
  readTestRunGrantV1, planDeterministicTestRunV1, testRunPlanHashV1, testRunPlanSourceV1,
} from '../src/afm-internal-builder-v2.mjs';

const HEX = 'f'.repeat(63) + '0';
const otherHex = 'e'.repeat(64);

// Grounded in the SharedChami code-bridge's real orchestration surface: the
// bridge's own contract tests and this tree's verified oracles are the demo
// checks, with the dispatch discipline the worker itself enforces (explicit
// argv, no shell, bounded budget) as the grant budget.
const grant = () => ({
  checks: {
    'bridge-contract': ['node', '--test', 'windows-worker-contract.test.mjs'],
    'afm-v1-oracle': ['node', '--test', 'afm-internal-builder-v1.test.mjs'],
    'v2-module-check': ['node', '--check', 'afm-internal-builder-v2.mjs'],
  },
  manifestHash: HEX,
  budget: { timeoutSeconds: 120, outputBytes: 262144 },
});

// Accepted first-increment proposal result (shape per SPEC.md).
const proposal = () => ({
  ok: true,
  profile: 'nisi-afm-internal-builder-v1',
  proposal: {
    proposedStep: 'document',
    testsToRun: ['afm-v1-oracle', 'bridge-contract'],
    explanation: 'Verify the builder against its verified oracle and bridge contract.',
    packHash: 'a'.repeat(64),
  },
});

const planRefusing = (proposalResult, grantPolicy) => {
  const r = planDeterministicTestRunV1(proposalResult, grantPolicy);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'AFM_BUILDER_V2_PLAN');
  assert.equal(r.profile, AFM_INTERNAL_BUILDER_V2_PROFILE);
  assert.ok(Object.isFrozen(r));
  return r;
};

const deepFrozen = (x, seen = new Set()) => {
  if (!x || typeof x !== 'object' || seen.has(x)) return true;
  seen.add(x);
  return Object.isFrozen(x) && Object.values(x).every((v) => deepFrozen(v, seen));
};

const refuse = (input, code, path) => {
  const r = readTestRunGrantV1(input);
  assert.deepEqual({ ok: r.ok, code: r.code, path: r.path }, { ok: false, code, path });
  assert.equal(r.profile, AFM_INTERNAL_BUILDER_V2_PROFILE);
  assert.deepEqual(Object.keys(r).sort(), ['code', 'ok', 'path', 'profile']);
  assert.ok(Object.isFrozen(r));
};

const noThrow = (name, make) => {
  try { readTestRunGrantV1(make()); } catch (e) { assert.fail(`${name} threw ${e && e.constructor.name}: ${String(e && e.message).slice(0, 60)}`); }
};

test('constants are frozen and exact', () => {
  assert.equal(AFM_INTERNAL_BUILDER_V2_PROFILE, 'nisi-afm-internal-builder-v2');
  assert.deepEqual(AFM_INTERNAL_BUILDER_V2_LIMITS_V1, { checks: 32, checksPerPlan: 3, checkNameLength: 64, argvMax: 8, argvEntryLength: 128, timeoutSeconds: 300, outputBytes: 1048576 });
  assert.deepEqual(AFM_INTERNAL_BUILDER_V2_CODES_V1, [
    'AFM_BUILDER_V2_NOT_OBJECT', 'AFM_BUILDER_V2_UNKNOWN_MEMBER', 'AFM_BUILDER_V2_MISSING_MEMBER',
    'AFM_BUILDER_V2_GRANT', 'AFM_BUILDER_V2_COMMAND', 'AFM_BUILDER_V2_BUDGET',
    'AFM_BUILDER_V2_PIN', 'AFM_BUILDER_V2_PLAN']);
  for (const c of [AFM_INTERNAL_BUILDER_V2_LIMITS_V1, AFM_INTERNAL_BUILDER_V2_CODES_V1]) assert.ok(Object.isFrozen(c));
});

test('a valid grant reads to a fresh, deep-frozen result', () => {
  const input = grant();
  const r = readTestRunGrantV1(input);
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r), ['ok', 'profile', 'grant']);
  assert.equal(r.profile, AFM_INTERNAL_BUILDER_V2_PROFILE);
  assert.deepEqual(Object.keys(r.grant), ['checks', 'manifestHash', 'budget']);
  assert.deepEqual(Object.keys(r.grant.checks), ['bridge-contract', 'afm-v1-oracle', 'v2-module-check']);
  assert.deepEqual(r.grant.checks['bridge-contract'], ['node', '--test', 'windows-worker-contract.test.mjs']);
  assert.deepEqual(r.grant.budget, { timeoutSeconds: 120, outputBytes: 262144 });
  assert.ok(deepFrozen(r));
  input.checks['bridge-contract'].push('smuggle');
  input.budget.timeoutSeconds = 999;
  assert.deepEqual(r.grant.checks['bridge-contract'], ['node', '--test', 'windows-worker-contract.test.mjs']);
  assert.deepEqual(r.grant.budget, { timeoutSeconds: 120, outputBytes: 262144 });
});

test('grant reader never throws and refuses non-objects', () => {
  for (const bad of [null, undefined, 'x', 1, 1n, true, Symbol('s'), () => {}, [], new Date(0)])
    refuse(bad, 'AFM_BUILDER_V2_NOT_OBJECT', '$');
  noThrow('proxy root', () => new Proxy(grant(), { get() { throw new Error('boom'); } }));
  noThrow('proxy getPrototypeOf', () => new Proxy({}, { getPrototypeOf() { throw new Error('boom'); } }));
  noThrow('throwing getter', () => { const g = grant(); Object.defineProperty(g, 'manifestHash', { get() { throw new Error('boom'); }, enumerable: true }); return g; });
  noThrow('throwing keys trap', () => new Proxy(grant(), { ownKeys() { throw new Error('boom'); } }));
  noThrow('throwing descriptor trap', () => new Proxy(grant(), { getOwnPropertyDescriptor() { throw new Error('boom'); } }));
  noThrow('cyclic grant', () => { const g = grant(); g.self = g; return g; });
});

test('grant unknown and missing members, before values', () => {
  refuse({ ...grant(), extra: 1 }, 'AFM_BUILDER_V2_UNKNOWN_MEMBER', '$.extra');
  refuse({ ...grant(), extra: 1, manifestHash: 7 }, 'AFM_BUILDER_V2_UNKNOWN_MEMBER', '$.extra');
  refuse({ ...grant(), budget: { ...grant().budget, extra: 1 } }, 'AFM_BUILDER_V2_UNKNOWN_MEMBER', '$.budget.extra');
  const missing = grant(); delete missing.budget;
  refuse(missing, 'AFM_BUILDER_V2_MISSING_MEMBER', '$.budget');
  const missingPin = grant(); delete missingPin.manifestHash;
  refuse(missingPin, 'AFM_BUILDER_V2_MISSING_MEMBER', '$.manifestHash');
  const missingChecks = grant(); delete missingChecks.checks;
  refuse(missingChecks, 'AFM_BUILDER_V2_MISSING_MEMBER', '$.checks');
});

test('grant member values refuse with the exact codes', () => {
  refuse({ ...grant(), manifestHash: 'z'.repeat(64) }, 'AFM_BUILDER_V2_PIN', '$.manifestHash');
  refuse({ ...grant(), manifestHash: HEX.slice(0, 63) }, 'AFM_BUILDER_V2_PIN', '$.manifestHash');
  refuse({ ...grant(), manifestHash: 7 }, 'AFM_BUILDER_V2_PIN', '$.manifestHash');
  refuse({ ...grant(), checks: [] }, 'AFM_BUILDER_V2_GRANT', '$.checks');
  refuse({ ...grant(), checks: {} }, 'AFM_BUILDER_V2_GRANT', '$.checks');
  refuse({ ...grant(), checks: { '': ['node'] } }, 'AFM_BUILDER_V2_GRANT', '$.checks');
  refuse({ ...grant(), checks: { ['x'.repeat(65)]: ['node'] } }, 'AFM_BUILDER_V2_GRANT', '$.checks');
  refuse({ ...grant(), checks: { 'a': 'not-an-array' } }, 'AFM_BUILDER_V2_COMMAND', '$.checks.a');
  refuse({ ...grant(), checks: { 'a': [] } }, 'AFM_BUILDER_V2_COMMAND', '$.checks.a');
  refuse({ ...grant(), checks: { 'a': ['x', 'y', 'z', 'w', 'v', 'u', 't', 's', 'r'] } }, 'AFM_BUILDER_V2_COMMAND', '$.checks.a');
  refuse({ ...grant(), checks: { 'a': [7] } }, 'AFM_BUILDER_V2_COMMAND', '$.checks.a[0]');
  refuse({ ...grant(), checks: { 'a': [''] } }, 'AFM_BUILDER_V2_COMMAND', '$.checks.a[0]');
  refuse({ ...grant(), checks: { 'a': ['x'.repeat(129)] } }, 'AFM_BUILDER_V2_COMMAND', '$.checks.a[0]');
  refuse({ ...grant(), checks: { 'a': ['no\nline'] } }, 'AFM_BUILDER_V2_COMMAND', '$.checks.a[0]');
  refuse({ ...grant(), budget: 'x' }, 'AFM_BUILDER_V2_GRANT', '$.budget');
  refuse({ ...grant(), budget: {} }, 'AFM_BUILDER_V2_MISSING_MEMBER', '$.budget.timeoutSeconds');
  refuse({ ...grant(), budget: { timeoutSeconds: 0, outputBytes: 262144 } }, 'AFM_BUILDER_V2_BUDGET', '$.budget.timeoutSeconds');
  refuse({ ...grant(), budget: { timeoutSeconds: 301, outputBytes: 262144 } }, 'AFM_BUILDER_V2_BUDGET', '$.budget.timeoutSeconds');
  refuse({ ...grant(), budget: { timeoutSeconds: 1.5, outputBytes: 262144 } }, 'AFM_BUILDER_V2_BUDGET', '$.budget.timeoutSeconds');
  refuse({ ...grant(), budget: { timeoutSeconds: 120, outputBytes: 0 } }, 'AFM_BUILDER_V2_BUDGET', '$.budget.outputBytes');
  refuse({ ...grant(), budget: { timeoutSeconds: 120, outputBytes: 1048577 } }, 'AFM_BUILDER_V2_BUDGET', '$.budget.outputBytes');
});

test('a valid accepted proposal and grant yield a typed, frozen plan', () => {
  const r = planDeterministicTestRunV1(proposal(), grant());
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r), ['ok', 'profile', 'plan']);
  assert.equal(r.profile, AFM_INTERNAL_BUILDER_V2_PROFILE);
  assert.deepEqual(Object.keys(r.plan), ['runs', 'manifestHash', 'packHash', 'budget', 'planHash']);
  assert.deepEqual(r.plan.runs, [
    { check: 'afm-v1-oracle', argv: ['node', '--test', 'afm-internal-builder-v1.test.mjs'] },
    { check: 'bridge-contract', argv: ['node', '--test', 'windows-worker-contract.test.mjs'] },
  ]);
  assert.equal(r.plan.manifestHash, HEX);
  assert.equal(r.plan.packHash, 'a'.repeat(64));
  assert.deepEqual(r.plan.budget, { timeoutSeconds: 120, outputBytes: 262144 });
  assert.match(r.plan.planHash, /^[0-9a-f]{64}$/);
  assert.ok(deepFrozen(r));
  // input mutation after planning cannot affect the plan
  const g = grant(); const p = proposal();
  const r2 = planDeterministicTestRunV1(p, g);
  g.checks['afm-v1-oracle'][1] = 'smuggled';
  p.proposal.testsToRun.push('v2-module-check');
  assert.deepEqual(r2.plan.runs[0].argv, ['node', '--test', 'afm-internal-builder-v1.test.mjs']);
  assert.equal(r2.plan.runs.length, 2);
});

test('plan refusals are exact and never throw', () => {
  // proposal problems -> $.proposal
  planRefusing(null, grant()).path === '$.proposal';
  assert.equal(planRefusing(null, grant()).path, '$.proposal');
  assert.equal(planRefusing('x', grant()).path, '$.proposal');
  assert.equal(planRefusing({ ok: false, profile: 'nisi-afm-internal-builder-v1', code: 'X', path: '$' }, grant()).path, '$.proposal');
  assert.equal(planRefusing({ ok: true, profile: 'nisi-afm-internal-builder-v2', proposal: {} }, grant()).path, '$.proposal');
  assert.equal(planRefusing({ ok: true, profile: 'nisi-afm-internal-builder-v1', proposal: { proposedStep: 'document', testsToRun: [], explanation: 'e', packHash: 'z'.repeat(64) } }, grant()).path, '$.proposal');
  // grant problems -> $.grant
  assert.equal(planRefusing(proposal(), null).path, '$.grant');
  assert.equal(planRefusing(proposal(), 'x').path, '$.grant');
  assert.equal(planRefusing(proposal(), { ...grant(), manifestHash: 7 }).path, '$.grant');
  assert.equal(planRefusing(proposal(), { ...grant(), checks: { 'a': ['node'] } }).path, '$.grant');
  // unknown check names -> precise per-entry path
  const p = proposal();
  p.proposal.testsToRun = ['afm-v1-oracle', 'no-such-check'];
  assert.equal(planRefusing(p, grant()).path, '$.testsToRun[1]');
  // hostile inputs never throw
  let threw = false;
  try { planDeterministicTestRunV1(new Proxy({}, { get() { throw new Error('boom'); } }), grant()); } catch { threw = true; }
  try { planDeterministicTestRunV1(proposal(), new Proxy({}, { get() { throw new Error('boom'); } })); } catch { threw = true; }
  assert.equal(threw, false, 'hostile proposal/grant inputs must refuse, not throw');
});

test('plan hash is deterministic over the five canonical fields', () => {
  const r = planDeterministicTestRunV1(proposal(), grant());
  const h = testRunPlanHashV1(r.plan);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, testRunPlanHashV1(planDeterministicTestRunV1(proposal(), grant()).plan));
  assert.equal(h, r.plan.planHash);
  assert.notEqual(h, testRunPlanHashV1(planDeterministicTestRunV1(
    { ...proposal(), proposal: { ...proposal().proposal, packHash: otherHex } }, grant()).plan));
  assert.notEqual(h, testRunPlanHashV1(planDeterministicTestRunV1(
    proposal(), { ...grant(), budget: { ...grant().budget, outputBytes: 1 } }).plan));
  assert.notEqual(h, testRunPlanHashV1(planDeterministicTestRunV1(
    { ...proposal(), proposal: { ...proposal().proposal, testsToRun: ['bridge-contract', 'afm-v1-oracle'] } }, grant()).plan));
});

test('a generated plan module passes node --check and refuses non-plan inputs', () => {
  const r = planDeterministicTestRunV1(proposal(), grant());
  const src = testRunPlanSourceV1(r);
  assert.equal(typeof src, 'string');
  assert.ok(src.includes('export default'));
  const dir = mkdtempSync(join(tmpdir(), 'afm-plan-'));
  const file = join(dir, 'plan.mjs');
  try {
    writeFileSync(file, src);
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const refusal = testRunPlanSourceV1({ ok: false, profile: AFM_INTERNAL_BUILDER_V2_PROFILE, code: 'AFM_BUILDER_V2_PLAN', path: '$' });
  assert.deepEqual(refusal, { ok: false, profile: AFM_INTERNAL_BUILDER_V2_PROFILE, code: 'AFM_BUILDER_V2_PLAN', path: '$' });
  assert.deepEqual(testRunPlanSourceV1(null), refusal);
  assert.deepEqual(testRunPlanSourceV1('x'), refusal);
  // a proposal result (not a plan result) must refuse
  assert.deepEqual(testRunPlanSourceV1(proposal()), refusal, 'a v1 proposal result is not a v2 plan result');
});

test('rung-2 plans a REAL proposal from the v1 module (integration)', async () => {
  const { readAfmBuilderPackV1, proposeAfmBuilderStepV1 } = await import('../../afm-internal-builder-v1/src/afm-internal-builder-v1.mjs');
  const packInput = {
    schemaVersion: 1,
    project: 'nisi',
    roadmapDigest: '0'.repeat(64),
    workOrder: { id: 'AFM-DEMO-2', goal: 'Prove deterministic test-run planning end to end.', acceptance: 'plan is pinned and bounded' },
    lastReceipts: [],
    allowedSteps: ['implement', 'test', 'document'],
    allowedChecks: ['afm-v1-oracle', 'bridge-contract', 'v2-module-check'],
  };
  const read = readAfmBuilderPackV1(packInput);
  assert.equal(read.ok, true);
  const prop = proposeAfmBuilderStepV1(read, { step: 'document', checks: ['afm-v1-oracle', 'bridge-contract'], explanation: 'End-to-end rung-1 to rung-2 integration.' });
  assert.equal(prop.ok, true);
  const plan = planDeterministicTestRunV1(prop, grant());
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.plan.runs.map((r) => r.check), ['afm-v1-oracle', 'bridge-contract']);
  assert.equal(plan.plan.packHash, prop.proposal.packHash);
});