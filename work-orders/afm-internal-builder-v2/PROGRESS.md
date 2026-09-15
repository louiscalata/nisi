# AFM internal builder — development progress

Updated: 2026-09-14 (verified: rung-1 green, rung-2 oracle green, rung-3 oracle green, rung-4 oracle green)

Work orders: `work-orders/afm-internal-builder-v1` (rung-1), `afm-internal-builder-v2`
(rung-2), `afm-internal-builder-v3` (rung-3) and `afm-internal-builder-v4` (rung-4),
inside `/Users/louiscalata/nisi-next-private`.
Design: `work-orders/afm-internal-builder-design/evidence/afm-builder-design.mjs`.

---

## Rung-1 — advisory proposal lane (`afm-internal-builder-v1`) ✅ COMPLETE

Read-only advisory: given a validated state pack and a deterministic policy,
produce a typed Proposal; render accepted proposals as self-contained frozen ESM.

| Artifact | Status |
|---|---|
| `src/afm-internal-builder-v1.mjs` | Filled, hardened (descriptor-walk snapshot, never-throws), pure region |
| `tests/afm-internal-builder-v1.test.mjs` | **10/10 pass**, exit 0 (protected oracle) |
| `README.md` | Done — provenance, fill decisions, demo verification |
| `evidence/` | barebones-as-received.mjs + barebones-job-record.json, proposal-demo.mjs, demo-proposal.json |
| Windows barebones | `mac-20260914-123639-6c18f96be518435044d4f68932f2c828` — Qwen3-Coder-Next 80B-A3B, 76.2 s |
| `node --check` module | PASS |

Exports: `readAfmBuilderPackV1`, `afmBuilderPackHashV1`, `proposeAfmBuilderStepV1`,
`proposalModuleSourceV1` (profile `nisi-afm-internal-builder-v1`).

---

## Rung-2 — deterministic test-run grant grammar (`afm-internal-builder-v2`) 🟢 ORACLE GREEN

Maps an **accepted rung-1 proposal** onto a caller-consented grant policy to
produce a typed, frozen, bounded run PLAN (exact argv, no shell; pinned
manifestHash + packHash; timeout/output budgets). The module **never executes
anything** — execution stays with consent-gated oracle/human accept commands.

| Artifact | Status |
|---|---|
| `SPEC.md` | Done — full contract (codes, paths, grammar, hashing) |
| `tests/afm-internal-builder-v2.test.mjs` | **10/10 pass**, exit 0 (protected oracle, incl. real rung-1→rung-2 integration) |
| `src/afm-internal-builder-v2.mjs` | Filled, hardened, pure region; `node --check` PASS |
| `evidence/barebones-as-received.mjs` + `barebones-job-record.json` | Done |
| Windows barebones | `mac-20260914205036-9bdcf3c24d4231af` — Qwen3-Coder-Next 80B-A3B, 36.1 s |
| Independent spec review (gpt-oss-20b) | **Timed out after 300 s** (`error: "The operation was aborted due to timeout"`) — lane unreliable; **fallback review job (`mac-20260914205433-7b6bfb887ae4b508`) SUCCEEDED in 90.7 s** (Qwen) → `evidence/spec-review.json`, 10 findings all dispositioned (no contract change) in README |

## Rung-2 verified close-out

- Demo chain evidence: `demo-pack-grounded.json` → `demo-proposal.json` (real v1 module) →
  `demo-plan.json` + `plan-demo.mjs` (real v2 module, `node --check` PASS,
  planHash `814a992382643047…`, runs `afm-v1-oracle`, `bridge-contract`).
- `README.md`: done — provenance (incl. both review-lane outcomes), fill decisions,
  orchestration learnings, **spec-review outcome with per-finding disposition**.

Exports: `readTestRunGrantV1`, `planDeterministicTestRunV1`, `testRunPlanHashV1`,
`testRunPlanSourceV1` (profile `nisi-afm-internal-builder-v2`).

---

## What rung-2 learned from the SharedChami worker's orchestration

