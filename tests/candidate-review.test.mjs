// Pure review/admission staging. Candidate strings are never imported or executed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewedLiveFixtureV1 } from '../examples/repository-task/reviewed-live-fixture-v1.mjs';
import { createCandidate, sha256Text } from '../workflow/contracts.mjs';
import { createCandidateReviewSessionV1, readIssuedCandidateReviewV1 } from '../hosts/repository/candidate-review-v1.mjs';
import { requireReviewedNodeSuiteV1 } from '../hosts/repository/node-suite-v1.mjs';
const context = async () => {
  const fixture = await createReviewedLiveFixtureV1(), base = fixture.preparations[0];
  const content = base.candidate.files[0].content.replace('input.retryLimit || 3', 'input.retryLimit == null ? 3 : input.retryLimit');
  const candidate = { files: [{ path: 'retry-settings.mjs', content }] };
  const repairResult = { status: 'REPAIRED', candidate, evidence: { schemaVersion: 1,
    runId: '9d21cc3d-a741-4107-97c9-4d4c6f6d674b', taskFingerprint: base.taskFingerprint, attempt: 1,
    candidateFingerprint: createCandidate(candidate, { authorId: base.candidate.authorId }).fingerprint,
    baseCandidateFingerprint: base.candidateFingerprint, note: 'Explicit null default; retain zero.' } };
  const origin = { kind: 'CURRENT_RUN', requestSha256: 'a'.repeat(64), responseSha256: 'b'.repeat(64) };
  const policy = { reviewId: 'review.one', reviewerId: 'reviewer.host', expiresAtMs: 2000 };
  let clock = 1000;
  const input = { suite: fixture.suite, repairResult, origin, policy }, create = () => createCandidateReviewSessionV1(input, () => clock);
  return { input, fixture, create, setTime: value => { clock = value; } };
};
const approval = s => ({ packetFingerprint: s.packet.fingerprint, reviewerId: s.packet.reviewerId,
  verdict: 'APPROVE_FOR_ISOLATION_REVIEW', rationale: 'Reviewed exact bytes; separate execution isolation still required.' });
const binding = s => Object.fromEntries(['packetFingerprint','runId','attempt','taskFingerprint','candidateFingerprint','materializedFingerprint']
  .map(k => [k, k === 'packetFingerprint' ? s.packet.fingerprint : s.packet[k]]));

