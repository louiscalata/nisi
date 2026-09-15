// Protected owner-authored contract oracle (Claude, 2026-09-14). Drafters must not edit this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RENDER_TILE_PROFILE_V1, RENDER_TILE_LIMITS_V1, RENDER_TILE_ROLES_V1, RENDER_TILE_MODALITIES_V1,
  RENDER_TILE_APRON_UNITS_V1, RENDER_TILE_VERDICTS_V1, RENDER_TILE_CODES_V1,
  readRenderTileV1, identityRenderTileV1,
} from '../src/render-tile-v1.mjs';

const D1 = '0'.repeat(63) + '1';
const D2 = '0'.repeat(63) + '2';
const leaf = () => ({
  schemaVersion: 1, profile: 'nisi-render-tile-v1', tileId: 'a', kind: 'leaf',
  inputs: { src: D1 },
  recipe: { role: 'generator', modality: 'code', model: 'm', seed: 1, params: {}, apron: { size: 0, unit: 'symbols' } },
  neighbours: [], children: [], attempt: 0,
  budget: { wallMs: 1000, tokens: null, memoryBytes: null },
  apron: {},
});
const parent = () => ({ ...leaf(), tileId: 'p', kind: 'parent', inputs: {},
  recipe: { role: 'assemble', modality: 'code', model: null, seed: null, params: {}, apron: { size: 0, unit: 'symbols' } },
  children: ['a', 'b'] });
const withNeighbour = () => ({ ...leaf(), neighbours: ['b'], apron: { b: D2 } });
const ok = (input) => { const r = readRenderTileV1(input); assert.equal(r.ok, true, JSON.stringify(r)); return r; };
const refuse = (input, code, path) => {
  const r = readRenderTileV1(input);
  assert.deepEqual({ ok: r.ok, code: r.code, path: r.path }, { ok: false, code, path });
  assert.deepEqual(Object.keys(r).sort(), ['code', 'ok', 'path', 'profile']);
  assert.equal(r.profile, RENDER_TILE_PROFILE_V1);
  assert.ok(Object.isFrozen(r));
};
const deepFrozen = (x, seen = new Set()) => {
  if (!x || typeof x !== 'object' || seen.has(x)) return true;
  seen.add(x);
  return Object.isFrozen(x) && Object.values(x).every(v => deepFrozen(v, seen));
};

test('constants are frozen and complete', () => {
  assert.equal(RENDER_TILE_PROFILE_V1, 'nisi-render-tile-v1');
  assert.deepEqual(RENDER_TILE_LIMITS_V1, { inputs: 256, neighbours: 256, children: 4096, idLength: 128, modelLength: 128, paramsBytes: 65536 });
  assert.deepEqual(RENDER_TILE_ROLES_V1, ['generator', 'denoiser', 'reconciler', 'checker', 'assemble']);
  assert.deepEqual(RENDER_TILE_MODALITIES_V1, ['code', 'image', 'text']);
  assert.deepEqual(RENDER_TILE_APRON_UNITS_V1, ['symbols', 'pixels', 'chars']);
  assert.deepEqual(RENDER_TILE_VERDICTS_V1, ['PASS', 'VALIDITY_FAIL', 'QUALITY_FAIL', 'APRON_STALE', 'REPLAY']);
  assert.deepEqual(RENDER_TILE_CODES_V1, [
    'RENDER_TILE_NOT_OBJECT', 'RENDER_TILE_UNKNOWN_MEMBER', 'RENDER_TILE_MISSING_MEMBER', 'RENDER_TILE_SCHEMA_VERSION',
    'RENDER_TILE_PROFILE', 'RENDER_TILE_ID', 'RENDER_TILE_KIND', 'RENDER_TILE_INPUTS', 'RENDER_TILE_DIGEST',
    'RENDER_TILE_RECIPE', 'RENDER_TILE_PARAMS', 'RENDER_TILE_NEIGHBOURS', 'RENDER_TILE_CHILDREN', 'RENDER_TILE_ATTEMPT',
    'RENDER_TILE_BUDGET', 'RENDER_TILE_APRON', 'RENDER_TILE_CHILD_OUTPUTS']);
  for (const c of [RENDER_TILE_LIMITS_V1, RENDER_TILE_ROLES_V1, RENDER_TILE_MODALITIES_V1, RENDER_TILE_APRON_UNITS_V1, RENDER_TILE_VERDICTS_V1, RENDER_TILE_CODES_V1]) assert.ok(Object.isFrozen(c));
});

