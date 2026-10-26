# handoff-claude-20260914 — nisi-render-tile-v1

Work order for build step 3 of the Nisi Render Engine: the `nisi/render-tile/v1`
manifest reader and identity. New files only; nothing outside this folder was
touched; no commit, no checkpoint (Louis's or Codex's call).

## Pattern

Claude wrote CONTRACT.md and the protected oracle `tests/render-tile-v1.test.mjs`.
The PC worker drafted `src/render-tile-v1.mjs` from the contract alone
(job `mac-20260914-023430-4407872d2110780717a34b9a89527b53`, model
`Qwen3-Coder-Next 80B-A3B Q4_K_M`, 213.2 s, 7,646-char prompt, retained as
`evidence/draft-request.json` / `draft-result.json`; the draft as received is
`evidence/draft-as-received.mjs`). Claude integrated with three repairs, ran
the oracle and the structural checker, and mutation-tested the oracle.

## Repairs to the draft (integrator, Claude)

1. `children` are kept in the order given (the draft sorted them; parent
   assembly and identity depend on order).
2. Unused `createHash` import removed.
3. Cycle guard in the params validator (a cyclic params object must be
   refused, not overflow the stack — the reader never throws); the redundant
   forbidden-key pre-pass, which would also have recursed forever, removed.

## Contract changes during integration

- Plain object now means prototype `Object.prototype` or `null` (Dates, Maps,
  class instances are refused as NOT_OBJECT).
- Entry-level vs array-level path rule for neighbours/children stated.
- Check-order clause aligned with the draft: a nested object's unknown/missing
  members are checked when that object is reached. No oracle case depended on
  the stricter wording.

## Owner-side oracle defects found and fixed

- A digit-only digest vector had no case to flip (`toUpperCase` was a no-op).
- Mutants M1 (children sorted) and M2 (no cycle guard) survived the first
  oracle; cases added. M3 (apron size check removed) is an equivalent mutant:
  the per-key loops already refuse a key-set mismatch.

## Evidence

- `evidence/oracle-final.log` — 15 tests, all passing (Node 24).
- `evidence/structural-check.json` — PASS, zero findings, 8/8 checker mutants caught.
- `evidence/mutants.json` — 6 deliberate mutants: 5 caught, 1 equivalent.
- Identity pinned to the Python reference vectors (`~/pending-review/nisi/render-engine/unit-02-tile-loop`),
  byte-compatible for ASCII content via `canonicalizeJSONV1`.
- Hashes: `SHA256SUMS` beside this file.

## Not done, on purpose

- Not integrated into the product: no `package.json` export, no move under a
  product directory, no `check:private-package` run. Integration steps if
  approved: choose the directory (`render/` proposed), fix the relative
  canonical import, add the export and the `files` entry, allowlist in
  `scripts/private-package-contract.mjs`, copy the test under `tests/`.
- No independent review yet. Requested: OpenCode bounded review or Astra via
  `astra-review`, against CONTRACT.md and the oracle.
- Receipts and verdict readers (`nisi/render-receipt/v1`) are the next slice.

## Revision 2 (same day, after the panel)

`attempt` removed from identity (contract, source, pinned vectors) on the
panel's finding that a vetoed attempt-0 identity could replay in a later
job; the journal carries tombstones instead (unit-03 in the design folder is
the reference for that). Oracle 15/15; structural PASS; mutants re-run with
M4 now "identity drops apron" and M7 "identity includes attempt" (must be
caught): see evidence/mutants.json. SHA256SUMS regenerated.

## Revision 3 (same day) — after the adversarial review: REJECT → fixed

`evidence/claude-review.json` (claude-workflow review-render-tile-v1, 107
agents) returned REJECT with four blockers, all real. What was wrong and what
changed:

1. **Identity threw foreign codec errors.** canonical-json-v1 accepts only
   safe-integer numbers and well-formed strings; the reader accepted floats,
   lone surrogates, non-NFC/NUL keys, unbounded depth and member counts, so
   `identityRenderTileV1` could throw `CanonicalJSONErrorV1` for a tile that
   read ok. Contract decision taken: params live inside the codec grammar
   (safe integers not -0, well-formed strings, NFC NUL-free keys, ≤120 levels,
   ≤4096 members per object). Every `ok()` fixture is now digested.
