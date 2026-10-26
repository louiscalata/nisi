# Review — `nisi-render-tile/v1` (OpenCode review, 2026-09-14)

**Reviewed artifact:** `work-orders/nisi-render-tile-v1-review-opencode/src/render-tile-v1.mjs`
**Contract:** `work-orders/nisi-render-tile-v1/CONTRACT.md`
**Protected oracle:** `work-orders/nisi-render-tile-v1-review-opencode/tests/render-tile-v1.test.mjs` (owner-authored, Claude, 2026-09-14; drafters must not edit)
**Reviewer:** OpenCode (automated audit). No acceptance authority; acceptance is by the owner's protected tests and a human decision.
**Evidence:** purity scan (`evidence/purity-scan.mjs`), adversarial probe (`evidence/adversarial-probe.mjs`), protected test suite, draft lineage (`evidence/draft-result.json`).

## Summary

The draft is a functionally-correct, pure ESM module that **passes all 15 protected tests** and the purity scan (no forbidden process/filesystem/network/dynamic-code calls in the pure region). However, it carries **three substantive contract findings**, one of them high-severity (violates the module's own "never throws" guarantee and the contract's replay-prevention requirement). The draft is also **truncated relative to the model's own generated output** — it is missing the required `createHash` import.

The module is **not ready for integration** until findings F1 and F3 are resolved; F2 requires owner clarification.

## Evidence gathered

| Check | Result | Source |
|---|---|---|
| Protected tests | **15/15 PASS** | `node --test tests/render-tile-v1.test.mjs` |
| Purity scan (pure region) | **CLEAN** — only benign `export` module-surface finding; no spawn/writeFile/fetch/eval/require/process.exit | `node evidence/purity-scan.mjs src/render-tile-v1.mjs` |
| Imports | `["'../../../canonical/canonical-json-v1.mjs'"]` — **`createHash` from `node:crypto` absent** | purity scan `imports:` line |
| Adversarial probe | **8/10 throw** (throwing getters, proxies, deep recursion); 2 accepted | `node evidence/adversarial-probe.mjs` |
| Mutation discrimination | `mut-M1.mjs` (sorts `tile.children`) is **caught** by test line 76 | test `a valid parent reads; apron keys come back sorted` |
| Draft lineage | Model (`Qwen3-Coder-Next 80B-A3B`) emitted `import { createHash } from 'node:crypto'` + `attempt` in identity; current file lost the import | `evidence/draft-result.json` |

## Findings

### F1 — `identityRenderTileV1` includes `attempt`; CONTRACT says it was removed (HIGH)

**Contract (CONTRACT.md §Identity):** identity = `canonicalizeJSONV1(Buffer.from(JSON.stringify({ apron, children: childOutputs, inputs, recipe }))).sha256`. "Identity therefore ignores `tileId`, `kind`, `profile`, `schemaVersion`, `neighbours`, `children` (ids), `budget` and **`attempt`**." "`attempt` was removed from identity on 2026-09-14 (panel finding: with attempt in the key, a vetoed attempt-0 identity could replay in a later job; the journal now carries tombstones instead — see unit-03)."

**Draft (line 449-455):**
```js
const identityObj = {
    apron: read.tile.apron,
    attempt: read.tile.attempt,   // ← present — contradicts CONTRACT
    children: childOutputs,
    inputs: read.tile.inputs,
    recipe: read.tile.recipe
};
```

**Why it matters:** including `attempt` in the identity key means a vetoed attempt-0 tile's identity can be *replayed* as a later attempt — exactly the panel finding CONTRACT cites.

**Tension with the test oracle:** protected test line 217 (`assert.notEqual(identityRenderTileV1({ ...leaf(), attempt: 1 }), identityRenderTileV1(leaf()))`) is consistent with the draft (attempt matters) but inconsistent with CONTRACT prose (attempt ignored → the two would be equal). The tests and the model's generation agree on the draft's behavior; the CONTRACT text says the opposite. **This is an unresolved spec inconsistency the owner must resolve.** Until then, the draft implements the tests (attempt-in-identity) and therefore violates the CONTRACT prose.

