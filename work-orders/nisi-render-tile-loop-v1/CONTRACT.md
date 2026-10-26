# nisi-render-tile-loop-v1 — CONTRACT

**Owner:** Louis (directed 2026-09-15)
**Author:** OpenCode (implementation), Claude (contract + protected oracle)
**Status:** draft
**Parent:** SPEC v0.2 build-order item 4 — "JS port of the tile loop as the core's reducer; journal of promoted identities"
**Depends on:** `nisi-render-tile-v1` (identity shape), `canonical/canonical-json-v1` (canonicalization)

---

## 1 — What this module is

The Nisi Render Engine **tile loop**: the core reducer that manages a directed acyclic
graph of tile state transitions, a shared promoted-identity journal with tombstones,
and upward-only cascade.

This is the JS production port of Python references `unit-02-tile-loop` (basic loop)
and `unit-03-closure` (journal / tombstones / cascade).  It does **not** contain rendering,
model inference, checking, block registry, or UI — those are higher layers.

## 2 — Module shape

| Property | Value |
|----------|-------|
| Path | `src/render-tile-loop-v1.mjs` |
| Format | ESM, single file |
| Dependencies | `canonical/canonical-json-v1.mjs` only |
| Zero network | true |
| Zero filesystem | true |
| Zero `require()` | true |
| Strict mode | implicit via ESM |
| PURE-REGION | lines between `PURE-REGION-BEGIN` and `PURE-REGION-END` |

**Imports:**

```js
import { canonicalizeJSONV1 } from '../../../canonical/canonical-json-v1.mjs';
```

## 3 — Exports

```js
export {
  TILE_LOOP_PROFILE_V1,   // 'nisi-render-tile-loop-v1'
  TILE_LOOP_STATES_V1,    // ['open','rendered','promoted','quarantined']
  TILE_LOOP_VERDICTS_V1,  // ['PASS','VALIDITY_FAIL','QUALITY_FAIL','APRON_STALE','REPLAY']
  TILE_LOOP_DEFAULTS_V1,  // { maxAttempts: 3, maxReopens: 2 }
  TileLoopV1,             // the class
};
```

## 4 — Class: `TileLoopV1`

### Constructor

```js
new TileLoopV1({
  maxAttempts = 3,   // inclusive ceiling; attempt > max → quarantine
  maxReopens  = 2,   // inclusive ceiling; reopens > max → quarantine
  journal     = new Map(),   // shared promoted-identity journal (survives across jobs)
} = {})
```

The journal maps `identity → output | None (tombstone)`.  Passing the same `Map`
reference into multiple `TileLoopV1` instances makes the journal shared across jobs.

### Internal tile state (per tile_id)

```js
{
  id:          string,
  inputs:      object,       // caller-provided
  recipe:      string,       // caller-provided
  neighbours:  string[],     // caller-provided (only used for APRON_STALE comparison)
  children:    string[],     // tile_ids this tile depends on
  parent:      string | null,// set when a child is added
  state:       'open' | 'rendered' | 'promoted' | 'quarantined',
  attempt:     number,       // starts 0
  reopens:     number,       // starts 0
  output:      string | null,// promoted or candidate output digest
  candidate:   string | null,// snapshot during rendered
  source:      string | null,// reviewer source during rendered
  apron:       object | null,// snapshot at render time
  lastCode:    string,       // last outcome code
}
```

### Methods — mutating (state machine)

#### `add(tileId, tile)`

- `tile` must have `{ inputs, recipe, neighbours?, children? }`.
- Throws `Error` if:
  - `tileId` already exists → throw
  - `tileId` appears in `neighbours` or `children` (tile naming itself) → throw
  - Any neighbour ID not yet added → throw
  - Any child ID not yet added → throw
  - Child already has a `parent` → throw
- Sets `state = 'open'`, `attempt = 0`, `reopens = 0`, `output = null`, `lastCode = null`.
- Registers as `parent` of each child.

#### `render(tileId, { output, source })`

- Must be `state = 'open'`.
- **Replay check:** compute live identity; if journal has non-None entry → `output = journal entry`, `state = 'promoted'`, `lastCode = 'REPLAY'`, `source = 'journal'`, return.
- **Replay tombstone:** if journal has None entry → must re-render (fall through).
- **Leaf** (no children): `output` and `source` must be non-empty strings. `candidate = digest(output)`, `source` = caller source.
- **Parent** (has children): all children must be `state = 'promoted'`. `candidate = digest(canonical(childOutputs))`, `source = 'assemble'`.
- Snapshot `apronSnapshot` = live apron map (see §5).
- `state = 'rendered'`, `lastCode = null`.

#### `verify(tileId, { validity, quality, reviewer })`

