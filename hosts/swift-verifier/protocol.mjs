// PRIVATE native-kernel seam, not a process runner or a public API.
// A valid report is structurally consistent evidence, not authenticated execution.
import { createHash } from 'node:crypto';
import { cloneFreeze, sha256Text } from '../../workflow/contracts.mjs';
import { canonicalizeJSONV1 } from '../../canonical/canonical-json-v1.mjs';
import { isIssuedRepositoryPreparation } from '../repository/snapshot-contract.mjs';

export const KERNEL_SCHEMA = 'nisi-swift-artifact-v1';
export const KERNEL_ARTIFACT_CAP = 1_048_576;
export const KERNEL_OUTPUT_CAP = 16_384;
export const KERNEL_HEADER_CAP = 4096;
const issued = new WeakSet();
const refuse = code => { throw Object.assign(new Error(code), { code }); };
export const hashBytes = bytes => createHash('sha256').update(bytes).digest('hex');
const isDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const definitions = Object.freeze({
  'nisi-json-structure-v1': { kind: 'json', sections: [] },
  'nisi-markdown-sections-v1': { kind: 'markdown', sections: ['Rollback', 'Testing'] },
  'nisi-text-structure-v1': { kind: 'text', sections: [] },
});

export function fixedProfile(id) {
  if (typeof id !== 'string' || !Object.hasOwn(definitions, id)) refuse('SWIFT_PROFILE_UNSUPPORTED');
  const definition = definitions[id];
  // Exact retained Swift CheckProfile.rulesFingerprint encoding; no new hash domain
  // is substituted for the original versioned rules identity.
  const encode = s => `${Buffer.byteLength(s, 'utf8')}:${s}`;
  const fields = ['veritas-check-profile-rules-v1', 'PROFILE_ADMITTED', id].map(encode);
  fields.push(definition.sections.map(encode).join(''), '', encode('model-optional'), encode('0'));
  return cloneFreeze({ id, kind: definition.kind, requiredSections: definition.sections,
    rulesFingerprint: sha256Text(fields.join('|')) });
}

// Host-provided digest is an opaque correlation field, not an execution grant.
// The future runner must issue/recheck its actual expectation and process receipt.
export function createNativeArtifactRequest(input) {
  const descriptors = Object.getOwnPropertyDescriptors(input ?? {});
  const names = ['preparation', 'path', 'profileId', 'expectationFingerprint', 'sourceFingerprint'];
  if (!input || ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
      Reflect.ownKeys(descriptors).length !== names.length || names.some(n =>
        !descriptors[n]?.enumerable || !Object.hasOwn(descriptors[n], 'value'))) refuse('SWIFT_REQUEST_SCHEMA');
  const values = Object.fromEntries(names.map(n => [n, descriptors[n].value]));
  if (!isIssuedRepositoryPreparation(values.preparation)) refuse('SWIFT_PREPARATION_NOT_ISSUED');
  if (!isDigest(values.expectationFingerprint) || !isDigest(values.sourceFingerprint)) refuse('SWIFT_REQUEST_IDENTITY');
  const file = values.preparation.materialized.files.find(f => f.path === values.path);
  if (!file) refuse('SWIFT_ARTIFACT_NOT_IN_PREPARATION');
  const profile = fixedProfile(values.profileId);
  const artifact = Buffer.from(file.content, 'utf8');
  if (artifact.length > KERNEL_ARTIFACT_CAP) refuse('SWIFT_ARTIFACT_LIMIT');
  const header = { schemaVersion: KERNEL_SCHEMA, expectationFingerprint: values.expectationFingerprint,
    preparationFingerprint: values.preparation.fingerprint, path: file.path,
    artifactSha256: hashBytes(artifact), profileId: profile.id,
    rulesFingerprint: profile.rulesFingerprint, sourceFingerprint: values.sourceFingerprint };
  const headerBytes = Buffer.from(JSON.stringify(header));
  if (headerBytes.length > KERNEL_HEADER_CAP) refuse('SWIFT_HEADER_LIMIT');
  const prefix = Buffer.alloc(4); prefix.writeUInt32BE(headerBytes.length);
  const frame = Buffer.concat([prefix, headerBytes, artifact]);
  const request = cloneFreeze({ header, profile, artifactByteLength: artifact.length,
    requestSha256: hashBytes(frame), frameHex: frame.toString('hex'), authorizing: false });
  issued.add(request);
  return request;
}

function exact(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
}

export function readNativeArtifactReport(bytes, request) {
  if (!issued.has(request)) refuse('SWIFT_REQUEST_NOT_ISSUED');
  if (!Buffer.isBuffer(bytes) || bytes.length < 2 || bytes.length > KERNEL_OUTPUT_CAP ||
      bytes[0] !== 123 || bytes.at(-2) !== 125 || bytes.at(-1) !== 10 ||
      bytes.subarray(0, -1).includes(10)) refuse('SWIFT_RESPONSE_FRAME');
  let report;
  try { report = JSON.parse(canonicalizeJSONV1(bytes).canonical); }
  catch { refuse('SWIFT_RESPONSE_JSON'); }
  const names = ['schemaVersion', 'expectationFingerprint', 'preparationFingerprint', 'path',
    'artifactSha256', 'profileId', 'rulesFingerprint', 'sourceFingerprint', 'requestSha256',
    'artifactByteLength', 'status', 'outcomes', 'authorizing'];
  if (!exact(report, names)) refuse('SWIFT_RESPONSE_SCHEMA');
  for (const [key, value] of Object.entries(request.header)) {
    if (report[key] !== value) refuse('SWIFT_RESPONSE_IDENTITY');
  }
  if (report.requestSha256 !== request.requestSha256 || report.artifactByteLength !== request.artifactByteLength ||
      report.authorizing !== false) refuse('SWIFT_RESPONSE_IDENTITY');
  const outcomes = report.outcomes;
  if (!Array.isArray(outcomes) || outcomes.length !== 3 || outcomes.some(o =>
      !exact(o, ['id', 'status', 'explanation']) || typeof o.explanation !== 'string' ||
      o.explanation.trim().length === 0 || Buffer.byteLength(o.explanation) > 1024)) refuse('SWIFT_OUTCOMES_SCHEMA');
  const structure = request.profile.kind === 'json' ? 'DET-003-JSON-STRUCTURE' : 'DET-003-REQUIRED-SECTIONS';
  if (outcomes[0].id !== 'DET-001-NONEMPTY' || outcomes[1].id !== 'DET-002-UTF8' ||
      outcomes[2].id !== structure) refuse('SWIFT_OUTCOMES_INVENTORY');
  // Issued preparations contain well-formed UTF-8 and are bounded; a different
  // native inventory/UTF8 result signals disagreement, never a downgraded PASS.
  if (outcomes[0].status !== (request.artifactByteLength === 0 ? 'FAIL' : 'PASS') ||
      outcomes[1].status !== 'PASS' || !['PASS', 'FAIL'].includes(outcomes[2].status)) refuse('SWIFT_OUTCOMES_STATUS');
  const derived = outcomes.some(o => o.status === 'FAIL') ? 'FAIL' : 'PASS';
  if (report.status !== derived) refuse('SWIFT_AGGREGATE_STATUS');
  return cloneFreeze({ report, consistency: 'CONSISTENT', executionVerified: false, authorizing: false });
}
