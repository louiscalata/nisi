import test from 'node:test';
import assert from 'node:assert/strict';
import { createCandidate, sha256Text } from '../workflow/contracts.mjs';
import { encodeRepositoryTrialCandidateV1 as encode, decodeRepositoryTrialCandidateV1 as decode } from '../evaluation/repository-trial-candidate-v1.mjs';
const make = files => createCandidate({ files }, { authorId: 'fixture.author' });
test('canonical candidate roundtrip keeps distinct raw-text hash and workflow fingerprint', () => {
  const candidate = make([{ path: 'z.mjs', content: 'é🍎\n' }, { path: 'a.mjs', content: 'export {};' }]);
  const encoded = encode(candidate);
  assert.equal(encoded.candidateSha256, sha256Text(encoded.candidateText)); assert.notEqual(encoded.candidateSha256, candidate.fingerprint);
  const decoded = decode(encoded.candidateText, encoded.candidateSha256);
  assert.equal(encoded.candidateFingerprint, candidate.fingerprint); assert.equal(decoded.candidateFingerprint, candidate.fingerprint);
  assert.equal(decoded.authorizing, false); assert.deepEqual(decoded.files, candidate.files);
  assert.equal(encoded.byteLength, Buffer.byteLength(encoded.candidateText)); assert(Object.isFrozen(decoded.files[0]));
  assert.deepEqual(encode({ ...candidate, files: [...candidate.files].reverse() }), encoded);
  assert.deepEqual(encode({ ...candidate, authorId: 'another.author' }), encoded); // author is not candidate-content identity.
});
test('stale fingerprint and candidate mutation are refused', () => {
  const candidate = make([{ path: 'a.mjs', content: 'a' }]);
  for (const changed of [{ ...candidate, schemaVersion: 2 }, { ...candidate, fingerprint: '0'.repeat(64) },
    { ...candidate, files: [{ path: 'a.mjs', content: 'changed' }] }]) assert.throws(() => encode(changed), { code: 'TRIAL_CANDIDATE_BINDING' });
  assert.throws(() => decode(encode(candidate).candidateText, candidate.fingerprint), { code: 'TRIAL_CANDIDATE_TEXT_HASH' });
});
test('noncanonical whitespace keys escapes and file ordering are not silently normalized', () => {
  const encoded = encode(make([{ path: 'a.mjs', content: 'a' }, { path: 'b.mjs', content: 'b' }]));
  const parsed = JSON.parse(encoded.candidateText);
  for (const text of [encoded.candidateText + '\n', JSON.stringify(parsed, null, 2),
    encoded.candidateText.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
    encoded.candidateText.replace('"a"', '"\\u0061"'),
    JSON.stringify({ files: [...parsed.files].reverse(), schemaVersion: 1 })])
    assert.throws(() => decode(text, sha256Text(text)), { code: 'TRIAL_CANDIDATE_NONCANONICAL' });
});
test('oversize and malformed Unicode are refused without truncation', () => {
  assert.throws(() => encode(make([{ path: 'a.mjs', content: 'a'.repeat(1048576) }])), { code: 'TRIAL_CANDIDATE_LIMIT' });
  assert.throws(() => encode(make([{ path: 'a.mjs', content: '\ud800' }])), { code: 'TRIAL_CANDIDATE_UNICODE' });
  assert.throws(() => encode(make([{ path: '\ud800.mjs', content: 'a' }])), { code: 'TRIAL_CANDIDATE_UNICODE' });
  const text = '{"files":[{"content":"\\ud800","path":"a.mjs"}],"schemaVersion":1}';
  assert.throws(() => decode(text, sha256Text(text)), { code: 'TRIAL_CANDIDATE_UNICODE' });
  const badPath = '{"files":[{"content":"a","path":"\\ud800.mjs"}],"schemaVersion":1}';
  assert.throws(() => decode(badPath, sha256Text(badPath)), { code: 'TRIAL_CANDIDATE_UNICODE' });
  assert.throws(() => decode('a'.repeat(1048577), '0'.repeat(64)), { code: 'TRIAL_CANDIDATE_TEXT' });
});
test('accessors extra properties duplicate paths and malformed digests are refused', () => {
  const candidate = make([{ path: 'a.mjs', content: 'a' }]), text = encode(candidate).candidateText; let calls = 0;
  const hostile = { ...candidate }; Object.defineProperty(hostile, 'files', { get() { calls++; }, enumerable: true });
  assert.throws(() => encode(hostile)); assert.equal(calls, 0);
  assert.throws(() => encode({ ...candidate, extra: true }));
  assert.throws(() => encode({ ...candidate, files: [...candidate.files, ...candidate.files] }));
  for (const hash of [undefined, null, '', sha256Text(text) + '\n', sha256Text(text).toUpperCase()])
    assert.throws(() => decode(text, hash), { code: 'TRIAL_CANDIDATE_TEXT_HASH' });
  for (const invalid of ['null', '{}', '{', '{"files":[],"schemaVersion":1}', '{"files":[],"schemaVersion":2}'])
    assert.throws(() => decode(invalid, sha256Text(invalid)));
});
