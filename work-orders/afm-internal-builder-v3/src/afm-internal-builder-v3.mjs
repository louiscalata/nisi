import { canonicalizeJSONV1 } from '../../../canonical/canonical-json-v1.mjs';

// PURE-REGION-BEGIN
// AFM internal builder, third capability rung: a scoped-STAGING-WRITE grant
// grammar, read-only advisory. Extends rungs 1-2 into settlement: an accepted
// rung-2 run plan plus a caller-consented staging policy settle into a typed,
// frozen, bounded WRITE plan whose target paths are all inside one lane prefix,
// with per-file and total byte budgets and pins (manifestHash, packHash,
// sourcePlanHash) an oracle/human accept command can verify later. The policy's
// manifestHash MUST equal the source plan's manifestHash, so both sides of the
// settlement bind to the same manifest pin (closes the rung-2 spec-review
// finding #1 binding gap). The module never writes anything, never executes
// anything, and never holds acceptance authority: it only plans, deterministically.

const AFM_INTERNAL_BUILDER_V3_PROFILE = 'nisi-afm-internal-builder-v3';
const AFM_INTERNAL_BUILDER_V3_LIMITS_V1 = Object.freeze({
  files: 32,
  writesPerPlan: 3,
  nameLength: 64,
  laneLength: 96,
  bytesPerFile: 262144,
  bytesTotal: 1048576
});
const AFM_INTERNAL_BUILDER_V3_CODES_V1 = Object.freeze([
  'AFM_BUILDER_V3_NOT_OBJECT',
  'AFM_BUILDER_V3_UNKNOWN_MEMBER',
  'AFM_BUILDER_V3_MISSING_MEMBER',
  'AFM_BUILDER_V3_STAGING',
  'AFM_BUILDER_V3_FILE',
  'AFM_BUILDER_V3_BUDGET',
  'AFM_BUILDER_V3_PIN',
  'AFM_BUILDER_V3_WRITE'
]);

const STAGING_KEYS = ['lane', 'files', 'manifestHash'];
const BUDGET_KEYS = ['timeoutSeconds', 'outputBytes'];
const V2_PLAN_KEYS = ['runs', 'manifestHash', 'packHash', 'budget', 'planHash'];
const V2_PLAN_PROFILE = 'nisi-afm-internal-builder-v2';
const HEX64 = /^[0-9a-f]{64}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const ARGV_MAX = 8;
const ARGV_ENTRY_LENGTH = 128;
const TIMEOUT_MAX = 300;
const SNAPSHOT_MAX_DEPTH = 8;
const SNAPSHOT_MAX_NODES = 1024;

class SnapshotRefused extends Error {}

function own(o, k) {
  return Object.prototype.hasOwnProperty.call(o, k);
}

function plain(x) {
  if (x === null || typeof x !== 'object') return false;
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}

function isNonEmptyString(s) {
  return typeof s === 'string' && s.length > 0;
}

function refusal(code, path) {
  return Object.freeze({ ok: false, profile: AFM_INTERNAL_BUILDER_V3_PROFILE, code, path });
}

// One descriptor walk over the input before any validation (same hardening as
// rungs 1-2): only own, enumerable, string-keyed data properties; plain objects
// and plain arrays. Accessors, symbols, exotic arrays, cycles and budget
// overruns all refuse the whole input. Anything that throws inside the walk
// refuses the input too, so getters and Proxy traps can never make the readers
// throw.
function snapshot(x, depth, stack, counter) {
  if (typeof x === 'string') return x;
  if (x === null || typeof x !== 'object') return x;
  if (depth > SNAPSHOT_MAX_DEPTH || stack.has(x)) throw new SnapshotRefused();
  if (++counter.nodes > SNAPSHOT_MAX_NODES) throw new SnapshotRefused();
  stack.add(x);
  let out;
  if (Array.isArray(x)) {
    if (Object.getPrototypeOf(x) !== Array.prototype) throw new SnapshotRefused();
    const length = x.length;
    if (!Number.isSafeInteger(length) || length < 0 || Reflect.ownKeys(x).length !== length + 1) throw new SnapshotRefused();
    out = [];
    for (let i = 0; i < length; i++) {
      const d = Object.getOwnPropertyDescriptor(x, String(i));
      if (d === undefined || !own(d, 'value') || !d.enumerable) throw new SnapshotRefused();
      out.push(snapshot(d.value, depth + 1, stack, counter));
    }
  } else {
    if (!plain(x)) throw new SnapshotRefused();
    out = {};
    for (const k of Reflect.ownKeys(x)) {
      if (typeof k !== 'string') throw new SnapshotRefused();
      const d = Object.getOwnPropertyDescriptor(x, k);
      if (!own(d, 'value') || !d.enumerable) throw new SnapshotRefused();
      Object.defineProperty(out, k, { value: snapshot(d.value, depth + 1, stack, counter), enumerable: true, writable: true, configurable: true });
    }
  }
  stack.delete(x);
  return out;
}

