// PRIVATE original-lane request consistency only, not a repository-run verdict.
// Raw source-bearing bodies remain memory-only inside the issued lane channel.
import { readIssuedLiveModelLaneV4 } from '../hosts/repository/reviewed-live-model-v4.mjs';
import { readRepairGuidanceV1, repairGuidanceReceiptV1 } from '../adapters/repair-guidance-v1.mjs';
import { strictJSON } from '../adapters/local-chat.mjs';
import { cloneFreeze, stableStringify, sha256Text } from '../workflow/contracts.mjs';
import { exact } from '../integrity/record-utils.mjs';
const fail = code => { throw Object.assign(new Error(code), { code }); };
const same = (a, b) => stableStringify(a) === stableStringify(b);
const reviewPins = Object.freeze({
  CHAT_COMPLETIONS: 'ca5106bf35d6629eff99b8f3d6f251b37040153a1f239126d82a2df0062a38f1',
  NATIVE_API: 'f11ea6482869e9f8dbb587acfd02bcb0fe239b355f3b63271a9f428491b6a319',
});
function responseFormat(task, operation) {
  const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
  const note = { type: 'string', minLength: 1, maxLength: 4096 };
  const candidate = object({ files: { type: 'array', minItems: 1, maxItems: 256, items: object({
    path: { type: 'string', enum: task.allowedFiles }, content: { type: 'string' },
  }) } });
  const schema = operation === 'repair'
    ? object({ status: { type: 'string', enum: ['REPAIRED', 'NO_CHANGE'] }, candidate: { anyOf: [candidate, { type: 'null' }] }, note })
    : object({ findings: { type: 'array', maxItems: 256, items: object({ code: { type: 'string' }, message: { type: 'string' } }) }, summary: note });
  return { type: 'json_schema', json_schema: { name: `nisi_${operation}`, strict: true, schema } };
}
function inspectRequest(observed, invocation, config, treatment) {
  const role = invocation.role, selection = config[role], native = selection.api === 'NATIVE_API';
  const p = invocation.payload, operation = invocation.operation;
  exact(observed, ['role','api','operation','endpoint','request','requestBytes','requestSha256','binding',
    'observation','providerDeliveryAttested'], 'LIVE_REQUEST_OBSERVATION_SCHEMA');
  exact(observed.request, ['method','redirect','headers','body'], 'LIVE_REQUEST_OBSERVATION_SCHEMA');
  const { body } = observed.request;
  if (observed.role !== role || observed.api !== selection.api || observed.operation !== operation ||
      observed.endpoint !== selection.endpoint || !same(observed.binding, p.binding) ||
      observed.observation !== 'LOCAL_TRANSPORT_INVOKED' || observed.providerDeliveryAttested !== false ||
      observed.request.method !== 'POST' || observed.request.redirect !== 'error' ||
      !same(observed.request.headers, { 'content-type': 'application/json', accept: 'application/json' }) ||
      typeof body !== 'string' || observed.requestBytes !== Buffer.byteLength(body, 'utf8') ||
      observed.requestBytes > config.maxRequestBytes || observed.requestSha256 !== sha256Text(body)) fail('LIVE_REQUEST_OBSERVATION_MISMATCH');
  const parsed = strictJSON(body);
  let system, user;
  if (native) {
    exact(parsed, ['model','input','system_prompt','integrations','stream','temperature','max_output_tokens','reasoning','store'], 'LIVE_REQUEST_BODY_SCHEMA');
    if (parsed.max_output_tokens !== config.maxOutputTokens || parsed.reasoning !== 'off' || parsed.store !== false ||
        !same(parsed.integrations, [])) fail('LIVE_REQUEST_CONTROLS');
    system = parsed.system_prompt; user = parsed.input;
  } else {
    exact(parsed, ['model','stream','temperature','max_tokens','messages', ...(selection.outputMode === 'json_schema' ? ['response_format'] : [])], 'LIVE_REQUEST_BODY_SCHEMA');
    if (parsed.max_tokens !== config.maxOutputTokens || (selection.outputMode === 'json_schema' &&
        !same(parsed.response_format, responseFormat(p.task, operation)))) fail('LIVE_REQUEST_CONTROLS');
    if (!Array.isArray(parsed.messages) || parsed.messages.length !== 2) fail('LIVE_REQUEST_MESSAGES');
    for (const message of parsed.messages) exact(message, ['role','content'], 'LIVE_REQUEST_MESSAGES');
    if (parsed.messages[0].role !== 'system' || parsed.messages[1].role !== 'user') fail('LIVE_REQUEST_MESSAGES');
    system = parsed.messages[0].content; user = parsed.messages[1].content;
  }
  if (parsed.model !== selection.model || parsed.stream !== false || parsed.temperature !== 0 ||
      Object.is(parsed.temperature, -0) || typeof system !== 'string' || typeof user !== 'string') fail('LIVE_REQUEST_CONTROLS');
  const expectedSystemHash = role === 'author' ? treatment.expectedSystemPromptSha256 : reviewPins[selection.api];
  if (sha256Text(system) !== expectedSystemHash) fail('LIVE_REQUEST_SYSTEM_PROMPT');
  const expectedUser = { schemaVersion: 1, operation, task: p.task, candidate: p.candidate,
    acceptanceCriteria: p.acceptanceCriteria, checks: p.checks ?? null, tests: p.tests ?? null, stages: p.stages ?? null };
  if (!same(strictJSON(user), expectedUser) || user !== JSON.stringify(expectedUser)) fail('LIVE_REQUEST_PAYLOAD');
  const expectedBody = native ? { model: selection.model, input: user, system_prompt: system,
    integrations: [], stream: false, temperature: 0, max_output_tokens: config.maxOutputTokens, reasoning: 'off', store: false }
    : { model: selection.model, stream: false, temperature: 0, max_tokens: config.maxOutputTokens,
      ...(selection.outputMode === 'json_schema' ? { response_format: responseFormat(p.task, operation) } : {}),
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
  if (body !== JSON.stringify(expectedBody)) fail('LIVE_REQUEST_WIRE_BYTES');
  return { requestSha256: observed.requestSha256, requestBytes: observed.requestBytes, systemPromptSha256: expectedSystemHash };
}

export function inspectIssuedLiveModelRequestsV4(input) {
  exact(input, ['lane'], 'LIVE_REQUEST_CONTEXT');
  const { suite, preparations, treatment: original, invocations, requestObservations, snapshot: lane } = readIssuedLiveModelLaneV4(input.lane);
  const config = lane.configuration, treatment = readRepairGuidanceV1(original, config.author.api);
  if (!same(config.treatment, treatment) || config.arm !== treatment.arm || !same(treatment.binding, {
    taskFingerprint: preparations[0].taskFingerprint, baselineFingerprint: preparations[0].baselineFingerprint,
    suiteFingerprint: suite.fingerprint, reviewedSourceFingerprint: config.reviewedSourceFingerprint })) fail('LIVE_REQUEST_TREATMENT_BINDING');
  if (invocations.length > 2 || requestObservations.length > 2 ||
      new Set(invocations.map(item => item.role)).size !== invocations.length ||
      new Set(requestObservations.map(item => item.role)).size !== requestObservations.length) fail('LIVE_REQUEST_INVENTORY');
  const calls = [], reasons = [];
  for (const role of ['author','reviewer']) {
    const invocation = invocations.find(item => item.role === role), observations = requestObservations.filter(item => item.role === role);
    const receipts = lane[role + 'Receipts'];
    if (observations.length > 1 || receipts.length > 1 || (!invocation && (observations.length || receipts.length))) fail('LIVE_REQUEST_INVENTORY');
    if (!invocation) continue;
    const operation = role === 'author' ? 'repair' : 'review', p = invocation.payload;
    const preparation = preparations[role === 'author' ? 0 : 1];
    if (invocation.operation !== operation || !same(invocation.binding, { schemaVersion: 1, runId: lane.runId, taskFingerprint: config.taskFingerprint,
          attempt: 1, candidateFingerprint: preparation.candidateFingerprint })) fail('LIVE_REQUEST_INVOCATION');
    const observed = observations[0], receipt = receipts[0];
    if (observed ? (!p || !same(p.binding, invocation.binding) || !same(p.task, preparation.task) ||
        !same(p.candidate, preparation.candidate) || !same(p.acceptanceCriteria, preparation.task.acceptanceCriteria))
      : p !== null) fail('LIVE_REQUEST_INVOCATION');
    const details = observed ? inspectRequest(observed, invocation, config, treatment) : null;
    if (!receipt) reasons.push('ADAPTER_RESULT_PENDING');
    else {
      if (receipt.schemaVersion !== config[role].adapterReceiptVersion || receipt.operation !== operation ||
          receipt.adapterId !== config[role + 'Id'] || receipt.requestedModel !== config[role].model ||
          receipt.requestedMaxOutputTokens !== config.maxOutputTokens || receipt.runId !== lane.runId ||
          receipt.taskFingerprint !== config.taskFingerprint || receipt.attempt !== 1 ||
          receipt.inputCandidateFingerprint !== preparation.candidateFingerprint) fail('LIVE_REQUEST_RECEIPT_BINDING');
      if (role === 'author') {
        const expectedPrompt = observed ? details.systemPromptSha256 : receipt.treatment?.systemPromptSha256;
        if (!same(receipt.treatment, repairGuidanceReceiptV1(treatment, expectedPrompt, Boolean(observed))))
          fail('LIVE_REQUEST_TREATMENT_RECEIPT');
      } else if (Object.hasOwn(receipt, 'treatment')) fail('LIVE_REQUEST_REVIEWER_TREATMENT');
      if (observed && receipt.requestSha256 !== details.requestSha256) fail('LIVE_REQUEST_RECEIPT_HASH');
      if (!observed && (receipt.status !== 'UNAVAILABLE' || receipt.lifecycle.transportSettlement !== 'NOT_STARTED')) fail('LIVE_REQUEST_DISPATCH_MISMATCH');
      if (observed && receipt.lifecycle.transportSettlement === 'NOT_STARTED') fail('LIVE_REQUEST_DISPATCH_MISMATCH');
      if (receipt.status !== 'RESPONSE_VALIDATED' || receipt.lifecycle.transportSettlement !== 'CONFIRMED') reasons.push('ADAPTER_RESULT_INCOMPLETE');
    }
    calls.push({ role, operation, binding: invocation.binding, ...(details ?? { requestSha256: null, requestBytes: null, systemPromptSha256: null }),
      observation: observed ? 'LOCAL_TRANSPORT_INVOKED' : 'NOT_OBSERVED', receiptStatus: receipt?.status ?? null,
      transportSettlement: receipt?.lifecycle.transportSettlement ?? 'UNKNOWN' });
  }
  if (!invocations.length) reasons.push('NO_MODEL_INVOCATION');
  return cloneFreeze({ schemaVersion: 'nisi-live-model-request-inspection-v4', status: reasons.length ? 'INCOMPLETE' : 'CONSISTENT',
    reasons: [...new Set(reasons)], runId: lane.runId, arm: config.arm, treatmentFingerprint: treatment.fingerprint, calls,
    source: 'ORIGINAL_ISSUED_LANE', consistencyOnly: true, providerDeliveryAttested: false, modelUseAttested: false,
    repositoryRunValidated: false, executionAttested: false, authorizing: false, promotionEligible: false, measurementVerified: false });
}
