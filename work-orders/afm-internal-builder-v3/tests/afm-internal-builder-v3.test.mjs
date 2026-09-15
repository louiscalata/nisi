// Protected oracle for the AFM internal builder rung-3 (scoped-staging-write
// grant grammar). Contract-first, written from work-orders/afm-internal-builder-v3/SPEC.md
// before the module was filled. Drafters must not edit this file to make a draft pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  AFM_INTERNAL_BUILDER_V3_PROFILE, AFM_INTERNAL_BUILDER_V3_LIMITS_V1, AFM_INTERNAL_BUILDER_V3_CODES_V1,
  readStagingPolicyV1, planStagingWritesV1, stagingWritePlanHashV1, stagingWritePlanSourceV1,
} from '../src/afm-internal-builder-v3.mjs';

const HEX = 'f'.repeat(63) + '0';
const otherHex = 'e'.repeat(64);
const PLANHASH = 'c'.repeat(64);

// Grounded in the SharedChami code-bridge's checked surfaces: the lanes that a
// staging write may touch are this tree's evidence directories; pins mirror the
// bridge's temp-then-rename atomicity discipline (nothing half-written).
const policy = () => ({
  lane: 'evidence/demo-staging/',
  files: { 'plan.json': 4096, 'summary.md': 2048 },
  manifestHash: HEX,
});

// Accepted rung-2 plan result (shape per afm-internal-builder-v2/SPEC.md).
const planResult = () => ({
  ok: true,
  profile: 'nisi-afm-internal-builder-v2',
  plan: {
    runs: [
      { check: 'afm-v1-oracle', argv: ['node', '--test', 'afm-internal-builder-v1.test.mjs'] },
      { check: 'bridge-contract', argv: ['node', '--test', 'windows-worker-contract.test.mjs'] },
    ],
    manifestHash: HEX,
    packHash: 'a'.repeat(64),
    budget: { timeoutSeconds: 120, outputBytes: 262144 },
    planHash: PLANHASH,
  },
});

const writePlanRefusing = (planResultArg, stagingPolicyArg) => {
  const r = planStagingWritesV1(planResultArg, stagingPolicyArg);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'AFM_BUILDER_V3_WRITE');
  assert.equal(r.profile, AFM_INTERNAL_BUILDER_V3_PROFILE);
  assert.ok(Object.isFrozen(r));
  return r;
};

const deepFrozen = (x, seen = new Set()) => {
  if (!x || typeof x !== 'object' || seen.has(x)) return true;
  seen.add(x);
  return Object.isFrozen(x) && Object.values(x).every((v) => deepFrozen(v, seen));
};

const refuse = (input, code, path) => {
  const r = readStagingPolicyV1(input);
  assert.deepEqual({ ok: r.ok, code: r.code, path: r.path }, { ok: false, code, path });
  assert.equal(r.profile, AFM_INTERNAL_BUILDER_V3_PROFILE);
  assert.deepEqual(Object.keys(r).sort(), ['code', 'ok', 'path', 'profile']);
  assert.ok(Object.isFrozen(r));
};

const noThrow = (name, make) => {
  try { readStagingPolicyV1(make()); } catch (e) { assert.fail(`${name} threw ${e && e.constructor.name}: ${String(e && e.message).slice(0, 60)}`); }
};

test('constants are frozen and exact', () => {
  assert.equal(AFM_INTERNAL_BUILDER_V3_PROFILE, 'nisi-afm-internal-builder-v3');
  assert.deepEqual(AFM_INTERNAL_BUILDER_V3_LIMITS_V1, { files: 32, writesPerPlan: 3, nameLength: 64, laneLength: 96, bytesPerFile: 262144, bytesTotal: 1048576 });
  assert.deepEqual(AFM_INTERNAL_BUILDER_V3_CODES_V1, [
    'AFM_BUILDER_V3_NOT_OBJECT', 'AFM_BUILDER_V3_UNKNOWN_MEMBER', 'AFM_BUILDER_V3_MISSING_MEMBER',
    'AFM_BUILDER_V3_STAGING', 'AFM_BUILDER_V3_FILE', 'AFM_BUILDER_V3_BUDGET',
    'AFM_BUILDER_V3_PIN', 'AFM_BUILDER_V3_WRITE']);
  for (const c of [AFM_INTERNAL_BUILDER_V3_LIMITS_V1, AFM_INTERNAL_BUILDER_V3_CODES_V1]) assert.ok(Object.isFrozen(c));
});

