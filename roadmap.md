# Nisi roadmap

Canonical project roadmap. Updated September 23, 2026. Product name: Nisi.
Public v0.1 package version: 0.1.0. Current candidate: Nisi v0.2.0-rc.1. The September 12 documentation and onboarding revision started from public commit `fc8bf1b`; its GitHub update and package registry publication were separate release actions.

## Public v0.2 journal and store candidate

- [x] Document only public journal/store behavior and retained v0.1 boundaries.
- [x] Add a version-scoped verification record and changelog.
- [x] Restrict CI token permissions and pin its third-party actions.
- [x] Review the final outgoing tree after recovery-worker removal and test the
  declared imports from a packed, installed archive on Mac.
- [x] Run the full public checks on Node 22 and 24 on Mac for the initial
  `a3319d1` candidate; later public code passed the hosted four-job matrix.
- [x] Obtain hosted Windows Node 22/24 results for the public v0.2 code at
  `d2eaf44`; both jobs passed 198/198 tests. Native Windows application and
  separate PC handoff results remain open.
- [ ] Recheck CI against the exact published commit.

## Nisi v0.1 follow-up

- [x] Show Nisi v0.1 in the README, editor header and downloadable editable copy.
- [x] Reject adapter results when the deadline passes during result copying.
- [x] Add a regression for both required and optional report storage; confirm it
  fails before the correction and passes afterward.
- [x] Pass all 170 tests on Node 22 and 24, the structural check, the deterministic
  workflow example and all 12 editor checks.
- [x] Review the correction independently and preserve the live manuscript.

The [follow-up review](docs/reviews/2026-09-12-v0.1-push-review.md) records the
before/after behavior and verification scope.

## September 12 review plan

- [x] Put purpose, checkout instructions, runnable usage and expected output first.
- [x] Use Workflow Orchestrator in prose; retain public imports and API contracts.
- [x] Define architecture, workflow, pipeline, run, stage, status, outcome and state.
- [x] Keep the kitchen brigade chart and move technical detail into linked guides.
- [x] Move brief neutral background to the end; remove the defensive aside.
- [x] Add Node-version preflight and actionable local-model argument errors.
- [x] Rebuild the editable manuscript without changing the typing behavior.
- [x] Verify the changed source, examples, links, editor and before/after record.
- [x] Complete the GitHub push review and apply its concrete findings.

