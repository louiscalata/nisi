// PRIVATE fixed-source oracle registration. A separate protected execution graph
// holds the oracle harness; the workflow graph and model configuration are intact.
// Two reviewed candidates only. Location separation is not attested independence.
import { readFile } from 'node:fs/promises';
import { cloneFreeze, createTaskSpecification, sha256Text } from '../../workflow/contracts.mjs';
import { digest } from '../../integrity/record-utils.mjs';
import { createRepositorySnapshot, prepareRepositoryCandidate } from '../../hosts/repository/snapshot-contract.mjs';
import { registerReviewedNodeSuiteV1, REVIEWED_NODE_SCOPE } from '../../hosts/repository/node-suite-v1.mjs';
import { encodeRepositoryTrialCandidateV1 } from '../../evaluation/repository-trial-candidate-v1.mjs';
import { createReviewedLiveFixtureV1 } from './reviewed-live-fixture-v1.mjs';
const issued = new WeakMap();
const fail = code => { throw Object.assign(Error(code), { code }); };
const entryPath = 'oracle-only/check-retry-semantics.mjs';
const sourceManifest = cloneFreeze([{ path: entryPath, byteLength: 2855,
  sha256: 'b94e0a0bb8ad223e220b17fcad661c4369d98107107361a61eaac6f938f08566' }]);
const names = Object.freeze(['explicit undefined uses the default', 'interior integer one is preserved',
  'interior integer nine is preserved', 'fractional number is rejected', 'NaN is rejected',
  'positive infinity is rejected', 'negative infinity is rejected', 'boolean true is rejected', 'bigint is rejected',
  'omitted input uses the default', 'empty input uses the default', 'null retry limit uses the default',
  'zero is preserved', 'upper boundary ten is preserved', 'negative integer is rejected',
  'integer above ten is rejected', 'numeric string is rejected']);

// Trusted byte seam for refusal tests, not a user-supplied review decision.
// All candidate/source bytes still come from the original fixed reviewed loader.
export async function createReviewedRepositoryOracleFromSourceV1(input) {
  if (!Buffer.isBuffer(input) || input.length !== sourceManifest[0].byteLength) fail('ORACLE_SOURCE_BYTES');
  const bytes = Buffer.from(input);
  if (sha256Text(bytes) !== sourceManifest[0].sha256) fail('ORACLE_SOURCE_HASH');
  const workflow = await createReviewedLiveFixtureV1();
  const baseline = createRepositorySnapshot({ files: [...workflow.baseline.files.map(({ path, content }) => ({ path, content })),
    { path: entryPath, content: bytes.toString('utf8') }] });
  const protectedFiles = baseline.files.filter(file => file.path !== 'retry-settings.mjs');
  const task = createTaskSpecification({ ...workflow.task, taskId: 'retry.repository.oracle',
    allowedFiles: baseline.files.map(file => file.path), protectedFiles: protectedFiles.map(file => file.path),
    protectedSnapshots: Object.fromEntries(protectedFiles.map(file => [file.path, file.sha256])),
    policy: { ...workflow.task.policy, repairBudget: 0 } });
  const preparations = Object.freeze(workflow.preparations.map(original => prepareRepositoryCandidate({ baseline, task,
    candidate: { files: original.candidate.files }, authorId: original.candidate.authorId })));
  const suite = registerReviewedNodeSuiteV1({ id: 'nisi.node.retry-oracle', scope: REVIEWED_NODE_SCOPE,
    preparations, entryPath, reportSchema: 'nisi-retry-oracle-v1', assertionNames: names, setupReason: 'ORACLE_SETUP_FAILED' });
  // Establish correspondence by exact candidate identity, not shared array index.
  const mappings = workflow.preparations.map(original => {
    const oracle = preparations.find(p => p.candidateFingerprint === original.candidateFingerprint);
    if (!oracle) fail('ORACLE_MAPPING');
    const encoded = encodeRepositoryTrialCandidateV1(original.candidate);
    return { candidateSha256: encoded.candidateSha256, candidateFingerprint: original.candidateFingerprint,
      workflowPreparationFingerprint: original.fingerprint, workflowMaterializedFingerprint: original.materializedFingerprint,
      oraclePreparationFingerprint: oracle.fingerprint, oracleMaterializedFingerprint: oracle.materializedFingerprint };
  });
  const identity = cloneFreeze({ schemaVersion: 'nisi-reviewed-repository-oracle-v1', scope: 'FIXED_REVIEWED_CANDIDATE_ORACLE',
    workflow: { taskSha256: workflow.preparations[0].taskFingerprint, baselineSha256: workflow.baseline.fingerprint,
      suiteFingerprint: workflow.suite.fingerprint, reviewedSourceFingerprint: workflow.reviewedSourceFingerprint },
    oracle: { taskSha256: preparations[0].taskFingerprint, baselineSha256: baseline.fingerprint, suiteFingerprint: suite.fingerprint,
      entryPath, entrySha256: suite.entrySha256, sourceManifest, sourceManifestFingerprint: digest('nisi/oracle-source/v1', sourceManifest) },
    assertionNames: names, candidateSerializationProfile: 'nisi-workflow-stable-json-v1', mappings,
    candidatePopulation: mappings.length, harnessExposure: 'EXCLUDED_FROM_WORKFLOW_GRAPH',
    inferenceExposureAttested: false, independenceAttested: false, measurementVerified: false,
    arbitraryCandidateExecutionAllowed: false, promotionEligible: false, authorizing: false });
  const registration = cloneFreeze({ ...identity, oracleSha256: digest('nisi/repository-trial-oracle/v1', identity) });
  issued.set(registration, Object.freeze({ registration, workflow, baseline, task, preparations, suite }));
  return registration;
}
export async function createReviewedRepositoryOracleV1() {
  const bytes = await readFile(new URL(entryPath, import.meta.url));
  return createReviewedRepositoryOracleFromSourceV1(bytes);
}
export function readIssuedRepositoryOracleV1(registration) {
  const owned = issued.get(registration); if (!owned) fail('ORACLE_NOT_ISSUED'); return owned;
}
