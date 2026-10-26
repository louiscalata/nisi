import type { RepairPayload, TaskSpecification } from './workflow.js';
export type RepairGuidanceApi = 'CHAT_COMPLETIONS' | 'NATIVE_API';
export type RepairGuidanceArm = 'OFF' | 'ON';
export interface RepairGuidanceBinding {
  readonly taskFingerprint: string; readonly baselineFingerprint: string;
  readonly suiteFingerprint: string; readonly reviewedSourceFingerprint: string;
}
declare const issuedBrand: unique symbol;
/** Original runtime-issued configuration, never an execution grant. */
export interface RepairGuidanceRegistration {
  readonly [issuedBrand]: true;
  readonly schemaVersion: 'nisi-repair-guidance-v1'; readonly version: 'nisi-general-repair-guidance-1';
  readonly arm: RepairGuidanceArm; readonly api: RepairGuidanceApi; readonly binding: RepairGuidanceBinding;
  readonly applicationPoint: 'AUTHOR_REPAIR_SYSTEM_PROMPT_SUFFIX_V1';
  readonly suffix: string; readonly suffixSha256: string; readonly baseSystemPromptSha256: string;
  readonly expectedSystemPromptSha256: string; readonly fingerprint: string;
  readonly independenceAttested: false; readonly measurementVerified: false;
  readonly authorizing: false; readonly promotionEligible: false;
}
export interface RepairGuidanceReceipt {
  readonly treatmentFingerprint: string; readonly arm: RepairGuidanceArm;
  readonly applicationPoint: 'AUTHOR_REPAIR_SYSTEM_PROMPT_SUFFIX_V1';
  readonly baseSystemPromptSha256: string; readonly systemPromptSha256: string | null;
  readonly dispatch: 'LOCAL_FETCH_INVOKED' | 'NOT_DISPATCHED'; readonly modelUseAttested: false;
}
export function registerRepairGuidanceV1(input: { readonly arm: RepairGuidanceArm;
  readonly api: RepairGuidanceApi; readonly binding: RepairGuidanceBinding }): RepairGuidanceRegistration;
export function readRepairGuidanceV1(registration: RepairGuidanceRegistration, api: RepairGuidanceApi): RepairGuidanceRegistration;
export function resolveRepairGuidanceV1(registration: RepairGuidanceRegistration, api: RepairGuidanceApi,
  baseInstruction: string, task: TaskSpecification): string;
export function snapshotGuidedRepairPayloadV1(raw: RepairPayload): RepairPayload;
/** Describes caller-supplied dispatch state; does not attest provider execution. */
export function repairGuidanceReceiptV1(registration: RepairGuidanceRegistration,
  systemPromptSha256: string | null, sent: boolean): RepairGuidanceReceipt;
