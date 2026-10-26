// Owner evidence index for the isolated candidate. This cannot grant acceptance.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const base = path.dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(fs.readFileSync(path.join(base, file), 'utf8'));
const ref = file => ({ path: file, sha256: hash(fs.readFileSync(path.join(base, file))) });
const checks = read('checks-LrT9D5/checks.json');
const mutations = read('mutations-aHt2co/checks.json');
const validation = read('nisi-validation-AKuzou/receipt.json');
const review = read('daybreak-source-review-final.json');
assert.equal(checks.ok, true); assert.equal(mutations.ok, true); assert.equal(validation.ok, true);
assert.equal(review.verdict, 'PASS'); assert.equal(review.reviewerExecutedTests, false);
assert.deepEqual(checks.candidateHashes, validation.sourceHashes);
for (const [file, sha] of Object.entries(checks.candidateHashes)) {
  assert.equal(hash(fs.readFileSync(path.join(base, 'candidate', file))), sha);
  assert.equal(review.sourceHashes['candidate/' + file], sha);
}
for (const row of checks.checks) {
  assert.equal(hash(fs.readFileSync(path.join(base, 'checks-LrT9D5', row.name + '.log'))), row.logSha256);
}
assert.equal(mutations.checkpointSha256, ref('checks-LrT9D5/checks.json').sha256);
for (const row of mutations.checks) {
  assert.equal(hash(fs.readFileSync(path.join(base, 'mutations-aHt2co', row.name + '.log'))), row.logSha256);
}
assert.equal(hash(fs.readFileSync(path.join(base, 'nisi-validation-AKuzou/nisi-validation.log'))), validation.logSha256);
const evidence = {
  schemaVersion: 'nisi-c07-private-candidate-checkpoint/v1',
  scope: 'CALLER_SUPPLIED_NATIVE_INCIDENT_EVIDENCE_NODE_ONLY',
  sourceHashes: checks.candidateHashes,
  checks: ref('checks-LrT9D5/checks.json'), mutations: ref('mutations-aHt2co/checks.json'),
  validation: ref('nisi-validation-AKuzou/receipt.json'), review: ref('daybreak-source-review-final.json'),
  before: [ref('checks-KNvt6H/checks.json'), ref('checks-o3AP1u/checks.json')],
  canonicalBaseCommit: 'b37c40d8a641b27ad3756d660254ac6f9f4c830c',
  requiredDependencySupersession: {
    path: 'hosts/repository/native-incident-source-v1.mjs',
    oldSha256: 'ab08ed666126011f3e57f7d3975dce8602a1d570f81c8c544f1c58a2f0616a26',
    newSha256: checks.candidateHashes['hosts/repository/native-incident-source-v1.mjs'],
    status: 'NOT_IMPLEMENTED'
  },
  implementationAccepted: false, integrated: false, nativeBuildAccepted: false,
  nativeExecutionAttested: false, sourceAuthenticityAttested: false,
  resumeGranted: false, publicationAuthorized: false, openCodeExecuted: false, inference: 'NOT_RUN'
};
fs.writeFileSync(path.join(base, 'candidate-checkpoint.json'), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ path: path.join(base, 'candidate-checkpoint.json'), sha256: ref('candidate-checkpoint.json').sha256,
  implementationAccepted: false, sourceFiles: Object.keys(checks.candidateHashes).length }));