test('new candidate has exact before/after bytes and full inventory but no execution authority', async () => {
  const c = await context(), s = c.create(), p = s.packet;
  assert.equal(p.changes.length, 1); assert.equal(p.files.length, 4); assert.equal(p.alreadyRegistered, false);
  const change = p.changes[0]; assert.equal(change.kind, 'MODIFIED'); assert.equal(change.path, 'retry-settings.mjs');
  assert.equal(change.before.content, c.fixture.preparations[0].candidate.files[0].content);
  assert.equal(change.after.content, c.input.repairResult.candidate.files[0].content);
  assert.equal(change.after.sha256, sha256Text(change.after.content)); assert.equal(change.after.byteLength, Buffer.byteLength(change.after.content));
  assert.equal(p.harness.sha256, c.fixture.suite.entrySha256);
  for (const key of ['sourceExecuted','isolationVerified','executionAuthorized','authorizing','modelOriginAttested','reviewerIdentityAttested']) assert.equal(p[key], false);
  assert.equal(readIssuedCandidateReviewV1(s).state, 'PENDING');
  assert.throws(() => s.handoff(binding(s)), { code: 'CANDIDATE_REVIEW_STATE' });
});
test('host approval produces a one-time handoff; never registers the candidate or attests review', async () => {
  const c = await context(), s = c.create(), decision = s.decide(approval(s));
  assert.equal(decision.basis, 'TRUSTED_HOST_REVIEW_ASSERTION'); assert.equal(decision.executionAuthorized, false);
  assert.equal(s.snapshot().state, 'APPROVED_FOR_ISOLATION_REVIEW');
  const out = s.handoff(binding(s)); assert.equal(out.packet, s.packet); assert.equal(out.decision, decision);
  assert.equal(out.preparation.candidateFingerprint, s.packet.candidateFingerprint); assert.equal(out.authorizing, false);
  assert.throws(() => requireReviewedNodeSuiteV1(c.fixture.suite, out.preparation), { code: 'NODE_SUITE_PREPARATION_NOT_REGISTERED' });
  assert.equal(s.snapshot().state, 'HANDED_OFF'); assert.throws(() => s.handoff(binding(s)), { code: 'CANDIDATE_REVIEW_STATE' });
  assert.throws(() => s.decide(approval(s)), { code: 'CANDIDATE_REVIEW_STATE' });
  s.revoke(); assert.equal(s.snapshot().revoked, true); assert.equal(s.snapshot().handedOff, true);
});
test('ordinary accessors are refused without invocation and input mutation cannot rewrite review', async () => {
  const c = await context(); let calls = 0;
  const accessor = { ...c.input, get repairResult() { calls++; return c.input.repairResult; } };
  assert.throws(() => createCandidateReviewSessionV1(accessor)); assert.equal(calls,0);
  const s=c.create(), original=s.packet.changes[0].after.content;
  c.input.repairResult.candidate.files[0].content='host mutation'; c.input.origin.kind='RETAINED_OBSERVATION'; c.input.policy.expiresAtMs=9999;
  assert.equal(s.packet.changes[0].after.content,original); assert.equal(s.packet.origin.kind,'CURRENT_RUN'); assert.equal(s.packet.expiresAtMs,2000);
  assert.ok(Object.isFrozen(s.packet.changes[0].after)); assert.ok(Object.isFrozen(s.packet.task.acceptanceCriteria));
  assert.throws(() => readIssuedCandidateReviewV1({ ...s }), {code:'CANDIDATE_REVIEW_NOT_ISSUED'});
  assert.throws(() => readIssuedCandidateReviewV1(structuredClone(s.packet)), {code:'CANDIDATE_REVIEW_NOT_ISSUED'});
});
for (const [name, mutate] of [
  ['candidate bytes', i => { i.repairResult.candidate.files[0].content+='\n'; }],
  ['task identity', i => { i.repairResult.evidence.taskFingerprint='f'.repeat(64); }],
  ['base identity', i => { i.repairResult.evidence.baseCandidateFingerprint='f'.repeat(64); }],
  ['attempt zero', i => { i.repairResult.evidence.attempt=0; }],
  ['attempt negative zero', i => { i.repairResult.evidence.attempt=-0; }],
  ['exhausted attempt', i => { i.repairResult.evidence.attempt=2; }],
  ['run newline', i => { i.repairResult.evidence.runId+='\n'; }],
  ['origin extra authority', i => { i.origin.authorizing=true; }],
  ['origin malformed hash', i => { i.origin.requestSha256+='\n'; }],
  ['same reviewer label', i => { i.policy.reviewerId='author.live-model'; }],
  ['copied suite', i => { i.suite=structuredClone(i.suite); }],
  ['protected harness', i => {
    i.repairResult.candidate.files.push({path:'checks/check-retry-settings.mjs',content:'changed harness'});
    i.repairResult.evidence.candidateFingerprint=createCandidate(i.repairResult.candidate,{authorId:'author.live-model'}).fingerprint;
  }],
]) test(`review staging refuses ${name}`, async () => { const c=await context(); mutate(c.input); assert.throws(c.create); });
test('different original session cannot consume another packet decision or handoff', async () => {
  const c=await context(), s=c.create(); c.input.policy.reviewId='review.two'; const other=c.create();
  assert.notEqual(s.packet.fingerprint,other.packet.fingerprint);
  assert.throws(() => other.decide(approval(s)), {code:'CANDIDATE_REVIEW_DECISION'});
  s.decide(approval(s)); other.decide(approval(other));
  assert.throws(() => other.handoff(binding(s)), {code:'CANDIDATE_REVIEW_HANDOFF'});
  assert.equal(other.snapshot().handedOff,false); assert.equal(other.handoff(binding(other)).packet,other.packet);
});
for (const field of ['packetFingerprint','runId','attempt','taskFingerprint','candidateFingerprint','materializedFingerprint'])
  test(`handoff refuses changed ${field}`, async () => {
    const c=await context(), s=c.create(); s.decide(approval(s)); const b=binding(s); b[field]=field==='attempt'?2:'f'.repeat(64);
    assert.throws(() => s.handoff(b),{code:'CANDIDATE_REVIEW_HANDOFF'}); assert.equal(s.snapshot().handedOff,false);
  });
