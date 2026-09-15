import { canonicalizeJSONV1 } from '../../../canonical/canonical-json-v1.mjs';

// PURE-REGION-BEGIN
// AFM internal builder, fourth capability rung: a staged-SWIFT-COMPILE grant
// grammar, read-only advisory. Extends rungs 1-3 into pre-execution: an
// accepted rung-3 write plan plus a caller-consented compile policy settle
// into a typed, frozen, bounded COMPILE plan (exact swiftc argv with no shell,
// no network, sources that the rung-3 plan staged, output artifact inside the
// same lane, sha256 source pins, budgets, and chained pins from the source
// write plan). The policy's manifestHash MUST equal the write plan's
// manifestHash (cross-rung pin), so the whole ladder binds to the same manifest
// pin. The module never invokes anything, never executes anything, and never
// holds acceptance authority: it only plans, deterministically.

const AFM_INTERNAL_BUILDER_V4_PROFILE = 'nisi-afm-internal-builder-v4';
const AFM_INTERNAL_BUILDER_V4_LIMITS_V1 = Object.freeze({
  sources: 8,
  sourceNameLength: 64,
  argvMax: 16,
  argvEntryLength: 128,
  invokeTimeoutSeconds: 300,
  outputBytes: 1048576,
  compilerNameLength: 64,
  outputNameLength: 64,
  laneLength: 96
});
const AFM_INTERNAL_BUILDER_V4_CODES_V1 = Object.freeze([
  'AFM_BUILDER_V4_NOT_OBJECT',
  'AFM_BUILDER_V4_UNKNOWN_MEMBER',
  'AFM_BUILDER_V4_MISSING_MEMBER',
  'AFM_BUILDER_V4_COMPILE',
  'AFM_BUILDER_V4_COMMAND',
  'AFM_BUILDER_V4_BUDGET',
  'AFM_BUILDER_V4_PIN',
  'AFM_BUILDER_V4_INVOKE'
]);

const COMPILE_KEYS = ['invoke', 'sources', 'output', 'manifestHash', 'budget'];
const BUDGET_KEYS = ['timeoutSeconds', 'outputBytes'];
const V3_WRITEPLAN_KEYS = ['writes', 'lane', 'manifestHash', 'packHash', 'sourcePlanHash', 'totalBytes', 'stagingHash'];
const V3_WRITEPLAN_PROFILE = 'nisi-afm-internal-builder-v3';
const SWIFTC = 'swiftc';
const HEX64 = /^[0-9a-f]{64}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const WRITES_MAX = 3;
const BYTES_PER_FILE = 262144;
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
  return Object.freeze({ ok: false, profile: AFM_INTERNAL_BUILDER_V4_PROFILE, code, path });
}

// Same descriptor-walk hardening as rungs 1-3.
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
 * Validates caller-consented compile policy { invoke, sources, output, manifestHash, budget }.
 * @param {unknown} input — candidate compile policy object
 * @returns {{ ok: boolean, profile: string, ... }} validation result
 */
