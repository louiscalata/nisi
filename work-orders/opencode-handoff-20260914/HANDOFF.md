# Handoff to OpenCode — parallel development, 2026-09-14

**Authorization (Louis, 2026-09-14):** "allow opencode to takeover the
development as a co author. now it will be codex, claude and opencode … make a
handoff to opencode. we'll start parallel development … give opencode tasks
that you're not working on so you two can parallel work without working on the
same project."

**Overall roadmap progress: 30% — 3/10 NX milestones accepted.** This handoff
does not change it. Canonical roadmap: `../../roadmap.md`. Codex's paused state
and the takeover log: `../parallel-seven-tracks-v1/PAUSED-HANDOFF.md`.

## The three co-authors and the one rule

> **INCIDENT 2026-09-14 10:22Z:** OpenCode wrote a new target into the FROZEN Veritas import
> (`integrations/veritas/…/CodenameVeritasFramework/`) and built it in place. Never write, format or
> build under `integrations/veritas/` — it is manifest-verified and any change fails the product suite.
> New Swift work goes through the Nisi overlay `native/macos/Nisi/` and only with a Claude contract.
> The draft was relocated to `work-orders/afm-internal-builder-opencode-20260914/` and is held for Louis.

Codex (Astra) is paused, usage exhausted; do not restart it. Claude and OpenCode
work in parallel on DISJOINT paths. The rule that makes parallel work safe:
**one writer per directory.** Every task below names its owned paths; write
nowhere else, and never in a directory another task owns. If a task needs a
file outside its allowlist, stop and record the need in that task's roadmap;
do not reach across.

Deterministic acceptance decides, never the model: each work order carries an
oracle test file that OpenCode did not write (or, for Track 1, will write
FIRST and hand to Claude for review before implementing). `packet-receipt`
runs the accept commands. Tests written alongside code are not an oracle for
that code.

Lanes: OpenCode may use `CHAMI_PACKET_TIER=go` (metered OpenCode Go,
kimi-k2.7-code; Louis allowed paid until its usage is consumed) for
contract-sized items, `free` for reviews and small items, `local` only for
one-line mechanical edits (it is slow and intermittent). There is no usage
meter: a refused request in a receipt means the paid lane is exhausted; fall
back to `free` and note it. Never commit, push, publish, sign, install,
change model service state, or edit the frozen Veritas import.

## OpenCode-owned tasks (Claude will not write in these directories)

**Before starting any task, read its STATUS line. A packet whose `.result.md`
says `outcome: done` is finished: never rerun it. As of 2026-09-14 all four
OpenCode-owned tasks (O1–O4) are complete on OpenCode's side; O2 is the only
one with an external gate left — Claude's cross-review (ACCEPT) — and nothing
else is open for OpenCode right now.**

### O1 — Track 7 release-readiness binding — **STATUS: DONE 2026-09-13 22:57 PDT. Do not rerun its packet.**
- Owned: `work-orders/parallel-seven-tracks-v1/track7/` (all files except
  `check-release-readiness.hardening.test.mjs`, which is Claude's oracle and
  read-only).
- Packet: `track7/.packets/nisi-track7-release-readiness-binding.packet.md`
  — receipt DONE; hardening 10/10 AND author 2/2 (Claude rerun). `track7/README.md` records hashes.
- Done when: both suites green; `current-readiness.json` still NOT ready
  (placeholders kept); receipt DONE; a dated line in
  `track7/README.md` (create it) with file hashes.

### O2 — Track 1 fixture-only repository runner — **STATUS: second pass REJECTED 2026-09-14 03:20 PDT (5 must-fixes; see the cross-review appended to `track1/README.md`). Fix in `track1/` only, oracle first, then re-append ORACLE READY FOR REVIEW. Nothing from `track1/` is integrated until an ACCEPT.**
- Owned: `work-orders/parallel-seven-tracks-v1/track1/` (create it): 
  `repository-fixture-runner.mjs`, `repository-fixture-runner.test.mjs`,
  `README.md`, `package.json`, `.packets/`.
