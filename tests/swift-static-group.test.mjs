// PRIVATE object consistency tests. Native execution is tested separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSwiftCheckPlanV1, issuedSwiftChecksV1 } from '../hosts/swift-verifier/check-plan-v1.mjs';
import { createSwiftStaticGroupV1 as create, readSwiftStaticGroupV1 as read } from '../receipts/swift-static-group-v1.mjs';
import { sha256Text, stableStringify } from '../workflow/contracts.mjs';
import { plan, prep, entry, undispatched, files, targets, profile, runId } from './helpers/swift-group-fixture.mjs';
const refusal = (fn, code) => assert.throws(fn, e => e.code === code);
const all = p => p.targets.map((_, i) => entry(p, i));
const rehash = v => { const { fingerprint, ...identity } = v;
  return { ...identity, fingerprint: sha256Text('nisi/swift-static-group/v1\0' + stableStringify(identity)) }; };

test('group plan binds same-profile files separately and canonicalizes target order', () => {
  const p = plan(), checks = issuedSwiftChecksV1(p);
  assert.equal(new Set(checks.map(c => c.expected.fingerprint)).size, 3);
  assert.equal(new Set(checks.map(c => c.expected.binding.checkId)).size, 3);
  assert.equal(checks[0].expected.profile.id, checks[1].expected.profile.id);
  assert.equal(plan({ targets: [...targets].reverse() }).fingerprint, p.fingerprint);
  assert.deepEqual(p.targets.map(t => t.path), files.map(f => f.path));
  assert(Object.isFrozen(p.targets[0]));
  refusal(() => issuedSwiftChecksV1(structuredClone(p)), 'SWIFT_PLAN_NOT_ISSUED');
  for (const change of [{ attempt: 1 }, { runId: '12345678-1234-4234-8234-000000000001' },
    { preparation: prep([{ path: 'a.json', content: '[]' }]) },
    { targets: targets.map((v, i) => i === 0 ? { ...v, profileId: 'nisi-text-structure-v1' } : v) },
    { executionProfile: { ...profile, timeoutMs: 4000 } }]) {
    assert.notEqual(plan(change).fingerprint, p.fingerprint);
    assert.notEqual(issuedSwiftChecksV1(plan(change))[1].expected.fingerprint, checks[1].expected.fingerprint);
  }
});

test('plan requires exact full materialized coverage, even for a one-file patch', () => {
  for (const bad of [[], targets.slice(1), [...targets, targets[0]], [targets[0], targets[0], targets[2]],
    [{ ...targets[0], path: 'other.json' }, ...targets.slice(1)]]) assert.throws(() => plan({ targets: bad }));
  assert.throws(() => plan({ preparation: prep([{ path: 'a.json', content: '[]' }]), targets: [targets[0]] }));
  refusal(() => plan({ preparation: structuredClone(prep()) }), 'SWIFT_PLAN_PREPARATION');
  refusal(() => plan({ targets: [{ ...targets[0], path: 'other.json' }, ...targets.slice(1)] }), 'SWIFT_PLAN_INVENTORY');
  refusal(() => plan({ targets: [targets[0], targets[0], targets[2]] }), 'SWIFT_PLAN_DUPLICATE');
  assert.throws(() => plan({ targets: targets.map((v, i) => i ? v : { ...v, profileId: '__proto__' }) }));
});

test('plan rejects non-closed arrays and execution profiles without running getters', () => {
  for (const mutate of [v => Object.setPrototypeOf(v, null), v => Object.defineProperty(v, '0', { enumerable: false }),
    v => { v.extra = true; }, v => { delete v[0]; }]) {
    const value = [...targets]; mutate(value); assert.throws(() => plan({ targets: value }));
  }
  assert.throws(() => plan({ executionProfile: { ...profile, id: 'smuggled' } }));
  refusal(() => plan({ executionProfile: { ...profile, argv: ['--unapproved'] } }), 'SWIFT_PLAN_PROFILE_SCHEMA');
  let invoked = false;
  assert.throws(() => createSwiftCheckPlanV1({ preparation: prep(), runId, attempt: 0, executionProfile: profile,
    get targets() { invoked = true; return targets; } })); assert.equal(invoked, false);
});

