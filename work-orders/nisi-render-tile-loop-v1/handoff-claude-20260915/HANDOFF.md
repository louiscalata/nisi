# nisi-render-tile-loop-v1 — HANDOFF

**Date:** 2026-09-15
**Status:** Draft — NOT integrated into the Nisi product until Louis says so.
**Parent:** SPEC v0.2 build-order item 4.

## What this is

The JS production port of Python references `unit-02-tile-loop` + `unit-03-closure`
into the Nisi tree: the core reducer of the Nisi Render Engine. Responsibilities:

- Tile state machine: `open → rendered → promoted`, `quarantined` terminal.
- Verbs: `add` / `render` (with replay check) / `verify` (with apron stale check) / `reopen` (tombstone).
- Shared promoted-identity journal with `null` tombstones (survives across loop instances).
- Upward-only cascade on reopen; children and siblings untouched.
- Identity excludes `attempt` (decision R): `sha256(canonical({ apron, children, inputs, recipe }))`.

## Files

| File | Role | Author |
|------|------|--------|
| `CONTRACT.md` | Contract (spec) | Claude (via OpenCode session, 2026-09-15) |
| `tests/render-tile-loop-v1.test.mjs` | Protected oracle (24 tests) | Claude (owner-authored, not editable by drafters) |
| `src/render-tile-loop-v1.mjs` | Draft implementation | OpenCode |
| `evidence/oracle-final.log` | Test run output | — |
| `evidence/draft-as-received.mjs` | Snapshot of the draft at handoff | — |

## Deterministic verification

- `node --test tests/render-tile-loop-v1.test.mjs` → **24/24 PASS**, 0 fail (node v24.18.0).
- `chami_gate_scan` → **NOT_RUN** by design: the gate accepts only `.py`/`.swift`
  candidates; this is a `.mjs` module. The deterministic acceptance for this
  work order is the 24-test oracle above. Gate scan does not supply a verdict
  for JS modules, so this order stays UNCERTIFIED at the Chami level.
- Exported module is ESM with zero dependencies beyond
  `canonical/canonical-json-v1.mjs`; import has no side effects.

## Decisions applied (per DECISIONS.md / SPEC v0.2)

- A (row state machine): states `open`/`rendered`/`promoted`/`quarantined`.
- B (tile loop): one shape, three scales — handled by higher layers, not this module.
- R (identity without attempt): verified by test "identity excludes attempt".
- Tombstones: reopen writes `null` for the promoted identity; a tombstoned
  identity never replays until re-verified (tests 8/9).
- Shared journal across jobs: constructor `journal` param (test 19).
- Upward-only cascade: ancestors `rendered`/`promoted` → `open`, attempt unchanged (test 16).
- K (max reopens = 2, default): attempts/reopens ceilings per constructor (tests 15/17).

## Faithful-port notes (differences from my first attempt, caught against the Python reference)

1. `apron` is the **live map** `{ neighbourId: output | null }` (null when the
   neighbour is not promoted), recomputed at render/verify/reopen — not a copy of
   the neighbours array. This keeps identity byte-compatible with `render-tile-v1`
   and Python `unit-03`.
2. `add()` validates neighbours **before** children; both must already exist.
3. `add()` rejects the tile naming itself (in neighbours OR children).
4. Parent render forces `source = 'assemble'`; leaf render requires non-empty output+source.
5. Verify recomputes the apron map and compares to the render-time snapshot
   (`apronSnapshot`) — drifting neighbours set `APRON_STALE` with **no attempt spend**.
6. Reopen leaves `attempt` unchanged on ancestors; cascade touches only
   `rendered`/`promoted` ancestors (children, siblings untouched).
7. Python-faithful queries: `done()` is `true` on an empty loop; `height()` counts
   non-promoted tiles; `lastCode` is `null` after render, `'PASS'` after promote.
8. Replay sets `source = 'journal'`.

## Known limitations / risks

- **UNCERTIFIED:** no Chami structural gate, no model review, no mutation scan on
  this module yet. Recommended next step: OpenCode packet review (pattern:
  `nisi-render-tile-v1-review-opencode`).
- No attempt-based identity means two tiles with identical content share one
  journal key — by design (decision R), but worth re-stating for integration.
- `deepStrictEqual`-compatible JSON stringification drives the live digest;
  byte-compat with Python unit-03 pinned vectors should be cross-checked in a
  later review (canonical module already carries that guarantee for ASCII).
- `maxAttempts`/`maxReopens` are fixed per loop instance, not per tile (Python-faithful).

## Next steps (for Louis's decision)

1. Review the draft (OpenCode packet or delegate review).
2. If accepted: integrate per SPEC build order — item 4 done → item 5
   (block registry + fabric table; placement with prefetch; per-block admission).
3. The render-receipt/v1 and render-tile/v1 orders remain awaiting their own
   integration decisions.