# Experiments (from the panel's list) — log

## E1 · Closure soundness, no engine — DONE as a reference model (2026-09-14)

`unit-03-closure/`: the tile loop with a shared journal. Identity excludes
`attempt`; `reopen` writes a tombstone for the tile's identity; a tombstoned
identity never replays until it is verified again; an unchanged resubmit
replays a whole shot; a partial change re-renders only the touched tiles and
their ancestors; a package re-saved with unchanged content digests replays.
PC-worker draft (Qwen3-Coder-Next 80B) passed the 15 owner tests first try; five
deliberate mutants all caught (attempt back in identity, no tombstone, replay
ignoring tombstones, journal not shared, cascade clearing the journal). The
same rule was applied to `nisi/render-tile/v1` in the private tree (identity
without attempt; mutant M7 "identity includes attempt" now caught).
Not done: a stub executor over real files. The `inputs` dict is the closure
abstraction; hashing what an engine actually opened is engine work.

## E2 · Closed reader and row gate — step zero measured; reader built as a reference

`unit-04-exr-gate/exr_gate_reference.py`: scanline EXR reader for NONE/ZIPS/ZIP
(half/float/uint), eleven structural refusal codes, and the checks
CHANNEL_MISSING → NAN_PIXELS → BLACK_FRAME per frame and FLICKER per sequence,
thresholds as parameters (a fade-to-black is not flicker; a dark frame passes
unless the recipe says otherwise). 14/14 owner tests, 8/8 mutants caught. The
PC-worker draft passed 3/14 as received; four parts rewritten by the integrator.
Synthetic frames only: the tests carry their own EXR writer. Not yet run on a
file from Recorder or MRQ — that needs E2 step zero below.

Measured on this Mac 2026-09-14: Unity `6000.4.10f1` is installed
(`/Applications/Unity/Hub/Editor`); the only Unity project (`~/My project`) is
URP `17.4.0` (`com.unity.render-pipelines.universal`), pinned to
6000.4.10f1, with **no Recorder package** in its manifest and no
`Library/PackageCache` at all (never imported). No Unreal install found
(`/Users/Shared/Epic Games`, `/Applications/Epic*` absent).
Consequence: the panel's statement that Recorder 5.1.6 defaults to JPEG and
writes Zip float32 EXR only on opt-in, and that MRQ's EXR node defaults to
PIZ, remains a panel claim — nothing on this machine can confirm it. Step
zero of E2 therefore is: install Recorder into the URP project and record a
default sequence, before choosing ZIP-only versus a PIZ decoder.
The receipt schema the panel asked for (`{checkId, measured, threshold,
scope}` per check) is now `nisi/render-receipt/v1` in the private tree.

## E3 · Run-to-run drift, then temporal isolation — NOT RUN

Needs a Unity batch render of a 48-frame shot twice from the same commit,
temporal off then on, with Recorder installed. Blocked on E2 step zero and on
Louis's engine-first answer. Nothing claimed.
