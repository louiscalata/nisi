/**
 * render-tile-loop-v1.mjs
 *
 * The Nisi Render Engine tile loop — the core reducer that manages tile state
 * transitions, a shared promoted-identity journal with tombstones, and
 * upward-only cascade.
 *
 * Faithful JS port of Python reference unit-03 (tile_loop_journal_reference.py).
 * SPEC v0.2 build-order item 4: "JS port of the tile loop as the core's
 * reducer; journal of promoted identities."
 *
 * Identity = sha256(canonical({ apron, children, inputs, recipe }))
 *   - apron    = live map neighbourId -> output | null (null when not promoted)
 *   - children = child output list, null placeholders for non-promoted children
 *   - No attempt in identity (decision R).
 */

import { canonicalizeJSONV1 } from '../../../canonical/canonical-json-v1.mjs';

// PURE-REGION-BEGIN

const TILE_LOOP_PROFILE_V1 = 'nisi-render-tile-loop-v1';

const TILE_LOOP_STATES_V1 = Object.freeze([
  'open', 'rendered', 'promoted', 'quarantined',
]);

const TILE_LOOP_VERDICTS_V1 = Object.freeze([
  'PASS', 'VALIDITY_FAIL', 'QUALITY_FAIL', 'APRON_STALE', 'REPLAY',
]);

