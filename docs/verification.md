# Verification record

## September 12: documentation and onboarding revision

The review revision adds Node-version preflight checks, local-model CLI argument
validation, an architecture guide, and a shorter editable README. The workflow
orchestrator and model transport implementation remain unchanged. New results
are recorded separately in the [September 12 summary](verification/2026-09-12/summary.json)
and [source manifest](verification/2026-09-12/source-manifest.json).

Local checks passed all 169 tests on Node 22.23.2 and 24.18.0 on macOS arm64.
After removing optional chaining from the preflight, the four onboarding tests
were rerun on both versions. An actual Node 20.20.2 invocation was refused
with the intended setup message and exit code 1. The deterministic example completed with one repair
and verified report storage. The editor's 12 checks cover export parity, HTML
save round trips, safe rendering, and the corrected repair-to-checks branch.

No live model, native Apple, or native Windows integration was rerun for this
revision. The September 11 live records below keep their original source scope.
See [GitHub Actions](https://github.com/louiscalata/nisi/actions/workflows/ci.yml)
for hosted results and check the commit attached to each run. The workflow now
also checks the editable README on each Linux Node job.

## September 11: implementation and integration evidence

These results were collected on September 11, 2026, while developing the source
update based on Git commit `67ca3a1`. The [source manifest](verification/2026-09-11/source-manifest.json)
identifies the tested runtime, tests, examples, native sources and package files
by SHA-256. It was captured after the final checks; no runtime source changed
between those checks and the capture. The [validation summary](verification/2026-09-11/validation-summary.json)
links the records. A result applies to its source and environment, not to every
future revision or platform.

| Check | Recorded result | Scope |
|---|---|---|
| Automated Node tests | 165/165 passed on Node 22.23.2 and 24.18.0 | macOS arm64; no skipped, failed or cancelled tests |
| Published GitHub Actions | Both Node 22 and Node 24 jobs passed 165/165 tests | Ubuntu runner at implementation commit `ec12fcb`; static check also passed |
| Scoped static analysis | 8 forbidden and 8 allowed fixtures passed; no source-region findings | Direct patterns in the codec's marked region |
| Deterministic workflow example | COMPLETED after one repair | Real Node syntax check, failing then passing assertions, separate callback review, report write/sync/read-back |
| Native Apple helper | 2/2 calls passed, caps 128 and 0 | Real Foundation Models calls on the tested Mac; helper and source hashes retained |
| Current local-model example | COMPLETED | Gemma 3 author, four acceptance assertions, Gemma 4 reviewer, current JSON-schema requests |
| Current Qwen schema request | BLOCKED | Empty final author content; no review or tests followed |
| Current Gemma/GPT-OSS schema run | TIMED_OUT | Four assertions passed; GPT-OSS review exceeded the total deadline |
| Earlier local-model example | COMPLETED | Qwen/GPT-OSS before JSON-schema requests; exact source manifest unavailable |
| Earlier malformed review | BLOCKED | Candidate passed four assertions; reviewer supplied invalid JSON |
| Editorial artifact | PASS | Isolated Chrome typing, four chart exit branches, Markdown byte parity and standalone HTML reopening; static save/export checks |

## Reproduction and retained automated evidence

```bash
npm ci
npm run check
npm run example:workflow
node examples/allow-a-file.mjs
node docs/editor/check-editor.mjs ./index-typing-revision.html
```

Full output is retained for [Node 22](verification/2026-09-11/node22-check.log)
and [Node 24](verification/2026-09-11/node24-check.log). The
[deterministic workflow record](verification/2026-09-11/deterministic-workflow.json)
contains both the final report and the report actually written to disk, with
its matching digest and acknowledgement. Public root and subpath exports were
also checked for function identity.

The automated tests use deterministic stand-ins and injected HTTP responses.
They exercise successful work and deliberate refusal paths, including mutable
reviewer configuration, stale evidence, scope/protected files, malformed
Unicode/JSON, contradictory assertion counts, clock errors, cancellation,
timeouts, repair limits, no progress and storage failures. They do not themselves
call a live model. Native and local-model runs are separate evidence.

## September 11 live integrations

- [Native Apple calls](verification/2026-09-11/native-apple.json) contain helper,
  Swift source and adapter source hashes, input digest, returned evidence and
  refusal arrays. Both executions passed on macOS 27.0 / Apple Silicon using
  Swift 6.4 and Node 24.18.0. These helper/executor source hashes match the manifest.
- [Current completed local-model run](verification/2026-09-11/local-model-completed.json)
  records Gemma 3 (`google/gemma-3-4b`) authoring and Gemma 4
  (`google/gemma-4-26b-a4b-qat`) reviewing the same retry configuration after four
  assertions passed. It used the current JSON-schema requests at a loopback
  HTTP server, a 4,096-token output cap and a 90-second total deadline. The author
  response validated in 17.924 seconds and the reviewer in 9.326 seconds.
- [Empty-author refusal](verification/2026-09-11/local-model-empty-author.json)
  records a Qwen schema request whose author returned no final content. The
  adapter recorded `LOCAL_CHAT_EMPTY_RESPONSE`. A separate diagnostic observed
  schema JSON in the server's reasoning field with an empty final content field;
  Nisi did not promote that reasoning field into a final response.
- [Review timeout](verification/2026-09-11/local-model-review-timeout.json)
  records a valid Gemma 3 candidate and four passing assertions, followed by a
  GPT-OSS review that exceeded the 180-second total workflow deadline. The engine
  returned `TIMED_OUT`, not completion.

To run the successful configuration, use a compatible server with those exact
models available. The default example deadline is 180 seconds; the retained run
called `runLocalModelExample` with an explicit 90-second deadline:

```bash
node examples/local-model-workflow.mjs http://127.0.0.1:1234/v1/chat/completions google/gemma-3-4b google/gemma-4-26b-a4b-qat
```

The endpoint reported 349 author tokens and 841 reviewer tokens for the current
completed run. Model names and usage are endpoint reports, not independent
attestation or billing measurements. There is no matched baseline for savings.

## Earlier evidence retained without current-source credit

- [Earlier completed run](verification/2026-09-11/local-model-completed-before-schema.json)
  used Qwen (`qwen/qwen3.8-27b`) and GPT-OSS (`openai/gpt-oss-20b`). It predates
  JSON-schema requests; an exact source manifest was not captured for that run.
- [Malformed-review refusal](verification/2026-09-11/local-model-malformed-review.json)
  retains a candidate, four passing assertions and an unavailable review. The
  adapter recorded `LOCAL_CHAT_JSON_INVALID` and the engine returned `BLOCKED`.

## Editorial artifact

The [browser receipt](verification/2026-09-11/editor-browser.json) records an
isolated headless Chrome check with a fresh profile: 17 section textareas and
one About field, each character entered once, preview unchanged during typing,
Enter/Backspace working, four early-exit branches, no Next steps section, exact
Markdown export and a downloaded editable HTML copy reopened successfully.
There were no page JavaScript errors. Louis also confirmed normal typing in the
live editor. The [editor manifest](verification/2026-09-11/editor-manifest.json)
identifies the artifact and manuscript bytes checked. Static checks cover two
save round trips, escaped user HTML and safe link schemes.

## Published GitHub Actions

[Run 34634897678](https://github.com/louiscalata/nisi/actions/runs/34634897678)
passed both Node 22 and Node 24 jobs on `ubuntu-latest` for implementation commit
`ec12fcbe105932d0062f9ef545589b6773fbacdd`. Each job installed dependencies,
passed the scoped static check and passed all 165 tests. The
[retained CI receipt](verification/2026-09-11/github-actions.json) records job and
step results. The documentation-only follow-up through `fc8bf1b` did not change
those runtime hashes. The September 12 onboarding revision has a separate manifest.

## Evidence limits

The engine validates records, not callback honesty. The local server and native
helper are trusted integrations. A loopback address does not prove that the
server performs inference locally or avoids forwarding and logging. Native
Apple evidence does not independently observe every network/storage claim made
by the helper.

The examples cover a small configuration task and a fixed JavaScript module.
They do not establish general coding quality, security certification, native
Windows behavior, signed distribution, package publication, or measured gains
in reliability, token use, cost or speed. The retained hosted CI run covers Linux Node 22/24; it does not run native
Apple inference or establish native Windows support. Results for later commits
must be checked separately.
