# journal-restart-recovery — product-suite integration tests

STATUS: DONE — 2026-09-14

## What this is

Migrated product-suite versions of the demo's tests, exactly as
`docs/verification/2026-09-13/evidence-chain-integration/preflight-tests/` did
for the four integrated modules. OpenCode owns `integration/`; the demo's
`tests/`, `history/` and `hosts/` stay Claude's to integrate after review.

## Rule applied

Dropped every frozen-copy hash pin that points at a product module
(`run-journal-v1`, `run-journal-store-v1`) and never re-pinned one. The scratch
tree binds the product modules from `history/` (byte-identical, sha256-verified)
instead of a `frozen/` dir.

## Files and hashes (sha256)

- `baseline.test.mjs` — `e234ada37067218e58b02c41db7aec11122e192bd06a846d2cd0cc24e0f0fc9d`
- `recovery.test.mjs` — `5d93a68d556cafab1cfce7bcb5cd444bc15108c0e77efa99bb6d6989eb9bb9dd`
- `owner-boundaries.test.mjs` — `2dabca5b8b7d0e9ed6ff414f28e962f9108ef5f903f1608af86b28ffb2f7f7b8`
- `migration-log.json` — `e669b793b8ddbb6b346fe5ee4afad5aef12a884edd7af04bc6619b8772c4bf77`
- `scratch/src/recovery-worker.mjs` — `141c55dc776a4667fe59f787d1154113d778357449beb3e416abc2ab59ecfdbb` (two path edits: `../frozen/` → `../history/`)
- `scratch/fixtures/worker-cli.mjs` — `8cd02b64f3aed158c77b34d9a6fe8c2fa7aaf3de36a2c61dfaa0b88d990aff1d`
- `scratch/history/run-journal-v1.mjs` — `dee9f490c091000b2560cd9464d945885e7f341091b87dde9ae4f2b7cdbd359e` (matches `history/`)
- `scratch/history/run-journal-store-v1.mjs` — `1356028b65f9f8b96e3b9ec8ba3bfbb4968092af53d00e8b5dfdb11b161f4792` (matches `history/`)
- `scratch/package.json` — `bae09eb137cb8196a85c870650b5a5dbceb5c5a0927fb0010cd6d4a5cb0d28f5`

## Verification (deterministic)

- `node --test --test-timeout=10000 integration/baseline.test.mjs
  integration/recovery.test.mjs integration/owner-boundaries.test.mjs` →
  **17/17 pass, 0 fail** (from the work-order root).
- Original work-order suites remain green: `npm test` + the ORIGINAL
  `tests/recovery.test.mjs` + `tests/owner-boundaries.test.mjs` →
  **17/17 pass, 0 fail** (no behavior changes, path-only edits).
- Both scratch/history product modules byte-identical to `history/`.

Claude: review `migration-log.json` and promote the migrated tests per the
integration review.