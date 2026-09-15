# Track 5 — module registry containment fixes

STATUS: DONE — 2026-09-14

## What was done

Claude's adversarial review (`evidence/claude-review-20260914.md`) found two
containment defects in `experimental/module-registry-v1.mjs`. OpenCode copied
the product module into `track5/src/` (byte-identical), wrote a containment
oracle from the review's missing-oracle list, confirmed it FAILED on the
unmodified copy (10/20 failing), then applied the two one-line fixes to the
**copy only**. The product module and the author's 7 tests stay Claude's to
promote.

## Defects fixed in `track5/src/module-registry-v1.mjs` (copy)

- **D1** — `inspect()` and `disable()` skipped identifier validation: they ran
  `cloneRecord` but no `requireIdentifier`, so non-string / NUL-padded
  `moduleId`/`versionId` reached the Map-key concatenation and were misreported
  as `MODULE_NOT_REGISTERED` (or could forge keys across the `\0` separator).
  Fix: `requireIdentifier(request.moduleId, 'INVALID_MODULE_ID')` and
  `requireIdentifier(request.versionId, 'INVALID_VERSION_ID')` inside the same
  try block that clones the request.
- **D2** — `cloneRecord` counted `Object.keys(input).length`, which misses
  non-enumerable and Symbol keys, so hidden fields on manifests/requests were
  silently accepted. Fix: use `Reflect.ownKeys(input).length`.

## Verification (deterministic)

- `npm test` — containment suite green: **20/20 pass, 0 fail**.
- `npm run test:author` — author's 7 tests green against the untouched
  product: **7/7 pass, 0 fail** (run from repo root against
  `tests/experimental-module-registry.test.mjs`).
- Diff between product and copy is exactly the two fixes (3 hunks).
- Chami gate scan: NOT_RUN (JS outside py/swift scope).
- Defect probes on the fixed copy: `inspect({moduleId:123})` →
  `INVALID_MODULE_ID`; NUL-padded id → `INVALID_MODULE_ID`; non-enumerable
  hidden manifest key → `UNEXPECTED_FIELDS`; Symbol key → `UNEXPECTED_FIELDS`.

## Files and hashes (sha256)

- `src/module-registry-v1.mjs` — `567622623bb274cdf233b83bce5b202413ae8c6e230a00bdc7fbb50cefcde326`
- `tests/registry-containment.test.mjs` — `f4689231ba5c19647bdac97f12be054f809dfb2f5ba70ac21a588939b3e02f3b`
- `package.json` — `0a159553b82dd76065759f93bf1282de23db80301c9f05af428e1a10a0d05108`
- `retained-bn01-module.json` (unchanged fixture) — `faeb1005f95cc1e505a888f538106cc9ca34e59746678ba8d415b67137b50f7b`

Claude: promote the copy's fixes into `experimental/module-registry-v1.mjs`
and run `tests/experimental-module-registry.test.mjs` and
`track5/tests/registry-containment.test.mjs` per the Triage acceptance.