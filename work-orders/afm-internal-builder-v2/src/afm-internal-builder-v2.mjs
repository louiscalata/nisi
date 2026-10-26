import { canonicalizeJSONV1 } from '../../../canonical/canonical-json-v1.mjs';

// PURE-REGION-BEGIN
// AFM internal builder, second capability rung: a deterministic test-run GRANT
// grammar, read-only advisory. Learns the SharedChami two-machine dispatch
// discipline directly: explicit argv with no shell (the worker routes by
// explicit model id, never silent substitution), bounded budgets (the worker
// caps per-lane concurrency and job timeouts), honest degradation becomes
// exact refusal codes, and temp-then-rename atomicity becomes deep-frozen
// outputs. The module never executes anything and never holds acceptance
// authority: it validates a caller-consented grant policy against an accepted
// rung-1 proposal and renders a typed, frozen, bounded run plan whose pins
// (manifestHash, packHash) an oracle/human accept command can verify later.

const AFM_INTERNAL_BUILDER_V2_PROFILE = 'nisi-afm-internal-builder-v2';
const AFM_INTERNAL_BUILDER_V2_LIMITS_V1 = Object.freeze({
  checks: 32,
  checksPerPlan: 3,
  checkNameLength: 64,
  argvMax: 8,
  argvEntryLength: 128,
  timeoutSeconds: 300,
  outputBytes: 1048576
});
const AFM_INTERNAL_BUILDER_V2_CODES_V1 = Object.freeze([
  'AFM_BUILDER_V2_NOT_OBJECT',
  'AFM_BUILDER_V2_UNKNOWN_MEMBER',
  'AFM_BUILDER_V2_MISSING_MEMBER',
  'AFM_BUILDER_V2_GRANT',
  'AFM_BUILDER_V2_COMMAND',
  'AFM_BUILDER_V2_BUDGET',
  'AFM_BUILDER_V2_PIN',
  'AFM_BUILDER_V2_PLAN'
]);

const GRANT_KEYS = ['checks', 'manifestHash', 'budget'];
const BUDGET_KEYS = ['timeoutSeconds', 'outputBytes'];
const V1_PROPOSAL_KEYS = ['proposedStep', 'testsToRun', 'explanation', 'packHash'];
const V1_PROPOSAL_PROFILE = 'nisi-afm-internal-builder-v1';
const HEX64 = /^[0-9a-f]{64}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
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
  return Object.freeze({ ok: false, profile: AFM_INTERNAL_BUILDER_V2_PROFILE, code, path });
}

// One descriptor walk over the input before any validation: only own,
// enumerable, string-keyed data properties; plain objects and plain arrays.
// Accessors, symbols, exotic arrays, cycles and budget overruns all refuse the
// whole input. Anything that throws inside the walk refuses the input too, so
// getters and Proxy traps can never make the readers throw.
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