test('a valid staging policy reads to a fresh, deep-frozen result', () => {
  const input = policy();
  const r = readStagingPolicyV1(input);
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r), ['ok', 'profile', 'stagingPolicy']);
  assert.equal(r.profile, AFM_INTERNAL_BUILDER_V3_PROFILE);
  assert.deepEqual(Object.keys(r.stagingPolicy), ['lane', 'files', 'manifestHash']);
  assert.equal(r.stagingPolicy.lane, 'evidence/demo-staging/');
  assert.deepEqual(Object.keys(r.stagingPolicy.files), ['plan.json', 'summary.md']);
  assert.deepEqual(r.stagingPolicy.files, { 'plan.json': 4096, 'summary.md': 2048 });
  assert.equal(r.stagingPolicy.manifestHash, HEX);
  assert.ok(deepFrozen(r));
  input.files['plan.json'] = 1;
  input.lane = 'smuggled/';
  delete input.files['summary.md'];
  assert.deepEqual(r.stagingPolicy.files, { 'plan.json': 4096, 'summary.md': 2048 });
  assert.equal(r.stagingPolicy.lane, 'evidence/demo-staging/');
});

test('policy reader never throws and refuses non-objects', () => {
  for (const bad of [null, undefined, 'x', 1, 1n, true, Symbol('s'), () => {}, [], new Date(0)])
    refuse(bad, 'AFM_BUILDER_V3_NOT_OBJECT', '$');
  noThrow('proxy root', () => new Proxy(policy(), { get() { throw new Error('boom'); } }));
  noThrow('proxy getPrototypeOf', () => new Proxy({}, { getPrototypeOf() { throw new Error('boom'); } }));
  noThrow('throwing getter', () => { const p = policy(); Object.defineProperty(p, 'manifestHash', { get() { throw new Error('boom'); }, enumerable: true }); return p; });
  noThrow('throwing keys trap', () => new Proxy(policy(), { ownKeys() { throw new Error('boom'); } }));
  noThrow('throwing descriptor trap', () => new Proxy(policy(), { getOwnPropertyDescriptor() { throw new Error('boom'); } }));
  noThrow('cyclic policy', () => { const p = policy(); p.self = p; return p; });
  noThrow('non-plain prototype', () => Object.assign(Object.create({ nope: true }), policy()));
});

test('policy unknown and missing members, before values', () => {
  refuse({ ...policy(), extra: 1 }, 'AFM_BUILDER_V3_UNKNOWN_MEMBER', '$.extra');
  refuse({ ...policy(), extra: 1, lane: 7 }, 'AFM_BUILDER_V3_UNKNOWN_MEMBER', '$.extra');
  const missingPin = policy(); delete missingPin.manifestHash;
  refuse(missingPin, 'AFM_BUILDER_V3_MISSING_MEMBER', '$.manifestHash');
  const missingFiles = policy(); delete missingFiles.files;
  refuse(missingFiles, 'AFM_BUILDER_V3_MISSING_MEMBER', '$.files');
  const missingLane = policy(); delete missingLane.lane;
  refuse(missingLane, 'AFM_BUILDER_V3_MISSING_MEMBER', '$.lane');
});

