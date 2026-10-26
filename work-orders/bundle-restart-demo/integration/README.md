# bundle-restart-demo — product-suite integration tests

STATUS: DONE — 2026-09-14

## What this is

Migrated product-suite versions of the demo's tests, exactly as
`docs/verification/2026-09-13/evidence-chain-integration/preflight-tests/` did
for the four integrated modules. OpenCode owns `integration/`; the demo's
`tests/`, `history/` and `hosts/` stay Claude's to integrate after review.

## Rule applied

Dropped every frozen-copy hash pin that points at a product module
(`run-journal-v1`, `run-journal-store-v1`, `fixed-run-journal-entry`,
`host-journal-bundle`) and never re-pinned one. The scratch tree binds the
product modules from `history/` (byte-identical, sha256-verified) instead of a
`frozen/` dir. Fixture pins are kept unchanged.

## Files and hashes (sha256)

- `baseline.test.mjs` — `92213684f229bd8212bcf1e2145e63f25cd549af5ef8df6d2b961ad2e2164eae`
- `demo.test.mjs` — `02c21e111db74e983b7b558403956ea1f5fe20e51fdf7e6b63a58ab3f12bcf62`
- `migration-log.json` — `0757af1496cc6be65107f806feb75cb0c6b54941fe66d3cad2a7b1efbd51601f`
- `scratch/src/bundle-restart-demo.mjs` — `3952ead61328cde6e5645d0dd1a7420fbe17ecaa556a8e9a74645f2cda04cddc` (single path edit: `../frozen/` → `../history/`)
- `scratch/fixtures/demo-cli.mjs` — `958a14f002affb589ee8a6981f0031a23447d72a82cd895c999f6927e14d97a5`
- `scratch/fixtures/summary-observed.json` — `a00dce2160b6f271080f1297b6f426c958205dc20a1369a2671c2c657bb4e8ad`
- `scratch/fixtures/summary-timeout.json` — `2d9180eb8a0d5fb6083489b1298fd23c26281df7c92ed85d74895d63e5bbd407`
- `scratch/history/run-journal-v1.mjs` — `dee9f490c091000b2560cd9464d945885e7f341091b87dde9ae4f2b7cdbd359e` (matches `history/`)
- `scratch/history/run-journal-store-v1.mjs` — `1356028b65f9f8b96e3b9ec8ba3bfbb4968092af53d00e8b5dfdb11b161f4792` (matches `history/`)
- `scratch/history/fixed-run-journal-entry.mjs` — `ba888a4f4d5b1b78f799045e44fbdfe79b75545847ab9b3ed2673fd7b353585c` (matches `history/`)
- `scratch/history/host-journal-bundle.mjs` — `97b2554b7fe50812fcb0065197964967d2beefc0c8cb322a38154ec16ebb9894` (matches `history/`)
- `scratch/package.json` — `83813476f3c178db2f3ec1fe12a7da929915ad9b3fa551ec33082c5fab522c7e`

## Verification (deterministic)

- `node --test integration/baseline.test.mjs integration/demo.test.mjs` →
  **12/12 pass, 0 fail** (from the work-order root).
- Original work-order suites remain green: `npm test` + `npm run test:demo`
  → **12/12 pass, 0 fail** (no behavior changes, path-only edits).
- All four scratch/history product modules byte-identical to `history/`.

Claude: review `migration-log.json` and promote the migrated tests per the
integration review.