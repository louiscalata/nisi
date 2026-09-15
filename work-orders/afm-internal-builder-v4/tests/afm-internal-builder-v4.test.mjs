// Protected oracle for the AFM internal builder rung-4 (staged-swift-compile
// grant grammar). Contract-first, written from work-orders/afm-internal-builder-v4/SPEC.md
// before the module was filled. Drafters must not edit this file to make a draft pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  AFM_INTERNAL_BUILDER_V4_PROFILE, AFM_INTERNAL_BUILDER_V4_LIMITS_V1, AFM_INTERNAL_BUILDER_V4_CODES_V1,
  readCompilePolicyV1, planStagedCompileV1, stagedCompilePlanHashV1, stagedCompilePlanSourceV1,
} from '../src/afm-internal-builder-v4.mjs';
import { stagingWritePlanHashV1 } from '../../afm-internal-builder-v3/src/afm-internal-builder-v3.mjs';

const HEX = 'f'.repeat(63) + '0';
const otherHex = 'e'.repeat(64);
const SHA = '1'.repeat(64);
const SHA2 = '2'.repeat(64);
const LANE = 'staging/afm-4-demo/';

// Self-consistent accepted rung-3 write-plan result: the stagingHash is derived
// with the REAL rung-3 hash function over exactly this content, so every
// fixture (and every content variant below) binds to its own ancestor hash.
const stagedWritePlan = (base) => ({ ...base, stagingHash: stagingWritePlanHashV1(base) });
const writePlanResult = () => {
  const writes = [
    { path: LANE + 'a.swift', name: 'a.swift', bytes: 2048 },
    { path: LANE + 'b.swift', name: 'b.swift', bytes: 2048 },
  ];
  const base = { writes, lane: LANE, manifestHash: HEX, packHash: 'a'.repeat(64), sourcePlanHash: 'b'.repeat(64), totalBytes: 4096 };
  return { ok: true, profile: 'nisi-afm-internal-builder-v3', writePlan: stagedWritePlan(base) };
};

// Caller-consented compile policy (exact swiftc argv, sha256 source pins).
const compilePolicy = () => ({
  invoke: ['swiftc', '-c', 'a.swift', '-o', 'out.o'],
  sources: { 'a.swift': SHA, 'b.swift': SHA2 },
  output: 'out.o',
  manifestHash: HEX,
  budget: { timeoutSeconds: 120, outputBytes: 262144 },
});

const compileRefusing = (planResultArg, policyArg) => {
  const r = planStagedCompileV1(planResultArg, policyArg);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'AFM_BUILDER_V4_INVOKE');
  assert.equal(r.profile, AFM_INTERNAL_BUILDER_V4_PROFILE);
  assert.ok(Object.isFrozen(r));
  return r;
};

const deepFrozen = (x, seen = new Set()) => {
  if (!x || typeof x !== 'object' || seen.has(x)) return true;
  seen.add(x);
  return Object.isFrozen(x) && Object.values(x).every((v) => deepFrozen(v, seen));
};

const refuse = (input, code, path) => {
  const r = readCompilePolicyV1(input);
  assert.deepEqual({ ok: r.ok, code: r.code, path: r.path }, { ok: false, code, path });
  assert.equal(r.profile, AFM_INTERNAL_BUILDER_V4_PROFILE);
  assert.deepEqual(Object.keys(r).sort(), ['code', 'ok', 'path', 'profile']);
  assert.ok(Object.isFrozen(r));
};

const noThrow = (name, make) => {
  try { readCompilePolicyV1(make()); } catch (e) { assert.fail(`${name} threw ${e && e.constructor.name}: ${String(e && e.message).slice(0, 60)}`); }
};

