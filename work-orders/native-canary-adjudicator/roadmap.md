# Native canary adjudicator — private work-order status

**Product progress: 30% — 3/10 major milestones accepted.** This isolated draft
does not own the product denominator. The single canonical product roadmap is
[Nisi roadmap](../../roadmap.md).

Purpose: a pure, presentation-and-adjudication module for the fixed-canary
output of the XPC embedded-Node fixture (roadmap :716-724, :3837). It turns the
child's JSON lines plus a fixed expected matrix into per-operation verdicts and
a plain-text table. It never derives isolation acceptance: every result carries
`isolationAccepted: false` and the table ends with a literal caveat.

- [x] Author the contract and the protected tests (Claude, co-author, 2026-09-13).
- [x] Execute one local OpenCode packet attempt: BLOCKED (executor read the tests, made no edit in 12 min). Resolved on the SharedChami PC worker in two jobs (88 s + 30 s), one integrator repair; 2/2 + 11/11 + 6/6; see [handoff](handoff-claude-20260913/HANDOFF.md).
- [x] Owner review (Astra) of the implementation against the contract; cross-review. 2026-09-13: ACCEPTED with documented contract limits; 10/10 hashes, 2/2 + 11/11 + 6/6 tests, source unchanged; see handoff owner review.
- [x] Review and integrate the implementation into the product separately: `hosts/macos-xpc/native-canary-adjudicator.mjs`; `tests/native-canary-adjudicator.test.mjs`, `tests/native-canary-table.test.mjs`, and `tests/native-canary-adjudicator-baseline.test.mjs` (2026-09-13; 19/19).

Only `src/native-canary-adjudicator.mjs` is an OpenCode edit target. This is a
data-adjudication exercise, not an execution, isolation, security or release gate.

## Product integration — Astra, 2026-09-13

Louis authorized integration in the Claude session at approximately 12:00 PDT: "Go for it". Astra remained the sole product writer.

The accepted source was copied byte-for-byte to `hosts/macos-xpc/native-canary-adjudicator.mjs`, SHA256 before/after `cf875eaa7adf335ceab49ae16f9941e2d9b5b9780f5ca15c22eea4c97405de00`. All 19 relocated tests pass (11 adjudication, 6 table, 2 baseline). `tests/fixtures/native-canary-adjudicator-package.json` preserves the work-order baseline package contract unchanged. Only module/read-fixture paths changed in tests. The product adapter now consumes this sibling adjudicator in fixed-data tests; host identity provenance, raw evidence retention and isolation acceptance remain separate obligations.

[Canonical integration evidence](../../docs/verification/2026-09-13/five-work-order-integration/receipt.json) records exact source/test hashes, checks and limits. The original work-order source, assertions, handoff and receipts remain unchanged. Claude Fable 5.1 post-integration review remains pending.
