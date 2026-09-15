// Private cooperative slot admission; not CPU control, execution or permission.
import { createCourierQueue } from './courier-queue.mjs';
import { makeQueueResponseReader } from './scheduler-queue-responses.mjs';
import { BN01_LIMITS } from './bn01.mjs';
import { DUAL_FACE_LIMITS } from './dual-face.mjs';

const flags = Object.freeze({ authorizing: false, modelExecuted: false,
  promotionGranted: false, certificationGranted: false });
const result = (ok, code, fields = {}) => Object.freeze({ ok, code, ...fields, ...flags });
const fail = code => result(false, code);
const boundedInt = (v, min, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && v >= min && v <= max;
const validID = v => typeof v === 'string' && v.length <= 96 && /^[a-z][a-z0-9_.-]*(?![\s\S])/.test(v);
const validHash = v => typeof v === 'string' && /^[0-9a-f]{64}(?![\s\S])/.test(v);

/** A pure decision only. ALLOW cannot grant a ticket or execute work. */
export function decideSlotAdmission(input) {
  try {
    const { windowSlots: s, totalAdmitted: t, courierAdmitted: c, courierQueued: queued, kind } = input;
    if (!boundedInt(s, 1, 1000) || !boundedInt(t, 0, s) ||
        !boundedInt(c, 0, Math.min(t, Math.floor(s / 10))) ||
        !boundedInt(queued, 0, 256) || !['PRIMARY', 'COURIER'].includes(kind)) return 'INPUT_INVALID';
    const quota = Math.floor(s / 10);
    if (kind === 'COURIER') {
      if (c >= quota) return 'COURIER_BUDGET_EXHAUSTED';
      return t >= s ? 'WINDOW_FULL' : 'ALLOW';
    }
    if (t >= s) return 'WINDOW_FULL';
    return queued > 0 && s - t <= quota - c ? 'COURIER_RESERVED' : 'ALLOW';
  } catch { return 'INPUT_INVALID'; }
}

function windowAt(now, epoch, duration) {
  const index = (BigInt(now) - BigInt(epoch)) / BigInt(duration);
  const start = BigInt(epoch) + index * BigInt(duration);
  const end = start + BigInt(duration);
  if (end > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return { index: Number(index), start: Number(start), end: Number(end) };
}

class SharedWorkSlotScheduler {
  #config; #queue; #latch; #lastTime; #epoch; #window; #readQueue;
  #active = true; #busy = false; #queueStopConfirmed = false; #queueSnapshot;
  #total = 0; #courier = 0; #primaryHistory = new Map(); #pending = new Map();

  constructor(config, queue, latch, initialWindow, snapshot, readQueue) {
    this.#config = config; this.#queue = queue; this.#latch = latch;
    this.#lastTime = latch.now; this.#epoch = latch.now; this.#window = initialWindow;
    this.#queueSnapshot = snapshot;
    this.#readQueue = readQueue;
  }

  #snapshotQueue() {
    const snapshot = this.#readQueue('inspect', this.#queue.inspect(), this.#latch.now);
    if (snapshot.state !== 'ACTIVE') throw Error('QUEUE_FAILURE');
    this.#queueSnapshot = snapshot;
    return snapshot;
  }

  #shutdown() {
    this.#active = false;
    for (const entry of this.#pending.values()) {
      if (entry.kind === 'PRIMARY') entry.record.state = 'CANCELLED';
    }
    this.#pending.clear();
    this.#queueStopConfirmed = false; this.#queueSnapshot = null;
    try {
      const stopped = this.#readQueue('stop', this.#queue.stop(), this.#latch.now);
      if (!((stopped.ok === true && stopped.code === 'STOPPED') ||
            (stopped.ok === false && stopped.code === 'OFF'))) return false;
      const snapshot = this.#readQueue('inspect', this.#queue.inspect(), this.#latch.now);
      if (snapshot.state !== 'OFF') return false;
      this.#queueStopConfirmed = true; this.#queueSnapshot = snapshot;
      return true;
    } catch { return false; }
  }

  #retire(ticket, primaryState) {
    const entry = this.#pending.get(ticket);
    if (!entry) return false;
    if (entry.kind === 'COURIER') {
      const cancelled = this.#readQueue('cancelTicket', this.#queue.cancelTicket(entry.inner), this.#latch.now);
      if (!((cancelled.ok === true && cancelled.code === 'CANCELLED') ||
            (cancelled.ok === false && cancelled.code === 'INVALID_TICKET'))) throw Error('QUEUE_FAILURE');
    } else entry.record.state = primaryState;
    this.#pending.delete(ticket);
    return true;
  }

  #operate(operation) {
    if (this.#busy) return fail('BUSY');
    if (!this.#active) return fail('OFF');
    this.#busy = true;
    try {
      let now;
      try { now = this.#config.clock(); }
      catch { this.#shutdown(); return fail('CLOCK_ERROR'); }
      if (!boundedInt(now, 0)) { this.#shutdown(); return fail('CLOCK_INVALID'); }
      if (now < this.#lastTime) { this.#shutdown(); return fail('CLOCK_REGRESSION'); }
      const next = windowAt(now, this.#epoch, this.#config.windowDurationMs);
      if (!next) { this.#shutdown(); return fail('CLOCK_RANGE'); }
      this.#lastTime = now; this.#latch.now = now;
      this.#snapshotQueue(); // Unknown queue state can never authorize borrowing.
      if (next.index !== this.#window.index) {
        for (const ticket of this.#pending.keys()) this.#retire(ticket, 'STALE_WINDOW');
        this.#window = next; this.#total = 0; this.#courier = 0;
        this.#snapshotQueue();
      }
      return operation();
    } catch {
      this.#shutdown();
      return fail('QUEUE_FAILURE');
    } finally { this.#busy = false; }
  }

  #decision(kind) {
    return decideSlotAdmission({ windowSlots: this.#config.windowSlots,
      totalAdmitted: this.#total, courierAdmitted: this.#courier,
      courierQueued: this.#queueSnapshot.queued, kind });
  }

  enqueueCourier(bytes) {
    return this.#operate(() => {
      const response = this.#readQueue('enqueue', this.#queue.enqueue(bytes), this.#latch.now);
      this.#snapshotQueue();
      return response;
    });
  }

  takeCourier() {
    return this.#operate(() => {
      const decision = this.#decision('COURIER');
      if (decision !== 'ALLOW') return fail(decision);
      const taken = this.#readQueue('take', this.#queue.take(), this.#latch.now);
      if (taken.ok === false && taken.code === 'EMPTY') return taken;
      if (taken.ok !== true || taken.code !== 'TAKEN' || !taken.ticket || typeof taken.ticket !== 'object') throw Error('QUEUE_FAILURE');
      const ticket = Object.freeze(Object.create(null));
      this.#pending.set(ticket, { kind: 'COURIER', inner: taken.ticket, window: this.#window.index });
      this.#total++; this.#courier++;
      this.#snapshotQueue();
      return result(true, 'COURIER_ADMITTED', { ticket, windowIndex: this.#window.index });
    });
  }

  admitPrimary(workId, workSha256) {
    return this.#operate(() => {
      if (!validID(workId) || !validHash(workSha256)) return fail('PRIMARY_IDENTITY_INVALID');
      const previous = this.#primaryHistory.get(workId);
      if (previous) return previous.sha256 === workSha256
        ? result(true, 'DUPLICATE', { workId, workState: previous.state }) : fail('WORK_CONFLICT');
      if (this.#primaryHistory.size >= this.#config.maxPrimaryIds) return fail('PRIMARY_HISTORY_FULL');
      const decision = this.#decision('PRIMARY');
      if (decision !== 'ALLOW') return fail(decision);
      const ticket = Object.freeze(Object.create(null));
      const record = { workId, sha256: workSha256, state: 'ADMITTED' };
      this.#primaryHistory.set(workId, record);
      this.#pending.set(ticket, { kind: 'PRIMARY', record, window: this.#window.index });
      this.#total++;
      return result(true, 'PRIMARY_ADMITTED', { ticket, windowIndex: this.#window.index });
    });
  }

  claim(ticket) {
    return this.#operate(() => {
      const entry = this.#pending.get(ticket);
      if (!entry || entry.window !== this.#window.index) return fail('INVALID_TICKET');
      if (entry.kind === 'PRIMARY') {
        this.#pending.delete(ticket); entry.record.state = 'CLAIMED';
        return result(true, 'PRIMARY_CLAIMED', { workId: entry.record.workId, workSha256: entry.record.sha256 });
      }
      const delivery = this.#readQueue('consume', this.#queue.consume(entry.inner), this.#latch.now);
      this.#pending.delete(ticket);
      if (delivery.ok === false && delivery.code === 'INVALID_TICKET') return fail('INVALID_TICKET');
      if (delivery.ok !== true || delivery.code !== 'DELIVERED') throw Error('QUEUE_FAILURE');
      this.#snapshotQueue();
      return result(true, 'COURIER_CLAIMED', { taskId: delivery.taskId, packet: delivery.packet, payload: delivery.payload });
    });
  }

  cancel(ticket) {
    return this.#operate(() => this.#retire(ticket, 'CANCELLED') ? result(true, 'CANCELLED') : fail('INVALID_TICKET'));
  }

  cancelCourier(taskId) {
    return this.#operate(() => {
      const response = this.#readQueue('cancel', this.#queue.cancel(taskId), this.#latch.now);
      this.#snapshotQueue();
      return response;
    });
  }

  stop() {
    if (this.#busy) return fail('BUSY');
    if (!this.#active) return fail('OFF');
    return this.#shutdown() ? result(true, 'STOPPED') : fail('QUEUE_FAILURE');
  }

  inspect() {
    if (this.#busy) return fail('BUSY');
    const snapshot = () => result(true, 'SNAPSHOT', { state: this.#active ? 'ACTIVE' : 'OFF',
      windowIndex: this.#window.index, windowStart: this.#window.start, windowEnd: this.#window.end,
      windowSlots: this.#config.windowSlots, courierQuota: Math.floor(this.#config.windowSlots / 10),
      totalAdmitted: this.#total, courierAdmitted: this.#courier, primaryAdmitted: this.#total - this.#courier,
      pendingTickets: this.#pending.size, retainedPrimaryIds: this.#primaryHistory.size,
      courierQueue: this.#queueSnapshot, queueStopConfirmed: this.#queueStopConfirmed });
    return this.#active ? this.#operate(snapshot) : snapshot();
  }
}

export function createSharedWorkSlotScheduler(baseBytes, dualBytes, options) {
  try {
    if (!Buffer.isBuffer(baseBytes) || baseBytes.length === 0 || baseBytes.length > BN01_LIMITS.bytes ||
        !Buffer.isBuffer(dualBytes) || dualBytes.length === 0 || dualBytes.length > DUAL_FACE_LIMITS.bytes ||
        baseBytes.buffer instanceof SharedArrayBuffer || dualBytes.buffer instanceof SharedArrayBuffer) return fail('DECLARATION_BYTES_REFUSED');
    const baseCopy = Buffer.from(baseBytes), dualCopy = Buffer.from(dualBytes);
    const config = Object.freeze({ generation: options?.generation, windowSlots: options?.windowSlots,
      windowDurationMs: options?.windowDurationMs, maxPrimaryIds: options?.maxPrimaryIds,
      maxCourierIds: options?.maxCourierIds, clock: options?.clock });
    if (!boundedInt(config.generation, 1) || !boundedInt(config.windowSlots, 1, 1000) ||
        !boundedInt(config.windowDurationMs, 1, 60000) || !boundedInt(config.maxPrimaryIds, 1, 4096) ||
        !boundedInt(config.maxCourierIds, 1, 4096) || typeof config.clock !== 'function') return fail('CONFIGURATION_REFUSED');
    let now;
    try { now = config.clock(); } catch { return fail('CLOCK_ERROR'); }
    if (!boundedInt(now, 0)) return fail('CLOCK_INVALID');
    const initial = windowAt(now, now, config.windowDurationMs);
    if (!initial) return fail('CLOCK_RANGE');
    const latch = { now };
    const made = createCourierQueue(baseCopy, dualCopy, { generation: config.generation,
      maxRetainedTaskIds: config.maxCourierIds, clock: () => latch.now });
    if (!made.ok) return fail('QUEUE_CONSTRUCTION_REFUSED');
    const readQueue = makeQueueResponseReader(baseCopy, dualCopy, config.generation, config.maxCourierIds);
    const snapshot = readQueue('inspect', made.queue.inspect(), now);
    if (snapshot.state !== 'ACTIVE') { made.queue.stop(); return fail('QUEUE_FAILURE'); }
    return result(true, 'READY_PRIVATE_SLOT_SCHEDULER_ONLY', {
      scheduler: new SharedWorkSlotScheduler(config, made.queue, latch, initial, snapshot, readQueue) });
  } catch { return fail('CONSTRUCTION_ERROR'); }
}
