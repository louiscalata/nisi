---
packet: nisi-v02-c01-overlay-clean-state
project_root: /Users/louiscalata/nisi
created_by: codex
created: 2026-09-18T17:10:00-07:00
write_owner: opencode
status: ready
---

# C01 — Accept a clean native overlay without recreating stale build artifacts

> PRIVATE — RELEASED by owner 2026-09-18 (status: ready). Fable 5.1 revised
> co-review FAIL findings resolved in the frozen oracle; the staging latch was
> replaced by a separately reviewed owner change (dispatch-check.mjs).
> This new order never resets or resumes a historical executing packet.

## Context

Fresh September 18 reproduction: overlay 6/8; both failures require a now-absent legacy .build directory. Frozen-import checks 13/13 pass. The failure is not evidence that source bytes are missing. The retained debug receipt records two regular files: .buildSystem_debug, 10 bytes, cd1ba1c9604b794d71cd3cb482cc02e4c16bdea56c361333fabe801a74db2b90; CACHEDIR.TAG, 209 bytes, 61833598201b8d9bb6a18003b6be9fd00ae014cfbd583253c1f23b746bf035d1. Paths share prefix native/macos/CodenameVeritasFramework/.build/.

Milestone mapping: NX-04/NX-07. Coauthor/review assignment: Fable 5.1.
Cluster dependencies: none.
The executor receives only a contract frozen by the owner. The current order is
held until its named stop below is resolved. Source references (read-only unless
also explicitly listed in an item):

- tests/nisi-native-overlay.test.mjs
- work-orders/parallel-seven-tracks-v1/build-nisi-macos.mjs
- scripts/verify-veritas-import.mjs
- docs/verification/2026-09-14/nisi-app-bundle/nisi-app-bundle-debug-GKiX5y.verification.json

## Constraints

- One writer; inspect fresh dirty state and coordinate with Claude before handoff.
- No writes outside the item file lists. Packet/config/acceptance-control files
  are owner-managed and never executor targets.
- Never edit, format, build inside or re-pin integrations/veritas/.
- Preserve existing dirty work, historical packets, failed evidence and source IDs.
- Traversal root is frozenPackage (the overlay package under importedRoot); collect()
  never scans importedRoot as a whole and ignores manifest paths outside frozenPackage.
- No installation, native launch, model call, network, credentials, service changes,
  signing, publication, commits or pushes from an edit-phase packet.
- No automatic tier fallback, stale forced retry, scope expansion or invented APIs.
- Every new regression must run in the graded cluster command, not an unused file.
  Coauthored tests are not independent acceptance by themselves.
- Imported/generated code is inspected by the owner before execution.
- Hold: RESOLVED 2026-09-18 by owner — contract and oracle reviewed; Fable 5.1
  revised co-review FAIL findings 1-3 closed (regular-file sha256, nested
  accessors, explicit traversal root). Native build acceptance is a later
  separate check, never inferred from Node tests.

## Items

### P1 — Add the discriminating regression oracle
- **files**: tests/native-overlay-inventory-v1.test.mjs
- **do**: Add pure synthetic inventory tests for clean absence, the exact historical marker set and digests, unknown entries, symlinks, wrong kinds/sizes/bytes, partial markers and before/after mutation. Test absent .build remains absent after validation. Preserve every source hash, compiled-source traversal and branding assertion.
  Create the named test only after the owner resolves the hold (resolved
  2026-09-18; Fable 5.1 findings closed). Gate is behavioral: test:oracle fails
  until scripts/native-overlay-inventory-v1.mjs exists, passes once it does;
  P2 remains the cluster-wide graded gate.
- **accept**: npm run test:oracle --prefix work-orders/v02-finish-cluster-v1

### P2 — Implement the frozen bounded change and verify
- **files**: scripts/native-overlay-inventory-v1.mjs, tests/native-overlay-inventory-v1.test.mjs, tests/nisi-native-overlay.test.mjs, work-orders/parallel-seven-tracks-v1/build-nisi-macos.mjs
- **do**: Extract a pure inventory check used by the Nisi-owned build proof and its tests. Accept only CLEAN_ABSENT or HISTORICAL_MARKERS as defined above; reject mixed/unknown snapshots. Compare exact before/after state so accepting either starting state never accepts a transition during a build. Update the two stale required-directory expectations. Do not modify the import verifier, frozen files, import manifest or marker bytes. Keep all compiled-source and manifest guards. No Swift build, launch or signing in this packet.
- **accept**: npm run test:c01 --prefix work-orders/v02-finish-cluster-v1
- **needs**: P1

## Packet acceptance

npm test --prefix work-orders/v02-finish-cluster-v1
npm run test:dispatch --prefix work-orders/v02-finish-cluster-v1 -- C01

## Owner release checklist

- [ ] Resolve CONTRACT_REVIEW_REQUIRED; collect current source hashes and confirm write ownership.
- [ ] Review contract/oracle, freeze exact allowed paths and candidate acceptance.
- [ ] Resolve each dependency with source-bound acceptance; no stale DONE reuse.
- [ ] Replace the cluster's staging latch only through a separately reviewed owner
      change; executor may not change it or skip its command.
- [ ] Mark this new packet ready, then run real packet-lint (it executes commands).
      Baseline must pass; each item accept must fail before implementation.
- [ ] Dispatch one writer on the explicitly selected local route; no duplicate work.
- [ ] Inspect real receipt, scope diff, graded tests and adverse cases. Required
      independent review/native checks remain distinct from receipt completion.

