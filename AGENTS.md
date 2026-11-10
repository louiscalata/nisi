# AGENTS.md

Instructions for coding agents working in this repository. Product name: Nisi.

## Overview

Nisi is a Node.js CLI and library (version 0.3.1, Node.js 22 or newer, Apache-2.0) that runs one coding task through draft, checks, tests, separate review, and bounded repair, then returns a report. It does not apply the files. The ethos is: propose and never apply, measure honestly, and keep data boundaries explicit. A completed report is not permission to ship. Jev calls and local-model calls leave the machine only when the caller opts in. The latest GitHub release is v0.3.1. v0.3.2 is in preparation (`docs/release-notes/v0.3.2.md`) and is not tagged.

## Repository map

| Path | What it is |
| --- | --- |
| `bin/nisi.mjs`, `index.mjs` | CLI and package entry |
| `workflow/` | Orchestrator and contracts |
| `adapters/` | Local chat, Jev advisor and client, Apple Foundation Models |
| `history/` | Run journal, journal store, `nisi validate` |
| `policy/`, `gate/` | File-access policy and the Apple content executor |
| `canonical/`, `serialization/`, `contracts/` | Canonical JSON v1 |
| `examples/`, `tests/` | Runnable examples and the Node test suite |
| `benchmarks/value/`, `benchmarks/harder/` | Source-checkout benchmarks, not in the package archive |
| `scripts/`, `tools/`, `probes/` | Checks and the Swift probes (probes are not in the archive) |
| `docs/` | Guides, verification records, reviews |
| `fixtures/sample-data/` | Synthetic validate fixture, not working journals |

## Commands

From a source checkout, after `npm ci`. These were run on commit `bfcc24d` with Node `v22.23.4` on Linux. Each exited 0.

| Command | What a clean run shows |
| --- | --- |
| `npm run check:structural` | JSON `"status":"PASS"` and `"sourceFindings":[]` |
| `npm run check:static` | JSON `"status":"PASS"` and `"sourceFindings":[]` |
| `npm test` | 305 passed, 0 failed, 1 skipped |
| `npm run check` | Structural check, then the same test result |
| `npm run check:cli-package` | `"status": "PASS"`, 21 archive files, installed demo |

The skipped test on Linux is `an unregistered script still reports a real Windows spawn refusal`. It runs on Windows. Do not count that skip as a failure, and do not count a Linux run as a Windows run.

`node bin/nisi.mjs demo` prints `outcome` `COMPLETED`, one repair, and `modelCalls` 0. It calls no model. `node examples/workflow.mjs` keeps the report. `node examples/local-model-workflow.mjs` needs a loopback server and two model names; with no arguments it exits 2 and prints usage. `scripts/validate-real-data.sh --smoke` checks only `fixtures/sample-data/`.

## CI

`.github/workflows/ci.yml` runs on pull requests and on pushes to `main`. The matrix is `ubuntu-latest` and `windows-latest`, Node.js 22 and 24. The Windows jobs are `test (windows-latest, 22)` and `test (windows-latest, 24)`. Each job runs `npm ci`, `npm run check:static`, `npm run check`, `npm run check:cli-package`, the public journal and store tests, and `node docs/editor/check-editor.mjs ./index-typing-revision.html`. Apple Foundation Models tests use stand-ins. The Swift probes are not run here. The one-PC Windows note in `docs/verification-v0.3-windows.md` is v0.3.0 only.

Merge a pull request only when all four jobs are green. A queued job is not a pass.

## Conventions

- One small pull request per concern. Do not mix unrelated fixes.
- Never push to `main`. Open a pull request and merge with a merge commit only after CI is green.
- Docs stay plain and factual. No hype, and no release-process instructions on the public README.
- Outside contributions: issues are welcome; pull requests are not accepted. See `CONTRIBUTING.md`.

## Hard rules

- Do not commit secrets, API keys, or journal payloads. Errors must not echo keys or response bodies. `TYPESAFE_API_KEY` alone does not send task state. `planWithJev` and `createJevReviewer` need `remote: true`. The harder-task runner needs `--judge typesafe`. `createJevJudge()` is an explicit call and may read the key.
- Report `NOT_RUN` when a check was not run. A skipped live model, a skipped Jev call, or a Linux-only run is not a pass for that thing. Do not invent scores.
- Do not tag, create a GitHub Release, or publish to npm unless Louis says yes. v0.3.2 is waiting for that yes. `package.json` stays 0.3.1 until a release commit.
- Do not edit `AGIW.md`.
- Do not repair journals or fingerprints silently. A pre-v0.2.1 pruned row whose fingerprint was not recomputed fails `reopen` with `INVALID` and `LEGACY_UNRETAINED_FINGERPRINT`. The store refuses it with that reason. The file is not authorized and is not rewritten. The remedy is to run the work again with v0.2.1 or later. See `docs/run-journal.md`.

## Deeper docs

- `README.md` — what Nisi is and the demo
- `docs/README.md` — documentation index
- `docs/install.md` — install the v0.3.1 archive and run the CLI
- `docs/workflow-api.md` — task, callbacks, and report
- `docs/architecture.md` — flow and trust boundaries
- `docs/local-models.md` — loopback chat, `reasoningEffort`, and what is sent to Jev
- `docs/run-journal.md` — journal, store, and `LEGACY_UNRETAINED_FINGERPRINT`
- `docs/benchmarks.md` and `benchmarks/harder/README.md` — measurements and their limits
- `CHANGELOG.md` — released and unreleased changes
- `roadmap.md` — shipped and open items
- `SECURITY.md` — how to report a security problem
