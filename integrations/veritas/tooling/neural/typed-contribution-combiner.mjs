// Generalized typed task/response/combiner contract (BN01-C09 "arbitrary task/
// response/combiner types" slice). The f32-only baseline stays untouched; this
// module adds a CLOSED type registry (F32, F64, I64, BOOL, BYTES, STRING) over the same
// canonical-bytes-in / frozen-results-out envelope with per-type domain checks,
// type-consistency enforcement and per-type combine operations.
// Pure declarations: no model execution, no scheduling, no permission minting.
import { createHash } from 'node:crypto';
import { BN01_LIMITS, validateBn01Bytes } from './bn01.mjs';
import { DUAL_FACE_LIMITS, validateDualFaceBytes } from './dual-face.mjs';

export const TYPED_LIMITS = Object.freeze({ textBytes: 65536, depth: 24, values: 12000,
  maxContributors: 64, maxTasks: 64, maxRetainedPayloadBytes: 1048576 });

const FLAGS = Object.freeze({ authorizing: false, modelExecuted: false,
  promotionGranted: false, certificationGranted: false });
const answer = (ok, code, fields = {}) => Object.freeze({ ok, code, ...fields, ...FLAGS });
const fail = (code, fields = {}) => answer(false, code, fields);
const isID = v => typeof v === 'string' && v.length >= 1 && v.length <= 96 && /^[a-z][a-z0-9_.-]*(?![\s\S])/.test(v);
const isHash = v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const isInt = (v, min, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && v >= min && v <= max;
const isPlain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const keysEqual = (value, expected) => isPlain(value) &&
  Object.keys(value).sort().join('\0') === [...expected].sort().join('\0');

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
const digestOf = record => createHash('sha256')
  .update(`veritas/typed-contribution/${record.kind}\0`).update(canonical(record)).digest('hex');

function parseText(text) {
  if (typeof text !== 'string' || text.length === 0 || text.length > TYPED_LIMITS.textBytes ||
      Buffer.byteLength(text, 'utf8') > TYPED_LIMITS.textBytes) throw Error('TEXT_LIMIT');
  const value = JSON.parse(text), stack = [[value, 0]];
  let count = 0;
  while (stack.length) {
    const [item, depth] = stack.pop();
    if (++count > TYPED_LIMITS.values || depth > TYPED_LIMITS.depth) throw Error('TREE_LIMIT');
    if (item && typeof item === 'object') for (const child of Object.values(item)) stack.push([child, depth + 1]);
  }
  return value;
}

// ---- closed type registry (a string outside this table is never interpreted) ----
export const TYPED_TYPES = Object.freeze({
  F32: Object.freeze({ elementBytes: 4, minWidth: 1, maxWidth: 4096 }),
  F64: Object.freeze({ elementBytes: 8, minWidth: 1, maxWidth: 4096 }),
  I64: Object.freeze({ elementBytes: 8, minWidth: 1, maxWidth: 4096 }),
  BOOL: Object.freeze({ elementBytes: 1, minWidth: 1, maxWidth: 8192 }),
  BYTES: Object.freeze({ elementBytes: 0, minWidth: 1, maxWidth: 32768 }),
  STRING: Object.freeze({ elementBytes: 1, minWidth: 1, maxWidth: 64 }),
});
const TYPE_NAMES = Object.freeze(Object.keys(TYPED_TYPES));
const SAFE_INT = BigInt(Number.MAX_SAFE_INTEGER);
const SAFE_NEG = -SAFE_INT;

function ownedU8(buffer, maximum) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > maximum) return null;
  if (buffer.buffer instanceof SharedArrayBuffer) return null;
  return Buffer.from(buffer);
}
// Strict RFC 3629 UTF-8 validation (no overlongs, no surrogates, capped at
// U+10FFFF). Deterministic and portable across Node versions — Buffer.isUtf8
// is unavailable on older runtimes this repo supports.
function isUtf8(buf) {
  let i = 0;
  while (i < buf.length) {
    const b = buf[i];
    if (b < 0x80) { i += 1; continue; }
    let need;
    if ((b & 0xe0) === 0xc0) need = 2;
    else if ((b & 0xf0) === 0xe0) need = 3;
    else if ((b & 0xf8) === 0xf0) need = 4;
    else return false;
    if (i + need > buf.length) return false;
    for (let j = 1; j < need; j++) if ((buf[i + j] & 0xc0) !== 0x80) return false;
    if (need === 2 && b < 0xc2) return false;
    if (need === 3 && b === 0xe0 && buf[i + 1] < 0xa0) return false;
    if (need === 3 && b === 0xed && buf[i + 1] >= 0xa0) return false; // surrogate
    if (need === 4 && b === 0xf0 && buf[i + 1] < 0x90) return false;
    if (need === 4 && b > 0xf4 || need === 4 && b === 0xf4 && buf[i + 1] >= 0x90) return false;
    i += need;
  }
  return true;
}
function domainValid(type, buffer, width) {
  if (type === 'BYTES') return buffer.length === width;
  // STRING entries are variable-length UTF-8 (width = declared entry span,
  // not byte count); NUL bytes are refused so combine's \0 separator is
  // unambiguous.
  if (type === 'STRING') {
    return buffer.length >= 1 && isUtf8(buffer) && !buffer.includes(0);
  }
  const spec = TYPED_TYPES[type];
  if (buffer.length !== spec.elementBytes * width) return false;
  if (type === 'F32') { for (let i = 0; i < buffer.length; i += 4) if (!Number.isFinite(buffer.readFloatLE(i))) return false; return true; }
  if (type === 'F64') { for (let i = 0; i < buffer.length; i += 8) if (!Number.isFinite(buffer.readDoubleLE(i))) return false; return true; }
  if (type === 'I64') { for (let i = 0; i < buffer.length; i += 8) { const v = buffer.readBigInt64LE(i); if (v < SAFE_NEG || v > SAFE_INT) return false; } return true; }
  for (let i = 0; i < buffer.length; i++) if (buffer[i] !== 0 && buffer[i] !== 1) return false;
  return true;
}
function typeValid(v) { return TYPE_NAMES.includes(v.outputType) && isInt(v.outputWidth, TYPED_TYPES[v.outputType].minWidth, TYPED_TYPES[v.outputType].maxWidth); }

