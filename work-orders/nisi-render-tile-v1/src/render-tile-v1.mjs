import { canonicalizeJSONV1 } from '../../../canonical/canonical-json-v1.mjs';

// PURE-REGION-BEGIN
const RENDER_TILE_PROFILE_V1 = 'nisi-render-tile-v1';
const RENDER_TILE_LIMITS_V1 = Object.freeze({ inputs: 256, neighbours: 256, children: 4096, idLength: 128, modelLength: 128, paramsBytes: 65536, paramsDepth: 120, paramsMembers: 4096 });
const RENDER_TILE_ROLES_V1 = Object.freeze(['generator', 'denoiser', 'reconciler', 'checker', 'assemble']);
const RENDER_TILE_MODALITIES_V1 = Object.freeze(['code', 'image', 'text']);
const RENDER_TILE_APRON_UNITS_V1 = Object.freeze(['symbols', 'pixels', 'chars']);
const RENDER_TILE_VERDICTS_V1 = Object.freeze(['PASS', 'VALIDITY_FAIL', 'QUALITY_FAIL', 'APRON_STALE', 'REPLAY']);
const RENDER_TILE_CODES_V1 = Object.freeze([
  'RENDER_TILE_NOT_OBJECT', 'RENDER_TILE_UNKNOWN_MEMBER', 'RENDER_TILE_MISSING_MEMBER', 'RENDER_TILE_SCHEMA_VERSION',
  'RENDER_TILE_PROFILE', 'RENDER_TILE_ID', 'RENDER_TILE_KIND', 'RENDER_TILE_INPUTS', 'RENDER_TILE_DIGEST',
  'RENDER_TILE_RECIPE', 'RENDER_TILE_PARAMS', 'RENDER_TILE_NEIGHBOURS', 'RENDER_TILE_CHILDREN', 'RENDER_TILE_ATTEMPT',
  'RENDER_TILE_BUDGET', 'RENDER_TILE_APRON', 'RENDER_TILE_CHILD_OUTPUTS',
]);

const ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256_REGEX = /^[0-9a-f]{64}$/;
const BAD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const NUL = String.fromCharCode(0);
const SNAPSHOT_MAX_DEPTH = 160;
const SNAPSHOT_MAX_NODES = 200000;
const SNAPSHOT_MAX_PAYLOAD = 8000000; // string characters (keys and values) plus array elements, counted per copy
const SNAPSHOT_MAX_KEY = 4096;
const ROOT_KEYS = ['schemaVersion', 'profile', 'tileId', 'kind', 'inputs', 'recipe', 'neighbours', 'children', 'attempt', 'budget', 'apron'];
const RECIPE_KEYS = ['role', 'modality', 'model', 'seed', 'params', 'apron'];
const RECIPE_APRON_KEYS = ['size', 'unit'];
const BUDGET_KEYS = ['wallMs', 'tokens', 'memoryBytes'];

class SnapshotRefused extends Error {}

function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function plain(x) {
  if (typeof x !== 'object' || x === null) return false;
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}
function isId(s) { return typeof s === 'string' && ID_REGEX.test(s); }
function isDigest(s) { return typeof s === 'string' && SHA256_REGEX.test(s); }
function isInt(n) { return Number.isSafeInteger(n) && n >= 0 && !Object.is(n, -0); }
function isWellFormed(s) { return typeof s === 'string' && s.isWellFormed(); }
function isModel(s) { return isWellFormed(s) && s.length > 0 && s.length <= RENDER_TILE_LIMITS_V1.modelLength; }
function refusal(code, path) { return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code, path }); }