function snapshotOrRefuseRoot(value) {
  try {
    return { ok: true, value: snapshot(value, 0, new Set(), { nodes: 0 }) };
  } catch {
    return { ok: false };
  }
}

function deepFreeze(o) {
  if (o === null || typeof o !== 'object' || Object.isFrozen(o)) return o;
  Object.freeze(o);
  for (const k of Object.getOwnPropertyNames(o)) deepFreeze(o[k]);
  return o;
}

/**
 * Validates caller-consented staging policy { lane, files, manifestHash }.
 * @param {unknown} input - The staging policy to validate.
 * @returns {{ ok: boolean, profile: string, ... }} Validation result.
 */
function readStagingPolicyV1(input) {
  const limits = AFM_INTERNAL_BUILDER_V3_LIMITS_V1;
  const snap = snapshotOrRefuseRoot(input);
  if (!snap.ok || !plain(snap.value)) return refusal('AFM_BUILDER_V3_NOT_OBJECT', '$');
  const value = snap.value;

  for (const k of Object.keys(value)) {
    if (!STAGING_KEYS.includes(k)) return refusal('AFM_BUILDER_V3_UNKNOWN_MEMBER', `$.${k}`);
  }
  for (const k of STAGING_KEYS) {
    if (!own(value, k)) return refusal('AFM_BUILDER_V3_MISSING_MEMBER', `$.${k}`);
  }

  // Lane: the target path prefix pin. Banned outright: empty, too long,
  // control chars, '.', leading '/', and any '..' substring. Copied verbatim,
  // never normalized.
  if (typeof value.lane !== 'string' || value.lane.length === 0 || value.lane.length > limits.laneLength ||
      CONTROL.test(value.lane) || value.lane === '.' || value.lane.startsWith('/') || value.lane.includes('..')) {
    return refusal('AFM_BUILDER_V3_STAGING', '$.lane');
  }

  // File set: container and key problems are the file-SET level (STAGING), a
  // bad name is FILE at the container (the name itself cannot be addressed
  // safely), a bad planned byte count is BUDGET at the name, and an over-budget
  // total is BUDGET at the container.
  if (!plain(value.files)) return refusal('AFM_BUILDER_V3_STAGING', '$.files');
  const names = Object.keys(value.files);
  if (names.length === 0 || names.length > limits.files) return refusal('AFM_BUILDER_V3_STAGING', '$.files');
  const files = {};
  let total = 0;
  for (const name of names) {
    if (!isNonEmptyString(name) || name.length > limits.nameLength || name.includes('/') || name.includes('..') ||
        CONTROL.test(name) || name === '.' || name === '..' || name === '__proto__' || name === 'constructor') {
      return refusal('AFM_BUILDER_V3_FILE', '$.files');
    }
    const bytes = value.files[name];
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > limits.bytesPerFile) {
      return refusal('AFM_BUILDER_V3_BUDGET', `$.files.${name}`);
    }
    total += bytes;
    files[name] = bytes;
  }
  if (total > limits.bytesTotal) return refusal('AFM_BUILDER_V3_BUDGET', '$.files');

  if (typeof value.manifestHash !== 'string' || !HEX64.test(value.manifestHash)) {
    return refusal('AFM_BUILDER_V3_PIN', '$.manifestHash');
  }

  const stagingPolicy = deepFreeze({ lane: value.lane, files, manifestHash: value.manifestHash });
  return Object.freeze({ ok: true, profile: AFM_INTERNAL_BUILDER_V3_PROFILE, stagingPolicy });
}

// Deterministic staging hash over the six canonical write-plan fields: writes,
// lane, manifestHash, packHash, sourcePlanHash, totalBytes. Canonicalized JSON,
// sha256 hex. Only pass a writePlan (or equivalent hash parts) produced by this
// module's settled shape; anything outside the codec grammar throws a coded
// canonicalizeJSONV1 error (same contract as the rung-1 pack hash and rung-2
// plan hash). Declared before use only by hoisting; the single definition
// follows planStagingWritesV1 below.

/**
 * Maps an accepted rung-2 plan result onto staged writes under the lane into a typed write plan.
 * @param {unknown} planResult - The accepted rung-2 plan result.
 * @param {unknown} stagingPolicy - The validated staging policy.
 * @returns {{ ok: boolean, profile: string, ... }} Staged write plan.
 */