Grounded in the real two-machine bridge (`chamiDATA/code-bridge/`):
- explicit model routing → explicit argv, **no shell** (worker: no silent model substitution)
- 30 s heartbeat / 300 s staleness / honest `degraded` → **bounded budgets & exact refusal codes** (worker: `status: running|degraded|stopped`)
- per-lane concurrency caps + job timeouts → **plan budget** `{timeoutSeconds ≤ 300, outputBytes ≤ 1048576}`
- temp-then-rename atomicity → **deep-frozen outputs** (nothing half-written)
- demo grant uses the bridge's real verified checks (`windows-worker-contract.test.mjs`, the v1 oracle)

## Key contract rules (rung-2, how to read a refusal)

- Refusal: frozen `{ ok: false, profile, code, path }`; 8 codes; **never throws**.
- Codes: `NOT_OBJECT` (hostile/cyclic input), `UNKNOWN_MEMBER`/`MISSING_MEMBER`
  (checked before values), `PIN` (bad manifestHash), `GRANT` (checks-set/budget
  container), `COMMAND` (`$.checks.<name>[i]` bad argv), `BUDGET` (over cap /
  non-integer), `PLAN` (proposal/grant settlement refusal).
- Settlement nuance: grant sharing **zero** run targets with the proposal →
  `$.grant`; partially-covering grant → per-entry `$.testsToRun[i]`.
- `planHash` = canonicalizeJSONV1(JSON of `{runs, manifestHash, packHash, budget}`) → sha256; deterministic.

## Verified checks (rerun from each work-order dir)

- Rung-1: `node --check src/afm-internal-builder-v1.mjs && node --test tests/afm-internal-builder-v1.test.mjs` → **10/10, exit 0**
- Rung-2: `node --check src/afm-internal-builder-v2.mjs && node --test tests/afm-internal-builder-v2.test.mjs` → **10/10, exit 0**

## Remaining

1. ✅ Done: rung-2 demo chain artifacts, README, spec-review disposition.
2. ✅ Done (same pipeline): rung-3 `scoped-staging-write` grammar — SPEC, Windows
   barebones (job `mac-20260914212038-687d1d6fd051086e`, success), oracle 10/10,
   fill, spec review (`mac-20260914224520-dafe1b303b2eb9b9`, 61.1 s — 7 findings,
   all dispositioned, NO contract change), grounded demo chain, README.
3. ✅ Done (same pipeline): rung-4 `staged-swift-compile` grammar — SPEC, Windows
   barebones (`mac-20260914231047-f9cc4eb9fc81a240`, 91.7 s), oracle 10/10, fill,
   spec review (`mac-20260914232427-f9829b96c8ced649`, 33.9 s — 8 findings:
   1 adopted = ancestor stagingHash self-consistency check, 7 rejected, no shape
   change), grounded demo chain, README.
4. Next cycle (per design ladder or integration of the DRAFT rungs) — when requested.

Status: rungs 1–4 are **DRAFT — not integrated**; acceptance authority stays with oracle/human accept commands.

---

## Rung-3 — scoped-staging-write grant grammar (`afm-internal-builder-v3`) 🟢 ORACLE GREEN

Maps an **accepted rung-2 plan result** onto a caller-consented staging policy
to produce a typed, frozen, bounded WRITE plan (exact target paths under one
lane prefix; per-file ≤ 262144 B and total ≤ 1048576 B; pins manifestHash,
packHash, sourcePlanHash). The policy's manifest pin MUST equal the source
plan's pin (cross-input refusal `$.manifestHash`) — closes rung-2 spec-review
finding #1 (hash binding). Never writes, never executes, never accepts.

