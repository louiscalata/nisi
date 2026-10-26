---
packet: nisi-render-tile-loop-hardening-review
project_root: ~/nisi-next-private/work-orders/nisi-render-tile-loop-v1
created_by: codex
created: 2026-09-17T11:44:00-07:00
write_owner: opencode
status: executing
---

# nisi-render-tile-loop-v1 — independent hardening review

## Context

`handoff-claude-20260915/HANDOFF.md` in this directory closes with "**Next
steps (for Louis's decision):** 1. Review the draft (OpenCode packet or delegate
review)" and records the draft's own status as UNCERTIFIED with no structural
gate, no model review and no mutation scan. This packet produces exactly that
review package, following the pattern already retained at
`../../../work-orders/nisi-render-tile-v1-review-opencode/` (its `evidence/`
holds a purity scan, an adversarial probe, mutation copies and a findings file).

Read-only inputs you must not edit: `CONTRACT.md`, `src/render-tile-loop-v1.mjs`
(the draft under review), `tests/render-tile-loop-v1.test.mjs` (the protected
24-test oracle), and everything under `handoff-claude-20260915/`. Independence
is the point: the hardening oracle you write must be its own reading of
`CONTRACT.md` and the Python-faithful behaviour list in the handoff — it must
not be produced by copying the draft's code or the protected oracle's cases.

This is a review, not an integration: nothing here is promoted into the Nisi
product, and the draft is not modified. No installs, no network, no model
calls, no commits, no writes outside this directory.

## Items

### P1 — Write the hardening oracle and the package manifest
- **files**: package.json, tests/hardening-v1.test.mjs
- **do**: Create `package.json` (new file) with `"type": "module"`, `"private": true` and scripts `"test:hardening": "node --test tests/hardening-v1.test.mjs"`, `"test:purity": "node evidence/purity-scan.mjs"`, `"test:record": "node --test tests/review-record.test.mjs"`. Create `tests/hardening-v1.test.mjs` (new file): an independent oracle over the draft's exported API that exercises, at minimum, the state machine `open → rendered → promoted` with `quarantined` terminal, `add` validating neighbours and children before mutation and rejecting self-reference, `render` replay refusal and parent `source === 'assemble'`, `verify` recomputing the apron map and reporting `APRON_STALE` with no attempt spend, `reopen` writing a `null` tombstone that blocks replay until re-verification, the upward-only cascade leaving children, siblings and `attempt` untouched, identity excluding `attempt`, the constructor ceilings for attempts and reopens, shared-journal behaviour across two loop instances, and the Python-faithful queries (`done()` true on an empty loop, `height()` excluding promoted tiles, `lastCode` null after render and `'PASS'` after promote). Every case must be written from the contract, not read off the implementation; where the contract does not decide a behaviour, record it as an open question in `REVIEW.md` instead of asserting it.
- **accept**: npm run test:hardening

### P2 — Purity scan and mutation probe
- **files**: evidence/purity-scan.mjs, evidence/mut-M1.mjs, package.json
- **do**: Create `evidence/purity-scan.mjs` (new file): a deterministic, dependency-free scan that fails closed on any of `fetch`, `net`, `http`, `https`, `tls`, `dgram`, `child_process`, `worker_threads`, `require`, `eval`, `process.exit`, `process.env` reads or non-literal dynamic `import` in `src/render-tile-loop-v1.mjs`, and prints the exact offending line for each; it must exit nonzero on a finding and zero on a clean scan. Create `evidence/mut-M1.mjs` (new file): a byte-copy of the draft with exactly one documented semantic mutation in the identity or apron computation, for use as a negative control. The scan must reject `mut-M1.mjs` at the mutation and accept the unmodified draft. Record both observed results, with the mutation named, for `REVIEW.md`.
- **accept**: npm run test:purity
- **needs**: P1

### P3 — File the review record
- **files**: REVIEW.md, tests/review-record.test.mjs
- **do**: Create `REVIEW.md` (new file) with: the exact files and SHA256 of everything read and produced; the deterministic commands run with their observed counts; the mutation result; every open question the contract did not decide; a findings list where each finding names the file and line, the contract sentence it violates, a one-line fix, and a severity; and an explicit statement that the gate scan supplies no verdict for `.mjs` candidates so this order stays UNCERTIFIED at the Chami level. Create `tests/review-record.test.mjs` (new file) asserting `REVIEW.md` exists, contains all the sections above, carries at least one SHA256 per read input, ends with a dated `REVIEW COMPLETE` line, and that `evidence/purity-scan.mjs` and `src/render-tile-loop-v1.mjs` are byte-identical to the hashes recorded for them.
- **accept**: npm run test:record
- **needs**: P2

## Packet acceptance

node --check src/render-tile-loop-v1.mjs
