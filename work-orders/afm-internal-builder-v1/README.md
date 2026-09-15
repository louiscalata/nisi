# AFM internal builder — first increment (`afm-internal-builder-v1`)

STATUS: DRAFT — filled and oracle-green on macOS, **not integrated**. Nothing here is
compiled into a receipt or accepted by an oracle/human accept command. Design is
`../afm-internal-builder-design/evidence/afm-builder-design.mjs` with
`../afm-internal-builder-design/evidence/state-pack.demo.json`.

## Scope (first increment — read-only advisory lane)

Given a validated Nisi state pack, a deterministic caller-provided policy yields a
typed Proposal (one allowed step, up to three allowed checks, an explanation, and
the pack hash), and an accepted proposal can be rendered as a self-contained frozen
ESM module source that passes `node --check`. No writes, no compilation, no network,
no model calls, no acceptance authority. Nothing touches the frozen Veritas import
(`integrations/veritas/` stays off-limits per `../afm-internal-builder-opencode-20260914/README.md`).

## Provenance

- Windows barebones: inbox job `mac-20260914-123639-6c18f96be518435044d4f68932f2c828`
  (result 76.2 s, model `Qwen3-Coder-Next 80B-A3B Q4_K_M`), preserved verbatim in
  `evidence/barebones-as-received.mjs` + `evidence/barebones-job-record.json`.
- Fill: macOS implementation of the four stubbed functions plus constants, written
  contract-first against `tests/afm-internal-builder-v1.test.mjs` (protected oracle —
  drafters must not edit it to make a draft pass).
- Pure region: `src/afm-internal-builder-v1.mjs` keeps all logic and constants inside
  `// PURE-REGION-BEGIN/END`; the `export {}` block sits after the region.

## Fill decisions (recorded)

- `roadmapDigest` value refusals use the `AFM_BUILDER_PROJECT` code (path
  `$.roadmapDigest`).
- `afmBuilderPackHashV1` hashes the five identity members only
  (`allowedChecks`, `allowedSteps`, `project`, `roadmapDigest`, `workOrder`);
  `lastReceipts` is history, not identity, and is excluded.
- Policy shape is exactly `{ step, checks, explanation }`; unknown members refuse
  before missing members, values after.
- Strings are the only snapshot leaves; accessors/symbols/exotic arrays/cycles and
  snapshot budget overruns (depth 8, nodes 1024) refuse the whole input as
  `AFM_BUILDER_NOT_OBJECT` — getters and Proxy traps can never make the reader throw.
- Reader refuses duplicates at the array path (`$.allowedSteps`) and non-string
  entries at the index path (`$.allowedSteps[1]`); lastReceipts has no uniqueness
  requirement.
- A policy whose raw member access throws (e.g. a Proxy with a throwing `get` trap)
  refuses at `$`, guarded by a bounded try/catch probe; missing plain members stay
  precise (`$.checks`).
- Acceptance authority is deliberately absent: `propose*`/readers only validate and
  advise; step/check acceptance remains with oracle/human accept commands.

## Verification (deterministic, macOS)

- `node --check src/afm-internal-builder-v1.mjs` — MODULE SYNTAX OK.
- `node --test tests/afm-internal-builder-v1.test.mjs` — 10/10 pass, exit 0,
  including the adversarial never-throws set and the generated proposal module
  passing `node --check` via a temp file (Node v24.18.0).

Rerun from this directory with: `node --check src/afm-internal-builder-v1.mjs &&
node --test tests/afm-internal-builder-v1.test.mjs`.

## Verified against the design demo pack

`../afm-internal-builder-design/evidence/state-pack.demo.json` smoke test (state as authored):
- As-is, it **refuses** with `AFM_BUILDER_PROJECT / $.roadmapDigest`: its slug
  `open-3-of-10-nx-internal-builder-v0` is not a 64-hex digest. The design spec
  (`afm-builder-design.mjs`) never specifies the digest format; the fill requires
  sha256-hex, consistent with every digest elsewhere in the tree (packHash,
  manifestHash). The demo file is stale evidence — owner decision to backfill a
  real digest or relax the format.
- With a backfilled 64-hex digest the full demo shape reads, proposes
  (`implement` / `swift-build,unit-01` / deterministic packHash
  `63aecabb…c138c0b`), and the generated proposal module passes `node --check`.
- Retained review artifacts: `evidence/demo-proposal.json` (the typed proposal,
  reviewable against `../afm-internal-builder-design/evidence/state-pack.demo.json`)
  and `evidence/proposal-demo.mjs` (the self-contained frozen module it renders to).

## Not done / next rung

- First capability increment only; the design's next rungs (deterministic test-run
  grant for the proposal's `testsToRun`, and only then build receipts) are untouched.
- Windows re-verification and any integration decision belong to the owner; this
  directory is the retained record until then.