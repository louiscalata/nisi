import { canonicalizeJSONV1 } from '../../../canonical/canonical-json-v1.mjs';

// PURE-REGION-BEGIN
// AFM internal builder, first increment: a read-only advisory lane. Given a
// state pack (validated, frozen), a deterministic caller-provided policy yields
// a typed Proposal (one allowed step, up to three allowed checks, an
// explanation, and the pack hash), and the accepted proposal can be rendered
// as a self-contained frozen ESM module source that passes `node --check`.
// No writes, no compilation, no network, no model calls, no acceptance
// authority: acceptance stays with oracle/human accept commands.

const AFM_BUILDER_PROFILE_V1 = 'nisi-afm-internal-builder-v1';
const AFM_BUILDER_LIMITS_V1 = Object.freeze({
  receipts: 16,
  steps: 16,
  checks: 16,
  checksPerProposal: 3,
  explanationLength: 512
});
const AFM_BUILDER_CODES_V1 = Object.freeze([
  'AFM_BUILDER_NOT_OBJECT',
  'AFM_BUILDER_UNKNOWN_MEMBER',
  'AFM_BUILDER_MISSING_MEMBER',
  'AFM_BUILDER_SCHEMA_VERSION',
  'AFM_BUILDER_PROJECT',
  'AFM_BUILDER_WORK_ORDER',
  'AFM_BUILDER_ALLOWED_STEPS',
  'AFM_BUILDER_ALLOWED_CHECKS',
  'AFM_BUILDER_RECEIPTS',
  'AFM_BUILDER_PROPOSAL'
]);

const ROOT_KEYS = ['schemaVersion', 'project', 'roadmapDigest', 'workOrder', 'lastReceipts', 'allowedSteps', 'allowedChecks'];
const WORK_ORDER_KEYS = ['id', 'goal', 'acceptance'];
const POLICY_KEYS = ['step', 'checks', 'explanation'];
const HEX64 = /^[0-9a-f]{64}$/;
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
  return Object.freeze({ ok: false, profile: AFM_BUILDER_PROFILE_V1, code, path });
}

// One descriptor walk over the input before any validation: only own,
// enumerable, string-keyed data properties; plain objects and plain arrays.
// Accessors, symbols, exotic arrays, cycles and budget overruns all refuse the
// whole input. Anything that throws inside the walk refuses the input too, so
// getters and Proxy traps can never make the reader throw.
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

// String-array contract for allowedSteps / allowedChecks: non-empty, bounded,
// unique, every entry a non-empty string. Returns null when valid, otherwise
// { kind, index }: 'type'/'size'/'dup' are set-level problems (reported at the
// array path), while 'entry' is an element problem (reported at its index).
function stringArrayProblem(a, max) {
  if (!Array.isArray(a)) return { kind: 'type' };
  if (a.length === 0 || a.length > max) return { kind: 'size' };
  const seen = new Set();
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (!isNonEmptyString(v)) return { kind: 'entry', index: i };
    if (seen.has(v)) return { kind: 'dup', index: i };
    seen.add(v);
  }
  return null;
}

