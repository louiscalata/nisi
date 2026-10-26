// Private default-contribution-round contract (BN01-C09 slice).
// Pure declarations/contract only: no model execution, no permission minting,
// no CPU/work-slot scheduling, no device resources, no caller-supplied paths
// or model objects are resolved. Results are advisory decisions, never PASS.
//
// Contract under test (BN01-C09): "Three default contribution requests cannot
// bypass unavailable/denied routes or create indefinite work."
//  - A default round targeting a DENIED or UNAVAILABLE route is REFUSED and the
//    refusal is remembered for the session, so a recast via a different
//    roundId/expertise/ttl on the same blocked channel is refused as well.
//  - The default round cap is exactly 3 proposals per session; the 4th
//    proposal is refused outright (bounded attempts -> no indefinite work).
//  - After the cap is reached the session is terminal (EXHAUSTED) and never
//    reports success; a dispatched default round is advisory only.
//
// Fully dependency-free by design (this repo copy has no node_modules
// installed): owned canonical raw bytes in, closed frozen results out.
import { createHash } from 'node:crypto';

const ROUTE_STATES = Object.freeze(['ALLOW', 'DENIED', 'UNAVAILABLE']);
const DEFAULT_ROUND_CAP = 3;
const FLAGS = Object.freeze({ authorizing: false, modelExecuted: false,
  promotionGranted: false, certificationGranted: false });
const answer = (ok, code, fields = {}) => Object.freeze({ ok, code, ...fields, ...FLAGS });
const fail = code => answer(false, code);
const isID = v => typeof v === 'string' && v.length >= 1 && v.length <= 96 && /^[a-z][a-z0-9_.-]*(?![\s\S])/.test(v);
const isHash = v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const isInt = (v, min, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && v >= min && v <= max;
const isPlain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
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
  return createHash('sha256').update(`veritas/default-round/${record.kind}\0`).update(canonical(record)).digest('hex');
}

const SESSION_KEYS = Object.freeze(['kind', 'sessionId', 'requester', 'generation', 'defaultCap', 'routes']);
const SESSION_ROUTE_KEYS = Object.freeze(['channelId', 'fromNodeId', 'toNodeId', 'state']);
const ROUND_KEYS = Object.freeze(['kind', 'roundId', 'sessionId', 'channelId', 'requester', 'generation', 'expertise', 'ttlMs']);

function sessionRouteValid(value) {
  if (!keysEqual(value, SESSION_ROUTE_KEYS)) return false;
  return isID(value.channelId) && isID(value.fromNodeId) && isID(value.toNodeId) && ROUTE_STATES.includes(value.state);
}
function sessionValid(value) {
  if (!keysEqual(value, SESSION_KEYS)) return false;
  if (value.kind !== 'veritas-default-round-session-v1' || value.requester !== 'PRIMARY') return false;
  if (!isID(value.sessionId) || !isInt(value.generation, 1)) return false;
  if (value.defaultCap !== DEFAULT_ROUND_CAP) return false;
  if (!Array.isArray(value.routes) || value.routes.length < 1 || value.routes.length > 24) return false;
  const seen = new Set();
  for (const route of value.routes) {
    if (!sessionRouteValid(route) || seen.has(route.channelId)) return false;
    seen.add(route.channelId);
  }
  return true;
}
function roundValid(value) {
  if (!keysEqual(value, ROUND_KEYS)) return false;
  return value.kind === 'veritas-default-round-request-v1' && isID(value.roundId) &&
    isID(value.sessionId) && isID(value.channelId) && value.requester === 'PRIMARY' &&
    isInt(value.generation, 1) && isID(value.expertise) && isInt(value.ttlMs, 1, 60000);
}

class DefaultContributionRounds {
  #session = null;
  #routes = new Map();
  #denyLedger = new Set();
  #rounds = [];
  #dispatched = 0;

  constructor(header, generation) {
    this.#session = Object.freeze({ ...header, sessionDigest: hash(header) });
    this.#routes = new Map(header.routes.map(r => [r.channelId, r]));
  }

