# Native canary adapter — private work-order status

**Product progress: 30% — 3/10 major milestones accepted.** This isolated draft
does not own the product denominator. The single canonical product roadmap is
[Nisi roadmap](../../roadmap.md).

Purpose: the explicit, versioned adapter both reviewers asked for at the
canary-adjudicator acceptance: it maps the fixed script's real output vocabulary
(`operation` snake_case, `outcome` allowed|error|observed, `code`/`syscall`) onto
the adjudicator's contract (`op`, ALLOWED|DENIED|SELF_REPORT), rejects lines with
duplicate JSON member names before parsing, treats `error` as a denial only on
the approved per-operation signature, and builds the expected matrix from trusted
runtime identities. Frozen fixtures: the accepted adjudicator (sha256 cf875eaa…)
and the real inherit-run stdout (781 bytes, sha256 51612e7b…). Every result still
carries `isolationAccepted: false`.

- [x] Author the contract, the protected tests and the frozen fixtures (Claude, co-author, 2026-09-13).
- [x] Owner review of the packet and tests before execution (Astra, 2026-09-13): CHANGES MADE; revised contract reviewed, execution awaits Louis's decision.
- [x] Execute one bounded draft attempt (2026-09-13 11:27 PDT, `packet-run-pc`, PC worker 172.7 s → 5/14; repair round refused, over the worker cap) then integrator rewrite by Claude → 14/14 + 3/3; deterministic receipt DONE with both named; see [handoff](handoff-claude-20260913/HANDOFF.md).
- [x] Owner review of the implementation (Astra, 2026-09-13): CHANGES MADE; corrected the duplicate-key whitespace scanner, verified the final artifact, and accepted the isolated implementation for Louis's integration decision. See owner review below.
- [x] Review and integrate the adapter into the product separately: `hosts/macos-xpc/native-canary-adapter.mjs`; `tests/native-canary-adapter.test.mjs` and `tests/native-canary-adapter-baseline.test.mjs` (2026-09-13; 14/14 + 3/3).

Only `src/native-canary-adapter.mjs` is an executor edit target. This is a
data-mapping exercise, not an execution, isolation, security or release gate.

## Pre-execution review — Astra

2026-09-13: CHANGES MADE. Verified both frozen hashes and the service-record
identities. Original test expectations were correct; repaired decoded-key
duplicate detection and vocabulary/contradiction bypasses in Context, with
regressions in the existing 14 tests. Clarified validation and trusted-input
boundaries. Before and after: `npm test` 3/3; `npm run test:adapter` 1 pass / 13
fail on the unchanged placeholder; packet-lint OK. See
[review evidence and exact outputs](pre-execution-review-astra.md).
No implementation, packet execution, model calls, commit or push. Louis must
decide whether to approve this revised contract for one bounded draft attempt;
implementation review and product integration remain open.

## Owner review — Astra (implementation)

2026-09-13: **CHANGES MADE; accept the corrected isolated implementation.**
Louis must decide whether to integrate it. This review does not accept isolation,
authenticate child evidence, execute a packet, or approve product completion.

### Findings and correction

- `src/native-canary-adapter.mjs:68` recognized only space, tab, CR and LF before
  a member-name colon. The contract requires JavaScript `\s`. For example,
  `'{"a"\u00a0:1,"a"\u00a0:2}'` (actual NBSP characters before the colons)
  incorrectly produced `PASSTHROUGH_INVALID`, rather than
  `REJECTED_DUPLICATE_KEY`. Replaced only that condition with `/\s/.test(text[j])`.
  This was a classification defect; invalid JSON did not become `ALL_MATCHED`.
- Checked decoded-key equality, escape parity, separate decoded/raw key sets,
  nested objects, arrays, parent-set restoration, unmatched containers and
  unfinished strings. Checked all vocabulary guards, strict per-operation
  errno/code/syscall signatures, identity validation, own-property handling,
  line/report/count preservation, frozen inputs and fresh nested output objects
  under the fixed v1 policy. No remaining defect found in those checks.
- A concrete contract boundary remains: replacing the own-write fixture row with
  `{"operation":"own_container_write","outcome":"allowed","errno":0,"metadata":{"outcome":"error"}}`
  still produces the matching own-write row and `ALL_MATCHED` for the complete
  fixture. Extra metadata is expressly omitted by the contract. Unknown or
  contradictory evidence inside that metadata is not adjudicated. Preserve the
  raw stdout and report; `isolationAccepted` remains false. Alternative policy
  mappings and caller-supplied identity provenance are separate trust obligations.

### Retained draft and receipt evidence