function planStagingWritesV1(planResult, stagingPolicy) {
  const limits = AFM_INTERNAL_BUILDER_V3_LIMITS_V1;
  const bad = (path) => refusal('AFM_BUILDER_V3_WRITE', path);

  // Plan side: an accepted rung-2 plan result, fully re-validated (deep pins,
  // bounds, nested run shape) so a hostile or mutated result cannot smuggle a
  // different source of authority.
  const snapPlan = snapshotOrRefuseRoot(planResult);
  if (!snapPlan.ok || !plain(snapPlan.value)) return bad('$.plan');
  const value = snapPlan.value;
  if (value.ok !== true || value.profile !== V2_PLAN_PROFILE || !plain(value.plan)) return bad('$.plan');
  if (Object.keys(value).length !== 3) return bad('$.plan');
  const plan = value.plan;
  for (const k of Object.keys(plan)) {
    if (!V2_PLAN_KEYS.includes(k)) return bad('$.plan');
  }
  for (const k of V2_PLAN_KEYS) {
    if (!own(plan, k)) return bad('$.plan');
  }
  if (!Array.isArray(plan.runs) || plan.runs.length === 0 || plan.runs.length > limits.writesPerPlan) return bad('$.plan');
  for (const run of plan.runs) {
    if (!plain(run) || Object.keys(run).length !== 2 || !own(run, 'check') || !own(run, 'argv')) return bad('$.plan');
    const check = run.check;
    if (!isNonEmptyString(check) || check.length > limits.nameLength || CONTROL.test(check)) return bad('$.plan');
    if (!Array.isArray(run.argv) || run.argv.length === 0 || run.argv.length > ARGV_MAX) return bad('$.plan');
    for (const a of run.argv) {
      if (typeof a !== 'string' || a.length === 0 || a.length > ARGV_ENTRY_LENGTH || CONTROL.test(a)) return bad('$.plan');
    }
  }
  if (typeof plan.manifestHash !== 'string' || !HEX64.test(plan.manifestHash)) return bad('$.plan');
  if (typeof plan.packHash !== 'string' || !HEX64.test(plan.packHash)) return bad('$.plan');
  if (typeof plan.planHash !== 'string' || !HEX64.test(plan.planHash)) return bad('$.plan');
  if (!plain(plan.budget)) return bad('$.plan');
  for (const k of Object.keys(plan.budget)) {
    if (!BUDGET_KEYS.includes(k)) return bad('$.plan');
  }
  for (const k of BUDGET_KEYS) {
    if (!own(plan.budget, k)) return bad('$.plan');
  }
  if (!Number.isSafeInteger(plan.budget.timeoutSeconds) || plan.budget.timeoutSeconds < 1 || plan.budget.timeoutSeconds > TIMEOUT_MAX) return bad('$.plan');
  if (!Number.isSafeInteger(plan.budget.outputBytes) || plan.budget.outputBytes < 1 || plan.budget.outputBytes > limits.bytesTotal) return bad('$.plan');

  // Staging side: re-read through the policy grammar (rung-1 hardened probe:
  // a Proxy whose get trap throws passes the descriptor walk untouched, so the
  // probe turns it into a root refusal instead of a misleading member path).
  const snapPolicy = snapshotOrRefuseRoot(stagingPolicy);
  if (!snapPolicy.ok || !plain(snapPolicy.value)) return bad('$.staging');
  try {
    void stagingPolicy.lane;
    void stagingPolicy.files;
    void stagingPolicy.manifestHash;
  } catch {
    return bad('$.staging');
  }
  const reread = readStagingPolicyV1(snapPolicy.value);
  if (!reread.ok) return bad('$.staging');
  const policy = reread.stagingPolicy;

  // Cross-input pin: both sides of the settlement must bind to the SAME
  // manifest pin, or the write grant is refused at the staging manifest path.
  if (policy.manifestHash !== plan.manifestHash) return bad('$.manifestHash');

  const entries = Object.keys(policy.files).slice(0, limits.writesPerPlan);
  const writes = [];
  let totalBytes = 0;
  for (const name of entries) {
    const bytes = policy.files[name];
    totalBytes += bytes;
    writes.push(Object.freeze({ path: policy.lane + name, name, bytes }));
  }
  const hashParts = {
    writes,
    lane: policy.lane,
    manifestHash: plan.manifestHash,
    packHash: plan.packHash,
    sourcePlanHash: plan.planHash,
    totalBytes
  };
  const writePlan = deepFreeze({
    writes: Object.freeze(writes),
    lane: policy.lane,
    manifestHash: plan.manifestHash,
    packHash: plan.packHash,
    sourcePlanHash: plan.planHash,
    totalBytes,
    stagingHash: stagingWritePlanHashV1(hashParts)
  });
  return Object.freeze({ ok: true, profile: AFM_INTERNAL_BUILDER_V3_PROFILE, writePlan });
}