function readAfmBuilderPackV1(input) {
  const limits = AFM_BUILDER_LIMITS_V1;
  const snap = snapshotOrRefuseRoot(input);
  if (!snap.ok || !plain(snap.value)) return refusal('AFM_BUILDER_NOT_OBJECT', '$');
  const value = snap.value;

  for (const k of Object.keys(value)) {
    if (!ROOT_KEYS.includes(k)) return refusal('AFM_BUILDER_UNKNOWN_MEMBER', `$.${k}`);
  }
  for (const k of ROOT_KEYS) {
    if (!own(value, k)) return refusal('AFM_BUILDER_MISSING_MEMBER', `$.${k}`);
  }

  if (value.schemaVersion !== 1) return refusal('AFM_BUILDER_SCHEMA_VERSION', '$.schemaVersion');
  if (!isNonEmptyString(value.project)) return refusal('AFM_BUILDER_PROJECT', '$.project');
  if (typeof value.roadmapDigest !== 'string' || !HEX64.test(value.roadmapDigest)) {
    return refusal('AFM_BUILDER_PROJECT', '$.roadmapDigest');
  }

  if (!plain(value.workOrder)) return refusal('AFM_BUILDER_WORK_ORDER', '$.workOrder');
  for (const k of Object.keys(value.workOrder)) {
    if (!WORK_ORDER_KEYS.includes(k)) return refusal('AFM_BUILDER_UNKNOWN_MEMBER', `$.workOrder.${k}`);
  }
  for (const k of WORK_ORDER_KEYS) {
    if (!own(value.workOrder, k)) return refusal('AFM_BUILDER_MISSING_MEMBER', `$.workOrder.${k}`);
  }
  for (const k of WORK_ORDER_KEYS) {
    if (!isNonEmptyString(value.workOrder[k])) return refusal('AFM_BUILDER_WORK_ORDER', `$.workOrder.${k}`);
  }

  if (!Array.isArray(value.lastReceipts)) return refusal('AFM_BUILDER_RECEIPTS', '$.lastReceipts');
  if (value.lastReceipts.length > limits.receipts) return refusal('AFM_BUILDER_RECEIPTS', '$.lastReceipts');
  for (let i = 0; i < value.lastReceipts.length; i++) {
    if (!isNonEmptyString(value.lastReceipts[i])) return refusal('AFM_BUILDER_RECEIPTS', `$.lastReceipts[${i}]`);
  }

  const stepsProblem = stringArrayProblem(value.allowedSteps, limits.steps);
  if (stepsProblem) {
    if (stepsProblem.kind === 'entry') return refusal('AFM_BUILDER_ALLOWED_STEPS', `$.allowedSteps[${stepsProblem.index}]`);
    return refusal('AFM_BUILDER_ALLOWED_STEPS', '$.allowedSteps');
  }
  const checksProblem = stringArrayProblem(value.allowedChecks, limits.checks);
  if (checksProblem) {
    if (checksProblem.kind === 'entry') return refusal('AFM_BUILDER_ALLOWED_CHECKS', `$.allowedChecks[${checksProblem.index}]`);
    return refusal('AFM_BUILDER_ALLOWED_CHECKS', '$.allowedChecks');
  }

  const pack = {
    schemaVersion: 1,
    project: value.project,
    roadmapDigest: value.roadmapDigest,
    workOrder: {
      id: value.workOrder.id,
      goal: value.workOrder.goal,
      acceptance: value.workOrder.acceptance
    },
    lastReceipts: Object.freeze(value.lastReceipts.slice()),
    allowedSteps: Object.freeze(value.allowedSteps.slice()),
    allowedChecks: Object.freeze(value.allowedChecks.slice())
  };
  return Object.freeze({ ok: true, profile: AFM_BUILDER_PROFILE_V1, pack: deepFreeze(pack) });
}

// Deterministic pack hash over the five identity members of a READ pack:
// allowedChecks, allowedSteps, project, roadmapDigest, workOrder. Receipts are
// deliberately excluded (history, not identity). Only pass a pack returned by
// readAfmBuilderPackV1; anything outside the codec grammar throws a coded
// canonicalizeJSONV1 error.
function afmBuilderPackHashV1(pack) {
  const five = {
    allowedChecks: pack.allowedChecks,
    allowedSteps: pack.allowedSteps,
    project: pack.project,
    roadmapDigest: pack.roadmapDigest,
    workOrder: pack.workOrder
  };
  return canonicalizeJSONV1(Buffer.from(JSON.stringify(five))).sha256;
}