2. **The reader could throw.** Deep params (stack overflow), throwing getters,
   Proxy traps, Array subclasses, null-prototype and own-`map` arrays,
   Symbol.species, hidden `toJSON`. Replaced validate-then-copy with a single
   descriptor-walk snapshot (accessor, non-enumerable, symbol, exotic array,
   cycle, depth and node-budget refusals → `RENDER_TILE_NOT_OBJECT` at `$`);
   validation and output are built from the snapshot; no input method is
   called anywhere.
3. **Re-reads between validation and copy** — gone with the snapshot.
4. **The structural-check evidence was false.** `scripts/structural-check.mjs`
   hardcodes `canonical/canonical-json-v1.mjs` as its subject; the file I had
   recorded as this module's PASS was the codec's. Re-run through a
   parametrised copy of the checker (kept outside the tree); the export list
   moved outside the PURE-REGION markers (the checker's `module-surface` rule
   would have failed it); `evidence/structural-check.json` now carries this
   module's own `sourceDigest`.
Also fixed: `childOutputs` snapshotted and copied by index before hashing;
shared (non-cyclic) sub-objects in params accepted (path-stack cycle guard +
node budget), exponential DAGs refused without throwing; `constructor` /
`prototype` refused as inputs and apron keys; identity errors carry the code
in `.message`; contract prose on neighbours, sorted keys, imports corrected.

Oracle: 16 tests (revision 3), all passing; pinned identity vectors unchanged.
Mutants: 16/16 caught (evidence/mutants.json), including model-128 and
neighbours-256 boundaries, the inputs name-before-value order, NFC keys,
accessor acceptance, cycle guard, depth boundary and the empty-message error.
Two review items remain open: an integer-like-key ordering statement is now
in the contract and pinned; the `hasForbiddenKeys` helper no longer exists
(rewrite). Not integrated; re-review requested.

## Revision 4 (same day) — after the re-review: REJECT → fixed

`evidence/claude-rereview.json` confirmed 11 of the 14 first-review findings
fixed and 3 partially fixed, and found one remaining blocker of the same
family: `JSON.stringify(recipe.params)` ran on an unbounded snapshot, so a
16-level `{l,r}` DAG around one 10 KB string (inside the node budget) or a
single 90 M-character string threw a code-less `RangeError` out of both
entry points; a primitive array shared through a DAG could reach an
uncatchable heap OOM; near-max-length strings threw at `normalize` and at the
unknown-member path build.

Fixed: the snapshot now carries a payload budget (8,000,000 string characters
of keys and values plus array elements, counted per copy) and a 4,096-character
key cap beside the depth (160) and node (200,000) budgets; `paramsValid`
keeps a running lower-bound byte estimate and stops at the first leaf that
passes `paramsBytes`, so `isWellFormed`, `normalize` and the exact
`JSON.stringify` only ever run on bounded data. Measured after the fix: the
16-level DAG refused in 1 ms, the 90 M string in 0 ms, a 13-object DAG around
a 1e6-element array in 645 ms at ~500 MB RSS, a 100k-char U+0344 key in 0 ms —
all as `RENDER_TILE_NOT_OBJECT` at `$`, none thrown.

Oracle revision 4: 19 tests — boundaries pinned exactly (nest 159 → PARAMS,
160 → NOT_OBJECT; 199,990 nodes → PARAMS, 199,991 → NOT_OBJECT; 4,096-char
key → UNKNOWN_MEMBER, 4,097 → NOT_OBJECT), the payload cases above, model
length in UTF-16 code units (64 astral ok, 65 refused), and the cross-level
check order. Mutants: 24/24 caught, including snapshot depth 150 and nodes
100,000, no payload budget (strings, arrays), no key cap, no running byte
budget, hoisted nested unknown-member check, and code-point model length.
Structural check regenerated for the new `sourceDigest`. The in-tree
`scripts/structural-check.mjs` still hardcodes the codec (an integration
item outside this work order's new-files-only scope). Not integrated.