Extracted the sole fenced code block from `P1-draft.result.json` and diffed it
against the initial source: **not equal** (573 unified-diff lines). Extracted
draft SHA256, with the file's final newline:
`7323502ea21b93d642397b417faf1e59001f90623f149dc099d7d6bfb95f4971`.
The retained draft acceptance says exit 1, 5 passed / 9 failed. The repair job
has a 41,215-character prompt; its result is `unavailable`, with error
`prompt empty, oversized, or potentially sensitive`, and contains no fenced
source to diff and no repair acceptance file. A successful worker repair is
not evidenced. The source is the separately disclosed Claude integration rewrite,
whose initial hash matches the handoff SHA256SUMS, plus Astra's one-line fix.
The handoff's "180 lines" wording is stale: the retained implementation has
204 lines. The job prompt also contains no test source after its oracle heading.

The result receipt names the worker draft and Claude rewrite, but contains no
packet hash. The installed receipt tool supports an expected-hash check; these
retained files alone do not prove which expected hash was supplied historically.
No receipt or packet was regenerated during owner review.

### Independent verification

- Before and after correction: `npm test` 3/3, `npm run test:adapter` 14/14;
  no failures, skips or cancellations.
- Final forbidden-token grep: no matches, including clock/random tokens.
- Additional in-memory owner probes: 24 whitespace characters excluding LF
  (the input-line delimiter), 9 scanner edge cases, 37,449 short text inputs
  without a throw, and 2,100 evidence mutations. Only the 8 expected valid
  combinations reached `ALL_MATCHED`. Frozen-input and disjoint-object-graph
  checks passed. These are scoped probes, not an exhaustive security proof.

### SHA256

- Source before: `adb76dca0106d5ab5cd5f5e049a8fb8954e3c02127ab8f47b44c45fecbce506b`
- Source after: `ac9c9cfaacfad91a27f08d2daee461b1f0580892509dc76693ccd36bd35a5c8f`
- Packet, unchanged: `cad1b488a51d8be4139f0f668c2d3370eceff429c29ea9d58951749e1afd5cf4`
- Adapter tests, unchanged: `21c383e51d0fb156b170bae87cc26d860680299c60c9e149477f16598b20b9af`
- Baseline tests, unchanged: `26a6689dae6763114af5a5c17d4b51894b5c323d49313d9d502535f6e88c699b`
- Frozen adjudicator, unchanged: `cf875eaa7adf335ceab49ae16f9941e2d9b5b9780f5ca15c22eea4c97405de00`
- Frozen stdout, unchanged: `51612e7ba818bfe7dd2a42d46e8c0cf8e84332d63f2562132842e9879bc3dddc`

Permanent edits: the single source condition and this roadmap only. Tests,
fixtures, packet evidence, product tree and run-journal were not edited.

## Product integration — Astra, 2026-09-13

Louis authorized integration in the Claude session at approximately 12:00 PDT: "Go for it". Astra remained the sole product writer.

The corrected accepted source was copied byte-for-byte to `hosts/macos-xpc/native-canary-adapter.mjs`, SHA256 before/after `ac9c9cfaacfad91a27f08d2daee461b1f0580892509dc76693ccd36bd35a5c8f`. Product fixture `tests/fixtures/native-canary/inherit-run-node.stdout` remains 781 bytes, SHA256 before/after `51612e7ba818bfe7dd2a42d46e8c0cf8e84332d63f2562132842e9879bc3dddc`. An unchanged work-order package fixture preserves the three baseline assertions; 17/17 product tests pass. Only module/read-fixture paths changed. The inherited metadata/trusted-policy limitations and `isolationAccepted: false` are retained.

[Canonical integration evidence](../../docs/verification/2026-09-13/five-work-order-integration/receipt.json) records exact source/test hashes, checks and limits. The original work-order source, assertions, handoff and receipts remain unchanged. Claude Fable 5.1 post-integration review remains pending.

2026-09-13 — display-escape correction: product `hosts/macos-xpc/native-canary-adjudicator.mjs` SHA256 `cf875eaa7adf335ceab49ae16f9941e2d9b5b9780f5ca15c22eea4c97405de00` → `444acc75db292d69c62ce0360f536ea73292317f78b36409acc619774b44e9eb`; the baseline assertion is re-pinned to the corrected hash. Verification pending. This is plain-text display hardening; structured evidence and `isolationAccepted: false` are unchanged. Historical text above is retained.

2026-09-13 — correction to the preceding re-pin note: the frozen source copy stays at the accepted `cf875eaa7adf335ceab49ae16f9941e2d9b5b9780f5ca15c22eea4c97405de00` bytes it was reviewed against, and its baseline pin is restored to that hash; the product module carries the display-escape fix.