  proposeRound(text) {
    // Every schema-valid proposal advances the session; the cap bounds both
    // dispatched work and refused attempts, so blocked routes cannot be probed
    // without end ("no indefinite work").
    let value;
    try { value = JSON.parse(text); }
    catch { return fail('JSON_INVALID'); }
    if (canonical(value) !== text) return fail('ROUND_NONCANONICAL');
    if (!roundValid(value)) return fail('ROUND_SCHEMA_INVALID');
    if (value.sessionId !== this.#session.sessionId) return fail('ROUND_SESSION_MISMATCH');
    if (value.generation !== this.#session.generation) return fail('ROUND_GENERATION_MISMATCH');
    if (this.#rounds.length >= DEFAULT_ROUND_CAP) return fail('INDEFINITE_WORK_REFUSED');
    this.#rounds.push(Object.freeze({ ...value, roundDigest: hash(value) }));
    const route = this.#routes.get(value.channelId);
    if (!route) return fail('ROUND_ROUTE_UNKNOWN');
    if (this.#denyLedger.has(value.channelId)) return fail('ROUND_ROUTE_REMEMBRANCE_REFUSED');
    if (route.state === 'ALLOW') {
      this.#dispatched++;
      return answer(true, 'DEFAULT_ROUND_DISPATCHED', { sessionId: value.sessionId, roundId: value.roundId, channelId: value.channelId, expertise: value.expertise, dispatched: this.#dispatched });
    }
    this.#denyLedger.add(value.channelId);
    return answer(false, route.state === 'DENIED' ? 'ROUND_ROUTE_DENIED' : 'ROUND_ROUTE_UNAVAILABLE',
      { sessionId: value.sessionId, roundId: value.roundId, channelId: value.channelId });
  }

  sessionStatus() {
    const terminal = this.#rounds.length >= DEFAULT_ROUND_CAP;
    const code = terminal ? 'SESSION_ROUNDS_EXHAUSTED' : (this.#dispatched > 0 ? 'SESSION_DISPATCHED' : 'SESSION_OPEN');
    return answer(true, code, {
      sessionId: this.#session.sessionId,
      sessionDigest: this.#session.sessionDigest,
      rounds: this.#rounds.length,
      cap: DEFAULT_ROUND_CAP,
      dispatched: this.#dispatched,
      refused: this.#rounds.length - this.#dispatched,
      terminal,
    });
  }

  // Read-only audit: one route's live state plus whether this session already
  // remembers refusing it (a recast on the same channel is refused again).
  routeStatus(channelId) {
    if (!isID(channelId)) return fail('ROUTE_STATUS_INVALID_ID');
    const route = this.#routes.get(channelId);
    if (!route) return fail('ROUTE_UNKNOWN');
    return answer(true, 'ROUTE_STATUS', {
      sessionId: this.#session.sessionId, channelId,
      state: route.state,
      rememberedRefusal: this.#denyLedger.has(channelId),
    });
  }
}

/** Binds one owned canonical default-round session declaration and its exact
 * generation. No queue, scheduler, worker or model is resolved; a bound
 * session is not permission and a dispatched default round never executes. */
export function createDefaultContributionRounds(sessionBytes, options) {
  try {
    const captured = Object.freeze({ generation: options?.generation });
    if (!isInt(captured.generation, 1)) return fail('CONFIGURATION_REFUSED');
    if (!Buffer.isBuffer(sessionBytes) || sessionBytes.length === 0 || sessionBytes.length > 65536) return fail('DECLARATION_BYTES_REFUSED');
    if (sessionBytes.buffer instanceof SharedArrayBuffer) return fail('DECLARATION_BYTES_REFUSED');
    let value;
    try { value = JSON.parse(sessionBytes.toString('utf8')); }
    catch { return fail('DECLARATION_BYTES_REFUSED'); }
    if (!sessionValid(value)) return fail('DECLARATIONS_REFUSED');
    if (value.generation !== captured.generation) return fail('DECLARATION_GENERATION_MISMATCH');
    if (canonical(value) !== sessionBytes.toString('utf8')) return fail('DECLARATIONS_REFUSED');
    const rounds = new DefaultContributionRounds(value, captured.generation);
    return answer(true, 'READY_PRIVATE_DEFAULT_CONTRIBUTION_ROUNDS_ONLY', { rounds });
  } catch {
    return fail('CONSTRUCTION_ERROR');
  }
}