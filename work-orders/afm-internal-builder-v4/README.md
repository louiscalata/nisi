# afm-internal-builder-v4 — rung-4 (staged-swift-compile grant grammar)

STATUS: **DRAFT — not integrated.** Read-only advisory lane, fourth rung of the
AFM internal builder ladder (design: `../afm-internal-builder-design/evidence/afm-builder-design.mjs`,
rung `staged_swift_compile`, pin `compiler invocation + source hashes + manifestHash`).

The module **never invokes anything, never executes anything, and never holds
acceptance authority**. It validates a caller-consented compile policy against
an accepted rung-3 write plan and renders a typed, frozen, bounded COMPILE plan:
exact `swiftc` argv (no shell), no network (`noNetwork: true` is part of the
rendered contract), source files that the rung-3 write plan staged (name match),
output artifact inside the same lane, sha256 source pins, budgets, and chained
pins (`sourceStagingHash`, `packHash`) an oracle/human accept command can verify
later. Execution stays with consent-gated accept commands.

## What the module exports

- `readCompilePolicyV1(input)` — validated, deep-frozen `{ invoke, sources, output, manifestHash, budget }`.
- `planStagedCompileV1(writePlanResult, compilePolicy)` → frozen `{ ok, profile, compilePlan }`
  where `compilePlan = { invoke, sources, output, lane, manifestHash, packHash, sourceStagingHash, planHash, budget, noNetwork }`.
- `stagedCompilePlanHashV1(compilePlan)` — deterministic sha256 over the seven
  canonical fields `{ invoke, sources, output, lane, manifestHash, packHash, sourceStagingHash }`
  (canonicalized JSON; object-key order irrelevant, array order relevant).
- `stagedCompilePlanSourceV1(compilePlanResult)` — self-contained frozen ESM
  module source that always passes `node --check`.

Profile `nisi-afm-internal-builder-v4`; limits `{ sources: 8, sourceNameLength:
64, argvMax: 16, argvEntryLength: 128, invokeTimeoutSeconds: 300, outputBytes:
1048576, compilerNameLength: 64, outputNameLength: 64, laneLength: 96 }`.

## Key contract rules (how to read a refusal)

- Refusal: frozen `{ ok: false, profile, code, path }`; 8 codes; **never throws**
  (descriptor-walk snapshot: getters, Proxy traps, cycles, exotic arrays all refuse).
- Codes: `NOT_OBJECT` (hostile/non-plain input), `UNKNOWN_MEMBER` / `MISSING_MEMBER`
  (member set, checked before values), `COMPILE` (invoke/sources/output/budget
  container problems), `COMMAND` (`$.invoke[0]` not exactly `swiftc`, or a bad
  argv entry), `BUDGET` (timeout/output budget values), `PIN` (bad source or
  manifest hash), `INVOKE` (compile-plan settlement refusals).
- `invoke` is the complete sandboxed argv; the first entry must be exactly
  `swiftc` (this rung is scoped to swiftc-style invocations). All entries are
  plain bounded strings without control chars — no shell, no separators.
- Cross-rung pin: `compilePolicy.manifestHash` MUST equal the accepted rung-3
  write plan's `manifestHash`, else `$.manifestHash`.
- Every compile source MUST have been staged by the rung-3 write plan (name in
  `writePlan.writes`), else `$.sources.<name>`; the compile output MUST NOT
  collide with a staged source name, else `$.output` (a pinned input must never
  be overwritable by the artifact).
- The write-plan result is fully re-validated (lane/name rules, `path === lane + name`,
  per-file bytes, `totalBytes ===` sum, all hexes) — a mutated or hostile
  rung-3 result refuses at `$.writePlan`.

## Why rung-4 exists (what it closes)

The ladder's settlement chain is now complete for the "plan everything, execute
nothing" surface: rung-1 proposes (what), rung-2 plans bounded exact runs (how
to verify), rung-3 plans lane-scoped staged writes (what to write), rung-4 plans
a sandboxed, no-network, pinned `swiftc` invocation on those staged sources
(what to compile). Every hop carries the same manifest pin plus the previous
hop's hash (`sourcePlanHash` at rung-3, `sourceStagingHash` at rung-4), so an
accept command can verify the exact ancestor results at the end of the chain.

## Provenance

