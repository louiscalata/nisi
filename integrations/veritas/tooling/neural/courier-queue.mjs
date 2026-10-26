// Private in-memory transport preparation. No model runner or admission authority.
import Ajv2020 from 'ajv/dist/2020.js';
import { createHash } from 'node:crypto';
import { BN01_LIMITS } from './bn01.mjs';
import { DUAL_FACE_LIMITS, validateDualFaceBytes } from './dual-face.mjs';

export const COURIER_LIMITS = Object.freeze({ packetBytes: 65536, retainedTaskIds: 4096 });
const flags = Object.freeze({ authorizing: false, modelExecuted: false,
  promotionGranted: false, certificationGranted: false });
const answer = (ok, code, fields = {}) => Object.freeze({ ok, code, ...fields, ...flags });
const fail = code => answer(false, code);
const integer = (minimum, maximum = Number.MAX_SAFE_INTEGER) => ({ type: 'integer', minimum, maximum });
const id = { type: 'string', minLength: 1, maxLength: 96, pattern: '^[a-z][a-z0-9_.-]*(?![\\s\\S])' };
const digest = { type: 'string', minLength: 64, maxLength: 64, pattern: '^[0-9a-f]{64}$' };
const properties = {
  kind: { const: 'veritas-courier-f32-v1' }, taskId: id,
  traveler: { enum: ['PROTON', 'ELECTRON', 'NEUTRON'] },
  graphSha256: digest, runSha256: digest, topologySha256: digest, planSha256: digest,
  generation: integer(1), channelId: id, fromPortId: id, toPortId: id,
  createdAtMs: integer(0), ttlMs: integer(1, 60000), hopCount: integer(1, 16),
  spaceSha256: digest,
  payloadHex: { type: 'string', minLength: 8, maxLength: 32768, pattern: '^(?:[0-9a-f]{8})+$' },
};
const checkPacket = new Ajv2020({ strict: true, allErrors: false, ownProperties: true })
  .compile({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const canonical = value => '{' + Object.keys(value).sort()
  .map(key => JSON.stringify(key) + ':' + JSON.stringify(value[key])).join(',') + '}';
const isTime = value => Number.isSafeInteger(value) && value >= 0;
const isID = value => typeof value === 'string' && value.length <= 96 && /^[a-z][a-z0-9_.-]*(?![\s\S])/.test(value);
const live = entry => entry.state === 'QUEUED' || entry.state === 'IN_FLIGHT';
function ownedBytes(value, maximum) {
  if (!Buffer.isBuffer(value) || value.length === 0 || value.length > maximum) return null;
  if (value.buffer instanceof SharedArrayBuffer) return null;
  return Buffer.from(value);
}

class CourierQueue {
  #clock; #lastTime; #generation; #maxHistory; #pins; #routes;
  #active = true; #busy = false; #history = new Map(); #tickets = new WeakMap();
  #messages = 0; #payloadBytes = 0; #channelCounts = new Map(); #budget;

  constructor(base, dual, options, now) {
    this.#clock = options.clock;
    this.#lastTime = now;
    this.#generation = options.generation;
    this.#maxHistory = options.maxRetainedTaskIds;
    this.#pins = { graphSha256: base.graph.sha256, runSha256: base.run.sha256,
      topologySha256: dual.topology.sha256, planSha256: dual.plan.sha256 };
    this.#budget = dual.topology.record.transportBudget;
    const nodes = new Map(base.graph.record.nodes.map(node => [node.nodeId, node]));
    const plugins = new Map(base.plugins.map(plugin => [plugin.sha256, plugin.record]));
    const channels = new Map(dual.topology.record.channels.map(channel => [channel.channelId, channel]));
    this.#routes = new Map(dual.plan.record.routes.map(route => [route.channelId, {
      channel: channels.get(route.channelId),
      tensor: plugins.get(nodes.get(route.fromNodeId).revisionSha256).output,
    }]));
  }

  #release(entry, state) {
    if (!live(entry)) return;
    this.#messages--;
    this.#payloadBytes -= entry.byteLength;
    this.#channelCounts.set(entry.channelId, this.#channelCounts.get(entry.channelId) - 1);
    if (entry.ticket) this.#tickets.delete(entry.ticket);
    delete entry.ticket;
    delete entry.packet;
    delete entry.payload;
    entry.state = state;
  }

  #shutdown() {
    this.#active = false;
    for (const entry of this.#history.values()) this.#release(entry, 'CANCELLED');
  }

  #operate(operation) {
    if (this.#busy) return fail('BUSY');
    if (!this.#active) return fail('OFF');
    this.#busy = true;
    try {
      let now;
      try { now = this.#clock(); }
      catch { this.#shutdown(); return fail('CLOCK_ERROR'); }
      if (!isTime(now)) { this.#shutdown(); return fail('CLOCK_INVALID'); }
      if (now < this.#lastTime) { this.#shutdown(); return fail('CLOCK_REGRESSION'); }
      this.#lastTime = now;
      for (const entry of this.#history.values()) {
        if (live(entry) && now >= entry.deadline) this.#release(entry, 'EXPIRED');
      }
      return operation(now);
    } catch {
      // Unexpected failures cannot leave partially usable state or turn into PASS.
      this.#shutdown();
      return fail('INTERNAL_ERROR');
    } finally { this.#busy = false; }
  }

  enqueue(bytes) {
    return this.#operate(now => {
      const copy = ownedBytes(bytes, COURIER_LIMITS.packetBytes);
      if (!copy) return fail('PACKET_BYTES_REFUSED');
      let text, packet;
      try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(copy); }
      catch { return fail('UTF8_INVALID'); }
      try { packet = JSON.parse(text); }
      catch { return fail('JSON_INVALID'); }
      if (!checkPacket(packet)) return fail('PACKET_SCHEMA_INVALID');
      if (canonical(packet) !== text) return fail('NONCANONICAL_PACKET');
      if (packet.generation !== this.#generation) return fail('GENERATION_MISMATCH');
      for (const [key, expected] of Object.entries(this.#pins)) {
        if (packet[key] !== expected) return fail('IDENTITY_MISMATCH');
      }
      const selected = this.#routes.get(packet.channelId);
      if (!selected || selected.channel.permission !== 'ALLOW') return fail('ROUTE_REFUSED');
      const { channel, tensor } = selected;
      if (packet.fromPortId !== channel.fromPortId || packet.toPortId !== channel.toPortId) return fail('ENDPOINT_MISMATCH');
      if (packet.spaceSha256 !== tensor.spaceSha256 || packet.payloadHex.length !== tensor.width * 8) return fail('TENSOR_MISMATCH');
      const payload = Buffer.from(packet.payloadHex, 'hex');
      for (let offset = 0; offset < payload.length; offset += 4) {
        if (!Number.isFinite(payload.readFloatLE(offset))) return fail('NONFINITE_PAYLOAD');
      }
      const fingerprint = createHash('sha256').update('veritas/courier-f32-v1\0').update(copy).digest('hex');
      const previous = this.#history.get(packet.taskId);
      if (previous) {
        return previous.fingerprint === fingerprint
          ? answer(true, 'DUPLICATE', { taskId: packet.taskId, taskState: previous.state })
          : fail('TASK_CONFLICT');
      }
      if (payload.length > channel.maxPayloadBytes) return fail('PAYLOAD_LIMIT');
      if (packet.hopCount > channel.hopLimit) return fail('HOP_LIMIT');
      if (packet.ttlMs > channel.ttlMs) return fail('TTL_LIMIT');
      const deadline = packet.createdAtMs + packet.ttlMs;
      if (!Number.isSafeInteger(deadline)) return fail('DEADLINE_OVERFLOW');
      if (packet.createdAtMs > now) return fail('FUTURE_PACKET');
      if (now >= deadline) return fail('EXPIRED');
      if (this.#history.size >= this.#maxHistory) return fail('TASK_HISTORY_FULL');
      const channelCount = this.#channelCounts.get(packet.channelId) ?? 0;
      if (channelCount >= channel.queueLimit) return fail('CHANNEL_FULL');
      if (this.#messages + 1 > this.#budget.maxQueuedMessages ||
          this.#payloadBytes + payload.length > this.#budget.maxQueuedPayloadBytes) return fail('CAPACITY_FULL');
      const { payloadHex: _payloadHex, ...metadata } = packet;
      this.#history.set(packet.taskId, { fingerprint, state: 'QUEUED', channelId: packet.channelId,
        byteLength: payload.length, deadline, packet: Object.freeze(metadata), payload });
      this.#messages++;
      this.#payloadBytes += payload.length;
      this.#channelCounts.set(packet.channelId, channelCount + 1);
      return answer(true, 'QUEUED', { taskId: packet.taskId, taskState: 'QUEUED' });
    });
  }

  take() {
    return this.#operate(() => {
      for (const entry of this.#history.values()) {
        if (entry.state !== 'QUEUED') continue;
        const ticket = Object.freeze(Object.create(null));
        entry.state = 'IN_FLIGHT';
        entry.ticket = ticket;
        this.#tickets.set(ticket, entry);
        return answer(true, 'TAKEN', { ticket });
      }
      return fail('EMPTY');
    });
  }

  consume(ticket) {
    return this.#operate(() => {
      const entry = this.#tickets.get(ticket);
      if (!entry || entry.state !== 'IN_FLIGHT' || entry.ticket !== ticket) return fail('INVALID_TICKET');
      const packet = Object.freeze({ ...entry.packet });
      const payload = Buffer.from(entry.payload);
      this.#release(entry, 'DELIVERED');
      return answer(true, 'DELIVERED', { taskId: packet.taskId, packet, payload });
    });
  }

  cancelTicket(ticket) {
    return this.#operate(() => {
      const entry = this.#tickets.get(ticket);
      if (!entry || entry.state !== 'IN_FLIGHT' || entry.ticket !== ticket) return fail('INVALID_TICKET');
      const taskId = entry.packet.taskId;
      this.#release(entry, 'CANCELLED');
      return answer(true, 'CANCELLED', { taskId, taskState: 'CANCELLED' });
    });
  }

  cancel(taskId) {
    return this.#operate(() => {
      if (!isID(taskId)) return fail('TASK_ID_INVALID');
      const entry = this.#history.get(taskId);
      if (!entry) return fail('TASK_UNKNOWN');
      if (!live(entry)) return answer(true, 'ALREADY_TERMINAL', { taskId, taskState: entry.state });
      this.#release(entry, 'CANCELLED');
      return answer(true, 'CANCELLED', { taskId, taskState: 'CANCELLED' });
    });
  }

  stop() {
    if (this.#busy) return fail('BUSY');
    if (!this.#active) return fail('OFF');
    this.#shutdown();
    return answer(true, 'STOPPED');
  }

  inspect() {
    if (this.#busy) return fail('BUSY');
    const snapshot = () => {
      let queued = 0, inFlight = 0;
      for (const entry of this.#history.values()) {
        if (entry.state === 'QUEUED') queued++;
        if (entry.state === 'IN_FLIGHT') inFlight++;
      }
      return answer(true, 'SNAPSHOT', { state: this.#active ? 'ACTIVE' : 'OFF',
        queued, inFlight, payloadBytes: this.#payloadBytes, retainedTaskIds: this.#history.size });
    };
    return this.#active ? this.#operate(snapshot) : snapshot();
  }
}

/** Owns only declared routes and in-memory packets. It never resolves model
 * objects, authenticates consent, runs tools, or grants execution authority.
 * `clock` is a trusted host test/runtime dependency, not sender-provided time.
 */
export function createCourierQueue(baseBytes, dualBytes, options) {
  try {
    const baseCopy = ownedBytes(baseBytes, BN01_LIMITS.bytes);
    const dualCopy = ownedBytes(dualBytes, DUAL_FACE_LIMITS.bytes);
    if (!baseCopy || !dualCopy) return fail('DECLARATION_BYTES_REFUSED');
    if (!validateDualFaceBytes(baseCopy, dualCopy).ok) return fail('DECLARATIONS_REFUSED');
    // Read each dependency once BEFORE validation. Accessors cannot substitute
    // a different identity, unbounded capacity or clock between check and use.
    const captured = Object.freeze({ generation: options?.generation,
      maxRetainedTaskIds: options?.maxRetainedTaskIds, clock: options?.clock });
    if (!Number.isSafeInteger(captured.generation) || captured.generation < 1 ||
        !Number.isSafeInteger(captured.maxRetainedTaskIds) || captured.maxRetainedTaskIds < 1 ||
        captured.maxRetainedTaskIds > COURIER_LIMITS.retainedTaskIds || typeof captured.clock !== 'function') return fail('CONFIGURATION_REFUSED');
    let now;
    try { now = captured.clock(); } catch { return fail('CLOCK_ERROR'); }
    if (!isTime(now)) return fail('CLOCK_INVALID');
    const queue = new CourierQueue(JSON.parse(baseCopy.toString('utf8')), JSON.parse(dualCopy.toString('utf8')), captured, now);
    return answer(true, 'READY_PRIVATE_COURIER_QUEUE_ONLY', { queue });
  } catch { return fail('CONSTRUCTION_ERROR'); }
}