test('policy member values refuse with the exact codes', () => {
  // manifestHash pin: format
  refuse({ ...policy(), manifestHash: 'z'.repeat(64) }, 'AFM_BUILDER_V3_PIN', '$.manifestHash');
  refuse({ ...policy(), manifestHash: HEX.toUpperCase() }, 'AFM_BUILDER_V3_PIN', '$.manifestHash');
  refuse({ ...policy(), manifestHash: HEX.slice(0, 63) }, 'AFM_BUILDER_V3_PIN', '$.manifestHash');
  refuse({ ...policy(), manifestHash: 7 }, 'AFM_BUILDER_V3_PIN', '$.manifestHash');
  // lane: prefix rules
  refuse({ ...policy(), lane: '' }, 'AFM_BUILDER_V3_STAGING', '$.lane');
  refuse({ ...policy(), lane: '.' }, 'AFM_BUILDER_V3_STAGING', '$.lane');
  refuse({ ...policy(), lane: '/etc/x' }, 'AFM_BUILDER_V3_STAGING', '$.lane');
  refuse({ ...policy(), lane: '../up' }, 'AFM_BUILDER_V3_STAGING', '$.lane');
  refuse({ ...policy(), lane: 'a..b' }, 'AFM_BUILDER_V3_STAGING', '$.lane');
  refuse({ ...policy(), lane: 'a\nb' }, 'AFM_BUILDER_V3_STAGING', '$.lane');
  refuse({ ...policy(), lane: 'x'.repeat(97) }, 'AFM_BUILDER_V3_STAGING', '$.lane');
  // files: container problems
  refuse({ ...policy(), files: [] }, 'AFM_BUILDER_V3_STAGING', '$.files');
  refuse({ ...policy(), files: {} }, 'AFM_BUILDER_V3_STAGING', '$.files');
  refuse({ ...policy(), files: 'x' }, 'AFM_BUILDER_V3_STAGING', '$.files');
  refuse({ ...policy(), files: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`f${i}`, 1])) }, 'AFM_BUILDER_V3_STAGING', '$.files');
  // files: bad names
  refuse({ ...policy(), files: { '../x': 100 } }, 'AFM_BUILDER_V3_FILE', '$.files');
  refuse({ ...policy(), files: { 'a/b': 100 } }, 'AFM_BUILDER_V3_FILE', '$.files');
  refuse({ ...policy(), files: { '.': 100 } }, 'AFM_BUILDER_V3_FILE', '$.files');
  refuse({ ...policy(), files: { '..': 100 } }, 'AFM_BUILDER_V3_FILE', '$.files');
  refuse({ ...policy(), files: { '': 100 } }, 'AFM_BUILDER_V3_FILE', '$.files');
  refuse({ ...policy(), files: { ['x'.repeat(65)]: 100 } }, 'AFM_BUILDER_V3_FILE', '$.files');
  refuse({ ...policy(), files: { 'a\nb': 100 } }, 'AFM_BUILDER_V3_FILE', '$.files');
  // files: bad planned bytes
  refuse({ ...policy(), files: { 'a.json': 0 } }, 'AFM_BUILDER_V3_BUDGET', '$.files.a.json');
  refuse({ ...policy(), files: { 'a.json': 262145 } }, 'AFM_BUILDER_V3_BUDGET', '$.files.a.json');
  refuse({ ...policy(), files: { 'a.json': 1.5 } }, 'AFM_BUILDER_V3_BUDGET', '$.files.a.json');
  refuse({ ...policy(), files: { 'a.json': Infinity } }, 'AFM_BUILDER_V3_BUDGET', '$.files.a.json');
  refuse({ ...policy(), files: { 'a.json': '100' } }, 'AFM_BUILDER_V3_BUDGET', '$.files.a.json');
  // files: sum over budget (each file within per-file cap; only the total overflows)
  refuse({ ...policy(), files: { 'a.bin': 262144, 'b.bin': 262144, 'c.bin': 262144, 'd.bin': 262144, 'e.bin': 1 } }, 'AFM_BUILDER_V3_BUDGET', '$.files');
});

test('a valid accepted plan and policy yield a typed, frozen write plan', () => {
  const r = planStagingWritesV1(planResult(), policy());
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r), ['ok', 'profile', 'writePlan']);
  assert.equal(r.profile, AFM_INTERNAL_BUILDER_V3_PROFILE);
  assert.deepEqual(Object.keys(r.writePlan), ['writes', 'lane', 'manifestHash', 'packHash', 'sourcePlanHash', 'totalBytes', 'stagingHash']);
  assert.deepEqual(r.writePlan.writes, [
    { path: 'evidence/demo-staging/plan.json', name: 'plan.json', bytes: 4096 },
    { path: 'evidence/demo-staging/summary.md', name: 'summary.md', bytes: 2048 },
  ]);
  assert.equal(r.writePlan.lane, 'evidence/demo-staging/');
  assert.equal(r.writePlan.manifestHash, HEX);
  assert.equal(r.writePlan.packHash, 'a'.repeat(64));
  assert.equal(r.writePlan.sourcePlanHash, PLANHASH);
  assert.equal(r.writePlan.totalBytes, 6144);
  assert.match(r.writePlan.stagingHash, /^[0-9a-f]{64}$/);
  assert.ok(deepFrozen(r));
  // writesPerPlan cap: only the first 3 policy files are written; totalBytes covers exactly those
  const wide = policy();
  wide.files = { 'a.json': 100, 'b.json': 200, 'c.json': 300, 'd.json': 400 };
  const w = planStagingWritesV1(planResult(), wide);
  assert.equal(w.writePlan.writes.length, 3);
  assert.deepEqual(w.writePlan.writes.map((x) => x.name), ['a.json', 'b.json', 'c.json']);
  assert.equal(w.writePlan.totalBytes, 600);
  // input mutation after planning cannot affect the write plan
  const pr = planResult(); const p = policy();
  const r2 = planStagingWritesV1(pr, p);
  p.files['plan.json'] = 1;
  p.lane = 'smuggled/';
  pr.plan.packHash = otherHex;
  pr.plan.runs[0].argv[1] = 'smuggled';
  assert.equal(r2.writePlan.writes[0].bytes, 4096);
  assert.equal(r2.writePlan.lane, 'evidence/demo-staging/');
  assert.equal(r2.writePlan.packHash, 'a'.repeat(64));
  assert.deepEqual(r2.writePlan.writes[0].argv, undefined);
});

