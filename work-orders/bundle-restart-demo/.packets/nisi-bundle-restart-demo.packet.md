---
packet: nisi-bundle-restart-demo
project_root: /Users/louiscalata/nisi-next-private/work-orders/bundle-restart-demo
created_by: claude
created: 2026-09-13T16:45:00-07:00
write_owner: opencode
status: done
---

# Nisi — bundle restart demo (the U02-04 exit criterion, demonstrated across real processes)

## Context

Revision 2 (2026-09-13 17:20 PDT, after Claude's cross-review found the JS
`fs.realpathSync` vs kernel divergence on `link/..`): the boundary now requires a
normalized path and `fs.realpathSync.native`. No other change.

Isolated private work-order test adapter, NOT the production host. Node 24, ESM,
no dependencies. `npm test` passes 3 baseline checks (pins the four frozen
modules and two fixtures by sha256). `npm run test:demo` (9 tests) fails
against the placeholder; those failures are expected unfinished work, not
permission to edit tests or fixtures. The tests spawn a NEW real Node process
per request through `fixtures/demo-cli.mjs` (already written; it owns stdin
parsing and the one-line response envelope; DO NOT write a runner or CLI) and
keep their synthetic journals under this work order's `.scratch/`. This prose
is the complete contract; the tests are the oracle.

Target: `src/bundle-restart-demo.mjs`, exporting exactly one synchronous named
function `runBundleDemoRequest(input)`. Its ONLY imports are
`../frozen/host-journal-bundle.mjs` (read it; do not edit it), `node:fs`,
`node:path` and `node:url`. It never throws for an ordinary JSON input or any
represented filesystem/journal outcome; it returns a plain JSON-safe object.
Forbidden anywhere in the file: `fetch`, `XMLHttpRequest`, `eval`, `Function`,
`setTimeout`, `setInterval`, `child_process`, `Date`, `Math.random`.

The frozen bundle exports `openJournalBundle({ path, fs, config, now })` →
either `{ status: 'REFUSED', reason, authorizing: false }` (reasons
`INVALID_INPUT`, `READ_FAILED`, `PROJECT_MISMATCH`) or a bundle
`{ status: 'OPEN'|'SEALED', recovery, sha256, bytes, entries, interrupted, journal, authorizing: false }`,
and `recordFixedRun({ bundle, run, now })` → always
`{ status, entryId, journal, store, sha256, bytes, authorizing: false }` with
`status` one of `RECORDED | DUPLICATE | CONFLICT | STORE_CONFLICT | STORE_FAILED | REFUSED`
(`reason` present on REFUSED, e.g. `BUNDLE_SEALED`, `INVALID_INPUT`, a builder
reason, or a journal code). `bundle.entries` rows contain a frozen `journal`
handle and functions; the response must NOT include `bundle.journal`.

### Response shape — exact keys in this insertion order for EVERY result
```
{ status, reason, bundle, record, sha256, bytes, pid,
  authorizing: false, isolationAccepted: false, generatedCodeExecuted: false }
```
Defaults: `reason`, `bundle`, `record`, `sha256` = `null`; `bytes` = `0`;
`pid` = `process.pid` of the current process (read via the `node:process`
global `process` — do not import it). `bundle`, when present, is a plain copy of
the opened bundle WITHOUT its `journal` key, in this key order:
`status, recovery, sha256, bytes, entries, interrupted, authorizing`, where
`entries` is `bundle.entries` copied to plain JSON (each row's `entry`,
`historical`, `retained`, `revoked`, `expired`, `liveness`, `authorizing`).
`record`, when present, is the `recordFixedRun` result as returned (it is
already plain). `sha256`/`bytes` are the bundle's on-disk values after the
operation (`record.sha256`/`record.bytes` after a RECORDED; the opened
bundle's otherwise).

### Common request validation → `{ status: 'REFUSED', reason: 'INVALID_INPUT', ... }` with defaults
- `input` is a non-null non-array object with EXACTLY the command's keys
  (below), no more, no fewer.
- `command` is `'inspect'` or `'record'`.
- `path` is a non-empty absolute string, no NUL, EQUAL to `path.normalize(path)`
  (so no `.`/`..` segments survive) AND not ending in the path separator
  (`normalize` preserves a trailing slash, so check it separately), whose basename is
  exactly `journal.jsonl`, whose parent directory EXISTS, is a real directory,
  and whose KERNEL real path (`fs.realpathSync.native`, never the JS
  `fs.realpathSync`, which collapses `link/..` lexically before resolving the
  link and therefore disagrees with where `open()` lands) is strictly inside
  this work order's `.scratch` directory (locate it from `import.meta.url` with
  `fileURLToPath` and `node:path`; realpath both sides with `.native` before
  comparing; a path equal to `.scratch` itself is outside). If the target file exists it must be a regular
  non-symlink file (`fs.lstatSync`); a missing file is allowed. Never create
  directories. Any lstat/realpath exception → `INVALID_INPUT`.
