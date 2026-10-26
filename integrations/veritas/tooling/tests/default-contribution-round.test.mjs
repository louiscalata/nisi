import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultContributionRound } from '../neural/default-contribution-round.mjs';
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
  const made = createDefaultContributionRound(baseBytes, dualBytes, { generation: 1 });
  assert.equal(made.ok, true, made.code);
  return made.planner;
}
function contributor(role, idPrefix = 'contrib') {
  return { kind: 'veritas-contribution-contributor-v1', contributorId: `${idPrefix}.${role.toLowerCase()}`,
    role, revision: 1, outputWidth: ROOT_WIDTH, outputSpaceSha256: ROOT_SPACE, maxPayloadBytes: 256 };
}
const C_P = contributor('PROTON');
const C_E = contributor('ELECTRON');
const C_N = contributor('NEUTRON');
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
const NEUTRON_REQ = { role: 'NEUTRON', contributorId: C_N.contributorId, channelId: 'channel.0.forward', fromPortId: 'n0.a', toPortId: 'n1.b' };

test('factory validates the bounded declarations + generation and never authorizes', () => {
  const made = createDefaultContributionRound(baseBytes, dualBytes, { generation: 1 });
  assert.equal(made.ok, true);
  assert.equal(made.code, 'READY_PRIVATE_DEFAULT_CONTRIBUTION_ROUND_ONLY');
  for (const f of ['authorizing', 'modelExecuted', 'promotionGranted', 'certificationGranted']) assert.equal(made[f], false);
  assert.equal(createDefaultContributionRound(baseBytes, dualBytes, { generation: 0 }).ok, false);
  assert.equal(createDefaultContributionRound(baseBytes, dualBytes, {}).ok, false);
  assert.equal(createDefaultContributionRound(Buffer.from('{'), dualBytes, { generation: 1 }).ok, false);
});

test('every result is non-authorizing and frozen', () => {
  const s = admit(C_P);
  const t = task({ requiredContributors: [task().requiredContributors[0]] });
  const results = [
    createDefaultContributionRound(baseBytes, dualBytes, { generation: 1 }),
    s.admitContributor(text(C_E)), s.admitContributor(Buffer.from('{').toString()),
    s.admitTask(text(t)), s.admitTask(Buffer.from('{').toString()),
    s.requestRound(Buffer.from('{').toString()),
    s.recordOutcome('{}', C_P.contributorId, 'SUCCESS'),
    s.select('{}'),
  ];
  for (const r of results) {
    for (const f of ['authorizing', 'modelExecuted', 'promotionGranted', 'certificationGranted']) assert.equal(r[f], false);
    assert.equal(Object.isFrozen(r), true);
  }
});

test('single-contributor task requests a bounded round and selects SOLO on SUCCESS', () => {
  const s = admit(C_P);
  const req = task().requiredContributors[0];
  const t = task({ requiredContributors: [req] });
  const rr = s.requestRound(text(t));
  assert.equal(rr.code, 'ROUND_REQUESTED');
  assert.equal(rr.roundDigest.length, 64);
  assert.deepEqual(rr.roles, ['PROTON']);
  assert.equal(rr.deadlineMs, 1000);
  assert.equal(rr.boundedRetries, 0);
  assert.equal(s.recordOutcome(text({ kind: 'veritas-contribution-round-v1', roundId: rr.roundId, taskId: t.taskId, taskDigest: rr.taskDigest, generation: t.generation, roles: rr.roles, deadlineMs: t.deadlineMs }), C_P.contributorId, 'SUCCESS').code, 'OUTCOME_RECORDED');
  const sel = s.select(text({ kind: 'veritas-contribution-round-v1', roundId: rr.roundId, taskId: t.taskId, taskDigest: rr.taskDigest, generation: t.generation, roles: rr.roles, deadlineMs: t.deadlineMs }));
  assert.equal(sel.code, 'ROUND_SELECTION');
  assert.equal(sel.selection, 'SOLO');
  assert.deepEqual(sel.roles, ['PROTON']);
  assert.equal(sel.exactlyOneWriter, true);
  assert.equal(sel.taskDigest, rr.taskDigest);
});

