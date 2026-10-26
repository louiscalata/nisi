# Nisi Render Engine — working spec (v0.2, 2026-09-14)

v0.2: the tile loop (one shape, three scales) supersedes the two-gate
formulation; product is Nisi's, released as Unreal and Unity plugins (see the
product brief in the private tree).

v0.1: re-based onto the Nisi Render Engine (the reference Louis named) and
added the virtual-SoC capability. Sections marked v0 are the original sketch;
where they conflict with the engine's vocabulary, the engine's wins.

Vocabulary is the production render engine's, because its visualisation
conventions already exist: passes, denoiser, buckets, farm, compositor.

## State

Everything the engine knows is a cell in the tensor (layer × tile × iteration).
A cell carries: output, source (which model/node), confidence, provenance hash,
assigned resource. A **processing node** is one (layer, tile, iteration) job;
its ID is the hash of its inputs, so unchanged inputs are cache hits.

Views are projections: layer × tile = bucket grid (who is on which cell now);
resource × time = farm lanes; layer × iteration = convergence strip; the final
frame carries a provenance overlay. The **well** shows only uncleared rows
(scheduler's view; stack height is the health metric); the **frame** shows
committed rows (compositor's view).

## Layers, tiles (decisions B, C)

Rows are aspects, not depth: five mandatory (intent, constraints, interfaces,
implementation, tests) plus up to five task-specific, bottom-up. Depth lives on
the iteration axis. Tiles are symbols (function/class) for code rows, files for
prose rows; tile IDs must be stable across iterations.

## Roles

| role | does | lane (decision L) |
|---|---|---|
| generator | one coarse pass over every row | Mac GPU (Bionic) |
| denoiser | holes and seams inside one row; neighbourhood context only | AFM (on-device) |
| reconciler | conflicts between rows; multi-row context; may veto a cleared row | PC GPU via `chami-dispatch` |
| checker | line check on a full row: validity (deterministic) then quality (tier `verify` model, never the row's author) | local verifier / AFM for triage |

Fillers dispatch adaptively (F3): one denoise pass per tile in iteration 1,
then only cells below the confidence threshold. Confidence is deterministic
first (placeholders, unresolved references, failing tests, gate findings),
cross-model disagreement for rows with no deterministic signal.

## Per-row state machine (unit 1)

`open → full → checking → passed → cleared`, plus `quarantined`.

- open → full: every tile holds a non-hole output (D2).
- full → checking: the engine starts the line check.
- checking → passed: validity and quality both pass; → open on failure, with the
  failed tiles blanked (all tiles if none named).
- passed → cleared: all declared dependencies are cleared (I2). One clear can
  cascade into several — the Tetris multi-line clear.
- cleared/passed → open: reconciler veto (re-open). Named tiles blanked; every
  transitive dependent that was checking/passed/cleared drops to full with its
  content intact. After `max_reopens` (2) the next veto quarantines the row.
- Cleared rows are immutable. Quarantined rows are frozen; the run reports.

v0 said "two gates at two granularities". v0.2 replaces that with one gate
at three scales — see The tile loop. Verdicts still come from deterministic
checks; models only propose (G, H).

## The tile loop (v0.2) — balanced, repeatable, tileable

One shape at three scales. A **tile** is `(inputs by digest, recipe, budget,
apron)`. The only verbs are `render`, `verify`, `promote`; `reopen` is a new
attempt of the same recipe with a reason, not a fourth state. A cell is a tile
with its apron; a row is a tile of cells; a frame is a tile of rows. A parent's
`render` is "assemble the children", allowed only once every child is
promoted — that single nesting rule is the Tetris rule, so bottom-up commit is
a property of the structure, not a policy.

- **Tileable — the apron.** Every cell renders with a margin of its neighbours'
  context (adjacent symbols' signatures for code; a pixel border for images),
  snapshotted at render as the digests of the neighbours' promoted outputs.
  At verify the apron is recomputed; a difference is `APRON_STALE`: the
  candidate is discarded and the cell re-renders with fresh context, without
  spending an attempt. Seams stop being a model's job: the denoiser keeps
  holes, the reconciler keeps cross-layer conflicts.
- **Repeatable — identity.** A tile's identity is the digest of the canonical
  JSON of `{apron, attempt, children outputs, inputs, recipe}`. A promoted
  identity is journaled; rendering any tile whose identity is already in the
  journal promotes it immediately as `REPLAY`. Where generation is not
  deterministic, the verdict and the receipt are. Apron size is a property of
  the recipe, fixed per modality — never derived from the lane, or identity
  would depend on which block rendered the tile. A lane must hold tile + apron
  or it does not get the job.
- **Reopen cascades upward only.** A reopened tile clears its output, bumps its
  attempt, and returns every ancestor to open (they must re-assemble).
  Siblings and children are untouched; a fault located in a child is reopened
  there explicitly. After `max_reopens` the next veto quarantines.
- **One gate.** `verify` is always validity (deterministic checks) then quality
  (an independent reviewer, itself a tile). The reviewer must differ from the
  tile's source — the assembler cannot review its own assembly either.
- **Balanced — the well.** The scheduler's objective is every block's queue
  depth near a target and the stack height falling; filler spend follows
  measured noise, never a fixed ratio (DLSS 4.5's dynamic multiplier is the
  precedent). Any single cell can be re-rendered alone on any block because
  its context is in its inputs, which is what makes SoC placement cheap.

Reference model: `unit-02-tile-loop/` (Python, owner tests). The v0 row state
machine (`unit-01-well/`) is the two-level special case.

Artist surface, identical in both engines: **Submit** (a Movie Render Graph
job, a Recorder job, or a layered job from a selection), **Watch** (one bucket
grid at three zooms: cells in a row, rows in a frame, frames on the farm),
**Accept** (promoted outputs land in the project with a provenance sidecar).

## Scheduler

Capacity vector per resource (memory, tok/s, slots, context cap, cost) vs
demand vector per node (model, context, expected output). Two rules dominate:
model residency (batch by model per phase; never co-load generator and
reconciler on unified memory — moot when split by device) and hard per-node
wall-clock caps with requeue (a hung backend is failed, not slow). Lookahead:
pre-assign lanes for the pieces the generator is about to emit.

## Sandbox

Ring 0 — scheduler, layer store, compositor, provenance ledger; nodes never
touch it. Ring 1 — snapshot k, immutable, what nodes read. Ring 2 — per-node
scratch: token, wall-clock, memory, filesystem and network scope (assigned lane
only). Output enters the store only through the merge gate. Engine reserve:
triage on AFM (a separate device), one Bionic slot for the checker.

Tile size is derived from the smallest lane: 12k-char prompt cap on
`chami-dispatch`, 900 s local lane cap. Layer store on local APFS, never the
share; PC nodes get inputs pushed.

## Stop rule (K)

Done when every row is cleared and one further iteration produced zero
re-opens. Budget exhaustion or a quarantined row ends the run with a partial,
uncertified report that includes the well state.

## Fit with the Nisi Render Engine (v0.1)

Reference checkout: `~/Library/CloudStorage/OneDrive-Personal/Playground Mac/Forged Render Engine` (directory name retired)
(git, one checkpoint commit, ~446 uncommitted paths — active work, Codex is the
write owner; nothing here is written into it). The engine already is the farm:
a durable background render queue for Compositor/Tracker with a coordinator
job-state machine (`draft → accepted → queued → running → verifying → rendered |
failed | cancelled`), an idempotent sequenced worker-event reducer, a SQLite
journal (jobs, attempts, frames, events, outbox), one-frame-per-slot
scheduling, worker enrollment/heartbeats/frame leases with expiry recovery and
late-result rejection, capacity holds that retain uncertain slots instead of
guessing, a coordinator-owned weighted CPU admission budget with one
interactive logical CPU reserved, streamed verification with atomic
no-overwrite promotion, a Tracker outbox, and a fail-closed native-containment
provider catalog (macOS App Sandbox/XPC, Linux namespaces/seccomp/cgroups,
Windows AppContainer/Job Object — all explicitly unavailable until proven).
`forged.code-build@1` is already its first non-render workload.

So the layered generator is a **second non-render workload type**, not a new
engine. Vocabulary map (v0 → engine):

| v0 sketch | engine term | note |
|---|---|---|
| frame (whole output) | job (`RenderJobManifest`) | rows/tiles become manifest fields |
| cell (layer, tile) | frame | one frame per slot, leased |
| processing node | attempt of a frame | lease, expiry, late-result rejection already exist |
| lane / model | worker with a capability | capability preflight rejects incompatible builds |
| merge gate | verification → promotion | promoted output is immutable |
| cleared row | all of the row's frames promoted + row verdict recorded | |
| re-open | new attempt superseding the promoted one | never an overwrite: the journal keeps both |
| engine reserve | interactive CPU reservation in the admission budget | generalise per block (see SoC) |
| ring 0 / snapshot / scratch | journal / job input snapshot / lease-specific staging | |
| sandbox ring 2 | containment provider | fail-closed today |

What is genuinely new, and therefore what to build: (1) the layered job
semantics — rows with a dependency DAG, line checks, clears, re-open cascade,
quarantine — as a reducer above the frame reducer (unit-01 is its reference
model); (2) worker roles with author ≠ reviewer enforced as capabilities;
(3) adaptive fill driven by confidence; (4) the bucket grid on the queue
dashboard. The engine is Node ESM, zero-dependency; unit-01 is a Python
reference certified by the snippet chain and is a spec-by-tests for a JS port
(`src/layered-job-state.js` or similar), not the production file.

## Virtual SoC capability (v0.1)

Louis's requirement: the engine directs the sandboxed environment as if it
were a system-on-chip, for faster processing. Concretely, a SoC is
heterogeneous blocks + a memory hierarchy + a fabric + DMA + power domains +
firmware that places work. Each has a counterpart the engine can own:

| SoC | engine capability | reuses |
|---|---|---|
| compute blocks (P-cores, E-cores, GPU, NPU, remote GPU) | block registry: kind, capacity vector, current residency (loaded model), measured throughput | `hardware-resource-plan` (today `bounded-host-cpu-slot-planning-only`), worker capability preflight |
| memory hierarchy (L1 / L2 / SLC / DRAM) | node scratch / lane-resident cache (loaded model, prompt-prefix or KV cache) / immutable snapshot k, memory-mapped / journal | lease-specific staging, journal |
| fabric (NoC) | link table with measured bandwidth and latency per block pair: in-process, `:1234`, LAN | adaptive bridge transport ranking (broadcast UDP fast path) |
| DMA | prefetch: stage a node's inputs at the target block before dispatch, overlapping with the current node | scheduler lookahead |
| power / clock domains, DVFS | per-block admission budget and adaptive concurrency from measured throughput; interactive reserve per block | host capacity broker, capacity holds, IOKit power fence |
| firmware placement | placement = min(compute + data movement) subject to residency affinity and reserves | coordinator |
| die boundary | the containment provider is the boundary; inside it the engine sets the levers | provider catalog |

The levers per platform (the "manipulate and direct" part), all through the
containment provider: macOS — QoS classes / `taskpolicy` steer work to P or E
clusters, App Sandbox scopes files and network; there is no user-space core
pinning or GPU partitioning, so GPU work is serialised per block. Linux —
cgroup v2 `cpuset`, `cpu.max`, `memory.max`, `io.max` (full control). Windows —
Job Object CPU rate, affinity and memory limits (the renderer Job Object work
already exists). The ANE is reachable only through frameworks, so its block is
AFM.

Where the speed actually comes from: locality (a lane keeps the layer context
resident instead of re-sending it under the 12k-char cap), overlap (PC inputs
staged while the Mac generates), specialisation (AFM at 0.6 s for denoise),
no contention (per-block admission with an interactive reserve prevents the
measured 2026-09-06 case of three sessions sharing one `:1234`), and
cross-device parallelism (Mac GPU + ANE + PC GPU are different devices, so no
co-residency conflict).

Honesty limits: the engine's containment providers are fail-closed and
unavailable today, so "directs the sandbox" is a plan on a base that must not
claim SoC behaviour until a provider proves every control; the PC is a chiplet
behind a slow link, so placement must price the hop; measured throughput, not
configured slots, is the only admissible capacity figure (5.1 §4).

## Build order (v0.2, progress 2026-09-14 late)

1. `well` — row state machine, Python reference + immutable tests (unit-01, done, uncertified).
2. `tile-loop` — nesting, identity, apron, upward cascade, replay, quarantine (unit-02, done as reference); **unit-03** adds the shared journal, identity without attempt, tombstones and cross-job replay (panel experiment 1, done as reference, 15/15, 5/5 mutants caught).
3. Manifest `nisi/render-tile/v1` (done in the private tree: closed reader + identity, 15/15, structural PASS, 6/7 mutants caught + 1 equivalent) and receipt `nisi/render-receipt/v1` (done: closed reader + digest, 13/13, structural PASS, 6/7 caught + 1 equivalent). Both await review and integration.
3b. `exr-gate` — closed EXR scanline reader (NONE/ZIPS/ZIP, half/float/uint) with CHANNEL_MISSING / NAN_PIXELS / BLACK_FRAME per frame and FLICKER per sequence (unit-04, panel experiment 2; Python reference done, 14/14, 8/8 mutants caught, synthetic frames only).
4. JS port of the tile loop as the core's reducer; journal of promoted identities.
5. Block registry + fabric table; placement with prefetch; per-block admission with an interactive reserve.
6. Workers: engine renderer (Unreal Movie Render Graph, Unity Recorder), on-device and local model lanes, deterministic checkers — as capabilities.
7. Plugins: `NisiRenderEngine.uplugin` and `com.nisi.render-engine`, thin clients over the local protocol; one grid, three zooms.

Ownership: the product lives in the Nisi tree (`~/nisi-next-private`, work
order `nisi-render-engine`); this folder produces reference models, tests and
the mapping, and hands off. The Nisi Render Engine stays a reference.
