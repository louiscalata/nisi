---
packet: nisi-v02-c03-fixture-cleanup
project_root: ~/nisi
created_by: codex
created: 2026-09-18T17:10:00-07:00
write_owner: opencode
status: blocked
---

# C03 — Report cleanup, cancellation and completion from observed outcomes

> PRIVATE — NODE IMPLEMENTATION ACCEPTED; REPEAT DISPATCH CLOSED.
> This new order never resets or resumes a historical executing packet.

## Owner integration acceptance — September 20, 2026

Accepted as **INERT_FIXTURE_CLEANUP_NODE_ONLY** through Fable draft reuse,
Daybreak/Luna bounded corrections and independent Codex integration. C03 80/80,
C02 33/33, C01 42/42 and cluster baseline 47/47 pass; 10 deliberate mutants
are assertion-detected. Nisi contract/syntax validation is VALIDATED but remains
advisory, not a model review or workflow certificate. Final evidence and seven
source/test/document hashes are recorded in `cluster.json`; C02's prior hashes
and evidence path are preserved in its explicit revalidation history.

This is direct owner integration, **not OpenCode execution**. The executor
release checklist below is historical and was not performed. Status stays
blocked against duplicate dispatch, including after runtime recovery. No native
build, external inference, publication or release acceptance is established.

## Owner contract amendment — September 20, 2026

C02 is accepted at runner `07020b77…`. Fable is paused; Codex owns isolated
correction and eventual canonical integration. Reuse frozen C03 `6e440f53…`
and its `d52b38e9…` oracle, retaining C02's independent original-identity bundle
reader. The partial C03b helper must not replace the closed own-data reader.
Its explicit sixth-clause structure is not required where the actual receipt
writer already enforces both the observed completion and independent bundle gate.

Lifecycle vocabulary is resolved as an additive field, `cleanupState`:

- `NOT_CREATED`: no owned root was returned by allocation. Legacy `cleaned:true`
  means no cleanup was needed, not that a removal was observed. Allocation failure
  still returns REFUSED with its exact OS code and no receipt.
- `REMOVED`: the exact owned pathname returned ENOENT at post-removal lstat.
- `PRESENT`: that lstat succeeded and the entry remains present.
- `UNKNOWN`: post-removal lstat failed with another error; absence is unverified.

For an allocated root, `cleaned:true` requires successful rm AND `REMOVED`.
An rm rejection followed by ENOENT is `REMOVED` but `cleaned:false`, with the
removal error preserved. Any cleanup error prevents successful completion and
withdraws the returned receipt. Previously observed receipt bytes remain
diagnostic records; their existence is not hidden. Report-code precedence for
CANCELLED/TIMED_OUT remains unchanged. Cleanup assumes a trusted stable parent;
this is not hostile-filesystem isolation or process-wide drain proof.

Owner-owned acceptance additionally includes independent actual-caller fault
tests (`tests/fixture-cleanup-boundaries.test.mjs`) and lifecycle-state tests
(`tests/fixture-cleanup-state.test.mjs`), plus a closed-reader oracle
(`tests/fixture-completion-reader.test.mjs`). All run in graded C03–C05 checks;
the original C02 tests remain mandatory. The owner also updates the track README
and cluster controls, preserving historical C02 hashes in an explicit
supersession record before any accepted shared-runner hash changes.
The original runner test changes only its exact import allowlist to admit
`node:util` for non-trapping Proxy detection. Its behavioral assertions remain.

This amendment resolves the lifecycle design question, not dispatch admission.
The owner integration above completes its bounded implementation acceptance;
the packet remains blocked against duplicate execution. No OpenCode receipt
is invented for direct owner integration.

## Context

Retained findings 2/5/7/8: cleaned:true is constant, removal failures swallowed, and SETTLED can be mislabeled COMPLETED for an interrupted report. Current runner creates and removes only its own fixture root. It is not a general cleanup service.