test('write-plan refusals are exact and never throw', () => {
  // plan-result problems -> $.plan
  assert.equal(writePlanRefusing(null, policy()).path, '$.plan');
  assert.equal(writePlanRefusing('x', policy()).path, '$.plan');
  assert.equal(writePlanRefusing({ ok: false, profile: 'nisi-afm-internal-builder-v2', code: 'X', path: '$' }, policy()).path, '$.plan');
  assert.equal(writePlanRefusing({ ok: true, profile: 'nisi-afm-internal-builder-v3', writePlan: {} }, policy()).path, '$.plan');
  assert.equal(writePlanRefusing({ ...planResult(), plan: { ...planResult().plan, packHash: 'z'.repeat(20) } }, policy()).path, '$.plan');
  assert.equal(writePlanRefusing({ ...planResult(), plan: { ...planResult().plan, budget: { timeoutSeconds: 301, outputBytes: 1 } } }, policy()).path, '$.plan');
  // staging policy problems -> $.staging
  assert.equal(writePlanRefusing(planResult(), null).path, '$.staging');
  assert.equal(writePlanRefusing(planResult(), 'x').path, '$.staging');
  assert.equal(writePlanRefusing(planResult(), { ...policy(), lane: 7 }).path, '$.staging');
  assert.equal(writePlanRefusing(planResult(), { ...policy(), files: { 'a/b': 1 } }).path, '$.staging');
  // cross-input pin mismatch -> the staging manifestHash path
  assert.equal(writePlanRefusing(planResult(), { ...policy(), manifestHash: otherHex }).path, '$.manifestHash');
  // hostile inputs never throw
  let threw = false;
  try { planStagingWritesV1(new Proxy(planResult(), { get() { throw new Error('boom'); } }), policy()); } catch { threw = true; }
  try { planStagingWritesV1(planResult(), new Proxy(policy(), { get() { throw new Error('boom'); } })); } catch { threw = true; }
  try { planStagingWritesV1(Object.assign(Object.create({ x: 1 }), planResult()), policy()); } catch { threw = true; }
  assert.equal(threw, false, 'hostile plan/policy inputs must refuse, not throw');
});

test('staging hash is deterministic over the canonical fields', () => {
  const r = planStagingWritesV1(planResult(), policy());
  const h = stagingWritePlanHashV1(r.writePlan);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, stagingWritePlanHashV1(planStagingWritesV1(planResult(), policy()).writePlan));
  assert.equal(h, r.writePlan.stagingHash);
  assert.notEqual(h, stagingWritePlanHashV1(planStagingWritesV1(
    planResult(), { ...policy(), lane: 'other/lane/' }).writePlan));
  assert.notEqual(h, stagingWritePlanHashV1(planStagingWritesV1(
    planResult(), { ...policy(), files: { ...policy().files, 'plan.json': 4097 } }).writePlan));
  assert.notEqual(h, stagingWritePlanHashV1(planStagingWritesV1(
    planResult(), { ...policy(), files: { 'summary.md': 2048, 'plan.json': 4096 } }).writePlan));
  assert.notEqual(h, stagingWritePlanHashV1(planStagingWritesV1(
    planResult(), { ...policy(), files: { ...policy().files, 'notes.md': 512 } }).writePlan));
  assert.notEqual(h, stagingWritePlanHashV1(planStagingWritesV1(
    { ...planResult(), plan: { ...planResult().plan, planHash: otherHex } }, policy()).writePlan));
  assert.notEqual(h, stagingWritePlanHashV1(planStagingWritesV1(
    { ...planResult(), plan: { ...planResult().plan, packHash: otherHex } }, policy()).writePlan));
});

