// Private default contribution round planner (BN01-C09 "default rounds" gap).
// Pure declarations/contract only: no model execution, no work-slot scheduling,
// no permission minting, no retries, no clock reads. The planner records bounded
// per-role round outcomes and makes ONE deterministic advisory selection
// (solo/pair/trio) among the roles with SUCCESS outcomes. A selection is not
// authorization: exactly one writer may later apply an approved candidate after
// required checks; this file neither writes, executes, nor schedules anything.
//
// Sibling contracts in this layer (do not duplicate): default-contribution-rounds.mjs
// is the session cap / refused-route remembrance bound; contribution-admission.mjs
// is the closed admission config; admitted-run-owner.mjs is the run budget owner;
// typed-contribution-combiner.mjs generalizes task/response/combiner types.
//
// Dependency-free by design (same policy as task-response-combiner.mjs: this
// repo copy has no node_modules installed). It composes the combiner for the
// bounded base/dual declarations and task pins, and adds only the round
// envelope, outcome records and the selection policy.
//
// Round bounds (from the canonical design):
//   * default round requests the task's pinned required contributors in their
//     declared order (bounded 1..3) — never an unbounded "all roles" fan-out;
//   * boundedRetries is always 0: a round may not create indefinite work;
//   * deadlineMs is carried from the admitted task (1..60000); enforcing it is
//     the executor's job, this planner is deliberately clock-free;
//   * unavailable/denied outcomes (ABSTAIN, REFUSED, ERROR) never count as
//     useful and never satisfy selection.
import { createHash } from 'node:crypto';
import { createTaskResponseCombiner } from './task-response-combiner.mjs';

const ROLES = Object.freeze(['PROTON', 'ELECTRON', 'NEUTRON']);
const OUTCOMES = Object.freeze(['SUCCESS', 'ABSTAIN', 'REFUSED', 'ERROR']);
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

// Profile-specific ASCII canonical encoding (deliberately not JCS), with a
// round-specific hash namespace so round digests never collide with
// contribution records from the combiner.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function hash(record) {
  return createHash('sha256').update(`veritas/round/${record.kind}\0`).update(canonical(record)).digest('hex');
}

const ROUND_KEYS = Object.freeze(['kind', 'roundId', 'taskId', 'taskDigest', 'generation', 'roles', 'deadlineMs']);
const OUTCOME_KEYS = Object.freeze(['kind', 'roundId', 'contributorId', 'role', 'outcome', 'reason']);

function roundValid(value) {
  if (!keysEqual(value, ROUND_KEYS)) return false;
  if (value.kind !== 'veritas-contribution-round-v1' || !isID(value.roundId) || !isID(value.taskId)) return false;
  if (!isHash(value.taskDigest) || !isInt(value.generation, 1) || !isInt(value.deadlineMs, 1, 60000)) return false;
  if (!Array.isArray(value.roles) || value.roles.length < 1 || value.roles.length > 3) return false;
  if (value.roles.some(r => !isROLE(r))) return false;
  return new Set(value.roles).size === value.roles.length;
}
function outcomeValid(value) {
  if (!keysEqual(value, OUTCOME_KEYS)) return false;
  if (value.kind !== 'veritas-contribution-outcome-v1' || !isID(value.roundId)) return false;
  if (!isID(value.contributorId) || !isROLE(value.role) || !OUTCOMES.includes(value.outcome)) return false;
  if (typeof value.reason !== 'string' || value.reason.length > 256 || !/^[\x20-\x7E]*$/.test(value.reason)) return false;
  if (value.outcome === 'SUCCESS' && value.reason !== '') return false;
  return true;
}

class DefaultContributionRound {
  #combiner = null;
  #contributors = new Map(); // role -> frozen {contributorId, role}
  #rounds = new Map();       // roundId -> { digest, value, outcomes: Map(contributorId -> record) }

  constructor(combiner) {
    this.#combiner = combiner;
  }

  admitContributor(text) {
    const admitted = this.#combiner.admitContributor(text);
    if (!admitted.ok) return admitted;
    this.#contributors.set(admitted.role, Object.freeze({ contributorId: admitted.contributorId, role: admitted.role }));
    return admitted;
  }

  admitTask(text) {
    return this.#combiner.admitTask(text);
  }

