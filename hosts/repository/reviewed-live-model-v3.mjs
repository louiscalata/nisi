// PRIVATE V3 one-shot reviewed-fixture lane. Protocol selection is explicit.
// Returned unregistered source is retained data, never execution approval.
import { createLocalChatAuthorAdapter, createLocalChatReviewerAdapter, createLocalChatTransportOwner } from '../../adapters/local-chat.mjs';
import { createNativeChatAuthorAdapterV1, createNativeChatReviewerAdapterV1, createNativeChatTransportOwnerV1 } from '../../adapters/native-chat-v1.mjs';
import { cloneFreeze, stableStringify, sha256Text, createCandidate, createTaskSpecification } from '../../workflow/contracts.mjs';
import { exact } from '../../integrity/record-utils.mjs';
import { reviewedNodePreparationsV1 } from './node-suite-v1.mjs';
import { readLiveModelSelectionV3 } from './live-model-selection-v3.mjs';

const lanes = new WeakMap(), hash = (domain, value) => sha256Text(domain + '\0' + stableStringify(value));
const fail = code => { throw Object.assign(new Error(code), { code }); };
const isHash = v => typeof v === 'string' && /^[a-f0-9]{64}$/u.exec(v)?.[0] === v;
const errorCode = e => typeof e?.code === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/u.exec(e.code)?.[0] === e.code ? e.code : 'LIVE_MODEL_ERROR';
const roleConfig = role => ({ ...role, ...(role.api === 'NATIVE_API'
  ? { adapterReceiptVersion: 'nisi-native-chat-receipt-v1', storeRequested: false, integrationsRequested: [] }
  : { adapterReceiptVersion: 2 }) });

