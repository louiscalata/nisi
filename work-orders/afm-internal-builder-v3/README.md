# afm-internal-builder-v3 — rung-3 (scoped-staging-write grant grammar)

STATUS: **DRAFT — not integrated.** Read-only advisory lane, third rung of the
AFM internal builder ladder (design: `../afm-internal-builder-design/evidence/afm-builder-design.mjs`,
rung `scoped_staging_write`, pin `target path prefix + manifestHash`).

The module **never writes anything, never executes anything, and never holds
acceptance authority**. It validates a caller-consented staging policy against
an accepted rung-2 plan result and renders a typed, frozen, bounded WRITE plan:
exact target paths under one lane prefix, per-file and total byte budgets, pins
(`manifestHash`, `packHash`, `sourcePlanHash`) an oracle/human accept command
can verify later. Execution of the writes stays with consent-gated accept
commands.

## What the module exports

- `readStagingPolicyV1(input)` — validated, deep-frozen `{ lane, files, manifestHash }`.
- `planStagingWritesV1(planResult, stagingPolicy)` → frozen `{ ok, profile, writePlan }`
  where `writePlan = { writes, lane, manifestHash, packHash, sourcePlanHash, totalBytes, stagingHash }`.
- `stagingWritePlanHashV1(writePlan)` — deterministic sha256 over the six
  canonical fields `{ writes, lane, manifestHash, packHash, sourcePlanHash, totalBytes }`
  (canonicalized JSON; key order irrelevant, array order relevant).
- `stagingWritePlanSourceV1(writePlanResult)` — self-contained frozen ESM module
  source that always passes `node --check`.

Profile `nisi-afm-internal-builder-v3`; limits `{ files: 32, writesPerPlan: 3,
nameLength: 64, laneLength: 96, bytesPerFile: 262144, bytesTotal: 1048576 }`.

## Key contract rules (how to read a refusal)

- Refusal: frozen `{ ok: false, profile, code, path }`; 8 codes; **never throws**
  (descriptor-walk snapshot: getters, Proxy traps, cycles, exotic arrays all refuse).
- Codes: `NOT_OBJECT` (hostile/non-plain input), `UNKNOWN_MEMBER` / `MISSING_MEMBER`
  (member set, checked before values), `STAGING` (lane/container problems),
  `FILE` (bad file name at `$.files` — the name itself cannot be addressed safely),
  `BUDGET` (bad planned bytes `$.files.<name>`, or sum over `bytesTotal` at `$.files`),
  `PIN` (bad `manifestHash` format), `WRITE` (write-plan settlement refusals).
- Settlement refusals: plan-result problems → `$.plan`; staging-policy problems →
  `$.staging`; **cross-input pin mismatch → `$.manifestHash`** (the staging policy's
  `manifestHash` MUST equal the accepted rung-2 plan's `manifestHash`).
- Lane rules: non-empty ≤ 96 chars, no control chars, not `.`, no leading `/`,
  no `..` anywhere; copied verbatim, never normalized. File names: non-empty ≤ 64,
  no `/`, no `..`, no control chars, not `.`/`..`, not `__proto__`/`constructor`.
- `writesPerPlan` (3) caps how many policy files the write plan carries; `totalBytes`
  is the sum of the **written** files only.
- `stagingWritePlanHashV1` outside the codec throws a coded `canonicalizeJSONV1`
  error (same contract as rung-1 pack hash / rung-2 plan hash).

## Why rung-3 exists (what it closes)

The rung-2 spec review noted finding #1: the plan's hashes are not bound to an
execution-accepting surface. Rung-3 implements the binding **between both sides
of the settlement**: the staging policy's manifest pin must equal the source
plan's manifest pin (`$.manifestHash` refusal otherwise), and the write plan
carries `sourcePlanHash` + `packHash` so any accept command can verify the exact
plan result the writes were derived from.

Rung-3 also applies the write-side budget discipline the bridge worker enforces
on its own files: per-file caps, a total cap, exact target paths (no `..`, no
absolute paths, no normalization surprises), and atomic replace semantics belong
to the acceptance command (temp-then-rename), not to this planner.

## Provenance

- Work order: `work-orders/afm-internal-builder-v3` in `/Users/louiscalata/nisi-next-private`.
- Windows barebones (modelled by the worker, filled by the Mac):
  - job `mac-20260914212038-687d1d6fd051086e` — **success**,
    Qwen3-Coder-Next 80B-A3B Q4_K_M (not shown: elapsed) — see
    `evidence/barebones-job-record.json` and `evidence/barebones-as-received.mjs`.
- Independent spec review:
  - job `mac-20260914224520-dafe1b303b2eb9b9` — **success**, 61.1 s,
    Qwen3-Coder-Next 80B-A3B Q4_K_M — **7 findings, verdict "CONTRACT CHANGE
    REQUIRED"; after per-finding disposition: NO CONTRACT CHANGE REQUIRED** (all
    seven findings false, category-confused, or already-documented; verbatim in
    `evidence/spec-review.json`, disposition below).
