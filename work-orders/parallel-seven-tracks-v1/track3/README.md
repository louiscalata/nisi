# Track 3 — prevention experiment-plan validator: containment fixes

STATUS: DONE — 2026-09-14 (Claude authored review + oracle + packet; OpenCode free lane applied the edit; Claude promoted).

- Review: `evidence/claude-review-20260914.md` — REJECT on the reviewed module
  (sha256 `185b6550b0f8dce7a77fdfd06e568500ffb9315f2e7349425f38ab65345d4829`):
  #1 `list()` re-read a Proxy's `length`, so a length-lying Proxy emitted plans
  above every inventory bound and with `armOrder.length !== repetitions`;
  #2 training/evaluation disjointness checked `taskSha256` only, so a held-out
  oracle or baseline that was a training example was DECLARED. #3 (test strength)
  is covered by the oracle's bound table. Budget ceilings, Proxy refusal, bidi
  text and intra-task digest distinctness were refuted as non-contract.
- Oracle: `tests/plan-containment.test.mjs` (17; sha256
  `bdd75b2f16eea95b43b9c009280141168b8129b3256b0095d990a42c2e48c705`) — 10/17
  on the reviewed module, 17/17 after the fix; the author's 9 stay green.
- Packet: `.packets/nisi-track3-plan-containment.packet.md` on tier `free`
  (`opencode/big-pickle`), `outcome: done`, P1 DONE, acceptance exit 0;
  the diff against the reviewed module is exactly the two end-states the
  packet specified (5 hunks, no new imports or codes).
- Fixed module: `src/prevention-experiment-plan-v1.mjs` sha256
  `470443df194876c39e74444860dd1f376ffbead27bb83a61f498c2f942a9a0d1`.
- Promoted 2026-09-14 01:07 PDT: `evaluation/prevention-experiment-plan-v1.mjs` (same sha) and
  `tests/prevention-experiment-plan-containment.test.mjs` (one import-path edit).
  Suite 1721/1721.
