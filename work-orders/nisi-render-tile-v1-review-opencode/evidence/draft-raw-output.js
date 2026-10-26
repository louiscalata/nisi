```js
import { createHash } from 'node:crypto';
import { canonicalizeJSONV1 } from '../../../canonical/canonical-json-v1.mjs';

// PURE-REGION-BEGIN
const RENDER_TILE_PROFILE_V1 = 'nisi-render-tile-v1';
const RENDER_TILE_LIMITS_V1 = Object.freeze({ inputs: 256, neighbours: 256, children: 4096, idLength: 128, modelLength: 128, paramsBytes: 65536 });
const RENDER_TILE_ROLES_V1 = Object.freeze(['generator','denoiser','reconciler','checker','assemble']);
const RENDER_TILE_MODALITIES_V1 = Object.freeze(['code','image','text']);
const RENDER_TILE_APRON_UNITS_V1 = Object.freeze(['symbols','pixels','chars']);
const RENDER_TILE_VERDICTS_V1 = Object.freeze(['PASS','VALIDITY_FAIL','QUALITY_FAIL','APRON_STALE','REPLAY']);
const RENDER_TILE_CODES_V1 = Object.freeze([
  'RENDER_TILE_NOT_OBJECT',
  'RENDER_TILE_UNKNOWN_MEMBER',
  'RENDER_TILE_MISSING_MEMBER',
  'RENDER_TILE_SCHEMA_VERSION',
  'RENDER_TILE_PROFILE',
  'RENDER_TILE_ID',
  'RENDER_TILE_KIND',
  'RENDER_TILE_INPUTS',
  'RENDER_TILE_DIGEST',
  'RENDER_TILE_RECIPE',
  'RENDER_TILE_PARAMS',
  'RENDER_TILE_NEIGHBOURS',
  'RENDER_TILE_CHILDREN',
  'RENDER_TILE_ATTEMPT',
  'RENDER_TILE_BUDGET',
  'RENDER_TILE_APRON',
  'RENDER_TILE_CHILD_OUTPUTS'
]);

const ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256_REGEX = /^[0-9a-f]{64}$/;

function own(o, k) {
  return Object.prototype.hasOwnProperty.call(o, k);
}

function plain(x) {
  if (x === null || typeof x !== 'object') return false;
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}

function isId(s) {
  return typeof s === 'string' && ID_REGEX.test(s);
}

function isDigest(s) {
  return typeof s === 'string' && SHA256_REGEX.test(s);
}

function isInt(n) {
  return Number.isSafeInteger(n) && n >= 0 && !Object.is(n, -0);
}

function deepFreeze(o) {
  if (plain(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) {
      deepFreeze(o[k]);
    }
  } else if (Array.isArray(o)) {
    Object.freeze(o);
    for (const v of o) {
      deepFreeze(v);
    }
  }
  return o;
}

function deepCopy(o) {
  if (plain(o)) {
    const copy = {};
    for (const k of Object.keys(o)) {
      copy[k] = deepCopy(o[k]);
    }
    return copy;
  } else if (Array.isArray(o)) {
    return o.map(deepCopy);
  } else {
    return o;
  }
}

function validateJSONValue(v) {
  if (v === null) return true;
  if (typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string') return true;
  if (Array.isArray(v)) {
    for (const e of v) {
      if (!validateJSONValue(e)) return false;
    }
    return true;
  }
  if (plain(v)) {
    for (const k of Object.keys(v)) {
      if (k === '__proto__' || k === 'prototype' || k === 'constructor') return false;
      if (!validateJSONValue(v[k])) return false;
    }
    return true;
  }
  return false;
}

function readRenderTileV1(input) {
  const limits = RENDER_TILE_LIMITS_V1;
  const roles = RENDER_TILE_ROLES_V1;
  const modalities = RENDER_TILE_MODALITIES_V1;
  const apronUnits = RENDER_TILE_APRON_UNITS_V1;

  // Check root is plain object
  if (!plain(input)) {
    return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_NOT_OBJECT', path: '$' });
  }

  // Known members set
  const knownRootKeys = new Set(['schemaVersion','profile','tileId','kind','inputs','recipe','neighbours','children','attempt','budget','apron']);
  for (const k of Object.keys(input)) {
    if (!knownRootKeys.has(k)) {
      return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_UNKNOWN_MEMBER', path: '$.' + k });
    }
  }

  // Required members
  const requiredRoot = ['schemaVersion','profile','tileId','kind','inputs','recipe','neighbours','children','attempt','budget','apron'];
  for (const k of requiredRoot) {
    if (!own(input, k)) {
      return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_MISSING_MEMBER', path: '$.' + k });
    }
  }

  // schemaVersion
  if (input.schemaVersion !== 1) {
    return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_SCHEMA_VERSION', path: '$.schemaVersion' });
  }

  // profile
  if (input.profile !== RENDER_TILE_PROFILE_V1) {
    return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_PROFILE', path: '$.profile' });
  }

  // tileId
  if (!isId(input.tileId)) {
    return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_ID', path: '$.tileId' });
  }

  // kind
  if (input.kind !== 'leaf' && input.kind !== 'parent') {
    return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_KIND', path: '$.kind' });
  }

  // inputs
  if (!plain(input.inputs)) {
    return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_INPUTS', path: '$.inputs' });
  }
  if (Object.keys(input.inputs).length > limits.inputs) {
    return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_INPUTS', path: '$.inputs' });
  }
  for (const k of Object.keys(input.inputs)) {
    if (!isId(k)) {
      return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_INPUTS', path: '$.inputs' });
    }
    if (!isDigest(input.inputs[k])) {
      return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_DIGEST', path: '$.inputs.' + k });
    }
  }

  // recipe
  if (!plain(input.recipe)) {
    return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_RECIPE', path: '$.recipe' });
  }

  const recipeKeys = ['role','modality','model','seed','params','apron'];
  for (const k of Object.keys(input.recipe)) {
    if (!recipeKeys.includes(k)) {
      return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_UNKNOWN_MEMBER', path: '$.recipe.' + k });
    }
  }
  for (const k of recipeKeys) {
    if (!own(input.recipe, k)) {
      return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_MISSING_MEMBER', path: '$.recipe.' + k });
    }
  }

  // recipe.role
  if (!roles.includes(input.recipe.role)) {
    return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_RECIPE', path: '$.recipe.role' });
  }
  // role–kind mismatch
  if (input.kind === 'parent' && input.recipe.role !== 'assemble') {
    return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_RECIPE', path: '$.recipe.role' });
  }
  if (input.kind === 'leaf' && input.recipe.role === 'assemble') {
    return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_RECIPE', path: '$.recipe.role' });
  }

  // recipe.modality
  if (!modalities.includes(input.recipe.modality)) {
    return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_RECIPE', path: '$.recipe.modality' });
  }

  // recipe.model
  if (input.recipe.model !== null) {
    if (typeof input.recipe.model !== 'string' || input.recipe.model.length === 0 || input.recipe.model.length > limits.modelLength) {
      return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_RECIPE', path: '$.recipe.model' });
    }
  }

  // recipe.seed
  if (input.recipe.seed !== null && !isInt(input.recipe.seed)) {
    return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_RECIPE', path: '$.recipe.seed' });
  }

  // recipe.params
  if (!plain(input.recipe.params)) {
    return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_PARAMS', path: '$.recipe.params' });
  }
  // Check for forbidden keys
  function hasForbiddenKeys(o) {
    if (plain(o)) {
      for (const k of Object.keys(o)) {
        if (k === '__proto__' || k === 'prototype' || k === 'constructor') return true;
        if (hasForbiddenKeys(o[k])) return true;
      }
    } else if (Array.isArray(o)) {
      for (const e of o) {
        if (hasForbiddenKeys(e)) return true;
      }
    }
    return false;
  }
  if (hasForbiddenKeys(input.recipe.params)) {
    return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_PARAMS', path: '$.recipe.params' });
  }
  // Validate JSON values
  if (!validateJSONValue(input.recipe.params)) {
    return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_PARAMS', path: '$.recipe.params' });
  }
  // Check byte length
  const paramsBytes = Buffer.byteLength(JSON.stringify(input.recipe.params), 'utf8');
  if (paramsBytes > limits.paramsBytes) {
    return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_PARAMS', path: '$.recipe.params' });
  }

  // recipe.apron
  if (!plain(input.recipe.apron)) {
    return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_RECIPE', path: '$.recipe.apron' });
  }
  const apronKeys = ['size','unit'];
  for (const k of Object.keys(input.recipe.apron)) {
    if (!apronKeys.includes(k)) {
      return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_UNKNOWN_MEMBER', path: '$.recipe.apron.' + k });
    }
  }
  for (const k of apronKeys) {
    if (!own(input.recipe.apron, k)) {
      return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_MISSING_MEMBER', path: '$.recipe.apron.' + k });
    }
  }
  if (!isInt(input.recipe.apron.size)) {
    return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_RECIPE', path: '$.recipe.apron.size' });
  }
  if (!apronUnits.includes(input.recipe.apron.unit)) {
    return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_RECIPE', path: '$.recipe.apron.unit' });
  }

  // neighbours
  if (!Array.isArray(input.neighbours)) {
    return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_NEIGHBOURS', path: '$.neighbours' });
  }
  if (input.neighbours.length > limits.neighbours) {
    return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_NEIGHBOURS', path: '$.neighbours' });
  }
  const seenNeighbours = new Set();
  for (let i = 0; i < input.neighbours.length; i++) {
    const n = input.neighbours[i];
    if (!isId(n)) {
      return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_NEIGHBOURS', path: '$.neighbours[' + i + ']' });
    }
    if (n === input.tileId) {
      return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_NEIGHBOURS', path: '$.neighbours[' + i + ']' });
    }
    if (seenNeighbours.has(n)) {
      return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_NEIGHBOURS', path: '$.neighbours[' + i + ']' });
    }
    seenNeighbours.add(n);
  }

  // children
  if (!Array.isArray(input.children)) {
    return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_CHILDREN', path: '$.children' });
  }
  if (input.children.length > limits.children) {
    return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_CHILDREN', path: '$.children' });
  }
  if (input.kind === 'leaf' && input.children.length !== 0) {
    return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_CHILDREN', path: '$.children' });
  }
  if (input.kind === 'parent' && input.children.length === 0) {
    return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_CHILDREN', path: '$.children' });
  }
  const seenChildren = new Set();
  for (let i = 0; i < input.children.length; i++) {
    const c = input.children[i];
    if (!isId(c)) {
      return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_CHILDREN', path: '$.children[' + i + ']' });
    }
    if (c === input.tileId) {
      return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_CHILDREN', path: '$.children[' + i + ']' });
    }
    if (seenChildren.has(c)) {
      return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_CHILDREN', path: '$.children[' + i + ']' });
    }
    if (seenNeighbours.has(c)) {
      return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_CHILDREN', path: '$.children[' + i + ']' });
    }
    seenChildren.add(c);
  }

  // attempt
  if (!isInt(input.attempt)) {
    return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_ATTEMPT', path: '$.attempt' });
  }

  // budget
  if (!plain(input.budget)) {
    return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_BUDGET', path: '$.budget' });
  }
  const budgetKeys = ['wallMs','tokens','memoryBytes'];
  for (const k of Object.keys(input.budget)) {
    if (!budgetKeys.includes(k)) {
      return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_UNKNOWN_MEMBER', path: '$.budget.' + k });
    }
  }
  for (const k of budgetKeys) {
    if (!own(input.budget, k)) {
      return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_MISSING_MEMBER', path: '$.budget.' + k });
    }
  }
  if (!isInt(input.budget.wallMs) || input.budget.wallMs < 1) {
    return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_BUDGET', path: '$.budget.wallMs' });
  }
  if (input.budget.tokens !== null && !isInt(input.budget.tokens)) {
    return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_BUDGET', path: '$.budget.tokens' });
  }
  if (input.budget.memoryBytes !== null && !isInt(input.budget.memoryBytes)) {
    return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_BUDGET', path: '$.budget.memoryBytes' });
  }

  // apron
  if (!plain(input.apron)) {
    return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_APRON', path: '$.apron' });
  }
  const apronKeysSet = new Set(Object.keys(input.apron));
  const neighboursSet = new Set(input.neighbours);
  if (apronKeysSet.size !== neighboursSet.size) {
    return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_APRON', path: '$.apron' });
  }
  for (const k of neighboursSet) {
    if (!apronKeysSet.has(k)) {
      return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_APRON', path: '$.apron' });
    }
  }
  for (const k of apronKeysSet) {
    if (!neighboursSet.has(k)) {
      return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_APRON', path: '$.apron' });
    }
    if (input.apron[k] !== null && !isDigest(input.apron[k])) {
      return Object.freeze({ ok: false, profile: RENDER_TILE_PROFILE_V1, code: 'RENDER_TILE_DIGEST', path: '$.apron.' + k });
    }
  }

  // Build output tile
  const tile = {};
  tile.schemaVersion = 1;
  tile.profile = RENDER_TILE_PROFILE_V1;
  tile.tileId = input.tileId;
  tile.kind = input.kind;

  // inputs: sorted by key
  const inputs = {};
  for (const k of Object.keys(input.inputs).sort()) {
    inputs[k] = input.inputs[k];
  }
  tile.inputs = inputs;

  // recipe: in order
  const recipe = {};
  recipe.role = input.recipe.role;
  recipe.modality = input.recipe.modality;
  recipe.model = input.recipe.model;
  recipe.seed = input.recipe.seed;
  recipe.params = deepCopy(input.recipe.params);
  recipe.apron = { size: input.recipe.apron.size, unit: input.recipe.apron.unit };
  tile.recipe = recipe;

  // neighbours: already sorted by iteration order (we built from array in order)
  tile.neighbours = input.neighbours.slice();

  // children: sort
  tile.children = input.children.slice().sort();

  // attempt
  tile.attempt = input.attempt;

  // budget
  tile.budget = { wallMs: input.budget.wallMs, tokens: input.budget.tokens, memoryBytes: input.budget.memoryBytes };

  // apron: sorted by key
  const apron = {};
  for (const k of Object.keys(input.apron).sort()) {
    apron[k] = input.apron[k];
  }
  tile.apron = apron;

  return Object.freeze({ ok: true, profile: RENDER_TILE_PROFILE_V1, tile: deepFreeze(tile) });
}

function identityRenderTileV1(tile, childOutputs = []) {
  // First validate tile
  const read = readRenderTileV1(tile);
  if (!read.ok) {
    const err = new Error();
    err.code = read.code;
    throw err;
  }

  // Validate childOutputs
  if (!Array.isArray(childOutputs)) {
    const err = new Error();
    err.code = 'RENDER_TILE_CHILD_OUTPUTS';
    throw err;
  }
  if (childOutputs.length !== read.tile.children.length) {
    const err = new Error();
    err.code = 'RENDER_TILE_CHILD_OUTPUTS';
    throw err;
  }
  for (const c of childOutputs) {
    if (c !== null && !isDigest(c)) {
      const err = new Error();
      err.code = 'RENDER_TILE_CHILD_OUTPUTS';
      throw err;
    }
  }

  // Build identity object
  const identityObj = {
    apron: read.tile.apron,
    attempt: read.tile.attempt,
    children: childOutputs,
    inputs: read.tile.inputs,
    recipe: read.tile.recipe
  };

  // Canonicalize and return SHA256
  const jsonBytes = Buffer.from(JSON.stringify(identityObj));
  const { sha256 } = canonicalizeJSONV1(jsonBytes);
  return sha256;
}

export {
  RENDER_TILE_PROFILE_V1,
  RENDER_TILE_LIMITS_V1,
  RENDER_TILE_ROLES_V1,
  RENDER_TILE_MODALITIES_V1,
  RENDER_TILE_APRON_UNITS_V1,
  RENDER_TILE_VERDICTS_V1,
  RENDER_TILE_CODES_V1,
  readRenderTileV1,
  identityRenderTileV1
};
// PURE-REGION-END
```