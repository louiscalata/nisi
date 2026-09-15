// Chain-harness framework tests: the BN01 seam contracts.
// The harness WRITES the edges between nodes and validates them; these tests
// prove the happy chain, construction refusals (generation/declarations/wire),
// and refusal PROPAGATION — a refused node flows into the next node's declared
// gates and the chain stops at the right place with the right code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createChainHarness, CHAIN_EDGES } from '../harness/chain-harness.mjs';
import { typedContext } from './fixtures/typed-context.mjs';

const sha = s => createHash('sha256').update(s).digest('hex');
const CONTEXT = typedContext();
const PINS = Object.freeze(CONTEXT.pins);
const SPACE = sha('space');

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// ---- declaration builders ----
function sessionBytes(gen, routes) {
  return Buffer.from(canonical({ kind: 'veritas-default-round-session-v1',
    sessionId: 'sess-harness-1', requester: 'PRIMARY', generation: gen,
    defaultCap: 3, routes }));
}
function bindBytes(gen) {
  return Buffer.from(canonical({ kind: 'veritas-admitted-run-bind-v1',
    profile: 'veritas-bn01-offline-contract-v1', schemaVersion: 1,
    generation: gen, runBudgetCap: 4, deadlineMs: 60000, ...PINS }));
}
function configBytes(gen) {
  return Buffer.from(canonical({ kind: 'veritas-contribution-admission-config-v1',
    profile: 'veritas-bn03-offline-contract-v1', schemaVersion: 1,
    generation: gen, maxAttempts: 8, packetBytesLimit: 1024 }));
}
function baseBytes() {
  return Buffer.from(CONTEXT.baseBytes);
}
function dualBytes() {
  return Buffer.from(CONTEXT.dualBytes);
}
const decls = (gen, opts = {}) => ({
  sessionBytes: sessionBytes(gen, [{ channelId: 'chan-main', fromNodeId: 'n-a',
    toNodeId: 'n-b', state: opts.routeState ?? 'ALLOW' }]),
  bindBytes: bindBytes(opts.bindGen ?? gen),
  configBytes: configBytes(gen),
  baseBytes: baseBytes(),
  dualBytes: dualBytes(),
});

// ---- typed combiner envelope ----
function typedTask(gen, contributorIds, over = {}) {
  return { kind: 'veritas-typed-contribution-task-v1', taskId: 'task-h-1',
    requester: 'PRIMARY', graphSha256: PINS.graphSha256, runSha256: PINS.runSha256,
    topologySha256: PINS.topologySha256, planSha256: PINS.planSha256,
    generation: gen, requiredContributors: contributorIds, deadlineMs: 30000, ...over };
}
const taskDigest = taskValue => sha('veritas/typed-contribution/veritas-typed-contribution-task-v1\0' + canonical(taskValue));
function contributor(id, type, width) {
  return { kind: 'veritas-typed-contribution-contributor-v1', contributorId: id,
    role: `role-${id}`, revision: 1, outputType: type, outputWidth: width,
    spaceSha256: SPACE, maxPayloadBytes: 4096 };
}
function response(contributorId, digest, payload) {
  return { kind: 'veritas-typed-contribution-response-v1', contributorId,
    taskId: 'task-h-1', taskDigest: digest, outcome: 'RESPONSE_OK',
    payloadSha256: sha(payload) };
}

const GEN = 11;
const IDS = ['c-alpha', 'c-beta', 'c-gamma'];
function happyEnv(over = {}) {
  const queue = { state: 'QUEUED', inFlight: 0, capacity: 4,
    retainedTasks: 0, packetBytes: 128 };
  const taskValue = typedTask(GEN, IDS);
  const digest = taskDigest(taskValue);
  const payloads = [Buffer.from('alpha'), Buffer.from('beta'), Buffer.from('gamma')];
  return {
    channelId: 'chan-main', scope: 'chain-test', attemptId: 'att-h-1',
    runId: 'run-h-1', ttlMs: 30000, queueSnapshot: canonical(queue),
    task: {
      contributors: IDS.map((id, i) => ({ contributor: contributor(id, 'STRING', 2) })),
      task: taskValue,
      responses: IDS.map((id, i) => ({ response: response(id, digest, payloads[i]),
        payload: payloads[i] })),
    },
    ...over,
  };
}