function readCompilePolicyV1(input) {
  const limits = AFM_INTERNAL_BUILDER_V4_LIMITS_V1;
  const snap = snapshotOrRefuseRoot(input);
  if (!snap.ok || !plain(snap.value)) return refusal('AFM_BUILDER_V4_NOT_OBJECT', '$');
  const value = snap.value;

  for (const k of Object.keys(value)) {
    if (!COMPILE_KEYS.includes(k)) return refusal('AFM_BUILDER_V4_UNKNOWN_MEMBER', `$.${k}`);
  }
  for (const k of COMPILE_KEYS) {
    if (!own(value, k)) return refusal('AFM_BUILDER_V4_MISSING_MEMBER', `$.${k}`);
  }

  // Invoke: the complete, sandboxed argv (no shell). First entry must be the
  // exact compiler binary name for this rung (swiftc); every entry is a plain
  // bounded string without control characters.
  if (!Array.isArray(value.invoke) || value.invoke.length === 0 || value.invoke.length > limits.argvMax) {
    return refusal('AFM_BUILDER_V4_COMPILE', '$.invoke');
  }
  const invoke = [];
  for (let i = 0; i < value.invoke.length; i++) {
    const entry = value.invoke[i];
    if (typeof entry !== 'string' || entry.length === 0 || entry.length > limits.argvEntryLength || CONTROL.test(entry)) {
      return refusal('AFM_BUILDER_V4_COMMAND', `$.invoke[${i}]`);
    }
    if (i === 0 && entry !== SWIFTC) return refusal('AFM_BUILDER_V4_COMMAND', '$.invoke[0]');
    invoke.push(entry);
  }

  // Sources: staged file pins. Container and key problems are the source-SET
  // level (COMPILE); a bad sha256 pin is PIN at the name.
  if (!plain(value.sources)) return refusal('AFM_BUILDER_V4_COMPILE', '$.sources');
  const names = Object.keys(value.sources);
  if (names.length === 0 || names.length > limits.sources) return refusal('AFM_BUILDER_V4_COMPILE', '$.sources');
  const sources = {};
  for (const name of names) {
    if (!isNonEmptyString(name) || name.length > limits.sourceNameLength || name.includes('/') || name.includes('..') ||
        CONTROL.test(name) || name === '.' || name === '..' || name === '__proto__' || name === 'constructor') {
      return refusal('AFM_BUILDER_V4_COMPILE', '$.sources');
    }
    const sha = value.sources[name];
    if (typeof sha !== 'string' || !HEX64.test(sha)) {
      return refusal('AFM_BUILDER_V4_PIN', `$.sources.${name}`);
    }
    sources[name] = sha;
  }

  if (!isNonEmptyString(value.output) || value.output.length > limits.outputNameLength || value.output.includes('/') ||
      value.output.includes('..') || CONTROL.test(value.output) || value.output === '.' || value.output === '..' ||
      value.output === '__proto__' || value.output === 'constructor') {
    return refusal('AFM_BUILDER_V4_COMPILE', '$.output');
  }

  if (typeof value.manifestHash !== 'string' || !HEX64.test(value.manifestHash)) {
    return refusal('AFM_BUILDER_V4_PIN', '$.manifestHash');
  }

  if (!plain(value.budget)) return refusal('AFM_BUILDER_V4_COMPILE', '$.budget');
  for (const k of Object.keys(value.budget)) {
    if (!BUDGET_KEYS.includes(k)) return refusal('AFM_BUILDER_V4_UNKNOWN_MEMBER', `$.budget.${k}`);
  }
  for (const k of BUDGET_KEYS) {
    if (!own(value.budget, k)) return refusal('AFM_BUILDER_V4_MISSING_MEMBER', `$.budget.${k}`);
  }
  const timeoutSeconds = value.budget.timeoutSeconds;
  if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > limits.invokeTimeoutSeconds) {
    return refusal('AFM_BUILDER_V4_BUDGET', '$.budget.timeoutSeconds');
  }
  const outputBytes = value.budget.outputBytes;
  if (!Number.isSafeInteger(outputBytes) || outputBytes < 1 || outputBytes > limits.outputBytes) {
    return refusal('AFM_BUILDER_V4_BUDGET', '$.budget.outputBytes');
  }

  const compilePolicy = deepFreeze({
    invoke: Object.freeze(invoke),
    sources,
    output: value.output,
    manifestHash: value.manifestHash,
    budget: deepFreeze({ timeoutSeconds, outputBytes })
  });
  return Object.freeze({ ok: true, profile: AFM_INTERNAL_BUILDER_V4_PROFILE, compilePolicy });
}

const writePlanNameSet = (writes) => {
  const set = {};
  for (const w of writes) set[w.name] = true;
  return set;
};

/**
 * Maps an accepted rung-3 write plan onto a sandboxed staged compile into a typed compile plan.
 * @param {unknown} writePlanResult — result from rung-3 write plan acceptance
 * @param {unknown} compilePolicy — validated compile policy
 * @returns {{ ok: boolean, profile: string, ... }} staged compile plan result
 */
