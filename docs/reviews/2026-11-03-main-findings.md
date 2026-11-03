# Public main review findings — November 3, 2026

Base: `f85ec6595413f9b091ee2bc6bdd6fd7a9525fb45`. All changes are local and
uncommitted. No branch, tag, PR, release, service, login, signing or notarization
operation was performed. Review inputs came from an external review. Its claims
were checked against the working tree; externally scoped claims were not
promoted to verified facts.

Finding identifiers retain the input numbering from an external review, with
neutral A, B, C1 and C2 prefixes. Duplicate reports are consolidated. No
independent live review sign-off is claimed; new inference calls would exceed
this task's GET-only network constraint.

## Dispositions

| Input / finding | Disposition and evidence |
|---|---|
| A1: non-retained fingerprint bypass | **Fixed.** `history/run-journal-v1.mjs` recomputes fingerprints on pruning and validates every row on reopen. `tests/run-journal.test.mjs` rejects a rehashed `retained:false` row carrying the old payload fingerprint. Original payload re-appends conflict after pruning. Older unverifiable pruned rows are rejected; README and changelog disclose this compatibility change. |
| B1: consent clock rollback | **Fixed.** `gate/content-consent.mjs` tracks the last valid observation and makes observed expiry terminal. Two regressions in `tests/content-consent.test.mjs` cover rollback after admission and after expiry. |
| B2: factory/report candidates rejected by workflow | **Fixed.** `workflow/contracts.mjs` accepts and revalidates the normalized shape at workflow boundaries, checking author/version and recomputing fingerprints. `tests/workflow.test.mjs` composes factory → review → report → review and refuses altered metadata/content. The factory still accepts only raw `{ files }`. |
| A2, C2.11: example imports candidate source | **Fixed.** `examples/workflow.mjs` retains Node syntax checking but recognizes only its fixed answer source shape as data. `tests/workflow-example.test.mjs` supplies a benign global-mutation statement: it executed before and no longer executes. |
| B3, C2.9, C1.5: hidden CLI model errors | **Fixed for runtime diagnostics and help.** `bin/nisi.mjs` prints only allowlisted failure codes, roles and operations. `tests/cli.test.mjs` distinguishes malformed JSON from model mismatch with injected `Response` objects and verifies unknown codes are omitted. Bare invocation shows help with loopback/distinct-model rules. Parse failures still use a generic message pointing to help; arbitrary exception text is never printed. |
| B4: quadratic pruning and unbounded metadata | **Fixed within a bounded journal design.** Retention scans the active retained map, not all historical rows. A 10,000-record limit returns `HISTORY_LIMIT`; `tests/run-journal.test.mjs` exercises the ceiling, duplicate identity at capacity, and oversized-history reopen refusal. README requires rotation and host input-byte caps. A complete byte-quota design remains deferred. |
| B5: recursive payload overflow | **Fixed.** Entry copying refuses depth greater than 64 before hashing, with `ENTRY`. Append and rehashed-reopen regressions cover the bound. Malformed reopen records remain `INVALID` / `RECORD`. |
| C2.1: hard links cross intended file boundary | **Fixed.** Opened files with `nlink > 1n` return `CONTENT_HARDLINK_REFUSED`. `tests/content-consent.test.mjs` creates an outside fixture and an inside hard link. `docs/file-policy.md` and SECURITY document the conservative rule; parent directories still must be trusted. |
| C2.2: timeout/cancellation prevents report storage | **Fixed for required terminal reports.** Required TIMED_OUT/CANCELLED storage gets one attempt with an independent signal and a fresh `storeTimeoutMs` budget (default 1000 ms), preserving the clock watermark and `workflowOutcome`. Storage expiry makes the final outcome TIMED_OUT; other required-store failures make it BLOCKED. Other storage retains the workflow deadline and caller signal; an optional store can still run after wall-timer expiry if the host clock remains below the deadline. README and the Workflow API describe the grace budget; the API details these limits. |
| C2.3, C1.9: unkeyed chain and arbitrary store replacement | **Documentation fixed; authentication/continuity redesign deferred.** The store verifies internal consistency and a supplied prior-byte digest, not authenticity, project identity or history extension. README and SECURITY say a writer can rehash the entire file, and a matching previous digest permits an empty or unrelated valid replacement. No keyed hashes, anchors or append-only store guarantees were added. The private-reporting link now includes an availability fallback; enabled status was not externally verified. |
| C2.4: missing redaction paths throw | **Fixed.** Missing paths are no-ops in append and reopen validation. Tests cover null, empty and partial payloads, a present path and a revocation in the same journal. |
| C2.5: repeated retry target/attempt accepted | **Fixed.** Append returns `RETRY_DUPLICATE`; reopen refuses rehashed duplicates. Tests cover both. Retries of terminal successes remain allowed by the existing rule and are now explicitly documented; changing that policy is not required for duplicate protection. |
| A5: serialization omits current-time pruning | **Fixed.** Optional `serialize(now)` prunes before producing bytes; omitted time uses the last watermark. Test verifies expired payload text is absent and the result reopens. |
| C2.6: list/retain advance time and prune | **Documentation fixed; proposed semantic change rejected.** These operations intentionally mutate retention and reject decreasing timestamps with `TIME`. README now explains the destructive watermark and same-unit clock requirement. Arbitrarily guessing whether a caller's timestamp is implausible would break the injected-clock contract. |
| C2.7: damaged journal blocks store path | **Documentation fixed; automated recovery deferred.** `readSerializedJournal` refuses damaged data and writes refuse `EXISTING_INVALID`. README separates valid-store reads from host raw-byte reads followed by sealed `reopen` recovery. Automatic overwrite/quarantine would add a recovery policy and risk discarding evidence. |
| C2.8: model review schema omits string constraints | **Fixed.** `adapters/local-chat.mjs` advertises finding min/max lengths and non-whitespace patterns; the existing summary/note bounds also advertise non-whitespace. `tests/local-chat.test.mjs` captures the actual request schema. Runtime validation remains authoritative; valid negative findings already produce FAIL and permit repair. |
| A6, C1.6, C2.10: demo temp leak | **Fixed.** CLI requests `runExample({ keepReport: false })`, which removes the owned directory in `finally` after write/read-back. Direct example/programmatic default keeps the report and returns/prints its path. `tests/workflow-example.test.mjs` verifies the cleaned path is absent. |
| A4: main version and footprint ambiguity | **Fixed.** `package.json` and lockfile identify unreleased `0.2.1-dev`; README drops the old source-checkout size sentence. Published archive figures remain explicitly scoped to v0.2.0, not this tree. |
| C1.3: redaction/liveness correction omitted from changelog | **Fixed in source documentation.** CHANGELOG records the corrections; SECURITY explains by-path copies and inferability. Existing README already distinguished terminal liveness from the separate expired flag. Editing or republishing the historical archive is out of scope. |
| C1.11: Swift helper called bundled | **Fixed.** `docs/apple-foundation-models.md` says the helper is in repository `probes/` and excluded from the npm-format archive, matching `package.json.files`. |
| A7, C1.12: outdated keywords/A-B comment | **Fixed metadata/comment.** Package keywords describe workflow/CLI/LLM components; the A/B comment identifies a historical codec experiment and its POSIX npm shortcut. Porting or deleting the optional model-running script is deferred. |
| C1.14: store write-order description | **Fixed.** README matches temp write → file sync → temp read-back → rename → directory sync → destination read-back. Existing store test asserts this ordering. |
| C2.12: different serializers and no workflow journal adapter | **Documentation fixed; consolidation deferred.** `docs/architecture.md` identifies journal UTF-16 key order, separate codec profile, and absent automatic workflow integration. Substituting serializers would alter versioned digests and stored bytes; adapters/migration need a separate design. |
| C2.13 and a test note from an external review: weak/fragile test boundaries | **Fixed small cases.** Protected-file test now supplies a correct candidate fingerprint and asserts `PROTECTED_FILE_CHANGED`; the storage-deadline test uses an injected clock. `tests/example.test.mjs` resolves its script from `import.meta.url`, with an actual failing/passing run from another cwd. Real HTTP/redirect integration is deferred because this task forbids starting services. The diagnostics regressions do exercise native `Response` streams without a server. |
| A8, C1.15: macOS CI, Python dependency, release automation | **Deferred.** CI indeed lists Linux/Windows and the editor check invokes Python. Existing tests explicitly use Apple stand-ins, not the native helper. Editor checks passed locally; no missing-Python failure was reproduced. macOS jobs, dependency automation, attestations and parser replacement are separate CI/release work; replacing a real HTML parser with a regex is not a safe equivalent fix. |
| C1.7: historical reviewer names/private-path denylist | **Documentation sanitized.** Internal reviewer labels and local paths were removed from this disposition log. Protective packaging exclusions remain unchanged. |
| C1.8 and documentation prose from an external review: old v0.1 documents contradict v0.2 | **Rejected.** README explicitly labels the v0.1 editable manuscript as earlier text; historical records are scoped accordingly. No removal or archive branch is warranted. |
| C1.10: stale roadmap | **Fixed current source status.** Canonical `roadmap.md` has the current date, unreleased fixes, deferred designs, and explicitly historical v0.1 gates. Historical release checkboxes were not marked verified from unverified review claims. |
| C1.13: incomplete changelog | **Fixed current corrections.** Unreleased runtime/docs changes are recorded. Backfilling release dates, historical comparisons and a 0.1.0 release entry is deferred with history/tag work rather than invented. |
| C1.4: npm name ownership/supported installation | **Rejected alleged install-documentation gap; registry action deferred.** README already states Nisi is not registry-published and provides local-archive installation. Current name ownership was not independently verified; registration or publication is prohibited here. |
| A3, C1.1, C1.2: old email, rewritten commits/tags, release/CI provenance | **Deferred, explicitly out of scope and not independently verified.** No old-commit email, PR 11/12/13, release metadata, history or tags were inspected or changed. No release evidence is inferred from this checkout's passing tests. |
| IPv6 prose from an external review: bracketed hostname test is dead | **Rejected by reproduction.** `node -p 'new URL("http://[::1]/").hostname'` returned `[::1]` on Node v24.18.0. The existing bracketed check is valid. |
| Review refactor proposals and missing live/concurrency coverage | **Deferred.** Large engine/adapter/serializer restructuring is unnecessary for these fixes. Existing single-writer and trusted-adapter limits remain documented. No live model, native Apple execution, concurrency acceptance or deployment claim is made. |
| Additional packaging-check defect encountered locally | **Fixed.** With TMPDIR under the checkout, npm selected an ancestor project instead of the temporary consumer. `scripts/check-cli-package.mjs` now creates a private consumer `package.json`. The existing installed-package check failed before with MODULE_NOT_FOUND for its preserved symlink and passed afterward, including an actual offline installed demo. |

