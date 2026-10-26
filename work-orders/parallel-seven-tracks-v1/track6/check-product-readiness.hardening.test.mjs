// Independent oracle for the readiness checker (Claude, 2026-09-14). The
// author's tests prove the happy path; these prove that evidence which SHOULD
// NOT count does not count. Written against the handoff's finding: "generic
// PASS fields/empty manifests and self-declared gate inventories can overstate
// readiness". Owned temp roots; cleaned on success and failure.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import {createHash} from 'node:crypto';
import {checkProductReadiness} from './check-product-readiness.mjs';
const hash = b => createHash('sha256').update(b).digest('hex');
const LANES = ['portable', 'native', 'windows', 'install', 'evaluation'];
function fixture(t, receiptBody = lane => ({schema: 'fixture-v1', status: 'PASS_SCOPED', sourceManifest: {'package.json': hash(Buffer.from('fixture\n'))}})) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nisi-readiness-h-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.mkdirSync(path.join(root, 'evidence')); fs.writeFileSync(path.join(root, 'package.json'), 'fixture\n');
  const receipts = [];
  for (const lane of LANES) { const body = JSON.stringify(receiptBody(lane)); const p = `evidence/${lane}.json`; fs.writeFileSync(path.join(root, p), body); receipts.push({id: lane, path: p, sha256: hash(Buffer.from(body))}); }
  return {root, receipts};
}
const input = (f, patch = {}) => ({schemaVersion: 'nisi-product-readiness-input/v1', receipts: f.receipts, sourcePins: [{path: 'package.json', sha256: hash(Buffer.from('fixture\n'))}],
  featureInventory: {required: ['workflow'], observed: ['workflow']}, gates: LANES.map(lane => ({id: lane, lane, receiptId: lane})), ...patch});
const notReady = (r, label) => { assert.equal(r.ready, false, label); assert.notEqual(r.status, 'PASS_SCOPED', label); assert.equal(r.authorizing, false, label); };

test('control: the clean fixture is ready, so every refusal below is attributable to its one change', t => {
  const f = fixture(t); const r = checkProductReadiness(input(f), {root: f.root});
  assert.equal(r.status, 'PASS_SCOPED'); assert.equal(r.ready, true);
  assert.deepEqual(Object.keys(r), ['schemaVersion', 'status', 'ready', 'authorizing', 'lanes', 'source', 'featureInventory']);
});

test('a PASS receipt with an EMPTY sourceManifest binds nothing and must not count', t => {
  const f = fixture(t, () => ({schema: 'fixture-v1', status: 'PASS', sourceManifest: {}}));
  const r = checkProductReadiness(input(f), {root: f.root});
  notReady(r, 'empty manifest');
  for (const lane of LANES) assert.notEqual(r.lanes[lane].status, 'PASS', lane);
});

test('a PASS receipt whose sourceManifest names a file that does not exist, or a wrong hash, is INCONCLUSIVE not PASS', t => {
  const missing = fixture(t, () => ({schema: 'fixture-v1', status: 'PASS', sourceManifest: {'nope.mjs': 'a'.repeat(64)}}));
  const r1 = checkProductReadiness(input(missing), {root: missing.root}); notReady(r1, 'missing pinned file');
  assert.ok(LANES.every(l => r1.lanes[l].status === 'INCONCLUSIVE'), JSON.stringify(r1.lanes.portable));
  const wrong = fixture(t, () => ({schema: 'fixture-v1', status: 'PASS', sourceManifest: {'package.json': 'b'.repeat(64)}}));
  const r2 = checkProductReadiness(input(wrong), {root: wrong.root}); notReady(r2, 'wrong hash');
  assert.equal(r2.lanes.portable.reason, 'CURRENT_SOURCE_DRIFT');
});

test('a generic status string that is not in the accepted vocabulary, or a receipt without status, is ERROR', t => {
  const f = fixture(t, () => ({schema: 'fixture-v1', status: 'OK', sourceManifest: {'package.json': hash(Buffer.from('fixture\n'))}}));
  const r = checkProductReadiness(input(f), {root: f.root}); notReady(r, 'status OK');
  assert.ok(LANES.every(l => r.lanes[l].status === 'ERROR'));
  const g = fixture(t, () => ({schema: 'fixture-v1', sourceManifest: {'package.json': hash(Buffer.from('fixture\n'))}}));
  notReady(checkProductReadiness(input(g), {root: g.root}), 'no status');
});

test('adverse receipt states are preserved exactly and never coerced: FAIL, NOT_RUN, ERROR, INCONCLUSIVE, REQUIRES_AUTHORITY', t => {
  for (const state of ['FAIL', 'NOT_RUN', 'ERROR', 'INCONCLUSIVE', 'REQUIRES_AUTHORITY']) {
    const f = fixture(t, lane => ({schema: 'fixture-v1', status: lane === 'native' ? state : 'PASS_SCOPED', sourceManifest: {'package.json': hash(Buffer.from('fixture\n'))}}));
    const r = checkProductReadiness(input(f), {root: f.root}); notReady(r, state);
    assert.equal(r.lanes.native.status, state, state); assert.equal(r.lanes.native.historicalStatus, state, state);
    assert.equal(r.lanes.portable.status, 'PASS', 'the other lanes are still judged on their own evidence');
  }
});