function proposeAfmBuilderStepV1(readPackResult, policy) {
  const limits = AFM_BUILDER_LIMITS_V1;
  const bad = (path) => refusal('AFM_BUILDER_PROPOSAL', path);

  let pack;
  const snapRead = snapshotOrRefuseRoot(readPackResult);
  if (!snapRead.ok || !plain(snapRead.value)) return bad('$');
  const readValue = snapRead.value;
  if (readValue.ok !== true || readValue.profile !== AFM_BUILDER_PROFILE_V1 || !plain(readValue.pack)) return bad('$');
  const reread = readAfmBuilderPackV1(readValue.pack);
  if (!reread.ok) return bad('$');
  pack = reread.pack;

  const snapPolicy = snapshotOrRefuseRoot(policy);
  if (!snapPolicy.ok || !plain(snapPolicy.value)) return bad('$');
  // Probe the RAW policy members once: a Proxy whose get trap throws passes the
  // descriptor walk untouched, so this access (fully guarded) is what turns a
  // hostile policy into a root refusal instead of a misleading member path.
  // Plain data policies are unaffected and later validation reads the snapshot.
  try {
    void policy.step;
    void policy.checks;
    void policy.explanation;
  } catch {
    return bad('$');
  }
  const pol = snapPolicy.value;
  for (const k of Object.keys(pol)) {
    if (!POLICY_KEYS.includes(k)) return bad(`$.${k}`);
  }
  for (const k of POLICY_KEYS) {
    if (!own(pol, k)) return bad(`$.${k}`);
  }

  if (typeof pol.step !== 'string' || !pack.allowedSteps.includes(pol.step)) return bad('$.step');
  if (!Array.isArray(pol.checks) || pol.checks.length === 0 || pol.checks.length > limits.checksPerProposal) return bad('$.checks');
  const seen = new Set();
  for (let i = 0; i < pol.checks.length; i++) {
    const c = pol.checks[i];
    if (typeof c !== 'string' || !pack.allowedChecks.includes(c) || seen.has(c)) return bad('$.checks');
    seen.add(c);
  }
  if (typeof pol.explanation !== 'string' || pol.explanation.length < 1 || pol.explanation.length > limits.explanationLength) {
    return bad('$.explanation');
  }

  const proposal = {
    proposedStep: pol.step,
    testsToRun: Object.freeze(pol.checks.slice()),
    explanation: pol.explanation,
    packHash: afmBuilderPackHashV1(pack)
  };
  return Object.freeze({ ok: true, profile: AFM_BUILDER_PROFILE_V1, proposal: deepFreeze(proposal) });
}

// Render an accepted proposal result as a self-contained frozen ESM module
// source (no imports; default-exports the deep-frozen result). The generated
// source always passes `node --check`. Anything that is not an accepted
// proposal result returns the AFM_BUILDER_PROPOSAL refusal; never throws.
function proposalModuleSourceV1(proposalResult) {
  const limits = AFM_BUILDER_LIMITS_V1;
  const bad = () => refusal('AFM_BUILDER_PROPOSAL', '$');
  const snap = snapshotOrRefuseRoot(proposalResult);
  if (!snap.ok || !plain(snap.value)) return bad();
  const value = snap.value;
  if (value.ok !== true || value.profile !== AFM_BUILDER_PROFILE_V1 || !plain(value.proposal)) return bad();
  if (Object.keys(value).length !== 3 || Object.keys(value.proposal).length !== 4) return bad();
  const p = value.proposal;
  if (!isNonEmptyString(p.proposedStep)) return bad();
  if (!Array.isArray(p.testsToRun) || p.testsToRun.length === 0 || p.testsToRun.length > limits.checksPerProposal) return bad();
  for (const c of p.testsToRun) {
    if (!isNonEmptyString(c)) return bad();
  }
  if (typeof p.explanation !== 'string' || p.explanation.length < 1 || p.explanation.length > limits.explanationLength) return bad();
  if (typeof p.packHash !== 'string' || !HEX64.test(p.packHash)) return bad();

  const json = JSON.stringify({ ok: true, profile: AFM_BUILDER_PROFILE_V1, proposal: p });
  return [
    '// Generated by afm-internal-builder-v1 proposalModuleSourceV1. Read-only advisory proposal.',
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
  AFM_BUILDER_PROFILE_V1,
  AFM_BUILDER_LIMITS_V1,
  AFM_BUILDER_CODES_V1,
  readAfmBuilderPackV1,
  afmBuilderPackHashV1,
  proposeAfmBuilderStepV1,
  proposalModuleSourceV1
};