test('two-contributor task: PAIR on both SUCCESS, SOLO on one denied outcome', () => {
  const s = admit(C_P, C_E);
  const { t, rr } = (() => {
    const t = task();
    const rr = s.requestRound(text(t));
    assert.equal(rr.code, 'ROUND_REQUESTED');
    return { t, rr };
  })();
  const roundText = text({ kind: 'veritas-contribution-round-v1', roundId: rr.roundId, taskId: t.taskId, taskDigest: rr.taskDigest, generation: t.generation, roles: rr.roles, deadlineMs: t.deadlineMs });
  assert.equal(s.recordOutcome(roundText, C_P.contributorId, 'SUCCESS').code, 'OUTCOME_RECORDED');
  assert.equal(s.recordOutcome(roundText, C_E.contributorId, 'SUCCESS').code, 'OUTCOME_RECORDED');
  assert.equal(s.select(roundText).selection, 'PAIR');
  assert.deepEqual(s.select(roundText).roles, ['PROTON', 'ELECTRON']);

  const s2 = admit(C_P, C_E);
  const rr2 = s2.requestRound(text(task()));
  const round2 = text({ kind: 'veritas-contribution-round-v1', roundId: rr2.roundId, taskId: task().taskId, taskDigest: rr2.taskDigest, generation: task().generation, roles: rr2.roles, deadlineMs: task().deadlineMs });
  assert.equal(s2.recordOutcome(round2, C_P.contributorId, 'ERROR', 'backend refused').code, 'OUTCOME_RECORDED');
  assert.equal(s2.recordOutcome(round2, C_E.contributorId, 'SUCCESS').code, 'OUTCOME_RECORDED');
  const sel2 = s2.select(round2);
  assert.equal(sel2.selection, 'SOLO');
  assert.deepEqual(sel2.roles, ['ELECTRON']);
});

test('three-contributor task: TRIO on all SUCCESS; PAIR when one abstains', () => {
  const s = admit(C_P, C_E, C_N);
  const t = task({ requiredContributors: [...task().requiredContributors, NEUTRON_REQ] });
  const rr = s.requestRound(text(t));
  assert.equal(rr.code, 'ROUND_REQUESTED');
  assert.deepEqual(rr.roles, ['PROTON', 'ELECTRON', 'NEUTRON']);
  const roundText = text({ kind: 'veritas-contribution-round-v1', roundId: rr.roundId, taskId: t.taskId, taskDigest: rr.taskDigest, generation: t.generation, roles: rr.roles, deadlineMs: t.deadlineMs });
  for (const [c, o] of [[C_P, 'SUCCESS'], [C_E, 'SUCCESS'], [C_N, 'SUCCESS']]) {
    assert.equal(s.recordOutcome(roundText, c.contributorId, o).code, 'OUTCOME_RECORDED');
  }
  assert.equal(s.select(roundText).selection, 'TRIO');
  assert.deepEqual(s.select(roundText).roles, ['PROTON', 'ELECTRON', 'NEUTRON']);

  const s2 = admit(C_P, C_E, C_N);
  const rr2 = s2.requestRound(text(t));
  const round2 = text({ kind: 'veritas-contribution-round-v1', roundId: rr2.roundId, taskId: t.taskId, taskDigest: rr2.taskDigest, generation: t.generation, roles: rr2.roles, deadlineMs: t.deadlineMs });
  assert.equal(s2.recordOutcome(round2, C_P.contributorId, 'SUCCESS').code, 'OUTCOME_RECORDED');
  assert.equal(s2.recordOutcome(round2, C_E.contributorId, 'ABSTAIN', 'no useful contribution').code, 'OUTCOME_RECORDED');
  assert.equal(s2.recordOutcome(round2, C_N.contributorId, 'SUCCESS').code, 'OUTCOME_RECORDED');
  const sel2 = s2.select(round2);
  assert.equal(sel2.selection, 'PAIR');
  assert.deepEqual(sel2.roles, ['PROTON', 'NEUTRON']);
});

