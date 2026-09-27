# Changelog

Changes to the public Nisi package are recorded here. This file describes the
public source tree and does not include private experiments.

## Unreleased source update

These changes are on `main` only. The package version remains 0.2.0, and the
v0.2.0 tag and release archive do not include them. The package file
allowlist and export map are unchanged; runtime, result-shape, and host
contract changes are listed under Changed.

### Benchmarks

- Add source-checkout workflow-control, mocked-interface, and inert-overhead
  benchmarks, plus a 12-task exploratory pilot against one configured local
  Gemma chat endpoint. Retain raw pilot candidates, reports, and request
  receipts so the exact-match results can be rescored.
- Add GitHub-readable benchmark graphs and a study plan that separates this
  single local integration from untested providers and production outcomes.
  This benchmark addition leaves the released v0.2.0 runtime modules, public
  API, and package file allowlist unchanged.

### Fixed

- Read the `reviewers` array, the `author` entry, each author and reviewer
  `id`, and the review-mode `candidate`, `candidateAuthorId`, and `reportStore`
  options once in `runWorkflow`, and run the snapshot that was validated. An
  accessor or Proxy can no longer pass validation with one reviewer plan, ID,
  or candidate and run with another.
- Copy workflow input reached through several references once, so
  shared-reference input costs linear rather than exponential time, and refuse
  Buffers, typed arrays, Maps, and class instances before reading their
  properties. The 64-level depth limit and `INPUT_CYCLE` are unchanged.
- Parse local-chat envelopes and model output in linear time. Long whitespace
  runs could block the process for minutes; accepted and refused inputs are
  unchanged.
- Stop routing local-chat requests through Node's environment proxy
  (`NODE_USE_ENV_PROXY` or `--use-env-proxy` with `HTTP_PROXY`) or a
  host-installed `fetch` dispatcher when no `fetch` is injected; this also
  covers `nisi local-model`. The default transport has no 300-second header timeout of
  its own, so `timeoutMs` works across its documented 1-86,400,000 ms range.
- Refuse a non-object local-chat payload before any timer or request. A
  missing or null payload previously threw an uncoded TypeError and left a
  timer running for `timeoutMs`.
- Bound run-journal entries at 256 nested objects and arrays, counting the
  entry itself, so a deep entry throws `ENTRY` on append instead of exhausting
  the stack.
- Refuse a symlinked journal-store destination; a rename previously replaced
  the link and left its target stale. Refuse a file over
  `buffer.constants.MAX_STRING_LENGTH` bytes without decoding it; Node 22
  previously threw `ERR_STRING_TOO_LONG` from the store.
- Resolve `filePath` and `scopeRoot` in the file access policy with the
  operating system's realpath. On POSIX, a `..` after a symlinked directory was
  collapsed as text and could admit the bytes of a different file than the one
  the OS names.
- Remove the `nisi demo` temporary `nisi-workflow-*` report directory after the
  report has been written and verified. If removal fails, stderr says so and
  the exit status is unchanged.
- Run the shipped examples and the benchmark entrypoints when invoked through a
  symlinked path (pnpm, `npm link`, `npm install <folder>`, macOS `/tmp`);
  they previously printed nothing and exited 0. `examples/allow-a-file.mjs` no
  longer crashes when symlink creation is refused (EPERM or EACCES); it prints
  a `SKIPPED` line for that case and always removes its scratch folders.
- Pin LF line endings for all text files (`* text=auto eol=lf`), so the packed
  archive's bytes do not depend on the build OS. Use absolute GitHub URLs for
  README benchmark links and charts, so the packed README has no dead links.

### Changed

- Workflow reports, including setup refusals and the preliminary report given
  to a store, add `workflowCode` next to `workflowOutcome`: the code from
  before storage. When a required-store failure, or cancellation or expiry
  during storage, replaces `code`, the workflow's own code (for example
  `TESTS_FAILED`) is kept there. The report's `reportSha256` covers the field.
- A sparse `reviewers` array is refused at setup as
  `REVIEWER_IDENTITY_INVALID`; it previously threw a TypeError mid-run.
- A non-plain object in task, candidate, or adapter data that also has accessor
  or symbol properties is refused as `INPUT_OBJECT_INVALID`; it was
  `INPUT_PROPERTY_INVALID`. The exported `cloneFreeze(value)` in
  `workflow/contracts.mjs` no longer takes its internal recursion arguments.
  Input with more than 16,777,216 (2^24) distinct objects exceeds V8's Map
  limit: `cloneFreeze` then throws a RangeError, and `runWorkflow` reports
  `INPUT_INVALID` for such a task or `ADAPTER_RESULT_INVALID` for such an
  adapter result.
