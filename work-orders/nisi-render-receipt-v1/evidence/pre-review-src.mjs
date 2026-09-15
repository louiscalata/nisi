import { canonicalizeJSONV1 } from '../../../canonical/canonical-json-v1.mjs';

// PURE-REGION-BEGIN
const RENDER_RECEIPT_PROFILE_V1 = 'nisi-render-receipt-v1';
const RENDER_RECEIPT_LIMITS_V1 = Object.freeze({ checks: 256, idLength: 128, modelLength: 128, textLength: 256 });
const RENDER_RECEIPT_VERDICTS_V1 = Object.freeze(['PASS','VALIDITY_FAIL','QUALITY_FAIL','APRON_STALE','REPLAY']);
const RENDER_RECEIPT_SOURCE_KINDS_V1 = Object.freeze(['worker','journal','assemble']);
const RENDER_RECEIPT_CHECK_KINDS_V1 = Object.freeze(['validity','quality']);
const RENDER_RECEIPT_OUTCOMES_V1 = Object.freeze(['pass','fail','not_run']);
const RENDER_RECEIPT_SCOPES_V1 = Object.freeze(['cell','row','frame']);
const RENDER_RECEIPT_CODES_V1 = Object.freeze([
  'RENDER_RECEIPT_NOT_OBJECT',
  'RENDER_RECEIPT_UNKNOWN_MEMBER',
  'RENDER_RECEIPT_MISSING_MEMBER',
  'RENDER_RECEIPT_SCHEMA_VERSION',
  'RENDER_RECEIPT_PROFILE',
  'RENDER_RECEIPT_ID',
  'RENDER_RECEIPT_IDENTITY',
  'RENDER_RECEIPT_ATTEMPT',
  'RENDER_RECEIPT_SOURCE',
  'RENDER_RECEIPT_CANDIDATE',
  'RENDER_RECEIPT_VERDICT',
  'RENDER_RECEIPT_CHECKS',
  'RENDER_RECEIPT_REVIEWER',
  'RENDER_RECEIPT_ELAPSED',
  'RENDER_RECEIPT_TOKENS',
  'RENDER_RECEIPT_CONSISTENCY'
]);

const ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256_REGEX = /^[0-9a-f]{64}$/;
const CODE_REGEX = /^[A-Z][A-Z0-9_]{0,63}$/;

function own(o, k) {
  return Object.prototype.hasOwnProperty.call(o, k);
}

function plain(x) {
  return typeof x === 'object' && x !== null && (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null);
}

function isId(s) {
  return typeof s === 'string' && ID_REGEX.test(s);
}

function isDigest(s) {
  return typeof s === 'string' && SHA256_REGEX.test(s);
}

function isCode(s) {
  return typeof s === 'string' && CODE_REGEX.test(s);
}

function isInt(n) {
  return Number.isSafeInteger(n) && n >= 0 && !Object.is(n, -0);
}

function isText(s) {
  return typeof s === 'string' && s.length <= RENDER_RECEIPT_LIMITS_V1.textLength;
}

function isMeasure(v) {
  return v === null || (typeof v === 'number' && Number.isFinite(v)) || isText(v);
}

function deepFreeze(o) {
  if (o === null || typeof o !== 'object') return o;
  if (Object.isFrozen(o)) return o;
  Object.freeze(o);
  for (const k of Object.getOwnPropertyNames(o)) {
    const v = o[k];
    if (typeof v === 'object' && v !== null) deepFreeze(v);
  }
  return o;
}

function copy(o) {
  if (!plain(o)) return o;
  const r = {};
  for (const k of Object.keys(o)) {
    r[k] = copy(o[k]);
  }
  return r;
}