test('constants are frozen and exact', () => {
  assert.equal(AFM_INTERNAL_BUILDER_V4_PROFILE, 'nisi-afm-internal-builder-v4');
  assert.deepEqual(AFM_INTERNAL_BUILDER_V4_LIMITS_V1, { sources: 8, sourceNameLength: 64, argvMax: 16, argvEntryLength: 128, invokeTimeoutSeconds: 300, outputBytes: 1048576, compilerNameLength: 64, outputNameLength: 64, laneLength: 96 });
  assert.deepEqual(AFM_INTERNAL_BUILDER_V4_CODES_V1, [
    'AFM_BUILDER_V4_NOT_OBJECT', 'AFM_BUILDER_V4_UNKNOWN_MEMBER', 'AFM_BUILDER_V4_MISSING_MEMBER',
    'AFM_BUILDER_V4_COMPILE', 'AFM_BUILDER_V4_COMMAND', 'AFM_BUILDER_V4_BUDGET',
    'AFM_BUILDER_V4_PIN', 'AFM_BUILDER_V4_INVOKE']);
  for (const c of [AFM_INTERNAL_BUILDER_V4_LIMITS_V1, AFM_INTERNAL_BUILDER_V4_CODES_V1]) assert.ok(Object.isFrozen(c));
});

test('a valid compile policy reads to a fresh, deep-frozen result', () => {
  const input = compilePolicy();
  const r = readCompilePolicyV1(input);
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r), ['ok', 'profile', 'compilePolicy']);
  assert.equal(r.profile, AFM_INTERNAL_BUILDER_V4_PROFILE);
  assert.deepEqual(Object.keys(r.compilePolicy), ['invoke', 'sources', 'output', 'manifestHash', 'budget']);
  assert.deepEqual(r.compilePolicy.invoke, ['swiftc', '-c', 'a.swift', '-o', 'out.o']);
  assert.deepEqual(Object.keys(r.compilePolicy.sources), ['a.swift', 'b.swift']);
  assert.deepEqual(r.compilePolicy.sources, { 'a.swift': SHA, 'b.swift': SHA2 });
  assert.equal(r.compilePolicy.output, 'out.o');
  assert.equal(r.compilePolicy.manifestHash, HEX);
  assert.deepEqual(r.compilePolicy.budget, { timeoutSeconds: 120, outputBytes: 262144 });
  assert.ok(deepFrozen(r));
  input.invoke.push('smuggle');
  input.sources['evil.swift'] = SHA;
  input.budget.timeoutSeconds = 999;
  assert.deepEqual(r.compilePolicy.invoke, ['swiftc', '-c', 'a.swift', '-o', 'out.o']);
  assert.deepEqual(Object.keys(r.compilePolicy.sources), ['a.swift', 'b.swift']);
  assert.deepEqual(r.compilePolicy.budget, { timeoutSeconds: 120, outputBytes: 262144 });
});

test('policy reader never throws and refuses non-objects', () => {
  for (const bad of [null, undefined, 'x', 1, 1n, true, Symbol('s'), () => {}, [], new Date(0)])
    refuse(bad, 'AFM_BUILDER_V4_NOT_OBJECT', '$');
  noThrow('proxy root', () => new Proxy(compilePolicy(), { get() { throw new Error('boom'); } }));
  noThrow('proxy getPrototypeOf', () => new Proxy({}, { getPrototypeOf() { throw new Error('boom'); } }));
  noThrow('throwing getter', () => { const p = compilePolicy(); Object.defineProperty(p, 'manifestHash', { get() { throw new Error('boom'); }, enumerable: true }); return p; });
  noThrow('throwing keys trap', () => new Proxy(compilePolicy(), { ownKeys() { throw new Error('boom'); } }));
  noThrow('throwing descriptor trap', () => new Proxy(compilePolicy(), { getOwnPropertyDescriptor() { throw new Error('boom'); } }));
  noThrow('cyclic policy', () => { const p = compilePolicy(); p.self = p; return p; });
});

