# Packet merge — Nisi Render Engine packets → Nisi Render Engine

Date: 2026-09-19. Author: local implementation subagent (read-only review +
additive merge). Source: all packets connected to the Nisi Render Engine
(`.packets/` in the canonical checkout and the SharedChami snapshot
`Nisi/v0.2/forged-render-engine/.packets/`).

## 1. Method and honesty floor

- Every render-engine packet inventory-wise is covered: 4 packet files + 1
  receipt.
- No packet was executed or forced in this pass. The three unrun packets are
  **blocked** with `CONFIRMED_FAILURE_TIMEOUT_BLOCKED` (local `qwen3.8-27b`
  route, returncode -15 / SIGTERM, pipes EOF, process group exited) recorded
  in `.packet-diagnostics/execution-result-*.json` on 2026-09-18; they were
  **never successfully executed** and their content is design material, not
  accepted work.
- This document merges only design/useful content into this folder. It makes
  no gate, certification, native, signing, installation or release claim for
  the Nisi render engine.

## 2. Inventory

| packet | status | sha256 (canonical file) | execution truth |
|---|---|---|---|
| `forged-gate-truth-01.packet.md` | blocked | `ea106d6b…e576b` | never fulfilled; timeout-blocked 2026-09-18T17:21:59-0700 |
| `forged-gate-truth-02.packet.md` | blocked | `92d07e43…93f13` | never fulfilled; timeout-blocked 2026-09-18T21:24:53-0700 |
| `forged-fix-failure-triage.packet.md` | blocked | `6ca1cf2d…9e735` | never fulfilled; timeout-blocked 2026-09-18T21:51:00-0700 |
| `macos-resync-test-commands.packet.md` | done | `e1611fda…59e` | P1/P2 DONE exit 0, verified by packet-receipt 2026-09-05 |
| `macos-resync-test-commands.result.md` | receipt | `a2bb19c2…2c421` | deterministic receipt |

## 3. Extracted useful content

### 3.1 `forged-gate-truth-01` — documented-gate verifier (metadata only)

The card's core design, restated: a dependency-free deterministic verifier
reads `package.json` scripts and `README.md`, extracts every documented gate
command of the form `npm run test:<name>`, and reports per row
`MISSING_SCRIPT` / `MALFORMED_ROW` / `NO_COUNT`; exit nonzero on any drift,
zero when every documented gate resolves; JSON summary carries
`metadataOnly: true`, `gatesExecuted: 0`; and its own output must state it
verified metadata only and executed no gate. Boundary: it must never claim a
gate passed and never be presented as release qualification. Claim ceiling
language: "documented gate commands must exist as metadata."

### 3.2 `forged-gate-truth-02` — STATUS command-anchor audit (metadata only)

For every `STATUS.md` line naming `npm run test:<name>` or `npm test`, report
`RESOLVED` / `MISSING_SCRIPT` / `UNPARSED_ROW` / `NO_ANCHOR` against the real
`package.json`; exit nonzero on any missing/unparsed/anchorless count; it
never edits `STATUS.md` and never declares a claim false on its own. Basis
line: "`STATUS.md` is the engineering-evidence truth. A status row that
claims verified behaviour without naming a command that exists is exactly the
overstatement that a metadata audit can catch deterministically."

### 3.3 `forged-fix-failure-triage` — failure taxonomy and triage record

- Measured tree state: `npm test` RED, 878 tests / 857 pass / 17 fail across
  15 files; six failures named prerequisite-bound (`prepared bundled Node
  cache required`, `FORGED_NODE_RUNTIME_CACHE`), `macos-renderer-*` failures
  native-artifact-bound.
- Cause classes: `code` | `prerequisite-env` | `pending-native`.
- Triage-record contract: one row per failing file with exact failing test
  name, exact assertion text, cause class, exact single-file reproduction
  command, and — for every non-`code` row — a concrete non-empty blocker.
