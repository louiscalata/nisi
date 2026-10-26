// PRIVATE execution bindings. Declarations correlate evidence; they grant no
// model, tool, storage, policy-promotion or runtime-admission authority.
import { createHash } from 'node:crypto';
import { record, natural } from './intake-v1.mjs';

export const runnerFail = code => { throw Object.assign(new Error(code), { code }); };
export const sha256 = text => createHash('sha256').update(text).digest('hex');
export function digest(value) {
  if (typeof value !== 'string' || value.length !== 64 || !/^[a-f0-9]{64}$/u.test(value)) runnerFail('RUNNER_DIGEST');
  return value;
}
export function freezeOwned(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeOwned(child);
    Object.freeze(value);
  }
  return value;
}
export function readPreventionExecutionProfileV1(input, planSha256, policy) {
  const boundPolicy = record(policy, ['version', 'sha256', 'influenceEnabled']);
  if (boundPolicy.influenceEnabled !== false) runnerFail('RUNNER_POLICY_INFLUENCE');
  const p = record(input, ['schemaVersion', 'planSha256', 'model', 'modelSettingsSha256',
    'toolchainSha256', 'resourceBudgetSha256', 'trialPolicy', 'executorTimeoutMs',
    'oracleTimeoutMs', 'retentionTimeoutMs', 'drainTimeoutMs']);
  if (p.schemaVersion !== 'nisi-prevention-execution-profile-v1') runnerFail('RUNNER_PROFILE_SCHEMA');
  if (digest(p.planSha256) !== digest(planSha256)) runnerFail('RUNNER_PLAN_BINDING');
  if (typeof p.model !== 'string' || !p.model.isWellFormed() || !p.model.length ||
      p.model.trim() !== p.model || p.model.includes('\0') || Buffer.byteLength(p.model) > 200) runnerFail('RUNNER_MODEL');
  for (const key of ['modelSettingsSha256', 'toolchainSha256', 'resourceBudgetSha256']) digest(p[key]);
  p.trialPolicy = record(p.trialPolicy, ['version', 'sha256']);
  if (typeof p.trialPolicy.version !== 'string' ||
      /^[a-z][a-z0-9_.-]{0,95}$/u.exec(p.trialPolicy.version)?.[0] !== p.trialPolicy.version) runnerFail('RUNNER_POLICY');
  digest(p.trialPolicy.sha256);
  if (p.trialPolicy.version !== boundPolicy.version || p.trialPolicy.sha256 !== boundPolicy.sha256) runnerFail('RUNNER_POLICY_BINDING');
  for (const key of ['executorTimeoutMs', 'oracleTimeoutMs', 'retentionTimeoutMs', 'drainTimeoutMs']) {
    natural(p[key]);
    if (p[key] < 1 || p[key] > 120000) runnerFail('RUNNER_TIMEOUT');
  }
  return freezeOwned({ ...p, profileSha256: sha256(JSON.stringify(p)) });
}