- `config` is a non-null non-array object (the bundle validates it further and
  returns `INVALID_INPUT` on a bad one, which you forward as your own
  `INVALID_INPUT`).
- `now` is a safe integer >= 0 and not `-0`.
- `inspect` keys: `command, path, config, now`.
- `record` keys: `command, path, config, now, run`, where `run` must be a
  non-null non-array object (its contents are validated by the bundle/builder).

### inspect
`bundle = openJournalBundle({ path, fs: <real node:fs module>, config, now })`.
A `REFUSED` open → `{ status: 'REFUSED', reason: <the open reason>, ... }` with
defaults. Otherwise `{ status: 'INSPECTED', reason: null, bundle: <plain copy>, record: null, sha256: bundle.sha256, bytes: bundle.bytes, pid, ...false }`.
Inspect never writes (the bundle's open performs only a read).

### record
Open as for inspect; a refused open → the same REFUSED result. Then
`record = recordFixedRun({ bundle, run, now })`. Then return, with `bundle`
= the plain copy taken AFTER the record call (so `entries`/`sha256`/`bytes`
reflect a RECORDED write) and `record` = the record result:
- `record.status === 'RECORDED'` → `status: 'RECORDED', reason: null, sha256: record.sha256, bytes: record.bytes`.
- `DUPLICATE` / `CONFLICT` / `STORE_CONFLICT` / `STORE_FAILED` → `status` = that
  string, `reason: null`, `sha256`/`bytes` = the bundle's current values.
- `REFUSED` → `status: 'REFUSED', reason: record.reason`, `sha256`/`bytes` =
  the bundle's current values, `bundle` and `record` both still present.
Every response's `pid` is the current process id. `authorizing`,
`isolationAccepted`, `generatedCodeExecuted` are always `false`.

## Constraints

- Write ONLY `src/bundle-restart-demo.mjs`. Everything else is read-only:
  `package.json`, `roadmap.md`, `tests/`, `fixtures/` (including
  `fixtures/demo-cli.mjs`), `frozen/`, `evidence/`, `.packets/`, `.scratch/`.
  No parent-tree exploration.
- The executor owns only this draft. Claude authored the contract; Astra
  (Codex) owns review; packet completion is not product completion.
- No dependencies, installs, network or model calls; no process spawning; the
  only filesystem access is the real `node:fs` handed to the frozen bundle plus
  the `lstatSync`/`realpathSync` boundary checks above.
- Keep all work private. No commits, pushes, packages, public README/demo or
  disclosures. Nothing in this packet grants publication permission.
- Do not run commands, tests or nested packets yourself. The installed wrapper
  runs the inspected acceptance checks and writes the execution receipt.
- Do not alter tests, fixtures, acceptance commands, order or receipt to obtain
  DONE. If required context is missing, leave a concrete blocker, not an
  invented result.

## Items

### P1 — Implement runBundleDemoRequest
- **files**: src/bundle-restart-demo.mjs
- **do**: Replace the placeholder with the synchronous named export runBundleDemoRequest(input) implementing the request validation, the .scratch boundary, inspect and record through the frozen bundle with real node:fs, and the exact response shape above.
- **accept**: npm run test:demo

## Packet acceptance
npm test
