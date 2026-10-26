# Native canary summary — private work-order status

**Product progress: 30% — 3/10 major milestones accepted.** This isolated draft
does not own the product denominator. The single canonical product roadmap is
[Nisi roadmap](../../roadmap.md).

Purpose (U02-02 "reproducible user-facing evidence flow"): one pure function that
turns a fixed run's service receipt plus the child's stdout into the adjudicated
canary table and a typed run summary, composing the three accepted modules
(adapter v1, adjudicator, formatter) without changing them. The real inherit-run
evidence (`service-raw.json`, 781-byte stdout) is the test fixture. Every result
carries `isolationAccepted: false`, `generatedCodeExecuted: false`,
`authorizing: false`; a run is OBSERVED only when every lifecycle gate holds and
every canary matches.

- [x] Author the contract, the protected tests and the frozen fixtures (Claude, co-author, 2026-09-13).
- [x] Execute one bounded draft attempt for `src/native-canary-summary.mjs` (local lane first, PC worker fallback); deterministic receipt.
  2026-09-13 13:38–13:53 PDT: local lane (`lmstudio/qwen/qwen3.8-27b`, JIT cold load) hit the wrapper's 900 s edit cap with NO edit landed;
  receipt `.packets/nisi-native-canary-summary.result.md` = blocked, P1 FAILED (placeholder unchanged). From 13:46 a second packet
  (Astra's run-journal-store) shared the same local model. The receipt is retained as-is.
  2026-09-13 13:57 PDT: integrator fix — Claude (co-author) wrote `src/native-canary-summary.mjs` from the packet contract
  (SHA256 `92590f11d91071fb7d5c1a0208958ef7c094d06a723fd38c5827fc63e6fb9c41`); independent rerun: baseline 3/3, summary 10/10.
  No packet, test, fixture or receipt was altered. PC worker fallback was not used for this item.
- [x] Owner review (Astra, bounded read-only, 2026-09-13 14:12 PDT): ACCEPT — no implementation defects; typed reads,
  reason order, gated adjudication, key order, purity and non-mutation confirmed against the packet and the ten tests
  (report retained at `evidence/astra-review-20260913-1412.md`; SHA256 of the reviewed source
  `92590f11d91071fb7d5c1a0208958ef7c094d06a723fd38c5827fc63e6fb9c41`).
- [ ] Integrate separately under `hosts/macos-xpc/` with the tests and fixtures.

Only `src/native-canary-summary.mjs` is an executor edit target. This is an
evidence-composition exercise, not an execution, isolation, security or release gate.

2026-09-13 — display-escape correction: product `hosts/macos-xpc/native-canary-adjudicator.mjs` SHA256 `cf875eaa7adf335ceab49ae16f9941e2d9b5b9780f5ca15c22eea4c97405de00` → `444acc75db292d69c62ce0360f536ea73292317f78b36409acc619774b44e9eb`; the baseline assertion is re-pinned to the corrected hash. Verification pending. This is plain-text display hardening; structured evidence and `isolationAccepted: false` are unchanged. Historical text above is retained.
  Note (Claude, 15:35 PDT): this work order's frozen copy `src/native-canary-adjudicator.mjs` stays at the
  accepted `cf875eaa…` bytes it was reviewed against; the baseline pin was briefly re-pinned to the product hash
  during integration and reverted (baseline 3/3, summary 10/10 after revert). The product module carries the fix.

2026-09-13 — integrated (Astra; Louis “Autointegrate”, 2026-09-13 Claude session): `hosts/macos-xpc/native-canary-summary.mjs` copied byte-for-byte, SHA256 `92590f11d91071fb7d5c1a0208958ef7c094d06a723fd38c5827fc63e6fb9c41`; 13/13 migrated tests (10 functional + 3 baseline), product check 1230/1230 with zero failed/skipped/cancelled/todo, TypeScript PASS and PRIVATE_PACKAGE_FILES 27. Not closed: host wiring of the bundle to the XPC runner, real-filesystem durability, cross-process locking, crash qualification, or incident admission. Progress stays 30% — 3 of 10; no milestone closure. Receipt: `../../docs/verification/2026-09-13/evidence-chain-integration/receipt.json`.