test('a valid leaf reads to a fresh, ordered, deep-frozen tile', () => {
  const input = leaf();
  input.inputs = { zeta: D2, alpha: D1 };
  input.recipe.params = { nested: { k: [1, 'two', null, true] } };
  const r = ok(input);
  assert.deepEqual(Object.keys(r), ['ok', 'profile', 'tile']);
  assert.equal(r.profile, RENDER_TILE_PROFILE_V1);
  assert.deepEqual(Object.keys(r.tile), ['schemaVersion', 'profile', 'tileId', 'kind', 'inputs', 'recipe', 'neighbours', 'children', 'attempt', 'budget', 'apron']);
  assert.deepEqual(Object.keys(r.tile.recipe), ['role', 'modality', 'model', 'seed', 'params', 'apron']);
  assert.deepEqual(Object.keys(r.tile.inputs), ['alpha', 'zeta']);
  assert.deepEqual(r.tile.recipe.params, { nested: { k: [1, 'two', null, true] } });
  assert.ok(deepFrozen(r) && deepFrozen(r.tile));
  assert.notEqual(r.tile.recipe.params, input.recipe.params);
  input.recipe.params.nested.k.push('late');
  input.inputs.alpha = D2;
  assert.deepEqual(r.tile.recipe.params, { nested: { k: [1, 'two', null, true] } });
  assert.equal(r.tile.inputs.alpha, D1);
});

test('a valid parent reads; apron keys come back sorted', () => {
  const r = ok(parent());
  assert.equal(r.tile.kind, 'parent');
  assert.deepEqual(r.tile.children, ['a', 'b']);
  assert.deepEqual(ok({ ...parent(), children: ['b', 'a'] }).tile.children, ['b', 'a'], 'children keep the order given');
  const n = ok({ ...leaf(), neighbours: ['z', 'b'], apron: { z: null, b: D2 } });
  assert.deepEqual(Object.keys(n.tile.apron), ['b', 'z']);
  assert.deepEqual(n.tile.neighbours, ['z', 'b']);
});

test('inputs may be empty and every role but assemble is a leaf role', () => {
  for (const role of ['generator', 'denoiser', 'reconciler', 'checker']) ok({ ...leaf(), inputs: {}, recipe: { ...leaf().recipe, role } });
  for (const modality of RENDER_TILE_MODALITIES_V1) ok({ ...leaf(), recipe: { ...leaf().recipe, modality } });
  for (const unit of RENDER_TILE_APRON_UNITS_V1) ok({ ...leaf(), recipe: { ...leaf().recipe, apron: { size: 3, unit } } });
});

test('reader never throws and refuses non-objects', () => {
  for (const bad of [null, undefined, 'x', 1, 1n, true, [], () => {}, Symbol('s'), new Date(0)]) refuse(bad, 'RENDER_TILE_NOT_OBJECT', '$');
});

test('unknown and missing members, at every level, before any value check', () => {
  refuse({ ...leaf(), extra: 1 }, 'RENDER_TILE_UNKNOWN_MEMBER', '$.extra');
  refuse({ ...leaf(), extra: 1, schemaVersion: 'bad' }, 'RENDER_TILE_UNKNOWN_MEMBER', '$.extra');
  refuse({ ...leaf(), recipe: { ...leaf().recipe, extra: 1 } }, 'RENDER_TILE_UNKNOWN_MEMBER', '$.recipe.extra');
  refuse({ ...leaf(), recipe: { ...leaf().recipe, apron: { size: 0, unit: 'symbols', extra: 1 } } }, 'RENDER_TILE_UNKNOWN_MEMBER', '$.recipe.apron.extra');
  refuse({ ...leaf(), budget: { ...leaf().budget, extra: 1 } }, 'RENDER_TILE_UNKNOWN_MEMBER', '$.budget.extra');
  refuse(JSON.parse('{"__proto__":1}'), 'RENDER_TILE_UNKNOWN_MEMBER', '$.__proto__');
  const missing = leaf(); delete missing.attempt;
  refuse(missing, 'RENDER_TILE_MISSING_MEMBER', '$.attempt');
  const missingSeed = leaf(); delete missingSeed.recipe.seed;
  refuse(missingSeed, 'RENDER_TILE_MISSING_MEMBER', '$.recipe.seed');
  const missingUnit = leaf(); delete missingUnit.recipe.apron.unit;
  refuse(missingUnit, 'RENDER_TILE_MISSING_MEMBER', '$.recipe.apron.unit');
  const missingTokens = leaf(); delete missingTokens.budget.tokens;
  refuse(missingTokens, 'RENDER_TILE_MISSING_MEMBER', '$.budget.tokens');
});

