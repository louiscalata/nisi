# AGENTS.md

Instructions for coding agents working in this repository. Product name: Nisi.

## Overview

Nisi is a Node.js CLI and library (Node.js 22 or newer, Apache-2.0) that runs one coding task through draft, checks, tests, separate review, and bounded repair, then returns a report. It does not apply the files. The ethos is: propose and never apply, measure honestly, and keep data boundaries explicit. A completed report is not permission to ship. Hosted Jev calls require explicit opt-in in v0.3.2. Local-model examples call only the loopback endpoint supplied by the caller. The latest GitHub release is v0.3.2. See `docs/release-notes/v0.3.2.md` for the release scope.

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

From a source checkout, after `npm ci`. The results below are from the `test (ubuntu-latest, 24)` job of main CI [run 43719693869](https://github.com/louiscalata/nisi/actions/runs/43719693869) on commit `3bfc602` (Node `v24.22.2`, GitHub-hosted Linux, read from the job log). Each step in that job passed. The same run's Linux Node 22 job also reports 351 tests, 350 passed, 1 skipped.

| Command | What a clean run shows |
| --- | --- |
| `npm run check:structural` | JSON `"status":"PASS"` and `"sourceFindings":[]` |
| `npm run check:static` | JSON `"status":"PASS"` and `"sourceFindings":[]` |
| `npm test` | 351 tests, 350 passed, 0 failed, 1 skipped |
| `npm run check` | Structural check, then the same test result |
| `npm run check:cli-package` | `"status": "PASS"`, 21 archive files, installed demo |

`npm run check:static` is `node tools/check-side-effects.mjs`, which imports `scripts/structural-check.mjs`. It is the same check as `npm run check:structural`. Before `npm ci`, both exit 1 with `ERR_MODULE_NOT_FOUND` for `typescript`.

The skipped test on Linux is `an unregistered script still reports a real Windows spawn refusal`. It runs on Windows. In the same run the Windows jobs report 351 tests, 349 passed, 0 failed, 2 skipped (the symlink-swap test, because Windows has no `O_NOFOLLOW`, and the FIFO test, because Windows has no `mkfifo`). Do not count those skips as failures, and do not count a Linux run as a Windows run.

`node bin/nisi.mjs demo` prints `outcome` `COMPLETED`, one repair, and `modelCalls` 0. It calls no model. `node examples/workflow.mjs` keeps the report. `node examples/local-model-workflow.mjs` needs a loopback server and two model names; with no arguments it exits 2 and prints usage. `scripts/validate-real-data.sh --smoke` checks only `fixtures/sample-data/`.

## CI

`.github/workflows/ci.yml` runs on pull requests, pushes to `main`, and manual dispatch. The matrix is `ubuntu-latest` and `windows-latest`, Node.js 22 and 24. Linux uses GitHub-hosted `ubuntu-latest`. Windows uses `[self-hosted, pc-win]` for pushes, manual runs and same-repository pull requests; fork pull requests use GitHub-hosted `windows-latest`. The Windows jobs are `test (windows-latest, 22)` and `test (windows-latest, 24)`. Each job runs `npm ci`, `npm run check:static`, `npm run check`, `npm run check:cli-package`, the public journal and store tests, and `node docs/editor/check-editor.mjs ./index-typing-revision.html`. Apple Foundation Models tests use stand-ins. The Swift probes are not run here. The one-PC Windows note in `docs/verification-v0.3-windows.md` is v0.3.0 only. The 10 November 2026 harder-task re-measure is `NOT_RUN`; see `docs/reviews/2026-11-10-live-model-remeasure.md`.

A separate `python` job on `ubuntu-latest` installs `ruff==0.17.4`, runs `ruff check` and `ruff format --check` (rules in `ruff.toml` and `docs/python-style.md`), and runs `benchmarks/harder/check_reproducible.py`, which regenerates both frozen task sets and compares them byte for byte with the committed files and the hashes pinned in `benchmarks/harder/run.mjs`.

Merge a pull request only when all five jobs are green. A queued job is not a pass.

## Conventions

- One small pull request per concern. Do not mix unrelated fixes.
- Never push to `main`. Open a pull request and merge with a merge commit only after CI is green.
- Docs stay plain and factual. No hype, and no release-process instructions on the public README.
- Outside contributions: issues are welcome; pull requests are not accepted. See `CONTRIBUTING.md`.

## Hard rules

- Do not commit secrets, API keys, or journal payloads. Errors must not echo keys or response bodies.
- Report `NOT_RUN` when a check was not run. A skipped live model, a skipped Jev call, or a Linux-only run is not a pass for that thing. Do not invent scores.
- Do not tag, create a GitHub Release, or publish to npm unless Louis says yes. Keep the package version stable until the next authorized release.
- Do not edit `AGIW.md`. It is not in this tree. Do not create it.
- Do not repair journals or fingerprints silently. A pre-v0.2.1 pruned row whose fingerprint was not recomputed fails `reopen` with `INVALID` and `LEGACY_UNRETAINED_FINGERPRINT`. The store refuses it with that reason. The file is not authorized. The stored fingerprint is not recomputed, and the bytes are not rewritten. Any other fingerprint mismatch stays `RECORD` or `INVALID_JOURNAL`. The remedy is to run the work again with v0.2.1 or later. See `docs/run-journal.md`.

## Deeper docs

- `README.md` — what Nisi is and the demo
- `docs/README.md` — documentation index
- `docs/install.md` — install the v0.3.2 archive and run the CLI
- `docs/workflow-api.md` — task, callbacks, and report
- `docs/architecture.md` — flow and trust boundaries
- `docs/local-models.md` — loopback chat, `reasoningEffort`, and what is sent to Jev
- `docs/run-journal.md` — journal, store, and `LEGACY_UNRETAINED_FINGERPRINT`
- `docs/benchmarks.md` and `benchmarks/harder/README.md` — measurements and their limits
- `CHANGELOG.md` — released and unreleased changes
- `roadmap.md` — shipped and open items
- `SECURITY.md` — how to report a security problem
