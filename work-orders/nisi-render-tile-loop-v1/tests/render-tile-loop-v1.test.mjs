// Protected owner-authored contract oracle (Claude, 2026-09-15). Drafters must not edit this file.
// Port of unit-03 acceptance semantics to the JS TileLoopV1; identity excludes attempt (decision R).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TILE_LOOP_PROFILE_V1,
  TILE_LOOP_STATES_V1,
  TILE_LOOP_VERDICTS_V1,
  TILE_LOOP_DEFAULTS_V1,
  TileLoopV1,
} from '../src/render-tile-loop-v1.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Content-identical tile builder (same inputs/recipe/neighbours → same identity). */
const same = (id, over = {}) => ({
  inputs:     over.inputs     ?? { p: 1 },
  recipe:     over.recipe     ?? 'r1',
  neighbours: over.neighbours ?? [],
  children:   over.children   ?? [],
});

const DIGEST_RE = /^[0-9a-f]{64}$/;

const promoteLeaf = (loop, id, { output = 'x', source = 's1', reviewer = 'r1' } = {}) => {
  loop.render(id, { output, source });
  loop.verify(id, { validity: true, quality: true, reviewer });
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

test('constants are frozen and complete', () => {
  assert.equal(TILE_LOOP_PROFILE_V1, 'nisi-render-tile-loop-v1');
  assert.deepEqual(TILE_LOOP_STATES_V1, ['open', 'rendered', 'promoted', 'quarantined']);
  assert.deepEqual(TILE_LOOP_VERDICTS_V1, ['PASS', 'VALIDITY_FAIL', 'QUALITY_FAIL', 'APRON_STALE', 'REPLAY']);
  assert.deepEqual(TILE_LOOP_DEFAULTS_V1, { maxAttempts: 3, maxReopens: 2 });
  for (const c of [TILE_LOOP_STATES_V1, TILE_LOOP_VERDICTS_V1, TILE_LOOP_DEFAULTS_V1]) {
    assert.ok(Object.isFrozen(c));
  }
});

test('defaults apply and empty loop is done (Python-faithful)', () => {
  const loop = new TileLoopV1();
  assert.equal(loop.done(), true);
  assert.equal(loop.stuck(), false);
  assert.equal(loop.height(), 0);
  assert.deepEqual(loop.snapshot(), { tiles: {} });
  assert.ok(Object.isFrozen(loop.snapshot()));
  assert.ok(Object.isFrozen(loop.snapshot().tiles));
});

// ---------------------------------------------------------------------------
// add() — programming-error throws
// ---------------------------------------------------------------------------

test('add throws on duplicate id', () => {
  const loop = new TileLoopV1();
  loop.add('a', same('a'));
  assert.throws(() => loop.add('a', same('a')), /duplicate/);
});

test('add throws when tile names itself (neighbours or children)', () => {
  const loop = new TileLoopV1();
  assert.throws(() => loop.add('a', { inputs: { p: 1 }, recipe: 'r1', neighbours: ['a'] }), /naming itself/);
  assert.throws(() => loop.add('b', { inputs: { p: 1 }, recipe: 'r1', children: ['b'] }), /naming itself/);
});

test('add throws on unknown neighbour or unknown child', () => {
  const loop = new TileLoopV1();
  assert.throws(() => loop.add('a', { inputs: { p: 1 }, recipe: 'r1', neighbours: ['ghost'] }), /unknown neighbour/);
  assert.throws(() => loop.add('b', { inputs: { p: 1 }, recipe: 'r1', children: ['ghost'] }), /unknown child/);
});

test('add throws when child already has a parent', () => {
  const loop = new TileLoopV1();
  loop.add('leaf', same('leaf'));
  loop.add('p1', same('p1', { children: ['leaf'] }));
  assert.throws(() => loop.add('p2', same('p2', { children: ['leaf'] })), /already has a parent/);
});

test('unknown tile operations throw', () => {
  const loop = new TileLoopV1();
  assert.throws(() => loop.state('nope'), /unknown tile/);
  assert.throws(() => loop.render('nope', { output: 'x', source: 's' }), /unknown tile/);
  assert.throws(() => loop.verify('nope', { validity: true, quality: true, reviewer: 'r' }), /unknown tile/);
  assert.throws(() => loop.reopen('nope', 'why'), /unknown tile/);
});

// ---------------------------------------------------------------------------
// Leaf lifecycle
// ---------------------------------------------------------------------------

test('leaf render returns RENDERED', () => {
  const loop = new TileLoopV1();
  loop.add('a', same('a'));
  assert.equal(loop.render('a', { output: 'x', source: 's1' }), 'rendered');
  assert.equal(loop.state('a'), 'rendered');
  assert.equal(loop.lastCode('a'), null);
  assert.equal(loop.height(), 1);
  assert.equal(loop.done(), false);
});

test('leaf verify PASS promotes and records output', () => {
  const loop = new TileLoopV1();
  loop.add('a', same('a'));
  loop.render('a', { output: 'x', source: 's1' });
  assert.equal(loop.verify('a', { validity: true, quality: true, reviewer: 'r1' }), 'promoted');
  assert.equal(loop.state('a'), 'promoted');
  assert.equal(loop.lastCode('a'), 'PASS');
  assert.match(loop.output('a'), DIGEST_RE);
  assert.equal(loop.done(), true);
});

// ---------------------------------------------------------------------------
// Identity without attempt (decision R)
// ---------------------------------------------------------------------------

test('identity excludes attempt: same key used across attempts, fails, tombstone and re-promote', () => {
  const journal = new Map();
  const loop = new TileLoopV1({ journal });
  loop.add('a', same('a'));

  // attempt 1: quality fail
  loop.render('a', { output: 'out1', source: 's1' });
  loop.verify('a', { validity: true, quality: false, reviewer: 'r1' });
  assert.equal(loop.state('a'), 'open');
  assert.equal(loop.attemptCount('a'), 1);

  // attempt 2: promote under the same identity
  loop.render('a', { output: 'out2', source: 's1' });
  loop.verify('a', { validity: true, quality: true, reviewer: 'r1' });
  assert.equal(loop.state('a'), 'promoted');
  assert.equal(journal.size, 1);

  // reopen: tombstone under the same identity
  loop.reopen('a', 'rework');
  assert.equal(journal.size, 1);
  assert.equal(journal.values().next().value, null);

  // attempt 3: tombstone blocks replay, re-render, re-promote under the same key
  loop.render('a', { output: 'out3', source: 's1' });
  assert.equal(loop.state('a'), 'rendered');
  loop.verify('a', { validity: true, quality: true, reviewer: 'r1' });
  assert.equal(loop.state('a'), 'promoted');
  assert.equal(journal.size, 1); // same key — attempt never entered the identity
  assert.match(journal.values().next().value, DIGEST_RE);
});

// ---------------------------------------------------------------------------
// Replay and tombstones
// ---------------------------------------------------------------------------

test('replay: identical resubmit promotes instantly with REPLAY', () => {
  const loop = new TileLoopV1();
  loop.add('a', same('a'));
  loop.add('b', same('b')); // identical content → identical identity
  promoteLeaf(loop, 'a', { output: 'x' });

  loop.render('b', { output: 'different-output', source: 's2' });
  assert.equal(loop.state('b'), 'promoted');
  assert.equal(loop.lastCode('b'), 'REPLAY');
  assert.equal(loop.output('b'), loop.output('a')); // journal value, not the new candidate
  assert.equal(loop.done(), true);
});

test('tombstone blocks replay until re-verified', () => {
  const loop = new TileLoopV1();
  loop.add('a', same('a'));
  loop.add('b', same('b'));
  promoteLeaf(loop, 'a', { output: 'x' });

  loop.reopen('a', 'rework'); // tombstone under the shared identity

  loop.render('b', { output: 'y', source: 's2' });
  assert.equal(loop.state('b'), 'rendered'); // NOT a replay
  assert.equal(loop.lastCode('b'), null);
  assert.equal(loop.output('b'), null);

  loop.verify('b', { validity: true, quality: true, reviewer: 'r2' });
  assert.equal(loop.state('b'), 'promoted');
  assert.match(loop.output('b'), DIGEST_RE);
});

// ---------------------------------------------------------------------------
// Parent / child
// ---------------------------------------------------------------------------

test('parent render requires all children promoted', () => {
  const loop = new TileLoopV1();
  loop.add('leaf', same('leaf'));
  loop.add('p', same('p', { children: ['leaf'] }));

  // child not even rendered
  assert.throws(() => loop.render('p', { output: 'x', source: 's' }), /children promoted/);

  // child rendered but not verified/promoted
  loop.render('leaf', { output: 'x', source: 's1' });
  assert.throws(() => loop.render('p', { output: 'x', source: 's' }), /children promoted/);
});

test('parent verify PASS promotes after children', () => {
  const loop = new TileLoopV1();
  loop.add('leaf', same('leaf'));
  loop.add('p', same('p', { children: ['leaf'] }));
  promoteLeaf(loop, 'leaf', { output: 'x' });

  assert.equal(loop.render('p', { output: 'ignored', source: 'ignored' }), 'rendered');
  assert.equal(loop.state('p'), 'rendered');
  assert.equal(loop.verify('p', { validity: true, quality: true, reviewer: 'r9' }), 'promoted');
  assert.equal(loop.lastCode('p'), 'PASS');
  assert.match(loop.output('p'), DIGEST_RE);
  assert.equal(loop.done(), true);
});

// ---------------------------------------------------------------------------
// Verify failures
// ---------------------------------------------------------------------------

test('apron stale returns to OPEN without spending an attempt', () => {
  const loop = new TileLoopV1();
  loop.add('b', same('b', { recipe: 'rb' })); // neighbour must exist before it is referenced
  loop.add('a', same('a', { neighbours: ['b'] }));

  // render a while b is still open → apron snapshot { b: null }
  loop.render('a', { output: 'xa', source: 's1' });

  // b gets promoted → a's apron drifts from null to a digest
  promoteLeaf(loop, 'b', { output: 'xb' });

  assert.equal(loop.verify('a', { validity: true, quality: true, reviewer: 'r2' }), 'open');
  assert.equal(loop.lastCode('a'), 'APRON_STALE');
  assert.equal(loop.attemptCount('a'), 0); // no attempt spent

  // stale tile can re-render and promote normally
  loop.render('a', { output: 'xa2', source: 's1' });
  loop.verify('a', { validity: true, quality: true, reviewer: 'r2' });
  assert.equal(loop.state('a'), 'promoted');
});

test('validity failure increments attempt and returns to OPEN', () => {
  const loop = new TileLoopV1();
  loop.add('a', same('a'));
  loop.render('a', { output: 'x', source: 's1' });
  assert.equal(loop.verify('a', { validity: false, quality: true, reviewer: 'r1' }), 'open');
  assert.equal(loop.lastCode('a'), 'VALIDITY_FAIL');
  assert.equal(loop.attemptCount('a'), 1);
});

test('quality failure increments attempt and returns to OPEN', () => {
  const loop = new TileLoopV1();
  loop.add('a', same('a'));
  loop.render('a', { output: 'x', source: 's1' });
  assert.equal(loop.verify('a', { validity: true, quality: false, reviewer: 'r1' }), 'open');
  assert.equal(loop.lastCode('a'), 'QUALITY_FAIL');
  assert.equal(loop.attemptCount('a'), 1);
});

test('attempt ceiling quarantines after max attempts', () => {
  const loop = new TileLoopV1({ maxAttempts: 2 });
  loop.add('a', same('a'));
  for (let i = 1; i <= 2; i++) {
    loop.render('a', { output: `x${i}`, source: 's1' });
    assert.equal(loop.verify('a', { validity: false, quality: true, reviewer: 'r1' }), 'open');
    assert.equal(loop.attemptCount('a'), i);
  }
  loop.render('a', { output: 'x3', source: 's1' });
  assert.equal(loop.verify('a', { validity: false, quality: true, reviewer: 'r1' }), 'quarantined');
  assert.equal(loop.lastCode('a'), 'VALIDITY_FAIL');
  assert.equal(loop.stuck(), true);
  assert.equal(loop.done(), false);
});

test('reviewer must differ from source', () => {
  const loop = new TileLoopV1();
  loop.add('a', same('a'));
  loop.render('a', { output: 'x', source: 's1' });
  assert.throws(() => loop.verify('a', { validity: true, quality: true, reviewer: 's1' }), /reviewer same as source/);
  assert.throws(() => loop.verify('a', { validity: true, quality: true, reviewer: '' }), /invalid reviewer/);
});

// ---------------------------------------------------------------------------
// Reopen and cascade
// ---------------------------------------------------------------------------

test('reopen cascades upward only; siblings and children untouched', () => {
  const loop = new TileLoopV1();
  // distinct recipe per tile — identical-content tiles would replay (distinct identities required here)
  loop.add('c', same('c', { recipe: 'rc' }));
  loop.add('sib', same('sib', { recipe: 'rsib' }));
  loop.add('b', same('b', { recipe: 'rb', children: ['c', 'sib'] }));
  loop.add('g', same('g', { recipe: 'rg', children: ['b'] }));

  promoteLeaf(loop, 'c', { output: 'xc' });
  promoteLeaf(loop, 'sib', { output: 'xsib' });
  promoteLeaf(loop, 'b', { output: 'ignored' }); // parent: source forced to 'assemble'
  promoteLeaf(loop, 'g', { output: 'ignored' });
  assert.equal(loop.done(), true);

  assert.equal(loop.reopen('c', 'rework'), 'open');
  assert.equal(loop.state('c'), 'open');
  assert.equal(loop.state('b'), 'open');   // ancestor
  assert.equal(loop.state('g'), 'open');   // ancestor
  assert.equal(loop.state('sib'), 'promoted'); // sibling untouched
  assert.equal(loop.output('c'), null);
  assert.equal(loop.output('b'), null);
  assert.equal(loop.output('g'), null);
  assert.match(loop.output('sib'), DIGEST_RE); // sibling output retained
  assert.equal(loop.attemptCount('b'), 0); // ancestors keep attempts unchanged
  assert.equal(loop.attemptCount('g'), 0);

  // full re-assembly: re-render the child, then b, then g
  promoteLeaf(loop, 'c', { output: 'xc2' });
  promoteLeaf(loop, 'b', { output: 'ignored' });
  promoteLeaf(loop, 'g', { output: 'ignored' });
  assert.equal(loop.done(), true);
});

test('reopen ceiling quarantines after max reopens', () => {
  const loop = new TileLoopV1({ maxReopens: 1 });
  loop.add('a', same('a'));
  promoteLeaf(loop, 'a', { output: 'x' });
  assert.equal(loop.reopen('a', 'r1'), 'open');
  assert.equal(loop.reopenCount('a'), 1);

  promoteLeaf(loop, 'a', { output: 'y' });
  assert.equal(loop.reopen('a', 'r2'), 'quarantined');
  assert.equal(loop.reopenCount('a'), 2);
  assert.equal(loop.stuck(), true);
});

test('reopen requires a reason', () => {
  const loop = new TileLoopV1();
  loop.add('a', same('a'));
  promoteLeaf(loop, 'a', { output: 'x' });
  assert.throws(() => loop.reopen('a', ''), /reason/);
  assert.throws(() => loop.reopen('a', undefined), /reason/);
});

// ---------------------------------------------------------------------------
// Cross-job journal
// ---------------------------------------------------------------------------

test('shared journal replays a whole shot across jobs', () => {
  const journal = new Map();

  const l1 = new TileLoopV1({ journal });
  l1.add('a', same('a'));
  promoteLeaf(l1, 'a', { output: 'first-shot' });

  const l2 = new TileLoopV1({ journal });
  l2.add('a', same('a'));
  l2.render('a', { output: 'any-output', source: 's2' });
  assert.equal(l2.state('a'), 'promoted'); // replay — no render/verify needed
  assert.equal(l2.lastCode('a'), 'REPLAY');
  assert.equal(l2.output('a'), l1.output('a'));
  assert.equal(l2.done(), true);
  assert.equal(journal.size, 1);
});

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

test('snapshot reports states and is deeply frozen', () => {
  const loop = new TileLoopV1();
  loop.add('a', same('a'));
  loop.add('b', same('b'));
  loop.render('a', { output: 'x', source: 's1' });
  promoteLeaf(loop, 'b', { output: 'y' });

  const snap = loop.snapshot();
  assert.deepEqual(snap, {
    tiles: {
      a: { state: 'rendered', output: null, lastCode: null },
      b: { state: 'promoted', output: loop.output('b'), lastCode: 'PASS' },
    },
  });
  const deepFrozen = (x, seen = new Set()) => {
    if (!x || typeof x !== 'object' || seen.has(x)) return true;
    seen.add(x);
    return Object.isFrozen(x) && Object.values(x).every(v => deepFrozen(v, seen));
  };
  assert.ok(deepFrozen(snap));
});