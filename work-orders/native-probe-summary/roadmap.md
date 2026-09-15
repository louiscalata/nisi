# Native-probe summary — private work-order status

**Product progress: 30% — 3/10 major milestones accepted.** This isolated draft
does not own the product denominator. The single canonical product roadmap is
[Nisi roadmap](../../roadmap.md).

- [x] Inspect and reuse the bounded Fable-reviewed display contract.
- [x] Prepare a stable workspace with protected tests and an explicit write scope.
- [x] Lint and retain authoring evidence (preparation only, not implementation).
- [x] Execute the requested local OpenCode attempt: BLOCKED (`Model is unloaded.`).
- [x] Inspect the empty source diff, unchanged protected files and failed execution receipt.
- [x] Resolve model availability and obtain direction for a new bounded attempt.
- [x] Produce and review an implementation that passes all thirteen formatter tests.
- [x] Review and integrate the implementation into the product separately: `hosts/macos-xpc/native-probe-summary.mjs` and `tests/native-probe-summary.test.mjs` (2026-09-13; 13/13).

Only `src/native-probe-summary.mjs` is an OpenCode edit target. This is a
presentation exercise, not an execution, isolation, security or release gate.
The empty-string placeholder is intentionally not an implemented feature.

The September 13 attempt took 17.942 seconds. Baseline remains 2/2 passing;
formatter checks remain 0/13 passing, with no skipped/cancelled tests. The model
listing was reachable, but no completed inference or editing tool call occurred.
No model was loaded, replaced or restarted, and no automatic retry was made.
This status update is Codex's post-run documentation, not an OpenCode source edit.
See the [execution receipt](.packets/nisi-native-probe-summary.result.md) and
[owner verification](../../.build/native-summary-execution-Y8FVUs/verification.json).

**2026-09-13 — Owner acceptance (supersedes the blocked-attempt status above):**
The [retained handoff](handoff-claude-20260913/HANDOFF.md) records the
`chami-dispatch` route to the SharedChami PC worker, model
`Qwen3-Coder-Next 80B-A3B Q4_K_M`, job
`mac-20260913-013410-4a6a67433191e182b7dd50406c00daaf`, with a worker-reported
elapsed time of 33.8 s. Claude's handoff reports the raw draft passed 10/13
formatter tests (3 failed); Claude's one-line integrator repair added the final
newline: `return lines.join('\n')` → `return lines.join('\n') + '\n'`.
Astra verified that this is the sole change from the retained worker draft,
matched all five handoff file hashes, and found no packet-contract defects in
the source review. Fresh owner runs passed 13/13 formatter tests and 2/2 baseline
tests, with zero failures, skips or cancellations. Final source SHA-256:
`c048df362405ffbd3053de93aedd05a0b51ec5c64417d19c9ee5ea22a6d90056`.
Product integration remains a separate open item; this acceptance records the
formatter work order only.

## Product integration — Astra, 2026-09-13

Louis authorized integration in the Claude session at approximately 12:00 PDT: "Go for it". Astra remained the sole product writer.

The accepted source was copied byte-for-byte to `hosts/macos-xpc/native-probe-summary.mjs`, SHA256 before/after `c048df362405ffbd3053de93aedd05a0b51ec5c64417d19c9ee5ea22a6d90056`. All 13 product formatter tests pass; only module/read-source paths changed. This supersedes the earlier separate-integration-open wording. Native host/UI wiring and product milestone acceptance remain open.

[Canonical integration evidence](../../docs/verification/2026-09-13/five-work-order-integration/receipt.json) records exact source/test hashes, checks and limits. The original work-order source, assertions, handoff and receipts remain unchanged. Claude Fable 5.1 post-integration review remains pending.
