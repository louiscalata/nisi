// Real engine, synthetic static receipts: this does not execute Swift or models.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runWorkflow, createCandidate } from '../workflow/engine.mjs';
import { stableStringify, sha256Text } from '../workflow/contracts.mjs';
import { createSwiftStaticGroupV1 } from '../receipts/swift-static-group-v1.mjs';
import { createSwiftStaticRunV1 as create, readSwiftStaticRunV1 as read } from '../receipts/swift-static-run-v1.mjs';
import { plan, prep, entry, undispatched, files, task, targets, profile } from './helpers/swift-group-fixture.mjs';
import { createRepositorySnapshot } from '../hosts/repository/snapshot-contract.mjs';
const rehash = v => { const { fingerprint, ...identity } = v;
  return { ...identity, fingerprint: sha256Text('nisi/swift-static-run/v1\0' + stableStringify(identity)) }; };
async function fixture({ repair = false, terminal = null, interrupt = false, storage = false, childDeadline = false } = {}) {
  const plans = [], groups = [], controller = new AbortController(); let clock = 0;
  const t = { ...task, mode: repair ? 'edit' : 'review', policy: { ...task.policy, requireReportStore: storage } };
  const draft = p => {
    const c = createCandidate({ files }, { authorId: 'author.fixture' });
    return { candidate: { files: c.files }, evidence: { ...p.binding, candidateFingerprint: c.fingerprint, note: 'Fixture draft' } };
  };
  const report = await runWorkflow(t, { clock: () => clock, signal: controller.signal, ...(repair ? {} : { candidate: { files }, candidateAuthorId: 'author.fixture' }),
    ...(storage ? { reportStore: { store: () => { throw new Error('Fixture store error'); } } } : {}),
    adapters: { authorizeContext: { authorize: p => ({ status: 'PASS', evidence: { ...p.binding, reason: '' } }) },
      author: { id: 'author.fixture', draft, repair: p => {
        if (terminal) return { status: terminal, candidate: null, evidence: { ...p.binding,
          baseCandidateFingerprint: p.binding.candidateFingerprint, note: 'Fixture terminal repair' } };
        const c = createCandidate({ files: files.map((f, i) => i ? f : { ...f, content: '{"repaired":true}' }) }, { authorId: 'author.fixture' });
        return { status: 'REPAIRED', candidate: { files: c.files }, evidence: { ...p.binding, candidateFingerprint: c.fingerprint,
          baseCandidateFingerprint: p.binding.candidateFingerprint, note: 'Fixture repair' } };
      } },
      staticChecks: { check: p => {
        const pl = plan({ preparation: prep(p.candidate.files, { task: p.task }), runId: p.binding.runId, attempt: p.binding.attempt });
        const group = childDeadline ? createSwiftStaticGroupV1(pl, [entry(pl, 0, 'INCONCLUSIVE', {
          reason: 'DEADLINE_EXCEEDED', process: { deadlineExceeded: true, cancelRequested: true, durationMs: profile.timeoutMs,
            closed: false, drain: 'UNKNOWN', exitCode: null } }), undispatched('CHILD_UNAVAILABLE'), undispatched('CHILD_UNAVAILABLE')], 'CHILD_UNAVAILABLE')
          : createSwiftStaticGroupV1(pl, pl.targets.map((_, i) => entry(pl, i, repair && !p.binding.attempt && i === 2 ? 'FAIL' : 'PASS')));
        plans.push(pl); groups.push(group);
        if (interrupt === 'abort') controller.abort(); else if (interrupt) clock = task.policy.totalDeadlineMs;
        return group.adapterResult;
      } }, tests: { run: p => ({ status: 'PASS', evidence: { ...p.binding, assertionsExecuted: 1, assertionsPassed: 1, failures: [], reason: '' } }) },
      reviewers: [{ id: 'reviewer.fixture', review: p => ({ status: 'PASS', evidence: { ...p.binding, reviewerId: 'reviewer.fixture',
        findings: [], summary: 'Synthetic fixture review, not model inference', reason: '' } }) }] } });
  return { context: { report, plans }, groups };
}

