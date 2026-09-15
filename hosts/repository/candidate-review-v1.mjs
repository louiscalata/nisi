// PRIVATE trusted-host review staging. No source execution, filesystem/network,
// model calls, suite registration, isolation or user authorization is performed.
// A handoff is inspectable data, NOT an executable capability. Hostile JS hosts,
// Proxies and modified intrinsics are outside this in-process trust boundary.
import { cloneFreeze } from '../../workflow/contracts.mjs';
import { randomUUID } from 'node:crypto';
import { exact, digest } from '../../integrity/record-utils.mjs';
import { prepareRepositoryCandidate } from './snapshot-contract.mjs';
import { reviewedNodePreparationsV1 } from './node-suite-v1.mjs';

const issued = new WeakSet();
const issuedHandoffs = new WeakMap();
const issuedClaims = new WeakMap();
const fail = code => { throw Object.assign(new Error(code), { code }); };
const matches = (v, pattern) => typeof v === 'string' && pattern.exec(v)?.[0] === v;
const id = v => matches(v, /^[a-z][a-z0-9_.-]{0,95}$/u);
const hash = v => matches(v, /^[a-f0-9]{64}$/u);
const integer = v => Number.isSafeInteger(v) && v >= 0 && !Object.is(v, -0);
const prose = (v, maximum) => typeof v === 'string' && v.isWellFormed() && v.trim().length > 0 &&
  !v.includes('\0') && Buffer.byteLength(v) <= maximum;
const noAuthority = Object.freeze({ sourceExecuted: false, isolationVerified: false, executionAuthorized: false,
  modelOriginAttested: false, reviewerIdentityAttested: false, authorizing: false });

