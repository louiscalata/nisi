// Independent oracle for the release-readiness validator (Claude, 2026-09-14).
// The handoff's finding: "self-declared gate inventories can overstate
// readiness". A platform entry that is only {id, status:'PASS'} binds no
// evidence. These tests require every platform to bind a receipt file by
// path+sha256 whose own status is a pass state, and require the artifact and
// product-report digests to be real. Owned temp roots; cleaned on exit.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import {createHash} from 'node:crypto';
import {checkReleaseReadiness} from './check-release-readiness.mjs';
const hash = b => createHash('sha256').update(b).digest('hex');
const PLATFORMS = ['portable', 'native', 'windows', 'install'];
const AUTHORITY = ['legal', 'disclosure', 'release', 'signing', 'notarization', 'publication'];
function fixture(t, receiptFor = id => ({status: 'PASS_SCOPED', authorizing: false})) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nisi-release-h-')); t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.mkdirSync(path.join(root, 'evidence'));
  const a = Buffer.from('archive-bytes'); fs.writeFileSync(path.join(root, 'artifact.tgz'), a);
  const p = Buffer.from(JSON.stringify({status: 'PASS_SCOPED', ready: true, authorizing: false})); fs.writeFileSync(path.join(root, 'product.json'), p);
  const platforms = PLATFORMS.map(id => { const body = Buffer.from(JSON.stringify(receiptFor(id))); const rel = `evidence/${id}.json`; fs.writeFileSync(path.join(root, rel), body); return {id, receipt: {path: rel, sha256: hash(body)}}; });
  return {root, artifact: {path: 'artifact.tgz', sha256: hash(a)}, productReport: {path: 'product.json', sha256: hash(p)}, platforms};
}
const input = (f, patch = {}) => ({schemaVersion: 'nisi-release-readiness-input/v1', artifact: f.artifact, productReport: f.productReport, platforms: f.platforms,
  approvals: Object.fromEntries(AUTHORITY.map(k => [k, {status: 'REQUIRES_AUTHORITY'}])), ...patch});
const notReady = (r, label) => { assert.equal(r.ready, false, label); assert.notEqual(r.status, 'PASS_SCOPED', label); assert.equal(r.authorizing, false, label); assert.equal(r.publishingAllowed, false, label); };

test('control: four platforms each bound to a passing receipt file, real artifact and product digests, is engineering-ready and still non-authorizing', t => {
  const f = fixture(t); const r = checkReleaseReadiness(input(f), {root: f.root});
  assert.equal(r.status, 'PASS_SCOPED'); assert.equal(r.ready, true); assert.equal(r.authorizing, false); assert.equal(r.publishingAllowed, false);
  for (const k of AUTHORITY) assert.equal(r.approvals[k].status, 'REQUIRES_AUTHORITY', k);
  for (const id of PLATFORMS) { assert.equal(r.platforms[id].status, 'PASS', id); assert.equal(r.platforms[id].receiptId ?? r.platforms[id].receipt?.path, `evidence/${id}.json`, 'the platform result names the receipt it was judged on'); }
});

test('a platform declared PASS with NO receipt binding is not a pass: self-declared status is refused', t => {
  const f = fixture(t); const i = input(f); i.platforms = PLATFORMS.map(id => ({id, status: 'PASS_SCOPED'}));
  const r = checkReleaseReadiness(i, {root: f.root}); notReady(r, 'bare status');
  for (const id of PLATFORMS) assert.notEqual(r.platforms?.[id]?.status, 'PASS', id);
});

test('a bound receipt whose own status is adverse keeps that exact status; a receipt with no status or a non-vocabulary status is ERROR', t => {
  for (const state of ['FAIL', 'NOT_RUN', 'INCONCLUSIVE', 'ERROR', 'REQUIRES_AUTHORITY']) {
    const f = fixture(t, id => ({status: id === 'windows' ? state : 'PASS_SCOPED', authorizing: false}));
    const r = checkReleaseReadiness(input(f), {root: f.root}); notReady(r, state);
    assert.equal(r.platforms.windows.status, state, state); assert.equal(r.platforms.portable.status, 'PASS');
  }
  const g = fixture(t, id => ({status: 'OK', authorizing: false})); const rg = checkReleaseReadiness(input(g), {root: g.root}); notReady(rg, 'OK'); assert.equal(rg.platforms.portable.status, 'ERROR');
  const h = fixture(t, id => ({authorizing: false})); notReady(checkReleaseReadiness(input(h), {root: h.root}), 'no status');
});

test('a receipt edited after it was declared (digest mismatch), a missing receipt, and a receipt outside the root or through a symlink never pass', t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.root, 'evidence/native.json'), JSON.stringify({status: 'PASS_SCOPED', authorizing: false, note: 'edited'}));
  const r = checkReleaseReadiness(input(f), {root: f.root}); notReady(r, 'edited'); assert.equal(r.platforms.native.status, 'INCONCLUSIVE');
  const g = fixture(t); fs.rmSync(path.join(g.root, 'evidence/install.json')); const rg = checkReleaseReadiness(input(g), {root: g.root}); notReady(rg, 'missing'); assert.equal(rg.platforms.install.status, 'NOT_RUN');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'nisi-out-')); t.after(() => fs.rmSync(outside, {recursive: true, force: true}));
  const body = Buffer.from(JSON.stringify({status: 'PASS_SCOPED', authorizing: false})); fs.writeFileSync(path.join(outside, 'r.json'), body);
  const s = fixture(t); fs.symlinkSync(path.join(outside, 'r.json'), path.join(s.root, 'evidence', 'link.json')); const i = input(s); i.platforms[1] = {id: 'native', receipt: {path: 'evidence/link.json', sha256: hash(body)}};
  const rs = checkReleaseReadiness(i, {root: s.root}); notReady(rs, 'symlink'); assert.notEqual(rs.platforms.native.status, 'PASS');
  for (const p of ['../r.json', '/etc/hosts', 'evidence/../../r.json', '']) { const j = input(s); j.platforms[1] = {id: 'native', receipt: {path: p, sha256: hash(body)}}; assert.notEqual(checkReleaseReadiness(j, {root: s.root}).platforms?.native?.status, 'PASS', p); }
});

