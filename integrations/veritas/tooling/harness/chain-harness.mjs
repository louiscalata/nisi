// Deterministic chain harness (BN01 framework seam). This is the FRAMEWORK
// that wires the four private BN01 nodes — default-contribution-rounds,
// admitted-run-owner, contribution-admission (BN-03 glue) and the typed
// contribution combiner — into one advisory chain whose hops are explicit
// edge contracts, not silent hand-offs.
//
// Design:
//  - The harness never reimplements a node. It binds the real factories and
//    drives each node ONLY through its public API (status/ledger reads and
//    the same canonical-text calls the standalone suites use). A node's real
//    result feeds the next node's declared inputs: a refused round flows into
//    the glue as a refused gate outcome, exactly as it would in the pipeline.
//  - Hops carry named frozen edge contracts (key-set equality, canonical
//    sorted order same as every module). Every seam is re-checked at runtime;
//    a future module that drifts its output shape breaks the chain loudly
//    (CHAIN_EDGE_CONTRACT_VIOLATION) instead of degrading silently.
//  - Results are advisory only: every authority flag frozen false, no model
//    execution, no scheduling, no permission minting, no queue instance.
//
// Fully dependency-free by design (this repo copy has no node_modules):
// node:crypto only.
import { createHash } from 'node:crypto';
import { createDefaultContributionRounds } from '../neural/default-contribution-rounds.mjs';
import { createAdmittedRunOwner } from '../neural/admitted-run-owner.mjs';
import { createContributionAdmission } from '../neural/contribution-admission.mjs';
import { createTypedContributionCombiner } from '../neural/typed-contribution-combiner.mjs';

const FLAGS = Object.freeze({ authorizing: false, modelExecuted: false,
  promotionGranted: false, certificationGranted: false });