function planStagedCompileV1(writePlanResult, compilePolicy) {
  const limits = AFM_INTERNAL_BUILDER_V4_LIMITS_V1;
  const bad = (path) => refusal('AFM_BUILDER_V4_INVOKE', path);

  // Write-plan side: an accepted rung-3 write-plan result, fully re-validated
  // (deep pins, lane/writes shape, bounds) so a hostile or mutated result
  // cannot smuggle a different source of authority.
  const snapWp = snapshotOrRefuseRoot(writePlanResult);
  if (!snapWp.ok || !plain(snapWp.value)) return bad('$.writePlan');
  const value = snapWp.value;
  if (value.ok !== true || value.profile !== V3_WRITEPLAN_PROFILE || !plain(value.writePlan)) return bad('$.writePlan');
  if (Object.keys(value).length !== 3) return bad('$.writePlan');
  const wp = value.writePlan;
  for (const k of Object.keys(wp)) {
    if (!V3_WRITEPLAN_KEYS.includes(k)) return bad('$.writePlan');
  }
  for (const k of V3_WRITEPLAN_KEYS) {
    if (!own(wp, k)) return bad('$.writePlan');
  }
  if (typeof wp.lane !== 'string' || wp.lane.length === 0 || wp.lane.length > limits.laneLength ||
      CONTROL.test(wp.lane) || wp.lane.startsWith('/') || wp.lane.includes('..')) return bad('$.writePlan');
  if (!Array.isArray(wp.writes) || wp.writes.length === 0 || wp.writes.length > WRITES_MAX) return bad('$.writePlan');
  let sum = 0;
  const staged = {};
  for (const w of wp.writes) {
    if (!plain(w) || Object.keys(w).length !== 3 || !own(w, 'path') || !own(w, 'name') || !own(w, 'bytes')) return bad('$.writePlan');
    if (typeof w.name !== 'string' || w.name.length === 0 || w.name.length > limits.sourceNameLength ||
        w.name.includes('/') || w.name.includes('..') || CONTROL.test(w.name)) return bad('$.writePlan');
    if (typeof w.path !== 'string' || w.path !== wp.lane + w.name) return bad('$.writePlan');
    if (!Number.isSafeInteger(w.bytes) || w.bytes < 1 || w.bytes > BYTES_PER_FILE) return bad('$.writePlan');
    sum += w.bytes;
    staged[w.name] = true;
  }
  if (!Number.isSafeInteger(wp.totalBytes) || wp.totalBytes !== sum) return bad('$.writePlan');
  if (typeof wp.manifestHash !== 'string' || !HEX64.test(wp.manifestHash)) return bad('$.writePlan');
  if (typeof wp.packHash !== 'string' || !HEX64.test(wp.packHash)) return bad('$.writePlan');
  if (typeof wp.sourcePlanHash !== 'string' || !HEX64.test(wp.sourcePlanHash)) return bad('$.writePlan');
  if (typeof wp.stagingHash !== 'string' || !HEX64.test(wp.stagingHash)) return bad('$.writePlan');
  // Ancestor binding: a rung-3 write-plan result whose stagingHash does not
  // match its own content cannot seed a compile grant (re-derive the rung-3
  // staging-hash formula over the six canonical write-plan fields).
  const ancestorHash = canonicalizeJSONV1(Buffer.from(JSON.stringify({
    writes: wp.writes,
    lane: wp.lane,
    manifestHash: wp.manifestHash,
    packHash: wp.packHash,
    sourcePlanHash: wp.sourcePlanHash,
    totalBytes: wp.totalBytes
  }))).sha256;
  if (wp.stagingHash !== ancestorHash) return bad('$.writePlan');

  // Compile-policy side: re-read through the policy grammar (hostile-getter
  // probe as rungs 2-3).
  const snapPolicy = snapshotOrRefuseRoot(compilePolicy);
  if (!snapPolicy.ok || !plain(snapPolicy.value)) return bad('$.compile');
  try {
    void compilePolicy.invoke;
    void compilePolicy.sources;
    void compilePolicy.output;
    void compilePolicy.manifestHash;
    void compilePolicy.budget;
  } catch {
    return bad('$.compile');
  }
  const reread = readCompilePolicyV1(snapPolicy.value);
  if (!reread.ok) return bad('$.compile');
  const policy = reread.compilePolicy;

  // Cross-rung pin: both sides of the compile settlement must bind to the SAME
  // manifest pin, or the compile grant is refused at the policy pin path.
  if (policy.manifestHash !== wp.manifestHash) return bad('$.manifestHash');

  // Every compile source must be a file the rung-3 write plan staged; an
  // unstaged name is precise per source.
  for (const name of Object.keys(policy.sources)) {
    if (!own(staged, name)) return bad(`$.sources.${name}`);
  }
  // The compiled artifact must not overwrite a pinned staged source.
  if (own(staged, policy.output)) return bad('$.output');

  const sources = [];
  for (const name of Object.keys(policy.sources)) {
    sources.push(Object.freeze({ name, path: wp.lane + name, sha256: policy.sources[name] }));
  }
  const output = Object.freeze({ name: policy.output, path: wp.lane + policy.output });
  const hashParts = {
    invoke: policy.invoke,
    sources,
    output,
    lane: wp.lane,
    manifestHash: wp.manifestHash,
    packHash: wp.packHash,
    sourceStagingHash: wp.stagingHash
  };
  const compilePlan = deepFreeze({
    invoke: policy.invoke,
    sources: Object.freeze(sources),
    output,
    lane: wp.lane,
    manifestHash: wp.manifestHash,
    packHash: wp.packHash,
    sourceStagingHash: wp.stagingHash,
    planHash: stagedCompilePlanHashV1(hashParts),
    budget: policy.budget,
    noNetwork: true
  });
  return Object.freeze({ ok: true, profile: AFM_INTERNAL_BUILDER_V4_PROFILE, compilePlan });
}

/**
 * Computes deterministic SHA-256 hex hash over canonical fields of compile plan.
 * @param {unknown} compilePlan — staged compile plan object
 * @returns {string} sha256 hex string
 */