test('policy unknown and missing members, before values', () => {
  refuse({ ...compilePolicy(), extra: 1 }, 'AFM_BUILDER_V4_UNKNOWN_MEMBER', '$.extra');
  refuse({ ...compilePolicy(), extra: 1, invoke: 7 }, 'AFM_BUILDER_V4_UNKNOWN_MEMBER', '$.extra');
  const missingInvoke = compilePolicy(); delete missingInvoke.invoke;
  refuse(missingInvoke, 'AFM_BUILDER_V4_MISSING_MEMBER', '$.invoke');
  const missingSources = compilePolicy(); delete missingSources.sources;
  refuse(missingSources, 'AFM_BUILDER_V4_MISSING_MEMBER', '$.sources');
  const missingOutput = compilePolicy(); delete missingOutput.output;
  refuse(missingOutput, 'AFM_BUILDER_V4_MISSING_MEMBER', '$.output');
  const missingBudget = compilePolicy(); delete missingBudget.budget;
  refuse(missingBudget, 'AFM_BUILDER_V4_MISSING_MEMBER', '$.budget');
  const missingPin = compilePolicy(); delete missingPin.manifestHash;
  refuse(missingPin, 'AFM_BUILDER_V4_MISSING_MEMBER', '$.manifestHash');
});

test('policy member values refuse with the exact codes', () => {
  // invoke: container and entries
  refuse({ ...compilePolicy(), invoke: 'swiftc' }, 'AFM_BUILDER_V4_COMPILE', '$.invoke');
  refuse({ ...compilePolicy(), invoke: [] }, 'AFM_BUILDER_V4_COMPILE', '$.invoke');
  refuse({ ...compilePolicy(), invoke: Array.from({ length: 17 }, () => 'x') }, 'AFM_BUILDER_V4_COMPILE', '$.invoke');
  refuse({ ...compilePolicy(), invoke: ['cc', '-c'] }, 'AFM_BUILDER_V4_COMMAND', '$.invoke[0]');
  refuse({ ...compilePolicy(), invoke: [7] }, 'AFM_BUILDER_V4_COMMAND', '$.invoke[0]');
  refuse({ ...compilePolicy(), invoke: ['swiftc', ''] }, 'AFM_BUILDER_V4_COMMAND', '$.invoke[1]');
  refuse({ ...compilePolicy(), invoke: ['swiftc', 'x'.repeat(129)] }, 'AFM_BUILDER_V4_COMMAND', '$.invoke[1]');
  refuse({ ...compilePolicy(), invoke: ['swiftc', 'no\nline'] }, 'AFM_BUILDER_V4_COMMAND', '$.invoke[1]');
  // sources: container and names
  refuse({ ...compilePolicy(), sources: [] }, 'AFM_BUILDER_V4_COMPILE', '$.sources');
  refuse({ ...compilePolicy(), sources: {} }, 'AFM_BUILDER_V4_COMPILE', '$.sources');
  refuse({ ...compilePolicy(), sources: 'x' }, 'AFM_BUILDER_V4_COMPILE', '$.sources');
  refuse({ ...compilePolicy(), sources: { '../a.swift': SHA } }, 'AFM_BUILDER_V4_COMPILE', '$.sources');
  refuse({ ...compilePolicy(), sources: { 'dir/a.swift': SHA } }, 'AFM_BUILDER_V4_COMPILE', '$.sources');
  refuse({ ...compilePolicy(), sources: { '.': SHA } }, 'AFM_BUILDER_V4_COMPILE', '$.sources');
  refuse({ ...compilePolicy(), sources: { '': SHA } }, 'AFM_BUILDER_V4_COMPILE', '$.sources');
  // sources: bad hash pins
  refuse({ ...compilePolicy(), sources: { 'a.swift': 'z'.repeat(64) } }, 'AFM_BUILDER_V4_PIN', '$.sources.a.swift');
  refuse({ ...compilePolicy(), sources: { 'a.swift': SHA2.slice(0, 63) } }, 'AFM_BUILDER_V4_PIN', '$.sources.a.swift');
  refuse({ ...compilePolicy(), sources: { 'a.swift': 7 } }, 'AFM_BUILDER_V4_PIN', '$.sources.a.swift');
  // output name
  refuse({ ...compilePolicy(), output: 'a/b.o' }, 'AFM_BUILDER_V4_COMPILE', '$.output');
  refuse({ ...compilePolicy(), output: '' }, 'AFM_BUILDER_V4_COMPILE', '$.output');
  refuse({ ...compilePolicy(), output: '..' }, 'AFM_BUILDER_V4_COMPILE', '$.output');
  // manifestHash pin
  refuse({ ...compilePolicy(), manifestHash: 'z'.repeat(64) }, 'AFM_BUILDER_V4_PIN', '$.manifestHash');
  refuse({ ...compilePolicy(), manifestHash: HEX.toUpperCase() }, 'AFM_BUILDER_V4_PIN', '$.manifestHash');
  refuse({ ...compilePolicy(), manifestHash: 7 }, 'AFM_BUILDER_V4_PIN', '$.manifestHash');
  // budget
  refuse({ ...compilePolicy(), budget: 'x' }, 'AFM_BUILDER_V4_COMPILE', '$.budget');
  refuse({ ...compilePolicy(), budget: {} }, 'AFM_BUILDER_V4_MISSING_MEMBER', '$.budget.timeoutSeconds');
  refuse({ ...compilePolicy(), budget: { timeoutSeconds: 0, outputBytes: 1 } }, 'AFM_BUILDER_V4_BUDGET', '$.budget.timeoutSeconds');
  refuse({ ...compilePolicy(), budget: { timeoutSeconds: 301, outputBytes: 1 } }, 'AFM_BUILDER_V4_BUDGET', '$.budget.timeoutSeconds');
  refuse({ ...compilePolicy(), budget: { timeoutSeconds: 1.5, outputBytes: 1 } }, 'AFM_BUILDER_V4_BUDGET', '$.budget.timeoutSeconds');
  refuse({ ...compilePolicy(), budget: { timeoutSeconds: 120, outputBytes: 0 } }, 'AFM_BUILDER_V4_BUDGET', '$.budget.outputBytes');
  refuse({ ...compilePolicy(), budget: { timeoutSeconds: 120, outputBytes: 1048577 } }, 'AFM_BUILDER_V4_BUDGET', '$.budget.outputBytes');
});

