# Nisi Render Engine design panel — report

Five lenses (working artist, studio pipeline TD, solo indie dev, systems architect, sceptic) produced 33 ideas; each picked a top 3, rebutted 2, and merged one. Ten candidates then went to three sceptical verifiers (desirability, feasibility on this design, differentiation).

**The headline first, because you will want it plainly: no candidate passed all three verifiers.** The differentiation lens cleared five; desirability and feasibility refuted every one of them, and the refutations are concrete and repeat across ideas. Section 1 therefore ranks the ideas that came closest, with the conditions under which they hold, not ideas that are ready to build. One data note: the desirability verdict on "delivery is a parent tile" came back as a placeholder ("Test", "short reason", strength 2). Treat that idea as having two real verdicts, not three.

## 1. What the panel agreed on

### 1. Per-frame identity and REPLAY (content-addressed frame replay)
*Two authors (architect, TD); four of five panelists converged on it independently. Score 8/7. Differentiation: not refuted (strength 4/3).*

**Pitch.** Resubmit a shot after an edit; every frame whose declared inputs are unchanged promotes from the journal as REPLAY, only the rest render. Deadline, OpenCue and MRQ's own queue key on job id or the range you type; none can say which frames are stale.
**Who benefits.** Anyone re-rendering long sequences where a shared asset's blast radius is unknown; at farm scale, the wrangler.
**Why this design.** Tile identity = digest(inputs, recipe, apron, attempt); a journaled identity replays without a lease. It is the identity primitive, not a bolt-on cache.
**Release.** Pitched as 1. Feasibility verifiers say release 2 or later as a per-engine evaluator project.
**Condition.** Both feasibility verdicts agree on the blockers: (a) the plugin must hash per-frame *evaluated* state (Sequencer sections and keys within the evaluation window, bound-object values at frame N), not package hashes — an edited curve or a moved light re-saves the level/sequence package and invalidates every frame, so the headline example yields zero replays; (b) under Lumen an off-screen material edit changes GI in frames the object never appears in, so a finer closure is unsound; (c) temporal state (TSR history, Niagara, Chaos, streaming) makes an isolated re-render of frames 120-160 diverge from its neighbours at 119|120 and 160|161 with a clean receipt; (d) the reference journal keeps a vetoed attempt-0 identity, so a cross-job resubmit can replay vetoed bytes; (e) Metal-vs-D3D12 output differs, so replay is environment-pinned, contradicting decision O's block-independence; (f) nothing in the design computes the closure at all. Desirability: a false REPLAY ships a stale frame to a client, which is worse than the GPU-hours saved, and the target artist already types a frame range.
**Dissent.** The TD and sceptic rebutted the sceptic's own "ripple-safe resubmission" as the same idea with the wrong mechanism (apron instead of input closure). The indie's rebuttal that the solo dev "already knows what changed" was countered by the architect: nobody can enumerate which frames reference a material instance three levels down.

### 2. Pass rows as the QC gate: a shot is never delivered half-rendered
*TD. 3 votes. Score 6. All three lenses refuted (strength 2 each).*

**Pitch.** frame = shot, row = pass, cell = (pass, frame). A pass row clears only by a closed EXR reader with exact codes (NAN, MISSING_CHANNEL, BLACK_FRAME, FLICKER) plus an Accept by someone who is not the submitter; the beauty/composite cannot assemble until every pass row is promoted.
**Who benefits.** Comp leads; the artist who submits at 18:00 and leaves.
**Why this design.** The nesting rule (parent verified only once every child is promoted) makes partial delivery structurally impossible, not a checklist item. Every studio runs a frame-checker script; none has a row that must clear before a parent exists.
**Release.** 1 as pitched; the brief puts the row line check in release 2.
**Condition.** Feasibility: MRG and Recorder emit all passes from one render, so "re-render only the depth cell of frame 1017" is either a different recipe or a full re-render, and a fresh depth against an old beauty is itself a comp defect (stochastic sample sets must match). Rewrite as: the frame (all passes, one lease) is the render and reopen unit; passes promote together as one row; FLICKER moves to a row-level verdict; expiry is per-recipe, not the 900 s lane cap; a provenance-recorded human override ("eat") with a named authoriser exists; self-accept is allowed and flagged for solo users. Desirability: only for teams rendering through MRG/Recorder as the delivery path, with no sunk Deadline/OpenCue investment and at least two people.