Publication and hosted verification are tracked per commit in
[GitHub history](https://github.com/louiscalata/nisi/commits/main/) and
[GitHub Actions](https://github.com/louiscalata/nisi/actions/workflows/ci.yml).

## Direction

Put the portable operating rules of **initiate online code mode** into a usable
JavaScript Workflow Orchestrator: fixed scope and acceptance criteria, one author,
separate reviewers, deterministic checking tools, bounded repair, and outcomes
supported by records tied to the exact task and candidate. The assistant skill
remains operating instructions; the library can run without installing it.

Use the kitchen brigade to explain the process, with conventional developer
terms alongside each role. Louis owns the editorial voice and release decisions.
The editable draft is the current README manuscript. The current authorized update includes the September 12 review changes.
Later unrequested editorial work remains local until publication is requested.

## September 11 implementation record

- [x] Public package entrypoint and conventional component names: Workflow Orchestrator,
  File Access Policy, JSON Canonicalizer, Apple Foundation Models Adapter,
  Local Chat Author/Reviewer Adapters, and Static Analysis Check.
- [x] Retain legacy component imports, factories, v1 refusal codes and digest
  domains through additive aliases and compatibility checks.
- [x] Immutable task, policy, changed-file candidate, stage and report contracts.
- [x] Sequential edit and review modes; fixed adapter identities; scope and
  protected-file checks; evidence bound to run, task, attempt and candidate.
- [x] Validate actual assertion counts and stage invariants; refuse missing,
  stale, malformed or contradictory evidence.
- [x] Bounded repairs, repeated-candidate termination, monotonic total deadlines,
  cancellation and distinct incomplete outcomes.
- [x] Optional report-store contract, including required-store failure behavior
  and a report digest. Storage acknowledgements remain trusted host reports.
- [x] Runnable deterministic example with real Node syntax checks, failing then
  passing assertions, one repair, separate callback review and a report written,
  synced and verified by reading it back.
- [x] Restricted integer-only JSON canonicalizer and digest, with scoped static
  analysis and eight forbidden/eight allowed fixtures.
- [x] File-admission checks with captured file identity, bounded reads, UTF-8
  validation, scope, expiry and revocation. Stable parent paths remain required.
- [x] Native Apple advisory adapter with strict returned-evidence validation,
  helper and prompt digests, bounded output and execution. Two real helper calls
  passed on the tested Mac, with advisory caps 128 and 0.
- [x] Experimental loopback HTTP author/reviewer adapters with closed JSON-schema
  requests, strict response validation, size/deadline limits and retained receipts.
- [x] Full automated checks: 165/165 tests passed on each of Node 22.23.2 and
  Node 24.18.0 on macOS arm64. Published GitHub Actions also passed both Linux
  Node 22/24 jobs with 165 tests each at implementation commit `ec12fcb`.
  Native Windows was not run.

Detailed evidence, source hashes and retained outcomes are in
[docs/verification.md](docs/verification.md). Passing checks apply to the recorded
source and environment; they are not a universal correctness claim.

## Local-model compatibility status

- [x] Retain an earlier completed Qwen-author/GPT-OSS-reviewer configuration run,
  including four passing acceptance assertions. It predates JSON-schema requests
  and has no exact source manifest; do not credit it to the current implementation.
- [x] Retain current-schema failures honestly: Qwen returned empty final content
  and was refused; Gemma authored a valid configuration with four passing
  assertions, but GPT-OSS review exceeded the total deadline.
- [x] Complete a current-schema run with Gemma 3 as author and Gemma 4 as
  reviewer: all four acceptance assertions passed; both responses validated.
  Retain source hashes, configured model names, deadline and request receipts.
- [ ] Measure matched tasks before claiming gains in quality, tokens, cost or speed.

The HTTP integration does not invoke the LM Studio CLI, load models, or choose
models automatically. A trusted compatible local server and configured model
names are supplied by the host application.

## September 11 editorial record

- [x] Explain what Nisi is, what it does, its intended value and current limits.
- [x] Map brigade roles to developer terms and render **The Path of One Plate**
  with checks, review, repair and early stopping branches.
- [x] Provide 17 editable sections and an editable About description, Markdown
  export and a standalone editable HTML download.
- [x] Keep typing fields and layout unchanged while typing; update previews on
  blur. Louis confirmed the fix. Isolated Chrome character-entry, Enter/Backspace,
  export byte-parity and standalone HTML reopening checks also passed.
- [x] Remove the editorial Next steps section, add LLM Orchestration, and polish
  the entire draft against the implemented source. This roadmap retains future work.
- [x] Preserve section IDs and original baselines while merging editorial changes.
- [x] Louis authorizes updating GitHub with the current reviewed wording and code.
- [x] Replace development-only status wording for the GitHub update and retain
  an exact source manifest with the verification record.

## Integration and release work still outside the verified prototype

- [ ] Host-specific integration for applying candidates, actual independent
  author/reviewer isolation and durable production report storage.
- [ ] Broader model/server compatibility and real project workflow evaluation.
- [x] Hosted Linux CI passed for the published implementation.
- [ ] Native Windows validation and a supported-platform matrix.
- [ ] Distribution, installation and release checks before package publication.
- [x] Source-update approval received for commit/push.
- [ ] Versioned package publication and distribution release, if requested.

## Boundaries

The engine validates adapter reports; it cannot prove callbacks are honest.
Candidate paths are logical snapshot names, not filesystem capabilities. The
file policy must mediate relevant reads, kind labels are caller declarations,
and revocation cannot recall bytes already returned. Native helper behavior
flags are self-reports. A loopback address does not prove local-only inference
or absence of forwarding and logging. Cancellation requires cooperative adapters
and cannot forcibly interrupt synchronous JavaScript or undo external effects.

Machine paths, credentials, model-service setup, private project architecture,
network-share routing and automatic model selection remain host responsibilities.