function readRenderReceiptV1(input) {
  const profile = RENDER_RECEIPT_PROFILE_V1;
  const limits = RENDER_RECEIPT_LIMITS_V1;

  // Not a plain object
  if (!plain(input)) {
    return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_NOT_OBJECT', path: '$' });
  }

  // Known members
  const knownRootMembers = ['schemaVersion','profile','tileId','identity','attempt','source','candidate','verdict','checks','reviewer','elapsedMs','tokens'];
  for (const k of Object.keys(input)) {
    if (!knownRootMembers.includes(k)) {
      return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_UNKNOWN_MEMBER', path: '$.' + k });
    }
  }

  // Missing root members
  for (const k of knownRootMembers) {
    if (!own(input, k)) {
      return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_MISSING_MEMBER', path: '$.' + k });
    }
  }

  // schemaVersion
  if (input.schemaVersion !== 1) {
    return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_SCHEMA_VERSION', path: '$.schemaVersion' });
  }

  // profile
  if (input.profile !== profile) {
    return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_PROFILE', path: '$.profile' });
  }

  // tileId
  if (!isId(input.tileId)) {
    return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_ID', path: '$.tileId' });
  }

  // identity
  if (!isDigest(input.identity)) {
    return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_IDENTITY', path: '$.identity' });
  }

  // attempt
  if (!isInt(input.attempt)) {
    return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_ATTEMPT', path: '$.attempt' });
  }

  // source
  if (!plain(input.source)) {
    return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_SOURCE', path: '$.source' });
  }
  const sourceKnownMembers = ['kind','id','model','block'];
  for (const k of Object.keys(input.source)) {
    if (!sourceKnownMembers.includes(k)) {
      return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_UNKNOWN_MEMBER', path: '$.source.' + k });
    }
  }
  for (const k of sourceKnownMembers) {
    if (!own(input.source, k)) {
      return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_MISSING_MEMBER', path: '$.source.' + k });
    }
  }
  if (!RENDER_RECEIPT_SOURCE_KINDS_V1.includes(input.source.kind)) {
    return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_SOURCE', path: '$.source.kind' });
  }
  if (input.source.id !== null && !isId(input.source.id)) {
    return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_SOURCE', path: '$.source.id' });
  }
  if (input.source.model !== null) {
    if (typeof input.source.model !== 'string' || input.source.model.length === 0 || input.source.model.length > limits.modelLength) {
      return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_SOURCE', path: '$.source.model' });
    }
  }
  if (input.source.block !== null && !isId(input.source.block)) {
    return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_SOURCE', path: '$.source.block' });
  }

  // candidate
  if (input.candidate !== null && !isDigest(input.candidate)) {
    return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_CANDIDATE', path: '$.candidate' });
  }

  // verdict
  if (!RENDER_RECEIPT_VERDICTS_V1.includes(input.verdict)) {
    return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_VERDICT', path: '$.verdict' });
  }

  // checks
  if (!Array.isArray(input.checks)) {
    return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_CHECKS', path: '$.checks' });
  }
  if (input.checks.length > limits.checks) {
    return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_CHECKS', path: '$.checks' });
  }
  const seenCheckIds = new Set();
  for (let i = 0; i < input.checks.length; i++) {
    const c = input.checks[i];
    if (!plain(c)) {
      return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_CHECKS', path: '$.checks[' + i + ']' });
    }
    const checkKnownMembers = ['checkId','kind','outcome','measured','threshold','scope','code'];
    for (const k of Object.keys(c)) {
      if (!checkKnownMembers.includes(k)) {
        return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_UNKNOWN_MEMBER', path: '$.checks[' + i + '].' + k });
      }
    }
    for (const k of checkKnownMembers) {
      if (!own(c, k)) {
        return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_MISSING_MEMBER', path: '$.checks[' + i + '].' + k });
      }
    }
    if (!isId(c.checkId)) {
      return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_CHECKS', path: '$.checks[' + i + '].checkId' });
    }
    if (seenCheckIds.has(c.checkId)) {
      return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_CHECKS', path: '$.checks[' + i + '].checkId' });
    }
    seenCheckIds.add(c.checkId);
    if (!RENDER_RECEIPT_CHECK_KINDS_V1.includes(c.kind)) {
      return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_CHECKS', path: '$.checks[' + i + '].kind' });
    }
    if (!RENDER_RECEIPT_OUTCOMES_V1.includes(c.outcome)) {
      return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_CHECKS', path: '$.checks[' + i + '].outcome' });
    }
    if (!isMeasure(c.measured)) {
      return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_CHECKS', path: '$.checks[' + i + '].measured' });
    }
    if (!isMeasure(c.threshold)) {
      return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_CHECKS', path: '$.checks[' + i + '].threshold' });
    }
    if (!RENDER_RECEIPT_SCOPES_V1.includes(c.scope)) {
      return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_CHECKS', path: '$.checks[' + i + '].scope' });
    }
    if (c.code !== null && !isCode(c.code)) {
      return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_CHECKS', path: '$.checks[' + i + '].code' });
    }
    if (c.outcome === 'fail' && c.code === null) {
      return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_CHECKS', path: '$.checks[' + i + '].code' });
    }
  }

  // reviewer
  if (input.reviewer !== null) {
    if (!plain(input.reviewer)) {
      return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_REVIEWER', path: '$.reviewer' });
    }
    const reviewerKnownMembers = ['id','model'];
    for (const k of Object.keys(input.reviewer)) {
      if (!reviewerKnownMembers.includes(k)) {
        return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_UNKNOWN_MEMBER', path: '$.reviewer.' + k });
      }
    }
    for (const k of reviewerKnownMembers) {
      if (!own(input.reviewer, k)) {
        return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_MISSING_MEMBER', path: '$.reviewer.' + k });
      }
    }
    if (!isId(input.reviewer.id)) {
      return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_REVIEWER', path: '$.reviewer.id' });
    }
    if (input.reviewer.model !== null) {
      if (typeof input.reviewer.model !== 'string' || input.reviewer.model.length === 0 || input.reviewer.model.length > limits.modelLength) {
        return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_REVIEWER', path: '$.reviewer.model' });
      }
    }
  }

  // elapsedMs
  if (!isInt(input.elapsedMs)) {
    return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_ELAPSED', path: '$.elapsedMs' });
  }

  // tokens
  if (input.tokens !== null && !isInt(input.tokens)) {
    return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_TOKENS', path: '$.tokens' });
  }

  // Consistency rules
  // 1. source.kind "worker" requires source.id non-null; others require null
  if (input.source.kind === 'worker' && input.source.id === null) {
    return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_CONSISTENCY', path: '$.source.id' });
  }
  if ((input.source.kind === 'journal' || input.source.kind === 'assemble') && input.source.id !== null) {
    return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_CONSISTENCY', path: '$.source.id' });
  }

  // 2. verdict "REPLAY" requires source.kind "journal"; others require not "journal"
  if (input.verdict === 'REPLAY' && input.source.kind !== 'journal') {
    return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_CONSISTENCY', path: '$.source.kind' });
  }
  if (input.verdict !== 'REPLAY' && input.source.kind === 'journal') {
    return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_CONSISTENCY', path: '$.source.kind' });
  }

  // 3. "REPLAY" requires checks empty and reviewer null
  if (input.verdict === 'REPLAY') {
    if (input.checks.length !== 0) {
      return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_CONSISTENCY', path: '$.checks' });
    }
    if (input.reviewer !== null) {
      return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_CONSISTENCY', path: '$.reviewer' });
    }
  }

  // 4. "APRON_STALE" requires checks empty and reviewer null
  if (input.verdict === 'APRON_STALE') {
    if (input.checks.length !== 0) {
      return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_CONSISTENCY', path: '$.checks' });
    }
    if (input.reviewer !== null) {
      return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_CONSISTENCY', path: '$.reviewer' });
    }
  }

  // 5. "PASS" and "REPLAY" require candidate non-null
  if ((input.verdict === 'PASS' || input.verdict === 'REPLAY') && input.candidate === null) {
    return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_CONSISTENCY', path: '$.candidate' });
  }

  // 6. "PASS" requires reviewer non-null, reviewer.id differs from source.id, at least one validity pass, at least one quality pass, no fail
  if (input.verdict === 'PASS') {
    if (input.reviewer === null) {
      return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_CONSISTENCY', path: '$.reviewer' });
    }
    if (input.reviewer.id === input.source.id) {
      return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_CONSISTENCY', path: '$.reviewer.id' });
    }
    let hasValidityPass = false, hasQualityPass = false, hasFail = false;
    for (const c of input.checks) {
      if (c.outcome === 'fail') hasFail = true;
      if (c.kind === 'validity' && c.outcome === 'pass') hasValidityPass = true;
      if (c.kind === 'quality' && c.outcome === 'pass') hasQualityPass = true;
    }
    if (hasFail) {
      return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_CONSISTENCY', path: '$.checks' });
    }
    if (!hasValidityPass || !hasQualityPass) {
      return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_CONSISTENCY', path: '$.checks' });
    }
  }

  // 7. "VALIDITY_FAIL" requires at least one validity check with outcome "fail"
  if (input.verdict === 'VALIDITY_FAIL') {
    let hasValidityFail = false;
    for (const c of input.checks) {
      if (c.kind === 'validity' && c.outcome === 'fail') {
        hasValidityFail = true;
        break;
      }
    }
    if (!hasValidityFail) {
      return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_CONSISTENCY', path: '$.checks' });
    }
  }

  // 8. "QUALITY_FAIL" requires no validity fail, at least one quality fail, reviewer non-null, reviewer.id differs from source.id
  if (input.verdict === 'QUALITY_FAIL') {
    let hasValidityFail = false, hasQualityFail = false;
    for (const c of input.checks) {
      if (c.kind === 'validity' && c.outcome === 'fail') hasValidityFail = true;
      if (c.kind === 'quality' && c.outcome === 'fail') hasQualityFail = true;
    }
    if (hasValidityFail) {
      return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_CONSISTENCY', path: '$.checks' });
    }
    if (!hasQualityFail) {
      return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_CONSISTENCY', path: '$.checks' });
    }
    if (input.reviewer === null) {
      return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_CONSISTENCY', path: '$.reviewer' });
    }
    if (input.reviewer.id === input.source.id) {
      return Object.freeze({ ok: false, profile, code: 'RENDER_RECEIPT_CONSISTENCY', path: '$.reviewer.id' });
    }
  }

  // Build receipt in schema order
  const receipt = {
    schemaVersion: input.schemaVersion,
    profile: input.profile,
    tileId: input.tileId,
    identity: input.identity,
    attempt: input.attempt,
    source: {
      kind: input.source.kind,
      id: input.source.id,
      model: input.source.model,
      block: input.source.block
    },
    candidate: input.candidate,
    verdict: input.verdict,
    checks: input.checks.map(c => ({
      checkId: c.checkId,
      kind: c.kind,
      outcome: c.outcome,
      measured: c.measured,
      threshold: c.threshold,
      scope: c.scope,
      code: c.code
    })),
    reviewer: input.reviewer === null ? null : {
      id: input.reviewer.id,
      model: input.reviewer.model
    },
    elapsedMs: input.elapsedMs,
    tokens: input.tokens
  };

  deepFreeze(receipt);

  return Object.freeze({ ok: true, profile, receipt });
}

function digestRenderReceiptV1(receipt) {
  const read = readRenderReceiptV1(receipt);
  if (!read.ok) {
    throw Object.assign(new Error(), { code: read.code });
  }
  const json = JSON.stringify(read.receipt);
  const bytes = Buffer.from(json);
  const { sha256 } = canonicalizeJSONV1(bytes);
  return sha256;
}

export {
  RENDER_RECEIPT_PROFILE_V1,
  RENDER_RECEIPT_LIMITS_V1,
  RENDER_RECEIPT_VERDICTS_V1,
  RENDER_RECEIPT_SOURCE_KINDS_V1,
  RENDER_RECEIPT_CHECK_KINDS_V1,
  RENDER_RECEIPT_OUTCOMES_V1,
  RENDER_RECEIPT_SCOPES_V1,
  RENDER_RECEIPT_CODES_V1,
  readRenderReceiptV1,
  digestRenderReceiptV1
};
// PURE-REGION-END
