// PRIVATE installed-package runtime rehearsal. The fetch seams are synthetic;
// this test does not contact a provider or claim model execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as guidance from 'nisi/adapters/repair-guidance';
import * as guidanceDirect from 'nisi/adapters/repair-guidance-v1.mjs';
import * as local from 'nisi/adapters/local-chat';
import * as native from 'nisi/adapters/native-chat';
import { createCandidate, createTaskSpecification, sha256Text, stableStringify } from 'nisi/workflow/contracts.mjs';

const bindingHashes = Object.freeze({
  baselineFingerprint: 'b'.repeat(64),
  suiteFingerprint: 'c'.repeat(64),
  reviewedSourceFingerprint: 'd'.repeat(64),
});
const task = createTaskSpecification({
  taskId: 'repair.guidance.consumer', mode: 'edit', language: 'javascript',
  allowedFiles: ['answer.mjs'], protectedFiles: [], protectedSnapshots: {},
  acceptanceCriteria: ['return the reviewed answer'],
  policy: { repairBudget: 1, totalDeadlineMs: 5000, requiredReviewers: 1, requireReportStore: false },
});
const taskFingerprint = sha256Text(`nisi/workflow-task/v1\0${stableStringify(task)}`);
const baseCandidate = createCandidate({ files: [{ path: 'answer.mjs', content: 'export const answer = 1;' }] }, { authorId: 'author.guided' });
const repairedFiles = { files: [{ path: 'answer.mjs', content: 'export const answer = 2;' }] };
const binding = Object.freeze({ schemaVersion: 1, runId: 'guidance-consumer-run', taskFingerprint,
  attempt: 1, candidateFingerprint: baseCandidate.fingerprint });
const repairPayload = () => ({ task, candidate: baseCandidate, acceptanceCriteria: task.acceptanceCriteria,
  binding, stages: [], signal: new AbortController().signal });

const localEnvelope = () => JSON.stringify({ model: 'synthetic.model', choices: [{ finish_reason: 'stop',
  message: { content: JSON.stringify({ status: 'REPAIRED', candidate: repairedFiles, note: 'synthetic loopback' }) } }],
  usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } });
const nativeEnvelope = () => JSON.stringify({ model_instance_id: 'synthetic.instance', output: [{ type: 'message',
  content: JSON.stringify({ status: 'REPAIRED', candidate: repairedFiles, note: 'synthetic loopback' }) }],
  stats: { input_tokens: 3, total_output_tokens: 4, reasoning_output_tokens: 0,
    tokens_per_second: 10, time_to_first_token_seconds: 0.01 } });

function loopback(responseText, requests) {
  return async (_endpoint, request) => {
    requests.push(JSON.parse(request.body));
    return new Response(responseText(), { headers: { 'content-type': 'application/json' } });
  };
}
function localOptions(fetch) {
  return { destination: 'LOOPBACK_HTTP', endpoint: 'http://127.0.0.1:1234/v1/chat/completions',
    model: 'synthetic.model', id: 'author.guided', fetch };
}
function nativeOptions(fetch) {
  return { destination: 'LOOPBACK_HTTP', endpoint: 'http://127.0.0.1:1234/api/v1/chat',
    model: 'synthetic.model', expectedModelInstance: 'synthetic.instance', id: 'author.guided', reasoning: 'off', fetch };
}
function registration(arm, api) {
  return guidance.registerRepairGuidanceV1({ arm, api, binding: { taskFingerprint, ...bindingHashes } });
}
function receiptFor(adapter) { return adapter.receipts().at(-1); }

function assertTreatment(receipt, arm, schemaVersion) {
  assert.equal(receipt.schemaVersion, schemaVersion);
  assert.equal(receipt.operation, 'repair');
  assert.equal(receipt.treatment.arm, arm);
  assert.equal(receipt.treatment.applicationPoint, 'AUTHOR_REPAIR_SYSTEM_PROMPT_SUFFIX_V1');
  assert.equal(receipt.treatment.dispatch, 'LOCAL_FETCH_INVOKED');
  assert.equal(receipt.treatment.modelUseAttested, false);
  assert.equal(typeof receipt.treatment.treatmentFingerprint, 'string');
}

test('guidance aliases agree and local guided OFF/ON changes only the repair system prompt', async () => {
  assert.equal(guidance.registerRepairGuidanceV1, guidanceDirect.registerRepairGuidanceV1);
  const legacyRequests = [], offRequests = [], onRequests = [];
  const legacy = local.createLocalChatAuthorAdapter(localOptions(loopback(localEnvelope, legacyRequests)));
  const offRegistration = registration('OFF', 'CHAT_COMPLETIONS');
  const onRegistration = registration('ON', 'CHAT_COMPLETIONS');
  const off = local.createLocalChatGuidedAuthorAdapterV1(localOptions(loopback(localEnvelope, offRequests)), offRegistration);
  const on = local.createLocalChatGuidedAuthorAdapterV1(localOptions(loopback(localEnvelope, onRequests)), onRegistration);
  const legacyResult = await legacy.repair(repairPayload());
  const offResult = await off.repair(repairPayload());
  const onResult = await on.repair(repairPayload());
  assert.deepEqual(offResult, legacyResult);
  assert.deepEqual(offRequests[0], legacyRequests[0]);
  assert.equal(receiptFor(legacy).schemaVersion, 1);
  assert.equal(Object.hasOwn(receiptFor(legacy), 'treatment'), false);
  assertTreatment(receiptFor(off), 'OFF', 4);
  assertTreatment(receiptFor(on), 'ON', 4);
  assert.equal(receiptFor(off).treatment.systemPromptSha256, offRegistration.expectedSystemPromptSha256);
  assert.equal(receiptFor(on).treatment.systemPromptSha256, onRegistration.expectedSystemPromptSha256);
  const onBodyWithoutPrompt = structuredClone(onRequests[0]);
  onBodyWithoutPrompt.messages[0].content = offRequests[0].messages[0].content;
  assert.deepEqual(onBodyWithoutPrompt, offRequests[0]);
  assert.equal(onRequests[0].messages[0].content, offRequests[0].messages[0].content + onRegistration.suffix);
  assert.equal(receiptFor(on).treatment.modelUseAttested, false);
});

