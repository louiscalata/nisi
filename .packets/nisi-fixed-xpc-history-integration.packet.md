---
packet: nisi-fixed-xpc-history-integration
project_root: /Users/louiscalata/nisi-next-private
created_by: codex
created: 2026-09-13T16:35:00-07:00
write_owner: opencode
status: done
---

# Nisi fixed-XPC history projector — exact private relocation

## Context

MECHANICAL COPY ONLY. No new logic, design, fix, or review decisions.
Codex/Opus/Daybreak completed and reviewed the isolated pure projector.
27/27 scoped checks pass; six deliberate mutations are detected (1,2,2,2,2,1 failed
checks). Three RETAINED native records project; no new native launch occurred.
Current npm run check passed1230/1230 with213 selected source/test files unchanged.
npm test is the existing real baseline; package scripts/config are protected.
Each destination below is absent and node --check fails until a valid copy exists.
Final syntax/tests are NOT exact-copy proof: Codex separately compares every byte
against the substitutions here. Any difference blocks owner integration acceptance.

The source under work-orders/fixed-xpc-journal-observation is READ ONLY.
Allowed reads ONLY this packet, the five named origin files below and destination
files after creation. No project exploration, prompts, extra tasks or models.
The source may import the existing canonical protocol and journal for runtime/tests.
Those dependencies already match frozen copies; do NOT copy or edit dependencies.

Source code origin:
work-orders/fixed-xpc-journal-observation/src/index.mjs
Expected SHA256 dda78a29edbe8952ac97960a572496ebc18f6be6117bb06e38880dc19e95bca1.
It is145 lines and approved byte-for-byte, with one import-path replacement below.
Do not reformat, optimize, simplify or add commentary. Preserve LF and final newline.

Test origins under work-orders/fixed-xpc-journal-observation/tests/:
- fixtures.mjs (mutable ordinary-JSON synthetic fixture, frozen parser dependency)
- baseline.test.mjs (2 tests)
- observation.test.mjs (20 test groups)
- owner-boundaries.test.mjs (5 tests)
All assertions/fixtures are protected. Only the exact import substitutions below.
Never claim native app, isolation, persistence, incident admission or release acceptance.

## Constraints

- Create only the five listed destination files. No existing product file changes.
- Never change origins, CONTRACT.md, tests outside these new copies, package.json,
  package-lock.json, roadmap.md, README, .packets, .packet-diagnostics or config.
- Claude owns host-journal-bundle correction; DO NOT inspect/edit that lane.
- Windows queue is independently owned; DO NOT inspect/edit it.
- No shell/test execution, nested packet, receipt-writing tool, install, auth,
  security/service/model changes, network calls, commit, checkpoint or publication.
- The wrapper owns tests and receipt. Do not call it yourself.
- Source is private and experimental; canonical relocation does not wire any
  native runner, journal storage or failure-eligibility consumer.

## Items

### P1 — Copy the reviewed pure projector
- **files**: history/fixed-xpc-journal-observation-v1.mjs
- **do**: Copy work-orders/fixed-xpc-journal-observation/src/index.mjs verbatim, replacing exactly the single string '../frozen/protocol.mjs' with '../hosts/macos-xpc/protocol.mjs'. No other byte changes.
- **accept**: node --check history/fixed-xpc-journal-observation-v1.mjs

### P2 — Copy the faithful fixture
- **files**: tests/fixtures/fixed-xpc-journal-observation.mjs
- **do**: Copy work-orders/fixed-xpc-journal-observation/tests/fixtures.mjs verbatim, replacing exactly '../frozen/protocol.mjs' with '../../hosts/macos-xpc/protocol.mjs'. No other byte changes.
- **accept**: node --check tests/fixtures/fixed-xpc-journal-observation.mjs
- **needs**: P1

### P3 — Relocate two baseline tests
- **files**: tests/fixed-xpc-journal-observation-baseline.test.mjs
- **do**: Copy work-orders/fixed-xpc-journal-observation/tests/baseline.test.mjs verbatim. Replace '../src/index.mjs' with '../history/fixed-xpc-journal-observation-v1.mjs' and '../frozen/run-journal-v1.mjs' with '../history/run-journal-v1.mjs'. No other byte changes.
- **accept**: node --check tests/fixed-xpc-journal-observation-baseline.test.mjs
- **needs**: P1

### P4 — Relocate twenty observation test groups
- **files**: tests/fixed-xpc-journal-observation.test.mjs
- **do**: Copy work-orders/fixed-xpc-journal-observation/tests/observation.test.mjs verbatim. Replace '../src/index.mjs' with '../history/fixed-xpc-journal-observation-v1.mjs'; '../frozen/protocol.mjs' with '../hosts/macos-xpc/protocol.mjs'; '../frozen/run-journal-v1.mjs' with '../history/run-journal-v1.mjs'; './fixtures.mjs' with './fixtures/fixed-xpc-journal-observation.mjs'. No other changes.
- **accept**: node --check tests/fixed-xpc-journal-observation.test.mjs
- **needs**: P1, P2

### P5 — Relocate five owner-boundary tests
- **files**: tests/fixed-xpc-journal-observation-boundaries.test.mjs
- **do**: Copy work-orders/fixed-xpc-journal-observation/tests/owner-boundaries.test.mjs verbatim. Replace '../src/index.mjs' with '../history/fixed-xpc-journal-observation-v1.mjs'; './fixtures.mjs' with './fixtures/fixed-xpc-journal-observation.mjs'. No other changes.
- **accept**: node --check tests/fixed-xpc-journal-observation-boundaries.test.mjs
- **needs**: P1, P2

## Packet acceptance
npm test