test('harness: every foreign task pin refuses before consuming the honest run', () => {
  for (const key of Object.keys(PINS)) {
    const bound = createChainHarness(decls(GEN), { generation: GEN });
    const foreign = happyEnv();
    foreign.task.task[key] = sha('foreign-' + key);
    const digest = taskDigest(foreign.task.task);
    for (const entry of foreign.task.responses) entry.response.taskDigest = digest;
    const result = bound.chain.runChain(foreign);
    assert.equal(result.ok, false, key);
    assert.equal(result.code, 'CHAIN_TASK_IDENTITY_MISMATCH');
    assert.equal(bound.chain.runChain(happyEnv()).code, 'CHAIN_ADVISORY_COMPLETE');
  }
});

test('harness: returned success and refusal reports are deeply immutable', () => {
  for (const env of [happyEnv(), happyEnv({ queueSnapshot: canonical({ state: 'OFF', inFlight: 0,
    capacity: 4, retainedTasks: 0, packetBytes: 128 }) })]) {
    const result = createChainHarness(decls(GEN), { generation: GEN }).chain.runChain(env);
    assert.ok(result.report);
    const before = canonical(result.report);
    assert.equal(Object.isFrozen(result.report), true);
    assert.equal(Object.isFrozen(result.report.nodes), true);
    assert.equal(Object.isFrozen(result.report.edges), true);
    assert.throws(() => { result.report.nodes[0].code = 'FORGED_AFTER_DIGEST'; }, TypeError);
    assert.throws(() => { result.report.nodes.push({ code: 'ADMITTED' }); }, TypeError);
    assert.equal(canonical(result.report), before);
    if (result.ok) assert.equal(result.chainDigest, sha(`veritas/chain-harness/${GEN}\0${before}`));
  }
});

test('harness: happy chain runs every node and reports seams', () => {
  const bound = createChainHarness(decls(GEN), { generation: GEN });
  assert.equal(bound.ok, true);
  const out = bound.chain.runChain(happyEnv());
  assert.equal(out.ok, true);
  assert.equal(out.code, 'CHAIN_ADVISORY_COMPLETE');
  const nodes = out.report.nodes.map(n => n.code);
  assert.deepEqual(nodes, ['DEFAULT_ROUND_DISPATCHED', 'ADMITTED',
    'CONTRIBUTION_DISPATCHED', 'TYPED_COMBINE_COMPLETE']);
  assert.equal(out.report.edges.length, 3); // rounds->glue, owner->glue, queue->glue
  assert.match(out.chainDigest, /^[0-9a-f]{64}$/);
  // STRING combine across the real seams: alpha\0beta\0gamma
  const combinerNode = out.report.nodes.find(n => n.node === 'combiner');
  assert.equal(combinerNode.combinedSha256,
    sha(Buffer.concat([Buffer.from('alpha'), Buffer.from([0]), Buffer.from('beta'),
                       Buffer.from([0]), Buffer.from('gamma')])));
});

test('harness: wrong wiring edges are refused at construction', () => {
  const bound = createChainHarness(decls(GEN), {
    generation: GEN,
    edges: { roundsToGlue: ['outcome', 'channel'], ownerToGlue: ['outcome', 'permitId'],
             queueToGlue: ['state', 'inFlight', 'capacity', 'retainedTasks', 'packetBytes'],
             attemptToGlue: ['kind', 'attemptId', 'requester', 'generation'] },
  });
  assert.equal(bound.ok, false);
  assert.equal(bound.code, 'WIRE_CONTRACT_REFUSED');
});

test('harness: bad generation and missing declarations refused', () => {
  assert.equal(createChainHarness(decls(GEN), { generation: 0 }).code, 'GENERATION_REFUSED');
  assert.equal(createChainHarness({ ...decls(GEN), bindBytes: undefined },
    { generation: GEN }).code, 'DECLARATIONS_REFUSED');
  assert.equal(createChainHarness(decls(GEN), { generation: GEN }).ok, true);
});

