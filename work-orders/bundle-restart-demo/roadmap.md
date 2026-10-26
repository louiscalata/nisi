# Bundle restart demo — private work-order status

**Product progress: 30% — 3/10 major milestones accepted.** This isolated draft
does not own the product denominator. The single canonical product roadmap is
[Nisi roadmap](../../roadmap.md).

Purpose (U02-04 exit criterion: "actual persisted incidents can be read after
process restart, correctly attributed and revoked, without duplicate eligible
occurrences or silent success on an uncertain write"): demonstrate exactly that
with the integrated modules and nothing else. A fixed child CLI opens the
accepted host bundle on a real file with real `node:fs`, records one accepted
fixed-run entry, and exits; the protected tests spawn a NEW Node process per
request and assert that the next process reads the previous one's bytes back as
historical, that replay is DUPLICATE and conflict is CONFLICT with the file
untouched, that interrupted RUNNING work persists across processes, that a
truncated file opens SEALED and refuses records without rewriting, and that a
foreign project's file is never adopted. Fresh-process persistence is not
power-loss durability, cross-process locking or hostile-directory safety.

Frozen inputs are the four INTEGRATED product modules (byte-identical to
`history/` and pinned in `tests/baseline.test.mjs`). The disjoint
[journal-restart-recovery](../journal-restart-recovery/roadmap.md) work order
(Codex app session) proves the same for the store alone; this one proves it
through the bundle.

- [x] Author the contract, the fixed CLI, the protected tests (9) and the frozen inputs (Claude, co-author, 2026-09-13 16:45 PDT).
- [x] Draft (Astra-as-author in a scratch copy, 2026-09-13 16:50 PDT, 123 s): 9/9 and 3/3 on Astra's run and Claude's
  independent rerun; no contract/test contradiction. Claude probed four boundary cases the oracle does not cover
  (sibling-prefix directory, the .scratch root itself, an inherited-only command key, a symbol-keyed extra) — all
  refused — before installing. Installed as `src/bundle-restart-demo.mjs`, SHA256 `53a2d99d2b73300405c2c4d87090abea712e902b6ef18637dfcb5a7b71ed6b89`.
  Report retained at `evidence/astra-author-report-20260913-1650.md`.
- [x] Cross-review (Claude, adversarial workflow, 2026-09-13 17:15 PDT): ACCEPT_WITH_DEFECTS — eight candidates, one
  survived two refuters: the `.scratch` boundary used the JS `fs.realpathSync`, which collapses `link/..` lexically
  before resolving the link, so `D/lnk/../journal.jsonl` validated against `D` while the kernel wrote `D/a/`. Shared
  between Claude's contract (which named that primitive) and the module. Retained at
  `evidence/claude-crossreview-20260913-1715.md`.
  Fixed 17:25 PDT: packet Revision 2 (normalized path, `fs.realpathSync.native` both sides, explicit trailing-slash
  guard — Astra found `normalize` keeps a trailing slash); oracle extended with the `lnk/..` and trailing-slash cases
  (tests SHA256 `676c23e540d35d71b8d8ab4dc870092c2fb191a25bd3e89e51773262125fede5`); Astra applied the minimal module fix (SHA256 `1296d7ba1a7c7951019c9bd96103601bd2dfd98e5aa3132f4529637ab1f15985`).
  9/9 and 3/3 on Astra's run and Claude's independent rerun. The review also judged the oracle: it genuinely proves
  the persistence half (distinct pids, the file is the only channel, byte-for-byte reopen round-trip); the
  uncertain-write half is shown only in the restart sense, and `durable:true` is the store's own fsync report.
- [ ] Owner review (Astra) of the contract and oracle (reciprocal).
- [x] Integrated 2026-09-14 (Claude, after OpenCode's O4 rehearsal and adversarial review) under the
  actual names: module `history/bundle-restart-demo.mjs`, CLI `tests/fixtures/bundle-restart-demo-cli.mjs`,
  tests `tests/bundle-restart-demo.test.mjs` (9; two boundary probes and temp-dir cleanup added) and
  `tests/bundle-restart-demo-baseline.test.mjs` (3; frozen pins dropped). Evidence
  `docs/verification/2026-09-14/o4-integration/`.

Only `src/bundle-restart-demo.mjs` is an executor edit target.