- Work order: `work-orders/afm-internal-builder-v4` in `/Users/louiscalata/nisi-next-private`.
- Windows barebones (modelled by the worker, filled by the Mac):
  - job `mac-20260914231047-f9cc4eb9fc81a240` — **success**, 91.7 s,
    Qwen3-Coder-Next 80B-A3B Q4_K_M — see `evidence/barebones-job-record.json`
    and `evidence/barebones-as-received.mjs`. (This worker output used real
    newlines in the code block, unlike the escaped form rungs 2–3 received; the
    receiver's two-path unescaper handles both.)
- Independent spec review:
  - job `mac-20260914232427-f9829b96c8ced649` — **success**, 33.9 s,
    Qwen3-Coder-Next 80B-A3B Q4_K_M — **8 findings; 1 adopted (core finding #1),
    7 rejected; net: NO CONTRACT SHAPE CHANGE, one strengthened precondition**
    (verbatim in `evidence/spec-review.json`, disposition below).
- Oracle: `tests/afm-internal-builder-v4.test.mjs` (protected, 10 tests).
- Fill: OpenCode, contract-first. One oracle-authoring correction was made
  before the fill settled (the lane-variant determinism fixture changed the lane
  without remapping the writes paths, producing an internally inconsistent write
  plan the module correctly refuses); the fill was never edited to make the
  oracle pass after that.

## Fill decisions (vs the skeleton that came back from Windows)

| Skeleton element | Fill decision |
|---|---|
| single-line constants | kept values exactly; formatted like rungs 1–3; the received module's identifiers were reused verbatim |
| stubs with doc comments | doc comments kept; bodies implemented per SPEC/README rules |
| helpers omitted in skeleton | added house-style `snapshot`/`plain`/`deepFreeze`/`refusal` etc. inside the pure region |
| hash in the plan step | `planStagedCompileV1` and `stagedCompilePlanHashV1` share one canonical seven-field hash, so `compilePlan.planHash` always equals the standalone function's output |
| renderer | emits the whole compilePlan (JSON stringify + parse + deepFreeze), default-exporting the frozen result |

## Verified checks (run from this work-order dir)

`node --check src/afm-internal-builder-v4.mjs && node --test tests/afm-internal-builder-v4.test.mjs` → **10/10, exit 0**.

## Grounded demo chain

`evidence/staging-demo.mjs` (real rung-1 pack → proposal → rung-2 plan → rung-3
write plan → rung-4 compile plan) writes:

- `demo-pack-grounded.json`, `demo-proposal.json`, `demo-plan.json`,
  `demo-write-plan.json`, `demo-compile-plan.json`
- `compile-plan-demo.mjs` (generated module; `node --check` PASS)
- `demo-chain-summary.txt` — planHash `53ab2955…`, stagingHash `6b29dbc9…`,
  compilePlanHash `63cd24c2…`, invoke `swiftc -c a.swift b.swift -o staged.o`,
  noNetwork true, lane `work-orders/afm-internal-builder-v4/evidence/staging/`.

## Status

Contract settled and oracle-green; whole ladder (rungs 1–4) **DRAFT — not
integrated**. Acceptance authority stays at oracle/human accept commands.

## Spec review outcome (Qwen, 8 findings — disposition)

Verdict from the lane was "CONTRACT CHANGE REQUIRED". Each finding was verified
against the module with concrete inputs. **One genuine tightening adopted;
seven findings false, category-confused, or already-documented. The compile-plan
shape, codes, hashes and paths are unchanged.**

1. **HIGH — "stagingHash not verified against the write plan's own content"** —
   **ADOPTED.** `planStagedCompileV1` now re-derives the rung-3 staging hash over
   the write plan's own six canonical fields (`writes`, `lane`, `manifestHash`,
   `packHash`, `sourcePlanHash`, `totalBytes`) and refuses `$.writePlan` when the
   carried `stagingHash` differs — a self-inconsistent or forged rung-3 ancestor
   can no longer seed a compile grant. SPEC updated; oracle fixtures rebuilt to
   derive real hashes via the rung-3 module; new refusal assertion added.
2. **HIGH — "totalBytes not checked = sum"** — REJECTED (false). Already enforced
   (`wp.totalBytes !== sum` → `$.writePlan`) and oracle-tested.
3. **HIGH — "writes path !== lane+name not rejected"** — REJECTED (false). Already
   enforced (`w.path !== wp.lane + w.name` → `$.writePlan`) and oracle-tested.
4. **MEDIUM — "writePlan.lane vs compile-policy lane mismatch"** — REJECTED
   (contract misread). The compile policy has NO lane member; the lane comes from
   the accepted rung-3 write plan, precisely so the sandbox encloses the staged
   sources.
5. **MEDIUM — "packHash not validated as hex"** — REJECTED (false). Already
   enforced (`HEX64.test(wp.packHash)` → `$.writePlan`) and oracle-tested.
6. **MEDIUM — "sourcePlanHash must equal sourceStagingHash"** — REJECTED
   (nonsensical). These pin DIFFERENT ancestors: `sourcePlanHash` is the rung-2
   plan hash, `sourceStagingHash` is the rung-3 write-plan hash; equality would
   be a collision, never a consistency property.
7. **LOW — "hash function throws instead of refusing"** — REJECTED (documented).
   The throwing contract of the hash functions is inherited verbatim from rungs
   1–3 ("outside the codec it throws a coded canonicalizeJSONV1 error"); the
   never-throws contract covers the readers/planners/renderers.
8. **LOW — "source renderer accepts ok:false results"** — REJECTED (false).
   `stagedCompilePlanSourceV1` refuses any envelope with `ok !== true` (oracle-
   tested for null, strings, and a compile-policy result).