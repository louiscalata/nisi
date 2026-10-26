# Disk-to-history integration

**Overall Nisi: 30% (3/10 NX milestones). This scoped slice: 100% (5/5).**
Private source-checkout acceptance, not native/UI, packaged product or release.

- [x] Review the exact disk-reader and one-use permit contracts; define separate
  source selection/storage declarations and explicit limits.
- [x] Implement only `hosts/history/import-fixed-xpc-from-disk-v1.mjs`; preserve
  prior 234 selected source/test/type/script hashes.
- [x] Pass 40 tests; retain initial 0/32 stub, source-bound Opus review and six
  deliberate semantic faults caught. Relocated unmodified control: 40/40.
- [x] Run canonical `npm run check`: 1408/1408, zero fail/skip/cancel/todo,
  237 before/after selected pins unchanged.
- [x] Import 3 retained fixed-XPC records through the actual disk host to a new
  private filesystem journal; file/directory fsync, readback and fresh-process
  reopen of exact IDs/source/declaration digests pass. Original inputs unchanged.

## Human explanation

The host now connects two previously separate pieces: safely reading one selected
static file and admitting its bounded observation into history once. It does not
discover files, request OS permissions, authenticate a person or learn from the
observation automatically. Cancellation does not discard cleanup warnings or the
actual result of a journal write that was already admitted.

## Exact evidence

- [Contract](CONTRACT.md)
- [Adjudication/model accounting](evidence/adjudication.md)
- [237-file acceptance and six mutants](../../.build/disk-history-import-verification-cTQCH7/verification.json)
- [Three-source actual filesystem verification](../../.build/disk-history-retained-2QE4qV/verification.json)
- [Canonical product roadmap](../../roadmap.md)

## Open integration boundaries

Host/UI approval collection, authenticated-consent claims, persisted selection
provenance, stored-row revocation, physical retention cleanup, old v1 caller
migration, native incident admission and staged-package inclusion are not done.
The next owner must specify those contracts before enabling automatic collection.

> [!WARNING]
> **Do not widen the reader's guarantee.** `operator-trusted-static-local-v1`
> does not prove hostile-tree containment, atomic snapshots, local mount type or
> hard I/O cancellation. The caller asserts one file's scope; authenticity stays
> false. A successful observation import is not a successful new native run.