- Repair rule: smallest change that satisfies the test's documented intent;
  **never weaken a test to clear a row**; reclassify rather than repair when a
  native build, installer, environment cache or package change would be
  required; assertion counts per file are compared before/after.

### 3.4 `macos-resync-test-commands` — command-definition precedent

- Additive command-definition card discipline (approved card
  MAC-RESYNC-GATES-01, order 26; sole-writer transfer; claim/ACTIVE ledger
  record). Current host facts: macOS arm64, Node 24.18.0, Xcode 27.0.
- Pinned Node runtime cache is caller-supplied environment
  (`FORGED_NODE_RUNTIME_CACHE`); scripts never prepare/download; machine paths
  never go into `package.json`.
- "Native tests skip non-darwin-arm64 hosts, so their exit 0 on another host
  is not native acceptance." — the `npm test -- <file>` filter is not
  forwarded by `scripts/test-source.mjs` (use a `node --test <file>` shot).
- Minimal metadata gate: `npm run test:opencode-workplan`.

## 4. Merged into the Nisi render engine design

### 4.1 Gate-truth discipline → SPEC (new requirement rows, releases 1 and 2)

The Nisi render engine's own honesty posture ("verdicts never come from a
model; models draft and review, closed readers decide"; receipt
`{checkId, kind, outcome, measured, threshold, scope, code}` per DECISIONS T)
has the same drift risk as the predecessor: a README gate table or roadmap claim can
outrun the actual scripts. Merge:

- **R-DOCGATE**: ship a dependency-free `verify-documented-gates` equivalent
  for each plugin + core that proves every documented gate command in README
  and the roadmap resolves against the shipped manifest, exits nonzero on
  drift, reports `metadataOnly: true` / `gatesExecuted: 0`, and is never
  presented as qualification. Applied to the Unreal `.uplugin` metadata and
  Unity UPM `package.json` at pack time.
- **R-ANCHOR**: every acceptance/status/roadmap count in the release artifacts
  must name a resolvable command anchor; anchorless `N/N` counts are a build
  error (`NO_ANCHOR` precedent).

### 4.2 Failure taxonomy → row state machine (`DECISIONS G`, K)

Merge the predecessor cause classes into the Nisi render tile row state machine as
the closed failure classification contract: every failed row records a cause
class of `code` | `prerequisite-env` | `pending-native` plus an exact
reproduction command and a concrete blocker for non-`code` rows; repairs must
never weaken an acceptance assertion; rows needing environment/build surgery
are reclassified, not repaired. This is the product-side analogue of the
engine's "promote only after deterministic checks" rule and fits the EXR gate
(unit-04) and well (unit-01) row records.

### 4.3 Cross-platform evidence rules (`DECISIONS L`, core packaging)

Merge: device-skip is not native acceptance — every platform-specific claim on
the Nisi plugins must cite a run on that platform, never an exit 0 from a
skipping host; pinned Node/cache custody is an accepted pattern with an
explicit cost (supplied-by-caller cache, documented machine-specific paths
kept out of manifests), which supports core-packaging option (a) (embedded,
sandboxed Node host per the XPC embedded-Node prerequisite 2026-09-13) with
the pinned-runtime evidence requirement inherited.

### 4.4 Not merged (explicitly)

- None of the predecessor verifier JS is ported; only behavior specifications are
  merged (the Nisi product extracts portable shapes, per the product brief).
- No gate run, no certification claim, no `STATUS.md`-style truth table is
  asserted here.
- The three blocked packets were not executed and must not be force-ran
  without Louis clearing the earlier hold (HELD-render-engine-20260917) and
  the timeout diagnosis.

## 5. Follow-ups proposed

1. Fold R-DOCGATE / R-ANCHOR into `SPEC.md` v0.1 build order (suggest as step
   after the EXR gate unit, release-1 check row).
2. Add the failure cause-class tuple to `unit-01-well` row records and
   document it in DECISIONS G.
3. When Louis decides core packaging (a)/(b)/(c), carry the pinned
   runtime-cache custody rule from §4.3 into that decision's evidence.