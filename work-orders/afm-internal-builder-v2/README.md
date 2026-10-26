# AFM internal builder — rung-2 deterministic test-run grant grammar (`afm-internal-builder-v2`)

STATUS: DRAFT — filled and oracle-green on macOS, **not integrated**. Nothing here
executes code or holds acceptance authority; deterministic execution of the
rendered plans stays with oracle/human accept commands. Design:
`../afm-internal-builder-design/evidence/afm-builder-design.mjs` (capabilityLadder
rung `deterministic_test_run`, pin `test command argv + manifestHash`). Spec:
`./SPEC.md` (this directory's contract; the protected oracle is
`tests/afm-internal-builder-v2.test.mjs` — drafters must not edit it to make a
draft pass).

## Scope

Given an **accepted rung-1 proposal** (profile `nisi-afm-internal-builder-v1`) and a
**caller-consented grant policy**, produce a typed, frozen, bounded run PLAN:

- `runs` — one `{ check, argv }` per proposal `testsToRun` entry, proposal order,
  argv passed whole (no shell, no substitution).
- `manifestHash` + `packHash` — the pins the executor later verifies.
- `budget` — `{ timeoutSeconds, outputBytes }` bounded by the grant.
- `planHash` — `canonicalizeJSONV1(JSON({ runs, manifestHash, packHash, budget }))`
  sha256; independent of grant key order and check-set size.

Accepted plans render as self-contained frozen ESM module source passing
`node --check`. No process spawn, no filesystem, no network, no dynamic code —
everything except the export block sits in the pure region.

## Orchestration learnings (from the SharedChami worker, grounded)

Rung-2 mirrors the two-machine bridge's own discipline
(`chamiDATA/code-bridge/WINDOWS-WORKER-SPEC.md` + worker sources):

- explicit model routing, no silent substitution → argv arrays validated and
  passed whole; unknown check names refuse precisely (`$.testsToRun[i]`).
- 30 s heartbeat / 300 s staleness / honest `running|degraded|stopped` →
  bounded budgets enforced as exact `BUDGET` refusals; hostile inputs (getters,
  Proxies, cycles, budgets) refuse instead of throwing.
- per-lane concurrency caps and job timeouts → the grant's `timeoutSeconds`
  (≤ 300) and `outputBytes` (≤ 1048576) caps.
- temp-then-rename atomicity → every result is deep-frozen, never half-written.
- The demo grant uses the bridge's real verified checks (`windows-worker-contract.test.mjs`,
  the v1 oracle) — see evidence artifacts below.

## Provenance

- Windows barebones: inbox job `mac-20260914205036-9bdcf3c24d4231af`
  (result 36.1 s, model `Qwen3-Coder-Next 80B-A3B Q4_K_M`), preserved verbatim in
  `evidence/barebones-as-received.mjs` + `evidence/barebones-job-record.json`.
- Independent spec review: job `mac-20260914205036-af5709f3fb6d01b2` (gpt-oss-20b)
  ended with `status: "error"`, `"The operation was aborted due to timeout"`
  (300.1 s) — the lane did not serve it; recorded honestly. Fallback review job
  `mac-20260914205433-7b6bfb887ae4b508` (Qwen lane) succeeded in 90.7 s; the
  verbatim findings are in `evidence/spec-review.json`.
- Oracle + fill: OpenCode, contract-first, `node --test` 10/10 before this README.

## Spec review outcome (Qwen, 10 findings — disposition)

`evidence/spec-review.json` holds the review verbatim. Assessment against the
implemented, oracle-green grammar:

- **No contract change required.** Every finding was evaluated; outcomes:
  - #2 (JSON key order vs `planHash`) — **rejected premise**: `canonicalizeJSONV1`
    canonicalizes keys before hashing; `JSON.stringify` insertion order does not
    affect the digest.
  - #4 (NaN/Infinity/0 in budget) — **already excluded**: `Number.isSafeInteger`
    plus the `< 1` lower bound rejects all three.
  - #5 (undefined refusal precedence) — **already pinned and tested**: oracle
    asserts unknown/missing-before-values, proposal-before-grant, and the
    zero-vs-partial grant coverage rules; 10/10 green.
  - #6 (`grantPolicy.profile`) — **rejected premise**: grants carry no `profile`
    member; one would be refused as `AFM_BUILDER_V2_UNKNOWN_MEMBER`.
  - #7 (escaping) — **already correct**: `JSON.stringify` applies JSON string
    escaping for the embedded literal; verified by round-trip and `node --check`.
  - #9 (budget in `planHash`) — **deliberate**: budget is plan identity.
  - #10 (refusal path format) — **not applicable**: paths are internally
    generated, never taken from input.
  - #1 (hash binding) — **documented boundary**: the module is read-only and
    cannot resolve a manifest; `packHash` originates from the accepted proposal
    (bound to the pack it was read from) and `manifestHash` is a caller-pinned
    string carried through. Verifying both against a real manifest is the
    executor's role under the design's consent-gated model — noted below.
  - #3 (shell/flag metacharacters) — **accepted as documented scope**: argv is
    passed whole with no shell, so `;`, `|`, `&` are inert tokens; flag-style
    argument interpretation is the executor's concern at accept time.
  - #8 (UTF-8 byte vs char length) — **documented scope**: the contract is
    character-based per SPEC.md; byte-level limits are a downstream executor
    concern.

## Fill decisions (recorded)

- Refusal shape and 8 codes exactly as `SPEC.md`; unknown/missing members judged
  before values; `$.proposal` / `$.grant` settlement paths; precise
  `$.testsToRun[i]` for partially-covering grants; a grant with **zero** shared
  run targets refuses at `$.grant` (grant-vs-proposal mismatch).
- Plan keeps proposal `testsToRun` order; argv copies are frozen, so later input
  mutation cannot affect a plan.
- `planHash` is recomputable by `testRunPlanHashV1(plan)` for any produced plan;
  outside the codec grammar that helper throws a coded `canonicalizeJSONV1`
  error (same contract as rung-1's `afmBuilderPackHashV1`).
- Control chars (U+0000–U+001F, U+007F) are refused in argv entries; argv is
  arrays only — there is no shell anywhere in the grammar.

## Verification (deterministic, macOS, Node v24.18.0)

- `node --check src/afm-internal-builder-v2.mjs` — MODULE SYNTAX OK.
- `node --test tests/afm-internal-builder-v2.test.mjs` — **10/10 pass, exit 0**,
  including the never-throws adversarial set, exact codes/paths, planHash
  determinism, generated-plan-module `node --check`, and a **real rung-1 →
  rung-2 integration** that produces the accepted proposal with the actual v1
  module.

Rerun: `node --check src/afm-internal-builder-v2.mjs && node --test tests/afm-internal-builder-v2.test.mjs`.

## Evidence (grounded demo chain)

- `evidence/demo-pack-grounded.json` — state pack whose allowedChecks are the
  bridge's real check names.
- `evidence/demo-proposal.json` — accepted rung-1 proposal produced by the real
  v1 module.
- `evidence/demo-plan.json` + `evidence/plan-demo.mjs` — the typed plan and the
  generated module it renders to (`node --check` verified; planHash
  `814a992382643047…`, runs `afm-v1-oracle`, `bridge-contract`).
- `evidence/barebones-as-received.mjs`, `barebones-job-record.json` — Windows
  inputs as received.

## Not done / next

- Rung-2 remains an advisory grammar: no executor exists yet. The design's next
  rungs (scoped staging write, sandboxed compile) are untouched; any executor
  belongs behind consent and manifest pins.
- Windows-side re-verification and any integration decision belong to the owner;
  this directory is the retained record until then.