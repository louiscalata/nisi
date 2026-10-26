// Pure, fixed experimental guidance. Registration is configuration, not consent,
// source review, execution admission, effectiveness or model-use attestation.
// Leaf dependency: never import a transport, repository fixture or host here.
import { cloneFreeze, createTaskSpecification, stableStringify, sha256Text,
  validateCandidateForTask } from '../workflow/contracts.mjs';
const issued = new WeakSet();
const fail = code => { throw Object.assign(Error(code), { code }); };
const digest = value => sha256Text('nisi/repair-guidance/v1\0' + stableStringify(value));
const pins = Object.freeze({
  CHAT_COMPLETIONS: Object.freeze({ base: 'b08580d6d29f90dd62ed705c108052f22b222e69f430dd20b3ee8e4194b1ed1f',
    on: 'a1f82c1fc64e78de9aaaf79bf229fbb798de895174bad08a990bb3d2cb82ee0b' }),
  NATIVE_API: Object.freeze({ base: 'fc5d0dc8883e32afbe5b8ad27d9aad6be4fd5e4e6e5609ee2b8fe7b049edb119',
    on: 'bc7335389b8242ff74e60f9fee24d0dd0c1c0b33b4a0b7cff805b1555e9ddaa5' }),
});
const suffix = '\n\nBefore editing, check defaulting and control-flow behavior against the supplied requirements. Preserve explicit valid inputs; distinguish missing values from valid falsy values where the requirements call for it. Use the failed-stage evidence to make the smallest justified correction.';
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) fail('GUIDANCE_SCHEMA');
}
export function registerRepairGuidanceV1(input) {
  const v = cloneFreeze(input); exact(v, ['arm', 'api', 'binding']);
  if (!['OFF', 'ON'].includes(v.arm) || !Object.hasOwn(pins, v.api)) fail('GUIDANCE_SELECTION');
  exact(v.binding, ['taskFingerprint', 'baselineFingerprint', 'suiteFingerprint', 'reviewedSourceFingerprint']);
  for (const h of Object.values(v.binding)) if (typeof h !== 'string' || h.length !== 64 || !/^[a-f0-9]{64}$/.test(h)) fail('GUIDANCE_BINDING');
  const identity = { schemaVersion: 'nisi-repair-guidance-v1', version: 'nisi-general-repair-guidance-1',
    arm: v.arm, api: v.api, binding: v.binding, applicationPoint: 'AUTHOR_REPAIR_SYSTEM_PROMPT_SUFFIX_V1',
    suffix: v.arm === 'ON' ? suffix : '', suffixSha256: sha256Text(v.arm === 'ON' ? suffix : ''),
    baseSystemPromptSha256: pins[v.api].base, expectedSystemPromptSha256: pins[v.api][v.arm === 'ON' ? 'on' : 'base'],
    independenceAttested: false, measurementVerified: false, authorizing: false, promotionEligible: false };
  const registration = cloneFreeze({ ...identity, fingerprint: digest(identity) }); issued.add(registration); return registration;
}
export function readRepairGuidanceV1(registration, api) {
  if (!issued.has(registration)) fail('GUIDANCE_NOT_ISSUED');
  if (registration.api !== api) fail('GUIDANCE_API');
  return registration;
}
export function resolveRepairGuidanceV1(registration, api, baseInstruction, task) {
  const r = readRepairGuidanceV1(registration, api);
  const taskFingerprint = sha256Text('nisi/workflow-task/v1\0' + stableStringify(createTaskSpecification(task)));
  if (taskFingerprint !== r.binding.taskFingerprint) fail('GUIDANCE_TASK');
  if (typeof baseInstruction !== 'string' || sha256Text(baseInstruction) !== r.baseSystemPromptSha256) fail('GUIDANCE_BASE_PROMPT');
  const systemPrompt = baseInstruction + r.suffix;
  if (sha256Text(systemPrompt) !== r.expectedSystemPromptSha256) fail('GUIDANCE_FINAL_PROMPT');
  return systemPrompt;
}
// Snapshot the guided local-chat payload before any await. Native chat already
// has an equivalent strict snapshot; legacy local-chat behavior stays unchanged.
export function snapshotGuidedRepairPayloadV1(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) fail('GUIDANCE_PAYLOAD');
  const data = {}, descriptors = Object.getOwnPropertyDescriptors(raw);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (!['task', 'candidate', 'acceptanceCriteria', 'binding', 'signal', 'checks', 'tests', 'stages', 'reviewerId'].includes(key) ||
        !Object.hasOwn(descriptors[key], 'value') || !descriptors[key].enumerable) fail('GUIDANCE_PAYLOAD');
    if (key !== 'signal') data[key] = descriptors[key].value;
  }
  const signal = descriptors.signal?.value;
  if (signal !== undefined && !(signal instanceof AbortSignal)) fail('GUIDANCE_PAYLOAD');
  const p = cloneFreeze(data), task = createTaskSpecification(p.task), b = p.binding;
  exact(b, ['schemaVersion', 'runId', 'taskFingerprint', 'attempt', 'candidateFingerprint']);
  if (b.schemaVersion !== 1 || typeof b.runId !== 'string' || !b.runId.trim() || b.runId.length > 128 || !b.runId.isWellFormed() ||
      !Number.isSafeInteger(b.attempt) || b.attempt < 1 || task.mode !== 'edit' ||
      b.taskFingerprint !== sha256Text('nisi/workflow-task/v1\0' + stableStringify(task)) ||
      stableStringify(p.acceptanceCriteria) !== stableStringify(task.acceptanceCriteria)) fail('GUIDANCE_PAYLOAD_BINDING');
  const c = p.candidate && validateCandidateForTask({ files: p.candidate.files }, task, p.candidate.authorId);
  if (!c || stableStringify(c) !== stableStringify(p.candidate) || c.fingerprint !== b.candidateFingerprint) fail('GUIDANCE_PAYLOAD_BINDING');
  return Object.freeze({ ...p, ...(signal !== undefined ? { signal } : {}) });
}
export function repairGuidanceReceiptV1(registration, systemPromptSha256, sent) {
  if (!issued.has(registration)) fail('GUIDANCE_NOT_ISSUED');
  if (![null, registration.expectedSystemPromptSha256].includes(systemPromptSha256) || typeof sent !== 'boolean' ||
      (sent && systemPromptSha256 === null)) fail('GUIDANCE_RECEIPT');
  return cloneFreeze({ treatmentFingerprint: registration.fingerprint, arm: registration.arm,
    applicationPoint: registration.applicationPoint, baseSystemPromptSha256: registration.baseSystemPromptSha256,
    systemPromptSha256, dispatch: sent ? 'LOCAL_FETCH_INVOKED' : 'NOT_DISPATCHED', modelUseAttested: false });
}
