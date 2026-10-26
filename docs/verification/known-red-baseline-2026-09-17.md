# Known red baseline — 2026-09-17

## Command

`npm test` at this repository's root (`node scripts/require-node.cjs && node --test tests/*.test.mjs`).

## Observed counts

1788 total → 1768 pass, 10 fail.

## Eight TS2688 failures (declared `@types/node` not installed)

Every failure is `error TS2688: Cannot find type definition file for 'node'`:
`node_modules` ships `typescript` but not `@types/node`, so each tsc-based type
test dies before it can assert anything. Each file below runs `tsc` with
`--types node --typeRoots node_modules/@types` for a positive consumer and a
negative-control compile, so each file contributes two failing tests (eight
failing tests total across the four files):

- `tests/repository-incident-types.test.mjs`
- `tests/repository-host-history-types.test.mjs`
- `tests/journal-owner-v2-types.test.mjs`
- `tests/journal-maintenance-types.test.mjs`

## Two frozen-import overlay failures (manifest drift)

- `tests/veritas-import.test.mjs`
- `tests/nisi-native-overlay.test.mjs`

These two failures are frozen-import overlay manifest drift and are out of scope
for this prerequisite fix.

## Declared pin

`package.json` declares `devDependencies["@types/node"] = "24.13.3"`.

## One-line remediation

`npm install`

## Statement

As of 2026-09-17, this baseline is RED — 10 failures (eight `TS2688`
type-test failures and two frozen-import overlay manifest-drift failures) — and
stays red until the remediation (`npm install`) is authorized and run. No type
test is passing in this baseline.

## Post-remediation re-measurement — 2026-09-17 (after authorized `npm install`)

Louis authorized the one-line remediation, which was then run as
`npm install --no-audit --no-fund --ignore-scripts` (2 packages added, 104 ms,
served from the local npm cache). `git status` shows `package-lock.json`
**unmodified**: the existing lockfile already pinned `@types/node`,
`typescript` and `undici-types`, and the install only materialized them into
`node_modules` — no lockfile churn and no new dependency decisions.

The section above is retained as the pre-remediation measurement and is **not**
deleted, because it documents what the red state actually was.

### Observed counts after remediation

`npm test` → 1782 total, 1780 pass, **2 fail**, 0 skipped, 0 todo.

`npm run test:types` → exit 0, no `TS2688` diagnostics.

`npm run preflight` → `PRESENT @types/node@24.13.3`, exit 0.

Arithmetic reconciles with the section above: 1768 pass + 8 cleared `TS2688`
failures + 4 tests added by
`tests/type-prerequisite.test.mjs` = 1780; 10 failures − 8 cleared = 2.

### Correction to the failure attribution above

The pre-remediation section lists the two frozen-import overlay failures against
`tests/veritas-import.test.mjs` and `tests/nisi-native-overlay.test.mjs`. That
attribution is **wrong** and is corrected here from isolated per-file runs:

- `tests/veritas-import.test.mjs` → 13 tests, 13 pass, 0 fail (fully green).
- `tests/nisi-native-overlay.test.mjs` → 8 tests, 6 pass, 2 fail.

Both remaining failures are therefore in the single file
`tests/nisi-native-overlay.test.mjs`, at assertion sites
`tests/nisi-native-overlay.test.mjs:122`, `:130`, `:138` and `:156` (the last
being `deepStrictEqual` with `actual: []` against
`expected: ['native/macos/CodenameVeritasFramework/.build']`).

### Current statement

As of 2026-09-17 after remediation, this repository's only red is the
frozen-import overlay manifest drift inside
`tests/nisi-native-overlay.test.mjs` — 2 failing tests, both in that one file.
No type test is failing and the declared `@types/node` prerequisite is
installed. The drift itself is undiagnosed: this document records the
measurement only and does not claim to know whether the stale artifact is the
test's expectation or the tree.