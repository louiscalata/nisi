# afm-internal-builder-v4 — rung-4 spec (staged-swift-compile grant grammar)

STATUS: DRAFT. Read-only advisory lane, fourth capability rung of the AFM
internal builder (design: `../afm-internal-builder-design/evidence/afm-builder-design.mjs`,
capabilityLadder rung `staged_swift_compile`, scope "Invoke swiftc/build actions
in a sandbox on staged sources, no network", pin
`compiler invocation + source hashes + manifestHash`).
The module NEVER invokes anything and NEVER holds acceptance authority: it
validates a caller-consented compile policy against an accepted rung-3 write
plan and renders a typed, frozen, bounded COMPILE plan (exact `swiftc` argv, no
shell, no network, source files that were staged by the rung-3 plan, output
artifact inside the same lane, sha256 source pins, budgets, and chained pins
from the source write plan). Execution stays with consent-gated oracle/human
accept commands.

Rung-4 continues the binding chain: the compile policy's `manifestHash` MUST
equal the rung-3 write plan's `manifestHash` (cross-rung pin), and every compile
source MUST be a file the rung-3 write plan staged (name match against
`writePlan.writes`). The compile plan carries `sourceStagingHash` + `packHash`
so any accept command can verify the exact write plan the compile was derived
from, and `noNetwork: true` is part of the rendered contract.

## Module

`src/afm-internal-builder-v4.mjs`, ESM, zero dependencies. Imports only
`canonicalizeJSONV1` from `../../../canonical/canonical-json-v1.mjs`.
Whole body except the export list between `// PURE-REGION-BEGIN` and
`// PURE-REGION-END`: no process spawn, no filesystem, no network, no dynamic
code, no module load, no process mutation. Refusal strings carry only codes and
paths — never input content.

## Constants (frozen)

- `AFM_INTERNAL_BUILDER_V4_PROFILE = 'nisi-afm-internal-builder-v4'`
- `AFM_INTERNAL_BUILDER_V4_LIMITS_V1 = Object.freeze({
    sources: 8, sourceNameLength: 64, argvMax: 16, argvEntryLength: 128,
    invokeTimeoutSeconds: 300, outputBytes: 1048576, compilerNameLength: 64,
    outputNameLength: 64, laneLength: 96 })`
- `AFM_INTERNAL_BUILDER_V4_CODES_V1 = Object.freeze([
    'AFM_BUILDER_V4_NOT_OBJECT', 'AFM_BUILDER_V4_UNKNOWN_MEMBER',
    'AFM_BUILDER_V4_MISSING_MEMBER', 'AFM_BUILDER_V4_COMPILE',
    'AFM_BUILDER_V4_COMMAND', 'AFM_BUILDER_V4_BUDGET',
    'AFM_BUILDER_V4_PIN', 'AFM_BUILDER_V4_INVOKE' ])`

## Refusal shape

`Object.freeze({ ok: false, profile, code, path })`. Every public function never
throws (descriptor-walk snapshot hardening as rungs 1–3). Hostile inputs refuse
`AFM_BUILDER_V4_NOT_OBJECT` at `$` unless a more specific rule applies.

## Compile policy (caller consents)

```
{ invoke: ["swiftc", "<flag>", ...], sources: { "<name>": "<sha256-hex>" }, output: "<name>", manifestHash: "<64-hex>", budget: { timeoutSeconds, outputBytes } }
```

- `invoke`: array 1..16 non-empty strings ≤ 128 chars, no control chars. The
  FIRST entry is the compiler binary name: must be exactly `swiftc` (this rung
  is scoped to swiftc-style invocations; no shell, no separators — the invoke
  array is the complete argv of the sandboxed command).
- `sources`: plain object, 1..8 entries. Name: non-empty string ≤ 64 chars, no
  `/`, no `..`, no control, not `.` or `..`. Value: exact 64-lowercase-hex
  sha256 pin of the staged source file.
- `output`: non-empty string ≤ 64 chars, name rules as sources; the compiled
  artifact name written inside the lane.
