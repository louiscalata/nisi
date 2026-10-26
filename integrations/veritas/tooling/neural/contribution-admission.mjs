// BN-03 integration glue (contract level): one contribution admission attempt is
// a single frozen verdict composed across the default-contribution-rounds
// outcome, the admitted-run-owner check and a declared courier-queue snapshot.
// Pure decision function: no model execution, no scheduler, no queue instance and
// no permission minting. Any refusal at any gate dominates, so a refused attempt
// can never degrade into a partial dispatch. The attempt counter hard-caps
// schema-valid attempts (default exactly 3), so even a bypassed or misimplemented
// upstream gate cannot create indefinite work at this layer.
//
// The courier-queue slice itself is ajv-backed and cannot run in this
// dependency-free tree; this module accepts a *declared* queue snapshot and
// refuses OFF/BUSY/invalid/over-capacity snapshots instead of trusting them.
import { createHash } from 'node:crypto';

const FLAGS = Object.freeze({ authorizing: false, modelExecuted: false,
  promotionGranted: false, certificationGranted: false });
const answer = (ok, code, fields = {}) => Object.freeze({ ok, code, ...fields, ...FLAGS });
const fail = (code, fields = {}) => answer(false, code, fields);
const isID = v => typeof v === 'string' && v.length >= 1 && v.length <= 96 && /^[a-z][a-z0-9_.-]*(?![\s\S])/.test(v);
const isInt = (v, min, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && v >= min && v <= max;
const isPlain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
// Key-set match is order-independent on both sides (declarations arrive in
// canonical sorted-key order; the expected lists below are written readably).
const keysEqual = (value, expected) => isPlain(value) &&
  Object.keys(value).sort().join('\0') === [...expected].sort().join('\0');

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const ATTEMPT_KEYS = Object.freeze(['kind', 'attemptId', 'requester', 'generation']);
const ROUND_KEYS = Object.freeze(['outcome', 'channelId']);
const OWNER_KEYS = Object.freeze(['outcome', 'permitId']);
const QUEUE_KEYS = Object.freeze(['state', 'inFlight', 'capacity', 'retainedTasks', 'packetBytes']);
const CONFIG_KEYS = Object.freeze(['kind', 'profile', 'schemaVersion', 'generation', 'maxAttempts', 'packetBytesLimit']);

const ROUND_DISPATCH = 'DEFAULT_ROUND_DISPATCHED';
const OWNER_ADMITTED = 'ADMITTED';
const ROUND_REFUSALS = Object.freeze(['ROUND_ROUTE_DENIED', 'ROUND_ROUTE_UNAVAILABLE', 'ROUND_ROUTE_UNKNOWN',
  'ROUND_ROUTE_REMEMBRANCE_REFUSED', 'INDEFINITE_WORK_REFUSED', 'SESSION_ROUNDS_EXHAUSTED',
  'ROUND_NONCANONICAL', 'ROUND_SCHEMA_INVALID', 'ROUND_SESSION_MISMATCH', 'ROUND_GENERATION_MISMATCH']);
const OWNER_REFUSALS = Object.freeze(['PERMIT_STALE', 'PERMIT_REVOKED', 'LATE_OUTPUT_REFUSED',
  'PERMIT_ABSENT', 'EXECUTION_GENERATION_MISMATCH', 'EXECUTION_IDENTITY_MISMATCH',
  'EXECUTION_PIN_MISMATCH', 'OWNER_REVOKED', 'RUN_ALREADY_ADMITTED',
  'PERMIT_NONCANONICAL', 'PERMIT_REQUEST_SCHEMA_INVALID', 'PERMIT_GENERATION_MISMATCH',
  'EXECUTION_NONCANONICAL', 'EXECUTION_SCHEMA_INVALID', 'JSON_INVALID']);
const QUEUE_LIVE = Object.freeze(['QUEUED', 'IN_FLIGHT']);

function attemptValid(v) {
  if (!keysEqual(v, ATTEMPT_KEYS)) return false;
  return v.kind === 'veritas-contribution-admission-v1' && isID(v.attemptId) &&
    v.requester === 'PRIMARY' && isInt(v.generation, 1);
}
function roundValid(v) {
  if (!keysEqual(v, ROUND_KEYS)) return false;
  return (v.outcome === ROUND_DISPATCH || ROUND_REFUSALS.includes(v.outcome)) && isID(v.channelId);
}
function ownerValid(v) {
  if (!keysEqual(v, OWNER_KEYS)) return false;
  return (v.outcome === OWNER_ADMITTED || OWNER_REFUSALS.includes(v.outcome)) && isID(v.permitId);
}
function queueValid(v) {
  if (!keysEqual(v, QUEUE_KEYS)) return false;
  if (!QUEUE_LIVE.includes(v.state) && v.state !== 'OFF' && v.state !== 'BUSY') return false;
  return isInt(v.inFlight, 0) && isInt(v.capacity, 0) && isInt(v.retainedTasks, 0) && isInt(v.packetBytes, 8);
}
function configValid(v) {
  if (!keysEqual(v, CONFIG_KEYS)) return false;
  return v.kind === 'veritas-contribution-admission-config-v1' &&
    v.profile === 'veritas-bn03-offline-contract-v1' && v.schemaVersion === 1 &&
    isInt(v.generation, 1) && isInt(v.maxAttempts, 1, 65536) && isInt(v.packetBytesLimit, 8, 65536);
}

class ContributionAdmission {
  #generation;
  #maxAttempts;
  #packetBytesLimit;
  #attempts = 0;
  #ledger = [];
  #clock;
  #now;

  constructor(config, options, now) {
    this.#generation = config.generation;
    this.#maxAttempts = config.maxAttempts;
    this.#packetBytesLimit = config.packetBytesLimit;
    this.#clock = options.clock;
    this.#now = now;
  }

  #time() {
    // Ledger timestamps only; deliberately absent from every digest so an
    // admission identity is reproducible from its attempt and gates alone.
    return typeof this.#clock === 'function' ? this.#clock() : Date.now();
  }

  #counter() {
    const previous = this.#attempts;
    this.#attempts++;
    return previous;
  }

  admissionAttempt(input, gates) {
    // Retain at most maxAttempts + 1 observations (including cap refusal).
    // Once full, refuse without parsing, allocating another entry or sampling
    // the clock. Earlier evidence is never evicted; saturation is explicit.
    if (this.#ledger.length >= this.#maxAttempts + 1) return fail('LEDGER_CAP_EXHAUSTED');
    let attemptId = null;
    const bounded = typeof input === 'string' && input.length <= 65536 &&
      Buffer.byteLength(input, 'utf8') <= 65536;
    if (bounded) {
      try {
        const id = JSON.parse(input)?.attemptId;
        attemptId = isID(id) ? id : null;
      } catch { /* Invalid identity is never retained as caller data. */ }
    }
    let verdict;
    try { verdict = bounded ? this.#evaluateAttempt(input, gates) : fail('ADMISSION_BYTES_REFUSED'); }
    catch { verdict = fail('ADMISSION_INPUT_REFUSED'); }
    this.#ledger.push(Object.freeze({
      attemptId, code: verdict.code,
      ok: verdict.ok, atMs: this.#time(),
    }));
    return verdict;
  }

  #evaluateAttempt(input, gates) {
    let value;
    try { value = JSON.parse(input); }
    catch { return fail('JSON_INVALID'); }
    if (canonical(value) !== input) return fail('ADMISSION_NONCANONICAL');
    if (!attemptValid(value)) return fail('ADMISSION_SCHEMA_INVALID');
    if (value.generation !== this.#generation) return fail('ADMISSION_GENERATION_MISMATCH');
    if (this.#counter() >= this.#maxAttempts) return fail('CAP_EXHAUSTED');
    // Gates are declared objects from the owning slices; this layer never calls
    // them. The closed reader rejects unknown outcomes so a novel bypass code
    // can never smuggle through a gate.
    let round, owner, queue;
    try {
      [round, owner, queue] = [gates.round, gates.owner, gates.queue].map(g => JSON.parse(g));
    } catch { return fail('GATE_DECLARATIONS_INVALID'); }
    if (canonical(round) !== gates.round || canonical(owner) !== gates.owner || canonical(queue) !== gates.queue) {
      return fail('GATE_DECLARATIONS_INVALID');
    }
    if (!roundValid(round) || !ownerValid(owner) || !queueValid(queue)) return fail('GATE_DECLARATIONS_INVALID');

    // Gate 1: default contribution round must have dispatched.
    if (round.outcome !== ROUND_DISPATCH) {
      return fail('CONTRIBUTION_ROUND_REFUSED', { roundOutcome: round.outcome, channelId: round.channelId });
    }
    // Gate 2: the admitted run owner must have admitted this exact run.
    if (owner.outcome !== OWNER_ADMITTED) {
      return fail('CONTRIBUTION_OWNER_REFUSED', { ownerOutcome: owner.outcome, permitId: owner.permitId });
    }
    // Gate 3: the courier queue must be live and have room; bounded, never trusted.
    if (queue.state !== 'QUEUED') return fail('CONTRIBUTION_QUEUE_REFUSED', { queueState: queue.state });
    if (queue.inFlight + 1 > queue.capacity) return fail('CONTRIBUTION_QUEUE_REFUSED', { queueState: 'CAPACITY' });
    if (queue.packetBytes > this.#packetBytesLimit) return fail('CONTRIBUTION_QUEUE_REFUSED', { queueState: 'PACKET_OVER_LIMIT' });

    const attemptId = value.attemptId;
    const digest = createHash('sha256')
      .update(`veritas/contribution-admission/${attemptId}\0${this.#generation}`)
      .update(canonical(round)).update(canonical(owner)).update(canonical(queue)).digest('hex');
    return answer(true, 'CONTRIBUTION_DISPATCHED', {
      attemptId, admission: `admission-${digest.slice(0, 16)}`,
      roundOutcome: round.outcome, queueState: queue.state,
      attemptsUsed: this.#attempts, maxAttempts: this.#maxAttempts,
    });
  }

  status() {
    return answer(true, 'ADMISSION_STATUS', {
      generation: this.#generation, attemptsUsed: this.#attempts,
      maxAttempts: this.#maxAttempts, packetBytesLimit: this.#packetBytesLimit,
    });
  }

  // Read-only append-only outcome ledger: every attempt's verdict in arrival
  // order, each a frozen canonical record.
  ledger() {
    return answer(true, 'ADMISSION_LEDGER', {
      generation: this.#generation,
      entries: Object.freeze([...this.#ledger]),
      count: this.#ledger.length,
      capacity: this.#maxAttempts + 1,
      saturated: this.#ledger.length >= this.#maxAttempts + 1,
    });
  }
}

/** Binds a closed admission config (generation, hard attempt cap, packet ceiling).
 * A declared dispatch is an advisory verdict with every authority flag frozen
 * false; it never enqueues, executes, mints or authorizes anything. */
export function createContributionAdmission(configBytes, options) {
  try {
    const captured = Object.freeze({ clock: options?.clock ?? null });
    if (captured.clock !== null && typeof captured.clock !== 'function') return fail('CONFIGURATION_REFUSED');
    if (!Buffer.isBuffer(configBytes) || configBytes.length === 0 || configBytes.length > 65536) return fail('CONFIGURATION_BYTES_REFUSED');
    if (configBytes.buffer instanceof SharedArrayBuffer) return fail('CONFIGURATION_BYTES_REFUSED');
    const text = configBytes.toString('utf8');
    let value;
    try { value = JSON.parse(text); }
    catch { return fail('CONFIGURATION_BYTES_REFUSED'); }
    if (canonical(value) !== text) return fail('CONFIGURATION_REFUSED');
    if (!configValid(value)) return fail('CONFIGURATION_REFUSED');
    const admit = new ContributionAdmission(value, captured, Date.now());
    return answer(true, 'READY_PRIVATE_CONTRIBUTION_ADMISSION_ONLY', { admit });
  } catch {
    return fail('CONSTRUCTION_ERROR');
  }
}