Milestone mapping: NX-04/NX-07. Coauthor/review assignment: Fable 5.1.
Cluster dependencies: C02.
The executor receives only a contract frozen by the owner. The current order is
held until its named stop below is resolved. Source references (read-only unless
also explicitly listed in an item):

- work-orders/parallel-seven-tracks-v1/track1/repository-fixture-runner.mjs
- work-orders/parallel-seven-tracks-v1/track1/repository-fixture-runner.test.mjs
- work-orders/parallel-seven-tracks-v1/track1/README.md

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
- Hold: Implementation is accepted only in the scope above; repeat dispatch is closed. Do not use this as proof of process-wide drain or hostile-filesystem isolation.

## Items

### P1 — Add the discriminating regression oracle
- **files**: work-orders/parallel-seven-tracks-v1/track1/findings-cluster-cleanup.test.mjs, tests/fixture-cleanup-boundaries.test.mjs, tests/fixture-cleanup-state.test.mjs, tests/fixture-completion-reader.test.mjs
- **do**: Capture residue before test-finally cleanup. Cover removal rejection, lstat error other than ENOENT, mkdtemp failure, chmod failure, pre-abort, cancellation timing, settlement rejection and each false clause in the completion predicate. Check exact adverse reason and that an unconfirmed run never returns an accepted completion receipt. Tests clean only their own exclusive roots after capturing adverse evidence. Create the named test only after the owner resolves the hold. Syntax acceptance here proves only a parseable oracle; behavioral acceptance is P2.
- **accept**: node --check work-orders/parallel-seven-tracks-v1/track1/findings-cluster-cleanup.test.mjs

### P2 — Implement the frozen bounded change and verify
- **files**: work-orders/parallel-seven-tracks-v1/track1/repository-fixture-runner.mjs, work-orders/parallel-seven-tracks-v1/track1/repository-fixture-runner.test.mjs, work-orders/parallel-seven-tracks-v1/track1/findings-cluster-cleanup.test.mjs, tests/fixture-cleanup-boundaries.test.mjs, tests/fixture-cleanup-state.test.mjs, tests/fixture-completion-reader.test.mjs, work-orders/parallel-seven-tracks-v1/track1/README.md
- **do**: Derive observed completion from settled && report.outcome==='COMPLETED' && report.workflowOutcome==='COMPLETED' && hostResult.bundleError===null && hostResult.proposedChanges!==null/undefined using closed own-data fields; actual receipt eligibility additionally requires the unchanged independent C02 bundle gate. Build the frozen result after cleanup using the exact cleanupState/cleaned/error vocabulary in the owner amendment. Prefer report.code for CANCELLED/TIMED_OUT. Move owned-root creation/permission handling inside the controlled error path and retain the exact ownedRoot on partial failure. If receipt bytes were written before a failed removal, report their existence as adverse retained evidence; do not promise absent bytes or accepted receipt. Never remove an unrelated path under the documented trusted stable parent precondition.
- **accept**: npm run test:c03 --prefix work-orders/v02-finish-cluster-v1
- **needs**: P1

## Packet acceptance

npm test --prefix work-orders/v02-finish-cluster-v1
npm run test:dispatch --prefix work-orders/v02-finish-cluster-v1 -- C03

## Owner release checklist

- [ ] Resolve DEPENDENCY_AND_LIFECYCLE_REVIEW; collect current source hashes and confirm write ownership.
- [ ] Review contract/oracle, freeze exact allowed paths and candidate acceptance.
- [ ] Resolve each dependency with source-bound acceptance; no stale DONE reuse.
- [ ] Replace the cluster's staging latch only through a separately reviewed owner
      change; executor may not change it or skip its command.
- [ ] Mark this new packet ready, then run real packet-lint (it executes commands).
      Baseline must pass; each item accept must fail before implementation.
- [ ] Dispatch one writer on the explicitly selected local route; no duplicate work.
- [ ] Inspect real receipt, scope diff, graded tests and adverse cases. Required
      independent review/native checks remain distinct from receipt completion.
