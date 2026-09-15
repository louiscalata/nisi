import type { Buffer } from 'node:buffer';
export interface NonAuthorizingFlags { readonly authorizing: false; readonly modelExecuted: false; readonly promotionGranted: false; readonly certificationGranted: false }
export interface PolicyRefusal extends NonAuthorizingFlags { readonly ok: false; readonly code: string; readonly bytes?: number; readonly maximum?: number }
export type ContentKind = 'json' | 'markdown' | 'text';
export const CONTENT_CONSENT_LIMITS: Readonly<{ maxContentBytes: 65536; maxAdvisoryChars: 2048; maxLifetimeMs: 3600000 }>;
export const ALLOWED_CONTENT_KINDS: readonly ['json', 'markdown', 'text'];
/** The captured UI class is reserved; this implementation issues written declarations only. */
export const CONSENT_CLASSES: readonly ['WRITTEN_DECLARATION', 'CAPTURED_USER_INTERFACE_ACTION'];
export interface ContentItem { readonly filePath: string; readonly kind: ContentKind }
export interface AdmittedContent extends NonAuthorizingFlags {
  readonly ok: true; readonly code: 'CONTENT_ADMITTED'; readonly bytes: Buffer;
  readonly contentSha256: string; readonly contentBytes: number; readonly kind: ContentKind;
  readonly consentDigest: string; readonly maxAdvisoryChars: number;
}
export interface ContentConsentGrant {
  readonly digest: string;
  admitContent(item: ContentItem): AdmittedContent | PolicyRefusal;
  revoke(): NonAuthorizingFlags & { readonly ok: true; readonly code: 'CONSENT_REVOKED_BY_HOLDER' };
  status(): NonAuthorizingFlags & { readonly ok: true; readonly code: 'CONTENT_CONSENT_STATUS'; readonly grantId: string; readonly consentClass: 'WRITTEN_DECLARATION'; readonly consentDigest: string; readonly destination: 'ON_DEVICE_APPLE_FOUNDATION_MODELS_ONLY'; readonly networkEgress: false; readonly admittedItems: number; readonly live: boolean; readonly refusalIfNotLive: string | null };
}
export interface ContentConsentReady extends NonAuthorizingFlags { readonly ok: true; readonly code: 'READY_PRIVATE_CONTENT_CONSENT_ONLY'; readonly grant: ContentConsentGrant; readonly consentDigest: string }
/** Requires canonical Buffer bytes containing the exact v1 written grant and a supplied clock. */
export function createContentConsent(grantBytes: Buffer, options: { readonly clock: () => number }): ContentConsentReady | PolicyRefusal;
export { createContentConsent as createFileAccessPolicy, CONTENT_CONSENT_LIMITS as FILE_ACCESS_LIMITS };