for (const phase of ['pending','approved']) test(`expiry blocks ${phase} review without resurrection`, async () => {
  const c=await context(), s=c.create(); if(phase==='approved')s.decide(approval(s)); c.setTime(2000);
  assert.equal(s.snapshot().state,'EXPIRED'); assert.throws(() => s.decide(approval(s))); assert.throws(() => s.handoff(binding(s)));
  c.setTime(1500); assert.equal(s.snapshot().state,'INVALID_CLOCK'); c.setTime(1600); assert.equal(s.snapshot().state,'INVALID_CLOCK');
});
test('rejection and revocation are terminal for review handoff', async () => {
  const c=await context(), rejected=c.create(); rejected.decide({...approval(rejected),verdict:'REJECT'});
  assert.equal(rejected.snapshot().state,'REJECTED'); assert.throws(() => rejected.handoff(binding(rejected)));
  const revoked=c.create(); revoked.decide(approval(revoked)); revoked.revoke();
  assert.equal(revoked.snapshot().state,'REVOKED'); assert.throws(() => revoked.handoff(binding(revoked)));
});
test('clock expiry during decision capture prevents approval', async () => {
  const c=await context(); let n=0;
  const s=createCandidateReviewSessionV1(c.input,()=> ++n<3?1000:2000);
  assert.throws(()=>s.decide(approval(s)),{code:'CANDIDATE_REVIEW_STATE'}); assert.equal(s.snapshot().decision,null);
});
test('retained observations stay historical in packet and handoff', async () => {
  const c=await context(); c.input.origin.kind='RETAINED_OBSERVATION'; const s=c.create();
  s.decide(approval(s)); const out=s.handoff(binding(s)); assert.equal(out.packet.origin.kind,'RETAINED_OBSERVATION');
  assert.equal(out.modelOriginAttested,false); assert.equal(out.sourceExecuted,false);
});
test('identical host decision retry returns same record, conflicting retry is refused', async () => {
  const c=await context(), s=c.create(), d=approval(s), first=s.decide(d);
  assert.equal(s.decide(structuredClone(d)),first);
  assert.throws(()=>s.decide({...d,rationale:'different'}),{code:'CANDIDATE_REVIEW_DECISION_CONFLICT'});
  assert.equal(s.snapshot().state,'CONFLICT'); assert.throws(()=>s.handoff(binding(s)));
});
test('identical inputs in another owner still cannot use the first issued packet', async () => {
  const c=await context(), first=c.create(), other=c.create();
  assert.notEqual(first.packet.fingerprint,other.packet.fingerprint);
  assert.notEqual(first.packet.issuanceId,other.packet.issuanceId);
  assert.throws(()=>other.decide(approval(first)),{code:'CANDIDATE_REVIEW_DECISION'});
});
test('throwing clock invalidates review state and never revives after recovery', async () => {
  const c=await context(); let broken=false;
  const s=createCandidateReviewSessionV1(c.input,()=>{if(broken)throw Error('clock unavailable');return 1000;});
  broken=true; assert.doesNotThrow(()=>s.snapshot()); assert.equal(s.snapshot().state,'INVALID_CLOCK');
  broken=false; assert.equal(s.snapshot().state,'INVALID_CLOCK'); assert.throws(()=>s.decide(approval(s)));
});
test('rejected decision retries also stop at expiry, while historical decision remains readable', async () => {
  const c=await context(),s=c.create(),d={...approval(s),verdict:'REJECT'},first=s.decide(d);
  assert.equal(s.decide(structuredClone(d)),first);c.setTime(2000);
  assert.throws(()=>s.decide(d),{code:'CANDIDATE_REVIEW_STATE'});assert.deepEqual(s.snapshot().decision,first);
});
test('revocation samples time and preserves an already expired lifecycle cause', async () => {
  const c=await context(),s=c.create();s.decide(approval(s));c.setTime(2000);s.revoke();
  const state=s.snapshot();assert.equal(state.state,'EXPIRED');assert.equal(state.revoked,true);assert.equal(state.lastObservedAtMs,2000);
});
test('revocation records a throwing clock without losing revocation or propagating host errors', async () => {
  const c=await context();let broken=false;
  const s=createCandidateReviewSessionV1(c.input,()=>{if(broken)throw Error('private clock');return 1000;});
  broken=true;assert.doesNotThrow(()=>s.revoke());broken=false;
  assert.equal(s.snapshot().state,'INVALID_CLOCK');assert.equal(s.snapshot().revoked,true);
});
test('construction clock failures use bounded error codes', async () => {
  const c=await context();assert.throws(()=>createCandidateReviewSessionV1(c.input,()=>{throw Error('private clock');}),{code:'CANDIDATE_REVIEW_CLOCK'});
});
