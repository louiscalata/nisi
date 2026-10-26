---
packet: nisi-fix-type-prerequisite
project_root: ~/nisi
created_by: codex
created: 2026-09-17T12:05:00-07:00
write_owner: opencode
status: done
---

# nisi — make the missing type prerequisite explicit and fail closed

## Context

Measured on this machine, 2026-09-17: `npm test` at this root is RED,
1768/1778, and eight of the ten failures share one cause —
`error TS2688: Cannot find type definition file for 'node'`. `package.json`
declares `devDependencies["@types/node"] = "24.13.3"`, but `node_modules`
contains only `typescript`, so every tsc-based type test
(`tests/*-types.test.mjs`, `tests/repository-*-types.test.mjs`,
`tests/journal-*-types.test.mjs`) fails before it can assert anything. The other
two failures are frozen-import overlay manifest drift and are NOT in scope here.

Installing a dependency is outside this packet's authority: never run any `npm
install`/`npm ci`/`npx`, never edit the dependency declarations, and never
weaken, skip, delete or rewrite a type assertion to make the suite green. The
fix available without an install is to stop the suite reporting an opaque
compiler error and make the missing prerequisite explicit, fail-closed and
actionable — which is this repository's own style for every other prerequisite.

Preserve all existing dirty work. No network, no model calls, no commits, no
edits outside this repository.

## Items

### P1 — Add the prerequisite test
- **files**: tests/type-prerequisite.test.mjs, package.json
- **do**: Create `tests/type-prerequisite.test.mjs` (new file) asserting, with no network and no install: (a) `package.json` declares a `devDependencies["@types/node"]` pin and the test reads that pin rather than hard-coding a version; (b) a prerequisite check reports the exact state `MISSING_TYPES_NODE` with the declared version and the exact remediation line `npm install` when `node_modules/@types/node` is absent, and `PRESENT` when it exists; (c) the check is wired into the `preflight` script in `package.json` so it runs before any type test; (d) `package.json`'s `test:types` script is byte-identical to its pre-packet value, proving the red suite was not edited into passing. Add script `"test:type-prerequisite": "node --test tests/type-prerequisite.test.mjs"` to `package.json` and change nothing else there.
- **accept**: npm run test:type-prerequisite

### P2 — Wire the prerequisite into preflight and record the red baseline
- **files**: package.json, docs/verification/known-red-baseline-2026-09-17.md
- **do**: Edit only the `preflight` script value in `package.json` so it runs the prerequisite check first and exits nonzero with `MISSING_TYPES_NODE` and the declared version when the types package is absent — do not change any other script. Create `docs/verification/known-red-baseline-2026-09-17.md` (new file) recording: the exact command, the exact observed counts (1788 total → 1768 pass, 10 fail), the eight `TS2688` failures by test file, the two frozen-import overlay failures by test file, the declared `@types/node` pin, the exact one-line remediation, and a dated statement that this baseline is red until that remediation is authorized and run. Do not claim the suite is green and do not mark any type test as passing.
- **accept**: npm run test:type-prerequisite
- **needs**: P1

## Packet acceptance

node --check index.mjs
