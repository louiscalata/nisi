---
packet: nisi-track6-readiness-hardening
project_root: /Users/louiscalata/nisi-next-private/work-orders/parallel-seven-tracks-v1/track6
created_by: claude
created: 2026-09-14T05:40:00-07:00
write_owner: opencode
status: done
---

# Nisi — Track 6 product-readiness checker: close two over-statement holes

## Context

Isolated private work-order directory (the Track 6 draft from the seven-track
plan). Node 24, ESM, no dependencies. `npm test` (the author's 3 tests) passes.
`npm run test:hardening` (Claude's independent oracle, 11 tests) currently
fails 2 of 11 against the draft; those two failures are the defects to fix,
and the other 9 must keep passing. Do not edit either test file.

The file under edit is `check-product-readiness.mjs`, a read-only offline
checker: it reads explicitly declared receipt files under a root, verifies
their sha256, and emits per-lane PASS / FAIL / NOT_RUN / ERROR / INCONCLUSIVE.
Two places let evidence that binds nothing count as readiness:

1. **Empty source manifest counts as PASS.** In `checkProductReadiness`, the
   `acceptable` test for a lane requires `plain(receipt.receipt.sourceManifest)`
   — any plain object, including `{}`. The drift loop then iterates zero
   entries and finds no drift, so the lane is PASS while pinning no file.
   Required behaviour: a manifest with ZERO entries is treated exactly like a
   missing manifest — the lane becomes `INCONCLUSIVE` with reason
   `MISSING_SOURCE_MANIFEST` (reuse that reason; do not invent a new one).
   `historicalStatus` still records the receipt's own status.
2. **Empty required-feature list counts as complete.** The inventory's
   `complete` is `required.every(...)`, which is `true` for `[]`. Required
   behaviour: `complete` is `true` only when `required` has at least one
   entry AND every required entry appears in `observed`. Keep the copied
   `required`/`observed` arrays in the result unchanged.

Make no other behavioural change: result key order
`schemaVersion, status, ready, authorizing, lanes, source, featureInventory`,
the frozen result, the read-only/no-mutation property, and every existing
reason string stay as they are.

## Constraints

- Write ONLY `check-product-readiness.mjs`. Everything else is read-only:
  `package.json`, both test files, `readiness-input.example.json`, `.packets/`.
  No parent-tree exploration.
- No dependencies, installs, network or model calls; no new imports.
- Do not run commands, tests or nested packets yourself. The installed wrapper
  runs the inspected acceptance checks and writes the execution receipt.
- Do not alter tests, acceptance commands, order or receipt to obtain DONE.

## Items

### P1 — Close the two holes
- **files**: check-product-readiness.mjs
- **do**: Make an empty sourceManifest INCONCLUSIVE/MISSING_SOURCE_MANIFEST and an empty required-feature list incomplete, as specified above, changing nothing else.
- **accept**: npm run test:hardening

## Packet acceptance
npm test
