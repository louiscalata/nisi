# afm-internal-builder-v3 — rung-3 spec (scoped-staging-write grant grammar)

STATUS: DRAFT. Read-only advisory lane, third capability rung of the AFM internal
builder (design: `../afm-internal-builder-design/evidence/afm-builder-design.mjs`,
capabilityLadder rung `scoped_staging_write`, scope "Write only to paths inside the
item's lane/staging directory", pin `target path prefix + manifestHash`).
The module NEVER writes anything and NEVER holds acceptance authority: it
validates a caller-consented staging policy against an accepted rung-2 plan
result and renders a typed, frozen, bounded WRITE plan (exact target paths under
one lane prefix, per-file and total byte budgets, pins from the source plan).
Execution stays with oracle/human accept commands.

Rung-3 closes the hash-binding gap noted in the rung-2 spec review (finding #1):
the staging policy's `manifestHash` MUST equal the source rung-2 plan's
`manifestHash`, so both sides of the settlement bind to the same manifest pin.

## Module

`src/afm-internal-builder-v3.mjs`, ESM, zero dependencies. Imports only
`canonicalizeJSONV1` from `../../../canonical/canonical-json-v1.mjs`.
Whole body except the export list between `// PURE-REGION-BEGIN` and
`// PURE-REGION-END`: no process spawn, no filesystem, no network, no dynamic
code, no module load, no process mutation. Refusal strings carry only codes and
paths — never input content.

## Constants (frozen)

- `AFM_INTERNAL_BUILDER_V3_PROFILE = 'nisi-afm-internal-builder-v3'`
- `AFM_INTERNAL_BUILDER_V3_LIMITS_V1 = Object.freeze({
    files: 32, writesPerPlan: 3, nameLength: 64, laneLength: 96,
    bytesPerFile: 262144, bytesTotal: 1048576 })`
- `AFM_INTERNAL_BUILDER_V3_CODES_V1 = Object.freeze([
    'AFM_BUILDER_V3_NOT_OBJECT', 'AFM_BUILDER_V3_UNKNOWN_MEMBER',
    'AFM_BUILDER_V3_MISSING_MEMBER', 'AFM_BUILDER_V3_STAGING',
    'AFM_BUILDER_V3_FILE', 'AFM_BUILDER_V3_BUDGET',
    'AFM_BUILDER_V3_PIN', 'AFM_BUILDER_V3_WRITE' ])`

## Refusal shape

`Object.freeze({ ok: false, profile, code, path })`. Every public function never
throws; hostile inputs (accessors, Proxies, cycles, budget overruns,
non-plain structures) refuse like rungs 1–2's snapshot walk as
`AFM_BUILDER_V3_NOT_OBJECT` at `$` unless a more specific rule applies.

## Staging policy (caller consents)

```
{ lane: "<prefix>", files: { "<name>": <plannedBytes:int> }, manifestHash: "<64-hex>" }
```

- `lane`: non-empty string ≤ 96 chars, no control chars, no leading `/`, not `.`,
  and no `..` substring anywhere. Copy verbatim — no normalization. This is the
  "target path prefix" pin.
- `files`: plain object, 1..32 entries. Name: non-empty string ≤ 64 chars, no `/`,
  no `..` substring, no control chars, not `.` or `..`. Value: safe integer
  1..262144 (planned bytes for the write). Sum of all values ≤ 1048576.
- `manifestHash`: exact 64-lowercase-hex string. Must equal the source rung-2
  plan's `manifestHash` at plan time (else refusal PIN `$.manifestHash`).

## Functions (4, skeleton mirrors rungs 1–2)

1. `readStagingPolicyV1(input)` →
   `Object.freeze({ ok: true, profile, stagingPolicy })` (deep-frozen; names
   copied in insertion order) or refusal. Paths and codes: `$`
   NOT_OBJECT (non-plain/non-object); `$.lane` STAGING (bad lane prefix);
   `$.files` STAGING (container problems: not plain, empty, too many entries);
   `$.files` FILE (bad file name: empty, `> nameLength`, contains `/`, control
   chars, or equals `.` / `..` — the name itself cannot be addressed safely);
   `$.files.<name>` BUDGET (bad planned bytes: not a safe integer, `< 1`, or
   `> bytesPerFile`); `$.files` BUDGET (sum of planned bytes `> bytesTotal`);
   `$.manifestHash` PIN (bad pin format).
2. `planStagingWritesV1(planResult, stagingPolicy)` →
   `Object.freeze({ ok: true, profile, writePlan })` or refusal
   (code `AFM_BUILDER_V3_WRITE`):
   - `planResult` must be an ACCEPTED rung-2 plan result (profile
     `nisi-afm-internal-builder-v2`, `ok === true`, plan with exactly
     `runs` (1..3 entries, each `{ check, argv }` re-validated), `manifestHash`,
     `packHash`, `budget`, `planHash`, all re-validated; pin/budget values: all
     64-lowercase-hex, `budget.timeoutSeconds` safe integer 1..300 (rung-2
     boundary), `budget.outputBytes` safe integer 1..bytesTotal).
     Problems → `$.plan`.
   - `stagingPolicy` re-read through rule 1; problems → `$.staging`.
   - `stagingPolicy.manifestHash` must equal `planResult.plan.manifestHash`,
     else → `$.manifestHash`.
   - writePlan =
     `{ writes: [ { path: lane + name, name, bytes } … ], lane, manifestHash,
        packHash, sourcePlanHash, totalBytes, stagingHash }`
     in policy `files` insertion order, limited to `writesPerPlan` (3) entries.
   - `totalBytes` = sum of the planned bytes of the written files.
   - `stagingHash = canonicalizeJSONV1(Buffer.from(JSON.stringify(
       { writes, lane, manifestHash, packHash, sourcePlanHash, totalBytes }))).sha256`.
3. `stagingWritePlanHashV1(writePlan)` → 64-hex over the same canonical fields.
   Only meaningful for a writePlan produced by rule 2; outside the codec grammar
   it throws a coded `canonicalizeJSONV1` error (same contract as rungs 1–2).
4. `stagingWritePlanSourceV1(writePlanResult)` → ESM module source
   (self-contained, double-JSON-escaped, default-exports the deep-frozen result,
   always passes `node --check`) or refusal `AFM_BUILDER_V3_WRITE` at `$`;
   never throws.

## Deterministic checks (after fill)

- `node --check src/afm-internal-builder-v3.mjs`
- `node --test tests/afm-internal-builder-v3.test.mjs` (protected oracle;
  adversarial never-throws set, exact codes/paths, determinism, generated-module
  `node --check`, and a real rung-1 → rung-2 → rung-3 integration chain).

## Provenance

- Windows barebones: job id in `evidence/barebones-request-id.txt`; result in
  `evidence/barebones-as-received.mjs` + `evidence/barebones-job-record.json`.
- Oracle + fill: OpenCode, contract-first. Protected: oracle not edited to make
  the draft pass.