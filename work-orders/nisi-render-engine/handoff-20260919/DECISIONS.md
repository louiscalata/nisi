# Nisi Render Engine — decision record

**Product (Louis, 2026-09-14):** a future Nisi product, released as an Unreal Engine
plugin and a Unity component plugin; brief in
`~/nisi-next-private/work-orders/nisi-render-engine/PRODUCT-BRIEF.md`.

Date: 2026-09-14 (UTC). Status: default picks accepted on "continue"; override by
editing a `Pick:` line and saying so. Each decision sits where it acts in the
per-layer state machine `open → full → checking → passed → cleared` (+ re-open).

## Setup

**A. First modality** — Pick: **1**
1. Code — validity is deterministic (tests, gate, compile); the chain exists.
2. Documents — prose pipeline exists; validity is thin, quality review carries the check.
3. Images — closest to the metaphor; no lane serves it, validity would be metrics.

**B. What the ten layers are** — Pick: **3**
1. Fixed stack for every task.
2. Task-derived: the generator's first pass emits the layer list ("layer 0"), 6–12.
3. Hybrid: five mandatory (intent, constraints, interfaces, implementation, tests) + up to five task-specific.

**C. Tile unit** — Pick: **2**, file-level fallback for non-code layers
1. File.
2. Symbol (function/class from `ast-grep outline`); fits the 12k-char lane cap; stable IDs.
3. Budget-derived chunks; boundaries drift between iterations and break the cache.

## open → full

**D. "Full" detection** — Pick: **2**
1. Presence only.
2. Presence + deterministic placeholder scan (TODO, `pass`, `...`, unresolved refs).
3. Presence + self-reported confidence.

**E. Confidence source** — Pick: **1**, with **3** for layers without deterministic signal; 2 never alone
1. Deterministic signals only.
2. Model self-report.
3. Cross-model disagreement (two cheap drafts; divergence = low confidence).

**F. Filler dispatch** — Pick: **3**
1. Full pass every iteration.
2. Pure adaptive.
3. Adaptive with a floor (one denoise pass per tile in iteration 1).

## full → checking → cleared

**G. Validity (deterministic half)** — Pick: **2** everywhere, **3** for the tests row
1. Tests only.
2. Tests + structural gate (`chami_gate`) + compile.
3. Tests + gate + mutants (5.1 §1).

**H. Quality (model half)** — Pick: **1** default, **2** on risk flags, **3** for the tests row
1. Single verifier — the tier's `verify` model, never the row's author.
2. Two-reviewer quorum when `RISK_PATTERNS` fire (`--high-risk`).
3. Verifier + independent oracle (`--oracle`).

**I. Commit order** — Pick: **2** (strict bottom-up = the DAG with no declarations)
1. Strict bottom-up.
2. Declared dependency DAG; pre-check any time, commit waits for dependencies.
3. Optimistic clear, re-open on conflict.

## cleared → open

**J. Re-open policy** — Pick: **2** where a reference index exists, **1** otherwise; **3** only for quality warnings
1. Full cascade — the row and every cleared row above it.
2. Targeted — conflicting cells and the cells that reference them.
3. Quarantine — keep cleared, log for human adjudication.

**K. Stop rule** — Pick: **2 + 3**, cap of two re-opens per row, then quarantine
1. All rows cleared, nothing else is done.
2. All cleared or budget exhausted → partial report with the well state, uncertified.
3. Cleared + quiescence (one iteration with zero re-opens).

## Farm and sandbox

**L. Model residency** — Pick: **3**, **1** as Mac-only offline fallback
1. Phase batching on the Mac.
2. Fixed co-resident set that fits unified memory.
3. Split by device — generator on Mac GPU, reconciler on the PC via `chami-dispatch`, denoiser on AFM.

**M. Node budget enforcement (ring 2)** — Pick: **3**
1. Wall-clock + token caps.
2. Caps + filesystem scope (scratch dir; merge gate copies in).
3. Caps + fs scope + network scope (assigned lane only; no share, no cloud).

**N. Engine reserve** — Pick: **3** for triage + **1** for the checker
1. One of Bionic's four slots reserved for the checker.
2. Percentage floor (5.1 §4; SPEC, not enforced).
3. Separate device — engine-side triage on AFM.

## Tile loop (v0.2, decided on "continue" 2026-09-14)

**O. Apron size** — Pick: **1**
1. A property of the recipe, fixed per modality; the lane must hold tile + apron or is not eligible.
2. Derived from the lane's context cap — rejected: identity would depend on the block that rendered the tile.
3. Adaptive per iteration — rejected for the same reason, plus cache misses.

**P. Re-open direction** — Pick: **1**
1. Upward only: ancestors re-assemble; siblings and children untouched; a located child fault is reopened explicitly.
2. Full cascade above (v0 rule) — superseded; it re-rendered valid tiles.
3. Downward too — rejected: children are still valid tiles.

**Q. Seams** — Pick: **1**
1. Apron assertion at verify (`APRON_STALE`, no attempt spent) — structural, no model.
2. A seam model (v0 denoiser duty) — superseded.
3. Overlap-and-blend at compose time — image-only; keep as a modality recipe, not a rule.

## After the panel (2026-09-14, later)

**R. Attempt in identity** — Pick: **2** (was implicit in unit-02; changed on the panel's finding)
1. Keep `attempt` in the identity so every retry is a new key — rejected: a vetoed attempt-0 identity replays in a later job.
2. Identity = digest(apron, children outputs, inputs, recipe); the journal carries a tombstone for a vetoed identity until it is verified again. Reference: unit-03; applied to `nisi/render-tile/v1`.
3. Identity plus a per-job nonce — rejected: no cross-job replay at all.

**S. Lease unit for engine renders** — Pick: **1** (panel: one editor process per frame is ~100× overhead; passes come from one render)
1. The frame chunk (Movie Render Graph chunk / Recorder range) with recipe-declared warm-up; passes promote together as one row.
2. The frame.
3. The pass cell.

**T. What the receipt carries** — Pick: **1**
1. Per check: `{checkId, kind, outcome, measured, threshold, scope, code}`; author ≠ reviewer and verdict/check consistency enforced by the reader (`nisi/render-receipt/v1`).
2. Verdict and code only — rejected by the panel ("show the failing check, not just the verdict").
3. Free-form reviewer text — rejected: not a closed reader.