test('scalar members', () => {
  refuse({ ...leaf(), schemaVersion: '1' }, 'RENDER_TILE_SCHEMA_VERSION', '$.schemaVersion');
  refuse({ ...leaf(), schemaVersion: 2 }, 'RENDER_TILE_SCHEMA_VERSION', '$.schemaVersion');
  refuse({ ...leaf(), profile: 'nisi-render-tile-v2' }, 'RENDER_TILE_PROFILE', '$.profile');
  for (const id of ['', '-a', '.a', 'a b', 'a'.repeat(129), 7, null]) refuse({ ...leaf(), tileId: id }, 'RENDER_TILE_ID', '$.tileId');
  ok({ ...leaf(), tileId: 'A1.b_c:d-e' });
  ok({ ...leaf(), tileId: 'a'.repeat(128) });
  refuse({ ...leaf(), kind: 'row' }, 'RENDER_TILE_KIND', '$.kind');
  for (const a of [-1, 1.5, '0', -0, null, 2 ** 53]) refuse({ ...leaf(), attempt: a }, 'RENDER_TILE_ATTEMPT', '$.attempt');
  ok({ ...leaf(), attempt: 2 ** 53 - 1 });
});

test('inputs', () => {
  refuse({ ...leaf(), inputs: [] }, 'RENDER_TILE_INPUTS', '$.inputs');
  refuse({ ...leaf(), inputs: null }, 'RENDER_TILE_INPUTS', '$.inputs');
  refuse({ ...leaf(), inputs: { 'bad name': D1 } }, 'RENDER_TILE_INPUTS', '$.inputs');
  refuse({ ...leaf(), inputs: JSON.parse(`{"__proto__":"${D1}"}`) }, 'RENDER_TILE_INPUTS', '$.inputs');
  const many = {}; for (let i = 0; i < 257; i++) many['k' + i] = D1;
  refuse({ ...leaf(), inputs: many }, 'RENDER_TILE_INPUTS', '$.inputs');
  delete many.k256; ok({ ...leaf(), inputs: many });
  refuse({ ...leaf(), inputs: { src: 'abc' } }, 'RENDER_TILE_DIGEST', '$.inputs.src');
  refuse({ ...leaf(), inputs: { src: 'A'.repeat(64) } }, 'RENDER_TILE_DIGEST', '$.inputs.src');
  ok({ ...leaf(), inputs: { src: 'a'.repeat(64) } });
  refuse({ ...leaf(), inputs: { src: null } }, 'RENDER_TILE_DIGEST', '$.inputs.src');
});

test('recipe', () => {
  const rec = (patch) => ({ ...leaf(), recipe: { ...leaf().recipe, ...patch } });
  refuse({ ...leaf(), recipe: null }, 'RENDER_TILE_RECIPE', '$.recipe');
  refuse({ ...leaf(), recipe: [] }, 'RENDER_TILE_RECIPE', '$.recipe');
  refuse(rec({ role: 'painter' }), 'RENDER_TILE_RECIPE', '$.recipe.role');
  refuse(rec({ role: 'assemble' }), 'RENDER_TILE_RECIPE', '$.recipe.role');
  refuse({ ...parent(), recipe: { ...parent().recipe, role: 'generator' } }, 'RENDER_TILE_RECIPE', '$.recipe.role');
  refuse(rec({ modality: 'audio' }), 'RENDER_TILE_RECIPE', '$.recipe.modality');
  refuse(rec({ model: '' }), 'RENDER_TILE_RECIPE', '$.recipe.model');
  refuse(rec({ model: 'm'.repeat(129) }), 'RENDER_TILE_RECIPE', '$.recipe.model');
  refuse(rec({ model: 7 }), 'RENDER_TILE_RECIPE', '$.recipe.model');
  ok(rec({ model: null }));
  refuse(rec({ seed: -1 }), 'RENDER_TILE_RECIPE', '$.recipe.seed');
  refuse(rec({ seed: 1.5 }), 'RENDER_TILE_RECIPE', '$.recipe.seed');
  refuse(rec({ seed: '1' }), 'RENDER_TILE_RECIPE', '$.recipe.seed');
  refuse(rec({ apron: null }), 'RENDER_TILE_RECIPE', '$.recipe.apron');
  refuse(rec({ apron: { size: -0, unit: 'symbols' } }), 'RENDER_TILE_RECIPE', '$.recipe.apron.size');
  refuse(rec({ apron: { size: 1.5, unit: 'symbols' } }), 'RENDER_TILE_RECIPE', '$.recipe.apron.size');
  refuse(rec({ apron: { size: 0, unit: 'cm' } }), 'RENDER_TILE_RECIPE', '$.recipe.apron.unit');
});

