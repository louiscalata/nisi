// PRIVATE fixed-checker group plan. Issuance is in-process identity, not permission.
// Covers every file in the DECLARED materialized snapshot, not an entire disk tree.
import { cloneFreeze, sha256Text, stableStringify } from '../../workflow/contracts.mjs';
import { exact } from '../../integrity/record-utils.mjs';
import { isIssuedRepositoryPreparation } from '../repository/snapshot-contract.mjs';
import { createExecutionExpectation } from '../../receipts/repository-execution-v1.mjs';
import { createNativeArtifactRequest, fixedProfile } from './protocol.mjs';
import { closedList } from './group-contract-utils.mjs';

export const SWIFT_GROUP_LIMIT = 64;
const issued = new WeakMap();
const fail = code => { throw Object.assign(new Error(code), { code }); };
const hash = (domain, value) => sha256Text(domain + '\0' + stableStringify(value));

export function createSwiftCheckPlanV1(input) {
  exact(input, ['preparation', 'runId', 'attempt', 'targets', 'executionProfile'], 'SWIFT_PLAN_SCHEMA');
  const { preparation: p, runId, attempt } = input;
  if (!isIssuedRepositoryPreparation(p)) fail('SWIFT_PLAN_PREPARATION');
  const targets = closedList(input.targets, SWIFT_GROUP_LIMIT, 'SWIFT_PLAN_INVENTORY');
  exact(input.executionProfile, ['sourceSha256', 'buildSha256', 'executableSha256', 'argv', 'environmentSha256',
    'cwd', 'platform', 'architecture', 'timeoutMs', 'maximumOutputBytes'], 'SWIFT_PLAN_PROFILE_SCHEMA');
  closedList(input.executionProfile.argv, 0, 'SWIFT_PLAN_PROFILE_SCHEMA');
  const baseProfile = cloneFreeze(input.executionProfile);
  if (baseProfile.platform !== 'darwin' || baseProfile.architecture !== 'arm64' ||
      baseProfile.timeoutMs > 60000 || baseProfile.maximumOutputBytes !== 16384) fail('SWIFT_PLAN_PROFILE_INVALID');
  if (targets.length < 1 ||
      targets.length !== p.materialized.files.length) fail('SWIFT_PLAN_INVENTORY');
  const byPath = new Map();
  for (const target of targets) {
    exact(target, ['path', 'profileId'], 'SWIFT_PLAN_TARGET_SCHEMA');
    if (typeof target.path !== 'string' || byPath.has(target.path)) fail('SWIFT_PLAN_DUPLICATE');
    fixedProfile(target.profileId); byPath.set(target.path, target.profileId);
  }
  const selected = p.materialized.files.map(file => {
    if (!byPath.has(file.path)) fail('SWIFT_PLAN_INVENTORY');
    return { path: file.path, profileId: byPath.get(file.path), artifactSha256: file.sha256, artifactByteLength: file.byteLength };
  });
  const binding = { schemaVersion: 1, runId, taskFingerprint: p.taskFingerprint, attempt,
    candidateFingerprint: p.candidateFingerprint, baselineFingerprint: p.baselineFingerprint,
    materializedFingerprint: p.materializedFingerprint, preparationFingerprint: p.fingerprint, stage: 'staticChecks' };
  const identity = { schemaVersion: 'nisi-swift-check-plan-v1', binding, executionProfile: baseProfile, targets: selected };
  const fingerprint = hash('nisi/swift-check-plan/v1', identity);
  const checks = selected.map((target, index) => {
    const profile = fixedProfile(target.profileId);
    const checkId = 'nisi.swift.group.' + hash('nisi/swift-check-child/v1', { planFingerprint: fingerprint, index, path: target.path });
    const expected = createExecutionExpectation({ preparation: p, runId, attempt, checkId, stage: 'staticChecks',
      profile: { ...baseProfile, id: profile.id, version: 1, rulesetSha256: profile.rulesFingerprint } });
    const request = createNativeArtifactRequest({ preparation: p, path: target.path, profileId: target.profileId,
      expectationFingerprint: expected.fingerprint, sourceFingerprint: expected.profile.sourceSha256 });
    return Object.freeze({ expected, request, preparation: p, target: cloneFreeze(target) });
  });
  const plan = cloneFreeze({ ...identity, fingerprint, authorizing: false });
  issued.set(plan, Object.freeze(checks));
  return plan;
}

export function issuedSwiftChecksV1(plan) {
  const checks = issued.get(plan);
  if (!checks) fail('SWIFT_PLAN_NOT_ISSUED');
  return checks;
}