test('a placeholder or malformed digest on the artifact or product report is an ERROR with INVALID_FILE_BINDING, not a quiet gap', t => {
  const f = fixture(t);
  for (const bad of ['REQUIRES_CURRENT_PIN', 'x'.repeat(64), 'A'.repeat(64), '', 'a'.repeat(63)]) {
    const r = checkReleaseReadiness(input(f, {artifact: {path: 'artifact.tgz', sha256: bad}}), {root: f.root}); notReady(r, bad);
    assert.equal(r.artifact.status, 'ERROR', bad); assert.equal(r.artifact.reason, 'INVALID_FILE_BINDING', bad);
  }
  const r2 = checkReleaseReadiness(input(f, {productReport: {path: 'product.json', sha256: 'REQUIRES_CURRENT_PIN'}}), {root: f.root}); notReady(r2, 'report placeholder'); assert.equal(r2.productReport.status, 'ERROR');
});

test('the product report must itself be a scoped, ready, non-authorizing report: a report that is ready:true but authorizing:true, or not ready, or not JSON, never passes', t => {
  for (const [label, body] of [['authorizing', {status: 'PASS_SCOPED', ready: true, authorizing: true}], ['not ready', {status: 'INCONCLUSIVE', ready: false, authorizing: false}], ['ready without status', {ready: true, authorizing: false}], ['not json', 'nope']]) {
    const f = fixture(t); const p = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)); fs.writeFileSync(path.join(f.root, 'product.json'), p);
    const r = checkReleaseReadiness(input(f, {productReport: {path: 'product.json', sha256: hash(p)}}), {root: f.root}); notReady(r, label);
  }
});

test('approvals are never inferred: any supplied approval status, including PASS or APPROVED, reports REQUIRES_AUTHORITY, and an unknown approval key is refused', t => {
  const f = fixture(t);
  const r = checkReleaseReadiness(input(f, {approvals: Object.fromEntries(AUTHORITY.map(k => [k, {status: 'APPROVED', by: 'someone'}]))}), {root: f.root});
  for (const k of AUTHORITY) assert.equal(r.approvals[k].status, 'REQUIRES_AUTHORITY', k);
  assert.equal(r.publishingAllowed, false);
  const bad = checkReleaseReadiness(input(f, {approvals: {...Object.fromEntries(AUTHORITY.map(k => [k, {}])), marketing: {}}}), {root: f.root});
  assert.equal(bad.status, 'ERROR', 'extra approval key'); assert.equal(bad.publishingAllowed, false);
  const missing = checkReleaseReadiness(input(f, {approvals: Object.fromEntries(AUTHORITY.slice(1).map(k => [k, {}]))}), {root: f.root});
  assert.equal(missing.status, 'ERROR', 'missing approval key');
});

test('the platform matrix is exact: a duplicate id, a missing id, an unknown id, or five entries is INCOMPLETE_PLATFORM_MATRIX', t => {
  const f = fixture(t);
  for (const [label, platforms] of [['dup', [f.platforms[0], ...f.platforms.slice(0, 3)]], ['missing', f.platforms.slice(0, 3)], ['unknown', [...f.platforms.slice(0, 3), {...f.platforms[3], id: 'linux'}]], ['five', [...f.platforms, f.platforms[0]]]]) {
    const r = checkReleaseReadiness(input(f, {platforms}), {root: f.root}); assert.equal(r.status, 'ERROR', label); assert.equal(r.reason, 'INCOMPLETE_PLATFORM_MATRIX', label); assert.equal(r.publishingAllowed, false, label);
  }
});

test('the validator is pure and read-only: no files created, input not mutated, result frozen and repeatable', t => {
  const f = fixture(t); const before = fs.readdirSync(f.root).sort(); const i = input(f); const snap = JSON.stringify(i);
  const a = checkReleaseReadiness(i, {root: f.root}); const b = checkReleaseReadiness(i, {root: f.root});
  assert.deepEqual(a, b); assert.equal(JSON.stringify(i), snap); assert.deepEqual(fs.readdirSync(f.root).sort(), before);
  assert.ok(Object.isFrozen(a)); assert.throws(() => { a.publishingAllowed = true; }, TypeError);
});

test('the retained current-readiness.json for this repository is NOT ready and is refused for its placeholder pins, which is the honest current state', t => {
  const current = JSON.parse(fs.readFileSync(new URL('./current-readiness.json', import.meta.url), 'utf8'));
  const r = checkReleaseReadiness(current, {root: path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..')});
  notReady(r, 'current');
});