test('a valid accepted write plan and policy yield a typed, frozen compile plan', () => {
  const wr = writePlanResult();
  const r = planStagedCompileV1(wr, compilePolicy());
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r), ['ok', 'profile', 'compilePlan']);
  assert.equal(r.profile, AFM_INTERNAL_BUILDER_V4_PROFILE);
  assert.deepEqual(Object.keys(r.compilePlan), ['invoke', 'sources', 'output', 'lane', 'manifestHash', 'packHash', 'sourceStagingHash', 'planHash', 'budget', 'noNetwork']);
  assert.deepEqual(r.compilePlan.invoke, ['swiftc', '-c', 'a.swift', '-o', 'out.o']);
  assert.deepEqual(r.compilePlan.sources, [
    { name: 'a.swift', path: LANE + 'a.swift', sha256: SHA },
    { name: 'b.swift', path: LANE + 'b.swift', sha256: SHA2 },
  ]);
  assert.deepEqual(r.compilePlan.output, { name: 'out.o', path: LANE + 'out.o' });
  assert.equal(r.compilePlan.lane, LANE);
  assert.equal(r.compilePlan.manifestHash, HEX);
  assert.equal(r.compilePlan.packHash, 'a'.repeat(64));
  assert.equal(r.compilePlan.sourceStagingHash, wr.writePlan.stagingHash);
  assert.match(r.compilePlan.planHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(r.compilePlan.budget, { timeoutSeconds: 120, outputBytes: 262144 });
  assert.equal(r.compilePlan.noNetwork, true);
  assert.ok(deepFrozen(r));
  // input mutation after planning cannot affect the compile plan
  const wrMut = writePlanResult(); const cpMut = compilePolicy();
  const r2 = planStagedCompileV1(wrMut, cpMut);
  cpMut.invoke[1] = 'smuggled';
  cpMut.sources['evil.swift'] = SHA;
  wrMut.writePlan.writes[0].bytes = 1;
  assert.deepEqual(r2.compilePlan.invoke[1], '-c');
  assert.deepEqual(r2.compilePlan.sources.length, 2);
  assert.equal(r2.compilePlan.sources[0].bytes, undefined);
  assert.equal(r2.compilePlan.sources[0].sha256, SHA);
});