function readTestRunGrantV1(input) {
  const limits = AFM_INTERNAL_BUILDER_V2_LIMITS_V1;
  const snap = snapshotOrRefuseRoot(input);
  if (!snap.ok || !plain(snap.value)) return refusal('AFM_BUILDER_V2_NOT_OBJECT', '$');
  const value = snap.value;

  for (const k of Object.keys(value)) {
    if (!GRANT_KEYS.includes(k)) return refusal('AFM_BUILDER_V2_UNKNOWN_MEMBER', `$.${k}`);
  }
  for (const k of GRANT_KEYS) {
    if (!own(value, k)) return refusal('AFM_BUILDER_V2_MISSING_MEMBER', `$.${k}`);
  }

  if (typeof value.manifestHash !== 'string' || !HEX64.test(value.manifestHash)) {
    return refusal('AFM_BUILDER_V2_PIN', '$.manifestHash');
  }

  // Command table: key problems are the command-SET level (GRANT at the
  // container), a bad command array is COMMAND at the name, a bad entry is
  // COMMAND at its index.
  if (!plain(value.checks)) return refusal('AFM_BUILDER_V2_GRANT', '$.checks');
  const names = Object.keys(value.checks);
  if (names.length === 0 || names.length > limits.checks) return refusal('AFM_BUILDER_V2_GRANT', '$.checks');
  const grantChecks = {};
  for (const name of names) {
    if (!isNonEmptyString(name) || name.length > limits.checkNameLength) return refusal('AFM_BUILDER_V2_GRANT', '$.checks');
    const argv = value.checks[name];
    if (!Array.isArray(argv) || argv.length === 0 || argv.length > limits.argvMax) {
      return refusal('AFM_BUILDER_V2_COMMAND', `$.checks.${name}`);
    }
    const copy = [];
    for (let i = 0; i < argv.length; i++) {
      const entry = argv[i];
      if (typeof entry !== 'string' || entry.length === 0 || entry.length > limits.argvEntryLength || CONTROL.test(entry)) {
        return refusal('AFM_BUILDER_V2_COMMAND', `$.checks.${name}[${i}]`);
      }
      copy.push(entry);
    }
    if (name === '__proto__' || name === 'constructor') return refusal('AFM_BUILDER_V2_GRANT', '$.checks');
    grantChecks[name] = Object.freeze(copy);
  }

  if (!plain(value.budget)) return refusal('AFM_BUILDER_V2_GRANT', '$.budget');
  for (const k of Object.keys(value.budget)) {
    if (!BUDGET_KEYS.includes(k)) return refusal('AFM_BUILDER_V2_UNKNOWN_MEMBER', `$.budget.${k}`);
  }
  for (const k of BUDGET_KEYS) {
    if (!own(value.budget, k)) return refusal('AFM_BUILDER_V2_MISSING_MEMBER', `$.budget.${k}`);
  }
  const timeoutSeconds = value.budget.timeoutSeconds;
  if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > limits.timeoutSeconds) {
    return refusal('AFM_BUILDER_V2_BUDGET', '$.budget.timeoutSeconds');
  }
  const outputBytes = value.budget.outputBytes;
  if (!Number.isSafeInteger(outputBytes) || outputBytes < 1 || outputBytes > limits.outputBytes) {
    return refusal('AFM_BUILDER_V2_BUDGET', '$.budget.outputBytes');
  }

  const grant = {
    checks: grantChecks,
    manifestHash: value.manifestHash,
    budget: { timeoutSeconds, outputBytes }
  };
  return Object.freeze({ ok: true, profile: AFM_INTERNAL_BUILDER_V2_PROFILE, grant: deepFreeze(grant) });
}

// Deterministic plan hash over the five canonical plan fields: runs,
// manifestHash, packHash, budget. Canonicalized JSON, sha256 hex. Only pass a
// plan returned by planDeterministicTestRunV1; anything outside the codec
// grammar throws a coded canonicalizeJSONV1 error (same contract as the
// rung-1 pack hash).
function testRunPlanHashV1(plan) {
  const five = {
    runs: plan.runs,
    manifestHash: plan.manifestHash,
    packHash: plan.packHash,
    budget: plan.budget
  };
  return canonicalizeJSONV1(Buffer.from(JSON.stringify(five))).sha256;
}

// One settlement between an accepted rung-1 proposal and a caller-consented
// grant. Proposal-side problems refuse at '$.proposal'; grant-side problems at
// '$.grant'. A grant whose command table shares no run target with the
// proposal is a grant-vs-proposal mismatch ('$.grant'); when at least one
// target matches, an unmatched entry is precise ('$.testsToRun[i]').
function planDeterministicTestRunV1(proposalResult, grantPolicy) {
  const limits = AFM_INTERNAL_BUILDER_V2_LIMITS_V1;
  const bad = (path) => refusal('AFM_BUILDER_V2_PLAN', path);

  const snapProp = snapshotOrRefuseRoot(proposalResult);
  if (!snapProp.ok || !plain(snapProp.value)) return bad('$.proposal');
  const pr = snapProp.value;
  if (pr.ok !== true || pr.profile !== V1_PROPOSAL_PROFILE || !plain(pr.proposal)) return bad('$.proposal');
  if (Object.keys(pr).length !== 3) return bad('$.proposal');
  const pp = pr.proposal;
  for (const k of Object.keys(pp)) {
    if (!V1_PROPOSAL_KEYS.includes(k)) return bad('$.proposal');
  }
  for (const k of V1_PROPOSAL_KEYS) {
    if (!own(pp, k)) return bad('$.proposal');
  }
  if (!isNonEmptyString(pp.proposedStep)) return bad('$.proposal');
  if (!Array.isArray(pp.testsToRun) || pp.testsToRun.length === 0 || pp.testsToRun.length > limits.checksPerPlan) return bad('$.proposal');
  for (const c of pp.testsToRun) {
    if (!isNonEmptyString(c)) return bad('$.proposal');
  }
  if (typeof pp.explanation !== 'string' || pp.explanation.length < 1) return bad('$.proposal');
  if (typeof pp.packHash !== 'string' || !HEX64.test(pp.packHash)) return bad('$.proposal');

  // Grant re-read plus a bounded raw probe (rung-1 hardened pattern): a Proxy
  // whose get trap throws passes the descriptor walk untouched; the probe turns
  // such a hostile grant into a root refusal instead of a misleading member
  // path. Plain grants are unaffected; validation reads the snapshot.
  const snapGrant = snapshotOrRefuseRoot(grantPolicy);
  if (!snapGrant.ok || !plain(snapGrant.value)) return bad('$.grant');
  try {
    void grantPolicy.checks;
    void grantPolicy.manifestHash;
    void grantPolicy.budget;
  } catch {
    return bad('$.grant');
  }
  const reread = readTestRunGrantV1(snapGrant.value);
  if (!reread.ok) return bad('$.grant');
  const g = reread.grant;

  const tests = pp.testsToRun;
  let covered = 0;
  for (const t of tests) {
    if (own(g.checks, t)) covered++;
  }
  if (covered === 0) return bad('$.grant');
  const runs = [];
  for (let i = 0; i < tests.length; i++) {
    const t = tests[i];
    if (!own(g.checks, t)) return bad(`$.testsToRun[${i}]`);
    runs.push(Object.freeze({ check: t, argv: g.checks[t] }));
  }

  const budget = { timeoutSeconds: g.budget.timeoutSeconds, outputBytes: g.budget.outputBytes };
  const plan = {
    runs: Object.freeze(runs),
    manifestHash: g.manifestHash,
    packHash: pp.packHash,
    budget: Object.freeze(budget),
    planHash: testRunPlanHashV1({ runs, manifestHash: g.manifestHash, packHash: pp.packHash, budget })
  };
  return Object.freeze({ ok: true, profile: AFM_INTERNAL_BUILDER_V2_PROFILE, plan: deepFreeze(plan) });
}

