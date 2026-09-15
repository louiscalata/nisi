// Private admitted-run ownership contract (BN01-C09 slice / C05 flavor).
// Pure declarations/contract only: no model execution, no permission minting,
// no scheduler binding, no device resources, no caller-supplied paths or model
// objects are resolved. An admitted run and a minted permit are advisory
// decisions, never authority, and never a PASS.
//
// Contract under test: exactly one admitted run per bound generation, one-use
// advisory permit observations bound to exact immutable run identity (graph/run/
// topology/plan digests, requester, scope, generation), expiry, revocation and
// late-output refusal — with zero execution possible by construction.
//
// Fully dependency-free by design: owned canonical raw bytes in, closed frozen
// results out.
import { createHash } from 'node:crypto';

export const OWNER_LIMITS = Object.freeze({ textBytes: 65536, depth: 24, values: 12000, ledgerEntries: 3 });

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
  return createHash('sha256').update(`veritas/admitted-run/${record.kind}\0`).update(canonical(record)).digest('hex');
}

function parseText(text) {
  if (typeof text !== 'string' || !text.length || text.length > OWNER_LIMITS.textBytes ||
      Buffer.byteLength(text, 'utf8') > OWNER_LIMITS.textBytes) throw Error('TEXT_LIMIT');
  const value = JSON.parse(text), stack = [[value, 0]];
  let count = 0;
  while (stack.length) {
    const [item, depth] = stack.pop();
    if (++count > OWNER_LIMITS.values || depth > OWNER_LIMITS.depth) throw Error('TREE_LIMIT');
    if (item && typeof item === 'object') for (const child of Object.values(item)) stack.push([child, depth + 1]);
  }
  return value;
}

const RUN_KEYS = Object.freeze(['kind', 'runId', 'requester', 'generation', 'scope']);
const IDENTITY_KEYS = Object.freeze(['graphSha256', 'runSha256', 'topologySha256', 'planSha256']);
const BIND_KEYS = Object.freeze(['kind', 'profile', 'schemaVersion', 'generation', 'runBudgetCap', 'deadlineMs', ...IDENTITY_KEYS]);
const EXEC_KEYS = Object.freeze(['kind', 'permitId', 'runId', 'requester', 'generation', 'scope', ...IDENTITY_KEYS]);

function identityPins(raw) {
  return { graphSha256: raw.graphSha256, runSha256: raw.runSha256,
    topologySha256: raw.topologySha256, planSha256: raw.planSha256 };
}
function pinsValid(raw) {
  return IDENTITY_KEYS.every(k => isHash(raw[k]));
}
function bindValid(v) {
  if (!keysEqual(v, BIND_KEYS)) return false;
  if (v.kind !== 'veritas-admitted-run-bind-v1' || v.profile !== 'veritas-bn01-offline-contract-v1' || v.schemaVersion !== 1) return false;
  return isInt(v.generation, 1) && isInt(v.runBudgetCap, 1, 65536) && isInt(v.deadlineMs, 1, 60000) && pinsValid(v);
}
function runValid(v) {
  if (!keysEqual(v, RUN_KEYS)) return false;
  return v.kind === 'veritas-admitted-run-permit-request-v1' && isID(v.runId) &&
    v.requester === 'PRIMARY' && isInt(v.generation, 1) && isID(v.scope);
}
function execValid(v) {
  if (!keysEqual(v, EXEC_KEYS)) return false;
  return v.kind === 'veritas-admitted-run-execution-v1' && isID(v.permitId) && isID(v.runId) &&
    v.requester === 'PRIMARY' && isInt(v.generation, 1) && isID(v.scope) && pinsValid(v);
}

class AdmittedRunOwner {
  #generation = 0;
  #budgetCap = 0;
  #deadlineMs = 0;
  #pins = null;
  #permit = null;
  #consumed = false;
  #revoked = false;
  #expired = false;
  #busy = false;
  #clock = null;
  #now = null;
  #admitted = 0;
  #executions = 0;
  #ledger = [];

  constructor(bindValue, options) {
    this.#generation = bindValue.generation;
    this.#budgetCap = bindValue.runBudgetCap;
    this.#deadlineMs = bindValue.deadlineMs;
    this.#pins = Object.freeze(identityPins(bindValue));
    this.#clock = options.clock ?? (() => Math.floor(performance.now()));
  }

