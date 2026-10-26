---
packet: nisi-v02-c04-fixture-containment
project_root: ~/nisi
created_by: codex
created: 2026-09-18T17:10:00-07:00
write_owner: opencode
status: blocked
---

# C04 — Close the fixture oracle's known escape-test blind spots

> PRIVATE — STAGED, NOT DISPATCH-READY. SECURITY_REVIEW_REQUIRED.
> This new order never resets or resumes a historical executing packet.

## Context

Retained finding 3 lists six leak patterns missed by the old lexical guard. Test doubles and API interception are regression oracles, not a security sandbox. Whole temporary-directory inventories can change from unrelated processes and must not become flaky acceptance conditions.

Milestone mapping: NX-04/NX-09. Coauthor/review assignment: Fable 5.1.
Cluster dependencies: C03.
The executor receives only a contract frozen by the owner. The current order is
held until its named stop below is resolved. Source references (read-only unless
also explicitly listed in an item):

- work-orders/parallel-seven-tracks-v1/track1/repository-fixture-runner.test.mjs
- work-orders/parallel-seven-tracks-v1/track1/README.md
- tests/helpers/live-cli-side-effect-guard.mjs
- tests/helpers/owned-temp.mjs

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
- Hold: This security-sensitive oracle work stays held until the owner freezes and independently reviews its guard design. No unattended security implementation or sandbox claim.

## Items

### P1 — Add the discriminating regression oracle
- **files**: work-orders/parallel-seven-tracks-v1/track1/findings-cluster-containment.test.mjs
- **do**: Use an exclusive synthetic root with separate owned and escape subdirectories. Assert rejection of parent escape, fsp.open write, callback fs.writeFile, symlink ancestor, link/.. traversal and allocation before validation; inspect residue before cleanup. Record actual per-mutant assertion failures (at least one), with valid control passing. Runtime/import errors, skips and timeouts earn no mutant credit. Create the named test only after the owner resolves the hold. Syntax acceptance here proves only a parseable oracle; behavioral acceptance is P2.
- **accept**: node --check work-orders/parallel-seven-tracks-v1/track1/findings-cluster-containment.test.mjs

### P2 — Implement the frozen bounded change and verify
- **files**: work-orders/parallel-seven-tracks-v1/track1/repository-fixture-runner.mjs, work-orders/parallel-seven-tracks-v1/track1/repository-fixture-runner.test.mjs, work-orders/parallel-seven-tracks-v1/track1/findings-cluster-containment.test.mjs, work-orders/parallel-seven-tracks-v1/track1/fixture-write-guard.mjs
- **do**: Extract/harden the fixture-only guard, tracking owned-root allocation and realpath of deepest existing ancestors without normalizing away symlink semantics first. Observe promised callback/sync/async write APIs, write-capable open flags and both paths for two-path operations. Before profile/source validation allow no writes. After allocation admit only descendants of that exact root; reject workspace roots outside it. Never touch or snapshot-delete unrelated temp roots; restore all monkey patches in finally. Preserve the product source and existing hash-bound fixture.
- **accept**: npm run test:c04 --prefix work-orders/v02-finish-cluster-v1
- **needs**: P1

## Packet acceptance

npm test --prefix work-orders/v02-finish-cluster-v1
npm run test:dispatch --prefix work-orders/v02-finish-cluster-v1 -- C04

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

