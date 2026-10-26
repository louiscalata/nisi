export const CANONICAL_JSON_PROFILE_V1: 'nisi-canonical-json-v1';
export const CANONICAL_JSON_LIMITS_V1: Readonly<{ bytes: 1048576; depth: 128; objectMembers: 4096 }>;
export class CanonicalJSONErrorV1 extends Error { constructor(code: string); code: string }
export interface CanonicalJSONResultV1 { readonly profile: typeof CANONICAL_JSON_PROFILE_V1; readonly canonical: string; readonly sha256: string }
/** Raw nonshared Uint8Array bytes only. Malformed or out-of-profile input throws. */
export function canonicalizeJSONV1(input: Uint8Array): CanonicalJSONResultV1;
export { canonicalizeJSONV1 as canonicalizeJsonV1 };
