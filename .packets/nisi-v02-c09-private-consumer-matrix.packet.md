---
packet: nisi-v02-c09-private-consumer-matrix
project_root: ~/nisi
created_by: codex
created: 2026-09-18T17:10:00-07:00
write_owner: opencode
status: blocked
---

# C09 — Make private package evidence explicit for each supported Node runtime

> PRIVATE — STAGED, NOT DISPATCH-READY. RUNTIME_SELECTION_REVIEW.
> This new order never resets or resumes a historical executing packet.

## Context

The staged offline archive/TypeScript rehearsal already exists. Current observed Node is 24.18.0; declared Node >=22 does not prove a Node22 test. Preserve exact package allowlist, private:true, UNLICENSED, exports and all prior dirty package changes. Do not run npm pack on the canonical private root.

Milestone mapping: NX-09. Coauthor/review assignment: Codex.
Cluster dependencies: C01.
The executor receives only a contract frozen by the owner. The current order is
held until its named stop below is resolved. Source references (read-only unless
also explicitly listed in an item):

- scripts/check-private-package.mjs
- scripts/private-package-contract.mjs
- tests/private-package-contract.test.mjs
- tests/private-consumer.test.mjs
- tests/private-consumer/declaration-regressions.test.mjs

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
- Hold: Owner verifies available executable paths and exact rehearsal receipt schema before dispatch. Installation/testing under another runtime is a separate bounded run; no automatic environment upgrade.

## Items

### P1 — Add the discriminating regression oracle
- **files**: work-orders/v02-finish-cluster-v1/consumer/runtime-matrix-v1.test.mjs
- **do**: Build a pure report reader for separately retained staged-rehearsal records: exact artifact/source/runtime identity; unsupported, missing, malformed, failed, skipped and stale rows remain non-PASS. Positive fixtures require successful runtime and TypeScript/negative-control evidence for the same archive; unknown durations/tokens remain null. Cross-runtime archive mismatch and relabeling Node24 as Node22 must fail. Create the named test only after the owner resolves the hold. Syntax acceptance here proves only a parseable oracle; behavioral acceptance is P2.
- **accept**: node --check work-orders/v02-finish-cluster-v1/consumer/runtime-matrix-v1.test.mjs

### P2 — Implement the frozen bounded change and verify
- **files**: work-orders/v02-finish-cluster-v1/consumer/runtime-matrix-v1.mjs, work-orders/v02-finish-cluster-v1/consumer/runtime-matrix-v1.test.mjs, work-orders/v02-finish-cluster-v1/consumer/README.md
- **do**: Reuse the existing archive/consumer rehearsal without changing its export/file boundary; produce a matrix with independent Node22 and current-Node results. A missing installed approved Node22 runtime stays NOT_RUN with a concrete prerequisite, never automatic download. Document exact isolated local install command from the existing rehearsal, with offline and ignore-scripts, for later owner execution. Do not execute installers or alter packages/config in this packet.
- **accept**: npm run test:c09 --prefix work-orders/v02-finish-cluster-v1
- **needs**: P1

## Packet acceptance

npm test --prefix work-orders/v02-finish-cluster-v1
npm run test:dispatch --prefix work-orders/v02-finish-cluster-v1 -- C09

## Owner release checklist

- [ ] Resolve RUNTIME_SELECTION_REVIEW; collect current source hashes and confirm write ownership.
- [ ] Review contract/oracle, freeze exact allowed paths and candidate acceptance.
- [ ] Resolve each dependency with source-bound acceptance; no stale DONE reuse.
- [ ] Replace the cluster's staging latch only through a separately reviewed owner
      change; executor may not change it or skip its command.
- [ ] Mark this new packet ready, then run real packet-lint (it executes commands).
      Baseline must pass; each item accept must fail before implementation.
- [ ] Dispatch one writer on the explicitly selected local route; no duplicate work.
- [ ] Inspect real receipt, scope diff, graded tests and adverse cases. Required
      independent review/native checks remain distinct from receipt completion.