| Artifact | Status |
|---|---|
| `SPEC.md` | Done — full contract (codes, paths, lane rules, staging policy, write plan, hashing) |
| `tests/afm-internal-builder-v3.test.mjs` | **10/10 pass**, exit 0 (protected oracle, incl. real v1→v2→v3 integration) |
| `src/afm-internal-builder-v3.mjs` | Filled, hardened, pure region; `node --check` PASS |
| Windows barebones | `mac-20260914212038-687d1d6fd051086e` — Qwen3-Coder-Next 80B-A3B, **success** |
| Independent spec review | `mac-20260914224520-dafe1b303b2eb9b9` — **success 61.1 s**, 7 findings → all dispositioned, **NO contract change** (each finding false / category-confused / documented; verbatim + disposition in `evidence/spec-review.json` and README) |
| Demo chain | `evidence/staging-demo.mjs` (real v1→v2→v3) + `demo-pack-grounded.json`, `demo-proposal.json`, `demo-plan.json`, `demo-write-plan.json`, `write-plan-demo.mjs` (`node --check` PASS), `demo-chain-summary.txt` — stagingHash `d9e8e813…`, lane `work-orders/afm-internal-builder-v3/evidence/`, totalBytes 3072 |
| `node --check` module | PASS |

Refusals: `$.lane` STAGING · `$.files` STAGING (container) / FILE (bad name) ·
`$.files.<name>` BUDGET (bad bytes) · `$.files` BUDGET (sum) · `$.manifestHash`
PIN · write-plan refusals `$.plan` / `$.staging` / `$.manifestHash` (WRITE only).

---

## Rung-4 — staged-swift-compile grant grammar (`afm-internal-builder-v4`) 🟢 ORACLE GREEN

Maps an **accepted rung-3 write plan** onto a caller-consented compile policy to
produce a typed, frozen, bounded COMPILE plan: exact `swiftc` argv (no shell),
`noNetwork: true` in the rendered contract, sources that the rung-3 plan staged
(name match, else `$.sources.<name>`), output artifact inside the same lane
(no collision with a staged source, else `$.output`), sha256 source pins, and
chained pins (manifestHash + sourceStagingHash + packHash). The write plan's
`stagingHash` must match its own content (adopted from the rung-4 spec review) —
a forged ancestor refuses at `$.writePlan`. Never invokes, never executes,
never accepts.

| Artifact | Status |
|---|---|
| `SPEC.md` | Done — full contract (codes, paths, invoke grammar, ancestor binding) |
| `tests/afm-internal-builder-v4.test.mjs` | **10/10 pass**, exit 0 (protected oracle, incl. real v1→v2→v3→v4 integration) |
| `src/afm-internal-builder-v4.mjs` | Filled, hardened, pure region; `node --check` PASS |
| Windows barebones | `mac-20260914231047-f9cc4eb9fc81a240` — Qwen3-Coder-Next 80B-A3B, **success 91.7 s** |
| Independent spec review | `mac-20260914232427-f9829b96c8ced649` — **success 33.9 s**, 8 findings → 1 adopted (ancestor stagingHash self-consistency), 7 rejected (false / category-confused / documented), **no shape change**; verbatim + disposition in `evidence/spec-review.json` + README |
| Demo chain | `evidence/staging-demo.mjs` (real v1→v2→v3→v4) + `demo-pack-grounded.json`, `demo-proposal.json`, `demo-plan.json`, `demo-write-plan.json`, `demo-compile-plan.json`, `compile-plan-demo.mjs` (`node --check` PASS), `demo-chain-summary.txt` — planHash `53ab2955…`, stagingHash `6b29dbc9…`, compilePlanHash `63cd24c2…`, invoke `swiftc -c a.swift b.swift -o staged.o`, noNetwork true |
| `node --check` module | PASS |

Refusals: `$.invoke` COMPILE / `$.invoke[0]` COMMAND (must be exactly `swiftc`) /
`$.invoke[i]` COMMAND · `$.sources` COMPILE / `$.sources.<name>` PIN ·
`$.output` COMPILE · `$.manifestHash` PIN · `$.budget.*` BUDGET · compile-plan
refusals `$.writePlan` / `$.compile` / `$.manifestHash` / `$.sources.<name>` /
`$.output` (INVOKE only).

Status: rungs 1–4 are **DRAFT — not integrated**; acceptance authority stays with oracle/human accept commands.