test('no useful outcome yields SELECTION_NONE, never a selection', () => {
  const s = admit(C_P, C_E);
  const t = task();
  const rr = s.requestRound(text(t));
  const roundText = text({ kind: 'veritas-contribution-round-v1', roundId: rr.roundId, taskId: t.taskId, taskDigest: rr.taskDigest, generation: t.generation, roles: rr.roles, deadlineMs: t.deadlineMs });
  assert.equal(s.recordOutcome(roundText, C_P.contributorId, 'REFUSED', 'route denied').code, 'OUTCOME_RECORDED');
  assert.equal(s.recordOutcome(roundText, C_E.contributorId, 'ERROR', 'timed out').code, 'OUTCOME_RECORDED');
  const sel = s.select(roundText);
  assert.equal(sel.selection, 'NONE');
  assert.deepEqual(sel.roles, []);
});

test('bounded refusals: duplicate outcome, unknown contributor, tampered round, noncanonical', () => {
  const s = admit(C_P, C_E);
  const t = task();
  const rr = s.requestRound(text(t));
  const roundText = text({ kind: 'veritas-contribution-round-v1', roundId: rr.roundId, taskId: t.taskId, taskDigest: rr.taskDigest, generation: t.generation, roles: rr.roles, deadlineMs: t.deadlineMs });
  assert.equal(s.recordOutcome(roundText, C_P.contributorId, 'SUCCESS').code, 'OUTCOME_RECORDED');
  assert.equal(s.recordOutcome(roundText, C_P.contributorId, 'SUCCESS').code, 'OUTCOME_DUPLICATE');
  assert.equal(s.recordOutcome(roundText, 'nobody.unknown', 'SUCCESS').code, 'OUTCOME_CONTRIBUTOR_UNKNOWN');
  assert.equal(s.recordOutcome(roundText, C_P.contributorId, 'MAYBE').code, 'OUTCOME_SCHEMA_INVALID');
  // wrong round digest -> round not matched
  const tampered = text({ kind: 'veritas-contribution-round-v1', roundId: rr.roundId, taskId: t.taskId, taskDigest: 'b'.repeat(64), generation: t.generation, roles: rr.roles, deadlineMs: t.deadlineMs });
  assert.equal(s.recordOutcome(tampered, C_E.contributorId, 'SUCCESS').code, 'ROUND_UNMATCHED');
  assert.equal(s.select(tampered).code, 'ROUND_UNMATCHED');
  // non-canonical round text
  assert.equal(s.select(Buffer.from('{').toString()).code, 'ROUND_UNMATCHED');
  assert.equal(s.recordOutcome(Buffer.from('hello').toString(), C_E.contributorId, 'SUCCESS').code, 'ROUND_UNMATCHED');
  // a round can only be requested once
  assert.equal(s.requestRound(text(t)).code, 'ROUND_DUPLICATE');
});

test('SUCCESS outcomes require an empty reason; oversized or non-ASCII reasons refused', () => {
  const s = admit(C_P);
  const t = task({ requiredContributors: [task().requiredContributors[0]] });
  const rr = s.requestRound(text(t));
  const roundText = text({ kind: 'veritas-contribution-round-v1', roundId: rr.roundId, taskId: t.taskId, taskDigest: rr.taskDigest, generation: t.generation, roles: rr.roles, deadlineMs: t.deadlineMs });
  assert.equal(s.recordOutcome(roundText, C_P.contributorId, 'SUCCESS', 'why').code, 'OUTCOME_SCHEMA_INVALID');
  assert.equal(s.recordOutcome(roundText, C_P.contributorId, 'ERROR', 'x'.repeat(257)).code, 'OUTCOME_SCHEMA_INVALID');
  assert.equal(s.recordOutcome(roundText, C_P.contributorId, 'ERROR', 'backend\ninjected').code, 'OUTCOME_SCHEMA_INVALID');
  assert.equal(s.recordOutcome(roundText, C_P.contributorId, 'ERROR', 'bounded reason ok').code, 'OUTCOME_RECORDED');
});