/**
 * Computes deterministic hash over the write plan's canonical fields.
 * @param {unknown} plan - The write plan.
 * @returns {string} sha256 hex hash.
 */
function stagingWritePlanHashV1(plan) {
  const six = {
    writes: plan.writes,
    lane: plan.lane,
    manifestHash: plan.manifestHash,
    packHash: plan.packHash,
    sourcePlanHash: plan.sourcePlanHash,
    totalBytes: plan.totalBytes
  };
  return canonicalizeJSONV1(Buffer.from(JSON.stringify(six))).sha256;
}

/**
 * Renders a self-contained frozen module exporting the write plan.
 * @param {unknown} planResult - The accepted write-plan result.
 * @returns {string} Valid Node ESM module source.
 */
function stagingWritePlanSourceV1(writePlanResult) {
  const limits = AFM_INTERNAL_BUILDER_V3_LIMITS_V1;
  const bad = () => refusal('AFM_BUILDER_V3_WRITE', '$');
  const snap = snapshotOrRefuseRoot(writePlanResult);
  if (!snap.ok || !plain(snap.value)) return bad();
  const value = snap.value;
  if (value.ok !== true || value.profile !== AFM_INTERNAL_BUILDER_V3_PROFILE || !plain(value.writePlan)) return bad();
  if (Object.keys(value).length !== 3) return bad();
  const p = value.writePlan;
  if (Object.keys(p).length !== 7) return bad();
  if (typeof p.lane !== 'string' || p.lane.length === 0 || p.lane.length > limits.laneLength ||
      CONTROL.test(p.lane) || p.lane.startsWith('/') || p.lane.includes('..')) return bad();
  if (!Array.isArray(p.writes) || p.writes.length === 0 || p.writes.length > limits.writesPerPlan) return bad();
  let sum = 0;
  for (const w of p.writes) {
    if (!plain(w) || Object.keys(w).length !== 3 || !own(w, 'path') || !own(w, 'name') || !own(w, 'bytes')) return bad();
    if (typeof w.name !== 'string' || w.name.length === 0 || w.name.length > limits.nameLength ||
        w.name.includes('/') || w.name.includes('..') || CONTROL.test(w.name)) return bad();
    if (typeof w.path !== 'string' || w.path !== p.lane + w.name) return bad();
    if (!Number.isSafeInteger(w.bytes) || w.bytes < 1 || w.bytes > limits.bytesPerFile) return bad();
    sum += w.bytes;
  }
  if (!Number.isSafeInteger(p.totalBytes) || p.totalBytes !== sum) return bad();
  if (typeof p.manifestHash !== 'string' || !HEX64.test(p.manifestHash)) return bad();
  if (typeof p.packHash !== 'string' || !HEX64.test(p.packHash)) return bad();
  if (typeof p.sourcePlanHash !== 'string' || !HEX64.test(p.sourcePlanHash)) return bad();
  if (typeof p.stagingHash !== 'string' || !HEX64.test(p.stagingHash)) return bad();

  const json = JSON.stringify({
    writes: p.writes, lane: p.lane, manifestHash: p.manifestHash, packHash: p.packHash,
    sourcePlanHash: p.sourcePlanHash, totalBytes: p.totalBytes, stagingHash: p.stagingHash
  });
  return [
    '// Generated by afm-internal-builder-v3 stagingWritePlanSourceV1. Deterministic, bounded, lane-scoped write plan.',
    'const result = JSON.parse(' + JSON.stringify(json) + ');',
    'const deepFreeze = (o) => {',
    '  if (o === null || typeof o !== "object" || Object.isFrozen(o)) return o;',
    '  Object.freeze(o);',
    '  for (const k of Object.getOwnPropertyNames(o)) deepFreeze(o[k]);',
    '  return o;',
    '};',
    'export default deepFreeze(result);'
  ].join('\n');
}
// PURE-REGION-END

export {
  AFM_INTERNAL_BUILDER_V3_PROFILE,
  AFM_INTERNAL_BUILDER_V3_LIMITS_V1,
  AFM_INTERNAL_BUILDER_V3_CODES_V1,
  readStagingPolicyV1,
  planStagingWritesV1,
  stagingWritePlanHashV1,
  stagingWritePlanSourceV1
};