function stagedCompilePlanHashV1(compilePlan) {
  const seven = {
    invoke: compilePlan.invoke,
    sources: compilePlan.sources,
    output: compilePlan.output,
    lane: compilePlan.lane,
    manifestHash: compilePlan.manifestHash,
    packHash: compilePlan.packHash,
    sourceStagingHash: compilePlan.sourceStagingHash
  };
  return canonicalizeJSONV1(Buffer.from(JSON.stringify(seven))).sha256;
}

/**
 * Renders a self-contained frozen module exporting the compile plan.
 * @param {unknown} compilePlanResult — staged compile plan result object
 * @returns {string} valid Node ESM module source
 */
function stagedCompilePlanSourceV1(compilePlanResult) {
  const limits = AFM_INTERNAL_BUILDER_V4_LIMITS_V1;
  const bad = () => refusal('AFM_BUILDER_V4_INVOKE', '$');
  const snap = snapshotOrRefuseRoot(compilePlanResult);
  if (!snap.ok || !plain(snap.value)) return bad();
  const value = snap.value;
  if (value.ok !== true || value.profile !== AFM_INTERNAL_BUILDER_V4_PROFILE || !plain(value.compilePlan)) return bad();
  if (Object.keys(value).length !== 3) return bad();
  const p = value.compilePlan;
  if (Object.keys(p).length !== 10) return bad();
  if (!Array.isArray(p.invoke) || p.invoke.length === 0 || p.invoke.length > limits.argvMax) return bad();
  for (let i = 0; i < p.invoke.length; i++) {
    if (typeof p.invoke[i] !== 'string' || p.invoke[i].length === 0 || p.invoke[i].length > limits.argvEntryLength || CONTROL.test(p.invoke[i])) return bad();
    if (i === 0 && p.invoke[i] !== SWIFTC) return bad();
  }
  if (typeof p.lane !== 'string' || p.lane.length === 0 || p.lane.length > limits.laneLength ||
      CONTROL.test(p.lane) || p.lane.startsWith('/') || p.lane.includes('..')) return bad();
  if (!Array.isArray(p.sources) || p.sources.length === 0 || p.sources.length > limits.sources) return bad();
  for (const s of p.sources) {
    if (!plain(s) || Object.keys(s).length !== 3 || !own(s, 'name') || !own(s, 'path') || !own(s, 'sha256')) return bad();
    if (typeof s.name !== 'string' || s.name.length === 0 || s.name.length > limits.sourceNameLength ||
        s.name.includes('/') || s.name.includes('..') || CONTROL.test(s.name)) return bad();
    if (typeof s.path !== 'string' || s.path !== p.lane + s.name) return bad();
    if (typeof s.sha256 !== 'string' || !HEX64.test(s.sha256)) return bad();
  }
  if (!plain(p.output) || Object.keys(p.output).length !== 2 || !own(p.output, 'name') || !own(p.output, 'path')) return bad();
  if (typeof p.output.name !== 'string' || p.output.name.length === 0 || p.output.name.length > limits.outputNameLength ||
      p.output.name.includes('/') || p.output.name.includes('..') || CONTROL.test(p.output.name)) return bad();
  if (typeof p.output.path !== 'string' || p.output.path !== p.lane + p.output.name) return bad();
  if (typeof p.manifestHash !== 'string' || !HEX64.test(p.manifestHash)) return bad();
  if (typeof p.packHash !== 'string' || !HEX64.test(p.packHash)) return bad();
  if (typeof p.sourceStagingHash !== 'string' || !HEX64.test(p.sourceStagingHash)) return bad();
  if (typeof p.planHash !== 'string' || !HEX64.test(p.planHash)) return bad();
  if (!plain(p.budget) || Object.keys(p.budget).length !== 2) return bad();
  if (!Number.isSafeInteger(p.budget.timeoutSeconds) || p.budget.timeoutSeconds < 1 || p.budget.timeoutSeconds > limits.invokeTimeoutSeconds) return bad();
  if (!Number.isSafeInteger(p.budget.outputBytes) || p.budget.outputBytes < 1 || p.budget.outputBytes > limits.outputBytes) return bad();
  if (p.noNetwork !== true) return bad();

  const json = JSON.stringify(p);
  return [
    '// Generated by afm-internal-builder-v4 stagedCompilePlanSourceV1. Deterministic, bounded, no-network staged compile plan.',
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
  AFM_INTERNAL_BUILDER_V4_PROFILE,
  AFM_INTERNAL_BUILDER_V4_LIMITS_V1,
  AFM_INTERNAL_BUILDER_V4_CODES_V1,
  readCompilePolicyV1,
  planStagedCompileV1,
  stagedCompilePlanHashV1,
  stagedCompilePlanSourceV1
};