# Documentation index

Start with the [project README](../README.md) for what Nisi is and how to run the demo. This page lists every document in `docs/`, the project files and the repository layout, and says when to read each.

## Use Nisi

| Document | Read it when |
|---|---|
| [Install and use](install.md) | You want to run the demo, install the release archive, run the checks or find the import for your code. |
| [Workflow API](workflow-api.md) | You are writing the task, candidate, callbacks and report storage for your own application. |
| [Local models and Jev](local-models.md) | You want a local chat model to act as author or reviewer, set `reasoningEffort`, or add the optional Jev advisor (Jev is a hosted model from TypeSafe). It lists what data leaves your machine. |
| [File access policy](file-policy.md) | You need a written grant that limits which file content may reach the Apple on-device model. |
| [Apple Foundation Models adapter](apple-foundation-models.md) | You are on an Apple Silicon Mac with Apple Intelligence and want the native advisory helper. |
| [Run journal and store](run-journal.md) | You need an append-only, hash-chained record of run observations and want to save and reopen it from disk. `nisi validate` checks a file you already have. |

## Understand Nisi

| Document | Read it when |
|---|---|
| [Architecture](architecture.md) | You want the terms, execution flow, components and trust boundaries. |
| [Component names and core design](naming-and-core-design.md) | You want to know why components are named as they are and which legacy names still work. |
| [Benchmarks](benchmarks.md) | You want the measured token use, the package size comparison and their limits. |
| [Harder-task benchmark](../benchmarks/harder/README.md) | You want the opt-in 16-task model benchmark behind the Jev and reasoning figures. |
| [Canonical JSON v1 profile](../contracts/canonical-json-v1-profile.md) | You need the exact byte format Nisi uses for its JSON codec. |
| [Roadmap](../roadmap.md) | You want to know what is planned next. |

## Project files

| File | Read it when |
|---|---|
| [CHANGELOG.md](../CHANGELOG.md) | You want the changes in each version, including unreleased changes on main. |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | You want to know how to report an issue and why pull requests are not accepted. |
| [SECURITY.md](../SECURITY.md) | You are about to report a security problem. |

## Verification records

Each record is scoped to the version it names. The Windows check is one machine on one day. Do not read a record as covering later versions.

| Document | Read it when |
|---|---|
| [v0.1 verification](verification.md) | You want the September 2026 checks of Nisi v0.1. |
| [v0.2 verification](verification-v0.2.md) | You want the checks of the v0.2.0 CLI, journal and store. |
| [v0.3.0 Windows hardware check](verification-v0.3-windows.md) | You want to know how the CLI and journal store behaved on one real Windows PC. |
| [Raw verification files](verification/) | You want the logs, manifests and summaries behind those records, in the dated folders `2026-09-11`, `2026-09-12` and `2026-09-12-v0.1`. |
| [Review records](reviews/) | You want the written reviews of earlier pushes and of the main branch. |

Versions without a record:

- **v0.2.1:** changed the journal, store, file access policy and CLI. Covered by tests only.
- **v0.3.0:** adds `reasoningEffort`, the Jev advisor and one CLI error-code entry. Covered by `tests/jev-advisor.test.mjs`, `tests/local-chat.test.mjs` and `tests/harder-benchmark.test.mjs`.
- **v0.3.1:** adds the Jev client, harder-task set v2, the local-chat transport timeout fix, and `nisi validate`. Covered by tests. No verification record. Jev was not called while this version was prepared (`docs/jev/`).

## Repository layout

| Folder or file | What it holds |
|---|---|
| `bin/`, `index.mjs` | The command line entry point and the package entry point |
| `workflow/`, `adapters/` | The orchestrator and its contracts; local chat, Jev, and Apple Foundation Models adapters |
| `gate/`, `policy/`, `history/` | Legacy file access policy (`gate/`) and Apple content executor; the file access policy (`policy/`); the run journal and store (`history/`) |
| `canonical/`, `serialization/`, `contracts/` | The canonical JSON v1 codec, its alias, its profile and test vectors |
| `examples/`, `tests/` | Runnable examples; the Node test suite (`npm test`) |
| `benchmarks/` | `value/` (controls, overhead, local pilot, charts); `harder/` (opt-in model benchmark) |
| `scripts/`, `tools/`, `probes/` | Check and benchmark scripts; Swift probes for the Apple helper (not in the package archive) |
| `docs/` | Guides, verification records and reviews |
| Root files | `package.json`, `CHANGELOG.md`, `roadmap.md`, `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`, `.github/` (CI) |

## Background

Nisi grew out of "initiate online code mode", a saved set of instructions (an assistant skill) that Louis Calata uses to organize coding work with an AI assistant. Its rules became this library: fixed scope, defined responsibilities, separate review and bounded repair. Codex and Claude were used during development.

## Earlier material

| Document | Read it when |
|---|---|
| [v0.1 README draft](README-draft.md) | You want the README text as it was for v0.1. |
| [v0.1 editable README manuscript](editor/) | You want the standalone editor for that earlier text. Open `index.html` in a browser. |
