---
packet: nisi-v02-c10-finish-evidence-index
project_root: ~/nisi
created_by: codex
created: 2026-09-18T17:10:00-07:00
write_owner: opencode
status: blocked
---

# C10 — Reconcile the complete v0.2 finish gates without manufacturing readiness

> PRIVATE — STAGED, NOT DISPATCH-READY. FINAL_EVIDENCE_REVIEW.
> This new order never resets or resumes a historical executing packet.

## Context

Accepted NX01–03 =30%; NX04–10 remain open. Readiness readers, paired-trial accounting, coordinator/admission and module registry already exist. An index is not new evidence, permission or a second canonical roadmap.

Milestone mapping: NX-04..NX-10. Coauthor/review assignment: Codex.
Cluster dependencies: C01, C02, C03, C04, C05, C06, C07, C08, C09.
The executor receives only a contract frozen by the owner. The current order is
held until its named stop below is resolved. Source references (read-only unless
also explicitly listed in an item):

- roadmap.md
- work-orders/parallel-seven-tracks-v1/track6/check-product-readiness.mjs
- work-orders/parallel-seven-tracks-v1/track7/check-release-readiness.mjs
- evaluation/paired-trial-v1.mjs
- hosts/repository/execution-coordinator-v1.mjs
- experimental/module-registry-v1.mjs

## Constraints

- One writer; inspect fresh dirty state and coordinate with Claude before handoff.
- No writes outside the item file lists. Packet/config/acceptance-control files
  are owner-managed and never executor targets.
- Never edit, format, build inside or re-pin integrations/veritas/.
- Preserve existing dirty work, historical packets, failed evidence and source IDs.
- No installation, native launch, model call, network, credentials, service changes,
  signing, publication, commits or pushes from an edit-phase packet.
- No automatic tier fallback, stale forced retry, scope expansion or invented APIs.
- Every new regression must run in the graded cluster command, not an unused file.
  Coauthored tests are not independent acceptance by themselves.
- Imported/generated code is inspected by the owner before execution.
- Hold: Dependencies mean independently accepted exact revisions, not presence of result.md or status:done. Ten finished work packets do not force NX completion; real remaining integration/evaluation and external decisions remain gates.

## Items

### P1 — Add the discriminating regression oracle
- **files**: work-orders/v02-finish-cluster-v1/finish/evidence-index-v1.test.mjs
- **do**: Validate a fixed inventory covering all seven open milestones, mapping exact source/receipt hashes and scope to existing readers. Require explicit pending entries for live repository demo, native incident admission/recovery, real paired prevention trials, scheduler/provider/UI integration, experimental module/traveler graph integration, Node22/private install/native acceptance and external release gates. Missing or generic self-declared PASS cannot close a gate. Create the named test only after the owner resolves the hold. Syntax acceptance here proves only a parseable oracle; behavioral acceptance is P2.
- **accept**: node --check work-orders/v02-finish-cluster-v1/finish/evidence-index-v1.test.mjs

### P2 — Implement the frozen bounded change and verify
- **files**: work-orders/v02-finish-cluster-v1/finish/evidence-index-v1.json, work-orders/v02-finish-cluster-v1/finish/evidence-index-v1.test.mjs, work-orders/v02-finish-cluster-v1/finish/PRIVATE-HANDOFF.md
- **do**: Create only a private evidence index and handoff, referencing the canonical roadmap and actual retained results. Reuse existing reader contracts; do not write another readiness engine. Add all unresolved owner-led steps with dependencies and concrete next checks. Fable/model review and packet DONE never replace native/independent evaluation/counsel evidence. Keep legal/disclosure/release authorization external and blocked. Owner alone updates canonical milestone checkboxes after evidence review.
- **accept**: npm run test:c10 --prefix work-orders/v02-finish-cluster-v1
- **needs**: P1

## Packet acceptance

npm test --prefix work-orders/v02-finish-cluster-v1
npm run test:dispatch --prefix work-orders/v02-finish-cluster-v1 -- C10

## Owner release checklist

- [ ] Resolve FINAL_EVIDENCE_REVIEW; collect current source hashes and confirm write ownership.
- [ ] Review contract/oracle, freeze exact allowed paths and candidate acceptance.
- [ ] Resolve each dependency with source-bound acceptance; no stale DONE reuse.
- [ ] Replace the cluster's staging latch only through a separately reviewed owner
      change; executor may not change it or skip its command.
- [ ] Mark this new packet ready, then run real packet-lint (it executes commands).
      Baseline must pass; each item accept must fail before implementation.
- [ ] Dispatch one writer on the explicitly selected local route; no duplicate work.
- [ ] Inspect real receipt, scope diff, graded tests and adverse cases. Required
      independent review/native checks remain distinct from receipt completion.