test('params must be a plain object of JSON values within the byte limit', () => {
  const rec = (params) => ({ ...leaf(), recipe: { ...leaf().recipe, params } });
  for (const bad of [null, [], 'x', 1, { a: undefined }, { a: NaN }, { a: Infinity }, { a: () => 1 }, { a: 1n }, { a: Symbol('s') }, { a: new Date(0) }, { a: [1, { b: undefined }] }, JSON.parse('{"__proto__":{}}'), { a: JSON.parse('{"constructor":1}') }])
    refuse(rec(bad), 'RENDER_TILE_PARAMS', '$.recipe.params');
  refuse(rec({ big: 'x'.repeat(65536) }), 'RENDER_TILE_PARAMS', '$.recipe.params');
  const cyc = { a: [] }; cyc.a.push(cyc);
  refuse(rec(cyc), 'RENDER_TILE_PARAMS', '$.recipe.params');
  const arr = []; arr.push(arr);
  refuse(rec({ a: arr }), 'RENDER_TILE_PARAMS', '$.recipe.params');
  const cyc2 = {}; cyc2.self = cyc2;
  refuse(rec({ deep: { cyc2 } }), 'RENDER_TILE_PARAMS', '$.recipe.params');
  ok(rec({ big: 'x'.repeat(65536 - '{"big":""}'.length) }));
  ok(rec({ a: [1, 2.5, -3, 'four', null, true, false, { five: [] }] }));
});

test('neighbours and children', () => {
  refuse({ ...leaf(), neighbours: 'b' }, 'RENDER_TILE_NEIGHBOURS', '$.neighbours');
  refuse({ ...leaf(), neighbours: null }, 'RENDER_TILE_NEIGHBOURS', '$.neighbours');
  refuse({ ...leaf(), neighbours: new Array(257).fill(0).map((_, i) => 'n' + i), apron: {} }, 'RENDER_TILE_NEIGHBOURS', '$.neighbours');
  refuse({ ...leaf(), neighbours: ['b', 7], apron: { b: null } }, 'RENDER_TILE_NEIGHBOURS', '$.neighbours[1]');
  refuse({ ...leaf(), neighbours: ['b', 'b'], apron: { b: null } }, 'RENDER_TILE_NEIGHBOURS', '$.neighbours[1]');
  refuse({ ...leaf(), neighbours: ['a'], apron: { a: null } }, 'RENDER_TILE_NEIGHBOURS', '$.neighbours[0]');
  refuse({ ...leaf(), children: 'b' }, 'RENDER_TILE_CHILDREN', '$.children');
  refuse({ ...leaf(), children: ['b'] }, 'RENDER_TILE_CHILDREN', '$.children');
  refuse({ ...parent(), children: [] }, 'RENDER_TILE_CHILDREN', '$.children');
  refuse({ ...parent(), children: ['a', ''] }, 'RENDER_TILE_CHILDREN', '$.children[1]');
  refuse({ ...parent(), children: ['a', 'a'] }, 'RENDER_TILE_CHILDREN', '$.children[1]');
  refuse({ ...parent(), children: ['a', 'p'] }, 'RENDER_TILE_CHILDREN', '$.children[1]');
  refuse({ ...parent(), neighbours: ['b'], apron: { b: null }, children: ['a', 'b'] }, 'RENDER_TILE_CHILDREN', '$.children[1]');
  refuse({ ...parent(), children: new Array(4097).fill(0).map((_, i) => 'c' + i) }, 'RENDER_TILE_CHILDREN', '$.children');
  ok({ ...parent(), children: new Array(4096).fill(0).map((_, i) => 'c' + i) });
});

