// Protected oracle for the AFM internal builder first increment (contract-first,
// written from the design's firstIncrement spec before the module was filled).
// Drafters must not edit this file to make a failing draft pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AFM_BUILDER_PROFILE_V1, AFM_BUILDER_LIMITS_V1, AFM_BUILDER_CODES_V1,
  readAfmBuilderPackV1, afmBuilderPackHashV1, proposeAfmBuilderStepV1, proposalModuleSourceV1,
} from '../src/afm-internal-builder-v1.mjs';

const HEX = '0'.repeat(63) + '1';
const pack = () => ({
  schemaVersion: 1,
  project: 'nisi',
  roadmapDigest: HEX,
  workOrder: { id: 'AFM-DEMO-1', goal: 'Propose the next bounded step.', acceptance: 'step in allowedSteps; checks subset of allowedChecks' },
  lastReceipts: ['oracle-final: 19/19 PASS (render-tile-v1)'],
  allowedSteps: ['implement', 'test', 'document'],
  allowedChecks: ['swift-build', 'swift-test', 'unit-01'],
});
const ok = (input) => { const r = readAfmBuilderPackV1(input); assert.equal(r.ok, true, JSON.stringify(r)); return r; };
const refuse = (input, code, path) => {
  const r = readAfmBuilderPackV1(input);
  assert.deepEqual({ ok: r.ok, code: r.code, path: r.path }, { ok: false, code, path });
  assert.equal(r.profile, AFM_BUILDER_PROFILE_V1);
  assert.deepEqual(Object.keys(r).sort(), ['code', 'ok', 'path', 'profile']);
  assert.ok(Object.isFrozen(r));
};
const noThrow = (name, make) => {
  try { readAfmBuilderPackV1(make()); } catch (e) { assert.fail(`${name} threw ${e && e.constructor.name}: ${String(e && e.message).slice(0, 60)}`); }
};
const deepFrozen = (x, seen = new Set()) => {
  if (!x || typeof x !== 'object' || seen.has(x)) return true;
  seen.add(x);
  return Object.isFrozen(x) && Object.values(x).every((v) => deepFrozen(v, seen));
};

test('constants are frozen and exact', () => {
  assert.equal(AFM_BUILDER_PROFILE_V1, 'nisi-afm-internal-builder-v1');
  assert.deepEqual(AFM_BUILDER_LIMITS_V1, { receipts: 16, steps: 16, checks: 16, checksPerProposal: 3, explanationLength: 512 });
  assert.deepEqual(AFM_BUILDER_CODES_V1, [
    'AFM_BUILDER_NOT_OBJECT', 'AFM_BUILDER_UNKNOWN_MEMBER', 'AFM_BUILDER_MISSING_MEMBER', 'AFM_BUILDER_SCHEMA_VERSION',
    'AFM_BUILDER_PROJECT', 'AFM_BUILDER_WORK_ORDER', 'AFM_BUILDER_ALLOWED_STEPS', 'AFM_BUILDER_ALLOWED_CHECKS',
    'AFM_BUILDER_RECEIPTS', 'AFM_BUILDER_PROPOSAL']);
  for (const c of [AFM_BUILDER_LIMITS_V1, AFM_BUILDER_CODES_V1]) assert.ok(Object.isFrozen(c));
});

test('a valid pack reads to a fresh, deep-frozen result', () => {
  const input = pack();
  const r = ok(input);
  assert.deepEqual(Object.keys(r), ['ok', 'profile', 'pack']);
  assert.equal(r.profile, AFM_BUILDER_PROFILE_V1);
  assert.deepEqual(Object.keys(r.pack), ['schemaVersion', 'project', 'roadmapDigest', 'workOrder', 'lastReceipts', 'allowedSteps', 'allowedChecks']);
  assert.deepEqual(Object.keys(r.pack.workOrder), ['id', 'goal', 'acceptance']);
  assert.ok(deepFrozen(r) && deepFrozen(r.pack));
  input.workOrder.id = 'MUTATED';
  input.allowedSteps.push('smuggle');
  assert.equal(r.pack.workOrder.id, 'AFM-DEMO-1');
  assert.deepEqual(r.pack.allowedSteps, ['implement', 'test', 'document']);
});