### 3. The delivery is a parent tile: a movie assembled only from promoted frames
*Architect. 3 votes. Score 6. Feasibility and differentiation refuted; desirability verdict is a placeholder.*

**Pitch.** The encode is a parent whose identity is digest(children outputs); refused until every frame is promoted; re-encoded iff a frame changed; sidecar lists every frame's digest, attempt, reviewer. Unity Recorder writes video during capture with no gate; MRG's encoder encodes whatever is on disk.
**Who benefits.** Whoever sends a version number to a client.
**Why this design.** The nesting rule at the top scale, verified in unit-02 (parent render refused until every child PROMOTED; 14 owner tests pass).
**Release.** 1.
**Condition.** Narrow the claim to "contains only frames promoted from a single submission snapshot, with a sidecar; an unchanged resubmit replays the encode." Drop "current scene state" (no engine gives a scene-state digest). Keep intermediates lossless so the container check can demux-and-digest; for ProRes/MP4 the sidecar is the truth. The assembly must become a leased encoder job with its own reviewer, which the pure-function reference does not have. Verifiers' honest summary: delivered by the Nisi queue's durability, a small demonstration of the gate, not evidence for the tile loop.

### 4. Two-machine overnight farm, below the Deadline/OpenCue floor
*Sceptic. 1 vote. Score 6. Differentiation not refuted (strength 2).*

**Pitch.** A Mac and one PC with no Cuebot, no Postgres, no seats: durable resume after a crash with no duplicated or dropped frame.
**Who benefits.** 1-3 person teams who have not decided to run a farm.
**Why this design.** Leases, expiry recovery, late-result rejection, atomic promotion — inherited from the predecessor engine and, the sceptic says plainly, table stakes at scale but unavailable below the floor.
**Release.** 1.
**Condition.** The brief's release-1 core is an embedded Node host, i.e. a daemon, for the persona least willing to run one. Splitting one sequence across Metal and D3D12 gives visibly inconsistent frames, so jobs must be pinned to one machine; the reference's crash posture is RENDER_INTERRUPTED_RETRY_REQUIRED (manual retry) and sleep/wake evidence is unavailable. Deadline has had no per-node fee since 2020, so the gap evidence is stale. Holds as a single-machine "trustworthy resume" tool that any engine could build; the tile loop contributes nothing to it.

## 2. Ideas that did not survive, and why

- **One bucket-grid Watch panel** (artist). Desirability and differentiation: for release 1 it is Deadline Monitor / Cuetopia embedded in an editor window; the row scale does not exist for engine renders and "converging" has no meaning for a binary render. Feasibility: with containment fail-closed the renderer is the editor process, so the farm zoom shows one or two blades.
- **The Watch Panel as the only Accept button** (artist, merged). Feasibility: the core has no user identity; author != reviewer applies to the worker source, so "submitted by you" can never be produced, and a check in Fab/UPM-distributed source is editable by the person it refuses. Desirability: a hard wall for the solo lead, redundant for studios already on ShotGrid/ftrack.
- **Local cooperative Mac+PC SoC render** (indie). Rebutted by artist and architect: an engine frame cannot be split across blocks (XPU rule); Metal and D3D12 are not the same build. Release-2 model lanes only.
- **Multi-platform console certification** (indie). TD and sceptic: category error; cert covers the runtime build, and per-platform checkers contradict "verify once".
- **Verified promotion into version control** (indie). Artist: rendered deliverables live in trackers, not git.
- **Ripple-safe resubmission** (sceptic). TD and architect: the apron never fires across shots; input-closure identity does this job and is already idea 1.
- **Confidence-driven previz fill, gap-fill turntable angles, engine passes as ground-truth rows** (release 2 generative). Sceptic: no image lane, no chosen validity metric; confidence collapses to cross-model disagreement alone, which DECISIONS.md forbids.
- **Author-never-reviews as a sellable policy** (sceptic). Indie: the reviewer is still a model grading a model; advisory, not verdict-bearing.
- **Pass export is not a reason to install anything** (sceptic). Not refuted; accepted by the architect's merge. It is a caution, not a feature.