function freezeReport(value) {
  // Reports contain only locally constructed records/arrays, never payload Buffers.
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object') freezeReport(child);
  }
  return Object.freeze(value);
}
const answer = (ok, code, fields = {}) => {
  if (fields.report) freezeReport(fields.report);
  return Object.freeze({ ...fields, ok, code, ...FLAGS });
};
const fail = (code, fields = {}) => answer(false, code, fields);
const isID = v => typeof v === 'string' && v.length >= 1 && v.length <= 96 && /^[a-z][a-z0-9_.-]*(?![\s\S])/.test(v);
const isInt = (v, min, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && v >= min && v <= max;
const isPlain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const keysOf = v => isPlain(v) ? Object.keys(v).sort().join('\0') : null;

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// ---- the framework's frozen seam table (mirrors each module's declared
// input key lists; a changed edge is a wiring change, not a repair) ----
export const CHAIN_EDGES = Object.freeze({
  roundsToGlue: Object.freeze(['outcome', 'channelId']),
  ownerToGlue: Object.freeze(['outcome', 'permitId']),
  queueToGlue: Object.freeze(['state', 'inFlight', 'capacity', 'retainedTasks', 'packetBytes']),
  attemptToGlue: Object.freeze(['kind', 'attemptId', 'requester', 'generation']),
});

class ChainHarness {
  #nodes = null;
  #generation = 0;
  #pins = null;

  constructor(bound, generation) {
    this.#nodes = bound;
    this.#generation = generation;
    this.#pins = Object.freeze({
      graphSha256: bound.pins.graphSha256, runSha256: bound.pins.runSha256,
      topologySha256: bound.pins.topologySha256, planSha256: bound.pins.planSha256,
    });
  }

  #checkSeam(name, record) {
    const expected = CHAIN_EDGES[name];
    const actual = keysOf(record);
    return actual === [...expected].sort().join('\0');
  }

  runChain(env) {
    // 0. caller envelope is schema-checked before any node runs.
    if (!isPlain(env) || !isID(env.channelId) || !isID(env.scope) || !isID(env.attemptId) ||
        !isID(env.runId) || !isInt(env.ttlMs, 1, 60000)) return fail('CHAIN_ENV_INVALID');
    // A self-consistent response digest cannot substitute a foreign task for the
    // run checked by the owner. Refuse before consuming any round or permit.
    if (isPlain(env.task?.task) && Object.keys(this.#pins).every(k =>
      typeof env.task.task[k] === 'string' && /^[0-9a-f]{64}$/.test(env.task.task[k])) &&
      Object.keys(this.#pins).some(k => env.task.task[k] !== this.#pins[k])) {
      return fail('CHAIN_TASK_IDENTITY_MISMATCH');
    }
    const queues = (() => { try { return JSON.parse(env.queueSnapshot); } catch { return null; } })();
    if (!queues || canonical(queues) !== env.queueSnapshot) return fail('CHAIN_QUEUE_DECLARATION_INVALID');
    const report = { generation: this.#generation, nodes: [], edges: [] };

    // 1. default-contribution-rounds: one advisory dispatch attempt.
    const rounds = this.#nodes.rounds;
    const roundsStatus = rounds.sessionStatus();
    const roundRequest = {
      kind: 'veritas-default-round-request-v1', roundId: `round-${env.runId}`,
      sessionId: roundsStatus.sessionId, channelId: env.channelId, requester: 'PRIMARY',
      generation: this.#generation, expertise: env.scope, ttlMs: env.ttlMs,
    };
    const roundResult = rounds.proposeRound(canonical(roundRequest));
    const roundGate = { outcome: roundResult.code, channelId: env.channelId };
    if (!this.#checkSeam('roundsToGlue', roundGate)) return fail('CHAIN_EDGE_CONTRACT_VIOLATION', { seam: 'roundsToGlue' });
    report.nodes.push({ node: 'rounds', code: roundResult.code, ok: roundResult.ok });
    report.edges.push({ seam: 'roundsToGlue', checked: true });

    // 2. admitted-run-owner: permit then one-use execution, both advisory.
    const owner = this.#nodes.owner;
    const ownerStatus = owner.status();
    const runRequest = { kind: 'veritas-admitted-run-permit-request-v1',
      runId: env.runId, requester: 'PRIMARY', generation: this.#generation, scope: env.scope };
    const permitResult = owner.requestPermit(canonical(runRequest));
    let ownerGate;
    if (permitResult.ok) {
      const execRequest = { kind: 'veritas-admitted-run-execution-v1',
        permitId: permitResult.permitId, runId: env.runId, requester: 'PRIMARY',
        generation: this.#generation, scope: env.scope, ...this.#pins };
      const execResult = owner.checkExecution(canonical(execRequest));
      ownerGate = { outcome: execResult.code, permitId: execResult.ok ? permitResult.permitId : env.runId };
      report.nodes.push({ node: 'owner', code: execResult.code, ok: execResult.ok });
    } else {
      ownerGate = { outcome: permitResult.code, permitId: env.runId };
      report.nodes.push({ node: 'owner', code: permitResult.code, ok: false });
    }
    if (!this.#checkSeam('ownerToGlue', ownerGate)) return fail('CHAIN_EDGE_CONTRACT_VIOLATION', { seam: 'ownerToGlue' });
    report.edges.push({ seam: 'ownerToGlue', checked: true });

    // 3. BN-03 glue: one admission attempt fed by the REAL node outcomes.
    const queueGate = queues;
    if (!this.#checkSeam('queueToGlue', queueGate)) return fail('CHAIN_EDGE_CONTRACT_VIOLATION', { seam: 'queueToGlue' });
    report.edges.push({ seam: 'queueToGlue', checked: true });
    const glue = this.#nodes.glue;
    const attempt = { kind: 'veritas-contribution-admission-v1',
      attemptId: env.attemptId, requester: 'PRIMARY', generation: this.#generation };
    if (!this.#checkSeam('attemptToGlue', attempt)) return fail('CHAIN_EDGE_CONTRACT_VIOLATION', { seam: 'attemptToGlue' });
    try {
      // Every gate is the canonical JSON text of the REAL node outcome — the
      // same declared-snapshot form the standalone glue suite uses.
      const gates = { round: canonical(roundGate), owner: canonical(ownerGate),
                      queue: canonical(queueGate) };
      const glueResult = glue.admissionAttempt(canonical(attempt), gates);
      report.nodes.push({ node: 'glue', code: glueResult.code, ok: glueResult.ok,
                          roundOutcome: glueResult.roundOutcome ?? roundGate.outcome,
                          ownerOutcome: glueResult.ownerOutcome ?? ownerGate.outcome });
      if (!glueResult.ok) {
        return answer(false, 'CHAIN_REFUSED_AT_GLUE',
          { node: 'glue', leafCode: glueResult.code, report });
      }
    } catch {
      return fail('CHAIN_GLUE_DRIVER_ERROR');
    }

    // 4. typed combiner: bind contributors/task, admit response payloads,
    //    combine strictly in requiredContributors order.
    const combiner = this.#nodes.combiner;
    const envTask = env.task;
    if (!isPlain(envTask) || !Array.isArray(envTask.contributors) ||
        !Array.isArray(envTask.responses) || !isPlain(envTask.task) ||
        envTask.contributors.length === 0 ||
        envTask.contributors.length !== envTask.responses.length) {
      return answer(false, 'CHAIN_REFUSED_AT_COMBINER', { node: 'combiner', leafCode: 'CHAIN_TASK_ENV_INVALID', report });
    }
    for (const c of envTask.contributors) {
      if (!isPlain(c) || !isPlain(c.contributor)) {
        return answer(false, 'CHAIN_REFUSED_AT_COMBINER', { node: 'combiner', leafCode: 'CHAIN_TASK_ENV_INVALID', report });
      }
      const r = combiner.admitContributor(canonical(c.contributor));
      if (!r.ok) return answer(false, 'CHAIN_REFUSED_AT_COMBINER', { node: 'combiner', leafCode: r.code, report });
    }
    const taskAdmit = combiner.admitTask(canonical(envTask.task));
    if (!taskAdmit.ok) return answer(false, 'CHAIN_REFUSED_AT_COMBINER', { node: 'combiner', leafCode: taskAdmit.code, report });
    const entries = [];
    for (const resp of envTask.responses) {
      if (!isPlain(resp) || !isPlain(resp.response)) {
        return answer(false, 'CHAIN_REFUSED_AT_COMBINER', { node: 'combiner', leafCode: 'CHAIN_TASK_ENV_INVALID', report });
      }
      const r = combiner.admitResponse(canonical(resp.response), resp.payload);
      if (!r.ok) return answer(false, 'CHAIN_REFUSED_AT_COMBINER', { node: 'combiner', leafCode: r.code, report });
      entries.push({ text: canonical(resp.response), payload: resp.payload });
    }
    const combined = combiner.combine(canonical(envTask.task), entries);
    report.nodes.push({ node: 'combiner', code: combined.code, ok: combined.ok,
      combinedSha256: combined.combinedSha256 ?? null });
    if (!combined.ok) return answer(false, 'CHAIN_REFUSED_AT_COMBINER', { node: 'combiner', leafCode: combined.code, report });
    return answer(true, 'CHAIN_ADVISORY_COMPLETE', {
      verdict: 'advisory', report,
      chainDigest: createHash('sha256')
        .update(`veritas/chain-harness/${this.#generation}\0`)
        .update(canonical(report)).digest('hex'),
    });
  }
}

/** Binds the four private nodes to one exact generation and the owned
 * declaration bytes of each slice. Every seam is validated at construction:
 * passing an `edges` table that disagrees with the frozen CHAIN_EDGES is
 * refused loudly (WIRE_CONTRACT_REFUSED) — wiring drift is never a repair.
 * Pure declarations: no model, queue, scheduler or permission is resolved. */
export function createChainHarness(decls, options) {
  try {
    const generation = options?.generation ?? null;
    if (!isInt(generation, 1)) return fail('GENERATION_REFUSED');
    const need = ['sessionBytes', 'bindBytes', 'configBytes', 'baseBytes', 'dualBytes'];
    if (!isPlain(decls)) return fail('DECLARATIONS_REFUSED');
    for (const name of need) {
      const b = decls[name];
      if (!Buffer.isBuffer(b) || b.length === 0 || b.length > 65536 ||
          (b.buffer instanceof SharedArrayBuffer)) return fail('DECLARATIONS_REFUSED');
    }
    if (options?.edges !== undefined) {
      const given = options.edges;
      const same = Object.keys(CHAIN_EDGES).every(k =>
        Array.isArray(given?.[k]) && [...given[k]].sort().join('\0') ===
        [...CHAIN_EDGES[k]].sort().join('\0'));
      if (!isPlain(given) || !same) return fail('WIRE_CONTRACT_REFUSED');
    }
    const session = createDefaultContributionRounds(decls.sessionBytes, { generation });
    if (!session.ok) return fail('CONSTRUCTION_FAILED', { slice: 'rounds', sliceCode: session.code });
    const owner = createAdmittedRunOwner(decls.bindBytes, {});
    if (!owner.ok) return fail('CONSTRUCTION_FAILED', { slice: 'owner', sliceCode: owner.code });
    const glue = createContributionAdmission(decls.configBytes, {});
    if (!glue.ok) return fail('CONSTRUCTION_FAILED', { slice: 'glue', sliceCode: glue.code });
    const combiner = createTypedContributionCombiner(decls.baseBytes, decls.dualBytes, { generation });
    if (!combiner.ok) return fail('CONSTRUCTION_FAILED', { slice: 'combiner', sliceCode: combiner.code });
    const bindText = decls.bindBytes.toString('utf8');
    const bindValue = JSON.parse(bindText);
    const pins = { graphSha256: bindValue.graphSha256, runSha256: bindValue.runSha256,
      topologySha256: bindValue.topologySha256, planSha256: bindValue.planSha256 };
    const chain = new ChainHarness({ rounds: session.rounds, owner: owner.owner,
      glue: glue.admit, combiner: combiner.combiner, pins }, generation);
    return answer(true, 'READY_PRIVATE_CHAIN_HARNESS_ONLY', { chain });
  } catch {
    return fail('CONSTRUCTION_ERROR');
  }
}