  #record(event, atMs = this.#now, timeBasis = 'OPERATION_SAMPLE') {
    // State transitions bound this to issue + (execution OR expiry) + revoke.
    // Rejections/repeats never append; this is an event trail, not a call log.
    this.#ledger.push(Object.freeze({ event, permitId: this.#permit?.value.permitId ?? null,
      runId: this.#permit?.value.runId ?? null, atMs, timeBasis }));
  }

  #clockFailure() {
    this.#revoked = true;
    this.#consumed = true;
    this.#record('OWNER_CLOCK_REFUSED', this.#now, 'LAST_VALID_SAMPLE');
    return fail('CLOCK_REFUSED');
  }

  #operation(revokedCode, action) {
    if (this.#revoked) return fail(revokedCode);
    if (this.#busy) return fail('BUSY');
    this.#busy = true;
    try {
      let now;
      try { now = this.#clock(); }
      catch { return this.#revoked ? fail(revokedCode) : this.#clockFailure(); }
      // Revocation is allowed inside the clock callback and wins before commit.
      if (this.#revoked) return fail(revokedCode);
      if (!isInt(now, 0) || (this.#now !== null && now < this.#now)) return this.#clockFailure();
      this.#now = now;
      return action(now);
    } catch { return fail('OPERATION_REFUSED'); }
    finally { this.#busy = false; }
  }

  requestPermit(text) {
    // A revoked owner refuses further mints outright; revocation dominates.
    if (this.#revoked) return fail('OWNER_REVOKED');
    if (this.#busy) return fail('BUSY');
    // One admitted run at a time: a second permit while one is live is refused.
    if (this.#permit) return fail('RUN_ALREADY_ADMITTED');
    return this.#operation('OWNER_REVOKED', now => this.#requestPermit(text, now));
  }

  #requestPermit(text, now) {
    let value;
    try { value = parseText(text); }
    catch { return fail('JSON_INVALID'); }
    if (canonical(value) !== text) return fail('PERMIT_NONCANONICAL');
    if (!runValid(value)) return fail('PERMIT_REQUEST_SCHEMA_INVALID');
    if (value.generation !== this.#generation) return fail('PERMIT_GENERATION_MISMATCH');
    const expiresAtMs = now + this.#deadlineMs;
    if (!Number.isSafeInteger(expiresAtMs)) return fail('DEADLINE_OVERFLOW');
    const permit = Object.freeze({ kind: 'veritas-admitted-run-permit-v1', permitId: `permit-${hash(value).slice(0, 16)}`,
      runId: value.runId, requester: value.requester, generation: value.generation, scope: value.scope, ...this.#pins,
      issuedAtMs: now, deadlineMs: this.#deadlineMs });
    // The returned digest binds the permit's identity, deliberately excluding
    // issuedAtMs: mixing wall-clock time made the same request produce a
    // different digest on every run, so it could not be compared or replayed.
    const { issuedAtMs, ...identity } = permit;
    this.#permit = Object.freeze({ value: permit, digest: hash(identity), expiresAtMs });
    this.#admitted++;
    this.#record('PERMIT_ISSUED', now);
    return answer(true, 'PERMIT_ISSUED', { permitId: permit.permitId, runId: permit.runId, digest: this.#permit.digest });
  }

  checkExecution(text) {
    return this.#operation('PERMIT_REVOKED', now => this.#checkExecution(text, now));
  }

  // Non-consuming inspection for the internally owned scheduler composition.
  // CURRENT is neither a permission nor a consumed admission. The composition
  // must call checkExecution again AFTER the actual scheduler claim succeeds.
  inspectExecution(text) {
    return this.#operation('PERMIT_REVOKED', now => {
      const checked = this.#validateExecution(text, now);
      if (!checked.ok) return checked;
      return answer(true, 'EXECUTION_DECLARATION_CURRENT', {
        runId: this.#permit.value.runId, permitId: this.#permit.value.permitId,
        workSha256: this.#permit.digest });
    });
  }

  #validateExecution(text, now) {
    // Never executes anything. A refused execution is zero-work by construction.
    let value;
    try { value = parseText(text); }
    catch { return fail('JSON_INVALID'); }
    if (canonical(value) !== text) return fail('EXECUTION_NONCANONICAL');
    if (!execValid(value)) return fail('EXECUTION_SCHEMA_INVALID');
    if (value.generation !== this.#generation) return fail('EXECUTION_GENERATION_MISMATCH');
    if (!this.#permit || this.#permit.value.permitId !== value.permitId) return fail('PERMIT_ABSENT');
    if (this.#consumed) return fail('LATE_OUTPUT_REFUSED');
    if (now >= this.#permit.expiresAtMs) {
      if (!this.#expired) { this.#expired = true; this.#record('PERMIT_EXPIRED', now); }
      return fail('PERMIT_STALE');
    }
    if (this.#permit.value.runId !== value.runId || this.#permit.value.scope !== value.scope) return fail('EXECUTION_IDENTITY_MISMATCH');
    if (this.#permit.value.graphSha256 !== value.graphSha256 || this.#permit.value.runSha256 !== value.runSha256 ||
        this.#permit.value.topologySha256 !== value.topologySha256 || this.#permit.value.planSha256 !== value.planSha256) return fail('EXECUTION_PIN_MISMATCH');
    return answer(true, 'EXECUTION_DECLARATION_CURRENT');
  }

  #checkExecution(text, now) {
    const checked = this.#validateExecution(text, now);
    if (!checked.ok) return checked;
    this.#consumed = true;
    this.#executions++;
    this.#record('EXECUTION_ADMITTED', now);
    return answer(true, 'ADMITTED', { runId: this.#permit.value.runId, permitId: this.#permit.value.permitId,
      executionsUsed: this.#executions, budgetCap: this.#budgetCap });
  }

  revoke(permitId = null) {
    if (permitId !== null && (!isID(permitId) || !this.#permit || this.#permit.value.permitId !== permitId)) return fail('PERMIT_ABSENT');
    const code = this.#permit ? 'PERMIT_REVOKED' : 'OWNER_REVOKED';
    if (this.#revoked) return answer(true, code, { permitId: this.#permit?.value.permitId ?? null });
    // Cancellation may run during a clock callback. It must not need that clock
    // to succeed, nor wait behind the operation whose commit it invalidates.
    this.#revoked = true;
    this.#consumed = true;
    this.#record(code, this.#now, 'LAST_VALID_SAMPLE');
    return answer(true, code, { permitId: this.#permit?.value.permitId ?? null });
  }

  // Read-only append-only audit trail: every permit/execution/revocation
  // event in issue order, each a frozen canonical record.
  ledger() {
    return answer(true, 'OWNER_LEDGER', {
      generation: this.#generation,
      entries: Object.freeze([...this.#ledger]),
      count: this.#ledger.length,
      capacity: OWNER_LIMITS.ledgerEntries,
    });
  }

  status() {
    return answer(true, 'OWNER_STATUS', {
      generation: this.#generation, admitted: this.#admitted,
      executionsUsed: this.#executions, permitLive: this.#permit !== null && !this.#consumed && !this.#expired,
      revoked: this.#revoked, expired: this.#expired, budgetCap: this.#budgetCap, deadlineMs: this.#deadlineMs,
    });
  }
}

/** Binds one owned canonical run-identity declaration and its exact generation.
 * No scheduler, runner, model or queue is resolved; a minted permit is a
 * one-use advisory token, never permission and never execution. */
export function createAdmittedRunOwner(bindBytes, options) {
  try {
    const captured = Object.freeze({ clock: options?.clock ?? null });
    if (captured.clock !== null && typeof captured.clock !== 'function') return fail('DECLARATIONS_REFUSED');
    if (!Buffer.isBuffer(bindBytes) || bindBytes.length === 0 || bindBytes.length > 65536) return fail('DECLARATION_BYTES_REFUSED');
    if (bindBytes.buffer instanceof SharedArrayBuffer) return fail('DECLARATION_BYTES_REFUSED');
    const owned = Buffer.from(bindBytes), text = owned.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(owned)) return fail('DECLARATION_BYTES_REFUSED');
    let value;
    try { value = parseText(text); }
    catch { return fail('DECLARATION_BYTES_REFUSED'); }
    if (!bindValid(value)) return fail('DECLARATIONS_REFUSED');
    if (canonical(value) !== text) return fail('DECLARATIONS_REFUSED');
    const owner = new AdmittedRunOwner(value, captured);
    return answer(true, 'READY_PRIVATE_ADMITTED_RUN_OWNER_ONLY', { owner });
  } catch {
    return fail('CONSTRUCTION_ERROR');
  }
}
