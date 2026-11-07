# Changelog

Changes to the public Nisi package are recorded here. This file describes the
public source tree and does not include private experiments.

## Unreleased

- Add `nisi/adapters/jev-advisor`, optional Jev (TypeSafe System One)
  pre- and post-analysis. `planWithJev(task, { judge })` asks Jev whether a task
  needs the model to reason and maps the answer to local-chat settings
  (`direct`: `reasoningEffort: 'none'`, 1,024 tokens; `reason`: 4,096 tokens).
  `createJevReviewer({ id, judge })` is a reviewer that records Jev's
  probability that the candidate meets every criterion. It is advisory unless
  created with `gate: true`. Nisi never calls Jev itself: the host supplies
  `judge`, and every typed answer is validated.

- Add a `reasoningEffort` option to the local-chat adapters (`none`, `minimal`,
  `low`, `medium`, `high`), sent as `reasoning_effort`. With a reasoning model,
  `none` stops hidden thinking from spending the output budget, which otherwise
  ends calls with `LOCAL_CHAT_FINISH_REFUSED`. Without the option, requests are
  byte-identical to before. Invalid values are refused with
  `LOCAL_CHAT_REASONING_EFFORT_INVALID`. The live pilot accepts the same option.

## 0.2.1

Fixes found by review of v0.2.0. Runtime behavior changes only for inputs that
were mishandled. **Compatibility:** an `fs` passed to `writeSerializedJournal`
must now provide `lstatSync`; older pruned journal rows whose fingerprints cannot
be recomputed are rejected on reopen; some refusal codes are more specific (see
below).

- Resolve content-consent paths the way the operating system opens them. On
  POSIX, Node's JavaScript `realpath` removed `link/..` before following
  `link`, so `root/link/../ok.json` was admitted as `root/ok.json` even when
  the system would open a file outside the scope. POSIX now uses the system
  realpath; Windows, which removes `..` from the path text itself, is
  unchanged.

- Refuse a journal-store write whose destination is a symlink, with `SYMLINK`.
  The previous-hash check read the link's target, but the rename replaced the
  link itself, so the store reported `WRITTEN` while the target kept its old
  bytes. The check runs before the temp file is written and again just before
  the rename. **Compatibility:** an injected `fs` must now provide `lstatSync`;
  one without it is refused with `INVALID_INPUT`.

- Bound workflow snapshots and journal entry copies to 1,000,000 copied values.
  An object reached by two paths is copied and hashed once per path, so a
  shared chain 40 levels deep would run for hours before any schema check.
  Workflow snapshots refuse with `INPUT_SIZE_LIMIT`; journal entries with
  `ENTRY`. Journal entry copies also stop after 64 Mi UTF-16 code units of
  copied strings, since one large string reached by many paths is scanned and
  serialized once per path. Workflow snapshots also refuse typed arrays,
  Buffers, String objects and other non-plain objects before listing their
  properties, instead of enumerating one property per element first. Such
  objects always refused; one carrying a symbol key or accessor now reports
  `INPUT_OBJECT_INVALID` instead of `INPUT_PROPERTY_INVALID`.

- Read the reviewer list and its length once, then copy exactly the required
  number of reviewers. A getter or Proxy could pass the count check and then
  hand the engine an empty list, so a run reported `COMPLETED` with no review.
  A list with a hole is now refused with `REVIEWER_IDENTITY_INVALID` instead of
  throwing a `TypeError` out of `runWorkflow`.

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
- Copy local-chat binding identity before the response is awaited, so a receipt
  and its returned evidence keep the candidate that call sent when the payload
  changes in flight.
- Add source-checkout workflow-control, mocked-interface, and inert-overhead
  benchmarks, plus a 12-task exploratory pilot against one configured local
  Gemma chat endpoint. Retain raw pilot candidates, reports, and request
  receipts so the exact-match results can be rescored.
- Add GitHub-readable benchmark graphs and a study plan that separates this
  single local integration from untested providers and production outcomes.
  The benchmarks are source-checkout tools and are not in the package archive;
  the package file allowlist is unchanged from v0.2.0.

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