- Spec: the Track 1 section of `../parallel-seven-tracks-v1/engineering-triage.md`
  — a fixture-only acceptance runner over the reviewed repository host with
  inert reviewed adapters; exact source manifest; failing baseline then
  repaired candidate; settled host precedes receipt; stale / wrong-profile /
  cancelled cases stay adverse; no review-summary properties by default;
  owned fixtures cleaned on success and failure; refuses source-pin drift;
  never contacts a model endpoint. Read-only inputs:
  `hosts/repository/reviewed-workflow-v1.mjs`, `hosts/repository/task-workspace-v1.mjs`,
  `examples/repository-task/reviewed-live-fixture-v1.mjs`, and the three
  `tests/repository-*-cli.test.mjs` for the current API shapes.
- Order of work: (1) write `README.md` stating the contract in prose and
  `repository-fixture-runner.test.mjs` FIRST, then put a note in
  `track1/README.md` "oracle ready for review" and STOP; Claude reviews the
  oracle (adversarially) and appends findings to `track1/README.md`; (2) only
  then implement the runner against the reviewed oracle, via a packet on `go`.
- Done when: oracle reviewed, packet DONE, Claude's cross-review appended.

### O3 — Track 5 registry fixes — **STATUS: DONE, PROMOTED by Claude 2026-09-14 00:41 PDT. Do not touch `track5/` again.**
- Promoted verbatim (three hunks) into `experimental/module-registry-v1.mjs`; oracle
  promoted as `tests/experimental-module-registry-containment.test.mjs`; suite 1697/1697.
- One nit, no action needed: `track5/package.json` `test:author` points at
  `../tests/…` but the product test is three levels up; the README already says to
  run it from the repo root, which is what Claude did (7/7).
- Owned: `work-orders/parallel-seven-tracks-v1/track5/` (create `src/`,
  `tests/`, `.packets/`, `package.json`); the product files
  `experimental/module-registry-v1.mjs` and
  `tests/experimental-module-registry.test.mjs` stay Claude's to promote.
- Claude's adversarial review of the registry is running now; its report will
  land at `track5/evidence/claude-review-20260914.md` with a "missing oracle"
  list and per-defect one-line fixes. OpenCode then: copy the product module
  into `track5/src/`, write `track5/tests/registry-containment.test.mjs` from
  the missing-oracle list, confirm it fails on the copy, and run a packet on
  `go` to make it pass with the author's 7 tests still green.
- Done when: both suites green in `track5/`; Claude promotes.

### O4 — Product tests for the two ready-to-integrate demos — **STATUS: DONE, INTEGRATED by Claude 2026-09-14. Do not touch either `integration/` again.**
- Your rehearsal proved the product modules satisfy both protected oracles (scratch/history byte-identical). Claude installed from the work-order originals with the review's placement (modules at depth one under `history/`); suite 1749/1749. Evidence: `docs/verification/2026-09-14/o4-integration/`.
- Two things to carry forward: keep trailing newlines, and never add a layout-specific assertion in place of a dropped pin (the journal baseline replacement would have failed once installed).
- Owned: `work-orders/bundle-restart-demo/integration/` and
  `work-orders/journal-restart-recovery/integration/` (create both).
- Task: for each, write the product-suite versions of its tests
  (path-only edits, as `docs/verification/2026-09-13/evidence-chain-integration/preflight-tests/`
  did for the four integrated modules; drop any frozen-copy hash pin that
  points at a product module, never re-pin one), with a `migration-log.json`
  listing every edit. Do NOT place anything in `tests/`, `history/` or
  `hosts/`: Claude integrates after review.
- Done when: every migrated test passes against the product modules from a
  scratch tree you build under `integration/scratch/`; log written.

## Claude-owned (OpenCode must not write here)

Track 4 admission contract (`work-orders/parallel-seven-tracks-v1/track4/`,
`hosts/repository/`), Track 2 (`work-orders/native-incident-source*`),
native branding + app bundle (`integrations/veritas/native/…` build overlay,
`work-orders/parallel-seven-tracks-v1/build-macos.mjs`, `macos-build-plan.md`),
Track 6 (`track6/`, done), product integration of anything into `tests/`,
`history/`, `hosts/`, `experimental/`, `evaluation/`, `roadmap.md`, and
checkpoints (`~/bin/nisi-ckpt`).

## Reporting

Each task reports in its own `README.md` or `roadmap.md` (append-only, dated,
with sha256 of every file it changed and the exact test counts it observed).
Claude reads those files; there is no other channel. When a task is done,
write the line `STATUS: DONE — <date>` at the end of that file.