- Must be `state = 'rendered'`.
- `reviewer` must be a non-empty string and differ from `source`.
- **Apron stale check:** recompute live apron map; if it differs from `apronSnapshot` → `lastCode = 'APRON_STALE'`, `state = 'open'`, `candidate = null`, return (no attempt spend).
- If `validity AND quality` → `output = candidate`, `state = 'promoted'`, record `identity → output` in journal, `lastCode = 'PASS'`.
- Else → `attempt++`. If `attempt > maxAttempts` → `state = 'quarantined'`, `lastCode = validity ? 'QUALITY_FAIL' : 'VALIDITY_FAIL'`. Else `state = 'open'`, `candidate = null`.

#### `reopen(tileId, reason)`

- Must be `state = 'promoted'`; requires a non-empty `reason` string.
- `reopens++`.
- If `reopens > maxReopens` → `state = 'quarantined'`, return.
- Compute live identity **before** clearing output.
- Write tombstone: `journal.set(identity, None)`.
- Clear `output = null`.
- `attempt++`.
- `state = 'open'`.
- **Cascade upward only:** walk `parent` chain; each ancestor in `rendered` or `promoted` returns to `open` and clears its output; **attempt unchanged**.  Children and siblings are untouched.

### Methods — querying (no mutation)

| Method | Returns |
|--------|---------|
| `state(tileId)` | state string |
| `output(tileId)` | output string or `null` |
| `lastCode(tileId)` | last verdict code string |
| `attemptCount(tileId)` | integer |
| `reopenCount(tileId)` | integer |
| `done()` | `true` if all tiles are `promoted` (empty loop → `true`, Python-faithful) |
| `stuck()` | `true` if any tile is `quarantined` |
| `height()` | count of non-promoted tiles (Python-faithful) |
| `snapshot()` | frozen object: `{ tiles: { [id]: { state, output, lastCode } } }` |

### Throws contract

The mutating methods (`add`, `render`, `verify`, `reopen`) throw `Error` for
programming errors (wrong state, duplicate ID, self-reference, reviewer == source).
They do **not** return error objects — the tile loop is a deterministic internal
reducer, not an input reader.

## 5 — Identity

```
identity = sha256(canonicalize({ apron, children: childOutputs, inputs, recipe }))
```

- **No `attempt`** in the identity (decision R).
- `apron` is the **live apron map**: `{ neighbourId: output | null }` — `null`
  when the neighbour is not promoted (mirrors Python `Loop.apron()`).
- `children` is the child output list with `null` placeholders for non-promoted children.
- Canonicalization via `canonicalizeJSONV1(Buffer.from(JSON.stringify(obj))).sha256`.
- Live-computed everywhere (replay check, promote record, reopen tombstone),
  exactly like the Python reference. Because neighbours never change after
  `add`, the same identity is produced at render/verify/reopen for the same apron.

## 6 — Journal semantics

| Event | Journal action |
|-------|---------------|
| promote | `journal[identity] = output` |
| reopen | `journal[identity] = None` (tombstone) |
| render (replay) | identity in journal, value != None → skip render, promote immediately |
| render (tombstone) | identity in journal, value == None → must re-render |

## 7 — Cascade (upward only)

On `reopen`:
1. The reopened tile clears output, increments attempt, goes to `open`.
2. Walk `parent` chain upward: each ancestor goes to `open`, clears output.
3. **Children and siblings are untouched.**
4. A fault in a child is reopened there explicitly — the parent does not cascade down.

## 8 — Acceptance tests

File: `tests/render-tile-loop-v1.test.mjs`
Runner: `node --test tests/render-tile-loop-v1.test.mjs`
Minimum: 16 tests (15 from unit-03 port + 1 new for cross-job journal)

Tests cover:
1. Self-reference in children → throw
2. Duplicate tile_id → throw
3. Child already has parent → throw
4. Unknown child in children → throw
5. Leaf render → RENDERED
6. Leaf verify (validity + quality + different reviewer) → PROMOTED
7. Identity without attempt (same tile, different attempt → same identity)
8. Replay from journal → REPLAY
9. Tombstone prevents replay → must re-render
10. Parent render requires all children PROMOTED
11. Parent verify → PROMOTED
12. APRON_STALE → OPEN without attempt spend
13. Verify failure (validity fail) → attempt++, OPEN
14. Verify failure (quality fail) → attempt++, OPEN
15. Quarantine after max attempts exceeded
16. Upward-only cascade on reopen (children unaffected)
17. Quarantine after max reopens exceeded
18. Reviewer same as source → throw
19. Cross-job journal sharing

## 9 — Deterministic gate

After implementation, run:
1. `node --test tests/render-tile-loop-v1.test.mjs` — all tests PASS
2. `chami_gate_scan` on `src/render-tile-loop-v1.mjs` — no advisory findings

## 10 — Authorship and protection

- **Protected files (owner-authored, drafters must not edit):**
  - `CONTRACT.md`
  - `tests/render-tile-loop-v1.test.mjs`
- **Draft file (OpenCode writes):**
  - `src/render-tile-loop-v1.mjs`
- **Status:** Draft awaiting integration.  Not integrated into the Nisi product until Louis says so.
