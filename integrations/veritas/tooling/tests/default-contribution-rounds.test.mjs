import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultContributionRounds } from '../neural/default-contribution-rounds.mjs';

const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
const roundText = (value) => canonical(value);

const session = (routes, generation = 7, overrides = {}) => ({
  kind: 'veritas-default-round-session-v1',
  sessionId: 'sess-round-01',
  requester: 'PRIMARY',
  generation,
  defaultCap: 3,
  routes,
  ...overrides,
});

const DENIED = (channelId = 'ch-blocked') => ({ channelId, fromNodeId: 'n-a', toNodeId: 'n-b', state: 'DENIED' });
const UNAVAILABLE = (channelId = 'ch-busy') => ({ channelId, fromNodeId: 'n-a', toNodeId: 'n-b', state: 'UNAVAILABLE' });
const ALLOW = (channelId = 'ch-open') => ({ channelId, fromNodeId: 'n-a', toNodeId: 'n-b', state: 'ALLOW' });

const round = (sessionId = 'sess-round-01', channelId = 'ch-open', generation = 7, overrides = {}) => ({
  kind: 'veritas-default-round-request-v1',
  roundId: 'rr-01',
  sessionId,
  channelId,
  requester: 'PRIMARY',
  generation,
  expertise: 'ex-flow',
  ttlMs: 5000,
  ...overrides,
});

const bind = (sessionValue, generation = sessionValue.generation) => {
  const bytes = Buffer.from(canonical(sessionValue), 'utf8');
  return createDefaultContributionRounds(bytes, { generation });
};

test('factory validates a bounded session declaration and generation', () => {
  const r = bind(session([ALLOW(), DENIED()]));
  assert.equal(r.ok, true);
  assert.equal(r.code, 'READY_PRIVATE_DEFAULT_CONTRIBUTION_ROUNDS_ONLY');
  assert.equal(r.rounds instanceof Object, true);
});

test('factory refuses invalid declaration bytes or generation', () => {
  for (const bad of [
    Buffer.from('not json', 'utf8'),
    Buffer.from('{}', 'utf8'),
    Buffer.alloc(0),
  ]) {
    const r = createDefaultContributionRounds(bad, { generation: 7 });
    assert.equal(r.ok, false);
  }
  const bytes = Buffer.from(canonical(session([ALLOW()])), 'utf8');
  assert.equal(createDefaultContributionRounds(bytes, { generation: 8 }).ok, false); // generation mismatch
  assert.equal(createDefaultContributionRounds(bytes, { generation: 0 }).ok, false);
  assert.equal(createDefaultContributionRounds(undefined, { generation: 7 }).ok, false);
});

test('a session with a non-canonical declaration is refused', () => {
  const text = canonical(session([ALLOW()])).replace('"kind"', '" kind"');
  assert.equal(createDefaultContributionRounds(Buffer.from(text, 'utf8'), { generation: 7 }).ok, false);
});

test('a default round on an ALLOW route dispatches (advisory, no execution)', () => {
  const r = bind(session([ALLOW(), DENIED()]));
  const out = r.rounds.proposeRound(roundText(round('sess-round-01', 'ch-open')));
  assert.equal(out.ok, true);
  assert.equal(out.code, 'DEFAULT_ROUND_DISPATCHED');
  assert.equal(out.dispatched, 1);
  assert.equal(out.authorizing, false);
  assert.equal(out.modelExecuted, false);
});

test('a default round on a DENIED route is refused and remembered', () => {
  const r = bind(session([ALLOW(), DENIED()]));
  const out = r.rounds.proposeRound(roundText(round('sess-round-01', 'ch-blocked')));
  assert.equal(out.ok, false);
  assert.equal(out.code, 'ROUND_ROUTE_DENIED');
});

test('a default round on an UNAVAILABLE route is refused and remembered', () => {
  const r = bind(session([ALLOW(), UNAVAILABLE()]));
  const out = r.rounds.proposeRound(roundText(round('sess-round-01', 'ch-busy')));
  assert.equal(out.ok, false);
  assert.equal(out.code, 'ROUND_ROUTE_UNAVAILABLE');
});

test('a recast on a remembered blocked route cannot bypass the refusal', () => {
  const r = bind(session([DENIED()]));
  const first = r.rounds.proposeRound(roundText(round('sess-round-01', 'ch-blocked')));
  assert.equal(first.ok, false);
  // Same blocked channel, different roundId + expertise recast: still refused.
  const recast = r.rounds.proposeRound(roundText(round('sess-round-01', 'ch-blocked', 7, { roundId: 'rr-02', expertise: 'ex-recast' })));
  assert.equal(recast.ok, false);
  assert.equal(recast.code, 'ROUND_ROUTE_REMEMBRANCE_REFUSED');
});

test('the fourth default round is refused outright (indefinite-work guard)', () => {
  const r = bind(session([ALLOW('ch-a'), ALLOW('ch-b'), ALLOW('ch-c')]));
  for (const ch of ['ch-a', 'ch-b', 'ch-c']) {
    const out = r.rounds.proposeRound(roundText(round('sess-round-01', ch, 7, { roundId: `rr-${ch}` })));
    assert.equal(out.ok, true);
  }
  const fourth = r.rounds.proposeRound(roundText(round('sess-round-01', 'ch-a', 7, { roundId: 'rr-fourth' })));
  assert.equal(fourth.ok, false);
  assert.equal(fourth.code, 'INDEFINITE_WORK_REFUSED');
});

