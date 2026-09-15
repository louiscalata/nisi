# afm-internal-builder-v2 — rung-2 spec (deterministic test-run grant grammar)

STATUS: DRAFT. Read-only advisory lane, second capability rung of the AFM internal
builder (design: `../afm-internal-builder-design/evidence/afm-builder-design.mjs`,
capabilityLadder rung `deterministic_test_run`, pin `test command argv + manifestHash`).
The module NEVER runs tests and NEVER holds acceptance authority: it only
validates a caller-consented grant policy and renders a typed, bounded,
deterministic run plan for an accepted v1 proposal. Execution stays with
oracle/human accept commands (receiptIntegration / guardrails of the design).

## Module

`src/afm-internal-builder-v2.mjs`, ESM, zero dependencies. Imports only
`canonicalizeJSONV1` from `../../../canonical/canonical-json-v1.mjs`.
Whole body except the export list between `// PURE-REGION-BEGIN` and
`// PURE-REGION-END`: no process spawn, no filesystem, no network, no dynamic
code, no module load, no process mutation. Refusal strings carry only codes and
paths — never input content.

## Constants (frozen)

- `AFM_INTERNAL_BUILDER_V2_PROFILE = 'nisi-afm-internal-builder-v2'`
- `AFM_INTERNAL_BUILDER_V2_LIMITS_V1 = Object.freeze({
    checks: 32, checksPerPlan: 3, checkNameLength: 64,
    argvMax: 8, argvEntryLength: 128,
    timeoutSeconds: 300, outputBytes: 1048576 })`
- `AFM_INTERNAL_BUILDER_V2_CODES_V1 = Object.freeze([
    'AFM_BUILDER_V2_NOT_OBJECT', 'AFM_BUILDER_V2_UNKNOWN_MEMBER',
    'AFM_BUILDER_V2_MISSING_MEMBER', 'AFM_BUILDER_V2_GRANT',
    'AFM_BUILDER_V2_COMMAND', 'AFM_BUILDER_V2_BUDGET',
    'AFM_BUILDER_V2_PIN', 'AFM_BUILDER_V2_PLAN' ])`

## Refusal shape

`Object.freeze({ ok: false, profile, code, path })`. Every public function never
throws; hostile inputs (accessors, Proxies, cycles, budget overruns,
non-plain structures) refuse like v1's snapshot walk as `AFM_BUILDER_V2_NOT_OBJECT`
at `$` unless a more specific rule applies.

## Grant policy (caller consents)

```
{ checks: { "<name>": ["<argv0>", "…"] }, manifestHash: "<64-hex>",
  budget: { timeoutSeconds: <int 1..300>, outputBytes: <int 1..1048576> } }
```

- `checks`: plain object, 1..32 entries; key non-empty string ≤ 64 chars; value
  is a plain array 1..8 entries, each a non-empty string ≤ 128 chars containing
  no control characters (U+0000–U+001F, U+007F). argv[0] is the executable
  (same entry rule). There is no shell: argv arrays are passed whole.
- `manifestHash`: exact 64-lowercase-hex string.
- `budget`: plain object, exactly the two members.

## Functions (4, skeleton mirrors v1)

1. `readTestRunGrantV1(input)` → `Object.freeze({ ok: true, profile, grant })`
   (grant deep-frozen: keys of `checks` copied in insertion order) or refusal.
   Paths: `$` non-plain/not-object; `$.checks` / `$.budget` shape problems;
   `$.checks.<name>` bad command and `$.checks.<name>[i]` bad argv entry;
   `$.budget.timeoutSeconds` / `$.budget.outputBytes` bad or over cap;
   `$.manifestHash` bad pin. Codes: `GRANT` for check-set/budget container
   shape, `COMMAND` for a bad command, `BUDGET` for a bad budget value,
   `PIN` for a bad pin.
2. `planDeterministicTestRunV1(proposalResult, grantPolicy)` →
   `Object.freeze({ ok: true, profile, plan })` or refusal
   (code `AFM_BUILDER_V2_PLAN`):
   - `proposalResult` must be an ACCEPTED v1 proposal result
     (`ok === true`, profile `nisi-afm-internal-builder-v1`, proposal with
     `proposedStep`, `testsToRun`, `explanation`, `packHash`), re-validated;
     `packHash` must be 64-hex. Problems → `$.proposal`.
   - `grantPolicy` re-read through rule 1; problems → `$.grant`.
   - For each `testsToRun[i]`, the name must be a key of `grant.checks` or the
     plan refuses at `$.testsToRun[i]` (proposal order preserved).
   - plan =
     `{ runs: [{ check: <name>, argv: [<copied>] }, …], manifestHash, packHash,
        budget: { timeoutSeconds, outputBytes }, planHash }`
   - `planHash = canonicalizeJSONV1(Buffer.from(JSON.stringify(
       { runs, manifestHash, packHash, budget }))).sha256` — canonicalized,
     deterministic, and independent of the grant's checks set and key order.
3. `testRunPlanHashV1(plan)` → 64-hex over the same five canonical fields.
   Only meaningful for a plan produced by rule 2; outside the codec grammar it
   throws a coded `canonicalizeJSONV1` error (same contract as v1's pack hash).
4. `testRunPlanSourceV1(planResult)` → ESM module source (self-contained,
   double-JSON-escaped, default-exports the deep-frozen result, always passes
   `node --check`) or refusal `AFM_BUILDER_V2_PLAN` at `$`; never throws.

## Deterministic checks (after fill)

- `node --check src/afm-internal-builder-v2.mjs`
- `node --test tests/afm-internal-builder-v2.test.mjs` (protected oracle;
  adversarial never-throws set, exact codes/paths, determinism, generated-module
  `node --check`)

## Provenance

- Windows barebones: job `mac-20260914-<ts>-<id>` (see evidence/
  barebones-job-record.json; result in evidence/barebones-as-received.mjs).
- Independent spec review: job `mac-20260914-<ts>-<id>` (gpt-oss-20b), findings
  in evidence/spec-review.json, incorporated into the oracle where correct.
- Oracle + fill: OpenCode, contract-first. Protected: oracle not edited to make
  the draft pass.