- Without an injected `fetch`, local-chat uses `node:http` with a private agent
  instead of the global `fetch`. It sends `accept-encoding: identity` and
  never follows redirects. A status other than 2xx, or 204 or 205, is
  `LOCAL_CHAT_RESPONSE_UNAVAILABLE`; redirect statuses (301, 302, 303, 307,
  308) were `LOCAL_CHAT_UNAVAILABLE`. Connection and stream failures are
  `LOCAL_CHAT_UNAVAILABLE`.
- Local-chat adds the refusal code `LOCAL_CHAT_PAYLOAD_INVALID` for a payload
  that is not an object or whose `task` is not an object, and records a
  receipt. A missing or null `task` was `LOCAL_CHAT_UNAVAILABLE`, and an array
  or primitive `task` was sent to the model and could pass. A `task` object is
  still sent whatever its `allowedFiles` and `protectedFiles` hold.
- A null or other non-object local-chat envelope or choice is
  `LOCAL_CHAT_CHOICES_INVALID`; a null envelope or choice was
  `LOCAL_CHAT_UNAVAILABLE`, and a primitive choice was
  `LOCAL_CHAT_FINISH_REFUSED`. `usage: null` is accepted as missing usage; it
  was `LOCAL_CHAT_UNAVAILABLE`. A `tool_calls` value other than absent, `null`,
  or `[]` is `LOCAL_CHAT_FINISH_REFUSED`.
- Every local-chat receipt adds `httpStatus` (an integer 100-999 from the
  returned response, otherwise null). Failure receipts now also carry
  `candidateFingerprint` (null), `responseSha256` and `contentSha256` once
  known, and the reported model (at most 256 characters) and valid usage when
  the endpoint supplied them; these were dropped or null.
- The requested local-chat review schema limits finding `code` to 1-128 and
  `message` to 1-2,048 characters, matching the engine. When `allowedFiles` and
  `protectedFiles` are arrays, author and repair schemas no longer offer
  protected paths unless every allowed path is protected.
- A run journal holding an entry nested past 256 objects and arrays now always
  reopens `INVALID` with reason `RECORD`, and the store refuses it as
  `INVALID_JOURNAL`.
- `reopen` rejects, as `INVALID` with reason `RECORD`, a retired record that is
  neither expired at the header's `now` nor followed by at least `maxEntries`
  records; when several are, the first is the rejected line. Every journal the
  API writes meets this, so only hand-edited or rehashed files are affected.
- `writeSerializedJournal` requires the caller's `fs` to provide `lstatSync`;
  an `fs` without it is refused with `INVALID_INPUT`. New refusal reasons:
  `SYMLINK` (checked before any change and again before the rename;
  `readSerializedJournal` still follows links), `PATH_TOO_LONG` for a file
  name over 149 UTF-8 bytes on every platform, including non-ASCII names NTFS
  would accept (elsewhere such writes failed with `WRITE_FAILED`), and
  `TOO_LARGE` for a journal over `buffer.constants.MAX_STRING_LENGTH` UTF-8
  bytes, which the store could not read back.
- The journal store refuses a file over `buffer.constants.MAX_STRING_LENGTH`
  bytes as `INVALID_JOURNAL` on read and `EXISTING_INVALID` on write, on every
  Node version. On Node 24 a valid multibyte journal of that size previously
  read as `READ`.
- Journal-store `READ_FAILED`, `WRITE_FAILED`, `RENAME_FAILED`, and
  `READBACK_MISMATCH` refusals caused by a thrown fs call, including the
  destination lookup just before the rename, add an `error` field with that
  error's code (`IO_ERROR` when it has none). Successful results are unchanged.
- File access policy paths the OS cannot resolve as written, which the
  JavaScript resolver admitted before, are `CONTENT_PATH_UNRESOLVABLE`: on
  POSIX, a `..` after a directory that does not exist; on Linux, a trailing
  `/` or `/.` after a file name. A `scopeRoot` written that way admits nothing,
  and a `scopeRoot` written as `link/..` covers the directory the OS names. On
  Windows, the resolver expands 8.3 short names, uses the letter case stored
  by the file system, and resolves subst and mapped drives to their targets; a
  volume it cannot name is `CONTENT_PATH_UNRESOLVABLE`.
- A missing or unreadable Apple helper binary is `BINARY_UNREADABLE`, both as
  the construction code (was `CONSTRUCTION_ERROR`) and as the `refusals()`
  cause at execute (was `EVIDENCE_REFUSED`). Nothing is launched.