## Regression evidence

All generated fixtures/logs/caches live under ignored `.build/review/`. Tests use
synthetic public fixtures. Temporary children need `.build/review/tmp/package.json`
with `{"type":"commonjs"}` because extensionless CommonJS probe scripts otherwise
inherit the repository's ES-module setting. This is test-environment setup, not
an executor change. An initial full run exposed that issue (13 child-exit failures);
with the temp-package boundary in place the full suite passes.

| Command / scope | Before | After |
|---|---|---|
| `node --test tests/run-journal.test.mjs tests/content-consent.test.mjs tests/workflow.test.mjs tests/workflow-example.test.mjs` | 55 tests, 43 pass, **12 fail** | Initial fix: 55 pass, 0 fail. Final suite: **56 pass, 0 fail**, including the later demo-cleanup test. |
| `node --test tests/cli.test.mjs tests/workflow-example.test.mjs tests/local-chat.test.mjs` | 18 tests, 14 pass, **4 fail** | **18 pass, 0 fail** |
| `node --test tests/example.test.mjs`, cwd `.build/review/tmp` | **0 pass, 1 fail** | **1 pass, 0 fail** |
| `npm run check:cli-package`, TMPDIR inside checkout | **Failed** preserved-symlink assertion, MODULE_NOT_FOUND | **PASS**, 18 archive files, offline installed demo and preserved symlink |