export function createCandidateReviewSessionV1(input, now = Date.now) {
  exact(input, ['suite', 'repairResult', 'origin', 'policy'], 'CANDIDATE_REVIEW_SCHEMA');
  if (typeof now !== 'function') fail('CANDIDATE_REVIEW_CLOCK');
  const suite = input.suite, preparations = reviewedNodePreparationsV1(suite), baseline = preparations[0];
  const { repairResult: result, origin, policy } = cloneFreeze({ repairResult: input.repairResult, origin: input.origin, policy: input.policy });
  exact(result, ['status', 'candidate', 'evidence'], 'CANDIDATE_REVIEW_RESULT');
  exact(result.evidence, ['schemaVersion', 'runId', 'taskFingerprint', 'attempt', 'candidateFingerprint', 'baseCandidateFingerprint', 'note'], 'CANDIDATE_REVIEW_EVIDENCE');
  exact(origin, ['kind', 'requestSha256', 'responseSha256'], 'CANDIDATE_REVIEW_ORIGIN');
  exact(policy, ['reviewId', 'reviewerId', 'expiresAtMs'], 'CANDIDATE_REVIEW_POLICY');
  if (!['CURRENT_RUN', 'RETAINED_OBSERVATION'].includes(origin.kind) || !hash(origin.requestSha256) || !hash(origin.responseSha256)) fail('CANDIDATE_REVIEW_ORIGIN');
  if (!id(policy.reviewId) || !id(policy.reviewerId) || policy.reviewerId === baseline.candidate.authorId ||
      !integer(policy.expiresAtMs) || policy.expiresAtMs === 0) fail('CANDIDATE_REVIEW_POLICY');
  const e = result.evidence;
  if (result.status !== 'REPAIRED' || e.schemaVersion !== 1 ||
      !matches(e.runId, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u) ||
      !integer(e.attempt) || e.attempt < 1 || e.attempt > baseline.task.policy.repairBudget ||
      e.taskFingerprint !== baseline.taskFingerprint || e.baseCandidateFingerprint !== baseline.candidateFingerprint ||
      !hash(e.candidateFingerprint) || !prose(e.note, 2048)) fail('CANDIDATE_REVIEW_BINDING');
  const preparation = prepareRepositoryCandidate({ baseline: baseline.baseline, task: baseline.task,
    candidate: result.candidate, authorId: baseline.candidate.authorId });
  if (preparation.candidateFingerprint !== e.candidateFingerprint || e.candidateFingerprint === baseline.candidateFingerprint) fail('CANDIDATE_REVIEW_CANDIDATE');
  const changes = preparation.materialized.files.flatMap(after => {
    const before = baseline.materialized.files.find(file => file.path === after.path);
    if (before?.sha256 === after.sha256) return [];
    return [{ path: after.path, kind: before ? 'MODIFIED' : 'ADDED',
      before: before ? { content: before.content, byteLength: before.byteLength, sha256: before.sha256 } : null,
      after: { content: after.content, byteLength: after.byteLength, sha256: after.sha256 } }];
  });
  if (changes.length === 0) fail('CANDIDATE_REVIEW_NO_CHANGE');
  let createdAtMs;
  try { createdAtMs = now(); } catch { fail('CANDIDATE_REVIEW_CLOCK'); }
  if (!integer(createdAtMs) || createdAtMs >= policy.expiresAtMs) fail('CANDIDATE_REVIEW_CLOCK');
  const identity = cloneFreeze({ schemaVersion: 'nisi-candidate-review-packet-v1', reviewId: policy.reviewId,
    issuanceId: randomUUID(), scope: 'ONE_IN_PROCESS_REVIEW_SESSION', clockDomain: 'UNIX_EPOCH_MILLISECONDS_NONDECREASING',
    reviewerId: policy.reviewerId, createdAtMs, expiresAtMs: policy.expiresAtMs,
    runId: e.runId, attempt: e.attempt, taskFingerprint: e.taskFingerprint,
    baselineCandidateFingerprint: baseline.candidateFingerprint, candidateFingerprint: preparation.candidateFingerprint,
    baselineFingerprint: preparation.baselineFingerprint, materializedFingerprint: preparation.materializedFingerprint,
    preparationFingerprint: preparation.fingerprint, suiteFingerprint: suite.fingerprint,
    harness: { path: suite.entryPath, sha256: suite.entrySha256 },
    task: baseline.task, origin, resultFingerprint: digest('nisi/candidate-review-result/v1', result),
    alreadyRegistered: preparations.some(p => p.candidateFingerprint === preparation.candidateFingerprint),
    files: preparation.materialized.files.map(({ path, byteLength, sha256 }) => ({ path, byteLength, sha256 })),
    changes, nextBoundary: 'SEPARATE_ISOLATION_AND_EXECUTION_APPROVAL_REQUIRED', ...noAuthority });
  const packet = cloneFreeze({ ...identity, fingerprint: digest('nisi/candidate-review-packet/v1', identity) });
  let state = 'PENDING', decision = null, decisionInputFingerprint = null, revoked = false, lastTime = createdAtMs, handedOff = false, busy = false;
  function operation(fn) {
    if (busy) fail('CANDIDATE_REVIEW_REENTRANT');
    busy = true;
    try { return fn(); } finally { busy = false; }
  }
  function tick() {
    if (state === 'INVALID_CLOCK') fail('CANDIDATE_REVIEW_CLOCK');
    let time;
    try { time = now(); } catch { state = 'INVALID_CLOCK'; fail('CANDIDATE_REVIEW_CLOCK'); }
    if (!integer(time) || time < lastTime) { state = 'INVALID_CLOCK'; fail('CANDIDATE_REVIEW_CLOCK'); }
    lastTime = time;
    if (time >= policy.expiresAtMs && !['REJECTED', 'HANDED_OFF', 'REVOKED', 'CONFLICT'].includes(state)) state = 'EXPIRED';
    return time;
  }
  function guard(expected) {
    tick();
    if (revoked || state !== expected) fail('CANDIDATE_REVIEW_STATE');
  }
  const session = Object.freeze({
    packet,
    decide(raw) { return operation(() => {
      const d = cloneFreeze(raw);
      exact(d, ['packetFingerprint', 'reviewerId', 'verdict', 'rationale'], 'CANDIDATE_REVIEW_DECISION');
      tick();
      const inputFingerprint = digest('nisi/candidate-review-decision-input/v1', d);
      // Mutation-like decision calls require an unexpired session. Use snapshot()
      // to inspect a historical decision after expiry/revocation/handoff.
      if (decision !== null && !revoked && lastTime < policy.expiresAtMs && ['APPROVED_FOR_ISOLATION_REVIEW', 'REJECTED'].includes(state)) {
        if (inputFingerprint !== decisionInputFingerprint) { state = 'CONFLICT'; fail('CANDIDATE_REVIEW_DECISION_CONFLICT'); }
        return decision;
      }
      guard('PENDING');
      if (d.packetFingerprint !== packet.fingerprint || d.reviewerId !== policy.reviewerId ||
          !['APPROVE_FOR_ISOLATION_REVIEW', 'REJECT'].includes(d.verdict) || !prose(d.rationale, 4096)) fail('CANDIDATE_REVIEW_DECISION');
      const record = { schemaVersion: 'nisi-candidate-review-decision-v1', ...d, decidedAtMs: lastTime,
        basis: 'TRUSTED_HOST_REVIEW_ASSERTION', ...noAuthority };
      const captured = cloneFreeze({ ...record, fingerprint: digest('nisi/candidate-review-decision/v1', record) });
      guard('PENDING'); decision = captured; decisionInputFingerprint = inputFingerprint;
      state = d.verdict === 'REJECT' ? 'REJECTED' : 'APPROVED_FOR_ISOLATION_REVIEW'; return decision;
    }); },
    handoff(raw) { return operation(() => {
      const expected = cloneFreeze(raw);
      exact(expected, ['packetFingerprint', 'runId', 'attempt', 'taskFingerprint', 'candidateFingerprint', 'materializedFingerprint'], 'CANDIDATE_REVIEW_HANDOFF');
      guard('APPROVED_FOR_ISOLATION_REVIEW');
      for (const key of Object.keys(expected)) {
        const actual = key === 'packetFingerprint' ? packet.fingerprint : packet[key];
        if (expected[key] !== actual) fail('CANDIDATE_REVIEW_HANDOFF');
      }
      guard('APPROVED_FOR_ISOLATION_REVIEW'); handedOff = true; state = 'HANDED_OFF';
      // Preserve original preparation identity for the future isolation boundary.
      // Neither possession nor serializing this record authorizes registration or execution.
      const handoff = Object.freeze({ packet, decision, preparation, ...noAuthority });
      issuedHandoffs.set(handoff, { consumed: false, busy: false, guard() {
        const time = tick();
        if (revoked || state !== 'HANDED_OFF') fail('CANDIDATE_HANDOFF_REVOKED');
        // HANDED_OFF is a historical review state, not an unexpired lease.
        if (time >= policy.expiresAtMs) fail('CANDIDATE_HANDOFF_EXPIRED');
        return time;
      }, validateAt(time) {
        // No callbacks here: the consumer's final Unix-clock observation must
        // cover the source's last sample, and the source must still be live.
        if (!integer(time) || time < lastTime) fail('CANDIDATE_HANDOFF_CLOCK');
        if (revoked || state !== 'HANDED_OFF') fail('CANDIDATE_HANDOFF_REVOKED');
        if (time >= policy.expiresAtMs) fail('CANDIDATE_HANDOFF_EXPIRED');
      } });
      return handoff;
    }); },
    revoke() { return operation(() => {
      revoked = true;
      try { tick(); } catch (error) { if (error.code !== 'CANDIDATE_REVIEW_CLOCK') throw error; }
      if (['PENDING', 'APPROVED_FOR_ISOLATION_REVIEW'].includes(state)) state = 'REVOKED';
    }); },
    snapshot() { return operation(() => {
      try { tick(); } catch (error) { if (error.code !== 'CANDIDATE_REVIEW_CLOCK') throw error; }
      return cloneFreeze({ schemaVersion: 'nisi-candidate-review-state-v1', packetFingerprint: packet.fingerprint,
        state, decision, lastObservedAtMs: lastTime, revoked, handedOff, ...noAuthority });
    }); },
  });
  issued.add(session); return session;
}

