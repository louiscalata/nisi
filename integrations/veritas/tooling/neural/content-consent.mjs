// The consent boundary for packet-specific content.
//
// Until now nothing the caller supplied ever reached the model: the dispatcher
// ran one fixed, reviewed experiment. This module is the gate that lets real
// content through, and it is deliberately a gate rather than a flag.
//
// A grant is an explicit, canonical, digest-bound declaration of exactly what
// may be sent, from where, how much, for how long, and what may come back. Every
// content item is checked against it individually. Revocation is immediate and
// terminal. Absence of a grant is refusal, never a default.
//
// Honesty about what a grant is and is not: this record proves that a founder-
// authored declaration was presented and enforced. It is NOT captured user-
// interface consent, and it cannot prove a real launcher event or an OS-issued
// user action — the design document is explicit that a local wrapper cannot.
// `consentClass` records which of the two it is, so no reader can conflate them.
//
// The destination is the on-device Apple model. SystemLanguageModel is the local
// model; PrivateCloudComputeLanguageModel is a separate class this path never
// constructs, so a grant here authorises no network egress of content.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalizeMAC1JSONV1 } from '../canonical/mac1-json-v1.mjs';

const FLAGS = Object.freeze({ authorizing: false, modelExecuted: false,
  promotionGranted: false, certificationGranted: false });