Core failures were rollback after admission/expiry, hard links, pruned fingerprint
identity, retained:false bypass, missing redaction paths, duplicate retries,
payload depth, serialize-time expiry, total history limit, candidate execution,
and normalized-candidate composition. The second batch failed on safe CLI codes,
bare help rules, review schema limits and demo cleanup before those fixes.

## Final local checks

Node `v24.18.0`, macOS. For repository commands:

```sh
export TMPDIR="$PWD/.build/review/tmp"
export npm_config_cache="$PWD/.build/review/npm-cache"
npm test
npm run check:static
npm run check:structural
npm run check:cli-package
node docs/editor/check-editor.mjs ./index-typing-revision.html
```

- `npm test`: `tests 240`, `pass 239`, `fail 0`, `cancelled 0`, `skipped 1`, `todo 0`.
  The skip is the Windows-only unregistered-script control.
- Both static/structural commands: `"sourceFindings":[],"status":"PASS"`;
  all eight forbidden fixtures caught and all eight allowed fixtures accepted.
- Packaging: `"status": "PASS"`, `"package": "nisi@0.2.1-dev"`, `"archiveFiles": 18`.
- Editor: `{"status":"PASS","checks":12,"sections":10,"secondSaveRoundTrip":true,"markdownByteParity":true,"repairResumesChecks":true}`.
- `git diff --check`: no whitespace errors.

The TypeScript dependency was initially absent. A plain HTTPS GET failed DNS;
the exact existing cache entry was then verified against the lockfile SHA-512
and extracted into local ignored `node_modules/typescript`. No global installation,
login, server, model request or network POST was performed. Packaging's consumer
installation used the script's existing offline, no-scripts/no-audit mode.

These are local source/package checks, not hosted CI, a native Apple helper run,
release certification or an independent live-model review.
