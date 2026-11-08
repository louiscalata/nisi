# Nisi

Nisi is a Node.js library and command line tool that runs one coding task through draft, checks, tests, separate review and bounded repair, for developers who build tools around coding models.

**Status:** v0.3.0 · Node.js 22 or newer (macOS, Linux, Windows) · Apache-2.0 license

- **v0.3.0:** adds the `reasoningEffort` option for local chat models, an optional Jev advisor (Jev is a hosted model from TypeSafe; see Limits) and an opt-in 16-task harder benchmark.
- **On main, not in v0.3.0:** a built-in Jev client (`TYPESAFE_API_KEY`) and 42 more harder tasks.
- The [changelog](https://github.com/louiscalata/nisi/blob/main/CHANGELOG.md) lists every change.

## Try it

```bash
git clone --branch v0.3.0 --depth 1 https://github.com/louiscalata/nisi.git
cd nisi
node bin/nisi.mjs demo
```

You should see this JSON (indentation aside):

```json
{ "outcome": "COMPLETED", "code": null, "repairAttempts": 1,
  "reportStored": true, "modelCalls": 0 }
```

The demo calls no model. It repairs an intentionally incorrect module once, and writes then deletes a report in a temporary directory. Run `node examples/workflow.mjs` to keep the report.

To install the release archive, run Nisi's own tests or call the library, see [Install and use](https://github.com/louiscalata/nisi/blob/main/docs/install.md).

## How it works

An **adapter** is a callback object you supply that connects one role to your tool or model. A **candidate** is a snapshot of the changed file names and their complete contents, not a patch. Nisi validates everything an adapter returns.

1. Nisi binds the task and asks your code whether the permitted files may be used.
2. The author adapter drafts a candidate.
3. Static checks run, then tests. A failed check skips the tests, and a failed test skips review.
4. Each reviewer adapter reviews the candidate separately.
5. A failed check, test or review sends the candidate back to the author for repair, within the repair budget. The repaired candidate returns to step 3 and must pass fresh checks, tests and review.
6. The run ends with an outcome (`COMPLETED`, `FAILED`, `BLOCKED`, `CANCELLED`, `TIMED_OUT`, `REPAIR_LIMIT` or `NO_PROGRESS`) and a report. Cancellation, a deadline, missing evidence or a repeated candidate also end it.

Nisi never writes the files; your application decides whether to apply the candidate. In review mode you supply the candidate and Nisi skips drafting and repair. The full flow diagram is in [Architecture](https://github.com/louiscalata/nisi/blob/main/docs/architecture.md#execution-flow).

## Limits

- **Scope.** The CLI runs two fixed demonstrations and does not run your repository. `demo` calls no model. `local-model` needs a loopback chat server that you run, an endpoint and two different model names. Neither command runs model-generated code or changes a repository.
- **Distribution.** Nisi is not on the npm registry. The archive installs no models and starts no model server.
- **Trust.** Nisi checks what your callbacks report. It cannot see what they did. `COMPLETED` does not authorize applying files or shipping.
- **Generated code.** If you run generated code, isolate it.
- **Run journal.** The optional run journal is a hash-chained record of a run. Its `verified: true` means internal consistency, not authenticity.
- **Data sent to Jev.** Nisi builds a `state` record: the task's id, mode, language, allowed file names and acceptance criteria and, for the reviewer, the candidate's files and whether the tests passed. A `judge` is a function you write that receives the `state`, calls Jev and decides what is sent. The built-in client (main only) sends the `state` as is. Nothing is sent without a `judge` or, on main, `TYPESAFE_API_KEY`. See [Local models and Jev](https://github.com/louiscalata/nisi/blob/main/docs/local-models.md#jev-pre--and-post-analysis-optional).
- **Jev as reviewer.** Jev is a paid API with no free or open-weight version. By default it is advisory: it always passes, yet counts as a required reviewer. If its judge fails, the run ends `BLOCKED` with `REVIEW_UNAVAILABLE`. It scored AUC 0.78 on 31 labelled answers (AUC measures how well it ranks right answers above wrong ones), too weak to gate a run. On 16 harder tasks with one local model (single runs), the Jev plan showed no demonstrated gain in accuracy or speed.
- **Not measured.** The benchmarks are integration checks, not accuracy estimates. The local pilot used one loaded model and 12 tasks, and Nisi tied a handwritten checked loop.
- **Verification.** The v0.3.0 changes are covered by tests and have no verification record of their own.

## Learn more

- [Documentation index](https://github.com/louiscalata/nisi/blob/main/docs/README.md): every other document, including verification records, repository layout and project background.
- [Install and use](https://github.com/louiscalata/nisi/blob/main/docs/install.md): install the release archive, run the checks or call the library.
- [Workflow API](https://github.com/louiscalata/nisi/blob/main/docs/workflow-api.md): write your own task, callbacks and report storage.
- [Local models and Jev](https://github.com/louiscalata/nisi/blob/main/docs/local-models.md): connect a local model or the Jev advisor.
- [Benchmarks](https://github.com/louiscalata/nisi/blob/main/docs/benchmarks.md): the measured numbers and how far to trust them.
- [Changelog](https://github.com/louiscalata/nisi/blob/main/CHANGELOG.md): what changed in each version, including unreleased changes on main.

## License and support

Apache-2.0, maintained by Louis Calata.

Questions and reproducible reports are welcome in [GitHub Issues](https://github.com/louiscalata/nisi/issues); pull requests are not accepted. See [CONTRIBUTING.md](https://github.com/louiscalata/nisi/blob/main/CONTRIBUTING.md), [SECURITY.md](https://github.com/louiscalata/nisi/blob/main/SECURITY.md) and [LICENSE](https://github.com/louiscalata/nisi/blob/main/LICENSE).
