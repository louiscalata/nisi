# Changelog

Changes to the public Nisi package are recorded here. This file describes the
public source tree and does not include private experiments.

## Unreleased source update (0.2.1-dev)

- Add `storeTimeoutMs` (default 1000 ms) for one required terminal report-storage
  attempt after workflow timeout or cancellation, using an independent signal
  and preserving the clock watermark and original `workflowOutcome`.

- Validate every journal fingerprint, including pruned rows. Pruning now hashes
  the stored null-payload projection; re-appending discarded original content
  conflicts. Older pruned records with unreconstructable fingerprints are rejected.
- Ignore absent redaction paths, reject duplicate retry target/attempt pairs,
  cap total history at 10,000 records, bound entry nesting to 64 levels, scan
  only retained rows during pruning, and add time-aware `serialize(now)`.
- Refuse consent clock regression after any valid observation, make observed
  expiry terminal, and refuse files with multiple hard links.
- Accept revalidated normalized candidates at workflow boundaries. Treat demo
  source as data, remove CLI demo reports after verification, expose allowlisted
  local-model failure diagnostics, and align review schema string constraints.
- Correct journal authentication, redaction, recovery, storage-order and clock
  wording; document report-store deadline limits and the source-only Swift helper.
  Earlier main-only redaction/liveness wording corrections are included here;
  no released archive, history or tag is changed by this source update.


- Add source-checkout workflow-control, mocked-interface, and inert-overhead
  benchmarks, plus a 12-task exploratory pilot against one configured local
  Gemma chat endpoint. Retain raw pilot candidates, reports, and request
  receipts so the exact-match results can be rescored.
- Add GitHub-readable benchmark graphs and a study plan that separates this
  single local integration from untested providers and production outcomes.
  Those benchmark additions did not change the released v0.2.0 runtime. The
  unreleased fixes above do change runtime behavior; the file allowlist is unchanged.

## 0.2.0

- Add an installable `nisi` command for help, version, a fixed deterministic
  workflow demonstration, and an opt-in fixed local-model JSON demonstration.
  The CLI does not apply changes to a repository or execute model-generated code.
- Retain the public workflow and local-chat APIs. Add the run journal and journal
  store introduced in the release candidates, including rc.2's retained-entry
  fingerprint check during reopen.
- Distribute source and an npm-format archive through the GitHub release. No
  npm registry publication or native application is included.

## 0.2.0-rc.2

- Reject a retained run-journal entry on reopen when its recorded fingerprint
  differs from the validated, redacted entry. This prevents a crafted, rehashed
  journal from reversing duplicate and conflict classification for that ID.

## 0.2.0-rc.1

- Add the append-only run journal with entry validation, configured payload
  redaction, expiry/revocation handling, canonical serialization and verified
  reopen reporting.
- Add a journal store that validates serialized data and uses a same-directory
  temporary file, synchronization, read-back and rename; commit and durability
  are reported separately. On Windows, request directory synchronization through
  a write-access handle; an unsuccessful sync still reports non-durable.
- Retain Nisi v0.1 workflow and local-chat APIs as the existing package
  compatibility surface.
- Limit package exports to declared runtime modules. Undocumented deep imports
  of package internals that resolved through the previous wildcard may stop
  resolving; no recovery worker is shipped.
- Restrict GitHub Actions workflow token permissions to repository contents
  read-only and pin checkout/setup-node to reviewed commit SHAs.

See [the v0.2 verification record](docs/verification-v0.2.md) for the narrow
verification scope and its limits. This release candidate does not claim full
platform support, live provider behavior, performance gains, or production
readiness.