- `manifestHash`: exact 64-lowercase-hex. Must equal the accepted rung-3 write
  plan's `manifestHash` at plan time (else refusal PIN `$.manifestHash`).
- `budget`: `{ timeoutSeconds }` safe int 1..300 (rung boundary),
  `outputBytes` safe int 1..1048576.

## Functions (4, skeleton mirrors rungs 1–3)

1. `readCompilePolicyV1(input)` →
   `Object.freeze({ ok: true, profile, compilePolicy })` (deep-frozen, insertion
   order) or refusal. Paths: `$` NOT_OBJECT; `$.invoke` COMPILE (not an array /
   empty / > argvMax); `$.invoke[0]` COMMAND (not exactly `swiftc`);
   `$.invoke[i]` COMMAND (bad entry string); `$.sources` COMPILE (container/key
   problems); `$.sources.<name>` PIN (bad source hash); `$.output` COMPILE (bad
   name); `$.manifestHash` PIN (bad format); `$.budget` COMPILE (container) /
   `$.budget.timeoutSeconds` BUDGET / `$.budget.outputBytes` BUDGET.
2. `planStagedCompileV1(writePlanResult, compilePolicy)` →
   `Object.freeze({ ok: true, profile, compilePlan })` or refusal
   (code `AFM_BUILDER_V4_INVOKE`):
   - `writePlanResult` must be an ACCEPTED rung-3 write-plan result (profile
     `nisi-afm-internal-builder-v3`, `ok === true`, writePlan fully re-validated:
     exactly `{ writes, lane, manifestHash, packHash, sourcePlanHash, totalBytes,
     stagingHash }`, lanes/names/bytes/budget rules as rung-3). Ancestor
     binding: the write plan's `stagingHash` MUST equal the sha256 recomputed
     over its OWN `{ writes, lane, manifestHash, packHash, sourcePlanHash,
     totalBytes }` (the rung-3 staging-hash formula), so a self-inconsistent or
     forged ancestor result refuses at `$.writePlan` (adopted from the rung-4
     spec review, core finding #1). Problems → `$.writePlan`.
   - `compilePolicy` re-read through rule 1; problems → `$.compile`.
   - Cross-rung pins: `compilePolicy.manifestHash` must equal
     `writePlan.writePlan.manifestHash`, else → `$.manifestHash`.
   - Every compile source `name` must be staged by the write plan
     (`writePlan.writes` name set), else → `$.sources.<name>`.
   - The compile output name must NOT collide with a staged source name (else an
     accept command could overwrite a pinned input), else → `$.output`.
   - compilePlan =
     `{ invoke, sources: [ { name, path: lane + name, sha256 } … ] (policy
        insertion order), output: { name, path: lane + name }, lane, manifestHash,
        packHash, sourceStagingHash, planHash, budget, noNetwork: true }`.
   - `planHash = canonicalizeJSONV1(Buffer.from(JSON.stringify(
       { invoke, sources, output, lane, manifestHash, packHash, sourceStagingHash }))).sha256`.
3. `stagedCompilePlanHashV1(compilePlan)` → 64-hex over the same canonical
   fields; outside the codec grammar it throws a coded `canonicalizeJSONV1`
   error (same contract as rungs 1–3).
4. `stagedCompilePlanSourceV1(compilePlanResult)` → ESM module source
   (self-contained, double-JSON-escaped, default-exports the deep-frozen
   result, always passes `node --check`) or refusal `AFM_BUILDER_V4_INVOKE` at
   `$`; never throws.

## Deterministic checks (after fill)

- `node --check src/afm-internal-builder-v4.mjs`
- `node --test tests/afm-internal-builder-v4.test.mjs` (protected oracle;
  adversarial never-throws set, exact codes/paths, determinism, generated-module
  `node --check`, and a real rung-1 → rung-2 → rung-3 → rung-4 integration
  chain whose staged lane mirrors rung-3's demo evidence).

## Provenance

- Windows barebones: job id in `evidence/barebones-request-id.txt`; result in
  `evidence/barebones-as-received.mjs` + `evidence/barebones-job-record.json`.
- Oracle + fill: OpenCode, contract-first. Protected: oracle not edited to make
  the draft pass.