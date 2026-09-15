// Bounded AFM fan-out under one admitted run owner.
//
// The Apple on-device model saturates at FOUR concurrent sessions on this class
// of machine: measured 2026-09-10 on macOS 27.0 (FoundationModels 1.0), two
// reproduced sweeps, warmed, separate LanguageModelSession per request —
//
//     n=1  4.0 req/s   0.25s mean        n=6   6.0 req/s  0.80s mean
//     n=2  5.3 req/s   0.34s mean        n=8   6.2 req/s  1.06s mean
//     n=4  6.0 req/s   0.53s mean        n=16  6.2 req/s  2.19s mean
//
// Throughput is flat from four onward; every session past four buys latency and
// nothing else. Zero refusals were observed at any level, so the cap is a
// throughput fact, not an API limit. AFM_MAX_CONCURRENCY is therefore enforced
// structurally here rather than left to configuration.
//
// This module dispatches; it does not execute a model itself. The executor is
// injected, so the deterministic tests never need a model and the real binding
// stays outside this boundary. Nothing here grants authority, mints permission,
// promotes, or certifies: every authority flag is frozen false and observed
// model participation is reported separately, never as a verdict.
import { createHash } from 'node:crypto';
import { canonicalizeMAC1JSONV1 } from '../canonical/mac1-json-v1.mjs';
import { createScheduledRunOwner } from './scheduled-run-owner.mjs';
import { randomBytes } from 'node:crypto';

/** Measured saturation point of the on-device model. See the header. */
export const AFM_MAX_CONCURRENCY = 4;

/** floor(windowSlots / 10) is the scheduler's courier allowance, so the window
 *  that yields exactly AFM_MAX_CONCURRENCY couriers is forty slots. */
export const AFM_WINDOW_SLOTS = AFM_MAX_CONCURRENCY * 10;

const FLAGS = Object.freeze({ authorizing: false, modelExecuted: false,
  promotionGranted: false, certificationGranted: false });
const answer = (ok, code, fields = {}) => Object.freeze({ ...fields, ok, code, ...FLAGS });
const fail = (code, fields = {}) => answer(false, code, fields);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => canonicalizeMAC1JSONV1(Buffer.from(JSON.stringify(value), 'utf8')).canonical;
const isHex64 = v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const isID = v => typeof v === 'string' && v.length >= 1 && v.length <= 96 && /^[a-z][a-z0-9_.-]*$/.test(v);
const isInt = (v, min, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && v >= min && v <= max;

// Closed reader over whatever the injected executor returns. An unknown shape,
// an unknown code, or a self-asserted authority flag is refused outright: a
// dispatcher must never let an executor smuggle in its own verdict.
const OUTCOME_KEYS = ['ok', 'code', 'payloadSha256'];
const OUTCOME_CODES = ['AFM_PACKET_ANSWERED', 'AFM_PACKET_UNAVAILABLE', 'AFM_PACKET_REFUSED'];
function readOutcome(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.join('|') !== [...OUTCOME_KEYS].sort().join('|')) return null;
  if (typeof value.ok !== 'boolean' || !OUTCOME_CODES.includes(value.code)) return null;
  if (value.ok !== (value.code === 'AFM_PACKET_ANSWERED')) return null;
  if (!isHex64(value.payloadSha256)) return null;
  return Object.freeze({ ok: value.ok, code: value.code, payloadSha256: value.payloadSha256 });
}

class AFMDispatcher {
  #owner; #execute; #generation; #runId; #busy = false; #stopped = false; #dispatches = 0;

  constructor(owner, execute, generation, runId) {
    this.#owner = owner;
    this.#execute = execute;
    this.#generation = generation;
    this.#runId = runId;
  }