test('a generated write-plan module passes node --check and refuses non-plan inputs', async () => {
  const r = planStagingWritesV1(planResult(), policy());
  const src = stagingWritePlanSourceV1(r);
  assert.equal(typeof src, 'string');
  assert.ok(src.includes('export default'));
  const dir = mkdtempSync(join(tmpdir(), 'afm-staging-'));
  const file = join(dir, 'write-plan.mjs');
  try {
    writeFileSync(file, src);
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    const mod = await import(pathToFileURL(file).href);
    const exported = mod.default;
    assert.deepEqual(exported, r.writePlan);
    assert.ok(deepFrozen(exported));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const refusal = { ok: false, profile: AFM_INTERNAL_BUILDER_V3_PROFILE, code: 'AFM_BUILDER_V3_WRITE', path: '$' };
  assert.deepEqual(stagingWritePlanSourceV1(null), refusal);
  assert.deepEqual(stagingWritePlanSourceV1('x'), refusal);
  // a plain policy result is not a write-plan result
  assert.deepEqual(stagingWritePlanSourceV1(readStagingPolicyV1(policy())), refusal, 'a staging-policy result is not a write-plan result');
});

test('rung-3 plans writes for a REAL rung-2 plan from the v2 module (integration)', async () => {
  const { readAfmBuilderPackV1, proposeAfmBuilderStepV1 } = await import('../../afm-internal-builder-v1/src/afm-internal-builder-v1.mjs');
  const { planDeterministicTestRunV1 } = await import('../../afm-internal-builder-v2/src/afm-internal-builder-v2.mjs');
  const packInput = {
    schemaVersion: 1,
    project: 'nisi',
    roadmapDigest: '0'.repeat(64),
    workOrder: { id: 'AFM-DEMO-3', goal: 'Prove rung-3 scoped staging-write planning end to end.', acceptance: 'write plan is lane-scoped, pinned and bounded' },
    lastReceipts: [],
    allowedSteps: ['implement', 'test', 'document'],
    allowedChecks: ['afm-v1-oracle', 'bridge-contract', 'v2-module-check'],
  };
  const read = readAfmBuilderPackV1(packInput);
  assert.equal(read.ok, true);
  const prop = proposeAfmBuilderStepV1(read, { step: 'document', checks: ['afm-v1-oracle', 'bridge-contract'], explanation: 'End-to-end rung-1 to rung-3 integration.' });
  assert.equal(prop.ok, true);
  const grantPolicy = {
    checks: {
      'bridge-contract': ['node', '--test', 'windows-worker-contract.test.mjs'],
      'afm-v1-oracle': ['node', '--test', 'afm-internal-builder-v1.test.mjs'],
    },
    manifestHash: HEX, // caller-fixed manifest pin, bound identically at grant and staging
    budget: { timeoutSeconds: 120, outputBytes: 262144 },
  };
  const plan = planDeterministicTestRunV1(prop, grantPolicy);
  assert.equal(plan.ok, true);
  const staging = policy();
  staging.manifestHash = HEX; // bind to the SAME manifest pin the plan carries
  const writePlan = planStagingWritesV1(plan, staging);
  assert.equal(writePlan.ok, true);
  assert.equal(writePlan.writePlan.manifestHash, HEX);
  assert.equal(writePlan.writePlan.sourcePlanHash, plan.plan.planHash);
  assert.equal(writePlan.writePlan.packHash, prop.proposal.packHash);
  assert.ok(writePlan.writePlan.writes.every((w) => w.path.startsWith(staging.lane)));
  // a manifest pin misbound to a different manifest must refuse at $.manifestHash
  const misbound = planStagingWritesV1(plan, { ...staging, manifestHash: otherHex });
  assert.equal(misbound.ok, false);
  assert.equal(misbound.path, '$.manifestHash');
});