const TILE_LOOP_DEFAULTS_V1 = Object.freeze({
  maxAttempts: 3,
  maxReopens: 2,
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Canonical sha256 digest — mirrors Python `digest(canonical(x))`. */
function tileLoopDigest(x) {
  return canonicalizeJSONV1(Buffer.from(JSON.stringify(x))).sha256;
}

// ---------------------------------------------------------------------------
// TileLoopV1
// ---------------------------------------------------------------------------

class TileLoopV1 {
  /**
   * @param {object} [opts]
   * @param {number} [opts.maxAttempts=3]   — attempt > max → quarantine
   * @param {number} [opts.maxReopens=2]    — reopens > max → quarantine
   * @param {Map<string, string|null>} [opts.journal] — shared promoted-identity journal
   */
  constructor({ maxAttempts = TILE_LOOP_DEFAULTS_V1.maxAttempts,
                maxReopens  = TILE_LOOP_DEFAULTS_V1.maxReopens,
                journal     = new Map() } = {}) {
    this._maxAttempts = maxAttempts;
    this._maxReopens  = maxReopens;
    this._journal     = journal;
    this._tiles       = new Map(); // id -> tile state
    this._order       = [];        // insertion order
  }

  // -------------------------------------------------------------------------
  // Mutating — state machine
  // -------------------------------------------------------------------------

  /**
   * Add a tile to the loop.
   * @param {string} tileId
   * @param {object} tile — { inputs, recipe, neighbours?, children? }
   *
   * Throws: duplicate id; tile naming itself (in neighbours or children);
   * unknown neighbour; unknown child; child already has a parent.
   */
  add(tileId, tile) {
    if (!tile || typeof tile !== 'object') throw new Error('tile must be an object');
    if (this._tiles.has(tileId))                  throw new Error('duplicate id');
    if (typeof tile.inputs !== 'object' || tile.inputs === null) throw new Error('tile.inputs is required');
    if (typeof tile.recipe !== 'string')          throw new Error('tile.recipe must be a string');

    const neighbours = tile.neighbours ?? [];
    const children   = tile.children   ?? [];

    if (!Array.isArray(neighbours)) throw new Error('tile.neighbours must be an array');
    if (!Array.isArray(children))   throw new Error('tile.children must be an array');
    if (neighbours.includes(tileId) || children.includes(tileId)) {
      throw new Error('tile naming itself');
    }
    for (const n of neighbours) {
      if (!this._tiles.has(n)) throw new Error(`unknown neighbour: ${n}`);
    }
    for (const c of children) {
      if (!this._tiles.has(c)) throw new Error(`unknown child: ${c}`);
      if (this._tiles.get(c).parent !== null) throw new Error(`child already has a parent: ${c}`);
    }

    this._tiles.set(tileId, {
      id:            tileId,
      inputs:        tile.inputs,
      recipe:        tile.recipe,
      neighbours:    [...neighbours],
      children:      [...children],
      parent:        null,
      state:         'open',
      attempt:       0,
      reopens:       0,
      output:        null,
      lastCode:      null,
      candidate:     null,
      source:        null,
      apronSnapshot: null,
    });

    for (const c of children) {
      this._tiles.get(c).parent = tileId;
    }
    this._order.push(tileId);
  }

  /**
   * Live apron map: neighbourId -> output | null (null when not promoted).
   * Mirrors Python `Loop.apron()`.
   */
  _apron(tileId) {
    const t = this._tiles.get(tileId);
    const result = {};
    for (const n of t.neighbours) {
      const nt = this._tiles.get(n);
      result[n] = (nt && nt.state === 'promoted') ? nt.output : null;
    }
    return result;
  }

  /** Live identity: sha256(canonical({ apron, children, inputs, recipe })). */
  _identity(tileId) {
    const t = this._tiles.get(tileId);
    const apron = this._apron(tileId);
    const childrenOutputs = [];
    for (const c of t.children) {
      const ct = this._tiles.get(c);
      childrenOutputs.push((ct && ct.state === 'promoted') ? ct.output : null);
    }
    return tileLoopDigest({ apron, children: childrenOutputs, inputs: t.inputs, recipe: t.recipe });
  }

  /**
   * Render a tile.
   * @param {string} tileId
   * @param {object} opts
   * @param {string} [opts.output] — leaf output (string)
   * @param {string} [opts.source] — leaf source label
   */
  render(tileId, { output, source } = {}) {
    const t = this._tiles.get(tileId);
    if (!t) throw new Error(`unknown tile: ${tileId}`);
    if (t.state !== 'open') throw new Error(`render only from OPEN (state: ${t.state})`);

    // Replay check first: identity already in journal and not tombstoned
    const identity = this._identity(tileId);
    if (this._journal.has(identity) && this._journal.get(identity) !== null) {
      t.state    = 'promoted';
      t.output   = this._journal.get(identity);
      t.lastCode = 'REPLAY';
      t.source   = 'journal';
      return t.state;
    }

    const isLeaf = t.children.length === 0;

    if (isLeaf) {
      if (typeof output !== 'string' || typeof source !== 'string' || source === '') {
        throw new Error('invalid leaf render args');
      }
      t.candidate = tileLoopDigest(output);
      t.source    = source;
    } else {
      for (const c of t.children) {
        const ct = this._tiles.get(c);
        if (!ct || ct.state !== 'promoted') {
          throw new Error(`parent render requires all children promoted (child ${c} state: ${ct.state})`);
        }
      }
      const childOutputs = t.children.map(c => this._tiles.get(c).output);
      t.candidate = tileLoopDigest(childOutputs);
      t.source    = 'assemble';
    }

    t.apronSnapshot = this._apron(tileId);
    t.state     = 'rendered';
    t.lastCode  = null;
    return t.state;
  }

  /**
   * Verify a rendered tile.
   * @param {string} tileId
   * @param {object} opts
   * @param {boolean} opts.validity
   * @param {boolean} opts.quality
   * @param {string}  opts.reviewer — must differ from source
   */
  verify(tileId, { validity, quality, reviewer } = {}) {
    const t = this._tiles.get(tileId);
    if (!t) throw new Error(`unknown tile: ${tileId}`);
    if (t.state !== 'rendered') throw new Error(`verify only from RENDERED (state: ${t.state})`);
    if (typeof reviewer !== 'string' || reviewer === '') {
      throw new Error('invalid reviewer');
    }
    if (reviewer === t.source) throw new Error('reviewer same as source');

    // Recompute apron; any drift means a neighbour changed under us
    const currentApron = this._apron(tileId);
    if (currentApron !== null && !this._apronsEqual(currentApron, t.apronSnapshot)) {
      t.lastCode = 'APRON_STALE';
      t.state    = 'open';
      t.candidate = null;
      return t.state;
    }

    if (validity && quality) {
      t.state    = 'promoted';
      t.output   = t.candidate;
      t.lastCode = 'PASS';
      this._journal.set(this._identity(tileId), t.output);
    } else {
      t.candidate = null;
      t.attempt++;
      t.lastCode = validity ? 'QUALITY_FAIL' : 'VALIDITY_FAIL';
      t.state = t.attempt > this._maxAttempts ? 'quarantined' : 'open';
    }

    return t.state;
  }

  /**
   * Reopen a promoted tile (new attempt with a reason).
   * @param {string} tileId
   * @param {string} reason — non-empty reason string
   */
  reopen(tileId, reason) {
    const t = this._tiles.get(tileId);
    if (!t) throw new Error(`unknown tile: ${tileId}`);
    if (t.state !== 'promoted') throw new Error(`reopen only from PROMOTED (state: ${t.state})`);
    if (typeof reason !== 'string' || reason === '') {
      throw new Error('reopen requires a non-empty reason string');
    }

    t.reopens++;
    if (t.reopens > this._maxReopens) {
      t.state = 'quarantined';
      return t.state;
    }

    // Compute identity BEFORE clearing output, then write the tombstone
    const identity = this._identity(tileId);
    this._journal.set(identity, null);

    // Clear output, bump attempt, reopen
    t.output = null;
    t.attempt++;
    t.state  = 'open';

    // Cascade upward only: ancestors in RENDERED or PROMOTED return to OPEN,
    // their output is cleared, attempt unchanged. Children and siblings untouched.
    let currentId = tileId;
    for (;;) {
      const parentId = this._tiles.get(currentId).parent;
      if (parentId === null || !this._tiles.has(parentId)) break;
      const parent = this._tiles.get(parentId);
      if (parent.state === 'rendered' || parent.state === 'promoted') {
        parent.state  = 'open';
        parent.output = null;
      }
      currentId = parentId;
    }

    return t.state;
  }

  // -------------------------------------------------------------------------
  // Querying (no mutation)
  // -------------------------------------------------------------------------

  /** @returns {string} state of the tile */
  state(tileId) {
    const t = this._tiles.get(tileId);
    if (!t) throw new Error(`unknown tile: ${tileId}`);
    return t.state;
  }

  /** @returns {number} attempt count */
  attemptCount(tileId) {
    const t = this._tiles.get(tileId);
    if (!t) throw new Error(`unknown tile: ${tileId}`);
    return t.attempt;
  }

  /** @returns {number} reopen count */
  reopenCount(tileId) {
    const t = this._tiles.get(tileId);
    if (!t) throw new Error(`unknown tile: ${tileId}`);
    return t.reopens;
  }

  /** @returns {string|null} promoted output or null */
  output(tileId) {
    const t = this._tiles.get(tileId);
    if (!t) throw new Error(`unknown tile: ${tileId}`);
    return t.output;
  }

  /** @returns {string|null} last outcome code */
  lastCode(tileId) {
    const t = this._tiles.get(tileId);
    if (!t) throw new Error(`unknown tile: ${tileId}`);
    return t.lastCode;
  }

  /** @returns {boolean} true if every tile is promoted (empty loop → true, Python-faithful) */
  done() {
    for (const t of this._tiles.values()) {
      if (t.state !== 'promoted') return false;
    }
    return true;
  }

  /** @returns {boolean} true if any tile is quarantined */
  stuck() {
    for (const t of this._tiles.values()) {
      if (t.state === 'quarantined') return true;
    }
    return false;
  }

  /** @returns {number} count of non-promoted tiles (Python-faithful) */
  height() {
    let count = 0;
    for (const t of this._tiles.values()) {
      if (t.state !== 'promoted') count++;
    }
    return count;
  }

  /** @returns {object} frozen snapshot { tiles: { id: { state, output, lastCode } } } */
  snapshot() {
    const tiles = {};
    for (const [id, t] of this._tiles) {
      tiles[id] = Object.freeze({
        state:    t.state,
        output:   t.output,
        lastCode: t.lastCode,
      });
    }
    return Object.freeze({ tiles: Object.freeze(tiles) });
  }

  /** Deep equality for the JSON-safe apron maps. */
  _apronsEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
}

// PURE-REGION-END

export {
  TILE_LOOP_PROFILE_V1,
  TILE_LOOP_STATES_V1,
  TILE_LOOP_VERDICTS_V1,
  TILE_LOOP_DEFAULTS_V1,
  TileLoopV1,
};