// One descriptor walk over the input before any validation: only own, enumerable, string-keyed data
// properties; plain objects and Array.prototype arrays with no own keys beyond their indices and length.
// A cycle is refused through the path stack; shared (non-cyclic) sub-objects are copied again, and the
// node budget bounds that expansion. Anything that throws inside the walk refuses the whole input.
function snapshot(x, depth, stack, counter) {
  if (typeof x === 'string') {
    if ((counter.payload += x.length) > SNAPSHOT_MAX_PAYLOAD) throw new SnapshotRefused();
    return x;
  }
  if (x === null || typeof x !== 'object') return x;
  if (depth > SNAPSHOT_MAX_DEPTH || stack.has(x)) throw new SnapshotRefused();
  if (++counter.nodes > SNAPSHOT_MAX_NODES) throw new SnapshotRefused();
  stack.add(x);
  let out;
  if (Array.isArray(x)) {
    if (Object.getPrototypeOf(x) !== Array.prototype) throw new SnapshotRefused();
    const length = x.length;
    if (!Number.isSafeInteger(length) || length < 0 || Reflect.ownKeys(x).length !== length + 1) throw new SnapshotRefused();
    if ((counter.payload += length) > SNAPSHOT_MAX_PAYLOAD) throw new SnapshotRefused();
    out = [];
    for (let i = 0; i < length; i++) {
      const d = Object.getOwnPropertyDescriptor(x, String(i));
      if (d === undefined || !own(d, 'value') || !d.enumerable) throw new SnapshotRefused();
      out.push(snapshot(d.value, depth + 1, stack, counter));
    }
  } else {
    if (!plain(x)) throw new SnapshotRefused();
    out = {};
    for (const k of Reflect.ownKeys(x)) {
      if (typeof k !== 'string' || k.length > SNAPSHOT_MAX_KEY) throw new SnapshotRefused();
      if ((counter.payload += k.length) > SNAPSHOT_MAX_PAYLOAD) throw new SnapshotRefused();
      const d = Object.getOwnPropertyDescriptor(x, k);
      if (!own(d, 'value') || !d.enumerable) throw new SnapshotRefused();
      Object.defineProperty(out, k, { value: snapshot(d.value, depth + 1, stack, counter), enumerable: true, writable: true, configurable: true });
    }
  }
  stack.delete(x);
  return out;
}

function unknownOrMissing(obj, keys, path, unknownCode, missingCode) {
  for (const k of Object.keys(obj)) if (!keys.includes(k)) return refusal(unknownCode, `${path}.${k}`);
  for (const k of keys) if (!own(obj, k)) return refusal(missingCode, `${path}.${k}`);
  return null;
}

// params must sit inside the canonical-json-v1 grammar: safe-integer numbers, well-formed strings,
// NFC NUL-free string keys that are not the three reserved names, bounded depth and member count.
// bytes is a running lower bound on the serialised size; once it passes paramsBytes nothing more is scanned,
// so no O(n) operation (isWellFormed, normalize, JSON.stringify) ever runs on an unbounded string
function paramsValid(v, depth, bytes) {
  const spend = (n) => { bytes.n += n; return bytes.n <= RENDER_TILE_LIMITS_V1.paramsBytes; };
  if (v === null) return spend(4);
  if (typeof v === 'boolean') return spend(v ? 4 : 5);
  if (typeof v === 'number') return Number.isSafeInteger(v) && !Object.is(v, -0) && spend(String(v).length);
  if (typeof v === 'string') return spend(v.length + 2) && v.isWellFormed();
  if (typeof v !== 'object') return false;
  if (depth > RENDER_TILE_LIMITS_V1.paramsDepth) return false;
  if (Array.isArray(v)) {
    if (!spend(2)) return false;
    for (let i = 0; i < v.length; i++) if (!spend(i > 0 ? 1 : 0) || !paramsValid(v[i], depth + 1, bytes)) return false;
    return true;
  }
  const keys = Object.keys(v);
  if (keys.length > RENDER_TILE_LIMITS_V1.paramsMembers || !spend(2)) return false;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (!spend(k.length + 3 + (i > 0 ? 1 : 0))) return false;
    if (BAD_KEYS.has(k) || !k.isWellFormed() || k.includes(NUL) || k.normalize('NFC') !== k) return false;
    if (!paramsValid(v[k], depth + 1, bytes)) return false;
  }
  return true;
}

function deepFreeze(o) {
  if (o === null || typeof o !== 'object' || Object.isFrozen(o)) return o;
  Object.freeze(o);
  for (const k of Object.getOwnPropertyNames(o)) deepFreeze(o[k]);
  return o;
}

