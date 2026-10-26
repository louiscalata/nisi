# Journal owner v2 — correction and integration work order

Overall Nisi progress: **30% (3/10 NX milestones)**. Scope: private NX-05 successor.
One implementation owner: Codex; Claude supplies bounded design/draft collaboration.
The original Claude-owned host-bundle v1 stays unchanged. Canonical integration
adds explicitly versioned source and tests without overwriting prior files.

**This isolated correction/handoff scope: 6/6 checklist items complete (100%).**
**First product integration slice: 5/5 complete (100%).** No additional NX milestone is closed.
Final `npm run check`: **56/56 PASS**, no failures/skips/cancellations/todos.
All nine deliberately broken source variants were caught. The four original fault
paths are corrected in this successor, not in the still-unchanged v1 host bundle.

Canonical `npm run check`: **1331/1331 PASS**, 231 selected files unchanged during
acceptance. The exact owner and eight relocated source/test/helper copies are now
in the product, together with a TypeScript contract and fixed-XPC observation
importer. The importer passed16 checks and four targeted mutations. Three retained
records imported/reopened on real disk; no new native launch. See
[integration accounting](evidence/integration-accounting.md) and the canonical roadmap.
The frozen contract header predates implementation; this roadmap/handoff owns current status.

- [x] Recheck the current v1 source and four retained counterexamples.
- [x] Define explicit opaque-owner v2 API and unchanged journal/store disk formats.
- [x] Adjudicate bounded Opus contract critique and independent test design.
- [x] Implement owner and reproduce red-to-green corrections without test weakening.
- [x] Verify fault paths, targeted mutants, real-disk reopen and current-XPC entry.
- [x] Review final exact source and stage an explicit successor integration handoff.

Evidence: [source-bound acceptance](evidence/owner-verification.json),
[coauthor provenance](evidence/coauthor-provenance.md),
[eight owner mutants](evidence/owner-mutants-gCRgh1/verification.json),
[current-XPC adverse mutant](evidence/xpc-mutant-8fqltN/verification.json),
and [integration handoff](INTEGRATION-HANDOFF.md).

Opus supplied the open/inspect half and contract critique; Codex owns the write
staging/outcome logic and adjudication. Daybreak authored 50 behavior/boundary
tests and reviewed the exact source. Qwen supplied four current-XPC tests, corrected
by the owner after a 0/4 draft run. Two baseline tests complete the 56-test total.

> [!WARNING]
> **The existing v1 host bundle still has its four reproduced defects.**
>
> **Why this matters:** this versioned successor has one new observation consumer,
> but no old v1 caller migration, native application acceptance or release gate was performed.
> Preserve v1 evidence and migrate explicitly; never relabel this as an in-place fix.

See [CONTRACT.md](CONTRACT.md). Tests or preparation do not close NX-05 or release gates.
