# Changelog

Changes to the public Nisi package are recorded here. This file describes the
public source tree and does not include private experiments.

## Unreleased source update

These changes are on `main` only. The package version remains 0.2.0, and the
v0.2.0 tag and release archive do not include them. The package file
allowlist and export map are unchanged. Hosts should read the upgrade notes;
[docs/workflow-api.md](docs/workflow-api.md), [docs/journal-api.md](docs/journal-api.md)
and [docs/local-models.md](docs/local-models.md) give the details.

### Benchmarks

- Add source-checkout workflow-control, mocked-interface, and inert-overhead
  benchmarks, plus a 12-task exploratory pilot against one configured local
  Gemma chat endpoint. Retain raw pilot candidates, reports, and request
  receipts so the exact-match results can be rescored.
- Add GitHub-readable benchmark graphs and a study plan that separates this
  single local integration from untested providers and production outcomes.
- Disclose that the pilot harness replaced both checked arms' own repair stage
  records with one fixed finding, so the Nisi token row does not measure its
  default repair payload, and which pinned pilot sources are not in repository
  history or have since changed.

### Upgrade notes (host-visible changes)

- **Workflow reports** add `workflowCode` beside `workflowOutcome`: the code
  from before storage, kept when a required-store failure, or cancellation or
  expiry during storage, replaces `code`. The `reportSha256` passed to the
  store, and recorded as `storedReportSha256`, covers the field.
- **Workflow input**: a sparse `reviewers` array is `REVIEWER_IDENTITY_INVALID`
  at setup (it threw a TypeError mid-run). A non-plain object that also has
  accessor or symbol properties is `INPUT_OBJECT_INVALID` (was
  `INPUT_PROPERTY_INVALID`). The exported `cloneFreeze(value)` no longer takes
  its internal recursion arguments, and input with more than 2^24 distinct
  objects exceeds V8's Map limit (a RangeError, reported by `runWorkflow` as
  `INPUT_INVALID` or `ADAPTER_RESULT_INVALID`).
- **Local chat transport**: without an injected `fetch`, requests use
  `node:http` with a private agent instead of the global `fetch`, so Node's
  environment proxy or a host-installed dispatcher no longer reroutes them. It
  sends `accept-encoding: identity`, never follows redirects, and has no
  300-second header timeout of its own. A status other than 2xx, or 204 or
  205, is `LOCAL_CHAT_RESPONSE_UNAVAILABLE` (redirects were
  `LOCAL_CHAT_UNAVAILABLE`); connection and stream failures are
  `LOCAL_CHAT_UNAVAILABLE`.
- **Local chat codes**: new `LOCAL_CHAT_PAYLOAD_INVALID` for a payload or
  `task` that is not an object (a missing or null `task` was
  `LOCAL_CHAT_UNAVAILABLE`; an array or primitive `task` was sent to the
  model). A null, primitive or array envelope or choice is
  `LOCAL_CHAT_CHOICES_INVALID`; a null envelope or choice was
  `LOCAL_CHAT_UNAVAILABLE`, and a primitive or array choice was
  `LOCAL_CHAT_FINISH_REFUSED`. `usage: null` is accepted as missing usage (was
  `LOCAL_CHAT_UNAVAILABLE`). A `tool_calls` value other than absent, `null`, or
  `[]` is `LOCAL_CHAT_FINISH_REFUSED`; v0.2.0 accepted one without a truthy
  `length`, such as `{}` or `true`.
- **Local chat receipts and schemas**: every receipt adds `httpStatus`; failure
  receipts keep `responseSha256`, `contentSha256`, the reported model and valid
  usage once known. A `binding` value a receipt cannot hold (such as `NaN` or an
  object) is recorded as null, so every call leaves a receipt. The review
  schema bounds finding `code` to 1-128 and `message` to 1-2,048 characters,
  and author and repair schemas no longer offer protected paths unless every
  allowed path is protected.
- **Run journal**: entries nested past 256 objects and arrays (counting the
  entry) throw `ENTRY` on append; v0.2.0 accepted them until the stack ran out,
  then threw an uncoded RangeError. A journal already holding one, which v0.2.0
  reopened `COMPLETE`, now reopens `INVALID` with reason `RECORD`, and the store
  refuses it as `INVALID_JOURNAL` on read and `EXISTING_INVALID` on write.
  `reopen` also rejects a retired record that is neither expired at the
  header's `now` nor followed by at least `maxEntries` records; journals the
  API writes always meet this.
- **Journal store**: `writeSerializedJournal` requires `fs.lstatSync` (an `fs`
  without it is `INVALID_INPUT`). New refusal reasons: `SYMLINK` for a
  symlinked destination (a rename replaced the link and left its target
  stale); `PATH_TOO_LONG` for a file name over 149 UTF-8 bytes, on every
  platform (where names are capped at 255 bytes such writes failed with
  `WRITE_FAILED`, or `READ_FAILED` when the name itself exceeded 255 bytes);
  and `TOO_LARGE` for a journal over `buffer.constants.MAX_STRING_LENGTH`
  bytes. A file over that size reads as `INVALID_JOURNAL` and blocks a write as
  `EXISTING_INVALID` on every Node version (Node 22 threw
  `ERR_STRING_TOO_LONG`; Node 24 could read a multibyte one). Refusals caused
  by a thrown fs call add an `error` field with its code (`IO_ERROR` when it
  has none).