const CONTRIBUTOR_KEYS = Object.freeze(['kind', 'contributorId', 'role', 'revision', 'outputType', 'outputWidth', 'spaceSha256', 'maxPayloadBytes']);
const TASK_KEYS = Object.freeze(['kind', 'taskId', 'requester', 'graphSha256', 'runSha256', 'topologySha256', 'planSha256', 'generation', 'requiredContributors', 'deadlineMs']);
const RESPONSE_KEYS = Object.freeze(['kind', 'contributorId', 'taskId', 'taskDigest', 'outcome', 'payloadSha256']);

function contributorValid(v) {
  if (!keysEqual(v, CONTRIBUTOR_KEYS)) return false;
  return v.kind === 'veritas-typed-contribution-contributor-v1' && isID(v.contributorId) &&
    isID(v.role) && isInt(v.revision, 1, 1000000) && typeValid(v) &&
    isHash(v.spaceSha256) && isInt(v.maxPayloadBytes, 16, 65536);
}
function taskValid(v) {
  if (!keysEqual(v, TASK_KEYS)) return false;
  if (v.kind !== 'veritas-typed-contribution-task-v1' || v.requester !== 'PRIMARY') return false;
  if (!isID(v.taskId) || !isHash(v.graphSha256) || !isHash(v.runSha256) || !isHash(v.topologySha256) || !isHash(v.planSha256)) return false;
  if (!isInt(v.generation, 1) || !isInt(v.deadlineMs, 1, 60000)) return false;
  return Array.isArray(v.requiredContributors) && v.requiredContributors.length >= 1 && v.requiredContributors.length <= 4 &&
    v.requiredContributors.every(c => isID(c) && new Set(v.requiredContributors).size === v.requiredContributors.length);
}
function responseValid(v) {
  if (!keysEqual(v, RESPONSE_KEYS)) return false;
  return v.kind === 'veritas-typed-contribution-response-v1' && isID(v.contributorId) &&
    isID(v.taskId) && isHash(v.taskDigest) && v.outcome === 'RESPONSE_OK' && isHash(v.payloadSha256);
}

