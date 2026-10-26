---
packet: nisi-track1-fix-containment-guard
project_root: ~/nisi/work-orders/parallel-seven-tracks-v1/track1
created_by: codex
created: 2026-09-17T11:42:00-07:00
write_owner: opencode
status: blocked
---

# Track 1 — close must-fix 3 (containment guard and owned-root boundary)

## Context

Source of truth: finding 3 of the "Cross-review (Claude, adversarial, second
pass, 2026-09-14)" section of `README.md` in this directory. It names six leak
mutants that all pass 10/10 today (`leak-parent-engine`,
`leak-parent-workspace`, `root-before-profile-gate`, `open-outside-tmpdir`,
`cb-writefile-outside`, `symlink-escape`) and the exact APIs the guard misses:
callback `fs.*` forms, `fsp.open`/`fs.open`/`fs.openSync` flag checks, and the
lexical `inside()` that never resolves symlinks.

The product's own materializer writes workspace files with
`io.open(O_WRONLY|O_CREAT|O_EXCL)` (`hosts/repository/task-workspace-v1.mjs:160`),
so a guard that only patches 12 `fsp` names and 12 sync names observes nothing.
Mirror the reviewed idiom in `tests/helpers/live-cli-side-effect-guard.mjs`
(read it; do not edit it) and use `fs.realpathSync.native` on the deepest
existing ancestor with `path.relative` for containment, so the `link/..` case is
decided by real paths, not by string prefixes.

This packet is the largest of the lane: keep the guard, the journal and the
oracle consistent, keep every existing leak assertion, and keep `npm test` green.
Oracle first. No installs, no network, no model calls, no commits, no edits
outside this directory.

## Items

### P1 — Write the finding-3 leak slice against the current guard
- **files**: findings-f3-containment-guard.test.mjs, package.json
- **do**: Create `findings-f3-containment-guard.test.mjs` (new file) that reproduces the six leak mutants as tests against the runner: writing `engine-report.json` into the caller's `parentRoot`; materializing with `parentRoot: path.dirname(ownedRoot)`; creating an empty owned root before the PROFILE_REQUIRED gate; `fsp.open(parentRoot + '/../<outside>', 'w')`; a callback `fs.writeFile` to an absolute path outside the parent; and a callback `fs.symlink` escape followed by a patched write through the symlink. Each must be detected, must leave no residue outside the owned root, and must be reported as an adverse frozen record. Add `assert.equal(writes.length, 0)` to every refusal shape. Add script `"test:f3": "node --test findings-f3-containment-guard.test.mjs"` to `package.json`, changing nothing else.
- **accept**: npm run test:f3

### P2 — Harden the guard to the owned-root boundary
- **files**: repository-fixture-runner.mjs
- **do**: Rewrite only the guard region of `repository-fixture-runner.mjs`: add callback forms for every patched name, flag-checked wrappers for `fsp.open`, `fs.open` and `fs.openSync` that permit write flags only when the resolved target is inside the owned root, wrappers for `rmdir`/`truncate`/`utimes`/`chown`/`lchmod`, and destination-argument checks for every two-path operation (`copyFile`, `rename`, `cp`, `symlink`, `link`). Make containment real by resolving the deepest existing ancestor with `fs.realpathSync.native` and comparing with `path.relative`, so a symlink escape is refused. The guard's own path must never create the owned root before the profile/argument gates. When the guard refuses, record it in the `writes` journal that the oracle reads and keep the returned record frozen. `npm test` must stay green.
- **accept**: npm run test:f3
- **needs**: P1

## Packet acceptance

npm test