**Severity:** HIGH — the CONTRACT's replay-prevention requirement is not met.
**Fix direction (owner decides):** remove `attempt: read.tile.attempt` from `identityObj` to satisfy CONTRACT (will then also require test line 217 to change to `assert.equal`, a protected-test change only the owner may make); or keep the draft if the owner treats the CONTRACT prose as stale.

### F2 — Missing `import { createHash } from 'node:crypto'` (MEDIUM)

**Contract (CONTRACT.md §Module):** "Imports only `createHash` from `node:crypto` and `canonicalizeJSONV1` from `../../../canonical/canonical-json-v1.mjs`."

**Draft (line 1):** `import { canonicalizeJSONV1 } from '../../../canonical/canonical-json-v1.mjs';` — only one import. Purity scan confirms: `imports: ["'../../../canonical/canonical-json-v1.mjs'"]`.

**Draft lineage:** `evidence/draft-result.json` shows the model **did** emit `import { createHash } from 'node:crypto'` as its first line; the current `src/render-tile-v1.mjs` is truncated relative to that output (the import line was lost). Adding it back satisfies the contract's import requirement (it would be imported-but-unused here, since the hash is obtained via `canonicalizeJSONV1(jsonBytes)`).

**Severity:** MEDIUM — explicit CONTRACT import violation; also a source-of-truth integrity issue (the draft file does not match the model's own output).
**Fix:** restore `import { createHash } from 'node:crypto';` as line 1.

### F3 — `readRenderTileV1` throws on adversarial inputs (HIGH)

**Contract (CONTRACT.md §Module):** "`readRenderTileV1(input)` → ... **Never throws for any input value.**"

**Adversarial probe (`evidence/adversarial-probe.mjs`) — 8 of 10 cases THROW:**
- (a) throwing getter in `params` → `*** THREW Error: boom`
- (b) nested throwing getter in `params` → `*** THREW Error: boom`
- (c) throwing getter on root member `tileId` → `*** THREW Error: boom`
- (d) throwing getter on `inputs` digest → `*** THREW Error: boom`
- (e) `params` depth 60000 → `RangeError: Maximum call stack size exceeded`
- (f) `Proxy` throwing `getPrototypeOf` → `*** THREW Error: boom` (`plain()` calls `Object.getPrototypeOf`)
- (g) `Proxy` as root input → `*** THREW Error: boom` (`plain()` calls `Object.getPrototypeOf`)
- (h) `identityRenderTileV1` on deep params → `*** THREW RangeError`

**Root causes (all inside the pure region):**
1. `plain(x)` calls `Object.getPrototypeOf(x)` — crashes on proxies that override `getPrototypeOf` (F3-f, F3-g).
2. `validateJSONValue(v, seen)` recurses without a depth bound — stack-overflows on deep nesting (F3-e, F3-h). `canonical-json-v1.mjs` enforces `CANONICAL_JSON_LIMITS_V1.depth` (128); the tile module enforces none.
3. `validateJSONValue` calls `Object.keys(v)` and `v[k]`, and `readRenderTileV1` reads `input.tileId`, `input.inputs[k]`, etc. directly — these invoke throwing getters (F3-a, F3-b, F3-c, F3-d).

**Severity:** HIGH — directly violates the module's "never throws" contract guarantee. Malformed but non-throwing inputs (proxies, getters, deep nests) are reachable and will crash the caller instead of returning a refusal.
**Fix direction:** make `plain()` and `validateJSONValue()` proxy/throw-safe (e.g., catch `Object.getPrototypeOf` and property access; bound recursion depth to a small constant) so every input value yields a refusal, never a throw.

## Findings that PASS (no action)

- **Purity/structural:** no process spawn, filesystem write, network, dynamic code, module-load, or process-mutation calls in the pure region. Purity scan reported only the expected `export` module-surface finding.
- **Protected test oracle:** 15/15 tests pass (constants frozen/complete, ordered deep-frozen tile, sorted apron, unknown/missing members at every level, scalar members, inputs, recipe, params JSON-values-within-byte-limit, neighbours/children, budget, apron-key-set, identity vectors + naming/budget ignorance, identity refusals + bad child outputs).
- **Mutation discrimination:** `mut-M1.mjs` (`tile.children = input.children.slice().sort()`) is a valid mutant that the test suite catches (test asserts children keep the *given* order, test line 76). The draft's no-sort behavior is correct; the mutation is not silently accepted.
- **`deepCopy`/`deepFreeze`** correctly isolate the frozen tile from input mutation (tests lines 65-69).
- **Refusal objects** have exactly `{ ok, profile, code, path }` and are `Object.isFrozen` (test line 28).
- **`readRenderTileV1` never throws on normal inputs** (test line 88) — the throw guarantee holds for the well-formed domain; F3 concerns adversarial/malformed inputs.

## Recommendation

1. **Resolve F1 with the owner** (attempt-in-identity vs CONTRACT replay-prevention) before integration — it is the highest-consequence finding.
2. **Apply F2 immediately** (restore the `createHash` import) — a one-line source fix.
3. **Fix F3** (make the reader proxy/throw/depth-safe) before any untrusted input is fed to the module.
4. Re-run the protected oracle and adversarial probe after fixes.

**Reviewer disposition:** the draft is **not accepted**. It passes its test suite and purity check but does not satisfy the CONTRACT on `attempt` identity (F1, unresolved spec tension) or the "never throws" guarantee (F3). The `createHash` import gap (F2) is a confirmed source defect.

---

## Reconciliation addendum (2026-09-14, later the same day)

The findings above were written against this work order's frozen snapshot (draft `src/render-tile-v1.mjs` at 02:54, the 15-test oracle, and the CONTRACT as of 03:38). While the review was outstanding, the owner evolved the integration order `work-orders/nisi-render-tile-v1` (CONTRACT.md, `src/render-tile-v1.mjs`, and a revision-4 protected oracle, modified 05:07-05:09). All three findings are now resolved **in the integration order**:

- **F1 — RESOLVED (attempt removed).** The updated CONTRACT identity section and the integration src both exclude `attempt` (identityObject = apron, children, inputs, recipe), per the 2026-09-14 panel finding. The contract also now states childOutputs is snapshotted and copied by index before hashing, and identity ignores neighbour order.
- **F2 — RESOLVED (by contract change).** The CONTRACT import requirement was revised to 'Imports only `canonicalizeJSONV1`' — the unused `createHash` requirement was dropped. The integration src matches exactly (single import). The old draft's missing import is no longer a defect against the current contract.
- **F3 — RESOLVED (snapshot pre-walk).** The integration src adds a `snapshot()` descriptor walk over the input before any validation (own enumerable string-keyed data properties only, plain objects and plain arrays; cycle refusal via path stack; budgets: depth 160, 200,000 nodes, 8,000,000 payload chars, 4,096-char keys; anything that throws inside the walk refuses the whole input as RENDER_TILE_NOT_OBJECT). `paramsValid` enforces the canonical-json grammar (safe integers, well-formed strings, NFC NUL-free non-reserved keys, paramsDepth 120, paramsMembers 4096) with a running byte lower bound, so no unbounded O(n) operation ever runs. `RENDER_TILE_LIMITS_V1` gained paramsDepth/paramsMembers (documented in the updated CONTRACT).

**Verification run (read-only, this reviewer):** `node --test tests/render-tile-v1.test.mjs` in `work-orders/nisi-render-tile-v1` — **19/19 pass**, including the new rev-4 tests (snapshot boundaries exact: depth 160, 200,000 nodes, payload and key caps; unbounded payloads refused, never thrown on, in bounded time and memory; cross-level check order; idempotent re-reads with computable identity; a flipping `attempt` getter; a non-enumerable hidden `attempt`).

**Status of this work order:** its draft and 15-test oracle remain the frozen pre-revision-4 snapshot this review audited; the findings were accurate for that snapshot. No edits were made to the integration order (it is owner-owned and was being actively modified during this reconciliation). Acceptance authority remains with the owner's rev-4 oracle and human decision; this addendum is collaborator verification only.