test('harness: a DENIED round propagates through the seam to the glue', () => {
  const bound = createChainHarness(decls(GEN, { routeState: 'DENIED' }),
    { generation: GEN });
  const out = bound.chain.runChain(happyEnv());
  assert.equal(out.ok, false);
  assert.equal(out.code, 'CHAIN_REFUSED_AT_GLUE');
  assert.equal(out.leafCode, 'CONTRIBUTION_ROUND_REFUSED');
  assert.equal(out.node, 'glue');
  assert.equal(out.report.nodes.find(n => n.node === 'glue').roundOutcome,
    'ROUND_ROUTE_DENIED');
});

test('harness: an owner whose bind generation drifts refuses at the owner seam', () => {
  // bind declares generation 12 while the harness is bound to 11: the permit
  // request is refused (PERMIT_GENERATION_MISMATCH) and the glue sees it.
  const bound = createChainHarness(decls(GEN, { bindGen: 12 }), { generation: GEN });
  const out = bound.chain.runChain(happyEnv());
  assert.equal(out.ok, false);
  assert.equal(out.code, 'CHAIN_REFUSED_AT_GLUE');
  assert.equal(out.leafCode, 'CONTRIBUTION_OWNER_REFUSED');
  assert.equal(out.node, 'glue');
  assert.equal(out.report.nodes.find(n => n.node === 'owner').code,
    'PERMIT_GENERATION_MISMATCH');
  assert.equal(out.report.nodes.find(n => n.node === 'glue').ownerOutcome,
    'PERMIT_GENERATION_MISMATCH');
});

test('harness: a BUSY queue snapshot refuses at the queue gate', () => {
  const queue = { state: 'BUSY', inFlight: 2, capacity: 4, retainedTasks: 1, packetBytes: 64 };
  const bound = createChainHarness(decls(GEN), { generation: GEN });
  const out = bound.chain.runChain(happyEnv({ queueSnapshot: canonical(queue) }));
  assert.equal(out.ok, false);
  assert.equal(out.code, 'CHAIN_REFUSED_AT_GLUE');
  assert.equal(out.leafCode, 'CONTRIBUTION_QUEUE_REFUSED');
  assert.equal(out.node, 'glue');
  assert.equal(out.report.nodes.find(n => n.node === 'glue').code,
    'CONTRIBUTION_QUEUE_REFUSED');
});

test('harness: a task carrying a foreign generation stops at the combiner', () => {
  const env = happyEnv();
  const foreign = typedTask(99, IDS); // generation drifts from the harness
  const digest = taskDigest(foreign);
  env.task.task = foreign;
  env.task.responses = IDS.map((id, i) => ({
    response: response(id, digest, env.task.responses[i].payload),
    payload: env.task.responses[i].payload }));
  const bound = createChainHarness(decls(GEN), { generation: GEN });
  const out = bound.chain.runChain(env);
  assert.equal(out.ok, false);
  assert.equal(out.code, 'CHAIN_REFUSED_AT_COMBINER');
  assert.equal(out.leafCode, 'TASK_GENERATION_MISMATCH');
  assert.equal(out.node, 'combiner');
});

test('harness: invalid env shape is refused before any node runs', () => {
  const bound = createChainHarness(decls(GEN), { generation: GEN });
  assert.equal(bound.chain.runChain({ ...happyEnv(), attemptId: 'BAD ID!' }).code,
    'CHAIN_ENV_INVALID');
  assert.equal(bound.chain.runChain({ ...happyEnv(), queueSnapshot: '{"state":' }).code,
    'CHAIN_QUEUE_DECLARATION_INVALID');
});

test('harness: malformed task env stops at the combiner boundary', () => {
  const bound = createChainHarness(decls(GEN), { generation: GEN });
  const bad = happyEnv();
  bad.task = { contributors: [], task: {}, responses: [] }; // no contributors
  const out = bound.chain.runChain(bad);
  assert.equal(out.ok, false);
  assert.equal(out.code, 'CHAIN_REFUSED_AT_COMBINER');
  assert.equal(out.leafCode, 'CHAIN_TASK_ENV_INVALID');
  assert.equal(out.node, 'combiner');
});

