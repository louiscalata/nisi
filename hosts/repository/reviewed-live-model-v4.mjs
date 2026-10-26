// PRIVATE V4 experimental guidance lane. Same candidate population for OFF/ON.
// Returned unregistered source is retained data, never execution approval.
import { createLocalChatGuidedAuthorAdapterV1, createLocalChatReviewerAdapter, createLocalChatTransportOwner } from '../../adapters/local-chat.mjs';
import { createNativeChatGuidedAuthorAdapterV1, createNativeChatReviewerAdapterV1, createNativeChatTransportOwnerV1 } from '../../adapters/native-chat-v1.mjs';
import { readRepairGuidanceV1 } from '../../adapters/repair-guidance-v1.mjs';
import { cloneFreeze, stableStringify, sha256Text, createCandidate, createTaskSpecification } from '../../workflow/contracts.mjs';
import { exact } from '../../integrity/record-utils.mjs';
import { reviewedNodePreparationsV1 } from './node-suite-v1.mjs';
import { readLiveModelSelectionV3 } from './live-model-selection-v3.mjs';
import { liveModelOwnerStatusV1 } from './live-owner-status-v1.mjs';

const lanes = new WeakMap(), hash = (domain, value) => sha256Text(domain + '\0' + stableStringify(value));
const fail = code => { throw Object.assign(new Error(code), { code }); };
const isHash = v => typeof v === 'string' && /^[a-f0-9]{64}$/u.exec(v)?.[0] === v;
const errorCode = e => typeof e?.code === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/u.exec(e.code)?.[0] === e.code ? e.code : 'LIVE_MODEL_ERROR';
const roleConfig = (role, guided = false) => ({ ...role, ...(role.api === 'NATIVE_API'
  ? { adapterReceiptVersion: guided ? 'nisi-native-chat-guidance-receipt-v1' : 'nisi-native-chat-receipt-v1', storeRequested: false, integrationsRequested: [] }
  : { adapterReceiptVersion: guided ? 4 : 2 }) });

