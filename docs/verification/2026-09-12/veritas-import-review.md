# NX-03 — Private Veritas source import review

**Date:** September 12, 2026  
**Scope:** reproducible source freeze and dependency inventory only  
**Integration, legacy runtime, native app, model execution and release:** NOT_RUN

## What changed

The initial import contained 221 files from `tooling` and `native/macos`.
Inspection found that several tooling checks also require the original root
`veritas.ts`, `package.json`, `package-lock.json` and `.npmrc`. The initial import
therefore did not include the main legacy implementation or its root contract.

Those four exact files are now retained at `integrations/veritas/`, bringing the
current freeze to **225 files / 8,027,242 bytes**. A fresh original-versus-import
comparison found identical included paths, byte lengths and SHA-256 digests.
The source checkout's HEAD was `87b89102a4e231cea47b66f7a33da5a84f17d049`, but its
working tree is dirty and contains untracked source. HEAD alone is not this
import's identity; the per-file manifest is the source snapshot record.

The current [manifest](../../../integrations/veritas/import-manifest.json)
records that snapshot. The
[initial subtree manifest](../../../integrations/veritas/import-manifest-initial-subtrees.json)
is retained to explain the earlier 221-file count and omission.

## Data and execution boundaries

- The root `.npmrc` was screened before copying. Its four settings are known
  boolean values for `engine-strict`, `fund`, `audit` and `update-notifier`.
  It contains no authentication configuration. Root package metadata was also
  checked for authentication fields/credential-bearing URLs before copying.
- The copy did not traverse hidden subtree entries, `node_modules`, `DerivedData`
  or `*.xcresult`. Only the explicitly listed root files and two subtrees are in
  this freeze. This is not a general secrets audit or whole-repository backup.
- Original excluded entries observed: native `.build`, `.gitignore`, `.packets`,
  `.swiftpm`; tooling `.gitignore`, `.npmrc`, `.packets`, `node_modules`.
- The historical gate-event fixture inside the native test resources is retained
  privately and included in the hashes. It is not a live incident store.
- Existing source/evidence at the original Veritas root was not altered. No
  protected evidence root was copied or executed. No legacy main program, native
  test harness, model, signing step or publishing command was run for this review.

## Repeatable check

From the private Nisi working copy:

```sh
node scripts/verify-veritas-import.mjs
node --test tests/veritas-import.test.mjs tests/veritas-import-snapshot.test.mjs
node scripts/test-veritas-import-mutants.mjs
```

The reader checks its closed manifest schema, exact inventory, file size and
digest, and rejects symlinks within included source. It reports
`PASS_SOURCE_FREEZE_ONLY`; `integrationVerified` and `legalClearance` remain false.
Subsequent ordinary checks compare the import against the manifest, not against
the currently mounted original (`originRechecked: false`).

This is a change detector on trusted, stable host paths. A manifest can be edited
alongside files; its hash is not a signature, provenance authority, atomic
filesystem snapshot or defense against a malicious local process.
Its source metadata records the earlier local observation; the ordinary checker
does not authenticate or independently verify that metadata. Actual origin-byte
comparison and the later manifest-only check are different evidence scopes.

## Checked results

- **14/14 normal tests passed** on local Node 24.18.0, including the real
  225-file inventory and isolated positive/negative fixtures.
- A passing unmodified fixture-suite control is required before mutant execution.
- **4/4 targeted mutants were detected**, with exactly one expected failed check
  each: disabled content-digest comparison; disabled exact inventory guard;
  accepted schema-version drift; accepted unknown top-level authority field.
- The inventory mutant still reaches a different downstream refusal; that test
  proves detection of the missing inventory guard/error-classification change,
  not that this mutant would otherwise authorize extra files.
- Initial mutation output under `.build/import-mutants-1ZW20A/` was invalidated:
  an absent real-source fixture inflated each failure count. Raw source and output
  remain there with `INVALIDATED.md`. Corrected evidence is retained separately;
  it requires the exact failing test name, not merely a nonzero exit code.

These tests do not establish the completeness of all negative cases or acceptance
of imported Veritas code. A machine-readable receipt beside this document binds
the final checker/test source and latest outputs:
[final source-bound receipt](veritas-import-receipt.json).

## Dependencies still required for later stages

| Dependency | Current evidence / next action |
|---|---|
| Legacy root implementation and package contract | Missing initially; corrected by exact-byte import. Not executed. |
| Tooling dependencies | Not imported or provisioned. The retained installation verifier expects an external `/private/tmp/` dependency symlink with pinned packages. Prepare and verify a private runtime before lint/type/full Stage 5 execution; do not silently weaken that verifier. |
| Tooling-local `.npmrc` | Excluded by the original subtree policy. Review its settings when provisioning the tooling runtime rather than assuming the imported root config is equivalent. |
| Swift platform | Installed `xcrun swiftc` reports Swift 6.4 and an arm64 macOS 27 target. This is toolchain discovery, not compile, native test or installation acceptance. |
| Optional native host | Source has no third-party Swift package dependencies; it still requires the platform SDK, system SQLite, native build/test acceptance and unresolved UI/auth gates. |
| Alternate Xcode/platform lanes | Scripts contain explicit Xcode 26.6/27 paths. Neither lane was executed here; copied source cannot establish support for another OS. |
| Nisi runtime bridge | No production static-check adapter is wired yet. It must invoke the actual Swift deterministic gate, bind request/candidate/profile/source/binary identities and preserve unavailable outcomes. |

Luna performed the bounded dependency audit and checker review; Daybreak provided
a source-based defensive design review for the next native verifier connection.
Neither review substitutes for runtime tests. No new Claude inference is claimed;
the earlier expired-authentication failure was not automatically retried.

Review disposition: the provenance and filesystem limitations are stated above.
The mutation harness intentionally writes only its own generated evidence under
the private workspace's ignored `.build/` directory, outside all frozen import
roots. This is a test operation, not the read-only import check; no evidence was
deleted to satisfy the review's cleanup suggestion, because retention is required.

## Acceptance boundary

NX-03 can record **source freeze and dependency inventory complete**. NX-04 through
NX-10 remain incomplete. This does not narrow the merger to copied files or one
adapter: failure history, evaluated prevention, execution ownership, native UI and
experimental modules still require their own integration and acceptance evidence.

All imported code and this review remain private under the existing disclosure,
filing and exact legal/engineering release gates. Nothing was committed or pushed.