test('group derives PASS and scoped findings from exact native bytes, never grants authority', () => {
  const p = plan(), entries = all(p), passed = create(p, entries);
  assert.equal(read(passed, p).aggregate.counts.PASS, 3);
  assert.equal(passed.adapterResult.status, 'PASS');
  for (const key of ['executionVerified', 'authorizing', 'certificationGranted']) assert.equal(passed[key], false);
  entries[1] = entry(p, 1, 'FAIL'); const failed = create(p, entries);
  assert.equal(failed.adapterResult.status, 'FAIL'); assert.equal(failed.aggregate.counts.PASS, 2);
  assert.match(failed.adapterResult.evidence.findings[0].message, /^b\.json:/);
  assert.equal(failed.aggregate.knownFindings.length, 1);
});

test('group refuses missing extra reordered duplicate or wrong-candidate child receipts', () => {
  const p = plan(), entries = all(p);
  for (const bad of [[], entries.slice(0, 2), entries.slice(1), [...entries, entries[0]], [...entries].reverse(),
    [entries[0], entries[0], entries[2]], [entries[1], entries[0], entries[2]],
    [entry(plan({ attempt: 1 }), 0), ...entries.slice(1)]]) assert.throws(() => create(p, bad));
  for (const mutate of [v => Object.setPrototypeOf(v, null), v => Object.defineProperty(v, '0', { enumerable: false }),
    v => { v.extra = true; }]) { const bad = [...entries]; mutate(bad); assert.throws(() => create(p, bad)); }
});

test('group revalidates raw process contradictions even when native bytes and their hashes still match', () => {
  const p = plan();
  for (const change of [e => { e.receipt.process.cancelRequested = true; }, e => { e.receipt.process.deadlineExceeded = true; },
    e => { e.receipt.process.drain = 'UNKNOWN'; }, e => { e.receipt.process.durationMs = profile.timeoutMs; }]) {
    const es = structuredClone(all(p)); change(es[0]);
    refusal(() => create(p, es), 'EXECUTION_RESULT_CONTRADICTION');
  }
});

test('group refuses changed output bytes and native mismatch despite updated raw hashes', () => {
  const p = plan();
  for (const mutate of [e => { e.stdoutHex = '00'; }, e => { e.stderrHex = '00'; },
    e => { e.receipt.result.status = 'FAIL'; e.receipt.result.reason = 'SWIFT_ARTIFACT_FAILED'; },
    e => { const r = JSON.parse(Buffer.from(e.stdoutHex, 'hex')); r.path = 'b.json';
      const b = Buffer.from(JSON.stringify(r) + '\n'); e.stdoutHex = b.toString('hex');
      e.receipt.outputs.stdout = { capturedBytes: b.length, observedBytes: b.length, sha256: sha256Text(b), truncated: false }; }]) {
    const es = structuredClone(all(p)); mutate(es[0]); assert.throws(() => create(p, es));
  }
});

test('operational failures override quality FAIL while preserving its known findings', () => {
  const p = plan();
  for (const status of ['ERROR', 'NOT_RUN', 'INCONCLUSIVE']) {
    const group = create(p, [entry(p, 0, 'FAIL'), entry(p, 1, status), undispatched('CHILD_UNAVAILABLE')], 'CHILD_UNAVAILABLE');
    assert.equal(group.adapterResult.status, 'UNAVAILABLE'); assert.deepEqual(group.adapterResult.evidence.findings, []);
    assert.equal(group.aggregate.knownFindings.length, 1); assert.equal(group.aggregate.counts[status], 1);
    assert.equal(group.aggregate.counts.NOT_DISPATCHED, 1);
    assert.throws(() => create(p, [entry(p, 0, status), entry(p, 1), entry(p, 2)], 'CHILD_UNAVAILABLE'));
  }
});