test('grouped static run binds actual engine report with fresh receipts after fixture repair', async () => {
  const { context, groups } = await fixture({ repair: true }), bundle = create(context, groups), result = read(bundle, context);
  assert.equal(context.report.outcome, 'COMPLETED'); assert.equal(context.report.repairAttempts, 1);
  assert.equal(result.groupCount, 2); assert.equal(result.rawCounts.PASS, 5); assert.equal(result.rawCounts.FAIL, 1);
  assert.equal(result.recordedPassGroups, 1); assert.equal(result.executionVerified, false); assert.equal(result.authorizing, false);
  assert.equal(result.certificationGranted, false); assert.equal(result.scope, 'DECLARED_MATERIALIZED_STATIC_CHECKS_ONLY');
  assert.notEqual(context.plans[0].binding.candidateFingerprint, context.plans[1].binding.candidateFingerprint);
  assert.equal(context.plans[0].targets[1].artifactSha256, context.plans[1].targets[1].artifactSha256);
});

test('grouped raw PASS and engine TIMED_OUT coexist without recorded-pass credit', async () => {
  const { context, groups } = await fixture({ interrupt: true }), bundle = create(context, groups), result = read(bundle, context);
  assert.equal(result.outcome, 'TIMED_OUT'); assert.equal(result.recordedPassGroups, 0); assert.equal(result.unrecordedRawPassGroups, 1);
  assert.equal(result.rawCounts.PASS, 3); assert.equal(bundle.entries[0].disposition.kind, 'ENGINE_INTERRUPTED');
  assert.equal(groups[0].stopReason, null); assert.equal(groups[0].entries[0].receipt.process.cancelRequested, false);
});

test('grouped record retains final storage failure separately from a completed workflow', async () => {
  const { context, groups } = await fixture({ storage: true }), result = read(create(context, groups), context);
  assert.equal(result.workflowOutcome, 'COMPLETED'); assert.equal(result.outcome, 'BLOCKED');
  assert.equal(result.reportStoreCode, 'ADAPTER_EXCEPTION'); assert.equal(result.recordedPassGroups, 1);
});

test('grouped raw PASS and actual engine abort coexist without rewriting raw children', async () => {
  const { context, groups } = await fixture({ interrupt: 'abort' }), bundle = create(context, groups), result = read(bundle, context);
  assert.equal(result.outcome, 'CANCELLED'); assert.equal(result.code, 'ABORTED');
  assert.equal(result.recordedPassGroups, 0); assert.equal(result.unrecordedRawPassGroups, 1);
  assert.equal(result.rawCounts.PASS, 3); assert.equal(bundle.entries[0].disposition.kind, 'ENGINE_INTERRUPTED');
  assert(groups[0].entries.every(e => e.receipt.process.cancelRequested === false));
});

test('child-only deadline is a recorded unavailable result, not an engine interruption', async () => {
  const { context, groups } = await fixture({ childDeadline: true }), bundle = create(context, groups), result = read(bundle, context);
  assert.equal(result.outcome, 'BLOCKED'); assert.equal(result.code, 'STATIC_CHECKS_UNAVAILABLE');
  assert.equal(result.unknownDrainCount, 1); assert.equal(result.rawCounts.INCONCLUSIVE, 1); assert.equal(result.rawCounts.NOT_DISPATCHED, 2);
  assert.equal(bundle.entries[0].disposition.kind, 'RESULT_RECORDED'); assert.equal(groups[0].stopReason, 'CHILD_UNAVAILABLE');
  assert.equal(groups[0].entries[0].receipt.result.reason, 'DEADLINE_EXCEEDED');
});

test('grouped record requires complete ordered original plans and child groups', async () => {
  const { context, groups } = await fixture({ repair: true });
  for (const gs of [groups.slice(1), [...groups, groups[0]], [...groups].reverse(), [groups[0], groups[0]]]) assert.throws(() => create(context, gs));
  for (const ps of [context.plans.slice(1), structuredClone(context.plans), [...context.plans].reverse()]) assert.throws(() => create({ ...context, plans: ps }, groups));
  assert.throws(() => create({ ...context, plans: [...context.plans, context.plans.at(-1)] }, groups), e => e.code === 'SWIFT_RUN_INVENTORY');
  assert.throws(() => create({ ...context, plans: [] }, []));
});