- Oracle: `tests/afm-internal-builder-v3.test.mjs` (protected, 10 tests).
- Fill: OpenCode, contract-first. The oracle was corrected only for authoring
  defects before the fill settled (sum-overflow fixture per-file bound, a
  determinism assertion that would have crashed, and the real v1 pack exposing
  `packHash` rather than `manifestHash`); the fill was never edited to make the
  oracle pass after that.

## Fill decisions (vs the skeleton that came back from Windows)

| Skeleton element | Fill decision |
|---|---|
| single-line constants | kept values exactly; formatted like rungs 1–2; the received module's identifiers were reused verbatim |
| stubs with doc comments | doc comments kept; bodies implemented per SPEC/README rules |
| helpers omitted in skeleton | added house-style `snapshot`/`plain`/`deepFreeze`/`refusal` etc. inside the pure region |
| hash in the plan step | `planStagingWritesV1` and `stagingWritePlanHashV1` share one canonical six-field hash, so `writePlan.stagingHash` always equals the standalone function's output |
| renderer | emits only the writePlan (not the envelope), so the default export is the frozen `writePlan` (matches the oracle round-trip) |

## Verified checks (run from this work-order dir)

`node --check src/afm-internal-builder-v3.mjs && node --test tests/afm-internal-builder-v3.test.mjs` → **10/10, exit 0**.

## Grounded demo chain

`evidence/staging-demo.mjs` (real rung-1 pack → real rung-1 proposal → real
rung-2 plan → real rung-3 write plan) writes:

- `demo-pack-grounded.json`, `demo-proposal.json`, `demo-plan.json`, `demo-write-plan.json`
- `write-plan-demo.mjs` (generated module; `node --check` PASS)
- `demo-chain-summary.txt` — planHash `d3887b55…`, stagingHash `d9e8e813…`,
  lane `work-orders/afm-internal-builder-v3/evidence/`, totalBytes 3072.

## Status

Both-facing contract is settled and oracle-green. Remaining: independent spec-review
verdict + disposition, then the whole tree (rungs 1–3) stays DRAFT-not-integrated
with acceptance authority at oracle/human accept commands.

## Spec review outcome (Qwen, 7 findings — disposition, no contract change)

Verdict from the lane was "CONTRACT CHANGE REQUIRED". Each finding was verified
against the module with concrete inputs; every one is false, category-confused,
or explicitly documented. **NO CONTRACT CHANGES APPLIED.**

1. **HIGH — "planStagingWritesV1 does not enforce writes ≤ 3"** — REJECTED. The
   cap is enforced at the write-plan step (`Object.keys(policy.files).slice(0, writesPerPlan)`),
   proven by the oracle (4-file policy → exactly 3 writes) and by direct probe
   (writes.length === 3). The "trigger" describes runs[0].argv as if it carried
   files — category confusion; the run command vector has nothing to do with the
   file set.
2. **HIGH — "stagingHash not order-canonical → violates determinism"** — REJECTED.
   Determinism means same inputs → same hash, which holds (fixed-shape object
   literal + canonicalizeJSONV1). Order-SENSITIVITY is intended and documented:
   the write plan is an ordered sequence (files insertion order → writes array),
   exactly like rung-2's runs ordering (oracle-tested at both rungs). Two policies
   with the same files in different order produce different plans by design.
3. **MEDIUM — "source renderer throws on BigInt / non-serializable values"** — REJECTED.
   `stagingWritePlanSourceV1` never reaches `JSON.stringify` with an unvalidated
   value: every field (bytes, names, hex pins, totals) is checked first, so a
   hostile `bytes: 1n` yields the frozen `WRITE` refusal at `$` (probe-verified).
   `JSON.stringify` cannot throw on the validated result.
4. **MEDIUM — "lane 'a//b' accepted → path safety"** — REJECTED. Lane is a
   verbatim opaque prefix: `a//b/` resolves to the same directory as `a/b/` (no
   traversal, no absolute root). Banning `//` would be arbitrary; the hard rules
   (no leading `/`, no `..`, no control) are the safety boundary, and the README
   documents "copied verbatim, never normalized". Verified ACCEPTED with a probe
   — benign, deliberate.
5. **MEDIUM — "budget.outputBytes should bound file bytes"** — REJECTED
   (category confusion). `outputBytes` is the rung-2 RUN-output cap; staged
   artifact sizes are bounded by `bytesPerFile` (262144) and `bytesTotal` —
   independent, by design. Probe: a 262145-byte file is refused
   (`$.staging`) regardless of `outputBytes`.
6. **LOW — "hash throws coded error outside codec, ambiguous"** — REJECTED. The
   throw contract is inherited verbatim from rungs 1–2 (`canonicalizeJSONV1`
   coded error, documented in this README and both prior SPECs); the function is
   only ever called on plans this module produced.
7. **LOW — "totalBytes sums only written files → ambiguity"** — REJECTED. The
   rule is explicit in SPEC and README ("totalBytes = sum of the planned bytes of
   the WRITTEN files"); the reader's scenario is impossible anyway — a policy
   with 3×500000-byte files is refused at READ time (per-file cap first), so no
   plan can ever reference an un-writable over-budget file set.