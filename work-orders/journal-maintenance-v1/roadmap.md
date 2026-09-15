# Journal maintenance — private work order

**Overall Nisi: 30% (3/10 NX milestones). This slice: 100% (5/5 deliverables).**
The percentage covers this explicit source-checkout lifecycle only, not NX-05,
an automatic retention service, authenticated revocation or release readiness.

## Accepted deliverables

- [x] Source-grounded contract and independent pre-implementation stub-red oracle.
- [x] Current owner maintenance with shared record staging, busy guard and quarantine.
- [x] Additive TypeScript contract with positive and exact negative compiler controls.
- [x] 32 lifecycle checks, unmodified relocated control, six semantic fault variants
  and full **1442/1442** portable check; 240 selected hashes unchanged during runs.
- [x] Real filesystem lifecycle with synthetic clocks, fresh-process reopen,
  replay-byte stability and postcommit uncertainty/fresh-owner reconciliation.

| Evidence | Actual result |
| --- | --- |
| [Initial stub](evidence/red.json) | 2 pass, 30 fail; 32 discovered, no skip/cancel/todo |
| [Final verification](../../.build/journal-maintenance-verification-qbLBtS/verification.json) | 1442/1442 product; 32/32 focused and relocated control; 240 stable selected pins |
| [Real disk proof](../../.build/journal-maintenance-real-BTcSPr/verification.json) | Current-file TTL payload removal, IDs/revocation preserved at both fresh-process reopen points; replay bytes unchanged |
| [Exact-source Opus review](evidence/opus-source-response.json) | PASS, no findings for owner b64e21ae…; tools disabled, no independent test execution |
| [Corrections and ownership](evidence/adjudication.md) | Retains review disagreements and verification defects rather than hiding failed attempts |

Mutation assertion-failure counts in verifier order: **11, 1, 2, 5, 1, 2**.
The first variant also caused two later fixture runtime errors. Those are recorded
separately and cannot count as semantic detections. All six variants discover 32
tests, exit 1 and have actual assertion failures. The original overstrict verifier
attempt is retained at `.build/journal-maintenance-verification-RxaxbL`; production
source and tests were not altered to make mutation results pass.

## Reproduce privately

```sh
node work-orders/journal-maintenance-v1/verify.mjs
node work-orders/journal-maintenance-v1/verify-lifecycle-disk.mjs .build/journal-maintenance-verification-qbLBtS/verification.json
```

For a new verification, pass its emitted receipt path to the second command.
Both scripts create only new owned evidence directories and check current source
hashes. Target/mutant runs are bounded to 20 seconds; the product run to 120 seconds;
fresh-child disk reopens to 15 seconds. A timeout is not acceptance.

## What this does not do

> [!WARNING]
> **No secure erasure or user-authentication claim.** Revocation is a logical
> journal relation. TTL/capacity remove payloads only from new current-file bytes;
> old snapshots, backups and storage remnants are not wiped. No live store was touched.

> [!CAUTION]
> **Explicit maintenance is not background operation.** There is no timer/sweeper,
> authenticated UI, host declaration collection, hostile-writer lock, universal
> power-loss guarantee, learning promotion or native incident admission. Permanent
> IDs remain, so maxEntries does not bound total metadata. Non-durable and uncertain
> outcomes must stay visible when a future host invokes this API.

Next work belongs in separate reviewed host/caller integration. Preserve existing
v1 callers until individually migrated; do not relabel retained findings as fixed.
Keep the new API outside published/staged package claims until package acceptance.

The subsequent read-only caller inventory found no non-test caller of
`history/host-journal-bundle.mjs`; its tested legacy API exposes journal state and
cannot be silently replaced by an opaque-owner API. `createHostRunBundleV2` and
`readHostRunBundleV2` also have test-only direct callers. Receipt modules reuse
`readFinalEngineReportV2`, which is report validation, not history persistence.
The actual `hosts/repository/reviewed-workflow-v1.mjs` path has no history connection.
Prioritize an explicit optional integration in a real host path, with separate
storage scope/consent and refusal tests, rather than claiming a nonexistent live
migration. Old compatibility helpers and their known findings remain unchanged.
