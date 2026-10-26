// Compile-only private consumer oracle for the repair-guidance package surface.
// Nothing in this file is executed; the declarations prove the installed types
// preserve branded registration and separate guided receipts from legacy ones.
import { createLocalChatGuidedAuthorAdapterV1 } from 'nisi/adapters/local-chat';
import type {
  LocalChatGuidanceReceipt, LocalChatOptions, LocalChatReceipt,
} from 'nisi/adapters/local-chat';
import { createNativeChatGuidedAuthorAdapterV1 } from 'nisi/adapters/native-chat';
import type {
  NativeChatGuidanceReceipt, NativeChatOptions, NativeChatReceipt,
} from 'nisi/adapters/native-chat';
import {
  registerRepairGuidanceV1, readRepairGuidanceV1,
} from 'nisi/adapters/repair-guidance';
import type {
  RepairGuidanceApi, RepairGuidanceArm, RepairGuidanceBinding,
  RepairGuidanceReceipt, RepairGuidanceRegistration,
} from 'nisi/adapters/repair-guidance';

const binding: RepairGuidanceBinding = {
  taskFingerprint: 'a'.repeat(64),
  baselineFingerprint: 'b'.repeat(64),
  suiteFingerprint: 'c'.repeat(64),
  reviewedSourceFingerprint: 'd'.repeat(64),
};

const localRegistration: RepairGuidanceRegistration = registerRepairGuidanceV1({
  arm: 'OFF', api: 'CHAT_COMPLETIONS', binding,
});
const nativeRegistration: RepairGuidanceRegistration = registerRepairGuidanceV1({
  arm: 'ON', api: 'NATIVE_API', binding,
});
const arm: RepairGuidanceArm = localRegistration.arm;
const api: RepairGuidanceApi = nativeRegistration.api;
const receipt: RepairGuidanceReceipt = {
  treatmentFingerprint: localRegistration.fingerprint,
  arm,
  applicationPoint: 'AUTHOR_REPAIR_SYSTEM_PROMPT_SUFFIX_V1',
  baseSystemPromptSha256: localRegistration.baseSystemPromptSha256,
  systemPromptSha256: null,
  dispatch: 'NOT_DISPATCHED',
  modelUseAttested: false,
};

const localOptions = {} as LocalChatOptions;
const nativeOptions = {} as NativeChatOptions;
const localGuided = createLocalChatGuidedAuthorAdapterV1(localOptions, localRegistration);
const nativeGuided = createNativeChatGuidedAuthorAdapterV1(nativeOptions, nativeRegistration);
const localGuidedReceipts: readonly (LocalChatReceipt | LocalChatGuidanceReceipt)[] = localGuided.receipts();
const nativeGuidedReceipts: readonly (NativeChatReceipt | NativeChatGuidanceReceipt)[] = nativeGuided.receipts();

type LocalGuided = Extract<LocalChatGuidanceReceipt, { readonly schemaVersion: 4 }>;
type NativeGuided = Extract<NativeChatGuidanceReceipt, { readonly schemaVersion: 'nisi-native-chat-guidance-receipt-v1' }>;

function inspectLocal(value: LocalChatReceipt | LocalChatGuidanceReceipt): string | null {
  if (value.schemaVersion !== 4) return value.status === 'UNAVAILABLE' ? value.code : value.reportedModel;
  const treatment: RepairGuidanceReceipt = value.treatment;
  const appliedArm: RepairGuidanceArm = treatment.arm;
  const dispatch: 'LOCAL_FETCH_INVOKED' | 'NOT_DISPATCHED' = treatment.dispatch;
  const noModelUse: false = treatment.modelUseAttested;
  void [appliedArm, dispatch, noModelUse, value.operation, value.elapsedMs];
  return value.status === 'UNAVAILABLE' ? value.code : value.reportedModel;
}

function inspectNative(value: NativeChatReceipt | NativeChatGuidanceReceipt): string | null {
  if (value.schemaVersion !== 'nisi-native-chat-guidance-receipt-v1') {
    return value.status === 'UNAVAILABLE' ? value.code : value.reportedModelInstance;
  }
  const treatment: RepairGuidanceReceipt = value.treatment;
  const appliedArm: RepairGuidanceArm = treatment.arm;
  const dispatch: 'LOCAL_FETCH_INVOKED' | 'NOT_DISPATCHED' = treatment.dispatch;
  const noModelUse: false = treatment.modelUseAttested;
  void [appliedArm, dispatch, noModelUse, value.operation, value.elapsedMs];
  return value.status === 'UNAVAILABLE' ? value.code : value.reportedModelInstance;
}

declare const legacyLocal: LocalChatReceipt;
declare const legacyNative: NativeChatReceipt;
declare const guidedLocal: LocalGuided;
declare const guidedNative: NativeGuided;

// The explicit treatment receipt is not assignable to, or from, a legacy receipt.
// This prevents a guided experiment from being mistaken for an archived legacy run.
// @ts-expect-error legacy local receipt lacks the schema-4 treatment
const legacyAsGuidedLocal: LocalChatGuidanceReceipt = legacyLocal;
// @ts-expect-error guided local receipt has a distinct schema and treatment
const guidedAsLegacyLocal: LocalChatReceipt = guidedLocal;
// @ts-expect-error legacy native receipt lacks the guidance schema and treatment
const legacyAsGuidedNative: NativeChatGuidanceReceipt = legacyNative;
// @ts-expect-error guided native receipt has a distinct schema and treatment
const guidedAsLegacyNative: NativeChatReceipt = guidedNative;

// The input is closed: callers cannot choose an unreviewed arm/API or inject a suffix.
// @ts-expect-error the arm is a fixed two-valued selection
registerRepairGuidanceV1({ arm: 'MAYBE', api: 'CHAT_COMPLETIONS', binding });
// @ts-expect-error only the two reviewed transport APIs are accepted
registerRepairGuidanceV1({ arm: 'OFF', api: 'OPENAI_RESPONSES', binding });
// @ts-expect-error the suffix is fixed by the registered arm, not caller supplied
registerRepairGuidanceV1({ arm: 'ON', api: 'CHAT_COMPLETIONS', binding, suffix: 'extra' });
const unissuedRegistration = { arm: 'OFF' as const, api: 'CHAT_COMPLETIONS' as const, binding };
// @ts-expect-error registration is runtime-issued and branded, not a structural config
createLocalChatGuidedAuthorAdapterV1(localOptions, unissuedRegistration);
// @ts-expect-error the API argument is a closed union
readRepairGuidanceV1(localRegistration, 'UNSUPPORTED_API');

void [api, receipt, localGuidedReceipts, nativeGuidedReceipts, inspectLocal, inspectNative,
  legacyAsGuidedLocal, guidedAsLegacyLocal, legacyAsGuidedNative, guidedAsLegacyNative];
