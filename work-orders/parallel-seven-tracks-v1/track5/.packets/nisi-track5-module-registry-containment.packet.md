---
packet: nisi-track5-module-registry-containment
project_root: /Users/louiscalata/nisi-next-private/work-orders/parallel-seven-tracks-v1/track5
created_by: opencode
created: 2026-09-14T12:15:00-07:00
write_owner: opencode
status: done
---

# Nisi — Track 5 registry containment fixes (D1/D2) on the reviewed copy

## Context

Claude's adversarial review of `experimental/module-registry-v1.mjs`
(`evidence/claude-review-20260914.md`) found two containment defects. The
product module and the author's 7 tests stay Claude's to promote. OpenCode
copied the product module into `track5/src/`, wrote the containment oracle
from the review, confirmed it fails on the unmodified copy (10/20), then
fixed the **copy only**.

## Required behaviour

1. **D1** — `inspect()`/`disable()` must validate identifiers:
   `requireIdentifier(moduleId, 'INVALID_MODULE_ID')` and
   `requireIdentifier(versionId, 'INVALID_VERSION_ID')` inside the same try
   block that clones the request. Non-string / NUL-padded ids must answer
   `INVALID_MODULE_ID`, never `MODULE_NOT_REGISTERED`.
2. **D2** — `cloneRecord` must count `Reflect.ownKeys(input).length` so
   non-enumerable and Symbol keys are refused as `UNEXPECTED_FIELDS`.
3. Author's 7 tests (`npm run test:author`, from repo root against the
   untouched product) must stay green. No product-module edits.

## Constraints

- Write ONLY: `src/module-registry-v1.mjs` (copy), `tests/registry-containment.test.mjs`,
  `package.json`, this packet, and the README.
- Never edit `experimental/module-registry-v1.mjs` or
  `tests/experimental-module-registry.test.mjs` (Claude's to promote).
- No dependencies, installs, network or model calls.
- Do not alter the acceptance commands to obtain DONE.

## Items

### P1 — Apply D1/D2 containment fixes to the track5 copy
- **files**: src/module-registry-v1.mjs
- **do**: identifier validation in inspect()/disable(); Reflect.ownKeys in cloneRecord().
- **accept**: npm test

## Packet acceptance
npm test