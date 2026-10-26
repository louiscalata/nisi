# Fixed-run journal entry — private work-order status

**Product progress: 30% — 3/10 major milestones accepted.** This isolated draft
does not own the product denominator. The single canonical product roadmap is
[Nisi roadmap](../../roadmap.md).

Purpose (U02-02 "reproducible user-facing evidence flow", U02-04 durable
history): one pure function that turns an accepted fixed-run summary
(`nisi-fixed-run-summary/v1`) into an entry the accepted run journal
(`history/run-journal-v1.mjs`, frozen here as `src/run-journal-v1.mjs`) appends
as-is. Receipt → summary → entry → journal → disk store is the evidence chain;
this is the entry link. Every entry carries `isolationAccepted: false`,
`generatedCodeExecuted: false`, `authorizing: false`; an OBSERVED run is
SUCCEEDED, anything else is FAILED, and the journal's own duplicate/conflict
rules apply unchanged.

The four summary fixtures were generated from the frozen adapter/adjudicator and
the real inherit-run evidence by `evidence/generate-summary-fixtures.mjs`
(re-run against the accepted summary module and diff: byte-identical expected).

- [x] Author the contract, the protected tests and the frozen fixtures (Claude, co-author, 2026-09-13).
- [x] Execute one bounded draft attempt for `src/fixed-run-journal-entry.mjs` on the PC worker lane; deterministic receipt.
  2026-09-13 13:58–14:02 PDT: PC worker (Qwen3-Coder-Next 80B-A3B Q4_K_M) draft 184 s + repair 46 s; receipt
  `.packets/nisi-fixed-run-journal-entry.result.md` = blocked, P1 FAILED. The prompt (7,926 chars) omitted the
  16.5 KB test oracle (over the 12k cap) and the draft implemented a different, invented contract (imported a
  nonexistent `./utils.mjs`); retained verbatim as `evidence/pc-draft-rejected-20260913-1402.mjs.txt`, jobs under
  `.packets/nisi-fixed-run-journal-entry.pc-jobs/`.
  2026-09-13 14:05 PDT: integrator fix — Claude (co-author) wrote `src/fixed-run-journal-entry.mjs` from the packet
  contract (SHA256 `85bb05b57427735a385d978702e439dd051d5c2201efdd7931e974e36b76ccf7`); independent rerun: baseline 3/3,
  entry 8/8. No packet, test, fixture or receipt was altered.
- [x] Contract + tests review (Astra, bounded read-only, 2026-09-13 14:12 PDT): REJECT for packet-only execution —
  nine findings (array/key representability under-specified, purity test over-specified export syntax, canary reason
  allowed without adjudication, identity key order unstated, missing precedence/representability/freshness cases).
  Applied 14:20 PDT as packet Revision 2 (clarifications only; Revision 1 as executed retained at
  `evidence/packet-as-executed-20260913-1358.md`), tests extended in place (SHA256
  `db5556734fec3f4e958d47e46b53b36c457045b5bf39603ae72d5770775d4aab`), implementation tightened (identity key
  order enforced, CANARIES_NOT_MATCHED refused without adjudication; SHA256
  `321353df70ba4b815550a92b489082cfbfe805a57418c3419600d253adf6ebf5`); rerun baseline 3/3, entry 8/8.
- [x] Implementation review round 1 (Astra, bounded read-only, 2026-09-13 14:25 PDT): REJECT — three defects (a
  non-enumerable required key plus an extra key passed the input check; input-provided array methods could make the
  builder throw instead of refusing; fields were read before their validation stage so an input getter could run early)
  plus the lexical `import` test rule being unstated. Retained at `evidence/astra-impl-review-20260913-1425.md`.
  Applied 14:40 PDT: descriptor-based reads everywhere (no getter is ever invoked, no input method is ever called,
  arrays read by index), enumerable-name set comparison, packet Revision 3 (property-reading rule, `import` token rule;
  Revision 2 retained at `evidence/packet-revision-2-20260913-1415.md`), tests extended (SHA256
  `89a0a0e06fba80deccb074f9096b0cdc91b6256ce295b73db4803d80aaf6a320`); implementation SHA256
  `a52d7e32598d75f2063dda2061afd7be659eae1ab37e82a6809c0b84866d20c9`; rerun baseline 3/3, entry 8/8.
- [x] Implementation review round 2 (Astra, bounded read-only, 2026-09-13 14:50 PDT): ACCEPT — all four round-1
  findings resolved, no new defect; one cleanup note (redundant array-length expression), applied 14:55 PDT.
  Retained at `evidence/astra-impl-review-round2-20260913-1450.md`. Final implementation SHA256 `ba888a4f4d5b1b78f799045e44fbdfe79b75545847ab9b3ed2673fd7b353585c`;
  rerun baseline 3/3, entry 8/8. Astra's verdicts are static reviews; the test counts are Claude's reruns.
- [ ] Integrate separately under `history/` with the tests and fixtures.

Only `src/fixed-run-journal-entry.mjs` is an executor edit target. This is an
evidence-composition exercise, not an execution, isolation, security or release gate.

2026-09-13 — integrated (Astra; Louis “Autointegrate”, 2026-09-13 Claude session): `history/fixed-run-journal-entry.mjs` copied byte-for-byte, SHA256 `ba888a4f4d5b1b78f799045e44fbdfe79b75545847ab9b3ed2673fd7b353585c`; 11/11 migrated tests (8 functional + 3 baseline), product check 1230/1230 with zero failed/skipped/cancelled/todo, TypeScript PASS and PRIVATE_PACKAGE_FILES 27. Not closed: host wiring of the bundle to the XPC runner, real-filesystem durability, cross-process locking, crash qualification, or incident admission. Progress stays 30% — 3 of 10; no milestone closure. Receipt: `../../docs/verification/2026-09-13/evidence-chain-integration/receipt.json`.
