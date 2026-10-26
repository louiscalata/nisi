# Nisi Render Engine — handoff (2026-09-14)

Product decision: future Nisi product, Unreal plugin + Unity component plugin;
brief filed at `~/nisi-next-private/work-orders/nisi-render-engine/` with its
own handoff record (new files only).

Folder: `~/pending-review/nisi/render-engine/`. Produces reference models, tests
and the mapping onto the Nisi Render Engine; writes nothing into that repo
(Codex is its write owner).

- `DECISIONS.md` — 14 decisions, default picks accepted on "continue".
- `SPEC.md` v0.1 — design re-based onto the Nisi Render Engine
  (`~/Library/CloudStorage/OneDrive-Personal/Playground Mac/Forged Render Engine`; directory name retired),
  vocabulary map, the virtual-SoC capability, build order 1–7.
- `unit-01-well/` — the layered row state machine.
  - `task.txt` — the contract the chain drafted from.
  - `acceptance_tests.py` — 19 tests / 88 assertion sites, owner-written, immutable.
  - `well_reference.py` — the chain's final artifact, copied with its provenance header.
  - `run-1.log`, `run-2.log` — both runs; manifests under `~/code-runs/codemode-20260914-01{3219,3514}-*`.

## Unit-01 status, exactly

Run 2 (`codemode-20260914-013514-2703-036493000`): acceptance PASS (87/88
sites executed, 0 failed; the unexecuted site is the `assert False` inside the
expected-exception helper), structural gate PASS (ruleset `171abe86528a6f74`),
model-authored harness ERROR (adjudicated `MODEL_HARNESS_UNAVAILABLE`,
acceptance authoritative), model-verify UNAVAILABLE on both requested reviewers
(gpt-oss-20b: output truncated and rejected; qwen3.6-35b-a3b: HTTP 400 from
`:1234`). Certification: **UNCERTIFIED, `MODEL_VERIFY_FAIL`**. Three repairs
by qwen3.6-35b-a3b. Run 1 failed before any test ran (owner-side: `globals()`
in the test runner; and the draft's own tests imported a module).

Claude read the final artifact in full. Two findings, untested, for the port:
`report_check` and `reopen` mutate the row before validating `failed_tiles` /
`tiles`, so an unknown tile leaves a partially blanked row; `snapshot()` returns
the live `layers`/`tiles` lists rather than copies.

## Next (Codex-owned, in the engine repo)

Port the Well as a reducer above the frame reducer (`re-open` = new attempt,
never overwrite), extend the manifest for rows/tiles/DAG/roles, then generalise
`hardware-resource-plan` from CPU slots to SoC blocks — see SPEC.md v0.1.

- `RESEARCH.html` — the published research page (https://claude.ai/code/artifact/0985034f-a4e4-4e04-9736-96e4aaad776f), durable copy.

## Unit-02 tile loop (2026-09-14, later)

`unit-02-tile-loop/`: `task.txt` (contract), `acceptance_tests.py` (14 owner
tests, 113 assertion statements / 68 runner sites), `tile_loop_reference.py`
(sha256 d2af8632…), `run-1.log`, `run-2.log`.

Chain outcome, exactly: two runs, both ended `SPECIFICATION_CLASSIFICATION`
(the classifier's route that skips repairs). Run 1's first failure was the
owner's: two tiles with identical identity replayed from the journal as
specified. Run 2 attempt 0 passed 43/44 acceptance sites; the one miss was a
real contract contradiction (output() "else None" versus "quarantine keeps the
output") — the classifier's SPECIFICATION label was right in kind, wrong in
its stated reason (it blamed a neighbour cascade that does not exist). Gemma's
two repairs regressed the draft (attempt 2 executed zero sites), then the run
stopped. Both runs: no gate scan, no model review, UNCERTIFIED.

Resolution: contract aligned (output() reports a quarantined tile's kept
output; apron and identity see PROMOTED neighbours/children only), run 2
attempt 0 taken as the draft, three-line integrator repair by Claude, model
test block removed; 14/14 owner tests pass under a plain interpreter. This is
the work-order pattern that held on 2026-09-13 (owner contract + tests, local
draft, integrator repair) — it still needs an independent review before it is
anything more than a reference.

Pipeline finding worth keeping: on this unit the failure classifier's
SPECIFICATION route fired twice and stopped repairs; once it was right for the
wrong reason, once it was wrong. A wrong SPECIFICATION call costs the whole
repair budget, so it deserves the 5.3.2 corpus treatment before it is trusted.

## Panel (2026-09-14, later) — `panel/`

Three rounds. Round 1: five Claude lenses (artist/sonnet, pipeline TD/opus,
indie/haiku, architect/opus, sceptic/sonnet; the two fable seats failed on
usage credits), 33 ideas, discussion, ten candidates × three sceptical
verifiers → `claude-panel-report.md`. Round 2: local models on Louis's
hardware — `local-*.json` (Apple FM 9.5 s / 3 ideas; PC Qwen3-Coder-Next 80B
62 s / 5; Bionic qwen3.8-27b empty on attempt 1 (3,499 reasoning tokens, no
content), 5 ideas on attempt 2 with thinking disabled; OpenCode big-pickle
hung twice, absent). Round 3: late product/opus and AI-native/sonnet lenses,
three returning lenses discussing, fifteen candidates verified →
`combined-panel-report.md`. Headline across all rounds: no idea passed all
three verifiers; the closest converge on one artefact — a sidecar written by
a closed reader with the environment in the identity — which the verifiers
call the only defensible part and orthogonal to the queue and the tile loop.
Six questions for Louis are at the end of the combined report. 97 agents,
~7.3M subagent tokens.

## After the panel (2026-09-14, later) — what was completed autonomously

- `unit-03-closure/` — tile loop with a shared journal: identity without
  attempt, tombstones on reopen, cross-job replay, decoy resave, partial
  change. PC-worker draft passed 15/15 owner tests first try; 5/5 mutants
  caught. Panel experiment 1, done as a reference model.
- Private tree: `nisi-render-tile-v1` revised (attempt removed from identity,
  pins recomputed, mutants re-run, handoff revision 2); new work order
  `nisi-render-receipt-v1` (closed reader + digest for per-check receipts,
  PC-worker draft + one integrator repair, 13/13, structural PASS, 6/7 mutants
  caught + 1 equivalent, handoff written). An adversarial Claude review of
  render-tile-v1 was launched (record lands in its evidence/ folder).
- `experiments/EXPERIMENT-LOG.md` — E1 done as reference; E2 step zero
  measured (Unity 6000.4.10f1 installed, URP 17.4.0 project, no Recorder, no
  Unreal); E3 not run.
- `unit-04-exr-gate/` — contract + owner tests with a minimal EXR writer
  fixture (NONE/ZIPS/ZIP, half/float/uint). PC-worker draft passed 3/14 as
  received (header walk, chunk layout, flag test and result shape were wrong);
  integrator rewrote those four parts; `exr_gate_reference.py` 14/14, 8/8
  mutants caught. Synthetic frames only — no real Recorder/MRQ file read yet.
- DECISIONS.md R–T added (identity without attempt; lease = frame chunk;
  receipt carries per-check records).

## Adversarial reviews of the two Node work orders (2026-09-14, latest)

Both `nisi-render-tile-v1` (107 agents) and `nisi-render-receipt-v1` (65
agents) came back **REJECT**, and the findings were real. The shared root
causes: (1) the readers accepted values the canonical-json-v1 codec cannot
digest — floats, unsafe integers, lone surrogates, non-NFC/NUL keys, unbounded
depth — so identity/digest could throw a foreign error for an accepted
input; (2) validate-then-copy re-read the input and called its array methods,
so getters, Proxies, Array subclasses and Symbol.species could throw or
smuggle content; (3) **my structural-check evidence was false** — the tree's
`scripts/structural-check.mjs` hardcodes the codec as its subject and ignores
argv, so the PASS files I had recorded described `canonical-json-v1.mjs`, not
the modules; a true run would have failed both on the `export {}` block
inside the pure region.

Fixed in place (both): a single descriptor-walk snapshot before validation
(accessors, non-enumerables, symbols, exotic arrays, cycles, depth and node
budget → NOT_OBJECT at `$`); params/measures restricted to the codec grammar;
every accepted fixture now digested and re-read in the oracles; exports moved
outside the pure region; the checker run through a parametrised copy kept
outside the tree, with `sourceDigest` now matching each module. Tile oracle
16/16 with 16/16 mutants caught; receipt 15/15 with 13/13. Contracts and
handoffs revised; a re-review workflow is running. Nothing integrated.

Lesson recorded in memory: never cite a checker's output as evidence for a
file without confirming the checker's subject — the `sourceDigest` in its
report is the check.

## Re-review round (2026-09-14, closing)

Tile: REJECT again — one blocker of the same family survived (unbounded
`JSON.stringify` on the snapshot; DAG-amplified payload; near-max strings at
`normalize` and path build). Receipt: ACCEPT_WITH_DEFECTS (visited mark never
released; ordering under-pinned; getters root-only). Both fixed: payload
budget + key cap in the snapshot, running byte estimate in params
validation, path-stack release; oracles now 19 and 16 tests with exact
boundary pins; mutants 24/24 caught on each; structural evidence
regenerated with matching digests; handoffs at revision 4 (tile) and 3
(receipt). A third review round was not run — the two remaining review items
are integration-scoped (the in-tree checker's hardcoded subject; landing the
files) and belong to Louis or Codex.
