# Restart demo + journal recovery integration — 2026-09-14

**INTEGRATED.** The two U02-04 demonstration work orders
(`work-orders/bundle-restart-demo`, `work-orders/journal-restart-recovery`) now run
inside the product suite against the live `history/` modules. Authorization: Louis's
takeover directive (Claude co-author) and the OpenCode handoff O4. OpenCode (app
session) produced the rehearsal under each work order's `integration/` (byte-identical
scratch copies of the product modules, 12/12 and 17/17); Claude's adversarial review of
that rehearsal (`../o4-migration-review.md`, workflow wf_26076001-0dd) fixed the
placement, and Claude installed from the work-order ORIGINALS, not from `integration/`.

## Placement (source → product)

| Source | Product path | Edit |
|---|---|---|
| `bundle-restart-demo/src/bundle-restart-demo.mjs` | `history/bundle-restart-demo.mjs` | one import: `../frozen/host-journal-bundle.mjs` → `./host-journal-bundle.mjs` |
| `journal-restart-recovery/src/recovery-worker.mjs` | `history/recovery-worker.mjs` | two imports: `../frozen/run-journal{,-store}-v1.mjs` → `./…` |
| `bundle-restart-demo/fixtures/demo-cli.mjs` | `tests/fixtures/bundle-restart-demo-cli.mjs` | one import |
| `journal-restart-recovery/fixtures/worker-cli.mjs` | `tests/fixtures/journal-restart-recovery-cli.mjs` | one import |
| `*/package.json` | `tests/fixtures/<work-order>-package.json` | copied |
| `bundle-restart-demo/fixtures/summary-*.json` | already present at `tests/fixtures/fixed-run/` (identical hashes) | not copied |
| `bundle-restart-demo/tests/baseline.test.mjs` | `tests/bundle-restart-demo-baseline.test.mjs` | paths; four frozen-copy pins on product modules dropped, never re-pinned |
| `bundle-restart-demo/tests/demo.test.mjs` | `tests/bundle-restart-demo.test.mjs` | paths + two deliberate additions (below) |
| `journal-restart-recovery/tests/baseline.test.mjs` | `tests/journal-restart-recovery-baseline.test.mjs` | paths; two pins dropped; the then-empty pin-only test and its unused hash helper removed (2 tests → 1) |
| `journal-restart-recovery/tests/recovery.test.mjs` | `tests/journal-restart-recovery.test.mjs` | paths + cleanup hook |
| `journal-restart-recovery/tests/owner-boundaries.test.mjs` | `tests/journal-restart-recovery-boundaries.test.mjs` | paths + cleanup hook |

Depth-one placement under `history/` is forced by the modules: each derives its owned
root as `<parent of module dir>/.scratch` and the demo test's "outside" probe reads
`<parent of .scratch>/package.json`; every depth-two placement fails 8/9 (ENOENT).
So the owned root is `<repo>/.scratch/`, now gitignored (`.scratch/`).

## Deliberate non-path edits (all marked "Product-suite addition" in the files)

1. **Temp-directory cleanup.** The protected tests never removed their `mkdtemp`
   directories (one work order carried 300+ stale dirs). The three tests that create
   them now collect and `rmSync` them in an `after` hook, after all assertions (some
   compare mtimes). Residue after a full suite run: 0.
2. **Boundary probes (review finding B5).** Widening the demo module's `.scratch`
   boundary survived the original oracle because every "outside" probe was refused by
   an earlier check. Two probes with a well-formed name whose parent is a real
   directory outside `.scratch`, plus a no-write assertion, were added. Proven in a
   scratch tree: pristine 9/9, boundary-widened mutant 8/9.
3. Pins dropped only; no title changes; trailing newlines preserved (OpenCode's
   rehearsal files had lost theirs and carried a new layout-specific assertion; neither
   was installed).

## Verification

| Check | Result |
|---|---|
| Five installed suites | 28/28 (bundle 3 + 9, journal 1 + 10 + 5) |
| Full suite before / after | 1721/1721 → **1749/1749**, 0 fail/cancelled/skipped/todo |
| `npm run check:structural` | PASS, 8/8 mutations caught, 0 findings |
| `.scratch` residue after full run | 0 directories |
| `history/` product modules | unchanged (the four pinned by `tests/host-journal-bundle-baseline.test.mjs` still match) |
| `package.json` `files` | unaffected (explicit allowlist; nothing under `history/` or `tests/`) |

Hashes: `SHA256SUMS` beside this file.

Not claimed: power-loss durability, cross-process locking, hostile-directory safety,
NX-05 or U02-04 closure. Process-restart persistence is what these suites prove.
- Attributed: the three same-window writes to tests/ flagged by the review (native-incident-source, experimental-module-registry-containment, nisi-native-overlay) are Claude's own lanes, not the migration.