test('guidance aliases agree and native guided OFF/ON changes only system_prompt', async () => {
  assert.equal(native.createNativeChatGuidedAuthorAdapterV1 instanceof Function, true);
  const legacyRequests = [], offRequests = [], onRequests = [];
  const legacy = native.createNativeChatAuthorAdapterV1(nativeOptions(loopback(nativeEnvelope, legacyRequests)));
  const offRegistration = registration('OFF', 'NATIVE_API');
  const onRegistration = registration('ON', 'NATIVE_API');
  const off = native.createNativeChatGuidedAuthorAdapterV1(nativeOptions(loopback(nativeEnvelope, offRequests)), offRegistration);
  const on = native.createNativeChatGuidedAuthorAdapterV1(nativeOptions(loopback(nativeEnvelope, onRequests)), onRegistration);
  const legacyResult = await legacy.repair(repairPayload());
  const offResult = await off.repair(repairPayload());
  const onResult = await on.repair(repairPayload());
  assert.deepEqual(offResult, legacyResult);
  assert.deepEqual(offRequests[0], legacyRequests[0]);
  assert.equal(receiptFor(legacy).schemaVersion, 'nisi-native-chat-receipt-v1');
  assert.equal(Object.hasOwn(receiptFor(legacy), 'treatment'), false);
  assertTreatment(receiptFor(off), 'OFF', 'nisi-native-chat-guidance-receipt-v1');
  assertTreatment(receiptFor(on), 'ON', 'nisi-native-chat-guidance-receipt-v1');
  assert.equal(receiptFor(off).treatment.systemPromptSha256, offRegistration.expectedSystemPromptSha256);
  assert.equal(receiptFor(on).treatment.systemPromptSha256, onRegistration.expectedSystemPromptSha256);
  const onBodyWithoutPrompt = structuredClone(onRequests[0]);
  onBodyWithoutPrompt.system_prompt = offRequests[0].system_prompt;
  assert.deepEqual(onBodyWithoutPrompt, offRequests[0]);
  assert.equal(onRequests[0].system_prompt, offRequests[0].system_prompt + onRegistration.suffix);
  assert.equal(receiptFor(on).treatment.modelUseAttested, false);
});

test('guided constructors keep draft on the legacy receipt contract', async () => {
  const draftTask = createTaskSpecification({ ...task, taskId: 'repair.guidance.draft' });
  const draftBinding = { schemaVersion: 1, runId: 'guidance-draft-run',
    taskFingerprint: sha256Text(`nisi/workflow-task/v1\0${stableStringify(draftTask)}`), attempt: 0, candidateFingerprint: null };
  const payload = () => ({ task: draftTask, candidate: null, acceptanceCriteria: draftTask.acceptanceCriteria,
    binding: draftBinding, signal: new AbortController().signal });
  const draftFiles = { files: [{ path: 'answer.mjs', content: 'export const answer = 1;' }] };
  const localRequests = [], nativeRequests = [];
  const localAdapter = local.createLocalChatGuidedAuthorAdapterV1(localOptions(async (_url, request) => {
    localRequests.push(JSON.parse(request.body));
    return new Response(JSON.stringify({ model: 'synthetic.model', choices: [{ finish_reason: 'stop',
      message: { content: JSON.stringify({ candidate: draftFiles, note: 'draft' }) } }] }));
  }), registration('ON', 'CHAT_COMPLETIONS'));
  const nativeAdapter = native.createNativeChatGuidedAuthorAdapterV1(nativeOptions(async (_url, request) => {
    nativeRequests.push(JSON.parse(request.body));
    return new Response(JSON.stringify({ model_instance_id: 'synthetic.instance', output: [{ type: 'message',
      content: JSON.stringify({ candidate: draftFiles, note: 'draft' }) }],
      stats: { input_tokens: 3, total_output_tokens: 4, reasoning_output_tokens: 0, tokens_per_second: 10, time_to_first_token_seconds: 0.01 } }));
  }), registration('ON', 'NATIVE_API'));
  await localAdapter.draft(payload());
  await nativeAdapter.draft(payload());
  assert.equal(receiptFor(localAdapter).schemaVersion, 1);
  assert.equal(Object.hasOwn(receiptFor(localAdapter), 'treatment'), false);
  assert.equal(receiptFor(nativeAdapter).schemaVersion, 'nisi-native-chat-receipt-v1');
  assert.equal(Object.hasOwn(receiptFor(nativeAdapter), 'treatment'), false);
  assert.equal(localRequests.length, 1);
  assert.equal(nativeRequests.length, 1);
});