const answer = (ok, code, fields = {}) => Object.freeze({ ...fields, ok, code, ...FLAGS });
const fail = (code, fields = {}) => answer(false, code, fields);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => canonicalizeMAC1JSONV1(Buffer.from(JSON.stringify(value), 'utf8')).canonical;
const isInt = (v, min, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && v >= min && v <= max;
const isID = v => typeof v === 'string' && v.length >= 1 && v.length <= 96 && /^[a-z][a-z0-9_.-]*$/.test(v);

export const CONTENT_CONSENT_LIMITS = Object.freeze({
  maxContentBytes: 65536,     // one artifact, bounded
  maxAdvisoryChars: 2048,     // bounded text may come back
  maxLifetimeMs: 3600000,     // a grant cannot outlive an hour
});

export const ALLOWED_CONTENT_KINDS = Object.freeze(['json', 'markdown', 'text']);

const GRANT_KEYS = ['kind', 'schemaVersion', 'generation', 'grantId', 'consentClass',
  'scopeRoot', 'allowedKinds', 'maxContentBytes', 'maxAdvisoryChars', 'lifetimeMs',
  'destination', 'networkEgress', 'contentPersisted', 'transcriptPersisted'];

/** The two things a grant can be. Nothing may report the weaker as the stronger. */
export const CONSENT_CLASSES = Object.freeze([
  'FOUNDER_AUTHORED_DECLARATION',   // what this module can actually witness
  'CAPTURED_USER_INTERFACE_ACTION', // reserved; no code path issues it yet
]);

function grantValid(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  if (Object.keys(v).sort().join('|') !== [...GRANT_KEYS].sort().join('|')) return false;
  if (v.kind !== 'veritas-content-consent-v1' || v.schemaVersion !== 1) return false;
  if (!isInt(v.generation, 1) || !isID(v.grantId)) return false;
  if (v.consentClass !== 'FOUNDER_AUTHORED_DECLARATION') return false;
  if (typeof v.scopeRoot !== 'string' || !path.isAbsolute(v.scopeRoot) || v.scopeRoot.length > 1024) return false;
  if (!Array.isArray(v.allowedKinds) || v.allowedKinds.length === 0) return false;
  if (!v.allowedKinds.every(k => ALLOWED_CONTENT_KINDS.includes(k))) return false;
  if (new Set(v.allowedKinds).size !== v.allowedKinds.length) return false;
  if (!isInt(v.maxContentBytes, 1, CONTENT_CONSENT_LIMITS.maxContentBytes)) return false;
  if (!isInt(v.maxAdvisoryChars, 0, CONTENT_CONSENT_LIMITS.maxAdvisoryChars)) return false;
  if (!isInt(v.lifetimeMs, 1, CONTENT_CONSENT_LIMITS.maxLifetimeMs)) return false;
  // These four are the boundary itself and are not negotiable per grant.
  if (v.destination !== 'ON_DEVICE_APPLE_FOUNDATION_MODELS_ONLY') return false;
  if (v.networkEgress !== false || v.contentPersisted !== false || v.transcriptPersisted !== false) return false;
  return true;
}

class ContentConsentGrant {
  #value; #digest; #clock; #issuedAtMs; #revoked = false; #admitted = 0;

  constructor(value, digest, clock, issuedAtMs) {
    this.#value = Object.freeze({ ...value, allowedKinds: Object.freeze([...value.allowedKinds]) });
    this.#digest = digest;
    this.#clock = clock;
    this.#issuedAtMs = issuedAtMs;
  }

  get digest() { return this.#digest; }

  #live() {
    if (this.#revoked) return 'CONSENT_REVOKED';
    const now = this.#clock();
    if (!isInt(now, 0)) return 'CONSENT_CLOCK_INVALID';
    if (now < this.#issuedAtMs) return 'CONSENT_CLOCK_REGRESSION';
    if (now >= this.#issuedAtMs + this.#value.lifetimeMs) return 'CONSENT_EXPIRED';
    return null;
  }

  /** Checks one concrete content item against the grant and, when it passes,
   *  returns the exact bytes that may be sent. Reads the file itself so no
   *  caller can present bytes that differ from what the path holds. */
  admitContent(item) {
    const notLive = this.#live();
    if (notLive) return fail(notLive);
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return fail('CONTENT_ITEM_INVALID');
    if (Object.keys(item).sort().join('|') !== 'filePath|kind') return fail('CONTENT_ITEM_INVALID');
    const { filePath, kind } = item;
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) return fail('CONTENT_PATH_INVALID');
    if (!this.#value.allowedKinds.includes(kind)) return fail('CONTENT_KIND_REFUSED');

    // Resolve symlinks before the scope test: a link inside the approved root
    // that points outside it must not smuggle content past the boundary.
    let resolved, rootResolved;
    try {
      resolved = fs.realpathSync(filePath);
      rootResolved = fs.realpathSync(this.#value.scopeRoot);
    } catch { return fail('CONTENT_PATH_UNRESOLVABLE'); }
    const prefix = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep;
    if (!resolved.startsWith(prefix)) return fail('CONTENT_OUT_OF_SCOPE');

    let stat;
    try { stat = fs.lstatSync(resolved); } catch { return fail('CONTENT_PATH_UNRESOLVABLE'); }
    if (!stat.isFile()) return fail('CONTENT_NOT_REGULAR_FILE');
    if (stat.size === 0) return fail('CONTENT_EMPTY');
    if (stat.size > this.#value.maxContentBytes) {
      return fail('CONTENT_BYTE_LIMIT', { bytes: stat.size, maximum: this.#value.maxContentBytes });
    }

    let bytes;
    try { bytes = fs.readFileSync(resolved); } catch { return fail('CONTENT_UNREADABLE'); }
    if (bytes.length !== stat.size) return fail('CONTENT_CHANGED_DURING_READ');
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { return fail('CONTENT_NOT_UTF8'); }

    this.#admitted += 1;
    return answer(true, 'CONTENT_ADMITTED', {
      bytes,
      contentSha256: sha(bytes),
      contentBytes: bytes.length,
      kind,
      consentDigest: this.#digest,
      maxAdvisoryChars: this.#value.maxAdvisoryChars,
    });
  }

  /** Immediate and terminal. A revoked grant admits nothing further. */
  revoke() {
    this.#revoked = true;
    return answer(true, 'CONSENT_REVOKED_BY_HOLDER');
  }

  status() {
    return answer(true, 'CONTENT_CONSENT_STATUS', {
      grantId: this.#value.grantId,
      consentClass: this.#value.consentClass,
      consentDigest: this.#digest,
      destination: this.#value.destination,
      networkEgress: false,
      admittedItems: this.#admitted,
      live: this.#live() === null,
      refusalIfNotLive: this.#live(),
    });
  }
}

/** Binds one canonical consent grant. Absence of a valid grant is refusal. */
export function createContentConsent(grantBytes, options) {
  try {
    const config = options && typeof options === 'object' && !Array.isArray(options) ? options : null;
    if (!config || Object.keys(config).some(k => k !== 'clock')) return fail('CONFIGURATION_REFUSED');
    const { clock } = config;
    if (typeof clock !== 'function') return fail('CONFIGURATION_REFUSED');
    if (!Buffer.isBuffer(grantBytes) || grantBytes.length === 0 || grantBytes.length > 8192) {
      return fail('CONSENT_BYTES_REFUSED');
    }
    if (grantBytes.buffer instanceof SharedArrayBuffer) return fail('CONSENT_BYTES_REFUSED');
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(grantBytes); }
    catch { return fail('CONSENT_BYTES_REFUSED'); }
    let value;
    try { value = JSON.parse(canonicalizeMAC1JSONV1(grantBytes).canonical); }
    catch { return fail('CONSENT_NONCANONICAL'); }
    if (canonical(value) !== text) return fail('CONSENT_NONCANONICAL');
    if (!grantValid(value)) return fail('CONSENT_DECLARATION_REFUSED');
    let issuedAtMs;
    try { issuedAtMs = clock(); } catch { return fail('CONSENT_CLOCK_INVALID'); }
    if (!isInt(issuedAtMs, 0)) return fail('CONSENT_CLOCK_INVALID');
    const digest = sha(Buffer.from(`veritas/content-consent/v1\0${text}`, 'utf8'));
    return answer(true, 'READY_PRIVATE_CONTENT_CONSENT_ONLY', {
      grant: new ContentConsentGrant(value, digest, clock, issuedAtMs),
      consentDigest: digest,
    });
  } catch {
    return fail('CONSTRUCTION_ERROR');
  }
}