test('reader never throws and refuses non-objects', () => {
  for (const bad of [null, undefined, 'x', 1, 1n, true, Symbol('s'), () => {}, [], new Date(0)])
    refuse(bad, 'AFM_BUILDER_NOT_OBJECT', '$');
  noThrow('proxy root', () => new Proxy(pack(), { get() { throw new Error('boom'); } }));
  noThrow('proxy getPrototypeOf', () => new Proxy({}, { getPrototypeOf() { throw new Error('boom'); } }));
  noThrow('throwing getter', () => { const p = pack(); Object.defineProperty(p, 'project', { get() { throw new Error('boom'); }, enumerable: true }); return p; });
  noThrow('throwing keys trap', () => new Proxy(pack(), { ownKeys() { throw new Error('boom'); } }));
  noThrow('throwing descriptor trap', () => new Proxy(pack(), { getOwnPropertyDescriptor() { throw new Error('boom'); } }));
  noThrow('cyclic pack', () => { const p = pack(); p.self = p; return p; });
});

test('unknown and missing members before values, at every level', () => {
  refuse({ ...pack(), extra: 1 }, 'AFM_BUILDER_UNKNOWN_MEMBER', '$.extra');
  refuse({ ...pack(), extra: 1, project: 7 }, 'AFM_BUILDER_UNKNOWN_MEMBER', '$.extra');
  refuse({ ...pack(), workOrder: { ...pack().workOrder, extra: 1 } }, 'AFM_BUILDER_UNKNOWN_MEMBER', '$.workOrder.extra');
  const missing = pack(); delete missing.roadmapDigest;
  refuse(missing, 'AFM_BUILDER_MISSING_MEMBER', '$.roadmapDigest');
  const missingGoal = pack(); delete missingGoal.workOrder.goal;
  refuse(missingGoal, 'AFM_BUILDER_MISSING_MEMBER', '$.workOrder.goal');
});

test('member values refuse with the exact codes', () => {
  refuse({ ...pack(), schemaVersion: '1' }, 'AFM_BUILDER_SCHEMA_VERSION', '$.schemaVersion');
  refuse({ ...pack(), schemaVersion: 2 }, 'AFM_BUILDER_SCHEMA_VERSION', '$.schemaVersion');
  refuse({ ...pack(), project: '' }, 'AFM_BUILDER_PROJECT', '$.project');
  refuse({ ...pack(), project: 7 }, 'AFM_BUILDER_PROJECT', '$.project');
  refuse({ ...pack(), roadmapDigest: 'z'.repeat(64) }, 'AFM_BUILDER_PROJECT', '$.roadmapDigest');
  refuse({ ...pack(), roadmapDigest: HEX.slice(0, 63) }, 'AFM_BUILDER_PROJECT', '$.roadmapDigest');
  refuse({ ...pack(), workOrder: null }, 'AFM_BUILDER_WORK_ORDER', '$.workOrder');
  refuse({ ...pack(), workOrder: { id: '', goal: 'g', acceptance: 'a' } }, 'AFM_BUILDER_WORK_ORDER', '$.workOrder.id');
  refuse({ ...pack(), workOrder: { id: 'i', goal: '', acceptance: 'a' } }, 'AFM_BUILDER_WORK_ORDER', '$.workOrder.goal');
  refuse({ ...pack(), lastReceipts: 'x' }, 'AFM_BUILDER_RECEIPTS', '$.lastReceipts');
  refuse({ ...pack(), lastReceipts: ['ok', ''] }, 'AFM_BUILDER_RECEIPTS', '$.lastReceipts[1]');
  refuse({ ...pack(), lastReceipts: Array.from({ length: 17 }, (_, i) => 'r' + i) }, 'AFM_BUILDER_RECEIPTS', '$.lastReceipts');
  refuse({ ...pack(), allowedSteps: [] }, 'AFM_BUILDER_ALLOWED_STEPS', '$.allowedSteps');
  refuse({ ...pack(), allowedSteps: ['a', 'a'] }, 'AFM_BUILDER_ALLOWED_STEPS', '$.allowedSteps');
  refuse({ ...pack(), allowedSteps: ['a', 7] }, 'AFM_BUILDER_ALLOWED_STEPS', '$.allowedSteps[1]');
  refuse({ ...pack(), allowedSteps: Array.from({ length: 17 }, (_, i) => 's' + i) }, 'AFM_BUILDER_ALLOWED_STEPS', '$.allowedSteps');
  refuse({ ...pack(), allowedChecks: [] }, 'AFM_BUILDER_ALLOWED_CHECKS', '$.allowedChecks');
  refuse({ ...pack(), allowedChecks: ['a', 'a'] }, 'AFM_BUILDER_ALLOWED_CHECKS', '$.allowedChecks');
  refuse({ ...pack(), allowedChecks: ['a', ''] }, 'AFM_BUILDER_ALLOWED_CHECKS', '$.allowedChecks[1]');
});

test('pack hash is deterministic over the five identity members only', () => {
  const r = ok(pack());
  const h1 = afmBuilderPackHashV1(r.pack);
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.equal(h1, afmBuilderPackHashV1(ok(pack()).pack));
  assert.notEqual(h1, afmBuilderPackHashV1(ok({ ...pack(), workOrder: { ...pack().workOrder, id: 'OTHER' } }).pack));
  assert.equal(h1, afmBuilderPackHashV1(ok({ ...pack(), lastReceipts: ['different receipt'] }).pack));
});