test('compile refusals are exact and never throw', () => {
  // write-plan-result problems -> $.writePlan
  assert.equal(compileRefusing(null, compilePolicy()).path, '$.writePlan');
  assert.equal(compileRefusing('x', compilePolicy()).path, '$.writePlan');
  assert.equal(compileRefusing({ ok: false, profile: 'nisi-afm-internal-builder-v3', code: 'X', path: '$' }, compilePolicy()).path, '$.writePlan');
  assert.equal(compileRefusing({ ok: true, profile: 'nisi-afm-internal-builder-v4', compilePlan: {} }, compilePolicy()).path, '$.writePlan');
  assert.equal(compileRefusing({ ...writePlanResult(), writePlan: { ...writePlanResult().writePlan, packHash: 'z'.repeat(20) } }, compilePolicy()).path, '$.writePlan');
  assert.equal(compileRefusing({ ...writePlanResult(), writePlan: { ...writePlanResult().writePlan, stagingHash: 'c'.repeat(63) } }, compilePolicy()).path, '$.writePlan');
  // a WRITE PLAN whose stagingHash does not match its own content must refuse
  assert.equal(compileRefusing({ ...writePlanResult(), writePlan: { ...writePlanResult().writePlan, stagingHash: otherHex } }, compilePolicy()).path, '$.writePlan');
  // compile policy problems -> $.compile
  assert.equal(compileRefusing(writePlanResult(), null).path, '$.compile');
  assert.equal(compileRefusing(writePlanResult(), 'x').path, '$.compile');
  assert.equal(compileRefusing(writePlanResult(), { ...compilePolicy(), invoke: 7 }).path, '$.compile');
  // cross-rung pin mismatch -> $.manifestHash
  assert.equal(compileRefusing(writePlanResult(), { ...compilePolicy(), manifestHash: otherHex }).path, '$.manifestHash');
  // compile source not staged by the write plan -> precise per-name path
  assert.equal(compileRefusing(writePlanResult(), { ...compilePolicy(), sources: { 'a.swift': SHA, 'evil.swift': SHA } }).path, '$.sources.evil.swift');
  // compile output must not collide with a staged source
  assert.equal(compileRefusing(writePlanResult(), { ...compilePolicy(), output: 'a.swift' }).path, '$.output');
  // hostile inputs never throw
  let threw = false;
  try { planStagedCompileV1(new Proxy(writePlanResult(), { get() { throw new Error('boom'); } }), compilePolicy()); } catch { threw = true; }
  try { planStagedCompileV1(writePlanResult(), new Proxy(compilePolicy(), { get() { throw new Error('boom'); } })); } catch { threw = true; }
  assert.equal(threw, false, 'hostile write-plan/policy inputs must refuse, not throw');
});