// Render an accepted plan result as a self-contained frozen ESM module source
// (no imports; default-exports the deep-frozen result). The generated source
// always passes `node --check`. Anything that is not an accepted plan result
// returns the AFM_BUILDER_V2_PLAN refusal; never throws.
function testRunPlanSourceV1(planResult) {
  const limits = AFM_INTERNAL_BUILDER_V2_LIMITS_V1;
  const bad = () => refusal('AFM_BUILDER_V2_PLAN', '$');
  const snap = snapshotOrRefuseRoot(planResult);
  if (!snap.ok || !plain(snap.value)) return bad();
  const value = snap.value;
  if (value.ok !== true || value.profile !== AFM_INTERNAL_BUILDER_V2_PROFILE || !plain(value.plan)) return bad();
  if (Object.keys(value).length !== 3) return bad();
  const p = value.plan;
  if (Object.keys(p).length !== 5) return bad();
  if (!Array.isArray(p.runs) || p.runs.length === 0 || p.runs.length > limits.checksPerPlan) return bad();
  for (const run of p.runs) {
    if (!plain(run) || Object.keys(run).length !== 2 || !isNonEmptyString(run.check) ||
        !Array.isArray(run.argv) || run.argv.length === 0 || run.argv.length > limits.argvMax) return bad();
    for (const a of run.argv) {
      if (typeof a !== 'string' || a.length === 0 || a.length > limits.argvEntryLength || CONTROL.test(a)) return bad();
    }
  }
  if (typeof p.manifestHash !== 'string' || !HEX64.test(p.manifestHash)) return bad();
  if (typeof p.packHash !== 'string' || !HEX64.test(p.packHash)) return bad();
  if (!plain(p.budget) || Object.keys(p.budget).length !== 2) return bad();
  if (!Number.isSafeInteger(p.budget.timeoutSeconds) || p.budget.timeoutSeconds < 1 || p.budget.timeoutSeconds > limits.timeoutSeconds) return bad();
  if (!Number.isSafeInteger(p.budget.outputBytes) || p.budget.outputBytes < 1 || p.budget.outputBytes > limits.outputBytes) return bad();
  if (typeof p.planHash !== 'string' || !HEX64.test(p.planHash)) return bad();

  const json = JSON.stringify({
    ok: true, profile: AFM_INTERNAL_BUILDER_V2_PROFILE,
    plan: { runs: p.runs, manifestHash: p.manifestHash, packHash: p.packHash, budget: p.budget, planHash: p.planHash }
  });
  return [
    '// Generated by afm-internal-builder-v2 testRunPlanSourceV1. Deterministic, bounded, read-only run plan.',
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
  AFM_INTERNAL_BUILDER_V2_PROFILE,
  AFM_INTERNAL_BUILDER_V2_LIMITS_V1,
  AFM_INTERNAL_BUILDER_V2_CODES_V1,
  readTestRunGrantV1,
  planDeterministicTestRunV1,
  testRunPlanHashV1,
  testRunPlanSourceV1
};