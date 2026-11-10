# Nisi

[![CI](https://github.com/louiscalata/nisi/actions/workflows/ci.yml/badge.svg)](https://github.com/louiscalata/nisi/actions/workflows/ci.yml)
[![Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](https://github.com/louiscalata/nisi/blob/main/LICENSE)
[![Node.js 22+](https://img.shields.io/badge/node-%3E%3D22-339933.svg)](https://github.com/louiscalata/nisi/blob/main/package.json)

Nisi runs one coding task through draft, checks, tests, separate review and bounded repair, and returns a report. It does not apply the files.

**Status:** The published release is [v0.3.1](https://github.com/louiscalata/nisi/releases/tag/v0.3.1) (9 November 2026), on GitHub with `nisi-0.3.1.tgz` and `SHA256SUMS`. Nisi is not on the npm registry. This source tree has unreleased changes after that tag; see the [changelog](https://github.com/louiscalata/nisi/blob/main/CHANGELOG.md). Node.js 22 or newer on macOS, Linux and Windows. Apache-2.0. The v0.3.1 changes are covered by the test suite and CI (Linux and Windows, Node.js 22 and 24). The [Windows check](https://github.com/louiscalata/nisi/blob/main/docs/verification-v0.3-windows.md) is one PC on v0.3.0 and was not repeated for v0.3.1. A local-model end-to-end run for v0.3.1 was **not run**. A 10 November 2026 Mac re-measure of the harder tasks was also **not run**; models were present on disk, but no usable loopback endpoint was available ([note](https://github.com/louiscalata/nisi/blob/main/docs/reviews/2026-11-10-live-model-remeasure.md)). Jev pre- and post-analysis did not run while the source was prepared ([docs/jev](https://github.com/louiscalata/nisi/blob/main/docs/jev/pre-v0.3.1.md)); the post-analysis run at publish time is recorded in the [release notes](https://github.com/louiscalata/nisi/releases/tag/v0.3.1). v0.3.2 is in preparation; see [docs/release-notes/v0.3.2.md](https://github.com/louiscalata/nisi/blob/main/docs/release-notes/v0.3.2.md). The latest release is v0.3.1.

## Quick start

Install Node.js 22 or newer. Then:

```bash
git clone --branch v0.3.1 --depth 1 https://github.com/louiscalata/nisi.git
cd nisi
node bin/nisi.mjs demo
```

You should see this JSON:

```json
{
  "outcome": "COMPLETED",
  "code": null,
  "repairAttempts": 1,
  "reportStored": true,
  "modelCalls": 0
}
```

The demo calls no model. It repairs an intentionally incorrect module once, writes a report in a temporary directory, checks it by read-back, and deletes it. `node examples/workflow.mjs` keeps the report.

From a source checkout, `npm ci` then `npm run check` runs the structural check and the tests. Installing the release archive is described in [Install and use](https://github.com/louiscalata/nisi/blob/main/docs/install.md).

## Jev pre- and post-analysis

Jev is TypeSafe's hosted System One model, a paid API with no free or open-weight stand-in. Nisi can ask it two questions around a run. Nothing is sent unless you pass a `judge` function or `judge: 'typesafe'` (on the harder-task runner, `--judge typesafe`). `TYPESAFE_API_KEY` alone prints one line to stderr and leaves the call on the local or no-judge path. v0.3.1 did send when that variable was set and no `judge` was passed.

**Pre-analysis** (`planWithJev`) asks whether the task needs the model to reason (`reason` or `direct`) and whether the task is missing information. The default map gives `direct` tasks `reasoningEffort: 'none'` and 1,024 output tokens, and `reason` tasks 4,096 tokens. That choice is a setting, not evidence that the setting is better.

**Post-analysis** (`createJevReviewer`) records Jev's probability that the candidate meets every acceptance criterion. By default the review passes, and it still uses one of the task's required-reviewer slots. `gate: true` fails the review when the probability is below `threshold` (default 0.5) and sends the candidate to repair. If the judge throws or returns an invalid answer, the run ends `BLOCKED` with `REVIEW_UNAVAILABLE`.

On 16 harder tasks with one local model, each figure from a single run, the Jev plan matched the adapter defaults (14 of 16) and showed no demonstrated gain in accuracy or speed. On 31 labeled answers, Jev's ranking was too weak to gate a run (AUC 0.78). Numbers and the exact data that leaves the machine are in [Local models and Jev](https://github.com/louiscalata/nisi/blob/main/docs/local-models.md#jev-pre--and-post-analysis-optional).

## What is in 0.3.1

- A built-in Jev client, `nisi/adapters/jev-client`, used when `TYPESAFE_API_KEY` is set and no `judge` is passed.
- Forty-two more harder tasks, selected with `--tasks v2`. The default remains the 16-task set from v0.3.0.
- Local-chat calls may run longer than five minutes. Node's `fetch` was cutting them off. An injected `fetch` is unchanged.
- `nisi validate` checks a run journal, or a directory of journals and workflow reports, and prints PASS or FAIL without printing payloads.

The [changelog](https://github.com/louiscalata/nisi/blob/main/CHANGELOG.md) is the full list. The published notes are on the [v0.3.1 release](https://github.com/louiscalata/nisi/releases/tag/v0.3.1).

## How it works

An **adapter** is a callback object you supply that connects one role to your tool or model. A **candidate** is a snapshot of the changed file names and their complete contents, not a patch. Nisi validates everything an adapter returns.

1. Nisi binds the task and asks your code whether the permitted files may be used.
2. The author adapter drafts a candidate.
3. Static checks run, then tests. A failed check skips the tests, and a failed test skips review.
4. Each reviewer adapter reviews the candidate separately.
5. A failed check, test or review sends the candidate back to the author for repair, within the repair budget. The repaired candidate returns to step 3 and must pass fresh checks, tests and review.
6. The run ends with an outcome (`COMPLETED`, `FAILED`, `BLOCKED`, `CANCELLED`, `TIMED_OUT`, `REPAIR_LIMIT` or `NO_PROGRESS`) and a report. Cancellation, a deadline, missing evidence or a repeated candidate also end it.

Nisi never writes the files; your application decides whether to apply the candidate. In review mode you supply the candidate and Nisi skips drafting and repair. The full flow diagram is in [Architecture](https://github.com/louiscalata/nisi/blob/main/docs/architecture.md#execution-flow).

## Check a journal on your machine

Real run journals are not in this repository. Point the checker at a directory or one file. It reads locally and prints counts, sha256 and reason codes.

```bash
scripts/validate-real-data.sh --data-dir /absolute/path/to/your/nisi-data
scripts/validate-real-data.sh --journal /absolute/path/to/journal.jsonl
```

`scripts/validate-real-data.sh --smoke` checks only `fixtures/sample-data/`, which is synthetic. `verified: true` on a journal means the hash chain matches the file, not that the events happened or that a signature was checked.

## Limits

- **Scope.** The CLI runs two fixed demonstrations and `validate`. It does not run your repository. `demo` calls no model. `local-model` needs a loopback chat server that you run, an endpoint and two different model names. Neither command runs model-generated code or changes a repository.
- **Distribution.** Nisi is not on the npm registry. The archive installs no models and starts no model server.
- **Trust.** Nisi checks what your callbacks report. It cannot see what they did. `COMPLETED` does not authorize applying files or shipping.
- **Generated code.** If you run generated code, isolate it.
- **Run journal.** The optional run journal is a hash-chained record of a run. Its `verified: true` means internal consistency, not authenticity.
- **Data sent to Jev.** Nisi builds a `state` record: the task's id, mode, language, allowed file names and acceptance criteria and, for the reviewer, the candidate's files and whether the tests passed. A `judge` function decides what is sent. `judge: 'typesafe'` sends that `state` as is with the built-in client, which reads `TYPESAFE_API_KEY`. The variable alone does not send.
- **Jev as reviewer.** By default it passes, yet counts as a required reviewer. A failing judge blocks the run. The measured ranking was too weak to use as a gate. See the section above.
- **Not measured.** The benchmarks are integration checks, not accuracy estimates. The local pilot used one loaded model and 12 tasks, and Nisi tied a handwritten checked loop.
- **Verification.** v0.3.0 and v0.3.1 are covered by tests. v0.3.0 has a one-PC Windows note. v0.3.1 has no verification record of its own beyond CI and the checks listed in its release notes.

## Learn more

- [Documentation index](https://github.com/louiscalata/nisi/blob/main/docs/README.md)
- [Install and use](https://github.com/louiscalata/nisi/blob/main/docs/install.md)
- [Workflow API](https://github.com/louiscalata/nisi/blob/main/docs/workflow-api.md)
- [Local models and Jev](https://github.com/louiscalata/nisi/blob/main/docs/local-models.md)
- [Run journal and store](https://github.com/louiscalata/nisi/blob/main/docs/run-journal.md)
- [Benchmarks](https://github.com/louiscalata/nisi/blob/main/docs/benchmarks.md)
- [Changelog](https://github.com/louiscalata/nisi/blob/main/CHANGELOG.md)

## License and support

Apache-2.0, maintained by Louis Calata.

Questions and reproducible reports are welcome in [GitHub Issues](https://github.com/louiscalata/nisi/issues). Pull requests are not accepted. See [CONTRIBUTING.md](https://github.com/louiscalata/nisi/blob/main/CONTRIBUTING.md), [SECURITY.md](https://github.com/louiscalata/nisi/blob/main/SECURITY.md) and [LICENSE](https://github.com/louiscalata/nisi/blob/main/LICENSE).