function readRenderTileV1(original) {
  const limits = RENDER_TILE_LIMITS_V1;
  let input;
  try {
    input = snapshot(original, 0, new Set(), { nodes: 0, payload: 0 });
  } catch (e) {
    return refusal('RENDER_TILE_NOT_OBJECT', '$');
  }
  if (!plain(input)) return refusal('RENDER_TILE_NOT_OBJECT', '$');

  const rootProblem = unknownOrMissing(input, ROOT_KEYS, '$', 'RENDER_TILE_UNKNOWN_MEMBER', 'RENDER_TILE_MISSING_MEMBER');
  if (rootProblem) return rootProblem;

  if (input.schemaVersion !== 1) return refusal('RENDER_TILE_SCHEMA_VERSION', '$.schemaVersion');
  if (input.profile !== RENDER_TILE_PROFILE_V1) return refusal('RENDER_TILE_PROFILE', '$.profile');
  if (!isId(input.tileId)) return refusal('RENDER_TILE_ID', '$.tileId');
  if (input.kind !== 'leaf' && input.kind !== 'parent') return refusal('RENDER_TILE_KIND', '$.kind');

  // inputs: a bad name wins over a bad value on an entry
  if (!plain(input.inputs)) return refusal('RENDER_TILE_INPUTS', '$.inputs');
  const inputNames = Object.keys(input.inputs);
  if (inputNames.length > limits.inputs) return refusal('RENDER_TILE_INPUTS', '$.inputs');
  for (const k of inputNames) {
    if (!isId(k) || BAD_KEYS.has(k)) return refusal('RENDER_TILE_INPUTS', '$.inputs');
    if (!isDigest(input.inputs[k])) return refusal('RENDER_TILE_DIGEST', `$.inputs.${k}`);
  }

  // recipe
  if (!plain(input.recipe)) return refusal('RENDER_TILE_RECIPE', '$.recipe');
  const recipeProblem = unknownOrMissing(input.recipe, RECIPE_KEYS, '$.recipe', 'RENDER_TILE_UNKNOWN_MEMBER', 'RENDER_TILE_MISSING_MEMBER');
  if (recipeProblem) return recipeProblem;
  const recipe = input.recipe;
  if (!RENDER_TILE_ROLES_V1.includes(recipe.role)) return refusal('RENDER_TILE_RECIPE', '$.recipe.role');
  if ((input.kind === 'parent') !== (recipe.role === 'assemble')) return refusal('RENDER_TILE_RECIPE', '$.recipe.role');
  if (!RENDER_TILE_MODALITIES_V1.includes(recipe.modality)) return refusal('RENDER_TILE_RECIPE', '$.recipe.modality');
  if (recipe.model !== null && !isModel(recipe.model)) return refusal('RENDER_TILE_RECIPE', '$.recipe.model');
  if (recipe.seed !== null && !isInt(recipe.seed)) return refusal('RENDER_TILE_RECIPE', '$.recipe.seed');
  if (!plain(recipe.params) || !paramsValid(recipe.params, 1, { n: 0 })) return refusal('RENDER_TILE_PARAMS', '$.recipe.params');
  // the snapshot is fresh plain data with no toJSON hooks and the running estimate has bounded it, so this exact
  // measurement serialises at most a few multiples of paramsBytes and cannot hit the engine's string limit
  if (Buffer.byteLength(JSON.stringify(recipe.params), 'utf8') > limits.paramsBytes) return refusal('RENDER_TILE_PARAMS', '$.recipe.params');
  if (!plain(recipe.apron)) return refusal('RENDER_TILE_RECIPE', '$.recipe.apron');
  const apronProblem = unknownOrMissing(recipe.apron, RECIPE_APRON_KEYS, '$.recipe.apron', 'RENDER_TILE_UNKNOWN_MEMBER', 'RENDER_TILE_MISSING_MEMBER');
  if (apronProblem) return apronProblem;
  if (!isInt(recipe.apron.size)) return refusal('RENDER_TILE_RECIPE', '$.recipe.apron.size');
  if (!RENDER_TILE_APRON_UNITS_V1.includes(recipe.apron.unit)) return refusal('RENDER_TILE_RECIPE', '$.recipe.apron.unit');

  // neighbours
  if (!Array.isArray(input.neighbours)) return refusal('RENDER_TILE_NEIGHBOURS', '$.neighbours');
  if (input.neighbours.length > limits.neighbours) return refusal('RENDER_TILE_NEIGHBOURS', '$.neighbours');
  const neighbours = [];
  const neighbourSet = new Set();
  for (let i = 0; i < input.neighbours.length; i++) {
    const n = input.neighbours[i];
    if (!isId(n) || n === input.tileId || neighbourSet.has(n)) return refusal('RENDER_TILE_NEIGHBOURS', `$.neighbours[${i}]`);
    neighbourSet.add(n);
    neighbours.push(n);
  }

  // children
  if (!Array.isArray(input.children)) return refusal('RENDER_TILE_CHILDREN', '$.children');
  if (input.children.length > limits.children) return refusal('RENDER_TILE_CHILDREN', '$.children');
  if ((input.kind === 'leaf') !== (input.children.length === 0)) return refusal('RENDER_TILE_CHILDREN', '$.children');
  const children = [];
  const childSet = new Set();
  for (let i = 0; i < input.children.length; i++) {
    const c = input.children[i];
    if (!isId(c) || c === input.tileId || childSet.has(c) || neighbourSet.has(c)) return refusal('RENDER_TILE_CHILDREN', `$.children[${i}]`);
    childSet.add(c);
    children.push(c);
  }

  if (!isInt(input.attempt)) return refusal('RENDER_TILE_ATTEMPT', '$.attempt');

  // budget
  if (!plain(input.budget)) return refusal('RENDER_TILE_BUDGET', '$.budget');
  const budgetProblem = unknownOrMissing(input.budget, BUDGET_KEYS, '$.budget', 'RENDER_TILE_UNKNOWN_MEMBER', 'RENDER_TILE_MISSING_MEMBER');
  if (budgetProblem) return budgetProblem;
  const budget = input.budget;
  if (!isInt(budget.wallMs) || budget.wallMs < 1) return refusal('RENDER_TILE_BUDGET', '$.budget.wallMs');
  if (budget.tokens !== null && !isInt(budget.tokens)) return refusal('RENDER_TILE_BUDGET', '$.budget.tokens');
  if (budget.memoryBytes !== null && !isInt(budget.memoryBytes)) return refusal('RENDER_TILE_BUDGET', '$.budget.memoryBytes');

  // apron: key set equals the neighbour set; values digests or null
  if (!plain(input.apron)) return refusal('RENDER_TILE_APRON', '$.apron');
  const apronKeys = Object.keys(input.apron);
  if (apronKeys.length !== neighbourSet.size) return refusal('RENDER_TILE_APRON', '$.apron');
  for (const k of apronKeys) {
    if (!neighbourSet.has(k) || BAD_KEYS.has(k)) return refusal('RENDER_TILE_APRON', '$.apron');
    const v = input.apron[k];
    if (v !== null && !isDigest(v)) return refusal('RENDER_TILE_DIGEST', `$.apron.${k}`);
  }

  // output: ordered, fresh, deep-frozen; inputs and apron in sorted key order (integer-like keys still
  // enumerate first in JavaScript; the canonical codec re-sorts by key bytes for the identity)
  const inputs = {};
  for (const k of inputNames.slice().sort()) Object.defineProperty(inputs, k, { value: input.inputs[k], enumerable: true, writable: true, configurable: true });
  const apron = {};
  for (const k of apronKeys.slice().sort()) Object.defineProperty(apron, k, { value: input.apron[k], enumerable: true, writable: true, configurable: true });
  const tile = {
    schemaVersion: 1,
    profile: RENDER_TILE_PROFILE_V1,
    tileId: input.tileId,
    kind: input.kind,
    inputs,
    recipe: { role: recipe.role, modality: recipe.modality, model: recipe.model, seed: recipe.seed, params: recipe.params, apron: { size: recipe.apron.size, unit: recipe.apron.unit } },
    neighbours,
    children,
    attempt: input.attempt,
    budget: { wallMs: budget.wallMs, tokens: budget.tokens, memoryBytes: budget.memoryBytes },
    apron,
  };
  return Object.freeze({ ok: true, profile: RENDER_TILE_PROFILE_V1, tile: deepFreeze(tile) });
}