const policy = () => ({ step: 'implement', checks: ['swift-build', 'unit-01'], explanation: 'Continue the render tile lane with its existing oracle.' });
const propose = (readResult, p = policy()) => proposeAfmBuilderStepV1(readResult, p);

test('an accepted pack with a valid policy yields a typed proposal', () => {
  const read = ok(pack());
  const r = propose(read);
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r), ['ok', 'profile', 'proposal']);
  assert.deepEqual(Object.keys(r.proposal), ['proposedStep', 'testsToRun', 'explanation', 'packHash']);
  assert.equal(r.profile, AFM_BUILDER_PROFILE_V1);
  assert.equal(r.proposal.proposedStep, 'implement');
  assert.deepEqual(r.proposal.testsToRun, ['swift-build', 'unit-01']);
  assert.equal(r.proposal.packHash, afmBuilderPackHashV1(read.pack));
  assert.ok(deepFrozen(r));
  assert.ok(Object.isFrozen(r));
});

test('proposal refusals are exact and never throw', () => {
  const read = ok(pack());
  const bad = (readResult, p, path) => {
    const r = proposeAfmBuilderStepV1(readResult, p);
    assert.deepEqual({ ok: r.ok, code: r.code, path: r.path }, { ok: false, code: 'AFM_BUILDER_PROPOSAL', path });
    assert.ok(Object.isFrozen(r));
  };
  bad(read, null, '$');
  bad(read, 'x', '$');
  bad(read, { step: 'document', checks: [], explanation: 'e' }, '$.checks');
  bad(read, { step: 'document', checks: ['nope'], explanation: 'e' }, '$.checks');
  bad(read, { step: 'document', checks: ['swift-build', 'swift-build'], explanation: 'e' }, '$.checks');
  bad(read, { step: 'document', checks: ['swift-build', 'swift-test', 'unit-01', 'extra'], explanation: 'e' }, '$.checks');
  bad(read, { step: 'fly', checks: ['swift-build'], explanation: 'e' }, '$.step');
  bad(read, { step: 'document', checks: ['swift-build'], explanation: '' }, '$.explanation');
  bad(read, { step: 'document', checks: ['swift-build'], explanation: 'x'.repeat(513) }, '$.explanation');
  bad(read, { step: 'document', checks: ['swift-build'], explanation: 'e', extra: 1 }, '$.extra');
  const noChecks = policy(); delete noChecks.checks;
  bad(read, noChecks, '$.checks');
  bad({ ok: false, profile: AFM_BUILDER_PROFILE_V1, code: 'AFM_BUILDER_NOT_OBJECT', path: '$' }, policy(), '$');
  bad(null, policy(), '$');
  // policies that throw must refuse, never throw
  bad(read, new Proxy({}, { get() { throw new Error('boom'); } }), '$');
});

test('testsToRun keeps the policy order and the empty pack check order', () => {
  const read = ok(pack());
  const r = propose(read, { step: 'test', checks: ['unit-01', 'swift-build'], explanation: 'Re-run the oracle.' });
  assert.deepEqual(r.proposal.testsToRun, ['unit-01', 'swift-build']);
  ok({ ...pack(), allowedChecks: ['a', 'b', 'c', 'd'] });
  const r2 = propose(read, { step: 'test', checks: ['swift-test', 'swift-build'], explanation: 'Run both.' });
  assert.deepEqual(r2.proposal.testsToRun, ['swift-test', 'swift-build']);
});

test('a generated proposal module passes node --check', () => {
  const read = ok(pack());
  const r = propose(read);
  const src = proposalModuleSourceV1(r);
  assert.equal(typeof src, 'string');
  assert.ok(src.includes('export default'));
  const dir = mkdtempSync(join(tmpdir(), 'afm-proposal-'));
  const file = join(dir, 'proposal.mjs');
  try {
    writeFileSync(file, src);
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const refusal = proposalModuleSourceV1({ ok: false, profile: AFM_BUILDER_PROFILE_V1, code: 'AFM_BUILDER_PROPOSAL', path: '$' });
  assert.deepEqual(refusal, { ok: false, profile: AFM_BUILDER_PROFILE_V1, code: 'AFM_BUILDER_PROPOSAL', path: '$' });
  assert.deepEqual(proposalModuleSourceV1(null), refusal);
  assert.deepEqual(proposalModuleSourceV1('x'), refusal);
  assert.deepEqual(proposalModuleSourceV1(read), refusal, 'a read-pack result is not a proposal result');
});