test('compile plan hash is deterministic over the seven canonical fields', () => {
  const r = planStagedCompileV1(writePlanResult(), compilePolicy());
  const h = stagedCompilePlanHashV1(r.compilePlan);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, stagedCompilePlanHashV1(planStagedCompileV1(writePlanResult(), compilePolicy()).compilePlan));
  assert.equal(h, r.compilePlan.planHash);
  assert.notEqual(h, stagedCompilePlanHashV1(planStagedCompileV1(writePlanResult(), { ...compilePolicy(), invoke: ['swiftc', '-O'] }).compilePlan));
  assert.notEqual(h, stagedCompilePlanHashV1(planStagedCompileV1(writePlanResult(), { ...compilePolicy(), sources: { 'a.swift': SHA2, 'b.swift': SHA } }).compilePlan));
  assert.notEqual(h, stagedCompilePlanHashV1(planStagedCompileV1(writePlanResult(), { ...compilePolicy(), output: 'lib.o' }).compilePlan));
  assert.notEqual(h, stagedCompilePlanHashV1(planStagedCompileV1(
    { ...writePlanResult(), writePlan: (() => { const wp = writePlanResult().writePlan; const lane = 'other/staging/'; const writes = wp.writes.map((w) => ({ ...w, path: lane + w.name })); return stagedWritePlan({ writes, lane, manifestHash: wp.manifestHash, packHash: wp.packHash, sourcePlanHash: wp.sourcePlanHash, totalBytes: wp.totalBytes }); })() }, compilePolicy()).compilePlan));
  assert.notEqual(h, stagedCompilePlanHashV1(planStagedCompileV1(
    (() => { const wp = writePlanResult().writePlan; return { ...writePlanResult(), writePlan: stagedWritePlan({ writes: wp.writes, lane: wp.lane, manifestHash: otherHex, packHash: wp.packHash, sourcePlanHash: wp.sourcePlanHash, totalBytes: wp.totalBytes }) }; })(),
    { ...compilePolicy(), manifestHash: otherHex }).compilePlan));
  assert.notEqual(h, stagedCompilePlanHashV1(planStagedCompileV1(
    (() => { const wp = writePlanResult().writePlan; return { ...writePlanResult(), writePlan: stagedWritePlan({ writes: wp.writes, lane: wp.lane, manifestHash: wp.manifestHash, packHash: otherHex, sourcePlanHash: wp.sourcePlanHash, totalBytes: wp.totalBytes }) }; })(),
    compilePolicy()).compilePlan));
  assert.notEqual(h, stagedCompilePlanHashV1(planStagedCompileV1(
    (() => { const wp = writePlanResult().writePlan; const writes = wp.writes.map((w, i) => ({ ...w, bytes: 4096 + i })); const totalBytes = writes.reduce((s, w) => s + w.bytes, 0); return { ...writePlanResult(), writePlan: stagedWritePlan({ writes, lane: wp.lane, manifestHash: wp.manifestHash, packHash: wp.packHash, sourcePlanHash: wp.sourcePlanHash, totalBytes }) }; })(),
    compilePolicy()).compilePlan));
});