test('a round beyond the cap is refused even on an ALLOW route (no late bypass)', () => {
  const r = bind(session([ALLOW()]));
  const third = r.rounds.proposeRound(roundText(round('sess-round-01', 'ch-open', 7, { roundId: 'rr-1' })));
  assert.equal(third.ok, true);
  assert.equal(r.rounds.proposeRound(roundText(round('sess-round-01', 'ch-open', 7, { roundId: 'rr-2' }))).ok, true);
  assert.equal(r.rounds.proposeRound(roundText(round('sess-round-01', 'ch-open', 7, { roundId: 'rr-3' }))).ok, true);
  assert.equal(r.rounds.proposeRound(roundText(round('sess-round-01', 'ch-open', 7, { roundId: 'rr-4' }))).code, 'INDEFINITE_WORK_REFUSED');
});

test('after the cap the session is terminal EXHAUSTED, never success', () => {
  const r = bind(session([ALLOW('ch-a'), DENIED('ch-b'), UNAVAILABLE('ch-c')]));
  r.rounds.proposeRound(roundText(round('sess-round-01', 'ch-a', 7, { roundId: 'rr-1' })));
  r.rounds.proposeRound(roundText(round('sess-round-01', 'ch-b', 7, { roundId: 'rr-2' })));
  r.rounds.proposeRound(roundText(round('sess-round-01', 'ch-c', 7, { roundId: 'rr-3' })));
  const status = r.rounds.sessionStatus();
  assert.equal(status.code, 'SESSION_ROUNDS_EXHAUSTED');
  assert.equal(status.terminal, true);
  assert.equal(status.rounds, 3);
  assert.equal(status.dispatched + status.refused, 3);
  assert.equal(status.authorizing, false);
});

test('a mismatched session, generation, requester or round shape is refused', () => {
  const r = bind(session([ALLOW()]));
  assert.equal(r.rounds.proposeRound(roundText(round('sess-other', 'ch-open', 7))).code, 'ROUND_SESSION_MISMATCH');
  assert.equal(r.rounds.proposeRound(roundText(round('sess-round-01', 'ch-open', 8))).code, 'ROUND_GENERATION_MISMATCH');
  assert.equal(r.rounds.proposeRound(roundText(round('sess-round-01', 'ch-open', 7, { requester: 'SHADOW' }))).code, 'ROUND_SCHEMA_INVALID');
  assert.equal(r.rounds.proposeRound(roundText(round('sess-round-01', 'ch-open', 7, { ttlMs: 0 }))).code, 'ROUND_SCHEMA_INVALID');
  assert.equal(r.rounds.proposeRound(roundText(round('sess-round-01', 'ch-open', 7, { expertise: '' }))).code, 'ROUND_SCHEMA_INVALID');
});

test('an unknown route is refused without being remembered', () => {
  const r = bind(session([ALLOW()]));
  const out = r.rounds.proposeRound(roundText(round('sess-round-01', 'ch-ghost')));
  assert.equal(out.ok, false);
  assert.equal(out.code, 'ROUND_ROUTE_UNKNOWN');
  // Unknown-route attempts count toward the cap (bounded attempts).
  assert.equal(r.rounds.sessionStatus().terminal, false);
});

test('non-canonical or malformed round text is refused, never a PASS', () => {
  const r = bind(session([ALLOW()]));
  assert.equal(r.rounds.proposeRound('{bad json').code, 'JSON_INVALID');
  const text = canonical(round('sess-round-01', 'ch-open'));
  assert.equal(r.rounds.proposeRound(text.replace('"roundId"', '" roundId"')).code, 'ROUND_NONCANONICAL');
});

test('results are frozen, non-authorizing declarations', () => {
  const r = bind(session([ALLOW('ch-a'), DENIED('ch-b')]));
  const dispatched = r.rounds.proposeRound(roundText(round('sess-round-01', 'ch-a', 7, { roundId: 'rr-x' })));
  const refused = r.rounds.proposeRound(roundText(round('sess-round-01', 'ch-b', 7, { roundId: 'rr-y' })));
  for (const entry of [dispatched, refused]) {
    for (const flag of ['authorizing', 'modelExecuted', 'promotionGranted', 'certificationGranted']) {
      assert.equal(Object.isFrozen(entry), true);
      assert.equal(entry[flag], false);
    }
  }
  const status = r.rounds.sessionStatus();
  assert.equal(Object.isFrozen(status), true);
  assert.equal(status.authorizing, false);
});

test('a session with a non-PRIMARY requester or wrong cap is refused at bind', () => {
  assert.equal(bind(session([ALLOW()], 7, { requester: 'SHADOW' })).ok, false);
  assert.equal(bind(session([ALLOW()], 7, { defaultCap: 4 })).ok, false);
  assert.equal(bind(session([ALLOW()], 7, { defaultCap: 2 })).ok, false);
  assert.equal(bind(session([{ ...ALLOW(), state: 'MAYBE' }])).ok, false);
  assert.equal(bind(session([], 7)).ok, false); // no routes
});

test('duplicate channel routes are refused at bind', () => {
  assert.equal(bind(session([ALLOW('ch-a'), DENIED('ch-a')])).ok, false);
});