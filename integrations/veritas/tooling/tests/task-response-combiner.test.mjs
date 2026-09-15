import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskResponseCombiner } from '../neural/task-response-combiner.mjs';
import { makeBn01Fixture, fixtureBytes } from '../neural/bn01-fixture.mjs';
import { makeDualFixture, canonicalFixtureBytes } from '../neural/dual-face-fixture.mjs';

const base = makeBn01Fixture();
const dual = makeDualFixture(base);
const baseBytes = fixtureBytes(base);
const dualBytes = canonicalFixtureBytes(dual);
const ROOT_SPACE = base.plugins[0].record.output.spaceSha256;
const ROOT_WIDTH = base.plugins[0].record.output.width;

// Canonical compact encoding helper matching the checker's canonical().
function can(value) {
  if (Array.isArray(value)) return `[${value.map(can).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${can(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
const text = v => can(v);

function make() {
  const made = createTaskResponseCombiner(baseBytes, dualBytes, { generation: 1 });
  assert.equal(made.ok, true, made.code);
  return made.combiner;
}
function contributor(role, idPrefix = 'contrib') {
  return { kind: 'veritas-contribution-contributor-v1', contributorId: `${idPrefix}.${role.toLowerCase()}`,
    role, revision: 1, outputWidth: ROOT_WIDTH, outputSpaceSha256: ROOT_SPACE, maxPayloadBytes: 256 };
}
const C_P = contributor('PROTON');
const C_E = contributor('ELECTRON');
function admit(...contributors) {
  const s = make();
  for (const ct of contributors) assert.equal(s.admitContributor(text(ct)).code, 'CONTRIBUTOR_ADMITTED');
  return s;
}
function task(overrides = {}) {
  return {
    kind: 'veritas-contribution-task-v1', taskId: 'task.1', requester: 'PRIMARY',
    graphSha256: base.graph.sha256, runSha256: base.run.sha256,
    topologySha256: dual.topology.sha256, planSha256: dual.plan.sha256, generation: 1,
    requiredContributors: [
      { role: 'PROTON', contributorId: C_P.contributorId, channelId: 'channel.0.forward', fromPortId: 'n0.a', toPortId: 'n1.b' },
      { role: 'ELECTRON', contributorId: C_E.contributorId, channelId: 'channel.0.forward', fromPortId: 'n0.a', toPortId: 'n1.b' },
    ],
    deadlineMs: 1000, ...overrides,
  };
}
function payload(width = ROOT_WIDTH, values) {
  const b = Buffer.alloc(4 * width);
  for (let i = 0; i < width; i++) b.writeFloatLE(values ?? 1 + i, i * 4);
  return b;
}
function response(role, contributorId, taskId, taskDigest, outcome = 'SUCCESS', pl = payload()) {
  return { kind: 'veritas-contribution-response-v1', contributorId, role,
    taskId, taskDigest, outcome };
}
function admitTaskAndResponses(s) {
  const t = task();
  const tRes = s.admitTask(text(t));
  assert.equal(tRes.code, 'TASK_ADMITTED');
  const rp = s.admitResponse(text(response('PROTON', C_P.contributorId, t.taskId, tRes.taskDigest, 'SUCCESS', payload())), payload());
  const re = s.admitResponse(text(response('ELECTRON', C_E.contributorId, t.taskId, tRes.taskDigest, 'SUCCESS', payload())), payload());
  assert.equal(rp.code, 'RESPONSE_RECORDED');
  assert.equal(re.code, 'RESPONSE_RECORDED');
  return { t, tRes, rp, re };
}

test('factory validates the bounded base + dual declarations and generation', () => {
  const made = createTaskResponseCombiner(baseBytes, dualBytes, { generation: 1 });
  assert.equal(made.ok, true);
  assert.equal(made.code, 'READY_PRIVATE_TASK_RESPONSE_COMBINER_ONLY');
  for (const f of ['authorizing', 'modelExecuted', 'promotionGranted', 'certificationGranted']) assert.equal(made[f], false);
});

test('factory refuses invalid generation or declaration bytes', () => {
  assert.equal(createTaskResponseCombiner(baseBytes, dualBytes, { generation: 0 }).ok, false);
  assert.equal(createTaskResponseCombiner(baseBytes, dualBytes, {}).ok, false);
  assert.equal(createTaskResponseCombiner(Buffer.from('{'), dualBytes, { generation: 1 }).ok, false);
});

test('valid single-contributor task admits and combines', () => {
  const s = admit(C_P);
  const t = task({ requiredContributors: [{ role: 'PROTON', contributorId: C_P.contributorId, channelId: 'channel.0.forward', fromPortId: 'n0.a', toPortId: 'n1.b' }] });
  const tRes = s.admitTask(text(t)); assert.equal(tRes.code, 'TASK_ADMITTED');
  const rp = s.admitResponse(text(response('PROTON', C_P.contributorId, t.taskId, tRes.taskDigest, 'SUCCESS', payload())), payload());
  assert.equal(rp.code, 'RESPONSE_RECORDED');
  const out = s.combine(text(t), [rp]);
  assert.equal(out.code, 'COMBINED');
  assert.equal(out.combinedOutputWidth, ROOT_WIDTH);
  assert.equal(out.combined.length, 4 * ROOT_WIDTH);
});

test('valid two-contributor task combines in declared order', () => {
  const s = admit(C_P, C_E);
  const { t, tRes, rp, re } = admitTaskAndResponses(s);
  const out = s.combine(text(t), [rp, re]);
  assert.equal(out.code, 'COMBINED');
  assert.equal(out.combinedOutputWidth, 2 * ROOT_WIDTH);
  assert.deepEqual(out.contributors, ['PROTON', 'ELECTRON']);
  assert.equal(out.taskDigest, tRes.taskDigest);
});

test('every result is non-authorizing', () => {
  const s = make();
  const t = task();
  const results = [
    createTaskResponseCombiner(baseBytes, dualBytes, { generation: 1 }),
    s.admitContributor(text(C_P)), s.admitContributor(Buffer.from('{').toString()),
    s.admitTask(text(t)), s.admitTask(Buffer.from('{').toString()),
    s.combine(text(t), []), s.combine(Buffer.from('{').toString(), []),
  ];
  for (const r of results) for (const f of ['authorizing', 'modelExecuted', 'promotionGranted', 'certificationGranted']) assert.equal(r[f], false);
});

test('malformed contributor input is refused, never a PASS', () => {
  const s = make();
  for (const bad of [Buffer.from('{').toString(), Buffer.from('hello').toString(), text({ kind: 'veritas-contribution-contributor-v1', role: 'PROTON' })]) {
    const r = s.admitContributor(bad); assert.equal(r.ok, false);
  }
});

test('duplicate or equivocating contributor role is refused', () => {
  const s = admit(C_P);
  assert.equal(s.admitContributor(text(C_P)).code, 'CONTRIBUTOR_DUPLICATE');
  const dup = { ...C_P, contributorId: 'other.proton' };
  assert.equal(s.admitContributor(text(dup)).code, 'CONTRIBUTOR_DUPLICATE');
});

test('task requires declared pins, generation, and known contributors', () => {
  const s = admit(C_P, C_E);
  const badPins = [
    { graphSha256: 'b'.repeat(64) }, { runSha256: 'b'.repeat(64) },
    { topologySha256: 'b'.repeat(64) }, { planSha256: 'b'.repeat(64) }, { generation: 2 },
  ];
  for (const changes of badPins) {
    const r = s.admitTask(text(task({ ...changes }))); assert.equal(r.ok, false, JSON.stringify(changes));
  }
  const unknown = task({ requiredContributors: [{ role: 'NEUTRON', contributorId: 'nobody', channelId: 'channel.0.forward', fromPortId: 'n0.a', toPortId: 'n1.b' }] });
  assert.equal(s.admitTask(text(unknown)).code, 'TASK_CONTRIBUTOR_UNKNOWN');
});

test('task refuses refused routes, duplicate contributors, wrong endpoints', () => {
  const s = admit(C_P, C_E);
  const dup = task({ requiredContributors: [
    { role: 'PROTON', contributorId: C_P.contributorId, channelId: 'channel.0.forward', fromPortId: 'n0.a', toPortId: 'n1.b' },
    { role: 'PROTON', contributorId: C_P.contributorId, channelId: 'channel.0.forward', fromPortId: 'n0.a', toPortId: 'n1.b' },
  ] });
  assert.equal(s.admitTask(text(dup)).code, 'TASK_CONTRIBUTOR_DUPLICATE');
  const route = task({ requiredContributors: [
    { role: 'PROTON', contributorId: C_P.contributorId, channelId: 'channel.1.forward', fromPortId: 'n1.a', toPortId: 'n0.b' },
  ] });
  assert.equal(s.admitTask(text(route)).code, 'TASK_ROUTE_REFUSED');
  const endpoint = task({ requiredContributors: [
    { role: 'PROTON', contributorId: C_P.contributorId, channelId: 'channel.0.forward', fromPortId: 'n1.a', toPortId: 'n0.b' },
  ] });
  assert.equal(s.admitTask(text(endpoint)).code, 'TASK_ROUTE_ENDPOINT_MISMATCH');
});

test('combine enforces count, order, digest, width and nonfinite refusals', () => {
  const s = admit(C_P, C_E);
  const { t, tRes, rp, re } = admitTaskAndResponses(s);
  // wrong count
  assert.equal(s.combine(text(t), []).code, 'COMBINE_RESPONSE_COUNT_MISMATCH');
  assert.equal(s.combine(text(t), [rp]).code, 'COMBINE_RESPONSE_COUNT_MISMATCH');
  // swapped order
  assert.equal(s.combine(text(t), [re, rp]).code, 'COMBINE_RESPONSE_ORDER_MISMATCH');
  // foreign task digests
  const foreign = { ...rp, taskDigest: 'b'.repeat(64) };
  assert.equal(s.combine(text(t), [foreign, re]).code, 'COMBINE_RESPONSE_UNMATCHED');
  // a FAILURE response cannot satisfy combine
  const failRes = s.admitResponse(text(response('ELECTRON', C_E.contributorId, t.taskId, tRes.taskDigest, 'FAILURE')), payload());
  assert.equal(s.combine(text(t), [rp, failRes]).code, 'COMBINE_RESPONSE_UNMATCHED');
});

test('combine refuses a task that admitTask never admitted', () => {
  // combine() re-checked identity and generation but never required admission,
  // so a task refused at the route gate could still produce COMBINED.
  const s = admit(C_P, C_E);
  const { t, tRes, rp, re } = admitTaskAndResponses(s);
  assert.equal(s.combine(text(t), [rp, re]).code, 'COMBINED');

  // a task refused at the route gate must not combine on a fresh instance
  const s2 = admit(C_P);
  const refused = task({ requiredContributors: [{ role: 'PROTON', contributorId: C_P.contributorId,
    channelId: 'channel.not.declared', fromPortId: 'n0.a', toPortId: 'n1.b' }] });
  assert.equal(s2.admitTask(text(refused)).code, 'TASK_ROUTE_REFUSED');
  assert.equal(s2.combine(text(refused), [rp]).code, 'COMBINE_TASK_NOT_ADMITTED');
});
