import type { Buffer } from 'node:buffer';
import type { AdmittedContent, PolicyRefusal, ContentItem, NonAuthorizingFlags } from './policy.js';
export const APPLE_CONTENT_PROMPT_VERSION: 'nisi/apple-content-prompt/v1';
export interface AppleExecutorOptions {
  readonly binary: string; readonly binarySHA256: string;
  readonly grant: { admitContent(item: ContentItem): AdmittedContent | PolicyRefusal };
  readonly items: Readonly<Record<string, ContentItem>>; readonly timeoutMs?: number;
}
export interface AppleContentEvidence {
  readonly schemaVersion: 1; readonly status: 'PASS'; readonly evidenceClass: 'CONSENTED_CONTENT_ADVISORY_READING';
  readonly consentDigest: string; readonly contentSha256: string; readonly contentBytes: number; readonly kind: string;
  readonly promptSha256: string; readonly advisory: string; readonly advisoryChars: number; readonly advisorySha256: string;
  readonly modelParticipation: 'PARTICIPATED'; readonly modelIdentityStatus: 'MODEL_ID_NOT_EXPOSED_BY_API'; readonly route: 'system-on-device-requested';
  readonly quiescent: true; readonly contentPersisted: false; readonly transcriptPersisted: false; readonly networkEgress: false; readonly externalToolsEnabled: false; readonly acceptanceAuthorityGranted: false;
  readonly limitationCodes: readonly ['ADVISORY_READING_NON_AUTHORIZING', 'NO_ACCEPTANCE_OR_CERTIFICATION'];
}
export interface AppleReading { readonly taskId: string; readonly contentSha256: string; readonly advisory: string; readonly advisoryChars: number; readonly promptSha256: string; readonly promptVersion: typeof APPLE_CONTENT_PROMPT_VERSION; readonly binarySHA256: string; readonly executionSha256: string; readonly evidence: AppleContentEvidence }
export interface AppleContentExecutor extends NonAuthorizingFlags {
  readonly ok: true; readonly code: 'READY_PRIVATE_AFM_CONTENT_EXECUTOR_ONLY'; readonly binarySHA256: string;
  execute(packet: Buffer, context?: { readonly taskId?: string; readonly signal?: AbortSignal }): Promise<{ readonly ok: true; readonly code: 'AFM_PACKET_ANSWERED'; readonly payloadSha256: string } | { readonly ok: false; readonly code: 'AFM_PACKET_UNAVAILABLE'; readonly payloadSha256: string }>;
  status(): 'IDLE' | 'BUSY' | 'QUARANTINED' | 'STOPPED' | 'STOPPED_DRAINING' | 'STOPPED_QUARANTINED';
  stop(): void;
  /** Internal child-observer records are retained but intentionally opaque in this public declaration proposal. */
  observations(): readonly unknown[];
  refusals(): readonly { readonly taskId: string | null; readonly cause: string }[];
  readings(): readonly AppleReading[];
}
export function createAFMContentExecutor(options: AppleExecutorOptions): AppleContentExecutor | PolicyRefusal;
export { createAFMContentExecutor as createAppleFoundationModelsAdapter };