## 3. Merged ideas worth a second look

- **Shot-as-tile release 1** (architect; score 8, differentiation strength 4). The most complete restatement: cell under input-closure identity, row cleared by closed reader, delivery as parent, morning report as the well state. The feasibility verifier's rewrite is worth adopting wholesale: cell = (MRG render layer, whole shot); identity from a deliberately over-inclusive closure hashed from the files the render actually opened (an fs-usage trace of UnrealEditor-Cmd), so REPLAY is claimed only for a wholly untouched shot on the same machine class; pitch becomes "untouched shots never re-render, nothing with NaN/black/missing channels ships, the sidecar proves it."
- **Shot ledger to tracker version** (TD; score 7). Same tree plus a tracker version whose sidecar diff names replayed vs re-rendered frames. Verifier: derive the per-frame diff from output pixel digests (what did change), not input closure (what should change), and note that a household user has no tracker.
- **Below-the-floor shot kit** (sceptic). Its experiment check (1) is unfalsifiable as written: REPLAY returns the journaled digest by construction. Keep the framing, replace the check.

## 4. Where the models disagreed

One panel per tier, so read this as a pattern, not a finding. The two opus lenses (TD, architect) wrote mechanism-level ideas naming concrete engine APIs, the exact failure mode, and which half was table stakes; they also wrote the sharpest rebuttals and received the most votes. The sonnet lenses (artist, sceptic) contributed workflow, market and positioning framing — the two most useful cautions on the board (pass export is not a feature; the only certified artefact is a code gate) came from the sceptic. The haiku lens (indie) produced the ideas that drew rebuttals for category errors (git for renders, console cert, splitting an engine frame across GPUs). Across tiers, every panelist over-estimated what the input closure can deliver; the verifiers, not the panel, found the Lumen and temporal-coupling problems.

## 5. First experiments

1. **Closure soundness, no engine.** Extend unit-02 with a stub executor whose "inputs" are a synthetic per-frame closure. Fix the cross-job hole first (drop `attempt` from identity, add a supersession tombstone on reopen). Pass: a vetoed attempt-0 identity never replays in a second job; an unchanged resubmit replays 100%. Two days.
2. **Closed reader and row gate, no engine.** Write the ZIP/None-only EXR reader (PIZ is out of scope for a zero-dependency core) and run 200 synthetic frames with injected NaN, missing channel, black frame, plus 20 legitimately dark frames and a fast cut. Pass: exactly the injected cells quarantined with the right code, the assembly refused, zero false positives on the dark frames. Three days.
3. **Temporal isolation cost, real engine.** In whichever engine is installed (verifiers note Unity Hub is present, Unreal is not), render a 48-frame shot once, then re-render frames 10-14 in isolation with the recipe's warm-up count, on the same machine, with GI on. Measure: wall time of the isolated render including editor start vs the full shot, and pixel difference at seams 9|10 and 14|15 against a threshold you pick before running. Pass: isolated cost is under half the full shot AND seams are under threshold. If either fails, "only changed frames render" comes out of release 1's pitch. Under a week.

## 6. Questions only Louis can answer

1. Who is the first paying user: a solo Unreal/Unity user without Deadline, or a studio with one? Every verdict splits on this.
2. Which engine ships first, given Unity is installed on the Mac and Unreal is not?
3. Is release 1 allowed to say "untouched shots never re-render" instead of "only changed frames render"?
4. For a solo user, is "accepted by submitter, recorded in provenance" an acceptable form of the author != reviewer rule?
5. The sceptic's uncomfortable point: the only certified artefact is a code gate. Is a code-review gate for Blueprints/shaders a product you would consider, or is rendering non-negotiable?