test('grouped run refuses corrupt static-stage binding at the binding gate before comparing quality', async () => {
  const { context, groups } = await fixture();
  for (const [key, value] of [['schemaVersion', 2], ['attempt', 1], ['runId', '12345678-1234-4234-8234-000000000001'],
    ['taskFingerprint', '0'.repeat(64)], ['candidateFingerprint', '0'.repeat(64)]]) {
    const report = structuredClone(context.report); report.stages.find(s => s.stage === 'staticChecks').evidence[key] = value;
    assert.throws(() => create({ ...context, report }, groups), e => e.code === 'SWIFT_RUN_BINDING');
  }
});

test('grouped record rejects changes to baseline or checker configuration between attempts', async () => {
  const { context, groups } = await fixture({ repair: true });
  const p = context.plans[1], finalFiles = context.report.candidate.files;
  for (const extra of [{ executionProfile: { ...profile, timeoutMs: 4000 } },
    { targets: targets.map((t, i) => i ? t : { ...t, profileId: 'nisi-text-structure-v1' }) },
    { preparation: prep(finalFiles, { task: { ...task, mode: 'edit' }, baseline: createRepositorySnapshot({
      files: files.map((f, i) => i ? f : { ...f, content: '{"differentBaseline":true}' }) }) }) }]) {
    const changed = plan({ preparation: prep(finalFiles, { task: { ...task, mode: 'edit' } }),
      runId: p.binding.runId, attempt: 1, ...extra });
    const group = createSwiftStaticGroupV1(changed, changed.targets.map((_, i) => entry(changed, i)));
    assert.throws(() => create({ ...context, plans: [context.plans[0], changed] }, [groups[0], group]), e => e.code === 'SWIFT_RUN_CONFIGURATION');
  }
});

test('terminal repair without new checks remains linked to last checked candidate', async () => {
  for (const terminal of ['NO_CHANGE', 'FAIL', 'NOT_RUN', 'UNAVAILABLE']) {
    const { context, groups } = await fixture({ repair: true, terminal });
    assert.equal(read(create(context, groups), context).groupCount, 1);
    const changed = createCandidate({ files: [{ path: 'a.json', content: '[]' }] }, { authorId: 'author.fixture' });
    const report = { ...context.report, candidate: changed, candidateFingerprint: changed.fingerprint };
    assert.throws(() => create({ ...context, report }, groups), e => e.code === 'SWIFT_RUN_FINAL_CANDIDATE');
  }
});

test('grouped reader rejects forged dispositions or summaries despite outer rehash', async () => {
  const { context, groups } = await fixture({ interrupt: true }), bundle = create(context, groups);
  for (const mutate of [b => { b.entries[0].disposition.kind = 'RESULT_RECORDED'; }, b => { b.entries[0].disposition.stageIndex++; },
    b => { b.authorizing = true; }, b => { b.reportSha256 = '0'.repeat(64); }, b => { b.scope = 'FULL_HOST'; }]) {
    const bad = structuredClone(bundle); mutate(bad); assert.throws(() => read(rehash(bad), context), e => e.code === 'SWIFT_RUN_MISMATCH');
  }
});

test('grouped stage mismatch and arbitrary exception cannot be turned into complete evidence', async () => {
  const { context, groups } = await fixture(), report = structuredClone(context.report);
  const stage = report.stages.find(s => s.stage === 'staticChecks'); stage.evidence.reason = 'different';
  assert.throws(() => create({ ...context, report }, groups), e => e.code === 'SWIFT_RUN_STAGE_RESULT');
  const timed = await fixture({ interrupt: true }), bad = structuredClone(timed.context.report);
  bad.stages.at(-1).code = 'ADAPTER_EXCEPTION'; bad.stages.at(-1).evidence.reason = 'ADAPTER_EXCEPTION';
  bad.code = 'ADAPTER_EXCEPTION'; bad.outcome = 'BLOCKED'; bad.workflowOutcome = 'BLOCKED';
  assert.throws(() => create({ ...timed.context, report: bad }, timed.groups), e => e.code === 'SWIFT_RUN_UNRECORDED_ERROR');
});

test('full report changes invalidate existing grouped record, including non-static review text', async () => {
  const { context, groups } = await fixture(), bundle = create(context, groups), report = structuredClone(context.report);
  report.stages.find(s => s.stage === 'review').evidence.summary = 'Changed trusted report';
  assert.throws(() => read(bundle, { ...context, report }), e => e.code === 'SWIFT_RUN_MISMATCH');
});