test('budget', () => {
  const bud = (patch) => ({ ...leaf(), budget: { ...leaf().budget, ...patch } });
  refuse({ ...leaf(), budget: null }, 'RENDER_TILE_BUDGET', '$.budget');
  refuse({ ...leaf(), budget: [] }, 'RENDER_TILE_BUDGET', '$.budget');
  refuse(bud({ wallMs: 0 }), 'RENDER_TILE_BUDGET', '$.budget.wallMs');
  refuse(bud({ wallMs: null }), 'RENDER_TILE_BUDGET', '$.budget.wallMs');
  refuse(bud({ tokens: -1 }), 'RENDER_TILE_BUDGET', '$.budget.tokens');
  refuse(bud({ memoryBytes: 'x' }), 'RENDER_TILE_BUDGET', '$.budget.memoryBytes');
  ok(bud({ wallMs: 1, tokens: 0, memoryBytes: 0 }));
});

test('apron keys must equal the neighbour set and values must be digests or null', () => {
  refuse({ ...leaf(), apron: [] }, 'RENDER_TILE_APRON', '$.apron');
  refuse({ ...leaf(), apron: null }, 'RENDER_TILE_APRON', '$.apron');
  refuse({ ...leaf(), apron: { b: null } }, 'RENDER_TILE_APRON', '$.apron');
  refuse({ ...withNeighbour(), apron: {} }, 'RENDER_TILE_APRON', '$.apron');
  refuse({ ...withNeighbour(), apron: { b: D2, c: null } }, 'RENDER_TILE_APRON', '$.apron');
  refuse({ ...withNeighbour(), apron: { b: 'zz' } }, 'RENDER_TILE_DIGEST', '$.apron.b');
  refuse({ ...withNeighbour(), apron: { b: undefined } }, 'RENDER_TILE_DIGEST', '$.apron.b');
  ok({ ...withNeighbour(), apron: { b: null } });
});

test('identity is pinned to the reference vectors and ignores naming and budget', () => {
  assert.equal(identityRenderTileV1(leaf()), '34ace3a958e0ed7f4946d4a13742efe8b7803bbf9b6daadd47fec0c0ecdedc0e');
  assert.equal(identityRenderTileV1(withNeighbour()), 'bfecd07b7e9918c8b6821da394d30870290f2c2e5dd936e9b28c791d030fdf9b');
  assert.equal(identityRenderTileV1(parent(), [D1, null]), '8c893f15a7e226d55632262535d26aa9f3b45a9386bb7b7da2b577a84e474e8e');
  assert.equal(identityRenderTileV1({ ...leaf(), tileId: 'zzz', budget: { wallMs: 5, tokens: 9, memoryBytes: 9 } }), identityRenderTileV1(leaf()));
  assert.equal(identityRenderTileV1(readRenderTileV1(leaf()).tile), identityRenderTileV1(leaf()));
  assert.notEqual(identityRenderTileV1({ ...leaf(), attempt: 1 }), identityRenderTileV1(leaf()));
  assert.notEqual(identityRenderTileV1({ ...withNeighbour(), apron: { b: null } }), identityRenderTileV1(withNeighbour()));
  assert.notEqual(identityRenderTileV1(parent(), [D1, D2]), identityRenderTileV1(parent(), [D1, null]));
  assert.notEqual(identityRenderTileV1({ ...leaf(), recipe: { ...leaf().recipe, seed: 2 } }), identityRenderTileV1(leaf()));
  assert.match(identityRenderTileV1(leaf()), /^[0-9a-f]{64}$/);
});

test('identity refuses what the reader refuses, and bad child outputs', () => {
  assert.throws(() => identityRenderTileV1({ ...leaf(), kind: 'row' }), (e) => e instanceof Error && e.code === 'RENDER_TILE_KIND');
  assert.throws(() => identityRenderTileV1(null), (e) => e.code === 'RENDER_TILE_NOT_OBJECT');
  for (const bad of [undefined, null, 'x', [D1], [D1, 'zz'], [D1, null, null], [D1, 5]])
    assert.throws(() => identityRenderTileV1(parent(), bad), (e) => e.code === 'RENDER_TILE_CHILD_OUTPUTS', JSON.stringify(bad));
  assert.throws(() => identityRenderTileV1(leaf(), [D1]), (e) => e.code === 'RENDER_TILE_CHILD_OUTPUTS');
  assert.equal(identityRenderTileV1(leaf(), []), identityRenderTileV1(leaf()));
});