test('a generated compile-plan module passes node --check and refuses non-plan inputs', async () => {
  const r = planStagedCompileV1(writePlanResult(), compilePolicy());
  const src = stagedCompilePlanSourceV1(r);
  assert.equal(typeof src, 'string');
  assert.ok(src.includes('export default'));
  const dir = mkdtempSync(join(tmpdir(), 'afm-compile-'));
  const file = join(dir, 'compile-plan.mjs');
  try {
    writeFileSync(file, src);
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    const mod = await import(pathToFileURL(file).href);
    const exported = mod.default;
    assert.deepEqual(exported, r.compilePlan);
    assert.ok(deepFrozen(exported));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const refusal = { ok: false, profile: AFM_INTERNAL_BUILDER_V4_PROFILE, code: 'AFM_BUILDER_V4_INVOKE', path: '$' };
  assert.deepEqual(stagedCompilePlanSourceV1(null), refusal);
  assert.deepEqual(stagedCompilePlanSourceV1('x'), refusal);
  assert.deepEqual(stagedCompilePlanSourceV1(readCompilePolicyV1(compilePolicy())), refusal, 'a compile-policy result is not a compile-plan result');
});

test('rung-4 plans a compile for a REAL write plan from the v3 module (integration)', async () => {
  const { readAfmBuilderPackV1, proposeAfmBuilderStepV1 } = await import('../../afm-internal-builder-v1/src/afm-internal-builder-v1.mjs');
  const { planDeterministicTestRunV1 } = await import('../../afm-internal-builder-v2/src/afm-internal-builder-v2.mjs');
  const { planStagingWritesV1 } = await import('../../afm-internal-builder-v3/src/afm-internal-builder-v3.mjs');
  const packInput = {
    schemaVersion: 1,
    project: 'nisi',
    roadmapDigest: '0'.repeat(64),
    workOrder: { id: 'AFM-DEMO-4', goal: 'Prove rung-4 sandboxed staged compile planning end to end.', acceptance: 'compile plan is lane-scoped, swiftc-invoked, pinned and no-network' },
    lastReceipts: [],
    allowedSteps: ['implement', 'test', 'document'],
    allowedChecks: ['afm-v1-oracle', 'bridge-contract', 'v2-module-check', 'v3-module-check'],
  };
  const read = readAfmBuilderPackV1(packInput);
  assert.equal(read.ok, true);
  const prop = proposeAfmBuilderStepV1(read, { step: 'implement', checks: ['afm-v1-oracle', 'bridge-contract'], explanation: 'End-to-end rung-1 to rung-4 integration.' });
  assert.equal(prop.ok, true);
  const grantPolicy = {
    checks: {
      'bridge-contract': ['node', '--test', 'windows-worker-contract.test.mjs'],
      'afm-v1-oracle': ['node', '--test', 'afm-internal-builder-v1.test.mjs'],
    },
    manifestHash: HEX,
    budget: { timeoutSeconds: 120, outputBytes: 262144 },
  };
  const plan = planDeterministicTestRunV1(prop, grantPolicy);
  assert.equal(plan.ok, true);
  const stagingPolicy = {
    lane: LANE,
    files: { 'a.swift': 2048, 'b.swift': 2048 },
    manifestHash: HEX,
  };
  const writePlan = planStagingWritesV1(plan, stagingPolicy);
  assert.equal(writePlan.ok, true);
  const cp = compilePolicy();
  const compilePlan = planStagedCompileV1(writePlan, cp);
  assert.equal(compilePlan.ok, true);
  assert.equal(compilePlan.compilePlan.manifestHash, HEX);
  assert.equal(compilePlan.compilePlan.sourceStagingHash, writePlan.writePlan.stagingHash);
  assert.equal(compilePlan.compilePlan.packHash, writePlan.writePlan.packHash);
  assert.equal(compilePlan.compilePlan.noNetwork, true);
  assert.ok(compilePlan.compilePlan.invoke[0] === 'swiftc');
  assert.ok(compilePlan.compilePlan.sources.every((s) => s.path.startsWith(LANE)));
  assert.equal(compilePlan.compilePlan.output.path, LANE + 'out.o');
  // misbound compile pin refuses at $.manifestHash
  const misbound = planStagedCompileV1(writePlan, { ...cp, manifestHash: otherHex });
  assert.equal(misbound.ok, false);
  assert.equal(misbound.path, '$.manifestHash');
  // an unstaged source refuses at its precise path
  const unstaged = planStagedCompileV1(writePlan, { ...cp, sources: { 'a.swift': SHA, 'evil.swift': SHA } });
  assert.equal(unstaged.ok, false);
  assert.equal(unstaged.path, '$.sources.evil.swift');
  // an output colliding with a staged source refuses at $.output
  const collide = planStagedCompileV1(writePlan, { ...cp, output: 'a.swift' });
  assert.equal(collide.ok, false);
  assert.equal(collide.path, '$.output');
});