class TypedCombiner {
  #contributors = new Map();
  #tasks = new Map();
  #responses = new Map();
  #generation;
  #pins;
  #limits;
  #clock;
  #now = null;
  #busy = false;
  #stopped = false;
  #payloadBytes = 0;

  constructor(pins, generation, limits, clock) {
    this.#generation = generation;
    this.#pins = Object.freeze(pins);
    this.#limits = Object.freeze(limits);
    this.#clock = clock;
  }

  #contributor(id) { return this.#contributors.get(id); }

  #clear() {
    this.#stopped = true;
    this.#contributors.clear(); this.#tasks.clear(); this.#responses.clear();
    this.#payloadBytes = 0;
  }

  #terminal(task, state) {
    for (const id of task.requiredContributors) {
      const key = `${task.taskId}\0${id}`, response = this.#responses.get(key);
      if (response) { this.#payloadBytes -= response.payload.length; this.#responses.delete(key); }
    }
    // Keep the task ID as a bounded replay tombstone; never refund identity slots.
    this.#tasks.set(task.taskId, Object.freeze({ ...task, state }));
  }

  #operation(action) {
    if (this.#busy) return fail('BUSY');
    if (this.#stopped) return fail('OFF');
    this.#busy = true;
    try {
      let now;
      try { now = this.#clock(); } catch { this.#clear(); return fail('CLOCK_REFUSED'); }
      if (!isInt(now, 0) || (this.#now !== null && now < this.#now)) {
        this.#clear(); return fail('CLOCK_REFUSED');
      }
      this.#now = now;
      for (const task of this.#tasks.values()) {
        if (task.state === 'LIVE' && now >= task.expiresAt) this.#terminal(task, 'EXPIRED');
      }
      return action(now);
    } catch { return fail('OPERATION_REFUSED'); }
    finally { this.#busy = false; }
  }

  admitContributor(text) { return this.#operation(() => this.#admitContributor(text)); }
  admitTask(text) { return this.#operation(now => this.#admitTask(text, now)); }
  admitResponse(text, payload) { return this.#operation(() => this.#admitResponse(text, payload)); }
  combine(text, entries) { return this.#operation(() => this.#combine(text, entries)); }
  stop() {
    if (this.#busy) return fail('BUSY');
    this.#clear(); return answer(true, 'STOPPED');
  }
  status() {
    return answer(true, 'TYPED_STATUS', { stopped: this.#stopped, generation: this.#generation,
      contributors: this.#contributors.size, retainedTasks: this.#tasks.size,
      retainedResponses: this.#responses.size, retainedPayloadBytes: this.#payloadBytes,
      limits: this.#limits });
  }

  #admitContributor(text) {
    let value;
    try { value = parseText(text); }
    catch { return fail('JSON_INVALID'); }
    if (canonical(value) !== text) return fail('CONTRIBUTOR_NONCANONICAL');
    if (!contributorValid(value)) return fail('CONTRIBUTOR_SCHEMA_INVALID');
    if (this.#contributor(value.contributorId)) return fail('CONTRIBUTOR_DUPLICATE');
    if (this.#contributors.size >= this.#limits.maxContributors) return fail('CONTRIBUTOR_CAP_EXHAUSTED');
    this.#contributors.set(value.contributorId, Object.freeze({ ...value, digest: digestOf(value) }));
    return answer(true, 'CONTRIBUTOR_BOUND', { contributorId: value.contributorId, outputType: value.outputType, outputWidth: value.outputWidth });
  }

  #admitTask(text, now) {
    let value;
    try { value = parseText(text); }
    catch { return fail('JSON_INVALID'); }
    if (canonical(value) !== text) return fail('TASK_NONCANONICAL');
    if (!taskValid(value)) return fail('TASK_SCHEMA_INVALID');
    if (Object.keys(this.#pins).some(k => value[k] !== this.#pins[k])) return fail('TASK_IDENTITY_MISMATCH');
    if (value.generation !== this.#generation) return fail('TASK_GENERATION_MISMATCH');
    if (this.#tasks.has(value.taskId)) return fail('TASK_DUPLICATE');
    for (const contributorId of value.requiredContributors) {
      if (!this.#contributor(contributorId)) return fail('TASK_CONTRIBUTOR_UNKNOWN');
    }
    if (this.#tasks.size >= this.#limits.maxTasks) return fail('TASK_CAP_EXHAUSTED');
    if (!Number.isSafeInteger(now + value.deadlineMs)) return fail('DEADLINE_OVERFLOW');
    this.#tasks.set(value.taskId, Object.freeze({ ...value, requiredContributors: Object.freeze(value.requiredContributors),
      digest: digestOf(value), expiresAt: now + value.deadlineMs, state: 'LIVE' }));
    return answer(true, 'TASK_ADMITTED', { taskId: value.taskId, digest: this.#tasks.get(value.taskId).digest });
  }

  #admitResponse(text, payload) {
    let value;
    try { value = parseText(text); }
    catch { return fail('JSON_INVALID'); }
    if (canonical(value) !== text) return fail('RESPONSE_NONCANONICAL');
    if (!responseValid(value)) return fail('RESPONSE_SCHEMA_INVALID');
    const task = this.#tasks.get(value.taskId);
    if (!task) return fail('RESPONSE_TASK_UNKNOWN');
    if (task.state !== 'LIVE') return fail(`TASK_${task.state}`);
    if (value.taskDigest !== task.digest) return fail('RESPONSE_TASK_DIGEST_MISMATCH');
    const contributor = this.#contributor(value.contributorId);
    if (!contributor) return fail('RESPONSE_CONTRIBUTOR_UNKNOWN');
    if (!task.requiredContributors.includes(contributor.contributorId)) return fail('RESPONSE_END_POINT_REFUSED');
    const payloadBytes = ownedU8(payload, contributor.maxPayloadBytes);
    if (!payloadBytes) return fail('PAYLOAD_BYTES_REFUSED');
    if (!domainValid(contributor.outputType, payloadBytes, contributor.outputWidth)) return fail('PAYLOAD_TYPE_DOMAIN_INVALID');
    const payloadSha256 = createHash('sha256').update(payloadBytes).digest('hex');
    if (value.payloadSha256 !== payloadSha256) return fail('PAYLOAD_DIGEST_MISMATCH');
    const key = `${value.taskId}\0${contributor.contributorId}`;
    if (this.#responses.has(key)) return fail('RESPONSE_DUPLICATE');
    if (this.#payloadBytes + payloadBytes.length > this.#limits.maxRetainedPayloadBytes) return fail('PAYLOAD_CAP_EXHAUSTED');
    this.#responses.set(key, Object.freeze({ record: value, text, payload: payloadBytes }));
    this.#payloadBytes += payloadBytes.length;
    return answer(true, 'RESPONSE_ADMITTED', { contributorId: contributor.contributorId, payloadSha256 });
  }

  #combine(taskText, entries) {
    let taskValue;
    try { taskValue = parseText(taskText); }
    catch { return fail('JSON_INVALID'); }
    if (canonical(taskValue) !== taskText) return fail('TASK_NONCANONICAL');
    if (!taskValid(taskValue)) return fail('TASK_SCHEMA_INVALID');
    if (Object.keys(this.#pins).some(k => taskValue[k] !== this.#pins[k])) return fail('TASK_IDENTITY_MISMATCH');
    if (taskValue.generation !== this.#generation) return fail('TASK_GENERATION_MISMATCH');
    const task = this.#tasks.get(taskValue.taskId);
    if (!task || task.digest !== digestOf(taskValue)) return fail('TASK_UNKNOWN');
    if (task.state !== 'LIVE') return fail(`TASK_${task.state}`);
    if (!Array.isArray(entries) || entries.length !== task.requiredContributors.length) return fail('RESPONSE_COUNT_MISMATCH');

    const acts = [];
    // Iterate only the task's owned bounded count. Caller entries may have
    // accessor-backed properties; capture each once while reentry is blocked.
    for (let i = 0; i < task.requiredContributors.length; i++) {
      const entry = entries[i];
      const text = entry?.text, rawPayload = entry?.payload;
      let record;
      try { record = parseText(text); }
      catch { return fail('JSON_INVALID'); }
      if (canonical(record) !== text) return fail('RESPONSE_NONCANONICAL');
      if (!responseValid(record)) return fail('RESPONSE_SCHEMA_INVALID');
      const contributor = this.#contributor(record.contributorId);
      if (!contributor) return fail('RESPONSE_CONTRIBUTOR_UNKNOWN');
      // Contract order is the requiredContributors sequence; the caller's entry
      // at position i must BE that contributor, never re-sorted into place.
      if (record.contributorId !== task.requiredContributors[i]) return fail('RESPONSE_ORDER_MISMATCH');
      const key = `${record.taskId}\0${record.contributorId}`;
      const admitted = this.#responses.get(key);
      if (!admitted) return fail('RESPONSE_NOT_ADMITTED');
      // The entry must BE the admitted response, not merely name an admitted
      // key: both the canonical record text and the payload bytes are compared,
      // so no schema-valid fabrication can ride on a real admission.
      if (admitted.text !== text) return fail('RESPONSE_ADMITTED_RECORD_MISMATCH');
      if (record.taskId !== task.taskId || record.taskDigest !== task.digest) return fail('RESPONSE_TASK_MISMATCH');
      const payload = ownedU8(rawPayload, contributor.maxPayloadBytes);
      if (!payload || createHash('sha256').update(payload).digest('hex') !== record.payloadSha256) return fail('PAYLOAD_DIGEST_MISMATCH');
      if (payload.length !== admitted.payload.length) return fail('RESPONSE_ADMITTED_PAYLOAD_MISMATCH');
      for (let j = 0; j < payload.length; j++) {
        if (payload[j] !== admitted.payload[j]) return fail('RESPONSE_ADMITTED_PAYLOAD_MISMATCH');
      }
      // Same domain rule admitResponse applies. BYTES is not exempt: for BYTES
      // the domain rule IS the declared width bound (domainValid line 73).
      if (!domainValid(contributor.outputType, payload, contributor.outputWidth)) return fail('PAYLOAD_TYPE_DOMAIN_INVALID');
      acts.push({ contributor, record, payload });
    }

    // Type consistency: every admitted response must carry its contributor's declared type.
    const typeSet = new Set(acts.map(a => a.contributor.outputType));
    if (typeSet.size !== 1) return fail('TYPE_MISMATCH');
    const type = [...typeSet][0];
    const width = acts[0].contributor.outputWidth;
    if (!acts.every(a => a.contributor.outputWidth === width)) return fail('WIDTH_MISMATCH');
    // The typed arithmetic registry is distinct from BN01's f32 plugin output
    // contract. It still cannot combine values from different declared spaces.
    if (!acts.every(a => a.contributor.spaceSha256 === acts[0].contributor.spaceSha256)) return fail('SPACE_MISMATCH');

    // Per-type combine (advisory; counts, order, digest and domain already enforced).
    let combined, combinedSha256;
    if (type === 'BYTES') {
      combined = Buffer.concat(acts.map(a => a.payload));
      if (combined.length > 65536) return fail('COMBINED_OVER_LIMIT');
    } else if (type === 'BOOL') {
      combined = Buffer.alloc(width);
      for (let i = 0; i < width; i++) combined[i] = acts.some(a => a.payload[i] === 1) ? 1 : 0;
    } else if (type === 'STRING') {
      const parts = [];
      for (let i = 0; i < acts.length; i++) {
        if (i > 0) parts.push(Buffer.from([0]));
        parts.push(acts[i].payload);
      }
      combined = Buffer.concat(parts);
      if (combined.length > 65536) return fail('COMBINED_OVER_LIMIT');
    } else if (type === 'I64') {
      combined = Buffer.alloc(8 * width);
      for (let i = 0; i < width; i++) {
        let sum = 0n;
        for (const a of acts) sum += a.payload.readBigInt64LE(i * 8);
        if (sum < SAFE_NEG || sum > SAFE_INT) return fail('COMBINED_OVERFLOW_REFUSED');
        combined.writeBigInt64LE(sum, i * 8);
      }
    } else {
      const element = type === 'F32' ? 4 : 8;
      const read = type === 'F32' ? (b, i) => b.readFloatLE(i) : (b, i) => b.readDoubleLE(i);
      const write = type === 'F32' ? (b, v, i) => b.writeFloatLE(v, i) : (b, v, i) => b.writeDoubleLE(v, i);
      combined = Buffer.alloc(element * width);
      for (let i = 0; i < width; i++) {
        let sum = 0;
        for (const a of acts) sum += read(a.payload, i * element);
        if (!Number.isFinite(sum)) return fail('COMBINED_NONFINITE_REFUSED');
        write(combined, sum, i * element);
        if (!Number.isFinite(read(combined, i * element))) return fail('COMBINED_NONFINITE_REFUSED');
      }
    }
    combinedSha256 = createHash('sha256').update(combined).digest('hex');
    this.#terminal(task, 'CONSUMED');
    return answer(true, 'TYPED_COMBINE_COMPLETE', {
      taskId: task.taskId, type, width, contributors: acts.length,
      combinedSha256, combinedBytes: combined.length,
    });
  }
}

/** Binds owned canonical base/dual declaration bytes and the exact generation.
 * Mirrors the f32 baseline envelope with a closed typed registry; every result
 * is frozen with all authority flags false and no execution path. */
export function createTypedContributionCombiner(baseBytes, dualBytes, options) {
  try {
    const generation = options?.generation ?? null;
    if (!isInt(generation, 1)) return fail('GENERATION_REFUSED');
    const limits = Object.fromEntries(['maxContributors', 'maxTasks', 'maxRetainedPayloadBytes']
      .map(k => [k, options?.[k] ?? TYPED_LIMITS[k]]));
    if (Object.keys(limits).some(k => !isInt(limits[k], 1, TYPED_LIMITS[k]))) return fail('LIMITS_REFUSED');
    const clock = options?.clock ?? (() => Math.floor(performance.now()));
    if (typeof clock !== 'function') return fail('CLOCK_REFUSED');
    const baseCopy = ownedU8(baseBytes, BN01_LIMITS.bytes);
    const dualCopy = ownedU8(dualBytes, DUAL_FACE_LIMITS.bytes);
    if (!baseCopy || !dualCopy) return fail('DECLARATION_BYTES_REFUSED');
    const base = validateBn01Bytes(baseCopy), dual = validateDualFaceBytes(baseCopy, dualCopy);
    if (!base.ok || !dual.ok) return fail('DECLARATIONS_REFUSED');
    const pins = { graphSha256: base.graphSha256, runSha256: base.runSha256,
      topologySha256: dual.topologySha256, planSha256: dual.planSha256 };
    const combiner = new TypedCombiner(pins, generation, limits, clock);
    return answer(true, 'READY_PRIVATE_TYPED_CONTRIBUTION_COMBINER_ONLY', { combiner });
  } catch {
    return fail('CONSTRUCTION_ERROR');
  }
}