export function readIssuedCandidateReviewV1(session) {
  if (!issued.has(session)) fail('CANDIDATE_REVIEW_NOT_ISSUED');
  return session.snapshot();
}

function withLiveHandoff(handoff, action) {
  const state = issuedHandoffs.get(handoff);
  if (!state) fail('CANDIDATE_HANDOFF_NOT_ISSUED');
  if (state.busy) fail('CANDIDATE_HANDOFF_REENTRANT');
  if (state.consumed) fail('CANDIDATE_HANDOFF_CONSUMED');
  state.busy = true;
  try { state.guard(); return action(state); } finally { state.busy = false; }
}

// Original handoff + live source lifecycle only. This does not attest CURRENT_RUN
// or authenticate a user/model; it is not registration or execution permission.
export function readIssuedCandidateReviewHandoffV1(handoff) {
  return withLiveHandoff(handoff, () => handoff);
}

// Final no-callback state/ordering check after the consumer samples its clock.
export function validateIssuedCandidateReviewHandoffV1(handoff, observedAtMs) {
  const state = issuedHandoffs.get(handoff);
  if (!state) fail('CANDIDATE_HANDOFF_NOT_ISSUED');
  if (state.busy) fail('CANDIDATE_HANDOFF_REENTRANT');
  if (state.consumed) fail('CANDIDATE_HANDOFF_CONSUMED');
  state.validateAt(observedAtMs);
  return handoff;
}

// One-way synchronous claim for a separate approval/execution owner. A failed
// later launch cannot undo this claim. Serialized receipts remain inert data.
export function consumeCandidateReviewHandoffV1(handoff, raw) {
  return withLiveHandoff(handoff, state => {
    const expected = cloneFreeze(raw);
    exact(expected, ['packetFingerprint', 'decisionFingerprint', 'executionId'], 'CANDIDATE_HANDOFF_CLAIM');
    if (expected.packetFingerprint !== handoff.packet.fingerprint || expected.decisionFingerprint !== handoff.decision.fingerprint ||
        !id(expected.executionId)) fail('CANDIDATE_HANDOFF_CLAIM');
    const atMs = state.guard();
    const body = { schemaVersion: 'nisi-candidate-handoff-consumption-v1', ...expected, consumedAtMs: atMs, ...noAuthority };
    const receipt = cloneFreeze({ ...body, fingerprint: digest('nisi/candidate-handoff-consumption/v1', body) });
    state.guard(); state.consumed = true;
    const claim = Object.freeze({ handoff, receipt });
    issuedClaims.set(claim, state);
    return claim;
  });
}

// Validate original consumed-record identity and current source state after the
// consumer's final callback. observedAtMs is host asserted, not clock attestation.
export function validateIssuedCandidateReviewConsumptionV1(claim, observedAtMs) {
  const state = issuedClaims.get(claim);
  if (!state || !state.consumed) fail('CANDIDATE_HANDOFF_CLAIM_NOT_ISSUED');
  state.validateAt(observedAtMs);
  return claim;
}