test('cancellation after dispatch preserves raw ABORTED and the group stop reason', () => {
  const p = plan(), aborted = entry(p, 1, 'INCONCLUSIVE', { reason: 'ABORTED', process: { cancelRequested: true } });
  const group = create(p, [entry(p, 0), aborted, undispatched('ABORTED')], 'ABORTED');
  assert.equal(group.stopReason, 'ABORTED'); assert.equal(group.aggregate.counts.INCONCLUSIVE, 1);
  assert.equal(group.aggregate.counts.NOT_DISPATCHED, 1);
  assert.throws(() => create(p, [entry(p, 0), aborted, undispatched('CHILD_UNAVAILABLE')], 'CHILD_UNAVAILABLE'));
});

test('pre-abort and post-PASS abort preserve inventory without invented child receipts', () => {
  const p = plan(), pre = create(p, p.targets.map(() => undispatched('ABORTED')), 'ABORTED');
  assert.equal(pre.aggregate.counts.NOT_DISPATCHED, 3); assert.equal(pre.aggregate.counts.PASS, 0);
  assert.equal(create(p, all(p), 'ABORTED').adapterResult.status, 'UNAVAILABLE');
  assert.throws(() => create(p, [entry(p, 0), undispatched('ABORTED'), entry(p, 2)], 'ABORTED'));
  assert.throws(() => create(p, all(p), 'CHILD_UNAVAILABLE'));
  assert.throws(() => create(p, all(p), 'OWNER_STOPPED'));
});

test('unknown drain is retained and cannot contribute to a passing group', () => {
  const p = plan(), unknown = entry(p, 0, 'INCONCLUSIVE', { reason: 'CHILD_CLOSE_UNKNOWN',
    process: { closed: false, drain: 'UNKNOWN', exitCode: null } });
  const group = create(p, [unknown, undispatched('CHILD_UNAVAILABLE'), undispatched('CHILD_UNAVAILABLE')], 'CHILD_UNAVAILABLE');
  assert.equal(group.aggregate.unknownDrainCount, 1); assert.equal(group.adapterResult.status, 'UNAVAILABLE');
});

test('fixed Swift quality results require exit zero and empty stderr even when generic v1 permits them', () => {
  const p = plan();
  for (const alter of [e => { e.receipt.process.exitCode = 1; }, e => { e.stderrHex = '78';
    e.receipt.outputs.stderr = { capturedBytes: 1, observedBytes: 1, sha256: sha256Text('x'), truncated: false }; }]) {
    const es = structuredClone(all(p)); es[0] = structuredClone(entry(p, 0, 'FAIL')); alter(es[0]);
    refusal(() => create(p, es), 'SWIFT_GROUP_TERMINATION');
  }
  refusal(() => create(p, [null, ...all(p).slice(1)]), 'SWIFT_GROUP_CHILD_SCHEMA');
});

test('group reader rederives aggregate flags and output binding despite outer rehash', () => {
  const p = plan(), group = create(p, [entry(p, 0, 'FAIL'), entry(p, 1), entry(p, 2)]);
  for (const mutate of [v => { v.aggregate.status = 'PASS'; }, v => { v.aggregate.counts.PASS = 3; },
    v => { v.aggregate.knownFindings = []; }, v => { v.adapterResult.status = 'PASS'; },
    v => { v.authorizing = true; }, v => { v.executionVerified = true; }, v => { v.certificationGranted = true; },
    v => { v.planFingerprint = '0'.repeat(64); }, v => { v.schemaVersion = 'nisi-swift-static-group-v0'; }]) {
    const bad = structuredClone(group); mutate(bad); refusal(() => read(rehash(bad), p), 'SWIFT_GROUP_MISMATCH');
  }
  refusal(() => read({ ...group, fingerprint: '0'.repeat(64) }, p), 'SWIFT_GROUP_MISMATCH');
});