export function createReviewedLiveModelLaneV4(input) {
  const transport = globalThis.fetch;
  return make(input, { author: transport, reviewer: transport }, Date.now, 'LOOPBACK_HTTP');
}
export function createReviewedLiveModelLaneWithTransportV4(input, transports, now = Date.now) {
  return make(input, transports, now, 'INJECTED_TEST_TRANSPORT');
}
// Pure preflight: preserve original fixture/treatment identities without creating
// transport owners, adapters, listeners or model requests.
export function prepareReviewedLiveModelLaneV4(input, transportKind = 'LOOPBACK_HTTP') {
  if (!['LOOPBACK_HTTP', 'INJECTED_TEST_TRANSPORT'].includes(transportKind)) fail('LIVE_TRANSPORT_KIND');
  exact(input, ['suite', 'reviewedSourceFingerprint', 'author', 'reviewer', 'timeoutMs', 'maxOutputTokens', 'approval', 'arm', 'treatment'], 'LIVE_LANE_SCHEMA');
  const suite = input.suite;
  const selection = readLiveModelSelectionV3({ author: input.author, reviewer: input.reviewer });
  const treatment = readRepairGuidanceV1(input.treatment, selection.author.api);
  if (input.arm !== treatment.arm) fail('LIVE_TREATMENT_ARM');
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
  const treatmentBinding = { taskFingerprint: baseline.taskFingerprint, baselineFingerprint: baseline.baselineFingerprint,
    suiteFingerprint: suite.fingerprint, reviewedSourceFingerprint: captured.reviewedSourceFingerprint };
  if (stableStringify(treatment.binding) !== stableStringify(treatmentBinding)) fail('LIVE_TREATMENT_BINDING');
  const configuration = cloneFreeze({ author: roleConfig(selection.author, true), reviewer: roleConfig(selection.reviewer),
    treatment, arm: treatment.arm,
    timeoutMs: captured.timeoutMs, maxOutputTokens: captured.maxOutputTokens, taskFingerprint: baseline.taskFingerprint,
    suiteFingerprint: suite.fingerprint, reviewedSourceFingerprint: captured.reviewedSourceFingerprint, transportKind,
    authorId: 'author.live-model', reviewerId: 'reviewer.live-model', maxRequestBytes: 262144, maxResponseBytes: 262144 });
  return Object.freeze({ suite, selection, treatment, captured, preparations, baseline, repaired, configuration });
}
function make(input, transports, now, transportKind) {
  const { suite, treatment, captured, preparations, baseline, repaired, configuration } = prepareReviewedLiveModelLaneV4(input, transportKind);
  exact(transports, ['author', 'reviewer'], 'LIVE_TRANSPORT_REQUIRED');
  if (typeof transports.author !== 'function' || typeof transports.reviewer !== 'function' || typeof now !== 'function') fail('LIVE_TRANSPORT_REQUIRED');
  const fetches = { author: transports.author, reviewer: transports.reviewer }, task = baseline.task;
  const configurationFingerprint = hash('nisi/live-model-configuration/v4', configuration);
  const approval = cloneFreeze({ ...captured.approval, scope: 'REVIEWED_FIXTURE_REPAIR_AND_REVIEW_ONLY', configurationFingerprint });
  const approvalFingerprint = hash('nisi/live-model-approval/v4', approval);
  const owners = {}, adapters = {}, invocations = [], requestObservations = [], pendingInvocations = new Map();
  // Memory-only original request channel. At most one request for each role;
  // ordinary snapshots/serialized receipts deliberately do not contain bodies.
  const observeTransport = role => function (url, request) {
    const invocation = pendingInvocations.get(role);
    if (!invocation || requestObservations.some(item => item.role === role)) fail('LIVE_REQUEST_INVENTORY');
    pendingInvocations.delete(role);
    exact(request, ['method', 'redirect', 'signal', 'headers', 'body'], 'LIVE_REQUEST_SCHEMA');
    if (typeof url !== 'string' || typeof request.body !== 'string' ||
        !(request.signal instanceof AbortSignal) || Buffer.byteLength(request.body, 'utf8') > configuration.maxRequestBytes)
      fail('LIVE_REQUEST_SCHEMA');
    if (Buffer.byteLength(JSON.stringify(invocation.payload), 'utf8') > configuration.maxRequestBytes + 1024) fail('LIVE_REQUEST_PAYLOAD_CAP');
    const captured = cloneFreeze({ method: request.method, redirect: request.redirect, headers: request.headers, body: request.body });
    // Pass exactly the frozen bytes/controls observed here and the original
    // signal once. Invocation is not proof of provider delivery or execution.
    invocations[invocation.index] = Object.freeze({ role, operation: invocation.operation,
      binding: invocation.payload.binding, payload: invocation.payload });
    requestObservations.push(cloneFreeze({ role, api: configuration[role].api, operation: invocation.operation,
      endpoint: url, request: captured, requestBytes: Buffer.byteLength(captured.body, 'utf8'),
      requestSha256: sha256Text(captured.body), binding: invocation.payload.binding,
      observation: 'LOCAL_TRANSPORT_INVOKED', providerDeliveryAttested: false }));
    return Reflect.apply(fetches[role], this, [url, Object.freeze({ ...captured, signal: request.signal })]);
  };
  try {
    for (const name of ['author', 'reviewer']) {
      const r = configuration[name], native = r.api === 'NATIVE_API';
      const owner = native ? createNativeChatTransportOwnerV1() : createLocalChatTransportOwner(); owners[name] = owner;
      const common = { destination: 'LOOPBACK_HTTP', endpoint: r.endpoint, model: r.model, id: configuration[name + 'Id'],
        timeoutMs: configuration.timeoutMs, maxOutputTokens: configuration.maxOutputTokens,
        maxRequestBytes: configuration.maxRequestBytes, maxResponseBytes: configuration.maxResponseBytes,
        transportOwner: owner, fetch: observeTransport(name) };
      const options = native ? { ...common, expectedModelInstance: r.expectedModelInstance, reasoning: r.reasoning }
        : { ...common, outputMode: r.outputMode };
      adapters[name] = name === 'author'
        ? (native ? createNativeChatGuidedAuthorAdapterV1 : createLocalChatGuidedAuthorAdapterV1)(options, treatment)
        : (native ? createNativeChatReviewerAdapterV1 : createLocalChatReviewerAdapter)(options);
    }
  } catch (error) {
    // Constructor failure returns no lane handle. Stop every owner allocated
    // so far here. An unconfirmed rollback takes precedence over the original
    // error; callers cannot claim cleanup of an owner they never received.
    let confirmed = true;
    for (const owner of Object.values(owners)) {
      try {
        owner.stop();
        const status = owner.status();
        if (status.state !== 'STOPPED' || status.pendingTransports !== 0 || status.recoveryRequired) confirmed = false;
      } catch { confirmed = false; }
    }
    if (!confirmed) fail('LIVE_CONSTRUCTOR_ROLLBACK_UNCONFIRMED');
    throw error;
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
      const { signal: _signal, ...data } = p;
      const role = operation === 'repair' ? 'author' : 'reviewer';
      const invocation = Object.freeze({ role, operation, payload: Object.freeze(data), index: invocations.length });
      // Do not retain potentially oversized stage text after a pre-fetch refusal.
      invocations.push(Object.freeze({ role, operation, binding: p.binding, payload: null }));
      pendingInvocations.set(role, invocation);
      let result;
      try { result = await (operation === 'repair' ? adapters.author.repair(p) : adapters.reviewer.review(p)); }
      finally { pendingInvocations.delete(role); }
      returnedResults.push(cloneFreeze({ operation, result }));
      scopeGuard(p);
      if (phase !== (operation === 'repair' ? 'REPAIRING' : 'REVIEWING')) fail('LIVE_STAGE_ORDER');
      const fingerprint = result.evidence.candidateFingerprint;
      if (operation === 'repair') {
        if (result.status === 'NO_CHANGE') {
          if (result.candidate !== null || fingerprint !== baseline.candidateFingerprint) fail('LIVE_REPAIR_NOT_REGISTERED');
        } else if (result.status !== 'REPAIRED' || !preparations.some(item => item.candidateFingerprint === fingerprint)) fail('LIVE_REPAIR_NOT_REGISTERED');
        if (result.evidence.baseCandidateFingerprint !== baseline.candidateFingerprint) fail('LIVE_REPAIR_NOT_REGISTERED');
      }
      event(operation, p, result.status, fingerprint);
      phase = operation === 'repair' ? (fingerprint === baseline.candidateFingerprint ? 'NO_PROGRESS' : 'REPAIRED') : 'REVIEWED';
      return result;
    } catch (e) {
      phase = 'FAILED'; stopOwners(); event(operation, p, 'UNAVAILABLE', null, errorCode(e)); throw e;
    }
  }
  const executionOwners = Object.freeze(['author', 'reviewer'].map(role => Object.freeze({ id: `model.${role}`,
    status: () => liveModelOwnerStatusV1(owners[role].status()),
    settled: () => owners[role].settled(), cancel: () => owners[role].stop() })));
  const lane = Object.freeze({ authorizeContext,
    author: Object.freeze({ id: configuration.authorId, draft, repair: p => invoke(p, 'repair') }),
    reviewers: Object.freeze([Object.freeze({ id: configuration.reviewerId, review: p => invoke(p, 'review') })]),
    revoke() { revoked = true; stopOwners(); },
    executionOwners: () => executionOwners,
    snapshot: () => cloneFreeze({ schemaVersion: 'nisi-reviewed-live-model-lane-v4', configuration, configurationFingerprint,
      approval, approvalFingerprint, runId, phase, revoked, baselineCandidateFingerprint: baseline.candidateFingerprint,
      repairedCandidateFingerprint: repaired.candidateFingerprint, events, returnedResults,
      authorReceipts: adapters.author.receipts(), reviewerReceipts: adapters.reviewer.receipts(),
      lifecycle: lifecycle(), remoteInferenceStopped: 'NOT_OBSERVED', authorizing: false }) });
  lanes.set(lane, { suite, preparations, treatment, invocations, requestObservations, executionOwners }); return lane;
}
// Callback-free identity discovery, before any live snapshot is inspected.
export function readIssuedLiveModelLaneIdentityV4(lane) {
  const state = lanes.get(lane); if (!state) fail('LIVE_LANE_NOT_ISSUED');
  return Object.freeze({ suite: state.suite, executionOwners: state.executionOwners });
}
export function readIssuedLiveModelLaneV4(lane) {
  const state = lanes.get(lane); if (!state) fail('LIVE_LANE_NOT_ISSUED');
  return Object.freeze({ suite: state.suite, preparations: state.preparations, treatment: state.treatment,
    invocations: Object.freeze([...state.invocations]), requestObservations: Object.freeze([...state.requestObservations]), snapshot: lane.snapshot() });
}