- **File access policy**: `filePath` and `scopeRoot` are resolved with
  `fs.realpathSync.native`, so a stub of `fs.realpathSync` no longer
  intercepts them. A `..` after a symlinked directory now names the directory
  the OS names. Paths the OS cannot resolve as written, which the JavaScript
  resolver admitted, are `CONTENT_PATH_UNRESOLVABLE` (on POSIX a `..` after a
  missing directory; on Linux a trailing `/` or `/.` after a file name). On
  Windows the resolver expands 8.3 short names, uses the stored letter case,
  and resolves subst and mapped drives.
- **Apple helper**: a missing or unreadable binary is `BINARY_UNREADABLE` at
  construction (was `CONSTRUCTION_ERROR`) and as the execute cause (was
  `EVIDENCE_REFUSED`). When the helper exits 65 with one of its refusal codes
  on stderr, the `CHILD_EXIT_NONZERO` record adds `helperCode`; stderr is
  drained and at most 64 bytes are kept.
- **CLI**: `nisi local-model` argument refusals keep exit 2 and add a line
  naming the argument, its rule and a code (`LOCAL_MODEL_ARGUMENT_COUNT`,
  `LOCAL_MODEL_ARGUMENT_TOO_LONG`, `LOCAL_MODEL_NAME_BLANK`,
  `LOCAL_MODEL_NAMES_EQUAL`, `LOCAL_CHAT_ENDPOINT_INVALID`,
  `LOCAL_CHAT_DESTINATION_REFUSED`, or `LOCAL_MODEL_ARGUMENTS_INVALID`);
  `--help` states the rules. A workflow module that cannot load exits 1 with
  `The local-model workflow could not be loaded (CODE). Reinstall Nisi.` (it was
  a usage error). The JSON summary adds `authorCode` and `reviewerCode`, the
  fixed code of each role's last failed call, or null. A `nisi demo` failure
  names a fixed cause code when one exists.

### Fixed

- `runWorkflow` reads each adapter source and review-mode option once, so an
  accessor or Proxy can no longer pass validation with one reviewer plan, ID or
  candidate and run with another (for example, `COMPLETED` with no review).
- Buffers and typed arrays in workflow input are refused in O(1), and shared
  references are copied once; either could stall the event loop for seconds
  and end a run as `DEADLINE_EXCEEDED` instead of naming the invalid input.
- Local-chat JSON is parsed in linear time; a long whitespace run could block
  the process for minutes regardless of `timeoutMs`.
- A missing local-chat payload no longer throws an uncoded TypeError or leaves
  a timer running.
- A deep journal entry can no longer make a journal written in a warm process
  fail to reopen after a restart.
- `nisi demo` removes its `nisi-workflow-*` temporary directory once the
  workflow run returns, whether or not the report was stored; if removal fails,
  stderr says so and the exit status is unchanged.
- Examples and benchmark entrypoints run when invoked through a symlinked path
  (they printed nothing and exited 0), and `examples/allow-a-file.mjs` skips its
  symlink case instead of crashing when symlink creation is refused.
- Text files are pinned to LF (`* text=auto eol=lf`), so the packed archive's
  bytes do not depend on the build OS, and README benchmark links are absolute,
  so the packed README has no dead links.

### Documentation

- Add [docs/journal-api.md](docs/journal-api.md), a reference for the run
  journal and store, and correct the README's journal and store wording.
- Document workflow evidence size limits, when the report store is skipped,
  the plain-object adapter rule and the accepted candidate shape; the
  local-chat transport, receipts and codes; the file access policy's path
  resolution and race codes; the Apple helper's build and codes; and the
  structural scan's matching rule. Correct the file-policy declaration-bytes
  recipe, which the factory refused.
- Record the stable v0.2.0 CI run, tag and archive in the v0.2 verification
  record, state in SECURITY.md what the loopback guarantee covers, and narrow
  the 0.2.0-rc.2 entry below to retained entries.

### Tests

- Add 72 tests (297 in all) that pin the documented guards and codes above.
  Each fix has a regression test.
- The report-store timeout test no longer depends on wall-clock stage timing,
  the file-policy and Apple helper tests remove their scratch directories, and
  the symlink-swap race test is skipped with a reason where symlink creation
  is refused.
- `npm run check:cli-package` checks packed export targets and installed
  imports, LF-only packed text, relative README links, and a closed-port
  `nisi local-model` run. The structural check covers more direct-call
  patterns (14 forbidden and 8 allowed fixtures).

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
  differs from its validated, redacted entry, so a retained row and its
  duplicate/conflict classification agree. A retired entry keeps the
  fingerprint recorded in the chain, which cannot be recomputed; because the
  chain does not authenticate a writer, a party able to rehash the file can
  still change any entry's classification.

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
