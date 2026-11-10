# Changelog

Changes to the public Nisi package are recorded here. This file describes the
public source tree and does not include private experiments.

## Unreleased

- The built-in Jev client uses Node's `https` module by default. `timeoutMs` may be from 1 s to 24 h (default 60 s). v0.3.1 used global `fetch` and refused a timeout above 300 s with `JEV_TIMEOUT_INVALID`; `fetch` also gave up after 300 s with no response headers. A `fetch` passed to `createJevJudge`, `planWithJev` or `createJevReviewer` is unchanged and keeps that limit. The endpoint, request JSON, size limits and error codes are unchanged.
- `benchmarks/harder/run.mjs` uses the built-in Jev client for `--plan` and `--jev-review` when `TYPESAFE_API_KEY` is set and `--judge` is omitted. A `--judge` module still wins. With neither, the run stops before creating the output file and sends nothing. Finished and partial output files record the settings needed to read the run back: token cap, timeout, reasoning effort, plan and review flags, task-set id, arms, repair budget, deadline, judge source (`builtin`, `module` or `function`), endpoint, package version and runtime. The API key and the judge module path are not written. The 2026-11-07 files in `benchmarks/harder/results/` still come from the older private harness and do not contain the token cap or timeout.

## 0.3.1

Prepared 9 November 2026 from the six commits after tag `v0.3.0` (#26–#31) plus
the release-prep fixes below. Tagged `v0.3.1` and published as a GitHub Release
with `nisi-0.3.1.tgz` on 9 November 2026. Not published to the npm registry. **Compatibility:** `planWithJev` and
`createJevReviewer` send the task state to TypeSafe when no `judge` is passed
and `TYPESAFE_API_KEY` is set. v0.3.0 threw `JEV_JUDGE_REQUIRED` and sent
nothing in that case. The local-chat default transport is Node's `http` module
instead of global `fetch`; a caller-supplied `fetch` is unchanged, and the
request JSON is unchanged. The package archive is 21 files. Relative to the
v0.3.0 archive (19 files) it adds `adapters/jev-client.mjs` and
`history/validate-data.mjs`.

- Add `nisi/adapters/jev-client`, a built-in client for TypeSafe's hosted Jev.
  `planWithJev` and `createJevReviewer` use it when no `judge` is passed and
  `TYPESAFE_API_KEY` is set. `createJevJudge({ apiKey, model, timeoutMs })` is
  exported. The endpoint is fixed, redirects are errors, the request and
  response are bounded to 1 MiB, the call times out (60 s by default, 1 to 300 s),
  and neither the key nor the response body appears in an error. Client codes:
  `JEV_API_KEY_REQUIRED`, `JEV_API_KEY_INVALID`, `JEV_MODEL_INVALID`,
  `JEV_TIMEOUT_INVALID`, `JEV_REQUEST_INVALID`, `JEV_REQUEST_TOO_LARGE`,
  `JEV_AUTH_FAILED`, `JEV_RATE_LIMITED`, `JEV_HTTP_ERROR`, `JEV_TIMEOUT`,
  `JEV_RESPONSE_TOO_LARGE`, `JEV_RESPONSE_INVALID`, `JEV_UNAVAILABLE`. A custom
  `judge` still wins over the environment variable.
- Add `benchmarks/harder` task set v2: 42 tasks in six categories. Every answer
  is computed by a generator in `v2/generators/`. Regenerating `tasks-v2.json`
  with `make_tasks_v2.py` reproduced the pinned sha256
  `63007882ea7bb02195abdf6b5eb8c1a09e87829ce26391fd4c4d2cde70350f5c`. Some
  generators cross-check with a second implementation in the same file. This
  repository does not contain a separate solver that re-read only the prompts.
  Run v2 with `--tasks v2`. The default stays the 16-task v1 set. For the one
  v2 answer that has at most two distinct values, repair feedback reports the
  count of wrong elements and not their positions.
- Fix: a local-chat `timeoutMs` longer than 300 s now takes effect. Node's
  global `fetch` ends a request that has received no response headers for 300 s,
  and these requests are not streamed, so a slow model failed at five minutes
  as `LOCAL_CHAT_UNAVAILABLE`. The default transport is loopback `http` only,
  with no redirects, and a non-2xx status is refused. The Jev client still uses
  `fetch`, so its timeout stays within 1 to 300 s.
- Fix: an interrupted harder-task run wrote the v1 dataset hash into the
  partial file for every task set. The partial file now records the hash of
  the task set that was loaded.
- Add `nisi validate --journal FILE` and `nisi validate --data-dir DIR`
  (`NISI_JOURNAL` or `NISI_DATA_DIR` when the flag is omitted). The command
  reopens run journals and checks the shape of workflow reports. It prints a
  PASS/FAIL summary and does not print payloads. `scripts/validate-real-data.sh`
  is the source-checkout wrapper. `fixtures/sample-data/` is a synthetic smoke
  fixture, not working data, and is checked out with LF line endings so Windows
  does not turn the journal into a non-canonical file.
- Docs: the README is a short landing page. The run journal moved to
  `docs/run-journal.md`, benchmarks to `docs/benchmarks.md`, install steps to
  `docs/install.md`. v0.3.0 doc corrections (#26, #27) keep the Jev timing
  claim limited to what the single runs showed, and record the Windows check
  of tag `v0.3.0` on one PC in `docs/verification-v0.3-windows.md`. That check
  was not repeated for v0.3.1.
- Tests remove the temporary folders they create. `npm run check` had left
  about 96 `consent-*`, `afm-content-*` and `afm-stub-*` folders per run.

## 0.3.0

Adds optional Jev pre- and post-analysis, a reasoning-effort option for local
chat models, and the harder-task benchmark. Nothing existing changes: requests
that do not set `reasoningEffort` are byte-identical to v0.2.1, and the new
module is only loaded if you import it. **Compatibility:** the package archive
gains one file, `adapters/jev-advisor.mjs` (19 files; the new import path is
`nisi/adapters/jev-advisor`).

- Add `nisi/adapters/jev-advisor`, optional Jev (TypeSafe System One)
  pre- and post-analysis. `planWithJev(task, { judge })` asks Jev whether a task
  needs the model to reason and maps the answer to local-chat settings
  (`direct`: `reasoningEffort: 'none'`, 1,024 tokens; `reason`: 4,096 tokens).
  `createJevReviewer({ id, judge })` is a reviewer that records Jev's
  probability that the candidate meets every criterion. It is advisory unless
  created with `gate: true`, but it counts as one of the task's required
  reviewers and, if `judge` fails or returns an invalid answer, reports
  `UNAVAILABLE`, which blocks the run (`REVIEW_UNAVAILABLE`). Nisi never calls Jev itself: the host supplies
  `judge`, which sends the task (and, for the reviewer, the candidate's files)
  to Jev's hosted service, and every typed answer is validated.

- Add a `reasoningEffort` option to the local-chat adapters (`none`, `minimal`,
  `low`, `medium`, `high`), sent as `reasoning_effort`. With a reasoning model,
  `none` stops hidden thinking from spending the output budget, which otherwise
  ends calls with `LOCAL_CHAT_FINISH_REFUSED`. Without the option, requests are
  byte-identical to before. Invalid values are refused with
  `LOCAL_CHAT_REASONING_EFFORT_INVALID`. `runPilot()` in `benchmarks/value/live-pilot.mjs` accepts the same option; the
  pilot's command line has no flag for it.

- Add `benchmarks/harder/`, the opt-in benchmark behind the Jev and
  reasoning figures: 16 frozen tasks whose answers `make_tasks.py` computes,
  a one-shot arm and a Nisi arm, and flags for the token cap, timeout, reasoning
  effort, shape-only tests and a host-supplied Jev judge module. Its defaults
  match the adapter's (4,096 tokens, 120 s).

## 0.2.1

Fixes found by review of v0.2.0. Runtime behavior changes only for inputs that
were mishandled. **Compatibility:** an `fs` passed to `writeSerializedJournal`
must now provide `lstatSync`; older pruned journal rows whose fingerprints cannot
be recomputed are rejected on reopen; some refusal codes are more specific (see
below). Running `nisi` with no arguments now prints help and exits 0 (it was a
usage error with exit 2).

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
  shared chain 20 levels deep took about a second to snapshot, each extra level
  roughly doubled that, and about 23 levels exhausted the heap and crashed Node,
  all before any schema check.
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
  local-model failure diagnostics, and tighten response-schema string constraints for notes, summaries and finding
  fields (this changes the request body and its hash).
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