  requestRound(taskText) {
    const admitted = this.#combiner.admitTask(taskText);
    if (!admitted.ok) return fail(admitted.code);
    let value;
    try { value = JSON.parse(taskText); }
    catch { return fail('JSON_INVALID'); }
    if (canonical(value) !== taskText) return fail('TASK_NONCANONICAL');
    const round = {
      kind: 'veritas-contribution-round-v1',
      roundId: `round.${value.taskId}`,
      taskId: value.taskId,
      taskDigest: admitted.taskDigest,
      generation: value.generation,
      roles: value.requiredContributors.map(r => r.role),
      deadlineMs: value.deadlineMs,
    };
    if (!roundValid(round)) return fail('ROUND_SCHEMA_INVALID');
    if (this.#rounds.has(round.roundId)) return fail('ROUND_DUPLICATE');
    const digest = hash(round);
    this.#rounds.set(round.roundId, { digest, value: round, outcomes: new Map() });
    return answer(true, 'ROUND_REQUESTED', { roundId: round.roundId, roundDigest: digest,
      taskId: round.taskId, taskDigest: round.taskDigest,
      roles: round.roles, deadlineMs: round.deadlineMs, boundedRetries: 0 });
  }

  #resolveRound(roundText) {
    let value;
    try { value = JSON.parse(roundText); }
    catch { return null; }
    if (canonical(value) !== roundText || !roundValid(value)) return null;
    const stored = this.#rounds.get(value.roundId);
    if (!stored || stored.digest !== hash(value)) return null;
    return { ...stored, value };
  }

  recordOutcome(roundText, contributorId, outcome, reason = '') {
    const parsed = this.#resolveRound(roundText);
    if (!parsed) return fail('ROUND_UNMATCHED');
    if (!isID(contributorId)) return fail('OUTCOME_CONTRIBUTOR_UNKNOWN');
    const contributor = [...this.#contributors.values()].find(c => c.contributorId === contributorId);
    if (!contributor) return fail('OUTCOME_CONTRIBUTOR_UNKNOWN');
    const record = { kind: 'veritas-contribution-outcome-v1', roundId: parsed.value.roundId,
      contributorId, role: contributor.role, outcome, reason: String(reason) };
    if (!outcomeValid(record)) return fail('OUTCOME_SCHEMA_INVALID');
    if (parsed.outcomes.has(contributorId)) return fail('OUTCOME_DUPLICATE');
    parsed.outcomes.set(contributorId, Object.freeze(record));
    return answer(true, 'OUTCOME_RECORDED', { roundId: parsed.value.roundId,
      contributorId, role: contributor.role, outcome: record.outcome });
  }

  select(roundText) {
    const parsed = this.#resolveRound(roundText);
    if (!parsed) return fail('ROUND_UNMATCHED');
    const useful = parsed.value.roles.filter(role => {
      const entry = [...parsed.outcomes.values()].find(r => r.role === role);
      return entry && entry.outcome === 'SUCCESS';
    });
    const selection = useful.length === 0 ? 'NONE' : useful.length === 1 ? 'SOLO' : useful.length === 2 ? 'PAIR' : 'TRIO';
    const rationale = selection === 'NONE'
      ? 'No admitted role produced a SUCCESS outcome; no useful combo exists.'
      : `Maximal useful set of SUCCESS outcomes in declared role order: ${useful.join(', ')}.`;
    return answer(true, 'ROUND_SELECTION', { taskId: parsed.value.taskId,
      taskDigest: parsed.value.taskDigest, roundId: parsed.value.roundId,
      selection, roles: useful, exactlyOneWriter: true, rationale });
  }
}

/** Binds owned canonical base/dual declaration bytes and the generation exactly
 * once (delegating through the combiner), then exposes the round planner.
 * A bound declaration is not permission; a selection is not an authorization
 * to write, execute, or schedule. Nothing here can retry, promote, or grant. */
export function createDefaultContributionRound(baseBytes, dualBytes, options) {
  try {
    const captured = Object.freeze({ generation: options?.generation });
    if (!isInt(captured.generation, 1)) return fail('CONFIGURATION_REFUSED');
    const combiner = createTaskResponseCombiner(baseBytes, dualBytes, { generation: captured.generation });
    if (!combiner.ok) return fail(combiner.code);
    const planner = new DefaultContributionRound(combiner.combiner);
    return answer(true, 'READY_PRIVATE_DEFAULT_CONTRIBUTION_ROUND_ONLY', { planner });
  } catch {
    return fail('CONSTRUCTION_ERROR');
  }
}