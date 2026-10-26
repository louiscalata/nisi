---
packet: nisi-v02-c05-fixture-input-imports
project_root: ~/nisi
created_by: codex
created: 2026-09-18T17:10:00-07:00
write_owner: opencode
status: blocked
---

# C05 — Reject unsupported fixture inputs and audit the actual import surface

> PRIVATE — STAGED, NOT DISPATCH-READY. SECURITY_REVIEW_REQUIRED.
> This new order never resets or resumes a historical executing packet.

## Context

Current runner uses parentRoot/profile and optional signal/sources/inject; inject overrides testsOwner only. Retained findings 6/9 demonstrate ignored control fields, dynamic imports/re-exports and socket paths missed by the guard. The reviewed post-C04 runner has exactly fourteen approved literal imports; the owner-frozen C05 design is retained in .packet-diagnostics/c05-owner-review-PeEuLA/DESIGN.md.

Milestone mapping: NX-04/NX-09. Coauthor/review assignment: Fable 5.1.
Cluster dependencies: C04.
The executor receives only a contract frozen by the owner. The current order is
held until its named stop below is resolved. Source references (read-only unless
also explicitly listed in an item):

- work-orders/parallel-seven-tracks-v1/track1/repository-fixture-runner.mjs
- work-orders/parallel-seven-tracks-v1/track1/repository-fixture-runner.test.mjs
- work-orders/parallel-seven-tracks-v1/track1/README.md
- integrity/record-utils.mjs

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
- Hold: Freeze the post-C04 exact imports and injection-key contract before dispatch. Owner security review remains required; scanner passing does not prove arbitrary JavaScript containment.

## Items

### P1 — Add the discriminating regression oracle
- **files**: work-orders/parallel-seven-tracks-v1/track1/findings-cluster-input-imports.test.mjs
- **do**: Reject extra endpoint/model/reviewHistory/reviewIncidents fields, inject.staticOwner, accessors, symbol/hidden fields and unsupported prototypes before any I/O. Positive controls cover each admitted input. Static fixture controls cover literal dynamic import, re-export, nonliteral import, createRequire and process.binding; runtime controls cover socket/TLS/dgram/http2/DNS attempts. Preserve the exact approved import set after reviewed C04 extraction, not a minimum-count heuristic. Create the named test only after the owner resolves the hold. Syntax acceptance here proves only a parseable oracle; behavioral acceptance is P2.
- **accept**: node --check work-orders/parallel-seven-tracks-v1/track1/findings-cluster-input-imports.test.mjs

### P2 — Implement the frozen bounded change and verify
- **files**: work-orders/parallel-seven-tracks-v1/track1/repository-fixture-runner.mjs, work-orders/parallel-seven-tracks-v1/track1/repository-fixture-runner.test.mjs, work-orders/parallel-seven-tracks-v1/track1/fixture-write-guard.mjs, work-orders/parallel-seven-tracks-v1/track1/findings-cluster-input-imports.test.mjs, work-orders/parallel-seven-tracks-v1/track1/findings-cluster-cleanup.test.mjs
- **do**: Validate the complete input shape and nested injection seam before property reads with possible user code or I/O. Preserve existing accepted signal/Buffer semantics and documented test-only sources/inject. Harden static/runtime oracle coverage for the named bypasses without adding networking. Do not introduce dependencies, eval or a general JS sandbox. Keep all C02–C04 regressions in the graded acceptance command.
- **accept**: npm run test:c05 --prefix work-orders/v02-finish-cluster-v1
- **needs**: P1

## Packet acceptance

npm test --prefix work-orders/v02-finish-cluster-v1
npm run test:dispatch --prefix work-orders/v02-finish-cluster-v1 -- C05

## Owner-controlled amendment — private implementation route

This packet remains blocked and was NOT executed by OpenCode. The owner-supervised
candidate includes the fifth cleanup oracle to migrate its trusted cancellation
hook without weakening input rejection. All 17 cancellation thresholds and
existing outcome assertions remain required. The exact five-file source set,
independent source review, graded checks and semantic mutations are bound in
`.packet-diagnostics/c05-owner-review-PeEuLA/final-evidence.json`. Acceptance is
separate from dispatch: a reviewed owner ledger transition never marks this
historical work order ready/done or authorizes native execution/publication.

## Owner release checklist

- [ ] Resolve SECURITY_REVIEW_REQUIRED; collect current source hashes and confirm write ownership.
- [ ] Review contract/oracle, freeze exact allowed paths and candidate acceptance.
- [ ] Resolve each dependency with source-bound acceptance; no stale DONE reuse.
- [ ] Replace the cluster's staging latch only through a separately reviewed owner
      change; executor may not change it or skip its command.
- [ ] Mark this new packet ready, then run real packet-lint (it executes commands).
      Baseline must pass; each item accept must fail before implementation.
- [ ] Dispatch one writer on the explicitly selected local route; no duplicate work.
- [ ] Inspect real receipt, scope diff, graded tests and adverse cases. Required
      independent review/native checks remain distinct from receipt completion.
