// Private typed task/response/combiner coordination contract (BN01-C09).
// Pure declarations/contract only: no model execution, no permission minting,
// no CPU/work-slot scheduling, no device resources, no caller-supplied paths
// or model objects are resolved. Results are advisory decisions, never PASS.
//
// Fully dependency-free by design: this repo copy has no node_modules installed
// (ajv is not runnable here), so both the base/dual declaration binding and the
// typed envelope checks use bounded field validation only. Owned canonical raw
// bytes in, closed frozen results out.
import { createHash } from 'node:crypto';

const ROLES = Object.freeze(['PROTON', 'ELECTRON', 'NEUTRON']);
const FLAGS = Object.freeze({ authorizing: false, modelExecuted: false,
  promotionGranted: false, certificationGranted: false });
const answer = (ok, code, fields = {}) => Object.freeze({ ok, code, ...fields, ...FLAGS });
const fail = code => answer(false, code);
const isID = v => typeof v === 'string' && v.length >= 1 && v.length <= 96 && /^[a-z][a-z0-9_.-]*(?![\s\S])/.test(v);
const isHash = v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const isInt = (v, min, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && v >= min && v <= max;
const isPlain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isROLE = v => ROLES.includes(v);
const keysEqual = (value, expected) => isPlain(value) && Object.keys(value).sort().join('\0') === [...expected].sort().join('\0');

// Profile-specific ASCII canonical encoding (deliberately not JCS).
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function hash(record) {
  return createHash('sha256').update(`veritas/contribution/${record.kind}\0`).update(canonical(record)).digest('hex');
}

const CONTRIBUTOR_KEYS = Object.freeze(['kind', 'contributorId', 'role', 'revision', 'outputWidth', 'outputSpaceSha256', 'maxPayloadBytes']);
const TASK_KEYS = Object.freeze(['kind', 'taskId', 'requester', 'graphSha256', 'runSha256', 'topologySha256', 'planSha256', 'generation', 'requiredContributors', 'deadlineMs']);
const RESPONSE_KEYS = Object.freeze(['kind', 'contributorId', 'role', 'taskId', 'taskDigest', 'outcome']);
const REQ_KEYS = Object.freeze(['role', 'contributorId', 'channelId', 'fromPortId', 'toPortId']);

function contributorValid(value) {
  if (!keysEqual(value, CONTRIBUTOR_KEYS)) return false;
  return value.kind === 'veritas-contribution-contributor-v1' && isID(value.contributorId) &&
    isROLE(value.role) && isInt(value.revision, 1, 1000000) && isInt(value.outputWidth, 1, 4096) &&
    isHash(value.outputSpaceSha256) && isInt(value.maxPayloadBytes, 1, 65536);
}
function reqValid(v) {
  if (!keysEqual(v, REQ_KEYS)) return false;
  return isROLE(v.role) && isID(v.contributorId) && isID(v.channelId) && isID(v.fromPortId) && isID(v.toPortId);
}
function taskValid(value) {
  if (!keysEqual(value, TASK_KEYS)) return false;
  if (value.kind !== 'veritas-contribution-task-v1' || value.requester !== 'PRIMARY') return false;
  if (!isID(value.taskId) || !isHash(value.graphSha256) || !isHash(value.runSha256) || !isHash(value.topologySha256) || !isHash(value.planSha256)) return false;
  if (!isInt(value.generation, 1) || !isInt(value.deadlineMs, 1, 60000)) return false;
  if (!Array.isArray(value.requiredContributors) || value.requiredContributors.length < 1 || value.requiredContributors.length > 3) return false;
  return value.requiredContributors.every(reqValid);
}
function responseValid(value) {
  if (!keysEqual(value, RESPONSE_KEYS)) return false;
  return value.kind === 'veritas-contribution-response-v1' && isID(value.contributorId) &&
    isROLE(value.role) && isID(value.taskId) && isHash(value.taskDigest) &&
    ['SUCCESS', 'FAILURE', 'REFUSED'].includes(value.outcome);
}

const finiteF32 = (buffer, width) => {
  if (!Buffer.isBuffer(buffer) || buffer.length !== 4 * width || buffer.buffer instanceof SharedArrayBuffer) return false;
  for (let i = 0; i < buffer.length; i += 4) if (!Number.isFinite(buffer.readFloatLE(i))) return false;
  return true;
};

function ownedU8(value, maximum) {
  if (!Buffer.isBuffer(value) || value.length === 0 || value.length > maximum) return null;
  if (value.buffer instanceof SharedArrayBuffer) return null;
  return Buffer.from(value);
}

// ---- bounded base/dual binding (dependency-free mirror of the shared checks) ----
const BASE_KEYS = Object.freeze(['graph', 'plugins', 'predecessors', 'profile', 'run', 'schemaVersion']);
const DUAL_KEYS = Object.freeze(['plan', 'profile', 'schemaVersion', 'topology']);
const TENSOR_KEYS = Object.freeze(['dtype', 'spaceSha256', 'width']);
const CHANNEL_KEYS = Object.freeze(['channelId', 'fromPortId', 'hopLimit', 'linkId', 'maxPayloadBytes', 'permission', 'queueLimit', 'toPortId', 'ttlMs']);
const ROUTE_KEYS = Object.freeze(['channelId', 'fromNodeId', 'toNodeId']);

function parseOwned(buffer, maximum) {
  const copy = ownedU8(buffer, maximum);
  if (!copy) return null;
  try { return JSON.parse(copy.toString('utf8')); }
  catch { return null; }
}
function binding(baseValue, dualValue) {
  const base = { graph: baseValue?.graph, plugins: baseValue?.plugins,
    run: baseValue?.run, profile: baseValue?.profile, schemaVersion: baseValue?.schemaVersion, predecessors: baseValue?.predecessors };
  const dual = { plan: dualValue?.plan, topology: dualValue?.topology, profile: dualValue?.profile, schemaVersion: dualValue?.schemaVersion };
  try {
    if (!keysEqual(baseValue, BASE_KEYS) || !keysEqual(dualValue, DUAL_KEYS)) return null;
    if (base.schemaVersion !== 1 || base.profile !== 'veritas-bn01-offline-contract-v1') return null;
    if (dual.schemaVersion !== 1 || dual.profile !== 'veritas-bn01-dual-face-v1') return null;
    if (!isHash(base.graph.sha256) || !isHash(base.run.sha256) || !isHash(base.graph.record?.graphSha256 ?? base.graph.sha256)) return null;
    if (!isHash(dual.topology.sha256) || !isHash(dual.plan.sha256)) return null;
    if (!isPlain(base.graph.record) || !isPlain(base.run.record) || !isPlain(dual.topology.record) || !isPlain(dual.plan.record)) return null;
    if (!Array.isArray(base.graph.record.nodes) || !Array.isArray(base.plugins) ||
        !Array.isArray(dual.topology.record.channels) || !Array.isArray(dual.plan.record.routes)) return null;
  } catch { return null; }
  return { base, dual };
}

class TaskResponseCombiner {
  #contributors = new Map();
  // Digests of tasks that actually passed admitTask. combine() refuses anything
  // absent here, so a task refused at the route, endpoint, tensor or duplicate
  // gate can never reach a COMBINED certificate.
  #admittedTasks = new Set();
  #taskPins = null;

  constructor(base, dual, generation) {
    const pins = {
      graphSha256: base.graph.sha256, runSha256: base.run.sha256,
      topologySha256: dual.topology.sha256, planSha256: dual.plan.sha256,
      generation,
    };
    const nodes = new Map(base.graph.record.nodes.map(n => [n.nodeId, n]));
    const plugins = new Map(base.plugins.map(e => [e.sha256, e.record]));
    const channels = new Map(dual.topology.record.channels.map(c => [c.channelId, c]));
    const routes = new Map(dual.plan.record.routes.map(r => [r.channelId, {
      channel: channels.get(r.channelId),
      tensor: plugins.get(nodes.get(r.fromNodeId)?.revisionSha256)?.output,
    }]));
    this.#taskPins = Object.freeze({ ...pins, routes, plugins });
  }

  #resolveContributor(roleOrId) {
    return this.#contributors.get(roleOrId) ?? null;
  }

  admitContributor(text) {
    let value;
    try { value = JSON.parse(text); }
    catch { return fail('JSON_INVALID'); }
    if (canonical(value) !== text) return fail('CONTRIBUTOR_NONCANONICAL');
    if (!contributorValid(value)) return fail('CONTRIBUTOR_SCHEMA_INVALID');
    if (this.#contributors.has(value.role) || this.#contributors.has(value.contributorId)) return fail('CONTRIBUTOR_DUPLICATE');
    if (!this.#declaredOutputSpace(value.outputSpaceSha256, value.outputWidth)) return fail('CONTRIBUTOR_TENSOR_UNKNOWN');
    const entry = Object.freeze({ ...value, digest: hash(value) });
    this.#contributors.set(value.role, entry);
    this.#contributors.set(value.contributorId, entry);
    return answer(true, 'CONTRIBUTOR_ADMITTED', { contributorId: value.contributorId, role: value.role });
  }

  #declaredOutputSpace(spaceSha256, width) {
    for (const plugin of this.#taskPins.plugins.values()) {
      if (plugin.output?.spaceSha256 === spaceSha256 && plugin.output?.width === width) return true;
    }
    return false;
  }

  admitTask(text) {
    let value;
    try { value = JSON.parse(text); }
    catch { return fail('JSON_INVALID'); }
    if (canonical(value) !== text) return fail('TASK_NONCANONICAL');
    if (!taskValid(value)) return fail('TASK_SCHEMA_INVALID');
    if (value.graphSha256 !== this.#taskPins.graphSha256 || value.runSha256 !== this.#taskPins.runSha256 ||
        value.topologySha256 !== this.#taskPins.topologySha256 || value.planSha256 !== this.#taskPins.planSha256) return fail('TASK_IDENTITY_MISMATCH');
    if (value.generation !== this.#taskPins.generation) return fail('TASK_GENERATION_MISMATCH');
    const seenRoles = new Set(), seenIds = new Set();
    for (const req of value.requiredContributors) {
      if (seenRoles.has(req.role) || seenIds.has(req.contributorId)) return fail('TASK_CONTRIBUTOR_DUPLICATE');
      seenRoles.add(req.role); seenIds.add(req.contributorId);
      const contributor = this.#resolveContributor(req.contributorId);
      if (!contributor || contributor.role !== req.role) return fail('TASK_CONTRIBUTOR_UNKNOWN');
      const route = this.#taskPins.routes.get(req.channelId);
      if (!route || route.channel?.permission !== 'ALLOW') return fail('TASK_ROUTE_REFUSED');
      if (req.fromPortId !== route.channel.fromPortId || req.toPortId !== route.channel.toPortId) return fail('TASK_ROUTE_ENDPOINT_MISMATCH');
      if (contributor.outputSpaceSha256 !== route.tensor?.spaceSha256 || contributor.outputWidth !== route.tensor?.width) return fail('TASK_TENSOR_MISMATCH');
    }
    const admittedDigest = hash(value);
    this.#admittedTasks.add(admittedDigest);
    return answer(true, 'TASK_ADMITTED', { taskId: value.taskId, taskDigest: admittedDigest });
  }

  admitResponse(text, payload) {
    let value;
    try { value = JSON.parse(text); }
    catch { return fail('JSON_INVALID'); }
    if (canonical(value) !== text) return fail('RESPONSE_NONCANONICAL');
    if (!responseValid(value)) return fail('RESPONSE_SCHEMA_INVALID');
    const contributor = this.#resolveContributor(value.contributorId);
    if (!contributor || contributor.role !== value.role) return fail('RESPONSE_CONTRIBUTOR_UNKNOWN');
    if (value.outcome !== 'SUCCESS') return answer(true, 'RESPONSE_RECORDED', { taskId: value.taskId, role: value.role, outcome: value.outcome });
    if (!finiteF32(payload, contributor.outputWidth)) return fail('RESPONSE_PAYLOAD_INVALID');
    return answer(true, 'RESPONSE_RECORDED', { taskId: value.taskId, contributorId: value.contributorId, role: value.role, taskDigest: value.taskDigest, outcome: value.outcome, payload });
  }

  combine(taskText, responses) {
    let taskValue;
    try { taskValue = JSON.parse(taskText); }
    catch { return fail('JSON_INVALID'); }
    if (canonical(taskValue) !== taskText) return fail('TASK_NONCANONICAL');
    if (!taskValid(taskValue)) return fail('TASK_SCHEMA_INVALID');
    const taskDigest = hash(taskValue);
    if (taskValue.graphSha256 !== this.#taskPins.graphSha256 || taskValue.runSha256 !== this.#taskPins.runSha256 ||
        taskValue.topologySha256 !== this.#taskPins.topologySha256 || taskValue.planSha256 !== this.#taskPins.planSha256) return fail('TASK_IDENTITY_MISMATCH');
    if (taskValue.generation !== this.#taskPins.generation) return fail('TASK_GENERATION_MISMATCH');
    // Admission is a precondition, not decoration: every admitTask gate
    // (route, endpoint, tensor, duplicate) dominates the whole pipeline.
    if (!this.#admittedTasks.has(taskDigest)) return fail('COMBINE_TASK_NOT_ADMITTED');
    if (!Array.isArray(responses) || responses.length !== taskValue.requiredContributors.length) return fail('COMBINE_RESPONSE_COUNT_MISMATCH');
    let combined = Buffer.alloc(0);
    let totalWidth = 0;
    for (let i = 0; i < taskValue.requiredContributors.length; i++) {
      const req = taskValue.requiredContributors[i];
      const res = responses[i];
      if (!res || !res.ok || res.outcome !== 'SUCCESS' || res.taskId !== taskValue.taskId || res.taskDigest !== taskDigest) return fail('COMBINE_RESPONSE_UNMATCHED');
      if (res.role !== req.role) return fail('COMBINE_RESPONSE_ORDER_MISMATCH');
      const contributor = this.#resolveContributor(req.contributorId);
      if (!contributor || res.contributorId !== req.contributorId) return fail('COMBINE_CONTRIBUTOR_UNKNOWN');
      if (!finiteF32(res.payload, contributor.outputWidth)) return fail('COMBINE_PAYLOAD_INVALID');
      combined = Buffer.concat([combined, Buffer.from(res.payload)]);
      totalWidth += contributor.outputWidth;
    }
    if (combined.length !== 4 * totalWidth) return fail('COMBINE_WIDTH_MISMATCH');
    return answer(true, 'COMBINED', { taskId: taskValue.taskId, taskDigest, combinedOutputWidth: totalWidth, contributors: taskValue.requiredContributors.map(r => r.role), combined });
  }
}

/** Binds owned canonical base/dual declaration bytes and the generator exactly
 * once. No model object, path, queue or scheduler is resolved; a bound
 * declaration is not permission. This contract never executes, schedules or
 * grants. */
export function createTaskResponseCombiner(baseBytes, dualBytes, options) {
  try {
    const captured = Object.freeze({ generation: options?.generation });
    if (!isInt(captured.generation, 1)) return fail('CONFIGURATION_REFUSED');
    const baseValue = parseOwned(baseBytes, 262144);
    const dualValue = parseOwned(dualBytes, 131072);
    if (!baseValue || !dualValue) return fail('DECLARATION_BYTES_REFUSED');
    const bound = binding(baseValue, dualValue);
    if (!bound) return fail('DECLARATIONS_REFUSED');
    if (canonical(baseValue) !== baseBytes.toString('utf8') || canonical(dualValue) !== dualBytes.toString('utf8')) return fail('DECLARATIONS_REFUSED');
    const combiner = new TaskResponseCombiner(bound.base, bound.dual, captured.generation);
    return answer(true, 'READY_PRIVATE_TASK_RESPONSE_COMBINER_ONLY', { combiner });
  } catch {
    return fail('CONSTRUCTION_ERROR');
  }
}