- When the Apple helper exits 65 with exactly one of its refusal codes on
  stderr (`PLATFORM`, `MODEL_UNAVAILABLE`, `MODEL_REFUSED`, `STDIN_BYTES`,
  `STDIN_FRAMING`, `HEADER_INVALID`, `HEADER_BOUNDS`,
  `CONTENT_DIGEST_MISMATCH`, `CONTENT_NOT_UTF8`), the `CHILD_EXIT_NONZERO`
  refusal record adds `helperCode`. The cause and refusal digest are
  unchanged. The helper's stderr is piped rather than ignored and always
  drained; at most its first 64 bytes are kept.
- `nisi local-model` argument refusals keep exit code 2 and the `Invalid command
  or arguments` line, and add a line naming the argument, its rule, and one of
  `LOCAL_MODEL_ARGUMENT_COUNT`, `LOCAL_MODEL_ARGUMENT_TOO_LONG`,
  `LOCAL_MODEL_NAME_BLANK`, `LOCAL_MODEL_NAMES_EQUAL`,
  `LOCAL_CHAT_ENDPOINT_INVALID`, `LOCAL_CHAT_DESTINATION_REFUSED`, or
  `LOCAL_MODEL_ARGUMENTS_INVALID`. `nisi --help` states the endpoint and
  model-name rules.
- If `nisi local-model` cannot load its workflow module, it exits 1 with
  `The local-model workflow could not be loaded (CODE). Reinstall Nisi.`, where
  CODE is the import error's fixed code or `LOCAL_MODEL_EXPORTS_MISSING`; the
  parenthesis is left out when there is no fixed code. It previously reported a
  usage error with exit 2.
- The `nisi local-model` JSON summary adds `authorCode` and `reviewerCode`: the
  fixed code on each role's last adapter receipt, set when that call failed
  (for example `LOCAL_CHAT_UNAVAILABLE` or `LOCAL_CHAT_MODEL_MISMATCH`), or
  null.
- A `nisi demo` failure includes a fixed cause code when one is available, for
  example `The deterministic workflow demo failed (ENOENT).`

### Documentation

- Add [docs/journal-api.md](docs/journal-api.md), a reference for the run
  journal and journal store: config, entries, limits, results and refusal
  codes, liveness, reopen reports, durability, temp naming, and what the hash
  chain does not prove. The README now gives the full liveness order, the
  `INVALID`/`HEADER` reopen result with `journal: null`, the strict redaction
  rule, that a replacement needs `expectedPreviousSha256` and is not checked
  for lineage, and that the header time is part of the chain root.
- Document workflow evidence size limits and their codes (256 findings, codes
  of 128 characters, messages of 2,048, and reasons, summaries, and notes of
  4,096; paths of 512), that oversized evidence blocks without a repair, when
  the report store is skipped, that author and reviewer adapters must be plain
  objects, that `runWorkflow` accepts only the raw `{ files }` candidate, and
  that `createCandidate()` does not check task scope or protected files.
- Document the local-chat transport, receipt fields, and refusal codes; the
  file access policy's OS path resolution and race codes; the Apple helper
  build from repository source and its new codes; and the structural scan's
  matching rule and blind spots. Correct the file-policy declaration-bytes
  recipe, which passed the codec's result record and was refused with
  `CONSENT_BYTES_REFUSED`.
- Record the stable v0.2.0 hosted CI run, tag commit, and archive digest in
  the v0.2 verification record, and state in SECURITY.md what the local-chat
  loopback guarantee covers.
- Disclose that the local pilot harness replaced both checked arms' own repair
  stage records with one fixed finding, so the Nisi token row does not measure
  its default repair payload, and which pinned pilot sources are not in
  repository history or have since changed.
- Narrow the 0.2.0-rc.2 entry below: its fingerprint check covers retained
  entries only.

### Tests

- Add 71 tests (296 in all). They pin documented workflow guards, evidence
  limits, journal and store behavior, local-chat codes and receipts, the CLI,
  and file-policy races by exact code; exercise the local-chat transport
  against real loopback servers; and check that the pilot source manifest
  differs from the checkout only where the results README says so. Each fix's
  regression test was shown to fail with the fix reverted where a deterministic
  test exists.
- Make the report-store timeout test independent of wall-clock stage timing.
- `npm run check:cli-package` checks that every export target is packed and
  imports from the installed archive, that packed text is LF-only, and that
  relative README links resolve to packed files. It runs the installed
  `nisi local-model` against a closed loopback port, and its child processes
  run without `NODE_USE_ENV_PROXY`.
- The structural check also flags direct calls to further filesystem-write,
  module-load, and process-mutation functions;
  `contracts/structural-fixtures.json` has 14 forbidden and 8 allowed
  fixtures.

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
