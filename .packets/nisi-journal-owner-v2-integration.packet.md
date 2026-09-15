---
packet: nisi-journal-owner-v2-integration
project_root: /Users/louiscalata/nisi-next-private
created_by: codex
created: 2026-09-13T17:48:00-07:00
write_owner: opencode
status: blocked
---

# Private journal owner v2 — exact reviewed relocation

## Context

MECHANICAL COPY ONLY. All design and implementation decisions are fixed.
The isolated work-orders/journal-owner-v2 module passed 56/56 checks and caught
nine deliberate defects. Its owner source SHA256 is
54777f65338a36ca6c208fc880c8ca4013ffce675c7aede2afdc2d8fa85f4e49.
It uses the existing unchanged history/run-journal-v1.mjs and
history/run-journal-store-v1.mjs. Do not edit or copy these dependencies.

Create only eight new files below. Only read this packet, the eight named origins,
and the eight named destinations. No other repository exploration. Do not change
assertions, hash literals, comments, formatting, line endings or final newlines.
Preserve LF. Apply each literal import/URL substitution at EVERY occurrence;
do not modify strings not explicitly listed. No code generation or optimization.

All destinations are absent. Each item syntax check fails before creation.
The packet baseline is git diff --check; it passes before this packet. It is only
a whitespace check, not correctness evidence. Codex owns exact byte comparison
and the full deterministic behavior test run AFTER the generated files are read
and compared. Do not run tests or claim integration acceptance yourself.

## Constraints

- Do not edit ANY existing source, test, helper, package, lock, config or documentation.
- The old host-journal-bundle API is NOT being replaced or silently migrated.
- work-orders/journal-owner-v2 is read-only; Claude and Windows work is protected.
- No shell commands, network, models, native runs, installs, authentication, service
  changes, security changes, git mutation, publication, or nested packets.
- The external wrapper owns syntax checks and receipt; do not call receipt tools.
- This is private observation history, not authorization or proof of native execution.

## Items

### P1 — Copy the reviewed owner byte for byte
- **files**: history/journal-owner-v2.mjs
- **do**: Copy work-orders/journal-owner-v2/src/index.mjs verbatim. No substitutions.
- **accept**: node --check history/journal-owner-v2.mjs

### P2 — Copy the filesystem test helper byte for byte
- **files**: tests/journal-owner-v2.memfs.mjs
- **do**: Copy work-orders/journal-owner-v2/tests/memfs.mjs verbatim. No substitutions.
- **accept**: node --check tests/journal-owner-v2.memfs.mjs
- **needs**: P1

### P3 — Relocate the shared assertions helper
- **files**: tests/journal-owner-v2.helper.mjs
- **do**: Copy work-orders/journal-owner-v2/tests/helper.mjs verbatim except replace '../src/run-journal-v1.mjs' with '../history/run-journal-v1.mjs'.
- **accept**: node --check tests/journal-owner-v2.helper.mjs
- **needs**: P1

### P4 — Relocate the two baseline checks
- **files**: tests/journal-owner-v2-baseline.test.mjs
- **do**: Copy work-orders/journal-owner-v2/tests/baseline.test.mjs verbatim except replace '../src/index.mjs' with '../history/journal-owner-v2.mjs' and the literal '../src/' with '../history/'. The package.json path remains unchanged and now checks the canonical private package.
- **accept**: node --check tests/journal-owner-v2-baseline.test.mjs
- **needs**: P1

### P5 — Relocate the twenty-eight behavior checks
- **files**: tests/journal-owner-v2.test.mjs
- **do**: Copy work-orders/journal-owner-v2/tests/owner.test.mjs verbatim except replace '../src/index.mjs' with '../history/journal-owner-v2.mjs'; '../src/run-journal-v1.mjs' with '../history/run-journal-v1.mjs'; './memfs.mjs' with './journal-owner-v2.memfs.mjs'; './helper.mjs' with './journal-owner-v2.helper.mjs'. Include the module URL replacement near the fresh-process test.
- **accept**: node --check tests/journal-owner-v2.test.mjs
- **needs**: P1, P2, P3

### P6 — Relocate six adjudication-boundary checks
- **files**: tests/journal-owner-v2-adjudication.test.mjs
- **do**: Copy work-orders/journal-owner-v2/tests/adjudication-boundaries.test.mjs verbatim except replace '../src/index.mjs' with '../history/journal-owner-v2.mjs'; '../src/run-journal-v1.mjs' with '../history/run-journal-v1.mjs'; './memfs.mjs' with './journal-owner-v2.memfs.mjs'; './helper.mjs' with './journal-owner-v2.helper.mjs'.
- **accept**: node --check tests/journal-owner-v2-adjudication.test.mjs
- **needs**: P1, P2, P3

### P7 — Relocate sixteen store-boundary checks
- **files**: tests/journal-owner-v2-store.test.mjs
- **do**: Copy work-orders/journal-owner-v2/tests/store-boundary.test.mjs verbatim except replace '../src/index.mjs' with '../history/journal-owner-v2.mjs'; '../src/run-journal-v1.mjs' with '../history/run-journal-v1.mjs'; '../src/run-journal-store-v1.mjs' with '../history/run-journal-store-v1.mjs'; './memfs.mjs' with './journal-owner-v2.memfs.mjs'; './helper.mjs' with './journal-owner-v2.helper.mjs'. These replacements include URLs. Do not replace the store import literal inside the test-only wrapper: it remains './run-journal-store-v1.mjs'. All hashes remain unchanged.
- **accept**: node --check tests/journal-owner-v2-store.test.mjs
- **needs**: P1, P2, P3

### P8 — Relocate four Windows-coauthored XPC observation checks
- **files**: tests/journal-owner-v2-xpc.test.mjs
- **do**: Copy work-orders/journal-owner-v2/tests/windows-xpc-integration.test.mjs verbatim except replace '../src/index.mjs' with '../history/journal-owner-v2.mjs'; '../../../history/fixed-xpc-journal-observation-v1.mjs' with '../history/fixed-xpc-journal-observation-v1.mjs'; '../../../tests/fixtures/fixed-xpc-journal-observation.mjs' with './fixtures/fixed-xpc-journal-observation.mjs'; './memfs.mjs' with './journal-owner-v2.memfs.mjs'. No other changes.
- **accept**: node --check tests/journal-owner-v2-xpc.test.mjs
- **needs**: P1, P2

## Packet acceptance
git diff --check