export function createReviewedLiveModelLaneV3(input) {
  const transport = globalThis.fetch;
  return make(input, { author: transport, reviewer: transport }, Date.now, 'LOOPBACK_HTTP');
}
export function createReviewedLiveModelLaneWithTransportV3(input, transports, now = Date.now) {
  return make(input, transports, now, 'INJECTED_TEST_TRANSPORT');
}
function make(input, transports, now, transportKind) {
  exact(input, ['suite', 'reviewedSourceFingerprint', 'author', 'reviewer', 'timeoutMs', 'maxOutputTokens', 'approval'], 'LIVE_LANE_SCHEMA');
  exact(transports, ['author', 'reviewer'], 'LIVE_TRANSPORT_REQUIRED');
  if (typeof transports.author !== 'function' || typeof transports.reviewer !== 'function' || typeof now !== 'function') fail('LIVE_TRANSPORT_REQUIRED');
  const fetches = { author: transports.author, reviewer: transports.reviewer }, suite = input.suite;
  const selection = readLiveModelSelectionV3({ author: input.author, reviewer: input.reviewer });
  const captured = cloneFreeze({ reviewedSourceFingerprint: input.reviewedSourceFingerprint,
    timeoutMs: input.timeoutMs, maxOutputTokens: input.maxOutputTokens, approval: input.approval });
  exact(captured.approval, ['id', 'expiresAtMs'], 'LIVE_APPROVAL_SCHEMA');
  if (typeof captured.approval.id !== 'string' || !/^[a-z][a-z0-9_.-]{0,95}$/u.test(captured.approval.id) ||
      !Number.isSafeInteger(captured.approval.expiresAtMs) || captured.approval.expiresAtMs <= 0) fail('LIVE_APPROVAL_INVALID');
  if (!isHash(captured.reviewedSourceFingerprint)) fail('LIVE_SOURCE_IDENTITY');
  if (!Number.isSafeInteger(captured.timeoutMs) || captured.timeoutMs < 1 || captured.timeoutMs > 90000 ||
      !Number.isSafeInteger(captured.maxOutputTokens) || captured.maxOutputTokens < 1 || captured.maxOutputTokens > 4096) fail('LIVE_CALL_BUDGET');
  const preparations = reviewedNodePreparationsV1(suite);
  if (preparations.length !== 2 || preparations[0].candidateFingerprint === preparations[1].candidateFingerprint) fail('LIVE_FIXTURE_PAIR');
  const [baseline, repaired] = preparations, task = baseline.task;
  if (task.mode !== 'edit' || task.policy.repairBudget !== 1 || task.policy.requiredReviewers !== 1) fail('LIVE_TASK_POLICY');
  const configuration = cloneFreeze({ author: roleConfig(selection.author), reviewer: roleConfig(selection.reviewer),
    timeoutMs: captured.timeoutMs, maxOutputTokens: captured.maxOutputTokens, taskFingerprint: baseline.taskFingerprint,
    suiteFingerprint: suite.fingerprint, reviewedSourceFingerprint: captured.reviewedSourceFingerprint, transportKind,
    authorId: 'author.live-model', reviewerId: 'reviewer.live-model', maxRequestBytes: 262144, maxResponseBytes: 262144 });
  const configurationFingerprint = hash('nisi/live-model-configuration/v3', configuration);
  const approval = cloneFreeze({ ...captured.approval, scope: 'REVIEWED_FIXTURE_REPAIR_AND_REVIEW_ONLY', configurationFingerprint });
  const approvalFingerprint = hash('nisi/live-model-approval/v3', approval);
  const owners = {}, adapters = {};
  for (const name of ['author', 'reviewer']) {
    const r = configuration[name], native = r.api === 'NATIVE_API';
    const owner = native ? createNativeChatTransportOwnerV1() : createLocalChatTransportOwner(); owners[name] = owner;
    const common = { destination: 'LOOPBACK_HTTP', endpoint: r.endpoint, model: r.model, id: configuration[name + 'Id'],
      timeoutMs: configuration.timeoutMs, maxOutputTokens: configuration.maxOutputTokens,
      maxRequestBytes: configuration.maxRequestBytes, maxResponseBytes: configuration.maxResponseBytes,
      transportOwner: owner, fetch: fetches[name] };
    adapters[name] = native
      ? (name === 'author' ? createNativeChatAuthorAdapterV1 : createNativeChatReviewerAdapterV1)({ ...common, expectedModelInstance: r.expectedModelInstance, reasoning: r.reasoning })
      : (name === 'author' ? createLocalChatAuthorAdapter : createLocalChatReviewerAdapter)({ ...common, outputMode: r.outputMode });
  }
  let phase = 'NEW', runId = null, revoked = false, lastWall = null;
  const events = [], returnedResults = [], stopOwners = () => { owners.author.stop(); owners.reviewer.stop(); };
  function lifecycle() {
    const roles = { author: owners.author.status(), reviewer: owners.reviewer.status() }, values = Object.values(roles);
    const pendingTransports = values.reduce((n, s) => n + s.pendingTransports, 0);
    const recoveryRequired = values.some(s => s.recoveryRequired);
    const state = recoveryRequired ? 'QUARANTINED' : values.some(s => ['DRAINING', 'STOPPED_DRAINING'].includes(s.state)) ? 'DRAINING'
      : values.some(s => s.state === 'BUSY') ? 'BUSY' : values.some(s => s.state === 'STOPPED') ? 'STOPPED' : 'IDLE';
    return cloneFreeze({ state, pendingTransports, recoveryRequired, remoteInferenceStopped: 'NOT_OBSERVED', scope: 'THIS_LANE_ONLY', roles });
  }
  function snapshotPayload(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) fail('LIVE_PAYLOAD_SCHEMA');
    const descriptors = Object.getOwnPropertyDescriptors(raw), data = {};
    for (const key of Reflect.ownKeys(descriptors)) {
      if (!['task', 'candidate', 'acceptanceCriteria', 'binding', 'signal', 'checks', 'tests', 'stages', 'reviewerId'].includes(key) ||
          !Object.hasOwn(descriptors[key], 'value') || !descriptors[key].enumerable) fail('LIVE_PAYLOAD_SCHEMA');
      if (key !== 'signal') data[key] = descriptors[key].value;
    }
    const signal = descriptors.signal?.value;
    if (signal !== undefined && !(signal instanceof AbortSignal)) fail('LIVE_SIGNAL_INVALID');
    return Object.freeze({ ...cloneFreeze(data), ...(signal !== undefined ? { signal } : {}) });
  }
  function scopeGuard(p) {
    const wall = now();
    if (!Number.isSafeInteger(wall) || wall < 0 || (lastWall !== null && wall < lastWall)) { stopOwners(); fail('LIVE_CLOCK_INVALID'); }
    lastWall = wall;
    if (revoked) fail('LIVE_APPROVAL_REVOKED');
    if (wall >= approval.expiresAtMs) { stopOwners(); fail('LIVE_APPROVAL_EXPIRED'); }
    if (p.signal?.aborted) { stopOwners(); fail('ABORTED'); }
  }
  function guard(p, expectedPhase, attempt, candidateFingerprint) {
    scopeGuard(p);
    if (phase !== expectedPhase) fail('LIVE_STAGE_ORDER');
    exact(p.binding, ['schemaVersion', 'runId', 'taskFingerprint', 'attempt', 'candidateFingerprint'], 'LIVE_BINDING_SCHEMA');
    const b = p.binding;
    if (b.schemaVersion !== 1 || typeof b.runId !== 'string' || b.runId.length !== 36 || !/^[a-f0-9-]{36}$/u.test(b.runId) ||
        b.taskFingerprint !== baseline.taskFingerprint || b.attempt !== attempt || b.candidateFingerprint !== candidateFingerprint ||
        (runId !== null && runId !== b.runId)) fail('LIVE_BINDING_MISMATCH');
    if (stableStringify(createTaskSpecification(p.task)) !== stableStringify(task)) fail('LIVE_TASK_MISMATCH');
    if (stableStringify(p.acceptanceCriteria) !== stableStringify(task.acceptanceCriteria)) fail('LIVE_CRITERIA_MISMATCH');
    if (candidateFingerprint !== null && createCandidate({ files: p.candidate.files }, { authorId: configuration.authorId }).fingerprint !== candidateFingerprint) fail('LIVE_CANDIDATE_MISMATCH');
    if (lifecycle().state !== 'IDLE') fail('LIVE_TRANSPORT_NOT_IDLE');
  }
  function event(stage, p, status, resultCandidateFingerprint, code = null) {
    if (events.length < 8) events.push(cloneFreeze({ stage, binding: p?.binding ?? null, status, resultCandidateFingerprint, code }));
  }
  const authorizeContext = Object.freeze({ authorize(raw) {
    const p = snapshotPayload(raw); guard(p, 'NEW', 0, null); runId = p.binding.runId; phase = 'AUTHORIZED';
    event('authorizeContext', p, 'PASS', null); return { status: 'PASS', evidence: { ...p.binding, reason: '' } };
  } });
  function draft(raw) {
    const p = snapshotPayload(raw); guard(p, 'AUTHORIZED', 0, null); phase = 'SEEDED';
    event('hostSeed', p, 'PASS', baseline.candidateFingerprint);
    return { candidate: { files: baseline.candidate.files.map(({ path, content }) => ({ path, content })) },
      evidence: { ...p.binding, candidateFingerprint: baseline.candidateFingerprint,
        note: 'Host-seeded source-reviewed baseline. No model draft occurred.' } };
  }
  async function invoke(raw, operation) {
    let p;
    try {
      p = snapshotPayload(raw);
      guard(p, operation === 'repair' ? 'SEEDED' : 'REPAIRED', 1,
        operation === 'repair' ? baseline.candidateFingerprint : repaired.candidateFingerprint);
      phase = operation === 'repair' ? 'REPAIRING' : 'REVIEWING';
      const result = await (operation === 'repair' ? adapters.author.repair(p) : adapters.reviewer.review(p));
      returnedResults.push(cloneFreeze({ operation, result }));
      scopeGuard(p);
      if (phase !== (operation === 'repair' ? 'REPAIRING' : 'REVIEWING')) fail('LIVE_STAGE_ORDER');
      const fingerprint = result.evidence.candidateFingerprint;
      if (operation === 'repair' && (result.status !== 'REPAIRED' || fingerprint !== repaired.candidateFingerprint)) fail('LIVE_REPAIR_NOT_REGISTERED');
      event(operation, p, result.status, fingerprint); phase = operation === 'repair' ? 'REPAIRED' : 'REVIEWED'; return result;
    } catch (e) {
      phase = 'FAILED'; stopOwners(); event(operation, p, 'UNAVAILABLE', null, errorCode(e)); throw e;
    }
  }
  const lane = Object.freeze({ authorizeContext,
    author: Object.freeze({ id: configuration.authorId, draft, repair: p => invoke(p, 'repair') }),
    reviewers: Object.freeze([Object.freeze({ id: configuration.reviewerId, review: p => invoke(p, 'review') })]),
    revoke() { revoked = true; stopOwners(); },
    snapshot: () => cloneFreeze({ schemaVersion: 'nisi-reviewed-live-model-lane-v3', configuration, configurationFingerprint,
      approval, approvalFingerprint, runId, phase, revoked, baselineCandidateFingerprint: baseline.candidateFingerprint,
      repairedCandidateFingerprint: repaired.candidateFingerprint, events, returnedResults,
      authorReceipts: adapters.author.receipts(), reviewerReceipts: adapters.reviewer.receipts(),
      lifecycle: lifecycle(), remoteInferenceStopped: 'NOT_OBSERVED', authorizing: false }) });
  lanes.set(lane, { suite, preparations }); return lane;
}
export function readIssuedLiveModelLaneV3(lane) {
  const state = lanes.get(lane); if (!state) fail('LIVE_LANE_NOT_ISSUED');
  return Object.freeze({ suite: state.suite, preparations: state.preparations, snapshot: lane.snapshot() });
}
