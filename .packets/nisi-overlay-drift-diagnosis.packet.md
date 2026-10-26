---
packet: nisi-overlay-drift-diagnosis
project_root: ~/nisi
created_by: codex
created: 2026-09-17T12:05:00-07:00
write_owner: opencode
status: blocked
---

# nisi — frozen-import overlay drift: read-only diagnosis

## Context

After the authorized `npm install` on 2026-09-17, the full suite is
1782 total / 1780 pass / **2 fail**, and both failures are inside the single file
`tests/nisi-native-overlay.test.mjs` (6 pass, 2 fail at assertion sites `:122`,
`:130`, `:138`, `:156`). `tests/veritas-import.test.mjs` is 13/13 green. The
measured baseline is recorded in
`docs/verification/known-red-baseline-2026-09-17.md`.

This packet is **diagnosis only and strictly read-only with respect to the
subject**: it must NOT edit `tests/nisi-native-overlay.test.mjs`, must NOT edit
`tests/veritas-import.test.mjs`, and must NOT create, delete, restore or build
anything under `native/macos/CodenameVeritasFramework` or any `integrations/`
path. A prior incident makes writes under the frozen Veritas import forbidden;
this packet exists precisely so a human can decide the change instead of an
agent applying one.

Observed symptom, for the record only: a `deepStrictEqual` reports
`actual: []` against
`expected: ['native/macos/CodenameVeritasFramework/.build']`, i.e. the set the
code derives no longer contains the stale SwiftPM build directory that the
expectation still names. Whether the expectation is stale or the tree lost an
entry it is supposed to carry is **unknown**, and this packet must not pretend
otherwise.

Tool constraint: the packet agent has no shell. Gather evidence only with file
tools (Read, Grep, Glob). Do not attempt `git`, `mkdir`, `find`, `swift`,
`npm install`, network calls or mount commands — if the deciding evidence
appears to live only in Git history, the correct outcome is an explicit
`UNKNOWN` that names the exact missing evidence, not a guess.

Claim ceiling: a cited evidence record plus a recommendation. No repair is
applied, no verdict of correctness is issued, and nothing is certified.

This repository carries the user's pre-existing dirty state; append-only edits
only, never revert, clean, stage or bulk-format. No installs, no commits.

## Items

### P1 — Record the drift evidence
- **files**: docs/verification/overlay-drift-diagnosis-2026-09-17.md, tests/overlay-diagnosis.test.mjs, package.json
- **do**: Record the SHA256 of `tests/nisi-native-overlay.test.mjs` and of `tests/veritas-import.test.mjs` as constants before any other action, so the test you add can prove neither file was touched. Create `docs/verification/overlay-drift-diagnosis-2026-09-17.md` containing these exact H2 sections in this order: `## Observed`, `## Evidence`, `## Classification`, `## Recommended change`, `## Decision needed`. In `## Observed`, quote the four assertion sites and the exact `actual`/`expected` values, or state plainly which of them you could not reproduce by reading. In `## Evidence`, cite every claim as `path:line` and include the code that builds the compared set, the manifest or fixture the expectation is derived from, and every file in the tree that still mentions the `.build` entry, plus the outcome of a Glob for `.build` under `native/macos/CodenameVeritasFramework`. Create `tests/overlay-diagnosis.test.mjs` (new file) asserting the document exists, that all five H2 sections are present in order, and that both subject files still match the recorded SHA256 constants. Add script `"test:overlay-diagnosis": "node --test tests/overlay-diagnosis.test.mjs"` to `package.json`, adding only that key. Do not create the `.build` directory.
- **accept**: npm run test:overlay-diagnosis

### P2 — Classify and recommend without applying
- **files**: docs/verification/overlay-drift-diagnosis-2026-09-17.md, scripts/overlay-drift-report.mjs, package.json
- **do**: In `## Classification`, state exactly one of `TEST_EXPECTATION_STALE`, `TREE_MISSING_REQUIRED_ENTRY`, or `UNKNOWN`, followed by the specific evidence that decided it and, for `UNKNOWN`, the exact artifact or record that would decide it. In `## Recommended change`, give the single minimal change as a quoted diff-style block naming exact paths and line numbers, and state explicitly that it is not applied. In `## Decision needed`, name the specific human judgement required. Create `scripts/overlay-drift-report.mjs` (new file): a dependency-free deterministic check that reads the document and fails nonzero unless exactly one classification is present, unless the recommended block names a path that exists in the tree, and unless every `path:line` citation inside `## Evidence` resolves to an existing file. It must print `gatesExecuted: 0` and must not execute the subject test. Add script `"test:overlay-drift-report": "node scripts/overlay-drift-report.mjs"` to `package.json`, adding only that key.
- **accept**: npm run test:overlay-drift-report
- **needs**: P1

## Packet acceptance

npm run test:types
