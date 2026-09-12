# September 12 GitHub push review

The previous README explained the background before showing how to run Nisi.
This revision puts a working example first, separates architecture from model
setup, and adds actionable setup checks. The public `runWorkflow` API, module
paths, workflow behavior, and model transport contract remain stable.

## Plan and applied changes

| Review recommendation | Before | Applied change |
|---|---|---|
| Lead with purpose and use | Background and multiple explanations before setup | One purpose paragraph, checkout commands, expected example output, then integration |
| Use consistent component names | Workflow Engine mixed with LLM Orchestration | Workflow Orchestrator for coordination; Local Chat Adapters for HTTP integration |
| Define technical terms | Pipeline, workflow and state were easy to conflate | Architecture guide defines the terms and separates a workflow's rules from a run |
| Keep the useful analogy | Brigade roles and a long numbered walkthrough repeated the diagram | One chart and a compact mapping of kitchen roles to software responsibilities |
| Correct diagram semantics | Repair returned to drafting/preparation | Repair returns its replacement candidate directly to checks and tests |
| Automate setup requirements | Node requirement in advisory engines metadata | npm devEngines plus a dependency-free preflight for tests, checks, and examples |
| Make errors useful | Extra CLI arguments were ignored; invalid configuration could print a stack trace | Exactly three validated arguments; a setup message, usage, and exit code 2 before inference |
| Remove defensive overhead | Personal note near the top included a joke aimed at critics | Brief neutral background at the end |
| Keep evidence accurate | Detailed historical results in the landing page | Linked verification records with separate dates, source manifests, and integration limits |
| Preserve the editor | 17 editable sections and old source/reviewer badges | 10 editable sections, About field, original wording in comparison baselines, stale badges removed |

The Markdown word count, including code and diagram labels, changes from 2,142
to 965. The first command appears at line 20 instead of line 145.

## Before and after

**Opening before:** “An AI coding workflow inspired by a kitchen brigade.”

**Opening after:** “A Node.js library for running AI-assisted coding workflows.”

**Before setup:** `npm ci` assumed the reader already had a checkout.

**After setup:** `git clone`, `cd nisi`, `npm ci`, and `npm run example:workflow`
lead to the documented `COMPLETED`, one-repair, stored-report result.

Compare the [previous README](https://github.com/louiscalata/nisi/blob/fc8bf1b11d613c7bd0d3ed3494c3f64d7cd45d18/README.md)
with the [revised README](../../README.md). Download and open the
[rendered comparison](../editor/review-before-after.html) to read both versions
side by side, or use the [editable manuscript](../editor/README.md).

## Final review disposition

The final source review found three issues: the verification narrative needed a
separate record for changed onboarding code; the diagram's repair arrow implied
an extra draft call; and optional chaining in the Node preflight could prevent
an older runtime from displaying its setup error. All three were corrected.

The Linux CI comment explaining the Apple-only probe limitation was retained.
It explains a platform constraint. Details that document public contracts,
trust boundaries, or non-obvious reasons were retained in the relevant guides.
Removing all comments or promising universal correctness was not adopted.

Validation results and source scope are in [Verification](../verification.md).
Package registry publication, wider model compatibility, and native Windows
acceptance remain separate work in the [roadmap](../../roadmap.md).