test('the declared receipt digest is the binding: a receipt edited after declaration is INCONCLUSIVE, and a stale declaration cannot be rescued by a matching status', t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.root, 'evidence/native.json'), JSON.stringify({schema: 'fixture-v1', status: 'PASS', sourceManifest: {'package.json': hash(Buffer.from('fixture\n'))}}));
  const r = checkProductReadiness(input(f), {root: f.root}); notReady(r, 'edited after declaration');
  assert.equal(r.lanes.native.status, 'INCONCLUSIVE'); assert.equal(r.lanes.native.reason, 'RECEIPT_DIGEST_MISMATCH');
});

test('a self-declared gate cannot bring its own evidence: a gate pointing at an undeclared receipt id is ERROR, a duplicate receipt id is refused outright', t => {
  const f = fixture(t); const i = input(f); i.gates[1] = {id: 'native', lane: 'native', receiptId: 'made-up'};
  const r = checkProductReadiness(i, {root: f.root}); notReady(r, 'unknown receipt'); assert.equal(r.lanes.native.status, 'ERROR'); assert.equal(r.lanes.native.reason, 'UNKNOWN_RECEIPT');
  const j = input(f); j.receipts = [...f.receipts, {...f.receipts[0]}];
  const r2 = checkProductReadiness(j, {root: f.root}); assert.equal(r2.status, 'ERROR'); assert.equal(r2.reason, 'INVALID_RECEIPT_ID');
  const k = input(f); k.gates = [...k.gates, {id: 'native2', lane: 'native', receiptId: 'portable'}];
  const r3 = checkProductReadiness(k, {root: f.root}); assert.equal(r3.lanes.native.receiptId, 'native', 'the first declaration for a lane wins; a second cannot override it');
});

test('feature inventory: a required feature missing from observed is INCONCLUSIVE; a malformed inventory is not treated as complete', t => {
  const f = fixture(t);
  notReady(checkProductReadiness(input(f, {featureInventory: {required: ['workflow', 'history'], observed: ['workflow']}}), {root: f.root}), 'missing feature');
  for (const bad of [null, 'x', {required: 'workflow', observed: ['workflow']}, {required: []}, {}]) {
    const r = checkProductReadiness(input(f, {featureInventory: bad}), {root: f.root});
    assert.equal(r.featureInventory.complete, false, JSON.stringify(bad)); notReady(r, JSON.stringify(bad));
  }
  const r = checkProductReadiness(input(f, {featureInventory: {required: [], observed: []}}), {root: f.root});
  assert.equal(r.featureInventory.complete, false, 'an EMPTY required list is not a complete inventory');
});

test('receipt paths cannot escape the root or pass through symlinks, and an oversize receipt is refused', t => {
  const f = fixture(t); const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'nisi-outside-')); t.after(() => fs.rmSync(outside, {recursive: true, force: true}));
  fs.writeFileSync(path.join(outside, 'r.json'), JSON.stringify({status: 'PASS', sourceManifest: {'package.json': hash(Buffer.from('fixture\n'))}}));
  fs.symlinkSync(path.join(outside, 'r.json'), path.join(f.root, 'evidence', 'link.json'));
  const i = input(f); i.receipts[1] = {id: 'native', path: 'evidence/link.json', sha256: hash(fs.readFileSync(path.join(outside, 'r.json')))};
  const r = checkProductReadiness(i, {root: f.root}); notReady(r, 'symlink'); assert.notEqual(r.lanes.native.status, 'PASS');
  for (const p of ['../r.json', '/etc/hosts', 'evidence/../../r.json', 'evidence/./native.json', '']) {
    const j = input(f); j.receipts[1] = {id: 'native', path: p, sha256: 'c'.repeat(64)};
    const rr = checkProductReadiness(j, {root: f.root}); assert.notEqual(rr.lanes?.native?.status, 'PASS', p);
  }
  const big = fixture(t); fs.writeFileSync(path.join(big.root, 'evidence/native.json'), Buffer.alloc(4 * 1024 * 1024 + 1, 0x20));
  const k = input(big); k.receipts[1] = {id: 'native', path: 'evidence/native.json', sha256: hash(fs.readFileSync(path.join(big.root, 'evidence/native.json')))};
  assert.equal(checkProductReadiness(k, {root: big.root}).lanes.native.status, 'ERROR');
});

test('the checker is read-only and pure: it creates nothing, mutates nothing, and the same input yields the same output', t => {
  const f = fixture(t); const before = fs.readdirSync(path.join(f.root, 'evidence')).sort(); const i = input(f); const snapshot = JSON.stringify(i);
  const a = checkProductReadiness(i, {root: f.root}); const b = checkProductReadiness(i, {root: f.root});
  assert.deepEqual(a, b); assert.equal(JSON.stringify(i), snapshot, 'input not mutated');
  assert.deepEqual(fs.readdirSync(path.join(f.root, 'evidence')).sort(), before, 'nothing created');
  assert.ok(Object.isFrozen(a));
  assert.throws(() => { a.ready = true; }, TypeError, 'the result cannot be flipped after the fact');
});

test('current product is NOT ready when judged on real receipts that lack a source manifest (the actual known gap)', t => {
  const f = fixture(t, lane => ({schema: 'fixture-v1', status: 'PASS_SCOPED'}));
  const r = checkProductReadiness(input(f), {root: f.root}); notReady(r, 'no manifests');
  assert.ok(LANES.every(l => r.lanes[l].status === 'INCONCLUSIVE' && r.lanes[l].reason === 'MISSING_SOURCE_MANIFEST'));
});
