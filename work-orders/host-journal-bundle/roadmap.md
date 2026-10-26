# Host journal bundle — private work-order status

**Product progress: 30% — 3/10 major milestones accepted.** This isolated draft
does not own the product denominator. The single canonical product roadmap is
[Nisi roadmap](../../roadmap.md).

Purpose (U02-04 "persist trustworthy history and recover honestly"): the host
side of the evidence chain. `openJournalBundle` reads the persisted journal
through the accepted store, reopens it through the accepted journal, reports
recovery honestly (NEW / COMPLETE / INCOMPLETE / INVALID), refuses another
project's file, and lists interrupted work (RUNNING rows whose heartbeat is
stale). `recordFixedRun` builds the accepted fixed-run entry, appends,
serializes and writes back with the expected-previous hash; a disk that changed
underneath is STORE_CONFLICT with the append rolled back; an interrupted write
is STORE_FAILED with old bytes intact and no temp left; a non-durable write is
reported, never hidden. Every result carries `authorizing: false`.

Frozen inputs (pinned in `tests/baseline.test.mjs`): journal
`dee9f490…`, store `1356028b…` (post-review fix), entry builder `ba888a4f…`,
two summary fixtures. The tests inject an in-memory fs (`tests/memfs.mjs`).

- [x] Author the contract, the protected tests (14) and the frozen inputs (Claude, co-author, 2026-09-13 16:20 PDT).
- [x] Draft attempts, 2026-09-13:
  - Local lane run 1 (15:15 PDT): "Model is unloaded" (gemma had evicted qwen); receipt blocked, retained at
    `evidence/local-lane-receipt-run1-unloaded.md`.
  - Local lane run 2 (15:19–15:34 PDT, qwen pre-loaded with a 32k context): hit the 900 s edit cap with no edit.
  - Astra (Codex) parallel authoring in a scratch copy (15:32 PDT): STOPPED on a real oracle defect — one test asserted
    `TIME` for `createdAt > now`; the frozen journal throws `ENTRY` for that. Claude corrected the test (both clock faults
    now asserted; tests SHA256 `d830a9974edea06ffca4bba886dd89bce1bbcd0c45adccb4ec1d5e3d37f0ca48`) and annotated the packet; Astra then authored the module
    against the corrected oracle: 14/14 and 3/3 (Astra's run and Claude's independent rerun).
    Installed as `src/host-journal-bundle.mjs`, SHA256 `97b2554b7fe50812fcb0065197964967d2beefc0c8cb322a38154ec16ebb9894`.
    Report retained at `evidence/astra-author-report-20260913-1540.md`. Claude probed rollback watermark semantics and
    the public surface (no config leak) before installing.
- [x] Cross-review (Claude, adversarial workflow, 2026-09-13 16:00 PDT): ACCEPT — nine candidates, none survived two
  independent refuters; each refutation cited the packet line the module obeys. Retained at
  `evidence/claude-crossreview-20260913-1600.md`. One refuted candidate is kept as a CONTRACT note for the next revision
  (Claude owns the packet): opening with a clock earlier than the persisted watermark surfaces as `INVALID_INPUT`
  because the frozen journal's `list(now)` throws `TIME`; a dedicated `CLOCK_BEHIND_JOURNAL` open reason would be
  clearer. Not changed now: the module obeys the contract as written and the oracle pins the current behaviour.
- [ ] Owner review (Astra) of the installed module against the packet (Astra authored it, so this is the
  reciprocal check of Claude's contract and tests rather than of the code).
- [ ] Integrate separately under `history/` (or `hosts/`) with the tests, the memfs helper and the fixtures.

Only `src/host-journal-bundle.mjs` is an executor edit target. This is a persistence
composition exercise, not crash qualification, power-loss durability, cross-process
locking, incident admission or milestone closure.

2026-09-13 — integrated (Astra; Louis “Autointegrate”, 2026-09-13 Claude session): `history/host-journal-bundle.mjs` copied byte-for-byte, SHA256 `97b2554b7fe50812fcb0065197964967d2beefc0c8cb322a38154ec16ebb9894`; 17/17 migrated tests (14 functional + 3 baseline), product check 1230/1230 with zero failed/skipped/cancelled/todo, TypeScript PASS and PRIVATE_PACKAGE_FILES 27. Not closed: host wiring of the bundle to the XPC runner, real-filesystem durability, cross-process locking, crash qualification, or incident admission. Progress stays 30% — 3 of 10; no milestone closure. Receipt: `../../docs/verification/2026-09-13/evidence-chain-integration/receipt.json`.