test('harness: a queue snapshot with foreign keys violates the seam, not the gate', () => {
  const queue = { state: 'QUEUED', inFlight: 0, capacity: 4,
    retainedTasks: 0, packetBytes: 128, smuggler: 'bypass' }; // extra key
  const bound = createChainHarness(decls(GEN), { generation: GEN });
  const out = bound.chain.runChain(happyEnv({ queueSnapshot: canonical(queue) }));
  assert.equal(out.ok, false);
  assert.equal(out.code, 'CHAIN_EDGE_CONTRACT_VIOLATION');
  assert.equal(out.seam, 'queueToGlue');
});

test('harness: oversized ttlMs and empty declarations are refused up front', () => {
  assert.equal(createChainHarness(decls(GEN), { generation: GEN })
    .chain.runChain({ ...happyEnv(), ttlMs: 60001 }).code, 'CHAIN_ENV_INVALID');
  // Empty declaration bytes are caught by the factory's own up-front guard, so
  // this one is refused before any slice is constructed.
  assert.equal(createChainHarness({ ...decls(GEN), sessionBytes: Buffer.from('') },
    { generation: GEN }).code, 'DECLARATIONS_REFUSED');
  const sab = new SharedArrayBuffer(8);
  const declsSab = decls(GEN);
  declsSab.bindBytes = Buffer.from('x').map(function () { return 1; }); // plain copy
  declsSab.baseBytes = Buffer.from(new Uint8Array(sab)); // SAB-backed -> refused
  // A refusal raised inside a slice keeps BOTH the harness's declared code and
  // the exact inner cause. Before, the inner code was spread over `code` and
  // CONSTRUCTION_FAILED was unreachable, so which layer refused was erased.
  const sabResult = createChainHarness(declsSab, { generation: GEN });
  assert.equal(sabResult.code, 'CONSTRUCTION_FAILED');
  assert.equal(sabResult.slice, 'owner');
  assert.equal(sabResult.sliceCode, 'DECLARATION_BYTES_REFUSED');
});

test('harness: malformed task elements refuse with a declared code, never a thrown error', () => {
  // Each of these previously escaped runChain as a bare TypeError, so no
  // refusal record reached the caller and which rule fired was erased.
  const shapes = [
    { contributors: [null], responses: [null] },
    { contributors: [{}], responses: [{}] },
    { contributors: [{ contributor: 'not-an-object' }], responses: [{ response: null }] },
  ];
  for (const shape of shapes) {
    const env = happyEnv();
    const chain = createChainHarness(decls(GEN), { generation: GEN }).chain;
    let out;
    assert.doesNotThrow(() => {
      out = chain.runChain({ ...env, task: { ...env.task, ...shape } });
    }, `shape ${JSON.stringify(shape)} must not throw`);
    assert.equal(out.ok, false);
    assert.equal(out.code, 'CHAIN_REFUSED_AT_COMBINER');
    assert.equal(out.leafCode, 'CHAIN_TASK_ENV_INVALID');
    assert.equal(out.authorizing, false);
  }
});

test('harness: a declared refusal code is never overwritten by its own fields', () => {
  // answer() spreads fields BEFORE ok/code precisely so a field named `code`
  // cannot replace the refusal label, which is what made CONSTRUCTION_FAILED
  // unreachable.
  const declsBadOwner = decls(GEN);
  declsBadOwner.bindBytes = Buffer.from('{not-json', 'utf8');
  const out = createChainHarness(declsBadOwner, { generation: GEN });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'CONSTRUCTION_FAILED');
  assert.equal(out.slice, 'owner');
  assert.equal(typeof out.sliceCode, 'string');
  assert.notEqual(out.sliceCode, 'CONSTRUCTION_FAILED');
});

test('harness: both frozen CHAIN_EDGES round-trips are stable', () => {
  assert.equal(CHAIN_EDGES.roundsToGlue.length, 2);
  assert.equal(CHAIN_EDGES.queueToGlue.length, 5);
  assert.deepEqual([...CHAIN_EDGES.roundsToGlue].sort(), ['channelId', 'outcome']);
});
