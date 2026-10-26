// PRIVATE candidate byte codec. Data only, never execution or oracle acceptance.
import { record } from './intake-v1.mjs';
import { cloneFreeze, createCandidate, stableStringify, sha256Text } from '../workflow/contracts.mjs';
const fail = code => { throw Object.assign(Error(code), { code }); };
const limit = 1048576;
function encode(candidate) {
  if (candidate.files.some(file => !file.path.isWellFormed() || !file.content.isWellFormed())) fail('TRIAL_CANDIDATE_UNICODE');
  const candidateText = stableStringify({ schemaVersion: 1, files: candidate.files });
  const byteLength = Buffer.byteLength(candidateText);
  if (byteLength > limit) fail('TRIAL_CANDIDATE_LIMIT');
  return cloneFreeze({ serializationProfile: 'nisi-workflow-stable-json-v1', candidateText,
    candidateSha256: sha256Text(candidateText), candidateFingerprint: candidate.fingerprint, byteLength });
}
export function encodeRepositoryTrialCandidateV1(input) {
  const raw = record(input, ['schemaVersion', 'authorId', 'files', 'fingerprint']);
  const candidate = createCandidate({ files: raw.files }, { authorId: raw.authorId });
  if (raw.schemaVersion !== 1 || raw.fingerprint !== candidate.fingerprint) fail('TRIAL_CANDIDATE_BINDING');
  return encode(candidate);
}
export function decodeRepositoryTrialCandidateV1(candidateText, candidateSha256) {
  if (typeof candidateText !== 'string' || !candidateText.isWellFormed() || Buffer.byteLength(candidateText) > limit)
    fail('TRIAL_CANDIDATE_TEXT');
  if (typeof candidateSha256 !== 'string' || candidateSha256.length !== 64 || !/^[a-f0-9]{64}$/u.test(candidateSha256) ||
      sha256Text(candidateText) !== candidateSha256) fail('TRIAL_CANDIDATE_TEXT_HASH');
  let parsed;
  try { parsed = JSON.parse(candidateText); } catch { fail('TRIAL_CANDIDATE_JSON'); }
  const raw = record(parsed, ['schemaVersion', 'files']);
  if (raw.schemaVersion !== 1) fail('TRIAL_CANDIDATE_SCHEMA');
  const candidate = createCandidate({ files: raw.files }, { authorId: 'trial.oracle' }), encoded = encode(candidate);
  // Reject whitespace, duplicate keys, alternate escapes and unsorted files;
  // no lossy parser normalization can stand in for the exact retained bytes.
  if (encoded.candidateText !== candidateText) fail('TRIAL_CANDIDATE_NONCANONICAL');
  return cloneFreeze({ files: candidate.files, candidateFingerprint: candidate.fingerprint,
    candidateSha256, serializationProfile: encoded.serializationProfile, authorizing: false });
}
