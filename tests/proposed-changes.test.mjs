// Pure proposal tests; synthetic report/summary are not executed check evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256Text, stableStringify } from '../workflow/contracts.mjs';
import { createRepositorySnapshot, prepareRepositoryCandidate } from '../hosts/repository/snapshot-contract.mjs';
import { createRepositoryProposalV1 as create } from '../hosts/repository/proposed-changes-v1.mjs';
function fixture() {
  const baseline = createRepositorySnapshot({ files: [{ path: 'a.mjs', content: 'before\r\n' }, { path: 'config.json', content: '{}' }] });
  const task = { taskId: 'proposal.fixture', mode: 'edit', language: 'javascript', allowedFiles: ['a.mjs', 'config.json', 'new.txt'],
    protectedFiles: ['config.json'], protectedSnapshots: { 'config.json': sha256Text('{}') }, acceptanceCriteria: ['Keep configuration'],
    policy: { repairBudget: 1, totalDeadlineMs: 20000, requiredReviewers: 1, requireReportStore: false } };
  const preparation = prepareRepositoryCandidate({ baseline, task, authorId: 'author.fixture',
    candidate: { files: [{ path: 'a.mjs', content: 'after\r\nno-newline' }, { path: 'config.json', content: '{}' }, { path: 'new.txt', content: '' }] } });
  const report = { runId: '12345678-1234-4234-8234-123456789abc', taskFingerprint: preparation.taskFingerprint,
    candidateFingerprint: preparation.candidateFingerprint, candidate: preparation.candidate,
    outcome: 'COMPLETED', workflowOutcome: 'COMPLETED', code: null, reportStoreCode: null };
  const bundleSummary = { ...report, status: 'CONSISTENT', preparationFingerprint: preparation.fingerprint,
    baselineFingerprint: preparation.baselineFingerprint, materializedFingerprint: preparation.materializedFingerprint, finalChecksRecordedPass: true };
  delete bundleSummary.candidate;
  bundleSummary.fingerprint = 'a'.repeat(64);
  bundleSummary.reportSha256 = sha256Text('nisi/repository-final-report/v1\0' + stableStringify(report));
  return { preparation, report, bundleSummary };
}
test('proposal preserves exact before/after bytes, adds and modifications without protected or unchanged files', () => {
  const c = fixture(), r = create(c);
  assert.deepEqual(r.changes.map(f => [f.path, f.kind]), [['a.mjs', 'MODIFY'], ['new.txt', 'ADD']]);
  assert.equal(r.changes[0].before.content, 'before\r\n'); assert.equal(r.changes[0].after.content, 'after\r\nno-newline');
  assert.equal(r.changes[1].before, null); assert.equal(r.changes[1].after.content, '');
  assert.equal(r.changes[0].after.sha256, sha256Text('after\r\nno-newline'));
  assert.equal(r.changes[0].after.byteLength, Buffer.byteLength('after\r\nno-newline'));
  const { fingerprint, ...body } = r; assert.equal(fingerprint, sha256Text('nisi/proposed-changes/v1\0' + stableStringify(body)));
  assert.equal(r.applied, false); assert.equal(r.authorizing, false); assert(Object.isFrozen(r.changes[0].after));
  assert.throws(() => { r.changes.push({}); }, TypeError);
});
for (const outcome of ['FAILED', 'BLOCKED', 'TIMED_OUT', 'CANCELLED']) test('proposal is absent for ' + outcome, () => {
  const c = fixture(); c.report.outcome = c.bundleSummary.outcome = outcome;
  c.bundleSummary.reportSha256 = sha256Text('nisi/repository-final-report/v1\0' + stableStringify(c.report));
  assert.equal(create(c), null);
});
test('workflow, storage, check and code failures independently prevent a proposal', () => {
  for (const field of ['workflowOutcome', 'reportStoreCode', 'code', 'finalChecksRecordedPass']) {
    const c = fixture(), value = field === 'workflowOutcome' ? 'FAILED' : field === 'finalChecksRecordedPass' ? false : 'FAILED';
    c.bundleSummary[field] = value; if (field !== 'finalChecksRecordedPass') c.report[field] = value;
    c.bundleSummary.reportSha256 = sha256Text('nisi/repository-final-report/v1\0' + stableStringify(c.report));
    assert.equal(create(c), null);
  }
});
test('proposal refuses cloned preparation and every report or summary identity mismatch', () => {
  const c = fixture(); assert.throws(() => create({ ...c, preparation: structuredClone(c.preparation) }), { code: 'PROPOSAL_PREPARATION_NOT_ISSUED' });
  for (const key of ['runId', 'taskFingerprint', 'candidateFingerprint', 'preparationFingerprint', 'baselineFingerprint', 'materializedFingerprint']) {
    assert.throws(() => create({ ...c, bundleSummary: { ...c.bundleSummary, [key]: 'different' } }));
  }
  assert.throws(() => create({ ...c, report: { ...c.report, candidate: { ...c.report.candidate, files: [] } } }), { code: 'PROPOSAL_CANDIDATE_MISMATCH' });
  assert.throws(() => create({ ...c, report: { ...c.report, candidate: null } }), { code: 'PROPOSAL_CANDIDATE_MISMATCH' });
});
test('malformed status, summary and top-level accessors refuse rather than silently authorize', () => {
  const c = fixture(); let read = 0;
  assert.throws(() => create({ ...c, get extra() { read++; return true; } }), { code: 'PROPOSAL_SCHEMA' });
  assert.equal(read, 0);
  assert.throws(() => create({ ...c, report: { ...c.report, outcome: 'CERTIFIED' } }), { code: 'PROPOSAL_INPUT_INVALID' });
  assert.throws(() => create({ ...c, bundleSummary: { ...c.bundleSummary, finalChecksRecordedPass: 'yes' } }), { code: 'PROPOSAL_INPUT_INVALID' });
  assert.throws(() => create({ ...c, bundleSummary: { ...c.bundleSummary, status: 'PASS' } }), { code: 'PROPOSAL_SUMMARY_INCONSISTENT' });
  assert.throws(() => create({ ...c, bundleSummary: { ...c.bundleSummary, outcome: 'FAILED' } }), { code: 'PROPOSAL_OUTCOME_MISMATCH' });
});
// Based on Fable's bounded linkage test draft, checked against this fixture.
test('valid bundle fingerprint change alters proposal fingerprint, not changes, and links exact hashes', () => {
  const c = fixture(), a = create(c), b = create({ ...c, bundleSummary: { ...c.bundleSummary, fingerprint: 'b'.repeat(64) } });
  assert.notEqual(b.fingerprint, a.fingerprint); assert.deepEqual(b.changes, a.changes);
  assert.equal(a.bundleFingerprint, c.bundleSummary.fingerprint); assert.equal(a.reportSha256, c.bundleSummary.reportSha256);
  assert.equal(b.bundleFingerprint, 'b'.repeat(64)); assert.equal(b.reportSha256, a.reportSha256);
});
test('proposal rejects absent uppercase short nonhex and wrong report evidence links', () => {
  const c = fixture();
  for (const key of ['fingerprint', 'reportSha256']) {
    for (const value of [undefined, null, 'A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64)]) {
      assert.throws(() => create({ ...c, bundleSummary: { ...c.bundleSummary, [key]: value } }), { code: 'PROPOSAL_EVIDENCE_LINKAGE' });
    }
  }
  assert.throws(() => create({ ...c, bundleSummary: { ...c.bundleSummary, reportSha256: 'a'.repeat(64) } }), { code: 'PROPOSAL_EVIDENCE_LINKAGE' });
  assert.throws(() => create({ ...c, report: { ...c.report, additionalFact: true } }), { code: 'PROPOSAL_EVIDENCE_LINKAGE' });
});