  /** One bounded fan-out. `packets` are canonical courier packet buffers, at
   *  most AFM_MAX_CONCURRENCY of them; each is admitted by the scheduler before
   *  any executor call, and a refusal anywhere refuses the whole dispatch. */
  async dispatch(packets, options = {}) {
    if (this.#stopped) return fail('DISPATCHER_STOPPED');
    if (this.#busy) return fail('DISPATCHER_BUSY');
    if (!Array.isArray(packets) || packets.length < 1) return fail('AFM_FANOUT_EMPTY');
    if (packets.length > AFM_MAX_CONCURRENCY) {
      return fail('AFM_FANOUT_REFUSED', { requested: packets.length, maximum: AFM_MAX_CONCURRENCY });
    }
    if (!packets.every(p => Buffer.isBuffer(p) && p.length > 0)) return fail('AFM_PACKET_BYTES_REFUSED');
    const descriptors = options && typeof options === 'object' && !Array.isArray(options) ? options : null;
    if (!descriptors || !Object.keys(descriptors).every(k => ['signal'].includes(k))) return fail('ARGUMENTS');
    const { signal } = descriptors;
    if (signal !== undefined && !(signal instanceof AbortSignal)) return fail('SIGNAL');
    if (signal?.aborted) return fail('ABORTED');

    this.#busy = true;
    const claimed = [];
    try {
      // 1. Admission first, for every packet, before any executor runs. A
      //    partially admitted fan-out is refused rather than partially executed.
      for (const packet of packets) {
        const queued = this.#owner.enqueueCourier(packet);
        if (!queued.ok) return fail('AFM_ADMISSION_REFUSED', { leafCode: queued.code });
        const taken = this.#owner.claimCourier();
        if (!taken.ok) return fail('AFM_ADMISSION_REFUSED', { leafCode: taken.code });
        if (!isID(taken.taskId)) return fail('AFM_ADMISSION_MALFORMED');
        claimed.push(taken.taskId);
      }
      if (claimed.length !== packets.length) return fail('AFM_ADMISSION_INCOMPLETE');
      if (signal?.aborted) return fail('ABORTED');

      // 2. Fan out. At most AFM_MAX_CONCURRENCY are in flight because that is
      //    the length bound checked above, so no semaphore is needed here.
      const settled = await Promise.all(claimed.map(async (taskId, index) => {
        try {
          const raw = await this.#execute(packets[index], { taskId, signal });
          return { taskId, outcome: readOutcome(raw) };
        } catch {
          return { taskId, outcome: null };
        }
      }));

      // 3. Refusal dominance: any malformed or refused packet refuses the whole
      //    dispatch. There is no partial success certificate.
      const malformed = settled.filter(s => s.outcome === null);
      if (malformed.length > 0) {
        return fail('AFM_OUTCOME_UNREADABLE', { unreadable: malformed.length });
      }
      const refused = settled.filter(s => !s.outcome.ok);
      if (refused.length > 0) {
        return fail('AFM_PACKET_REFUSED_DOMINATES', {
          refused: refused.length,
          leafCodes: Object.freeze(refused.map(s => s.outcome.code)),
        });
      }

      // 4. Combine in the caller's declared packet order, never re-sorted. The
      //    digest binds the dispatch identity and every payload; no wall-clock
      //    value reaches it, so an identical dispatch reproduces exactly.
      this.#dispatches += 1;
      const combined = {
        kind: 'veritas-afm-dispatch-v1',
        generation: this.#generation,
        packetCount: packets.length,
        packetSha256: Object.freeze(packets.map(p => sha(p))),
        payloadSha256: Object.freeze(settled.map(s => s.outcome.payloadSha256)),
      };
      const dispatchSha256 = sha(Buffer.from(`veritas/afm-dispatch/v1\0${canonical(combined)}`, 'utf8'));
      return answer(true, 'AFM_DISPATCH_COMPLETE', {
        generation: this.#generation,
        packetCount: packets.length,
        payloadSha256: combined.payloadSha256,
        dispatchSha256,
        // Observed, reported, never a verdict: the authority flags above stay false.
        modelParticipation: 'OBSERVED_ADVISORY_ONLY',
      });
    } catch {
      return fail('DISPATCH_ERROR');
    } finally {
      for (const taskId of claimed) { try { this.#owner.cancelCourier(taskId); } catch { /* terminal already */ } }
      this.#busy = false;
    }
  }

  status() {
    return answer(true, 'AFM_DISPATCHER_STATUS', {
      generation: this.#generation,
      runId: this.#runId,
      maximumConcurrency: AFM_MAX_CONCURRENCY,
      dispatchesCompleted: this.#dispatches,
      stopped: this.#stopped,
    });
  }

  stop() {
    this.#stopped = true;
    try { this.#owner.stop(); } catch { /* already stopped */ }
    return answer(true, 'AFM_DISPATCHER_STOPPED');
  }
}

/** Binds one scheduled run owner and a bounded AFM executor. The window is fixed
 *  at AFM_WINDOW_SLOTS so the scheduler's own courier allowance is exactly the
 *  measured concurrency ceiling; a caller cannot widen it. */
export function createAFMDispatcher(bindBytes, baseBytes, dualBytes, options) {
  try {
    const config = options && typeof options === 'object' && !Array.isArray(options) ? options : null;
    if (!config) return fail('CONFIGURATION_REFUSED');
    const allowed = ['clock', 'execute', 'generation', 'windowDurationMs', 'maxCourierIds'];
    if (!Object.keys(config).every(k => allowed.includes(k))) return fail('CONFIGURATION_REFUSED');
    const { clock, execute, generation, windowDurationMs, maxCourierIds } = config;
    if (typeof clock !== 'function' || typeof execute !== 'function') return fail('CONFIGURATION_REFUSED');
    if (!isInt(generation, 1) || !isInt(windowDurationMs, 1, 60000)) return fail('CONFIGURATION_REFUSED');
    if (!isInt(maxCourierIds, AFM_MAX_CONCURRENCY, 4096)) return fail('CONFIGURATION_REFUSED');
    const made = createScheduledRunOwner(bindBytes, baseBytes, dualBytes, {
      clock,
      windowSlots: AFM_WINDOW_SLOTS,
      windowDurationMs,
      maxCourierIds,
    });
    if (!made.ok) return fail('OWNER_REFUSED', { leafCode: made.code });
    const owner = made.owner;

    // The dispatcher IS one admitted run. Couriers only travel under an admitted
    // run, so the permit is minted and the run admitted here, once, at
    // construction; the fan-out below is traveler work inside that single run and
    // never a second admission.
    const bind = JSON.parse(Buffer.from(bindBytes).toString('utf8'));
    const pins = {
      graphSha256: bind.graphSha256, runSha256: bind.runSha256,
      topologySha256: bind.topologySha256, planSha256: bind.planSha256,
    };
    const runId = 'afm.' + randomBytes(16).toString('hex');
    const scope = 'afm-dispatch';
    const request = canonical({
      kind: 'veritas-admitted-run-permit-request-v1',
      runId, requester: 'PRIMARY', generation, scope });
    const permit = owner.requestPermit(request);
    if (!permit.ok) { try { owner.stop(); } catch { /* already */ } return fail('PERMIT_REFUSED', { leafCode: permit.code }); }
    const execution = canonical({
      kind: 'veritas-admitted-run-execution-v1',
      permitId: permit.permitId, runId, requester: 'PRIMARY', generation, scope, ...pins });
    const admitted = owner.checkExecution(execution);
    if (!admitted.ok) { try { owner.stop(); } catch { /* already */ } return fail('RUN_ADMISSION_REFUSED', { leafCode: admitted.code }); }

    return answer(true, 'READY_PRIVATE_AFM_DISPATCHER_ONLY', {
      dispatcher: new AFMDispatcher(owner, execute, generation, runId),
    });
  } catch {
    return fail('CONSTRUCTION_ERROR');
  }
}