function identityRenderTileV1(tile, childOutputs = []) {
  const read = readRenderTileV1(tile);
  if (!read.ok) { const e = new Error(read.code); e.code = read.code; throw e; }
  const bad = () => { const e = new Error('RENDER_TILE_CHILD_OUTPUTS'); e.code = 'RENDER_TILE_CHILD_OUTPUTS'; throw e; };
  let outputs;
  try {
    outputs = snapshot(childOutputs, 0, new Set(), { nodes: 0, payload: 0 });
  } catch (e) {
    bad();
  }
  if (!Array.isArray(outputs) || outputs.length !== read.tile.children.length) bad();
  const children = [];
  for (let i = 0; i < outputs.length; i++) {
    const c = outputs[i];
    if (c !== null && !isDigest(c)) bad();
    children.push(c);
  }
  const identityObject = { apron: read.tile.apron, children, inputs: read.tile.inputs, recipe: read.tile.recipe };
  return canonicalizeJSONV1(Buffer.from(JSON.stringify(identityObject))).sha256;
}
// PURE-REGION-END

export {
  RENDER_TILE_PROFILE_V1, RENDER_TILE_LIMITS_V1, RENDER_TILE_ROLES_V1, RENDER_TILE_MODALITIES_V1,
  RENDER_TILE_APRON_UNITS_V1, RENDER_TILE_VERDICTS_V1, RENDER_TILE_CODES_V1, readRenderTileV1, identityRenderTileV1,
};
