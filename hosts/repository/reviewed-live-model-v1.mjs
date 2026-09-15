// PRIVATE one-shot live REPAIR + independent-model REVIEW for a source-reviewed
// fixed fixture. Host seed is not inference. No automatic retry or code execution.
import { createLocalChatAuthorAdapter, createLocalChatReviewerAdapter, createLocalChatTransportOwner } from '../../adapters/local-chat.mjs';
import { cloneFreeze, stableStringify, sha256Text, createCandidate, createTaskSpecification } from '../../workflow/contracts.mjs';
import { exact } from '../../integrity/record-utils.mjs';
import { reviewedNodePreparationsV1 } from './node-suite-v1.mjs';

const lanes = new WeakMap(), hash = (domain, value) => sha256Text(domain + '\0' + stableStringify(value));
const fail = code => { throw Object.assign(new Error(code), { code }); };
const isId = v => typeof v === 'string' && /^[a-z][a-z0-9_.-]{0,95}$/u.exec(v)?.[0] === v;
const isHash = v => typeof v === 'string' && v.length === 64 && /^[a-f0-9]{64}$/u.test(v);
const errorCode = e => typeof e?.code === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/u.exec(e.code)?.[0] === e.code ? e.code : 'LIVE_MODEL_ERROR';

export function createReviewedLiveModelLaneV1(input) { return make(input, globalThis.fetch, Date.now, 'LOOPBACK_HTTP'); }
// Explicit test seam; its results can never acquire the real-transport label.
export function createReviewedLiveModelLaneWithTransportV1(input, transport, now = Date.now) {
  return make(input, transport, now, 'INJECTED_TEST_TRANSPORT');
}
// Versioned opt-in; V1 remains strict-schema-only with its original identities.
export function createReviewedLiveModelLaneV2(input) { return make(input, globalThis.fetch, Date.now, 'LOOPBACK_HTTP', 2); }
export function createReviewedLiveModelLaneWithTransportV2(input, transport, now = Date.now) {
  return make(input, transport, now, 'INJECTED_TEST_TRANSPORT', 2);
}
function make(input, transport, now, transportKind, version = 1) {
  exact(input, ['suite', 'reviewedSourceFingerprint', 'endpoint', 'authorModel', 'reviewerModel', 'timeoutMs', 'maxOutputTokens', 'approval',
    ...(version === 2 ? ['authorOutputMode', 'reviewerOutputMode'] : [])], 'LIVE_LANE_SCHEMA');
  if (version === 2 && ['authorOutputMode', 'reviewerOutputMode'].some(k => !['json_schema', 'json_instruction'].includes(input[k]))) fail('LIVE_OUTPUT_MODE_INVALID');
  exact(input.approval, ['id', 'expiresAtMs'], 'LIVE_APPROVAL_SCHEMA');
  if (!isId(input.approval.id) || !Number.isSafeInteger(input.approval.expiresAtMs) || input.approval.expiresAtMs <= 0) fail('LIVE_APPROVAL_INVALID');
  if (!isHash(input.reviewedSourceFingerprint)) fail('LIVE_SOURCE_IDENTITY');
  if (typeof transport !== 'function' || typeof now !== 'function') fail('LIVE_TRANSPORT_REQUIRED');
  for (const name of ['authorModel', 'reviewerModel']) {
    const value = input[name];
    if (typeof value !== 'string' || !value.isWellFormed() || value.trim() !== value || !value || value.includes('\0') || Buffer.byteLength(value) > 200) fail('LIVE_MODEL_ID');
  }
  if (input.authorModel === input.reviewerModel) fail('LIVE_MODELS_NOT_DISTINCT');
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 90000 ||
      !Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens < 1 || input.maxOutputTokens > 4096) fail('LIVE_CALL_BUDGET');
  const preparations = reviewedNodePreparationsV1(input.suite);
  if (preparations.length !== 2 || preparations[0].candidateFingerprint === preparations[1].candidateFingerprint) fail('LIVE_FIXTURE_PAIR');
  const [baseline, repaired] = preparations, task = baseline.task;
  if (task.mode !== 'edit' || task.policy.repairBudget !== 1 || task.policy.requiredReviewers !== 1) fail('LIVE_TASK_POLICY');
  const configuration = cloneFreeze({ endpoint: input.endpoint, authorModel: input.authorModel, reviewerModel: input.reviewerModel,
    ...(version === 2 ? { authorOutputMode: input.authorOutputMode, reviewerOutputMode: input.reviewerOutputMode } : {}),
    timeoutMs: input.timeoutMs, maxOutputTokens: input.maxOutputTokens, taskFingerprint: baseline.taskFingerprint,
    suiteFingerprint: input.suite.fingerprint, reviewedSourceFingerprint: input.reviewedSourceFingerprint, transportKind,
    authorId: 'author.live-model', reviewerId: 'reviewer.live-model', maxRequestBytes: 262144, maxResponseBytes: 262144 });
  const configurationFingerprint = hash(`nisi/live-model-configuration/v${version}`, configuration);
  const approval = cloneFreeze({ ...input.approval, scope: 'REVIEWED_FIXTURE_REPAIR_AND_REVIEW_ONLY', configurationFingerprint });
  const approvalFingerprint = hash(`nisi/live-model-approval/v${version}`, approval), owner = createLocalChatTransportOwner();
  const common = { destination: 'LOOPBACK_HTTP', endpoint: configuration.endpoint, timeoutMs: configuration.timeoutMs,
    maxOutputTokens: configuration.maxOutputTokens, maxRequestBytes: configuration.maxRequestBytes,
    maxResponseBytes: configuration.maxResponseBytes, transportOwner: owner, fetch: transport };
  const author = createLocalChatAuthorAdapter({ ...common, id: configuration.authorId, model: configuration.authorModel,
    ...(version === 2 ? { outputMode: configuration.authorOutputMode } : {}) });
  const reviewer = createLocalChatReviewerAdapter({ ...common, id: configuration.reviewerId, model: configuration.reviewerModel,
    ...(version === 2 ? { outputMode: configuration.reviewerOutputMode } : {}) });
  let phase = 'NEW', runId = null, revoked = false, lastWall = null; const events = [], returnedResults = [];
  function guard(payload, expectedPhase, attempt, candidateFingerprint) {
    const wall = now();
    if (!Number.isSafeInteger(wall) || wall < 0 || (lastWall !== null && wall < lastWall)) fail('LIVE_CLOCK_INVALID'); lastWall = wall;
    if (revoked) fail('LIVE_APPROVAL_REVOKED');
    if (wall >= approval.expiresAtMs) fail('LIVE_APPROVAL_EXPIRED');
    if (payload.signal?.aborted) fail('ABORTED');
    if (phase !== expectedPhase) fail('LIVE_STAGE_ORDER');
    exact(payload.binding, ['schemaVersion','runId','taskFingerprint','attempt','candidateFingerprint'], 'LIVE_BINDING_SCHEMA');
    const b = payload.binding;
    if (b.schemaVersion !== 1 || typeof b.runId !== 'string' || b.runId.length !== 36 || !/^[a-f0-9-]{36}$/u.test(b.runId) ||
        b.taskFingerprint !== baseline.taskFingerprint || b.attempt !== attempt || b.candidateFingerprint !== candidateFingerprint ||
        (runId !== null && runId !== b.runId)) fail('LIVE_BINDING_MISMATCH');
    if (stableStringify(createTaskSpecification(payload.task)) !== stableStringify(task)) fail('LIVE_TASK_MISMATCH');
    if (stableStringify(payload.acceptanceCriteria) !== stableStringify(task.acceptanceCriteria)) fail('LIVE_CRITERIA_MISMATCH');
    if (candidateFingerprint !== null && createCandidate({ files: payload.candidate.files }, { authorId: configuration.authorId }).fingerprint !== candidateFingerprint) fail('LIVE_CANDIDATE_MISMATCH');
    if (owner.status().state !== 'IDLE') fail('LIVE_TRANSPORT_NOT_IDLE');
  }
  function event(stage, payload, status, resultCandidateFingerprint, code = null) {
    events.push(cloneFreeze({ stage, binding: payload.binding, status, resultCandidateFingerprint, code }));
  }
  const authorizeContext = Object.freeze({ authorize(payload) {
    guard(payload, 'NEW', 0, null); runId = payload.binding.runId; phase = 'AUTHORIZED';
    event('authorizeContext', payload, 'PASS', null);
    return { status: 'PASS', evidence: { ...payload.binding, reason: '' } };
  } });
  function draft(payload) {
    guard(payload, 'AUTHORIZED', 0, null); phase = 'SEEDED';
    event('hostSeed', payload, 'PASS', baseline.candidateFingerprint);
    return { candidate: { files: baseline.candidate.files.map(({ path, content }) => ({ path, content })) },
      evidence: { ...payload.binding, candidateFingerprint: baseline.candidateFingerprint,
        note: 'Host-seeded source-reviewed baseline. No model draft occurred.' } };
  }
  async function invoke(payload, operation) {
    try {
      guard(payload, operation === 'repair' ? 'SEEDED' : 'REPAIRED', 1,
        operation === 'repair' ? baseline.candidateFingerprint : repaired.candidateFingerprint);
      phase = operation === 'repair' ? 'REPAIRING' : 'REVIEWING';
      const result = await (operation === 'repair' ? author.repair(payload) : reviewer.review(payload));
      // Retain valid but unregistered/late output as data, never executable approval.
      returnedResults.push(cloneFreeze({ operation, result }));
      // Guard expiry/revocation after copying too; validated transport may still
      // finish after scope ended. Retain its receipt but do not admit its result.
      const wall = now();
      if (!Number.isSafeInteger(wall) || wall < lastWall) fail('LIVE_CLOCK_INVALID'); lastWall = wall;
      if (revoked) fail('LIVE_APPROVAL_REVOKED'); if (wall >= approval.expiresAtMs) fail('LIVE_APPROVAL_EXPIRED');
      if (payload.signal?.aborted) fail('ABORTED');
      // A refused overlapping/replayed call makes this one-shot lane terminal.
      // Its earlier in-flight response must not revive the failed state.
      if (phase !== (operation === 'repair' ? 'REPAIRING' : 'REVIEWING')) fail('LIVE_STAGE_ORDER');
      const fingerprint = result.evidence.candidateFingerprint;
      if (operation === 'repair' && (result.status !== 'REPAIRED' || fingerprint !== repaired.candidateFingerprint)) fail('LIVE_REPAIR_NOT_REGISTERED');
      event(operation, payload, result.status, fingerprint);
      phase = operation === 'repair' ? 'REPAIRED' : 'REVIEWED'; return result;
    } catch (e) {
      phase = 'FAILED'; if (events.length < 8) event(operation, payload, 'UNAVAILABLE', null, errorCode(e)); throw e;
    }
  }
  const lane = Object.freeze({ authorizeContext,
    author: Object.freeze({ id: configuration.authorId, draft, repair: payload => invoke(payload, 'repair') }),
    reviewers: Object.freeze([Object.freeze({ id: configuration.reviewerId, review: payload => invoke(payload, 'review') })]),
    revoke() { revoked = true; owner.stop(); },
    snapshot: () => cloneFreeze({ schemaVersion: `nisi-reviewed-live-model-lane-v${version}`, configuration, configurationFingerprint,
      approval, approvalFingerprint, runId, phase, revoked, baselineCandidateFingerprint: baseline.candidateFingerprint,
      repairedCandidateFingerprint: repaired.candidateFingerprint, events, returnedResults, authorReceipts: author.receipts(), reviewerReceipts: reviewer.receipts(),
      lifecycle: owner.status(), remoteInferenceStopped: 'NOT_OBSERVED', authorizing: false }) });
  lanes.set(lane, { suite: input.suite, preparations, snapshot: lane.snapshot, version }); return lane;
}
function readIssued(lane, version) {
  const state = lanes.get(lane); if (!state) fail('LIVE_LANE_NOT_ISSUED');
  if (state.version !== version) fail('LIVE_LANE_VERSION_MISMATCH');
  return Object.freeze({ suite: state.suite, preparations: state.preparations, snapshot: state.snapshot() });
}
export function readIssuedLiveModelLaneV1(lane) { return readIssued(lane, 1); }
export function readIssuedLiveModelLaneV2(lane) { return readIssued(lane, 2); }
